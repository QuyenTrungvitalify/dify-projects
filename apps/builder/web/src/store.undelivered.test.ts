/**
 * An undelivered message lives in ONE place (spec 109).
 *
 * The field case: a send met the server's turn lock, the banner said "try again in a moment", and each
 * retry left one more copy of the same sentence in the thread — three identical bubbles for zero turns.
 * The thread is persisted and rebuilt on reopen, so those copies outlived the moment and read, forever
 * after, as three requests the build had ignored.
 *
 * The rule these tests pin: when a dispatch fails, the words go back to the composer (the caller's
 * `false`, spec 040 D2) and NOTHING is left in the thread — history records what was sent, never what
 * was merely attempted.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { api, ApiError } from './api';
import { start, reply, ask, confirm, task, thread, asking, resetToNew, startError, busyHolder } from './store';
import type { LiveThreadItem } from './store';
import { t as tr, lang } from './lib/i18n';
import type { WireTask } from './types';

const mk = (status: WireTask['status'] = 'awaiting_confirm'): WireTask =>
  ({
    taskId: 't1', project: null, workflow: null, workflowFile: 'main.yml', requirement: 'r',
    seedPath: null, deploy: 'none', confirmMode: 'each_step', phase: 'spec', status,
    workflowSlug: null, name: null, sessionIds: {}, artifacts: {}, rev: 1,
  }) as WireTask;

const busy = (): ApiError => new ApiError(409, 'a turn is already running — try again in a moment');
const users = (): LiveThreadItem[] => thread.value.filter((i) => i.kind === 'user');

afterEach(() => {
  vi.restoreAllMocks();
  resetToNew();
  startError.value = null;
  busyHolder.value = null;
  asking.value = false;
  lang.value = 'en';
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('a failed dispatch leaves no trace in the thread', () => {
  it('reply(): three turn-busy retries add nothing — the field case, inverted', async () => {
    task.value = mk();
    thread.value = [];
    vi.spyOn(api, 'reply').mockRejectedValue(busy());
    for (let i = 0; i < 3; i++) {
      expect(await reply('review lai workflow', 'Requested changes')).toBe(false);
    }
    expect(thread.value).toEqual([]); // was: 3 identical bubbles for 0 turns
  });

  it('ask(): a failed question takes its answer bubble with it', async () => {
    task.value = mk();
    thread.value = [];
    vi.spyOn(api, 'ask').mockRejectedValue(busy());
    expect(await ask('what does this workflow do?')).toBe(false);
    expect(thread.value).toEqual([]); // neither the question nor a qa bubble holding the error
    expect(asking.value).toBe(false); // and the composer is usable again
  });

  it('start(): a build that was never created leaves no requirement bubble', async () => {
    thread.value = [];
    vi.spyOn(api, 'createTask').mockRejectedValue(busy());
    expect(await start('summarize a topic')).toBe(false);
    expect(thread.value).toEqual([]);
  });

  it('rolls back BY ID: an item that arrived over SSE mid-flight survives', async () => {
    task.value = mk();
    thread.value = [];
    const sseItem: LiveThreadItem = { id: 'sse-1', kind: 'run', phase: 'spec', running: true, output: 'live' };
    // The await spans a real event: the stream appends a run item, THEN the POST rejects. A rollback
    // that cut by position/length would eat this item instead of the bubble it pushed.
    vi.spyOn(api, 'reply').mockImplementation(async () => {
      thread.value = [...thread.value, sseItem];
      throw busy();
    });
    expect(await reply('add a 5th sentiment level', 'Requested changes')).toBe(false);
    expect(thread.value).toEqual([sseItem]);
  });
});

describe('the delivered path is untouched', () => {
  it('reply(): a message the server accepted stays in the thread', async () => {
    task.value = mk();
    thread.value = [];
    vi.spyOn(api, 'reply').mockResolvedValue(mk('running') as never);
    expect(await reply('add a 5th sentiment level', 'Requested changes')).toBe(true);
    expect(users().map((i) => (i as { text: string }).text)).toEqual(['add a 5th sentiment level']);
  });

  it('ask(): an accepted question keeps its bubble AND its open answer', async () => {
    task.value = mk();
    thread.value = [];
    vi.spyOn(api, 'ask').mockResolvedValue({ ok: true } as never);
    expect(await ask('what does this workflow do?')).toBe(true);
    expect(thread.value.map((i) => i.kind)).toEqual(['user', 'qa']);
    expect(asking.value).toBe(true); // the ask:done SSE settles it, as before
  });
});

describe('a turn collision says so in the reader’s language', () => {
  it('the raw English server string never reaches the banner', async () => {
    task.value = mk();
    lang.value = 'ja';
    vi.spyOn(api, 'reply').mockRejectedValue(busy());
    await reply('x', 'Requested changes');
    expect(startError.value).toBe(tr('turnBusy'));
    expect(startError.value).not.toContain('a turn is already running');
  });

  it('every OTHER 409 still passes through verbatim', async () => {
    task.value = mk();
    vi.spyOn(api, 'reply').mockRejectedValue(new ApiError(409, 'task is done, not awaiting_confirm'));
    await reply('x', 'Requested changes');
    expect(startError.value).toBe('task is done, not awaiting_confirm');
  });

  it('keeps the jump to whichever build holds the turn', async () => {
    task.value = mk();
    vi.spyOn(api, 'reply').mockRejectedValue(
      new ApiError(409, 'a turn is already running — try again in a moment', 'other-task')
    );
    await reply('x', 'Requested changes');
    expect(busyHolder.value).toBe('other-task');
  });
});

describe('the banner does not outlive the collision it described', () => {
  it('a send that goes through clears the previous "turn is running"', async () => {
    task.value = mk();
    thread.value = [];
    startError.value = tr('turnBusy'); // the previous attempt collided
    vi.spyOn(api, 'reply').mockResolvedValue(mk('running') as never);
    expect(await reply('add a 5th sentiment level', 'Requested changes')).toBe(true);
    expect(startError.value).toBe(null); // was: a live-looking warning about a turn that already ended
  });

  it('a gate action that goes through clears it too — the field case clicked exactly here', async () => {
    task.value = mk();
    startError.value = tr('turnBusy');
    vi.spyOn(api, 'confirm').mockResolvedValue(mk('running') as never);
    await confirm({ id: 'approve', label: 'Approve', kind: 'confirm' } as never);
    expect(startError.value).toBe(null);
  });

  it('but a fresh collision still raises it', async () => {
    task.value = mk();
    vi.spyOn(api, 'reply').mockRejectedValue(busy());
    await reply('x', 'Requested changes');
    expect(startError.value).toBe(tr('turnBusy'));
  });
});

describe('a second ask while one is live refuses OUT LOUD', () => {
  it('no request, no bubble — but a banner that explains it', async () => {
    task.value = mk();
    thread.value = [];
    asking.value = true;
    const spy = vi.spyOn(api, 'ask');
    expect(await ask('a second question')).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(thread.value).toEqual([]);
    expect(startError.value).toBe(tr('turnBusy')); // was: silence — the send appeared to vanish
    expect(busyHolder.value).toBe(null); // the holder IS this task; a jump would go nowhere
  });
});
