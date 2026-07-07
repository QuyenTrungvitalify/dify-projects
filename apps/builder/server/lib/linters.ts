/**
 * linters.ts — the SINGLE source of truth for the 3-linter contract (spec 013 D1, fixes C1).
 *
 * The builder's "did this workflow pass?" verdict runs the SAME three linters in three places —
 * the Phase ③ post-turn gate (post-turn.ts), the Phase ④ report re-run (report.ts), and the
 * Implement success/still-failing resolve (orchestrator verifyPhase). Before 013 the list and the
 * "all three clean" test were hand-copied in each, and had already drifted (a -6 vs -4 detail
 * slice). This module owns the list, the clean-test, and the detail-slice depth so the ③ gate and
 * the ④ report PROVABLY run the identical set and the identical verdict — a linter added/renamed/
 * repathed here changes all consumers at once.
 *
 * Behavior-preserving: the paths, keys, order, and `lintClean` semantics are exactly what the
 * hand-copies computed. The ONE intentional unification is {@link LINT_DETAIL_LINES} (was -6 in
 * post-turn, -4 in report → 6 everywhere; spec 013 Q2).
 */

/** One linter: a human `name` for the ③ failure reason, a stable `key` for the codes record + the
 *  ④ note, and the repo-relative `script` path passed to `.venv/bin/python`. */
export interface LinterDef {
  name: string;
  key: 'validate' | 'lint_refs' | 'lint_plugin_hashes' | 'lint_node_bodies';
  script: string;
}

/** The 4 linters, in run order. The ONLY place this list is written. (4th entry = spec 038 P3
 *  promotion, after the measured-0-FP report 038-fp-report.md — the first widening of this
 *  contract since 013; the ③ gate and ④ report pick it up with zero further edits.) */
export const LINTERS: LinterDef[] = [
  { name: 'validate_workflow.py', key: 'validate', script: 'tools/dify_base/validate_workflow.py' },
  { name: 'lint_refs.py', key: 'lint_refs', script: 'tools/dify_base/lint_refs.py' },
  { name: 'lint_plugin_hashes.py', key: 'lint_plugin_hashes', script: 'tools/dify_base/lint_plugin_hashes.py' },
  { name: 'lint_node_bodies.py', key: 'lint_node_bodies', script: 'tools/dify_base/lint_node_bodies.py' },
];

/** The per-linter exit codes (0 = clean). Keyed by {@link LinterDef.key}. */
export type LintCodes = Record<LinterDef['key'], number>;

/** All four linters exited 0. `null`/`undefined` (the linters never ran — missing/empty artifact)
 *  is NOT clean. The single definition the ③ gate AND the ④ Import-precondition both consume. */
export const lintClean = (c: LintCodes | null | undefined): boolean =>
  c != null && c.validate === 0 && c.lint_refs === 0 && c.lint_plugin_hashes === 0 && c.lint_node_bodies === 0;

/** Unified failure-detail slice depth: keep the last N lines of a failing linter's stdout+stderr in
 *  the surfaced reason/note (was -6 in post-turn, -4 in report — unified to 6; spec 013 Q2). */
export const LINT_DETAIL_LINES = 6;
