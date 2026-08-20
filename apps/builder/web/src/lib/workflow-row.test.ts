/**
 * workflowRowAction — what clicking a sidebar workflow row does besides expanding it.
 *
 * WHY THIS TEST EXISTS. The single-build rule exists to remove a click, and the way it removes that
 * click is by CHANGING what the row does — so the two behaviors it must not swallow are the ones
 * pinned hardest here: a synthetic `(unsaved)` row must still arm nothing (spec 090: arming it built
 * a task that died at ② every time), and a row with several builds must not pick one on the user's
 * behalf. Both are silent failures — the row would just do the wrong thing, with no error anywhere.
 */
import { describe, it, expect } from 'vitest';
import { workflowRowAction } from './workflow-row';

const wf = (tasks: string[], synthetic?: boolean): { id: string; synthetic?: boolean; tasks: Array<{ id: string }> } =>
  ({ id: 'wf', synthetic, tasks: tasks.map((id) => ({ id })) });

describe('workflowRowAction', () => {
  it('opens the only build, so the sole child costs no second click', () => {
    expect(workflowRowAction(wf(['1785894453182']))).toEqual({ kind: 'open', taskId: '1785894453182' });
  });

  it('never guesses which of several builds you meant', () => {
    expect(workflowRowAction(wf(['a', 'b']))).toEqual({ kind: 'newTask' });
    expect(workflowRowAction(wf(['a', 'b', 'c']))).toEqual({ kind: 'newTask' });
  });

  it('arms a new edit-build when there is nothing to open', () => {
    expect(workflowRowAction(wf([]))).toEqual({ kind: 'newTask' });
  });

  it('arms NOTHING on the synthetic (unsaved) group, even when it holds exactly one build', () => {
    // spec 090: its slug is not a workflow — a build armed off it died at ② with `artifact missing`.
    expect(workflowRowAction(wf(['1785916628346'], true))).toEqual({ kind: 'expand' });
    expect(workflowRowAction(wf(['a', 'b'], true))).toEqual({ kind: 'expand' });
  });
});
