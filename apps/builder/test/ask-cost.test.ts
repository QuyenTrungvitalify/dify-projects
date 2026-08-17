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
import { askTestWithin, askWithin, readConsultChat, readLastAsk,
  askSessionTokens, shouldResetAskSession, ASK_RESET_TOKENS } from '../server/lib/ask.js';
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

  /* A reload must not erase the meter. A BUILD keeps its thread in localStorage, so it survived; a
     CONSULT rebuilds from the server transcript and that rebuild WINS over the browser copy — so on the
     one surface whose history is server-authoritative, the tip vanished on every reload. The number
     therefore belongs on disk, beside the answer it describes. */
  test('the transcript keeps the cost beside the answer, so a reload can restore it', async () => {
    const task = await terminalTask(dir);
    await settle(dir, task, { result: RESULT });

    const lines = await readConsultChat(dir, task.taskId);
    const answer = lines.at(-1)!;
    assert.equal(answer.role, 'assistant');
    assert.equal(answer.cost?.model, 'claude-opus-4-5-20260101');
    assert.equal(answer.cost?.outputTokens, 842);
    assert.equal(lines[0].cost, undefined, 'a question has no cost of its own');

    // …and the build's recovery payload carries it too, for a browser whose storage was cleared.
    const last = await readLastAsk(dir, task.taskId);
    assert.equal(last?.cost?.model, 'claude-opus-4-5-20260101');
  });

  test('a turn that reported nothing writes no cost onto the transcript line', async () => {
    const task = await terminalTask(dir);
    await settle(dir, task, { result: null, isError: true });
    const lines = await readConsultChat(dir, task.taskId);
    assert.equal('cost' in lines.at(-1)!, false);
  });

  /* ── the session reset ──────────────────────────────────────────────────────────────────────────
     A one-line question on an old build cost $8.86: the turn carried a 899k-token history and the cache
     had expired, so all of it was re-written at 1.25×. The seed was 21KB — shrinking it further could
     not have saved a cent. Dropping the history is the only lever, and it is safe HERE precisely because
     this surface re-sends the whole build context every turn. */

  test('a session that grew past the budget starts fresh, and the model is TOLD its history is gone', async () => {
    const task = await terminalTask(dir);
    task.sessionIds.askTest = 'old-session';
    await saveTask(dir, task);
    // the previous answer carried a 900k-token prefix — the measured shape
    await settle(dir, task, {
      result: { ...RESULT, usage: { input_tokens: 1, cache_read_input_tokens: 899_300, cache_creation_input_tokens: 10_300, output_tokens: 495 } },
    });

    let prompt = '';
    let resumed: string | undefined = 'not-observed';
    const runTurn = async (
      s: ClaudeSession, p: string, onSid?: (id: string) => void, o?: { onText?: (t: string) => void }
    ): Promise<TurnResult> => {
      prompt = p; resumed = s.resumeSessionId; onSid?.('brand-new'); o?.onText?.('ok');
      return { sessionId: 'brand-new', isError: false, result: RESULT } as unknown as TurnResult;
    };
    let done: Done & { sessionReset?: boolean } = { ok: false };
    await askTestWithin(task, 'and the next one?', {
      projectsDir: dir, settingsPath: '', log,
      broadcast: (_i: string, ev: string, pl: unknown) => { if (ev === 'ask:done') done = pl as typeof done; },
      runners: { runTurn },
    } as unknown as OrchestratorCtx, []);

    assert.equal(resumed, undefined, 'THE POINT: the expensive history is not resumed');
    assert.match(prompt, /NOT visible to you/, 'a dropped history must be stated, never left to be guessed at');
    assert.match(prompt, /say plainly that you cannot see it rather than guessing/);
    assert.equal(done.sessionReset, true, 'the live view can show it happened');
    assert.equal(task.sessionIds.askTest, 'brand-new', 'and the new session is the one carried forward');

    const last = await readConsultChat(dir, task.taskId);
    assert.equal(last.at(-1)!.sessionReset, true, 'recorded, so the exported ledger can show the lever working');
  });

  test('an ordinary session keeps its continuity — a follow-up chain is never interrupted', async () => {
    const task = await terminalTask(dir);
    // the first ask establishes the session (`settle`'s stub reports it as `sid-1`) and records a small
    // prefix — the ordinary case this must not disturb
    await settle(dir, task, {
      result: { ...RESULT, usage: { input_tokens: 2, cache_read_input_tokens: 15_600, cache_creation_input_tokens: 8_100, output_tokens: 500 } },
    });
    assert.equal(task.sessionIds.askTest, 'sid-1');

    let prompt = '';
    let resumed: string | undefined;
    const runTurn = async (
      s: ClaudeSession, p: string, onSid?: (id: string) => void, o?: { onText?: (t: string) => void }
    ): Promise<TurnResult> => {
      prompt = p; resumed = s.resumeSessionId; onSid?.('sid-1'); o?.onText?.('ok');
      return { sessionId: 'sid-1', isError: false, result: RESULT } as unknown as TurnResult;
    };
    let done: Done & { sessionReset?: boolean } = { ok: false };
    await askTestWithin(task, 'follow-up', {
      projectsDir: dir, settingsPath: '', log,
      broadcast: (_i: string, ev: string, pl: unknown) => { if (ev === 'ask:done') done = pl as typeof done; },
      runners: { runTurn },
    } as unknown as OrchestratorCtx, []);

    assert.equal(resumed, 'sid-1', 'THE POINT: an ordinary session is continued, not thrown away');
    assert.ok(!prompt.includes('NOT visible to you'), 'no note when nothing was dropped');
    assert.equal(done.sessionReset, undefined);
    assert.equal((await readConsultChat(dir, task.taskId)).at(-1)!.sessionReset, undefined);
  });

  test('a build with no recorded history keeps resuming, exactly as before', async () => {
    const task = await terminalTask(dir);
    task.sessionIds.askTest = 'legacy';
    await saveTask(dir, task);
    let prompt = '';
    let resumed: string | undefined;
    const runTurn = async (
      s: ClaudeSession, p: string, onSid?: (id: string) => void, o?: { onText?: (t: string) => void }
    ): Promise<TurnResult> => {
      prompt = p; resumed = s.resumeSessionId; onSid?.('legacy'); o?.onText?.('ok');
      return { sessionId: 'legacy', isError: false, result: RESULT } as unknown as TurnResult;
    };
    await askTestWithin(task, 'q', {
      projectsDir: dir, settingsPath: '', log, broadcast: () => {}, runners: { runTurn },
    } as unknown as OrchestratorCtx, []);
    assert.equal(resumed, 'legacy', 'nothing recorded ⇒ resume exactly as before');
    assert.ok(!prompt.includes('NOT visible to you'), 'nothing recorded ⇒ nothing to reset');
  });

  test('the decision itself: three angles on one prefix, summed once', () => {
    // A COLD turn reports the prefix as `written`; the next WARM turn reports the same material as
    // `read` plus the new increment. Both must land on the same number, or the reset would fire on one
    // and not the other for the same session.
    assert.equal(askSessionTokens({ inputTokens: 2, cacheReadTokens: 15_600, cacheCreationTokens: 883_700 }), 899_302);
    assert.equal(askSessionTokens({ inputTokens: 1, cacheReadTokens: 899_300, cacheCreationTokens: 10_300 }), 909_601);
    assert.equal(askSessionTokens(undefined), 0);
    assert.equal(askSessionTokens({}), 0);

    assert.equal(shouldResetAskSession({ inputTokens: 2, cacheReadTokens: 899_300 }), true);
    assert.equal(shouldResetAskSession({ inputTokens: 2, cacheReadTokens: 15_600, cacheCreationTokens: 8_100 }), false);
    assert.equal(shouldResetAskSession(undefined), false, 'no data is not a reason to throw away a session');
    assert.equal(shouldResetAskSession({ cacheReadTokens: ASK_RESET_TOKENS }), true, 'the limit is inclusive');
  });
});
