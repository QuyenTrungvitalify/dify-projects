/**
 * spec 105 — `auto` and a plan proposal cannot both be honoured, and the rule has to hold from BOTH
 * ends. Hiding the lane under `auto` is only half: the Confirm chip is live-patchable at a parked
 * gate, so a human could open a proposal under `each_step` and then switch. Nothing would happen —
 * autonomous advance hard-stops on the proposal gate — leaving a mode that reads "don't stop" on a
 * build that is stopped, with nothing on screen saying why.
 *
 * Whichever the human picked FIRST stands; the other option withdraws.
 */
import { describe, it, expect } from 'vitest';
import { canPropose, confirmModeOptions, type ProposeLaneTask } from './propose-lane';

const OK: ProposeLaneTask = {
  project: '_drafts',
  workflowSlug: 'wf',
  artifacts: { implement: 'projects/_drafts/wf/workflows/main.yml' },
  specRevise: undefined,
  confirmMode: 'each_step',
} as ProposeLaneTask;

const MODES = [{ v: 'each step' }, { v: 'spec only' }, { v: 'auto' }] as const;

describe('canPropose', () => {
  it('offers the lane on a build that has a workflow to plan a change to', () => {
    expect(canPropose(OK)).toBe(true);
    expect(canPropose({ ...OK, confirmMode: 'spec_only' })).toBe(true);
  });

  it('withholds it under auto — the gate would wait for someone who said they are not there', () => {
    expect(canPropose({ ...OK, confirmMode: 'auto' })).toBe(false);
  });

  it('withholds it before ③ has produced anything', () => {
    // `artifacts` is keyed by PHASE ID, so `yaml` is never a key here — gating on it silently
    // disabled the whole feature once, which is why the assertion names `implement` explicitly.
    expect(canPropose({ ...OK, artifacts: {} })).toBe(false);
    expect(canPropose({ ...OK, artifacts: { yaml: 'x' } as ProposeLaneTask['artifacts'] })).toBe(false);
    expect(canPropose({ ...OK, project: null })).toBe(false);
    expect(canPropose({ ...OK, workflowSlug: null })).toBe(false);
  });

  it('withholds it while one proposal is already open — a second would diff against a spec being replaced', () => {
    expect(canPropose({ ...OK, specRevise: true })).toBe(false);
  });

  it('withholds it with no task at all', () => {
    expect(canPropose(null)).toBe(false);
    expect(canPropose(undefined)).toBe(false);
  });
});

describe('confirmModeOptions', () => {
  it('offers every mode when no plan is pending', () => {
    expect(confirmModeOptions(MODES, null).map((o) => o.v)).toEqual(['each step', 'spec only', 'auto']);
    expect(confirmModeOptions(MODES, { specRevise: undefined }).map((o) => o.v)).toHaveLength(3);
  });

  it('withdraws auto while a plan is pending, and keeps the attended modes', () => {
    const opts = confirmModeOptions(MODES, { specRevise: true }).map((o) => o.v);
    expect(opts).toEqual(['each step', 'spec only']);
  });

  it('returns a copy — the caller must not be able to mutate the source list', () => {
    const out = confirmModeOptions(MODES, null);
    expect(out).not.toBe(MODES as unknown as typeof out);
  });
});
