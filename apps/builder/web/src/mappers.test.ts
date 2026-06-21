/**
 * T9 — the Confirm-mode wire mappers. confirmModeWire (UI label → verbose wire value, api.ts) and
 * confirmModeLabel (internal mode → UI label, store.ts) are inverses across the public/internal
 * boundary (AC #15); a mismatch silently flips a build's pause behavior.
 *
 * NOTE: the `applyTask` "never overwrite a defined artifact with undefined" guard (R3/R8) lands with
 * the R3 fix in Phase 2 — its test belongs here too and is tracked as a follow-up.
 */
import { describe, it, expect } from 'vitest';
import { confirmModeWire } from './api';
import { confirmModeLabel } from './store';

// [uiLabel, internalMode, verboseWire]
const TRIPLES = [
  ['each step', 'each_step', 'confirm each step'],
  ['spec only', 'spec_only', 'confirm at spec only'],
  ['auto', 'auto', 'auto'],
] as const;

describe('confirmModeWire (UI label → wire)', () => {
  for (const [label, , wire] of TRIPLES) {
    it(`"${label}" → "${wire}"`, () => {
      expect(confirmModeWire(label)).toBe(wire);
    });
  }
  it('also accepts the "at spec only" alias', () => {
    expect(confirmModeWire('at spec only')).toBe('confirm at spec only');
  });
  it('unknown label → safe default "confirm each step"', () => {
    expect(confirmModeWire('garbage')).toBe('confirm each step');
  });
});

describe('confirmModeLabel (internal mode → UI label)', () => {
  for (const [label, mode] of TRIPLES) {
    it(`"${mode}" → "${label}"`, () => {
      expect(confirmModeLabel(mode)).toBe(label);
    });
  }
});

describe('round-trip across the boundary', () => {
  it('label → wire and mode → label agree for every mode', () => {
    for (const [label, mode, wire] of TRIPLES) {
      expect(confirmModeWire(label)).toBe(wire);
      expect(confirmModeLabel(mode)).toBe(label);
    }
  });
});
