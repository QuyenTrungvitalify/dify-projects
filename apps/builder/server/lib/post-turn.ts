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
  slug: string;
  workflowFile: string;
  taskId: string;
  /** git-porcelain dirty paths captured BEFORE the turn (see gitDirtyPaths). */
  baseline: Set<string>;
  log: SessionLogger;
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
  /** every node id matched `^\d{13}$`. */
  idsOk: boolean;
  /** reverted out-of-confinement paths (non-empty = a security breach → always hard error). */
  confinementBreaches: string[];
}

export interface PostTurnResult {
  ok: boolean;
  status: 'done' | 'error';
  reasons: string[];
  detail: PostTurnDetail;
}

export interface ConfinementParams {
  projectsDir: string;
  /** active slug, or null pre-scaffold (①/②) — when null the `projects/<slug>/` rules can't match. */
  slug: string | null;
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
  const rel = `projects/${p.slug}/workflows/${p.workflowFile}`;
  const abs = join(p.projectsDir, rel);

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
    const bad = nodeIds.filter((id) => !/^\d{13}$/.test(id));
    if (bad.length) reasons.push(`non-13-digit node id(s): ${bad.slice(0, 10).join(', ')}`);
    idsOk = nodeIds.length > 0 && bad.length === 0;
  }

  // ─── (b) CONFINEMENT (baseline-delta + whitelist + REVERT) ──────
  // Run unconditionally — a breach must be reverted even if (a) already failed.
  const confinementBreaches = await confinementCheck(p);
  reasons.push(...confinementBreaches);

  const detail: PostTurnDetail = { artifactOk, yamlOk, lintCodes, idsOk, confinementBreaches };
  const ok = reasons.length === 0;
  return { ok, status: ok ? 'done' : 'error', reasons, detail };
}

/**
 * (b) standalone — baseline-delta git porcelain against the whitelist; REVERTS any
 * turn-introduced path outside it (findings E2d / plan Cross-cutting #3b). Returns one reason
 * per reverted breach (empty = confinement clean). Shared by the ③ post-turn check (above) and
 * the ①/② turn verify (orchestrator), which have no YAML artifact to lint.
 *
 * When `slug` is null (pre-scaffold ①/②), the `projects/<slug>/` rules can't match, so any write
 * under `projects/` is correctly treated as a breach (nothing should land there before scaffold).
 */
export async function confinementCheck(p: ConfinementParams): Promise<string[]> {
  const reasons: string[] = [];
  const after = await gitDirtyPaths(p.projectsDir);
  const turnTouched = [...after].filter((path) => !p.baseline.has(path));

  const isWhitelisted = (path: string): boolean =>
    (p.slug !== null && path.startsWith(`projects/${p.slug}/`)) ||
    path.startsWith(`apps/builder/.runs/${p.taskId}/`) ||
    // The skill bodies tell a turn (cwd = repo root) to write its task artifacts to the
    // shorthand `.runs/<taskId>/`; that resolves to repo-root `.runs/<taskId>/`. It is
    // task-scoped (not a broad escape), so it is whitelisted; the orchestrator relocates these
    // into the canonical `apps/builder/.runs/<taskId>/` (spec §A :517) right after the turn.
    path.startsWith(`.runs/${p.taskId}/`) ||
    path === '.vscode/settings.json' ||
    (p.slug !== null && path === `projects/${p.slug}/.dify-workspace.yaml`);

  const breaches = turnTouched.filter((path) => !isWhitelisted(path));
  for (const breach of breaches) {
    await revertPath(p.projectsDir, breach, p.log);
    reasons.push(`confinement breach (reverted): ${breach}`);
  }
  return reasons;
}

/** Parse `git status --porcelain` into a set of dirty repo-relative paths. */
export async function gitDirtyPaths(projectsDir: string): Promise<Set<string>> {
  const r = await runGit(projectsDir, ['status', '--porcelain']);
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
