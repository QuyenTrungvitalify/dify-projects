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
