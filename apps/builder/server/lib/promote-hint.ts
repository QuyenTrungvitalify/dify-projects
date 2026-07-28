/**
 * promote-hint.ts — Spec 078 S2: the self-harvest promote nudge.
 *
 * After a ④ report on a from-scratch, lint-clean build, ask the fingerprint catalog whether the
 * produced workflow proves a shape ABSENT from the curated shelf (`catalog.py check --shelf` —
 * a LIVE parse of templates/patterns/ + library/, never the collected.json seed: promoting a file
 * must self-quench the nudge on the very next check, and only parse-live guarantees that).
 *
 * The hint is a DEV-SURFACE field (`report.promote_hint` / `task.promoteHint`, rendered only under
 * `devMode`) and must NEVER be folded into the report `notes` string: notes are structurally
 * user-facing (Chat.tsx renders them; e2e_check.py's build_userview embeds them verbatim), and
 * "promote/pattern/shelf" is jargon to an end user (spec 063). e2e_check.py carries a
 * comprehension regression lock on the hint's stable phrase.
 *
 * Anti-noise guards (spec 078 S2 — a nudge that fires too often gets ignored forever):
 *   (a) from-scratch only — `workflow===null && seedPath===null` (PLUS seedAppId: a Dify-seed task
 *       whose pull failed has seedPath null but is still seeded). seedPath alone is NOT enough:
 *       an edit-local build also has seedPath null (it uses the diff snapshot instead), and nudging
 *       on an edited workflow — worst case one derived from an external base import — is exactly
 *       the false positive the v2.2 anchor fix exists to prevent. Callers also gate on lintClean.
 *   (b) node_count ≥ 4 — a trivial start→llm→end shape proves nothing (weak fingerprint signal).
 *   (c) verdict `new` ONLY — near-dup stays silent (better to miss than to nag).
 *   (d) one field per report = at most one nudge per task, by construction.
 * Advisory end to end: any catalog failure → null, never a report failure.
 */
import type { Task } from '../state/task.js';
import type { runPython as realRunPython } from './shell.js';

/** Wording-stable prefix — the e2e comprehension lock and the unit tests key off it. */
export const PROMOTE_HINT_PREFIX = 'Build này chứng minh một shape chưa có trên kệ mẫu';

export function promoteHintText(fingerprint: string): string {
  return (
    `${PROMOTE_HINT_PREFIX} (\`${fingerprint}\`). ` +
    'Promote nó thành pattern để các build sau tham khảo? (nút Promote)'
  );
}

/** The `catalog.py check --json` verdict shape (tools/dify_base/catalog.py). */
interface CatalogVerdict {
  verdict?: string;
  fingerprint?: string;
  node_count?: number;
}

/**
 * Returns the nudge text, or null when any guard says "stay silent". `runPython` is the 013-D2
 * seam (tests inject a fake; report.ts passes the real one).
 */
export async function computePromoteHint(
  projectsDir: string,
  task: Pick<Task, 'workflow' | 'seedPath' | 'seedAppId'>,
  wfRel: string,
  lintCleanNow: boolean,
  runPython: typeof realRunPython
): Promise<string | null> {
  if (!lintCleanNow) return null;
  // Guard (a) — the v2.2 anchor. Checked BEFORE spawning python: excluded builds cost nothing.
  if (task.workflow !== null || task.seedPath !== null || task.seedAppId !== null) return null;

  let res;
  try {
    res = await runPython(projectsDir, [
      'tools/dify_base/catalog.py', 'check', wfRel, '--shelf', '--json',
    ]);
  } catch {
    return null;
  }
  if (res.code !== 0) return null;
  let v: CatalogVerdict;
  try {
    v = JSON.parse(res.stdout) as CatalogVerdict;
  } catch {
    return null;
  }
  if (v?.verdict !== 'new') return null; // guard (c) — near-dup/dup stay silent
  if (typeof v.node_count !== 'number' || v.node_count < 4) return null; // guard (b)
  return promoteHintText(String(v.fingerprint ?? ''));
}
