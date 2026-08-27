/**
 * diff.ts — the unified-diff producer for spec 009 Lát 5 Task 4 (§G).
 *
 * Produces a `{ path, diff }` payload the Lát-4 `SplitDiffView`/`diff-parser` render. The diff is a
 * `difflib.unified_diff` (NOT `sync.py diff`, which is remote-vs-local) of the produced `main.yml`
 * against a BASE that depends on the build kind:
 *   - Dify-seed   → the pulled seed file (`task.seedPath`);
 *   - edit-existing → the pre-edit snapshot of `<workflowFile>` (captured by {@link snapshotDiffBase}
 *     BEFORE Phase ③ overwrites it);
 *   - no-seed / new → an empty base ⇒ the diff is the whole file as additions.
 *
 * The diff text is computed once after a successful Implement and written to `.runs/<taskId>/diff.json`
 * (so `GET /api/tasks/:id` reads it without re-spawning python). Backend-only; no Dify, no token.
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runPython } from './shell.js';
import type { Task } from '../state/task.js';

export interface DiffPayload {
  /** repo-relative path to the produced workflow (the "new" side). */
  path: string;
  /** unified-diff text (empty base ⇒ full file as additions). */
  diff: string;
  /**
   * Spec 103 step 1 — the same question asked of `SPEC.md`: what did THIS fix round change in the
   * document? `undefined` when there is no spec base, which is the normal state of a first build (②
   * wrote the spec minutes ago, so there is no "before" to compare with) — the panel then renders the
   * workflow section alone, exactly as it did pre-103.
   *
   * Rides the SAME artifact and the SAME tab as `diff`, deliberately: the `差分` tab already means
   * "what changed this round" (spec 103 L0 re-arms its base per round), so widening it to a second
   * file adds a row, not a new axis. A separate tab would have made `差分` and a new `仕様の差分`
   * answer the same question about different files, which is the trap Non-goal 6 names.
   */
  specDiff?: string;
}

/** Inline `difflib.unified_diff` over two files; a missing/empty base path reads as []. A non-UTF-8
 *  (binary) file also reads as [] rather than crashing the probe with an uncaught UnicodeDecodeError
 *  (spec 033 review #7): for the Ask anomaly path a binary file yields an empty diff — the anomaly is
 *  still reported+restored, just without a human-readable text diff. Byte-identical for text inputs. */
const DIFF_PROBE = `
import sys, difflib
def read(p):
    if not p:
        return []
    try:
        with open(p, encoding='utf-8') as f:
            return f.readlines()
    except (OSError, UnicodeDecodeError):
        return []
a = read(sys.argv[1]); b = read(sys.argv[2])
sys.stdout.write(''.join(difflib.unified_diff(a, b, fromfile=sys.argv[3], tofile=sys.argv[4])))
`;

/** The canonical pre-edit base snapshot path for a task (edit-existing only). */
function baseSnapshotRel(taskId: string): string {
  return `apps/builder/.runs/${taskId}/diff-base.yml`;
}

/** Spec 103 step 1 — the pre-round snapshot of `SPEC.md`. Deliberately shaped exactly like
 *  {@link baseSnapshotRel}: one file, overwritten per fix round, holding the state the round started
 *  from. ONE level of history on purpose — the UI offers one undo (a version picker is the deferred
 *  strip), and files nothing reads are files that rot. */
export function specBaseRel(taskId: string): string {
  return `apps/builder/.runs/${taskId}/spec-base.md`;
}

/** The canonical on-disk `SPEC.md` of a scaffolded build. */
function specRel(task: Task): string {
  return `projects/${task.project}/${task.workflowSlug}/SPEC.md`;
}

/**
 * Spec 103 Lane B — the DRAFT a ② revise edits. Never `SPEC.md` itself: that separation is what makes
 * "the real spec is untouched while you decide" a property of the filesystem rather than a promise
 * about the model's behaviour.
 *
 * Keyed on the TASK, not on the workflow. It sat at `projects/<p>/<w>/SPEC.next.md` for exactly one
 * audit cycle, and that was a silent-wrong-answer bug: several tasks legitimately share one workflow
 * (an edit-existing build, a finished build reopened for a fix — spec §1.4 counts the pattern), and a
 * parked build holds no lock, so build B's proposal would `copyFile` straight over build A's pending
 * draft. A then approved the plan it had read and the build implemented B's — reproduced end to end
 * against the real orchestrator. The per-task `specRevise` flag could never have caught it: it cannot
 * see a draft another task owns. Putting the taskId IN THE PATH makes the collision unrepresentable
 * instead of merely guarded against.
 *
 * Living in the run dir also means a cancelled proposal leaves no stray file in the user's workflow
 * folder — `.runs/<taskId>/` is the build's own scratch space, and it is confinement-whitelisted.
 */
export function specNextRel(task: Task): string {
  return `apps/builder/.runs/${task.taskId}/SPEC.next.md`;
}

/** Spec 103 Lane B — start a proposal: copy the live spec so ② edits hunks of a real document rather
 *  than composing a delta. Returns false when there is no spec to copy (nothing to revise). */
export async function beginSpecProposal(projectsDir: string, task: Task): Promise<boolean> {
  if (!task.project || !task.workflowSlug) return false;
  const src = join(projectsDir, specRel(task));
  if (!existsSync(src)) return false;
  await mkdir(join(projectsDir, `apps/builder/.runs/${task.taskId}`), { recursive: true });
  await copyFile(src, join(projectsDir, specNextRel(task)));
  return true;
}

/** Spec 103 Lane B — approve: the draft BECOMES the spec. A rename, deliberately: it costs no turn,
 *  cannot half-succeed, and the bytes the human read are exactly the bytes that land. */
export async function applySpecProposal(projectsDir: string, task: Task): Promise<boolean> {
  const next = join(projectsDir, specNextRel(task));
  if (!existsSync(next)) return false;
  await rename(next, join(projectsDir, specRel(task)));
  return true;
}

/** Spec 103 Lane B — drop a proposal. `SPEC.md` was never opened, so there is nothing to restore. */
export async function dropSpecProposal(projectsDir: string, task: Task): Promise<void> {
  const next = join(projectsDir, specNextRel(task));
  if (existsSync(next)) await rm(next, { force: true });
}

/**
 * Spec 103 step 1 — snapshot `SPEC.md` before a FIX ROUND overwrites it.
 *
 * Only fix rounds, and that is the whole point: ③ began writing `SPEC.md` when L0 shipped, and before
 * this there was no way back — nothing under `projects/_drafts/` is committed (spec 112 un-ignored
 * the folder, but un-ignoring is not committing), so git holds no history, and no `.bak` existed. A bad reconcile destroyed the previous spec permanently. This is the undo
 * L0 shipped without.
 *
 * A FIRST implement is deliberately NOT snapshotted: ② wrote that spec from the requirement minutes
 * earlier, so "undo the fix round" names nothing there. The gate offers undo iff this file exists,
 * so the gate's offer and the round's undoability are one fact, not two that can disagree.
 */
export async function snapshotSpecBase(projectsDir: string, task: Task): Promise<void> {
  if (!task.project || !task.workflowSlug) return;
  const srcAbs = join(projectsDir, specRel(task));
  if (!existsSync(srcAbs)) return; // no spec on disk yet → nothing to snapshot, and nothing to undo
  await mkdir(join(projectsDir, `apps/builder/.runs/${task.taskId}`), { recursive: true });
  await copyFile(srcAbs, join(projectsDir, specBaseRel(task.taskId)));
}

/** Spec 103 step 1 — is the last fix round undoable? Both snapshots must exist: undoing only one of
 *  them would leave `SPEC.md` describing a `main.yml` that no longer matches it, i.e. the Undo button
 *  would manufacture the exact drift this spec exists to prevent. */
export function fixRoundUndoable(projectsDir: string, task: Task): boolean {
  if (!task.project || !task.workflowSlug) return false;
  return (
    existsSync(join(projectsDir, specBaseRel(task.taskId))) &&
    existsSync(join(projectsDir, baseSnapshotRel(task.taskId)))
  );
}

/**
 * Spec 103 step 1 — undo the last fix round: restore BOTH files from their pre-round snapshots.
 *
 * Both or neither, always. Restoring only `SPEC.md` would leave it describing a workflow it no longer
 * matches; restoring only `main.yml` would leave the spec describing a change that is gone. Either
 * half alone is drift with a friendly button on it.
 *
 * Returns false when the snapshots are not both present (see {@link fixRoundUndoable}) — the caller
 * turns that into a 409 rather than a partial restore.
 */
export async function undoFixRound(projectsDir: string, task: Task): Promise<boolean> {
  if (!fixRoundUndoable(projectsDir, task)) return false;
  await copyFile(join(projectsDir, specBaseRel(task.taskId)), join(projectsDir, specRel(task)));
  await copyFile(join(projectsDir, baseSnapshotRel(task.taskId)), join(projectsDir, newWorkflowRel(task)));
  return true;
}

/** The produced workflow path (the "new" side of the diff). */
function newWorkflowRel(task: Task): string {
  return `projects/${task.project}/${task.workflowSlug}/workflows/${task.workflowFile}`;
}

/**
 * Snapshot the pre-edit workflow BEFORE the (first) Implement turn so an edit-existing diff has a
 * real base. No-op when: a Dify-seed task (the pulled `seedPath` IS the base), the snapshot already
 * exists (idempotent across /reply re-runs — capture the TRUE pre-edit state once), or the target
 * file doesn't exist yet (a no-seed new workflow → empty base → full additions).
 *
 * Spec 103 L0 — `opts.restart` re-arms the base for a NEW fix round. Without it, a build reopened for
 * a revision keeps the base it took before round 1, so the `差分` tab answers "what changed since this
 * build began" when the human is asking "what did THIS round change" — the two diverge further with
 * every round, which is the same drift this spec fixes for `SPEC.md`, one artifact over.
 *
 * KNOWN GAP (deliberate, not an oversight): a build seeded from a Dify app still diffs against that
 * app on every round. Closing THAT means changing {@link resolveBase}'s precedence, which would also
 * destroy the "compare with the Dify app I started from" view — a separate decision with its own
 * trade-off, not a line of this one.
 *
 * The gap used to be keyed on `seedPath`, which is wider than the sentence above describes: it is set
 * for EVERY local edit-existing build too (`localEditSeed` snapshots the workflow already on disk).
 * That silently swallowed the case the undo exists for — a human fixing a workflow they already had —
 * and left the button permanently unavailable there while offering it on builds they had just made.
 * Keying on `seedAppId` restores the gap to the shape its own comment claims. This does NOT change the
 * `差分` tab in either case: {@link resolveBase} still prefers `seedPath` when one exists, so the view
 * stays "compared with the seed"; the snapshot taken here only gives Undo something to restore.
 */
export async function snapshotDiffBase(
  projectsDir: string,
  task: Task,
  opts?: { restart?: boolean }
): Promise<void> {
  // Skip only when there is a Dify seed FILE to diff against — `seedAppId` alone is not enough: a
  // build whose pull failed has the id but no seed on disk, and `resolveBase` then falls through to
  // this snapshot. Requiring both keeps the exclusion exactly as wide as the view it protects.
  if (!task.project || !task.workflowSlug || (task.seedAppId && task.seedPath)) return;
  const snapRel = baseSnapshotRel(task.taskId);
  const snapAbs = join(projectsDir, snapRel);
  if (existsSync(snapAbs) && !opts?.restart) return;
  const srcAbs = join(projectsDir, newWorkflowRel(task));
  if (!existsSync(srcAbs)) return; // no pre-edit file → nothing to snapshot (new workflow)
  await mkdir(join(projectsDir, `apps/builder/.runs/${task.taskId}`), { recursive: true });
  await copyFile(srcAbs, snapAbs);
}

/** Spec 033 D3 layer 2 (FIX-M): the same `difflib.unified_diff` probe {@link produceDiff} uses, exposed
 *  as a standalone two-ABSOLUTE-path helper so `ask.ts`'s anomaly-report can reuse it over a held
 *  before-snapshot vs the current on-disk file, without inventing a second diff algorithm. */
export async function unifiedDiffOfFiles(
  projectsDir: string,
  basePathAbs: string,
  newPathAbs: string,
  fromLabel: string,
  toLabel: string
): Promise<string> {
  const r = await runPython(projectsDir, ['-c', DIFF_PROBE, basePathAbs, newPathAbs, fromLabel, toLabel]);
  return r.stdout;
}

/** Resolve the diff base path + a human label for the `from` side, per build kind. */
function resolveBase(projectsDir: string, task: Task): { basePath: string; fromLabel: string } {
  if (task.seedPath && existsSync(join(projectsDir, task.seedPath))) {
    return { basePath: task.seedPath, fromLabel: `seed/${task.seedPath}` };
  }
  const snapRel = baseSnapshotRel(task.taskId);
  if (existsSync(join(projectsDir, snapRel))) {
    return { basePath: snapRel, fromLabel: `before/${task.workflowFile}` };
  }
  // no-seed / new workflow → empty base ⇒ the whole main.yml is additions. The auto-selected pattern
  // is agent-internal (prose in SPEC.md, not a tracked field), so no pattern-delta is produced — spec
  // §A:218/§C/AC#4 were narrowed to match this (a true pattern-delta is a Phase-3+ enhancement).
  return { basePath: '', fromLabel: '(empty — new workflow)' };
}

/** Produce the `{path, diff}` payload (diff of the produced workflow vs its base). */
export async function produceDiff(projectsDir: string, task: Task): Promise<DiffPayload> {
  const newRel = newWorkflowRel(task);
  const { basePath, fromLabel } = resolveBase(projectsDir, task);
  const r = await runPython(projectsDir, [
    '-c',
    DIFF_PROBE,
    basePath ? join(projectsDir, basePath) : '',
    join(projectsDir, newRel),
    fromLabel,
    `new/${newRel}`,
  ]);
  // Spec 103 step 1 — the spec's own diff for the same round, from the same probe. Absent base ⇒
  // `undefined` (not `''`): "there was no previous spec" and "the spec did not change" are different
  // facts and the panel renders them differently.
  const specBaseAbs = join(projectsDir, specBaseRel(task.taskId));
  let specDiff: string | undefined;
  if (existsSync(specBaseAbs) && task.project && task.workflowSlug) {
    const sr = await runPython(projectsDir, [
      '-c',
      DIFF_PROBE,
      specBaseAbs,
      join(projectsDir, specRel(task)),
      'before/SPEC.md',
      'new/SPEC.md',
    ]);
    specDiff = sr.stdout;
  }
  return { path: newRel, diff: r.stdout, specDiff };
}

/** Compute + persist the diff to `.runs/<taskId>/diff.json` (read back by GET /api/tasks).
 *
 * L5b (019): the 017-D7 content-hash short-circuit (+ its sidecar hash file) was removed — it was a
 * premature optimization that saved one sub-100ms `difflib` spawn on a single-user box at the cost of an
 * extra artifact file + branchy hash bookkeeping. We now always recompute: slower by one fast spawn,
 * never stale. The `{path,diff}` wire shape is unchanged. */
export async function writeDiffArtifact(
  projectsDir: string,
  task: Task
): Promise<{ rel: string; specHunks: number | undefined }> {
  const rel = `apps/builder/.runs/${task.taskId}/diff.json`;
  const abs = join(projectsDir, rel);
  const payload = await produceDiff(projectsDir, task);
  await writeFile(abs, JSON.stringify(payload, null, 2));
  return { rel, specHunks: countHunks(payload.specDiff) };
}

/**
 * Spec 103 step 1 follow-up — how many separate PLACES a unified diff touches (`@@` headers).
 *
 * `undefined` in ⇒ `undefined` out: not measured stays not measured, the contract every 103 signal
 * keeps. Zero is a real answer (measured, nothing moved) and must not read as "we did not look".
 *
 * Why a count at all: every ③ gate card renders the same two lines, so a human scrolling back through
 * four fix rounds cannot tell them apart — the observed complaint. "The spec moved in 3 places" is the
 * cheapest true thing the card can add, and it is free: the diff was computed anyway.
 */
export function countHunks(diff: string | undefined): number | undefined {
  if (diff === undefined) return undefined;
  return diff.split('\n').filter((l) => l.startsWith('@@')).length;
}
