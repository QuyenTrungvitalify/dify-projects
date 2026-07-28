import type { WireTask } from '../types';

/** The task fields the promote-button visibility depends on — a narrow view so it's unit-testable
 *  without constructing a whole WireTask. */
export type PromoteVisibilityTask = Pick<WireTask, 'kind' | 'status' | 'phase' | 'project' | 'workflowSlug'>;

/**
 * Whether the conversation view should show the "Promote to pattern" button (spec 052 D1; extended in
 * 85ecfa8 to the ④ gate). Visible for a proven build with a RESOLVED on-disk workflow — either finished
 * (`done`) OR parked at the ④ test gate (`awaiting_confirm` + phase `test`): `main.yml` is final and
 * lint-clean the moment ④ opens, and users who take the yml without importing would otherwise never
 * reach `done` and never see the button. Never for a promote task (you don't promote a promote), and
 * never before the workflow is scaffolded (`project`/`workflowSlug` unset).
 */
export function canPromoteFromConversation(
  view: string,
  task: PromoteVisibilityTask | null | undefined,
): boolean {
  if (view !== 'conversation' || !task) return false;
  if (task.kind === 'promote') return false;
  if (!task.project || !task.workflowSlug) return false;
  return task.status === 'done' || (task.status === 'awaiting_confirm' && task.phase === 'test');
}
