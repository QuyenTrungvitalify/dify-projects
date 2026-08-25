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
  persistDegraded,
  readPersistFailure,
  clearPersistFailure,
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

/** The storage key the store writes under. Versioned (`v2`) since the persisted shape stopped storing
 *  a question twice — see thread-persist.ts. Spelled once here so a future bump moves one line. */
const threadKey = (taskId: string): string => `builder.thread.v2.${taskId}`;

const persistedRunOutput = (taskId: string): string | undefined => {
  const raw = localStorage.getItem(threadKey(taskId));
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
  // Module-level signal: it outlives `resetToNew` (a degraded CACHE is not a property of the open task),
  // so a test that left it set would hand the next one a passing assertion it never earned.
  persistDegraded.value = null;
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
    const threadWrites = spy.mock.calls.filter((c) => String(c[0]).startsWith(threadKey('T-quota')));
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
    const threadWrites = spy.mock.calls.filter((c) => String(c[0]).startsWith(threadKey('T-dedupe')));
    expect(threadWrites).toHaveLength(0); // the dedupe must survive the reorder
  });
});

/**
 * Spec 099 S2′ — a storage failure nobody can see is a data loss nobody can diagnose.
 *
 * Every `setItem` in the store swallows its failure by design, localStorage never rides the export
 * bundle, and there is no telemetry — so on a machine nobody can reach, a full quota looks exactly like
 * a healthy session right up until the history is gone. These pin the two channels that fix that: a
 * banner for the person at the keyboard, and a flag the next request carries to the run timeline.
 */
describe('persistThreadNow — a failed write is visible and reportable (spec 099 S2′)', () => {
  const throwOnThreadWrite = (err: unknown) => {
    const real = localStorage.setItem.bind(localStorage);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string, v: string) => {
      if (k.startsWith('builder.thread.')) throw err;
      real(k, v);
    });
  };

  it('a quota failure raises the banner state AND leaves a report for the next request', () => {
    applyTask(mk('T-degraded', 1));
    applyOutput('analyze', 'output that will not fit');
    throwOnThreadWrite(new DOMException('quota', 'QuotaExceededError'));

    persistThreadImmediately();

    expect(persistDegraded.value?.reason).toBe('quota');
    expect(persistDegraded.value!.chars).toBeGreaterThan(0);
    const report = readPersistFailure();
    expect(report?.reason).toBe('quota');
    expect(report?.taskId).toBe('T-degraded');
    expect(report!.chars).toBeGreaterThan(0);
  });

  it('a NON-quota failure still reports — it just does not claim to know why', () => {
    applyTask(mk('T-other', 1));
    applyOutput('analyze', 'x');
    throwOnThreadWrite(new Error('storage is disabled'));

    persistThreadImmediately();

    expect(persistDegraded.value?.reason).toBe('other');
    expect(readPersistFailure()?.reason).toBe('other');
  });

  it('THE TRAP: the notice never becomes a thread item — that would re-trigger its own cause', () => {
    applyTask(mk('T-noloop', 1));
    applyOutput('analyze', 'x');
    const before = thread.value.length;
    throwOnThreadWrite(new DOMException('quota', 'QuotaExceededError'));

    persistThreadImmediately();
    persistThreadImmediately();
    persistThreadImmediately();

    // Any item appended here would wake the persist effect — i.e. the write that just failed — and a
    // per-failure notice would then append again, and again.
    expect(thread.value.length).toBe(before);
  });

  it('a write that lands again clears the banner — it tracks the state, not the history', () => {
    applyTask(mk('T-recover', 1));
    applyOutput('analyze', 'first');
    throwOnThreadWrite(new DOMException('quota', 'QuotaExceededError'));
    persistThreadImmediately();
    expect(persistDegraded.value).not.toBeNull();

    vi.restoreAllMocks();
    applyOutput('analyze', ' second'); // change the payload so the dedupe does not skip the write
    persistThreadImmediately();

    expect(persistDegraded.value).toBeNull();
  });

  it('the report survives a reload and is forgotten once delivered — one incident, one line', () => {
    applyTask(mk('T-once', 1));
    applyOutput('analyze', 'x');
    throwOnThreadWrite(new DOMException('quota', 'QuotaExceededError'));
    persistThreadImmediately();
    vi.restoreAllMocks();

    // It lives in localStorage, so a reload still finds it — that is the point of not keeping it in
    // memory only.
    expect(readPersistFailure()).not.toBeNull();

    clearPersistFailure();
    expect(readPersistFailure()).toBeNull();
  });

  it('a corrupt or half-written flag reads as no report, never as a crash', () => {
    localStorage.setItem('builder.persistFailed', 'not json');
    expect(readPersistFailure()).toBeNull();
    localStorage.setItem('builder.persistFailed', JSON.stringify({ taskId: 'T', reason: 'quota' }));
    expect(readPersistFailure()).toBeNull(); // no size ⇒ nothing worth reporting
    // And a flag written by an older build of the app, when the field was called `bytes`: unreadable
    // rather than silently reported under the wrong unit.
    localStorage.setItem('builder.persistFailed', JSON.stringify({ taskId: 'T', reason: 'quota', bytes: 10 }));
    expect(readPersistFailure()).toBeNull();
  });
});
