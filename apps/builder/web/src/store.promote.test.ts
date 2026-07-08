/**
 * Spec 052 S4 — store.promote. `./api` is mocked (promote + tree + active) and `./sse-client` is stubbed
 * (no real EventSource) while ApiError stays the real class so `instanceof` holds. Asserts: success opens
 * the returned promote task in the conversation view (task signal set, tree/active refreshed) and returns
 * true; a 400/404 (bad source) surfaces the verbatim error and returns false without opening a stream.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { ApiError } from './api';

const { promoteMock, treeMock, activeMock, connectMock } = vi.hoisted(() => ({
  promoteMock: vi.fn(),
  treeMock: vi.fn(async () => ({ projects: [] })),
  activeMock: vi.fn(async () => ({ active: [] })),
  connectMock: vi.fn(() => () => {}),
}));

vi.mock('./api', async (importActual) => {
  const actual = await importActual<typeof import('./api')>();
  return { ...actual, api: { ...actual.api, promote: promoteMock, tree: treeMock, active: activeMock, getTask: vi.fn() } };
});
vi.mock('./sse-client', () => ({ connectSSE: connectMock }));

import { promote, task, thread, startError } from './store';

const PROMOTE_TASK = {
  taskId: '1700000000001',
  kind: 'promote' as const,
  promote: { sourceFile: 'projects/proj/my-flow/workflows/main.yml', project: 'proj', workflow: 'my-flow', slug: 'my-flow' },
  project: 'proj',
  workflow: 'my-flow',
  workflowSlug: 'my-flow',
  workflowFile: 'main.yml',
  requirement: 'Promote projects/proj/my-flow to a reusable pattern',
  seedPath: null,
  deploy: 'none' as const,
  confirmMode: 'each_step' as const,
  phase: 'test' as const,
  status: 'running' as const,
  name: null,
  sessionIds: {},
  artifacts: {},
};

beforeEach(() => {
  promoteMock.mockReset();
  treeMock.mockClear();
  activeMock.mockClear();
  connectMock.mockClear();
  task.value = null;
  thread.value = [];
  startError.value = null;
});

describe('store.promote (spec 052)', () => {
  test('success → opens the promote task, refreshes tree/active, returns true', async () => {
    promoteMock.mockResolvedValue(PROMOTE_TASK);
    const ok = await promote('proj', 'my-flow');
    expect(ok).toBe(true);
    expect(promoteMock).toHaveBeenCalledWith({ project: 'proj', workflow: 'my-flow' });
    expect(task.value?.kind).toBe('promote');
    expect(task.value?.taskId).toBe('1700000000001');
    expect(connectMock).toHaveBeenCalledOnce(); // stream opened
    expect(treeMock).toHaveBeenCalled();
  });

  test('404 (no such workflow) → surfaces the verbatim error, returns false, no stream', async () => {
    promoteMock.mockRejectedValue(new ApiError(404, 'no workflow at projects/proj/nope/workflows/main.yml'));
    const ok = await promote('proj', 'nope');
    expect(ok).toBe(false);
    expect(startError.value).toBe('no workflow at projects/proj/nope/workflows/main.yml');
    expect(connectMock).not.toHaveBeenCalled();
  });
});
