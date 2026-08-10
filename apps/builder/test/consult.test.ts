/**
 * Spec 082 S2 — the consult mode (`kind:'consult'`), hermetic via the 013 D2 runner seam (a faked
 * runTurn — no real `claude` ever spawns). Pins:
 *   - POST /api/consult: validation, the minted terminal-born shape, the first turn's prompt
 *     (preamble + text, langPin-first), session persistence, ask:answer/ask:done relay;
 *   - follow-up /ask: routes by KIND, prompt is text-only (no re-seed — the 082 latency choice);
 *   - /reply carve-out (an error consult must never reach the ①②③④ report machinery);
 *   - self-heal: an error-status consult flips back to 'done' after one good message;
 *   - chat ∥ build at the ROUTE level: a held build lane never blocks consult creation;
 *   - listing: consults appear in listConsultTasks only — never in the tree or /api/active.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import tasksRoutes, { type TasksRoutesOptions } from '../server/routes/tasks.js';
import { loadTask, saveTask, type Task } from '../server/state/task.js';
import { CONSULT_PREAMBLE } from '../server/lib/ask.js';
import { acquireTurn, releaseTurn, chatTurnBusy } from '../server/lib/lock.js';
import { buildTree, listActiveTasks, listConsultTasks } from '../server/lib/artifacts.js';
import type { ClaudeSession } from '../server/lib/claude-session.js';
import type { TurnResult } from '../server/lib/turn-runner.js';
import type { ShellResult } from '../server/lib/shell.js';

async function waitFor(cond: () => boolean, what: string, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

interface Harness {
  app: Awaited<ReturnType<typeof Fastify>>;
  prompts: string[];
  events: Array<{ event: string; data: Record<string, unknown> }>;
}

async function build(dir: string, opts: { turnError?: boolean } = {}): Promise<Harness> {
  const prompts: string[] = [];
  const events: Harness['events'] = [];
  const runTurn = async (
    _s: ClaudeSession,
    prompt: string,
    onSessionId?: (id: string) => void,
    turnOpts?: { onText?: (t: string) => void }
  ): Promise<TurnResult> => {
    prompts.push(prompt);
    onSessionId?.(`sid-${prompts.length}`);
    if (opts.turnError) return { sessionId: `sid-${prompts.length}`, result: null, isError: true, note: 'boom' };
    turnOpts?.onText?.('an answer');
    return { sessionId: `sid-${prompts.length}`, result: { type: 'result', is_error: false }, isError: false };
  };
  // S3's machine checks (lintStandaloneYaml / checkRunnability) go through the SAME runner seam — a
  // clean-exit fake keeps them hermetic (no real python). checkRunnability's probe JSON-parse of ''
  // throws → the card reports "could not run preflight" (the honest-degrade path, itself worth pinning).
  const runPython = async (): Promise<ShellResult> => ({ code: 0, stdout: '', stderr: '' });
  const app = Fastify();
  const routeOpts: TasksRoutesOptions = {
    projectsDir: dir,
    settingsPath: '',
    broadcast: (_id, event, data) => events.push({ event, data: data as Record<string, unknown> }),
    runners: { runTurn, runPython },
  };
  await app.register(tasksRoutes, routeOpts);
  return { app, prompts, events };
}

describe('spec 082 — consult mode', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'consult-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('POST /api/consult: blank text → 400, no task minted', async () => {
    const h = await build(dir);
    const res = await h.app.inject({ method: 'POST', url: '/api/consult', payload: { text: '  ' } });
    assert.equal(res.statusCode, 400);
    await h.app.close();
  });

  test('first message: terminal-born task, preamble+text prompt, session persisted, SSE relayed', async () => {
    const h = await build(dir);
    const res = await h.app.inject({
      method: 'POST', url: '/api/consult', payload: { text: 'mình muốn tự động tóm tắt email' },
    });
    assert.equal(res.statusCode, 200, res.body);
    const task = res.json() as Task;
    assert.equal(task.kind, 'consult');
    assert.equal(task.status, 'done', 'born terminal-askable (082 §4.1)');
    assert.equal(task.project, null, 'nothing under projects/ is ever touched');

    await waitFor(() => !chatTurnBusy(), 'the consult turn to settle');
    assert.equal(h.prompts.length, 1);
    assert.ok(h.prompts[0].includes(CONSULT_PREAMBLE), 'fresh spawn folds the role preamble');
    assert.ok(h.prompts[0].includes('tóm tắt email'), 'and the user text');

    const onDisk = await loadTask(dir, task.taskId);
    assert.equal(onDisk.sessionIds.askTest, 'sid-1', 'chat continuity persisted to the askTest slot');
    assert.ok(h.events.some((e) => e.event === 'ask:answer'), 'answer streamed');
    assert.deepEqual(h.events.filter((e) => e.event === 'ask:done').at(-1)?.data, { ok: true });
    await h.app.close();
  });

  test('follow-up /ask routes by kind and does NOT re-seed (text-only prompt)', async () => {
    const h = await build(dir);
    const created = (await h.app.inject({ method: 'POST', url: '/api/consult', payload: { text: 'câu đầu tiên' } })).json() as Task;
    await waitFor(() => !chatTurnBusy(), 'first turn');

    const res = await h.app.inject({
      method: 'POST', url: `/api/tasks/${created.taskId}/ask`, payload: { text: 'hỏi tiếp nè' },
    });
    assert.equal(res.statusCode, 200, res.body);
    await waitFor(() => !chatTurnBusy(), 'second turn');

    assert.equal(h.prompts.length, 2);
    assert.ok(!h.prompts[1].includes(CONSULT_PREAMBLE), 'a resume never re-folds the seed (082 §4.2)');
    assert.ok(h.prompts[1].includes('hỏi tiếp nè'));
    await h.app.close();
  });

  test('a file attached to a FOLLOW-UP message reaches the turn prompt (it used to be saved and never mentioned)', async () => {
    const h = await build(dir);
    const created = (await h.app.inject({ method: 'POST', url: '/api/consult', payload: { text: 'câu đầu tiên' } })).json() as Task;
    await waitFor(() => !chatTurnBusy(), 'first turn');

    const png = `data:image/png;base64,${Buffer.alloc(16, 0x41).toString('base64')}`;
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/tasks/${created.taskId}/ask`,
      payload: { text: 'node nào đang đỏ?', files: [{ name: 'shot.png', mime: 'image/png', dataUrl: png }] },
    });
    assert.equal(res.statusCode, 200, res.body);
    await waitFor(() => !chatTurnBusy(), 'second turn');

    // The saved path must be NAMED in the prompt — without it the model answers "I only got text".
    assert.match(h.prompts[1], new RegExp(`Attached files:[^]*\\.runs/${created.taskId}/uploads/0_shot\\.png`));
    assert.deepEqual((res.json() as { uploads?: number[] }).uploads, [0], 'the FE gets the index to render it back');

    // and the transcript records it, so reopening the chat still shows the file
    const chat = (await readFile(join(dir, 'apps/builder/.runs', created.taskId, 'chat.jsonl'), 'utf8'))
      .split('\n').filter(Boolean).map((l) => JSON.parse(l) as { role: string; files?: unknown[] });
    const userLines = chat.filter((c) => c.role === 'user');
    assert.deepEqual(userLines[1].files, [{ name: 'shot.png', mime: 'image/png', idx: 0 }]);
    await h.app.close();
  });

  test('/reply on a consult → 409 even at status error (never reaches the ④ machinery)', async () => {
    const h = await build(dir);
    const created = (await h.app.inject({ method: 'POST', url: '/api/consult', payload: { text: 'x' } })).json() as Task;
    await waitFor(() => !chatTurnBusy(), 'first turn');

    const t = await loadTask(dir, created.taskId);
    t.status = 'error'; // the create-race loser / failSafe shape
    await saveTask(dir, t);

    const res = await h.app.inject({ method: 'POST', url: `/api/tasks/${created.taskId}/reply`, payload: { text: 'y' } });
    assert.equal(res.statusCode, 409, 'carve-out fires before the status===error /reply path');
    await h.app.close();
  });

  test('self-heal: an error-status consult chats fine and flips back to done', async () => {
    const h = await build(dir);
    const created = (await h.app.inject({ method: 'POST', url: '/api/consult', payload: { text: 'x' } })).json() as Task;
    await waitFor(() => !chatTurnBusy(), 'first turn');

    const t = await loadTask(dir, created.taskId);
    t.status = 'error';
    t.error = 'rejected — another chat is running';
    await saveTask(dir, t);

    const res = await h.app.inject({ method: 'POST', url: `/api/tasks/${created.taskId}/ask`, payload: { text: 'còn đó không?' } });
    assert.equal(res.statusCode, 200, '/ask routes a consult by KIND — any status');
    await waitFor(() => !chatTurnBusy(), 'heal turn');

    const healed = await loadTask(dir, created.taskId);
    assert.equal(healed.status, 'done', 'one good message heals the stray');
    assert.equal(healed.error, undefined);
    await h.app.close();
  });

  test('chat ∥ build: a held BUILD lane never blocks consult create or follow-up (082 core promise)', async () => {
    const h = await build(dir);
    assert.ok(acquireTurn('some-build', 'phase'));
    try {
      const res = await h.app.inject({ method: 'POST', url: '/api/consult', payload: { text: 'song song nhé' } });
      assert.equal(res.statusCode, 200, 'the build lane does not gate the chat lane');
      await waitFor(() => !chatTurnBusy(), 'consult turn settles while the build lane stays held');
    } finally {
      releaseTurn('some-build');
    }
    await h.app.close();
  });

  test('listing: consults live in listConsultTasks ONLY — not in the tree, not in /api/active', async () => {
    const h = await build(dir);
    const created = (await h.app.inject({ method: 'POST', url: '/api/consult', payload: { text: 'liệt kê tôi đúng chỗ' } })).json() as Task;
    await waitFor(() => !chatTurnBusy(), 'turn');

    const consults = await listConsultTasks(dir, Date.now());
    assert.deepEqual(consults.map((c) => c.id), [created.taskId]);

    const tree = await buildTree(dir, Date.now());
    const treeIds = JSON.stringify(tree);
    assert.ok(!treeIds.includes(created.taskId), 'never bucketed into the project tree (082)');

    const active = await listActiveTasks(dir, Date.now());
    assert.ok(!active.some((a) => a.id === created.taskId), 'born done → never "in progress"');
    await h.app.close();
  });

  test('084 follow-up — DELETE /api/tasks/:id removes the run dir; 404 for a missing task', async () => {
    const h = await build(dir);
    const created = (await h.app.inject({ method: 'POST', url: '/api/consult', payload: { text: 'xoá tôi đi' } })).json() as Task;
    await waitFor(() => !chatTurnBusy(), 'turn');
    assert.ok(existsSync(join(dir, `apps/builder/.runs/${created.taskId}`)), 'run dir exists before delete');

    const del = await h.app.inject({ method: 'DELETE', url: `/api/tasks/${created.taskId}` });
    assert.equal(del.statusCode, 200, del.body);
    assert.ok(!existsSync(join(dir, `apps/builder/.runs/${created.taskId}`)), 'run dir permanently removed');

    const missing = await h.app.inject({ method: 'DELETE', url: '/api/tasks/9999999999999' });
    assert.equal(missing.statusCode, 404, 'a missing task → 404');
    await h.app.close();
  });

  test('S3: a .yml attachment emits an ask:card BEFORE the turn and folds the facts into the prompt', async () => {
    const h = await build(dir);
    const yaml = Buffer.from('app:\n  mode: workflow\n', 'utf8').toString('base64');
    const res = await h.app.inject({
      method: 'POST', url: '/api/consult',
      payload: { text: 'file này ổn không?', files: [{ name: 'flow.yml', mime: '', dataUrl: `data:application/yaml;base64,${yaml}` }] },
    });
    assert.equal(res.statusCode, 200, res.body);
    await waitFor(() => !chatTurnBusy(), 'turn');

    const cards = h.events.filter((e) => e.event === 'ask:card');
    assert.equal(cards.length, 1, 'one card per attached yml');
    assert.equal(cards[0].data.file, 'flow.yml');
    assert.deepEqual(cards[0].data.lint, [], 'clean-exit fake linters → clean');
    assert.ok(String(cards[0].data.note ?? '').includes('could not run preflight'),
      'a tool that failed to run is REPORTED, never silently clean');

    const cardIdx = h.events.findIndex((e) => e.event === 'ask:card');
    const answerIdx = h.events.findIndex((e) => e.event === 'ask:answer');
    assert.ok(cardIdx < answerIdx, 'the card streams BEFORE the model says a word');
    assert.ok(h.prompts[0].includes('Machine check — flow.yml'), 'the same facts fold into the seed');
    await h.app.close();
  });

  test('transcript persists to the backend: GET returns the full chat, survives across messages', async () => {
    const h = await build(dir);
    const created = (await h.app.inject({ method: 'POST', url: '/api/consult', payload: { text: 'câu một' } })).json() as Task;
    await waitFor(() => !chatTurnBusy(), 'first turn');
    await h.app.inject({ method: 'POST', url: `/api/tasks/${created.taskId}/ask`, payload: { text: 'câu hai' } });
    await waitFor(() => !chatTurnBusy(), 'second turn');

    // the authoritative GET folds in the persisted transcript (independent of any client localStorage).
    const got = (await h.app.inject({ method: 'GET', url: `/api/tasks/${created.taskId}` })).json() as Task & { chat?: { role: string; text: string }[] };
    assert.ok(got.chat, 'a consult GET carries the transcript');
    assert.deepEqual(got.chat!.map((m) => m.role), ['user', 'assistant', 'user', 'assistant'], 'both exchanges, in order');
    assert.equal(got.chat![0].text, 'câu một');
    assert.equal(got.chat![1].text, 'an answer', 'the streamed answer was captured');
    assert.equal(got.chat![2].text, 'câu hai');

    // and the on-disk transcript is a real jsonl file under the run dir.
    const raw = await readFile(join(dir, `apps/builder/.runs/${created.taskId}/chat.jsonl`), 'utf8');
    assert.equal(raw.trim().split('\n').length, 4);
    await h.app.close();
  });

  test('a failed first turn still parks cleanly: canned answer, ask:done ok:false, task intact', async () => {
    const h = await build(dir, { turnError: true });
    const created = (await h.app.inject({ method: 'POST', url: '/api/consult', payload: { text: 'x' } })).json() as Task;
    await waitFor(() => !chatTurnBusy(), 'turn');

    assert.deepEqual(h.events.filter((e) => e.event === 'ask:done').at(-1)?.data, { ok: false });
    const answers = h.events.filter((e) => e.event === 'ask:answer');
    assert.ok(String(answers.at(-1)?.data.text).includes('boom'), 'the classified note self-describes');
    const onDisk = JSON.parse(await readFile(join(dir, `apps/builder/.runs/${created.taskId}/task.json`), 'utf8')) as Task;
    assert.equal(onDisk.status, 'done', 'a failed chat turn never flips the task');
    await h.app.close();
  });
});
