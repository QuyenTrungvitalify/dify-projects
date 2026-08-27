/**
 * confirmModeActs — where the Confirm-mode chip is still worth a slot.
 *
 * WHY THIS TEST EXISTS. The rule is not a style preference, it is an arithmetic fact about
 * `boundaryAutoAdvances`: the value is read only at the end of a phase, and from ③ on every remaining
 * ④ gate hard-stops for a human whatever the mode says. Widen this and the chip is a control that
 * describes a choice it can no longer affect; narrow it and a build parked at ① loses the one way to
 * say "run the rest without me". Neither failure raises anything.
 */
import { describe, it, expect } from 'vitest';
import { confirmModeActs } from './confirm-chip';
import type { WirePhase } from '../types';

const at = (phase: WirePhase): { phase: WirePhase } => ({ phase });

describe('confirmModeActs', () => {
  it('① and ② — a boundary the value governs is still ahead', () => {
    expect(confirmModeActs(at('analyze'))).toBe(true);
    expect(confirmModeActs(at('spec'))).toBe(true);
  });

  it('③ and ④ — nothing left for it to decide', () => {
    // Confirming ③ runs ④, which parks (import / live verdict / infra-degraded / still-failing) or is
    // terminal — in every case regardless of confirm mode.
    expect(confirmModeActs(at('implement'))).toBe(false);
    expect(confirmModeActs(at('test'))).toBe(false);
  });

  it('the entry surface always shows it — that is where the mode is chosen', () => {
    expect(confirmModeActs(null)).toBe(true);
    expect(confirmModeActs(undefined)).toBe(true);
  });
});
