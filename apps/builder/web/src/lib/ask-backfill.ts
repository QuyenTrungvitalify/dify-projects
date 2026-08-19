// ask-backfill.ts — put a build's lost Q&A back into the thread, from the transcript on disk.
//
// THE FAILURE THIS EXISTS FOR (spec 099). A build's conversation has only ever lived in this browser's
// localStorage. Every way that cache can go away therefore reads as data loss: the 20-thread LRU evicting
// an older build, a cleared cache, a different machine, the multi-tab clobber. Meanwhile `chat.jsonl` sat
// on disk beside the run the whole time, complete, with nothing reading it back.
//
// BACKFILL, NOT REBUILD — the one decision everything else follows from. It is tempting to hand the
// transcript to `consultThreadFromChat` and be done, and it would be wrong: `chat.jsonl` knows nothing
// about `run` or `gate` items, so rebuilding from it would erase the entire phase timeline to restore the
// conversation. This module only ever APPENDS what is missing and never touches an existing item.
//
// (When spec 099 was written there was a second reason — the browser held 87 exchanges against 53 on
// disk, so disk was not even a superset. On a machine installed today it is. The decision stands anyway,
// for the run/gate reason above; noted so nobody "simplifies" this into a rebuild later.)
//
// MATCHED BY QUESTION TEXT, as a MULTISET. A Set would silently swallow a repeat: ask "why?" twice, keep
// one bubble, and a set-based diff concludes nothing is missing. Text is the only key available — thread
// items carry no timestamp — which is also why the appended block goes at the END rather than being
// interleaved: there is no honest way to place it, so the marker says so instead of guessing.
import type { LiveThreadItem } from '../store';
import type { WirePhase, WirePhaseCost } from '../types';

/** One line of the persisted transcript, as `GET /api/tasks/:id/chat` returns it. */
export interface TranscriptLine {
  role: 'user' | 'assistant';
  text: string;
  cost?: WirePhaseCost;
  sessionReset?: boolean;
}

export interface BackfillOpts {
  /** Exchanges the server left out of its tail window — the reason a marker becomes mandatory. */
  dropped?: number;
  /** Phase to stamp on the marker item (it reuses the `run` kind — see `marker` below). */
  phase: WirePhase;
  /** Id minter, injected so this module stays pure and its output is assertable. */
  uid: () => string;
}

/** Adjacent (user, assistant) exchanges — exactly how `recordAsk` writes them, back-to-back. */
function pairs(chat: TranscriptLine[]): Array<{ q: TranscriptLine; a: TranscriptLine }> {
  const out: Array<{ q: TranscriptLine; a: TranscriptLine }> = [];
  for (let i = 0; i + 1 < chat.length; i++) {
    if (chat[i].role === 'user' && chat[i + 1].role === 'assistant') {
      out.push({ q: chat[i], a: chat[i + 1] });
      i++; // consume the answer, so a U,A,A run cannot pair the second answer too
    }
  }
  return out;
}

/**
 * The thread with any missing exchanges appended, or `null` when there is nothing to add.
 *
 * `null` rather than the unchanged array is deliberate and load-bearing: the caller assigns to a signal
 * that the persistence effect subscribes to, so handing back an equal-but-new array would publish a
 * write for a thread nobody changed. That is the exact shape of the bug spec 099 S1b just fixed, and
 * this module must not reintroduce it one layer up.
 */
export function backfillFromTranscript(
  items: LiveThreadItem[],
  chat: TranscriptLine[],
  opts: BackfillOpts
): LiveThreadItem[] | null {
  const all = pairs(chat);
  if (all.length === 0) return null;

  // Multiset of the questions already on screen: text → how many bubbles carry it.
  const have = new Map<string, number>();
  for (const it of items) {
    if (it.kind !== 'qa') continue;
    const k = it.question.trim();
    have.set(k, (have.get(k) ?? 0) + 1);
  }

  const missing: Array<{ q: TranscriptLine; a: TranscriptLine; idx: number }> = [];
  all.forEach((p, idx) => {
    const k = p.q.text.trim();
    const n = have.get(k) ?? 0;
    if (n > 0) have.set(k, n - 1); // consume one — a repeated question consumes one bubble per ask
    else missing.push({ ...p, idx });
  });
  if (missing.length === 0) return null;

  // Is the missing block exactly the tail of the transcript? Then appending it at the end preserves the
  // real order and the thread needs no explanation. Anything else — a hole in the middle — means the
  // rendered order is not the order things happened, and saying so is the whole of principle 3.
  const isTail = missing.every((m, i) => m.idx === all.length - missing.length + i);
  const needsMarker = !isTail || (opts.dropped ?? 0) > 0;

  const out = items.slice();
  if (needsMarker) out.push(marker(missing.length, opts));
  for (const m of missing) {
    out.push({ id: opts.uid(), kind: 'user', text: m.q.text });
    out.push({
      id: opts.uid(),
      kind: 'qa',
      question: m.q.text,
      answer: m.a.text,
      done: true,
      ...(m.a.cost ? { cost: m.a.cost } : {}),
      ...(m.a.sessionReset ? { sessionReset: true } : {}),
    });
  }
  return out;
}

/**
 * The "this came back from disk" note.
 *
 * Reuses the `run` kind rather than introducing a new one: a new kind would have to be taught to
 * `parseThread`, `serializeThread` and the renderer for a single line of prose, and there is already
 * precedent for exactly this — the `runsDropped` notice in `buildThreadFromRuns` is a `run` item too.
 *
 * Shown ONLY when something is genuinely unclear (a hole in the middle, or a server-side cut). Restoring
 * a clean tail says nothing, because there is nothing to say and a banner on every reopen is noise.
 */
function marker(count: number, opts: BackfillOpts): LiveThreadItem {
  const cut = (opts.dropped ?? 0) > 0 ? ` ${opts.dropped} older exchange(s) are not shown — see the exported bundle.` : '';
  return {
    id: opts.uid(),
    kind: 'run',
    phase: opts.phase,
    running: false,
    output: `[… ${count} exchange(s) below were restored from the transcript on disk; their position relative to the build steps may not be exact.${cut} …]`,
  };
}
