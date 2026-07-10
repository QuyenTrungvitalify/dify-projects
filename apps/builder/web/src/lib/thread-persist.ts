// thread-persist.ts — client-side persistence of the chat thread across a full page reload.
//
// WHY (spec 033 D6 stays intact): the thread is built CLIENT-side from SSE and the BACKEND keeps no
// transcript. A soft SSE reconnect already preserves the in-memory thread (onInit re-applies the gate
// without wiping thread.value), but a HARD reload wipes the JS context, and openTask rebuilds the thread
// from "requirement + current gate" only — so the Q&A conversation was lost. This module persists the
// thread to localStorage (client-only — does NOT reintroduce a backend transcript, so D6 holds) so a
// reload keeps the conversation. Cache-scoped: clearing the browser / another machine starts fresh.
//
// THREE DECISIONS baked in here (the reason this needed no separate spec — they're small + local):
//  1. SLIM persist: KEEP `run.output` (the streamed phase prose — the Analyze overview / Spec / Implement
//     report a reopened build wants to re-read) but CAP it per run so one runaway log can't blow the ~5MB
//     quota; still drop `gate.snapshot.artifactContents` (SPEC.md/main.yml bytes re-fetched by applyTask).
//     (Originally the run output was dropped entirely as "disposable" — but a hard reload then blanked every
//     phase's output, which reads as data loss. Overviews/specs are far under the cap; only a huge Implement
//     log is truncated, tail-kept so its final result survives.)
//  2. RECONCILE on reopen (`hydrateForReopen`): the ONE live gate always comes fresh + authoritative from
//     applyTask, because the build may have advanced/finished server-side while the tab was closed
//     (dispatch is fire-and-forget; auto-mode keeps running with no client). So DROP any unresolved gate
//     item from the restored thread (a stale one would render phantom live buttons for a phase already
//     passed) and finalize any still-`running` run. Keep user/qa + already-resolved gate history. Composes
//     with store.applyTask's #5 backward-scan fix, which then refreshes/pushes exactly one live gate.
//  3. Best-effort writes: debounced + deduped-by-serialized in store.ts; every access is try/catch-guarded
//     (private mode / quota / disabled storage never breaks the app — it just falls back to no-persist).
import type { LiveThreadItem } from '../store';

/** Cap a persisted run log so one runaway phase stream can't blow the ~5MB localStorage quota. Phase
 *  overviews/specs sit far under this; only a huge Implement log is truncated — TAIL kept, since a reopened
 *  build wants its final result/summary (which streams last), with a leading marker so the cut is visible. */
export const RUN_OUTPUT_CAP = 32_000; // chars (~32KB); LRU-20 builds × a few runs stays well under quota
export function capRunOutput(output: string): string {
  if (output.length <= RUN_OUTPUT_CAP) return output;
  return `[… ${output.length - RUN_OUTPUT_CAP} chars truncated …]\n` + output.slice(-RUN_OUTPUT_CAP);
}

/** Serialize the thread to a SLIM JSON string (decision #1): run output CAPPED, gate artifactContents dropped. */
export function serializeThread(items: LiveThreadItem[]): string {
  const slim = items.map((it) => {
    if (it.kind === 'run') return { ...it, output: capRunOutput(it.output) };
    if (it.kind === 'gate') return { ...it, snapshot: { ...it.snapshot, artifactContents: undefined } };
    return it;
  });
  return JSON.stringify(slim);
}

/** Parse a persisted thread; null on absent/corrupt/non-array (→ caller falls back to requirement-only). */
export function parseThread(json: string | null): LiveThreadItem[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return null;
    const items = v.filter(
      (it) => it && typeof it.id === 'string' && typeof it.kind === 'string'
    ) as LiveThreadItem[];
    return items.length ? items : null;
  } catch {
    return null;
  }
}

/** Reconcile a restored thread for reopening (decision #2): drop UNRESOLVED gate items (the live gate
 *  comes fresh from applyTask) and finalize any `running` run. Keep user/qa + resolved-gate history. */
export function hydrateForReopen(items: LiveThreadItem[]): LiveThreadItem[] {
  return items
    .filter((it) => !(it.kind === 'gate' && !it.resolved))
    .map((it) => (it.kind === 'run' && it.running ? { ...it, running: false } : it));
}
