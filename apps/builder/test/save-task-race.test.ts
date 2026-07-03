/**
 * saveTask concurrency — regression for the /cancel ENOENT 500.
 *
 * `saveTask` writes a temp file then renames it onto `task.json`. With a FIXED `${final}.tmp` name, two
 * saves running concurrently for the SAME task (e.g. /cancel's save while the force-killed turn's own
 * save was still in flight) both wrote then renamed the SAME `.tmp` → the second rename threw
 * `ENOENT: rename …/task.json.tmp -> …/task.json` (the first had already consumed it) → an HTTP 500
 * surfaced on cancel. The fix gives every save a unique temp name, so concurrent saves never collide.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTask, saveTask, loadTask } from '../server/state/task.js';

test('saveTask: many concurrent saves for one task never collide on the temp file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'savetask-'));
  try {
    const task = await createTask(dir, { requirement: 'race', deploy: 'none' });
    // Old code: high temp-file contention here threw ENOENT on at least one rename. New code: all resolve.
    await assert.doesNotReject(
      Promise.all(Array.from({ length: 40 }, (_, i) => saveTask(dir, { ...task, rev: i }))),
    );
    // task.json is a complete, parseable last-writer state (no half-written / missing file).
    const reloaded = await loadTask(dir, task.taskId);
    assert.equal(reloaded.taskId, task.taskId);
    assert.equal(typeof reloaded.rev, 'number');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
