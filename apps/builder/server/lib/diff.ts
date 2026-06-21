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
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runPython } from './shell.js';
import type { Task } from '../state/task.js';

export interface DiffPayload {
  /** repo-relative path to the produced workflow (the "new" side). */
  path: string;
  /** unified-diff text (empty base ⇒ full file as additions). */
  diff: string;
}

/** Inline `difflib.unified_diff` over two files; a missing/empty base path reads as []. */
const DIFF_PROBE = `
import sys, difflib
def read(p):
    if not p:
        return []
    try:
        with open(p, encoding='utf-8') as f:
            return f.readlines()
    except OSError:
        return []
a = read(sys.argv[1]); b = read(sys.argv[2])
sys.stdout.write(''.join(difflib.unified_diff(a, b, fromfile=sys.argv[3], tofile=sys.argv[4])))
`;

/** The canonical pre-edit base snapshot path for a task (edit-existing only). */
function baseSnapshotRel(taskId: string): string {
  return `apps/builder/.runs/${taskId}/diff-base.yml`;
}

/** The produced workflow path (the "new" side of the diff). */
function newWorkflowRel(task: Task): string {
  return `projects/${task.slug}/workflows/${task.workflowFile}`;
}

/**
 * Snapshot the pre-edit workflow BEFORE the (first) Implement turn so an edit-existing diff has a
 * real base. No-op when: a Dify-seed task (the pulled `seedPath` IS the base), the snapshot already
 * exists (idempotent across /reply re-runs — capture the TRUE pre-edit state once), or the target
 * file doesn't exist yet (a no-seed new workflow → empty base → full additions).
 */
export async function snapshotDiffBase(projectsDir: string, task: Task): Promise<void> {
  if (!task.slug || task.seedPath) return;
  const snapRel = baseSnapshotRel(task.taskId);
  const snapAbs = join(projectsDir, snapRel);
  if (existsSync(snapAbs)) return;
  const srcAbs = join(projectsDir, newWorkflowRel(task));
  if (!existsSync(srcAbs)) return; // no pre-edit file → nothing to snapshot (new workflow)
  await mkdir(join(projectsDir, `apps/builder/.runs/${task.taskId}`), { recursive: true });
  await copyFile(srcAbs, snapAbs);
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
  return { path: newRel, diff: r.stdout };
}

/** Compute + persist the diff to `.runs/<taskId>/diff.json` (read back by GET /api/tasks).
 *
 * L5b (019): the 017-D7 content-hash short-circuit (+ its sidecar hash file) was removed — it was a
 * premature optimization that saved one sub-100ms `difflib` spawn on a single-user box at the cost of an
 * extra artifact file + branchy hash bookkeeping. We now always recompute: slower by one fast spawn,
 * never stale. The `{path,diff}` wire shape is unchanged. */
export async function writeDiffArtifact(projectsDir: string, task: Task): Promise<string> {
  const rel = `apps/builder/.runs/${task.taskId}/diff.json`;
  const abs = join(projectsDir, rel);
  const payload = await produceDiff(projectsDir, task);
  await writeFile(abs, JSON.stringify(payload, null, 2));
  return rel;
}
