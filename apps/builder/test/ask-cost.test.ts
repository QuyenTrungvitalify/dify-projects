/**
 * The per-answer cost read-out (dev tip).
 *
 * A phase has always recorded what it cost (`task.json.cost.<phase>`, spec 059); an ask recorded
 * nothing. That left the one surface measured at 3.4× the price of building (spec 098) as the only one
 * with no meter on it — you could watch a build's tokens and not your own questions'. The turn's
 * terminal `result` event already carries the numbers, so this is a read, not a new measurement: the
 * same `costFromResult` the phases use, attached to `ask:done`.
 *
 * Two properties matter and are pinned here: it must ride on EVERY settle (a failed or cut-off answer is
 * exactly when someone wants to know what it burned), and it must be ABSENT rather than zero-filled when
 * the turn died before reporting anything — a tip made of dashes is worse than no tip.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { askTestWithin, askWithin } from '../server/lib/ask.js';
import { createTask, saveTask, type Task } from '../server/state/task.js';
import type { ClaudeSession } from '../server/lib/claude-session.js';
import type { TurnResult } from '../server/lib/turn-runner.js';
import type { OrchestratorCtx } from '../server/lib/orchestrator-shared.js';

const log = { info() {}, warn() {}, error() {}, debug() {} } as unknown as OrchestratorCtx['log'];

/** A terminal result event shaped like the CLI's, with the fields `costFromResult` reads. */
const RESULT = {
  type: 'result',
  is_error: false,
  duration_ms: 47_200,
  num_turns: 3,
  total_cost_usd: 0.2134,
  modelUsage: { 'claude-opus-4-5-20260101': {} },
  usage: {
    input_tokens: 4000,
    output_tokens: 842,
    cache_read_input_tokens: 36_000,
    cache_creation_input_tokens: 1200,
  },
};

type Done = { ok: boolean; cost?: Record<string, unknown>; seededFrom?: string[] };

async function terminalTask(dir: string): Promise<Task> {
  const task = await createTask(dir, { requirement: 'r', confirmMode: 'auto' });
  task.phase = 'test';
  task.status = 'done';
  task.project = '_drafts';
  task.workflowSlug = 'w';
  await saveTask(dir, task);
  await mkdir(join(dir, 'projects/_drafts/w/workflows'), { recursive: true });
  await writeFile(join(dir, 'projects/_drafts/w/SPEC.md'), '# s');
  await writeFile(
    join(dir, 'projects/_drafts/w/workflows/main.yml'),
    ['workflow:', '  graph:', '    nodes:', "    - id: 'a'", '      data:', '        type: start', '        title: t'].join('\n'),
  );
  await mkdir(join(dir, `apps/builder/.runs/${task.taskId}`), { recursive: true });
  return task;
}

/** Run one ask with a stubbed turn and hand back whatever `ask:done` carried. */
async function settle(dir: string, task: Task, turn: Partial<TurnResult> & { result: unknown }): Promise<Done> {
  let done: Done = { ok: false };
  const runTurn = async (
    _s: ClaudeSession, _p: string, onSid?: (id: string) => void, o?: { onText?: (t: string) => void }
  ): Promise<TurnResult> => {
    onSid?.('sid-1');
    if (!turn.isError) o?.onText?.('an answer');
    return { sessionId: 'sid-1', isError: false, ...turn } as TurnResult;
  };
  const ctx = {
    projectsDir: dir,
    settingsPath: '',
    log,
    broadcast: (_id: string, ev: string, payload: unknown) => {
      if (ev === 'ask:done') done = payload as Done;
    },
    runners: { runTurn },
  } as unknown as OrchestratorCtx;
  await askTestWithin(task, 'what does this do?', ctx, []);
  return done;
}

describe('the dev cost tip — what one answer cost', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ask-cost-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  test('ask:done carries the model + tokens of the turn that answered', async () => {
    const done = await settle(dir, await terminalTask(dir), { result: RESULT });
    assert.equal(done.ok, true);
    assert.deepEqual(done.cost, {
      durationMs: 47_200,
      numTurns: 3,
      totalCostUsd: 0.2134,
      inputTokens: 4000,
      outputTokens: 842,
      cacheReadTokens: 36_000,
      cacheCreationTokens: 1200,
      model: 'claude-opus-4-5-20260101',
    });
    // …and `seededFrom` still rides along: the tip is additive, it does not displace the caption.
    assert.ok(done.seededFrom?.includes('main.yml'));
  });

  test('a turn that died reporting nothing carries NO cost key (not a zero-filled husk)', async () => {
    const done = await settle(dir, await terminalTask(dir), { result: null, isError: true });
    assert.equal(done.ok, false);
    assert.equal('cost' in done, false, 'an absent measurement must be absent, not zero');
  });

  test('a CUT-OFF answer still reports what it burned — that is when it matters most', async () => {
    const done = await settle(dir, await terminalTask(dir), { result: RESULT, isError: true, note: 'timed out after 8m' });
    assert.equal(done.ok, false);
    assert.equal((done.cost as { outputTokens?: number }).outputTokens, 842);
  });

  test('a phase-gate ask reports it too, not only the terminal one', async () => {
    const task = await createTask(dir, { requirement: 'r', confirmMode: 'manual' });
    task.phase = 'spec';
    task.status = 'awaiting_confirm';
    task.project = '_drafts';
    task.workflowSlug = 'w';
    await saveTask(dir, task);
    await mkdir(join(dir, 'projects/_drafts/w'), { recursive: true });
    await writeFile(join(dir, 'projects/_drafts/w/SPEC.md'), '# s');

    let done: Done = { ok: false };
    const runTurn = async (
      _s: ClaudeSession, _p: string, onSid?: (id: string) => void, o?: { onText?: (t: string) => void }
    ): Promise<TurnResult> => {
      onSid?.('sid-2');
      o?.onText?.('yes');
      return { sessionId: 'sid-2', isError: false, result: RESULT } as unknown as TurnResult;
    };
    await askWithin(task, 'why this shape?', {
      projectsDir: dir,
      settingsPath: '',
      log,
      broadcast: (_id: string, ev: string, payload: unknown) => { if (ev === 'ask:done') done = payload as Done; },
      runners: { runTurn },
    } as unknown as OrchestratorCtx, []);
    assert.equal((done.cost as { model?: string }).model, 'claude-opus-4-5-20260101');
  });
});
