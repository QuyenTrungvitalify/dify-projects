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

export interface TurnResult {
  sessionId: string | null;
  result: ClaudeStreamEvent | null;
  isError: boolean;
  note?: string;
}

/**
 * @param onSessionId optional — invoked the moment the system/init event yields a session_id,
 *   so the caller can PERSIST it immediately (Lát 2: orchestrator writes sessionIds[phase] into
 *   task.json before the turn even ends, so Lát 3's separate /reply request can read it back).
 * @param opts.timeoutMs optional per-turn wall-clock budget (spec §I:826, AC #19). On elapse the
 *   child is force-killed and the turn resolves `{isError, note:"…timed out…"}` — the orchestrator
 *   maps that note to `status:error` (re-runnable, distinct from the still-failing gate). Phase ③'s
 *   5-pass validate→fix loop runs INSIDE this one turn, so a mid-loop timeout is `error`, not a gate.
 */
export async function runTurn(
  session: ClaudeSession,
  prompt: string,
  onSessionId?: (sessionId: string) => void,
  opts?: { timeoutMs?: number }
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
        session.forceKill();
        finish({
          sessionId: capturedSessionId,
          result: null,
          isError: true,
          note: `phase timed out after ${Math.round(opts.timeoutMs! / 1000)}s — retry or simplify`,
        });
      }, opts.timeoutMs);
    }

    session.onEvent = (event) => {
      // session_id from the system/init event (nexus :60-64)
      if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
        capturedSessionId = event.session_id as string;
        session.capturedSessionId = capturedSessionId;
        onSessionId?.(capturedSessionId);
      }
      // turn-end is the single terminal result event (nexus :148-157)
      if (event.type === 'result') {
        resultEvent = event;
        finish({ sessionId: capturedSessionId, result: event, isError: !!event.is_error });
      }
    };

    // process exited without a result event (nexus :208-220)
    session.onExit = (code) => {
      if (resultEvent) return;
      finish({
        sessionId: capturedSessionId,
        result: null,
        isError: true,
        note: `process exited code ${code} before a result event`,
      });
    };

    // Guard the spawn-failure path so the promise can never hang.
    void session.spawn(prompt).then((ok) => {
      if (!ok) {
        finish({
          sessionId: null,
          result: null,
          isError: true,
          note: 'failed to spawn claude process',
        });
      }
    });
  });
}
