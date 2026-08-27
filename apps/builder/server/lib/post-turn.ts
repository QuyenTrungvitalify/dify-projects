/**
 * post-turn — the load-bearing verify for spec 009 Lát 1.
 *
 * Runs BOTH checks; NEVER trusts the turn's `result.is_error` alone (findings §4):
 *   (a) CORRECTNESS — yaml.safe_load (truncation) → every LINTERS entry exits 0 (linters.ts owns
 *                     the set — don't count it here) → ^\d{13}$ node-id regex → artifact non-empty.
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
import { stat, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
  /**
   * Spec 094 S1 — {@link artifactHash} of the declared artifact captured BEFORE the turn spawned,
   * `null` when the file did not exist yet. Compared against the post-turn hash to answer the one
   * question a fix round could not answer: *did this turn change the file at all?*
   *
   * OMITTED (`undefined`) ⇒ "not measured", and {@link PostTurnDetail.artifactChanged} stays
   * `undefined` rather than guessing. The whole point of the flag is a badge telling the user a round
   * was empty; inferring that from a missing measurement would put a false "nothing changed" in front
   * of a round that DID change something — the one failure direction that costs more than no badge.
   */
  artifactHashBefore?: string | null;
  /**
   * Spec 103 L0 — {@link artifactHash} of `SPEC.md` captured at the SAME moment as
   * {@link artifactHashBefore}, `null` when the file did not exist yet.
   *
   * Same "not measured" contract: OMITTED (`undefined`) ⇒ {@link PostTurnDetail.specChanged} stays
   * `undefined`. The orchestrator supplies it ONLY on a revision round (a ③ turn carrying a change
   * request) — on a FIRST implement ② has just written SPEC.md, so the spec matches the workflow by
   * construction and measuring there would flag every new build as stale.
   */
  specHashBefore?: string | null;
  log: SessionLogger;
}

/**
 * Spec 103 L0 — the tripwire's whole logic, as a pure function so it can be pinned by a test instead
 * of only by an end-to-end run.
 *
 * TRUE means: this round moved the workflow and left the document that is supposed to describe it
 * behind. Both inputs must be measured — `undefined` on either side yields `undefined` ("we did not
 * look"), never `false`. Reading a missing measurement as "fine" is the one failure direction that
 * costs more than no signal at all, because it puts a silent all-clear in front of real drift.
 */
export function isSpecStale(
  artifactChanged: boolean | undefined,
  specChanged: boolean | undefined
): boolean | undefined {
  if (artifactChanged === undefined || specChanged === undefined) return undefined;
  return artifactChanged && !specChanged;
}

/** Spec 103 L0 — the repo-relative `SPEC.md` of a scaffolded build. ONE resolver, exported so the
 *  orchestrator's before-hash and this module's after-hash can never disagree about which file they
 *  measured (the spec 090 S4 lesson: hand the value, don't restate the condition). */
export function specRelFor(project: string, workflowSlug: string): string {
  return `projects/${project}/${workflowSlug}/SPEC.md`;
}

/**
 * Spec 094 S1 — sha256 of one repo-relative file, or `null` when it does not exist / cannot be read.
 *
 * Content, deliberately — NOT git, and NOT `diff.json`:
 *
 *  - **git is a poor witness for this file.** A from-scratch build defaults to `projects/_drafts/`
 *    (`DRAFTS_PROJECT`). That folder was gitignored WHOLESALE until spec 112 un-ignored it, so the
 *    confinement check could police cross-workflow writes there — but un-ignoring only makes git
 *    LOOK. Nothing under `projects/` is committed, so there is still no blob to compare against.
 *    Measured on run 1786089321835 (which built into `projects/_drafts/…`): a git-derived flag read
 *    "unchanged" for all six attempts, including the one that wrote the file.
 *  - **even where git DOES see it**, a `/reply` turn's artifact is already dirty from the previous
 *    turn, so it sits in `baseline` and drops out of `turnTouched` — the flag would read "unchanged"
 *    for a round that really did fix something. The Builder never commits between turns.
 *  - **`diff.json` is not available when this is decided.** It is produced AFTER the verify, in the
 *    same block that consumes this flag (orchestrator: `writeDiffArtifact` runs on the verify result),
 *    so reading it here is a chicken-and-egg — and it costs a python spawn the hash does not.
 *    (Spec 103 L0 re-arms the diff base on a revision round, so an empty round's diff.json is now
 *    empty too — a true signal, just one that arrives a step too late and a spawn too dear.)
 *
 * A hash also gets the honest answer when a turn rewrites the file byte-identically: nothing changed,
 * which is exactly what the user is being told.
 */
export async function artifactHash(projectsDir: string, rel: string): Promise<string | null> {
  try {
    return createHash('sha256').update(await readFile(join(projectsDir, rel))).digest('hex');
  } catch {
    return null; // missing (pre-first-write) or unreadable — both mean "no content to compare"
  }
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
  /** the linter exit codes — one per linters.ts LINTERS entry (null when the artifact was
   *  missing/empty so they never ran). */
  lintCodes: LintCodes | null;
  /** every node id matched `^\d{13}(start)?$` (13-digit, or an iteration/loop-start child `<id>start`). */
  idsOk: boolean;
  /** reverted out-of-confinement paths (non-empty = a security breach → always hard error). */
  confinementBreaches: string[];
  /** spec 039 — per-file gate results for every other turn-touched `workflows/*.ya?ml`
   *  (`[]` = the turn touched only its declared file, the universal case pre-039). */
  extraFiles: ExtraFileCheck[];
  /**
   * Spec 094 S1 — did THIS turn change the declared artifact's bytes? `undefined` = not measured
   * (no {@link PostTurnParams.artifactHashBefore} was supplied), which every consumer must treat as
   * "don't claim anything", never as `true` or `false`.
   *
   * Advisory only: it never feeds {@link resolveImplementOutcome}. A round that changed nothing is a
   * perfectly legal outcome (the right answer is sometimes "the fix is on your side") — it just has
   * to be SAID, because the gate rendered it identically to a round that fixed two bugs, and a user
   * re-imported the same file believing it was new (run 1786089321835, rounds R3 and R5).
   */
  artifactChanged?: boolean;
  /**
   * Spec 103 L0 — did THIS turn change `SPEC.md`'s bytes? Same three-state contract as
   * {@link artifactChanged}: `undefined` = not measured (no {@link PostTurnParams.specHashBefore}),
   * which every consumer must treat as "don't claim anything".
   *
   * Advisory, exactly like its sibling — it never feeds {@link resolveImplementOutcome}. Paired with
   * `artifactChanged` it answers the one question the fix loop could never answer: the workflow moved,
   * did the document that is supposed to describe it move too? (Spec 103 §1.2: `main.yml` is supposed
   * to be a function of `SPEC.md`, and a free-text fix round used to break that silently.)
   */
  specChanged?: boolean;
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
    lintCodes = { validate: 0, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 0 };
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

  // Spec 094 S1 — the after-hash, compared with the before-hash the orchestrator captured pre-spawn.
  // Only measured when a before-hash was supplied (see PostTurnParams.artifactHashBefore).
  const artifactChanged =
    p.artifactHashBefore === undefined
      ? undefined
      : (await artifactHash(p.projectsDir, rel)) !== p.artifactHashBefore;

  // Spec 103 L0 — the same measurement for SPEC.md, gated on its own before-hash so "not measured"
  // stays distinguishable from "measured, unchanged". Content-hash and NOT git, for the reason spelled
  // out on `artifactHash` above: nothing under `projects/` is committed — spec 112 un-ignored
  // `_drafts`, which lets git SEE the folder but gives it no history — so a git-derived flag would
  // read "unchanged" for a file the turn really did rewrite.
  const specChanged =
    p.specHashBefore === undefined
      ? undefined
      : (await artifactHash(p.projectsDir, specRelFor(p.project, p.workflowSlug))) !== p.specHashBefore;

  const detail: PostTurnDetail = {
    artifactOk,
    yamlOk,
    lintCodes,
    idsOk,
    confinementBreaches,
    extraFiles,
    artifactChanged,
    specChanged,
  };
  const ok = reasons.length === 0;
  return { ok, status: ok ? 'done' : 'error', reasons, detail };
}

/**
 * Spec 039 D3 — one extra turn-touched `workflows/*.ya?ml`, given the declared file's EXACT
 * contract: stat first (missing/empty — e.g. a turn-DELETED tracked file — is its own reason with
 * `lintCodes: null`); when size > 0 the YAML probe AND the 3 linters ALL run (linters gate on
 * size, not on the probe result, mirroring the declared path); then the idsOk regex. Reasons are
 * path-prefixed so a multi-file failure reads unambiguously at the gate.
 *
 * Exported since spec 108 S5: the orchestrator's advisory pass grades fs-detected workflow edits
 * (stray writes + ①/② own-folder edits) with THIS function, so "graded" means the same four linters
 * whichever seam found the file. `rp` exists for that caller alone — it must run under the test
 * runners' fake python (resolveRunners), where this module's own shell import cannot be injected.
 * postTurnCheck keeps the default.
 */
export async function checkExtraWorkflowFile(
  projectsDir: string,
  rel: string,
  rp: typeof runPython = runPython
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
    const probe = await rp(projectsDir, ['-c', YAML_PROBE, rel]);
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
    lintCodes = { validate: 0, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 0 };
    const results = await Promise.all(LINTERS.map((lint) => rp(projectsDir, [lint.script, rel])));
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

/** Junk that changes under `projects/` without anyone writing code: macOS finder droppings, VCS/tooling
 *  dirs. Excluded by NAME at every depth — a stray report naming `.DS_Store` teaches people to ignore it. */
const STRAY_SKIP = new Set(['.git', 'node_modules', '.venv', '.pytest_cache', '.DS_Store']);
/** A walk that can never become a hang: `projects/` is ~30 folders × a handful of files, and a runaway
 *  (a turn that unpacked something huge) must degrade to a truncated report, not to a stalled gate. */
const STRAY_MAX_FILES = 4000;

/**
 * Spec 111 — files under `projects/` that changed during THIS turn, outside the build's own folder.
 *
 * WHY STILL, NOW THAT git CAN SEE `_drafts`. This scan was born because `.gitignore` held
 * `projects/_drafts/` WHOLESALE — the folder where 33 of the 35 real runs on the author's machine
 * live — so `confinementCheck`'s git delta was EMPTY for almost every build and every cross-workflow
 * write landed in a blind spot. Two measured incidents rode it out undetected: run 1787273481220
 * spent $19.25 editing another project's folder while its own artifact never moved (the gate said
 * `success`), and its earlier ③ wrote the whole deliverable next door and died `artifact missing`
 * with nothing naming where the file went.
 *
 * Spec 112 un-ignored the folder, which closes the half of that hole made of NEWLY-CREATED paths:
 * confinement now sees them, reverts them, and fails the phase. The other half does not close, and
 * cannot close by un-ignoring alone. `turnTouched` is `after − baseline`, and porcelain prints an
 * untracked file as `?? <path>` BOTH before and after the turn — so a turn that OVERWRITES a
 * neighbour's existing draft in place produces an identical path on both sides, sits in `baseline`,
 * and is structurally invisible to the git delta. That is the case this walk still owns, and it is
 * the more destructive of the two. (It closes only when the drafts are actually COMMITTED, at which
 * point the overwrite shows as `M`.)
 *
 * ADVISORY BY CONSTRUCTION, and now for a sharper reason than before. Confinement reverts what it
 * catches, and that is safe precisely because it only ever catches paths that did NOT exist when the
 * turn began. What this walk reports is the opposite class — files that DID exist and were changed —
 * so "revert" here would mean overwriting or deleting work that pre-dates the build. It returns
 * paths; it neither reverts nor fails a phase.
 *
 * `sinceMs` is the spawn moment (captured next to the confinement baseline), so a file the human edited
 * in their own editor mid-turn also lands here. That is a false positive the caller must word for —
 * hence "changed outside the build folder", never "the turn wrote".
 */
export async function strayWrites(
  projectsDir: string,
  sinceMs: number,
  ownDir: string | null
): Promise<string[]> {
  const out: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    if (out.length >= STRAY_MAX_FILES) return;
    let entries;
    try {
      entries = await readdir(join(projectsDir, rel), { withFileTypes: true });
    } catch {
      return; // vanished mid-walk / unreadable → nothing to report, never a throw
    }
    for (const e of entries) {
      if (STRAY_SKIP.has(e.name)) continue;
      const child = `${rel}/${e.name}`;
      if (ownDir && (child === ownDir || child.startsWith(`${ownDir}/`))) continue; // the build's own folder
      if (e.isDirectory()) {
        await walk(child);
        continue;
      }
      if (!e.isFile()) continue;
      try {
        if ((await stat(join(projectsDir, child))).mtimeMs > sinceMs) out.push(child);
      } catch {
        /* raced away → skip */
      }
      if (out.length >= STRAY_MAX_FILES) return;
    }
  };
  await walk('projects');
  return out.sort();
}

/**
 * Spec 108 S5(b) — the build's OWN `workflows/*.ya?ml` files whose bytes changed during this turn.
 * The complement of {@link strayWrites}, which deliberately SKIPS the build folder: a ③ turn editing
 * its own workflow is the normal case and postTurnCheck grades it. But a ①/② turn editing it is
 * graded by NOBODY — their verify stats only their own artifact — and that is exactly what run
 * 1787544155222 did for 13 turns (every "spec" turn was rewriting main.yml). The caller grades what
 * this returns with {@link checkExtraWorkflowFile}, so "checked" means the same four linters either way.
 */
export async function changedWorkflowYmls(
  projectsDir: string,
  workflowsDirRel: string,
  sinceMs: number
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(join(projectsDir, workflowsDirRel), { withFileTypes: true });
  } catch {
    return []; // pre-scaffold / no workflows dir → nothing to grade
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isFile() || !/\.ya?ml$/i.test(e.name)) continue;
    try {
      if ((await stat(join(projectsDir, workflowsDirRel, e.name))).mtimeMs > sinceMs) {
        out.push(`${workflowsDirRel}/${e.name}`);
      }
    } catch {
      /* raced away → skip */
    }
  }
  return out.sort();
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
