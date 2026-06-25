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
