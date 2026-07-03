/**
 * Spec 028 (fast mode) — B4 tests. Two layers:
 *
 *  (unit)  normalizeFastMode + createTask force-off (seed/workflow/slug); restoreTargetPhaseFor.
 *  (flow)  the merged Analyze+Spec turn via the advance-loop seams (runTurn/runPython/postTurnCheck
 *          stubbed): a fast build runs ONE merged turn (not a separate Analyze), sets BOTH
 *          artifacts.analyze + artifacts.spec, never emits an Analyze phase, and — under `auto` — the
 *          §5 guard auto-advances a single-LLM shape (features==['llm']) but HARD-STOPS a non-single-LLM
 *          one (features⊄{llm}) or a features-less draft, parking at the Spec gate with fastReviewNote.
 *
 * No real claude/python/Dify — the seams make the ladder deterministic (mirrors advance-loop.test.ts).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { startTask, type OrchestratorCtx } from '../server/lib/orchestrator.js';
import { acquireTurn, releaseTurn, unmarkCancelled } from '../server/lib/lock.js';
import {
  createTask,
  normalizeFastMode,
  restoreTargetPhaseFor,
  type Task,
} from '../server/state/task.js';
import { PHASES } from '../server/lib/phases.js';
import { applyInitFake } from './helpers/scaffold-fake.js';
import type { ClaudeSession, SessionLogger } from '../server/lib/claude-session.js';
import type { TurnResult } from '../server/lib/turn-runner.js';
import type { PostTurnParams, PostTurnResult } from '../server/lib/post-turn.js';
import type { ReportResult } from '../server/lib/report.js';
import type { ShellResult } from '../server/lib/shell.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;

// ───────────────────────────── (unit) normalize + force-off + restore ─────────────────────────────

describe('028 · normalizeFastMode', () => {
  test('accepts real boolean + the string wire forms; unknown/missing → false', () => {
    for (const v of [true, 'true', 'on', '1', 'yes', 'TRUE', 'On']) {
      assert.equal(normalizeFastMode(v), true, `${String(v)} → true`);
    }
    for (const v of [false, 'false', 'off', '0', '', 'nope', null, undefined, {}]) {
      assert.equal(normalizeFastMode(v), false, `${String(v)} → false`);
    }
  });
});

describe('028 · createTask force-off (fast is from-scratch only)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fast-create-'));
  test('fast + no seed/workflow/slug → fastMode true', async () => {
    const t = await createTask(dir, { requirement: 'translate zh→en', fast: true });
    assert.equal(t.fastMode, true);
  });
  test('fast + seed → forced false', async () => {
    const t = await createTask(dir, { requirement: 'x', fast: true, seed: 'app-123' });
    assert.equal(t.fastMode, false);
  });
  test('fast + existing workflow → forced false', async () => {
    const t = await createTask(dir, { requirement: 'x', fast: true, workflow: 'my_flow' });
    assert.equal(t.fastMode, false);
  });
  test('fast + user-supplied slug → forced false', async () => {
    const t = await createTask(dir, { requirement: 'x', fast: true, slug: 'my_proj' });
    assert.equal(t.fastMode, false);
  });
  test('default (no fast field) → false', async () => {
    const t = await createTask(dir, { requirement: 'x' });
    assert.equal(t.fastMode, false);
  });
});

describe('028 · restoreTargetPhaseFor (fast-aware rewind)', () => {
  test('fast merged Spec first turn (spec, workflowSlug null) → null (no phantom Analyze gate)', () => {
    assert.equal(restoreTargetPhaseFor({ fastMode: true, phase: 'spec', workflowSlug: null }), null);
  });
  test('fast cancelled at implement (workflowSlug set) → spec (rewind to the Spec gate)', () => {
    assert.equal(restoreTargetPhaseFor({ fastMode: true, phase: 'implement', workflowSlug: 'p' }), 'spec');
  });
  test('standard build is unaffected', () => {
    assert.equal(restoreTargetPhaseFor({ fastMode: false, phase: 'spec', workflowSlug: null }), 'analyze');
    assert.equal(restoreTargetPhaseFor({ fastMode: false, phase: 'analyze', workflowSlug: null }), null);
  });
});

// ───────────────────────────── (flow) the merged turn via the advance-loop seams ─────────────────────────────

interface Harness {
  ctx: OrchestratorCtx;
  calls: { runTurn: number; runReport: number };
  events: Array<{ phase: string; status: string }>;
}

/** Emulate each phase's turn output. The FAST merged `spec` turn writes BOTH analyze.json (with the
 *  given features) AND SPEC.md to apps/builder/.runs/<taskId>/; Implement writes the workflow yaml. */
function writeTurnArtifacts(task: Task, dir: string, features: string[] | undefined): void {
  if (task.phase === 'spec' && task.fastMode) {
    const runDir = join(dir, 'apps/builder/.runs', task.taskId);
    mkdirSync(runDir, { recursive: true });
    const analyze: Record<string, unknown> = { seed: null, pattern: 'custom' };
    if (features !== undefined) analyze.features = features;
    writeFileSync(join(runDir, 'analyze.json'), JSON.stringify(analyze));
    writeFileSync(join(runDir, 'SPEC.md'), '# My App\nProposed slug / name: my_app / My App\nstart→llm→end.\n');
    return;
  }
  const phase = PHASES.find((p) => p.id === task.phase)!;
  const abs = join(dir, phase.artifactRel(task));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, task.phase === 'spec' ? '# SPEC\nbuild it.\n' : 'workflow:\n  graph:\n    nodes: []\n');
}

function harness(dir: string, task: Task, features: string[] | undefined): Harness {
  const calls = { runTurn: 0, runReport: 0 };
  const events: Harness['events'] = [];

  const runTurn = async (_s: ClaudeSession, _p: string): Promise<TurnResult> => {
    calls.runTurn++;
    writeTurnArtifacts(task, dir, features);
    return { sessionId: `sess-${task.phase}`, result: { type: 'result', is_error: false }, isError: false };
  };
  const runPython = async (_d: string, args: string[]): Promise<ShellResult> => {
    applyInitFake(dir, args);
    return { code: 0, stdout: '', stderr: '' };
  };
  const postTurnCheck = async (_p: PostTurnParams): Promise<PostTurnResult> => ({
    ok: true,
    status: 'done',
    reasons: [],
    detail: { artifactOk: true, yamlOk: true, lintCodes: { validate: 0, lint_refs: 0, lint_plugin_hashes: 0 }, idsOk: true, confinementBreaches: [] },
  });
  const runReport = async (_d: string, t: Task): Promise<ReportResult> => {
    calls.runReport++;
    return { ok: true, reasons: [], reportRel: `apps/builder/.runs/${t.taskId}/report.json`, lintClean: true };
  };

  const ctx: OrchestratorCtx = {
    projectsDir: dir,
    settingsPath: '',
    log,
    broadcast: (_id, event, data) => {
      if (event !== 'task:update') return;
      const t = data as Task;
      events.push({ phase: t.phase, status: t.status });
    },
    runners: { runTurn, runPython, runReport, postTurnCheck },
  };
  return { ctx, calls, events };
}

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fast-flow-'));
  const skill = join(dir, '.claude', 'skills', 'dify-build');
  mkdirSync(skill, { recursive: true });
  // fast → draft.md; standard → analyze/spec/implement. Provide all so runPhase's readFile+render works.
  for (const name of ['analyze', 'spec', 'implement', 'draft']) {
    writeFileSync(join(skill, `${name}.md`), `# ${name}\nrequirement: {{REQUIREMENT}}\ndepth: {{DEPTH}}\n`);
  }
  return dir;
}

async function withTurn(taskId: string, work: () => Promise<void>): Promise<void> {
  assert.ok(acquireTurn(taskId), 'acquired the turn lock');
  try {
    await work();
  } finally {
    releaseTurn(taskId);
    unmarkCancelled(taskId);
  }
}

describe('028 · merged Analyze+Spec turn (flow)', () => {
  test('each_step: ONE merged turn writes analyze.json + SPEC.md, parks at Spec (no Analyze gate, no scaffold)', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'translate zh→en', fast: true, confirmMode: 'each_step' });
    assert.equal(task.fastMode, true);
    const h = harness(dir, task, ['llm']);

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    assert.equal(task.phase, 'spec', 'runs the merged turn in the spec slot');
    assert.equal(task.status, 'awaiting_confirm', 'parks at the Spec gate');
    assert.equal(h.calls.runTurn, 1, 'ONE merged turn — the separate Analyze turn is skipped');
    assert.ok(task.artifacts.analyze, 'merged verify set artifacts.analyze');
    assert.ok(task.artifacts.spec, 'merged verify set artifacts.spec');
    assert.equal(task.workflowSlug, null, 'no scaffold yet — slug still null (writes stay under .runs/)');
    assert.equal(task.analysisFeatures?.join(','), 'llm', 'folded features from the merged analyze.json');
    assert.ok(h.events.every((e) => e.phase !== 'analyze'), 'the Analyze phase never appears in the emissions');
  });

  test('auto + single-LLM (features==["llm"]): §5 passes → runs hands-free to done in 2 turns', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'translate zh→en', fast: true, confirmMode: 'auto', deploy: 'none' });
    const h = harness(dir, task, ['llm']);

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    assert.equal(task.status, 'done', 'auto ran the merged build to done');
    assert.equal(task.phase, 'test');
    assert.equal(h.calls.runTurn, 2, 'merged spec + implement — NOT 3 (no standalone analyze)');
    assert.equal(h.calls.runReport, 1);
    assert.equal(task.fastReviewNote, undefined, '§5 did not fire for a genuine single-LLM shape');
    assert.ok(task.artifacts.analyze, 'artifacts.analyze persisted through the run');
    assert.ok(task.workflowSlug, 'workflowSlug derived at the (merged) Spec gate scaffold');
  });

  test('auto + NON-single-LLM (features⊄{llm}): §5 HARD-STOPS at the Spec gate for a human', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'loop over files then translate', fast: true, confirmMode: 'auto', deploy: 'none' });
    const h = harness(dir, task, ['llm', 'iteration']);

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    assert.equal(task.status, 'awaiting_confirm', 'auto did NOT auto-advance a non-trivial shape');
    assert.equal(task.phase, 'spec', 'parked at the Spec gate');
    assert.match(task.fastReviewNote ?? '', /non-trivial shape/, 'surfaced the review note (§5 guard fired)');
    assert.equal(h.calls.runReport, 0, 'never reached ④');
    assert.equal(task.workflowSlug, null, 'never scaffolded/advanced');
  });

  test('auto + features ABSENT: §5 fail-safe HARD-STOPS (empty ⊄ {llm})', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'ambiguous', fast: true, confirmMode: 'auto', deploy: 'none' });
    const h = harness(dir, task, undefined); // merged draft wrote NO features

    await withTurn(task.taskId, () => startTask(task, h.ctx));

    assert.equal(task.status, 'awaiting_confirm', 'a features-less draft fails safe (hard-stop, not auto-advance)');
    assert.equal(task.phase, 'spec');
    assert.match(task.fastReviewNote ?? '', /non-trivial shape/);
    assert.equal(task.analysisFeatures, undefined, 'no features folded');
  });
});
