/**
 * The chat history keeps the files a message carried. Before this, `store.reply`/`store.ask` pushed a
 * TEXT-ONLY user bubble, so an attached screenshot was visible in the composer and then gone forever the
 * instant it was sent. Two halves, both asserted here:
 *   - the bubble carries the attachments (name/mime + the in-memory dataUrl → instant thumbnail), and
 *   - the POST's `uploads` indices are STAMPED onto it (that is what survives a reload, since the bytes
 *     are stripped on persist and the history then reads GET /api/tasks/:id/uploads/:idx).
 * `./api` is mocked; `./sse-client` stubbed (no EventSource).
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { WireTask } from './types';
import type { Attachment } from './api';

const { replyMock, askMock, activeMock, getTaskMock, connectMock } = vi.hoisted(() => ({
  replyMock: vi.fn(),
  askMock: vi.fn(),
  activeMock: vi.fn(async () => ({ active: [] })),
  getTaskMock: vi.fn(),
  connectMock: vi.fn(() => () => {}),
}));

vi.mock('./api', async (importActual) => {
  const actual = await importActual<typeof import('./api')>();
  return {
    ...actual,
    api: { ...actual.api, reply: replyMock, ask: askMock, active: activeMock, getTask: getTaskMock },
  };
});
vi.mock('./sse-client', () => ({ connectSSE: connectMock }));

import { reply, ask, task, thread, asking, type LiveThreadItem } from './store';

const mk = (status: WireTask['status'] = 'awaiting_confirm'): WireTask =>
  ({
    taskId: 'T1', project: null, workflow: null, workflowFile: 'main.yml', requirement: 'r',
    seedPath: null, deploy: 'none', confirmMode: 'each_step', phase: 'spec', status,
    workflowSlug: null, name: null, sessionIds: {}, artifacts: {}, rev: 1,
    gate: { actions: [{ id: 'edit', label: 'Edit spec', kind: 'reply', route: '/reply' }] },
  }) as WireTask;

const FILES: Attachment[] = [
  { name: 'shot.png', mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA' },
  { name: 'notes.txt', mime: 'text/plain', dataUrl: 'data:text/plain;base64,BBBB' },
];

const lastUser = (): LiveThreadItem & { kind: 'user' } =>
  [...thread.value].reverse().find((i) => i.kind === 'user') as LiveThreadItem & { kind: 'user' };

beforeEach(() => {
  replyMock.mockReset();
  askMock.mockReset();
  activeMock.mockClear();
  task.value = null;
  thread.value = [];
  asking.value = false;
});

describe('store.reply — the user bubble keeps its files', () => {
  test('bubble carries name/mime/dataUrl and gets the server indices stamped on', async () => {
    const t = mk();
    task.value = t;
    replyMock.mockResolvedValue({ ...t, status: 'running', uploads: [4, 5] });

    expect(await reply('please fix this', 'Edit spec', FILES)).toBe(true);

    expect(lastUser().atts).toEqual([
      { name: 'shot.png', mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA', idx: 4 },
      { name: 'notes.txt', mime: 'text/plain', dataUrl: 'data:text/plain;base64,BBBB', idx: 5 },
    ]);
  });

  test('no files → no atts on the bubble (unchanged shape)', async () => {
    const t = mk();
    task.value = t;
    replyMock.mockResolvedValue({ ...t, status: 'running' });

    await reply('just words', 'Edit spec');

    expect(lastUser().atts).toBeUndefined();
  });

  test('a response without `uploads` leaves the in-memory preview usable (no idx, no crash)', async () => {
    const t = mk();
    task.value = t;
    replyMock.mockResolvedValue({ ...t, status: 'running' }); // older server / no echo

    await reply('here', 'Edit spec', FILES);

    expect(lastUser().atts?.map((a) => a.idx)).toEqual([undefined, undefined]);
    expect(lastUser().atts?.[0].dataUrl).toBe('data:image/png;base64,AAAA');
  });
});

describe('store.ask — an Ask at a gate keeps its files too', () => {
  test('the question bubble carries the files and is stamped from the ask response', async () => {
    task.value = mk();
    askMock.mockResolvedValue({ ok: true, uploads: [0] });

    expect(await ask('what is wrong here?', [FILES[0]])).toBe(true);

    expect(askMock).toHaveBeenCalledWith('T1', 'what is wrong here?', [FILES[0]]);
    expect(lastUser().atts).toEqual([
      { name: 'shot.png', mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA', idx: 0 },
    ]);
  });
});
