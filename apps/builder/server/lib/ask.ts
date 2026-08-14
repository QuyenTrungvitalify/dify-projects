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
import { readFile, readdir, writeFile, rm, mkdir, appendFile } from 'node:fs/promises';
import { join, relative, dirname, sep } from 'node:path';
import { ClaudeSession } from './claude-session.js';
import { clearSession, isAskCancelRequested, setSession } from './lock.js';
import { attachmentBlock } from './attachments.js';
import { buildWorkflowIndex } from './workflow-index.js';
import { unifiedDiffOfFiles } from './diff.js';
import { PHASES } from './phases.js';
import { languagePin } from './language.js';
import { lintStandaloneYaml } from './base-import.js';
import { checkRunnability, preflightNote, sourceContractNote } from './runnability.js';
import { costFromResult } from './cost.js';
import { errMsg, resolveRunners, type OrchestratorCtx } from './orchestrator-shared.js';
import type { TurnResult } from './turn-runner.js';
import { bumpRev, noteUserLang, saveTask, taskDir, workflowDir, type PhaseCost, type Task } from '../state/task.js';

/** Pinned shorter than the phase default (10 min) — an Ask is a quick conversational reply, not a long
 *  agentic turn (matches the existing JUDGE_TIMEOUT_MS convention for a short data-turn, live-test.ts).
 *  Env-tunable (spec 048 D1): read ONCE at module load, so a change needs a restart. */
/**
 * Spec 097 — the notice a CUT-OFF answer must carry.
 *
 * All three ask paths deliberately keep the partial text when a turn errors after streaming ("a turn
 * that streamed partial text before erroring keeps that text"), which is right — throwing away a
 * half-written answer helps nobody. What was missing is the second half of that decision: SAYING it is
 * half-written. Without it a truncated answer is finalized as `回答済み` / "Answered", indistinguishable
 * from a complete one, so the reader waits for a continuation that can never come.
 *
 * Measured on task 1786505684286: an ask on a 52-node build streamed an analysis ending "I'll report
 * back as soon as I have the result", hit the 3-minute wall, was force-killed, and was presented as a
 * finished answer. The two follow-ups then resumed that killed session and returned nothing, then an
 * error — with no transcript and no recorded cost to explain any of it.
 *
 * `note` is turn-runner's classified cause (`timed out after …`, a quota/auth/network death) — the same
 * string a phase turn surfaces on its gate card, and the one thing that makes this diagnosable.
 */
export function truncationNotice(note: string | undefined): string {
  const why = note ? ` (${note})` : '';
  return (
    `\n\n---\n⚠ This answer stopped early and is incomplete${why}. ` +
    `Nothing was written to your files. Ask again — a narrower question finishes faster.`
  );
}

/**
 * Spec 097 — the ask wall-clock budget. Raised 3 → 8 minutes.
 *
 * Three minutes was killing legitimate work: an ask on a 52-node build reads the requirement, SPEC.md,
 * a 95KB main.yml and report.json, then cross-checks vetted patterns. Measured on task 1786505684286 it
 * was force-killed mid-analysis twice. A phase turn gets 15 minutes for comparable reading (spec 085
 * raised it after a real build landed at 600.7s), so 3 was out of step with the evidence.
 *
 * NOT 15, though: an ask is interactive — someone is watching — whereas 15 minutes is the budget for a
 * turn nobody is sitting in front of. 8 is the compromise, and it is only safe BECAUSE two other things
 * shipped with it: a cut-off answer now says so (truncationNotice), and Stop is offered on every ask
 * rather than consult-only, so a long budget is no longer a wait you cannot escape.
 *
 * The lane is a single global slot (lock.ts), so this bounds how long ONE ask can block every other
 * chat app-wide. That is the real cost of raising it, and the Stop button is what pays for it.
 */
export const ASK_TIMEOUT_MS = Number(process.env.BUILDER_ASK_TIMEOUT_MS) || 8 * 60 * 1000;

/**
 * Every answer surface renders Markdown, where a fence closes at the FIRST run of backticks at least as
 * long as the one that opened it. A hand-over block ("copy this whole document") whose content has its
 * own ``` sections therefore cut ITSELF in half: the reader got a code box that stopped mid-document and
 * the rest spilled into the page as prose — unreadable, and impossible to copy as one piece. Observed on
 * a Build-Requirement hand-over. The renderer understands ````-fences (see web/src/lib/markdown.ts), so
 * the escape hatch exists; this line is what makes the model reach for it.
 *
 * Shared by all three ask surfaces on purpose: the rule is about the shared RENDERER, so letting the
 * three prompts drift on it would just mean fixing this three times.
 */
export const FENCE_RULE =
  ' FORMATTING: when a fenced block you write contains ``` anywhere inside it (e.g. handing over a whole' +
  ' document to copy), open and close that block with FOUR backticks (````) or more — always longer than' +
  ' any run of backticks inside it. Otherwise the block ends early and the rest leaks into the page.';

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

/**
 * What one answer cost, for the dev tip under it.
 *
 * Same reader a phase uses (`costFromResult` on the turn's terminal `result` event), so the numbers mean
 * exactly what the dev panel's table already means — model, tokens, cache share, wall-clock, USD. Until
 * now an ask recorded NONE of that: a phase wrote `task.json.cost.<phase>` and an ask wrote nothing, so
 * the surface that turned out to cost 3.4× the build (spec 098) was the one surface with no meter on it.
 *
 * Rides on the `ask:done` event and nowhere else — this is a live read-out, not a record. It is NOT
 * persisted to `task.json`: an ask has no phase slot to write to, and inventing one would put a
 * per-message number into the build's cost table, where every reader would take it for a phase.
 *
 * `{}` when the turn reported nothing numeric (a killed turn has no result event), so the payload simply
 * has no `cost` key and the client renders no tip — rather than a tip full of dashes.
 */
function askCost(turn: TurnResult): { cost?: PhaseCost } {
  const cost = costFromResult(turn.result);
  return cost ? { cost } : {};
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
    model: task.model, // spec 096 — same start-bound choice as the build phases
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
export async function askWithin(
  task: Task,
  text: string,
  ctx: OrchestratorCtx,
  /** spec 098 S2: indices in `task.attachments` of the files THIS message brought — only those carry the
   *  "read them" invitation. Absent ⇒ every attachment is treated as new (the pre-098 behavior). */
  newAttachments?: number[]
): Promise<void> {
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
    // The gate-side Ask is exactly where the language gap was FELT: the observed run has the user asking
    // twice, in Vietnamese, for the Japanese gate questions to be explained again. This turn used to
    // carry no language directive at all — it inherited whatever the resumed session had been speaking.
    await noteUserLang(projectsDir, task, text);
    const prompt =
      languagePin({ chatLang: task.chatLang, latest: text, hint: task.langHint, requirement: task.requirement }) +
      `${text}\n\n(Answer conversationally. Do NOT create, modify, or delete any file — this is a ` +
      `question, not a change request.${FENCE_RULE})` +
      attachmentBlock(task.attachments, newAttachments);

    let gotText = false;
    let answer = ''; // accumulated for the transcript (recordAsk) — the live view gets the chunks
    const turn = await askTurn(task, prompt, ctx, (chunk) => {
      gotText = true;
      answer += chunk;
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
      await recordAsk(projectsDir, task.taskId, text, answer, false, askCost(turn).cost);
      ctx.broadcast?.(task.taskId, 'ask:done', { ok: false, anomaly: { files: anomalies }, ...askCost(turn) });
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
      // Spec 045 (review #4): append the classified turn-failure note — a quota/auth/network death
      // during Ask must self-describe exactly like a phase turn's gate note does, not stay canned.
      const cause = turn.note ? ` (${turn.note})` : '';
      const canned = `couldn't get an answer for that — try again, or use Request changes to edit the artifact.${cause}`;
      ctx.broadcast?.(task.taskId, 'ask:answer', { text: canned });
      await recordAsk(projectsDir, task.taskId, text, canned, false, askCost(turn).cost);
      ctx.broadcast?.(task.taskId, 'ask:done', { ok: false, ...askCost(turn) });
      return;
    }
    // Spec 097: errored but text DID stream — keep it (as before) and say it is incomplete. ok:false so
    // a cut-off answer can never be captured as a build prefill by an armed graduate.
    if (turn.isError) {
      const notice = truncationNotice(turn.note);
      ctx.broadcast?.(task.taskId, 'ask:answer', { text: notice });
      // The notice is part of what the reader saw, so it is part of what gets recorded — a recovered
      // answer must never look more finished than the live one did.
      await recordAsk(projectsDir, task.taskId, text, answer + notice, false, askCost(turn).cost);
      ctx.broadcast?.(task.taskId, 'ask:done', { ok: false, ...askCost(turn) });
      return;
    }

    // Normal path — no anomaly, an answer streamed (or a clean empty result). FIX-B: ok, no task:update.
    await recordAsk(projectsDir, task.taskId, text, answer, true, askCost(turn).cost);
    ctx.broadcast?.(task.taskId, 'ask:done', { ok: true, ...askCost(turn) });
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
/**
 * Spec 098 — how much of an artifact the terminal ask carries.
 *
 * MEASURED, on this user's own sessions: the seed was 124–141KB and was re-sent on EVERY question (46
 * of them in one session, 89% of the bytes byte-identical to the previous ask). It made answering cost
 * 3.4× what BUILDING the workflows cost — 60.5M vs 18.0M input-equivalent tokens — and `main.yml` alone
 * was ~85% of it.
 *
 * The fix is deliberately NOT "seed once and remember": the CLI COMPACTS a long session (observed twice
 * in that same session), which summarises the old inlined YAML away — a later ask would then answer
 * about a workflow it can no longer see, and be confidently wrong. So the seed still goes out every
 * turn; what changed is its SIZE. Details live in the files, whose paths ride along.
 */
const SPEC_INLINE_MAX = 16 * 1024;
/** Raw YAML is inlined only when it is small enough that a map would not pay for itself. */
const YAML_RAW_MAX = 8 * 1024;
/** An outline is bounded too: a spec with 400 headings would otherwise be its own wall of text. */
const OUTLINE_MAX = 4 * 1024;
/** Every threshold here is in BYTES, not `String.length`. A user writing in Japanese pays 3 bytes per
 *  character, so a "16KB" cap read as characters silently admitted ~48KB of real text — measured: a real
 *  SPEC.md of 16,398 bytes sailed under a 16,384-CHARACTER cap and got inlined whole. */
const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');
/** First `max` BYTES of `s`, cut on a character boundary — slicing the buffer alone would sever a
 *  multi-byte character and leave a replacement glyph at the seam. */
function clipBytes(s: string, max: number): string {
  if (bytes(s) <= max) return s;
  let out = '';
  let used = 0;
  for (const ch of s) {
    const n = bytes(ch);
    if (used + n > max) break;
    out += ch;
    used += n;
  }
  return out;
}

const specOutlineNote = (rel: string, size: number): string =>
  `(outline only — the full ${Math.round(size / 1024)}KB document is at \`${rel}\`; read it for any section you need)`;

/**
 * The `main.yml` section: a node/edge map plus the path, or — when the file is not shaped the way the
 * scanner understands — the raw bytes (small files) or an honest "no map, read the file" pointer.
 * Never a partial map: `buildWorkflowIndex` reports `ok:false` rather than guess (see its header).
 */
async function workflowSeedBody(projectsDir: string, rel: string): Promise<string | null> {
  const raw = await tryReadRel(projectsDir, rel);
  if (!raw) return null;
  const size = bytes(raw);
  const idx = buildWorkflowIndex(raw);
  if (idx.ok) {
    return `File: \`${rel}\` (${Math.round(size / 1024)}KB — read it for node bodies, prompts, URLs)\n${idx.text}`;
  }
  if (size <= YAML_RAW_MAX) return raw; // small enough to just hand over, map or no map
  return `File: \`${rel}\` (${Math.round(size / 1024)}KB). A node map could not be built from it — read the file directly.`;
}

async function gatherTerminalSeed(
  projectsDir: string,
  task: Task
): Promise<{ seed: string; seededFrom: string[] }> {
  const parts: string[] = [];
  // `seededFrom` drives the `参照:` caption under the answer, and the tags stay the FILE names even
  // though `main.yml` now travels as a map and a big `SPEC.md` as an outline. Deliberate: the answer
  // really is assembled from those files — the map is derived from `main.yml`, and the file itself is
  // read when a question needs more — so the caption is not a lie. Writing `main.yml (index)` would
  // change what the user reads, and break a pinned assertion, to say something less true, not more.
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
  // Spec 098 S3: a big SPEC.md rides as its heading outline plus its path — measured 37.7KB → 748 chars
  // on the largest real spec. Under the cap it is inlined whole, which is most builds.
  const specBody = await tryReadRel(projectsDir, specRel);
  if (specBody && bytes(specBody) > SPEC_INLINE_MAX) {
    // One heading is free-form text and can be a paragraph on its own, so each is clipped before it is
    // measured — otherwise a single fat heading eats the whole budget (review: it did, and the outline
    // came out as the words "… and 1 more headings" with no content at all).
    const heads = specBody
      .split('\n')
      .filter((l) => /^#{1,4} /.test(l))
      .map((l) => (l.length > 160 ? `${l.slice(0, 160)}…` : l));
    let gist: string;
    if (heads.length) {
      const kept: string[] = [];
      let used = 0;
      for (const h of heads) {
        // Backstop, not the main defence: the clip above already keeps any single heading far under the
        // budget, so this only bites if someone lowers OUTLINE_MAX or raises the clip. An outline of
        // nothing is not an outline.
        if (kept.length && used + bytes(h) + 1 > OUTLINE_MAX) break;
        kept.push(h);
        used += bytes(h) + 1;
      }
      const dropped = heads.length - kept.length;
      gist = kept.join('\n') + (dropped ? `\n… and ${dropped} more heading${dropped > 1 ? 's' : ''} (read the file)` : '');
    } else {
      // A long spec written without markdown headings has no outline — hand over its opening instead of
      // a bare pointer, so the answer has somewhere to start. (Review: the cap used to run on this branch
      // too, and with no headings to keep it replaced the excerpt with the phrase "… and 0 more
      // headings" — destroying the one thing this branch exists to provide.)
      gist = `${clipBytes(specBody, OUTLINE_MAX)}\n… (opening excerpt — this document has no headings; read the file for the rest)`;
    }
    add('SPEC.md', `${specOutlineNote(specRel, bytes(specBody))}\n${gist}`, 'SPEC.md');
  } else {
    add('SPEC.md', specBody, 'SPEC.md');
  }

  const ymlRel = task.artifacts.implement ?? (dir ? `${dir}/workflows/${task.workflowFile}` : null);
  if (ymlRel) add('main.yml', await workflowSeedBody(projectsDir, ymlRel), 'main.yml');

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
export async function askTestWithin(
  task: Task,
  text: string,
  ctx: OrchestratorCtx,
  /** spec 098 S2 — see askWithin. */
  newAttachments?: number[]
): Promise<void> {
  const { projectsDir, settingsPath, log } = ctx;
  try {
    const { seed, seededFrom } = await gatherTerminalSeed(projectsDir, task);
    await noteUserLang(projectsDir, task, text);
    const prompt =
      // Same omission as askWithin's: the ④/terminal Ask had no language directive, so a Vietnamese
      // question about a finished Japanese build came back in Japanese (or English, on a fresh spawn).
      languagePin({ chatLang: task.chatLang, latest: text, hint: task.langHint, requirement: task.requirement }) +
      (seed ? `You are answering a question about the following build.\n\n${seed}\n\n---\n\n` : '') +
      `${text}\n\n(Answer conversationally. Do NOT create, modify, or delete any file — this is a ` +
      `question, not a change request.${FENCE_RULE})` +
      // Same omission as the consult resume path: this turn accepts files (the ④ gate and a terminal
      // build's chat both offer attach), saved them, and then told the model nothing about them.
      attachmentBlock(task.attachments, newAttachments);

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
      model: task.model, // spec 096 — same start-bound choice as the build phases
    });
    setSession(task.taskId, session); // hand the child to /cancel (scoped abort, same as askWithin — D9)

    let gotText = false;
    let answer = ''; // accumulated for the transcript (recordAsk) — the live view gets the chunks
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
          answer += chunk;
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
      // Spec 097: this path DROPPED `turn.note` while the other two included it — so the one surface a
      // user actually hit reported a bare "try again" with the timeout reason stripped off.
      const cause = turn.note ? ` (${turn.note})` : '';
      const canned = `couldn't get an answer for that — try again.${cause}`;
      ctx.broadcast?.(task.taskId, 'ask:answer', { text: canned });
      await recordAsk(projectsDir, task.taskId, text, canned, false, askCost(turn).cost);
      ctx.broadcast?.(task.taskId, 'ask:done', { ok: false, ...askCost(turn) });
      return;
    }
    if (turn.isError) {
      const notice = truncationNotice(turn.note);
      ctx.broadcast?.(task.taskId, 'ask:answer', { text: notice });
      await recordAsk(projectsDir, task.taskId, text, answer + notice, false, askCost(turn).cost);
      // `seededFrom` rides along: the answer WAS assembled from those artifacts, and being cut off does
      // not unmake that. applyAskDone folds the caption regardless of `ok`, so dropping it here would
      // strip the "assembled from" line off exactly the answer whose provenance matters most.
      ctx.broadcast?.(task.taskId, 'ask:done', { ok: false, seededFrom, ...askCost(turn) });
      return;
    }
    // No layer-2 (D4) → no anomaly branch → `ask:done` is always ok:true here, carrying `seededFrom` (§2).
    await recordAsk(projectsDir, task.taskId, text, answer, true, askCost(turn).cost);
    ctx.broadcast?.(task.taskId, 'ask:done', { ok: true, seededFrom, ...askCost(turn) });
  } catch (e) {
    clearSession(task.taskId); // ensure the /cancel handle is cleared on any throw
    log.error({ taskId: task.taskId, err: errMsg(e) }, 'askTest: unexpected error — surfaced as ask:done{ok:false}');
    ctx.broadcast?.(task.taskId, 'ask:done', { ok: false });
  }
}

// ─────────────────────────────── spec 082 · consult chat (kind:'consult') ───────────────────────────

/** Spec 082 §4.2 — the consult ROLE preamble, folded only into a FRESH spawn (a resumed session
 *  already carries it in its history). Deliberately tiny: the latency win of a consult turn over a
 *  phase turn is that NO phase doc is inlined — this line is the entire standing context beyond the
 *  user's own messages and attachments. */
export const CONSULT_PREAMBLE =
  "You are the Dify workflow Builder's consult chat: help the user explore ideas, plan workflows, " +
  "and discuss any attached YAML file. Answer conversationally, in the user's language. " +
  'Do NOT create, modify, or delete any file — this is a conversation, not a change request. ' +
  // Spec 082 §4.4: when the user asks to actually BUILD, don't dead-end on a refusal + improvised
  // "paste it into the Build box" steps. There is a real one-click affordance — point them to it.
  'When the user wants to actually build the workflow, do NOT just decline: tell them to click the ' +
  '"Start build from this chat" button at the top of this chat — it turns this whole conversation into ' +
  'a ready-to-run build requirement (they can edit it before running) — and keep helping them shape the ' +
  'idea until they click it. Never tell them to copy-paste text into another box by hand.' +
  // The consult is where hand-over blocks actually happen (it is the surface that drafts a document for
  // the user to take elsewhere), but the rule is shared — see FENCE_RULE.
  FENCE_RULE;

/** Spec 082 S3 — one YAML report card: the MACHINE checks (no LLM, ~1s) run on a `.yml` the user
 *  dropped into the consult. `lint` = the same 4-linter gate the promote paste door uses ([] = clean);
 *  `preflight`/`contract` = the runnability advisories the ③ verify computes. A tool that fails to run
 *  is REPORTED in `note` — never silently treated as clean (the 081 preflight DNA). */
export interface ConsultCard {
  file: string;
  lint: string[];
  preflight?: string;
  contract?: string;
  note?: string;
}

const isYamlRel = (rel: string): boolean => /\.ya?ml$/i.test(rel);

/** Run the machine checks over the consult's attached YAMLs (first 3 — cap logged into the card note,
 *  no silent truncation). Emits one `ask:card` per file BEFORE the turn spawns, and returns the prompt
 *  block that folds the same facts into the model's seed so it discusses real data, not guesses. */
async function yamlCards(task: Task, ctx: OrchestratorCtx): Promise<string> {
  const { projectsDir, log } = ctx;
  const { runPython } = resolveRunners(ctx);
  const yamls = (task.attachments ?? []).filter(isYamlRel);
  if (!yamls.length) return '';
  const blocks: string[] = [];
  for (const rel of yamls.slice(0, 3)) {
    // Display name = the user's own filename: saveAttachments prefixes saved files with `<idx>_`
    // (collision-proofing) — strip that machine prefix so the card reads `flow.yml`, not `0_flow.yml`.
    const base = rel.split('/').pop() ?? rel;
    const card: ConsultCard = { file: base.replace(/^\d+_/, ''), lint: [] };
    try {
      const content = await readFile(join(projectsDir, rel), 'utf8');
      card.lint = await lintStandaloneYaml(projectsDir, content, runPython);
    } catch (e) {
      card.note = `could not run lint: ${errMsg(e)}`;
    }
    try {
      const pf = await checkRunnability(projectsDir, rel, runPython);
      card.preflight = preflightNote(pf) ?? undefined;
      card.contract = sourceContractNote(pf) ?? undefined;
    } catch (e) {
      card.note = `${card.note ? card.note + ' · ' : ''}could not run preflight: ${errMsg(e)}`;
    }
    if (yamls.length > 3) card.note = `${card.note ? card.note + ' · ' : ''}only the first 3 files were checked (${yamls.length} attached)`;
    ctx.broadcast?.(task.taskId, 'ask:card', card);
    log.info({ taskId: task.taskId, file: card.file, lint: card.lint.length, note: card.note }, 'consult: yaml card');
    blocks.push(
      `## Machine check — ${card.file}\n` +
      `- lint: ${card.lint.length ? card.lint.join(' | ') : 'clean'}\n` +
      (card.preflight ? `- preflight: ${card.preflight}\n` : '') +
      (card.contract ? `- source contract: ${card.contract}\n` : '') +
      (card.note ? `- note: ${card.note}\n` : '')
    );
  }
  return blocks.length ? `\n\n${blocks.join('\n')}` : '';
}

/**
 * Spec 082 (rev 2026-07-30) — the consult transcript lives on the BACKEND at `.runs/<taskId>/chat.jsonl`
 * (one `{role,text,at}` per line). This DEPARTS from a build Ask's ephemerality (033 D6 — no backend
 * transcript for the build pipeline): a consult's conversation IS its deliverable, so a reopen must show
 * it regardless of browser / cleared cache / a second machine — the localStorage-only path (§4.2b, now
 * superseded) lost it on all three. Scoped to the consult's OWN run dir, so the build pipeline's D6
 * invariant is untouched. Best-effort: a write failure never breaks the turn; the read degrades to [].
 */
export interface ConsultChatLine {
  role: 'user' | 'assistant';
  text: string;
  at?: number;
  /** The files this message carried, as the FE needs to show them back: `idx` addresses the saved copy
   *  at `GET /api/tasks/:id/uploads/:idx`. Recorded HERE because a consult reopens from this transcript
   *  (it is authoritative — cleared cache / another machine), so without it the reopened chat forgets
   *  every attachment. User lines only. */
  files?: { name: string; mime: string; idx: number }[];
  /** Only ever written as `false`, and only on an assistant line: the exchange settled badly (an error,
   *  a cut-off answer, a layer-2 anomaly). Absent means it settled fine, so every transcript written
   *  before this field existed reads correctly. */
  ok?: boolean;
  /** What the turn that wrote this answer cost (assistant lines only) — the dev tip's numbers.
   *  On DISK because a consult rebuilds its thread from this file and that rebuild WINS over the
   *  browser's copy: without it, a reload dropped the tip on exactly the surface whose thread is
   *  server-authoritative. Absent on every line written before this field existed. */
  cost?: PhaseCost;
}
async function appendChat(
  projectsDir: string,
  taskId: string,
  role: 'user' | 'assistant',
  text: string,
  at: number,
  files?: ConsultChatLine['files'],
  ok?: boolean,
  cost?: PhaseCost
): Promise<void> {
  try {
    const line: ConsultChatLine = {
      role, text, at,
      ...(files && files.length ? { files } : {}),
      ...(ok === false ? { ok: false } : {}),
      ...(cost ? { cost } : {}),
    };
    await appendFile(join(taskDir(projectsDir, taskId), 'chat.jsonl'), JSON.stringify(line) + '\n', 'utf8');
  } catch {
    /* transcript is best-effort — never let it affect the turn */
  }
}

/**
 * Record ONE build ask exchange (`askWithin` at a gate, `askTestWithin` at ④/terminal) to the same
 * `chat.jsonl` a consult uses.
 *
 * WHY this exists: a build ask's answer used to live ONLY in the browser. `ask:answer` is deliberately
 * excluded from the SSE replay buffer (plugins/sse.ts — it is high-volume), a task switch tears the
 * stream down (`openStream`), and a fresh EventSource never sends `Last-Event-ID`, so nothing was
 * replayable either. Send a question, open another task, come back: the chunks that arrived while away
 * were gone for good, and the client — seeing the turn no longer running — closed the bubble as a
 * successful `回答済み` with no text in it. It read as an answer that died mid-sentence, which is exactly
 * what the user reported. A consult never had this problem because its transcript is on disk and its
 * reopen path reads from disk; this gives a build the same footing.
 *
 * `text` is what the READER SAW, notice included (a cut-off answer keeps its ⚠ line), so a recovered
 * answer can never look more finished than the live one did.
 */
async function recordAsk(
  projectsDir: string,
  taskId: string,
  question: string,
  answer: string,
  ok: boolean,
  cost?: PhaseCost
): Promise<void> {
  const at = Date.now();
  await appendChat(projectsDir, taskId, 'user', question, at);
  await appendChat(projectsDir, taskId, 'assistant', answer, at + 1, undefined, ok, cost);
}

/** The exchange a reopened build needs to finish an interrupted answer: the LAST assistant line plus the
 *  question it belongs to. `q` is what the client matches against, so it never grafts an answer onto a
 *  different question. Undefined when there is no transcript (every build before this shipped, and any
 *  build nobody has asked anything). */
export async function readLastAsk(
  projectsDir: string,
  taskId: string
): Promise<{ q: string; a: string; ok: boolean; cost?: PhaseCost } | undefined> {
  const lines = await readConsultChat(projectsDir, taskId);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].role !== 'assistant') continue;
    // The nearest preceding user line is this answer's question (recordAsk writes them as a pair).
    for (let j = i - 1; j >= 0; j--) {
      if (lines[j].role === 'user') {
        return { q: lines[j].text, a: lines[i].text, ok: lines[i].ok !== false, ...(lines[i].cost ? { cost: lines[i].cost } : {}) };
      }
    }
    return undefined; // an assistant line with no question before it — nothing to match on
  }
  return undefined;
}
/** Read the persisted consult transcript (GET /api/tasks/:id folds it in for a `kind:'consult'` task). */
export async function readConsultChat(projectsDir: string, taskId: string): Promise<ConsultChatLine[]> {
  try {
    const raw = await readFile(join(taskDir(projectsDir, taskId), 'chat.jsonl'), 'utf8');
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as ConsultChatLine);
  } catch {
    return []; // no transcript yet / unreadable → the FE falls back to the requirement bubble
  }
}

/**
 * `consultWithin(task, text, ctx)` — spec 082: the chat turn of a `kind:'consult'` task. The
 * `askTestWithin` shape DUPLICATED (D8 DNA — the shipped ask paths keep byte-behavior), minus the
 * per-question terminal seed and plus three consult-specific choices, each with a reason:
 *   1. Seed (preamble + attachments) only on a FRESH spawn — nothing on disk changes between consult
 *      questions, so a resume never re-folds context (askTestWithin re-seeds because ④ artifacts CAN
 *      change between questions; a consult's can't). Directly serves the "chat is slow" complaint.
 *   2. `languagePin(...)` on EVERY prompt (fresh + resume) — consult is a pure chat surface for JP/VN
 *      users; prose must follow the user's language from token one. Here `latest` is THIS message, so a
 *      chat set to `auto` tracks the language the human switches to mid-conversation.
 *   3. Self-heal: a consult stranded at `status:'error'` (the create-race loser, or a failSafe on an
 *      unexpected throw) flips back to 'done' after any successful turn — /ask routes consult by KIND
 *      (any status), so one message is all it takes to recover the chat.
 * Containment is layer 1 ONLY (askMode → the hook denies every write): like askTestWithin, there is
 * no in-progress artifact to protect (D4). Never touches gate/phase; mirrors the never-throw guard.
 */
export async function consultWithin(
  task: Task,
  text: string,
  ctx: OrchestratorCtx,
  /** Files this message carried (name/mime + the index the route saved them at) — recorded on the
   *  user's transcript line so a reopened chat still shows them. */
  files?: ConsultChatLine['files']
): Promise<void> {
  const { projectsDir, settingsPath, log } = ctx;
  try {
    // Mirror askWithin's review-#2 guard: a /cancel that landed before setSession (no live child yet —
    // it merely flagged the holder) must abort here, not run the full turn holding the chat lane.
    if (isAskCancelRequested(task.taskId)) {
      ctx.broadcast?.(task.taskId, 'ask:done', { ok: false });
      return;
    }

    const fresh = !task.sessionIds.askTest;
    await noteUserLang(projectsDir, task, text);
    const langPin = languagePin({
      chatLang: task.chatLang,
      latest: text,
      hint: task.langHint,
      requirement: task.requirement,
    });
    // S3: the machine checks run only on the FIRST turn — card(s) stream to the FE before the model says
    // a word, and the same facts fold into the seed. Never fatal: yamlCards reports tool failures inside
    // the card itself. (The old reason given here — "attachments only arrive at create" — stopped being
    // true when spec 089 gave /ask files.)
    const cardBlock = fresh ? await yamlCards(task, ctx) : '';
    // The attachment block goes on EVERY turn, not just the first. A file dropped into an ongoing chat
    // was saved to disk and then never mentioned to the model, which answered "I only received text" —
    // the file was invisible to it. Listing the task's full set each turn (what askWithin already does)
    // costs a few lines of prompt and can never silently drop the one file the user just handed over.
    const fileBlock = attachmentBlock(task.attachments);
    const prompt = fresh
      ? `${langPin}${CONSULT_PREAMBLE}\n\n---\n\n${text}${fileBlock}${cardBlock}`
      : `${langPin}${text}${fileBlock}`;

    const { runTurn } = resolveRunners(ctx);
    const session = new ClaudeSession(`${task.taskId}:consult`, {
      taskId: task.taskId,
      workingDir: projectsDir,
      settingsPath,
      log,
      // 082 §4.1: consult reuses the `askTest` slot — its semantics are exactly "chat continuity
      // outside phases" (034 D2), and a consult never has phase sessions to collide with.
      resumeSessionId: task.sessionIds.askTest,
      askMode: true, // layer-1 write-deny: BUILDER_ASK_MODE → the hook denies every Write/Edit
      model: task.model, // spec 096 — same start-bound choice as the build phases
    });
    setSession(task.taskId, session); // hand the child to /cancel (scoped abort, D9)

    let gotText = false;
    let answer = ''; // accumulate the streamed answer → the backend transcript (chat.jsonl)
    const turn = await runTurn(
      session,
      prompt,
      (sid) => {
        task.sessionIds.askTest = sid; // persist immediately so a mid-turn follow-up resumes it
        void saveTask(projectsDir, task);
      },
      {
        timeoutMs: ASK_TIMEOUT_MS,
        onText: (chunk) => {
          gotText = true;
          answer += chunk;
          ctx.broadcast?.(task.taskId, 'ask:answer', { text: chunk });
        },
      }
    );
    clearSession(task.taskId);
    if (turn.sessionId) {
      task.sessionIds.askTest = turn.sessionId;
      await saveTask(projectsDir, task);
    }

    // Persist the transcript (rev 2026-07-30). The user's message always lands (the turn ran); the
    // assistant line lands with whatever the turn produced — the real answer, or the canned error
    // below — so the reopened chat matches exactly what streamed. `at`/`at+1` orders the pair.
    const at = Date.now();
    await appendChat(projectsDir, task.taskId, 'user', text, at, files);

    // Choice 3 (self-heal): only ever flips error→done — a healthy consult (born 'done') is untouched.
    if (!turn.isError && task.status === 'error') {
      task.status = 'done';
      task.error = undefined;
      bumpRev(task); // direct broadcast bypasses emit — bump so a stale GET can't resurrect the error
      await saveTask(projectsDir, task);
      ctx.broadcast?.(task.taskId, 'task:update', task);
    }

    // FIX-D-analog: an error with no streamed text → a short canned message, never an empty bubble.
    if (turn.isError && !gotText) {
      const cause = turn.note ? ` (${turn.note})` : '';
      const msg = `couldn't get an answer for that — try again.${cause}`;
      ctx.broadcast?.(task.taskId, 'ask:answer', { text: msg });
      await appendChat(projectsDir, task.taskId, 'assistant', msg, at + 1, undefined, false, askCost(turn).cost);
      ctx.broadcast?.(task.taskId, 'ask:done', { ok: false, ...askCost(turn) });
      return;
    }
    if (turn.isError) {
      // Spec 097: same as the other two, plus the persisted transcript — a reopened chat must not show a
      // cut-off answer as a finished one either.
      const notice = truncationNotice(turn.note);
      ctx.broadcast?.(task.taskId, 'ask:answer', { text: notice });
      await appendChat(projectsDir, task.taskId, 'assistant', answer + notice, at + 1, undefined, false, askCost(turn).cost);
      ctx.broadcast?.(task.taskId, 'ask:done', { ok: false, ...askCost(turn) });
      return;
    }
    if (gotText) await appendChat(projectsDir, task.taskId, 'assistant', answer, at + 1, undefined, undefined, askCost(turn).cost);
    ctx.broadcast?.(task.taskId, 'ask:done', { ok: true, ...askCost(turn) });
  } catch (e) {
    clearSession(task.taskId); // ensure the /cancel handle is cleared on any throw
    log.error({ taskId: task.taskId, err: errMsg(e) }, 'consult: unexpected error — surfaced as ask:done{ok:false}');
    ctx.broadcast?.(task.taskId, 'ask:done', { ok: false });
  }
}
