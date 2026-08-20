// undo-fix.test.ts — spec 103 step 1, the UI half: when may the ③ gate offer to take a fix back, and
// how does the 差分 tab talk about the spec side of a round.
//
// Both helpers exist to hold apart pairs of states that look alike and mean different things. That is
// the whole job, so these cases are written as pairs.
import { describe, it, expect } from 'vitest';
import { canUndoFix } from './gate-foot';
import { specDiffState } from './diff-parser';
import type { WireTask } from '../types';

const gate = (over: Partial<WireTask>): Pick<WireTask, 'phase' | 'status' | 'fixUndoable'> =>
  ({ phase: 'implement', status: 'awaiting_confirm', fixUndoable: true, ...over }) as WireTask;

describe('103 step 1 · canUndoFix — where the undo is offered', () => {
  it('a live ③ gate with a snapshot pair → offered', () => {
    expect(canUndoFix(gate({}), false)).toBe(true);
  });

  it('a RESOLVED card in the scroll-back → never', () => {
    // The dangerous one. An old card still renders its task snapshot, but the files on disk have moved
    // on several rounds; acting on it would restore from a round that is not the one shown.
    expect(canUndoFix(gate({}), true)).toBe(false);
  });

  it('at ④ → never, even with a snapshot pair sitting there', () => {
    // At ④ the human has just learned something from the report or the live run. The right move is to
    // fix forward. A rewind here would also strand a report describing a file that no longer exists —
    // and, because an import only ever happens at ④, excluding ④ is what makes it impossible for an
    // undo to contradict what was already pushed to Dify.
    expect(canUndoFix(gate({ phase: 'test' }), false)).toBe(false);
  });

  it('mid-turn or errored → never', () => {
    expect(canUndoFix(gate({ status: 'running' }), false)).toBe(false);
    expect(canUndoFix(gate({ status: 'error' }), false)).toBe(false);
    expect(canUndoFix(gate({ status: 'done' }), false)).toBe(false);
  });

  it('no snapshot pair → never, and `undefined` is not a yes', () => {
    // `fixUndoable` is absent on a first Implement (nothing to undo) and on a Dify-seed build (only
    // half the round could be restored). `=== true` on purpose: an older task.json has no field at all,
    // and offering a button that always 409s is worse than offering none.
    expect(canUndoFix(gate({ fixUndoable: false }), false)).toBe(false);
    expect(canUndoFix(gate({ fixUndoable: undefined }), false)).toBe(false);
  });
});

describe('103 step 1 · specDiffState — three states, and why none may collapse', () => {
  it('no snapshot → absent (the section is omitted entirely)', () => {
    expect(specDiffState(null)).toBe('absent');
    expect(specDiffState(undefined)).toBe('absent');
  });

  it('measured and nothing moved → unchanged (a statement, not a blank)', () => {
    expect(specDiffState('')).toBe('unchanged');
    expect(specDiffState('   \n')).toBe('unchanged');
  });

  it('a real diff → changed', () => {
    expect(specDiffState('@@ -1 +1 @@\n-a\n+b\n')).toBe('changed');
  });

  it('absent and unchanged are DIFFERENT — the pair this function exists for', () => {
    // "we could not look" must never render like "we looked and nothing moved". Collapse these two and
    // a first build silently claims its spec was checked and found identical.
    expect(specDiffState(null)).not.toBe(specDiffState(''));
  });
});
