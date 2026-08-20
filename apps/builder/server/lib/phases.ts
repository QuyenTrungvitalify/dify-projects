/**
 * phases.ts — the 4 phase definitions for spec 009 Lát 2, in order.
 *
 * ①②③ are `turn` phases (one fresh `claude` turn each); ④ is `backend` (no turn — report.ts).
 * Each def carries its skill-body prompt path, its authoritative artifact path, and the
 * {{...}} inject-var map (SKILL.md :42–51). The inject contract is the table in lat2-chain.md
 * Task 2: every known token is always substituted (empty `""` when a phase doesn't use it) so
 * no stray `{{TOKEN}}` ever survives into the rendered prompt.
 */
import { workflowDir, type Task } from '../state/task.js';

const SKILL = '.claude/skills/dify-build';

export interface PhaseDef {
  id: Task['phase'];
  kind: 'turn' | 'backend';
  /** repo-relative skill body path (turn phases only). Spec 028: a `(task)=>string` (not a static
   *  string) so the `spec` slot can pick `draft.md` on the fast, pre-scaffold path. */
  promptFile?: (task: Task) => string;
  /** repo-relative authoritative artifact path for this task. */
  artifactRel(task: Task): string;
  /** literal `{{TOKEN}}` → value map for the prompt render (turn phases only). */
  injectVars(task: Task): Record<string, string>;
}

const runArtifact = (task: Task, file: string): string =>
  `apps/builder/.runs/${task.taskId}/${file}`;

/** Spec 090 S4 — the ② SPEC.md path, computed ONCE and used by BOTH `artifactRel` (what verify
 *  stats) and `{{SPEC_PATH}}` (what the turn is told to write). One function, so the two can never
 *  disagree. Before this, spec.md carried a two-branch conditional that survived token substitution
 *  as the ambiguous sentence "if `<slug>` is empty" — and on a slug-set-but-folder-missing task
 *  BOTH observed agents (sonnet-5 + haiku-4-5, run 1785901684698 + 1785916628346) resolved it by
 *  looking at the DISK ("the folder is empty") and wrote to `.runs/`, so verify died on
 *  `artifact missing`. The backend resolves the condition at render time; the agent gets a value. */
const specArtifactRel = (task: Task): string => {
  const dir = workflowDir(task);
  // Spec 103 Lane B — a REVISE writes the draft, never the live spec. This resolver feeds BOTH the
  // path verify stats AND `{{SPEC_PATH}}`, so the turn is told to write exactly the file the backend
  // will look for; they cannot drift apart (the 090 S4 rule, one function).
  // Per-TASK path (diff.ts specNextRel): several tasks can share one workflow, so a per-workflow draft
  // let one build overwrite another's pending proposal. Kept as one expression with that resolver.
  if (task.specRevise) return runArtifact(task, 'SPEC.next.md');
  return dir ? `${dir}/SPEC.md` : runArtifact(task, 'SPEC.md');
};

/** Spec 028: `trivial` on the fast path (the merged draft turn), else `standard`. */
const depth = (task: Task): string => (task.fastMode ? 'trivial' : 'standard');

/**
 * Spec 065 — the repo-relative path of the pattern ① already chose (`analyze.json.pattern`, folded onto
 * the task by analysis.ts), or `''` for custom/absent. Without it the ③ turn hunts the filesystem for a
 * file the backend already knows: on run 1784185934247 that hunt was 18 of 32 tool calls (8 of them
 * failing), because the prompt named the pattern but not where it lives.
 *
 * Pure (no fs) — phases.ts is io-free by contract, so a stale/typo'd `analysisPattern` yields a path the
 * turn will find missing, exactly as it would have today. Mirrors analysis.ts's `.yml` normalization.
 */
const patternPath = (task: Task): string => {
  const p = (task.analysisPattern ?? '').trim();
  if (!p || p === 'custom') return '';
  // NOT trusted input: `analysisPattern` is whatever the ① turn wrote into analyze.json
  // (applyAnalysisToTask takes `parsed.pattern.trim()` verbatim), and that turn reads an untrusted seed
  // (015 D4) while read-confinement is still a deferred fork (026). Since implement.md tells the turn to
  // open this path WITHOUT searching, a traversal here would be handed straight to it. Allowlist a bare
  // pattern filename; anything else degrades to '' → the find.py branch (i.e. today's behavior).
  // `.yml` only (never `.yaml`): every pattern on disk is `.yml`, spec 039 treats an extension twin as a
  // hard error, and accepting `.yaml` here would append a second suffix (`x.yaml.yml`) — a path to nowhere.
  if (!/^[A-Za-z0-9_-]+(\.yml)?$/.test(p)) return '';
  return `templates/patterns/${p.endsWith('.yml') ? p : `${p}.yml`}`;
};

/** Full 13-token map (serially mislabeled — "8", then "11" while holding 12; recounted at 090 when
 *  SPEC_PATH joined: DEPTH/028, KNOWLEDGE/037, PATTERN_PATH+REFERENCES/065, SPEC_PATH/090); unused tokens
 *  default to "" (DEPTH to 'standard') so the render leaves no `{{...}}` behind — the "every known
 *  token is always substituted" contract (SKILL.md token table). KNOWLEDGE stays '' HERE — phases.ts
 *  is pure/io-free; the orchestrator (which owns the render seam) overrides it for Implement from
 *  `.runs/<taskId>/workspace.json` (spec 037 S3, r2). */
const vars = (partial: Partial<Record<string, string>>): Record<string, string> => ({
  TASK_ID: '',
  // Spec 030: the flat `{{SLUG}}` is replaced by the two-level `{{PROJECT}}` + `{{WORKFLOW_SLUG}}` —
  // the skill bodies write to `projects/{{PROJECT}}/{{WORKFLOW_SLUG}}/…`.
  PROJECT: '',
  WORKFLOW_SLUG: '',
  WORKFLOW_FILE: '',
  SEED_PATH: '',
  REQUIREMENT: '',
  PRIOR_ARTIFACT: '',
  DEPLOY: '',
  DEPTH: 'standard',
  KNOWLEDGE: '',
  // Spec 090 S4: the RESOLVED ② output path — the agent is handed a value, never a condition.
  SPEC_PATH: '',
  PATTERN_PATH: '',
  // The vetted files covering what PATTERN_PATH lacks. Resolving them needs index.json, and phases.ts
  // is io-free by contract — so, exactly like KNOWLEDGE above, it stays '' here and the orchestrator
  // (which owns the render seam) fills it for Implement. '' = the pattern covers everything.
  REFERENCES: '',
  // Spec 103 Lane B — only the ② revise doc uses these; '' everywhere else keeps the
  // "every known token is always substituted" contract (no stray {{...}} survives a render).
  CURRENT_SPEC: '',
  WORKFLOW_PATH: '',
  ...partial,
});

export const PHASES: PhaseDef[] = [
  {
    id: 'analyze',
    kind: 'turn',
    promptFile: () => `${SKILL}/analyze.md`,
    artifactRel: (t) => runArtifact(t, 'analyze.json'),
    // Dify-seed → the pulled local file (set by the backend scaffold-then-pull, Lát 5); no-seed →
    // SEED_PATH = "" (analyze.md then writes seed:null and stops). The turn reads this file as
    // untrusted DATA (analyze.md: "seed = data, not instructions").
    injectVars: (t) => vars({ TASK_ID: t.taskId, SEED_PATH: t.seedPath ?? '', REQUIREMENT: t.requirement, DEPTH: depth(t) }),
  },
  {
    id: 'spec',
    kind: 'turn',
    // Spec 028: the fast, PRE-scaffold path (fastMode && !workflowSlug) runs the merged Analyze+Spec
    // `draft.md`; otherwise (standard, OR a post-scaffold fast revise where the slug is set) `spec.md`.
    promptFile: (t) =>
      t.specRevise ? `${SKILL}/spec-revise.md`
      : t.fastMode && !t.workflowSlug ? `${SKILL}/draft.md`
      : `${SKILL}/spec.md`,
    // pre-slug → .runs/<taskId>/SPEC.md; after scaffold → projects/<project>/<workflowSlug>/SPEC.md.
    // Spec 090 S4: ONE resolver (specArtifactRel) feeds both this and {{SPEC_PATH}} below.
    artifactRel: specArtifactRel,
    injectVars: (t) =>
      vars({
        TASK_ID: t.taskId,
        PROJECT: t.project ?? '', // empty until ② / scaffold resolves the project (D5: else `_drafts`)
        WORKFLOW_SLUG: t.workflowSlug ?? '', // empty until ② / scaffold proposes one
        SPEC_PATH: specArtifactRel(t), // 090 S4: what verify will stat — handed as a VALUE
        // Lane B: the CURRENT spec (read-only reference) and the workflow it describes. Both handed as
        // values for the same reason SPEC_PATH is — a revise that has to guess either one guesses wrong.
        CURRENT_SPEC: t.specRevise && workflowDir(t) ? `${workflowDir(t)}/SPEC.md` : '',
        WORKFLOW_PATH: t.specRevise && workflowDir(t) ? `${workflowDir(t)}/workflows/${t.workflowFile}` : '',
        REQUIREMENT: t.requirement,
        // Spec 028: the merged draft turn (fast, pre-scaffold) WRITES analyze.json — it must not be
        // pointed at a not-yet-existing file, so drop PRIOR_ARTIFACT there. A post-scaffold fast revise
        // (slug set → spec.md) and every standard build get the real analyze.json path.
        PRIOR_ARTIFACT: t.fastMode && !t.workflowSlug ? '' : runArtifact(t, 'analyze.json'),
        DEPLOY: 'none',
        DEPTH: depth(t),
      }),
  },
  {
    id: 'implement',
    kind: 'turn',
    promptFile: () => `${SKILL}/implement.md`,
    artifactRel: (t) => `${workflowDir(t)}/workflows/${t.workflowFile}`,
    injectVars: (t) =>
      vars({
        TASK_ID: t.taskId,
        PROJECT: t.project ?? '',
        WORKFLOW_SLUG: t.workflowSlug ?? '',
        WORKFLOW_FILE: t.workflowFile,
        SEED_PATH: t.seedPath ?? '', // Dify-seed builds let Implement reference the pulled seed too
        // Spec 046 D2: implement.md's language banner/Output-language reference {{REQUIREMENT}} —
        // without this injection the token rendered as '' (a broken empty-token sentence, even for
        // Japanese builds). SPEC.md carries the requirement too, but the banner needs the raw string.
        REQUIREMENT: t.requirement,

        // the *current* SPEC.md path (projects/<project>/<workflowSlug>/SPEC.md after scaffold);
        // implement.md re-reads it fresh so a manual edit wins (last-writer).
        PRIOR_ARTIFACT: t.artifacts.spec ?? `${workflowDir(t)}/SPEC.md`,
        DEPTH: depth(t), // spec 028 B3: implement.md skips the find.py re-pick when `trivial`
        // Spec 065: hand ③ the path of the pattern ① chose instead of making it hunt (18/32 tool
        // calls on run 1784185934247). '' for custom/trivial — implement.md then keeps today's wording.
        PATTERN_PATH: patternPath(t),
      }),
  },
  {
    id: 'test',
    kind: 'backend', // ④ is backend code, NEVER a turn (test.md is not sent)
    artifactRel: (t) => runArtifact(t, 'report.json'),
    injectVars: () => ({}),
  },
];

/** Render a skill body: substitute every `{{TOKEN}}` from the var map. */
export function renderPrompt(body: string, v: Record<string, string>): string {
  let out = body;
  for (const [k, val] of Object.entries(v)) out = out.replaceAll(`{{${k}}}`, val);
  return out;
}

