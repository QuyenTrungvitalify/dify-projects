// thread-persist.test.ts — the slim-serialize + reconcile-on-reopen logic (the risky part: dropping a
// stale unresolved gate so a build that advanced/finished while the tab was closed can't render phantom
// live buttons for a passed phase).
import { describe, it, expect } from 'vitest';
import { serializeThread, parseThread, hydrateForReopen, capRunOutput, RUN_OUTPUT_CAP } from './thread-persist';
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
