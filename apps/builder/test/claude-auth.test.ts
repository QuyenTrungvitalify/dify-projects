/**
 * claude-auth — the parts that decide whether a sign-in can work at all.
 *
 * WHY THESE AND NOT OTHERS. The login is a conversation with a terminal program through a PTY, and
 * three things in it are pure decisions that a screenshot would never catch:
 *
 *   1. Finding the URL in output that has been through a terminal. The CLI prints it as an OSC-8
 *      hyperlink, so the URL appears TWICE, back to back, separated only by a BEL. `[ĐO]` The obvious
 *      implementation — strip the control characters, then look for a URL — matches `<url><url>]8;;`:
 *      a link the user cannot sign in with, on a screen that looks perfectly fine.
 *   2. What may be written into that PTY. The pasted code is the only caller-supplied bytes that reach
 *      a terminal anywhere in this app, so `sanitizeCode` is a security boundary, not a nicety.
 *   3. Never leaking the code back out. The failure line we quote is cut from the same captured output
 *      the code was echoed into.
 *
 * The fixtures are the CLI's REAL bytes, captured from `claude` 2.1.222 during the measurement that
 * shaped this module — not bytes invented to match the parser.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  LoginSession,
  awaitingCode,
  extractLoginUrl,
  ptyArgv,
  sanitizeCode,
  stripTerminal,
  unknownProbe,
  type LoginChild,
} from '../server/lib/claude-auth.js';

const URL_ =
  'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e' +
  '&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback' +
  '&scope=org%3Acreate_api_key+user%3Aprofile&code_challenge=u7Tz5ydT9xE0TDXfi5Kk9DWrzst1QaLE&code_challenge_method=S256' +
  '&state=Q1JBDsxjj0XWcV5RAnruukHkBIngIuQ7DuAUV14FnBg';

/** What the CLI actually writes through a PTY: OSC-8 wrapper, the URL twice, CRs, and the prompt. */
const PTY_OUTPUT =
  'Opening browser to sign in…\r\n' +
  `If the browser didn't open, visit: \x1b]8;;${URL_}\x07${URL_}\x1b]8;;\x07\r\n` +
  'Paste code here if prompted > ';

/** A fake login child: no process, no PTY — the session's own logic, driven byte by byte. */
function fakeChild(): LoginChild & { written: string[]; killed: boolean; emit(s: string): void; exit(code: number | null): void } {
  let onData: (c: string) => void = () => {};
  let onExit: (c: number | null) => void = () => {};
  return {
    written: [],
    killed: false,
    write(c) { this.written.push(c); },
    kill() { this.killed = true; },
    onData(fn) { onData = fn; },
    onExit(fn) { onExit = fn; },
    emit(s) { onData(s); },
    exit(code) { onExit(code); },
  };
}

describe('reading the CLI through a PTY', () => {
  test('the sign-in URL survives the OSC-8 hyperlink — one URL, not two glued together', () => {
    const url = extractLoginUrl(PTY_OUTPUT);
    assert.equal(url, URL_);
    // The bug this pins: a control-strip-then-match parser yields `<URL><URL>…`, a link to nowhere.
    assert.equal(url!.indexOf('https://'), url!.lastIndexOf('https://'));
    assert.match(url!, /state=Q1JBDsxjj0XWcV5RAnruukHkBIngIuQ7DuAUV14FnBg$/);
  });

  test('no URL in the output means no URL — not a partial guess', () => {
    assert.equal(extractLoginUrl('Opening browser to sign in…\r\n'), null);
    assert.equal(extractLoginUrl('visit: https://claude.com/settings/profile'), null); // not an authorize URL
  });

  test('the prompt is recognised through the terminal noise', () => {
    assert.equal(awaitingCode(PTY_OUTPUT), true);
    assert.equal(awaitingCode('Opening browser to sign in…'), false);
  });

  test('stripTerminal removes the wrapper and the control bytes, keeping the words', () => {
    const clean = stripTerminal(PTY_OUTPUT);
    assert.doesNotMatch(clean, /\x1b|\x07|\r/);
    assert.match(clean, /Paste code here if prompted/);
  });
});

describe('what may be written into the PTY', () => {
  test('a real-shaped code passes', () => {
    assert.equal(sanitizeCode('sk-ant-oat01_AbC-123#Q1JBDsxjj0XWcV5RAnruuk'), 'sk-ant-oat01_AbC-123#Q1JBDsxjj0XWcV5RAnruuk');
    assert.equal(sanitizeCode('  padded-code-value-1234  '), 'padded-code-value-1234'); // trimmed, not rejected
  });

  test('a second line can never ride in on the first — the whole point of the check', () => {
    assert.equal(sanitizeCode('good-code-1234\nlogout'), null);
    assert.equal(sanitizeCode('good-code-1234\r\nrm -rf /'), null);
    assert.equal(sanitizeCode('good-code-1234\x1b[A'), null);
    assert.equal(sanitizeCode('good-code-1234; echo hi'), null);
  });

  test('non-strings and absurd lengths are not codes', () => {
    assert.equal(sanitizeCode(undefined), null);
    assert.equal(sanitizeCode(42), null);
    assert.equal(sanitizeCode('short'), null);
    assert.equal(sanitizeCode('x'.repeat(513)), null);
  });
});

describe('a login attempt', () => {
  test('hands back the URL as soon as the CLI prints it, and writes the code as ONE line', async () => {
    const child = fakeChild();
    const s = new LoginSession(() => child);
    s.start();
    const wait = s.waitForUrl(1000);
    child.emit(PTY_OUTPUT);
    assert.equal(await wait, URL_);
    assert.equal(s.state, 'awaiting_code');

    const done = s.submitCode('a-good-looking-code-1234', 1000);
    child.exit(0);
    assert.equal(await done, 0);
    assert.deepEqual(child.written, ['a-good-looking-code-1234\n']);
    assert.equal(s.state, 'done');
  });

  test('a rejected code fails with the CLI\'s own sentence — and without the code in it', async () => {
    const child = fakeChild();
    const s = new LoginSession(() => child);
    s.start();
    const wait = s.waitForUrl(1000);
    child.emit(PTY_OUTPUT);
    await wait;

    const done = s.submitCode('wrong-code-abcdef', 1000);
    // The PTY echoes what was typed, so the code is IN the captured output when we go looking for the
    // failure line. That is exactly how a credential ends up in an error message shown on screen.
    child.emit('wrong-code-abcdef\r\nLogin failed: Request failed with status code 400\r\n');
    child.exit(1);
    assert.equal(await done, 1);
    assert.equal(s.state, 'failed');
    assert.equal(s.error, 'Login failed: Request failed with status code 400');
    assert.doesNotMatch(String(s.error), /wrong-code-abcdef/);
  });

  test('exiting 0 with no code submitted is SUCCESS — the callback landed, nobody pasted anything', async () => {
    // `[ĐO]` The ordinary path: the CLI opens its page against its own `localhost:<random>/callback`,
    // takes the redirect itself, and exits clean. Reading that as a failure — which this did at first,
    // because it only knew about the paste flow — turns every normal sign-in into an error on screen.
    const child = fakeChild();
    const s = new LoginSession(() => child);
    s.start();
    child.emit(PTY_OUTPUT);
    child.exit(0);
    assert.equal(s.state, 'done');
    assert.equal(s.error, null);
  });

  test('a child that dies before printing anything resolves the URL wait — it does not hang', async () => {
    const child = fakeChild();
    const s = new LoginSession(() => child);
    s.start();
    const wait = s.waitForUrl(1000);
    child.exit(127); // e.g. no `claude` on PATH
    assert.equal(await wait, null);
    assert.equal(s.state, 'failed');
  });

  test('cancelling kills the child — a walked-away-from sign-in leaves no PTY behind', () => {
    const child = fakeChild();
    const s = new LoginSession(() => child);
    s.start();
    s.cancel();
    assert.equal(child.killed, true);
  });

  test('a code submitted to a dead session is refused rather than written into nothing', async () => {
    const child = fakeChild();
    const s = new LoginSession(() => child);
    s.start();
    child.exit(1);
    assert.equal(await s.submitCode('a-good-looking-code-1234', 1000), null);
    assert.deepEqual(child.written, []);
  });
});

describe('the argv, and the default probe', () => {
  test('both supported platforms get a PTY, each in its own spelling', () => {
    // macOS/BSD: file first, then the command as argv. util-linux: -c string, file last.
    assert.deepEqual(ptyArgv('darwin'), { cmd: 'bash', args: ['-c', 'script -q /dev/null claude auth login < <(cat)'] });
    assert.deepEqual(ptyArgv('linux'), { cmd: 'bash', args: ['-c', "script -qec 'claude auth login' /dev/null < <(cat)"] });
  });

  test('stdin comes through `cat`, on every platform — the fix for the failure a shell never shows', () => {
    // `[ĐO]` Without this, the backend's socketpair stdin kills `script` at startup with
    // `tcgetattr/ioctl: Operation not supported on socket`, and the sign-in dies before printing a
    // URL. It reproduces ONLY when the parent is the server: run the same command by hand in a
    // terminal, or with a shell pipeline, and it works — which is exactly why it is pinned here.
    for (const os of ['darwin', 'linux']) {
      const { cmd, args } = ptyArgv(os);
      assert.equal(cmd, 'bash'); // `sh` cannot do the process substitution
      assert.match(args[1], /< <\(cat\)$/);
    }
  });

  test('an un-wired probe says "cannot say" — never "signed in"', async () => {
    const p = await unknownProbe();
    assert.equal(p.available, false);
    assert.equal(p.loggedIn, false);
  });
});
