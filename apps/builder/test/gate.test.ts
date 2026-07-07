/**
 * T1 — computeGate (the gate state machine). PURE, so exhaustively tabled:
 * every phase × outcome → the action-id/kind set, plus the F1 Discard invariant,
 * the still_failing variant, and the selfhost-④ awaiting_import gate.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeGate, type GateOutcome } from '../server/lib/gate.js';
import type { Deploy, Phase } from '../server/state/task.js';

const ids = (phase: Phase, outcome: GateOutcome, deploy: Deploy = 'none'): string[] =>
  computeGate(phase, { outcome }, deploy).actions.map((a) => a.id);

const kinds = (phase: Phase, outcome: GateOutcome, deploy: Deploy = 'none'): string[] =>
  computeGate(phase, { outcome }, deploy).actions.map((a) => a.kind);

describe('computeGate', () => {
  test('error in ANY phase → single Retry reply, never a Discard', () => {
    for (const phase of ['analyze', 'spec', 'implement', 'test'] as Phase[]) {
      const g = computeGate(phase, { outcome: 'error' }, 'none');
      assert.deepEqual(g.actions.map((a) => a.id), ['retry']);
      assert.equal(g.actions[0].kind, 'reply');
      assert.equal(g.flag, undefined);
    }
  });

  test('analyze success → Continue / Request changes / Discard', () => {
    assert.deepEqual(ids('analyze', 'success'), ['continue', 'changes', 'discard']);
    assert.deepEqual(kinds('analyze', 'success'), ['confirm', 'reply', 'cancel']);
  });

  test('spec success → Implement / Edit spec / Discard', () => {
    assert.deepEqual(ids('spec', 'success'), ['continue', 'changes', 'discard']);
    assert.equal(computeGate('spec', { outcome: 'success' }, 'none').actions[0].label, 'Implement this spec');
  });

  test('implement success → Continue to Test / Request changes / Discard', () => {
    assert.deepEqual(ids('implement', 'success'), ['continue', 'changes', 'discard']);
    assert.deepEqual(kinds('implement', 'success'), ['confirm', 'reply', 'cancel']);
  });

  test('implement still_failing → Accept / Keep / Abandon, flagged, NO Discard', () => {
    const g = computeGate('implement', { outcome: 'still_failing' }, 'none');
    assert.deepEqual(g.actions.map((a) => a.id), ['accept', 'keep', 'abandon']);
    assert.deepEqual(g.actions.map((a) => a.kind), ['confirm', 'reply', 'cancel']);
    assert.equal(g.flag, 'still_failing');
    assert.ok(!g.actions.some((a) => a.id === 'discard'));
  });

  test('test awaiting_import (selfhost ④) → Import / Skip / Request changes / Discard, flagged (spec 041)', () => {
    const g = computeGate('test', { outcome: 'awaiting_import' }, 'selfhost');
    assert.deepEqual(g.actions.map((a) => a.id), ['import', 'skip_import', 'changes', 'discard']);
    assert.deepEqual(g.actions.map((a) => a.kind), ['confirm', 'confirm', 'reply', 'cancel']);
    // both import paths are /confirm so `auto` auto-confirms the FIRST (import)
    assert.equal(g.actions[0].kind, 'confirm');
    assert.equal(g.actions[1].kind, 'confirm');
    assert.equal(g.flag, 'awaiting_import');
  });

  // ── spec 032/036 live-test gate additions ──
  const SELFHOST = { selfhost: { url: 'http://localhost/console/api', token: 't' } };
  test('spec 036: implement success + targets.selfhost → adds a test_live confirm after Continue (continue stays first)', () => {
    const g = computeGate('implement', { outcome: 'success' }, 'none', SELFHOST);
    assert.deepEqual(g.actions.map((a) => a.id), ['continue', 'test_live', 'changes', 'discard']);
    assert.deepEqual(g.actions.map((a) => a.kind), ['confirm', 'confirm', 'reply', 'cancel']);
    assert.equal(g.actions[0].id, 'continue', 'continue is the safe static primary');
  });

  test('spec 036: implement success WITHOUT any target (default {}) is byte-identical to before — no test_live', () => {
    assert.deepEqual(ids('implement', 'success'), ['continue', 'changes', 'discard']);
    assert.deepEqual(computeGate('implement', { outcome: 'success' }, 'none', {}).actions.map((a) => a.id), [
      'continue',
      'changes',
      'discard',
    ]);
    // §8 reserved seam: a cloud-only target must NOT emit test_live in this spec (self-host is the one live target).
    assert.deepEqual(
      computeGate('implement', { outcome: 'success' }, 'none', { cloud: { url: 'u', token: 't' } }).actions.map((a) => a.id),
      ['continue', 'changes', 'discard']
    );
  });

  test('test test_result → Accept / Request changes / Re-test / Delete apps / Discard, flagged (auto hard-stops)', () => {
    const g = computeGate('test', { outcome: 'test_result' }, 'selfhost');
    assert.deepEqual(g.actions.map((a) => a.id), ['accept', 'changes', 'test_live', 'cleanup_apps', 'discard']);
    assert.deepEqual(g.actions.map((a) => a.kind), ['confirm', 'reply', 'confirm', 'confirm', 'cancel']);
    assert.equal(g.flag, 'test_result');
  });

  test('test infra_degraded → Retry live / Accept static / Request changes / Delete apps / Discard, flagged (spec 041)', () => {
    const g = computeGate('test', { outcome: 'infra_degraded' }, 'selfhost');
    assert.deepEqual(g.actions.map((a) => a.id), ['retry_live', 'accept_static', 'changes', 'cleanup_apps', 'discard']);
    assert.deepEqual(g.actions.map((a) => a.kind), ['confirm', 'confirm', 'reply', 'confirm', 'cancel']);
    assert.equal(g.flag, 'infra_degraded');
  });

  test('spec 041: test still_failing → Accept / Request changes / Discard (fixable, not just accept/discard)', () => {
    const g = computeGate('test', { outcome: 'still_failing' }, 'none');
    assert.deepEqual(g.actions.map((a) => a.id), ['accept', 'changes', 'discard']);
    assert.deepEqual(g.actions.map((a) => a.kind), ['confirm', 'reply', 'cancel']);
    assert.equal(g.flag, 'still_failing');
  });

  test('test success is terminal (no actions) regardless of deploy target', () => {
    for (const deploy of ['none', 'cloud', 'selfhost'] as Deploy[]) {
      assert.deepEqual(computeGate('test', { outcome: 'success' }, deploy).actions, []);
    }
  });

  // 013 D3: computeGate takes `deploy` but only the Lát-5 ④ awaiting_import branch is deploy-shaped,
  // and even that depends on the OUTCOME, not the deploy value — the gate is identical across targets.
  test('the deploy arg does not change the gate for error / terminal / awaiting_import', () => {
    const deploys: Deploy[] = ['none', 'selfhost', 'cloud'];
    for (const phase of ['analyze', 'spec', 'implement', 'test'] as Phase[]) {
      const ref = computeGate(phase, { outcome: 'error' }, 'none');
      for (const d of deploys) {
        assert.deepEqual(computeGate(phase, { outcome: 'error' }, d), ref, `error/${phase} ignores deploy`);
      }
    }
    // terminal ④ success: empty actions regardless of deploy.
    for (const d of deploys) assert.deepEqual(computeGate('test', { outcome: 'success' }, d).actions, []);
    // awaiting_import: same Import/Skip/Discard set regardless of the deploy value passed.
    const importRef = computeGate('test', { outcome: 'awaiting_import' }, 'selfhost');
    for (const d of deploys) {
      assert.deepEqual(computeGate('test', { outcome: 'awaiting_import' }, d), importRef, `awaiting_import ignores deploy(${d})`);
    }
  });

  test('F1 invariant: every NON-terminal, NON-error/NON-still_failing gate carries a Discard', () => {
    const carriers: Array<[Phase, GateOutcome]> = [
      ['analyze', 'success'],
      ['spec', 'success'],
      ['implement', 'success'],
      ['test', 'awaiting_import'],
    ];
    for (const [phase, outcome] of carriers) {
      const g = computeGate(phase, { outcome }, 'selfhost');
      assert.ok(g.actions.some((a) => a.id === 'discard' && a.kind === 'cancel'), `${phase}/${outcome} has Discard`);
    }
  });
});
