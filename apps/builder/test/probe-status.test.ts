/**
 * Spec 086 S1 — probeStatus: the structured probe verdict, derived from the minted note by prefix.
 * The test is a ROUNDTRIP through probeVerdict (mint) → probeStatus (match): reword a verdict in
 * report.ts without updating the matcher and this fails — the co-location guard (085 isTimeoutNote
 * discipline), same reason both live in report.ts.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { probeVerdict, probeStatus } from '../server/lib/report.js';

describe('probeStatus — mint→match roundtrip (spec 086 S1)', () => {
  test('every minted verdict maps to its structured value', () => {
    assert.equal(probeStatus(probeVerdict.ok()), 'ok');
    assert.equal(probeStatus(probeVerdict.ok('[probe] 123')), 'ok'); // stray-copy variant still ok
    assert.equal(probeStatus(probeVerdict.rejected('HTTP 400')), 'failed');
    assert.equal(probeStatus(probeVerdict.rejected('')), 'failed');
    assert.equal(probeStatus(probeVerdict.parked()), 'unknown_version');
    assert.equal(probeStatus(probeVerdict.skipped('timeout')), 'skipped');
  });

  test('no note / unrecognized note → null (no probe ran ≠ any verdict)', () => {
    assert.equal(probeStatus(undefined), null);
    assert.equal(probeStatus(null), null);
    assert.equal(probeStatus(''), null);
    assert.equal(probeStatus('some future wording'), null);
  });
});
