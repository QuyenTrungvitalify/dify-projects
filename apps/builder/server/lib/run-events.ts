/**
 * run-events.ts — spec 062 S1b. The run TIMELINE: one append-only JSONL line per orchestrator
 * transition, written to `.runs/<taskId>/events.jsonl`. This is the backbone the dossier renders as
 * `## Flow` (and a machine-readable trace a Claude session can replay).
 *
 * BEST-EFFORT + non-fatal by contract: a timeline write must NEVER fail a build turn (S1b), so every
 * function swallows its own IO errors. Append-only (never rewritten), so a live read during a build
 * just sees a prefix. `logEvent` stamps the wall-clock itself (the app may use `Date`; only workflow
 * scripts can't) — an optional `nowMs` override keeps tests deterministic.
 */
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PhaseCost } from '../state/task.js';

/** The transition kinds that make up a build's story (S1b). */
export type RunEventKind =
  | 'phase_start' // a phase turn began (detail: 'fresh' | 'resume' | 'retry')
  | 'turn_spawned' // the claude child is about to spawn (detail: 'attempt N'; spec 085 S0 — its ts
  //                  minus phase_start's is the pre-turn overhead, and the next event's ts minus its
  //                  is the turn's wall-clock: the split that separates thrash from host-sleep/size)
  | 'gate_reached' // parked at a gate (detail: the gate flag / outcome)
  | 'gate_action' // a human/auto confirm advanced a boundary (detail: the action id)
  | 'request_changes' // a "Request changes" /reply — detail carries the USER'S change text
  | 'error' // the phase/turn errored (detail: the reason / triage)
  | 'retry' // a Retry-out-of-error re-ran the phase (detail: the user's text, if any)
  | 'live_test' // a ④ live-test verdict (detail: verdict + reason)
  | 'turn_cost' // what ONE attempt cost (carried in `cost`, not `detail`)
  // Spec 099 S0 — a browser opened / closed the SSE stream for this task, `detail: 'clients=N'` where N
  // counts the streams still live ON THIS TASK. It answers exactly one question, and it is the question
  // that blocked the 099 investigation: HOW MANY TABS were watching this build at once? Two tabs on one
  // build is a real data-loss scenario (099 S1b), and the old `dev-restart.log` could not answer it — it
  // recorded every request but NEVER a disconnect, so every stream appeared to "end" when the process
  // died and any concurrency count from it was fiction.
  //
  // Written HERE rather than only to `app.log` because `.runs/dev-restart.log` is process-global, mixes
  // every task, is not redacted, and therefore can never ride the export bundle. On the author's machine
  // a log line is enough; on a tester's machine it is unreachable. This file already ships in the bundle.
  | 'stream_open'
  | 'stream_close'
  // Spec 099 S1 — the browser asked for the transcript and its own count DISAGREED with the disk's,
  // `detail: 'disk=N browser=M'`. Written only on disagreement: the everyday case must stay silent, or
  // the timeline fills with noise and stops being read.
  //
  // This is the measurement the 099 investigation could not get. "87 exchanges in the browser, 53 on
  // disk" came from asking the user to paste a console dump, after three wrong diagnoses built on
  // inferring the browser's state from the disk's. On a tester's machine that request is not available
  // at all — so the number has to record itself, on the one channel the export bundle carries.
  | 'history_gap'
  | 'artifact_unchanged'; // spec 094 S1 — an ③ turn ended with the artifact's bytes IDENTICAL (detail:
//                           the workflow file). Emitted only when measured; absent ⇒ the turn changed
//                           the file, or the build predates 094. Two of the five fix rounds on run
//                           1786089321835 were this, and nothing in the timeline said so.

export interface RunEvent {
  ts: number;
  phase?: string;
  kind: RunEventKind;
  detail?: string;
  /**
   * `turn_cost` only — what that attempt cost (model, tokens, cache, $).
   *
   * On the SERVER because the browser's copy is not a record: the thread lives in localStorage, so the
   * numbers survive a reload on the same machine and vanish on any other — and a run nobody watched
   * live never had them at all. This file already outlives all of that and already ships in the export.
   *
   * Per ATTEMPT, which `task.cost[phase]` cannot be: that slot is last-write-wins across re-runs, so
   * after three fix rounds it holds only the third. Here every round keeps its own line.
   */
  cost?: PhaseCost;
}

export const EVENTS_FILE = 'events.jsonl';

/**
 * Append one timeline event to `<runDir>/events.jsonl`. Never throws — a failed write is logged
 * nowhere and simply dropped (the build proceeds unaffected, S1b). `detail` is truncated to keep a
 * single event line bounded (a change-request paste could be huge).
 */
export async function logEvent(
  runDir: string,
  ev: { kind: RunEventKind; phase?: string; detail?: string; nowMs?: number; cost?: PhaseCost }
): Promise<void> {
  try {
    const detail = ev.detail != null ? oneLine(ev.detail).slice(0, 2000) : undefined;
    const rec: RunEvent = { ts: ev.nowMs ?? Date.now(), phase: ev.phase, kind: ev.kind, detail, ...(ev.cost ? { cost: ev.cost } : {}) };
    await appendFile(join(runDir, EVENTS_FILE), JSON.stringify(rec) + '\n');
  } catch {
    // best-effort: the run timeline must never break a turn.
  }
}

/** Read the timeline back (for the bundle / dossier). Missing file → []; a torn last line is skipped. */
export async function readEvents(runDir: string): Promise<RunEvent[]> {
  let raw: string;
  try {
    raw = await readFile(join(runDir, EVENTS_FILE), 'utf8');
  } catch {
    return [];
  }
  const out: RunEvent[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const rec = JSON.parse(t) as RunEvent;
      if (rec && typeof rec.kind === 'string') out.push(rec);
    } catch {
      // a partially-written last line (a crash mid-append) — skip it.
    }
  }
  return out;
}

/** Collapse newlines/tabs so one event stays one JSONL line even when detail is multi-line user text. */
function oneLine(s: string): string {
  return s.replace(/\s*\n\s*/g, ' ⏎ ').replace(/\t/g, ' ').trim();
}
