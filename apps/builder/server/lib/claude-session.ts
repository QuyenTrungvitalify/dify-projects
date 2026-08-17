/**
 * ClaudeSession — COPIED + STRIPPED from claude-nexus
 * (`src/server/lib/claude-session.ts`) for spec 009 Lát 1.
 *
 * KEPT verbatim from nexus:
 *   - spawn('claude', args, {cwd, env, stdio:['pipe','pipe','pipe']})
 *   - stdin-prompt write (plain text) + stdin.end()  (nexus :215/:217, rationale :91)
 *   - readline NDJSON parser → JSON.parse per line → onEvent, swallow non-JSON  (nexus :226-235)
 *   - CLAUDE_CODE* / CLAUDECODE env-clean loop  (nexus :127-133)
 *   - --resume <session_id> support (precedes the prompt) — kept for Lát 3 /reply, unused here
 *   - onExit, capturedSessionId, kill/forceKill/pid
 *
 * ADDED for model C (spike findings §5): --permission-mode acceptEdits,
 *   --settings <abs headless-settings.json>, --setting-sources local.
 *
 * STRIPPED (not needed here): multimodal/images, --input-format stream-json, --mcp-config,
 *   bundleHint final-cwd race block, SWARM_* and NEXUS_* env, dryRun,
 *   model/systemPrompt/appendSystemPrompt/allowedTools/maxTurns options.
 *
 * Note on `-p`: nexus omits `-p`/`--print`; in claude 2.1.156 `--output-format stream-json
 * --verbose` runs headless and completes without it (init+result emitted, exit 0 — verified
 * Lát 1 smoke test). The canonical `claude -p …` string in the spike doc is equivalent.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';

/** Minimal logger shape — a Fastify (pino) logger or a console-shim both satisfy it. */
export interface SessionLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface SessionOptions {
  taskId: string;
  /** cwd for the spawned `claude` (= DIFY_PROJECTS_DIR / repo root). */
  workingDir: string;
  /** ABSOLUTE path to apps/builder/headless-settings.json (cwd is the repo, so pass abs). */
  settingsPath: string;
  log: SessionLogger;
  /** --resume <session_id>; kept for Lát 3 in-phase /reply. Must precede the prompt. */
  resumeSessionId?: string;
  /** Spec 033 D3 layer 1: sets `BUILDER_ASK_MODE=1` on the child env so the PreToolUse permission
   *  hook (permission-gate.ts `decide()`) denies every Write/Edit/MultiEdit/NotebookEdit outright —
   *  an Ask turn may resume a phase session but must never mutate its artifact. */
  askMode?: boolean;
  /**
   * Spec 096 — `--model` for this spawn. An ALIAS (`opus` / `sonnet` / `haiku` / `fable`), not a
   * pinned id: the CLI documents an alias as "the latest model" of that family, so the alias keeps
   * meaning "newest available in THIS environment" with no version table for us to maintain and go
   * stale. Verified by real spawns under these exact flags — `opus`→claude-opus-5,
   * `sonnet`→claude-sonnet-5, `haiku`→claude-haiku-4-5-20251001, `fable`→claude-fable-5.
   *
   * Omitted ⇒ the flag is not passed and the CLI picks, which is what every run did before this: the
   * model was AMBIENT. Measured drift across three real builds (haiku+opus, haiku+opus, all-haiku)
   * with nothing in the repo choosing — `--setting-sources local` even excludes the operator's own
   * ~/.claude preference. `cost.ts` recorded which model ran but nothing selected it, so a
   * before/after campaign could credit a prompt change for a model change.
   */
  model?: string;
}

/**
 * The child `claude` argv, as a PURE function of the options (spec 096 extracted it out of `spawn` so
 * the flag set is assertable without creating a process — the ESM `child_process` binding cannot be
 * stubbed, and "does this spawn carry --model" is exactly the kind of thing that must be pinned).
 * Order matters in one place only: `--resume` must precede the prompt.
 */
export function buildSpawnArgs(o: SessionOptions): string[] {
  const args: string[] = [];

  // Resume must come before prompt.
  if (o.resumeSessionId) args.push('--resume', o.resumeSessionId);

  // stdin carries the prompt, so special characters (a prompt starting with "---") are never read as
  // CLI flags.
  args.push('--output-format', 'stream-json', '--verbose');

  // Spec 096 — pin the model for this turn (see SessionOptions.model). ONLY when asked: with no value
  // the flag is absent and the argv is byte-identical to every pre-096 spawn, so a task created before
  // this shipped keeps running exactly as it did.
  if (o.model) args.push('--model', o.model);

  // Model C spawn flags (spike findings §5): broad-allow acceptEdits + candidate settings file +
  // local-only layer (excludes host ~/.claude AND the repo's project .claude layer, incl. its
  // permission-gate.js PreToolUse hook — findings §2/E4).
  args.push('--permission-mode', 'acceptEdits');
  args.push('--settings', o.settingsPath);
  args.push('--setting-sources', 'local');
  return args;
}

export interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  [key: string]: unknown;
}

export class ClaudeSession {
  readonly id: string;
  readonly taskId: string;
  readonly workingDir: string;
  readonly log: SessionLogger;
  /** The session this spawn will `--resume`, or undefined for a fresh one. Readable for the same reason
   *  `buildSpawnArgs` is exported: "does this spawn continue the old conversation or start a new one" is
   *  a decision worth pinning, and a caller that decides it must be able to prove what it decided. */
  readonly resumeSessionId: string | undefined;

  private process: ChildProcess | null = null;
  alive = false;
  capturedSessionId: string | null = null;

  // The stdout line reader + the bound stream listeners, kept so a kill can detach them (011 R14 / spec
  // 014 D7): a force-killed child must leave NOTHING attached, else each killed turn leaks a readline
  // interface + stderr/exit/error listeners → slow memory growth on a long-lived server.
  private rl: Interface | null = null;
  private onStderrData: ((data: Buffer) => void) | null = null;
  private onProcExit: ((code: number | null) => void) | null = null;
  private onProcError: ((err: Error) => void) | null = null;

  // Spec 045 D1 — a BOUNDED ring of recent stderr lines (reset per spawn). When the CLI dies without
  // a result event, the real cause (usage limit / not logged in / network) is on stderr and nowhere
  // else; turn-runner's classifyTurnFailure reads this tail to surface it as the gate note. Bounded
  // (24 lines / 2 KB) by construction — a chatty CLI cannot grow it; it is data, not a listener, so
  // the detach discipline (011 R14) is untouched.
  private stderrRing: string[] = [];

  // Callbacks
  onEvent: ((event: ClaudeStreamEvent) => void) | null = null;
  onExit: ((code: number | null) => void) | null = null;

  constructor(
    id: string,
    private options: SessionOptions
  ) {
    this.id = id;
    this.taskId = options.taskId;
    this.workingDir = options.workingDir;
    this.log = options.log;
    this.resumeSessionId = options.resumeSessionId;
  }

  /** Spec 045 D1 — the recent stderr tail (joined lines; '' when the CLI wrote nothing). */
  stderrTail(): string {
    return this.stderrRing.join('\n');
  }

  async spawn(prompt: string): Promise<boolean> {
    this.stderrRing = []; // 045 D1: per-spawn reset — the tail always belongs to THIS turn
    const args = buildSpawnArgs(this.options);

    // Clean env — remove ALL Claude Code env vars to prevent nested-session issues, AND every
    // `DIFY_*` var (esp. DIFY_CONSOLE_TOKEN / DIFY_CONSOLE_URL / DIFY_API_KEY). Dify I/O is
    // backend-owned: the token enters ONLY the backend's own `sync.py` subprocess env (dify-io.ts),
    // NEVER a claude turn (spec §F/§J / spec-009 Lát 5 Task 8). The backend passes `{...process.env}`
    // here, so if an operator exported the token (or a .env loaded it), this strip is the load-bearing
    // guarantee that no generating turn can read it — defense beyond "phases never run sync.py".
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith('CLAUDE_CODE') || key === 'CLAUDECODE' || key.startsWith('DIFY_')) {
        delete env[key];
      }
    }
    // Spec 015 D1: expose THIS turn's task id to the PreToolUse permission hook
    // (apps/builder/server/hooks/permission-gate.ts) so its sibling-`.runs/<other>/` write guard
    // knows which run dir is "self" (the turn's own `.runs/<taskId>/` stays writable; another task's
    // does not). Set AFTER the strip loop so it survives. Harmless when the hook isn't loaded.
    env.BUILDER_TASK_ID = this.taskId;
    // Spec 033 D3 layer 1: an Ask turn's structural write-deny — read by permission-gate.ts `main()`
    // the same way BUILDER_TASK_ID is. A normal phase/reply/judge turn never sets this, so the hook's
    // existing decide() branch is untouched byte-for-byte for every other turn.
    if (this.options.askMode) env.BUILDER_ASK_MODE = '1';

    try {
      this.process = spawn('claude', args, {
        cwd: this.workingDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.alive = true;

      // Plain-text prompt via stdin.
      this.process.stdin!.write(prompt);
      this.process.stdin!.end();
    } catch (err: unknown) {
      this.log.error(
        { sessionId: this.id, err: err instanceof Error ? err.message : String(err) },
        'Failed to spawn'
      );
      return false;
    }

    this.attachListeners();
    return true;
  }

  /**
   * Wire the stdout(readline)/stderr/exit/error listeners to `this.process`, keeping references so
   * {@link detachListeners} can remove them all on kill (011 R14). Note the natural-exit handler does
   * NOT detach (readline may still have buffered result lines to flush after `exit`); only an explicit
   * kill detaches — the leak the spec targets is the FORCE-KILLED child.
   */
  private attachListeners(): void {
    // Spec 045 D1 (review #5): reset HERE, not only in spawn() — the attachTo test seam calls
    // attachListeners without spawn(), and the ring must always belong to the current child.
    this.stderrRing = [];
    const p = this.process;
    if (!p) return;

    // Parse stdout (stream-json: one JSON object per line).
    this.rl = createInterface({ input: p.stdout! });
    this.rl.on('line', (line) => {
      try {
        const event: ClaudeStreamEvent = JSON.parse(line);
        this.onEvent?.(event);
      } catch {
        // Non-JSON output, ignore.
      }
    });

    this.onStderrData = (data: Buffer): void => {
      const text = data.toString().trim();
      if (text) {
        this.log.error({ sessionId: this.id, stderr: text }, 'Claude CLI stderr');
        // Spec 045 D1: keep the tail for failure triage (cap 24 lines / 2 KB, oldest dropped).
        this.stderrRing.push(...text.split('\n'));
        while (
          this.stderrRing.length > 24 ||
          (this.stderrRing.length > 1 && this.stderrRing.join('\n').length > 2048)
        ) {
          this.stderrRing.shift();
        }
      }
    };
    p.stderr!.on('data', this.onStderrData);

    this.onProcExit = (code: number | null): void => {
      this.alive = false;
      this.onExit?.(code);
    };
    p.on('exit', this.onProcExit);

    this.onProcError = (err: Error): void => {
      this.log.error({ sessionId: this.id, err: err.message }, 'Process error');
      this.alive = false;
      // Spec 045 (review blocker #1): a MISSING `claude` binary emits ONLY 'error' (ENOENT) — never
      // 'exit' — so without this the turn would strand until the 10-min timeout. Feed the message to
      // the triage ring and fire the exit path; runTurn's finish() is settled-guarded, so a later
      // real 'exit' (non-ENOENT error cases) cannot double-resolve.
      this.stderrRing.push(err.message);
      this.onExit?.(null);
    };
    p.on('error', this.onProcError);
  }

  /**
   * Remove every listener this session attached + close the readline interface (011 R14 / spec 014 D7).
   * Idempotent. Called from kill/forceKill so a killed child leaves nothing attached — no readline, no
   * stderr `data`, no `exit`/`error` listeners — preventing a per-turn listener/memory leak.
   */
  detachListeners(): void {
    if (this.rl) {
      this.rl.removeAllListeners('line');
      this.rl.close();
      this.rl = null;
    }
    const p = this.process;
    if (p) {
      if (this.onStderrData && p.stderr) p.stderr.removeListener('data', this.onStderrData);
      if (this.onProcExit) p.removeListener('exit', this.onProcExit);
      if (this.onProcError) p.removeListener('error', this.onProcError);
    }
    this.onStderrData = null;
    this.onProcExit = null;
    this.onProcError = null;
  }

  /** TEST SEAM (011 R14): attach the lifecycle listeners to an already-spawned child so the
   *  detach-on-kill behavior is unit-testable WITHOUT a real `claude` on PATH (a CI box has none). */
  attachTo(child: ChildProcess): void {
    this.process = child;
    this.alive = true;
    this.attachListeners();
  }

  /** Process PID (null if not spawned or already exited). */
  get pid(): number | null {
    return this.process?.pid ?? null;
  }

  /**
   * Resolve a pending turn after an explicit kill. `detachListeners` (called by kill/forceKill) removes
   * the process `exit` listener, so the real exit can no longer reach `onExit`. Without this, a turn
   * killed from OUTSIDE runTurn (the `/cancel` route) never settles → the dispatch `finally` never runs
   * → the turn-lock leaks (turnHolder stays pinned to the cancelled build, so every new task 409s with
   * "a turn is already running"). Fire `onExit` once with a null code so runTurn settles; null it so a
   * 2nd kill is a harmless no-op. The internal timeout path resolves the turn ITSELF before calling
   * forceKill, so this no-ops there (its `finish` already set `settled`).
   */
  private fireExit(): void {
    const cb = this.onExit;
    this.onExit = null;
    cb?.(null);
  }

  kill(): void {
    if (this.process) {
      try {
        this.process.kill('SIGTERM');
      } catch {
        // Process may already have exited.
      }
    }
    this.detachListeners(); // leave nothing attached on the killed child (011 R14)
    this.alive = false;
    this.fireExit(); // resolve a pending turn — the real `exit` was just detached (cancel lock-leak fix)
  }

  /** Force kill (SIGKILL). */
  forceKill(): void {
    if (this.process) {
      try {
        this.process.kill('SIGKILL');
      } catch {
        // Process may already have exited.
      }
    }
    this.detachListeners(); // leave nothing attached on the killed child (011 R14)
    this.alive = false;
    this.fireExit(); // resolve a pending turn — the real `exit` was just detached (cancel lock-leak fix)
  }
}
