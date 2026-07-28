/**
 * 013 D3 (C3) — push_intent idempotency. `sync.py push` ALWAYS creates a NEW Dify app, so the
 * write-before-push marker is the ONLY guard against a crash/restart duplicating the app. This pins:
 *   • writePushIntent → readPushIntent round-trip + clear; corrupt/absent → null (never throws);
 *   • reconcilePushIntents NEVER re-pushes: a marker WITHOUT an appId whose id can't be reconciled
 *     (Dify list unavailable) is left appId:null and the task is annotated "check Dify" — it does
 *     not invent an id, and an already-resolved marker (appId set) is skipped untouched;
 *   • a SINGLE-match reconcile attaches the recovered id (marker write-back + task.appId +
 *     the "recovered after a mid-import restart" note) — still without pushing.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writePushIntent,
  readPushIntent,
  clearPushIntent,
  reconcilePushIntents,
} from '../server/lib/recovery.js';
import { saveTask, type Task } from '../server/state/task.js';
import type { SessionLogger } from '../server/lib/claude-session.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;

const runsDir = (dir: string, taskId: string): string => join(dir, 'apps/builder/.runs', taskId);
const markerPath = (dir: string, taskId: string): string => join(runsDir(dir, taskId), 'push_intent.json');

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'recovery-'));
}

/** A minimal Task on disk so reconcilePushIntents can load + annotate it. */
async function seedTask(dir: string, taskId: string): Promise<Task> {
  const task = {
    taskId, project: 'p', workflow: null, workflowFile: 'main.yml', requirement: 'r',
    seedPath: null, seedAppId: null, deploy: 'selfhost', appId: null, appUrl: null,
    confirmMode: 'each_step', phase: 'test', status: 'error', workflowSlug: 'wf', name: 'App',
    sessionIds: {}, artifacts: {},
  } as unknown as Task;
  await saveTask(dir, task);
  return task;
}

describe('push_intent round-trip (013 D3 / C3)', () => {
  test('write → read returns the same intent; clear removes it', async () => {
    const dir = tmp();
    await writePushIntent(dir, '1', { project: 'p', workflowSlug: 'wf', file: 'main.yml', appName: 'App', appId: null });
    assert.deepEqual(await readPushIntent(dir, '1'), { project: 'p', workflowSlug: 'wf', file: 'main.yml', appName: 'App', appId: null });

    await writePushIntent(dir, '1', { project: 'p', workflowSlug: 'wf', file: 'main.yml', appName: 'App', appId: 'abc' });
    assert.equal((await readPushIntent(dir, '1'))?.appId, 'abc', 'appId written back');

    await clearPushIntent(dir, '1');
    assert.equal(await readPushIntent(dir, '1'), null, 'cleared → null');
  });

  test('write is atomic: no .tmp residue, overwrite never leaves a torn marker (spec 014 D3)', async () => {
    const dir = tmp();
    await writePushIntent(dir, '3', { project: 'p', workflowSlug: 'wf', file: 'main.yml', appName: 'App', appId: null });
    // temp+rename: the staging file must NOT survive and the marker must be complete valid JSON.
    assert.equal(existsSync(markerPath(dir, '3') + '.tmp'), false, 'no .tmp staging file left behind');
    assert.deepEqual(await readPushIntent(dir, '3'), { project: 'p', workflowSlug: 'wf', file: 'main.yml', appName: 'App', appId: null });
    // overwriting (id written back) is likewise clean — rename replaces in place, no torn read.
    await writePushIntent(dir, '3', { project: 'p', workflowSlug: 'wf', file: 'main.yml', appName: 'App', appId: 'xyz' });
    assert.equal(existsSync(markerPath(dir, '3') + '.tmp'), false, 'no .tmp after overwrite');
    assert.equal((await readPushIntent(dir, '3'))?.appId, 'xyz');
  });

  test('absent marker → null; corrupt JSON → null (never throws)', async () => {
    const dir = tmp();
    assert.equal(await readPushIntent(dir, 'nope'), null);
    mkdirSync(runsDir(dir, '2'), { recursive: true });
    writeFileSync(markerPath(dir, '2'), '{ not json');
    assert.equal(await readPushIntent(dir, '2'), null);
  });
});

describe('reconcilePushIntents — reconcile, NEVER re-push (013 D3 / AC #25)', () => {
  test('marker without appId + Dify list unavailable → task annotated, marker left appId:null', async () => {
    const dir = tmp();
    await seedTask(dir, '100');
    await writePushIntent(dir, '100', { project: 'p', workflowSlug: 'wf', file: 'main.yml', appName: 'App', appId: null });

    // reconcileAppIdByName shells `.venv/bin/python sync.py list` → ENOENT in a bare tmpdir → null,
    // so the recover path can't find an id. It must NOT fabricate one nor re-push.
    await reconcilePushIntents(dir, log);

    const marker = JSON.parse(readFileSync(markerPath(dir, '100'), 'utf8'));
    assert.equal(marker.appId, null, 'marker still has NO appId (no re-push, no invented id)');
    const task = JSON.parse(readFileSync(join(runsDir(dir, '100'), 'task.json'), 'utf8'));
    assert.match(task.error, /check Dify/, 'task annotated to check Dify');
  });

  test('marker without appId + AMBIGUOUS reconcile (≥2 same-named) → "verify in Dify", appId NOT attached (D6)', async () => {
    const dir = tmp();
    await seedTask(dir, '150');
    await writePushIntent(dir, '150', { project: 'p', workflowSlug: 'wf', file: 'main.yml', appName: 'App', appId: null });

    // inject a reconcile that reports ambiguity (the real path shells `sync.py list` → ≥2 name matches).
    await reconcilePushIntents(dir, log, async () => ({ appId: null, ambiguous: true }));

    const marker = JSON.parse(readFileSync(markerPath(dir, '150'), 'utf8'));
    assert.equal(marker.appId, null, 'ambiguous → NEVER a guessed appId (no wrong-app attach)');
    const task = JSON.parse(readFileSync(join(runsDir(dir, '150'), 'task.json'), 'utf8'));
    assert.match(task.error, /[Vv]erify in Dify/, 'task annotated "ambiguous — verify in Dify"');
    assert.equal(task.appId ?? null, null, 'no app id attached');
  });

  test('marker without appId + SINGLE-match reconcile → id attached to marker + task, "recovered" note', async () => {
    const dir = tmp();
    await seedTask(dir, '175');
    await writePushIntent(dir, '175', { project: 'p', workflowSlug: 'wf', file: 'main.yml', appName: 'App', appId: null });

    // inject a reconcile that finds exactly ONE name match (the real path shells `sync.py list`).
    await reconcilePushIntents(dir, log, async () => ({ appId: 'app-42', ambiguous: false }));

    const marker = JSON.parse(readFileSync(markerPath(dir, '175'), 'utf8'));
    assert.equal(marker.appId, 'app-42', 'recovered id written BACK into the marker (idempotency key resolved)');
    const task = JSON.parse(readFileSync(join(runsDir(dir, '175'), 'task.json'), 'utf8'));
    assert.equal(task.appId, 'app-42', 'recovered id attached to the task (the user sees the app)');
    assert.match(task.error, /recovered after a mid-import restart.*app-42/, 'the "recovered" note names the id');
  });

  test('marker already resolved (appId set) is skipped untouched', async () => {
    const dir = tmp();
    const task = await seedTask(dir, '200');
    task.error = 'original error';
    await saveTask(dir, task);
    await writePushIntent(dir, '200', { project: 'p', workflowSlug: 'wf', file: 'main.yml', appName: 'App', appId: 'already-here' });

    await reconcilePushIntents(dir, log);

    const after = JSON.parse(readFileSync(join(runsDir(dir, '200'), 'task.json'), 'utf8'));
    assert.equal(after.error, 'original error', 'a resolved marker leaves the task untouched');
    const marker = JSON.parse(readFileSync(markerPath(dir, '200'), 'utf8'));
    assert.equal(marker.appId, 'already-here');
  });

  test('missing runs root → no-op (no throw)', async () => {
    const dir = tmp(); // nothing under apps/builder/.runs
    await reconcilePushIntents(dir, log);
    assert.ok(true);
  });
});
