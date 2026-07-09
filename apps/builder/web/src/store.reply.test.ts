/**
 * Spec 053 — store.reply's empty-text carve-out for Retry-out-of-error. `./api` is mocked (reply +
 * active + getTask) and `./sse-client` stubbed (no EventSource); ApiError stays real. Asserts:
 *   - reply('') on a `status:'error'` task DISPATCHES a text-less retry (api.reply(id, '', undefined)),
 *     adds NO empty user bubble, resolves the open gate with the 'Retry phase' label, returns true.
 *   - reply('') on an `awaiting_confirm` task is a no-op (returns false, api.reply never called).
 *   - reply('', 'Retry phase', files) on error FORWARDS the staged files (3rd arg) — never drops them.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { WireTask } from './types';
import type { Attachment } from './api';

const { replyMock, activeMock, getTaskMock, connectMock } = vi.hoisted(() => ({
  replyMock: vi.fn(),
  activeMock: vi.fn(async () => ({ active: [] })),
  getTaskMock: vi.fn(),
  connectMock: vi.fn(() => () => {}),
}));

vi.mock('./api', async (importActual) => {
  const actual = await importActual<typeof import('./api')>();
  return { ...actual, api: { ...actual.api, reply: replyMock, active: activeMock, getTask: getTaskMock } };
});
vi.mock('./sse-client', () => ({ connectSSE: connectMock }));

import { reply, task, thread } from './store';

/** A minimal parked task at the given status, with one UNRESOLVED gate item in the thread so the
 *  optimistic gate-resolution (label) is observable. */
const mk = (status: WireTask['status'], phase: WireTask['phase'] = 'spec'): WireTask =>
  ({
    taskId: 'T1', project: null, workflow: null, workflowFile: 'main.yml', requirement: 'r',
    seedPath: null, deploy: 'none', confirmMode: 'each_step', phase, status, workflowSlug: null,
    name: null, sessionIds: {}, artifacts: {}, rev: 1,
    gate: { actions: [{ id: 'retry', label: 'Retry phase', kind: 'reply', route: '/reply' }] },
  }) as WireTask;

const seedGate = (t: WireTask): void => {
  thread.value = [{ id: 'g1', kind: 'gate', phase: t.phase, snapshot: t, resolved: undefined }];
};

const userBubbles = (): number => thread.value.filter((i) => i.kind === 'user').length;

beforeEach(() => {
  replyMock.mockReset();
  activeMock.mockClear();
  task.value = null;
  thread.value = [];
});

describe('store.reply — Retry-out-of-error empty-text carve-out (spec 053)', () => {
  test("reply('') on status:'error' → text-less dispatch, no empty bubble, gate resolved 'Retry phase'", async () => {
    const t = mk('error');
    task.value = t;
    seedGate(t);
    replyMock.mockResolvedValue({ ...t, status: 'running' });

    const ok = await reply('', 'Retry phase');

    expect(ok).toBe(true);
    expect(replyMock).toHaveBeenCalledTimes(1);
    expect(replyMock).toHaveBeenCalledWith('T1', '', undefined);
    expect(userBubbles()).toBe(0); // no empty user bubble pushed
    const gate = thread.value.find((i) => i.kind === 'gate') as { resolved?: string };
    expect(gate.resolved).toBe('Retry phase');
  });

  test("reply('') on status:'awaiting_confirm' → no-op (returns false, api.reply never called)", async () => {
    const t = mk('awaiting_confirm');
    task.value = t;
    seedGate(t);

    const ok = await reply('');

    expect(ok).toBe(false);
    expect(replyMock).not.toHaveBeenCalled();
    expect(userBubbles()).toBe(0);
  });

  test("reply('', 'Retry phase', files) on error → FORWARDS the staged files (not dropped)", async () => {
    const t = mk('error');
    task.value = t;
    seedGate(t);
    replyMock.mockResolvedValue({ ...t, status: 'running' });
    const files: Attachment[] = [{ name: 'a.pdf', mime: 'application/pdf', dataUrl: 'data:application/pdf;base64,AA==' }];

    const ok = await reply('', 'Retry phase', files);

    expect(ok).toBe(true);
    expect(replyMock).toHaveBeenCalledWith('T1', '', files);
  });

  test("a STEERED reply (non-empty) still adds the user bubble — carve-out doesn't change it", async () => {
    const t = mk('error');
    task.value = t;
    seedGate(t);
    replyMock.mockResolvedValue({ ...t, status: 'running' });

    const ok = await reply('simplify the spec', 'Retry phase');

    expect(ok).toBe(true);
    expect(replyMock).toHaveBeenCalledWith('T1', 'simplify the spec', undefined);
    expect(userBubbles()).toBe(1); // the typed message IS shown
  });
});
