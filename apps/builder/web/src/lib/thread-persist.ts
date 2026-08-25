// thread-persist.ts — client-side persistence of the chat thread across a full page reload.
//
// WHY (spec 033 D6 stays intact): the thread is built CLIENT-side from SSE and the BACKEND keeps no
// transcript. A soft SSE reconnect already preserves the in-memory thread (onInit re-applies the gate
// without wiping thread.value), but a HARD reload wipes the JS context, and openTask rebuilds the thread
// from "requirement + current gate" only — so the Q&A conversation was lost. This module persists the
// thread to localStorage (client-only — does NOT reintroduce a backend transcript, so D6 holds) so a
// reload keeps the conversation. Cache-scoped: clearing the browser / another machine starts fresh.
//
// THE DECISIONS baked in here:
//  1. SLIM persist: KEEP `run.output` (the streamed phase prose — the Analyze overview / Spec / Implement
//     report a reopened build wants to re-read) but CAP it per run so one runaway log can't blow the ~5MB
//     quota; store NOTHING a reopen re-fetches anyway — the whole GET-only half of a gate snapshot
//     (`sseShapedSnapshot`) and the second copy of every question (`slimItem`, qa branch).
//     (Originally the run output was dropped entirely as "disposable" — but a hard reload then blanked every
//     phase's output, which reads as data loss. Overviews/specs are far under the cap; only a huge Implement
//     log is truncated, tail-kept so its final result survives.)
//  1b. And when even that does not fit, keep the longest PREFIX under a per-build cap
//     (`serializeThreadCapped`) — cutting the end, which disk can give back, never the start, which it
//     cannot. Duplication is removed first and cutting is the last resort, in that order, because on the
//     build that first hit the quota three quarters of the payload was duplication.
//  2. RECONCILE on reopen (`hydrateForReopen`): the ONE live gate always comes fresh + authoritative from
//     applyTask, because the build may have advanced/finished server-side while the tab was closed
//     (dispatch is fire-and-forget; auto-mode keeps running with no client). So DROP any unresolved gate
//     item from the restored thread (a stale one would render phantom live buttons for a phase already
//     passed) and finalize any still-`running` run. Keep user/qa + already-resolved gate history. Composes
//     with store.applyTask's #5 backward-scan fix, which then refreshes/pushes exactly one live gate.
//  3. Best-effort writes: debounced + deduped-by-serialized in store.ts; every access is try/catch-guarded
//     (private mode / quota / disabled storage never breaks the app — it just falls back to no-persist).
import type { LiveThreadItem } from '../store';
import type { WireTask } from '../types';

/** Cap a persisted run log so one runaway phase stream can't blow the ~5MB localStorage quota. Phase
 *  overviews/specs sit far under this; only a huge Implement log is truncated — TAIL kept, since a reopened
 *  build wants its final result/summary (which streams last), with a leading marker so the cut is visible. */
export const RUN_OUTPUT_CAP = 32_000; // chars (~32KB); LRU-20 builds × a few runs stays well under quota
export function capRunOutput(output: string): string {
  if (output.length <= RUN_OUTPUT_CAP) return output;
  return `[… ${output.length - RUN_OUTPUT_CAP} chars truncated …]\n` + output.slice(-RUN_OUTPUT_CAP);
}

/**
 * Fields `GET /api/tasks/:id` adds ON TOP of the snapshot SSE broadcasts — and therefore the fields a
 * persisted gate card must never carry (spec 113).
 *
 * THE RULE, and why it is shaped as "drop what GET adds" rather than "keep this list of fields": a gate
 * item stores a whole `WireTask`, and the card is rendered by handing that object wholesale to
 * `gateView` / `terminalFootActions` / `GateActions` — together ~27 fields. An allow-list of 27 names is
 * a thing that breaks silently (miss `specStale` and a reopened card shows the wrong badge, with nothing
 * to notice it). The GET-only set, by contrast, is small, server-owned, declared in ONE place
 * (`routes/tasks.ts`, the enrichment spread), and every field in it is re-fetched on reopen anyway —
 * `applyTask` refreshes the live gate from a fresh GET, so persisting these bytes buys nothing.
 *
 * What it cost before this existed: `runs` (added when a phase's reasoning was made to outlive the
 * browser) rode into EVERY gate snapshot at up to 48k chars, `lastAsk` at up to 88k, and a build that
 * reached 35 gates put ~2.2M characters of duplicated log into a ~2.6M-character quota — measured, on a
 * user's machine, as a thread that could no longer be saved at all.
 *
 * A name list still can't be trusted on its own (the next heavy field will have a different name), so
 * the mechanical half of this guard is the SIZE assertion in the tests, not this constant.
 */
const GET_ONLY_SNAPSHOT_FIELDS = [
  'artifactContents',
  'runs',
  'runsDropped',
  'runCosts',
  'lastAsk',
  'chat',
] as const;

function sseShapedSnapshot(snapshot: WireTask): WireTask {
  const out: Record<string, unknown> = { ...snapshot };
  for (const k of GET_ONLY_SNAPSHOT_FIELDS) delete out[k];
  return out as unknown as WireTask;
}

/**
 * One thread item, slimmed for storage. `prev` is the item before it in the SAME array — needed because
 * a `qa` is stored relative to the `user` bubble above it (see below).
 *
 *  - `run`: output CAPPED (tail kept).
 *  - `gate`: snapshot reduced to the shape SSE sends (above).
 *  - `user`: attachments reduced to `{name, mime, idx}` — the base64 `dataUrl` is STRIPPED (one pasted
 *    screenshot is megabytes) and an attachment with no server-side index is dropped entirely, since
 *    nothing could render it after a reload. `idx` addresses the saved copy at
 *    `GET /api/tasks/:id/uploads/:idx`, which is how history survives.
 *  - `qa`: `question` OMITTED when it is character-for-character the `user` bubble immediately above —
 *    which is every ordinary ask, because that is how the pair is pushed. Storing both meant every
 *    question was kept twice; on the build that broke the quota the second copy alone was 874k
 *    characters. `parseThread` rebuilds it, so nothing downstream can tell the difference.
 */
function slimItem(it: LiveThreadItem, prev: LiveThreadItem | undefined): unknown {
  if (it.kind === 'run') return { ...it, output: capRunOutput(it.output) };
  if (it.kind === 'gate') return { ...it, snapshot: sseShapedSnapshot(it.snapshot) };
  if (it.kind === 'user' && it.atts) {
    const atts = it.atts.filter((a) => a.idx !== undefined).map(({ name, mime, idx }) => ({ name, mime, idx }));
    return { ...it, atts: atts.length ? atts : undefined };
  }
  if (it.kind === 'qa' && prev?.kind === 'user' && prev.text === it.question) {
    const { question: _dropped, ...rest } = it;
    return rest;
  }
  return it;
}

/** Serialize the thread to a SLIM JSON string. Item-by-item so the capped variant below can measure each
 *  piece once instead of re-serializing the whole thread per candidate length. */
export function serializeThread(items: LiveThreadItem[]): string {
  return '[' + itemParts(items).join(',') + ']';
}

function itemParts(items: LiveThreadItem[]): string[] {
  return items.map((it, i) => JSON.stringify(slimItem(it, items[i - 1])));
}

/**
 * One build's share of storage. A count-based cap (20 threads) bounds the number of builds kept and says
 * nothing at all about their size — which is how a single build reached ~4M characters against a
 * ~2.6M-character quota and stopped being saved at all. This is the size half of that bound.
 *
 * The number is measured, not guessed: rebuilding the worst real thread on record and running it through
 * this serializer gives ~1.62M characters, and 1.4M is the largest cap that thread can actually MEET by
 * dropping exchanges the transcript can serve back (16 of them). A tighter cap does not store less — it
 * hits the floor below and stores 1.26M anyway, having thrown away three times as much history for the
 * privilege.
 */
export const PER_BUILD_CAP = 1_400_000; // chars (UTF-16 units — the unit browsers bill storage in)

/**
 * How many exchanges may be dropped from the tail before trimming gives up and hands the problem back.
 *
 * NOT a taste threshold — it is `GET /api/tasks/:id/chat`'s window (the last 50 exchanges) minus room
 * for the pair that is still in flight, because that window is exactly what a reopened build can get
 * back from disk. Dropping inside it is a cache eviction; dropping past it is data loss. When the cap
 * still isn't met at this point the caller frees space elsewhere (evicting OTHER builds) rather than
 * cutting deeper here.
 */
export const TRIM_MAX_PAIRS = 45;

/**
 * Serialize, and if the result exceeds `cap`, keep the longest PREFIX of the thread that fits.
 *
 * PREFIX — i.e. the tail is what goes — and that direction is the opposite of the intuitive one, so it
 * is worth stating why: the backend serves back the most RECENT exchanges. What only the browser holds
 * is the OLD end of a long conversation. Cutting the tail is therefore a cache eviction that
 * `backfillFromTranscript` undoes in the right order and without a marker (the missing block is exactly
 * the transcript's tail); cutting the head would be silent, permanent loss — local would already cover
 * everything the server can serve, so the backfill would conclude nothing is missing.
 *
 * The one exception rides along on purpose: an OPEN `qa` (and the `user` bubble it belongs to) is always
 * re-appended, however full the prefix is. The transcript records an exchange only once the turn ends,
 * so the in-flight question is the one thing on screen that is nowhere else — dropping it would make a
 * reload during a long ask lose the question itself.
 *
 * Returns the JSON plus how many exchanges were dropped, so the caller can tell "trimmed" from "fits".
 */
export function serializeThreadCapped(
  items: LiveThreadItem[],
  cap = PER_BUILD_CAP
): { json: string; droppedPairs: number } {
  const parts = itemParts(items);
  const assemble = (idx: number[]): string => '[' + idx.map((i) => parts[i]).join(',') + ']';
  const all = parts.map((_, i) => i);
  const whole = assemble(all);
  if (whole.length <= cap) return { json: whole, droppedPairs: 0 };

  // Hold the in-flight exchange aside. Its slimmed bytes stay valid: `slimItem` only looks at the item
  // before it, and the pair is moved together, so the qa still sits directly under its user bubble.
  const held: number[] = [];
  let end = items.length;
  const last = items[end - 1];
  if (last?.kind === 'qa' && !last.done) {
    held.unshift(--end);
    const before = items[end - 1];
    if (before?.kind === 'user' && before.text === last.question) held.unshift(--end);
  }

  // Measured by arithmetic, not by re-serializing: this runs on the debounced write path while a phase
  // is streaming, and re-assembling a multi-megabyte string once per candidate length would turn a
  // storage cap into a typing stutter. `2` = the brackets, `n - 1` = the commas.
  const heldBytes = held.reduce((n, i) => n + parts[i].length, 0);
  const lengthWith = (prefixEnd: number, prefixBytes: number): number => {
    const n = prefixEnd + held.length;
    return n === 0 ? 2 : 2 + prefixBytes + heldBytes + (n - 1);
  };
  let prefixBytes = all.slice(0, end).reduce((n, i) => n + parts[i].length, 0);

  let dropped = 0;
  while (end > 0) {
    // Never end on a `user` whose `qa` was just dropped: a dangling question bubble is one the backfill
    // will restore a second time (it counts qa items, not user ones), i.e. a visible duplicate.
    if (items[end - 1]?.kind === 'user' && items[end]?.kind === 'qa') {
      end--;
      prefixBytes -= parts[end].length;
    }
    if (lengthWith(end, prefixBytes) <= cap || dropped >= TRIM_MAX_PAIRS) break;
    end--;
    prefixBytes -= parts[end].length;
    if (items[end].kind === 'qa') dropped++;
  }
  return { json: assemble(all.slice(0, end).concat(held)), droppedPairs: dropped };
}

/**
 * Parse a persisted thread; null on absent/corrupt/non-array (→ caller falls back to requirement-only).
 *
 * Rebuilds a `qa`'s omitted `question` from the `user` bubble above it. This happens HERE, before any
 * caller sees the items, because two readers take `question` and neither tolerates its absence:
 * `backfillFromTranscript` matches exchanges by question text (a wrong/blank one there means the disk
 * transcript looks entirely "missing" and the whole conversation gets appended a second time) and
 * `recoverOpenAsk` compares it against the last exchange the backend recorded. A payload written before
 * the omission existed still carries its own `question`; it is never overwritten.
 */
export function parseThread(json: string | null): LiveThreadItem[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return null;
    const items = v.filter(
      (it) => it && typeof it.id === 'string' && typeof it.kind === 'string'
    ) as LiveThreadItem[];
    items.forEach((it, i) => {
      if (it.kind !== 'qa' || typeof it.question === 'string') return;
      const prev = items[i - 1];
      it.question = prev?.kind === 'user' ? prev.text : '';
    });
    return items.length ? items : null;
  } catch {
    return null;
  }
}

/** Reconcile a restored thread for reopening (decision #2): drop UNRESOLVED gate items (the live gate
 *  comes fresh from applyTask) and finalize any `running` run. Keep user/qa + resolved-gate history.
 *
 *  An OPEN `qa` is deliberately left OPEN here, unlike a running run. It may still be live: a hard reload
 *  opens a fresh SSE stream that keeps receiving `ask:answer`/`ask:done` for a turn the server is still
 *  running, and those fragments land on exactly this restored item — closing it here would silently throw
 *  the rest of the answer away. Whether it is live is not knowable from the thread bytes, so the settle
 *  lives where that IS known: the store's `init` handler, which closes an open qa when the server reports
 *  no turn holds the task (store.ts / `turnRunning`). Without that settle it rendered "Answering…" through
 *  every subsequent reload — observed after a mid-Ask server restart. */
export function hydrateForReopen(items: LiveThreadItem[]): LiveThreadItem[] {
  return items
    .filter((it) => !(it.kind === 'gate' && !it.resolved))
    .map((it) => (it.kind === 'run' && it.running ? { ...it, running: false } : it));
}
