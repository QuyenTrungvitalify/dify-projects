// gate-foot.test.ts — spec 035 §S1 / Biggest-risk #2: pins the INDEPENDENT terminal-foot guards, so the
// Non-goal #4 regression (a pre-scaffold cancelled build losing Restore because Edit-again's
// project/workflowSlug requirement was ANDed onto it) can't be reintroduced silently. Spec 036 S5 adds the
// third guard — Run-test-with-workflow (done AUTONOMOUS build + self-host reachable).
import { describe, it, expect } from 'vitest';
import { terminalFootActions } from './gate-foot';
import type { WireTask } from '../types';

// Defaults: a done, pre-scaffold build with NO self-host target and each_step confirm-mode (so runTest is
// off unless a case explicitly opts in). Each case overrides only what it exercises.
const t = (over: Partial<WireTask>): Pick<WireTask, 'status' | 'project' | 'workflowSlug' | 'confirmMode' | 'liveTargets'> =>
  ({ status: 'done', project: null, workflowSlug: null, confirmMode: 'each_step', liveTargets: { selfhost: false }, ...over }) as WireTask;

// all handlers wired; the point is the TASK-FIELD logic, not handler presence.
const all = { restore: true, editAgain: true, runTest: true };

describe('terminalFootActions (spec 035 — independent Restore / Edit-again guards)', () => {
  it('(a) cancelled + no on-disk workflow (pre-scaffold) → Restore stays, Edit-again hidden [the regression guard]', () => {
    expect(terminalFootActions(t({ status: 'cancelled', project: null, workflowSlug: null }), all)).toEqual({
      restore: true,
      editAgain: false,
      runTest: false,
    });
  });

  it('(b) cancelled + project/workflowSlug set → both render (runTest never on a cancelled build)', () => {
    expect(terminalFootActions(t({ status: 'cancelled', project: 'p', workflowSlug: 'wf' }), all)).toEqual({
      restore: true,
      editAgain: true,
      runTest: false,
    });
  });

  it('(c) done + project/workflowSlug set (each_step, no creds) → Edit-again only (done is never restorable)', () => {
    expect(terminalFootActions(t({ status: 'done', project: 'p', workflowSlug: 'wf' }), all)).toEqual({
      restore: false,
      editAgain: true,
      runTest: false,
    });
  });

  it('(d) done + no on-disk workflow → neither renders', () => {
    expect(terminalFootActions(t({ status: 'done', project: null, workflowSlug: 'wf' }), all)).toEqual({
      restore: false,
      editAgain: false,
      runTest: false,
    });
  });

  it('a missing handler hides its own action even when the task fields qualify', () => {
    expect(
      terminalFootActions(t({ status: 'cancelled', project: 'p', workflowSlug: 'wf' }), { restore: false, editAgain: true, runTest: true })
    ).toEqual({ restore: false, editAgain: true, runTest: false });
  });
});

describe('terminalFootActions — runTest (spec 036 D5: done autonomous + self-host reachable)', () => {
  const qualified = (over: Partial<WireTask>): Partial<WireTask> =>
    ({ status: 'done', project: 'p', workflowSlug: 'wf', liveTargets: { selfhost: true }, ...over });

  it('done + auto + creds + on-disk workflow → runTest shown (its only live path)', () => {
    expect(terminalFootActions(t(qualified({ confirmMode: 'auto' })), all).runTest).toBe(true);
  });

  it('done + spec_only + creds + on-disk workflow → runTest shown', () => {
    expect(terminalFootActions(t(qualified({ confirmMode: 'spec_only' })), all).runTest).toBe(true);
  });

  it('done + each_step + creds → HIDDEN (each_step already saw the implement-gate live button)', () => {
    expect(terminalFootActions(t(qualified({ confirmMode: 'each_step' })), all).runTest).toBe(false);
  });

  it('done + null/corrupt confirmMode + creds → HIDDEN (fail-safe to non-autonomous)', () => {
    expect(terminalFootActions(t(qualified({ confirmMode: null as never })), all).runTest).toBe(false);
  });

  it('done + auto but NO self-host target (liveTargets.selfhost false) → HIDDEN', () => {
    expect(terminalFootActions(t(qualified({ confirmMode: 'auto', liveTargets: { selfhost: false } })), all).runTest).toBe(false);
  });

  it('done + auto + creds but liveTargets ABSENT (pre-036 snapshot) → HIDDEN', () => {
    expect(terminalFootActions(t(qualified({ confirmMode: 'auto', liveTargets: undefined })), all).runTest).toBe(false);
  });

  it('done + auto + creds but NO on-disk workflow → HIDDEN', () => {
    expect(terminalFootActions(t(qualified({ confirmMode: 'auto', workflowSlug: null })), all).runTest).toBe(false);
  });

  it('auto + creds + on-disk workflow but NOT done (running/awaiting_confirm) → HIDDEN', () => {
    expect(terminalFootActions(t(qualified({ confirmMode: 'auto', status: 'awaiting_confirm' })), all).runTest).toBe(false);
  });

  it('done + auto + creds qualified but handler NOT wired (has.runTest=false) → HIDDEN', () => {
    expect(terminalFootActions(t(qualified({ confirmMode: 'auto' })), { restore: true, editAgain: true, runTest: false }).runTest).toBe(false);
  });
});
