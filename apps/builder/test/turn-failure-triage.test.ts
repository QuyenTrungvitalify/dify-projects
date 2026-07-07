/**
 * Spec 045 — turn-failure triage: when the `claude` CLI dies without a result, the gate note names
 * the REAL cause (usage limit / not logged in / network / not installed) read from the session's
 * bounded stderr ring, instead of the bare "exited code 1" that cost a remote-diagnosis session in
 * the field (the chatwork_2 incident).
 *
 * Integration runs through runTurn with a MINIMAL fake session (runTurn only touches onEvent/onExit/
 * spawn/forceKill/stderrTail — the first turn-runner-level suite, no prior fakes to preserve).
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn, classifyTurnFailure } from '../server/lib/turn-runner.js';
import type { ClaudeSession } from '../server/lib/claude-session.js';

// ── D2 classifier table (pure) ──────────────────────────────────────────────────────────────────

describe('classifyTurnFailure — the class table (real-shaped CLI wordings)', () => {
  test('usage_limit: the field incident wording', () => {
    const r = classifyTurnFailure("You've hit your usage limit · resets 11:20pm (Asia/Tokyo)", 1);
    assert.equal(r.cls, 'usage_limit');
    assert.match(r.note, /^Claude CLI usage limit reached — builds cannot run until the limit resets\./);
    assert.ok(r.note.includes('resets 11:20pm'), 'the verbatim line (with the reset time) is attached');
  });

  test('auth: login/API-key wordings', () => {
    for (const line of ['Invalid API key · Please run /login', 'Error: not logged in']) {
      const r = classifyTurnFailure(line, 1);
      assert.equal(r.cls, 'auth', line);
      assert.match(r.note, /run `claude` in a terminal and log in/);
    }
  });

  test('network: DNS/conn errors', () => {
    const r = classifyTurnFailure('TypeError: fetch failed\ngetaddrinfo ENOTFOUND api.anthropic.com', 1);
    assert.equal(r.cls, 'network');
    assert.match(r.note, /Cannot reach the Anthropic API/);
  });

  test('fallback carries the stderr tail verbatim; empty stderr says (empty)', () => {
    const r = classifyTurnFailure('some new failure wording\nsecond line', 1);
    assert.equal(r.cls, 'unknown');
    assert.match(r.note, /^process exited code 1 before a result event — stderr tail: /);
    assert.ok(r.note.includes('second line'));
    assert.match(classifyTurnFailure('', 1).note, /stderr tail: \(empty\)$/);
  });

  test('precedence: a line with both limit and network words classifies usage_limit (first-match)', () => {
    const r = classifyTurnFailure('rate limit exceeded while contacting network endpoint', 1);
    assert.equal(r.cls, 'usage_limit');
  });

  test('spawn context names the probable cause', () => {
    const r = classifyTurnFailure('', null, 'spawn');
    assert.equal(r.cls, 'spawn');
    assert.match(r.note, /is the `claude` CLI installed\?/);
  });

  test('review #1: ENOENT arriving via the exit path (the real missing-binary flow) → spawn class', () => {
    const r = classifyTurnFailure('spawn claude ENOENT', null, 'exit');
    assert.equal(r.cls, 'spawn');
    assert.match(r.note, /is the `claude` CLI installed\?.*spawn claude ENOENT/);
  });

  test('review #3: embedded stderr is sanitized — no raw " | " (the FE split marker) or newlines', () => {
    const r = classifyTurnFailure('usage limit hit | resets soon\nnext line', 1);
    assert.equal(r.cls, 'usage_limit');
    assert.ok(!/[^⏐] \| /.test(r.note), `no raw pipe separator: ${r.note}`);
    assert.ok(!r.note.includes('\n'), 'no raw newline in the note');
  });
});

// ── review blocker #1: the session's 'error'(ENOENT) event must settle the turn immediately ─────

describe('ClaudeSession — a spawn ENOENT ("error" event, no "exit") fires onExit + feeds the ring', () => {
  test('attachTo + child "error" → onExit(null) called, stderrTail carries the message', async () => {
    const { ClaudeSession } = await import('../server/lib/claude-session.js');
    const { EventEmitter } = await import('node:events');
    const { PassThrough } = await import('node:stream');
    const log = { info() {}, warn() {}, error() {} } as never;
    const session = new ClaudeSession('t:enoent', {
      taskId: 't', workingDir: '/tmp', settingsPath: '', log,
    } as never);
    const child = new EventEmitter() as never as import('node:child_process').ChildProcess;
    Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), killed: false });
    session.attachTo(child);
    let exitCode: number | null | undefined;
    session.onExit = (c) => { exitCode = c; };
    (child as unknown as InstanceType<typeof EventEmitter>).emit('error', new Error('spawn claude ENOENT'));
    assert.equal(exitCode, null, 'onExit fired from the error path — the turn settles, no 10-min strand');
    assert.ok(session.stderrTail().includes('spawn claude ENOENT'), 'ring fed for the classifier');
  });
});

// ── integration through runTurn with a minimal fake session ─────────────────────────────────────

interface FakeSession {
  onEvent: ((e: unknown) => void) | null;
  onExit: ((code: number | null) => void) | null;
  capturedSessionId: string | null;
  spawnOk: boolean;
  tail: string;
  spawn(prompt: string): Promise<boolean>;
  forceKill(): void;
  stderrTail(): string;
}

function fakeSession(tail: string, spawnOk = true): FakeSession {
  return {
    onEvent: null,
    onExit: null,
    capturedSessionId: null,
    spawnOk,
    tail,
    async spawn() {
      return this.spawnOk;
    },
    forceKill() {},
    stderrTail() {
      return this.tail;
    },
  };
}

afterEach(() => {
  delete process.env.DIFY_CONSOLE_TOKEN;
  delete process.env.DIFY_CONSOLE_URL;
});

describe('runTurn — the note reads the RING, redacted (AC 2/2b/3/4)', () => {
  test('AC 2: exit-without-result + planted quota stderr → classified note with the planted line', async () => {
    const s = fakeSession("You've hit your usage limit · resets 11:20pm");
    const p = runTurn(s as unknown as ClaudeSession, 'prompt');
    await new Promise((r) => setImmediate(r)); // let spawn() resolve + handlers attach
    s.onExit!(1);
    const res = await p;
    assert.equal(res.isError, true);
    assert.match(res.note!, /^Claude CLI usage limit reached/);
    assert.ok(res.note!.includes('resets 11:20pm'));
  });

  test('AC 2b (anti-gaming): same exit code, EMPTY stderr → the fallback note (ring is read, not guessed)', async () => {
    const s = fakeSession('');
    const p = runTurn(s as unknown as ClaudeSession, 'prompt');
    await new Promise((r) => setImmediate(r));
    s.onExit!(1);
    const res = await p;
    assert.match(res.note!, /^process exited code 1 before a result event — stderr tail: \(empty\)$/);
  });

  test('AC 3: a planted secret in the stderr ring never reaches the note (redactSecrets)', async () => {
    process.env.DIFY_CONSOLE_URL = 'http://localhost/console/api';
    process.env.DIFY_CONSOLE_TOKEN = 'tok-supersecret-045';
    const s = fakeSession('quota exceeded for tok-supersecret-045 account');
    const p = runTurn(s as unknown as ClaudeSession, 'prompt');
    await new Promise((r) => setImmediate(r));
    s.onExit!(1);
    const res = await p;
    assert.ok(!res.note!.includes('tok-supersecret-045'), res.note);
    assert.match(res.note!, /^Claude CLI usage limit reached/);
  });

  test('AC 4: spawn failure names the probable cause; the TIMEOUT note is byte-unchanged', async () => {
    const sFail = fakeSession('zsh: command not found: claude', false);
    const resFail = await runTurn(sFail as unknown as ClaudeSession, 'prompt');
    assert.match(resFail.note!, /failed to spawn claude process — is the `claude` CLI installed\?/);

    const sHang = fakeSession(''); // spawns ok, never emits → timeout fires
    const resTimeout = await runTurn(sHang as unknown as ClaudeSession, 'prompt', undefined, { timeoutMs: 50 });
    assert.equal(resTimeout.note, 'phase timed out after 0s — retry or simplify'); // pre-045 text, untouched
  });
});
