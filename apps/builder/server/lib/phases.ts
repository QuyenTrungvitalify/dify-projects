/**
 * phases.ts — the 4 phase definitions for spec 009 Lát 2, in order.
 *
 * ①②③ are `turn` phases (one fresh `claude` turn each); ④ is `backend` (no turn — report.ts).
 * Each def carries its skill-body prompt path, its authoritative artifact path, and the
 * {{...}} inject-var map (SKILL.md :42–51). The inject contract is the table in lat2-chain.md
 * Task 2: every known token is always substituted (empty `""` when a phase doesn't use it) so
 * no stray `{{TOKEN}}` ever survives into the rendered prompt.
 */
import type { Task } from '../state/task.js';

const SKILL = '.claude/skills/dify-build';

export interface PhaseDef {
  id: Task['phase'];
  kind: 'turn' | 'backend';
  /** repo-relative skill body path (turn phases only). */
  promptFile?: string;
  /** repo-relative authoritative artifact path for this task. */
  artifactRel(task: Task): string;
  /** literal `{{TOKEN}}` → value map for the prompt render (turn phases only). */
  injectVars(task: Task): Record<string, string>;
}

const runArtifact = (task: Task, file: string): string =>
  `apps/builder/.runs/${task.taskId}/${file}`;

/** Full 7-token map; unused tokens default to "" so the render leaves no `{{...}}` behind. */
const vars = (partial: Partial<Record<string, string>>): Record<string, string> => ({
  TASK_ID: '',
  SLUG: '',
  WORKFLOW_FILE: '',
  SEED_PATH: '',
  REQUIREMENT: '',
  PRIOR_ARTIFACT: '',
  DEPLOY: '',
  ...partial,
});

export const PHASES: PhaseDef[] = [
  {
    id: 'analyze',
    kind: 'turn',
    promptFile: `${SKILL}/analyze.md`,
    artifactRel: (t) => runArtifact(t, 'analyze.json'),
    // no-seed path: SEED_PATH = "" (analyze.md then writes seed:null and stops).
    injectVars: (t) => vars({ TASK_ID: t.taskId, SEED_PATH: '', REQUIREMENT: t.requirement }),
  },
  {
    id: 'spec',
    kind: 'turn',
    promptFile: `${SKILL}/spec.md`,
    // pre-slug → .runs/<taskId>/SPEC.md; after scaffold → projects/<slug>/SPEC.md (spec §A :477).
    artifactRel: (t) => (t.slug ? `projects/${t.slug}/SPEC.md` : runArtifact(t, 'SPEC.md')),
    injectVars: (t) =>
      vars({
        TASK_ID: t.taskId,
        SLUG: t.slug ?? '', // empty until ② / scaffold proposes one
        REQUIREMENT: t.requirement,
        PRIOR_ARTIFACT: runArtifact(t, 'analyze.json'),
        DEPLOY: 'none',
      }),
  },
  {
    id: 'implement',
    kind: 'turn',
    promptFile: `${SKILL}/implement.md`,
    artifactRel: (t) => `projects/${t.slug}/workflows/${t.workflowFile}`,
    injectVars: (t) =>
      vars({
        TASK_ID: t.taskId,
        SLUG: t.slug ?? '',
        WORKFLOW_FILE: t.workflowFile,
        SEED_PATH: '',
        // the *current* SPEC.md path (projects/<slug>/SPEC.md after scaffold); implement.md
        // re-reads it fresh so a manual edit wins (last-writer).
        PRIOR_ARTIFACT: t.artifacts.spec ?? `projects/${t.slug}/SPEC.md`,
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
