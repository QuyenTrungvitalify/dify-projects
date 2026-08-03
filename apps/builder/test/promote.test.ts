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
  resolvePastedPromoteSource,
  firstFreePatternSlug,
  undoPromotion,
} from '../server/lib/promote.js';
import { createPromoteTask, loadTask, saveTask } from '../server/state/task.js';
import { readArtifactContents, buildTree, listPromoteTasks } from '../server/lib/artifacts.js';
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
  let turnWritesShorthand: boolean; // spec 070: force the .runs shorthand → relocateRunArtifacts runs

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

  const fakeRunTurn = async (_s: unknown, _p: unknown, _u: unknown, opts?: { onText?: (t: string) => void }): Promise<TurnResult> => {
    // spec 084: emit some streamed text so `distillLog` capture is exercised.
    opts?.onText?.('Distilled the pattern — genericized the room_id and token into placeholders.');
    // Simulate the distill turn's on-disk effect: write the staged pattern (+ optional notes).
    const t = await loadTask(dir, currentTaskId);
    if (stagedContent != null) {
      // spec 070: when `turnWritesShorthand`, write under the `.runs/<id>` shorthand (production's turn
      // cwd=repo root) so relocateRunArtifacts actually runs — the path that ENOTEMPTY-collides if a staged
      // source sat under promote/. Default writes the canonical path (relocate is then a no-op).
      const root = turnWritesShorthand ? '.runs' : 'apps/builder/.runs';
      const dstDir = join(dir, `${root}/${t.taskId}/promote`);
      await mkdir(dstDir, { recursive: true });
      await writeFile(join(dstDir, `${t.promote!.slug}.yml`), stagedContent, 'utf8');
      if (notes != null) {
        await writeFile(join(dstDir, 'notes.json'), JSON.stringify(notes), 'utf8');
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
    turnWritesShorthand = false;
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

  // ── AC3 / spec 084: an eligible NO-collision source AUTO-finalizes onto the shelf ──
  test('spec 084 — an eligible no-collision source auto-finalizes onto the shelf (no review gate)', async () => {
    const id = await startEligible();
    const t = await loadTask(dir, id);
    assert.equal(t.status, 'done', 'no git origin → done (auto-approved, no review gate parked)');
    assert.equal(t.promote!.target, 'templates/patterns/my-flow.yml');
    assert.ok(existsSync(join(dir, 'templates/patterns/my-flow.yml')), 'auto-finalized onto the shelf');
    // both gates ran: B1 (check) + B2′ (check --distilled).
    assert.equal(calls.filter((a) => a.includes('check')).length, 2);
    assert.ok(calls.some((a) => a.includes('--distilled')));
    assert.ok(calls.some((a) => a.some((x) => x.includes('build_index.py'))), 'INDEX rebuilt on auto-finalize');
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
    assert.equal(t.status, 'done'); // spec 084: candidate rules recorded, then auto-finalized
    assert.deepEqual(t.promote!.rules, ['env vars use name: not variable:']);
    const cand = calls.find((a) => a.includes('candidate'));
    assert.ok(cand);
    assert.ok(cand!.includes('--rule') && cand!.includes('env vars use name: not variable:'));
  });

  // ── AC5/AC6 / spec 084: auto-finalize stamps provenance + INDEX; a collision is never auto-clobbered ──
  test('spec 084 — a no-collision distill auto-finalizes: provenance stamped, staged moved, INDEX rebuilt', async () => {
    const id = await startEligible();
    const t = await loadTask(dir, id);
    assert.equal(t.status, 'done');
    assert.equal(t.promote!.target, 'templates/patterns/my-flow.yml');
    const written = await readFile(join(dir, 'templates/patterns/my-flow.yml'), 'utf8');
    assert.match(written, /# x-provenance: source=original/);
    assert.match(written, /spec=052/);
    assert.match(written, /# Pattern: demo/, 'staged content carried through');
    assert.ok(!existsSync(join(dir, t.promote!.staged!)), 'staged file moved, not left behind');
    assert.ok(calls.some((a) => a.some((x) => x.includes('build_index.py'))), 'INDEX rebuilt');
  });

  test('AC6 / spec 084 — a slug collision is NEVER auto-clobbered: parks Overwrite/Save-as-new', async () => {
    // pre-seed an existing pattern at the target slug.
    await mkdir(join(dir, 'templates/patterns'), { recursive: true });
    await writeFile(join(dir, 'templates/patterns/my-flow.yml'), '# existing pattern\n', 'utf8');
    // spec 084: the collision is detected at the END of the distill turn → NO auto-finalize, the choice is
    // parked immediately (no separate Approve needed to surface it).
    const id = await startEligible();
    let t = await loadTask(dir, id);
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

  test('spec 084 — Request-changes/Resend re-runs the distill from a FAILED gate, no write to templates/', async () => {
    // With auto-approve, Request-changes/Resend is reachable from the distill_failed gate (the review gate
    // no longer parks on a clean no-collision distill). A note-less re-run is the tray [Resend].
    reGate = VERDICT(false, ['lint_refs.py exit 1: dangling ref {{#999.text#}}']);
    const id = await startEligible();
    let t = await loadTask(dir, id);
    assert.equal(t.gate?.flag, 'promote_distill_failed');
    calls = [];
    assert.ok(acquireTurn(id));
    try {
      await promoteReply(t, '', makeCtx()); // empty note = Resend (clean re-run)
    } finally {
      releaseTurn(id);
    }
    t = await loadTask(dir, id);
    assert.equal(t.gate?.flag, 'promote_distill_failed'); // reGate still fails → re-parked
    assert.equal(calls.filter((a) => a.includes('check')).length, 1); // re-gate ran again (B2′)
    assert.ok(!existsSync(join(dir, 'templates/patterns')));
  });

  test('a failed gate artifact pane shows the STAGED pattern (not a not-yet-written target)', async () => {
    reGate = VERDICT(false, ['bad ref']);
    const id = await startEligible();
    const t = await loadTask(dir, id);
    assert.equal(t.gate?.flag, 'promote_distill_failed');
    // `staged` is set before the re-gate fails; target is never written — readArtifactContents reads staged.
    const art = await readArtifactContents(dir, t);
    assert.match(art.yaml ?? '', /# Pattern: demo/, 'the staged pattern is surfaced for the reviewer');
    assert.equal(art.spec, null);
  });

  test('after auto-finalize, the artifact pane reads the finalized target (staged was moved)', async () => {
    const id = await startEligible();
    const t = await loadTask(dir, id);
    const art = await readArtifactContents(dir, t);
    assert.match(art.yaml ?? '', /# x-provenance: source=original/, 'reads the promoted file with its header');
  });

  test('spec 084 — the distill turn output is persisted (distillLog) for later replay', async () => {
    const id = await startEligible();
    const t = await loadTask(dir, id);
    assert.match(t.promote!.distillLog ?? '', /genericized the room_id and token/);
  });

  test('spec 084 DEV — a test distill parks at review and NEVER auto-finalizes (no shelf write)', async () => {
    const src = resolvePromoteSource(dir, 'proj', 'my-flow');
    assert.ok(src.ok);
    const task = await createPromoteTask(dir, {
      project: 'proj', workflow: 'my-flow',
      sourceFile: (src as { sourceFile: string }).sourceFile, slug: (src as { slug: string }).slug, test: true,
    });
    currentTaskId = task.taskId;
    assert.ok(acquireTurn(task.taskId));
    try {
      await startPromote(task, makeCtx());
    } finally {
      releaseTurn(task.taskId);
    }
    const t = await loadTask(dir, task.taskId);
    assert.equal(t.promote!.test, true);
    assert.equal(t.status, 'awaiting_confirm');
    assert.equal(t.gate?.flag, 'promote_review'); // parked, not auto-finalized
    assert.ok(!existsSync(join(dir, 'templates/patterns')), 'a dry-run test writes NOTHING to the shelf');
  });

  // ── spec 084 S1.5: the distill/promote tasks get their own "蒸留" section, out of the build tree ──
  test('spec 084 S1.5 — a promote task lists in listPromoteTasks and is EXCLUDED from the build tree', async () => {
    const task = await createPromoteTask(dir, {
      project: 'proj', workflow: 'my-flow', sourceFile: 'projects/proj/my-flow/workflows/main.yml', slug: 'my-flow',
    });
    const promotes = await listPromoteTasks(dir, Date.now());
    assert.ok(promotes.some((p) => p.id === task.taskId), 'appears in the 蒸留 section list');
    const tree = await buildTree(dir, Date.now());
    assert.ok(!JSON.stringify(tree).includes(task.taskId), 'NOT bucketed into the build tree (no clutter)');
  });

  test('spec 084 S1.5 — a cancelled promote is excluded from the section (Discard/Clear removes it)', async () => {
    const task = await createPromoteTask(dir, { project: 'proj', workflow: 'gone', sourceFile: 's', slug: 'gone' });
    const t = await loadTask(dir, task.taskId);
    t.status = 'cancelled';
    await saveTask(dir, t);
    const promotes = await listPromoteTasks(dir, Date.now());
    assert.ok(!promotes.some((p) => p.id === task.taskId), 'a cancelled distill is not history');
  });

  // ── spec 084 S2: Undo (inverse of finalize — unlink + rebuild index, no git) ──
  test('spec 084 — undoPromotion unlinks the shelf file + rebuilds INDEX; a missing file is a no-op', async () => {
    const id = await startEligible(); // auto-finalized templates/patterns/my-flow.yml
    assert.ok(existsSync(join(dir, 'templates/patterns/my-flow.yml')));
    calls = [];
    const t = await loadTask(dir, id);
    const r1 = await undoPromotion(t, makeCtx());
    assert.equal(r1.removed, true);
    assert.ok(!existsSync(join(dir, 'templates/patterns/my-flow.yml')), 'shelf file gone after undo');
    assert.ok(calls.some((a) => a.some((x) => x.includes('build_index.py'))), 'INDEX rebuilt on undo (catalog stays in sync)');
    // idempotent: a second undo is a no-op (removed:false), never an error.
    const r2 = await undoPromotion(t, makeCtx());
    assert.equal(r2.removed, false);
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

  // ── spec 070: distill from an EXTERNAL (pasted/uploaded) YAML — honest provenance (D3, G3) ──
  test('070 unit — provenanceHeader external branch stamps source=external + license + hash + spec=070', () => {
    const h = provenanceHeader('apps/builder/.runs/1/promote/source.yml', '', {
      label: 'colleague blog', sha256: 'deadbeef', license: 'Apache-2.0',
    });
    assert.match(h, /# x-provenance: source=external/);
    assert.match(h, /file="colleague blog"/);
    assert.match(h, /orig_sha256=deadbeef/);
    assert.match(h, /license=Apache-2\.0 spec=070/);
    assert.doesNotMatch(h, /source=original/);
    // an omitted license defaults to `unknown` (never silently MIT).
    assert.match(provenanceHeader('x', '', {}), /license=unknown/);
  });

  test('070 unit — resolvePastedPromoteSource: slug from app.name (hyphenated) + sha256; empty → 400', () => {
    const r = resolvePastedPromoteSource('app:\n  name: My Cool Flow\n');
    assert.ok(r.ok);
    assert.equal((r as { slug: string }).slug, 'my-cool-flow');
    assert.match((r as { sha256: string }).sha256, /^[0-9a-f]{64}$/);
    assert.equal((resolvePastedPromoteSource('   ') as { status: number }).status, 400);
  });

  /** Drive the flow from a PASTED source (no project workflow) up to the review gate. */
  async function startEligibleExternal(license = 'unknown'): Promise<string> {
    const yaml = 'app:\n  name: External Flow\n';
    const src = resolvePastedPromoteSource(yaml);
    assert.ok(src.ok);
    const s = src as { slug: string; sha256: string };
    const task = await createPromoteTask(dir, {
      project: '(external)', workflow: s.slug, sourceFile: '', slug: s.slug,
      external: { yaml, label: 'External Flow', sha256: s.sha256, license },
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

  test('070 — a pasted source is staged at the run-dir ROOT + carries origin=external, then auto-finalizes', async () => {
    const id = await startEligibleExternal();
    assert.ok(existsSync(join(dir, `apps/builder/.runs/${id}/source.yml`)), 'pasted YAML staged at the run-dir root');
    assert.ok(!existsSync(join(dir, `apps/builder/.runs/${id}/promote/source.yml`)), 'NOT under promote/ (relocate hazard)');
    const t = await loadTask(dir, id);
    assert.equal(t.promote!.origin, 'external');
    assert.equal(t.promote!.sourceFile, `apps/builder/.runs/${id}/source.yml`);
    assert.equal(t.status, 'done'); // spec 084: external no-collision auto-finalizes too
    assert.ok(existsSync(join(dir, `templates/patterns/${t.promote!.slug}.yml`)), 'landed on the shelf');
  });

  test('070 — a shorthand-writing distill turn relocates cleanly then auto-finalizes (the ENOTEMPTY hazard)', async () => {
    turnWritesShorthand = true; // force relocateRunArtifacts to actually run (production cwd=repo root)
    const id = await startEligibleExternal();
    const t = await loadTask(dir, id);
    assert.equal(t.status, 'done', 'relocate did not throw → the flow finalized');
    assert.ok(existsSync(join(dir, `apps/builder/.runs/${id}/source.yml`)), 'staged source survived relocate');
    assert.ok(existsSync(join(dir, `templates/patterns/${t.promote!.slug}.yml`)), 'distilled output landed on the shelf');
  });

  test('070 (G3) — an external distill AUTO-finalizes with source=external + the declared license, NOT source=original/MIT', async () => {
    const id = await startEligibleExternal('CC-BY-4.0');
    const t = await loadTask(dir, id);
    assert.equal(t.status, 'done');
    const written = await readFile(join(dir, `templates/patterns/${t.promote!.slug}.yml`), 'utf8');
    assert.match(written, /# x-provenance: source=external/);
    assert.match(written, /license=CC-BY-4\.0 spec=070/);
    assert.match(written, /file="External Flow"/);
    assert.doesNotMatch(written, /source=original/);
    assert.doesNotMatch(written, /license=MIT/);
  });
});
