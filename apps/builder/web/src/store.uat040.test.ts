/**
 * Spec 040 D2/D3/D4 — UAT hardening regressions (store-level; no network/SSE success paths).
 *   D2: a failed dispatch (409 turn-busy) is signalled by a `false` return, so App can keep the draft.
 *   D3: restoreLastTask reopens an existing build and SILENTLY degrades a stale/deleted id (no banner).
 *   D4: a real status transition refreshes the sidebar "In progress" list (loadActive); a same-status
 *       re-apply does not.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { api, ApiError } from './api';
import { start, reply, ask, restoreLastTask, applyTask, task, resetToNew, startError } from './store';
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

afterEach(() => {
  vi.restoreAllMocks();
  resetToNew();
  startError.value = null;
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('D2 — a failed send is recoverable (dispatch resolves false, never rejects)', () => {
  it('start() → false on a 409 (turn busy)', async () => {
    vi.spyOn(api, 'createTask').mockRejectedValue(new ApiError(409, 'a turn is already running'));
    expect(await start('summarize a topic')).toBe(false);
  });

  it('reply() → false on a 409', async () => {
    task.value = mk('t1', 1, 'awaiting_confirm');
    vi.spyOn(api, 'reply').mockRejectedValue(new ApiError(409, 'busy'));
    expect(await reply('add a 5th sentiment level')).toBe(false);
  });

  it('ask() → false on a 409', async () => {
    task.value = mk('t1', 1, 'awaiting_confirm');
    vi.spyOn(api, 'ask').mockRejectedValue(new ApiError(409, 'busy'));
    expect(await ask('what does this workflow do?')).toBe(false);
  });
});

describe('D3 — restoreLastTask reopens or silently degrades', () => {
  it('a stale/deleted id → key cleared, NO error banner, empty view', async () => {
    localStorage.setItem('builder.lastTask', 'gone999');
    const getSpy = vi.spyOn(api, 'getTask').mockRejectedValue(new ApiError(404, 'not found'));
    await restoreLastTask();
    expect(getSpy).toHaveBeenCalledWith('gone999');
    expect(localStorage.getItem('builder.lastTask')).toBe(null); // forgotten
    expect(task.value).toBe(null); // stays on the empty view
    expect(startError.value).toBe(null); // ⚠️ review fix: a missing build must NOT flash a banner
  });

  it('no persisted id → a pure no-op (no getTask)', async () => {
    const getSpy = vi.spyOn(api, 'getTask');
    await restoreLastTask();
    expect(getSpy).not.toHaveBeenCalled();
  });
});

describe('D4 — a status transition refreshes the sidebar in-progress list', () => {
  it('running→awaiting_confirm calls loadActive once; a same-status re-apply does not', async () => {
    const activeSpy = vi.spyOn(api, 'active').mockResolvedValue({ active: [] });
    // the gate-branch artifact-contents fetch is swallowed (.catch) — reject it so no applyTask re-entry.
    vi.spyOn(api, 'getTask').mockRejectedValue(new Error('no network in unit'));
    resetToNew(); // reset the rev guard so each fresh-rev snapshot applies

    applyTask(mk('t9', 1, 'running'));
    const afterRunning = activeSpy.mock.calls.length;

    applyTask(mk('t9', 2, 'awaiting_confirm')); // running → gate (arrives via SSE, no user action)
    expect(activeSpy.mock.calls.length).toBe(afterRunning + 1);

    applyTask(mk('t9', 3, 'awaiting_confirm')); // same status (e.g. reconnect re-emit) → no extra refresh
    expect(activeSpy.mock.calls.length).toBe(afterRunning + 1);
  });
});
