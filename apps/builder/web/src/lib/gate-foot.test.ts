// gate-foot.test.ts — spec 035 §S1 / Biggest-risk #2: pins the INDEPENDENT terminal-foot guards, so the
// Non-goal #4 regression (a pre-scaffold cancelled build losing Restore because Edit-again's
// project/workflowSlug requirement was ANDed onto it) can't be reintroduced silently. Spec 036 S5 adds the
// third guard — Run-test-with-workflow (done AUTONOMOUS build + self-host reachable).
import { describe, it, expect } from 'vitest';
import { replyButtonKind, terminalFootActions } from './gate-foot';
import type { WireGateAction, WireTask } from '../types';

// Defaults: a done, pre-scaffold build with NO self-host target and each_step confirm-mode (so runTest is
// off unless a case explicitly opts in). Each case overrides only what it exercises.
const t = (over: Partial<WireTask>): Pick<WireTask, 'status' | 'project' | 'workflowSlug' | 'confirmMode' | 'liveTargets'> =>
  ({ status: 'done', project: null, workflowSlug: null, confirmMode: 'each_step', liveTargets: { selfhost: false }, ...over }) as WireTask;

// all handlers wired; the point is the TASK-FIELD logic, not handler presence.
const all = { restore: true, editAgain: true, runTest: true, requestFix: true };

describe('terminalFootActions (spec 035 — independent Restore / Edit-again guards)', () => {
  it('(a) cancelled + no on-disk workflow (pre-scaffold) → Restore stays, Edit-again hidden [the regression guard]', () => {
    expect(terminalFootActions(t({ status: 'cancelled', project: null, workflowSlug: null }), all)).toEqual({
      restore: true,
      editAgain: false,
      runTest: false,
      requestFix: false,
    });
  });

  it('(b) cancelled + project/workflowSlug set → both render (runTest never on a cancelled build)', () => {
    expect(terminalFootActions(t({ status: 'cancelled', project: 'p', workflowSlug: 'wf' }), all)).toEqual({
      restore: true,
      editAgain: true,
      runTest: false,
      requestFix: false,
    });
  });

  it('(c) done + project/workflowSlug set (each_step, no creds) → Edit-again only (done is never restorable)', () => {
    expect(terminalFootActions(t({ status: 'done', project: 'p', workflowSlug: 'wf' }), all)).toEqual({
      restore: false,
      editAgain: true,
      runTest: false,
      requestFix: true,
    });
  });

  it('(d) done + no on-disk workflow → neither renders', () => {
    expect(terminalFootActions(t({ status: 'done', project: null, workflowSlug: 'wf' }), all)).toEqual({
      restore: false,
      editAgain: false,
      runTest: false,
      requestFix: false,
    });
  });

  it('a missing handler hides its own action even when the task fields qualify', () => {
    expect(
      terminalFootActions(t({ status: 'cancelled', project: 'p', workflowSlug: 'wf' }), { restore: false, editAgain: true, runTest: true, requestFix: true })
    ).toEqual({ restore: false, editAgain: true, runTest: false, requestFix: false });
  });
});

// The post-import fix loop: the done card's "Request a fix" button — the one action that keeps the user
// in THIS conversation (arms change-mode → POST /reply → the implement session resumes). It is
// deliberately done-ONLY and, unlike runTest, confirm-mode-blind: every finished build gets fixed the
// same way, whoever confirmed the gates.
describe('terminalFootActions — requestFix (the post-import fix loop)', () => {
  it('done + on-disk workflow → shown, at ANY confirm-mode (unlike runTest)', () => {
    for (const confirmMode of ['each_step', 'spec_only', 'auto'] as const) {
      expect(terminalFootActions(t({ status: 'done', project: 'p', workflowSlug: 'wf', confirmMode }), all).requestFix).toBe(true);
    }
  });

  it('done but NO on-disk workflow → hidden (nothing to revise)', () => {
    expect(terminalFootActions(t({ status: 'done', project: 'p', workflowSlug: null }), all).requestFix).toBe(false);
    expect(terminalFootActions(t({ status: 'done', project: null, workflowSlug: 'wf' }), all).requestFix).toBe(false);
  });

  it('cancelled → hidden (a cancelled build re-enters via Restore, and may have no implement session)', () => {
    expect(terminalFootActions(t({ status: 'cancelled', project: 'p', workflowSlug: 'wf' }), all).requestFix).toBe(false);
  });

  it('not terminal (running / awaiting_confirm) → hidden (the gate already offers Request changes)', () => {
    expect(terminalFootActions(t({ status: 'awaiting_confirm', project: 'p', workflowSlug: 'wf' }), all).requestFix).toBe(false);
    expect(terminalFootActions(t({ status: 'running', project: 'p', workflowSlug: 'wf' }), all).requestFix).toBe(false);
  });

  it('qualified but handler NOT wired (e.g. a promote build) → hidden', () => {
    expect(
      terminalFootActions(t({ status: 'done', project: 'p', workflowSlug: 'wf' }), { ...all, requestFix: false }).requestFix
    ).toBe(false);
  });
});

describe('terminalFootActions — runTest (done autonomous; self-host checked on click, not as a display gate)', () => {
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

  // Discoverability change: self-host reachability is NO LONGER a display gate — the foot shows for a done
  // autonomous build even without creds (creds are checked on click in store.liveTest, and server-side).
  it('done + auto but NO self-host target (liveTargets.selfhost false) → SHOWN (creds checked on click)', () => {
    expect(terminalFootActions(t(qualified({ confirmMode: 'auto', liveTargets: { selfhost: false } })), all).runTest).toBe(true);
  });

  it('done + auto but liveTargets ABSENT (pre-036 snapshot) → SHOWN (creds checked on click)', () => {
    expect(terminalFootActions(t(qualified({ confirmMode: 'auto', liveTargets: undefined })), all).runTest).toBe(true);
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

// spec 053 — the reply-button behavior split: the error gate's SOLE `retry` action is a one-click re-run
// (→ 'retry'), every other reply-kind action (or the same id at a non-error status) ARMS the composer
// (→ 'arm'). Pinned pure so the carve-out can't silently leak onto another gate's reply buttons.
describe('replyButtonKind (spec 053 — one-click retry vs arm-composer)', () => {
  const a = (id: string): Pick<WireGateAction, 'id' | 'kind'> => ({ id, kind: 'reply' });

  it("id 'retry' AND status 'error' → 'retry' (the one-click re-run)", () => {
    expect(replyButtonKind(a('retry'), 'error')).toBe('retry');
  });

  it("id 'retry' but status is NOT error → 'arm' (never fires a retry off the error path)", () => {
    expect(replyButtonKind(a('retry'), 'awaiting_confirm')).toBe('arm');
    expect(replyButtonKind(a('retry'), 'running')).toBe('arm');
  });

  it("other reply ids at an error status → 'arm' (only id 'retry' is the retry button)", () => {
    // (defensive — ERROR_GATE only ever emits id 'retry', but the guard must not fire on a hypothetical
    //  other reply action co-present at an error status)
    expect(replyButtonKind(a('changes'), 'error')).toBe('arm');
  });

  it("the OTHER gates' reply ids (Keep trying / Request changes / Edit spec) → 'arm' — no leak", () => {
    expect(replyButtonKind(a('keep'), 'awaiting_confirm')).toBe('arm'); // still_failing "Keep trying"
    expect(replyButtonKind(a('changes'), 'awaiting_confirm')).toBe('arm'); // awaiting_import/spec "Request changes"
  });
});
