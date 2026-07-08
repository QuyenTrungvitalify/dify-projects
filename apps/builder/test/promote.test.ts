/**
 * Spec 052 — the `kind:'promote'` build flow (B1 gate → distill turn → B2′ re-gate → Approve → finalize).
 *
 * Drives the promote functions DIRECTLY (the orchestrator-unit-test precedent) with faked `runPython`
 * (the promote_gate.py / build_index.py verdicts) + `runTurn` (the distill turn's on-disk effect), so the
 * full pipeline runs without a real `claude` turn, a `.venv`, or Dify. Asserts:
 *   AC2 — an ineligible source parks at `promote_blocked`, no turn spawned, nothing staged.
 *   AC3 — an eligible source runs the distill turn, staging ONLY under the run dir.
 *   AC4 — a distilled output failing the re-gate parks at `promote_distill_failed`; a mechanical rule is recorded.
 *   AC5 — Approve is the ONLY write to templates/patterns/; Request-changes re-runs; Discard writes nothing.
 *   AC6 — Approve stamps x-provenance (spec=052), rebuilds INDEX; a slug collision is surfaced, never silent.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  startPromote,
  promoteConfirm,
  promoteReply,
  parseVerdict,
  provenanceHeader,
  resolvePromoteSource,
  firstFreePatternSlug,
} from '../server/lib/promote.js';
import { createPromoteTask, loadTask } from '../server/state/task.js';
import { readArtifactContents } from '../server/lib/artifacts.js';
import { acquireTurn, releaseTurn } from '../server/lib/lock.js';
import type { OrchestratorCtx } from '../server/lib/orchestrator-shared.js';
import type { ShellResult } from '../server/lib/shell.js';
import type { TurnResult } from '../server/lib/turn-runner.js';

const log = { info() {}, warn() {}, error() {}, debug() {} } as unknown as OrchestratorCtx['log'];

const VERDICT = (eligible: boolean, reasons: string[] = [], probe = 'skipped'): string =>
  JSON.stringify({ eligible, reasons, probe, probe_detail: 'no creds', known_good_dify: null }, null, 2);

describe('promote flow (spec 052)', () => {
  let dir: string;
  let calls: string[][];
  // configurable fakes
  let b1: string; // B1 check verdict JSON
  let reGate: string; // B2′ (--distilled) verdict JSON
  let stagedContent: string | null; // what the distill turn writes (null → writes nothing = fail)
  let notes: unknown | null; // the turn's notes.json (null → none)
  let indexCode: number;

  const fakeRunPython = async (_cwd: string, args: string[]): Promise<ShellResult> => {
    calls.push(args);
    if (args.includes('check')) {
      return { code: 0, stdout: args.includes('--distilled') ? reGate : b1, stderr: '' };
    }
    if (args.includes('candidate')) return { code: 0, stdout: 'added', stderr: '' };
    if (args.some((a) => a.includes('build_index.py'))) return { code: indexCode, stdout: '', stderr: indexCode ? 'boom' : '' };
    if (args.some((a) => a.includes('check_provenance.py'))) return { code: 0, stdout: 'current', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };

  const fakeRunTurn = async (): Promise<TurnResult> => {
    // Simulate the distill turn's on-disk effect: write the staged pattern (+ optional notes).
    const t = await loadTask(dir, currentTaskId);
    if (stagedContent != null) {
      const staged = join(dir, `apps/builder/.runs/${t.taskId}/promote/${t.promote!.slug}.yml`);
      await writeFile(staged, stagedContent, 'utf8');
      if (notes != null) {
        await writeFile(join(dir, `apps/builder/.runs/${t.taskId}/promote/notes.json`), JSON.stringify(notes), 'utf8');
      }
    }
    return { sessionId: 's1', result: { type: 'result' }, isError: false };
  };

  let currentTaskId = '';
  const makeCtx = (): OrchestratorCtx => ({
    projectsDir: dir,
    settingsPath: join(dir, 'headless-settings.json'),
    log,
    runners: { runPython: fakeRunPython, runTurn: fakeRunTurn as unknown as NonNullable<OrchestratorCtx['runners']>['runTurn'] },
  });

  /** Scaffold a source workflow on disk so resolvePromoteSource + the flow find it. */
  async function seedSource(project = 'proj', workflow = 'my-flow'): Promise<void> {
    await mkdir(join(dir, `projects/${project}/${workflow}/workflows`), { recursive: true });
    await writeFile(join(dir, `projects/${project}/${workflow}/workflows/main.yml`), 'app:\n  name: My Flow\n', 'utf8');
  }

  async function startEligible(): Promise<string> {
    const src = resolvePromoteSource(dir, 'proj', 'my-flow');
    assert.ok(src.ok);
    const task = await createPromoteTask(dir, { project: 'proj', workflow: 'my-flow', sourceFile: (src as { sourceFile: string }).sourceFile, slug: (src as { slug: string }).slug });
    currentTaskId = task.taskId;
    assert.ok(acquireTurn(task.taskId));
    try {
      await startPromote(task, makeCtx());
    } finally {
      releaseTurn(task.taskId);
    }
    return task.taskId;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'promote-'));
    calls = [];
    b1 = VERDICT(true);
    reGate = VERDICT(true);
    stagedContent = '# Pattern: demo\napp:\n  name: Demo Pattern\n  description: a demo\n';
    notes = null;
    indexCode = 0;
    // the skill body the distill turn reads (rendered, but the fake turn ignores it) must exist on disk.
    await mkdir(join(dir, '.claude/skills/dify-build'), { recursive: true });
    await writeFile(join(dir, '.claude/skills/dify-build/promote.md'), 'distill {{SOURCE_PATH}} → {{STAGED_PATH}}', 'utf8');
    await seedSource();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ── unit: parseVerdict / provenanceHeader / resolvePromoteSource / firstFreePatternSlug ──
  test('parseVerdict reads the pretty-printed gate JSON (and a noisy fallback)', () => {
    const v = parseVerdict(VERDICT(false, ['llm node has an empty model']));
    assert.equal(v?.eligible, false);
    assert.deepEqual(v?.reasons, ['llm node has an empty model']);
    const noisy = parseVerdict('some warning line\n' + VERDICT(true) + '\ntrailing');
    assert.equal(noisy?.eligible, true);
    assert.equal(parseVerdict('not json'), null);
  });

  test('provenanceHeader stamps source=original, license=MIT, spec=052, known_good_dify', () => {
    const h = provenanceHeader('projects/p/w/workflows/main.yml', '1.13.0');
    assert.match(h, /# x-provenance: source=original/);
    assert.match(h, /file="projects\/p\/w\/workflows\/main\.yml"/);
    assert.match(h, /license=MIT spec=052 known_good_dify=1\.13\.0/);
  });

  test('resolvePromoteSource: 404 for a missing workflow, 400 for traversal, ok slug is hyphenated', async () => {
    assert.equal((resolvePromoteSource(dir, 'proj', 'nope') as { status: number }).status, 404);
    assert.equal((resolvePromoteSource(dir, '..', 'x') as { status: number }).status, 400);
    const ok = resolvePromoteSource(dir, 'proj', 'my-flow');
    assert.ok(ok.ok);
    assert.equal((ok as { slug: string }).slug, 'my-flow');
  });

  // ── AC2: the B1 blocked gate ──
  test('AC2 — an ineligible source parks at promote_blocked; no turn spawned, nothing staged', async () => {
    b1 = VERDICT(false, ['llm node abc has an empty model (provider/name)']);
    const id = await startEligible();
    const t = await loadTask(dir, id);
    assert.equal(t.status, 'awaiting_confirm');
    assert.equal(t.gate?.flag, 'promote_blocked');
    assert.match(t.promote!.note!, /empty model/);
    // exactly ONE gate check ran (B1), never the distill turn, never templates/.
    assert.equal(calls.filter((a) => a.includes('check')).length, 1);
    assert.ok(!existsSync(join(dir, `apps/builder/.runs/${id}/promote`)));
    assert.ok(!existsSync(join(dir, 'templates/patterns')));
  });

  // ── AC3: the distill turn stages only under the run dir ──
  test('AC3 — an eligible source distills to the run dir and parks at promote_review', async () => {
    const id = await startEligible();
    const t = await loadTask(dir, id);
    assert.equal(t.status, 'awaiting_confirm');
    assert.equal(t.gate?.flag, 'promote_review');
    assert.equal(t.promote!.staged, `apps/builder/.runs/${id}/promote/my-flow.yml`);
    assert.ok(existsSync(join(dir, t.promote!.staged!)), 'staged pattern written under the run dir');
    assert.ok(!existsSync(join(dir, 'templates/patterns')), 'nothing under templates/ before Approve');
    // both gates ran: B1 (check) + B2′ (check --distilled).
    assert.equal(calls.filter((a) => a.includes('check')).length, 2);
    assert.ok(calls.some((a) => a.includes('--distilled')));
  });

  // ── AC4: re-gate reject + candidate rule ──
  test('AC4 — a distilled output failing the re-gate parks at promote_distill_failed, templates untouched', async () => {
    reGate = VERDICT(false, ['lint_refs.py exit 1: dangling ref {{#999.text#}}']);
    const id = await startEligible();
    const t = await loadTask(dir, id);
    assert.equal(t.gate?.flag, 'promote_distill_failed');
    assert.match(t.promote!.note!, /dangling ref/);
    assert.ok(!existsSync(join(dir, 'templates/patterns')));
  });

  test('AC4 — a mechanical gotcha in notes.json is routed to promote_gate.py candidate', async () => {
    notes = { mechanicalRules: [{ rule: 'env vars use name: not variable:', citation: 'vendor/dify-src/x' }], designGotchas: ['idempotency'] };
    const id = await startEligible();
    const t = await loadTask(dir, id);
    assert.equal(t.gate?.flag, 'promote_review');
    assert.deepEqual(t.promote!.rules, ['env vars use name: not variable:']);
    const cand = calls.find((a) => a.includes('candidate'));
    assert.ok(cand);
    assert.ok(cand!.includes('--rule') && cand!.includes('env vars use name: not variable:'));
  });

  // ── AC5/AC6: Approve is the only write to templates/patterns/, with provenance + INDEX ──
  test('AC5/AC6 — Approve stamps provenance, moves to templates/patterns/, rebuilds INDEX', async () => {
    const id = await startEligible();
    assert.ok(!existsSync(join(dir, 'templates/patterns/my-flow.yml')), 'not there before Approve');
    let t = await loadTask(dir, id);
    assert.ok(acquireTurn(id));
    try {
      await promoteConfirm(t, 'approve', makeCtx());
    } finally {
      releaseTurn(id);
    }
    t = await loadTask(dir, id);
    assert.equal(t.status, 'done');
    assert.equal(t.promote!.target, 'templates/patterns/my-flow.yml');
    const written = await readFile(join(dir, 'templates/patterns/my-flow.yml'), 'utf8');
    assert.match(written, /# x-provenance: source=original/);
    assert.match(written, /spec=052/);
    assert.match(written, /# Pattern: demo/, 'staged content carried through');
    assert.ok(!existsSync(join(dir, t.promote!.staged!)), 'staged file moved, not left behind');
    assert.ok(calls.some((a) => a.some((x) => x.includes('build_index.py'))), 'INDEX rebuilt');
  });

  test('AC6 — a slug collision surfaces overwrite/rename, never a silent clobber', async () => {
    // pre-seed an existing pattern at the target slug.
    await mkdir(join(dir, 'templates/patterns'), { recursive: true });
    await writeFile(join(dir, 'templates/patterns/my-flow.yml'), '# existing pattern\n', 'utf8');
    const id = await startEligible();
    let t = await loadTask(dir, id);
    assert.ok(acquireTurn(id));
    try {
      await promoteConfirm(t, 'approve', makeCtx());
    } finally {
      releaseTurn(id);
    }
    t = await loadTask(dir, id);
    // still parked at review, now offering the collision choice — the existing file is UNTOUCHED.
    assert.equal(t.status, 'awaiting_confirm');
    assert.equal(t.gate?.flag, 'promote_review');
    assert.ok(t.gate?.actions.some((a) => a.id === 'approve_overwrite'));
    assert.ok(t.gate?.actions.some((a) => a.id === 'approve_rename'));
    assert.equal(await readFile(join(dir, 'templates/patterns/my-flow.yml'), 'utf8'), '# existing pattern\n');

    // Save-as-new → a hyphen-suffixed slug, existing file still intact.
    assert.ok(acquireTurn(id));
    try {
      await promoteConfirm(await loadTask(dir, id), 'approve_rename', makeCtx());
    } finally {
      releaseTurn(id);
    }
    t = await loadTask(dir, id);
    assert.equal(t.status, 'done');
    assert.equal(t.promote!.target, 'templates/patterns/my-flow-2.yml');
    assert.ok(existsSync(join(dir, 'templates/patterns/my-flow-2.yml')));
    assert.equal(await readFile(join(dir, 'templates/patterns/my-flow.yml'), 'utf8'), '# existing pattern\n', 'never clobbered');
  });

  test('AC5 — Request-changes re-runs the distill turn (note-steered), no write to templates/', async () => {
    const id = await startEligible();
    calls = [];
    const t = await loadTask(dir, id);
    assert.ok(acquireTurn(id));
    try {
      await promoteReply(t, 'make the description shorter', makeCtx());
    } finally {
      releaseTurn(id);
    }
    const t2 = await loadTask(dir, id);
    assert.equal(t2.gate?.flag, 'promote_review'); // re-parked at review after the re-run
    assert.equal(calls.filter((a) => a.includes('check')).length, 1); // re-gate ran again (B2′)
    assert.ok(!existsSync(join(dir, 'templates/patterns')));
  });

  test('review-gate artifact pane shows the STAGED pattern (not the not-yet-written target)', async () => {
    const id = await startEligible();
    const t = await loadTask(dir, id);
    assert.equal(t.gate?.flag, 'promote_review');
    // `target` is set at review (the proposed path) but not on disk — readArtifactContents must read staged.
    const art = await readArtifactContents(dir, t);
    assert.match(art.yaml ?? '', /# Pattern: demo/, 'the staged pattern is surfaced for the reviewer');
    assert.equal(art.spec, null);
  });

  test('after Approve, the artifact pane reads the finalized target (staged was moved)', async () => {
    const id = await startEligible();
    assert.ok(acquireTurn(id));
    try {
      await promoteConfirm(await loadTask(dir, id), 'approve', makeCtx());
    } finally {
      releaseTurn(id);
    }
    const t = await loadTask(dir, id);
    const art = await readArtifactContents(dir, t);
    assert.match(art.yaml ?? '', /# x-provenance: source=original/, 'reads the promoted file with its header');
  });

  test('promoteReply at the blocked gate is a no-op (never re-runs a distill on an ineligible source)', async () => {
    b1 = VERDICT(false, ['llm node abc has an empty model (provider/name)']);
    const id = await startEligible();
    calls = [];
    const t = await loadTask(dir, id);
    assert.equal(t.gate?.flag, 'promote_blocked');
    assert.ok(acquireTurn(id));
    try {
      await promoteReply(t, 'try again', makeCtx());
    } finally {
      releaseTurn(id);
    }
    // no gate check ran (no re-distill), nothing staged.
    assert.equal(calls.length, 0);
    assert.ok(!existsSync(join(dir, `apps/builder/.runs/${id}/promote`)));
  });

  test('firstFreePatternSlug suffixes with -2, -3 on collision', async () => {
    await mkdir(join(dir, 'templates/patterns'), { recursive: true });
    await writeFile(join(dir, 'templates/patterns/x.yml'), '', 'utf8');
    assert.equal(firstFreePatternSlug(dir, 'x'), 'x-2');
    await writeFile(join(dir, 'templates/patterns/x-2.yml'), '', 'utf8');
    assert.equal(firstFreePatternSlug(dir, 'x'), 'x-3');
    assert.equal(firstFreePatternSlug(dir, 'y'), 'y');
  });
});
