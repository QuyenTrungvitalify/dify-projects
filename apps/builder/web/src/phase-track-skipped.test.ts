/**
 * Spec 105 — the phase track used to claim work that never happened.
 *
 * `phaseStates` derived every step's state from POSITION alone: everything before `task.phase` was
 * `done`. That was true while every build began at ①. A build that edits a workflow which already has
 * an analysis and a spec now starts at ③ — and the track drew ① 分析 and ② 仕様 with a green check,
 * telling the user the app had analysed their workflow and written its spec on this run. It had not;
 * it had deliberately skipped both because the files were already there.
 *
 * A green check is the strongest claim this UI makes. It has to mean the work ran.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { phaseStates, task } from './store';
import type { WireTask } from './types';

const mk = (over: Partial<WireTask>): WireTask =>
  ({ taskId: '1', phase: 'implement', status: 'running', ...over }) as WireTask;

describe('105 · the phase track and the steps that never ran', () => {
  beforeEach(() => { task.value = null; });

  it('draws ① and ② as skipped, not done, on a build that started at ③', () => {
    task.value = mk({ startPhase: 'implement' });
    const st = phaseStates.value;
    expect(st.analyze).toBe('skipped');
    expect(st.spec).toBe('skipped');
    expect(st.implement).toBe('running');
    expect(st.test).toBe('pending');
  });

  it('still says done for the steps a normal build really ran', () => {
    // The absent `startPhase` — every build before 105, and every build from scratch — must read
    // exactly as it did before: ① and ② ran, so they are finished.
    task.value = mk({});
    const st = phaseStates.value;
    expect(st.analyze).toBe('done');
    expect(st.spec).toBe('done');
  });

  it('keeps ① and ② skipped after the build finishes', () => {
    // The done state is where the user looks longest, and where a false check would stand for good.
    task.value = mk({ startPhase: 'implement', phase: 'test', status: 'done' });
    const st = phaseStates.value;
    expect(st.analyze).toBe('skipped');
    expect(st.spec).toBe('skipped');
    expect(st.implement).toBe('done');
    expect(st.test).toBe('done');
  });

  it('never marks the phase the build is standing IN as skipped', () => {
    // `startPhase` is where it began, not a claim about the present. If a start-at-③ build is parked at
    // ③, ③ is live — the dash belongs only strictly before it.
    task.value = mk({ startPhase: 'implement', phase: 'implement', status: 'awaiting_confirm' });
    expect(phaseStates.value.implement).toBe('awaiting');
  });
});
