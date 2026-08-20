/**
 * 013 D3 — the advance-loop integration test (fixes C2: the orchestrator's verdict/advance code was
 * untestable because it hard-imported the subprocess runners). With the D2 seams stubbed (runTurn /
 * runPython / runReport / postTurnCheck), this drives the REAL state machine
 * (startTask → confirmAdvance → replyWithin) through analyze→spec→implement→test and pins:
 *
 *   • AC #15 — `auto` runs ①→④ HANDS-FREE up to the deploy decision (no human confirm through ④).
 *   • AC #25 — a `still_failing` Implement HARD-STOPS `auto`; a lint≠0 ④ parks at an Accept gate
 *              (never silently `done`, spec 014 D2); `auto` never auto-accepts.
 *   • spec 014 D1 — deploy is ALWAYS an explicit human confirm: `auto`/`spec_only` PARK at the ④
 *                   Import gate (a clean selfhost build does NOT auto-push).
 *   • `/reply` at ④ re-runs the REPORT, not a turn.
 *   • a cancel landing mid-turn leaves `status=cancelled` with the gate cleared (no clobber).
 *
 * No real `claude`, python, or Dify is spawned — the seams make the ladder deterministic.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { startTask, confirmAdvance, replyWithin, type OrchestratorCtx } from '../server/lib/orchestrator.js';
import { acquireTurn, releaseTurn, markCancelled, unmarkCancelled } from '../server/lib/lock.js';
import { canRequestFix } from '../server/lib/gate.js';
import { createTask, type Task } from '../server/state/task.js';
import { PHASES } from '../server/lib/phases.js';
import { applyInitFake } from './helpers/scaffold-fake.js';
import type { ClaudeSession, SessionLogger } from '../server/lib/claude-session.js';
import type { TurnResult } from '../server/lib/turn-runner.js';
import { artifactHash } from '../server/lib/post-turn.js';
import type { PostTurnParams, PostTurnResult } from '../server/lib/post-turn.js';
import type { ReportResult, ReportOpts } from '../server/lib/report.js';
import type { ShellResult } from '../server/lib/shell.js';
import type { LintCodes } from '../server/lib/linters.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;

interface Overrides {
  /** the ③ lint exit codes the stubbed postTurnCheck reports (default all-0 = clean → success). */
  lintCodes?: LintCodes;
  /** the ④ report's lintClean verdict (default true). */
  reportLintClean?: boolean;
  /** when set, the runTurn stub calls markCancelled() while running THIS phase (simulates a /cancel). */
  cancelDuringTurn?: Task['phase'];
  /** spec 105 — the ③ turn looks at the workflow and writes NOTHING: the agent decided no change was
   *  needed. Models what the AGENT did, never what the check reports — the measurement stays derived
   *  from the files, so this cannot manufacture a verdict the system could not reach on its own. */
  implementNoOp?: boolean;
}

interface Harness {
  ctx: OrchestratorCtx;
  calls: { runTurn: number; runReport: number; runPython: number; postTurnCheck: number };
  /** every `task:update` emission, in order. */
  events: Array<{ phase: string; status: string; flag?: string; actions: string[] }>;
  /** spec 036 AC #9: the `task.deploy` the (stubbed) report SAW on each call — proves the Import/Skip
   *  re-report labels `selfhost` after the static→park deploy stamp (D4 Rev-A). */
  reportDeploys: string[];
  /** spec 105: what the orchestrator asked the ③ check to measure, per call. A test asserting on a
   *  hard-stop can then prove the measurement was REQUESTED, not merely injected. */
  lastPostTurn: Array<{ artifactHashBefore?: string | null; specHashBefore?: string | null }>;
}

/** Spec 036: set the self-host console env for the (async) body, then restore it (node --test = one
 *  process). ASYNC so the finally runs AFTER the awaited work — the Option A Import park triggers on
 *  `difyTargets()` (env creds) DURING the orchestrator dispatch, NOT on `task.deploy`. */
async function withDifyEnv<T>(fn: () => Promise<T>): Promise<T> {
  const prev = { url: process.env.DIFY_CONSOLE_URL, tok: process.env.DIFY_CONSOLE_TOKEN };
  process.env.DIFY_CONSOLE_URL = 'http://localhost/console/api';
  process.env.DIFY_CONSOLE_TOKEN = 'tok-test';
  try {
    return await fn();
  } finally {
    if (prev.url === undefined) delete process.env.DIFY_CONSOLE_URL; else process.env.DIFY_CONSOLE_URL = prev.url;
    if (prev.tok === undefined) delete process.env.DIFY_CONSOLE_TOKEN; else process.env.DIFY_CONSOLE_TOKEN = prev.tok;
  }
}

/** Write the artifact a real turn would produce for the task's CURRENT phase, so the (real) ①/②
 *  verify (artifact-exists + JSON + confinement) passes; ③ verify is the stubbed postTurnCheck. */
function writeArtifact(task: Task, dir: string, o: Overrides, nth: number): void {
  const phase = PHASES.find((p) => p.id === task.phase)!;
  const rel = phase.artifactRel(task);
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  if (task.phase === 'analyze') { writeFileSync(abs, '{"seed": null, "summary": "ok"}'); return; }
  if (task.phase === 'spec') { writeFileSync(abs, '# SPEC\nbuild it.\n'); return; }
  // spec 105 — a fix round CHANGES the workflow, so the bytes must differ per implement turn. This
  // wrote a constant before, which made every /reply round measure as "unchanged": harmless while
  // nothing read that, and a trap the moment something does. The tests here say "main.yml is actually
  // edited"; now that is true rather than merely asserted.
  if (o.implementNoOp) return; // the agent read the workflow and changed nothing
  writeFileSync(abs, `workflow:\n  graph:\n    nodes: []\n# round ${nth}\n`);
}

function harness(dir: string, task: Task, o: Overrides = {}): Harness {
  const calls = { runTurn: 0, runReport: 0, runPython: 0, postTurnCheck: 0 };
  const events: Harness['events'] = [];
  const reportDeploys: string[] = [];
  const lastPostTurn: Harness['lastPostTurn'] = [];

  const runTurn = async (
    _session: ClaudeSession,
    _prompt: string,
    _onSessionId?: (id: string) => void
  ): Promise<TurnResult> => {
    calls.runTurn++;
    if (o.cancelDuringTurn === task.phase) markCancelled(task.taskId);
    // NB: we deliberately don't invoke `_onSessionId` — a real turn fires it on the init event, well
    // before the result; calling it synchronously here would race the awaited post-turn saveTask on
    // the shared task.json.tmp path. The session id is still persisted below (from the return value).
    writeArtifact(task, dir, o, calls.runTurn);
    return { sessionId: `sess-${task.phase}`, result: { type: 'result', is_error: false }, isError: false };
  };

  const runPython = async (_projectsDir: string, args: string[]): Promise<ShellResult> => {
    calls.runPython++;
    // Emulate init_project.py's effect (both tiers): create projects/<project>/<workflowSlug>/workflows
    // so the SPEC.md move + the Implement artifact path resolve. (spec 030 two-tier scaffold.)
    applyInitFake(dir, args);
    return { code: 0, stdout: '', stderr: '' };
  };

  const postTurnCheck = async (p: PostTurnParams): Promise<PostTurnResult> => {
    calls.postTurnCheck++;
    lastPostTurn.push({ artifactHashBefore: p.artifactHashBefore, specHashBefore: p.specHashBefore });
    const lintCodes: LintCodes = o.lintCodes ?? { validate: 0, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 0 };
    const clean = lintCodes.validate === 0 && lintCodes.lint_refs === 0 && lintCodes.lint_plugin_hashes === 0;
    const reasons = clean ? [] : ['lint≠0 (cap-5 reached)'];
    // spec 105 — MEASURE, do not accept an answer. The real check hashes the file on disk and compares
    // with the before-hash it was handed, reporting `undefined` only when no before-hash was supplied
    // (post-turn.ts, the "not measured" contract). This fake does the same thing against the same files.
    //
    // It matters that this is not a knob: an earlier version of this harness let a test declare
    // `artifactChanged: false`, which pinned a state production cannot produce (a from-scratch build
    // always has before-hash `null` against a freshly written file) and would have let a dead branch
    // carry a green test. A stub that can assert what the system cannot do is worse than no stub.
    const hashNow = (rel: string): Promise<string | null> => artifactHash(dir, rel);
    const wfRel = `projects/${p.project}/${p.workflowSlug}/workflows/${p.workflowFile}`;
    const artifactChanged =
      p.artifactHashBefore === undefined ? undefined : p.artifactHashBefore !== (await hashNow(wfRel));
    const specChanged =
      p.specHashBefore === undefined
        ? undefined
        : p.specHashBefore !== (await hashNow(`projects/${p.project}/${p.workflowSlug}/SPEC.md`));
    return {
      ok: clean,
      status: clean ? 'done' : 'error',
      reasons,
      detail: {
        artifactOk: true, yamlOk: true, lintCodes, idsOk: true, confinementBreaches: [], extraFiles: [],
        ...(artifactChanged === undefined ? {} : { artifactChanged }),
        ...(specChanged === undefined ? {} : { specChanged }),
      },
    };
  };

  const runReport = async (
    _projectsDir: string,
    t: Task,
    _log: SessionLogger,
    _opts?: ReportOpts
  ): Promise<ReportResult> => {
    calls.runReport++;
    reportDeploys.push(t.deploy); // spec 036 AC #9: capture what deploy the report labels
    return {
      ok: true,
      reasons: [],
      reportRel: `apps/builder/.runs/${t.taskId}/report.json`,
      lintClean: o.reportLintClean ?? true,
    };
  };

  const ctx: OrchestratorCtx = {
    projectsDir: dir,
    settingsPath: '',
    log,
    broadcast: (_taskId, event, data) => {
      if (event !== 'task:update') return;
      const t = data as Task;
      events.push({
        phase: t.phase,
        status: t.status,
        flag: t.gate?.flag,
        actions: t.gate?.actions.map((a) => a.id) ?? [],
      });
    },
    runners: { runTurn, runPython, runReport, postTurnCheck },
  };
  return { ctx, calls, events, reportDeploys, lastPostTurn };
}

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'advance-loop-'));
  // runPhase reads each phase's skill body before spawning the (stubbed) turn — provide stubs so the
  // read + token-render succeeds. Content is irrelevant; the stubbed runTurn ignores the prompt.
  const skill = join(dir, '.claude', 'skills', 'dify-build');
  mkdirSync(skill, { recursive: true });
  for (const name of ['analyze', 'spec', 'implement']) {
    writeFileSync(join(skill, `${name}.md`), `# ${name}\nrequirement: {{REQUIREMENT}}\n`);
  }
  return dir;
}

/** Acquire the turn lock around a dispatched entry point, mirroring the route's dispatch/finally. */
async function withTurn(taskId: string, work: () => Promise<void>): Promise<void> {
  assert.ok(acquireTurn(taskId), 'acquired the turn lock');
  try {
    await work();
  } finally {
    releaseTurn(taskId);
    unmarkCancelled(taskId);
  }
}

afterEach(() => {
  // defensive: ensure no lock/flag leaks into the next sequential test
});

describe('advance-loop integration (013 D3)', () => {
  test('AC #15 — auto runs ①→④ hands-free (one startTask reaches done)', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'add a translate step', confirmMode: 'auto', deploy: 'none' });
    const h = harness(dir, task);

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    assert.equal(task.status, 'done', 'reached done with no human confirm');
    assert.equal(task.phase, 'test');
    // Spec 055: a from-scratch build now runs the Analyze (requirement-digest) turn too — 3 turns
    // (analyze + spec + implement); auto auto-advances the analyze gate.
    assert.equal(h.calls.runTurn, 3, 'one turn each for analyze/spec/implement (spec 055)');
    assert.equal(h.calls.runReport, 1, '④ report ran once');
    // the ladder visited every TURN phase (analyze now emits — spec 055)
    const phasesSeen = new Set(h.events.map((e) => e.phase));
    assert.deepEqual([...phasesSeen].sort(), ['analyze', 'implement', 'spec', 'test']);
    // a workflow was scaffolded for the derived slug
    assert.ok(task.workflowSlug, 'workflowSlug derived at the spec gate');
    assert.ok(task.project, 'project resolved at the spec gate (_drafts by default)');
  });

  // ── spec 105: the measured fault an autonomous build must not sail past ───────────────────────
  // Beside the still_failing test on purpose: same shape (auto must PARK), different reason.
  // still_failing is a gate STATE the verify assigns; this is something it MEASURED about the round,
  // previously readable only on a card `auto` never shows anyone.
  //
  // These build an EDIT-EXISTING task, not a from-scratch one, because that is the only configuration
  // in which the guard can fire at all: from-scratch has no file before ③ (before-hash `null` ⇒ always
  // "changed"). Pinning it on a from-scratch build would pin the function while leaving the system
  // untested.

  /** Put a workflow on disk the way an earlier build would have left it, and hand its slug to the
   *  task — `localEditSeed` then resolves project+slug and ③ edits THIS file. This is what makes the
   *  guard reachable at all: a from-scratch build has no pre-round file to compare against. */
  function seedExistingWorkflow(dir: string, slug: string): void {
    const abs = join(dir, 'projects', '_drafts', slug, 'workflows', 'main.yml');
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, 'workflow:\n  graph:\n    nodes: [{id: existing}]\n');
  }

  test('spec 105 — auto HARD-STOPS when the round left the workflow byte-identical', async () => {
    const dir = fixtureDir();
    seedExistingWorkflow(dir, 'existing_wf');
    const task = await createTask(dir, {
      requirement: 'change the notify step',
      workflow: 'existing_wf', // edit-existing: the file is already there
      confirmMode: 'auto',
      deploy: 'none',
    });
    // The turn runs and writes nothing — the agent looked and decided no change was needed. Nothing
    // about the VERDICT is injected: the check hashes the same file before and after and measures an
    // unchanged round itself.
    const h = harness(dir, task, { implementNoOp: true });

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    assert.equal(task.status, 'awaiting_confirm', 'auto parked instead of advancing');
    assert.equal(task.phase, 'implement', 'stopped AT the implement gate');
    assert.equal(task.artifactUnchanged, true, 'the fault that stopped it is the measured one');
    assert.equal(h.calls.runReport, 0, '④ never ran — a done report would have described empty work');
    // The measurement was REQUESTED by the orchestrator, not merely injected by this test: a real
    // before-hash means the file existed before ③ (the whole reason this configuration can fire).
    const implCall = h.lastPostTurn.at(-1)!;
    assert.notEqual(implCall.artifactHashBefore, undefined, '③ was asked to measure the artifact');
    assert.notEqual(implCall.artifactHashBefore, null, 'and it had a real pre-round file to measure');
  });

  test('spec 105 — a round that really changed the workflow still runs hands-free', async () => {
    const dir = fixtureDir();
    seedExistingWorkflow(dir, 'existing_wf2');
    const task = await createTask(dir, {
      requirement: 'change the notify step',
      workflow: 'existing_wf2',
      confirmMode: 'auto',
      deploy: 'none',
    });
    // Same setup, one difference: the turn actually writes, so the same measurement comes out
    // "changed". The guard must let this through untouched.
    const h = harness(dir, task);

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    assert.equal(task.status, 'done', 'a healthy measurement changes nothing — the guard is narrow');
    assert.equal(task.phase, 'test');
    assert.equal(h.calls.runReport, 1);
  });

  test('spec 105 — a from-scratch build cannot trip the guard (before-hash is null, not undefined)', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'build something new', confirmMode: 'auto', deploy: 'none' });
    const h = harness(dir, task);

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    assert.equal(task.status, 'done', 'a new build still runs end to end');
    // The mechanism the guard's comment names, pinned so a later edit cannot quietly break new builds:
    // ③ IS measured on a from-scratch build (`null` is a value, not "not measured"), and `null` against
    // a freshly written file is a real change. The guard is inert here by arithmetic, not by omission.
    const implCall = h.lastPostTurn.at(-1)!;
    assert.equal(implCall.artifactHashBefore, null, 'measured, and the file did not exist yet');
    assert.equal(task.artifactUnchanged, false, 'so the round reads as changed');
  });

  test('AC #25 — a still_failing Implement HARD-STOPS auto (parks at the gate, never reaches ④)', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'build a flaky one', confirmMode: 'auto', deploy: 'none' });
    const h = harness(dir, task, { lintCodes: { validate: 1, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 0 } });

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    assert.equal(task.status, 'awaiting_confirm', 'auto hard-stopped — did NOT advance');
    assert.equal(task.phase, 'implement');
    assert.equal(task.gate?.flag, 'still_failing');
    assert.deepEqual(task.gate?.actions.map((a) => a.id), ['accept', 'keep', 'abandon']);
    assert.equal(h.calls.runReport, 0, 'never reached ④ → never auto-ran the report/import');
  });

  test('AC #25 / D2 — a lint≠0 ④ PARKS at an Accept gate (never silently done, auto never auto-accepts)', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'selfhost dirty', confirmMode: 'auto', deploy: 'selfhost' });
    // ③ passes (postTurnCheck clean) so it reaches ④; ④'s report lint is DIRTY and NOT human-accepted.
    const h = harness(dir, task, { reportLintClean: false });

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    assert.equal(task.status, 'awaiting_confirm', 'lint≠0 ④ is never silently done — it parks (spec 014 D2)');
    assert.equal(task.phase, 'test');
    assert.equal(task.gate?.flag, 'still_failing', 'auto HARD-STOPS on the still_failing flag — no auto-accept/import');
    assert.deepEqual(task.gate?.actions.map((a) => a.id), ['accept', 'changes', 'discard']); // spec 041: + Request changes
    assert.equal(h.calls.runReport, 1, 'the report ran once and decided dirty → parked, not shipped');
  });

  test('D2 — Accept at the lint≠0 ④ gate finishes done (terminal), not auto-advanced past', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'accept dirty', confirmMode: 'auto', deploy: 'none' });
    const h = harness(dir, task, { reportLintClean: false });
    await withTurn(task.taskId, () => startTask(task, h.ctx)); // parks at the ④ still_failing gate
    assert.equal(task.gate?.flag, 'still_failing', 'parked for an explicit accept');

    await withTurn(task.taskId, () => confirmAdvance(task, 'accept', h.ctx));

    assert.equal(task.status, 'done', 'a human Accept finishes the (tagged) build');
    assert.deepEqual(task.gate?.actions ?? [], [], 'terminal gate after accept');
  });

  test('spec 036 D4/D5 (Option A + S4) — auto + clean + creds: live button OFFERED but auto stays STATIC → DONE (AC #4)', async () => {
    const dir = fixtureDir();
    // Creds present via withDifyEnv → the OLD (014 D1) behavior parked `auto` at Import. Option A finishes
    // `done` static instead (auto reaches Dify only via the D5 done-state action). `deploy:'none'` — the
    // park now keys off `difyTargets()` (creds), not the removed deploy declaration.
    const task = await createTask(dir, { requirement: 'selfhost clean auto', confirmMode: 'auto', deploy: 'none' });
    const h = harness(dir, task, { reportLintClean: true });

    await withDifyEnv(() => withTurn(task.taskId, () => startTask(task, h.ctx)));

    assert.equal(task.status, 'done', 'auto + clean + creds finishes done — no Import park (AC #4)');
    assert.equal(task.phase, 'test');
    assert.deepEqual(task.gate?.actions ?? [], [], 'terminal ④ — no actions');
    assert.notEqual(task.gate?.flag, 'awaiting_import', 'auto NEVER parks at Import under Option A');
    assert.equal(h.calls.runReport, 1, 'the report ran once; the import did NOT auto-fire');
    // S4: the implement gate DID offer the live `test_live` button (creds present) — proving auto ignored
    // it and took `continue` (static). maybeAutoAdvance no longer auto-picks test_live (D5 branch deleted).
    assert.ok(
      h.events.some((e) => e.phase === 'implement' && e.actions.includes('test_live')),
      'the implement gate offered the live button (creds present)'
    );
    assert.ok(
      !h.events.some((e) => e.flag === 'test_result' || e.flag === 'infra_degraded'),
      'auto never entered the live path — it stayed static (S4)'
    );
  });

  test('spec 036 D4 (Option A) — spec_only + clean + creds finishes DONE past the Spec gate (AC #4)', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'selfhost clean spec_only', confirmMode: 'spec_only', deploy: 'none' });
    const h = harness(dir, task, { reportLintClean: true });

    await withDifyEnv(async () => {
      await withTurn(task.taskId, () => startTask(task, h.ctx)); // auto ①, PAUSE at ② Spec
      assert.equal(task.phase, 'spec');
      assert.equal(task.status, 'awaiting_confirm', 'spec_only pauses only at Spec');
      // human confirms Spec → implement then auto ④; isAutonomous(spec_only) → no Import park.
      await withTurn(task.taskId, () => confirmAdvance(task, 'continue', h.ctx));
    });

    assert.equal(task.status, 'done', 'spec_only + clean + creds finishes done after the Spec confirm (AC #4)');
    assert.equal(task.phase, 'test');
    assert.notEqual(task.gate?.flag, 'awaiting_import', 'spec_only never parks at Import under Option A');
  });

  test('spec 036 D4 (Option A) — each_step + clean + creds PARKS at Import, stamps deploy=selfhost, re-report labels selfhost (AC #9)', async () => {
    const dir = fixtureDir();
    // deploy:'none' at create — the park + the deploy STAMP come from creds now, not the declaration.
    const task = await createTask(dir, { requirement: 'selfhost clean', confirmMode: 'each_step', deploy: 'none' });
    const h = harness(dir, task, { reportLintClean: true });

    await withDifyEnv(async () => {
      // each_step: drive analyze→spec→implement→test by hand (spec 055: from-scratch starts at Analyze),
      // then assert the ④ Import gate appears.
      await withTurn(task.taskId, () => startTask(task, h.ctx)); // 055 → ① analyze, parks
      assert.equal(task.status, 'awaiting_confirm');
      assert.equal(task.phase, 'analyze');
      await withTurn(task.taskId, () => confirmAdvance(task, 'continue', h.ctx)); // ① → ② spec
      assert.equal(task.phase, 'spec');
      await withTurn(task.taskId, () => confirmAdvance(task, 'continue', h.ctx)); // scaffold → ③ implement
      assert.equal(task.phase, 'implement');
      assert.equal(task.status, 'awaiting_confirm');
      await withTurn(task.taskId, () => confirmAdvance(task, 'continue', h.ctx)); // → ④ test (clean, human, creds)

      assert.equal(task.phase, 'test');
      assert.equal(task.status, 'awaiting_confirm', 'clean human ④ with creds parks behind the Import button');
      assert.equal(task.gate?.flag, 'awaiting_import');
      assert.deepEqual(task.gate?.actions.map((a) => a.id), ['import', 'skip_import', 'changes', 'discard']); // spec 041: + Request changes
      // AC #9: the static→park deploy STAMP fired — report.ts branches on task.deploy, so this is what
      // makes the Import/Skip re-report label `selfhost` instead of the `DEPLOYED · none` contradiction.
      assert.equal(task.deploy, 'selfhost', 'the static→park stamped deploy=selfhost (before the re-report)');

      // Faked import: skip_import re-runs the (stubbed) report WITHOUT shelling sync.py — assert the
      // report SAW deploy=selfhost (the initial ④ report saw the pre-stamp 'none'; the re-report sees 'selfhost').
      await withTurn(task.taskId, () => confirmAdvance(task, 'skip_import', h.ctx));
    });

    assert.equal(task.status, 'done', 'skip_import finishes done');
    assert.equal(h.reportDeploys.at(-1), 'selfhost', 'the Import/Skip re-report labels selfhost (AC #9)');
    assert.equal(task.deploy, 'selfhost', 'deploy stays selfhost through the terminal report');
  });

  test('a Retry out of ERROR at ④ re-runs the REPORT, not a turn', async () => {
    // The remaining fall-through in replyWithin's ④ branch. It is scoped to `error` (and to a ④ with no
    // implement session): a build parked at a ④ GATE routes to Implement (spec 041, next test), and so
    // does a DONE one (the post-import fix loop, the test after that) — for both, re-running the report
    // on an unchanged main.yml would be the silent no-op 041 was written to kill.
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'x', confirmMode: 'auto', deploy: 'none' });
    const h = harness(dir, task);
    await withTurn(task.taskId, () => startTask(task, h.ctx)); // run to done@test
    assert.equal(task.phase, 'test');
    task.status = 'error'; // the Retry-out-of-error path (§I)
    const turnsBefore = h.calls.runTurn;
    const reportsBefore = h.calls.runReport;

    await replyWithin(task, 'tweak the report', h.ctx);

    assert.equal(h.calls.runTurn, turnsBefore, 'the Retry at ④ spawned NO turn');
    assert.equal(h.calls.runReport, reportsBefore + 1, 'the Retry at ④ re-ran the report');
  });

  test('the post-import fix loop — a fix request on a DONE build re-runs IMPLEMENT (the build reopens)', async () => {
    // A finished build is where the human's REAL acceptance test happens: they import the workflow into
    // Dify, run it, and only then find what to change. That fix must land in the SAME conversation —
    // resuming the implement session — rather than dying at `done` (the old behavior: /reply 409'd, so
    // the only route was a brand-new edit-existing build, fresh session and all four phases again).
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'x', confirmMode: 'auto', deploy: 'none' });
    const h = harness(dir, task);
    await withTurn(task.taskId, () => startTask(task, h.ctx)); // run to done@test
    assert.equal(task.status, 'done');
    assert.equal(task.phase, 'test');
    assert.ok(canRequestFix(task), 'a done ①②③④ build with an implement session + on-disk workflow is fixable');
    const turnsBefore = h.calls.runTurn;
    const reportsBefore = h.calls.runReport;

    await withTurn(task.taskId, () => replyWithin(task, 'the LLM node uses the wrong variable', h.ctx));

    assert.equal(h.calls.runTurn, turnsBefore + 1, 'the fix re-ran the IMPLEMENT turn → main.yml is actually edited');
    assert.equal(h.calls.runReport, reportsBefore, 'it did NOT re-run the report on the unchanged workflow');
    assert.equal(task.phase, 'implement', 're-parked at the Implement gate — the human re-tests/re-imports from there');
    assert.equal(task.status, 'awaiting_confirm', 'the build is live again, not terminal');
    assert.ok(task.gate?.actions.some((a) => a.id === 'continue'), 'the Implement gate offers "Continue to Test"');
  });

  test('canRequestFix — what stays terminal', async () => {
    const dir = fixtureDir();
    const base = await createTask(dir, { requirement: 'x', confirmMode: 'auto', deploy: 'none' });
    const done = { ...base, status: 'done' as const, phase: 'test' as const, project: 'p', workflowSlug: 'wf',
      sessionIds: { implement: 'sess-implement' } };
    assert.ok(canRequestFix(done));
    assert.ok(!canRequestFix({ ...done, status: 'cancelled' }), 'a cancelled build re-enters via Restore, not a fix');
    assert.ok(!canRequestFix({ ...done, status: 'awaiting_confirm' }), 'a parked build never needed this door');
    assert.ok(!canRequestFix({ ...done, kind: 'promote' }), 'a promote build has no implement phase to resume');
    assert.ok(!canRequestFix({ ...done, kind: 'consult' }), 'a chat has no workflow to revise');
    assert.ok(!canRequestFix({ ...done, sessionIds: {} }), 'no implement session → the reply would silently no-op');
    assert.ok(!canRequestFix({ ...done, workflowSlug: null }), 'no on-disk workflow → nothing to edit');
  });

  test('spec 036 fix — "Request changes" at the LIVE ④ gate re-runs IMPLEMENT (edits main.yml), not a bare re-test', async () => {
    // The reported 032 defect: a /reply at the live test-result gate dropped the change text and just
    // re-ran runLiveTest on the UNCHANGED workflow, so "make it uppercase" silently no-op'd. The fix
    // routes it back through Implement so the edit actually happens; the human re-tests from that gate.
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'live reply edits the workflow', confirmMode: 'each_step', deploy: 'none' });
    // Place it AT a live test_result gate (as after a `test_live` run): phase=test, testMode=live, an
    // implement session to resume, and a scaffolded workflow on disk (with a pre-edit main.yml to diff).
    task.phase = 'test';
    task.testMode = 'live';
    task.status = 'awaiting_confirm';
    task.project = 'p';
    task.workflowSlug = 'wf';
    task.workflowFile = 'main.yml';
    task.sessionIds.implement = 'sess-impl';
    mkdirSync(join(dir, 'projects', 'p', 'wf', 'workflows'), { recursive: true });
    writeFileSync(join(dir, 'projects', 'p', 'wf', 'workflows', 'main.yml'), 'workflow:\n  graph:\n    nodes: []\n');
    writeFileSync(join(dir, 'projects', 'p', 'wf', 'SPEC.md'), '# spec\nmake it.\n');
    const h = harness(dir, task, { reportLintClean: true });
    const turnsBefore = h.calls.runTurn;
    const reportsBefore = h.calls.runReport;

    await withTurn(task.taskId, () => replyWithin(task, 'make the output UPPERCASE', h.ctx));

    assert.equal(h.calls.runTurn, turnsBefore + 1, 'the /reply re-ran the IMPLEMENT turn → main.yml is actually edited (was: silently re-ran the unchanged workflow)');
    assert.equal(h.calls.runReport, reportsBefore, 'it did NOT re-run the report/live-test on the unchanged workflow');
    assert.equal(task.phase, 'implement', 're-parked at the Implement gate — the human re-tests from there');
    assert.equal(task.status, 'awaiting_confirm');
    assert.ok(task.gate?.actions.some((a) => a.id === 'continue'), 'the Implement gate offers "Continue to Test"');
  });

  test('spec 041 — "Request changes" at a STATIC ④ gate also re-runs IMPLEMENT (edits main.yml), not a report re-run', async () => {
    // spec 041 generalizes the 036 fix: a ④ revision (status awaiting_confirm) routes through Implement
    // for EVERY gate — including the STATIC ones (awaiting_import / still_failing), where the pre-041 code
    // re-ran the report on the UNCHANGED workflow and dropped the edit. Signal is `status`, not `testMode`.
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'static reply edits the workflow', confirmMode: 'each_step', deploy: 'none' });
    task.phase = 'test';
    task.testMode = 'static'; // ← the static path (NOT live) — the case 036 left re-running the report
    task.status = 'awaiting_confirm';
    task.project = 'p';
    task.workflowSlug = 'wf';
    task.workflowFile = 'main.yml';
    task.sessionIds.implement = 'sess-impl';
    mkdirSync(join(dir, 'projects', 'p', 'wf', 'workflows'), { recursive: true });
    writeFileSync(join(dir, 'projects', 'p', 'wf', 'workflows', 'main.yml'), 'workflow:\n  graph:\n    nodes: []\n');
    writeFileSync(join(dir, 'projects', 'p', 'wf', 'SPEC.md'), '# spec\nmake it.\n');
    const h = harness(dir, task, { reportLintClean: true });
    const turnsBefore = h.calls.runTurn;
    const reportsBefore = h.calls.runReport;

    await withTurn(task.taskId, () => replyWithin(task, 'add a translation step', h.ctx));

    assert.equal(h.calls.runTurn, turnsBefore + 1, 'the static-gate /reply re-ran the IMPLEMENT turn → main.yml is edited');
    assert.equal(h.calls.runReport, reportsBefore, 'it did NOT re-run the report on the unchanged workflow');
    assert.equal(task.phase, 'implement', 're-parked at the Implement gate — the human re-tests/imports from there');
    assert.equal(task.status, 'awaiting_confirm');
  });

  test('spec 041 — a Retry OUT OF ERROR at a STATIC ④ (status error) still re-runs the report, NOT implement', async () => {
    // The status signal must NOT misroute an error-retry: a ④ that errored (status 'error') re-runs ④
    // itself (the static report), exactly as before 041 — only an awaiting_confirm revision goes to Implement.
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'error retry stays on report', confirmMode: 'each_step', deploy: 'none' });
    task.phase = 'test';
    task.testMode = 'static';
    task.status = 'error'; // ← Retry-out-of-error, not a gate revision
    task.project = 'p';
    task.workflowSlug = 'wf';
    task.workflowFile = 'main.yml';
    task.sessionIds.implement = 'sess-impl';
    mkdirSync(join(dir, 'projects', 'p', 'wf', 'workflows'), { recursive: true });
    writeFileSync(join(dir, 'projects', 'p', 'wf', 'workflows', 'main.yml'), 'workflow:\n  graph:\n    nodes: []\n');
    const h = harness(dir, task, { reportLintClean: true });
    const turnsBefore = h.calls.runTurn;
    const reportsBefore = h.calls.runReport;

    await withTurn(task.taskId, () => replyWithin(task, 'retry please', h.ctx));

    assert.equal(h.calls.runTurn, turnsBefore, 'no IMPLEMENT turn — an error-retry is not a revision');
    assert.equal(h.calls.runReport, reportsBefore + 1, 'it re-ran the ④ report, exactly as before 041');
  });

  test('spec 036 fix — a /reply RESUME prompt carries the "revise the artifact" header (so the model EDITS, not chats)', async () => {
    // Root cause of "Request changes didn't change the workflow": on a SUCCESSFUL resume the prompt used to
    // be the bare change text, so a terse request ("make it uppercase") read as conversational and the
    // model answered instead of editing main.yml. The prompt must now frame it as a file revision.
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'x', confirmMode: 'each_step', deploy: 'none' });
    task.phase = 'implement';
    task.project = 'p';
    task.workflowSlug = 'wf';
    task.workflowFile = 'main.yml';
    task.sessionIds.implement = 'sess-impl';
    task.status = 'awaiting_confirm';
    mkdirSync(join(dir, 'projects', 'p', 'wf', 'workflows'), { recursive: true });
    writeFileSync(join(dir, 'projects', 'p', 'wf', 'workflows', 'main.yml'), 'workflow:\n  graph:\n    nodes: []\n');
    writeFileSync(join(dir, 'projects', 'p', 'wf', 'SPEC.md'), '# spec\n');
    let seenPrompt = '';
    const ctx: OrchestratorCtx = {
      projectsDir: dir,
      settingsPath: '',
      log,
      runners: {
        runTurn: async (_s, prompt) => {
          seenPrompt = prompt; // capture the RESUME prompt runPhase built
          return { sessionId: 'sess-impl', result: { type: 'result', is_error: false }, isError: false };
        },
        runPython: async () => ({ code: 0, stdout: '', stderr: '' }),
        runReport: async () => ({ ok: true, reasons: [], reportRel: 'r', lintClean: true }),
        postTurnCheck: async () => ({
          ok: true,
          status: 'done',
          reasons: [],
          detail: { artifactOk: true, yamlOk: true, lintCodes: { validate: 0, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 0 }, idsOk: true, confinementBreaches: [], extraFiles: [] },
        }),
      },
    };

    await withTurn(task.taskId, () => replyWithin(task, 'make the output uppercase', ctx));

    assert.match(seenPrompt, /Change request \(revise the existing artifact/, 'the resume prompt frames the change as a FILE revision (not a chat)');
    assert.match(seenPrompt, /make the output uppercase/, 'and still carries the user request');
  });

  test('D4 — a /reply that TIMES OUT does not re-run a second full turn (spec 014)', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'slow build', confirmMode: 'each_step', deploy: 'none' });
    // place it mid-build at Implement with a resumable session + a scaffolded workflow (spec 030 nested).
    task.phase = 'implement';
    task.project = 'slow_proj';
    task.workflowSlug = 'sum';
    task.workflowFile = 'main.yml';
    task.sessionIds.implement = 'sess-impl';
    task.status = 'awaiting_confirm';
    mkdirSync(join(dir, 'projects', 'slow_proj', 'sum', 'workflows'), { recursive: true });
    writeFileSync(join(dir, 'projects', 'slow_proj', 'sum', 'SPEC.md'), '# spec\nbuild it.\n');

    let turns = 0;
    const ctx: OrchestratorCtx = {
      projectsDir: dir,
      settingsPath: '',
      log,
      runners: {
        // every spawn TIMES OUT (isError + note). The resume fallback must NOT fire a fresh turn.
        runTurn: async () => {
          turns++;
          return { sessionId: 'sess-impl', result: null, isError: true, note: 'phase timed out after 10m' };
        },
        runPython: async () => ({ code: 0, stdout: '', stderr: '' }),
        runReport: async () => ({ ok: true, reasons: [], reportRel: 'r', lintClean: true }),
        // The artifact is deliberately NOT lint-clean (lint_refs=1): this test isolates D4 (the resume
        // timeout must not spend a SECOND turn), so it must NOT trip spec 085's salvage — a timeout that
        // left a CLEAN file now parks at success, not error (that path is covered in post-turn-multi-lint).
        postTurnCheck: async () => ({
          ok: true,
          status: 'done',
          reasons: [],
          detail: { artifactOk: true, yamlOk: true, lintCodes: { validate: 0, lint_refs: 1, lint_plugin_hashes: 0, lint_node_bodies: 0 }, idsOk: true, confinementBreaches: [], extraFiles: [] },
        }),
      },
    };

    await withTurn(task.taskId, () => replyWithin(task, 'are you done yet?', ctx));

    assert.equal(turns, 1, 'a resume timeout parks at error — it must NOT spend a SECOND full turn (D4)');
    assert.equal(task.status, 'error', 'the timed-out resume (dirty artifact) parks at error');
  });

  test('a cancel landing mid-turn leaves status=cancelled with the gate cleared (no clobber)', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'cancel me', confirmMode: 'auto', deploy: 'none' });
    const h = harness(dir, task, { cancelDuringTurn: 'analyze' }); // spec 055: the first TURN is now analyze

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    assert.equal(task.status, 'cancelled', 'converged to cancelled');
    assert.equal(task.gate, undefined, 'gate cleared (no awaiting_confirm clobber)');
    assert.equal(h.calls.runReport, 0, 'never advanced past the cancelled turn');
  });
});

// ── Spec 055 — from-scratch AND seeded both run the Analyze turn (046 D1 skip removed) ────────────
describe('spec 055 — from-scratch (seedless) now runs the Analyze turn + gate, like a seeded build', () => {
  test('AC 1: seedless standard → first gate is ANALYZE (the requirement-digest turn ran); artifacts.analyze set', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'from scratch', confirmMode: 'each_step', deploy: 'none' });
    const h = harness(dir, task);

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    assert.equal(task.phase, 'analyze', 'starts AT analyze — the requirement-digest turn (spec 055)');
    assert.equal(task.status, 'awaiting_confirm');
    assert.equal(h.calls.runTurn, 1, 'exactly one turn so far (analyze)');
    assert.ok(h.events.some((e) => e.phase === 'analyze'), 'analyze emitted (no longer skipped)');

    const analyzeRel = `apps/builder/.runs/${task.taskId}/analyze.json`;
    assert.equal(task.artifacts.analyze, analyzeRel, 'artifacts.analyze set from the real turn');
  });

  test('AC 2: a SEEDED (edit-existing) build still runs the real Analyze turn + gate', async () => {
    const dir = fixtureDir();
    // localEditSeed needs the target workflow on disk: projects/_drafts/<slug>/workflows/main.yml
    const wfDir = join(dir, 'projects', '_drafts', 'wf_seeded', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'main.yml'), 'workflow:\n  graph:\n    nodes: []\n');
    const task = await createTask(dir, {
      requirement: 'edit it', confirmMode: 'each_step', deploy: 'none', workflow: 'wf_seeded',
    });
    const h = harness(dir, task);

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    assert.equal(task.phase, 'analyze', 'seeded builds keep the full Analyze turn — D1 must not over-reach');
    assert.equal(task.status, 'awaiting_confirm');
    assert.ok(h.events.some((e) => e.phase === 'analyze'), 'analyze emitted');
    assert.equal(h.calls.runTurn, 1, 'the analyze TURN ran (not backend-written)');
  });
});
