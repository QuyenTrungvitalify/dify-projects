/**
 * Spec 099 S1 / 101 §3.1 — the openTask wiring around `backfillFromTranscript`.
 *
 * The pure diff is covered in `lib/ask-backfill.test.ts`. What is left here is the part that only exists
 * because the fetch resolves LATER than the code that started it, and both guards below are the kind of
 * bug that ships green: the thread simply looks slightly wrong, or belongs to another build.
 *
 * `./api` is mocked and `./sse-client` stubbed (no EventSource); the transcript fetch is a deferred
 * promise so a test can decide exactly when — and in what order — it lands.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WireTask } from './types';
import type { LiveThreadItem } from './store';

const { getTaskMock, getTaskChatMock, connectMock, activeMock } = vi.hoisted(() => ({
  getTaskMock: vi.fn(),
  getTaskChatMock: vi.fn(),
  connectMock: vi.fn(() => () => {}),
  activeMock: vi.fn(async () => ({ active: [] })),
}));

vi.mock('./api', async (importActual) => {
  const actual = await importActual<typeof import('./api')>();
  return {
    ...actual,
    api: { ...actual.api, getTask: getTaskMock, getTaskChat: getTaskChatMock, active: activeMock },
  };
});
vi.mock('./sse-client', () => ({ connectSSE: connectMock }));

import { applyTask, openTask, task, thread, resetToNew } from './store';

/**
 * A build parked at a gate — the shape a reopen lands on.
 *
 * `artifactContents` is NOT decoration. At a gate `applyTask` re-fetches when the snapshot lacks it
 * (`api.getTask(id).then(applyTask)`), so a mock that always resolves the same content-less snapshot
 * recurses forever: the run dies with an out-of-memory kill and no test output at all. In production the
 * real GET carries the contents and the re-fetch happens once. Cost an OOM to learn; pinned here so the
 * next person writing an openTask test does not pay it again.
 */
const mk = (taskId: string, over: Partial<WireTask> = {}): WireTask =>
  ({
    taskId, project: null, workflow: null, workflowFile: 'main.yml', requirement: 'build me a thing',
    seedPath: null, deploy: 'none', confirmMode: 'each_step', phase: 'test', status: 'awaiting_confirm',
    workflowSlug: null, name: null, sessionIds: {}, artifacts: {}, rev: 1,
    artifactContents: {},
    ...over,
  }) as WireTask;

const chatOf = (...qs: string[]) =>
  qs.flatMap((q) => [{ role: 'user' as const, text: q }, { role: 'assistant' as const, text: `answer to ${q}` }]);

const questions = (): string[] =>
  thread.value.filter((i): i is LiveThreadItem & { kind: 'qa' } => i.kind === 'qa').map((i) => i.question);

/** A promise this test resolves by hand, so the landing order is under its control, not the runtime's. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Let every pending microtask (the un-awaited backfill chain) run to completion. */
const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

beforeEach(() => {
  getTaskMock.mockReset();
  getTaskChatMock.mockReset();
  try { localStorage.clear(); } catch { /* ignore */ }
  resetToNew();
});
afterEach(() => {
  resetToNew();
  vi.restoreAllMocks();
});

describe('openTask backfills a build whose localStorage thread is gone (spec 099 S1)', () => {
  test('a build with no cached thread gets its exchanges back, and reports what it had', async () => {
    getTaskMock.mockResolvedValue(mk('T1'));
    getTaskChatMock.mockResolvedValue({ chat: chatOf('q1', 'q2') });

    await openTask('T1');
    await settle();

    expect(questions()).toEqual(['q1', 'q2']);
    expect(getTaskChatMock).toHaveBeenCalledWith('T1', 0);
  });

  test('`have` carries the count this browser already holds — the number the gap line is measured against', async () => {
    // Seed a cached thread with one exchange, so `have` must be 1 and only the second is restored.
    localStorage.setItem('builder.thread.T2', JSON.stringify([
      { id: 'u', kind: 'user', text: 'build me a thing' },
      { id: 'q', kind: 'qa', question: 'q1', answer: 'kept', done: true },
    ]));
    getTaskMock.mockResolvedValue(mk('T2'));
    getTaskChatMock.mockResolvedValue({ chat: chatOf('q1', 'q2') });

    await openTask('T2');
    await settle();

    expect(getTaskChatMock).toHaveBeenCalledWith('T2', 1);
    expect(questions()).toEqual(['q1', 'q2']);
    const kept = thread.value.find((i) => i.kind === 'qa') as LiveThreadItem & { kind: 'qa' };
    expect(kept.answer).toBe('kept'); // the cached copy wins; the transcript never overwrites
  });

  test('GUARD 2 — the view moved on: one build’s conversation must never land on another', async () => {
    // The worst failure this whole slice could produce, and it looks completely real on screen.
    const d = deferred<{ chat: ReturnType<typeof chatOf> }>();
    getTaskMock.mockResolvedValue(mk('T-slow'));
    getTaskChatMock.mockReturnValue(d.promise);

    await openTask('T-slow'); // its transcript request is now in flight…

    getTaskMock.mockResolvedValue(mk('T-other'));
    getTaskChatMock.mockResolvedValue({ chat: [] });
    await openTask('T-other'); // …and the user switched builds
    await settle();

    d.resolve({ chat: chatOf('secret question from the other build') }); // now it lands
    await settle();

    expect(task.value?.taskId).toBe('T-other');
    expect(questions()).toEqual([]);
    expect(thread.value.some((i) => i.kind === 'user' && i.text.includes('secret question'))).toBe(false);
  });

  test('GUARD 1 — the thread changes MID-FLIGHT and the change survives the merge', async () => {
    // The window that matters is between reading `thread.value` and the transcript landing: the stream is
    // live the whole time, so a phase can start, a gate can arrive, output can stream. Merging onto the
    // array captured before the await would silently drop every one of those.
    //
    // A first draft of this test asserted only that the gate card pushed by `applyTask` survived — and it
    // passed even with the guard deliberately broken, because that card is already in place before the
    // fetch begins. Decorative. The mutation has to happen WHILE the request is in flight.
    const d = deferred<{ chat: ReturnType<typeof chatOf> }>();
    getTaskMock.mockResolvedValue(mk('T3'));
    getTaskChatMock.mockReturnValue(d.promise);

    await openTask('T3');
    const beforeLen = thread.value.length;

    // A phase starts while we wait — a `task:update` the live stream delivers. applyTask pushes a
    // running `run` item for it, which is a real thread mutation inside the exact window under test.
    applyTask(mk('T3', { status: 'running', phase: 'implement', rev: 2 }));
    const midLen = thread.value.length;
    expect(midLen).toBeGreaterThan(beforeLen); // precondition: the thread really did change

    d.resolve({ chat: chatOf('q1') });
    await settle();

    const streamed = thread.value.find((i) => i.kind === 'run' && i.phase === 'implement');
    expect(streamed, 'the mid-flight change must not be merged away').toBeDefined();
    expect(questions()).toEqual(['q1']);
    expect(thread.value.length).toBe(midLen + 2); // the two restored items, on top of what was there
  });

  test('nothing missing → the thread is left ALONE, same array reference (no signal write)', async () => {
    localStorage.setItem('builder.thread.T4', JSON.stringify([
      { id: 'q', kind: 'qa', question: 'q1', answer: 'a', done: true },
    ]));
    getTaskMock.mockResolvedValue(mk('T4'));
    getTaskChatMock.mockResolvedValue({ chat: chatOf('q1') });

    await openTask('T4');
    const before = thread.value;
    await settle();

    expect(thread.value).toBe(before); // identity — waking the persist effect for nothing is the S1b bug
  });

  test('a failing / empty transcript is a silent no-op — opening a task must never get worse', async () => {
    getTaskMock.mockResolvedValue(mk('T5'));
    // `mockImplementation`, not `mockRejectedValue`: the latter constructs the rejected promise at
    // set-up time, so if anything defers the call the runtime sees an unhandled rejection and kills the
    // worker before a single assertion runs. Built at CALL time it is awaited inside the try/catch.
    getTaskChatMock.mockImplementation(() => Promise.reject(new Error('offline')));

    await openTask('T5');
    const before = thread.value;
    await settle();
    expect(thread.value).toBe(before);

    getTaskChatMock.mockResolvedValue({ chat: [] });
    await openTask('T5');
    const after = thread.value;
    await settle();
    expect(thread.value).toBe(after);
  });

  test('the "earlier attempts not shown" notice opens by itself too — same reasoning, same flag', async () => {
    // `buildThreadFromRuns` emits its own notice when the server capped the attempt list. It is the same
    // shape of thing as the restored-from-disk marker — one line whose only job is to be read — and it
    // had the same defect: collapsed behind a strip labelled with a phase number. Fixed for both, so a
    // reader never has to already suspect an omission in order to find out about it.
    getTaskMock.mockResolvedValue(mk('T-dropped', {
      runs: [{ phase: 'implement', output: 'attempt 4 output' }],
      runsDropped: 3,
    } as unknown as Partial<WireTask>));
    getTaskChatMock.mockResolvedValue({ chat: [] });

    await openTask('T-dropped');
    await settle();

    const runs = thread.value.filter((i): i is LiveThreadItem & { kind: 'run' } => i.kind === 'run');
    const notice = runs.find((r) => r.output.includes('earlier attempt(s) not shown'));
    const realRun = runs.find((r) => r.output === 'attempt 4 output');

    expect(notice, 'the notice is emitted at all').toBeDefined();
    expect(notice!.open).toBe(true);
    expect(realRun, 'and the actual phase output is still there').toBeDefined();
    expect(realRun!.open, '…still collapsed, because it is a log and not a notice').toBeUndefined();
  });

  test('REGRESSION: consult and promote never call the route — they would duplicate every exchange', async () => {
    getTaskMock.mockResolvedValue(mk('C1', { kind: 'consult', chat: [{ role: 'user', text: 'hi' }] } as Partial<WireTask>));
    await openTask('C1');
    await settle();
    expect(getTaskChatMock).not.toHaveBeenCalled();

    getTaskMock.mockResolvedValue(mk('P1', { kind: 'promote', promote: { distillLog: 'log' } } as unknown as Partial<WireTask>));
    await openTask('P1');
    await settle();
    expect(getTaskChatMock).not.toHaveBeenCalled();
  });
});
