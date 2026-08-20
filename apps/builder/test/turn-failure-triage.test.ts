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
import { runTurn, classifyTurnFailure, classifyResultFailure } from '../server/lib/turn-runner.js';
import { resolveImplementOutcome } from '../server/lib/orchestrator.js';
import type { PostTurnDetail } from '../server/lib/post-turn.js';
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


/* ══════════════════════════════════════════════════════════════════════════════════════════════
   Spec 104 S3 — the OTHER death path.

   `classifyTurnFailure` only ever runs from `onExit`, which returns early once a terminal `result`
   event has arrived. Measured in the claude 2.1.222 binary: the terminal result has three variants,
   and the `success` one carries `is_error` alongside an `api_error_status`, while
   `error_during_execution` carries an `errors[]` list. A limit reported THAT way used to reach the
   gate with no explanation at all — same cause, two very different things told to the user.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

const resultEvent = (over: Record<string, unknown> = {}): never =>
  ({ type: 'result', subtype: 'success', is_error: true, ...over }) as never;

describe('classifyResultFailure — the result-event path (spec 104 S3)', () => {
  test('api_error_status 429 → the SAME usage_limit note the exit path produces', () => {
    const r = classifyResultFailure(resultEvent({ api_error_status: 429 }), '');
    assert.equal(r?.cls, 'usage_limit');
    assert.match(r!.note, /^Claude CLI usage limit reached — builds cannot run until the limit resets\./);
  });

  test('errors[] carrying the limit wording is read, reset time and all', () => {
    const r = classifyResultFailure(
      resultEvent({ subtype: 'error_during_execution', errors: ["You've used 100% of your weekly limit · resets 11:20pm"] }),
      ''
    );
    assert.equal(r?.cls, 'usage_limit');
    assert.ok(r!.note.includes('resets 11:20pm'), 'the matched line is attached verbatim');
  });

  test('EVERY window name the CLI can print classifies — measured from 2.1.222, not guessed', () => {
    // `kNt` in the binary. Spec 045's table only ever matched the first of these; a Pro user burning
    // through the WEEKLY window — the everyday case — used to get no note at all.
    for (const window of ['session limit', 'weekly limit', 'Opus limit', 'Sonnet limit', 'Fable 5 limit', 'usage credit limit']) {
      const line = `You've used 100% of your ${window} · resets 11:20pm`;
      assert.equal(classifyResultFailure(resultEvent({ errors: [line] }), '')?.cls, 'usage_limit', window);
      // and the SAME line down the exit path, so one cause reads identically either way
      assert.equal(classifyTurnFailure(line, 1).cls, 'usage_limit', `${window} (exit path)`);
    }
  });

  test("the CLI's own blocked-state strings classify too", () => {
    assert.equal(classifyResultFailure(resultEvent({ errors: ['usage limit reached — check plan'] }), '')?.cls, 'usage_limit');
    assert.equal(classifyResultFailure(resultEvent({ errors: ['rate limited — wait and retry'] }), '')?.cls, 'usage_limit');
  });

  test('a 401 on the result event classifies auth, not usage_limit', () => {
    assert.equal(classifyResultFailure(resultEvent({ api_error_status: 401 }), '')?.cls, 'auth');
  });

  test('the stderr ring is still read on this path (both sources, one table)', () => {
    const r = classifyResultFailure(resultEvent(), 'fetch failed: ENOTFOUND api.anthropic.com');
    assert.equal(r?.cls, 'network');
  });

  test('NOTHING specific matched -> null, NOT a fallback note', () => {
    assert.equal(classifyResultFailure(resultEvent({ api_error_status: 500 }), ''), null);
    assert.equal(classifyResultFailure(resultEvent({ subtype: 'error_max_turns', errors: ['Reached maximum number of turns (5)'] }), ''), null);
  });

  /* The event a REAL `claude` 2.1.222 emitted, captured 2026-08-20 by driving it at a local stub that
     answers 429 (spec 104 §3's blocking test, run without an exhausted account and without a single
     packet leaving the machine). Not a hand-written shape — this is what actually came out. */
  const CAPTURED_429 = {
    type: 'result',
    subtype: 'success',
    is_error: true,
    result: "API Error: Request rejected (429) · You've used 100% of your weekly limit · resets 11:20pm",
    api_error_status: 429,
    terminal_reason: 'api_error',
    stop_reason: 'stop_sequence',
    num_turns: 1,
  } as never;

  test('THE REAL CAPTURED EVENT classifies, and the note carries the WHOLE sentence', () => {
    // stderr was EMPTY (0 bytes) in the captured run — the exit-path classifier had nothing to read,
    // which is exactly why S3 exists.
    const r = classifyResultFailure(CAPTURED_429, '');
    assert.equal(r?.cls, 'usage_limit');
    // Not the bare "429": the line a human can act on, including whatever the API said about resets.
    assert.ok(r!.note.includes('weekly limit'), r!.note);
    assert.ok(r!.note.includes('resets 11:20pm'), r!.note);
  });

  test('`result` is read ONLY under terminal_reason api_error — otherwise it is model prose', () => {
    const notAnApiError = { ...(CAPTURED_429 as object), terminal_reason: 'turn_setup_failed', api_error_status: undefined } as never;
    assert.equal(classifyResultFailure(notAnApiError, ''), null);
  });

  test("the MODEL'S OWN PROSE is never classified — only machine carriers are read", () => {
    const r = classifyResultFailure(
      resultEvent({ result: 'I documented what happens when the account hits its usage limit.' }),
      ''
    );
    assert.equal(r, null);
  });
});

describe('runTurn — an errored result event now self-describes (spec 104 S3)', () => {
  test('result{is_error, api_error_status:429} -> usage_limit note + failureCls + noteAdvisory', async () => {
    const s = fakeSession('');
    const p = runTurn(s as unknown as ClaudeSession, 'prompt');
    await new Promise((r) => setImmediate(r));
    s.onEvent!(resultEvent({ api_error_status: 429 }));
    const res = await p;
    assert.equal(res.isError, true);
    assert.equal(res.failureCls, 'usage_limit');
    assert.match(res.note!, /^Claude CLI usage limit reached/);
    assert.equal(res.noteAdvisory, true, 'marked explain-only so it cannot route');
  });

  test('a SUCCESSFUL result carrying limit words is never given a failure note', async () => {
    const s = fakeSession("You've hit your usage limit");
    const p = runTurn(s as unknown as ClaudeSession, 'prompt');
    await new Promise((r) => setImmediate(r));
    s.onEvent!(resultEvent({ is_error: false }));
    const res = await p;
    assert.equal(res.isError, false);
    assert.equal(res.note, undefined, 'a turn that SUCCEEDED must never wear a failure note');
    assert.equal(res.failureCls, undefined);
  });

  test('an errored result with no known signature is byte-for-byte the pre-S3 behaviour', async () => {
    const s = fakeSession('');
    const p = runTurn(s as unknown as ClaudeSession, 'prompt');
    await new Promise((r) => setImmediate(r));
    s.onEvent!(resultEvent({ api_error_status: 500 }));
    const res = await p;
    assert.equal(res.isError, true);
    assert.equal(res.note, undefined);
    assert.equal(res.noteAdvisory, undefined);
  });

  test('a planted secret never reaches the note on this path either (AC 3, result-side)', async () => {
    // redactSecrets scrubs KNOWN values (Dify creds + minted app-keys), not key-shaped patterns —
    // so plant what it actually knows, exactly as the exit-path AC 3 test above does.
    process.env.DIFY_CONSOLE_URL = 'http://localhost/console/api';
    process.env.DIFY_CONSOLE_TOKEN = 'tok-supersecret-104';
    const s = fakeSession('quota exceeded for tok-supersecret-104 account');
    const p = runTurn(s as unknown as ClaudeSession, 'prompt');
    await new Promise((r) => setImmediate(r));
    s.onEvent!(resultEvent());
    const res = await p;
    assert.equal(res.failureCls, 'usage_limit');
    assert.ok(!res.note!.includes('tok-supersecret-104'), res.note);
  });
});

/* ── The load-bearing guard: an EXPLANATION must not become a VERDICT ─────────────────────────
   `resolveImplementOutcome` turns any non-timeout note into a hard error, which discards the
   artifact and forces a full rebuild. Before S3 this path carried no note, so a limit that landed
   on a clean artifact still shipped. If attaching the explanation flipped that, spec 104 would bill
   a full rebuild to the user who just ran out of quota — the exact cost it exists to prevent. */
const cleanDetail = (): PostTurnDetail => ({
  artifactOk: true,
  yamlOk: true,
  lintCodes: { validate: 0, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 0 },
  idsOk: true,
  confinementBreaches: [],
  extraFiles: [],
});

describe('resolveImplementOutcome — an advisory note explains, it does not route (spec 104 S3)', () => {
  const LIMIT = 'Claude CLI usage limit reached — builds cannot run until the limit resets. (429)';

  test('advisory note + clean artifact -> success, exactly as before S3', () => {
    assert.equal(resolveImplementOutcome(cleanDetail(), LIMIT, true), 'success');
  });

  test('the SAME note from the exit path still hard-errors (unchanged, and correct — nothing was left)', () => {
    assert.equal(resolveImplementOutcome(cleanDetail(), LIMIT, false), 'error');
    assert.equal(resolveImplementOutcome(cleanDetail(), LIMIT), 'error', 'omitted flag = the old signature');
  });

  test('advisory does NOT whitewash a genuinely broken artifact', () => {
    assert.equal(resolveImplementOutcome({ ...cleanDetail(), artifactOk: false }, LIMIT, true), 'error');
    assert.equal(resolveImplementOutcome({ ...cleanDetail(), confinementBreaches: ['../escape.yml'] }, LIMIT, true), 'error');
  });

  test('advisory note + dirty lint -> still_failing (the human decides), not a hard error', () => {
    const dirty = { ...cleanDetail(), lintCodes: { validate: 1, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 0 } };
    assert.equal(resolveImplementOutcome(dirty, LIMIT, true), 'still_failing');
  });
});
