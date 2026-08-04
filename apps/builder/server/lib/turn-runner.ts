/**
 * turn-runner — RE-IMPLEMENTED for spec 009 Lát 1.
 *
 * claude-session.ts deliberately lacks turn-end + session_id capture (in nexus those live
 * in task-spawning.ts). This is the ~20-line equivalent lifted from nexus
 * `task-spawning.ts:60-64` (session_id from system/init), `:148-157` (turn-end on result),
 * `:208-220` (process exited without a result).
 *
 * IMPORTANT: `isError` reflects ONLY the turn's terminal `result.is_error`. It is NOT phase
 * success — per spike findings §4/E5, a per-tool `tool_result.is_error=True` does not fail the
 * turn, and `result.is_error:false` ≠ a correct workflow. post-turn.ts is the authoritative check.
 */
import { ClaudeSession, type ClaudeStreamEvent } from './claude-session.js';
import { redactSecrets } from './dify-io.js';

export interface TurnResult {
  sessionId: string | null;
  result: ClaudeStreamEvent | null;
  isError: boolean;
  note?: string;
  /** Spec 045 (review #8): the machine-readable failure class behind `note` — future consumers
   *  (e.g. orchestrator's resume-fallback exclusion) can key on this instead of note-sniffing. */
  failureCls?: 'usage_limit' | 'auth' | 'network' | 'spawn' | 'unknown';
}

/**
 * Spec 045 D2 — classify a dead turn's stderr tail into an ACTIONABLE note. The field incident this
 * fixes: the `claude` CLI ran out of usage quota, but the gate showed only "exit 1 / artifact
 * missing" — the real cause lived in stderr and was discarded. First-match-wins, most-specific
 * first; a wrong class is cosmetic by design (it never changes status/outcome routing, and the
 * matched line is attached VERBATIM so the truth always shows).
 *
 * The EN note templates are WORDING-STABLE — web/src/lib/i18n.ts NOTE_JA keys off their prefixes
 * (the 030a/043 exact-frame mechanism); reword them only together with the JA frames + tests.
 */
export function classifyTurnFailure(
  stderrTail: string,
  code: number | null,
  ctx: 'exit' | 'spawn' = 'exit'
): { cls: NonNullable<TurnResult['failureCls']>; note: string } {
  // Review #3: embedded stderr must never smuggle the FE's `' | '` split marker (Chat.tsx errLines)
  // or raw newlines into the note — sanitize every fragment before embedding.
  const clean = (s: string): string => s.replace(/\s*\|\s*/g, ' ⏐ ').replace(/\s*\n\s*/g, ' ⏎ ').trim();
  const lines = stderrTail.split('\n').map((l) => l.trim()).filter(Boolean);
  const firstMatch = (re: RegExp): string | undefined => lines.find((l) => re.test(l));

  let m = firstMatch(/usage limit|session limit|rate.?limit|credit balance|quota|\b429\b|overloaded/i);
  if (m) {
    return {
      cls: 'usage_limit',
      note: `Claude CLI usage limit reached — builds cannot run until the limit resets. (${clean(m)})`,
    };
  }
  m = firstMatch(/logged in|log.?in\b|authentication|unauthorized|\b401\b|invalid api key|oauth/i);
  if (m) {
    return {
      cls: 'auth',
      note: `Claude CLI is not authenticated on this machine — run \`claude\` in a terminal and log in. (${clean(m)})`,
    };
  }
  m = firstMatch(/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|network error/i);
  if (m) {
    return {
      cls: 'network',
      note: `Cannot reach the Anthropic API from this machine (network/proxy). (${clean(m)})`,
    };
  }
  const tail = clean(lines.slice(-2).join('\n')) || '(empty)';
  // Review blocker #1: a MISSING binary reaches here via the 'error'(ENOENT) event path — the ring
  // then carries node's `spawn claude ENOENT` message; classify it as the install case regardless
  // of ctx (the spawn-false branch only fires for sync argv edge cases).
  if (ctx === 'spawn' || firstMatch(/ENOENT|command not found|no such file/i)) {
    return {
      cls: 'spawn',
      note: `failed to spawn claude process — is the \`claude\` CLI installed? (stderr: ${tail})`,
    };
  }
  return {
    cls: 'unknown',
    note: `process exited code ${code} before a result event — stderr tail: ${tail}`,
  };
}

/**
 * @param onSessionId optional — invoked the moment the system/init event yields a session_id,
 *   so the caller can PERSIST it immediately (Lát 2: orchestrator writes sessionIds[phase] into
 *   task.json before the turn even ends, so Lát 3's separate /reply request can read it back).
 * @param opts.timeoutMs optional per-turn wall-clock budget (spec §I:826, AC #19). On elapse the
 *   child is force-killed and the turn resolves `{isError, note:"…timed out…"}` — the orchestrator
 *   maps that note to `status:error` (re-runnable, distinct from the still-failing gate). Phase ③'s
 *   5-pass validate→fix loop runs INSIDE this one turn, so a mid-loop timeout is `error`, not a gate.
 * @param opts.onText optional (Lát 4) — invoked with each assistant text fragment as the turn
 *   streams, so the orchestrator can `broadcast('phase:output', …)` to the SSE clients live. Pure
 *   forwarding: it never affects the turn outcome (post-turn.ts remains authoritative).
 * @param opts.onEvent optional (spec 062 S1) — invoked with EVERY raw stream event (before the
 *   text/result filtering below), so the orchestrator's per-attempt transcript recorder can extract
 *   the `tool_use`/`tool_result` blocks. Try/catch-wrapped here so a throwing recorder can NEVER break
 *   the turn; the SSE `onText` path stays byte-identical (AC #6).
 */
/** The note a wall-clock timeout stamps on its TurnResult. Exported alongside {@link isTimeoutNote} so a
 *  consumer (resolveImplementOutcome, spec 085) can tell a TIMEOUT — a possibly-salvageable interruption
 *  that may have left a valid artifact — apart from a hard spawn/exit failure, WITHOUT string-guessing that
 *  could silently drift from the mint below. */
export const timeoutNote = (ms: number): string =>
  `phase timed out after ${Math.round(ms / 1000)}s — retry or simplify`;
export const isTimeoutNote = (note: string | undefined): boolean => !!note && note.includes('timed out after');

export async function runTurn(
  session: ClaudeSession,
  prompt: string,
  onSessionId?: (sessionId: string) => void,
  opts?: { timeoutMs?: number; onText?: (text: string) => void; onEvent?: (event: ClaudeStreamEvent) => void }
): Promise<TurnResult> {
  return new Promise<TurnResult>((resolve) => {
    let capturedSessionId: string | null = null;
    let resultEvent: ClaudeStreamEvent | null = null;
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const finish = (r: TurnResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(r);
    };

    if (opts?.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        // Resolve FIRST (settled wins), THEN kill. forceKill now fires onExit(null) to unblock a turn
        // killed from outside runTurn (the /cancel route); doing it before this finish would clobber the
        // timeout note with the synthetic-exit note. This order preserves the note while still killing.
        finish({
          sessionId: capturedSessionId,
          result: null,
          isError: true,
          note: timeoutNote(opts.timeoutMs!),
        });
        session.forceKill();
      }, opts.timeoutMs);
    }

    session.onEvent = (event) => {
      // Spec 062 S1: hand the RAW event to the transcript recorder (tool_use/tool_result extraction).
      // Wrapped so a recorder throw can never break the turn; runs BEFORE the outcome-bearing logic.
      if (opts?.onEvent) {
        try {
          opts.onEvent(event);
        } catch {
          /* the transcript is best-effort — never let it affect the turn */
        }
      }
      // session_id from the system/init event (nexus :60-64)
      if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
        capturedSessionId = event.session_id as string;
        session.capturedSessionId = capturedSessionId;
        onSessionId?.(capturedSessionId);
      }
      // Assistant text fragments → forward live to the SSE relay (Lát 4). The stream-json
      // `assistant` event carries `message.content[] = [{type:'text', text}, …]`.
      if (opts?.onText && event.type === 'assistant') {
        const msg = event.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
        for (const block of msg?.content ?? []) {
          if (block?.type === 'text' && block.text) opts.onText(block.text);
        }
      }
      // turn-end is the single terminal result event (nexus :148-157)
      if (event.type === 'result') {
        resultEvent = event;
        finish({ sessionId: capturedSessionId, result: event, isError: !!event.is_error });
      }
    };

    // process exited without a result event (nexus :208-220). Spec 045 D3: classify the stderr
    // tail (redacted — D5 belt+braces; the turn env carries no DIFY_* anyway) into the note, so a
    // quota/auth/network death self-describes at the gate instead of the bare exit code.
    session.onExit = (code) => {
      if (resultEvent) return;
      const triage = classifyTurnFailure(redactSecrets(session.stderrTail?.() ?? ''), code, 'exit');
      finish({
        sessionId: capturedSessionId,
        result: null,
        isError: true,
        note: triage.note,
        failureCls: triage.cls,
      });
    };

    // Guard the spawn-failure path so the promise can never hang. (045 D3: same triage — an ENOENT
    // spawn usually means the CLI is not installed; stderr may still carry a shell-level hint.)
    void session.spawn(prompt).then((ok) => {
      if (!ok) {
        const triage = classifyTurnFailure(redactSecrets(session.stderrTail?.() ?? ''), null, 'spawn');
        finish({
          sessionId: null,
          result: null,
          isError: true,
          note: triage.note,
          failureCls: triage.cls,
        });
      }
    });
  });
}
