// confirm-chip.ts — whether the Confirm-mode chip can still change anything for this build.
//
// The chip patches `confirm_mode`, and that value is read at exactly one place: the END of a phase,
// where `boundaryAutoAdvances` decides whether the build parks or runs on. So the chip is only worth a
// slot while a boundary it governs is still AHEAD:
//
//   parked at ① → switching to auto/spec_only skips the ② and ③ gates
//   parked at ② → skips the ③ gate
//   at ③ or ④  → nothing. Every ④ gate that exists hard-stops regardless of mode (import, live-test
//                verdict, infra-degraded, still-failing), and a ④ with no gate is terminal under every
//                mode too. There is no outcome left for the value to change.
//
// It used to render at all four, which made it a control that described a choice it could no longer
// affect — the thing this codebase calls a lying control, and the same fault that took Workflow and
// Fast out of the conversation composer. Nothing is lost by hiding it: the mode a run used is recorded
// with the run's own facts.
//
// Keyed on the PHASE, never the status, so it disappears exactly once — the moment ③ starts — instead
// of blinking out while ① runs and back when ① parks.
//
// The chip's other rule, which VALUES it may offer, is `confirmModeOptions` in propose-lane.ts.
import type { WireTask } from '../types';

/**
 * `null`/absent task = the entry surface, where the mode is being chosen for a build that has not
 * started. That is the chip's main job and it always renders there.
 *
 * Deliberately excluded: the still-failing ③ gate, where switching to `auto` and then asking for
 * another attempt WOULD carry a clean retry straight into ④. That is one narrow path behind an error
 * state, and keeping a permanent chip for it costs the row 137px at every ③ and ④ — the gates whose own
 * action rows are the widest. Take it back only with the path itself in hand.
 */
export function confirmModeActs(task: Pick<WireTask, 'phase'> | null | undefined): boolean {
  if (!task) return true;
  return task.phase === 'analyze' || task.phase === 'spec';
}
