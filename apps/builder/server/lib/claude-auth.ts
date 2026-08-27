/**
 * claude-auth.ts — the Builder's own door to `claude` authentication, so a logged-out user never has
 * to find a terminal. Two things live here: a READ (is this machine logged in?) and a WRITE (run the
 * login and carry the pasted code back to it).
 *
 * `[ĐO 2026-08-27, claude 2.1.222]` Everything below is shaped by what the CLI actually does, measured:
 *
 *   1. `claude auth status --json` → `{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}`
 *      on stdout, exit **1**. Logged-out is a normal answer printed on a NON-ZERO exit, so the exit
 *      code is not the signal — the JSON is. Cost: ~0.4s, cheap enough to run before a turn.
 *   2. `claude auth login` offers TWO ways in, and it only PRINTS one of them. `[ĐO]` Recorded by
 *      shimming `open` and comparing: the URL it writes to stdout carries
 *      `redirect_uri=https://platform.claude.com/oauth/code/callback` (sign in, get a code, paste it
 *      back), while the URL it hands the OS to open carries `redirect_uri=http://localhost:<random>/
 *      callback` — same `code_challenge`, same `state`, one attempt. So there IS a callback, the CLI
 *      listens on it, and the ordinary path finishes with the user pasting NOTHING; the printed URL is
 *      the fallback for when no browser could be opened.
 *
 *      An earlier version of this file claimed the opposite ("no localhost callback"), because it read
 *      only what the CLI printed. That mistake shaped the whole surface: the modal waited for a code
 *      that, on any machine with a browser, never appears. Which is why completion is now observed by
 *      ASKING — {@link realProbe} — and not by watching for a paste.
 *   3. On the fallback path, the code has to reach a terminal: spawned with a plain pipe for stdin the
 *      CLI prints the URL, prints `Paste code here if prompted >`, and then **ignores stdin entirely**
 *      — it does not even exit on EOF (measured: still alive after an immediate `/dev/null` EOF).
 *   4. Given a real PTY it works: prompt appears, the written line is consumed, and a wrong code exits
 *      **1** with `Login failed: Request failed with status code 400`.
 *
 * So the login child needs a PTY, and we borrow one from `script(1)` rather than adding `node-pty`:
 * a native addon compiled on the user's machine is exactly the class of dependency spec 110 spent
 * seven slices removing from the user's path. `script` ships with macOS and with WSL2 — the two
 * platforms 110 §3 supports — and the two spellings differ, which {@link ptyArgv} owns.
 *
 *   5. `[ĐO]` One more thing had to be measured the hard way, because it only appears when the parent
 *      is a SERVER rather than a shell: BSD `script` reads its own stdin's terminal attributes at
 *      startup, and node's `stdio: 'pipe'` is a **socketpair** on macOS, not a pipe. Spawned straight
 *      from the backend it dies instantly with `script: tcgetattr/ioctl: Operation not supported on
 *      socket` — which a hand-run `printf … | script …` never reproduces, because a shell pipeline
 *      hands it a real pipe. Passing a FIFO does not fix it either (measured). What fixes it is
 *      letting a shell build the pipe: `script … < <(cat)`. `cat` is happy to read the socket, and
 *      what `script` gets is the pipe it insists on. `bash` (not `sh`) because the process
 *      substitution is a bashism — and because bash does not wait for it, the wrapper exits the
 *      moment the CLI does, which is what makes the no-`claude`-installed case fail in milliseconds
 *      instead of hanging until a timeout.
 *
 * SECRETS: the pasted code is a one-use credential. It is written to the child and never logged,
 * never stored, never echoed back in a response. The captured output is kept only to find the URL and
 * to quote the CLI's own last line on failure, and it is scrubbed of the code before it is used.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { platform } from 'node:os';

/** What {@link probeAuth} could establish about this machine.
 *  `available:false` means the QUESTION could not be answered (no `claude` on PATH, the probe crashed,
 *  unparseable output) — it is NOT the same as "logged out", and no caller may treat it as such. */
export interface AuthProbe {
  available: boolean;
  loggedIn: boolean;
  authMethod: string;
}

export type AuthProbeFn = () => Promise<AuthProbe>;

const PROBE_TIMEOUT_MS = 15_000;
/** How long the CLI gets to print its URL before we give up on the login child. */
export const URL_TIMEOUT_MS = 30_000;
/** How long the code exchange (a network round trip inside the CLI) gets. */
export const CODE_TIMEOUT_MS = 90_000;
/** A started-but-never-finished login is a live child holding a PTY; it does not get to live forever. */
export const SESSION_TTL_MS = 10 * 60_000;

/** Terminal noise the PTY adds: SGR/CSI sequences, OSC-8 hyperlink wrappers, BEL, CR. For human-facing
 *  text only — {@link extractLoginUrl} deliberately reads the RAW bytes instead, because the control
 *  characters are what separate the two copies of the URL an OSC-8 link writes (`ESC]8;;<url>BEL<url>
 *  ESC]8;;BEL`). `[ĐO]` A parser that strips control characters first and then looks for a URL matches
 *  `<url><url>]8;;` — a link to nowhere, on a screen that looks perfectly normal. */
export function stripTerminal(s: string): string {
  return s
    .replace(/\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/\r/g, '');
}

/** The sign-in URL, taken from the CLI's own output. Anchored on `oauth/authorize` rather than on the
 *  surrounding sentence ("If the browser didn't open, visit: …"), which is prose and may be reworded;
 *  the URL shape is the contract. Terminated by any control char or whitespace — see stripTerminal. */
export function extractLoginUrl(raw: string): string | null {
  const m = /https:\/\/[^\s\x00-\x1f\x7f"'<>]*oauth\/authorize[^\s\x00-\x1f\x7f"'<>]*/.exec(raw);
  return m ? m[0] : null;
}

/** The CLI is ready for the code. Matched loosely (case-insensitive, prompt punctuation optional)
 *  because this string is prose; the timeout is the real backstop if the wording ever changes. */
export function awaitingCode(raw: string): boolean {
  return /paste code here/i.test(stripTerminal(raw));
}

/**
 * A pasted OAuth code, or null if it is not one. The code rides into a PTY, so this is the one place
 * that decides what may reach a terminal: no control characters, no newlines, nothing that could act
 * as a second line of input. Length and charset are deliberately generous — the CLI, not us, is the
 * authority on whether a well-formed string is a VALID code.
 */
export function sanitizeCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const code = input.trim();
  if (code.length < 8 || code.length > 512) return null;
  return /^[A-Za-z0-9._~#\-/+=]+$/.test(code) ? code : null;
}

/** The answer when nobody wired a real probe in. Deliberately `available:false` ("cannot say") rather
 *  than a cheerful `loggedIn:true`: every caller already treats an unanswerable probe as "do not
 *  block", so an un-wired seam degrades to exactly the behaviour that existed before this feature —
 *  and can never invent a signed-in machine. The composition root (server/index.ts) passes the real
 *  one; tests that care inject their own. */
export const unknownProbe: AuthProbeFn = async () => ({ available: false, loggedIn: false, authMethod: 'unknown' });

/** `claude auth status --json`, read from stdout regardless of exit code (measurement 1). Anything we
 *  cannot parse — including no `claude` at all — answers `available:false`, never "logged out". */
export const realProbe: AuthProbeFn = () =>
  new Promise((resolve) => {
    execFile(
      'claude',
      ['auth', 'status', '--json'],
      { timeout: PROBE_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (_err, stdout) => {
        try {
          const j = JSON.parse(String(stdout || '').trim());
          if (j && typeof j.loggedIn === 'boolean') {
            resolve({
              available: true,
              loggedIn: j.loggedIn,
              authMethod: typeof j.authMethod === 'string' ? j.authMethod : 'unknown',
            });
            return;
          }
        } catch {
          /* not JSON — fall through to unavailable */
        }
        resolve({ available: false, loggedIn: false, authMethod: 'unknown' });
      }
    );
  });

/**
 * The login command, wrapped in a PTY. Two platform facts are baked in:
 *  - the `script` spelling differs — BSD/macOS takes `-q <file> <cmd> <args...>`, util-linux/WSL2
 *    takes the command as one string after `-c` with the file last;
 *  - `< <(cat)` gives `script` a real pipe for stdin (measurement 5 above), on both.
 * `[ĐO]` The macOS form is verified end to end against `claude` 2.1.222; the util-linux form is
 * NOT — it is the documented spelling, not a measured one, and the first WSL2 run is where it gets
 * confirmed. A fixed string either way: nothing a caller supplies is ever interpolated into it.
 */
export function ptyArgv(os: string = platform()): { cmd: string; args: string[] } {
  const login =
    os === 'linux'
      ? "script -qec 'claude auth login' /dev/null"
      : 'script -q /dev/null claude auth login';
  return { cmd: 'bash', args: ['-c', `${login} < <(cat)`] };
}

export interface LoginChild {
  write(chunk: string): void;
  kill(): void;
  onData(fn: (chunk: string) => void): void;
  onExit(fn: (code: number | null) => void): void;
}

/** The seam every test uses: the real one spawns a PTY, a fake one does not. */
export type SpawnLogin = () => LoginChild;

export const realSpawnLogin: SpawnLogin = () => {
  const { cmd, args } = ptyArgv();
  // `detached` puts the wrapper in its own process GROUP, which is the only way to end the whole
  // thing: killing the bash wrapper alone would orphan the `script` and the `claude` beneath it,
  // leaving a live PTY and a half-finished OAuth attempt behind every cancelled sign-in.
  const child: ChildProcess = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  return {
    write: (chunk) => child.stdin?.write(chunk),
    kill: () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM'); // the group is already gone (or never formed) — settle for the wrapper
      }
    },
    onData: (fn) => {
      child.stdout?.on('data', (b: Buffer) => fn(b.toString('utf8')));
      child.stderr?.on('data', (b: Buffer) => fn(b.toString('utf8')));
    },
    onExit: (fn) => {
      child.on('exit', (code) => fn(code));
      child.on('error', () => fn(null));
    },
  };
};

export type LoginState = 'starting' | 'awaiting_code' | 'exchanging' | 'done' | 'failed';

/**
 * One login attempt. Single-use: once it reaches `done`/`failed` it is discarded and a retry starts a
 * fresh one (the OAuth `state` + PKCE challenge are per-attempt, so reusing a session would hand the
 * user a URL whose code the CLI can no longer redeem).
 */
export class LoginSession {
  state: LoginState = 'starting';
  url: string | null = null;
  /** The CLI's own last line on failure — quoted verbatim so the truth shows even when we misread it. */
  error: string | null = null;

  private child: LoginChild | null = null;
  private out = '';
  private urlWaiters: Array<(u: string | null) => void> = [];
  private exitWaiters: Array<(code: number | null) => void> = [];
  private exited = false;
  private exitCode: number | null = null;
  private ttl: NodeJS.Timeout | null = null;
  private redact: string | null = null;

  constructor(private readonly spawnFn: SpawnLogin = realSpawnLogin) {}

  start(): void {
    this.child = this.spawnFn();
    this.child.onData((chunk) => {
      this.out += chunk;
      if (this.out.length > 256 * 1024) this.out = this.out.slice(-64 * 1024);
      if (!this.url) {
        const u = extractLoginUrl(this.out);
        if (u) {
          this.url = u;
          for (const w of this.urlWaiters.splice(0)) w(u);
        }
      }
      if (this.state === 'starting' && awaitingCode(this.out)) this.state = 'awaiting_code';
    });
    this.child.onExit((code) => {
      this.exited = true;
      this.exitCode = code;
      if (this.ttl) clearTimeout(this.ttl);
      // Exit 0 without a code ever being submitted is the NORMAL path: the browser hit the CLI's own
      // localhost callback and it signed in on its own. Calling that 'failed' would be backwards.
      if (this.state !== 'done') {
        if (code === 0) {
          this.state = 'done';
          this.error = null;
        } else {
          this.state = 'failed';
          this.error = this.lastLine();
        }
      }
      for (const w of this.urlWaiters.splice(0)) w(this.url);
      for (const w of this.exitWaiters.splice(0)) w(code);
    });
    this.ttl = setTimeout(() => this.cancel(), SESSION_TTL_MS);
    this.ttl.unref?.();
  }

  /** The URL, once the CLI has printed it. Resolves null if the child dies or takes too long first. */
  waitForUrl(timeoutMs = URL_TIMEOUT_MS): Promise<string | null> {
    if (this.url) return Promise.resolve(this.url);
    if (this.exited) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.urlWaiters = this.urlWaiters.filter((w) => w !== done);
        resolve(null);
      }, timeoutMs);
      const done = (u: string | null): void => {
        clearTimeout(timer);
        resolve(u);
      };
      this.urlWaiters.push(done);
    });
  }

  /**
   * Hand the CLI the code the user copied off the sign-in page and wait for it to finish.
   * Returns the exit code, or null if it never exited in time (the child is killed in that case).
   * The code is registered for redaction BEFORE it is written, so no later read of the captured
   * output — the failure line included — can carry it.
   */
  async submitCode(code: string, timeoutMs = CODE_TIMEOUT_MS): Promise<number | null> {
    if (!this.child || this.exited) return null;
    this.redact = code;
    this.state = 'exchanging';
    this.child.write(`${code}\n`);
    const exit = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        this.exitWaiters = this.exitWaiters.filter((w) => w !== done);
        this.cancel();
        resolve(null);
      }, timeoutMs);
      const done = (c: number | null): void => {
        clearTimeout(timer);
        resolve(c);
      };
      if (this.exited) done(this.exitCode);
      else this.exitWaiters.push(done);
    });
    if (exit === 0) {
      this.state = 'done';
      this.error = null;
    } else {
      this.state = 'failed';
      this.error = this.lastLine();
    }
    return exit;
  }

  cancel(): void {
    if (this.ttl) clearTimeout(this.ttl);
    this.child?.kill();
    if (this.state !== 'done') this.state = 'failed';
  }

  /** The CLI's last meaningful line, scrubbed of terminal noise, of the prompt itself, and of the code.
   *  Kept short: this is a quote for a human, not a log. */
  private lastLine(): string | null {
    let text = stripTerminal(this.out);
    if (this.redact) text = text.split(this.redact).join('«code»');
    const lines = text
      .split('\n')
      .map((l) => l.replace(/^.*Paste code here[^>]*>\s*/i, '').trim())
      .filter((l) => l.length > 0 && !/^https?:\/\//.test(l) && !/browser to sign in/i.test(l));
    const last = lines[lines.length - 1];
    return last ? last.slice(0, 200) : null;
  }
}
