/**
 * 013 D4 — the behavior-preservation golden test. A full `each_step` build (with the D2 runner seams
 * stubbed) records the ordered (phase, status, gate.actions[].id) emissions. The committed GOLDEN
 * sequence below is the regression net every downstream spec (014 lint-gate correctness, 015
 * confinement, 017 linter parallelize) leans on: those specs edit exactly the code this spec touched,
 * and this test fails the instant the refactor — or any of theirs — perturbs the gate/status/phase
 * ladder. 013 itself is behavior-preserving, so this sequence must hold before and after its refactor.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { startTask, confirmAdvance, type OrchestratorCtx } from '../server/lib/orchestrator.js';
import { acquireTurn, releaseTurn } from '../server/lib/lock.js';
import { createTask, type Task } from '../server/state/task.js';
import { PHASES } from '../server/lib/phases.js';
import { applyInitFake } from './helpers/scaffold-fake.js';
import type { ClaudeSession, SessionLogger } from '../server/lib/claude-session.js';
import type { TurnResult } from '../server/lib/turn-runner.js';
import type { PostTurnParams, PostTurnResult } from '../server/lib/post-turn.js';
import type { ReportResult } from '../server/lib/report.js';
import type { ShellResult } from '../server/lib/shell.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;

/** The committed baseline — a deploy=none each_step build's exact (phase/status/actions) emissions. */
const GOLDEN: Array<{ phase: string; status: string; actions: string[] }> = [
  { phase: 'analyze', status: 'running', actions: [] },
  { phase: 'analyze', status: 'awaiting_confirm', actions: ['continue', 'changes', 'discard'] },
  { phase: 'spec', status: 'running', actions: [] },
  { phase: 'spec', status: 'awaiting_confirm', actions: ['continue', 'changes', 'discard'] },
  { phase: 'implement', status: 'running', actions: [] },
  { phase: 'implement', status: 'awaiting_confirm', actions: ['continue', 'changes', 'discard'] },
  { phase: 'test', status: 'running', actions: [] },
  { phase: 'test', status: 'done', actions: [] },
];

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'golden-'));
  const skill = join(dir, '.claude', 'skills', 'dify-build');
  mkdirSync(skill, { recursive: true });
  for (const name of ['analyze', 'spec', 'implement']) writeFileSync(join(skill, `${name}.md`), `# ${name}\n`);
  return dir;
}

function stubs(dir: string, task: Task): { ctx: OrchestratorCtx; events: typeof GOLDEN } {
  const events: typeof GOLDEN = [];
  const runTurn = async (_s: ClaudeSession, _p: string, _cb?: (id: string) => void): Promise<TurnResult> => {
    const phase = PHASES.find((p) => p.id === task.phase)!;
    const abs = join(dir, phase.artifactRel(task));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, task.phase === 'analyze' ? '{"seed":null}' : 'workflow:\n  graph:\n    nodes: []\n');
    return { sessionId: `s-${task.phase}`, result: { type: 'result', is_error: false }, isError: false };
  };
  const runPython = async (_d: string, args: string[]): Promise<ShellResult> => {
    applyInitFake(dir, args);
    return { code: 0, stdout: '', stderr: '' };
  };
  const postTurnCheck = async (_p: PostTurnParams): Promise<PostTurnResult> => ({
    ok: true, status: 'done', reasons: [],
    detail: { artifactOk: true, yamlOk: true, lintCodes: { validate: 0, lint_refs: 0, lint_plugin_hashes: 0 }, idsOk: true, confinementBreaches: [] },
  });
  const runReport = async (_d: string, t: Task): Promise<ReportResult> =>
    ({ ok: true, reasons: [], reportRel: `apps/builder/.runs/${t.taskId}/report.json`, lintClean: true });

  const ctx: OrchestratorCtx = {
    projectsDir: dir, settingsPath: '', log,
    broadcast: (_id, event, data) => {
      if (event !== 'task:update') return;
      const t = data as Task;
      events.push({ phase: t.phase, status: t.status, actions: t.gate?.actions.map((a) => a.id) ?? [] });
    },
    runners: { runTurn, runPython, runReport, postTurnCheck },
  };
  return { ctx, events };
}

async function withTurn(taskId: string, work: () => Promise<void>): Promise<void> {
  assert.ok(acquireTurn(taskId));
  try {
    await work();
  } finally {
    releaseTurn(taskId);
  }
}

describe('golden build (013 D4 — behavior preservation)', () => {
  test('each_step deploy=none emits the exact committed (phase, status, actions) ladder', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'golden path', confirmMode: 'each_step', deploy: 'none' });
    const { ctx, events } = stubs(dir, task);

    await withTurn(task.taskId, () => startTask(task, ctx)); // ① analyze, parks
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx)); // ② spec
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx)); // scaffold → ③ implement
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx)); // ④ test → done

    assert.deepEqual(events, GOLDEN);
  });
});
