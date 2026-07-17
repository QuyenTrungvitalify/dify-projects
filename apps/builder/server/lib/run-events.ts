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

/** The transition kinds that make up a build's story (S1b). */
export type RunEventKind =
  | 'phase_start' // a phase turn began (detail: 'fresh' | 'resume' | 'retry')
  | 'gate_reached' // parked at a gate (detail: the gate flag / outcome)
  | 'gate_action' // a human/auto confirm advanced a boundary (detail: the action id)
  | 'request_changes' // a "Request changes" /reply — detail carries the USER'S change text
  | 'error' // the phase/turn errored (detail: the reason / triage)
  | 'retry' // a Retry-out-of-error re-ran the phase (detail: the user's text, if any)
  | 'live_test'; // a ④ live-test verdict (detail: verdict + reason)

export interface RunEvent {
  ts: number;
  phase?: string;
  kind: RunEventKind;
  detail?: string;
}

export const EVENTS_FILE = 'events.jsonl';

/**
 * Append one timeline event to `<runDir>/events.jsonl`. Never throws — a failed write is logged
 * nowhere and simply dropped (the build proceeds unaffected, S1b). `detail` is truncated to keep a
 * single event line bounded (a change-request paste could be huge).
 */
export async function logEvent(
  runDir: string,
  ev: { kind: RunEventKind; phase?: string; detail?: string; nowMs?: number }
): Promise<void> {
  try {
    const detail = ev.detail != null ? oneLine(ev.detail).slice(0, 2000) : undefined;
    const rec: RunEvent = { ts: ev.nowMs ?? Date.now(), phase: ev.phase, kind: ev.kind, detail };
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
