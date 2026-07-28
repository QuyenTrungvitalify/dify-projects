/**
 * Spec 014 D7 (closes 011 R14) — a force-killed `claude` child must leave NOTHING attached: no readline
 * `line` listener, no stderr `data` listener, no process `exit`/`error` listeners. Before the fix, every
 * killed turn leaked them → slow memory growth on a long-lived server.
 *
 * `claude` isn't on a CI box, so we drive a harmless long-lived `node` child through the `attachTo` test
 * seam (same listener wiring as a real spawn) and assert the counts drop to 0 after kill.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeSession, type SessionLogger } from '../server/lib/claude-session.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;

function session(): ClaudeSession {
  return new ClaudeSession('test', {
    taskId: 't', workingDir: process.cwd(), settingsPath: '/dev/null', log,
  });
}

/** A long-lived child with stdout+stderr pipes (so readline + the stderr listener attach to real streams). */
function longLivedChild() {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

describe('ClaudeSession listener cleanup on kill (011 R14 / 014 D7)', () => {
  test('forceKill detaches readline + stderr/exit/error listeners', () => {
    const child = longLivedChild();
    const sess = session();
    sess.attachTo(child);

    // Wired up after attach.
    assert.ok(child.listenerCount('exit') >= 1, 'exit listener attached');
    assert.ok(child.listenerCount('error') >= 1, 'error listener attached');
    assert.ok((child.stderr?.listenerCount('data') ?? 0) >= 1, 'stderr data listener attached');

    sess.forceKill();

    assert.equal(child.listenerCount('exit'), 0, 'exit listener removed');
    assert.equal(child.listenerCount('error'), 0, 'error listener removed');
    assert.equal(child.stderr?.listenerCount('data') ?? 0, 0, 'stderr data listener removed');

    child.kill('SIGKILL'); // belt-and-suspenders cleanup
  });

  test('kill (SIGTERM) likewise detaches, and a second kill is a harmless no-op (idempotent)', () => {
    const child = longLivedChild();
    const sess = session();
    sess.attachTo(child);
    sess.kill();
    assert.equal(child.listenerCount('exit'), 0);
    sess.kill(); // detachListeners is idempotent — must not throw
    assert.equal(child.listenerCount('error'), 0);
    child.kill('SIGKILL');
  });
});

/**
 * Cancel turn-lock leak: a turn killed from OUTSIDE runTurn (the `/cancel` route) must still settle the
 * runTurn promise, else the dispatch `finally` never releases the turn lock and `turnHolder` stays pinned
 * to the cancelled build (every subsequent task 409s "a turn is already running"). `forceKill` detaches
 * the real `exit` bridge, so it must fire `onExit` itself.
 */
describe('ClaudeSession resolves a pending turn on kill (cancel lock-leak fix)', () => {
  test('forceKill fires onExit once so an externally-killed turn settles', () => {
    const child = longLivedChild();
    const sess = session();
    sess.attachTo(child);

    let exits = 0;
    sess.onExit = () => {
      exits += 1;
    };

    sess.forceKill();
    assert.equal(exits, 1, 'onExit fired → runTurn settles → dispatch finally releases the turn lock');

    sess.forceKill(); // idempotent: a 2nd kill must NOT re-fire onExit
    assert.equal(exits, 1, 'onExit not re-fired on a second kill');

    child.kill('SIGKILL');
  });

  test('kill (SIGTERM) likewise fires onExit once', () => {
    const child = longLivedChild();
    const sess = session();
    sess.attachTo(child);
    let exits = 0;
    sess.onExit = () => {
      exits += 1;
    };
    sess.kill();
    assert.equal(exits, 1);
    child.kill('SIGKILL');
  });
});

/**
 * Spawn flags + child env — the load-bearing §F/§J guarantee (spec 009 Lát 5 Task 8 / 015 D1 / 033 D3):
 * the exact headless argv (resume BEFORE the prompt flags), NO `DIFY_*` or `CLAUDE_CODE*`/`CLAUDECODE`
 * in the child env (the token must never enter a generating turn), `BUILDER_TASK_ID` injected, and
 * `BUILDER_ASK_MODE=1` ONLY for an Ask turn. Driven through a real spawn: a fake `claude` first on
 * PATH records its argv + env (and drains stdin so the prompt write can't EPIPE), then exits.
 */
describe('ClaudeSession spawn flags + child env (§F/§J token strip / 033 D3)', () => {
  test('argv is the pinned headless flag set; DIFY_*/CLAUDE_CODE* stripped; BUILDER_TASK_ID set; ASK_MODE only for Ask', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-claude-'));
    writeFileSync(
      join(dir, 'claude'),
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args.txt"\nenv > "${dir}/env.txt"\ncat > /dev/null\nexit 0\n`,
      { mode: 0o755 }
    );
    const saved = {
      PATH: process.env.PATH,
      DIFY_CONSOLE_TOKEN: process.env.DIFY_CONSOLE_TOKEN,
      CLAUDE_CODE_X: process.env.CLAUDE_CODE_X,
      CLAUDECODE: process.env.CLAUDECODE,
    };
    process.env.PATH = `${dir}:${saved.PATH}`;
    process.env.DIFY_CONSOLE_TOKEN = 'tok-must-never-enter-a-turn';
    process.env.CLAUDE_CODE_X = 'nested-context';
    process.env.CLAUDECODE = '1';
    const runToExit = (sess: ClaudeSession, prompt: string): Promise<void> =>
      new Promise((resolve) => {
        sess.onExit = () => resolve();
        void sess.spawn(prompt);
      });
    try {
      // A phase /reply turn (resume set) — argv order matters: --resume precedes the prompt flags.
      const phase = new ClaudeSession('t', {
        taskId: '1750000000000', workingDir: dir, settingsPath: '/abs/headless-settings.json', log,
        resumeSessionId: 'sess-1',
      });
      await runToExit(phase, 'hello');
      const args = readFileSync(join(dir, 'args.txt'), 'utf8').trim().split('\n');
      assert.deepEqual(args, [
        '--resume', 'sess-1',
        '--output-format', 'stream-json', '--verbose',
        '--permission-mode', 'acceptEdits',
        '--settings', '/abs/headless-settings.json',
        '--setting-sources', 'local',
      ], 'the exact headless argv — no more, no fewer, resume first');
      const env1 = readFileSync(join(dir, 'env.txt'), 'utf8');
      assert.ok(!/^DIFY_/m.test(env1), 'no DIFY_* reaches a turn — the token-strip guarantee');
      assert.ok(!/^CLAUDE_CODE/m.test(env1) && !/^CLAUDECODE=/m.test(env1), 'no nested Claude Code context');
      assert.match(env1, /^BUILDER_TASK_ID=1750000000000$/m, 'the hook learns which run dir is "self"');
      assert.ok(!/^BUILDER_ASK_MODE=/m.test(env1), 'a phase turn NEVER sets ASK_MODE');

      // An Ask turn — same strip, plus the layer-1 write-deny switch.
      const ask = new ClaudeSession('t2', {
        taskId: '1750000000001', workingDir: dir, settingsPath: '/abs/headless-settings.json', log,
        askMode: true,
      });
      await runToExit(ask, 'question');
      const env2 = readFileSync(join(dir, 'env.txt'), 'utf8');
      assert.match(env2, /^BUILDER_ASK_MODE=1$/m, 'an Ask turn arms the hook write-deny');
      assert.ok(!/^DIFY_/m.test(env2), 'the strip holds for Ask turns too');
    } finally {
      process.env.PATH = saved.PATH;
      for (const [k, v] of Object.entries({ DIFY_CONSOLE_TOKEN: saved.DIFY_CONSOLE_TOKEN, CLAUDE_CODE_X: saved.CLAUDE_CODE_X, CLAUDECODE: saved.CLAUDECODE })) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
