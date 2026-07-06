/**
 * ask.ts — spec 033: the conversational Ask turn (chat, no phase re-run, answer-only) at a parked
 * Analyze/Spec/Implement gate. `askWithin` is a standalone, DUPLICATED spawn helper (D8, closes FIX-A) —
 * it deliberately does NOT share `runPhase`'s `spawnOnce`, nor `runJudge`'s fresh-turn shape (spec 032
 * §S0.5 A1's proposed `runDataTurn` was never built) — so the existing phase-turn code path
 * (`runPhase`/`gateAfterPhase`/`PHASES`) stays byte-unchanged.
 *
 * Containment is TWO INDEPENDENT LAYERS (D3), neither relying on `confinementCheck`/`gitDirtyPaths`:
 *   - Layer 1 (primary, structural): `ClaudeSession({askMode:true})` sets `BUILDER_ASK_MODE=1` on the
 *     child; `permission-gate.ts`'s `decide()` denies every Write/Edit/MultiEdit/NotebookEdit outright.
 *   - Layer 2 (backstop, defense-in-depth — FIX-M): a byte-snapshot/restore over BOTH writable roots a
 *     bypassed layer 1 would actually expose (`workflowDir(task)` + the task's own `.runs/<taskId>/`),
 *     not just the phase's single gate artifact — mirroring `pathIsProtectedWrite`'s own write-allow
 *     surface so a layer-1 bypass is caught regardless of WHICH in-scope file it touches.
 */
import { readFile, readdir, writeFile, rm, mkdir } from 'node:fs/promises';
import { join, relative, dirname, sep } from 'node:path';
import { ClaudeSession } from './claude-session.js';
import { clearSession, isAskCancelRequested, setSession } from './lock.js';
import { attachmentBlock } from './attachments.js';
import { unifiedDiffOfFiles } from './diff.js';
import { PHASES } from './phases.js';
import { errMsg, resolveRunners, type OrchestratorCtx } from './orchestrator-shared.js';
import { saveTask, workflowDir, type Task } from '../state/task.js';

/** Pinned shorter than the phase default (10 min) — an Ask is a quick conversational reply, not a long
 *  agentic turn (matches the existing JUDGE_TIMEOUT_MS convention for a short data-turn, live-test.ts). */
export const ASK_TIMEOUT_MS = 3 * 60 * 1000;

/** One anomaly the layer-2 restore found + already reverted (FIX-M — a file OTHER than the phase's own
 *  gate artifact is just as reportable as the artifact itself). */
export interface AskFileAnomaly {
  path: string;
  kind: 'modified' | 'created' | 'deleted';
  /** unified diff (modified only — a diff against/from nothing isn't meaningful for created/deleted). */
  diff?: string;
  /** review #4: set when this file could NOT be restored (an EACCES/ENOSPC/file-vs-dir error during the
   *  revert). The restore loop is per-file isolated so ONE such failure never aborts the rest — but a file
   *  left tampered must be surfaced, not hidden behind a clean-looking settle. */
  restoreFailed?: boolean;
}

const isEnoent = (e: unknown): boolean => (e as { code?: string } | null)?.code === 'ENOENT';

/** Recursively collect `{relPath: bytes}` under `absDir` (relative to `projectsDir`, POSIX-separated).
 *  A root/file that does not exist (`ENOENT`) contributes nothing — the two writable roots legitimately
 *  don't always both exist (pre-scaffold, the `.runs/<taskId>/` shorthand rarely populated), and a file
 *  that raced away between readdir and readFile is just gone. But review #6 / FIX-M's "fail closed":
 *  ANY OTHER error (EACCES/EIO/…) means we genuinely can't snapshot this root, so we must NOT silently
 *  treat it as empty (that would blind the byte-compare) — we rethrow so `snapshotRoots` → `askWithin`
 *  fails closed (emits `ask:done{ok:false}`, spawns nothing). */
async function walkDir(absDir: string, projectsDir: string, out: Map<string, Buffer>): Promise<void> {
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch (e) {
    if (isEnoent(e)) return; // root doesn't exist — legitimate, not a breach
    throw e; // a permission/IO error we can't safely ignore → fail closed
  }
  for (const e of entries) {
    const abs = join(absDir, e.name);
    if (e.isDirectory()) {
      await walkDir(abs, projectsDir, out);
    } else if (e.isFile()) {
      const rel = relative(projectsDir, abs).split(sep).join('/');
      try {
        out.set(rel, await readFile(abs));
      } catch (err) {
        if (!isEnoent(err)) throw err; // unreadable (EACCES/…) → fail closed; only a raced-away file is skipped
      }
    }
  }
}

/**
 * FIX-M — snapshot every file under BOTH writable roots a bypassed layer 1 could touch: the build's own
 * `projects/<project>/<workflowSlug>/` (post-scaffold; skipped when null, e.g. pre-scaffold Spec) and its
 * own `.runs/<taskId>/` (both the canonical `apps/builder/.runs/<taskId>/` and the pre-relocate shorthand
 * `.runs/<taskId>/` a turn's cwd=repo-root can still resolve, mirroring `post-turn.ts`'s
 * `confinementCheck` whitelist) — the same scope `pathIsProtectedWrite` allows for this task, not a
 * hand-picked single path.
 */
async function snapshotRoots(projectsDir: string, task: Task): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  const dir = workflowDir(task);
  if (dir) await walkDir(join(projectsDir, dir), projectsDir, out);
  await walkDir(join(projectsDir, 'apps/builder/.runs', task.taskId), projectsDir, out);
  await walkDir(join(projectsDir, '.runs', task.taskId), projectsDir, out);
  // Drop the backend's OWN bookkeeping so it is never mistaken for a turn-caused anomaly:
  //   - task.json — askTurn itself legitimately rewrites it (D5's session-id persistence) during the
  //     SAME window this snapshot brackets, via the identical atomic `saveTask` every turn already uses.
  //   - task.json.<pid>.<seq>.tmp — saveTask's atomic-write staging file (task.ts): a `void saveTask`
  //     could momentarily leave one mid-rename inside this window; matching it prevents a spurious
  //     "created" anomaly (and a restore that would delete a file a real save is about to rename in).
  //   - .ask-anomaly-before.tmp — this module's OWN diff staging file (restoreAndDiff), likewise not a
  //     turn write. (It is created AFTER the `after` snapshot, so normally absent, but exclude defensively.)
  const jsonPrefix = `apps/builder/.runs/${task.taskId}/task.json`;
  const askTmp = `apps/builder/.runs/${task.taskId}/.ask-anomaly-before.tmp`;
  for (const key of [...out.keys()]) {
    if (key === jsonPrefix || key.startsWith(jsonPrefix + '.') || key === askTmp) out.delete(key);
  }
  return out;
}

/**
 * Re-snapshot the same roots and diff against `before`, RESTORING every anomaly found (unconditionally,
 * before the caller reports anything) — created → deleted, deleted → recreated, modified → overwritten
 * with the held bytes. Returns the (already-reverted) anomaly list; empty = clean (the normal path).
 *
 * Review #4: each file's restore is ISOLATED in its own try/catch. FIX-M promises "restore
 * unconditionally, file-by-file", so ONE failing revert (EACCES/ENOSPC/file-vs-dir collision) must never
 * abort the batch and leave the rest tampered — nor may it look like a clean settle. A file that couldn't
 * be reverted is still reported (with `restoreFailed:true`), and `log`ged.
 */
async function restoreAndDiff(
  projectsDir: string,
  task: Task,
  before: Map<string, Buffer>,
  log: OrchestratorCtx['log']
): Promise<AskFileAnomaly[]> {
  const after = await snapshotRoots(projectsDir, task);
  const anomalies: AskFileAnomaly[] = [];

  for (const [rel, beforeBytes] of before) {
    const afterBytes = after.get(rel);
    const abs = join(projectsDir, rel);
    if (afterBytes === undefined) {
      // deleted → recreate from the held bytes
      try {
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, beforeBytes);
        anomalies.push({ path: rel, kind: 'deleted' });
      } catch (e) {
        log.error({ taskId: task.taskId, path: rel, err: errMsg(e) }, 'ask: FAILED to restore a deleted file');
        anomalies.push({ path: rel, kind: 'deleted', restoreFailed: true });
      }
    } else if (!afterBytes.equals(beforeBytes)) {
      // modified → diff the held bytes (via a temp file) against the current on-disk content, THEN
      // restore. Order matters: the diff must run before the overwrite below erases the "after" state.
      let diffText = '';
      let restoreFailed = false;
      try {
        const tmpAbs = join(projectsDir, `apps/builder/.runs/${task.taskId}/.ask-anomaly-before.tmp`);
        await mkdir(dirname(tmpAbs), { recursive: true });
        await writeFile(tmpAbs, beforeBytes);
        try {
          diffText = await unifiedDiffOfFiles(projectsDir, tmpAbs, abs, `before/${rel}`, `after/${rel}`);
        } finally {
          await rm(tmpAbs, { force: true });
        }
        await writeFile(abs, beforeBytes);
      } catch (e) {
        restoreFailed = true;
        log.error({ taskId: task.taskId, path: rel, err: errMsg(e) }, 'ask: FAILED to restore a modified file');
      }
      anomalies.push({ path: rel, kind: 'modified', diff: diffText, ...(restoreFailed ? { restoreFailed } : {}) });
    }
  }
  for (const rel of after.keys()) {
    if (!before.has(rel)) {
      try {
        await rm(join(projectsDir, rel), { force: true });
        anomalies.push({ path: rel, kind: 'created' });
      } catch (e) {
        log.error({ taskId: task.taskId, path: rel, err: errMsg(e) }, 'ask: FAILED to remove a created file');
        anomalies.push({ path: rel, kind: 'created', restoreFailed: true });
      }
    }
  }
  return anomalies;
}

/**
 * `askTurn` — duplicates (does not refactor-to-share, D8) the ~30-line `spawnOnce` shape from
 * `runPhase`: a fresh `ClaudeSession` with `resumeSessionId: task.sessionIds[task.phase]`,
 * `setSession`/`clearSession` so `/cancel` can reach it, `resolveRunners(ctx).runTurn` (the injectable
 * seam, spec 013 D2), and an `onSessionId` callback that persists `task.sessionIds[task.phase]`
 * immediately (mirroring orchestrator.ts, D5 — Ask shares the phase session, so a later Reply sees the
 * Q&A). `onAnswer` streams each assistant text fragment to the caller (→ `ask:answer` SSE, §2).
 */
async function askTurn(
  task: Task,
  prompt: string,
  ctx: OrchestratorCtx,
  onAnswer: (text: string) => void
) {
  const { projectsDir, settingsPath, log } = ctx;
  const { runTurn } = resolveRunners(ctx);
  const phaseId = task.phase as 'analyze' | 'spec' | 'implement';
  const session = new ClaudeSession(`${task.taskId}:ask`, {
    taskId: task.taskId,
    workingDir: projectsDir,
    settingsPath,
    log,
    resumeSessionId: task.sessionIds[phaseId],
    askMode: true,
  });
  setSession(task.taskId, session); // hand the child to /cancel (D9)
  const turn = await runTurn(
    session,
    prompt,
    (sid) => {
      task.sessionIds[phaseId] = sid;
      void saveTask(projectsDir, task);
    },
    { timeoutMs: ASK_TIMEOUT_MS, onText: onAnswer }
  );
  clearSession(task.taskId);
  if (turn.sessionId) {
    task.sessionIds[phaseId] = turn.sessionId;
    await saveTask(projectsDir, task);
  }
  return turn;
}

/**
 * `askWithin(task, text, ctx)` — the `/ask` route's core (§1). Never touches `task.gate`/`task.status`;
 * emits `ask:answer` fragments + a terminal `ask:done` over the SAME broadcast channel every other turn
 * uses. Callers (the route) are responsible for the turn lock (`acquireTurn(id, 'ask')`) and for
 * validating `status==='awaiting_confirm' && phase∈{analyze,spec,implement}` (D4) before calling this.
 */
export async function askWithin(task: Task, text: string, ctx: OrchestratorCtx): Promise<void> {
  const { projectsDir, log } = ctx;
  const phase = PHASES.find((p) => p.id === task.phase)!;
  const artifactRel = phase.artifactRel(task);

  // Layer 2 step 1 (FIX-M): snapshot BOTH writable roots. The gate's own artifact must be present (every
  // analyze/spec/implement gate's verify already required non-empty artifactOk to reach awaiting_confirm)
  // — fail closed (surface nothing spawned) if it's somehow missing from the snapshot.
  let before: Map<string, Buffer>;
  try {
    before = await snapshotRoots(projectsDir, task);
  } catch (e) {
    log.warn({ taskId: task.taskId, err: errMsg(e) }, 'ask: snapshot failed (fail closed) — not spawning');
    ctx.broadcast?.(task.taskId, 'ask:done', { ok: false });
    return;
  }
  if (!before.has(artifactRel)) {
    log.warn({ taskId: task.taskId, artifactRel }, 'ask: gate artifact missing from snapshot (fail closed)');
    ctx.broadcast?.(task.taskId, 'ask:done', { ok: false });
    return;
  }

  // Review #2: `/cancel` can only force-kill the child once `askTurn`'s `setSession` has run — but the
  // recursive `snapshotRoots` above runs BEFORE that, so a Stop pressed during the (potentially long)
  // walk finds no live child (liveSession null) and merely sets a `cancelRequested` flag on the holder
  // (lock.ts, NOT the shared cancelledTasks Set — which would leak per D9). Honor it here, before we
  // spawn: a cancel during the snapshot window must abort the Ask, not run it to completion holding the
  // global turn lock for the full 3-minute budget. (A cancel AFTER setSession force-kills the child, so
  // the window this closes is exactly [lock acquired → setSession].)
  if (isAskCancelRequested(task.taskId)) {
    log.info({ taskId: task.taskId }, 'ask: cancelled during snapshot — not spawning');
    ctx.broadcast?.(task.taskId, 'ask:done', { ok: false });
    return;
  }

  // askWithin must NEVER THROW past this point. If it did, the shared `dispatch` wrapper's `.catch()`
  // would call `failSafe`, which flips `task.status` to `error` + broadcasts a `task:update` — clobbering
  // the parked gate. That directly violates the invariant "Ask never touches task.status/task.gate" on
  // BOTH the normal and the anomaly path (D3). So any unexpected error in the spawn/restore below is
  // caught here and surfaced as a benign `ask:done{ok:false}` — the gate stays parked, exactly as at a
  // clean settle. (The turn lock is still released by the dispatch `finally` regardless.)
  try {
    const prompt =
      `${text}\n\n(Answer conversationally. Do NOT create, modify, or delete any file — this is a ` +
      `question, not a change request.)` +
      attachmentBlock(task.attachments);

    let gotText = false;
    const turn = await askTurn(task, prompt, ctx, (chunk) => {
      gotText = true;
      ctx.broadcast?.(task.taskId, 'ask:answer', { text: chunk });
    });

    // Layer 2 step 2 — the compare + restore ALWAYS runs first, regardless of the turn outcome
    // (success / error / resume-failure / mid-turn kill): a partial write could land before any of those,
    // and safety (restore) must never be skipped for a UX branch. FIX-B: no gate/status touch here.
    const anomalies = await restoreAndDiff(projectsDir, task, before, log);
    if (anomalies.length > 0) {
      // An anomaly (layer 1 bypassed) is the load-bearing signal — surface it even if the turn also
      // errored/produced no text; the restore already happened above (review #4: per-file isolated).
      log.warn({ taskId: task.taskId, files: anomalies.map((a) => `${a.kind}:${a.path}${a.restoreFailed ? '(RESTORE-FAILED)' : ''}`) },
        'ask: layer-2 detected + reverted write(s) — layer 1 was bypassed');
      ctx.broadcast?.(task.taskId, 'ask:done', { ok: false, anomaly: { files: anomalies } });
      return;
    }

    // FIX-D: an Ask that errored WITHOUT producing any answer text (a resume-attach failure — a bad/
    // expired session id makes the child exit before any result event; also any error-with-no-output)
    // must NOT inherit runPhase's write-intent fresh-turn fallback — `askWithin` HAS none, so the safety
    // goal ("a failed resume never falls through to a write turn") holds unconditionally. This branch only
    // improves the UX: surface a short canned message instead of finalizing an EMPTY answer bubble. Gated
    // on `!gotText` (not the never-produced `!note` shape turn-runner can't emit) so a turn that streamed
    // partial text before erroring keeps that text and finalizes ok:true.
    if (turn.isError && !gotText) {
      ctx.broadcast?.(task.taskId, 'ask:answer', {
        text: "couldn't get an answer for that — try again, or use Request changes to edit the artifact.",
      });
      ctx.broadcast?.(task.taskId, 'ask:done', { ok: false });
      return;
    }

    // Normal path — no anomaly, an answer streamed (or a clean empty result). FIX-B: ok, no task:update.
    ctx.broadcast?.(task.taskId, 'ask:done', { ok: true });
  } catch (e) {
    // The never-throw guard (see above): any unexpected error → benign ask:done{ok:false}, gate untouched.
    log.error({ taskId: task.taskId, err: errMsg(e) }, 'ask: unexpected error — surfaced as ask:done{ok:false}');
    ctx.broadcast?.(task.taskId, 'ask:done', { ok: false });
  }
}

// ─────────────────────────────── spec 034 · ④/terminal Ask (fresh-seeded) ───────────────────────────

/** repo-relative `.runs/<taskId>/<file>` — DUPLICATES phases.ts's module-private `runArtifact` template
 *  (not exported; mirrors criteria.ts's own "mirrors phases.ts `runArtifact`" duplication, 034 §1). */
const runArtifactRel = (taskId: string, file: string): string =>
  `apps/builder/.runs/${taskId}/${file}`;

/** `readCriteria`-style degrade-on-missing (live-test.ts:26-33 / D1): a missing/unreadable file returns
 *  null and simply drops out of the seed — it never fails the Ask. */
async function tryReadRel(projectsDir: string, rel: string): Promise<string | null> {
  try {
    return await readFile(join(projectsDir, rel), 'utf8');
  } catch {
    return null;
  }
}

/** Assemble the fresh seed from whatever of requirement/SPEC.md/main.yml/report.json/liveTest exist (D1).
 *  Returns the prompt-ready seed block + the list of sources actually folded in (→ `seededFrom`, §2). */
async function gatherTerminalSeed(
  projectsDir: string,
  task: Task
): Promise<{ seed: string; seededFrom: string[] }> {
  const parts: string[] = [];
  const seededFrom: string[] = [];
  const add = (label: string, body: string | null | undefined, tag: string): void => {
    if (body && body.trim()) {
      parts.push(`## ${label}\n${body.trim()}`);
      seededFrom.push(tag);
    }
  };

  add('Requirement', task.requirement, 'requirement');

  const dir = workflowDir(task);
  const specRel = task.artifacts.spec ?? (dir ? `${dir}/SPEC.md` : runArtifactRel(task.taskId, 'SPEC.md'));
  add('SPEC.md', await tryReadRel(projectsDir, specRel), 'SPEC.md');

  const ymlRel = task.artifacts.implement ?? (dir ? `${dir}/workflows/${task.workflowFile}` : null);
  if (ymlRel) add('main.yml', await tryReadRel(projectsDir, ymlRel), 'main.yml');

  add('report.json', await tryReadRel(projectsDir, runArtifactRel(task.taskId, 'report.json')), 'report.json');

  // `task.liveTest` (the judge's per-criterion verdict + run result) lives on the task, NOT in report.json.
  if (task.liveTest) add('Live-test result', JSON.stringify(task.liveTest, null, 2), 'liveTest');

  return { seed: parts.join('\n\n'), seededFrom };
}

/**
 * `askTestWithin(task, text, ctx)` — spec 034: a conversational Ask at a ④ Test gate (any of the four
 * flags, `awaiting_confirm && phase==='test'`) OR after a build reaches terminal `done`/`cancelled`. There
 * is NO phase session to resume (④ never runs a Claude turn for its own gate), so this is `runJudge`-shaped
 * (live-test.ts): a FRESH `ClaudeSession`, all context folded into the prompt (D1). A dedicated
 * `sessionIds.askTest` slot carries follow-up continuity (D2) — resumed on a 2nd question, spawned fresh on
 * the 1st. Containment is layer 1 ONLY (D4): `askMode:true` → `BUILDER_ASK_MODE=1` → the permission-gate
 * hook denies every file write; unlike `askWithin` there is NO byte-snapshot/restore backstop (report.json
 * is backend-authored, and there is no in-progress artifact mid-edit to protect — so layer 1 is the sole
 * guard, a deliberate single point of failure, D4). Never touches task.gate/status/phase; the ④ gate stays
 * parked and a terminal build stays terminal. Mirrors `askWithin`'s never-throw guard: any error →
 * benign `ask:done{ok:false}`.
 */
export async function askTestWithin(task: Task, text: string, ctx: OrchestratorCtx): Promise<void> {
  const { projectsDir, settingsPath, log } = ctx;
  try {
    const { seed, seededFrom } = await gatherTerminalSeed(projectsDir, task);
    const prompt =
      (seed ? `You are answering a question about the following build.\n\n${seed}\n\n---\n\n` : '') +
      `${text}\n\n(Answer conversationally. Do NOT create, modify, or delete any file — this is a ` +
      `question, not a change request.)`;

    // Mirror askWithin's review-#2 guard: a /cancel that landed during gatherTerminalSeed (before setSession,
    // so it found no live child and merely flagged the holder) must abort HERE — not spawn + run the full
    // turn holding the global lock for the whole timeout budget.
    if (isAskCancelRequested(task.taskId)) {
      ctx.broadcast?.(task.taskId, 'ask:done', { ok: false });
      return;
    }

    const { runTurn } = resolveRunners(ctx);
    const session = new ClaudeSession(`${task.taskId}:askTest`, {
      taskId: task.taskId,
      workingDir: projectsDir,
      settingsPath,
      log,
      resumeSessionId: task.sessionIds.askTest, // D2: continue the same ④/terminal conversation if any
      askMode: true, // D4 layer 1: BUILDER_ASK_MODE — the hook denies every write
    });
    setSession(task.taskId, session); // hand the child to /cancel (scoped abort, same as askWithin — D9)

    let gotText = false;
    const turn = await runTurn(
      session,
      prompt,
      (sid) => {
        task.sessionIds.askTest = sid; // D2: persist immediately so a mid-turn follow-up resumes it
        void saveTask(projectsDir, task);
      },
      {
        timeoutMs: ASK_TIMEOUT_MS,
        onText: (chunk) => {
          gotText = true;
          ctx.broadcast?.(task.taskId, 'ask:answer', { text: chunk });
        },
      }
    );
    clearSession(task.taskId);
    if (turn.sessionId) {
      task.sessionIds.askTest = turn.sessionId;
      await saveTask(projectsDir, task);
    }

    // FIX-D-analog: an error with no streamed text → a short canned message, never an empty bubble.
    if (turn.isError && !gotText) {
      ctx.broadcast?.(task.taskId, 'ask:answer', { text: "couldn't get an answer for that — try again." });
      ctx.broadcast?.(task.taskId, 'ask:done', { ok: false });
      return;
    }
    // No layer-2 (D4) → no anomaly branch → `ask:done` is always ok:true here, carrying `seededFrom` (§2).
    ctx.broadcast?.(task.taskId, 'ask:done', { ok: true, seededFrom });
  } catch (e) {
    clearSession(task.taskId); // ensure the /cancel handle is cleared on any throw
    log.error({ taskId: task.taskId, err: errMsg(e) }, 'askTest: unexpected error — surfaced as ask:done{ok:false}');
    ctx.broadcast?.(task.taskId, 'ask:done', { ok: false });
  }
}
