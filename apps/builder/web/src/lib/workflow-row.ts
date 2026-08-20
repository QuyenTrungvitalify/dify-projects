import type { WireTreeWorkflow } from '../types';

/** The workflow fields the row's click behavior depends on — a narrow view so it's unit-testable
 *  without constructing a whole tree node. */
export type WorkflowRowNode = Pick<WireTreeWorkflow, 'id' | 'synthetic'> & {
  tasks: Array<{ id: string }>;
};

/** What clicking a sidebar workflow row should do, besides expanding it. */
export type WorkflowRowAction =
  /** Expand only — the row is not a real workflow, so nothing may be armed off it. */
  | { kind: 'expand' }
  /** Open this build. */
  | { kind: 'open'; taskId: string }
  /** Arm a new edit-existing build on this workflow. */
  | { kind: 'newTask' };

/**
 * Clicking a workflow row always expands it; this decides what ELSE it does.
 *
 *  - synthetic row (the `(unsaved)` display bucket) → nothing. Its slug is not a workflow, and arming
 *    it as a build base produced a build that died deterministically at ② (spec 090).
 *  - exactly ONE build under it → open that build. The row and its only child are the same thing to a
 *    reader, so expanding and waiting for a second click on the sole child is a click the user should
 *    never have to make.
 *  - anything else (0 or 2+) → arm a new edit-existing build. With several children, picking one for
 *    the user would be a guess; with none there is nothing to open. The row's pencil arms a new build
 *    unconditionally, which is how you still get one when the single-child rule takes the row.
 */
export function workflowRowAction(wf: WorkflowRowNode): WorkflowRowAction {
  if (wf.synthetic) return { kind: 'expand' };
  if (wf.tasks.length === 1) return { kind: 'open', taskId: wf.tasks[0].id };
  return { kind: 'newTask' };
}
