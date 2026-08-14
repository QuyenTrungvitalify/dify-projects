// ask-recovery.ts — finish an ask bubble the browser stopped receiving, from the backend transcript.
//
// THE FAILURE THIS EXISTS FOR: send a question, open another task, come back. Switching tears the SSE
// stream down (store.openStream), `ask:answer` is deliberately excluded from the server's replay buffer
// (high-volume), and a fresh EventSource never sends `Last-Event-ID` — so every chunk that arrived while
// away is unrecoverable from the wire. The client then saw the turn was no longer running and closed the
// bubble with `applyAskDone({ ok: true })`: an empty "Answered". An answer that reads as if the model
// replied with nothing, when in fact it replied in full.
//
// The backend now records each build ask to `chat.jsonl` and GET /api/tasks/:id carries the last exchange
// as `lastAsk`. This module is the pure part: decide whether that exchange belongs to the open bubble,
// and what the settle's real outcome was.
//
// TWO RULES, both about not lying:
//  1. Graft ONLY on a question match. `lastAsk` is "the last ask on this task", not "the ask you are
//     looking at" — after a second question the transcript has moved on. Matching the question text is
//     what keeps a stale answer from being pasted under a different one.
//  2. NEVER SHORTEN. The live stream is ahead of the transcript while an answer is still arriving (the
//     transcript is written once, at settle), so the longer text is the more complete one. The outcome
//     (`ok`) is adopted regardless — it is authoritative in a way the client's optimistic `true` is not.
import type { LiveThreadItem } from '../store';

export interface LastAsk {
  q: string;
  a: string;
  ok: boolean;
}

/**
 * The bubble to work on: the last unsettled qa, or — with `includeSettled` — simply the last qa.
 *
 * `includeSettled` exists for the AUTO-RECONNECT case. There the settle runs before the authoritative
 * `GET /api/tasks/:id` has landed, so `lastAsk` is not available yet and the bubble closes empty; the
 * second pass runs once that snapshot arrives and fills in the text a now-settled bubble never received.
 * Filling text on a settled bubble is safe — it is the same question, and the question match still gates it.
 */
export function openAskIndex(items: LiveThreadItem[], includeSettled = false): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'qa' && (includeSettled || !it.done)) return i;
  }
  return -1;
}

/**
 * Given the thread and the server's last exchange, return the thread to show and the outcome to settle
 * with — or `null` when nothing can be said (no open bubble, no transcript, or it belongs to a different
 * question). `null` means "settle exactly as before", so every pre-transcript build keeps today's behavior.
 */
export function recoverOpenAsk(
  items: LiveThreadItem[],
  lastAsk: LastAsk | null | undefined,
  includeSettled = false
): { items: LiveThreadItem[]; ok: boolean } | null {
  if (!lastAsk) return null;
  const idx = openAskIndex(items, includeSettled);
  if (idx === -1) return null;
  const qa = items[idx] as LiveThreadItem & { kind: 'qa' };
  // The bubble's own `question` is the match key (store.ask writes it there alongside the user item).
  if (qa.question.trim() !== lastAsk.q.trim()) return null;
  if (lastAsk.a.length <= qa.answer.length) return { items, ok: lastAsk.ok }; // rule 2: keep the longer text
  const next = items.slice();
  next[idx] = { ...qa, answer: lastAsk.a };
  return { items: next, ok: lastAsk.ok };
}
