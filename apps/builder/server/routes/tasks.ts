/**
 * routes/tasks.ts — the HTTP surface for spec 009 Lát 3 (curl-driven; no SSE — that's Lát 4).
 *
 * `/api/tasks` POST is the run-lock gate: one build at a time → 409 (AC #21). Every step `await`s
 * the orchestrator so the response carries the resulting gate (the simplest correct v1; SSE makes
 * it live in Lát 4). `/cancel` works whether or not a turn is live: it kills the child if running,
 * else (paused at a gate) just flips the status — then frees the lock (AC #24). All mutating POSTs
 * bind 127.0.0.1 only (index.ts, hardcoded).
 */
import type { FastifyPluginAsync } from 'fastify';
import { createTask, loadTask, saveTask } from '../state/task.js';
import {
  confirmAdvance,
  replyWithin,
  startTask,
  type ConfirmPayload,
  type OrchestratorCtx,
} from '../lib/orchestrator.js';
import { acquire, holderTaskId, liveSession, markCancelled, release } from '../lib/lock.js';

export interface TasksRoutesOptions {
  projectsDir: string;
  /** ABSOLUTE path to apps/builder/headless-settings.json. */
  settingsPath: string;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const statusOf = (e: unknown): number =>
  (e as { statusCode?: number })?.statusCode && Number.isInteger((e as { statusCode?: number }).statusCode)
    ? (e as { statusCode: number }).statusCode
    : 500;

const tasksRoutes: FastifyPluginAsync<TasksRoutesOptions> = async (app, opts) => {
  const { projectsDir, settingsPath } = opts;
  const ctx: OrchestratorCtx = { projectsDir, settingsPath, log: app.log };

  /** Last-resort: on an UNEXPECTED throw, mark the task error and free the lock so it can't leak. */
  async function failSafe(taskId: string, reason: string): Promise<void> {
    try {
      const t = await loadTask(projectsDir, taskId);
      if (t.status !== 'done' && t.status !== 'cancelled') {
        t.status = 'error';
        t.error = `internal error: ${reason}`;
        await saveTask(projectsDir, t);
      }
    } catch {
      // task gone — nothing to mark
    }
    release(taskId);
  }

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

    try {
      await startTask(task, ctx);
    } catch (e) {
      app.log.error({ err: errMsg(e), taskId: task.taskId }, 'startTask threw');
      await failSafe(task.taskId, errMsg(e));
    }
    return reply.send(await loadTask(projectsDir, task.taskId));
  });

  // ── GET /api/tasks/:id — current state (phase, status, gate.actions, gate.flag, artifact paths) ──
  app.get('/api/tasks/:id', async (req, reply) => {
    const id = idOf(req);
    try {
      return await loadTask(projectsDir, id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${id}` });
    }
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

    const payload: ConfirmPayload = {};
    if (typeof body.slug === 'string') payload.slug = body.slug;
    if (typeof body.name === 'string') payload.name = body.name;

    try {
      await confirmAdvance(task, actionId, ctx, payload);
    } catch (e) {
      const code = statusOf(e);
      if (code === 500) await failSafe(id, errMsg(e));
      return reply.code(code).send({ error: errMsg(e) });
    }
    return reply.send(await loadTask(projectsDir, id));
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
    // Retry out of `error` re-acquires the lock (error released it, §I); 409 if another build holds it.
    if (task.status === 'error' && !acquire(task.taskId)) {
      return reply
        .code(409)
        .send({ error: 'Busy — another build holds the run-lock', holder: holderTaskId() });
    }

    try {
      await replyWithin(task, text, ctx);
    } catch (e) {
      const code = statusOf(e);
      if (code === 500) await failSafe(id, errMsg(e));
      return reply.code(code).send({ error: errMsg(e) });
    }
    return reply.send(await loadTask(projectsDir, id));
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
    }
    release(id); // frees the run-lock so a new POST /api/tasks succeeds (AC #24)
    return reply.send(await loadTask(projectsDir, id));
  });
};

export default tasksRoutes;
