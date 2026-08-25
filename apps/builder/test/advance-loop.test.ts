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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { startTask, confirmAdvance, replyWithin, type OrchestratorCtx } from '../server/lib/orchestrator.js';
import { acquireTurn, releaseTurn, markCancelled, unmarkCancelled } from '../server/lib/lock.js';
import { canRequestFix, mayOpenProposal } from '../server/lib/gate.js';
import { createTask, resolveStartPhase, restoreTargetPhaseFor, type Task } from '../server/state/task.js';
import { PHASES } from '../server/lib/phases.js';
import { applyInitFake } from './helpers/scaffold-fake.js';
import type { ClaudeSession, SessionLogger } from '../server/lib/claude-session.js';
import type { TurnResult } from '../server/lib/turn-runner.js';
import { artifactHash, specRelFor } from '../server/lib/post-turn.js';
import { LINTERS } from '../server/lib/linters.js';
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
  /** spec 105 — the ③ turn edits the workflow but leaves `SPEC.md` behind, i.e. it ignores the
   *  reconcile instruction. Also an AGENT behaviour, and the exact one `specStale` exists to catch. */
  implementSkipsSpecReconcile?: boolean;
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
  /** spec 105: the prompt text each turn was actually SENT. Counting turns proves ①② were skipped; only
   *  reading the prompt proves the human's request survived the skipping. */
  prompts: string[];
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
  // ③ also brings SPEC.md back in line with the workflow it just edited. The ONE round where a
  // well-behaved agent leaves it alone is a genuine first Implement, where ② has just written the spec
  // for this very change — so there is nothing to reconcile and the document correctly does not move.
  // A build that STARTED at ③ has no such ②: its SPEC.md describes the workflow from before the edit,
  // so even round 1 must move it (spec 105). Modelling the well-behaved agent by default is
  // load-bearing: without it every fix round here measures as spec-stale, which is a verdict about
  // this fake rather than about the code under test.
  const specWasWrittenForThisRound = nth === 1 && task.startPhase !== 'implement';
  if (!specWasWrittenForThisRound && !o.implementSkipsSpecReconcile && task.project && task.workflowSlug) {
    writeFileSync(join(dir, specRelFor(task.project, task.workflowSlug)), `# SPEC\nbuild it.\n# round ${nth}\n`);
  }
}

function harness(dir: string, task: Task, o: Overrides = {}): Harness {
  const calls = { runTurn: 0, runReport: 0, runPython: 0, postTurnCheck: 0 };
  const events: Harness['events'] = [];
  const reportDeploys: string[] = [];
  const lastPostTurn: Harness['lastPostTurn'] = [];
  const prompts: string[] = [];
  let implementTurns = 0; // `calls.runTurn` counts every phase; the spec-reconcile rule needs ③'s own index

  const runTurn = async (
    _session: ClaudeSession,
    prompt: string,
    _onSessionId?: (id: string) => void
  ): Promise<TurnResult> => {
    calls.runTurn++;
    prompts.push(prompt);
    if (o.cancelDuringTurn === task.phase) markCancelled(task.taskId);
    // NB: we deliberately don't invoke `_onSessionId` — a real turn fires it on the init event, well
    // before the result; calling it synchronously here would race the awaited post-turn saveTask on
    // the shared task.json.tmp path. The session id is still persisted below (from the return value).
    if (task.phase === 'implement') implementTurns++;
    writeArtifact(task, dir, o, task.phase === 'implement' ? implementTurns : calls.runTurn);
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
    // Every verdict below is DERIVED from the same files and the same helpers production uses. The
    // fake used to declare `artifactOk`/`yamlOk` true and compute "clean" from three of the four
    // linters — both let a test build a state the system cannot: a turn that writes nothing came back
    // `success` here while the real check reports `artifact missing`, and `lint_node_bodies: 1` came
    // back `ok` here while `resolveImplementOutcome` reads it as `still_failing` with no reasons.
    //
    // Paths come from the exported resolvers, never from a second copy of the formula: a fake that
    // restates a path keeps measuring the old location after a layout change, with its assertions
    // still green (`specRelFor` exists for exactly this reason).
    const wfRel = PHASES.find((x) => x.id === 'implement')!.artifactRel(
      { project: p.project, workflowSlug: p.workflowSlug, workflowFile: p.workflowFile } as Task
    );
    const specRel = p.project && p.workflowSlug ? specRelFor(p.project, p.workflowSlug) : null;
    const afterHash = await artifactHash(dir, wfRel);
    const artifactOk = afterHash !== null; // real: `size > 0`
    // The linters only run on a non-empty artifact; `null` is what the real check reports otherwise,
    // and `lintClean(null)` is false — the distinction the ③ outcome turns on.
    const lintCodes: LintCodes | null = artifactOk
      ? (o.lintCodes ?? { validate: 0, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 0 })
      : null;
    const reasons: string[] = [];
    if (!artifactOk) reasons.push(`artifact missing: ${wfRel}`);
    else for (const l of LINTERS) {
      const code = lintCodes![l.key];
      if (code !== 0) reasons.push(`${l.name} exit ${code}`);
    }
    const artifactChanged =
      p.artifactHashBefore === undefined ? undefined : p.artifactHashBefore !== afterHash;
    const specChanged =
      p.specHashBefore === undefined || !specRel
        ? undefined
        : p.specHashBefore !== (await artifactHash(dir, specRel));
    return {
      ok: reasons.length === 0,
      status: reasons.length === 0 ? 'done' : 'error',
      reasons,
      detail: {
        artifactOk, yamlOk: artifactOk, lintCodes, idsOk: true, confinementBreaches: [], extraFiles: [],
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
  return { ctx, calls, events, reportDeploys, lastPostTurn, prompts };
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

  // ── spec 105: an unattended build finishes its fix rounds too ─────────────────────────────────
  // A new build ran ①→④ hands-free while every fix on it stopped dead at ③ — an asymmetry nobody
  // chose. `/reply` ended the request on the reasoning that a revision is a human act; true for
  // `each_step`, and exactly backwards for `auto`, which is the user saying they are not watching.

  test('spec 105 — auto carries the FIRST fix (sent from done) through to 完了', async () => {
    // The first fix after `done` rides the `phase === "test"` branch, which returns early. A single
    // call at the tail of replyWithin would miss it, and the loop would alternate: round 1 parks,
    // round 2 finishes, round 3 parks.
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'x', confirmMode: 'auto', deploy: 'none' });
    const h = harness(dir, task);
    await withTurn(task.taskId, () => startTask(task, h.ctx));
    assert.equal(task.status, 'done');
    const reportsBefore = h.calls.runReport;

    await withTurn(task.taskId, () => replyWithin(task, 'the LLM node uses the wrong variable', h.ctx));

    assert.equal(task.status, 'done', 'the fix round finished on its own');
    assert.equal(task.phase, 'test');
    assert.equal(h.calls.runReport, reportsBefore + 1, '④ ran again on the edited workflow');
  });

  test('spec 105 — and a fix sent while PARKED at the ③ gate (the fall-through branch)', async () => {
    // The other entry: the build is standing at the Implement gate, not at `done`. That is where a
    // watched build lives, and where an unattended one lands after a hard-stop — so a fix typed there
    // takes a different route through replyWithin than the one above, and needs its own hand-off.
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'x', confirmMode: 'each_step', deploy: 'none' });
    const h = harness(dir, task);
    await withTurn(task.taskId, () => startTask(task, h.ctx));                 // ① parks
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', h.ctx)); // ② parks
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', h.ctx)); // ③ parks
    assert.equal(task.phase, 'implement');
    assert.equal(task.status, 'awaiting_confirm');
    task.confirmMode = 'auto'; // the human walks away at this point
    const reportsBefore = h.calls.runReport;

    await withTurn(task.taskId, () => replyWithin(task, 'one more thing', h.ctx));

    assert.equal(task.status, 'done', 'the fix carried on to ④ without another click');
    assert.equal(h.calls.runReport, reportsBefore + 1);
  });

  test('spec 105 — each_step is untouched: a fix still parks at the Implement gate', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'x', confirmMode: 'auto', deploy: 'none' });
    const h = harness(dir, task);
    await withTurn(task.taskId, () => startTask(task, h.ctx));
    task.confirmMode = 'each_step';
    const reportsBefore = h.calls.runReport;

    await withTurn(task.taskId, () => replyWithin(task, 'a fix I want to look at', h.ctx));

    assert.equal(task.phase, 'implement', 'parked for the human, as before');
    assert.equal(task.status, 'awaiting_confirm');
    assert.equal(h.calls.runReport, reportsBefore, '④ did NOT run');
  });

  test('spec 105 — the hand-off is clamped to ③: a retry at ① does not run ② behind it', async () => {
    // `replyWithin`'s fall-through re-runs whatever phase the build is parked at — ① and ② included,
    // where a /reply is a Retry, not a fix round. Whether an unattended build should also carry those
    // onward is a real question with its own reasoning, and it is NOT the question this slice answers.
    // The clamp keeps the change the size of its claim; without it, one line quietly widens `auto`
    // and `spec_only` at two more boundaries with nothing said about either.
    //
    // The errored state is constructed, the same way the ④ Retry case above constructs one: the
    // harness's turns always succeed, and what is under test here is the hand-off, not how ① fails.
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'x', confirmMode: 'auto', deploy: 'none' });
    const h = harness(dir, task);
    await withTurn(task.taskId, () => startTask(task, h.ctx));
    task.phase = 'analyze';
    task.status = 'error';
    const turnsBefore = h.calls.runTurn;

    await withTurn(task.taskId, () => replyWithin(task, 'the digest missed the schedule', h.ctx));

    assert.equal(task.phase, 'analyze', 'still at ①');
    assert.equal(h.calls.runTurn, turnsBefore + 1, 'exactly ONE turn: the ① re-run, no ② behind it');
  });

  test('spec 105 — a fix round that leaves SPEC.md alone still finishes (the badge warns, it does not block)', async () => {
    // This shipped the other way round for one commit: `specStale` was a hard-stop, on the argument
    // that an unattended build has no other guard on the document. It came off because the measurement
    // is two bits — `artifactChanged && !specChanged` — and cannot tell a turn that FORGOT to reconcile
    // from one that reconciled and correctly found nothing to change. The instruction sent to that same
    // turn ends "a no-op is a correct outcome", so blocking on it hangs a build for obeying.
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'x', confirmMode: 'auto', deploy: 'none' });
    const h = harness(dir, task, { implementSkipsSpecReconcile: true });
    await withTurn(task.taskId, () => startTask(task, h.ctx));
    const reportsBefore = h.calls.runReport;

    await withTurn(task.taskId, () => replyWithin(task, 'change the threshold', h.ctx));

    assert.equal(task.specStale, true, 'still MEASURED — the gate card says so');
    assert.equal(task.status, 'done', 'but it does not stop an unattended build');
    assert.equal(h.calls.runReport, reportsBefore + 1);
  });

  // ── spec 105: a workflow that already has an analysis and a spec starts at ③ ──────────────────

  test('resolveStartPhase — both artifacts present is the signal, and it self-selects', () => {
    const R = (o: Partial<Parameters<typeof resolveStartPhase>[0]>) =>
      resolveStartPhase({ editingExisting: true, hasSpec: true, hasWorkflowFile: true, ...o });

    assert.equal(R({}), 'implement', 'a workflow this Builder made: nothing left to analyse or spec');
    // An imported base is the case the full path exists FOR: `POST /api/bases` writes the YAML and no
    // spec, so nobody has read it yet. Same door, different thing coming through it.
    assert.equal(R({ hasSpec: false }), 'analyze', 'a YAML someone handed over');
    assert.equal(R({ hasWorkflowFile: false }), 'analyze', 'a spec with no workflow beside it');
    assert.equal(R({ editingExisting: false }), 'analyze', 'a from-scratch build is untouched');
    // `requested` may narrow, never widen: nobody can ask to skip a phase whose output does not exist.
    assert.equal(R({ requested: 'analyze' }), 'analyze', '"re-read it from scratch" is always allowed');
    assert.equal(R({ hasSpec: false, requested: 'implement' }), 'analyze', 'cannot skip ② with no spec');
    assert.equal(R({ requested: 'weird' }), 'implement', 'an unrecognised value is ignored, not guessed');
    // A RECOGNISED phase the system cannot start at is a different thing from garbage: it is a caller
    // asking for LESS skipping than the files allow. These fell through to the default and were
    // answered with ③ — more skipping than asked for, the one direction this must never go.
    assert.equal(R({ requested: 'spec' }), 'analyze', '"start at ② " must never be upgraded to ③');
    assert.equal(R({ requested: 'test' }), 'analyze', 'nor may an unsupported start silently skip work');
  });

  test('spec 105 — editing a specced workflow runs ONE turn, not three', async () => {
    const dir = fixtureDir();
    // A workflow as this Builder leaves them: the file, and the document describing it.
    mkdirSync(join(dir, 'projects', '_drafts', 'specced', 'workflows'), { recursive: true });
    writeFileSync(join(dir, 'projects/_drafts/specced/workflows/main.yml'), 'workflow:\n  graph:\n    nodes: []\n');
    writeFileSync(join(dir, 'projects/_drafts/specced/SPEC.md'), '# Spec\n\n## Acceptance Criteria\n- it works\n');
    const task = await createTask(dir, {
      requirement: 'use the newest default model',
      workflow: 'specced',
      startPhase: 'implement', // what the route resolves from those two files
      confirmMode: 'each_step',
      deploy: 'none',
    });
    const h = harness(dir, task);

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    assert.equal(h.calls.runTurn, 1, 'only ③ ran — ① and ② had nothing left to derive');
    assert.equal(task.phase, 'implement');
    assert.equal(task.status, 'awaiting_confirm', 'parked at the Implement gate for the human');
    const phasesSeen = new Set(h.events.map((e) => e.phase));
    assert.deepEqual([...phasesSeen], ['implement'], 'no ①/② gate was ever emitted');
    // ④ grades against the criteria ② normally persists on the way past; skipping ② must not cost them.
    assert.ok(task.artifacts.criteria, 'the rubric came from the existing SPEC.md');
  });

  test('spec 105 — an imported YAML with no spec still runs the full path', async () => {
    // `POST /api/bases` writes the workflow and NO spec, which is exactly the case ① and ② exist for.
    // Same door as above; the difference is on disk, so nobody has to remember a setting.
    const dir = fixtureDir();
    mkdirSync(join(dir, 'projects', '_drafts', 'imported', 'workflows'), { recursive: true });
    writeFileSync(join(dir, 'projects/_drafts/imported/workflows/main.yml'), 'workflow:\n  graph:\n    nodes: []\n');
    const task = await createTask(dir, {
      requirement: 'clean this up',
      workflow: 'imported',
      startPhase: 'analyze', // what the route resolves when the spec is missing
      confirmMode: 'auto',
      deploy: 'none',
    });
    const h = harness(dir, task);

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    assert.equal(h.calls.runTurn, 3, 'analyze + spec + implement, as before');
    assert.equal(task.startPhase, undefined, 'and it is not marked as having skipped anything');
  });

  test('spec 105 — the edit request REACHES ③; skipping ② must not lose the ask', async () => {
    // The whole point of the build. ② is the phase that turns the human's words into the document ③
    // builds from — skip it and SPEC.md still describes the workflow from BEFORE the edit, while
    // implement.md step 1 hands that file over as "the source of truth for what to build" and step 6
    // calls a no-op "a correct outcome". `{{REQUIREMENT}}` is injected, but the skill spends it on
    // WHICH LANGUAGE to write in, nothing more. So the turn ran, one turn, exactly as the count test
    // asserts — and had been told to rebuild what was already there.
    const dir = fixtureDir();
    mkdirSync(join(dir, 'projects', '_drafts', 'specced', 'workflows'), { recursive: true });
    writeFileSync(join(dir, 'projects/_drafts/specced/workflows/main.yml'), 'workflow:\n  graph:\n    nodes: []\n');
    writeFileSync(join(dir, 'projects/_drafts/specced/SPEC.md'), '# Spec\n\n## Acceptance Criteria\n- it works\n');
    const REQ = 'リトライ分岐を足して';
    const task = await createTask(dir, {
      requirement: REQ, workflow: 'specced', startPhase: 'implement',
      confirmMode: 'each_step', deploy: 'none',
    });
    const h = harness(dir, task);

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    assert.equal(h.prompts.length, 1);
    // Under the SAME header a fix round uses — the words alone would be indistinguishable from the
    // language banner that already quotes them, and the header is what makes "revise it" unambiguous.
    const i = h.prompts[0].indexOf('## Change request');
    assert.ok(i > -1, 'the ask arrives as a request, not as a hint about which language to use');
    assert.ok(h.prompts[0].slice(i).includes(REQ), 'and it is the request the human actually typed');
  });

  test('spec 105 — a NORMAL build does not get the change-request header on its first ③', async () => {
    // ② just wrote SPEC.md from this requirement, so "build what SPEC.md says" already is the ask.
    // Repeating it under a "revise the EXISTING artifact" header would tell a from-scratch turn to
    // edit a file that does not exist yet.
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'build me a summariser', deploy: 'none', confirmMode: 'auto' });
    const h = harness(dir, task);

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    const implementPrompt = h.prompts[2];
    assert.equal(h.prompts.length >= 3, true, 'analyze + spec + implement');
    assert.equal(implementPrompt.includes('## Change request'), false);
  });

  test('spec 105 — ④ grades against the criteria as ③ left them, not the ones it inherited', async () => {
    // The rubric is seeded from the existing SPEC.md at start, so ④ is never left with none. But that
    // document belongs to the workflow the human just asked to CHANGE — it never saw their request. If
    // it stood, the one thing they asked for would be the one thing the judge never checks. ③ reconciles
    // SPEC.md with what it built; the rubric has to be re-derived from the reconciled file.
    const dir = fixtureDir();
    mkdirSync(join(dir, 'projects', '_drafts', 'specced', 'workflows'), { recursive: true });
    writeFileSync(join(dir, 'projects/_drafts/specced/workflows/main.yml'), 'workflow:\n  graph:\n    nodes: []\n');
    writeFileSync(
      join(dir, 'projects/_drafts/specced/SPEC.md'),
      '# Spec\n\n## Acceptance Criteria\n- the summary is returned\n'
    );
    const task = await createTask(dir, {
      requirement: 'add a retry branch', workflow: 'specced', startPhase: 'implement',
      confirmMode: 'each_step', deploy: 'none',
    });
    // The reconcile a well-behaved ③ performs: SPEC.md gains the criterion for what was just added.
    const h = harness(dir, task);
    const inner = h.ctx.runners!.runTurn!;
    h.ctx.runners!.runTurn = async (...args: Parameters<typeof inner>) => {
      const r = await inner(...args);
      writeFileSync(
        join(dir, 'projects/_drafts/specced/SPEC.md'),
        '# Spec\n\n## Acceptance Criteria\n- the summary is returned\n- a failed fetch retries once\n'
      );
      return r;
    };

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    const rubric = JSON.parse(readFileSync(join(dir, `apps/builder/.runs/${task.taskId}/criteria.json`), 'utf8'));
    const text = JSON.stringify(rubric);
    assert.ok(text.includes('retries once'), 'the criterion for the change the human asked for');
  });

  test('spec 105 — the first ③ of a start-at-③ build is measured and undoable, like the fix round it is', async () => {
    // The three spec mechanisms (reconcile instruction, undo snapshot, staleness measurement) were
    // gated on `replyText` — a proxy for "SPEC.md predates this round". A build that starts at ③
    // satisfies that as loudly as any fix round and types nothing: ② never ran, so the spec on disk
    // describes the workflow from BEFORE the edit. It used to read as a first Implement and get none
    // of the three: no undo button on the one round that overwrites a real workflow, and no tripwire
    // on the one round most likely to leave the document behind.
    const dir = fixtureDir();
    mkdirSync(join(dir, 'projects', '_drafts', 'specced', 'workflows'), { recursive: true });
    writeFileSync(join(dir, 'projects/_drafts/specced/workflows/main.yml'), 'workflow:\n  graph:\n    nodes: []\n');
    writeFileSync(join(dir, 'projects/_drafts/specced/SPEC.md'), '# Spec\n\n## Acceptance Criteria\n- it works\n');
    const task = await createTask(dir, {
      requirement: 'add a retry branch', workflow: 'specced', startPhase: 'implement',
      confirmMode: 'each_step', deploy: 'none',
    });
    const h = harness(dir, task);

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    assert.equal(h.lastPostTurn.length, 1);
    assert.notEqual(h.lastPostTurn[0].specHashBefore, undefined, 'the spec was hashed before the turn');
    assert.equal(task.fixUndoable, true, 'and the round can be taken back');
    assert.equal(task.specStale, false, 'the agent reconciled, so the document is not behind');
  });

  test('spec 105 — and the tripwire actually fires there when the agent skips the reconcile', async () => {
    // The half that proves the measurement is a measurement: same build, an agent that edits the
    // workflow and leaves SPEC.md untouched. Without the widened gate `specHashBefore` is undefined,
    // `isSpecStale` reads "not measured", and this silently returns undefined instead of true.
    const dir = fixtureDir();
    mkdirSync(join(dir, 'projects', '_drafts', 'specced', 'workflows'), { recursive: true });
    writeFileSync(join(dir, 'projects/_drafts/specced/workflows/main.yml'), 'workflow:\n  graph:\n    nodes: []\n');
    writeFileSync(join(dir, 'projects/_drafts/specced/SPEC.md'), '# Spec\n\n## Acceptance Criteria\n- it works\n');
    const task = await createTask(dir, {
      requirement: 'add a retry branch', workflow: 'specced', startPhase: 'implement',
      confirmMode: 'each_step', deploy: 'none',
    });
    const h = harness(dir, task, { implementSkipsSpecReconcile: true });

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    assert.equal(task.specStale, true, 'the workflow moved and the document did not — say so');
  });

  test('spec 105 — a Dify-seed build never skips ①②, even with a workflow target beside it', async () => {
    // The seed picker and the workflow chip are separate controls and neither disables the other, so a
    // payload can carry both. `startTask` resolves that pair seed-first: it pulls the YAML from Dify and
    // `localEditSeed` never runs. The route, meanwhile, decided to skip ①② by looking at
    // `projects/<project>/<workflow>/` — a directory with nothing to do with the app about to arrive.
    // Two components answering "which workflow is this" differently is how a build skips its analysis
    // on the strength of some other workflow's files.
    const task = await createTask(fixtureDir(), {
      requirement: 'x', workflow: 'specced', seed: 'app-123', startPhase: 'implement', deploy: 'none',
    });
    assert.equal(task.startPhase, undefined, 'the seed decides, and it says start at ①');
    assert.equal(task.phase, 'analyze');
  });

  test('spec 105 — a build that started at ③ reopens retryable, not at a Spec gate nobody ran', async () => {
    const task = await createTask(fixtureDir(), { requirement: 'x', workflow: 'w', startPhase: 'implement', deploy: 'none' });
    task.phase = 'implement';
    assert.equal(restoreTargetPhaseFor(task), null, 'no ② behind it to rewind to');
    // ③ is not the only place such a build can be cancelled. Asking for a plan runs a ② revise, so
    // `task.phase` is legitimately 'spec' — and rewinding one boundary from there lands on ①, a gate
    // this build never reached either. The rule is about the whole prefix, not about one phase.
    assert.equal(restoreTargetPhaseFor({ ...task, phase: 'spec' }), null, 'nor any ① behind THAT');
    // Past its own start, the boundaries are real again: ③ ran, ③ gated, ④ may rewind to it.
    assert.equal(restoreTargetPhaseFor({ ...task, phase: 'test' }), 'implement');
    // An ordinary build is untouched: its ② really did run.
    assert.equal(restoreTargetPhaseFor({ ...task, startPhase: undefined }), 'spec');
  });

  // ── calibration: the harness itself ───────────────────────────────────────────────────────────
  // This suite's fake `postTurnCheck` has twice been the reason a wrong thing looked right, so it is
  // now checked the way any instrument is: reproduce a case with a known positive answer, and decline
  // a case known to be noise. If these two go red, every verdict in this file is suspect.

  test('calibration — a turn that writes nothing is an ERROR here, exactly as in production', async () => {
    // The real check reports `artifact missing` when the file is empty/absent, and that is a HARD
    // error. A fake that declared `artifactOk: true` would call this a clean success — the shape that
    // let a no-op round look like a finished one.
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'x', confirmMode: 'each_step', deploy: 'none' });
    const h = harness(dir, task, { implementNoOp: true });

    await withTurn(task.taskId, () => startTask(task, h.ctx));            // ① parks
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', h.ctx)); // ② parks
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', h.ctx)); // ③ writes nothing

    assert.equal(task.status, 'error', 'no artifact ⇒ hard error, not success');
    assert.match(task.error ?? '', /artifact missing/, 'and it says which file');
  });

  test('calibration — the FOURTH linter counts, exactly as in production', async () => {
    // `lintClean` requires all four exit codes to be 0. A fake that checked only three would return
    // `ok: true` while `resolveImplementOutcome` read the same codes as `still_failing` — a gate with
    // a failure flag and an empty reason list, which production cannot build.
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'x', confirmMode: 'auto', deploy: 'none' });
    const h = harness(dir, task, {
      lintCodes: { validate: 0, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 1 },
    });

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    assert.notEqual(task.status, 'done', 'a dirty fourth linter cannot finish a build');
    assert.equal(h.calls.runReport, 0, '④ never ran');
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
    //
    // Built hands-free, then watched: the fix goes in under `each_step`, because this test is about
    // spec 041 ROUTING (a ④ revision edits the workflow instead of re-running the report), not about
    // how far the build then travels. Under an unattended mode the same fix carries on to ④ — that is
    // spec 105, pinned separately below; mixing the two questions into one test would leave neither
    // able to fail alone.
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'x', confirmMode: 'auto', deploy: 'none' });
    const h = harness(dir, task);
    await withTurn(task.taskId, () => startTask(task, h.ctx)); // run to done@test
    assert.equal(task.status, 'done');
    task.confirmMode = 'each_step'; // the human comes back to watch this one
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

  test('spec 105 — mayOpenProposal: the server half of "a plan gate and unattended mode are exclusive"', async () => {
    // The FE withdraws the caret under `auto`; this is the authority. When the two drifted apart they
    // did so SILENTLY — a stale tab could open a plan on a build that will never stop for it, because
    // autonomous advance hard-stops on the proposal gate. `PATCH` already refuses the mirror move
    // (switching to `auto` while a plan is pending); together they make the pair impossible to hold.
    const dir = fixtureDir();
    const base = await createTask(dir, { requirement: 'x', confirmMode: 'each_step', deploy: 'none' });
    const ready = { ...base, status: 'awaiting_confirm' as const, project: 'p', workflowSlug: 'wf' };

    assert.ok(mayOpenProposal(ready, true), 'an attended build with a workflow may plan first');
    assert.ok(mayOpenProposal({ ...ready, confirmMode: 'spec_only' }, true), 'spec_only stops at gates too');
    assert.ok(!mayOpenProposal({ ...ready, confirmMode: 'auto' }, true), 'auto says nobody is waiting');
    assert.ok(!mayOpenProposal(ready, false), 'no workflow on disk → nothing to plan a change to');
    assert.ok(!mayOpenProposal({ ...ready, specRevise: true }, true), 'one proposal at a time');
    assert.ok(!mayOpenProposal({ ...ready, status: 'error' }, true), 'a /reply on an error is a Retry');
    assert.ok(!mayOpenProposal({ ...ready, project: null }, true));
    assert.ok(!mayOpenProposal({ ...ready, workflowSlug: null }, true));
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
