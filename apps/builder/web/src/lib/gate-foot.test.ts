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

/**
 * The done card's "Request a fix" button is GONE, and this is the guard that says so on purpose.
 *
 * It armed the composer for the post-import fix loop — the loop is untouched. On a done build the
 * composer already renders the ✎ change pill (`terminalFixable` in App.tsx), under the SAME label the
 * button carried: `requestFix` and `modeChange` were both 修正を依頼 in JA. So the card showed a button
 * whose only job was to point at another button on the same screen, and the two read identically while
 * behaving differently — one armed, one sent.
 *
 * What must not come back is the FIELD: a foot action nobody renders is dead weight that reads as a
 * feature. If a future change needs a done-card fix affordance, it should be argued for, not revived by
 * a merge.
 */
describe('terminalFootActions — the done card carries no fix button', () => {
  it('returns exactly three actions, and requestFix is not one of them', () => {
    const out = terminalFootActions(t({ status: 'done', project: 'p', workflowSlug: 'wf' }), all);
    expect(Object.keys(out).sort()).toEqual(['editAgain', 'restore', 'runTest']);
  });

  it('a done build still has its way back in: Edit-again on the foot, the ✎ pill in the composer', () => {
    // Edit-again is the OTHER door and it is not a substitute — it starts a NEW build. The in-place fix
    // is the composer pill, which `terminalFixable` (not this helper) governs. Pinned here so removing
    // the button cannot be read as removing the loop.
    expect(terminalFootActions(t({ status: 'done', project: 'p', workflowSlug: 'wf' }), all).editAgain).toBe(true);
  });
});

/**
 * The gate card no longer draws 「修正を依頼」.
 *
 * Since spec 092 that button sent nothing: it focused the composer and highlighted the ✎ pill already on
 * screen, under the SAME label. Every parked gate therefore showed two identically-worded buttons where
 * one existed only to point at the other — one armed, one sent. The pill is the door.
 *
 * The two traps this pins:
 *   · hide by ID, never by KIND. `keep` is a reply action too and it survives — as a CLICK, not a
 *     signpost — and the still-failing card names it in its own summary line, so going by kind would
 *     leave that card listing three choices above one button.
 *   · the one-click ids are untouched by the hiding rule: they re-run, they do not point at anything.
 */
describe('replyButtonKind — which reply actions still get drawn', () => {
  const a = (id: string) => ({ id, kind: 'reply' as const });

  it('`changes` is hidden at every gate that offers it', () => {
    for (const status of ['awaiting_confirm', 'error', 'done'] as const) {
      expect(replyButtonKind(a('changes'), status)).toBe('hidden');
    }
  });

  it('`keep` is drawn, and drawn as a CLICK', () => {
    // It says 「再試行を続ける」 — a promise of "go again with nothing new". It used to answer 'arm',
    // which opened a box you then had to type into, because /reply 400s on empty text. The route now
    // accepts an empty body for exactly this id (TEXTLESS_REPLY_IDS, server lib/gate.ts).
    expect(replyButtonKind(a('keep'), 'awaiting_confirm')).toBe('retry');
  });

  it('`retry` on an errored build is still the one-click re-run', () => {
    expect(replyButtonKind(a('retry'), 'error')).toBe('retry');
    // …and only there: the same id at a live gate would be an arm, as before.
    expect(replyButtonKind(a('retry'), 'awaiting_confirm')).toBe('arm');
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

  it("other reply ids at an error status do NOT become the retry button", () => {
    // (defensive — ERROR_GATE only ever emits id 'retry', but the guard must not fire on a hypothetical
    //  other reply action co-present at an error status). `changes` answers 'hidden' rather than 'arm'
    //  now; what matters here is that it is not 'retry'.
    expect(replyButtonKind(a('changes'), 'error')).not.toBe('retry');
  });

  it("the carve-out is a LIST, and `changes` is not on it", () => {
    // `keep` joined `retry` deliberately (both mean "go again, nothing to add"); what must never join
    // them is `changes`, whose entire purpose is to carry an instruction. Asserted as "not retry" —
    // it is hidden, and this guard is about the carve-out, not about rendering.
    expect(replyButtonKind(a('changes'), 'awaiting_confirm')).not.toBe('retry');
    expect(replyButtonKind(a('changes'), 'error')).not.toBe('retry');
    // An id on neither list still falls back to the arm shape.
    expect(replyButtonKind(a('somethingNew'), 'awaiting_confirm')).toBe('arm');
  });
});
