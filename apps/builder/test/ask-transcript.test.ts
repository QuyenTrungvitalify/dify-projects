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
import { askWithin, askTestWithin, readLastAsk } from '../server/lib/ask.js';
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
