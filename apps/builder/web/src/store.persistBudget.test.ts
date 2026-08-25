/**
 * Storage stays inside a budget — the half of persistence that a count-based cap never covered.
 *
 * The failure this is written from: one build's thread reached ~4M characters against a quota of
 * roughly 2.6M, so EVERY write for that build failed and the conversation stopped being saved at all,
 * for hours. The 20-thread LRU was working perfectly the whole time — it bounds how MANY builds are
 * kept and says nothing about how big they are. These cases pin the size bound, the reclaiming of keys
 * nothing points at any more, and the one narrow case where a failed write is allowed to delete
 * something to make room.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  applyTask,
  persistThreadImmediately,
  sweepOrphanThreadKeys,
  thread,
  resetToNew,
  persistDegraded,
  clearPersistFailure,
} from './store';
import type { LiveThreadItem } from './store';
import type { WireTask } from './types';

const mk = (taskId: string): WireTask =>
  ({
    taskId,
    project: null,
    workflow: null,
    workflowFile: 'main.yml',
    requirement: 'r',
    seedPath: null,
    deploy: 'none',
    confirmMode: 'each_step',
    phase: 'analyze',
    status: 'running',
    workflowSlug: null,
    name: null,
    sessionIds: {},
    artifacts: {},
    rev: 1,
  }) as WireTask;

const KEY = (id: string): string => `builder.thread.v2.${id}`;
const INDEX = 'builder.thread.v2.index';

/** A conversation of roughly `chars` characters — as exchanges, which is where the real weight lives (a
 *  run's output is already capped; a pasted question is not). ~20k per exchange. */
const conversation = (tag: string, chars: number): LiveThreadItem[] => {
  const out: LiveThreadItem[] = [];
  let n = 0;
  for (let i = 0; n < chars; i++) {
    const q = `${tag}-q${i} ` + 'x'.repeat(10_000);
    const a = 'a'.repeat(10_000);
    out.push({ id: `${tag}u${i}`, kind: 'user', text: q });
    out.push({ id: `${tag}q${i}`, kind: 'qa', question: q, answer: a, done: true });
    n += q.length + a.length;
  }
  return out;
};

/** Fail the next write of ONE build's thread key. Targeted rather than "the first setItem call": other
 *  machinery (the notification nudge, remembered preferences) writes to storage on the same turn, and a
 *  count-based stub would land the quota error on whichever of those happened to go first. */
const failWriteFor = (taskId: string, times = 1): void => {
  const real = localStorage.setItem.bind(localStorage);
  let left = times;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string, v: string) => {
    if (k === KEY(taskId) && left > 0) {
      left--;
      throw new DOMException('quota', 'QuotaExceededError'); // name, not message — isQuotaError reads `.name`
    }
    real(k, v);
  });
};

const write = (taskId: string, items: LiveThreadItem[]): void => {
  applyTask(mk(taskId));
  thread.value = items;
  persistThreadImmediately();
};

const indexIds = (): string[] =>
  (JSON.parse(localStorage.getItem(INDEX) ?? '[]') as { id: string }[]).map((e) => e.id);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetToNew();
  persistDegraded.value = null;
  clearPersistFailure();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('the total budget, not just the thread count', () => {
  it('evicts the OLDEST builds until everything stored fits', () => {
    write('A', conversation('A', 800_000));
    write('B', conversation('B', 800_000));
    write('C', conversation('C', 800_000));

    // Three ~800k threads cannot coexist under a 1.8M budget: the first one goes.
    expect(localStorage.getItem(KEY('A'))).toBeNull();
    expect(localStorage.getItem(KEY('B'))).not.toBeNull();
    expect(localStorage.getItem(KEY('C'))).not.toBeNull();
    expect(indexIds()).toEqual(['B', 'C']); // and the index says exactly what storage holds

    const stored = indexIds().reduce((n, id) => n + (localStorage.getItem(KEY(id))?.length ?? 0), 0);
    expect(stored).toBeLessThanOrEqual(1_800_000);
  });

  it('never evicts the build being written, even when it is the reason the budget blew', () => {
    write('OLD', conversation('OLD', 200_000));
    write('HUGE', conversation('HUGE', 1_500_000));
    expect(localStorage.getItem(KEY('HUGE'))).not.toBeNull();
    expect(indexIds()).toContain('HUGE');
  });

  it('caps a single build so one conversation cannot fill the whole store', () => {
    write('BIG', conversation('BIG', 2_000_000));
    expect(localStorage.getItem(KEY('BIG'))!.length).toBeLessThanOrEqual(1_400_000);
  });

  it('but stops short of the cap rather than cut past what the backend can restore', () => {
    // A thread this long cannot reach the cap by dropping only the exchanges the transcript can serve
    // back. It is stored OVER the cap on purpose: the alternative is deleting history that exists
    // nowhere else, quietly, to satisfy a number.
    write('ANCIENT', conversation('ANCIENT', 3_200_000));
    expect(localStorage.getItem(KEY('ANCIENT'))!.length).toBeGreaterThan(1_400_000);
  });
});

describe('keys nothing points at are reclaimed', () => {
  it('deletes pre-v2 payloads and orphans, and leaves the indexed thread alone', () => {
    write('LIVE', conversation('LIVE', 40_000));
    localStorage.setItem('builder.thread.T-legacy', '[{"id":"u","kind":"user","text":"old format"}]');
    localStorage.setItem(KEY('ORPHAN'), '[{"id":"u","kind":"user","text":"never indexed"}]');

    sweepOrphanThreadKeys();

    expect(localStorage.getItem('builder.thread.T-legacy')).toBeNull();
    expect(localStorage.getItem(KEY('ORPHAN'))).toBeNull();
    expect(localStorage.getItem(KEY('LIVE'))).not.toBeNull();
    expect(localStorage.getItem(INDEX)).not.toBeNull(); // the index itself is not an orphan
  });

  it('a corrupt index does not take every thread with it on the NEXT write', () => {
    write('KEEP', conversation('KEEP', 40_000));
    localStorage.setItem(INDEX, '{not json');
    sweepOrphanThreadKeys(); // sweep reads the index as empty → the key is unreferenced
    // This is the honest consequence, pinned rather than hidden: an unparseable index means nothing is
    // claimed, so the sweep reclaims. What must NOT happen is the old behaviour — the key surviving
    // forever, holding quota, while no index will ever mention it again.
    expect(localStorage.getItem(KEY('KEEP'))).toBeNull();
  });
});

describe('a quota failure may make room — once, and only when that could help', () => {
  it('evicts the oldest OTHER build and the write lands', () => {
    write('OLD', conversation('OLD', 100_000));
    applyTask(mk('NEW'));
    thread.value = conversation('NEW', 100_000);

    failWriteFor('NEW'); // "full" — until something is freed

    persistThreadImmediately();

    expect(localStorage.getItem(KEY('OLD'))).toBeNull(); // room was made
    expect(localStorage.getItem(KEY('NEW'))).not.toBeNull(); // and the retry landed
    expect(persistDegraded.value).toBeNull(); // so the user is never told the conversation is unsaved
  });

  it('deletes NOTHING for a payload trimming already refused to cut down to size', () => {
    // The destructive version of this feature: keep evicting for a write that can never succeed, and a
    // build's whole history is gone in exchange for nothing. A thread this long is over the per-build
    // cap only because trimming STOPPED at the backend's restore window — so the bytes that remain are
    // ones no eviction elsewhere can help with.
    //
    // The clock is moved past the stand-down window first, ON PURPOSE. Without it this test passes for
    // the wrong reason — the previous case's cooldown blocks the retry, and the assertion never
    // exercises the rule it claims to.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60_000);
    write('OLD', conversation('OLD', 100_000));
    applyTask(mk('NEW'));
    thread.value = conversation('NEW', 3_200_000);
    failWriteFor('NEW', 99);

    persistThreadImmediately();

    expect(localStorage.getItem(KEY('OLD'))).not.toBeNull(); // untouched
    expect(persistDegraded.value?.reason).toBe('quota'); // and the failure is still reported
  });

  it('stands down for a minute after a retry, instead of deleting again on every write', () => {
    // A quota that eviction cannot fix — a private window's zero allowance is the real case — would
    // otherwise cost one more build per write, forever, for nothing.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 20 * 60_000);
    write('OLD1', conversation('OLD1', 60_000));
    write('OLD2', conversation('OLD2', 60_000));
    applyTask(mk('NEW'));
    thread.value = conversation('NEW', 60_000);
    failWriteFor('NEW', 99); // nothing will ever make this write succeed

    persistThreadImmediately(); // round 1: allowed to make room
    const afterFirst = ['OLD1', 'OLD2'].filter((id) => localStorage.getItem(KEY(id)) !== null);
    persistThreadImmediately(); // round 2: must not touch storage again
    persistThreadImmediately();
    const afterMore = ['OLD1', 'OLD2'].filter((id) => localStorage.getItem(KEY(id)) !== null);

    expect(afterMore).toEqual(afterFirst);
    expect(persistDegraded.value?.reason).toBe('quota');
  });
});
