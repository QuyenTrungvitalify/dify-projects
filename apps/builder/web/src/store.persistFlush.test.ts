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
