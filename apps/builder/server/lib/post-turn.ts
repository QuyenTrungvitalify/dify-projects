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
 * Baseline-delta (vs. an absolute git-status check): this repo carries pre-existing uncommitted
 * work (other projects/, docs, .claude, …). We only ever evaluate/revert paths the *turn* newly
 * dirtied — paths already dirty at request start are never touched. The acceptance's
 * "clean of any write OUTSIDE {…}" is relative to that baseline.
 */
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { runPython, runGit } from './shell.js';
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

export interface PostTurnResult {
  ok: boolean;
  status: 'done' | 'error';
  reasons: string[];
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

  // 1: truncation — yaml.safe_load first; also extracts node ids in the same shot.
  let nodeIds: string[] | null = null;
  if (size > 0) {
    const probe = await runPython(p.projectsDir, ['-c', YAML_PROBE, rel]);
    if (probe.code !== 0) {
      reasons.push(`yaml parse failed (truncated/corrupt): ${(probe.stderr || probe.stdout).trim()}`);
    } else {
      try {
        const out = JSON.parse(probe.stdout) as { node_ids: unknown[] };
        nodeIds = (out.node_ids ?? []).map((x) => String(x));
      } catch {
        reasons.push(`yaml probe returned non-JSON: ${probe.stdout.slice(0, 200)}`);
      }
    }
  }

  // 2: the 3 linters, each must exit 0. Do NOT branch on a shared exit code — semantics differ
  //    per tool (findings/plan); each non-zero is its own reason.
  if (size > 0) {
    const linters: Array<{ name: string; args: string[] }> = [
      { name: 'validate_workflow.py', args: ['skills/mango-svip/scripts/validate_workflow.py', rel] },
      { name: 'lint_refs.py', args: ['tools/dify_base/lint_refs.py', rel] },
      { name: 'lint_plugin_hashes.py', args: ['tools/dify_base/lint_plugin_hashes.py', rel] },
    ];
    for (const lint of linters) {
      const r = await runPython(p.projectsDir, lint.args);
      if (r.code !== 0) {
        const detail = `${r.stdout}\n${r.stderr}`.trim().split('\n').slice(-6).join(' ⏎ ');
        reasons.push(`${lint.name} exit ${r.code}: ${detail}`);
      }
    }
  }

  // 3: 13-digit node-id regex (validators miss hand-written string IDs — AGENTS.md §4.1).
  if (nodeIds) {
    if (nodeIds.length === 0) {
      reasons.push('no node ids found in workflow.graph.nodes');
    }
    const bad = nodeIds.filter((id) => !/^\d{13}$/.test(id));
    if (bad.length) reasons.push(`non-13-digit node id(s): ${bad.slice(0, 10).join(', ')}`);
  }

  // ─── (b) CONFINEMENT (baseline-delta + whitelist + REVERT) ──────
  // Run unconditionally — a breach must be reverted even if (a) already failed.
  const after = await gitDirtyPaths(p.projectsDir);
  const turnTouched = [...after].filter((path) => !p.baseline.has(path));

  const isWhitelisted = (path: string): boolean =>
    path.startsWith(`projects/${p.slug}/`) ||
    path.startsWith(`apps/builder/.runs/${p.taskId}/`) ||
    path === '.vscode/settings.json' ||
    path === `projects/${p.slug}/.dify-workspace.yaml`;

  const breaches = turnTouched.filter((path) => !isWhitelisted(path));
  for (const breach of breaches) {
    await revertPath(p.projectsDir, breach, p.log);
    reasons.push(`confinement breach (reverted): ${breach}`);
  }

  const ok = reasons.length === 0;
  return { ok, status: ok ? 'done' : 'error', reasons };
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
function parsePorcelainPath(line: string): string | null {
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
