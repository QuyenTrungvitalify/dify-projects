/**
 * Spec 111 — Restore puts the human back where they were STANDING, not one boundary back.
 *
 * The rewind was written for one path: "you clicked Continue, the next phase started, you cancelled —
 * undo that Continue". `restoreTargetPhaseFor` reads `task.phase` and always steps back one, so it
 * cannot tell that path from the other way a cancel happens: a FIX ROUND on a build that has been
 * parked at ③ for rounds, which crossed no boundary at all.
 *
 * Observed on run 1787544155222. ③ had reached its gate twice (15:35, 16:32) when the 17:00 fix round
 * was cancelled; the restore dropped the build to ②, whose only way forward re-runs ③ as a FRESH turn
 * (`confirmAdvance` — "no cross-phase resume"), discarding the ③ session. The human took neither
 * option and kept steering from the ② gate for 13 turns / 7 hours, which is how phase ② came to be
 * editing `main.yml` (spec 108 §7.2). Nothing on the timeline said the phase had moved: the events
 * file goes `implement phase_start` 17:00 → `spec phase_start` 17:06 with nothing between.
 *
 * The evidence that a gate exists to return to is `gate_reached` on the cancelled phase — read from
 * the timeline, NOT from a new persisted field, so builds cancelled before this shipped restore
 * correctly too. Deliberately not `sessionIds[phase]`: that is set moments into a turn, so a first ③
 * killed mid-flight carries it and would reopen a gate that never existed — the third test pins that.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import tasksRoutes, { type TasksRoutesOptions } from '../server/routes/tasks.js';
import { saveTask, loadTask, taskDir, type Task } from '../server/state/task.js';
import type { RunEvent } from '../server/lib/run-events.js';

const TASK_ID = '1780000000111';

describe('POST /restore — return to the gate that existed (spec 111)', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof Fastify>>;

  /** A build cancelled at `phase`, with `status: 'cancelled'` exactly as /cancel converges it. */
  async function cancelledAt(phase: Task['phase'], over: Partial<Task> = {}): Promise<Task> {
    const task = {
      taskId: TASK_ID, kind: 'build', project: '_drafts', workflowSlug: 'wf', workflowFile: 'main.yml',
      requirement: 'x', phase, status: 'cancelled', error: 'cancelled by user',
      sessionIds: { implement: 'sess-impl' }, artifacts: {}, deploy: 'none', testMode: 'static',
      confirmMode: 'each_step', fastMode: false, seedPath: null, seedAppId: null,
      appId: null, appUrl: null, workflow: null, name: null, gate: undefined,
      ...over,
    } as unknown as Task;
    await saveTask(dir, task);
    return task;
  }

  /** Write the run timeline this task is supposed to be restored FROM. */
  async function timeline(...events: Array<Partial<RunEvent>>): Promise<void> {
    const lines = events.map((e) => JSON.stringify({ ts: 1, kind: 'phase_start', ...e })).join('\n');
    await writeFile(join(taskDir(dir, TASK_ID), 'events.jsonl'), lines + '\n');
  }

  async function events(): Promise<RunEvent[]> {
    const raw = await readFile(join(taskDir(dir, TASK_ID), 'events.jsonl'), 'utf8');
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as RunEvent);
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'restore-target-'));
    await mkdir(join(dir, 'projects', '_drafts', 'wf', 'workflows'), { recursive: true });
    await mkdir(join(dir, 'apps', 'builder', '.runs', TASK_ID), { recursive: true });
    await writeFile(join(dir, 'projects/_drafts/wf/SPEC.md'), '# Spec\n');
    app = Fastify();
    const opts: TasksRoutesOptions = { projectsDir: dir, settingsPath: '' };
    await app.register(tasksRoutes, opts);
  });
  afterEach(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  test('a cancelled FIX ROUND reopens ③ — it does not fall back to ②', async () => {
    await cancelledAt('implement');
    await timeline(
      { phase: 'implement', kind: 'phase_start', detail: 'fresh' },
      { phase: 'implement', kind: 'gate_reached', detail: 'success' }, // ③ provably parked at a gate
      { phase: 'implement', kind: 'phase_start', detail: 'reply' }, // …then the fix round that was cancelled
    );

    const res = await app.inject({ method: 'POST', url: `/api/tasks/${TASK_ID}/restore` });

    assert.equal(res.statusCode, 200);
    const after = await loadTask(dir, TASK_ID);
    assert.equal(after.phase, 'implement', 'the phase the human was standing in survives the cancel');
    assert.equal(after.status, 'awaiting_confirm');
    assert.ok(after.gate?.actions.some((a) => a.id === 'continue'), 'and it is a real ③ gate, not an error park');
  });

  test('a cancel with NO gate behind it still rewinds a boundary — the original case, unchanged', async () => {
    // Clicked Continue at ②, ③ started, cancelled before it ever reached a gate.
    await cancelledAt('implement');
    await timeline(
      { phase: 'spec', kind: 'gate_reached', detail: 'success' },
      { phase: 'implement', kind: 'phase_start', detail: 'fresh' },
    );

    const res = await app.inject({ method: 'POST', url: `/api/tasks/${TASK_ID}/restore` });

    assert.equal(res.statusCode, 200);
    const after = await loadTask(dir, TASK_ID);
    assert.equal(after.phase, 'spec', 'no ③ gate ever existed → the Continue is what gets undone');
    assert.equal(after.status, 'awaiting_confirm');
  });

  test('a live session id is NOT evidence of a gate', async () => {
    // `sessionIds.implement` is set moments into a turn, so a first ③ killed mid-flight carries one.
    // Keying on it would reopen a ③ gate that never existed — and hand the human a "Continue to Test"
    // button for a workflow file that was never written.
    await cancelledAt('implement', { sessionIds: { implement: 'sess-impl' } as Task['sessionIds'] });
    await timeline({ phase: 'implement', kind: 'phase_start', detail: 'fresh' });

    await app.inject({ method: 'POST', url: `/api/tasks/${TASK_ID}/restore` });

    assert.equal((await loadTask(dir, TASK_ID)).phase, 'spec');
  });

  test('the phase never moves without a line on the timeline saying so', async () => {
    // The forensic half. On the real run the ③→② drop had to be reconstructed from file mtimes,
    // because nothing between the two `phase_start` lines recorded it.
    await cancelledAt('implement');
    await timeline({ phase: 'implement', kind: 'gate_reached', detail: 'success' });

    await app.inject({ method: 'POST', url: `/api/tasks/${TASK_ID}/restore` });

    const restored = (await events()).filter((e) => e.kind === 'restored');
    assert.equal(restored.length, 1, 'exactly one restore line');
    assert.match(restored[0].detail ?? '', /implement → implement/);
  });

  test('/cancel writes its own line, and says whether a turn was killed', async () => {
    // `process exited code null before a result event` in a transcript is otherwise indistinguishable
    // from a crash. No turn is running here, so this is the parked path.
    await cancelledAt('implement', { status: 'awaiting_confirm' });
    await timeline({ phase: 'implement', kind: 'gate_reached', detail: 'success' });

    const res = await app.inject({ method: 'POST', url: `/api/tasks/${TASK_ID}/cancel` });

    assert.equal(res.statusCode, 200);
    const cancelled = (await events()).filter((e) => e.kind === 'cancelled');
    assert.equal(cancelled.length, 1);
    assert.match(cancelled[0].detail ?? '', /parked at implement/);
  });

  test('restore still refuses on a build that is not cancelled', async () => {
    await cancelledAt('implement', { status: 'awaiting_confirm' });
    const res = await app.inject({ method: 'POST', url: `/api/tasks/${TASK_ID}/restore` });
    assert.equal(res.statusCode, 409);
  });
});
