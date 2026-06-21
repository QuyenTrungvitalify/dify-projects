/**
 * T10 — phaseIndex / PHASE_LABELS bounds. Known phases map to 1..4; an unknown phase yields 0. Reading
 * `PHASE_LABELS[idx-1]` directly on that 0 was the R7 crash (an out-of-bounds `undefined` whose `.key`
 * throws and blanks the thread). Spec 016 D2 closes it with `phaseLabelAt`, which clamps the index into
 * range; these tests pin the mapping AND assert the clamp (was: documented the crash as still open).
 */
import { describe, it, expect } from 'vitest';
import { PHASE_LABELS, phaseIndex, phaseLabelAt } from './phase';

describe('PHASE_LABELS', () => {
  it('is the 4-phase table in order', () => {
    expect(PHASE_LABELS.map((p) => p.key)).toEqual(['analyze', 'spec', 'implement', 'test']);
    expect(PHASE_LABELS.map((p) => p.label)).toEqual(['Analyze', 'Spec', 'Implement', 'Test']);
  });
});

describe('phaseIndex', () => {
  it('maps each known phase to its 1-based index', () => {
    expect(phaseIndex('analyze')).toBe(1);
    expect(phaseIndex('spec')).toBe(2);
    expect(phaseIndex('implement')).toBe(3);
    expect(phaseIndex('test')).toBe(4);
  });

  it('known index resolves a label', () => {
    expect(PHASE_LABELS[phaseIndex('analyze') - 1].label).toBe('Analyze');
    expect(PHASE_LABELS[phaseIndex('test') - 1].label).toBe('Test');
  });

  it('unknown phase → 0 (findIndex -1, +1)', () => {
    expect(phaseIndex('bogus' as never)).toBe(0);
  });
});

describe('phaseLabelAt (R7 bounds-guard, spec 016 D2)', () => {
  it('maps each known 1-based index to its phase key', () => {
    expect(phaseLabelAt(1)).toBe('analyze');
    expect(phaseLabelAt(2)).toBe('spec');
    expect(phaseLabelAt(3)).toBe('implement');
    expect(phaseLabelAt(4)).toBe('test');
  });

  it('clamps the unknown-phase 0 up to the first phase — no out-of-bounds (was the R7 crash)', () => {
    expect(phaseLabelAt(phaseIndex('bogus' as never))).toBe('analyze'); // idx 0 → clamp → 'analyze'
  });

  it('clamps a negative or over-range index into 1..N', () => {
    expect(phaseLabelAt(-5)).toBe('analyze');
    expect(phaseLabelAt(99)).toBe('test');
  });
});
