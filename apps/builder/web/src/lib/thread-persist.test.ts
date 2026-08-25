// thread-persist.test.ts — the slim-serialize + reconcile-on-reopen logic (the risky part: dropping a
// stale unresolved gate so a build that advanced/finished while the tab was closed can't render phantom
// live buttons for a passed phase).
import { describe, it, expect } from 'vitest';
import {
  serializeThread,
  serializeThreadCapped,
  parseThread,
  hydrateForReopen,
  capRunOutput,
  RUN_OUTPUT_CAP,
  PER_BUILD_CAP,
  TRIM_MAX_PAIRS,
} from './thread-persist';
import { gateView } from '../components/Chat';
import type { LiveThreadItem } from '../store';
import type { WireTask } from '../types';

const snap = (over: Partial<WireTask> = {}): WireTask =>
  ({ taskId: 'T1', phase: 'spec', status: 'awaiting_confirm', requirement: 'r', ...over }) as WireTask;

describe('serializeThread — decision #1 (slim: KEEP capped run.output, drop gate artifactContents)', () => {
  it('keeps a normal-size run output verbatim and drops gate artifactContents; keeps user/qa verbatim', () => {
    const items: LiveThreadItem[] = [
      { id: 'u', kind: 'user', text: 'hi' },
      { id: 'r', kind: 'run', phase: 'analyze', running: false, output: 'the requirement overview' },
      { id: 'g', kind: 'gate', phase: 'spec', snapshot: snap({ artifactContents: { spec: '# big' } } as Partial<WireTask>) },
      { id: 'q', kind: 'qa', question: 'why?', answer: 'because', done: true },
    ];
    const parsed = JSON.parse(serializeThread(items)) as any[];
    expect(parsed[1].output).toBe('the requirement overview'); // run prose PRESERVED (was the reload data-loss bug)
    expect(parsed[2].snapshot.artifactContents).toBeUndefined(); // artifactContents dropped
    expect(parsed[0]).toEqual({ id: 'u', kind: 'user', text: 'hi' }); // user preserved
    expect(parsed[3]).toEqual({ id: 'q', kind: 'qa', question: 'why?', answer: 'because', done: true }); // qa preserved
  });

  it('caps a runaway run log (tail kept + truncation marker) so it cannot blow the quota', () => {
    const huge = 'x'.repeat(RUN_OUTPUT_CAP + 5000);
    const capped = capRunOutput(huge);
    expect(capped.length).toBeLessThan(huge.length);
    expect(capped.startsWith('[… 5000 chars truncated …]\n')).toBe(true);
    expect(capped.endsWith('x')).toBe(true); // tail preserved
    // and it round-trips through serializeThread
    const items: LiveThreadItem[] = [{ id: 'r', kind: 'run', phase: 'implement', running: false, output: huge }];
    const parsed = JSON.parse(serializeThread(items)) as any[];
    expect(parsed[0].output).toBe(capped);
  });

  it('leaves output at exactly the cap untouched', () => {
    const atCap = 'y'.repeat(RUN_OUTPUT_CAP);
    expect(capRunOutput(atCap)).toBe(atCap);
  });
});

describe('parseThread — corrupt/absent → null (caller falls back to requirement-only)', () => {
  it('null / empty / non-JSON / non-array → null', () => {
    expect(parseThread(null)).toBeNull();
    expect(parseThread('')).toBeNull();
    expect(parseThread('{not json')).toBeNull();
    expect(parseThread('{"a":1}')).toBeNull();
    expect(parseThread('[]')).toBeNull();
  });
  it('drops malformed items but keeps well-formed ones', () => {
    const json = JSON.stringify([{ id: 'u', kind: 'user', text: 'hi' }, { nope: true }]);
    expect(parseThread(json)).toEqual([{ id: 'u', kind: 'user', text: 'hi' }]);
  });
});

describe('hydrateForReopen — decision #2 (reconcile: drop unresolved gates, finalize runs)', () => {
  it('drops an UNRESOLVED gate (the live one comes fresh from applyTask), keeps resolved history + qa', () => {
    const items: LiveThreadItem[] = [
      { id: 'u', kind: 'user', text: 'hi' },
      { id: 'g1', kind: 'gate', phase: 'analyze', snapshot: snap({ phase: 'analyze' }), resolved: 'Continued' },
      { id: 'q1', kind: 'qa', question: 'q', answer: 'a', done: true },
      { id: 'g2', kind: 'gate', phase: 'spec', snapshot: snap() }, // UNRESOLVED — the stale/parked gate
    ];
    const out = hydrateForReopen(items);
    expect(out.map((i) => i.id)).toEqual(['u', 'g1', 'q1']); // g2 dropped
    expect(out.find((i) => i.id === 'g1')).toBeTruthy(); // resolved gate kept as history
  });

  it('finalizes a still-running run (a build that was mid-turn when the tab closed)', () => {
    const items: LiveThreadItem[] = [
      { id: 'r', kind: 'run', phase: 'implement', running: true, output: '' },
    ];
    const out = hydrateForReopen(items) as (LiveThreadItem & { kind: 'run' })[];
    expect(out[0].running).toBe(false);
  });

  // An open `qa` is NOT closed here, unlike a running run — the asymmetry is deliberate and load-bearing.
  // A hard reload's fresh SSE stream keeps delivering ask:answer/ask:done for a turn the server is still
  // running, and they land on exactly this restored item; closing it here would throw the rest of the
  // answer away. The settle happens in the store's `init` handler, gated on the server's `turnRunning`.
  it('leaves an open qa OPEN — a still-streaming answer resumes onto it after a reload', () => {
    const items: LiveThreadItem[] = [
      { id: 'u', kind: 'user', text: 'what broke?' },
      { id: 'q', kind: 'qa', question: 'what broke?', answer: 'the LLM node ', done: false },
    ];
    const out = hydrateForReopen(items) as (LiveThreadItem & { kind: 'qa' })[];
    expect(out.map((i) => i.id)).toEqual(['u', 'q']);
    expect(out[1].done).toBe(false); // still open — the store closes it only if no turn holds the task
    expect(out[1].answer).toBe('the LLM node '); // partial text preserved for the resume to append to
  });

  it('leaves an already-done qa untouched', () => {
    const items: LiveThreadItem[] = [{ id: 'q', kind: 'qa', question: 'q', answer: 'a', done: true }];
    expect(hydrateForReopen(items)).toEqual(items);
  });

  it('round-trip: serialize → parse → hydrate preserves the conversation, drops the live gate', () => {
    const items: LiveThreadItem[] = [
      { id: 'u', kind: 'user', text: 'build me X' },
      { id: 'q', kind: 'qa', question: 'why iteration?', answer: 'because N items', done: true },
      { id: 'g', kind: 'gate', phase: 'spec', snapshot: snap() }, // unresolved
    ];
    const revived = hydrateForReopen(parseThread(serializeThread(items))!);
    expect(revived.map((i) => i.kind)).toEqual(['user', 'qa']); // conversation kept, unresolved gate gone
  });
});

describe('serializeThread — user attachments (history keeps the files, not the bytes)', () => {
  it('strips the base64 dataUrl but KEEPS name/mime/idx (the reload-survivable form)', () => {
    const items: LiveThreadItem[] = [
      {
        id: 'u',
        kind: 'user',
        text: 'look at this',
        atts: [{ name: 'shot.png', mime: 'image/png', dataUrl: 'data:image/png;base64,' + 'A'.repeat(50_000), idx: 0 }],
      },
    ];
    const json = serializeThread(items);
    expect(json).not.toContain('base64'); // the megabyte payload never reaches localStorage
    expect(json.length).toBeLessThan(500);
    const parsed = JSON.parse(json) as any[];
    expect(parsed[0].atts).toEqual([{ name: 'shot.png', mime: 'image/png', idx: 0 }]);
  });

  it('drops an attachment with no server index — nothing could render it after a reload', () => {
    const items: LiveThreadItem[] = [
      { id: 'u', kind: 'user', text: 'x', atts: [{ name: 'a.png', mime: 'image/png', dataUrl: 'data:image/png;base64,AA' }] },
    ];
    const parsed = JSON.parse(serializeThread(items)) as any[];
    expect(parsed[0].atts).toBeUndefined();
  });

  it('round-trips through parse so a reopened build still shows the files', () => {
    const items: LiveThreadItem[] = [
      { id: 'u', kind: 'user', text: 'see attached', atts: [{ name: 'spec.pdf', mime: 'application/pdf', idx: 2 }] },
    ];
    const revived = parseThread(serializeThread(items))! as (LiveThreadItem & { kind: 'user' })[];
    expect(revived[0].atts).toEqual([{ name: 'spec.pdf', mime: 'application/pdf', idx: 2 }]);
  });
});

/* The dev cost tip survives a hard reload. Not an accident of the serializer passing qa items through:
   the number describes the turn that wrote THIS answer, so it stays true for as long as the answer does.
   Pinned because a future "slim the persisted thread" pass would otherwise drop it silently. */
describe('a qa item keeps its cost read-out across a reload', () => {
  it('round-trips model + tokens with the answer', () => {
    const items = [
      {
        id: 'q1', kind: 'qa', question: 'how many nodes?', answer: '3', done: true,
        seededFrom: ['main.yml'],
        cost: { model: 'claude-opus-5', inputTokens: 2, cacheReadTokens: 15_600, outputTokens: 19 },
      },
    ] as unknown as LiveThreadItem[];
    const back = parseThread(serializeThread(items));
    const qa = back?.[0] as { cost?: { model?: string; cacheReadTokens?: number } };
    expect(qa.cost?.model).toBe('claude-opus-5');
    expect(qa.cost?.cacheReadTokens).toBe(15_600);
  });
});

/**
 * What a gate card is allowed to cost in storage.
 *
 * A gate item holds a whole `WireTask`, and `GET /api/tasks/:id` returns a FATTER task than the SSE
 * broadcast does — it staples on the phase transcript (`runs`), the last ask exchange, and the
 * per-attempt costs. Every gate refetches once, so every persisted gate card was carrying a copy of
 * all three. Measured on the build where this was found: 35 gates × up to 48k of `runs` and 88k of
 * `lastAsk` = ~2.2M characters of duplicated log, against a quota of roughly 2.6M.
 *
 * The two tests below guard the same rule from both ends, and the second is the one that survives:
 * names go stale (the next heavy field will be called something else), a size assertion does not.
 */
describe('a persisted gate snapshot keeps only what SSE sends', () => {
  const fatSnapshot = (): WireTask =>
    snap({
      artifactContents: { spec: '# spec' },
      runs: [{ ts: 1, phase: 'implement', output: 'x'.repeat(48_000) }],
      runsDropped: 4,
      runCosts: [{ phase: 'implement', at: 1, cost: { model: 'm' } }],
      lastAsk: { q: 'why?', a: 'y'.repeat(80_000), ok: true },
      chat: [{ role: 'user', text: 'hi' }],
    } as unknown as Partial<WireTask>);

  it('drops every field the GET adds, and keeps the ones the card renders', () => {
    const items: LiveThreadItem[] = [{ id: 'g', kind: 'gate', phase: 'spec', snapshot: fatSnapshot() }];
    const stored = (JSON.parse(serializeThread(items)) as { snapshot: Record<string, unknown> }[])[0].snapshot;
    for (const k of ['artifactContents', 'runs', 'runsDropped', 'runCosts', 'lastAsk', 'chat']) {
      expect(stored, `GET-only field survived: ${k}`).not.toHaveProperty(k);
    }
    expect(stored.taskId).toBe('T1');
    expect(stored.phase).toBe('spec');
    expect(stored.status).toBe('awaiting_confirm');
  });

  it('renders IDENTICALLY after a round-trip — the card is the thing that must not change', () => {
    // Asserted through `gateView` rather than by listing field names: the card is rendered by handing
    // the whole task to gateView/GateActions/terminalFootActions, so the honest question is not "which
    // keys survived" but "does the card still say the same thing".
    const before = fatSnapshot();
    const items: LiveThreadItem[] = [{ id: 'g', kind: 'gate', phase: 'spec', snapshot: before }];
    const after = (parseThread(serializeThread(items)) as (LiveThreadItem & { kind: 'gate' })[])[0].snapshot;
    expect(gateView(after)).toEqual(gateView(before));
  });

  it('35 gate cards stay under a quarter-million characters (the mechanical half of the rule)', () => {
    const items: LiveThreadItem[] = Array.from({ length: 35 }, (_, i) => ({
      id: `g${i}`, kind: 'gate', phase: 'implement', snapshot: fatSnapshot(), resolved: 'Continued',
    }));
    expect(serializeThread(items).length).toBeLessThan(250_000);
  });
});

/**
 * A question was stored twice: once as the `user` bubble, once as the `qa`'s `question` — because that
 * is how the pair is pushed. On the build that broke the quota the second copy was 874k characters, a
 * fifth of everything stored. It is now written once and rebuilt on read; the round-trip has to be
 * exact, because `backfillFromTranscript` matches exchanges BY QUESTION TEXT and a blank one there
 * would make the disk transcript look entirely missing — appending the whole conversation a second time.
 */
describe('a question is stored once, not twice', () => {
  const pair: LiveThreadItem[] = [
    { id: 'u', kind: 'user', text: 'why iteration?' },
    { id: 'q', kind: 'qa', question: 'why iteration?', answer: 'because N items', done: true },
  ];

  it('writes the text once and rebuilds it on read', () => {
    const json = serializeThread(pair);
    expect(json.split('why iteration?').length - 1).toBe(1); // once, not twice
    expect(parseThread(json)).toEqual(pair); // and the caller cannot tell
  });

  it('keeps `question` when it is NOT the bubble above (a rebuilt consult chat, where it is empty)', () => {
    const items: LiveThreadItem[] = [
      { id: 'u', kind: 'user', text: 'what the user typed' },
      { id: 'q', kind: 'qa', question: '', answer: 'an answer', done: true },
    ];
    expect(parseThread(serializeThread(items))).toEqual(items);
  });

  it('a payload written before the omission existed is never overwritten', () => {
    const legacy = JSON.stringify([
      { id: 'u', kind: 'user', text: 'typed text' },
      { id: 'q', kind: 'qa', question: 'a DIFFERENT question', answer: 'a', done: true },
    ]);
    const back = parseThread(legacy) as (LiveThreadItem & { kind: 'qa' })[];
    expect(back[1].question).toBe('a DIFFERENT question');
  });

  it('a qa with no bubble above it survives with an empty question rather than a crash', () => {
    const orphan = JSON.stringify([{ id: 'q', kind: 'qa', answer: 'a', done: true }]);
    const back = parseThread(orphan) as (LiveThreadItem & { kind: 'qa' })[];
    expect(back[0].question).toBe(''); // the two readers of `question` both call .trim() on it
  });
});

/**
 * The size cap, and the direction it cuts in.
 *
 * PREFIX-keeping is the whole design: `GET /api/tasks/:id/chat` serves back the LAST 50 exchanges, so
 * the tail is a cache and the head is the only copy. Cutting the tail is undone by the backfill in the
 * right order; cutting the head would be silent, permanent loss.
 */
describe('serializeThreadCapped — cuts the end, never the start', () => {
  const exchange = (n: number, size: number): LiveThreadItem[] => [
    { id: `u${n}`, kind: 'user', text: `q${n} ` + 'x'.repeat(size) },
    { id: `q${n}`, kind: 'qa', question: `q${n} ` + 'x'.repeat(size), answer: 'a'.repeat(size), done: true },
  ];
  const long = (count: number, size = 1_000): LiveThreadItem[] =>
    Array.from({ length: count }, (_, i) => exchange(i, size)).flat();

  it('fits the cap by dropping whole exchanges off the END', () => {
    const items = long(30);
    const { json, droppedPairs } = serializeThreadCapped(items, 20_000);
    expect(json.length).toBeLessThanOrEqual(20_000);
    expect(droppedPairs).toBeGreaterThan(0);
    const kept = parseThread(json)!;
    expect(kept[0].id).toBe('u0'); // the OLDEST exchange is the one that stays
    expect(kept.map((i) => i.id)).not.toContain('q29');
  });

  it('never leaves a question bubble whose answer was cut (the backfill would restore it twice)', () => {
    const kept = parseThread(serializeThreadCapped(long(30), 20_000).json)!;
    const last = kept[kept.length - 1];
    expect(last.kind).not.toBe('user');
  });

  it('ALWAYS keeps the exchange still in flight — the transcript has not recorded it yet', () => {
    const items = [
      ...long(30),
      { id: 'u-live', kind: 'user', text: 'the question being answered right now' },
      { id: 'q-live', kind: 'qa', question: 'the question being answered right now', answer: 'partial', done: false },
    ] as LiveThreadItem[];
    const kept = parseThread(serializeThreadCapped(items, 20_000).json)!;
    expect(kept.map((i) => i.id)).toEqual(expect.arrayContaining(['u-live', 'q-live']));
    expect(kept[0].id).toBe('u0'); // and it is still a prefix + the live pair, not a tail window
  });

  it('stops cutting at TRIM_MAX_PAIRS even if that means exceeding the cap', () => {
    // Past the backend's 50-exchange window, cutting stops being a cache eviction and starts being data
    // loss — so the trimmer gives up and hands the problem to the caller (which frees space by evicting
    // OTHER builds) rather than quietly deleting history no one else has.
    const items = long(120, 2_000);
    const { json, droppedPairs } = serializeThreadCapped(items, 10_000);
    expect(droppedPairs).toBe(TRIM_MAX_PAIRS);
    expect(json.length).toBeGreaterThan(10_000);
  });

  it('leaves a thread that already fits completely alone', () => {
    const items = long(3);
    const { json, droppedPairs } = serializeThreadCapped(items, PER_BUILD_CAP);
    expect(droppedPairs).toBe(0);
    expect(json).toBe(serializeThread(items));
  });
});
