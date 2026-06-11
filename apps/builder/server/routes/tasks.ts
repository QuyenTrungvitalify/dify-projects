/**
 * routes/tasks.ts — the HTTP surface for spec 009 (Lát 3 gate + Lát 4 SSE-live evolution).
 *
 * `/api/tasks` POST is the run-lock gate: one build at a time → 409 (AC #21). Validation + lock
 * acquire + task creation run synchronously, but the orchestrator phase work is dispatched
 * **fire-and-forget** so the response returns the new task's id IMMEDIATELY — the UI needs that id to
 * open `GET /api/tasks/:id/stream` before phase ① finishes (Lát 4; the Lát 3 header foretold "SSE
 * makes it live in Lát 4"). Every phase/status/gate transition then reaches the browser over SSE
 * (orchestrator `broadcast`); `GET /api/tasks/:id` stays the authoritative re-fetch on reconnect
 * (AC #22). `/confirm` + `/reply` follow suit: validate synchronously (a bad action / wrong status
 * still returns 4xx), then dispatch async and return an optimistic snapshot. `/cancel` stays
 * synchronous (instant). All mutating routes bind 127.0.0.1 only + Origin-check (index.ts).
 */
import type { FastifyPluginAsync } from 'fastify';
import { createTask, loadTask, saveTask, type Task } from '../state/task.js';
import {
  confirmAdvance,
  replyWithin,
  startTask,
  type ConfirmPayload,
  type OrchestratorCtx,
} from '../lib/orchestrator.js';
import { acquire, holderTaskId, liveSession, markCancelled, release } from '../lib/lock.js';
import { readArtifactContents } from '../lib/artifacts.js';

export interface TasksRoutesOptions {
  projectsDir: string;
  /** ABSOLUTE path to apps/builder/headless-settings.json. */
  settingsPath: string;
  /** Lát 4 SSE relay (orchestrator broadcasts phase/status/gate transitions + streamed output). */
  broadcast?: (taskId: string, event: string, data: unknown) => void;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const tasksRoutes: FastifyPluginAsync<TasksRoutesOptions> = async (app, opts) => {
  const { projectsDir, settingsPath, broadcast } = opts;
  const ctx: OrchestratorCtx = { projectsDir, settingsPath, log: app.log, broadcast };

  /** Last-resort: on an UNEXPECTED throw, mark the task error, relay it, and free the lock. */
  async function failSafe(taskId: string, reason: string): Promise<void> {
    try {
      const t = await loadTask(projectsDir, taskId);
      if (t.status !== 'done' && t.status !== 'cancelled') {
        t.status = 'error';
        t.error = `internal error: ${reason}`;
        await saveTask(projectsDir, t);
        broadcast?.(taskId, 'task:update', t);
      }
    } catch {
      // task gone — nothing to mark
    }
    release(taskId);
  }

  // Tasks with an orchestrator step in flight. Guards the async-dispatch window: between a /confirm
  // (or /reply) returning its optimistic snapshot and the dispatched work flipping the task to
  // `running` on disk, a 2nd /confirm would still read `awaiting_confirm` + holder===id and dispatch
  // AGAIN → two turns for one build. The synchronous `advancing` check closes that window.
  const advancing = new Set<string>();

  /** Run orchestrator work in the background; converge to a relayed `error` on an unexpected throw. */
  function dispatch(taskId: string, work: Promise<void>): void {
    advancing.add(taskId);
    void work
      .catch((e) => {
        app.log.error({ err: errMsg(e), taskId }, 'orchestrator dispatch threw');
        void failSafe(taskId, errMsg(e));
      })
      .finally(() => advancing.delete(taskId));
  }

  /** Optimistic snapshot returned right after dispatch — SSE delivers the authoritative transitions. */
  const optimisticRunning = (task: Task): Task => ({
    ...task,
    status: 'running',
    gate: undefined,
    error: undefined,
  });

  const idOf = (req: { params: unknown }): string => (req.params as { id: string }).id;

  // ── POST /api/tasks — acquire the run-lock (409 if held), create the task, run Phase ① → gate ──
  app.post('/api/tasks', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requirement = String(body.requirement ?? '').trim();
    if (!requirement) return reply.code(400).send({ error: 'requirement is required' });

    // Fast path: a build already holds the lock → 409 without minting a task.
    if (holderTaskId()) {
      return reply.code(409).send({ error: 'Busy — a build is already running', holder: holderTaskId() });
    }

    const task = await createTask(projectsDir, {
      requirement,
      workflow: (body.workflow as string | null | undefined) ?? null,
      // Accept the spec's public `confirm_mode` (verbose) AND the internal token; normalized in createTask.
      confirmMode: (body.confirm_mode ?? body.confirmMode) as string | undefined,
      // Deploy target (Lát 5): body value, else the operator default DEFAULT_DEPLOY, else 'none'.
      deploy: (body.deploy as string | undefined) ?? process.env.DEFAULT_DEPLOY ?? undefined,
      // Chosen Dify seed app id from the seed picker (Lát 5); null/absent = no Dify seed.
      seed: (body.seed as string | null | undefined) ?? null,
      slug: (body.slug as string | null | undefined) ?? null,
      name: (body.name as string | null | undefined) ?? null,
      workflowFile: (body.workflowFile as string | undefined) ?? undefined,
    });

    // Race-safe acquire: two POSTs can both pass the fast-path check; the loser marks its stray task
    // rejected and gets 409.
    if (!acquire(task.taskId)) {
      task.status = 'error';
      task.error = 'rejected — another build holds the run-lock';
      await saveTask(projectsDir, task);
      return reply.code(409).send({ error: 'Busy — a build is already running', holder: holderTaskId() });
    }

    // Dispatch phase ① in the background; the UI opens /stream with the id we return now (Lát 4).
    dispatch(task.taskId, startTask(task, ctx));
    return reply.send(task);
  });

  // ── GET /api/tasks/:id — authoritative state (phase/status/gate) + artifact contents (Endpoints) ──
  app.get('/api/tasks/:id', async (req, reply) => {
    const id = idOf(req);
    let task: Task;
    try {
      task = await loadTask(projectsDir, id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${id}` });
    }
    // The artifact panel reads SPEC.md / main.yml / report from here (spec Endpoints :532). The diff
    // producer is Lát 5 → `artifacts.diff` stays null (panel degrades to "no diff yet").
    const artifactContents = await readArtifactContents(projectsDir, task);
    return { ...task, artifactContents };
  });

  // ── POST /api/tasks/:id/confirm — advance one boundary (the gate) ──
  app.post('/api/tasks/:id/confirm', async (req, reply) => {
    const id = idOf(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const actionId = String(body.actionId ?? '').trim();
    if (!actionId) return reply.code(400).send({ error: 'actionId is required' });

    let task;
    try {
      task = await loadTask(projectsDir, id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${id}` });
    }
    if (task.status !== 'awaiting_confirm') {
      return reply.code(409).send({ error: `task is ${task.status}, not awaiting_confirm` });
    }
    // An awaiting_confirm build HOLDS the lock (§I). If this gate is NOT the holder (corrupt .runs
    // state / stale file), confirming it would spawn a turn whose child setSession() silently drops —
    // an untracked, unkillable turn. Reject instead.
    if (holderTaskId() !== id) {
      return reply.code(409).send({ error: 'this gate is not the active build (lock held by another task)', holder: holderTaskId() });
    }

    // Validate the action synchronously so a stale/unknown action returns 409 to the caller.
    const action = task.gate?.actions.find((a) => a.id === actionId && a.kind === 'confirm');
    if (!action) {
      return reply.code(409).send({ error: `'${actionId}' is not a current confirm action` });
    }

    const payload: ConfirmPayload = {};
    if (typeof body.slug === 'string') payload.slug = body.slug;
    if (typeof body.name === 'string') payload.name = body.name;

    // Close the async-dispatch race: a step is already advancing this build (a 2nd click before the
    // first dispatch flips the disk status) → 409 instead of a duplicate turn.
    if (advancing.has(id)) {
      return reply.code(409).send({ error: 'a step is already in progress for this build' });
    }
    // Dispatch the advance in the background; SSE carries the next phase/gate (Lát 4).
    dispatch(id, confirmAdvance(task, actionId, ctx, payload));
    return reply.send(optimisticRunning(task));
  });

  // ── POST /api/tasks/:id/reply — revise WITHIN the current phase (or Retry out of error) ──
  app.post('/api/tasks/:id/reply', async (req, reply) => {
    const id = idOf(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = String(body.text ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'text is required' });

    let task;
    try {
      task = await loadTask(projectsDir, id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${id}` });
    }
    if (task.status !== 'awaiting_confirm' && task.status !== 'error') {
      return reply
        .code(409)
        .send({ error: `task is ${task.status}; /reply needs awaiting_confirm or error` });
    }
    // An awaiting_confirm build HOLDS the lock — a non-holder gate is stale/corrupt (see /confirm).
    if (task.status === 'awaiting_confirm' && holderTaskId() !== id) {
      return reply.code(409).send({ error: 'this gate is not the active build (lock held by another task)', holder: holderTaskId() });
    }
    // Close the async-dispatch race (a 2nd reply/confirm before the dispatch flips disk status).
    // BEFORE the error-retry acquire below, so a 409 here never leaks a just-taken lock.
    if (advancing.has(id)) {
      return reply.code(409).send({ error: 'a step is already in progress for this build' });
    }
    // Retry out of `error` re-acquires the lock (error released it, §I); 409 if another build holds it.
    if (task.status === 'error' && !acquire(task.taskId)) {
      return reply
        .code(409)
        .send({ error: 'Busy — another build holds the run-lock', holder: holderTaskId() });
    }

    // Dispatch the within-phase revise (or Retry-out-of-error) in the background; SSE carries it.
    // A throw inside lands in dispatch → failSafe, which RELEASES the lock, so the error-retry lock
    // taken just above can't leak even on an unexpected failure.
    dispatch(id, replyWithin(task, text, ctx));
    return reply.send(optimisticRunning(task));
  });

  // ── POST /api/tasks/:id/cancel — kill the live turn (or just flip a paused gate) + free the lock ──
  app.post('/api/tasks/:id/cancel', async (req, reply) => {
    const id = idOf(req);
    let task;
    try {
      task = await loadTask(projectsDir, id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${id}` });
    }

    // Mark first (survives the lock release; the orchestrator's in-flight bail checks this).
    markCancelled(id);
    const sess = liveSession(id);
    if (sess) {
      try {
        sess.forceKill(); // running turn → the orchestrator converges the state to `cancelled`
      } catch {
        // already exited
      }
    }
    // Converge to a terminal cancelled status (idempotent with the orchestrator bail). Leave `done` be.
    const fresh = await loadTask(projectsDir, id);
    if (fresh.status !== 'done' && fresh.status !== 'cancelled') {
      fresh.status = 'cancelled';
      fresh.gate = undefined;
      fresh.error = fresh.error ?? 'cancelled by user';
      await saveTask(projectsDir, fresh);
      broadcast?.(id, 'task:update', fresh); // relay the cancel to the SSE clients (Lát 4)
    }
    release(id); // frees the run-lock so a new POST /api/tasks succeeds (AC #24)
    return reply.send(await loadTask(projectsDir, id));
  });
};

export default tasksRoutes;
