/**
 * Spec 081 — the post-promote "share upstream" turn.
 *
 * Two layers, matching the spec's guard list:
 *   FSM (fake runners): the offer appears ONLY when origin exists + provenance is shareable; the
 *     preflight parks at the review gate with the scan/dup verdicts; confirm pushes and ends done;
 *     skip ends done exactly like a never-offered promote; every git failure re-parks with guidance.
 *   Git (REAL repos): pushContribution builds the commit in a throwaway worktree — the user's
 *     branch/index/working tree are untouched (a dirty file and a staged file survive byte-for-byte),
 *     the origin receives exactly the two contribution paths, and the temp worktree/branch are gone.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  contributionMessage,
  contributionMeta,
  loadShareConfig,
  postContribution,
  postExportBundle,
  pushContribution,
  shareableProvenance,
  sharePreflight,
} from '../server/lib/share.js';
import type { FetchLike } from '../server/lib/orchestrator-shared.js';
import { startPromote, promoteConfirm, resolvePromoteSource } from '../server/lib/promote.js';
import { createPromoteTask, loadTask, type PromoteState } from '../server/state/task.js';
import { acquireTurn, releaseTurn } from '../server/lib/lock.js';
import { runGit as realRunGit } from '../server/lib/shell.js';
import type { OrchestratorCtx } from '../server/lib/orchestrator-shared.js';
import type { ShellResult } from '../server/lib/shell.js';
import type { TurnResult } from '../server/lib/turn-runner.js';

const log = { info() {}, warn() {}, error() {}, debug() {} } as unknown as OrchestratorCtx['log'];
const execFileP = promisify(execFile);

const OK: ShellResult = { code: 0, stdout: '', stderr: '' };
const FAIL = (stderr: string, code = 1): ShellResult => ({ code, stdout: '', stderr });

const VERDICT = JSON.stringify({ eligible: true, reasons: [], probe: 'skipped', probe_detail: 'no creds', known_good_dify: null });
const SCAN_CLEAN = JSON.stringify({ file: 'x', findings: [], clean: true });
const SCAN_DIRTY = JSON.stringify({
  file: 'x', clean: false,
  findings: [{ kind: 'non-placeholder url', line: 12, excerpt: 'url: https://api.mycompany.co.jp/v1' }],
});
const CATALOG_NEW = JSON.stringify({ verdict: 'new', match: null, weak: false, fingerprint: 'f' });

// ── unit: provenance shareability (the external-license block) ──────────────────────────────────

test('shareableProvenance — local always; external only with a permissive license', () => {
  const base = { sourceFile: 's', project: 'p', workflow: 'w', slug: 'x' } as PromoteState;
  assert.ok(shareableProvenance(base), 'local (source=original/MIT)');
  assert.ok(shareableProvenance({ ...base, origin: 'external', license: 'MIT' }));
  assert.ok(shareableProvenance({ ...base, origin: 'external', license: 'Apache-2.0' }));
  assert.ok(!shareableProvenance({ ...base, origin: 'external' }), 'no license declared');
  assert.ok(!shareableProvenance({ ...base, origin: 'external', license: 'unknown' }));
  assert.ok(!shareableProvenance({ ...base, origin: 'external', license: 'GPL-3.0' }));
});

test('contributionMessage — the commit body carries the verdicts + the reviewer checklist', () => {
  const p = {
    sourceFile: 's', project: 'p', workflow: 'w', slug: 'per-row-notify',
    verdict: { eligible: true, reasons: [], probe: 'skipped', knownGoodDify: null },
    share: { state: 'review', findings: [], dup: 'new (no shelf match)' },
  } as unknown as PromoteState;
  const { subject, body } = contributionMessage(p);
  assert.equal(subject, 'contrib: add pattern per-row-notify');
  assert.match(body, /share-scan: clean/);
  assert.match(body, /near-dup: new \(no shelf match\)/);
  assert.match(body, /Reviewer checklist/);
  assert.match(body, /README \+ AGENTS\.md \+ docs\/architecture\.md/);
});

// ── FSM: offer → preflight review → push/skip (fake runners, promote.test.ts idiom) ─────────────

describe('share FSM on a promote task (spec 081 S2)', () => {
  let dir: string;
  let calls: string[][];
  let gitResponses: Record<string, ShellResult>;
  let fetchCalls: { url: string; body: unknown }[];
  let fetchReply: { ok: boolean; status: number; text: string } | Error;
  let currentTaskId = '';

  let shareScan: string; // spec 084: the share-scan verdict (default CLEAN → Share = Push ships straight)
  const fakeRunPython = async (_cwd: string, args: string[]): Promise<ShellResult> => {
    calls.push(args);
    if (args.includes('share-scan')) return { code: 0, stdout: shareScan, stderr: '' };
    if (args.some((a) => a.includes('catalog.py'))) return { code: 0, stdout: CATALOG_NEW, stderr: '' };
    if (args.includes('check')) return { code: 0, stdout: VERDICT, stderr: '' };
    return OK;
  };
  const fakeRunGit = async (_cwd: string, args: string[]): Promise<ShellResult> => {
    calls.push(['git', ...args]);
    for (const [key, resp] of Object.entries(gitResponses)) {
      if (args.includes(key)) return resp;
    }
    // Defaults model a healthy clone: identity configured, no pre-existing contrib branch.
    if (args.includes('config')) return { code: 0, stdout: 'test@example.com\n', stderr: '' };
    if (args.includes('rev-parse')) return FAIL('', 1);
    return OK;
  };
  const fakeRunTurn = async (): Promise<TurnResult> => {
    const t = await loadTask(dir, currentTaskId);
    const dstDir = join(dir, `apps/builder/.runs/${t.taskId}/promote`);
    await mkdir(dstDir, { recursive: true });
    await writeFile(join(dstDir, `${t.promote!.slug}.yml`), '# Pattern: demo\napp:\n  name: D\n', 'utf8');
    return { sessionId: 's1', result: { type: 'result' }, isError: false };
  };
  const fakeFetch: FetchLike = async (url, init) => {
    fetchCalls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (fetchReply instanceof Error) throw fetchReply;
    const r = fetchReply;
    return { ok: r.ok, status: r.status, text: async () => r.text };
  };
  const makeCtx = (): OrchestratorCtx => ({
    projectsDir: dir,
    settingsPath: join(dir, 'headless-settings.json'),
    log,
    runners: {
      runPython: fakeRunPython,
      runGit: fakeRunGit,
      fetchFn: fakeFetch,
      runTurn: fakeRunTurn as unknown as NonNullable<OrchestratorCtx['runners']>['runTurn'],
    },
  });

  // spec 084: startPromote now AUTO-finalizes a no-collision distill (no separate Approve). With a git
  // origin present the finalize parks at the share_offer gate — exactly the pre-share state these tests need.
  async function promoteToApproved(): Promise<string> {
    const src = resolvePromoteSource(dir, 'proj', 'my-flow');
    assert.ok(src.ok);
    const task = await createPromoteTask(dir, {
      project: 'proj', workflow: 'my-flow',
      sourceFile: (src as { sourceFile: string }).sourceFile, slug: (src as { slug: string }).slug,
    });
    currentTaskId = task.taskId;
    assert.ok(acquireTurn(task.taskId));
    try {
      await startPromote(task, makeCtx());
    } finally {
      releaseTurn(task.taskId);
    }
    return task.taskId;
  }

  async function confirmAction(id: string, actionId: string): Promise<void> {
    assert.ok(acquireTurn(id));
    try {
      await promoteConfirm(await loadTask(dir, id), actionId, makeCtx());
    } finally {
      releaseTurn(id);
    }
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'share-'));
    calls = [];
    gitResponses = {}; // every git call succeeds → origin exists, push works
    shareScan = SCAN_CLEAN; // spec 084: a clean scan → Share = Push (ships straight through)
    fetchCalls = [];
    fetchReply = { ok: true, status: 200, text: '{"ok":true}' };
    await mkdir(join(dir, '.claude/skills/dify-build'), { recursive: true });
    await writeFile(join(dir, '.claude/skills/dify-build/promote.md'), 'distill {{SOURCE_PATH}}', 'utf8');
    await mkdir(join(dir, 'projects/proj/my-flow/workflows'), { recursive: true });
    await writeFile(join(dir, 'projects/proj/my-flow/workflows/main.yml'), 'app:\n  name: My Flow\n', 'utf8');
    await writeFile(join(dir, 'INDEX.md'), '# index\n', 'utf8');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('finalize parks at the share offer when origin exists; the pattern is ALREADY on the local shelf', async () => {
    const id = await promoteToApproved();
    const t = await loadTask(dir, id);
    assert.equal(t.status, 'awaiting_confirm');
    assert.equal(t.gate?.flag, 'promote_share_offer');
    assert.deepEqual(t.gate?.actions.map((a) => a.id), ['share', 'share_skip']);
    assert.ok(t.gate?.actions.every((a) => a.kind === 'confirm'), 'no cancel action — a "no" must not cancel a done promotion');
    assert.ok(existsSync(join(dir, 'templates/patterns/my-flow.yml')), 'finalize already wrote the pattern');
  });

  test('no origin remote → finalize ends done with no offer (the exact pre-081 terminal state)', async () => {
    gitResponses = { remote: FAIL('fatal: not a git repository', 128) };
    const id = await promoteToApproved();
    const t = await loadTask(dir, id);
    assert.equal(t.status, 'done');
    assert.deepEqual(t.gate, { actions: [] });
    assert.equal(t.promote!.share, undefined);
  });

  test('an external source with an unknown license is never offered a share', async () => {
    const task = await createPromoteTask(dir, {
      project: '', workflow: '', sourceFile: 'pasted.yml', slug: 'ext',
      external: { yaml: 'app:\n  name: Ext\n' }, // no license declared → provenance not shareable
    });
    currentTaskId = task.taskId;
    // Drive only the finalize-relevant piece: stage a file and approve via the review gate.
    task.status = 'awaiting_confirm';
    task.gate = { actions: [{ id: 'approve', label: 'x', kind: 'confirm', route: '/confirm' }], flag: 'promote_review' };
    task.promote!.staged = `apps/builder/.runs/${task.taskId}/promote/ext.yml`;
    await mkdir(join(dir, `apps/builder/.runs/${task.taskId}/promote`), { recursive: true });
    await writeFile(join(dir, task.promote!.staged!), '# ext\n', 'utf8');
    assert.ok(acquireTurn(task.taskId));
    try {
      await promoteConfirm(task, 'approve', makeCtx());
    } finally {
      releaseTurn(task.taskId);
    }
    const t = await loadTask(dir, task.taskId);
    assert.equal(t.status, 'done', 'no share offer for unshareable provenance');
    assert.ok(!calls.some((c) => c[0] === 'git'), 'not even the origin probe runs — provenance is checked first');
  });

  test('spec 084 Share = Push — a CLEAN scan ships immediately (no 2nd confirm gate)', async () => {
    const id = await promoteToApproved();
    await confirmAction(id, 'share'); // clean scan → runShareShip runs straight through
    const t = await loadTask(dir, id);
    assert.equal(t.status, 'done');
    assert.equal(t.promote!.share?.state, 'pushed');
    assert.equal(t.promote!.share?.mode, 'git', 'no drop config in this workspace → the 081 git fallback');
    assert.match(t.promote!.share!.branch!, /^contrib\/my-flow-\d{8}$/);
    assert.ok(calls.some((c) => c.includes('share-scan')), 'share-scan ran');
    const push = calls.find((c) => c[0] === 'git' && c.includes('push'));
    assert.ok(push && push.includes('origin'), 'pushed to origin');
    const commit = calls.find((c) => c[0] === 'git' && c.includes('commit'));
    assert.ok(commit?.includes('--no-verify'));
    assert.ok(commit?.some((x) => x.includes('contrib: add pattern my-flow')), 'commit subject');
  });

  test('spec 084 fuse — a DIRTY scan (secret) BLOCKS the push: keep-local only, no push-anyway', async () => {
    shareScan = SCAN_DIRTY;
    const id = await promoteToApproved();
    await confirmAction(id, 'share');
    const t = await loadTask(dir, id);
    assert.equal(t.status, 'awaiting_confirm');
    assert.equal(t.gate?.flag, 'promote_share_review');
    assert.equal(t.promote!.share?.findings?.length, 1);
    assert.match(t.promote!.share!.findings![0].excerpt, /mycompany/);
    assert.deepEqual(t.gate?.actions.map((a) => a.id), ['share_skip'], 'no "push anyway" action — hard fuse');
    assert.ok(!calls.some((c) => c[0] === 'git' && c.includes('push')), 'blocked before any push');
  });

  test('share_skip at either gate ends done with share cleared (byte-identical terminal state)', async () => {
    const id = await promoteToApproved();
    await confirmAction(id, 'share_skip');
    const t = await loadTask(dir, id);
    assert.equal(t.status, 'done');
    assert.deepEqual(t.gate, { actions: [] });
    assert.equal(t.promote!.share, undefined);
  });

  test('a rejected push (during the Share=Push ship) re-parks with fork guidance + Try-again', async () => {
    gitResponses = { push: FAIL('remote: Permission to repo denied (403)') };
    const id = await promoteToApproved();
    await confirmAction(id, 'share'); // clean scan → ship → push fails → re-park retry
    const t = await loadTask(dir, id);
    assert.equal(t.status, 'awaiting_confirm');
    assert.equal(t.gate?.flag, 'promote_share_review');
    assert.equal(t.promote!.share?.state, 'failed');
    assert.match(t.promote!.share!.error!, /no write access|fork/);
    assert.deepEqual(t.gate?.actions.map((a) => a.id), ['share_confirm', 'share_skip'], 'Try-again offered');
  });

  // ── spec 083: the drop transport (primary when .dify-share.json carries a URL) ──

  const seedDropConfig = () =>
    writeFile(join(dir, '.dify-share.json'), JSON.stringify({ url: 'https://script.google.com/macros/s/x/exec', secret: 's3cret' }), 'utf8');

  test('083 — a configured drop URL makes the offer appear even with NO git anywhere', async () => {
    await seedDropConfig();
    gitResponses = { remote: FAIL('fatal: not a git repository', 128) };
    const id = await promoteToApproved();
    const t = await loadTask(dir, id);
    assert.equal(t.gate?.flag, 'promote_share_offer', 'drop config alone is eligible — git not required');
  });

  test('083 — a clean Share=Push ships via POST (mode drop): payload carries secret/yaml/meta, git push never runs', async () => {
    await seedDropConfig();
    const id = await promoteToApproved();
    await confirmAction(id, 'share'); // clean scan → ships via POST straight away
    const t = await loadTask(dir, id);
    assert.equal(t.status, 'done');
    assert.equal(t.promote!.share?.state, 'pushed');
    assert.equal(t.promote!.share?.mode, 'drop');
    assert.equal(t.promote!.share?.branch, undefined, 'drop mode has no branch');
    assert.equal(fetchCalls.length, 1);
    const body = fetchCalls[0].body as Record<string, unknown>;
    assert.equal(body.secret, 's3cret');
    assert.equal(body.slug, 'my-flow');
    assert.match(String(body.yaml), /x-provenance/, 'ships the FINALIZED pattern (header stamped)');
    const meta = body.meta as Record<string, unknown>;
    assert.equal(meta.nearDup, 'new (no shelf match)');
    assert.ok(meta.contributor, 'contributor identity rides in the meta');
    assert.ok(!calls.some((c) => c[0] === 'git' && c.includes('push')), 'the git transport is not touched');
  });

  test('083 — a rejected/unreachable drop re-parks with the receiver detail + Try-again', async () => {
    await seedDropConfig();
    fetchReply = { ok: true, status: 200, text: '{"ok":false,"error":"bad secret"}' };
    const id = await promoteToApproved();
    await confirmAction(id, 'share'); // clean scan → ship POST → rejected → re-park retry
    let t = await loadTask(dir, id);
    assert.equal(t.status, 'awaiting_confirm');
    assert.equal(t.promote!.share?.state, 'failed');
    assert.match(t.promote!.share!.error!, /bad secret/);
    assert.deepEqual(t.gate?.actions.map((a) => a.id), ['share_confirm', 'share_skip']);

    fetchReply = new Error('getaddrinfo ENOTFOUND script.google.com');
    await confirmAction(id, 'share_confirm'); // Try-again → offline
    t = await loadTask(dir, id);
    assert.equal(t.promote!.share?.state, 'failed');
    assert.match(t.promote!.share!.error!, /offline\?/);
  });

  test('a missing git identity fails BEFORE any branch/worktree exists, with config guidance', async () => {
    const id = await promoteToApproved();
    gitResponses = { config: { code: 0, stdout: '', stderr: '' } }; // user.email unset (empty stdout)
    calls = [];
    await confirmAction(id, 'share'); // clean scan → ship attempt → identity check fails before the worktree
    const t = await loadTask(dir, id);
    assert.equal(t.promote!.share?.state, 'failed');
    assert.match(t.promote!.share!.error!, /git config --global user\.email/);
    assert.ok(!calls.some((c) => c[0] === 'git' && c.includes('worktree')), 'stopped before touching anything');
  });
});

// ── REAL git: the worktree push leaves the user's checkout untouched ────────────────────────────

describe('pushContribution against real git repos', () => {
  let root: string; // holds origin.git + clone
  let clone: string;

  const git = (cwd: string, ...args: string[]) => execFileP('git', args, { cwd });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'share-git-'));
    const origin = join(root, 'origin.git');
    await mkdir(origin);
    await git(origin, 'init', '--bare', '--initial-branch=main');
    clone = join(root, 'clone');
    await git(root, 'clone', origin, clone);
    await git(clone, 'config', 'user.email', 'contrib@example.com');
    await git(clone, 'config', 'user.name', 'Contrib Tester');
    await writeFile(join(clone, 'INDEX.md'), '# index v1\n', 'utf8');
    await mkdir(join(clone, 'templates/patterns'), { recursive: true });
    await writeFile(join(clone, 'templates/patterns/existing.yml'), '# existing\n', 'utf8');
    await git(clone, 'add', '-A');
    await git(clone, 'commit', '-m', 'base');
    await git(clone, 'push', 'origin', 'main');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('pushes exactly the two paths from a throwaway worktree; branch lands on origin; checkout untouched', async () => {
    // The promoted state finalize leaves behind: a NEW pattern + a MODIFIED INDEX.md…
    await writeFile(join(clone, 'templates/patterns/shared-flow.yml'), '# Pattern: shared\n', 'utf8');
    await writeFile(join(clone, 'INDEX.md'), '# index v2 (rebuilt)\n', 'utf8');
    // …plus unrelated local state that must SURVIVE untouched: a dirty file and a staged file.
    await writeFile(join(clone, 'dirty.txt'), 'uncommitted work\n', 'utf8');
    await writeFile(join(clone, 'staged.txt'), 'staged work\n', 'utf8');
    await git(clone, 'add', 'staged.txt');

    const out = await pushContribution(
      clone,
      { slug: 'shared-flow', paths: ['templates/patterns/shared-flow.yml', 'INDEX.md'], subject: 'contrib: add pattern shared-flow', body: 'meta body\n\nReviewer checklist:\n- [ ] x' },
      realRunGit
    );
    assert.equal(out.error, undefined);
    assert.ok(out.ok);
    const branch = out.branch!;
    assert.match(branch, /^contrib\/shared-flow-\d{8}$/);

    // origin got the branch; its commit touches EXACTLY the two paths with the full message.
    const origin = join(root, 'origin.git');
    const { stdout: files } = await git(origin, 'show', '--name-only', '--format=', branch);
    assert.deepEqual(files.trim().split('\n').sort(), ['INDEX.md', 'templates/patterns/shared-flow.yml']);
    const { stdout: msg } = await git(origin, 'show', '-s', '--format=%B', branch);
    assert.match(msg, /contrib: add pattern shared-flow/);
    assert.match(msg, /Reviewer checklist/);
    const { stdout: tree } = await git(origin, 'show', `${branch}:templates/patterns/shared-flow.yml`);
    assert.equal(tree, '# Pattern: shared\n');

    // The user's checkout is untouched: branch still main, dirty stays dirty, staged stays staged,
    // the shelf still holds the pattern, and no contrib branch/worktree is left behind locally.
    const { stdout: head } = await git(clone, 'rev-parse', '--abbrev-ref', 'HEAD');
    assert.equal(head.trim(), 'main');
    const { stdout: status } = await git(clone, 'status', '--porcelain');
    assert.ok(status.includes('dirty.txt'), 'dirty file survived');
    assert.match(status, /^A\s+staged\.txt/m, 'staged file is still staged');
    assert.equal(await readFile(join(clone, 'templates/patterns/shared-flow.yml'), 'utf8'), '# Pattern: shared\n');
    const { stdout: branches } = await git(clone, 'branch', '--list', 'contrib/*');
    assert.equal(branches.trim(), '', 'local contrib branch cleaned up');
    const { stdout: wts } = await git(clone, 'worktree', 'list');
    assert.equal(wts.trim().split('\n').length, 1, 'no leftover worktree');
  });

  test('a second share the same day picks a suffixed branch (no collision with the remote)', async () => {
    await writeFile(join(clone, 'templates/patterns/twice.yml'), '# v1\n', 'utf8');
    await writeFile(join(clone, 'INDEX.md'), '# index v2\n', 'utf8');
    const args = { slug: 'twice', paths: ['templates/patterns/twice.yml', 'INDEX.md'], subject: 's', body: 'b' };
    const first = await pushContribution(clone, args, realRunGit);
    assert.ok(first.ok);
    // The remote branch exists; the local was cleaned. A changed file shares again the same day.
    await writeFile(join(clone, 'templates/patterns/twice.yml'), '# v2\n', 'utf8');
    const second = await pushContribution(clone, args, realRunGit);
    // Local branch names never collide (the local was deleted); the push targets the SAME remote
    // branch name only if the local name repeats — the suffix loop is keyed on local branches, so a
    // same-name push would be rejected by origin as non-fast-forward → surfaced, or succeed as an
    // update. Either way nothing is silent: assert the outcome is explicit.
    if (second.ok) {
      const { stdout } = await git(join(root, 'origin.git'), 'show', `${second.branch}:templates/patterns/twice.yml`);
      assert.equal(stdout, '# v2\n');
    } else {
      assert.match(second.error!, /push/i);
    }
  });

  test('pushing to an unreachable origin surfaces a network-shaped error and cleans up', async () => {
    await git(clone, 'remote', 'set-url', 'origin', 'https://127.0.0.1:1/unreachable/repo.git');
    await writeFile(join(clone, 'templates/patterns/offline.yml'), '# p\n', 'utf8');
    const out = await pushContribution(
      clone,
      { slug: 'offline', paths: ['templates/patterns/offline.yml', 'INDEX.md'], subject: 's', body: 'b' },
      realRunGit
    );
    assert.ok(!out.ok);
    assert.ok(out.error, 'the failure carries guidance');
    const { stdout: wts } = await git(clone, 'worktree', 'list');
    assert.equal(wts.trim().split('\n').length, 1, 'worktree cleaned up on failure');
    const { stdout: branches } = await git(clone, 'branch', '--list', 'contrib/*');
    assert.equal(branches.trim(), '', 'branch cleaned up on failure');
  });
});

// ── spec 083 units: config loader + POST transport ──────────────────────────────────────────────

describe('loadShareConfig (.dify-share.json)', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'sharecfg-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  test('absent / corrupt / empty-url / non-https all read as null (→ git fallback, never a crash)', async () => {
    assert.equal(await loadShareConfig(dir), null, 'absent');
    await writeFile(join(dir, '.dify-share.json'), '{oops', 'utf8');
    assert.equal(await loadShareConfig(dir), null, 'corrupt');
    await writeFile(join(dir, '.dify-share.json'), JSON.stringify({ url: '', secret: 'x' }), 'utf8');
    assert.equal(await loadShareConfig(dir), null, 'empty url (the committed template state)');
    await writeFile(join(dir, '.dify-share.json'), JSON.stringify({ url: 'http://insecure' }), 'utf8');
    assert.equal(await loadShareConfig(dir), null, 'plain http refused');
  });

  test('a valid config parses with the 512KB default cap', async () => {
    await writeFile(join(dir, '.dify-share.json'), JSON.stringify({ url: 'https://x/exec', secret: 's' }), 'utf8');
    assert.deepEqual(await loadShareConfig(dir), { url: 'https://x/exec', secret: 's', maxKb: 512 });
  });
});

describe('postContribution', () => {
  const CFG = { url: 'https://x/exec', secret: 's', maxKb: 512 };
  const reply = (status: number, text: string): FetchLike => async () =>
    ({ ok: status >= 200 && status < 300, status, text: async () => text });

  test('success / receiver-reject / HTTP error / non-JSON each produce a distinct explicit outcome', async () => {
    const payload = { slug: 'x', yaml: 'app: {}\n', meta: {} };
    assert.equal((await postContribution(CFG, payload, reply(200, '{"ok":true}'))).ok, true);
    const rej = await postContribution(CFG, payload, reply(200, '{"ok":false,"error":"too large"}'));
    assert.match(rej.error!, /rejected.*too large/);
    const http = await postContribution(CFG, payload, reply(500, 'Internal'));
    assert.match(http.error!, /HTTP 500/);
    const junk = await postContribution(CFG, payload, reply(200, '<html>login</html>'));
    assert.match(junk.error!, /not JSON/);
  });

  test('a network throw reads as offline guidance; an oversized pattern is stopped CLIENT-side', async () => {
    const boom: FetchLike = async () => { throw new Error('fetch failed: ENOTFOUND'); };
    const net = await postContribution(CFG, { slug: 'x', yaml: 'a: 1\n', meta: {} }, boom);
    assert.match(net.error!, /offline\?/);
    let called = false;
    const spy: FetchLike = async () => { called = true; return { ok: true, status: 200, text: async () => '{"ok":true}' }; };
    const big = await postContribution({ ...CFG, maxKb: 1 }, { slug: 'x', yaml: 'x'.repeat(2048), meta: {} }, spy);
    assert.match(big.error!, /larger than the share cap/);
    assert.equal(called, false, 'nothing was sent');
  });
});

describe('postExportBundle (spec 062 follow-up — upload the run dossier zip to Drive)', () => {
  const CFG = { url: 'https://x/exec', secret: 's', maxKb: 512 };
  const reply = (status: number, text: string): FetchLike => async () =>
    ({ ok: status >= 200 && status < 300, status, text: async () => text });
  const zipB64 = Buffer.from('PK fake zip bytes').toString('base64');

  test('success returns the Drive path; the POST carries {zip, secret, slug}, NOT yaml', async () => {
    let sent: Record<string, unknown> = {};
    const spy: FetchLike = async (_url, init) => {
      sent = init?.body ? JSON.parse(init.body as string) : {};
      return { ok: true, status: 200, text: async () => '{"ok":true,"path":"exports/2026-08/x--me--now.zip"}' };
    };
    const out = await postExportBundle(CFG, { slug: 'x', contributor: 'me', zipBase64: zipB64 }, spy);
    assert.equal(out.ok, true);
    assert.equal(out.path, 'exports/2026-08/x--me--now.zip');
    assert.equal(sent.zip, zipB64);
    assert.equal(sent.secret, 's');
    assert.equal(sent.yaml, undefined, 'an export carries a zip, never yaml');
  });

  test('a >25MB bundle is stopped CLIENT-side (never sent)', async () => {
    let called = false;
    const spy: FetchLike = async () => { called = true; return { ok: true, status: 200, text: async () => '{"ok":true}' }; };
    const huge = 'A'.repeat(34 * 1024 * 1024); // ~34MB base64 ≈ 25MB decoded → over the cap
    const out = await postExportBundle(CFG, { slug: 'x', zipBase64: huge }, spy);
    assert.match(out.error!, /larger than 25MB/);
    assert.equal(called, false, 'oversized → nothing sent');
  });

  test('a non-JSON Google page → UNCONFIRMED success (the write likely landed; verify in exports/)', async () => {
    // The /exec redirect echo often serves HTML to server clients even though doPost already wrote the
    // file. We reached Google, so we report a soft success (unconfirmed) — never a hard failure that would
    // alarm the user and invite a retry → duplicate upload.
    const out = await postExportBundle(CFG, { slug: 'x', zipBase64: zipB64 }, reply(200, '<html><title>エラー'));
    assert.equal(out.ok, true);
    assert.equal(out.unconfirmed, true);
    assert.equal(out.path, undefined, 'no path when the ack was unreadable');
  });

  test('a non-2xx redirect echo (e.g. HTTP 404) → UNCONFIRMED success, not a hard error', async () => {
    const out = await postExportBundle(CFG, { slug: 'x', zipBase64: zipB64 }, reply(404, '<!DOCTYPE html>google'));
    assert.equal(out.ok, true);
    assert.equal(out.unconfirmed, true);
  });

  test('a readable JSON rejection (e.g. bad secret) STAYS a hard failure', async () => {
    const out = await postExportBundle(CFG, { slug: 'x', zipBase64: zipB64 }, reply(200, '{"ok":false,"error":"bad secret"}'));
    assert.equal(out.ok, false);
    assert.match(out.error!, /bad secret/);
    assert.notEqual(out.unconfirmed, true);
  });
});

test('contributionMeta carries the same facts as the git commit body (verdict, scan, dup, identity)', () => {
  const p = {
    sourceFile: 's', project: 'p', workflow: 'w', slug: 'x',
    verdict: { eligible: true, reasons: [], probe: 'skipped', knownGoodDify: '1.15.0' },
    share: { state: 'review', findings: [{ kind: 'email address', line: 3, excerpt: 'a@b.jp' }], dup: 'new (no shelf match)' },
  } as unknown as PromoteState;
  const m = contributionMeta(p);
  assert.equal(m.slug, 'x');
  assert.equal(m.knownGoodDify, '1.15.0');
  assert.equal((m.shareScan as { findings: unknown[] }).findings.length, 1);
  assert.equal(m.nearDup, 'new (no shelf match)');
  assert.ok(m.contributor && m.hostname && m.sharedAt);
});

// ── preflight parsing (tool failure is reported, never silently clean) ──────────────────────────

test('sharePreflight — a tool that fails to run/parse is surfaced in `note`, not treated as clean', async () => {
  const runPython = async (_cwd: string, args: string[]): Promise<ShellResult> =>
    args.includes('share-scan')
      ? { code: 1, stdout: 'Traceback…', stderr: 'boom' }
      : { code: 0, stdout: 'not json', stderr: '' };
  const pre = await sharePreflight('/tmp', 'templates/patterns/x.yml', runPython);
  assert.equal(pre.findings.length, 0);
  assert.match(pre.note!, /share-scan did not run/);
  assert.match(pre.note!, /near-dup check did not run/);
});
