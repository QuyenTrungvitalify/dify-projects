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
import { createTask, type Task } from '../server/state/task.js';
import { PHASES } from '../server/lib/phases.js';
import type { ClaudeSession, SessionLogger } from '../server/lib/claude-session.js';
import type { TurnResult } from '../server/lib/turn-runner.js';
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
}

interface Harness {
  ctx: OrchestratorCtx;
  calls: { runTurn: number; runReport: number; runPython: number; postTurnCheck: number };
  /** every `task:update` emission, in order. */
  events: Array<{ phase: string; status: string; flag?: string; actions: string[] }>;
}

/** Write the artifact a real turn would produce for the task's CURRENT phase, so the (real) ①/②
 *  verify (artifact-exists + JSON + confinement) passes; ③ verify is the stubbed postTurnCheck. */
function writeArtifact(task: Task, dir: string): void {
  const phase = PHASES.find((p) => p.id === task.phase)!;
  const rel = phase.artifactRel(task);
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  if (task.phase === 'analyze') writeFileSync(abs, '{"seed": null, "summary": "ok"}');
  else if (task.phase === 'spec') writeFileSync(abs, '# SPEC\nbuild it.\n');
  else writeFileSync(abs, 'workflow:\n  graph:\n    nodes: []\n');
}

function harness(dir: string, task: Task, o: Overrides = {}): Harness {
  const calls = { runTurn: 0, runReport: 0, runPython: 0, postTurnCheck: 0 };
  const events: Harness['events'] = [];

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
    writeArtifact(task, dir);
    return { sessionId: `sess-${task.phase}`, result: { type: 'result', is_error: false }, isError: false };
  };

  const runPython = async (_projectsDir: string, args: string[]): Promise<ShellResult> => {
    calls.runPython++;
    // Emulate init_project.py's effect: create projects/<slug>/workflows so the SPEC.md move + the
    // Implement artifact path resolve. (The orchestrator's only runPython call is the scaffold.)
    const i = args.indexOf('--slug');
    if (args.some((a) => a.includes('init_project.py')) && i !== -1) {
      mkdirSync(join(dir, 'projects', args[i + 1], 'workflows'), { recursive: true });
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  const postTurnCheck = async (_p: PostTurnParams): Promise<PostTurnResult> => {
    calls.postTurnCheck++;
    const lintCodes: LintCodes = o.lintCodes ?? { validate: 0, lint_refs: 0, lint_plugin_hashes: 0 };
    const clean = lintCodes.validate === 0 && lintCodes.lint_refs === 0 && lintCodes.lint_plugin_hashes === 0;
    const reasons = clean ? [] : ['lint≠0 (cap-5 reached)'];
    return {
      ok: clean,
      status: clean ? 'done' : 'error',
      reasons,
      detail: { artifactOk: true, yamlOk: true, lintCodes, idsOk: true, confinementBreaches: [] },
    };
  };

  const runReport = async (
    _projectsDir: string,
    t: Task,
    _log: SessionLogger,
    _opts?: ReportOpts
  ): Promise<ReportResult> => {
    calls.runReport++;
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
  return { ctx, calls, events };
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
    assert.equal(h.calls.runTurn, 3, 'one turn each for analyze/spec/implement');
    assert.equal(h.calls.runReport, 1, '④ report ran once');
    // the ladder visited every phase
    const phasesSeen = new Set(h.events.map((e) => e.phase));
    assert.deepEqual([...phasesSeen].sort(), ['analyze', 'implement', 'spec', 'test']);
    // a project was scaffolded for the derived slug
    assert.ok(task.slug, 'slug derived at the spec gate');
  });

  test('AC #25 — a still_failing Implement HARD-STOPS auto (parks at the gate, never reaches ④)', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'build a flaky one', confirmMode: 'auto', deploy: 'none' });
    const h = harness(dir, task, { lintCodes: { validate: 1, lint_refs: 0, lint_plugin_hashes: 0 } });

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
    assert.deepEqual(task.gate?.actions.map((a) => a.id), ['accept', 'discard']);
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

  test('D1 — auto + clean selfhost PARKS at the Import gate (never auto-deploys)', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'selfhost clean auto', confirmMode: 'auto', deploy: 'selfhost' });
    const h = harness(dir, task, { reportLintClean: true });

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    assert.equal(task.status, 'awaiting_confirm', 'auto runs ①→④ but PARKS at the deploy decision (spec 014 D1)');
    assert.equal(task.phase, 'test');
    assert.equal(task.gate?.flag, 'awaiting_import');
    assert.deepEqual(task.gate?.actions.map((a) => a.id), ['import', 'skip_import', 'discard']);
    assert.equal(h.calls.runReport, 1, 'the report ran; the import did NOT auto-fire');
  });

  test('a clean selfhost build PARKS at the Import gate (auto-confirm would push) but not past it here', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'selfhost clean', confirmMode: 'each_step', deploy: 'selfhost' });
    const h = harness(dir, task, { reportLintClean: true });

    // each_step: drive analyze→spec→implement→test by hand, then assert the ④ Import gate appears.
    await withTurn(task.taskId, () => startTask(task, h.ctx)); // ① analyze → parks
    assert.equal(task.status, 'awaiting_confirm');
    assert.equal(task.phase, 'analyze');
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', h.ctx)); // → ② spec
    assert.equal(task.phase, 'spec');
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', h.ctx)); // scaffold → ③ implement
    assert.equal(task.phase, 'implement');
    assert.equal(task.status, 'awaiting_confirm');
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', h.ctx)); // → ④ test (clean selfhost)

    assert.equal(task.phase, 'test');
    assert.equal(task.status, 'awaiting_confirm', 'clean selfhost ④ parks behind the Import button');
    assert.equal(task.gate?.flag, 'awaiting_import');
    assert.deepEqual(task.gate?.actions.map((a) => a.id), ['import', 'skip_import', 'discard']);
  });

  test('/reply at ④ re-runs the REPORT, not a turn', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'x', confirmMode: 'auto', deploy: 'none' });
    const h = harness(dir, task);
    await withTurn(task.taskId, () => startTask(task, h.ctx)); // run to done@test
    assert.equal(task.phase, 'test');
    const turnsBefore = h.calls.runTurn;
    const reportsBefore = h.calls.runReport;

    await replyWithin(task, 'tweak the report', h.ctx);

    assert.equal(h.calls.runTurn, turnsBefore, '/reply at ④ spawned NO turn');
    assert.equal(h.calls.runReport, reportsBefore + 1, '/reply at ④ re-ran the report');
  });

  test('D4 — a /reply that TIMES OUT does not re-run a second full turn (spec 014)', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'slow build', confirmMode: 'each_step', deploy: 'none' });
    // place it mid-build at Implement with a resumable session + a scaffolded project.
    task.phase = 'implement';
    task.slug = 'slow_proj';
    task.project = 'slow_proj';
    task.workflowFile = 'main.yml';
    task.sessionIds.implement = 'sess-impl';
    task.status = 'awaiting_confirm';
    mkdirSync(join(dir, 'projects', 'slow_proj', 'workflows'), { recursive: true });
    writeFileSync(join(dir, 'projects', 'slow_proj', 'SPEC.md'), '# spec\nbuild it.\n');

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
        postTurnCheck: async () => ({
          ok: true,
          status: 'done',
          reasons: [],
          detail: { artifactOk: true, yamlOk: true, lintCodes: { validate: 0, lint_refs: 0, lint_plugin_hashes: 0 }, idsOk: true, confinementBreaches: [] },
        }),
      },
    };

    await withTurn(task.taskId, () => replyWithin(task, 'are you done yet?', ctx));

    assert.equal(turns, 1, 'a resume timeout parks at error — it must NOT spend a SECOND full turn (D4)');
    assert.equal(task.status, 'error', 'the timed-out resume parks at error');
  });

  test('a cancel landing mid-turn leaves status=cancelled with the gate cleared (no clobber)', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'cancel me', confirmMode: 'auto', deploy: 'none' });
    const h = harness(dir, task, { cancelDuringTurn: 'analyze' });

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    assert.equal(task.status, 'cancelled', 'converged to cancelled');
    assert.equal(task.gate, undefined, 'gate cleared (no awaiting_confirm clobber)');
    assert.equal(h.calls.runReport, 0, 'never advanced past the cancelled turn');
  });
});
