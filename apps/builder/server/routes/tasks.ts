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
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  bumpRev,
  createConsultTask,
  createPromoteTask,
  createTask,
  deleteTask,
  DRAFTS_PROJECT,
  isTaskId,
  isValidWorkflowFile,
  loadTask,
  normalizeConfirmMode,
  normalizeModel,
  restoreTargetPhaseFor,
  sanitizeSlug,
  saveTask,
  taskDir,
  toWireTask,
  type Task,
} from '../state/task.js';
import { canRequestFix, computeGate } from '../lib/gate.js';
import { difyTargets } from '../lib/dify-io.js';
import { runLiveTest } from '../lib/live-test.js';
import { promoteConfirm, promoteReply, resolvePastedPromoteSource, resolvePromoteSource, startPromote, undoPromotion } from '../lib/promote.js';
import { lintStandaloneYaml } from '../lib/base-import.js';
import { resolveRunners } from '../lib/orchestrator-shared.js';
import {
  confirmAdvance,
  replyWithin,
  startTask,
  type ConfirmPayload,
  type OrchestratorCtx,
} from '../lib/orchestrator.js';
import { askWithin, askTestWithin, consultWithin, countChatPairs, readConsultChat, readLastAsk, tailChatPairs } from '../lib/ask.js';
import { acquireTurn, buildHolderId, buildTurnBusy, chatHolderId, chatTurnBusy, evictCancelled, isCancelled, liveKind, liveSession, markCancelled, releaseTurn, requestAskCancel, taskTurnRunning, unmarkCancelled, type TurnKind } from '../lib/lock.js';
import { readArtifactContents } from '../lib/artifacts.js';
import { logEvent, readEvents } from '../lib/run-events.js';
import { readRunAttempts } from '../lib/run-transcript.js';
import { MAX_ATTACHMENT_BYTES, saveAttachments, validateAttachments } from '../lib/attachments.js';

export interface TasksRoutesOptions {
  projectsDir: string;
  /** ABSOLUTE path to apps/builder/headless-settings.json. */
  settingsPath: string;
  /** Lát 4 SSE relay (orchestrator broadcasts phase/status/gate transitions + streamed output). */
  broadcast?: (taskId: string, event: string, data: unknown) => void;
  /**
   * The 013 D2 subprocess seams, forwarded onto the ctx this plugin builds. Same contract as
   * `OrchestratorCtx.runners`: absent ⇒ the real impls, so production is byte-identical and only tests
   * inject fakes.
   *
   * Without this the seam stopped at the plugin boundary: every FSM test had to call
   * startTask/confirmAdvance DIRECTLY and drive acquireTurn/releaseTurn by hand, so nothing exercised
   * `dispatch()` itself — the release-exactly-once `finally`, `failSafe`, and the terminal-only
   * evictCancelled all sat behind an untestable wall (they are precisely the parts a hand-driven test
   * has to ASSUME). See dispatch-lifecycle.test.ts.
   */
  runners?: OrchestratorCtx['runners'];
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The turn-collision 409 (a turn is running; parked builds never trigger it). The `holder` lets the
 *  UI offer a one-tap "open it" jump to whichever task is running. 082: lane-aware — report the
 *  blocking lane's holder first; the fallback covers a per-task-exclusivity reject (the task itself
 *  holds the OTHER lane, so that holder is the blocker). Error string is WORDING-STABLE (i18n frames). */
const turnBusyError = (kind: TurnKind = 'phase'): { error: string; holder: string | null } => ({
  error: 'a turn is already running — try again in a moment',
  holder: kind === 'phase' ? (buildHolderId() ?? chatHolderId()) : (chatHolderId() ?? buildHolderId()),
});

const tasksRoutes: FastifyPluginAsync<TasksRoutesOptions> = async (app, opts) => {
  const { projectsDir, settingsPath, broadcast, runners } = opts;
  const ctx: OrchestratorCtx = { projectsDir, settingsPath, log: app.log, broadcast, runners };

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
      .catch(async (e) => {
        app.log.error({ err: errMsg(e), taskId }, 'orchestrator dispatch threw');
        // AWAIT it: `finally` must observe the SETTLED state. Fire-and-forget (`void failSafe(…)`) let
        // the finally run while failSafe's loadTask→saveTask was still in flight, which broke both
        // halves below — the lock was released while task.json still said `running` (contradicting this
        // function's own contract), and the evict check re-read that stale `running`, saw "not terminal",
        // and LEAKED the cancelled flag for a build that was cancelled and then threw — precisely the
        // case the spec-014-D7 bound exists for. failSafe swallows its own IO errors, so awaiting it
        // cannot turn a converged error into an unhandled rejection.
        await failSafe(taskId, errMsg(e));
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

  /** GET /api/tasks/:id/chat returns at most this many exchanges. Sized to cover a real conversation
   *  (the run that prompted spec 099 had 53) while bounding a runaway one; the remainder is reported as
   *  `dropped` rather than silently missing. */
  const CHAT_TAIL_PAIRS = 50;

  /** Indices in `task.attachments` of the files THIS request just saved. Returned as `uploads` on the
   *  four file-accepting POSTs so the FE can address each one as `GET /api/tasks/:id/uploads/:idx` and
   *  show it back in the chat history. Uploads only ever append (spec 025 D6), so an index is stable
   *  for the life of the task. Omitted (undefined) when the request carried no files. */
  const uploadIdx = (start: number, n: number): number[] | undefined =>
    n ? Array.from({ length: n }, (_, i) => start + i) : undefined;

  /** The same files as `{name, mime, idx}` — what a CONSULT records on its transcript line, since a
   *  consult reopens from `chat.jsonl` (authoritative) rather than the browser's persisted thread. */
  const chatFiles = (
    saved: { name: string; mime: string }[],
    idx?: number[]
  ): { name: string; mime: string; idx: number }[] | undefined =>
    idx && idx.length ? saved.map((a, i) => ({ name: a.name, mime: a.mime, idx: idx[i] })) : undefined;

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

    // Spec 090 S1 — an edit-existing TARGET must exist, or the build is refused AT THE DOOR. A
    // nonexistent target used to sail through (localEditSeed only warned) and produced a build that
    // deterministically died at ② (`artifact missing`, runs 1785901684698 + 1785916628346 — the
    // sidebar's synthetic "(unsaved)" row was one entrance). Refusing BEFORE createTask matters
    // twice over: no turn is burned, and no orphan task is minted — each phantom build's corpse
    // itself joined the "(unsaved)" group, breeding more bait for the next click. `slug` is
    // deliberately NOT guarded: it NAMES a new workflow (folder created later at the ② scaffold);
    // `workflow` TARGETS an existing one. Same sanitize as createTask/localEditSeed, so the checked
    // path is the path the build would use.
    const wfTarget = (body.workflow as string | null | undefined)?.trim();
    if (wfTarget && wfTarget !== 'none') {
      const targetProject = sanitizeSlug(String(body.project ?? '').trim() || DRAFTS_PROJECT);
      const targetSlug = sanitizeSlug(wfTarget);
      if (!existsSync(join(projectsDir, 'projects', targetProject, targetSlug))) {
        const hasYamlAttachment =
          Array.isArray(body.files) &&
          (body.files as { name?: string }[]).some((f) => /\.ya?ml$/i.test(String(f?.name ?? '')));
        return reply.code(400).send({
          error: hasYamlAttachment
            ? `The selected workflow "${wfTarget}" does not exist. To edit the attached YAML file, use "Import base" first (it turns the file into a real workflow you can edit) — or unselect the workflow to build from scratch.`
            : `The selected workflow "${wfTarget}" does not exist — it may have been removed. Unselect the workflow to build from scratch.`,
        });
      }
    }

    // Spec 012 / 025: validate any attached files (type/size/count → 400) BEFORE minting a task or
    // touching the lock — files augment, never replace, the requirement (Q2: text stays required above).
    const attCheck = validateAttachments(body.files);
    if (!attCheck.ok) return reply.code(400).send({ error: attCheck.error });

    // Fast path: a turn is already running → 409 without minting a task. A build PARKED at a gate does
    // NOT block this (turn-level lock) — that is the whole point of Lát 6.
    if (buildTurnBusy()) return reply.code(409).send(turnBusyError());

    const task = await createTask(projectsDir, {
      requirement,
      workflow: (body.workflow as string | null | undefined) ?? null,
      // Accept the spec's public `confirm_mode` (verbose) AND the internal token; normalized in createTask.
      confirmMode: (body.confirm_mode ?? body.confirmMode) as string | undefined,
      // spec 096: a family alias (`opus`/`sonnet`/`haiku`/`fable`); normalizeModel drops anything else
      // rather than guessing, so a typo can never silently run a different model than was asked for.
      model: (body.model ?? body.model_alias) as string | undefined,
      // NOTE: `deploy`/`test_mode` are deliberately NOT forwarded (spec 036 D3). They are stamped at
      // GATE-time from reachable creds, never start-bound — createTask hard-codes 'none'/'static' and
      // does not read them. Forwarding them (and a `DEFAULT_DEPLOY` env fallback) only made a dead knob
      // look alive; a client may still send them, they are simply ignored. See test-mode.test.ts.
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
      // The chat-language setting ('vi' | 'ja' | 'auto'); createTask normalizes anything else to 'auto',
      // so an older client that sends nothing keeps today's infer-from-the-text behavior.
      chatLang: (body.chat_lang ?? body.chatLang) as string | null | undefined,
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
    return reply.send({ ...task, uploads: uploadIdx(0, attCheck.attachments.length) });
  });

  // ── POST /api/promote — start a `kind:'promote'` build (spec 052 D1): distill a PROVEN build into a
  //    reusable templates/patterns/ pattern, behind the B1 gate → distill turn → B2′ re-gate → human
  //    Approve pipeline. A turn-bearing build like POST /api/tasks (takes the turn lock + dispatches), but
  //    NOT the ①②③④ FSM — startPromote/promoteConfirm/promoteReply drive it. Origin-checked (index.ts). ──
  app.post('/api/promote', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    // spec 084: a DEV test distill (dry-run — never auto-finalizes). Honored ONLY under BUILDER_DEV, so a
    // normal/prod run ignores a stray `test:true` and always behaves as a real promote.
    const test = body.test === true && process.env.BUILDER_DEV === '1';

    // spec 070: TWO source doors. `origin:'paste'` (or a `yaml` payload) distills an EXTERNAL YAML that
    // exists in no project — validate the same 4-linter gate as base-import (G5: reject inline, no task),
    // stage it into the run dir, and stamp HONEST provenance (source=external, D3). Else the original
    // {project, workflow} local-workflow door below (unchanged: source=original).
    if (body.origin === 'paste' || typeof body.yaml === 'string') {
      const yaml = typeof body.yaml === 'string' ? body.yaml : '';
      if (!yaml.trim()) return reply.code(400).send({ error: 'yaml is required (the workflow contents)' });
      if (Buffer.byteLength(yaml, 'utf8') > MAX_ATTACHMENT_BYTES) {
        return reply.code(400).send({ error: 'file is over the size limit' });
      }
      // G5 — reject a poisonous YAML inline BEFORE minting a task (same gate as POST /api/bases).
      const { runPython } = resolveRunners(ctx);
      const failures = await lintStandaloneYaml(projectsDir, yaml, runPython);
      if (failures.length) return reply.code(400).send({ error: failures.join('\n') });

      const src = resolvePastedPromoteSource(yaml);
      if (!src.ok) return reply.code(src.status).send({ error: src.error });

      if (buildTurnBusy()) return reply.code(409).send(turnBusyError());
      const label =
        typeof body.sourceLabel === 'string' && body.sourceLabel.trim() ? body.sourceLabel.trim()
        : typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim()
        : 'external YAML';
      const license = typeof body.license === 'string' && body.license.trim() ? body.license.trim() : 'unknown';
      const task = await createPromoteTask(projectsDir, {
        project: '(external)', workflow: src.slug, sourceFile: '', slug: src.slug,
        external: { yaml, label, sha256: src.sha256, license }, test,
        chatLang: (body.chat_lang ?? body.chatLang) as string | null | undefined,
      });
      if (!acquireTurn(task.taskId)) {
        task.status = 'error';
        task.error = 'rejected — another turn is running';
        await saveTask(projectsDir, task);
        return reply.code(409).send(turnBusyError());
      }
      dispatch(task.taskId, startPromote(task, ctx));
      return reply.send(task);
    }

    const project = String(body.project ?? '').trim();
    const workflow = String(body.workflow ?? '').trim();
    const src = resolvePromoteSource(projectsDir, project, workflow);
    if (!src.ok) return reply.code(src.status).send({ error: src.error });

    if (buildTurnBusy()) return reply.code(409).send(turnBusyError());
    const task = await createPromoteTask(projectsDir, {
      project, workflow, sourceFile: src.sourceFile, slug: src.slug, test,
      chatLang: (body.chat_lang ?? body.chatLang) as string | null | undefined,
    });
    if (!acquireTurn(task.taskId)) {
      task.status = 'error';
      task.error = 'rejected — another turn is running';
      await saveTask(projectsDir, task);
      return reply.code(409).send(turnBusyError());
    }
    dispatch(task.taskId, startPromote(task, ctx));
    return reply.send(task);
  });

  // ── POST /api/consult — start a `kind:'consult'` chat task (spec 082): chat-first, no phases, no
  //    gates, born terminal-askable. The FIRST message rides in as `text` (+ optional files, same
  //    validateAttachments allowlist — .yml included); every later message is a plain POST /:id/ask.
  //    Runs on the CHAT lane, so a running build never blocks starting or continuing a chat. ──
  app.post('/api/consult', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = String(body.text ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'text is required' });
    const attCheck = validateAttachments(body.files);
    if (!attCheck.ok) return reply.code(400).send({ error: attCheck.error });

    // Fast path: the chat lane is busy → 409 without minting a task (mirrors POST /api/tasks).
    if (chatTurnBusy()) return reply.code(409).send(turnBusyError('ask'));

    const task = await createConsultTask(projectsDir, {
      text,
      name: (body.name as string | null | undefined) ?? null,
      chatLang: (body.chat_lang ?? body.chatLang) as string | null | undefined,
      model: (body.model ?? body.model_alias) as string | null | undefined, // spec 096
    });

    // Persist files BEFORE acquiring the lane (a disk failure → 500 with NO lock held) — same ritual
    // and reasons as POST /api/tasks.
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

    // Race-safe acquire — the POST /api/tasks loser ritual (082 §4.3): mark the stray task, 409. The
    // stray stays reachable in the consult list and SELF-HEALS on its first successful /ask message.
    if (!acquireTurn(task.taskId, 'ask')) {
      task.status = 'error';
      task.error = 'rejected — another chat is running';
      await saveTask(projectsDir, task);
      return reply.code(409).send(turnBusyError('ask'));
    }
    const uploads = uploadIdx(0, attCheck.attachments.length);
    dispatch(task.taskId, consultWithin(task, text, ctx, chatFiles(attCheck.attachments, uploads)));
    return reply.send({ ...task, uploads });
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
    // Spec 082 (rev): a consult's persisted transcript rides the authoritative GET so a reopen restores
    // the full conversation from the backend — independent of the client's localStorage.
    const chat = task.kind === 'consult' ? await readConsultChat(projectsDir, id) : undefined;
    // A BUILD carries only its LAST ask exchange, not the whole transcript: this snapshot is re-fetched on
    // every reconnect, and a build's asks can be long — the one thing the client cannot rebuild is an
    // answer that finished while it was looking at another task, and that is always the last one (the ask
    // lane is a single global slot, so there is never a second one in flight). A consult already ships its
    // full `chat` and rebuilds from it, so adding this there would be pure duplication.
    const lastAsk = task.kind === 'consult' ? undefined : await readLastAsk(projectsDir, id);
    // Per-ATTEMPT phase costs, read from the run timeline rather than the task.
    //
    // `task.cost[phase]` holds only the last re-run of each phase, and the live `phase:cost` event only
    // reaches a client that was watching — its numbers then live in that browser's localStorage, so they
    // survive a reload there and nowhere else. This is the copy that outlives the browser: a machine that
    // never had the task open still gets every round's cost.
    // Every phase attempt the client streamed, from disk — so a browser that never had this task open
    // still gets the reasoning, not just "requirement + current gate". Bounded by the reader (this
    // snapshot is re-fetched on every reconnect); `runsDropped` says when older attempts were left out
    // rather than presenting a conversation with an unmarked hole.
    const { runs, dropped: runsDropped } = task.kind === 'consult'
      ? { runs: [], dropped: 0 }
      : await readRunAttempts(taskDir(projectsDir, id));
    const runCosts = (await readEvents(taskDir(projectsDir, id)))
      .filter((e) => e.kind === 'turn_cost' && e.cost)
      .map((e) => ({ phase: e.phase ?? '', at: e.ts, cost: e.cost! }));
    return {
      ...toWireTask(task), artifactContents,
      ...(chat ? { chat } : {}),
      ...(lastAsk ? { lastAsk } : {}),
      ...(runCosts.length ? { runCosts } : {}),
      ...(runs.length ? { runs, ...(runsDropped ? { runsDropped } : {}) } : {}),
    };
  });

  /**
   * ── GET /api/tasks/:id/chat — the persisted ask transcript, READ-ONLY ──
   *
   * Spec 099 S1. A build's Q&A has only ever lived in the browser's localStorage, so any reason that
   * cache goes away — the 20-thread LRU evicting an older build, a cleared cache, another machine, the
   * multi-tab clobber — took the conversation with it, while `chat.jsonl` sat on disk beside the run the
   * whole time with no way to read it back. This is that way back, and nothing more: it adds no write
   * path, no new file, no new format (`readConsultChat` is the reader consult already uses).
   *
   * A SEPARATE route rather than a field on `GET /api/tasks/:id`, deliberately: that snapshot is
   * re-fetched on EVERY SSE reconnect, and folding a few hundred KB of transcript into it would trade
   * this bug for a slower one. The client calls this once, when it opens a build.
   *
   * `?have=<n>` — how many `qa` bubbles the browser already has. When it disagrees with what is on disk,
   * ONE line goes to the run timeline. That single number ("browser 87, disk 53") took three wrong
   * diagnoses and a paste from the user's console to obtain during the 099 investigation; on a tester's
   * machine it would not have been obtainable at all. Agreement writes nothing — the everyday case has
   * to stay silent or the timeline becomes noise.
   */
  app.get('/api/tasks/:id/chat', async (req, reply) => {
    const id = idOf(req);
    // Confinement first: `taskDir` feeds `join`, and this handler both reads and (on a gap) writes.
    if (!isTaskId(id)) return reply.code(400).send({ error: 'invalid task id' });
    try {
      await loadTask(projectsDir, id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${id}` });
    }
    const all = await readConsultChat(projectsDir, id); // missing/unreadable ⇒ [] by contract
    const { lines, dropped } = tailChatPairs(all, CHAT_TAIL_PAIRS);

    const haveRaw = (req.query as { have?: string } | undefined)?.have;
    const have = haveRaw != null && /^\d+$/.test(haveRaw) ? Number(haveRaw) : null;
    const onDisk = countChatPairs(all);
    if (have != null && have !== onDisk) {
      void logEvent(taskDir(projectsDir, id), {
        kind: 'history_gap',
        detail: `disk=${onDisk} browser=${have}`,
      });
    }

    return { chat: lines, ...(dropped ? { dropped } : {}) };
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

  // ── POST /api/tasks/:id/undo-promote — spec 084 S2: gỡ 1-click an auto-approved pattern. Inverse of
  //    finalizePromotion, KEPT SIMPLE (no git): unlink templates/patterns/<slug>.yml + rebuild INDEX/
  //    provenance so the catalog never dangles. Idempotent — a missing file is a no-op, not an error. ──
  app.post('/api/tasks/:id/undo-promote', async (req, reply) => {
    const id = idOf(req);
    let task;
    try {
      task = await loadTask(projectsDir, id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${id}` });
    }
    if (task.kind !== 'promote') {
      return reply.code(409).send({ error: 'not a promote task' });
    }
    const res = await undoPromotion(task, ctx);
    return reply.send({ ok: true, removed: res.removed });
  });

  // ── DELETE /api/tasks/:id — spec 084 follow-up: permanently remove a task record (its .runs/<id> dir),
  //    so the user can clear a sidebar list. Guarded: a task whose turn is RUNNING must be cancelled first
  //    (deleting its dir mid-turn would break the live process) → 409. A missing task → 404. ──
  app.delete('/api/tasks/:id', async (req, reply) => {
    const id = idOf(req);
    if (taskTurnRunning(id)) {
      return reply.code(409).send({ error: 'this task has a turn running — cancel it before removing it' });
    }
    try {
      await loadTask(projectsDir, id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${id}` });
    }
    await deleteTask(projectsDir, id);
    evictCancelled(id); // drop any stale in-memory cancelled-flag bookkeeping for this id
    return reply.send({ ok: true });
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
  //     task.json, no writer race.)
  //
  // Spec 096: `model` is patchable HERE for the same reason confirm_mode is. It shipped start-bound for
  // one release and that was too tight — the requirement was "the first message's choice is the
  // DEFAULT", which presumes it can be changed, and the CLI it mirrors lets you switch mid-session.
  // Nothing technical forced the lock (`--model` is per-spawn), and the audit trail was never the
  // problem: `cost[phase].model` already records each phase separately, so a build that ran ② small and
  // ③ large reads correctly in the dossier — and cheap-①/strong-③ is worth being able to do by hand.
  // `workflow`/`deploy`/`fast` stay start-bound.
  app.patch('/api/tasks/:id', async (req, reply) => {
    const id = idOf(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    // spec 096: `model` joined confirm_mode as patchable — see the note above the handler.
    const wantsConfirm = body.confirm_mode !== undefined || body.confirmMode !== undefined;
    const wantsModel = body.model !== undefined;
    if (!wantsConfirm && !wantsModel) {
      return reply.code(400).send({ error: 'confirm_mode or model is required' });
    }
    let task;
    try {
      task = await loadTask(projectsDir, id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${id}` });
    }
    // Terminal blocks confirm_mode but NOT model. The 409 reason for confirm_mode is "there is no next
    // boundary to honor it" — true, and it does not transfer: a FINISHED build still takes follow-up
    // questions, and those Ask turns spawn with `task.model` (ask.ts). Refusing to change it there would
    // leave the user reading a model they cannot pick for the very next turn they are about to send —
    // and picking a cheap model for a quick question about a finished build is the point.
    if ((task.status === 'done' || task.status === 'cancelled') && wantsConfirm) {
      return reply.code(409).send({ error: `task is ${task.status} — confirm_mode is no longer changeable` });
    }
    if (taskTurnRunning(id)) {
      return reply.code(409).send({
        error: 'this build has a turn running — change confirm-mode once it pauses at a gate',
      });
    }
    // A /cancel can land during the loadTask above; without this re-check, saveTask would write the
    // stale in-memory snapshot (status:awaiting_confirm) back, RESURRECTING the just-cancelled build.
    if (isCancelled(id) && wantsConfirm) {
      return reply.code(409).send({ error: 'task was cancelled — confirm_mode is no longer changeable' });
    }
    if (wantsConfirm) task.confirmMode = normalizeConfirmMode(body.confirm_mode ?? body.confirmMode);
    if (wantsModel) {
      // spec 096: takes effect from the NEXT turn on — /confirm and /reply both re-load the task from
      // disk, so the next spawn reads this. Phases already run keep their model in `cost[*].model`, so
      // a mid-build switch stays auditable instead of rewriting history. An unrecognised value clears
      // the pin (back to ambient) rather than guessing — the same rule as create.
      task.model = normalizeModel(body.model);
    }
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

    // Spec 012 / 025: validate reply-turn files (type/size/count → 400) before loading/locking.
    const attCheck = validateAttachments(body.files);
    if (!attCheck.ok) return reply.code(400).send({ error: attCheck.error });

    let task;
    try {
      task = await loadTask(projectsDir, id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${id}` });
    }
    // Spec 082: a consult has no phases to revise — /reply is never valid on it (and without this
    // guard an ERROR-status consult would pass the status check below and fall into replyWithin's ④
    // branch, running the report machinery on a task with no project). Promote-carve-out DNA.
    if (task.kind === 'consult') {
      return reply.code(409).send({ error: '/reply is not available for a consult chat — use /ask' });
    }
    // A FINISHED build stays fixable (the post-import fix loop): `done` is admitted when `canRequestFix`
    // holds — the human tests the imported workflow in Dify and brings the fix back to THIS conversation,
    // where the implement session is still resumable. replyWithin routes it exactly like a ④ "Request
    // changes" (resume ③ → edit main.yml → re-lint → re-park at the Implement gate), so the build simply
    // re-enters the FSM; nothing here has to un-do `done` by hand. Everything else is terminal as before.
    if (task.status !== 'awaiting_confirm' && task.status !== 'error' && !canRequestFix(task)) {
      return reply
        .code(409)
        .send({ error: `task is ${task.status}; /reply needs awaiting_confirm or error` });
    }
    // Spec 053: an empty reply is valid ONLY as a Retry-out-of-error (a text-less one-click re-run of the
    // errored phase — replyWithin('') falls back to the fresh phase prompt). At an awaiting_confirm gate
    // empty text still has no meaning → 400. Moved below loadTask so it can see the status (was an
    // unconditional top-of-handler guard). An errored PROMOTE build (gate undefined) instead falls through
    // to the promote-gate check below and 409s there ("no change action") — never reaches replyWithin.
    if (!text && task.status !== 'error') return reply.code(400).send({ error: 'text is required' });
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
    if (taskTurnRunning(id)) return reply.code(409).send(turnBusyError());

    // Save the reply-turn files APPENDED after any earlier ones (D6: never overwrite), BEFORE
    // acquireTurn (a disk failure → 500 with no lock held). `replyWithin` reads `task.attachments`
    // from this in-memory object, so the just-saved paths reach the resumed turn's prompt.
    let uploads: number[] | undefined;
    if (attCheck.attachments.length) {
      try {
        const start = task.attachments?.length ?? 0;
        const rels = await saveAttachments(projectsDir, id, attCheck.attachments, start);
        task.attachments = [...(task.attachments ?? []), ...rels];
        uploads = uploadIdx(start, rels.length);
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
      return reply.send({ ...optimisticRunning(task), uploads });
    }
    dispatch(id, replyWithin(task, text, ctx));
    return reply.send({ ...optimisticRunning(task), uploads });
  });

  // ── POST /api/tasks/:id/ask — conversational Q&A at a parked gate (spec 033): resume, answer-only,
  //    artifact-immutable turn — no phase re-run, no gate/status touch (D3/D4). ──
  app.post('/api/tasks/:id/ask', async (req, reply) => {
    const id = idOf(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = String(body.text ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'text is required' });

    // Spec 089: /ask carries files too. Without this, only the FIRST message of a chat could bring a
    // document (POST /api/consult) and every later one could not — so a reference that came up mid-
    // conversation had no way in. Validate before loading/locking, exactly as /reply does.
    const attCheck = validateAttachments(body.files);
    if (!attCheck.ok) return reply.code(400).send({ error: attCheck.error });

    let task;
    try {
      task = await loadTask(projectsDir, id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${id}` });
    }
    // Spec 052: a promote build has no conversational Ask surface (its gates are blocked/distill/review) —
    // reject rather than mis-route to askTestWithin (which seeds from ①②③④ build artifacts).
    if (task.kind === 'promote') return reply.code(409).send({ error: '/ask is not available for a promote build' });
    // Spec 082 §4.2: a consult routes by KIND at ANY status — asking is always valid on a chat task
    // (there are no gates for status to guard), and an error-status consult (the create-race loser /
    // a failSafe) SELF-HEALS on its next message instead of dying behind the terminal-status check.
    const isConsultAsk = task.kind === 'consult';
    // Spec 034 §1: ONE endpoint, branch server-side on phase/status.
    //   - analyze/spec/implement + awaiting_confirm → askWithin        (033: resume sessionIds[phase])
    //   - test + awaiting_confirm (any of the four ④ flags)  ┐
    //   - done | cancelled (terminal, D3)                    ┘→ askTestWithin (034: fresh-seeded turn)
    // `error` matches none of these → 409 (033's own carve-out — no live parked gate to Ask against there).
    const isPhaseAsk =
      !isConsultAsk &&
      task.status === 'awaiting_confirm' &&
      (task.phase === 'analyze' || task.phase === 'spec' || task.phase === 'implement');
    const isTestGateAsk = !isConsultAsk && task.status === 'awaiting_confirm' && task.phase === 'test';
    const isTerminalAsk = !isConsultAsk && (task.status === 'done' || task.status === 'cancelled');
    if (!isConsultAsk && !isPhaseAsk && !isTestGateAsk && !isTerminalAsk) {
      const where = task.status === 'awaiting_confirm' ? `phase '${task.phase}'` : `status '${task.status}'`;
      return reply.code(409).send({ error: `/ask is not available at ${where}` });
    }

    // Files land AFTER every rejection above (a refused ask must leave nothing on disk) and BEFORE the
    // lock (a disk failure → 500 with no lock held) — the same ordering /reply uses, for the same reasons.
    // The turn-running pre-check is the FIX-M rule restated: a live Ask on THIS task snapshots
    // `.runs/<id>/uploads/` and byte-compares it, so a write landing mid-turn would read as `created` and
    // be deleted — losing the user's file and raising a false anomaly. Reject before writing anything.
    let uploads: number[] | undefined;
    if (attCheck.attachments.length) {
      if (taskTurnRunning(id)) return reply.code(409).send(turnBusyError('ask'));
      try {
        const start = task.attachments?.length ?? 0;
        const rels = await saveAttachments(projectsDir, id, attCheck.attachments, start);
        task.attachments = [...(task.attachments ?? []), ...rels];
        uploads = uploadIdx(start, rels.length);
        await saveTask(projectsDir, task);
      } catch (e) {
        return reply.code(500).send({ error: `failed to save files: ${errMsg(e)}` });
      }
    }

    // acquireTurn(id, 'ask') tags the holder so /cancel can scope its abort (D9); the lock is a single
    // GLOBAL slot, so at most one turn — phase OR Ask — runs anywhere at a time (§1). Both ask kinds are
    // tagged 'ask' so /cancel force-kills the child without markCancelled (scoped abort), same as 033.
    if (!acquireTurn(id, 'ask')) return reply.code(409).send(turnBusyError('ask'));

    // No optimisticRunning(task)-style snapshot — status/gate are genuinely unchanged (FIX-B). The FE
    // sets its own `asking` signal true synchronously on issuing the POST, then relies on SSE.
    // Every branch reads `task.attachments` off this same in-memory object, so files saved just above
    // reach the turn's prompt through the block each one already injects.
    dispatch(
      id,
      isConsultAsk
        ? consultWithin(task, text, ctx, chatFiles(attCheck.attachments, uploads))
        // spec 098 S2: `uploads` are the indices this request just saved — the ONLY files that carry the
        // "read them" invitation. Everything older stays listed, without it. `?? []` is load-bearing:
        // a question with no upload must say "nothing is new here", not fall back to "assume everything
        // is" — and a question with no upload is most of them.
        : isPhaseAsk
          ? askWithin(task, text, ctx, uploads ?? [])
          : askTestWithin(task, text, ctx, uploads ?? [])
    );
    return reply.send({ ok: true, uploads });
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
    // the gate parked throughout an Ask). Skip markCancelled entirely: an Ask never converges to
    // done/error/cancelled, so there is no terminal settle to evict the shared `cancelledTasks` flag —
    // it would linger (leaking the spec-014-D7 bound, and wrongly 409ing PATCH's isCancelled re-check)
    // until this task's next acquireTurn clears it ("fresh slate on (re)acquire", lock.ts).
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
    if (buildHolderId() !== id) evictCancelled(id);
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
    if (taskTurnRunning(id)) return reply.code(409).send(turnBusyError());
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
    if (taskTurnRunning(id)) return reply.code(409).send(turnBusyError());
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
