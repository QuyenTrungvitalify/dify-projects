/**
 * phase.ts — the canonical 4-phase label table + index helper, extracted from Chat.tsx so the
 * mapping is unit-testable in isolation (spec 011 T10) without importing the whole chat component
 * tree. Behavior is unchanged from the previous inline version.
 */
import type { PhaseKey } from '../types';

export const PHASE_LABELS: { key: PhaseKey; label: string }[] = [
  { key: 'analyze', label: 'Analyze' },
  { key: 'spec', label: 'Spec' },
  { key: 'implement', label: 'Implement' },
  { key: 'test', label: 'Test' },
];

/** 1-based phase index (Analyze=1 … Test=4). Unknown key → 0 (findIndex -1, +1) — callers that then
 *  index `PHASE_LABELS[idx-1]` must go through `phaseLabelAt` to bounds-guard the 0 case (R7 hazard). */
export const phaseIndex = (key: PhaseKey): number =>
  PHASE_LABELS.findIndex((p) => p.key === key) + 1;

/** Bounds-guarded label lookup for a 1-based index: clamps into 1..N so an unknown phase's `0`
 *  (or any out-of-range index) can never produce `PHASE_LABELS[-1]` — the R7 crash that blanked the
 *  whole thread (spec 016 D2). An unexpected phase degrades to the first phase's label, not a throw. */
export const phaseLabelAt = (idx: number): PhaseKey =>
  PHASE_LABELS[Math.min(Math.max(idx, 1), PHASE_LABELS.length) - 1].key;
