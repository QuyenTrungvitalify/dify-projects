/**
 * A BUILD ask's answer must survive the browser.
 *
 * THE BUG: `ask:answer` is deliberately excluded from the SSE replay buffer (plugins/sse.ts — it is
 * high-volume), switching tasks tears the stream down, and a fresh EventSource never sends
 * `Last-Event-ID`, so nothing was replayable either. A build ask's answer therefore existed ONLY in the
 * browser's memory: send a question, open another task, come back, and the client — seeing the turn was
 * no longer running — closed the bubble as a successful "Answered" with nothing in it. A consult never
 * had the problem because its transcript is on disk; these tests pin that a build now has one too, and
 * that `readLastAsk` hands back exactly what the reader saw.
 *
 * Hermetic via the 013 D2 runner seam — no real `claude` spawns.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { askWithin, askTestWithin, readLastAsk, recentExchanges,
  RESET_CARRYOVER_BYTES, RESET_CARRYOVER_PAIRS } from '../server/lib/ask.js';
import tasksRoutes, { type TasksRoutesOptions } from '../server/routes/tasks.js';
import { chatTurnBusy } from '../server/lib/lock.js';
import { createTask, saveTask, type Task } from '../server/state/task.js';
import type { ClaudeSession } from '../server/lib/claude-session.js';
import type { TurnResult } from '../server/lib/turn-runner.js';
import type { OrchestratorCtx } from '../server/lib/orchestrator-shared.js';

const log = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, fatal: () => {}, trace: () => {},
  level: 'silent', silent: () => {},
} as unknown as OrchestratorCtx['log'];

/** A fake turn that streams `chunks`, then settles as success or as the given error note. */
function seam(chunks: string[], opts: { isError?: boolean; note?: string } = {}) {
  return async (
    _s: ClaudeSession,
    _p: string,
    onSessionId?: (id: string) => void,
    turnOpts?: { onText?: (t: string) => void }
  ): Promise<TurnResult> => {
    onSessionId?.('sid-1');
    for (const c of chunks) turnOpts?.onText?.(c);
    return opts.isError
      ? { sessionId: 'sid-1', result: null, isError: true, note: opts.note }
      : { sessionId: 'sid-1', result: { type: 'result', is_error: false }, isError: false };
  };
}

function ctxFor(dir: string, runTurn: ReturnType<typeof seam>) {
  const events: Array<{ event: string; data: unknown }> = [];
  const ctx: OrchestratorCtx = {
    projectsDir: dir, settingsPath: '', log,
    broadcast: (_id, event, data) => events.push({ event, data }),
    runners: { runTurn },
  };
  return { ctx, events };
}

/** A build parked at the ② gate, with the artifact askWithin's layer-2 snapshot requires. */
async function parkedAtSpecGate(dir: string): Promise<Task> {
  const task = await createTask(dir, { requirement: 'build me a thing', confirmMode: 'each_step' });
  task.phase = 'spec';
  task.status = 'awaiting_confirm';
  await saveTask(dir, task);
  const runDir = join(dir, `apps/builder/.runs/${task.taskId}`);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'SPEC.md'), '# Spec\n');
  return task;
}

/** A finished build — the surface the reported failure happened on (askTestWithin). */
async function doneBuild(dir: string): Promise<Task> {
  const task = await createTask(dir, { requirement: 'build me a thing', confirmMode: 'auto' });
  task.phase = 'test';
  task.status = 'done';
  await saveTask(dir, task);
  await mkdir(join(dir, `apps/builder/.runs/${task.taskId}`), { recursive: true });
  return task;
}

const transcript = async (dir: string, taskId: string): Promise<string> =>
  readFile(join(dir, `apps/builder/.runs/${taskId}/chat.jsonl`), 'utf8');

describe('a build ask is recorded, so a reopened task can finish it', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ask-transcript-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  test('askTestWithin (finished build): question + full answer land on disk, readable as lastAsk', async () => {
    const task = await doneBuild(dir);
    const { ctx } = ctxFor(dir, seam(['because ', 'of X ', 'and Y']));
    await askTestWithin(task, 'why did it pick that node?', ctx);

    // The whole answer, reassembled from the streamed chunks — not just the first one.
    assert.deepEqual(await readLastAsk(dir, task.taskId), {
      q: 'why did it pick that node?',
      a: 'because of X and Y',
      ok: true,
    });
  });

  test('askWithin (parked gate): same record', async () => {
    const task = await parkedAtSpecGate(dir);
    const { ctx } = ctxFor(dir, seam(['the spec says ', 'three nodes']));
    await askWithin(task, 'how many nodes?', ctx);

    assert.deepEqual(await readLastAsk(dir, task.taskId), {
      q: 'how many nodes?', a: 'the spec says three nodes', ok: true,
    });
  });

  test('a CUT-OFF answer is recorded WITH its ⚠ notice and ok:false — never as a finished one', async () => {
    const task = await doneBuild(dir);
    const { ctx } = ctxFor(dir, seam(['I will report back'], { isError: true, note: 'timed out after 8m' }));
    await askTestWithin(task, 'analyze this', ctx);

    const rec = await readLastAsk(dir, task.taskId);
    assert.equal(rec?.ok, false, 'a truncated answer must not be recovered as a success');
    assert.ok(rec!.a.startsWith('I will report back'), 'the partial text is kept');
    assert.ok(rec!.a.includes('stopped early'), 'and it says it stopped early');
    assert.ok(rec!.a.includes('timed out after 8m'), 'carrying the classified cause');
  });

  test('a turn that died with NO text records the canned message, ok:false', async () => {
    const task = await doneBuild(dir);
    const { ctx } = ctxFor(dir, seam([], { isError: true, note: 'quota' }));
    await askTestWithin(task, 'anything?', ctx);

    const rec = await readLastAsk(dir, task.taskId);
    assert.equal(rec?.ok, false);
    assert.match(rec!.a, /couldn't get an answer/);
    assert.match(rec!.a, /quota/);
  });

  test('readLastAsk returns the LAST exchange, and each ask appends rather than overwrites', async () => {
    const task = await doneBuild(dir);
    await askTestWithin(task, 'first question', ctxFor(dir, seam(['first answer'])).ctx);
    await askTestWithin(task, 'second question', ctxFor(dir, seam(['second answer'])).ctx);

    assert.equal((await transcript(dir, task.taskId)).trim().split('\n').length, 4, 'two pairs on disk');
    assert.deepEqual(await readLastAsk(dir, task.taskId), {
      q: 'second question', a: 'second answer', ok: true,
    });
  });

  test('no transcript → undefined (every build from before this shipped keeps the old behavior)', async () => {
    const task = await doneBuild(dir);
    assert.equal(await readLastAsk(dir, task.taskId), undefined);
  });

  // The hop the browser actually depends on: POST /ask → GET /api/tasks/:id carries `lastAsk`. Tested
  // through the ROUTE, because a record on disk that never reaches the wire fixes nothing.
  test('GET /api/tasks/:id carries lastAsk after an ask (and not before)', async () => {
    const task = await doneBuild(dir);
    const app = Fastify();
    await app.register(tasksRoutes, {
      projectsDir: dir, settingsPath: '', broadcast: () => {},
      runners: { runTurn: seam(['Đổi schedule sang cron ', 'mỗi phút để test ngay.']), runPython: async () => ({ code: 0, stdout: '', stderr: '' }) },
    } as TasksRoutesOptions);

    const before = (await app.inject({ method: 'GET', url: `/api/tasks/${task.taskId}` })).json();
    assert.equal(before.lastAsk, undefined, 'nothing asked yet → the field is absent, not an empty shell');

    const posted = await app.inject({
      method: 'POST', url: `/api/tasks/${task.taskId}/ask`, payload: { text: 'test ngay được không?' },
    });
    assert.equal(posted.statusCode, 200, posted.body);
    const deadline = Date.now() + 20_000;
    while (chatTurnBusy()) {
      if (Date.now() > deadline) assert.fail('timed out waiting for the ask turn');
      await new Promise((r) => setTimeout(r, 5));
    }

    const after = (await app.inject({ method: 'GET', url: `/api/tasks/${task.taskId}` })).json();
    assert.deepEqual(after.lastAsk, {
      q: 'test ngay được không?', a: 'Đổi schedule sang cron mỗi phút để test ngay.', ok: true,
    });
    await app.close();
  });

  test('a CONSULT keeps shipping its full `chat` and no duplicate lastAsk', async () => {
    const task = await createTask(dir, { requirement: 'chat', confirmMode: 'auto' });
    task.kind = 'consult';
    task.phase = 'test';
    task.status = 'done';
    await saveTask(dir, task);
    await mkdir(join(dir, `apps/builder/.runs/${task.taskId}`), { recursive: true });

    const app = Fastify();
    await app.register(tasksRoutes, {
      projectsDir: dir, settingsPath: '', broadcast: () => {},
      runners: { runTurn: seam(['an answer']), runPython: async () => ({ code: 0, stdout: '', stderr: '' }) },
    } as TasksRoutesOptions);
    await app.inject({ method: 'POST', url: `/api/tasks/${task.taskId}/ask`, payload: { text: 'a question' } });
    const deadline = Date.now() + 20_000;
    while (chatTurnBusy()) {
      if (Date.now() > deadline) assert.fail('timed out waiting for the consult turn');
      await new Promise((r) => setTimeout(r, 5));
    }

    const snap = (await app.inject({ method: 'GET', url: `/api/tasks/${task.taskId}` })).json();
    assert.ok(Array.isArray(snap.chat) && snap.chat.length >= 2, 'the consult transcript still rides the GET');
    assert.equal(snap.lastAsk, undefined, 'and lastAsk is NOT duplicated onto it');
    await app.close();
  });

  test('recording never breaks the ask: an unwritable transcript still answers + settles ok', async () => {
    const task = await doneBuild(dir);
    // Make chat.jsonl impossible to append to (a directory of that name) — appendChat must swallow it.
    await mkdir(join(dir, `apps/builder/.runs/${task.taskId}/chat.jsonl`), { recursive: true });
    const { ctx, events } = ctxFor(dir, seam(['an answer']));
    await askTestWithin(task, 'q', ctx);

    const done = events.filter((e) => e.event === 'ask:done').at(-1)?.data as { ok: boolean };
    assert.equal(done?.ok, true, 'the ask settles normally even though the transcript could not be written');
    assert.ok(events.some((e) => e.event === 'ask:answer'), 'and the answer still streamed');
    assert.equal(await readLastAsk(dir, task.taskId), undefined, 'no record, but the answer was delivered');
  });
});

/**
 * Spec 099 S1 / 101 §3.1 — GET /api/tasks/:id/chat, the read-back path.
 *
 * A build's Q&A lived only in localStorage, so any reason that cache went away took the conversation
 * with it while `chat.jsonl` sat on disk beside the run. This route is the way back. What the tests
 * below actually guard is the pair of things that make it safe rather than merely present: the hot
 * `GET /api/tasks/:id` must not gain a byte, and the tail cut must never land mid-exchange.
 */
describe('GET /api/tasks/:id/chat — read the transcript back without touching the hot snapshot', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'chat-route-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  async function serve() {
    const app = Fastify();
    await app.register(tasksRoutes, {
      projectsDir: dir, settingsPath: '', broadcast: () => {},
      runners: { runTurn: seam(['ok']), runPython: async () => ({ code: 0, stdout: '', stderr: '' }) },
    } as TasksRoutesOptions);
    return app;
  }

  /** Write `n` exchanges straight to the transcript — no turns, so the test stays fast and hermetic. */
  async function seedChat(taskId: string, n: number): Promise<void> {
    const runDir = join(dir, `apps/builder/.runs/${taskId}`);
    await mkdir(runDir, { recursive: true });
    const lines: string[] = [];
    for (let i = 1; i <= n; i++) {
      lines.push(JSON.stringify({ role: 'user', text: `q${i}`, at: i * 2 }));
      lines.push(JSON.stringify({ role: 'assistant', text: `a${i}`, at: i * 2 + 1 }));
    }
    await writeFile(join(runDir, 'chat.jsonl'), lines.join('\n') + '\n');
  }

  /**
   * The route writes the gap line FIRE-AND-FORGET (`void logEvent(...)`), so it answers before the
   * append has landed. Reading straight after `inject` is a race — it passed most runs and failed
   * roughly one in three, which is worse than failing always: a suite that is usually green teaches
   * people to re-run instead of to look.
   *
   * `gapsAfter` waits for the expected count; `settled` is for the opposite claim (nothing was
   * written), where waiting cannot prove anything and a bounded pause is the honest best.
   */
  const gapsAfter = async (taskId: string, want: number): Promise<Array<{ kind: string; detail?: string }>> => {
    const deadline = Date.now() + 2000;
    for (;;) {
      const gaps = (await timeline(taskId)).filter((e) => e.kind === 'history_gap');
      if (gaps.length >= want || Date.now() > deadline) return gaps;
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  /** Give a would-be write time to land, THEN look — the only honest way to assert "nothing happened". */
  const settled = async (taskId: string): Promise<Array<{ kind: string; detail?: string }>> => {
    await new Promise((r) => setTimeout(r, 150));
    return timeline(taskId);
  };

  const timeline = async (taskId: string): Promise<Array<{ kind: string; detail?: string }>> => {
    try {
      const raw = await readFile(join(dir, `apps/builder/.runs/${taskId}/events.jsonl`), 'utf8');
      return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  };

  test('returns every exchange for a build that has them, oldest first', async () => {
    const task = await doneBuild(dir);
    await seedChat(task.taskId, 3);
    const app = await serve();
    const res = await app.inject({ method: 'GET', url: `/api/tasks/${task.taskId}/chat` });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.chat.length, 6);
    assert.deepEqual(body.chat.map((l: { text: string }) => l.text), ['q1', 'a1', 'q2', 'a2', 'q3', 'a3']);
    assert.equal(body.dropped, undefined, 'nothing was cut, so nothing is claimed to be');
    await app.close();
  });

  test('a build with no transcript → an empty array, not a 404 or a null', async () => {
    const task = await doneBuild(dir);
    const app = await serve();
    const res = await app.inject({ method: 'GET', url: `/api/tasks/${task.taskId}/chat` });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { chat: [] }, 'the caller must be able to treat "never asked" as ordinary');
    await app.close();
  });

  test('the cap keeps the LAST 50 exchanges and reports the rest — cut on a pair boundary, never inside one', async () => {
    const task = await doneBuild(dir);
    await seedChat(task.taskId, 53); // the size of the run that prompted spec 099
    const app = await serve();
    const body = (await app.inject({ method: 'GET', url: `/api/tasks/${task.taskId}/chat` })).json();

    assert.equal(body.dropped, 3, 'the omission is stated, never silent');
    assert.equal(body.chat.length, 100);
    assert.equal(body.chat[0].role, 'user', 'THE POINT: a mid-pair cut would graft each answer onto the wrong question');
    assert.equal(body.chat[0].text, 'q4');
    assert.equal(body.chat.at(-1).text, 'a53');
    for (let i = 0; i < body.chat.length; i += 2) {
      assert.equal(body.chat[i].role, 'user', `line ${i} opens an exchange`);
      assert.equal(body.chat[i + 1].role, 'assistant', `line ${i + 1} answers it`);
    }
    await app.close();
  });

  test('REGRESSION: the hot GET /api/tasks/:id is unchanged — no `chat` on a build, no matter what is on disk', async () => {
    const task = await doneBuild(dir);
    await seedChat(task.taskId, 5);
    const app = await serve();
    const snap = (await app.inject({ method: 'GET', url: `/api/tasks/${task.taskId}` })).json();
    assert.equal(snap.chat, undefined, 'this snapshot is re-fetched on EVERY reconnect — it must stay light');
    await app.close();
  });

  test('?have= disagreeing with disk writes ONE history_gap line; agreeing writes nothing', async () => {
    const task = await doneBuild(dir);
    await seedChat(task.taskId, 5);
    const app = await serve();

    await app.inject({ method: 'GET', url: `/api/tasks/${task.taskId}/chat?have=5` });
    assert.deepEqual(await settled(task.taskId), [], 'the everyday case is SILENT — else the timeline is noise');

    await app.inject({ method: 'GET', url: `/api/tasks/${task.taskId}/chat?have=2` });
    const gaps = await gapsAfter(task.taskId, 1);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].detail, 'disk=5 browser=2', 'the number three wrong diagnoses were built for lack of');

    await app.inject({ method: 'GET', url: `/api/tasks/${task.taskId}/chat` }); // no ?have at all
    assert.equal((await settled(task.taskId)).filter((e) => e.kind === 'history_gap').length, 1, 'absent ?have infers nothing');
    await app.close();
  });

  test('a capped build goes SILENT once the browser holds all it can — no line on every reopen', async () => {
    // The gap is measured against what this response can SERVE, not against the whole file. With 53 on
    // disk and a 50-pair window the browser can never reach 53, so comparing to the file total would
    // find a permanent difference and write a line on EVERY reopen — burying the one occurrence that
    // actually means something under noise it can do nothing about.
    const task = await doneBuild(dir);
    await seedChat(task.taskId, 53);
    const app = await serve();

    await app.inject({ method: 'GET', url: `/api/tasks/${task.taskId}/chat?have=0` });   // first open
    let gaps = await gapsAfter(task.taskId, 1);
    assert.equal(gaps.length, 1, 'a browser holding nothing IS a gap worth recording');
    assert.equal(gaps[0].detail, 'disk=53 browser=0', 'and the detail still names the true disk total');

    // …the client restores the 50 it was given, then reopens. And reopens. And reopens.
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: 'GET', url: `/api/tasks/${task.taskId}/chat?have=50` });
    }
    gaps = (await settled(task.taskId)).filter((e) => e.kind === 'history_gap');
    assert.equal(gaps.length, 1, 'still ONE — the unreachable 3 are not a gap the browser can close');

    // A browser that really is behind the window still reports.
    await app.inject({ method: 'GET', url: `/api/tasks/${task.taskId}/chat?have=20` });
    gaps = await gapsAfter(task.taskId, 2);
    assert.equal(gaps.length, 2);
    assert.equal(gaps[1].detail, 'disk=53 browser=20');
    await app.close();
  });

  test('a junk ?have is ignored, not trusted — no line, no crash', async () => {
    const task = await doneBuild(dir);
    await seedChat(task.taskId, 5);
    const app = await serve();
    for (const q of ['have=abc', 'have=-1', 'have=', 'have=1e9']) {
      const res = await app.inject({ method: 'GET', url: `/api/tasks/${task.taskId}/chat?${q}` });
      assert.equal(res.statusCode, 200, q);
    }
    assert.deepEqual(await settled(task.taskId), [], 'an unparseable count is not a disagreement');
    await app.close();
  });

  /**
   * Spec 099 S2′ — the browser reporting that IT could not persist.
   *
   * It rides this route because the route already validates the id, already loads the task and already
   * writes to the timeline: no new write surface for a diagnostic. The awkward part is inherent — the
   * browser can only speak on its NEXT request, i.e. about a different build than the one that failed —
   * which is why the failing task id travels in the detail rather than being inferred from the URL.
   */
  const persistLines = async (taskId: string, want: number): Promise<Array<{ kind: string; detail?: string }>> => {
    const deadline = Date.now() + 2000;
    for (;;) {
      const rows = (await timeline(taskId)).filter((e) => e.kind === 'persist_failed');
      if (rows.length >= want || Date.now() > deadline) return rows;
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  test('a persist-failure flag writes ONE timeline line, naming the build that actually failed', async () => {
    const opened = await doneBuild(dir);
    await seedChat(opened.taskId, 1);
    const app = await serve();

    const res = await app.inject({
      method: 'GET',
      url: `/api/tasks/${opened.taskId}/chat?have=1&persistFailed=4194304&pfReason=quota&pfTask=1786505684286&pfAt=1755000000000`,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().chat.length, 2, 'the transcript still comes back — the flag is a passenger');

    const rows = await persistLines(opened.taskId, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].detail, 'reason=quota chars=4194304 task=1786505684286 at=1755000000000');
  });

  test('no flag ⇒ no line: the everyday request stays exactly as silent as before', async () => {
    const task = await doneBuild(dir);
    await seedChat(task.taskId, 1);
    const app = await serve();
    await app.inject({ method: 'GET', url: `/api/tasks/${task.taskId}/chat?have=1` });
    assert.deepEqual(
      (await settled(task.taskId)).filter((e) => e.kind === 'persist_failed'), [],
      'a healthy browser must not write to the timeline',
    );
    await app.close();
  });

  test('every reported field is validated, never echoed — a junk flag is dropped, not logged', async () => {
    const task = await doneBuild(dir);
    await seedChat(task.taskId, 1);
    const app = await serve();

    // A byte count that is not a plain number is not a report at all.
    for (const q of ['persistFailed=abc', 'persistFailed=-5', 'persistFailed=1e9', 'persistFailed=']) {
      const res = await app.inject({ method: 'GET', url: `/api/tasks/${task.taskId}/chat?${q}` });
      assert.equal(res.statusCode, 200, q);
    }
    assert.deepEqual(
      (await settled(task.taskId)).filter((e) => e.kind === 'persist_failed'), [],
      'nothing unparseable reaches the file',
    );

    // A well-formed count with hostile companions: the count is honoured, the companions are replaced
    // by fixed values rather than written through.
    await app.inject({
      method: 'GET',
      url: `/api/tasks/${task.taskId}/chat?persistFailed=99&pfReason=${encodeURIComponent('quota chars=0 task=../../etc')}&pfTask=${encodeURIComponent('../../escape')}&pfAt=nope`,
    });
    const rows = await persistLines(task.taskId, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].detail, 'reason=other chars=99 task=unknown', 'a bad reason/task/at is normalised away');
    await app.close();
  });

  test('CONFINEMENT: a traversal id is rejected before anything touches the filesystem', async () => {
    const app = await serve();
    for (const id of ['..%2F..%2FESCAPED', 'abc', '...']) {
      const res = await app.inject({ method: 'GET', url: `/api/tasks/${id}/chat?have=1` });
      assert.equal(res.statusCode, 400, `${id} must not reach loadTask or logEvent`);
    }
    const res = await app.inject({ method: 'GET', url: '/api/tasks/1786505684286/chat' });
    assert.equal(res.statusCode, 404, 'a well-shaped id for a task that does not exist is a 404, not a 400');
    await app.close();
  });
});

/**
 * Spec 100 S2 — a reset must not blind the model next to its own transcript.
 *
 * The reset path used to hand the new session the artifacts plus a note saying the history was gone,
 * while `chat.jsonl` sat complete in the same directory. The model then spent ~400k tokens re-reading
 * `main.yml` to recover what it had just been told to forget. These tests pin that the tail of the
 * conversation now travels with the reset, that it is BOUNDED, and — the regression that matters — that
 * an ordinary resuming turn's prompt is untouched.
 */
describe('a reset carries the tail of the conversation with it', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ask-carry-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  /** Write a transcript whose LAST answer carries `cost` — that is what the reset decision reads. */
  async function seedTranscript(
    taskId: string, pairs: Array<{ q: string; a: string }>, cost: Record<string, number>
  ): Promise<void> {
    const runDir = join(dir, `apps/builder/.runs/${taskId}`);
    await mkdir(runDir, { recursive: true });
    const lines: string[] = [];
    pairs.forEach(({ q, a }, i) => {
      lines.push(JSON.stringify({ role: 'user', text: q }));
      lines.push(JSON.stringify({ role: 'assistant', text: a, ...(i === pairs.length - 1 ? { cost } : {}) }));
    });
    await writeFile(join(runDir, 'chat.jsonl'), lines.join('\n') + '\n');
  }

  /**
   * Ask one question on a finished build that already holds a session.
   *
   * `resumed` is the session the turn asked to CONTINUE — `undefined` means it reset. The task's own
   * `sessionIds.askTest` cannot answer that: every turn stamps it with whatever session actually ran,
   * so it reads the same either way once the turn is over.
   */
  async function promptOf(
    task: Task, question = 'and now?'
  ): Promise<{ prompt: string; resumed: string | undefined }> {
    let prompt = '';
    let resumed: string | undefined;
    const runTurn = async (
      s: ClaudeSession, p: string, onSid?: (id: string) => void, o?: { onText?: (t: string) => void }
    ): Promise<TurnResult> => {
      prompt = p;
      resumed = s.resumeSessionId;
      onSid?.('fresh');
      o?.onText?.('ok');
      return { sessionId: 'fresh', isError: false, result: { type: 'result', is_error: false } } as unknown as TurnResult;
    };
    await askTestWithin(task, question, {
      projectsDir: dir, settingsPath: '', log, broadcast: () => {}, runners: { runTurn },
    } as unknown as OrchestratorCtx, []);
    return { prompt, resumed };
  }

  /** A cost big enough to reset: 1.2M carried by ONE request (spec 100 S0′ divides by `numTurns`). */
  const OVER = { inputTokens: 1, cacheReadTokens: 1_200_000, numTurns: 1 };
  const UNDER = { inputTokens: 1, cacheReadTokens: 20_000, numTurns: 1 };

  test('the last exchanges ride into the fresh session, oldest first, newest nearest the question', async () => {
    const task = await doneBuild(dir);
    task.sessionIds.askTest = 'old-session';
    await saveTask(dir, task);
    await seedTranscript(task.taskId, [
      { q: 'q-oldest', a: 'a-oldest' }, { q: 'q-mid', a: 'a-mid' },
      { q: 'q-newer', a: 'a-newer' }, { q: 'q-newest', a: 'a-newest' },
    ], OVER);

    const { prompt, resumed } = await promptOf(task);
    assert.equal(resumed, undefined, 'precondition: this turn DID reset');

    assert.match(prompt, /The last 3 exchange\(s\) of this conversation/);
    for (const s of ['q-mid', 'a-mid', 'q-newer', 'a-newer', 'q-newest', 'a-newest']) {
      assert.ok(prompt.includes(s), `${s} must travel with the reset`);
    }
    assert.ok(!prompt.includes('q-oldest'), 'the window is the TAIL — a 4th exchange is out of it');
    assert.match(prompt, /1 earlier exchange\(s\) are NOT included/, 'and the cut says so, inside the block');

    // Chronological, and the whole block sits ABOVE the question being asked.
    assert.ok(prompt.indexOf('q-mid') < prompt.indexOf('q-newest'), 'oldest first');
    assert.ok(prompt.indexOf('a-newest') < prompt.indexOf('and now?'), 'the carried tail precedes the question');
  });

  test('the note stops lying: it names what WAS carried instead of denying everything', async () => {
    const task = await doneBuild(dir);
    task.sessionIds.askTest = 'old-session';
    await saveTask(dir, task);
    await seedTranscript(task.taskId, [{ q: 'q1', a: 'a1' }], OVER);

    const { prompt } = await promptOf(task);
    assert.match(prompt, /The last 1 exchange\(s\) are reproduced above/);
    assert.match(prompt, /anything EARLIER in it is NOT visible to you/);
    assert.ok(
      !prompt.includes('earlier questions and answers in it are NOT visible to you'),
      'the blanket denial would contradict the transcript printed a few lines above it',
    );
  });

  test('REGRESSION: an ordinary resuming turn is untouched — no block, no note', async () => {
    const task = await doneBuild(dir);
    task.sessionIds.askTest = 'old-session';
    await saveTask(dir, task);
    await seedTranscript(task.taskId, [{ q: 'q1', a: 'a1' }, { q: 'q2', a: 'a2' }], UNDER);

    const { prompt, resumed } = await promptOf(task);
    assert.equal(resumed, 'old-session', 'precondition: this turn did NOT reset — it resumed');
    assert.ok(!prompt.includes('of this conversation'), 'no carry-over block on a turn that kept its history');
    assert.ok(!prompt.includes('restarted to keep its cost bounded'), 'and no reset note');
    assert.ok(!prompt.includes('a1'), 'the transcript is not smuggled in by another route either');
  });

  test('nothing recorded ⇒ nothing reset and nothing carried — a build from before the meter is untouched', async () => {
    const task = await doneBuild(dir);
    task.sessionIds.askTest = 'old-session';
    await saveTask(dir, task);
    // No `chat.jsonl` at all: the decision reads no cost, so it resumes exactly as it always did. This
    // is the every-build-from-before-the-meter case, and it must stay byte-identical to today.
    const { prompt, resumed } = await promptOf(task);
    assert.ok(!prompt.includes('of this conversation'), 'nothing to carry ⇒ no block');
    assert.equal(resumed, 'old-session', 'and with nothing recorded, nothing is reset');
  });
});

describe('recentExchanges — the pure carry-over, bounded and honest about it', () => {
  const pair = (q: string, a: string) => [
    { role: 'user' as const, text: q }, { role: 'assistant' as const, text: a },
  ];

  test('takes the tail, in order, and reports nothing when there is nothing to report', () => {
    const lines = [...pair('q1', 'a1'), ...pair('q2', 'a2'), ...pair('q3', 'a3'), ...pair('q4', 'a4')];
    const r = recentExchanges(lines, { maxPairs: 2 });
    assert.equal(r.pairs, 2);
    assert.equal(r.dropped, 2);
    assert.ok(r.block.indexOf('q3') < r.block.indexOf('q4'), 'chronological');
    assert.ok(!r.block.includes('q2'), 'outside the window');
    assert.match(r.block, /2 earlier exchange\(s\) are NOT included/);

    const all = recentExchanges(lines, { maxPairs: 9 });
    assert.equal(all.dropped, 0);
    assert.ok(!all.block.includes('NOT included'), 'nothing was cut ⇒ nothing is claimed');
  });

  test('empty / unpaired transcripts produce no block at all, never a half one', () => {
    assert.equal(recentExchanges([]).block, '');
    assert.equal(recentExchanges([]).pairs, 0);
    assert.equal(recentExchanges([{ role: 'user', text: 'q' }]).pairs, 0, 'a question with no answer is not an exchange');
    assert.equal(recentExchanges([{ role: 'assistant', text: 'a' }]).pairs, 0);
  });

  test('the byte budget drops the OLDEST first — the newest exchange is the one that must survive', () => {
    const big = 'x'.repeat(800);
    const lines = [...pair('q-old', big), ...pair('q-new', big)];
    const r = recentExchanges(lines, { maxPairs: 3, maxBytes: 1_000 });
    assert.equal(r.pairs, 1);
    assert.ok(r.block.includes('q-new'), 'the newest exchange is kept');
    assert.ok(!r.block.includes('q-old'), 'the older one is what the budget spends');
    assert.match(r.block, /1 earlier exchange\(s\) are NOT included/);
    assert.ok(Buffer.byteLength(r.block, 'utf8') <= 1_000 + 200, 'the block stays near its budget');
  });

  test('one oversized exchange is clipped rather than dropped, and the clip is stated', () => {
    const r = recentExchanges([...pair('q', 'y'.repeat(5_000))], { maxBytes: 500 });
    assert.equal(r.pairs, 1, 'something is better than nothing');
    assert.match(r.block, /cut short here by \d+ bytes/, 'a truncation nobody is told about is a lie');
    // The budget covers the Q/A text; the two header lines ride outside it (measured worst case: +178 B
    // on the shipped 4 KB budget). Pinned here so the overshoot stays a known constant, not a surprise.
    assert.ok(
      Buffer.byteLength(r.block, 'utf8') < 500 + 250,
      `block was ${Buffer.byteLength(r.block, 'utf8')}B — the header overhead grew`,
    );
    assert.ok(r.block.includes('y'.repeat(100)), 'the HEAD is kept — an answer opens with its conclusion');
  });

  test('the shipped budget is the one spec 098 can afford', () => {
    assert.equal(RESET_CARRYOVER_BYTES, 4 * 1024, '12KB would be ~3/4 of a seed 098 pressed under 16k chars');
    assert.equal(RESET_CARRYOVER_PAIRS, 3);
  });
});
