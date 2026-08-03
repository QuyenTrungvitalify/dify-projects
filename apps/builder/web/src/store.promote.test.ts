/**
 * Spec 084 — store.promote now dispatches into the BACKGROUND tray (was spec 052 foreground: task.value +
 * openStream). `./api` is mocked (promote/getTask/confirm/reply + tree/active) and `./sse-client` stubbed;
 * ApiError stays real so `instanceof` holds. Asserts: a distill lands in `bgDistills` WITHOUT hijacking
 * task.value or opening a stream; a 409 (single write-lane busy) parks `queued` with no error; a 400/404
 * marks the item errored; the poll folds an authoritative snapshot back in; confirmBg drives a bg gate.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError } from './api';

const { promoteMock, getTaskMock, confirmMock, replyMock, cancelMock, undoMock, deleteMock, deleteProjectMock, deleteWorkflowMock, treeMock, activeMock, promotesMock, consultsMock, connectMock } = vi.hoisted(() => ({
  promoteMock: vi.fn(),
  getTaskMock: vi.fn(),
  confirmMock: vi.fn(),
  replyMock: vi.fn(),
  cancelMock: vi.fn(),
  undoMock: vi.fn(),
  deleteMock: vi.fn(),
  deleteProjectMock: vi.fn(),
  deleteWorkflowMock: vi.fn(),
  treeMock: vi.fn(async () => ({ projects: [] })),
  activeMock: vi.fn(async () => ({ active: [] })),
  promotesMock: vi.fn(async () => ({ promotes: [] })),
  consultsMock: vi.fn(async () => ({ consults: [] })),
  connectMock: vi.fn(() => () => {}),
}));

vi.mock('./api', async (importActual) => {
  const actual = await importActual<typeof import('./api')>();
  return {
    ...actual,
    api: { ...actual.api, promote: promoteMock, getTask: getTaskMock, confirm: confirmMock, reply: replyMock, cancel: cancelMock, undoPromote: undoMock, deleteTask: deleteMock, deleteProject: deleteProjectMock, deleteWorkflow: deleteWorkflowMock, tree: treeMock, active: activeMock, promotes: promotesMock, consults: consultsMock },
  };
});
vi.mock('./sse-client', () => ({ connectSSE: connectMock }));

import { promote, promoteExternalYaml, bgDistills, bgTestMode, setBgTestMode, pollBgTick, confirmBg, undoBg, clearTestDistills, restoreBgDistills, openTask, loadPromotes, promotes, removeTask, removeProject, removeWorkflow, stopBgPoll, task, thread, startError } from './store';

const PROMOTE_TASK = {
  taskId: '1700000000001',
  kind: 'promote' as const,
  promote: { sourceFile: 'projects/proj/my-flow/workflows/main.yml', project: 'proj', workflow: 'my-flow', slug: 'my-flow', target: 'templates/patterns/my-flow.yml' },
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
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  promoteMock.mockReset();
  getTaskMock.mockReset();
  confirmMock.mockReset();
  replyMock.mockReset();
  cancelMock.mockReset();
  undoMock.mockReset();
  deleteMock.mockReset();
  deleteProjectMock.mockReset();
  deleteWorkflowMock.mockReset();
  consultsMock.mockClear();
  treeMock.mockClear();
  activeMock.mockClear();
  connectMock.mockClear();
  task.value = null;
  thread.value = [];
  startError.value = null;
  bgDistills.value = [];
  bgTestMode.value = false;
  promotes.value = [];
  promotesMock.mockClear();
});
afterEach(() => stopBgPoll());

describe('store.promote (spec 084 background tray)', () => {
  test('success → lands in bgDistills, does NOT hijack task.value or open a stream', async () => {
    promoteMock.mockResolvedValue(PROMOTE_TASK);
    const key = promote('proj', 'my-flow');
    expect(typeof key).toBe('string'); // a tray key, not a boolean
    await flush();
    expect(promoteMock).toHaveBeenCalledWith({ project: 'proj', workflow: 'my-flow' });
    expect(task.value).toBeNull(); // foreground untouched
    expect(connectMock).not.toHaveBeenCalled(); // no 2nd SSE stream (§3 — POLL)
    const item = bgDistills.value.find((b) => b.key === key)!;
    expect(item.taskId).toBe('1700000000001');
    expect(item.slug).toBe('my-flow');
    expect(item.status).toBe('running');
    expect(item.target).toBe('templates/patterns/my-flow.yml');
  });

  test('409 (build lane busy) → item stays queued, no error surfaced', async () => {
    promoteMock.mockRejectedValue(new ApiError(409, 'another turn is running'));
    const key = promote('proj', 'my-flow');
    await flush();
    const item = bgDistills.value.find((b) => b.key === key)!;
    expect(item.status).toBe('queued');
    expect(item.taskId).toBeUndefined();
    expect(startError.value).toBeNull(); // NOT a red error — the poll retries
  });

  test('404 (bad source) → item marked errored', async () => {
    promoteMock.mockRejectedValue(new ApiError(404, 'no workflow at projects/proj/nope/workflows/main.yml'));
    const key = promote('proj', 'nope');
    await flush();
    expect(bgDistills.value.find((b) => b.key === key)!.status).toBe('error');
    expect(connectMock).not.toHaveBeenCalled();
  });

  test('poll folds an authoritative snapshot (running → parked review) back into the item', async () => {
    promoteMock.mockResolvedValue(PROMOTE_TASK);
    const key = promote('proj', 'my-flow');
    await flush();
    getTaskMock.mockResolvedValue({
      ...PROMOTE_TASK,
      status: 'awaiting_confirm',
      gate: { actions: [{ id: 'approve', label: 'Approve & promote', kind: 'confirm', route: '/confirm' }], flag: 'promote_review' },
    });
    await pollBgTick();
    const item = bgDistills.value.find((b) => b.key === key)!;
    expect(item.status).toBe('awaiting_confirm');
    expect(item.gate?.flag).toBe('promote_review');
  });

  test('confirmBg posts to the bg taskId without touching task.value', async () => {
    promoteMock.mockResolvedValue({ ...PROMOTE_TASK, status: 'awaiting_confirm', gate: { actions: [{ id: 'approve', label: 'Approve', kind: 'confirm', route: '/confirm' }], flag: 'promote_review' } });
    const key = promote('proj', 'my-flow');
    await flush();
    confirmMock.mockResolvedValue({ ...PROMOTE_TASK, status: 'done', gate: { actions: [] } });
    await confirmBg(key, 'approve');
    expect(confirmMock).toHaveBeenCalledWith('1700000000001', 'approve');
    expect(task.value).toBeNull(); // never opened foreground
    expect(bgDistills.value.find((b) => b.key === key)!.status).toBe('done');
  });

  test('queued item is retried by the poll when the lane frees', async () => {
    promoteMock.mockRejectedValueOnce(new ApiError(409, 'busy'));
    const key = promote('proj', 'my-flow');
    await flush();
    expect(bgDistills.value.find((b) => b.key === key)!.status).toBe('queued');
    promoteMock.mockResolvedValueOnce(PROMOTE_TASK); // lane freed
    await pollBgTick();
    expect(bgDistills.value.find((b) => b.key === key)!.status).toBe('running');
  });

  test('setBgTestMode persists the switch (localStorage) so it survives reload', () => {
    setBgTestMode(true);
    expect(bgTestMode.value).toBe(true);
    expect(localStorage.getItem('builder:testDistill')).toBe('1');
    setBgTestMode(false);
    expect(bgTestMode.value).toBe(false);
    expect(localStorage.getItem('builder:testDistill')).toBe('0');
  });

  test('bgTestMode ON → promote() carries test:true through to api.promote', async () => {
    promoteMock.mockResolvedValue({ ...PROMOTE_TASK, promote: { ...PROMOTE_TASK.promote, test: true } });
    bgTestMode.value = true;
    const key = promote('proj', 'my-flow');
    await flush();
    expect(promoteMock).toHaveBeenCalledWith({ project: 'proj', workflow: 'my-flow', test: true });
    expect(bgDistills.value.find((b) => b.key === key)!.test).toBe(true);
  });

  test('clearTestDistills undoes finalized tests, cancels in-flight tests, keeps non-test items', async () => {
    bgDistills.value = [
      { key: 'k1', taskId: 't1', slug: 'a', status: 'done', sourceKind: 'local', req: { project: 'p', workflow: 'a' }, test: true },
      { key: 'k2', taskId: 't2', slug: 'b', status: 'awaiting_confirm', sourceKind: 'local', req: { project: 'p', workflow: 'b' }, test: true },
      { key: 'k3', taskId: 't3', slug: 'c', status: 'done', sourceKind: 'local', req: { project: 'p', workflow: 'c' } },
    ];
    undoMock.mockResolvedValue({ ok: true, removed: true });
    cancelMock.mockResolvedValue({});
    await clearTestDistills();
    expect(undoMock).toHaveBeenCalledWith('t1'); // finalized test → undo (unlink)
    expect(cancelMock).toHaveBeenCalledWith('t2'); // in-flight test → cancel
    expect(bgDistills.value.map((b) => b.key)).toEqual(['k3']); // only the non-test item survives
  });

  test('undoBg posts to /undo-promote and drops the tray item', async () => {
    promoteMock.mockResolvedValue({ ...PROMOTE_TASK, status: 'done', gate: { actions: [] } });
    const key = promote('proj', 'my-flow');
    await flush();
    undoMock.mockResolvedValue({ ok: true, removed: true });
    await undoBg(key);
    expect(undoMock).toHaveBeenCalledWith('1700000000001');
    expect(bgDistills.value.find((b) => b.key === key)).toBeUndefined(); // dropped after undo
  });
});

describe('store.restoreBgDistills (spec 084 §7 Q2 — reload persistence)', () => {
  test('rebuilds the tray from non-terminal promote tasks; skips terminal + non-promote', async () => {
    activeMock.mockResolvedValueOnce({ active: [{ id: 'p-parked' }, { id: 'p-done' }, { id: 'b-build' }] } as any);
    getTaskMock.mockImplementation(async (id: string) => {
      if (id === 'p-parked') return { ...PROMOTE_TASK, taskId: 'p-parked', status: 'awaiting_confirm', gate: { actions: [], flag: 'promote_review' }, promote: { ...PROMOTE_TASK.promote, slug: 'parked-flow' } };
      if (id === 'p-done') return { ...PROMOTE_TASK, taskId: 'p-done', status: 'done', gate: { actions: [] } };
      return { ...PROMOTE_TASK, taskId: 'b-build', kind: 'build' }; // a plain build, not a promote
    });
    await restoreBgDistills();
    const restored = bgDistills.value;
    expect(restored.length).toBe(1); // only the parked promote
    expect(restored[0].taskId).toBe('p-parked');
    expect(restored[0].slug).toBe('parked-flow');
    expect(restored[0].status).toBe('awaiting_confirm');
    expect(task.value).toBeNull(); // restore never opens anything foreground
  });

  test('does not duplicate a distill already in the tray', async () => {
    promoteMock.mockResolvedValue(PROMOTE_TASK); // taskId 1700000000001
    promote('proj', 'my-flow');
    await flush();
    activeMock.mockResolvedValueOnce({ active: [{ id: '1700000000001' }] } as any);
    await restoreBgDistills();
    expect(bgDistills.value.filter((b) => b.taskId === '1700000000001').length).toBe(1);
  });
});

describe('store.removeTask (spec 084 follow-up — the sidebar row-× hard delete)', () => {
  test('DELETEs the task, drops it from the tray, and refreshes the lists', async () => {
    promoteMock.mockResolvedValue(PROMOTE_TASK);
    promote('proj', 'my-flow'); // taskId 1700000000001, lands in the tray
    await flush();
    deleteMock.mockResolvedValue({ ok: true });
    consultsMock.mockClear();
    promotesMock.mockClear();
    await removeTask('1700000000001');
    expect(deleteMock).toHaveBeenCalledWith('1700000000001');
    expect(bgDistills.value.find((b) => b.taskId === '1700000000001')).toBeUndefined(); // dropped from tray
    expect(consultsMock).toHaveBeenCalled(); // lists refreshed
    expect(promotesMock).toHaveBeenCalled();
  });

  test('a 409 (turn running) surfaces the error and does NOT drop the row', async () => {
    promoteMock.mockResolvedValue(PROMOTE_TASK);
    promote('proj', 'my-flow');
    await flush();
    deleteMock.mockRejectedValue(new ApiError(409, 'turn running — cancel first'));
    await removeTask('1700000000001');
    expect(startError.value).toContain('cancel first');
    expect(bgDistills.value.find((b) => b.taskId === '1700000000001')).toBeDefined(); // still there
  });

  test('removeProject DELETEs the project and refreshes the tree', async () => {
    deleteProjectMock.mockResolvedValue({ ok: true, tasksRemoved: 3 });
    treeMock.mockClear();
    await removeProject('junk');
    expect(deleteProjectMock).toHaveBeenCalledWith('junk');
    expect(treeMock).toHaveBeenCalled();
    expect(startError.value).toBeNull();
  });

  test('removeProject on _drafts (400) surfaces the error, no crash', async () => {
    deleteProjectMock.mockRejectedValue(new ApiError(400, 'the _drafts scratch area is a system project'));
    await removeProject('_drafts');
    expect(startError.value).toContain('system project');
  });

  test('removeWorkflow DELETEs the (project, workflow) and refreshes the tree', async () => {
    deleteWorkflowMock.mockResolvedValue({ ok: true, tasksRemoved: 2 });
    treeMock.mockClear();
    await removeWorkflow('_drafts', 'junk_flow');
    expect(deleteWorkflowMock).toHaveBeenCalledWith('_drafts', 'junk_flow');
    expect(treeMock).toHaveBeenCalled();
    expect(startError.value).toBeNull();
  });
});

describe('store.loadPromotes (spec 084 S1.5 — the 蒸留 sidebar section)', () => {
  test('populates the promotes signal from GET /api/promotes', async () => {
    promotesMock.mockResolvedValueOnce({ promotes: [{ id: 'p1', name: 'Distill x', time: '1h', status: 'done', phase: 'test' }] } as any);
    await loadPromotes();
    expect(promotes.value.map((p) => p.id)).toEqual(['p1']);
  });
});

describe('openTask on a finished promote (spec 084 B — replay the distill narrative)', () => {
  test('rebuilds the thread from distillLog: a run disclosure carrying the reasoning', async () => {
    try { localStorage.clear(); } catch { /* jsdom */ }
    getTaskMock.mockResolvedValue({
      ...PROMOTE_TASK,
      status: 'done',
      gate: { actions: [] },
      promote: { ...PROMOTE_TASK.promote, distillLog: 'Genericized the token into a placeholder.' },
    });
    await openTask('1700000000001');
    const run = thread.value.find((i) => i.kind === 'run');
    expect(run).toBeDefined();
    expect((run as { output: string }).output).toContain('Genericized the token');
    // the user bubble is still first, and the terminal gate card is appended below the disclosure
    expect(thread.value[0].kind).toBe('user');
    expect(thread.value.some((i) => i.kind === 'gate')).toBe(true);
  });
});

describe('store.promoteExternalYaml (spec 084)', () => {
  test('400 (bad YAML) → returns {error} inline and drops the tray item', async () => {
    promoteMock.mockRejectedValue(new ApiError(400, 'linter rejected the YAML'));
    const res = await promoteExternalYaml({ yaml: 'bad: yaml' });
    expect(res).toEqual({ error: 'linter rejected the YAML' });
    expect(bgDistills.value.length).toBe(0); // no lingering tray item
  });

  test('success → true and lands in the tray', async () => {
    promoteMock.mockResolvedValue({ ...PROMOTE_TASK, promote: { ...PROMOTE_TASK.promote, slug: 'pasted-flow' } });
    const res = await promoteExternalYaml({ yaml: 'app:\n  name: x', sourceLabel: 'x.yml' });
    expect(res).toBe(true);
    expect(bgDistills.value.length).toBe(1);
    expect(bgDistills.value[0].slug).toBe('pasted-flow');
  });
});
