/**
 * Spec 078 S2 — the self-harvest promote nudge (computePromoteHint).
 *
 * Pins the anti-noise guards: (a) the v2.2 from-scratch anchor — `workflow===null &&
 * seedPath===null` (+ seedAppId; seedPath ALONE misclassifies an edit-local build as from-scratch,
 * the bug the anchor fix exists for) — checked BEFORE any python spawn; (b) node_count ≥ 4;
 * (c) verdict `new` only — near-dup/dup stay silent; lint-clean gating; and that every catalog
 * failure (non-zero exit, garbage stdout, a throw) degrades to null, never an error.
 * Also pins the wording-stable prefix the e2e comprehension lock keys off.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePromoteHint,
  promoteHintText,
  PROMOTE_HINT_PREFIX,
} from '../server/lib/promote-hint.js';
import type { runPython } from '../server/lib/shell.js';

const FROM_SCRATCH = { workflow: null, seedPath: null, seedAppId: null };
const WF = 'projects/demo/wf/workflows/main.yml';

/** A fake runPython that records calls and returns a canned catalog verdict. */
function fake(verdict: unknown, code = 0): { fn: typeof runPython; calls: string[][] } {
  const calls: string[][] = [];
  const fn = ((_dir: string, args: string[]) => {
    calls.push(args);
    return Promise.resolve({
      code,
      stdout: typeof verdict === 'string' ? verdict : JSON.stringify(verdict),
      stderr: '',
    });
  }) as typeof runPython;
  return { fn, calls };
}

const NEW_5 = { verdict: 'new', fingerprint: 'code:1|end:1|http-request:1|llm:1|start:1/e:4', node_count: 5 };

describe('spec 078 S2 — from-scratch anchor (guard a, the v2.2 fix)', () => {
  test('edit-local (workflow set, seedPath null) → silent, python never spawned', async () => {
    const { fn, calls } = fake(NEW_5);
    const hint = await computePromoteHint('/p', { workflow: 'old-wf', seedPath: null, seedAppId: null }, WF, true, fn);
    assert.equal(hint, null);
    assert.equal(calls.length, 0, 'the anchor must reject BEFORE any python spawn');
  });

  test('Dify-seed (seedPath set) → silent', async () => {
    const { fn, calls } = fake(NEW_5);
    assert.equal(
      await computePromoteHint('/p', { workflow: null, seedPath: 'projects/x/seed.yml', seedAppId: 'app-1' }, WF, true, fn),
      null
    );
    assert.equal(calls.length, 0);
  });

  test('Dify-seed whose pull failed (seedAppId set, seedPath null) → still silent', async () => {
    const { fn, calls } = fake(NEW_5);
    assert.equal(
      await computePromoteHint('/p', { workflow: null, seedPath: null, seedAppId: 'app-1' }, WF, true, fn),
      null
    );
    assert.equal(calls.length, 0);
  });

  test('lint not clean → silent, python never spawned', async () => {
    const { fn, calls } = fake(NEW_5);
    assert.equal(await computePromoteHint('/p', FROM_SCRATCH, WF, false, fn), null);
    assert.equal(calls.length, 0);
  });
});

describe('spec 078 S2 — verdict guards (b: size, c: new-only)', () => {
  test('verdict new + node_count ≥ 4 → the hint, via `check --shelf --json` on the workflow', async () => {
    const { fn, calls } = fake(NEW_5);
    const hint = await computePromoteHint('/p', FROM_SCRATCH, WF, true, fn);
    assert.equal(hint, promoteHintText(NEW_5.fingerprint));
    assert.ok(hint!.startsWith(PROMOTE_HINT_PREFIX));
    assert.ok(hint!.includes('(nút Promote)'));
    assert.deepEqual(calls, [['tools/dify_base/catalog.py', 'check', WF, '--shelf', '--json']]);
  });

  test('near-dup stays silent — better to miss than to nag (guard c)', async () => {
    const { fn } = fake({ ...NEW_5, verdict: 'near-dup' });
    assert.equal(await computePromoteHint('/p', FROM_SCRATCH, WF, true, fn), null);
  });

  test('a trivial 3-node shape stays silent even when new (guard b)', async () => {
    const { fn } = fake({ verdict: 'new', fingerprint: 'end:1|llm:1|start:1/e:2', node_count: 3 });
    assert.equal(await computePromoteHint('/p', FROM_SCRATCH, WF, true, fn), null);
  });
});

describe('spec 078 S2 — advisory end to end (a catalog failure never surfaces)', () => {
  test('non-zero exit → null', async () => {
    const { fn } = fake(NEW_5, 2);
    assert.equal(await computePromoteHint('/p', FROM_SCRATCH, WF, true, fn), null);
  });

  test('garbage stdout → null', async () => {
    const { fn } = fake('✗ not json');
    assert.equal(await computePromoteHint('/p', FROM_SCRATCH, WF, true, fn), null);
  });

  test('runPython throw → null', async () => {
    const boom = (() => Promise.reject(new Error('spawn ENOENT'))) as unknown as typeof runPython;
    assert.equal(await computePromoteHint('/p', FROM_SCRATCH, WF, true, boom), null);
  });
});
