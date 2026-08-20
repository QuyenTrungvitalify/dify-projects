// gate-spec-stale.test.ts — spec 103 L0, the UI half: what the ③ gate says when a fix round moved the
// workflow and left SPEC.md behind.
//
// The measured failure (spec 103 §1.1) was not a wrong computation either — it was that NOTHING said
// anything. A build's spec sat at its 2026-08-12 state while the workflow took a week of fixes, and the
// user eventually hand-wrote a rival 582-line "current spec" because no surface ever admitted the
// original had stopped being true. These cases pin that the admission exists, and pin that it appears
// ONLY on a positive measurement.
//
// Sibling of gate-no-change.test.ts by design: same fixture, same three-case shape. The two flags are
// one measurement taken twice and should read as one pattern.
import { describe, it, expect } from 'vitest';
import { gateView } from './components/Chat';
import type { WireTask } from './types';

const implTask = (over: Partial<WireTask>): WireTask =>
  ({ phase: 'implement', status: 'awaiting_confirm', gate: { actions: [] }, ...over }) as WireTask;

describe('103 L0 · ③ gate — the workflow moved, the spec did not', () => {
  it('specStale:true → the warning LEADS the summary, and the spec is one click away', () => {
    const v = implTask({ specStale: true });
    const view = gateView(v);
    expect(view.summary[0]).toMatch(/spec document did not/);
    expect(view.tone).toBe('warn');
    // The ordinary lint line survives underneath — the round DID produce a verified file. This is
    // paperwork, not a failure, and the card must not read like the build broke.
    expect(view.summary.join(' ')).toMatch(/linters green/);
    expect(view.badge).toBe('Implemented');
    // Pointless to say "the spec is wrong" without a way to go look at it.
    expect(view.showSpecLink).toBe(true);
  });

  it('specStale:false → the ordinary Implemented card, unchanged from pre-103', () => {
    const view = gateView(implTask({ specStale: false }));
    expect(view.badge).toBe('Implemented');
    expect(view.tone).toBe('');
    expect(view.summary.join(' ')).not.toMatch(/spec document did not/);
  });

  it('specStale absent (first Implement / pre-103 build) → ordinary card, never a claim', () => {
    // The load-bearing case, same as its 094 sibling: `undefined` means "not measured" and must not
    // render as an accusation. A first Implement never measures this — ② wrote the spec minutes ago.
    const view = gateView(implTask({}));
    expect(view.badge).toBe('Implemented');
    expect(view.summary.join(' ')).not.toMatch(/spec document did not/);
  });

  it('a round that moved the spec SAYS so, with a count — how one card tells itself from the next', () => {
    // Four fix rounds used to scroll back as four identical cards (task 1787190372697: two different
    // requests, nothing on either card to tell them apart). This line is the round's own footprint.
    const view = gateView(implTask({ specEdits: 3 }));
    expect(view.summary.join(' ')).toMatch(/3 places\./); // fully substituted — a literal "{s}" shipped once
    expect(view.summary.join(' ')).not.toMatch(/[{}]/);
    expect(view.tone).toBe('');
    expect(view.badge).toBe('Implemented');
    expect(view.showSpecLink).toBe(true); // a claim about the spec must be one click from being checked
    // The workflow stays the headline — the spec line comes AFTER the lint line, not before it.
    expect(view.summary[0]).toMatch(/linters green/);
  });

  it('exactly one place → singular, no stray brace', () => {
    const view = gateView(implTask({ specEdits: 1 }));
    expect(view.summary.join(' ')).toMatch(/1 place\./);
    expect(view.summary.join(' ')).not.toMatch(/[{}]/);
  });

  it('no spec movement → no line (0 and undefined are both silence, not "0 places")', () => {
    expect(gateView(implTask({ specEdits: 0 })).summary.join(' ')).not.toMatch(/spec document was updated/);
    expect(gateView(implTask({})).summary.join(' ')).not.toMatch(/spec document was updated/);
  });

  it('an empty round still reads as an empty round — 094 wins the tie', () => {
    // The two cannot co-occur on real data (`specStale` requires the workflow to have changed), but the
    // renderer must not depend on that invariant holding: if both ever arrive, "this round changed
    // nothing" is the more urgent thing to say, and it must not be shadowed.
    const view = gateView(implTask({ artifactUnchanged: true, specStale: true }));
    expect(view.badge).toBe('No file change');
    expect(view.summary[0]).toMatch(/did not change the workflow file/);
  });
});
