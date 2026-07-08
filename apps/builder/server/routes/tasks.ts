/**
 * routes/tasks.ts — the HTTP surface for spec 009 (Lát 3 gate · Lát 4 SSE-live · Lát 6 turn-lock).
 *
 * The run-lock is TURN-LEVEL (Lát 6, §I): it is acquired synchronously in the route — `acquireTurn`,
 * the strict single-slot — RIGHT BEFORE the orchestrator work is dispatched, and released in the
 * shared `dispatch` `finally` when that work settles (the build parks at a gate or terminates). So a
 * build paused at a gate holds NOTHING and a 2nd build can start freely; the only 409 is a genuine
 * TURN collision (another build's turn is actively running). Acquiring synchronously in the route also
 * (a) gives the client a real 409, and (b) closes the double-dispatch race directly — two concurrent
 * `/confirm` for one build: the 2nd `acquireTurn` fails — which is why the old `advancing` Set is gone.
 *
 * Phase work is dispatched **fire-and-forget** so the response returns the task id IMMEDIATELY — the
 * UI needs it to open `GET /api/tasks/:id/stream` before phase ① finishes (Lát 4). Every
 * phase/status/gate transition then reaches the browser over SSE (orchestrator `broadcast`);
 * `GET /api/tasks/:id` stays the authoritative re-fetch on reconnect (AC #22). All mutating routes
 * bind 127.0.0.1 only + Origin-check (index.ts).
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  bumpRev,
  createPromoteTask,
  createTask,
  isValidWorkflowFile,
  loadTask,
  normalizeConfirmMode,
  restoreTargetPhaseFor,
  saveTask,
  toWireTask,
  type Task,
} from '../state/task.js';
import { computeGate } from '../lib/gate.js';
import { difyTargets } from '../lib/dify-io.js';
import { runLiveTest } from '../lib/live-test.js';
import { promoteConfirm, promoteReply, resolvePromoteSource, startPromote } from '../lib/promote.js';
import {
  confirmAdvance,
  replyWithin,
  startTask,
  type ConfirmPayload,
  type OrchestratorCtx,
} from '../lib/orchestrator.js';
import { askWithin, askTestWithin } from '../lib/ask.js';
import { acquireTurn, evictCancelled, isCancelled, liveKind, liveSession, markCancelled, releaseTurn, requestAskCancel, turnBusy, turnHolderId, unmarkCancelled } from '../lib/lock.js';
import { readArtifactContents } from '../lib/artifacts.js';
import { saveAttachments, validateAttachments } from '../lib/attachments.js';

export interface TasksRoutesOptions {
  projectsDir: string;
  /** ABSOLUTE path to apps/builder/headless-settings.json. */
  settingsPath: string;
  /** Lát 4 SSE relay (orchestrator broadcasts phase/status/gate transitions + streamed output). */
  broadcast?: (taskId: string, event: string, data: unknown) => void;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The turn-collision 409 (a turn is running for some build; parked builds never trigger it). The
 *  `holder` lets the UI offer a one-tap "open it" jump to whichever build is running. */
const turnBusyError = (): { error: string; holder: string | null } => ({
  error: 'a turn is already running — try again in a moment',
  holder: turnHolderId(),
});

const tasksRoutes: FastifyPluginAsync<TasksRoutesOptions> = async (app, opts) => {
  const { projectsDir, settingsPath, broadcast } = opts;
  const ctx: OrchestratorCtx = { projectsDir, settingsPath, log: app.log, broadcast };

  /** Last-resort: on an UNEXPECTED throw, mark the task error and relay it. The turn lock is freed by
   *  the dispatch `finally` (which runs after this), so failSafe never touches the lock itself. */
  async function failSafe(taskId: string, reason: string): Promise<void> {
    try {
      const t = await loadTask(projectsDir, taskId);
      if (t.status !== 'done' && t.status !== 'cancelled') {
        t.status = 'error';
        t.error = `internal error: ${reason}`;
        bumpRev(t); // D5: strictly increase rev so a stale same-rev GET can't resurrect the prior state
        await saveTask(projectsDir, t);
        broadcast?.(taskId, 'task:update', t);
      }
    } catch {
      // task gone — nothing to mark
    }
  }

  /**
   * Run orchestrator work in the background; converge to a relayed `error` on an unexpected throw, and
   * ALWAYS release the turn lock when the work settles. The `finally` is the SINGLE release point: a
   * turn is held from the route's `acquireTurn` until its dispatched work completes — i.e. until the
   * build parks at a gate (`awaiting_confirm`) or terminates (`done`/`error`/`cancelled`). An auto-run
   * chain (maybeAutoAdvance→confirmAdvance) is all awaited inside ONE dispatched promise, so the lock
   * is held for the whole chain and freed exactly once at the end. `releaseTurn` is "clear iff matches",
   * so even a stray release after a /cancel already let another build acquire is harmless.
   */
  function dispatch(taskId: string, work: Promise<void>): void {
    void work
      .catch((e) => {
        app.log.error({ err: errMsg(e), taskId }, 'orchestrator dispatch threw');
        void failSafe(taskId, errMsg(e));
      })
      .finally(() => {
        releaseTurn(taskId);
        // Bound cancelledTasks (spec 014 D7): once the chain has SETTLED, evict the flag if the build is
        // terminal. Done here — AFTER the whole dispatched chain — never inside releaseTurn, so the flag
        // still outlived every post-await `isCancelled` check (only evict on TERMINAL, not on release).
        // A still-parked (awaiting_confirm) build keeps nothing to evict; a terminal one drops its flag.
        void loadTask(projectsDir, taskId)
          .then((t) => {
            if (t.status === 'done' || t.status === 'error' || t.status === 'cancelled') {
              evictCancelled(taskId);
            }
          })
          .catch(() => {
            /* task gone — nothing to evict */
          });
      });
  }

  /** Optimistic snapshot returned right after dispatch — SSE delivers the authoritative transitions. */
  const optimisticRunning = (task: Task): Task => ({
    ...task,
    status: 'running',
    gate: undefined,
    error: undefined,
  });

  const idOf = (req: { params: unknown }): string => (req.params as { id: string }).id;

  // ── POST /api/tasks — acquire the turn (409 only if one is RUNNING), create the task, run Phase ① ──
  app.post('/api/tasks', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requirement = String(body.requirement ?? '').trim();
    if (!requirement) return reply.code(400).send({ error: 'requirement is required' });

    // Spec 015 D5 (S4): a supplied workflowFile must be a safe `*.yml`/`*.yaml` basename (no traversal).
    // It reaches `sync.py push --file workflows/<file>` at ④ outside the turn, so reject `../` here.
    const wfRaw = (body.workflowFile as string | undefined)?.trim();
    if (wfRaw && !isValidWorkflowFile(wfRaw)) {
      return reply.code(400).send({ error: 'workflowFile must be a plain *.yml/*.yaml basename (no path separators or "..")' });
    }

    // Spec 012 / 025: validate any attached files (type/size/count → 400) BEFORE minting a task or
    // touching the lock — files augment, never replace, the requirement (Q2: text stays required above).
    const attCheck = validateAttachments(body.files);
    if (!attCheck.ok) return reply.code(400).send({ error: attCheck.error });

    // Fast path: a turn is already running → 409 without minting a task. A build PARKED at a gate does
    // NOT block this (turn-level lock) — that is the whole point of Lát 6.
    if (turnBusy()) return reply.code(409).send(turnBusyError());

    const task = await createTask(projectsDir, {
      requirement,
      workflow: (body.workflow as string | null | undefined) ?? null,
      // Accept the spec's public `confirm_mode` (verbose) AND the internal token; normalized in createTask.
      confirmMode: (body.confirm_mode ?? body.confirmMode) as string | undefined,
      // Deploy target (Lát 5): body value, else the operator default DEFAULT_DEPLOY, else 'none'.
      deploy: (body.deploy as string | undefined) ?? process.env.DEFAULT_DEPLOY ?? undefined,
      // Chosen Dify seed app id from the seed picker (Lát 5); null/absent = no Dify seed.
      seed: (body.seed as string | null | undefined) ?? null,
      // Spec 030: the proposed WORKFLOW slug (public `workflow_slug`, legacy `slug`).
      slug: (body.workflow_slug ?? body.slug) as string | null | undefined ?? null,
      // Spec 030: the target PROJECT folder (sidebar project-"+" / workflow-"+" parent).
      project: (body.project as string | null | undefined) ?? null,
      name: (body.name as string | null | undefined) ?? null,
      workflowFile: (body.workflowFile as string | undefined) ?? undefined,
      // Spec 028: `⚡ Fast build` — accept `fast_mode` (public) or `fast`; createTask force-offs it
      // when a seed/workflow/slug is present, so it is honored only on a from-scratch build.
      fast: (body.fast_mode ?? body.fast) as boolean | string | null | undefined,
      // Spec 032: Phase ④ test mode (`test_mode` public / `testMode`); createTask force-offs it to
      // `static` unless deploy=selfhost, so it can never reach Dify on a non-selfhost build.
      testMode: (body.test_mode ?? body.testMode) as string | undefined,
    });

    // Persist the files to `.runs/<taskId>/uploads/` + record the paths on the task, BEFORE acquiring
    // the turn (a disk failure → 500 with NO lock held, NO turn started — spec §Validation/failure modes).
    if (attCheck.attachments.length) {
      try {
        task.attachments = await saveAttachments(projectsDir, task.taskId, attCheck.attachments, 0);
        await saveTask(projectsDir, task);
      } catch (e) {
        task.status = 'error';
        task.error = `file write failed: ${errMsg(e)}`;
        await saveTask(projectsDir, task);
        return reply.code(500).send({ error: `failed to save files: ${errMsg(e)}` });
      }
    }

    // Race-safe acquire: two POSTs can both pass the fast-path; the loser marks its stray task rejected
    // and gets 409. `acquireTurn` is synchronous + strict (one turn at a time), so distinct minted ids
    // can never both win.
    if (!acquireTurn(task.taskId)) {
      task.status = 'error';
      task.error = 'rejected — another turn is running';
      await saveTask(projectsDir, task);
      return reply.code(409).send(turnBusyError());
    }

    // Dispatch phase ① in the background; the dispatch `finally` releases the turn when ① parks/ends.
    dispatch(task.taskId, startTask(task, ctx));
    return reply.send(task);
  });

  // ── POST /api/promote — start a `kind:'promote'` build (spec 052 D1): distill a PROVEN build into a
  //    reusable templates/patterns/ pattern, behind the B1 gate → distill turn → B2′ re-gate → human
  //    Approve pipeline. A turn-bearing build like POST /api/tasks (takes the turn lock + dispatches), but
  //    NOT the ①②③④ FSM — startPromote/promoteConfirm/promoteReply drive it. Origin-checked (index.ts). ──
  app.post('/api/promote', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const project = String(body.project ?? '').trim();
    const workflow = String(body.workflow ?? '').trim();
    const src = resolvePromoteSource(projectsDir, project, workflow);
    if (!src.ok) return reply.code(src.status).send({ error: src.error });

    if (turnBusy()) return reply.code(409).send(turnBusyError());
    const task = await createPromoteTask(projectsDir, { project, workflow, sourceFile: src.sourceFile, slug: src.slug });
    if (!acquireTurn(task.taskId)) {
      task.status = 'error';
      task.error = 'rejected — another turn is running';
      await saveTask(projectsDir, task);
      return reply.code(409).send(turnBusyError());
    }
    dispatch(task.taskId, startPromote(task, ctx));
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
    // The artifact panel reads SPEC.md / main.yml / report from here (spec Endpoints :532). Spec 036 S5:
    // toWireTask adds the computed `liveTargets` capability bit so a reconnect GET (the authoritative
    // re-fetch) carries it — the done-state "Run test with workflow" foot needs it on every snapshot.
    const artifactContents = await readArtifactContents(projectsDir, task);
    return { ...toWireTask(task), artifactContents };
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
    // Validate the action synchronously so a stale/unknown action returns 409 to the caller. This runs
    // BEFORE acquireTurn — an early return here must never leak a lock.
    const action = task.gate?.actions.find((a) => a.id === actionId && a.kind === 'confirm');
    if (!action) {
      return reply.code(409).send({ error: `'${actionId}' is not a current confirm action` });
    }

    const payload: ConfirmPayload = {};
    if (typeof body.slug === 'string') payload.slug = body.slug;
    if (typeof body.name === 'string') payload.name = body.name;
    // Spec 036: on a `cleanup_apps` confirm, keep_current deletes only the OLD test apps (keep the current
    // one — "Delete old apps"); absent → delete ALL ("Delete test apps").
    if (body.keep_current === true || body.keepCurrent === true) payload.keepCurrent = true;

    // Acquire the turn LAST, right before dispatch. Strict + synchronous, so it also closes the
    // double-dispatch race directly: a 2nd concurrent /confirm for THIS build → the loser 409s here
    // (no `advancing` Set needed). A 409 means another build's turn is actively running — a build
    // merely parked at a gate never blocks; the `holder` lets the UI offer "open it".
    if (!acquireTurn(id)) return reply.code(409).send(turnBusyError());

    // Spec 052: a promote build's gate actions are dispatched to lib/promote.ts (the ①②③④ FSM in
    // confirmAdvance is never entered for `kind==='promote'`, keeping it untouched — AC7).
    if (task.kind === 'promote') {
      dispatch(id, promoteConfirm(task, actionId, ctx, payload));
      return reply.send(optimisticRunning(task));
    }
    // Dispatch the advance in the background; SSE carries the next phase/gate (Lát 4). The dispatch
    // `finally` releases the turn when this work settles (the next gate / terminal).
    dispatch(id, confirmAdvance(task, actionId, ctx, payload));
    return reply.send(optimisticRunning(task));
  });

  // ── PATCH /api/tasks/:id — live-patch a build's confirm_mode (spec 010 F2 Part A) ──
  // A PURE data write (no turn, no lock): persist `confirmMode` + relay `task:update`. The next
  // boundary — the next Continue (/confirm re-loads the task from disk) or the next auto-advance —
  // reads `task.confirmMode` fresh (`maybeAutoAdvance`/`boundaryAutoAdvances`), so switching a PARKED
  // build to `auto` then clicking Continue once runs the rest hands-free.
  //
  // TWO rejections, both 409:
  //   - terminal (done/cancelled) → no next boundary to honor it.
  //   - THIS build's turn is currently running (`turnHolderId() === id`) → the live orchestrator drives
  //     `maybeAutoAdvance` off its IN-MEMORY task (old mode) and its gate `emit` would clobber this
  //     write back to disk — so a patch mid-turn is both ineffective AND silently reverted (a lying
  //     control, the very thing F2 fixes). Reject it; the user patches once the build parks at a gate.
  //     (A patch to a DIFFERENT, parked build while some OTHER build's turn runs is fine — distinct
  //     task.json, no writer race.) Only `confirm_mode` is patchable; workflow/deploy are start-bound.
  app.patch('/api/tasks/:id', async (req, reply) => {
    const id = idOf(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.confirm_mode === undefined && body.confirmMode === undefined) {
      return reply.code(400).send({ error: 'confirm_mode is required' });
    }
    let task;
    try {
      task = await loadTask(projectsDir, id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${id}` });
    }
    if (task.status === 'done' || task.status === 'cancelled') {
      return reply.code(409).send({ error: `task is ${task.status} — confirm_mode is no longer changeable` });
    }
    if (turnHolderId() === id) {
      return reply.code(409).send({
        error: 'this build has a turn running — change confirm-mode once it pauses at a gate',
      });
    }
    // A /cancel can land during the loadTask above; without this re-check, saveTask would write the
    // stale in-memory snapshot (status:awaiting_confirm) back, RESURRECTING the just-cancelled build.
    if (isCancelled(id)) {
      return reply.code(409).send({ error: 'task was cancelled — confirm_mode is no longer changeable' });
    }
    task.confirmMode = normalizeConfirmMode(body.confirm_mode ?? body.confirmMode);
    bumpRev(task); // D5: this direct broadcast bypasses emit — bump so a stale GET can't revert confirmMode
    await saveTask(projectsDir, task);
    broadcast?.(id, 'task:update', task);
    return reply.send(task);
  });

  // ── POST /api/tasks/:id/reply — revise WITHIN the current phase (or Retry out of error) ──
  app.post('/api/tasks/:id/reply', async (req, reply) => {
    const id = idOf(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = String(body.text ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'text is required' });

    // Spec 012 / 025: validate reply-turn files (type/size/count → 400) before loading/locking.
    const attCheck = validateAttachments(body.files);
    if (!attCheck.ok) return reply.code(400).send({ error: attCheck.error });

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
    // Spec 052: a promote build accepts a "Request changes" reply ONLY at a gate that offers one
    // (promote_review / promote_distill_failed). At the promote_blocked gate (B1: ineligible → NO turn,
    // nothing written) there is no reply action — reject rather than spawn a distill turn on the ineligible
    // source (defends the B1 guarantee against a crafted POST the UI never issues).
    if (task.kind === 'promote' && !task.gate?.actions.some((a) => a.kind === 'reply')) {
      return reply.code(409).send({ error: 'this promote gate has no change action' });
    }

    // Spec 033 FIX-M audit (2nd site, alongside PUT /spec): a live Ask keeps status==='awaiting_confirm'
    // while holding the turn lock, so a concurrent /reply here would pass its status check and — CRUCIALLY
    // — run `saveAttachments` (which writes into `apps/builder/.runs/<id>/uploads/`, one of the roots the
    // live Ask snapshots) BEFORE its own `acquireTurn` 409s below. Those fresh files would then be seen by
    // the Ask's byte-compare as `created` → deleted (the user's reply attachments lost) + a false anomaly.
    // Reject BEFORE any write when this task already has a turn running. (Normal /reply at a parked gate
    // has no turn running for this id, so turnHolderId()!==id and this passes; a DIFFERENT task's turn
    // writes to a different root, unaffected. acquireTurn below still handles the general collision 409.)
    if (turnHolderId() === id) return reply.code(409).send(turnBusyError());

    // Save the reply-turn files APPENDED after any earlier ones (D6: never overwrite), BEFORE
    // acquireTurn (a disk failure → 500 with no lock held). `replyWithin` reads `task.attachments`
    // from this in-memory object, so the just-saved paths reach the resumed turn's prompt.
    if (attCheck.attachments.length) {
      try {
        const start = task.attachments?.length ?? 0;
        const rels = await saveAttachments(projectsDir, id, attCheck.attachments, start);
        task.attachments = [...(task.attachments ?? []), ...rels];
        await saveTask(projectsDir, task);
      } catch (e) {
        return reply.code(500).send({ error: `failed to save files: ${errMsg(e)}` });
      }
    }

    // Acquire the turn — this covers BOTH a within-phase revise (out of awaiting_confirm) AND a Retry
    // out of error (error freed the turn, so this re-takes it, §I). Strict + synchronous: a 2nd
    // concurrent /reply or /confirm for this build, or any other build's running turn, 409s here (so no
    // `advancing` Set). Acquired LAST so an earlier validation return can't leak the lock; a throw
    // inside the dispatched work lands in failSafe + the dispatch `finally` releases, so it never leaks.
    if (!acquireTurn(id)) return reply.code(409).send(turnBusyError());

    // Spec 052: "Request changes" at a promote gate re-runs the distill turn (note-steered), never the
    // ①②③④ replyWithin path.
    if (task.kind === 'promote') {
      dispatch(id, promoteReply(task, text, ctx));
      return reply.send(optimisticRunning(task));
    }
    dispatch(id, replyWithin(task, text, ctx));
    return reply.send(optimisticRunning(task));
  });

  // ── POST /api/tasks/:id/ask — conversational Q&A at a parked gate (spec 033): resume, answer-only,
  //    artifact-immutable turn — no phase re-run, no gate/status touch (D3/D4). ──
  app.post('/api/tasks/:id/ask', async (req, reply) => {
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
    // Spec 052: a promote build has no conversational Ask surface (its gates are blocked/distill/review) —
    // reject rather than mis-route to askTestWithin (which seeds from ①②③④ build artifacts).
    if (task.kind === 'promote') return reply.code(409).send({ error: '/ask is not available for a promote build' });
    // Spec 034 §1: ONE endpoint, branch server-side on phase/status.
    //   - analyze/spec/implement + awaiting_confirm → askWithin        (033: resume sessionIds[phase])
    //   - test + awaiting_confirm (any of the four ④ flags)  ┐
    //   - done | cancelled (terminal, D3)                    ┘→ askTestWithin (034: fresh-seeded turn)
    // `error` matches none of these → 409 (033's own carve-out — no live parked gate to Ask against there).
    const isPhaseAsk =
      task.status === 'awaiting_confirm' &&
      (task.phase === 'analyze' || task.phase === 'spec' || task.phase === 'implement');
    const isTestGateAsk = task.status === 'awaiting_confirm' && task.phase === 'test';
    const isTerminalAsk = task.status === 'done' || task.status === 'cancelled';
    if (!isPhaseAsk && !isTestGateAsk && !isTerminalAsk) {
      const where = task.status === 'awaiting_confirm' ? `phase '${task.phase}'` : `status '${task.status}'`;
      return reply.code(409).send({ error: `/ask is not available at ${where}` });
    }

    // acquireTurn(id, 'ask') tags the holder so /cancel can scope its abort (D9); the lock is a single
    // GLOBAL slot, so at most one turn — phase OR Ask — runs anywhere at a time (§1). Both ask kinds are
    // tagged 'ask' so /cancel force-kills the child without markCancelled (scoped abort), same as 033.
    if (!acquireTurn(id, 'ask')) return reply.code(409).send(turnBusyError());

    // No optimisticRunning(task)-style snapshot — status/gate are genuinely unchanged (FIX-B). The FE
    // sets its own `asking` signal true synchronously on issuing the POST, then relies on SSE.
    dispatch(id, isPhaseAsk ? askWithin(task, text, ctx) : askTestWithin(task, text, ctx));
    return reply.send({ ok: true });
  });

  // ── POST /api/tasks/:id/cancel — kill the live turn if one is running, else just flip the parked gate ──
  app.post('/api/tasks/:id/cancel', async (req, reply) => {
    const id = idOf(req);
    try {
      await loadTask(projectsDir, id); // existence check — 404 if missing (re-loaded as `fresh` below)
    } catch {
      return reply.code(404).send({ error: `no such task: ${id}` });
    }

    // D9: an Ask's abort is SCOPED — force-kill the child but never converge task.status/gate (D3 keeps
    // the gate parked throughout an Ask). Skip markCancelled entirely: this must NOT set the shared
    // `cancelledTasks` flag a phase turn's cancel uses, or a stale isCancelled(taskId)===true would
    // permanently block every FUTURE phase turn for this task (there is no terminal settle here to evict
    // it — Ask never converges to done/error/cancelled).
    if (liveKind(id) === 'ask') {
      const sess = liveSession(id);
      if (sess) {
        try {
          sess.forceKill();
        } catch {
          // already exited
        }
      } else {
        // Review #2: no live child yet — the Ask is in its pre-spawn snapshot window (the lock is held
        // but `askTurn`'s setSession hasn't run). Flag it so `askWithin` bails before spawning, instead of
        // this /cancel returning 200 as if it stopped something while the Ask runs on for its full budget.
        requestAskCancel(id);
      }
      return reply.send(await loadTask(projectsDir, id));
    }

    // Mark first (survives the turn-lock release; the orchestrator's in-flight bail checks this).
    markCancelled(id);
    // liveSession(id) is non-null ONLY if id is the build whose turn is currently running → kill it.
    // The orchestrator then converges the state to `cancelled` and its dispatch `finally` frees the
    // turn lock. A PARKED build holds no turn (liveSession null) → nothing to kill or release; we just
    // set `cancelled` below. Either way, no separate release here (the dispatch `finally` owns it).
    const sess = liveSession(id);
    if (sess) {
      try {
        sess.forceKill();
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
      bumpRev(fresh); // D5: strictly increase rev so an in-flight same-rev GET can't resurrect the gate
      await saveTask(projectsDir, fresh);
      broadcast?.(id, 'task:update', fresh); // relay the cancel to the SSE clients (Lát 4)
    }
    // Bound cancelledTasks (spec 014 D7): a PARKED build's cancel never runs a dispatch (no `finally` to
    // evict), so the flag we just marked would leak. If NO turn is in flight for this id, no orchestrator
    // will read the flag → evict it now. If a turn IS in flight (we force-killed it above), the
    // orchestrator still needs the flag through its chain; its dispatch `finally` evicts on terminal.
    if (turnHolderId() !== id) evictCancelled(id);
    return reply.send(await loadTask(projectsDir, id));
  });

  // ── POST /api/tasks/:id/restore — reopen a CANCELLED build at the gate BEFORE its cancelled phase ──
  // Undo the /confirm that advanced too far: rewind ONE boundary to the previous phase's gate
  // (awaiting_confirm). That phase provably completed + was gated, and its artifacts are preserved on
  // disk (the spec was already moved to projects/<slug>/ by the spec-gate scaffold), so re-confirming
  // re-runs the cancelled phase fresh from a coherent point. A restore runs NO turn (just re-parks),
  // so it takes no lock. `analyze` has no prior gate → reopen as a retryable `error` (/reply Retry).
  app.post('/api/tasks/:id/restore', async (req, reply) => {
    const id = idOf(req);
    let task;
    try {
      task = await loadTask(projectsDir, id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${id}` });
    }
    if (task.status !== 'cancelled') {
      return reply.code(409).send({ error: `task is ${task.status} — only a cancelled build can be restored` });
    }
    // Spec 034: a cancelled build is now askable (askTestWithin holds the turn lock while streaming, with
    // an in-memory task snapshot still at status='cancelled'). A /restore racing that live Ask would set
    // status='awaiting_confirm' + save, only for the Ask's own turn-end saveTask to clobber it back to
    // 'cancelled' on disk. Reject BEFORE any write when THIS task has a turn running (mirrors /reply's own
    // turnHolderId()===id guard, tasks.ts). The UI also disables Restore during a live Ask (busy||asking).
    if (turnHolderId() === id) return reply.code(409).send(turnBusyError());
    unmarkCancelled(id); // clear the in-flight flag so the next /confirm or /reply can actually run a turn
    // Spec 028: fast-aware rewind. A fast build cancelled AT the merged Spec turn (phase='spec', slug
    // still null) has NO prior gate → target=null (reopen retryable; Retry re-runs the merged draft),
    // NOT a phantom Analyze gate. A fast build cancelled at 'implement' (slug set by the scaffold)
    // rewinds to the Spec gate normally, where "Edit spec" runs the slug-aware spec.md (not draft.md).
    const target = restoreTargetPhaseFor(task);
    if (target) {
      task.phase = target;
      task.status = 'awaiting_confirm';
      task.gate = computeGate(target, { outcome: 'success' }, task.deploy);
      task.error = undefined;
    } else {
      // No prior gate: the standard first phase (analyze), OR the fast merged-draft first turn
      // (phase stays 'spec'). Reopen as a retryable error targeting the current phase.
      task.status = 'error';
      task.gate = computeGate(task.phase, { outcome: 'error' }, task.deploy);
      task.error = task.phase === 'spec'
        ? 'restored — Retry to re-run the merged draft'
        : 'restored — Retry to re-run analyze';
    }
    bumpRev(task); // D5: direct broadcast bypasses emit — bump so a stale GET can't clobber the restored gate
    await saveTask(projectsDir, task);
    broadcast?.(id, 'task:update', task);
    return reply.send(task);
  });

  // ── POST /api/tasks/:id/live-test — run a LIVE workflow test from a terminal `done` build (spec 036 D5) ──
  // `done` is NOT awaiting_confirm, so this CANNOT go through /confirm (confirmAdvance hard-guards
  // status==='awaiting_confirm' → 409, and a done build has no gate.actions to match). Dedicated route,
  // like /restore: re-check the done-state live gate SERVER-SIDE (never trust the FE), take the turn lock,
  // stamp the target, flip done→running, and dispatch runLiveTest. The done→running→test_result→done
  // transition is the D5 re-entry risk verified end-to-end on real Dify (S5 VERIFY).
  app.post('/api/tasks/:id/live-test', async (req, reply) => {
    const id = idOf(req);
    let task;
    try {
      task = await loadTask(projectsDir, id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${id}` });
    }
    // Server-side re-check of the SAME predicate the FE gate-foot evaluates (spec 036 D5): a done,
    // AUTONOMOUS build with an on-disk workflow and self-host reachable NOW. `each_step` already saw the
    // implement-gate live button (excluded); a null/corrupt confirmMode fails safe to excluded. The FE
    // hides the button in these cases too, but the route must not trust it (a stale/forged POST → 409).
    const isAutonomous = task.confirmMode === 'auto' || task.confirmMode === 'spec_only';
    if (task.status !== 'done' || !task.workflowSlug || !difyTargets().selfhost || !isAutonomous) {
      return reply.code(409).send({ error: 'live test is not available for this build' });
    }
    // A live Ask (askTestWithin over a done build) can hold the turn lock with an in-memory done snapshot —
    // reject a racing live-test BEFORE any write when THIS task already has a turn running (mirrors /reply,
    // /restore). acquireTurn below still handles the general cross-build collision 409 (with a holder).
    if (turnHolderId() === id) return reply.code(409).send(turnBusyError());
    if (!acquireTurn(id)) return reply.code(409).send(turnBusyError());
    // Stamp the target (D5 — symmetric to the implement-gate test_live dispatch) so report.ts + the
    // /reply-re-runs-live path label a real self-host live test, then flip done→running and dispatch.
    task.deploy = 'selfhost';
    task.testMode = 'live';
    task.status = 'running';
    task.gate = undefined;
    task.error = undefined;
    bumpRev(task); // this pre-dispatch write bypasses emit — bump so a stale GET can't resurrect the done gate
    await saveTask(projectsDir, task);
    dispatch(id, runLiveTest(task, ctx));
    return reply.send(optimisticRunning(task));
  });
};

export default tasksRoutes;
