/**
 * The sign-in door, and the check that sends people to it.
 *
 * Two things are pinned here, and both are about what happens to a USER, not about HTTP:
 *
 *   1. The door itself never leaks the code and never lets two attempts race. The pasted code is a
 *      one-use credential; a response that echoed it back would put it in a place nobody thinks of as
 *      a place (a browser's network log, a screenshot of a bug report). Two concurrent attempts is the
 *      subtler one: each `claude auth login` mints its own PKCE challenge and `state`, so a second
 *      child silently invalidates the page the user is already signing in on, and the code they paste
 *      then fails for no reason they can see.
 *
 *   2. The pre-turn check spends the 409 EARLY — before a task is minted — and only on a definite
 *      "no". A signed-out machine that mints the task instead loses the user's prompt into a dead
 *      build, which is the bug that started this. And a probe that cannot answer (no `claude` on
 *      PATH, a crash) must let the turn through: a broken probe that can block builds is worse than
 *      no probe at all.
 *
 * Everything runs through the real Fastify routes with the subprocess seams replaced — no `claude`,
 * no PTY, no network.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import authRoutes from '../server/routes/auth.js';
import tasksRoutes, { type TasksRoutesOptions } from '../server/routes/tasks.js';
import { buildTurnBusy } from '../server/lib/lock.js';
import type { AuthProbe, LoginChild } from '../server/lib/claude-auth.js';

const URL_ = 'https://claude.com/cai/oauth/authorize?code=true&state=abc123';
const PTY_OUTPUT = `visit: \x1b]8;;${URL_}\x07${URL_}\x1b]8;;\x07\r\nPaste code here if prompted > `;

/** A scripted login child. `verdict` decides what the pretend CLI makes of the code it is given. */
function scripted(verdict: 'accept' | 'reject' = 'accept') {
  const state = { spawns: 0, written: [] as string[], killed: 0 };
  const spawnLogin = (): LoginChild => {
    state.spawns++;
    let onData: (c: string) => void = () => {};
    let onExit: (c: number | null) => void = () => {};
    setImmediate(() => onData(PTY_OUTPUT));
    return {
      write(c) {
        state.written.push(c);
        setImmediate(() => {
          if (verdict === 'reject') onData('Login failed: Request failed with status code 400\r\n');
          onExit(verdict === 'accept' ? 0 : 1);
        });
      },
      kill() { state.killed++; },
      onData(fn) { onData = fn; },
      onExit(fn) { onExit = fn; },
    };
  };
  return { state, spawnLogin };
}

const probeOf = (p: Partial<AuthProbe>) => async (): Promise<AuthProbe> =>
  ({ available: true, loggedIn: false, authMethod: 'none', ...p });

describe('the sign-in door', () => {
  test('a whole successful sign-in: page out, code in, and the code never comes back', async () => {
    const { state, spawnLogin } = scripted('accept');
    let signedIn = false;
    const app = Fastify();
    await app.register(authRoutes, {
      spawnLogin,
      probe: async () => ({ available: true, loggedIn: signedIn, authMethod: signedIn ? 'claudeai' : 'none' }),
    });

    const start = await app.inject({ method: 'POST', url: '/api/auth/login' });
    assert.equal(start.statusCode, 200);
    assert.equal(start.json().url, URL_);

    signedIn = true; // what the CLI's exit(0) means: the credential is on disk now
    const CODE = 'the-users-pasted-code-1234';
    const fin = await app.inject({ method: 'POST', url: '/api/auth/login/code', payload: { code: CODE } });
    assert.equal(fin.statusCode, 200);
    assert.equal(fin.json().ok, true);
    assert.deepEqual(state.written, [`${CODE}\n`]);
    assert.doesNotMatch(fin.payload, /the-users-pasted-code/); // never echoed, not even in an error
    await app.close();
  });

  test('a wrong code is a 200 with ok:false — an answer to act on, not a transport error', async () => {
    const { spawnLogin } = scripted('reject');
    const app = Fastify();
    await app.register(authRoutes, { spawnLogin, probe: probeOf({ loggedIn: false }) });
    await app.inject({ method: 'POST', url: '/api/auth/login' });
    const fin = await app.inject({ method: 'POST', url: '/api/auth/login/code', payload: { code: 'wrong-code-abcdef' } });
    assert.equal(fin.statusCode, 200);
    assert.equal(fin.json().ok, false);
    assert.match(String(fin.json().error), /Login failed/);
    assert.doesNotMatch(fin.payload, /wrong-code-abcdef/);
    await app.close();
  });

  test('a second start joins the live attempt instead of spawning a rival that invalidates its page', async () => {
    const { state, spawnLogin } = scripted('accept');
    const app = Fastify();
    await app.register(authRoutes, { spawnLogin, probe: probeOf({}) });
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/auth/login' }),
      app.inject({ method: 'POST', url: '/api/auth/login' }),
    ]);
    assert.equal(a.json().url, URL_);
    assert.equal(b.json().url, URL_);
    assert.equal(state.spawns, 1); // one PTY, one PKCE challenge, one page that still works
    await app.close();
  });

  test('a malformed code is refused at the door — nothing reaches the terminal', async () => {
    const { state, spawnLogin } = scripted('accept');
    const app = Fastify();
    await app.register(authRoutes, { spawnLogin, probe: probeOf({}) });
    await app.inject({ method: 'POST', url: '/api/auth/login' });
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login/code', payload: { code: 'good-code-1234\nlogout' } });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.json().reason, 'bad_code');
    assert.deepEqual(state.written, []);
    await app.close();
  });

  test('a code with no sign-in running is a 409, not a crash', async () => {
    const app = Fastify();
    await app.register(authRoutes, { spawnLogin: scripted().spawnLogin, probe: probeOf({}) });
    const r = await app.inject({ method: 'POST', url: '/api/auth/login/code', payload: { code: 'a-code-with-no-home' } });
    assert.equal(r.statusCode, 409);
    assert.equal(r.json().reason, 'no_login');
    await app.close();
  });

  test('no `claude` to sign in with is said as such — an admin problem, not a retry', async () => {
    const app = Fastify();
    await app.register(authRoutes, {
      // a child that dies immediately, the way `script` does when there is no `claude`
      spawnLogin: (): LoginChild => {
        let onExit: (c: number | null) => void = () => {};
        setImmediate(() => onExit(127));
        return { write() {}, kill() {}, onData() {}, onExit(fn) { onExit = fn; } };
      },
      probe: async () => ({ available: false, loggedIn: false, authMethod: 'unknown' }),
    });
    const r = await app.inject({ method: 'POST', url: '/api/auth/login' });
    assert.equal(r.statusCode, 500);
    assert.equal(r.json().reason, 'cli_missing');
    await app.close();
  });

  test('cancel kills the child — the modal closing does not leave a PTY behind', async () => {
    const { state, spawnLogin } = scripted('accept');
    const app = Fastify();
    await app.register(authRoutes, { spawnLogin, probe: probeOf({}) });
    await app.inject({ method: 'POST', url: '/api/auth/login' });
    await app.inject({ method: 'POST', url: '/api/auth/login/cancel' });
    assert.equal(state.killed, 1);
    await app.close();
  });

  test('status is passed through as the probe answers it', async () => {
    const app = Fastify();
    await app.register(authRoutes, { probe: probeOf({ loggedIn: true, authMethod: 'claudeai' }) });
    const r = await app.inject({ method: 'GET', url: '/api/auth/status' });
    assert.deepEqual(r.json(), { available: true, loggedIn: true, authMethod: 'claudeai' });
    await app.close();
  });
});

describe('the pre-turn check, at the two doors that spend a prompt', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof Fastify>>;

  async function mount(authProbe: TasksRoutesOptions['authProbe']): Promise<void> {
    dir = await mkdtemp(join(tmpdir(), 'auth-preflight-'));
    app = Fastify();
    await app.register(tasksRoutes, { projectsDir: dir, settingsPath: '', authProbe });
  }

  /** The dispatch runs in the background and holds the lock; let it settle so temp dirs unlink cleanly. */
  async function settled(): Promise<void> {
    for (let i = 0; i < 400 && buildTurnBusy(); i++) await new Promise((r) => setTimeout(r, 10));
  }

  beforeEach(() => { /* each test mounts its own probe */ });
  afterEach(async () => {
    await settled();
    await app?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test('signed out: a build is refused with `not_logged_in`, and NO task is minted', async () => {
    await mount(probeOf({ available: true, loggedIn: false }));
    const r = await app.inject({ method: 'POST', url: '/api/tasks', payload: { requirement: 'build me a thing' } });
    assert.equal(r.statusCode, 409);
    assert.equal(r.json().reason, 'not_logged_in');
    // The whole point: nothing was created, so the prompt is not stranded in a dead build. (The FE
    // restores the composer on a failed start — see App.tsx send()/onDone.)
    const active = await app.inject({ method: 'GET', url: '/api/active' });
    assert.equal(active.statusCode === 200 ? active.json().active.length : 0, 0);
  });

  test('signed out: an ask is refused the same way — the chat lane spends a prompt too', async () => {
    await mount(probeOf({ available: true, loggedIn: false }));
    const r = await app.inject({ method: 'POST', url: '/api/consult', payload: { text: 'what does this workflow do?' } });
    assert.equal(r.statusCode, 409);
    assert.equal(r.json().reason, 'not_logged_in');
  });

  test('every door that carries typed text is checked — /reply and /ask included', async () => {
    // These two do not mint anything, which is why they were nearly left out. They cost MORE, not less:
    // a /reply whose turn dies takes the parked build to `error`, so the user returns from signing in to
    // a build that needs a retry before it will accept the same message. The 409 arrives before any of
    // that — ahead of the 404 these would otherwise give for a task that does not exist, which is what
    // makes the assertion meaningful with no fixture on disk.
    await mount(probeOf({ available: true, loggedIn: false }));
    for (const url of ['/api/tasks/1784212050777/reply', '/api/tasks/1784212050777/ask']) {
      const r = await app.inject({ method: 'POST', url, payload: { text: 'please use a retry branch' } });
      assert.equal(r.statusCode, 409, url);
      assert.equal(r.json().reason, 'not_logged_in', url);
    }
  });

  test('signed in: those same two doors fall through to their normal answer', async () => {
    // The guard must not become a new way for a request to end. Signed in, a made-up id is a 404 again.
    await mount(probeOf({ available: true, loggedIn: true, authMethod: 'claudeai' }));
    for (const url of ['/api/tasks/1784212050777/reply', '/api/tasks/1784212050777/ask']) {
      const r = await app.inject({ method: 'POST', url, payload: { text: 'please use a retry branch' } });
      assert.equal(r.statusCode, 404, url);
    }
  });

  test('a probe that cannot answer does NOT block — a broken check may not stop a working machine', async () => {
    await mount(async () => ({ available: false, loggedIn: false, authMethod: 'unknown' }));
    const r = await app.inject({ method: 'POST', url: '/api/tasks', payload: { requirement: 'build me a thing' } });
    assert.notEqual(r.statusCode, 409);
  });

  test('signed in: the door is exactly as it was', async () => {
    await mount(probeOf({ available: true, loggedIn: true, authMethod: 'claudeai' }));
    const r = await app.inject({ method: 'POST', url: '/api/tasks', payload: { requirement: 'build me a thing' } });
    assert.notEqual(r.statusCode, 409);
  });
});
