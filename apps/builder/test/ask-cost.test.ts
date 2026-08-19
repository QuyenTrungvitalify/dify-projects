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
import { askTestWithin, askWithin, readConsultChat, readLastAsk, readLastAskMeta,
  askSessionTokens, shouldResetAskSession, askResetSuppressed, ASK_RESET_TOKENS } from '../server/lib/ask.js';
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
    // The previous answer carried a prefix past the limit. Spec 100 raised that limit 300k → 1M, so
    // this fixture moved with it: 899k (the old value) is now BELOW the line on purpose — it was one
    // expensive QUESTION, not a bloated HISTORY, and the whole point of the new number is to stop
    // confusing the two. 1.2M is unambiguously a session that has actually grown.
    await settle(dir, task, {
      result: { ...RESULT, usage: { input_tokens: 1, cache_read_input_tokens: 1_190_000, cache_creation_input_tokens: 10_300, output_tokens: 495 } },
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

  /* THE DOOM LOOP (spec 100). The static 50k floor guards against a limit under the CLI's own preamble.
     It cannot guard against a limit under one TURN of a particular build — that number depends on how
     big the artifacts are, so no constant knows it. Run 1786505684286: turn 110 was a session that had
     JUST been reset, still carried 442k, still cost $1.02, and still triggered the next reset. Four
     resets in a day, two of them 8 minutes apart. The signal is exact and already on disk (`sessionReset`
     on the assistant line), so the fix is to read it rather than to guess a bigger constant. */
  test('the dynamic floor: a session that was ALREADY reset and still blew the limit is not reset again', async () => {
    const task = await terminalTask(dir);
    task.sessionIds.askTest = 'old-session';
    await saveTask(dir, task);
    // Build the precondition the way it happens in real life — the flag is decided from the PREVIOUS
    // turn, so it takes two. Turn 1 records an over-limit cost (nothing before it, so no reset). Turn 2
    // sees that, resets, and — this is what matters — ITS OWN cost is over the limit too, which is
    // exactly the shape of the observed loop (run 1786505684286 turn 110: fresh, and still 442k).
    const heavy = {
      result: { ...RESULT, usage: { input_tokens: 1, cache_read_input_tokens: 1_190_000, cache_creation_input_tokens: 10_300, output_tokens: 495 } },
    };
    await settle(dir, task, heavy);
    await settle(dir, task, heavy);
    const seeded = await readConsultChat(dir, task.taskId);
    assert.equal(seeded.at(-1)!.sessionReset, true, 'precondition: turn 2 IS recorded as a fresh session');
    assert.ok(
      askSessionTokens(seeded.at(-1)!.cost) >= ASK_RESET_TOKENS,
      'precondition: and that fresh turn STILL exceeded the limit — the loop condition',
    );

    // Turn 2 asks again. The limit fires on turn 1's cost — but resetting would just repeat the loop.
    let resumed: string | undefined = 'not-observed';
    let prompt = '';
    const runTurn = async (
      s: ClaudeSession, p: string, onSid?: (id: string) => void, o?: { onText?: (t: string) => void }
    ): Promise<TurnResult> => {
      resumed = s.resumeSessionId; prompt = p; onSid?.('kept'); o?.onText?.('ok');
      return { sessionId: 'kept', isError: false, result: RESULT } as unknown as TurnResult;
    };
    let done: Done & { sessionReset?: boolean } = { ok: false };
    const warns: unknown[] = [];
    await askTestWithin(task, 'and again?', {
      projectsDir: dir, settingsPath: '',
      log: { info() {}, warn: (o: unknown) => { warns.push(o); }, error() {} },
      broadcast: (_i: string, ev: string, pl: unknown) => { if (ev === 'ask:done') done = pl as typeof done; },
      runners: { runTurn },
    } as unknown as OrchestratorCtx, []);

    assert.ok(resumed, 'THE POINT: the second reset is DECLINED — continuity is kept, not thrown away twice');
    assert.equal(done.sessionReset, undefined, 'and nothing claims a reset happened');
    assert.ok(!prompt.includes('NOT visible to you'), 'no amnesia note when no history was dropped');

    // Declining QUIETLY would read exactly like a healthy session. This is the one line that says the
    // threshold itself is misconfigured, so it must carry the real numbers.
    assert.equal(warns.length, 1, 'the declined reset is reported, not swallowed');
    const w = warns[0] as { tokens: number; limit: number };
    assert.equal(w.limit, ASK_RESET_TOKENS);
    assert.ok(w.tokens >= ASK_RESET_TOKENS, `the warn carries the measured number (got ${w.tokens})`);
  });

  test('readLastAskMeta reads the reset decision inputs WITHOUT widening the wire payload', async () => {
    // A separate reader from `readLastAsk` on purpose: that one's shape rides GET /api/tasks/:id as
    // `lastAsk`, and spec 099 holds that payload fixed. This one exists so a server-internal decision
    // input never has to travel to the browser on every reconnect to be read by nobody.
    const task = await terminalTask(dir);
    assert.deepEqual(
      await readLastAskMeta(dir, task.taskId), { sessionReset: false },
      'no transcript ⇒ nothing recorded is not a reason to throw a session away',
    );

    await settle(dir, task, { result: { ...RESULT, usage: { input_tokens: 1, cache_read_input_tokens: 20_000, output_tokens: 5 } } });
    const ordinary = await readLastAskMeta(dir, task.taskId);
    assert.equal(ordinary.sessionReset, false, 'an ordinary turn is not a fresh session');
    assert.equal(askSessionTokens(ordinary.cost), 20_001, 'and its cost comes back for the decision');

    // …and `lastAsk` — the shape that DOES go on the wire — must be unchanged by any of this.
    const wire = await readLastAsk(dir, task.taskId);
    assert.deepEqual(
      Object.keys(wire!).sort(), ['a', 'cost', 'ok', 'q'],
      'regression: lastAsk gained no fields (spec 099 non-goal)',
    );
  });

  test('the dynamic floor is NOT a blanket amnesty: a reset session that came back UNDER the limit still resets later', async () => {
    // Guards the obvious over-correction — "was reset once ⇒ never reset again". The flag only matters
    // on the turn that is being judged; once a turn lands under the limit, the next growth is real again.
    assert.equal(
      shouldResetAskSession({ cacheReadTokens: 1_190_000 }, ASK_RESET_TOKENS, true), false,
      'previous turn was fresh AND over → declined',
    );
    assert.equal(
      shouldResetAskSession({ cacheReadTokens: 1_190_000 }, ASK_RESET_TOKENS, false), true,
      'previous turn was NOT fresh → an ordinary over-limit session still resets',
    );
    assert.equal(
      shouldResetAskSession({ cacheReadTokens: 65_714 }, ASK_RESET_TOKENS, true), false,
      'under the limit is a no-op either way — the flag never forces a reset',
    );
    assert.equal(
      askResetSuppressed({ cacheReadTokens: 1_190_000 }, ASK_RESET_TOKENS, true), true,
      'and THAT case is the one worth a log line',
    );
    assert.equal(askResetSuppressed({ cacheReadTokens: 65_714 }, ASK_RESET_TOKENS, true), false);
    assert.equal(askResetSuppressed({ cacheReadTokens: 1_190_000 }, ASK_RESET_TOKENS, false), false);
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

    assert.equal(shouldResetAskSession({ inputTokens: 2, cacheReadTokens: 1_190_000 }), true);
    assert.equal(shouldResetAskSession({ inputTokens: 2, cacheReadTokens: 15_600, cacheCreationTokens: 8_100 }), false);
    assert.equal(shouldResetAskSession(undefined), false, 'no data is not a reason to throw away a session');
    assert.equal(shouldResetAskSession({ cacheReadTokens: ASK_RESET_TOKENS }), true, 'the limit is inclusive');

    // 899k USED to reset (the limit was 300k) and deliberately no longer does. That turn was one
    // expensive QUESTION — a 622-token answer whose prefix had to be re-written because the cache had
    // expired — not a session that had grown. Resetting there is what spec 100 measured as the doom
    // loop: reset → the model must re-read main.yml → that turn blows the limit → reset again.
    assert.equal(
      shouldResetAskSession({ inputTokens: 2, cacheReadTokens: 899_300 }),
      false,
      'spec 100: one heavy turn is no longer mistaken for a bloated session',
    );

    // A fresh session is not free: measured live, the turn right after a reset still carried 26,837
    // tokens (the CLI's own preamble + the seed). A threshold under that floor resets EVERY turn —
    // continuity gone for good, bill unchanged — so the knob refuses to be set there.
    assert.ok(ASK_RESET_TOKENS >= 50_000, 'the configured limit never lands under the fresh-session floor');
    assert.equal(shouldResetAskSession({ cacheReadTokens: 26_837 }, 20_000), true, 'an explicit limit is still honoured in-process');
  });
});

/**
 * Per-attempt phase cost, on DISK.
 *
 * The live `phase:cost` event only reaches a client that is watching, and it lands in a thread the
 * browser keeps in localStorage — so the numbers survive a reload on that machine and nowhere else, and
 * a run nobody had open never had them at all. `events.jsonl` outlives all of that, already ships in the
 * exported bundle, and — unlike `task.cost[phase]`, which is last-write-wins across re-runs — keeps one
 * line per round.
 */
describe('phase cost outlives the browser', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'phase-cost-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  test('every attempt writes its own turn_cost line, oldest first', async () => {
    const { logEvent, readEvents } = await import('../server/lib/run-events.js');
    const runDir = join(dir, 'run');
    await mkdir(runDir, { recursive: true });
    await logEvent(runDir, { kind: 'turn_cost', phase: 'implement', cost: { totalCostUsd: 6.61, model: 'claude-opus-5' } });
    await logEvent(runDir, { kind: 'turn_cost', phase: 'implement', cost: { totalCostUsd: 0.3 } });

    const costs = (await readEvents(runDir)).filter((e) => e.kind === 'turn_cost');
    assert.equal(costs.length, 2, 'a fix round does not overwrite the round before it');
    assert.equal(costs[0].cost?.totalCostUsd, 6.61);
    assert.equal(costs[1].cost?.totalCostUsd, 0.3);
    assert.equal(costs[0].cost?.model, 'claude-opus-5');
  });

  test('an event with no cost stays exactly as it was — old timelines still parse', async () => {
    const { logEvent, readEvents } = await import('../server/lib/run-events.js');
    const runDir = join(dir, 'run2');
    await mkdir(runDir, { recursive: true });
    await logEvent(runDir, { kind: 'phase_start', phase: 'spec', detail: 'fresh' });
    const [e] = await readEvents(runDir);
    assert.equal(e.kind, 'phase_start');
    assert.equal('cost' in e, false, 'no phantom key on every other event in the file');
  });
});

/**
 * A phase's OUTPUT on the server.
 *
 * It had only ever lived in the browser: watch a build, clear the cache (or open it elsewhere), and a
 * finished build showed its requirement and the current gate with every phase's reasoning missing. The
 * markdown transcript beside this is for a person to read; this is the same attempt in a form the UI can
 * rebuild from, bounded so a long build does not re-ride the wire on every reconnect.
 */
describe('phase output outlives the browser', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'runs-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  test('each attempt is readable back, oldest first, with its cost', async () => {
    const { AttemptRecorder, readRunAttempts } = await import('../server/lib/run-transcript.js');
    const r1 = new AttemptRecorder({ phase: 'spec', attempt: 1, resume: false, prompt: 'p' });
    r1.onText('the spec reasoning');
    await r1.flush(dir, { cost: { totalCostUsd: 0.09, model: 'claude-haiku-4-5' }, note: undefined });
    const r2 = new AttemptRecorder({ phase: 'implement', attempt: 1, resume: false, prompt: 'p' });
    r2.onText('the implement reasoning');
    await r2.flush(dir, { cost: { totalCostUsd: 6.61 }, note: 'timed out' });

    const { runs, dropped } = await readRunAttempts(dir);
    assert.equal(dropped, 0);
    assert.deepEqual(runs.map((r) => r.phase), ['spec', 'implement']);
    assert.match(runs[0].output, /the spec reasoning/);
    assert.equal(runs[0].cost?.model, 'claude-haiku-4-5');
    assert.equal(runs[1].note, 'timed out', 'a turn that died says so where the UI can read it');
  });

  test('a long build is bounded, and says how many attempts it left out', async () => {
    const { AttemptRecorder, readRunAttempts } = await import('../server/lib/run-transcript.js');
    for (let i = 0; i < 12; i++) {
      const rec = new AttemptRecorder({ phase: 'implement', attempt: i + 1, resume: false, prompt: 'p' });
      // the marker goes at the END: the recorder keeps the TAIL of a long output on purpose
      // (a failure shows up last), so a head-anchored label would be the first thing dropped.
      rec.onText('x'.repeat(9_000) + ` attempt ${i}`);
      await rec.flush(dir, { cost: null });
    }
    const { runs, dropped } = await readRunAttempts(dir, { maxTotalChars: 20_000, maxPerAttempt: 6_000 });
    assert.ok(runs.length < 12 && runs.length > 0, `kept ${runs.length}`);
    assert.equal(dropped, 12 - runs.length, 'the count of what is missing is stated, not implied');
    assert.ok(runs.every((r) => r.output.length <= 6_100), 'each attempt is capped');
    assert.match(runs.at(-1)!.output, /attempt 11/, 'the newest attempt is the one always kept');
  });

  test('no records ⇒ nothing, not an empty-looking build', async () => {
    const { readRunAttempts } = await import('../server/lib/run-transcript.js');
    assert.deepEqual(await readRunAttempts(dir), { runs: [], dropped: 0 });
  });
});
