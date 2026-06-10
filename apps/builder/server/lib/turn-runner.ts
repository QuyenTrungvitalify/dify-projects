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

export async function runTurn(session: ClaudeSession, prompt: string): Promise<TurnResult> {
  return new Promise<TurnResult>((resolve) => {
    let capturedSessionId: string | null = null;
    let resultEvent: ClaudeStreamEvent | null = null;
    let settled = false;

    const finish = (r: TurnResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    session.onEvent = (event) => {
      // session_id from the system/init event (nexus :60-64)
      if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
        capturedSessionId = event.session_id as string;
        session.capturedSessionId = capturedSessionId;
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
