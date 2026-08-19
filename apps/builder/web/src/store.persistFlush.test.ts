/**
 * Mid-stream persistence flush — the "reload during a running phase loses the output" regression.
 *
 * Root cause chain: during a streaming phase `thread.value` changes many times per second, so the
 * 500ms debounced persist is perpetually re-armed and NEVER fires (starvation); a hard reload then
 * restored a thread snapshot from BEFORE the stream started. bb38c6a fixed WHAT is persisted
 * (capped run.output) but not WHEN. The fix: `persistThreadImmediately()` (drain rAF buffer +
 * synchronous write), wired to `pagehide`/`beforeunload`, plus a 3s max-wait in the debounce.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  applyTask,
  applyOutput,
  persistThreadImmediately,
  thread,
  resetToNew,
} from './store';
import type { WireTask, WirePhase } from './types';

const mk = (
  taskId: string,
  rev: number | undefined,
  status: WireTask['status'] = 'running',
  phase: WirePhase = 'analyze'
): WireTask =>
  ({
    taskId,
    project: null,
    workflow: null,
    workflowFile: 'main.yml',
    requirement: 'r',
    seedPath: null,
    deploy: 'none',
    confirmMode: 'each_step',
    phase,
    status,
    workflowSlug: null,
    name: null,
    sessionIds: {},
    artifacts: {},
    rev,
  }) as WireTask;

const persistedRunOutput = (taskId: string): string | undefined => {
  const raw = localStorage.getItem(`builder.thread.${taskId}`);
  if (!raw) return undefined;
  const items = JSON.parse(raw) as Array<{ kind: string; output?: string }>;
  return items.find((it) => it.kind === 'run')?.output;
};

afterEach(() => {
  vi.useRealTimers();
  // Unconditionally, because an inline `spy.mockRestore()` NEVER RUNS when an assertion above it throws
  // — the mock then leaks into the next test and turns one real failure into a cascade of fake ones.
  // Observed while proving the §3.2 test red: a leaked setItem stub made an unrelated dedupe assertion
  // fail too, which is exactly the kind of noise that hides the actual regression.
  vi.restoreAllMocks();
  resetToNew();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('persistThreadImmediately — unload-time flush beats the debounce starvation', () => {
  it('writes the streamed output synchronously while the debounce has not fired', () => {
    vi.useFakeTimers(); // freeze timers: the 500ms debounce (and max-wait tick) can never fire
    applyTask(mk('TFLUSH1', 1)); // running analyze → opens a run item
    applyOutput('analyze', 'the streamed digest ');
    applyOutput('analyze', 'that must survive a mid-run reload');
    // Debounce starved / not advanced → nothing (with this output) is persisted yet.
    expect(persistedRunOutput('TFLUSH1') ?? '').not.toContain('mid-run reload');

    persistThreadImmediately(); // what pagehide/beforeunload call

    const out = persistedRunOutput('TFLUSH1');
    expect(out).toContain('the streamed digest that must survive a mid-run reload');
    // and the in-memory thread got the drained fragments too (flushPendingOutput ran first)
    const run = thread.value.find((it) => it.kind === 'run') as { output: string };
    expect(run.output).toContain('mid-run reload');
  });

  it('is wired to pagehide (a reload mid-stream persists without any timer)', () => {
    vi.useFakeTimers();
    applyTask(mk('TFLUSH2', 1));
    applyOutput('analyze', 'pagehide-flushed text');

    window.dispatchEvent(new Event('pagehide'));

    expect(persistedRunOutput('TFLUSH2')).toContain('pagehide-flushed text');
  });
});

/**
 * Spec 101 §3.2 — a FAILED write must not poison every later one.
 *
 * `persistThreadNow` dedupes by comparing the serialized thread to `_lastPersisted`, and it used to set
 * that marker BEFORE calling `setItem`. So one throw — a full quota, private mode — left the marker
 * claiming this exact payload was stored when nothing was. Every subsequent attempt then matched the
 * marker and short-circuited: the thread was never written again for the rest of the session, silently,
 * because the surrounding catch has always swallowed. Moving the assignment after the write costs
 * nothing and makes the failure transient instead of terminal.
 */
describe('persistThreadNow — a throw does not permanently disable persistence (spec 101 §3.2)', () => {
  it('setItem throws once → the NEXT flush of the same thread still attempts the write', () => {
    const t = mk('T-quota', 1);
    applyTask(t);
    applyOutput('analyze', 'the phase output');

    const real = localStorage.setItem.bind(localStorage);
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    let calls = 0;
    spy.mockImplementation((k: string, v: string) => {
      calls++;
      if (calls === 1) throw new DOMException('QuotaExceededError'); // the thread write fails once
      real(k, v);
    });

    persistThreadImmediately(); // attempt 1 — throws
    persistThreadImmediately(); // attempt 2 — same payload, MUST be retried, not deduped away

    // >1 call for the thread key is the whole assertion: with the old ordering the second flush
    // short-circuited on `json === _lastPersisted` and never reached setItem at all.
    const threadWrites = spy.mock.calls.filter((c) => String(c[0]).startsWith('builder.thread.T-quota'));
    expect(threadWrites.length).toBeGreaterThan(1);
    expect(persistedRunOutput('T-quota')).toBe('the phase output'); // and it eventually landed
  });

  it('REGRESSION: with no throw, an unchanged thread is still written only ONCE (dedupe intact)', () => {
    const t = mk('T-dedupe', 1);
    applyTask(t);
    applyOutput('analyze', 'stable');
    persistThreadImmediately();

    const spy = vi.spyOn(Storage.prototype, 'setItem');
    persistThreadImmediately(); // nothing changed since the write above
    const threadWrites = spy.mock.calls.filter((c) => String(c[0]).startsWith('builder.thread.T-dedupe'));
    expect(threadWrites).toHaveLength(0); // the dedupe must survive the reorder
  });
});
