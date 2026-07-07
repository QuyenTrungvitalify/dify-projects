/**
 * post-turn — the load-bearing verify for spec 009 Lát 1.
 *
 * Runs BOTH checks; NEVER trusts the turn's `result.is_error` alone (findings §4):
 *   (a) CORRECTNESS — yaml.safe_load (truncation) → 3 linters exit 0 → ^\d{13}$ node-id regex
 *                     → artifact non-empty.
 *   (b) CONFINEMENT — git porcelain BASELINE-DELTA against a whitelist; any turn-introduced path
 *                     outside the whitelist is REVERTED (not just flagged — findings E2d / plan
 *                     Cross-cutting #3b), then status:error.
 *
 * Spec 015 D2 — this confinement scan is now a BACKSTOP, not the primary defense. The PreToolUse
 * permission hook (apps/builder/server/hooks/permission-gate.ts) DENIES a bad write BEFORE it happens
 * (protected roots: .venv/, apps/builder/.env, .claude/, tools/, skills/, sibling .runs/<other>/), so
 * the chain is closed pre-execution rather than reverted-if-seen. This git-porcelain pass still runs to
 * catch anything the hook abstained on (e.g. a tracked-file modification outside the whitelist). Note it
 * remains blind to `.gitignore`'d in-dir writes (a `.venv/bin/*` write shows only as a collapsed `!! .venv/`
 * even under `--ignored`), which is EXACTLY why the hook — not this scan — is the load-bearing fix for S1.
 *
 * Baseline-delta (vs. an absolute git-status check): this repo carries pre-existing uncommitted
 * work (other projects/, docs, .claude, …). We only ever evaluate/revert paths the *turn* newly
 * dirtied — paths already dirty at request start are never touched. The acceptance's
 * "clean of any write OUTSIDE {…}" is relative to that baseline.
 */
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { runPython, runGit } from './shell.js';
import { LINTERS, LINT_DETAIL_LINES, type LintCodes } from './linters.js';
import type { SessionLogger } from './claude-session.js';

export interface PostTurnParams {
  projectsDir: string;
  /** spec 030: the resolved project + workflow subfolder — the build lives at
   *  `projects/<project>/<workflowSlug>/`. Non-null at Implement (③), where this runs. */
  project: string;
  workflowSlug: string;
  workflowFile: string;
  taskId: string;
  /** git-porcelain dirty paths captured BEFORE the turn (see gitDirtyPaths). */
  baseline: Set<string>;
  log: SessionLogger;
}

/** Spec 039 D5 — the per-file verdict for every OTHER turn-touched `workflows/*.ya?ml` (the
 *  declared artifact keeps the top-level fields). `twin` = an extension twin of the declared file
 *  (D4 — hard error even when lint-clean). */
export interface ExtraFileCheck {
  path: string;
  yamlOk: boolean;
  lintCodes: LintCodes | null;
  idsOk: boolean;
  twin: boolean;
}

/** Structured breakdown of the ③ correctness + confinement check — lets Lát 3 pick the Implement
 *  gate variant (clean vs still-failing vs hard-error) instead of collapsing to one boolean. */
export interface PostTurnDetail {
  /** artifact exists + non-empty. */
  artifactOk: boolean;
  /** `yaml.safe_load` succeeded (false = truncated/corrupt → hard error, not a lint failure). */
  yamlOk: boolean;
  /** the 3 linter exit codes (null when the artifact was missing/empty so they never ran). */
  lintCodes: LintCodes | null;
  /** every node id matched `^\d{13}(start)?$` (13-digit, or an iteration/loop-start child `<id>start`). */
  idsOk: boolean;
  /** reverted out-of-confinement paths (non-empty = a security breach → always hard error). */
  confinementBreaches: string[];
  /** spec 039 — per-file gate results for every other turn-touched `workflows/*.ya?ml`
   *  (`[]` = the turn touched only its declared file, the universal case pre-039). */
  extraFiles: ExtraFileCheck[];
}

export interface PostTurnResult {
  ok: boolean;
  status: 'done' | 'error';
  reasons: string[];
  detail: PostTurnDetail;
}

export interface ConfinementParams {
  projectsDir: string;
  /** spec 030: the resolved project + workflow subfolder, or null pre-scaffold (①/②) — when either is
   *  null the `projects/<project>/<workflowSlug>/` rule can't match, so ANY `projects/` write is a breach. */
  project: string | null;
  workflowSlug: string | null;
  taskId: string;
  baseline: Set<string>;
  log: SessionLogger;
}

// Inline python: yaml.safe_load the workflow (truncation guard) and emit its node ids as JSON.
const YAML_PROBE = `
import sys, json, yaml
try:
    with open(sys.argv[1]) as f:
        data = yaml.safe_load(f)
except Exception as e:
    sys.stderr.write('parse error: %s' % e); sys.exit(1)
if not isinstance(data, dict):
    sys.stderr.write('top level is not a mapping'); sys.exit(1)
nodes = (((data.get('workflow') or {}).get('graph') or {}).get('nodes')) or []
ids = [n.get('id') for n in nodes if isinstance(n, dict) and 'id' in n]
print(json.dumps({'node_ids': ids}))
`;

export async function postTurnCheck(p: PostTurnParams): Promise<PostTurnResult> {
  const reasons: string[] = [];
  const rel = `projects/${p.project}/${p.workflowSlug}/workflows/${p.workflowFile}`;
  const abs = join(p.projectsDir, rel);

  // ─── (b) CONFINEMENT first (spec 039 D1) ───────────────────────
  // Revert breaches BEFORE enumerating the correctness set, so the extras lint list can never
  // include a path that is about to be reverted, and ONE git-status snapshot serves both checks.
  // Breach REASONS still surface LAST (assembly order below ≠ execution order — pinned by
  // linters.test.ts D5 order tests + confinement.test.ts).
  const { breaches: confinementBreaches, touched } = await confinementCheck(p);

  // ─── (a) CORRECTNESS ───────────────────────────────────────────

  // 4 (eager): artifact exists + non-empty.
  let size = -1;
  try {
    size = (await stat(abs)).size;
  } catch {
    reasons.push(`artifact missing: ${rel}`);
  }
  if (size === 0) reasons.push(`artifact empty: ${rel}`);
  const artifactOk = size > 0;

  // 1: truncation — yaml.safe_load first; also extracts node ids in the same shot.
  let nodeIds: string[] | null = null;
  let yamlOk = false;
  if (size > 0) {
    const probe = await runPython(p.projectsDir, ['-c', YAML_PROBE, rel]);
    if (probe.code !== 0) {
      reasons.push(`yaml parse failed (truncated/corrupt): ${(probe.stderr || probe.stdout).trim()}`);
    } else {
      try {
        const out = JSON.parse(probe.stdout) as { node_ids: unknown[] };
        nodeIds = (out.node_ids ?? []).map((x) => String(x));
        yamlOk = true;
      } catch {
        reasons.push(`yaml probe returned non-JSON: ${probe.stdout.slice(0, 200)}`);
      }
    }
  }

  // 2: the 3 linters, each must exit 0. Do NOT branch on a shared exit code — semantics differ
  //    per tool (findings/plan); each non-zero is its own reason. Capture each exit code so Lát 3
  //    can tell a "clean" Implement (all 0) from a "still-failing" one (lint≠0) — §D variants.
  let lintCodes: LintCodes | null = null;
  if (size > 0) {
    lintCodes = { validate: 0, lint_refs: 0, lint_plugin_hashes: 0 };
    // D5 (spec 017): run the 3 linters CONCURRENTLY — independent read-only python spawns (NOT gated
    // by the 015 turn hook), so ~3 cold spawns collapse to ~1 spawn's wall-clock. Behavior-equivalent:
    // fold the results in LINTERS order afterwards, so the keyed codes AND the reason ORDER are
    // byte-identical to the former sequential loop (pinned by linters.test.ts; AC #20 unbroken).
    const results = await Promise.all(LINTERS.map((lint) => runPython(p.projectsDir, [lint.script, rel])));
    LINTERS.forEach((lint, i) => {
      const r = results[i];
      lintCodes![lint.key] = r.code;
      if (r.code !== 0) {
        const detail = `${r.stdout}\n${r.stderr}`.trim().split('\n').slice(-LINT_DETAIL_LINES).join(' ⏎ ');
        reasons.push(`${lint.name} exit ${r.code}: ${detail}`);
      }
    });
  }

  // 3: 13-digit node-id regex (validators miss hand-written string IDs — AGENTS.md §4.1).
  let idsOk = false;
  if (nodeIds) {
    if (nodeIds.length === 0) {
      reasons.push('no node ids found in workflow.graph.nodes');
    }
    // Iteration/loop-start child nodes are legitimately `<13-digit-id>start` (AGENTS.md §4.1) — accept
    // that suffix, matching validate_workflow.py's NODE_ID_RE. Hand-written string ids (e.g. node-code-1)
    // still fail. Without this, every iteration-based workflow false-parks at the still_failing gate.
    const bad = nodeIds.filter((id) => !/^\d{13}(start)?$/.test(id));
    if (bad.length) reasons.push(`non-13-digit node id(s): ${bad.slice(0, 10).join(', ')}`);
    idsOk = nodeIds.length > 0 && bad.length === 0;
  }

  // ─── (a′) CORRECTNESS on every OTHER turn-touched workflows/*.ya?ml (spec 039 D2–D4) ───
  // Enumerated from the confinement delta (never a readdir glob — baseline-dirty files are not
  // ours to judge). Scope mirrors the pre-commit DSL hooks: only `workflows/*.ya?ml`; subtree
  // fixtures (tests/, inputs/, prompts/) stay confinement-only (D2). Each extra gets EXACTLY the
  // declared file's treatment (D3), one spawn per (linter, file) — validate_workflow.py reads
  // argv[1] only and silently ignores extras, so batching argv would skip files.
  const wfDirPrefix = `projects/${p.project}/${p.workflowSlug}/workflows/`;
  const extras = touched
    .filter((path) => path.startsWith(wfDirPrefix) && /\.ya?ml$/.test(path) && path !== rel)
    .sort();
  const extraFiles: ExtraFileCheck[] = [];
  const twinReasons: string[] = [];
  const relDir = rel.slice(0, rel.lastIndexOf('/'));
  const stem = (name: string): string => name.replace(/\.ya?ml$/, '');
  for (const path of extras) {
    const r = await checkExtraWorkflowFile(p.projectsDir, path);
    // D4: a twin sits DIRECTLY in workflows/ (nested same-stem files are plain extras) with the
    // declared file's stem under the other `.ya?ml` extension — both directions, never hardcoding
    // `main.yml`. Two canonical-looking artifacts = correctness ambiguity → hard error even when
    // lint-clean (the twin is still fully linted above for diagnostic value).
    const base = path.slice(path.lastIndexOf('/') + 1);
    const twin =
      path.slice(0, path.lastIndexOf('/')) === relDir &&
      stem(base) === stem(p.workflowFile) &&
      base !== p.workflowFile;
    if (twin) twinReasons.push(`extension twin of ${p.workflowFile}: ${path}`);
    extraFiles.push({ path, yamlOk: r.yamlOk, lintCodes: r.lintCodes, idsOk: r.idsOk, twin });
    reasons.push(...r.reasons);
  }
  reasons.push(...twinReasons);

  // Confinement breach reasons LAST — as before 039 (assembly order is byte-compatible).
  reasons.push(...confinementBreaches);

  const detail: PostTurnDetail = { artifactOk, yamlOk, lintCodes, idsOk, confinementBreaches, extraFiles };
  const ok = reasons.length === 0;
  return { ok, status: ok ? 'done' : 'error', reasons, detail };
}

/**
 * Spec 039 D3 — one extra turn-touched `workflows/*.ya?ml`, given the declared file's EXACT
 * contract: stat first (missing/empty — e.g. a turn-DELETED tracked file — is its own reason with
 * `lintCodes: null`); when size > 0 the YAML probe AND the 3 linters ALL run (linters gate on
 * size, not on the probe result, mirroring the declared path); then the idsOk regex. Reasons are
 * path-prefixed so a multi-file failure reads unambiguously at the gate.
 */
async function checkExtraWorkflowFile(
  projectsDir: string,
  rel: string
): Promise<{ yamlOk: boolean; lintCodes: LintCodes | null; idsOk: boolean; reasons: string[] }> {
  const reasons: string[] = [];
  let size = -1;
  try {
    size = (await stat(join(projectsDir, rel))).size;
  } catch {
    reasons.push(`extra workflow file missing (turn-touched then deleted): ${rel}`);
  }
  if (size === 0) reasons.push(`extra workflow file empty: ${rel}`);

  let yamlOk = false;
  let nodeIds: string[] | null = null;
  let lintCodes: LintCodes | null = null;
  if (size > 0) {
    const probe = await runPython(projectsDir, ['-c', YAML_PROBE, rel]);
    if (probe.code !== 0) {
      reasons.push(`${rel}: yaml parse failed (truncated/corrupt): ${(probe.stderr || probe.stdout).trim()}`);
    } else {
      try {
        const out = JSON.parse(probe.stdout) as { node_ids: unknown[] };
        nodeIds = (out.node_ids ?? []).map((x) => String(x));
        yamlOk = true;
      } catch {
        reasons.push(`${rel}: yaml probe returned non-JSON: ${probe.stdout.slice(0, 200)}`);
      }
    }
    lintCodes = { validate: 0, lint_refs: 0, lint_plugin_hashes: 0 };
    const results = await Promise.all(LINTERS.map((lint) => runPython(projectsDir, [lint.script, rel])));
    LINTERS.forEach((lint, i) => {
      const r = results[i];
      lintCodes![lint.key] = r.code;
      if (r.code !== 0) {
        const detail = `${r.stdout}\n${r.stderr}`.trim().split('\n').slice(-LINT_DETAIL_LINES).join(' ⏎ ');
        reasons.push(`${rel}: ${lint.name} exit ${r.code}: ${detail}`);
      }
    });
  }

  let idsOk = false;
  if (nodeIds) {
    if (nodeIds.length === 0) reasons.push(`${rel}: no node ids found in workflow.graph.nodes`);
    const bad = nodeIds.filter((id) => !/^\d{13}(start)?$/.test(id));
    if (bad.length) reasons.push(`${rel}: non-13-digit node id(s): ${bad.slice(0, 10).join(', ')}`);
    idsOk = nodeIds.length > 0 && bad.length === 0;
  }
  return { yamlOk, lintCodes, idsOk, reasons };
}

/** Spec 039 D1 — `confinementCheck`'s return. `breaches` = the FORMATTED reason strings exactly
 *  as returned pre-039 (`confinement breach (reverted): <path>`); `touched` = the RAW repo-relative
 *  in-whitelist survivors of the turn delta (breaches excluded — they were just reverted). The
 *  asymmetry is deliberate: confinement.test.ts assertions and the orchestrator ①/② spread stay
 *  byte-unchanged, while the ③ extras pass gets clean paths to enumerate from. */
export interface ConfinementResult {
  breaches: string[];
  touched: string[];
}

/**
 * (b) standalone — baseline-delta git porcelain against the whitelist; REVERTS any
 * turn-introduced path outside it (findings E2d / plan Cross-cutting #3b). Returns one reason
 * per reverted breach (empty = confinement clean) plus the in-whitelist touched paths (039 D1).
 * Shared by the ③ post-turn check (above) and the ①/② turn verify (orchestrator), which have
 * no YAML artifact to lint.
 *
 * When `project`/`workflowSlug` are null (pre-scaffold ①/②), the `projects/<project>/<workflowSlug>/`
 * rule can't match, so any write under `projects/` is correctly treated as a breach (nothing should
 * land there before scaffold).
 *
 * Spec 030: confinement is now to the WORKFLOW subtree — a turn for workflow X CANNOT resolve into a
 * sibling workflow Y or a sibling project by construction. The trailing `/` anchors the prefix
 * (`"projects/a/sum_2/x".startsWith("projects/a/sum/")` is false), so sibling workflows in disjoint
 * subtrees are structurally rejected. The old per-project `.dify-workspace.yaml` special-case is DROPPED
 * (D1): the manifest lives at the PROJECT level and a workflow build turn has no business writing it.
 */
export async function confinementCheck(p: ConfinementParams): Promise<ConfinementResult> {
  const reasons: string[] = [];
  const after = await gitDirtyPaths(p.projectsDir);
  const turnTouched = [...after].filter((path) => !p.baseline.has(path));

  const confined = p.project !== null && p.workflowSlug !== null;
  const isWhitelisted = (path: string): boolean =>
    (confined && path.startsWith(`projects/${p.project}/${p.workflowSlug}/`)) ||
    path.startsWith(`apps/builder/.runs/${p.taskId}/`) ||
    // The skill bodies tell a turn (cwd = repo root) to write its task artifacts to the
    // shorthand `.runs/<taskId>/`; that resolves to repo-root `.runs/<taskId>/`. It is
    // task-scoped (not a broad escape), so it is whitelisted; the orchestrator relocates these
    // into the canonical `apps/builder/.runs/<taskId>/` (spec §A :517) right after the turn.
    path.startsWith(`.runs/${p.taskId}/`) ||
    path === '.vscode/settings.json';

  // Spec 040 D1 — revert ONLY the class the PreToolUse hook defers here. The hook (spec 015/018) denies
  // every out-of-scope write pre-execution EXCEPT its one deliberate breadth: it blanket-allows all of
  // `projects/` (permission-gate.ts:247) and defers cross-project / cross-workflow policing to this pass.
  // So a turn-touched path OUTSIDE `projects/` (root files, docs/, templates/, tools/, skills/, apps/, or
  // a SIBLING `.runs/<other>/` — own `.runs/` is whitelisted above, a sibling is hook-denied) can NOT be
  // this turn's doing: it is a CONCURRENT external edit. Reverting it (git checkout/clean) would destroy
  // unrelated work AND fail an innocent build (the UAT J5 blocker). Ignore it (log for observability).
  const inWriteZone = (path: string): boolean => path.startsWith('projects/');
  const nonWhitelisted = turnTouched.filter((path) => !isWhitelisted(path));
  for (const path of nonWhitelisted) {
    if (!inWriteZone(path)) {
      p.log.warn({ path }, 'out-of-scope dirty path ignored (not turn-reachable — likely concurrent external edit)');
    }
  }
  const breaches = nonWhitelisted.filter(inWriteZone);
  for (const breach of breaches) {
    await revertPath(p.projectsDir, breach, p.log);
    reasons.push(`confinement breach (reverted): ${breach}`);
  }
  return { breaches: reasons, touched: turnTouched.filter(isWhitelisted) };
}

/** Parse `git status --porcelain` into a set of dirty repo-relative paths.
 *  `-uall` (spec 039): default porcelain collapses a NEW untracked directory to one `dir/` entry,
 *  which would hide a nested `workflows/sub/x.yaml` from the extras filter (and coarsen breach
 *  reverts). Listing individual files changes nothing about the baseline-delta: baseline and
 *  after are captured by this same function, so both sides collapse — or don't — identically. */
export async function gitDirtyPaths(projectsDir: string): Promise<Set<string>> {
  const r = await runGit(projectsDir, ['status', '--porcelain', '-uall']);
  const set = new Set<string>();
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue;
    const path = parsePorcelainPath(line);
    if (path) set.add(path);
  }
  return set;
}

/**
 * Extract the repo-relative path from one porcelain v1 line.
 *   "XY <path>"  |  "R  <orig> -> <new>"  (renames → the new path)
 * Paths with special chars are git-quoted; strip the surrounding quotes.
 */
export function parsePorcelainPath(line: string): string | null {
  if (line.length < 4) return null;
  let rest = line.slice(3);
  const arrow = rest.indexOf(' -> ');
  if (arrow !== -1) rest = rest.slice(arrow + 4);
  if (rest.startsWith('"') && rest.endsWith('"')) rest = rest.slice(1, -1);
  return rest;
}

/**
 * Revert ONE turn-introduced out-of-confinement path. Scoped to the single path so it can never
 * touch baseline-dirty work. `checkout` restores a tracked-modified file (no-op/err for untracked);
 * `clean -fd` removes an untracked file/dir. Running both covers either case.
 */
async function revertPath(projectsDir: string, path: string, log: SessionLogger): Promise<void> {
  log.warn({ path }, 'confinement breach — reverting');
  await runGit(projectsDir, ['checkout', '--', path]);
  await runGit(projectsDir, ['clean', '-fd', '--', path]);
}
