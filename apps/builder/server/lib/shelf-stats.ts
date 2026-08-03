/**
 * shelf-stats.ts — Spec 080 S2: the dev shelf-dashboard feed.
 *
 * One job: spawn `catalog.py stats --json` (the ONE place shelf numbers are composed — python owns
 * every parser, spec 080 §1) and pass its JSON through. Read-only end to end: the CLI writes
 * nothing, and this seam adds nothing. Mounted ONLY behind BUILDER_DEV=1 (routes/dev.ts).
 *
 * Failure shape mirrors POST /api/dev/rebuild: HTTP 200 + `{ok:false, reason, tail}` so the
 * dev-only FE reads the tail without ApiError plumbing. `runPython` is the 013-D2 seam
 * (tests inject a fake; the route passes the real one).
 */
import type { runPython as realRunPython } from './shell.js';

export interface ShelfStatsFailure {
  ok: false;
  reason: string;
  /** last chunk of stderr/stdout for the dev screen — enough to see the python error. */
  tail: string;
}

/** The success shape is `catalog.py stats --json` verbatim (its `ok` field included — the CLI
 *  itself answers ok:false for a missing index, which we pass through untouched). */
export async function fetchShelfStats(
  projectsDir: string,
  runPython: typeof realRunPython
): Promise<Record<string, unknown> | ShelfStatsFailure> {
  let res;
  try {
    res = await runPython(projectsDir, ['tools/dify_base/catalog.py', 'stats', '--json']);
  } catch (e) {
    return { ok: false, reason: 'failed to spawn catalog.py', tail: String(e).slice(-400) };
  }
  // Exit 1 with parseable JSON is the CLI's own ok:false (missing index) — parse before judging
  // the code, so the CLI's hint reaches the screen instead of a generic "exited 1".
  try {
    const parsed = JSON.parse(res.stdout) as Record<string, unknown>;
    if (typeof parsed === 'object' && parsed !== null) return parsed;
  } catch {
    /* fall through to the failure shape */
  }
  return {
    ok: false,
    reason: res.code === 0 ? 'catalog.py stats returned unparseable output' : `catalog.py stats exited ${res.code}`,
    tail: (res.stderr || res.stdout).slice(-400),
  };
}
