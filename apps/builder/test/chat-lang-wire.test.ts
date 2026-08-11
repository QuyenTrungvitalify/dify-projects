/**
 * The chat-language setting, END TO END through the real HTTP routes — `chat_lang` on the wire →
 * `task.json` → the pin that actually reaches the model.
 *
 * The pure resolve chain is unit-tested in content-language.test.ts. What THIS file protects is the
 * plumbing between the composer and the prompt, which unit tests cannot see: a setting that normalizes
 * correctly but never reaches `runTurn`'s prompt is worth nothing, and that is exactly how the earlier
 * bug survived — the pin existed, it was simply computed from the wrong text. So every assertion here
 * reads the PROMPT STRING the faked turn received, not an intermediate value.
 *
 * Both doors are covered because they mint tasks separately: POST /api/tasks (build) and POST
 * /api/consult (chat). `noteUserLang`'s sticky stamp is checked on disk after a real /reply.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import Fastify from 'fastify';
import tasksRoutes, { type TasksRoutesOptions } from '../server/routes/tasks.js';
import { loadTask, type Task } from '../server/state/task.js';
import { PHASES } from '../server/lib/phases.js';
import { buildTurnBusy, chatTurnBusy, releaseTurn } from '../server/lib/lock.js';
import type { ClaudeSession } from '../server/lib/claude-session.js';
import type { TurnResult } from '../server/lib/turn-runner.js';
import type { ShellResult } from '../server/lib/shell.js';

/** The first line of each pin — enough to identify WHICH language was pinned, in the prompt itself. */
const JA_PIN = '【最重要・言語】';
const VI_PIN = '【QUAN TRỌNG — NGÔN NGỮ】';

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
}

async function build(dir: string): Promise<Harness> {
  const prompts: string[] = [];
  const runTurn = async (
    s: ClaudeSession,
    prompt: string,
    onSessionId?: (id: string) => void,
    turnOpts?: { onText?: (t: string) => void }
  ): Promise<TurnResult> => {
    prompts.push(prompt);
    onSessionId?.(`sid-${prompts.length}`);
    turnOpts?.onText?.('an answer');
    // A build turn must leave the artifact its verify demands, or the task errors before it parks.
    // (A consult has no phase artifact — the read below simply throws and is ignored.)
    try {
      const t = JSON.parse(await readFile(join(dir, `apps/builder/.runs/${s.taskId}/task.json`), 'utf8')) as Task;
      const phase = PHASES.find((p) => p.id === t.phase);
      if (phase?.kind === 'turn' && t.kind !== 'consult') {
        const abs = join(dir, phase.artifactRel(t));
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, t.phase === 'analyze' ? '{"seed":null,"summary":"ok"}' : '# SPEC\n');
      }
    } catch {
      /* nothing to write */
    }
    return { sessionId: `sid-${prompts.length}`, result: { type: 'result', is_error: false }, isError: false };
  };
  const runPython = async (): Promise<ShellResult> => ({ code: 0, stdout: '', stderr: '' });
  const app = Fastify();
  const routeOpts: TasksRoutesOptions = {
    projectsDir: dir,
    settingsPath: '',
    runners: { runTurn, runPython },
  };
  await app.register(tasksRoutes, routeOpts);
  return { app, prompts };
}

describe('chat language — wire → task.json → prompt', () => {
  let dir: string;
  /** Every task minted here, so a mid-test failure still frees the lane for the rest of the suite. */
  const minted: string[] = [];
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'chatlang-'));
    const skill = join(dir, '.claude', 'skills', 'dify-build');
    await mkdir(skill, { recursive: true });
    for (const n of ['analyze', 'spec', 'implement']) await writeFile(join(skill, `${n}.md`), `# ${n}\n{{REQUIREMENT}}\n`);
  });
  afterEach(async () => {
    for (const id of minted.splice(0)) releaseTurn(id);
    await rm(dir, { recursive: true, force: true });
  });

  test('POST /api/tasks with chat_lang:vi → the ① prompt opens with the Vietnamese pin', async () => {
    const h = await build(dir);
    const res = await h.app.inject({
      method: 'POST', url: '/api/tasks',
      // A Japanese requirement with a Vietnamese speaker driving: the case the whole feature exists for.
      payload: { requirement: 'メール要約ワークフローを作ってください', confirm_mode: 'each_step', chat_lang: 'vi' },
    });
    assert.equal(res.statusCode, 200, res.body);
    const task = res.json() as Task;
    minted.push(task.taskId);
    assert.equal(task.chatLang, 'vi', 'the wire value lands on the task');

    await waitFor(() => h.prompts.length > 0, 'the ① turn to be issued');
    assert.ok(h.prompts[0].startsWith(VI_PIN), 'the pin leads the prompt — not buried after the phase body');
    assert.ok(!h.prompts[0].includes(JA_PIN), 'the requirement being Japanese does NOT re-pin the chat');
    // The boundary: the requirement still reaches the turn intact, so the artifact stays Japanese.
    assert.ok(h.prompts[0].includes('メール要約ワークフロー'), 'the requirement is passed through untranslated');
    await waitFor(() => !buildTurnBusy(), 'the build lane to free');
    await h.app.close();
  });

  test('POST /api/tasks with no chat_lang → auto: a Japanese requirement still pins Japanese', async () => {
    const h = await build(dir);
    const res = await h.app.inject({
      method: 'POST', url: '/api/tasks',
      payload: { requirement: 'メール要約ワークフローを作ってください', confirm_mode: 'each_step' },
    });
    const task = res.json() as Task;
    minted.push(task.taskId);
    assert.equal(task.chatLang, 'auto', 'an absent field reads as auto (back-compat)');
    await waitFor(() => h.prompts.length > 0, 'the ① turn to be issued');
    assert.ok(h.prompts[0].startsWith(JA_PIN), 'unchanged behavior for anyone who never opts in');
    await waitFor(() => !buildTurnBusy(), 'the build lane to free');
    await h.app.close();
  });

  test('a Vietnamese /reply on a Japanese build re-pins Vietnamese and sticks on the task', async () => {
    const h = await build(dir);
    const res = await h.app.inject({
      method: 'POST', url: '/api/tasks',
      payload: { requirement: '目的とスコープを整理したい', confirm_mode: 'each_step' },
    });
    const task = res.json() as Task;
    minted.push(task.taskId);
    await waitFor(() => h.prompts.length > 0, 'the ① turn');
    await waitFor(() => !buildTurnBusy(), 'the ① gate to park');

    const reply = await h.app.inject({
      method: 'POST', url: `/api/tasks/${task.taskId}/reply`,
      payload: { text: 'giải thích lại giúp mình phần đầu vào' },
    });
    assert.equal(reply.statusCode, 200, reply.body);
    await waitFor(() => h.prompts.length > 1, 'the reply turn');
    assert.ok(h.prompts[1].startsWith(VI_PIN), 'the reply follows the MESSAGE, not the requirement');

    await waitFor(() => !buildTurnBusy(), 'the reply turn to settle');
    const onDisk = await loadTask(dir, task.taskId);
    // The sticky stamp is what carries this language into the next Continue, which brings no text of
    // its own. Without it the build would answer Vietnamese here and Japanese at the next phase.
    assert.equal(onDisk.langHint, 'vi', 'the message language is remembered on the task');
    await h.app.close();
  });

  test('POST /api/consult: an explicit setting beats the detected language of the message', async () => {
    const h = await build(dir);
    const res = await h.app.inject({
      method: 'POST', url: '/api/consult',
      payload: { text: 'mình muốn tự động tóm tắt email', chat_lang: 'ja' },
    });
    assert.equal(res.statusCode, 200, res.body);
    const consult = res.json() as Task;
    minted.push(consult.taskId);
    assert.equal(consult.chatLang, 'ja');
    await waitFor(() => h.prompts.length > 0 && !chatTurnBusy(), 'the consult turn');
    assert.ok(h.prompts[0].startsWith(JA_PIN), 'the setting wins — a Vietnamese message does not override it');
    await h.app.close();
  });

  test('POST /api/consult with an unknown chat_lang degrades to auto (never rejects)', async () => {
    const h = await build(dir);
    const res = await h.app.inject({
      method: 'POST', url: '/api/consult',
      payload: { text: 'mình muốn tự động tóm tắt email', chat_lang: 'klingon' },
    });
    assert.equal(res.statusCode, 200, res.body);
    const consult = res.json() as Task;
    minted.push(consult.taskId);
    assert.equal(consult.chatLang, 'auto');
    await waitFor(() => h.prompts.length > 0 && !chatTurnBusy(), 'the consult turn');
    assert.ok(h.prompts[0].startsWith(VI_PIN), 'auto then detects the Vietnamese message');
    await h.app.close();
  });
});
