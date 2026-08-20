/**
 * Spec 103 step 1 — the undo: snapshot a fix round before it runs, take the whole round back after.
 *
 * This exists because L0 opened a hole while closing another one. Before L0, ③ never touched
 * `SPEC.md`; after it, every fix round overwrites the file — and `projects/_drafts/` is gitignored
 * wholesale, so there was no git history, no `.bak`, nothing. A bad reconcile destroyed the previous
 * spec permanently. The measured example is in `spec-reconcile-prompt.test.ts`: a round that updated
 * SPEC.md, passed every automated check, and left the document contradicting itself.
 *
 * The invariant every case here defends is BOTH-OR-NEITHER. Restoring only `SPEC.md` leaves it
 * describing a `main.yml` it no longer matches; restoring only `main.yml` leaves the spec describing a
 * change that is gone. Either half alone is drift — with a friendly button on it. So a missing half
 * must refuse, never partially succeed.
 */
import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  snapshotDiffBase, snapshotSpecBase, fixRoundUndoable, undoFixRound, specBaseRel, produceDiff,
  countHunks,
} from '../server/lib/diff.js';
import type { Task } from '../server/state/task.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const SPEC_V1 = '# Spec\n\nThreshold 0.5.\n';
const SPEC_V2 = '# Spec\n\nThreshold 0.2.\n';
const YAML_V1 = 'workflow:\n  graph:\n    nodes: []\n';
const YAML_V2 = 'workflow:\n  graph:\n    nodes: []\n# round 1\n';

const TASK_ID = '1000000000003';

function fixture(over: Partial<Task> = {}): { dir: string; task: Task; specAbs: string; ymlAbs: string } {
  const dir = mkdtempSync(join(tmpdir(), 'undo-fix-'));
  dirs.push(dir);
  const task = {
    taskId: TASK_ID, project: '_drafts', workflowSlug: 'wf', workflowFile: 'main.yml', ...over,
  } as Task;
  // `runPython` execs `<projectsDir>/.venv/bin/python`, and the fixture IS the projectsDir. Delegate to
  // the real interpreter rather than stubbing it: the point of the diff cases below is that difflib
  // actually ran, and a stub that printed nothing would make "unchanged" and "no base" look identical —
  // the one distinction those tests exist to hold apart.
  const bin = join(dir, '.venv', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'python'), '#!/usr/bin/env bash\nexec python3 "$@"\n', { mode: 0o755 });
  const wfDir = join(dir, 'projects', '_drafts', 'wf');
  mkdirSync(join(wfDir, 'workflows'), { recursive: true });
  const specAbs = join(wfDir, 'SPEC.md');
  const ymlAbs = join(wfDir, 'workflows', 'main.yml');
  writeFileSync(specAbs, SPEC_V1);
  writeFileSync(ymlAbs, YAML_V1);
  return { dir, task, specAbs, ymlAbs };
}

/** What the orchestrator does before spawning a FIX round (both snapshots, in that order). */
async function armFixRound(dir: string, task: Task): Promise<void> {
  await snapshotDiffBase(dir, task, { restart: true });
  await snapshotSpecBase(dir, task);
}

describe('103 step 1 · arming a fix round', () => {
  test('a fix round snapshots BOTH files', async () => {
    const { dir, task } = fixture();
    await armFixRound(dir, task);
    assert.equal(readFileSync(join(dir, specBaseRel(TASK_ID)), 'utf8'), SPEC_V1);
    assert.equal(fixRoundUndoable(dir, task), true);
  });

  test('a build with no SPEC.md on disk is not armed, and not undoable', async () => {
    // Nothing to restore ⇒ the gate must not offer a button that would always 409.
    const { dir, task, specAbs } = fixture();
    rmSync(specAbs);
    await armFixRound(dir, task);
    assert.equal(existsSync(join(dir, specBaseRel(TASK_ID))), false);
    assert.equal(fixRoundUndoable(dir, task), false);
  });

  test('a DIFY-SEED build is NOT undoable — half a restore is worse than none', async () => {
    // `snapshotDiffBase` no-ops for a build seeded from a Dify app (that app IS the diff base), so
    // there is no pre-round main.yml. The spec side would restore fine, and that is exactly the
    // danger: SPEC.md would go back while the workflow stayed forward. Deliberately excluded.
    const { dir, task } = fixture({ seedAppId: 'app-abc123' });
    await armFixRound(dir, task);
    assert.equal(existsSync(join(dir, specBaseRel(TASK_ID))), true, 'the spec half WAS taken');
    assert.equal(fixRoundUndoable(dir, task), false, 'but the pair is incomplete → refuse');
  });

  test('a LOCAL edit-existing build IS undoable — it is the case undo exists for (spec 105)', async () => {
    // `localEditSeed` sets `seedPath` on every local edit-existing build, and the exclusion above used
    // to key on that field — so the person most likely to want undo (someone fixing a workflow they
    // already had) was the one who never got the button, while a workflow they had just built did.
    // `seedPath` set, `seedAppId` absent: the snapshot must be taken.
    const { dir, task } = fixture({ seedPath: 'apps/builder/.runs/1780000000000/seed.yml' });
    await armFixRound(dir, task);
    assert.equal(fixRoundUndoable(dir, task), true, 'both halves taken → the round can be taken back');
  });

  test('the snapshot is re-armed each round — undo takes back the LAST round, not the first', async () => {
    const { dir, task, specAbs, ymlAbs } = fixture();
    await armFixRound(dir, task); // round 1 starts from V1
    writeFileSync(specAbs, SPEC_V2);
    writeFileSync(ymlAbs, YAML_V2); // round 1 edits
    await armFixRound(dir, task); // round 2 starts from V2
    assert.equal(readFileSync(join(dir, specBaseRel(TASK_ID)), 'utf8'), SPEC_V2);
  });
});

describe('103 step 1 · taking the round back', () => {
  test('undo restores BOTH files to their pre-round state', async () => {
    const { dir, task, specAbs, ymlAbs } = fixture();
    await armFixRound(dir, task);
    writeFileSync(specAbs, SPEC_V2);
    writeFileSync(ymlAbs, YAML_V2);

    assert.equal(await undoFixRound(dir, task), true);
    assert.equal(readFileSync(specAbs, 'utf8'), SPEC_V1);
    assert.equal(readFileSync(ymlAbs, 'utf8'), YAML_V1);
  });

  test('an incomplete snapshot pair REFUSES, and leaves both files untouched', async () => {
    // The load-bearing case. A partial restore is the one outcome worse than no undo at all: it
    // manufactures the exact SPEC.md-vs-main.yml drift this spec exists to remove.
    const { dir, task, specAbs, ymlAbs } = fixture();
    await armFixRound(dir, task);
    writeFileSync(specAbs, SPEC_V2);
    writeFileSync(ymlAbs, YAML_V2);
    rmSync(join(dir, specBaseRel(TASK_ID))); // one half of the pair goes missing

    assert.equal(await undoFixRound(dir, task), false);
    assert.equal(readFileSync(specAbs, 'utf8'), SPEC_V2, 'spec untouched');
    assert.equal(readFileSync(ymlAbs, 'utf8'), YAML_V2, 'workflow untouched — no half restore');
  });

  test('undo is idempotent: doing it twice lands on the same state', async () => {
    const { dir, task, specAbs, ymlAbs } = fixture();
    await armFixRound(dir, task);
    writeFileSync(specAbs, SPEC_V2);
    writeFileSync(ymlAbs, YAML_V2);
    await undoFixRound(dir, task);
    await undoFixRound(dir, task); // a double-click, a retried request
    assert.equal(readFileSync(specAbs, 'utf8'), SPEC_V1);
    assert.equal(readFileSync(ymlAbs, 'utf8'), YAML_V1);
  });
});

describe('103 step 1 · the spec diff rides the same round', () => {
  // Needs a real `python3` on PATH (the fixture's shim delegates to it).
  const runnable = (() => {
    try {
      execFileSync('python3', ['-c', 'import difflib'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  test('no spec base → specDiff is UNDEFINED, not an empty string', { skip: !runnable }, async () => {
    // "there was no previous spec" and "the spec did not change" are different facts; the panel renders
    // them differently (absent section vs an explicit "unchanged" line), so the payload must too.
    const { dir, task } = fixture();
    await snapshotDiffBase(dir, task, { restart: true }); // workflow base only
    const payload = await produceDiff(dir, task);
    assert.equal(payload.specDiff, undefined);
  });

  test('spec base present + spec edited → specDiff carries the change', { skip: !runnable }, async () => {
    const { dir, task, specAbs } = fixture();
    await armFixRound(dir, task);
    writeFileSync(specAbs, SPEC_V2);
    const payload = await produceDiff(dir, task);
    assert.ok(payload.specDiff && payload.specDiff.includes('0.2'), 'the new line is in the diff');
    assert.ok(payload.specDiff.includes('0.5'), 'and so is the old one');
  });

  test('spec base present + spec untouched → specDiff is EMPTY, and that is a real answer', { skip: !runnable }, async () => {
    const { dir, task } = fixture();
    await armFixRound(dir, task);
    const payload = await produceDiff(dir, task);
    assert.equal(payload.specDiff, '', 'measured, and nothing moved — distinct from undefined above');
  });
});

describe('103 step 1 follow-up · countHunks — the round\'s own footprint', () => {
  test('counts the PLACES a diff touches, not its lines', () => {
    const two = '--- a\n+++ b\n@@ -1,3 +1,3 @@\n-x\n+y\n@@ -20,2 +20,2 @@\n-p\n+q\n';
    assert.equal(countHunks(two), 2);
  });

  test('an empty diff is ZERO places — measured, and nothing moved', () => {
    assert.equal(countHunks(''), 0);
  });

  test('not measured stays not measured', () => {
    // Same three-state contract as `specChanged` and `isSpecStale`. A `?? 0` here would put "the spec
    // did not move" on a card for a round nobody looked at.
    assert.equal(countHunks(undefined), undefined);
  });
});
