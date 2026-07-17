/**
 * Spec 062 S1b — the run timeline (lib/run-events.ts). `logEvent` appends one JSONL line per
 * transition; `readEvents` reads them back in order. Contract: NON-FATAL (a write to a bad dir must not
 * throw — a timeline failure can never break a build turn), missing file → [], multi-line `detail`
 * stays one line, and a torn final line is skipped rather than aborting the read.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logEvent, readEvents, EVENTS_FILE } from '../server/lib/run-events.js';

describe('run-events (spec 062 S1b)', () => {
  test('append then read back, in order, with kind/phase/detail', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ev-'));
    try {
      await logEvent(dir, { kind: 'phase_start', phase: 'implement', detail: 'fresh', nowMs: 1000 });
      await logEvent(dir, { kind: 'error', phase: 'implement', detail: 'lint gate failed', nowMs: 2000 });
      await logEvent(dir, { kind: 'retry', phase: 'implement', detail: 'đổi Slack → Teams', nowMs: 3000 });
      const evs = await readEvents(dir);
      assert.equal(evs.length, 3);
      assert.deepEqual(evs.map((e) => e.kind), ['phase_start', 'error', 'retry']);
      assert.equal(evs[0].phase, 'implement');
      assert.equal(evs[1].detail, 'lint gate failed');
      assert.equal(evs[2].detail, 'đổi Slack → Teams');
      assert.deepEqual(evs.map((e) => e.ts), [1000, 2000, 3000]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('multi-line detail collapses to a single JSONL line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ev-'));
    try {
      await logEvent(dir, { kind: 'request_changes', phase: 'spec', detail: 'line one\nline two\nline three' });
      const evs = await readEvents(dir);
      assert.equal(evs.length, 1);
      assert.ok(!evs[0].detail!.includes('\n'), 'no raw newline survived');
      assert.match(evs[0].detail!, /line one ⏎ line two ⏎ line three/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('non-fatal: a write to a non-existent dir does NOT throw', async () => {
    // A build turn must never die because the timeline couldn't be written (S1b).
    await assert.doesNotReject(() => logEvent(join(tmpdir(), 'no-such-dir-xyz', 'deeper'), { kind: 'error' }));
  });

  test('missing events file → [] (no throw)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ev-'));
    try {
      assert.deepEqual(await readEvents(dir), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a torn final line (crash mid-append) is skipped, earlier events survive', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ev-'));
    try {
      await logEvent(dir, { kind: 'phase_start', phase: 'analyze' });
      appendFileSync(join(dir, EVENTS_FILE), '{"ts":5,"kind":"gate_rea'); // half-written line, no newline
      const evs = await readEvents(dir);
      assert.equal(evs.length, 1);
      assert.equal(evs[0].kind, 'phase_start');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
