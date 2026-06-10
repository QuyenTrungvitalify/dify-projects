/**
 * task.ts — the per-task JSON state for spec 009.
 *
 * One task = one JSON file at `apps/builder/.runs/<taskId>/task.json`. The `.runs/<taskId>/`
 * dir is the canonical artifact home (spec §A :517). `sessionIds[phase]` is persisted the
 * moment a turn's init event yields a `session_id` (orchestrator) — Lát 3's `/reply` is a
 * SEPARATE request that reads it back from this file, not from a live variable.
 *
 * `taskId` is a 13-digit ms-timestamp string (`Date.now()`), matching the node-id convention
 * (AGENTS.md §4.1) and the spec's task identity (§A :491).
 *
 * Lát 3 adds the gate to the persisted state: at a phase boundary the orchestrator sets
 * `status:awaiting_confirm` + `gate.actions[]` (schema `{id,label,kind,route}`, spec §Revision
 * Cleanups + §D) and stops — the next turn fires only on `/confirm`. `confirmMode` drives which
 * boundaries pause vs auto-advance (§D).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type Phase = 'analyze' | 'spec' | 'implement' | 'test';
// `scaffolding` is the transient state around the (non-atomic) Spec-gate scaffold (plan QĐ #9) —
// a private internal sub-state of `running`, NOT a sixth queryable/terminal status. The spec's
// five public statuses are running/awaiting_confirm/done/error/cancelled (§A :492, §I :818).
export type Status =
  | 'running'
  | 'scaffolding'
  | 'awaiting_confirm'
  | 'done'
  | 'error'
  | 'cancelled';

/** Internal confirm-mode; the PUBLIC wire field is `confirm_mode` with verbose values (§A, AC #15). */
export type ConfirmMode = 'each_step' | 'spec_only' | 'auto';

/** A gate action button (spec §Revision Cleanups + §D): `kind` distinguishes a `/confirm` advance
 *  from a composer-focus `/reply` from a terminal `/cancel`. */
export type GateActionKind = 'confirm' | 'reply' | 'cancel';
export interface GateAction {
  id: string;
  label: string;
  kind: GateActionKind;
  route: '/confirm' | '/reply' | '/cancel';
}
export interface Gate {
  actions: GateAction[];
  /** set on the still-failing Implement gate (cap-5, lint≠0) so `auto` + UI can detect it (§D). */
  flag?: 'still_failing';
}

export interface Task {
  taskId: string; // 13-digit ms-timestamp string
  project: string | null; // slug; null until Spec proposes/derives one
  workflow: string | null; // workflow name; null for new
  workflowFile: string; // "main.yml" for a new workflow
  requirement: string;
  seedPath: string | null; // null for the no-seed/new-workflow path (Lát 3's only path)
  deploy: 'none'; // Lát 3 is none-only (selfhost/cloud = Lát 5)
  confirmMode: ConfirmMode; // drives pause-vs-auto-advance at each boundary (§D)
  phase: Phase;
  status: Status;
  slug: string | null; // == project once Spec proposes/derives one
  name: string | null;
  // PERSIST per-phase session_id (Lát 3's /reply reads these back to --resume within a phase).
  sessionIds: { analyze?: string; spec?: string; implement?: string };
  artifacts: { analyze?: string; spec?: string; implement?: string; report?: string };
  // the live gate (set at awaiting_confirm; cleared/ignored in terminal states).
  gate?: Gate;
  error?: string;
}

export interface CreateTaskInput {
  requirement: string;
  /** new-workflow path uses "main.yml"; accepted for forward-compat. */
  workflowFile?: string;
  /** existing-workflow name → edit-existing; omitted/"none" → new workflow. */
  workflow?: string | null;
  /** verbose `confirm_mode` OR internal value — normalized via {@link normalizeConfirmMode}. */
  confirmMode?: string;
  /** user-supplied slug/name (else Spec proposes at the gate, AC #18). */
  slug?: string | null;
  name?: string | null;
}

/**
 * Normalize the public `confirm_mode` to the internal {@link ConfirmMode}. Lenient by design:
 * accepts the spec's verbose values ("confirm each step" / "confirm at spec only" / "auto") AND
 * the internal tokens ("each_step" / "spec_only" / "auto"), so the documented contract and the
 * curl demos both work. Unknown / missing → the default `each_step` (§A, AC #15).
 */
export function normalizeConfirmMode(raw: unknown): ConfirmMode {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'auto') return 'auto';
  if (s === 'spec_only' || s === 'confirm at spec only' || s === 'spec only') return 'spec_only';
  if (s === 'each_step' || s === 'confirm each step' || s === 'each step') return 'each_step';
  return 'each_step';
}

/** Sanitize a user-supplied slug to snake_case `[a-z0-9_]` (Task 5 / arg-validation, spec §J). */
export function sanitizeSlug(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40)
      .replace(/_+$/, '') || 'workflow'
  );
}

const runsRoot = (projectsDir: string): string => join(projectsDir, 'apps/builder/.runs');
export const taskDir = (projectsDir: string, taskId: string): string =>
  join(runsRoot(projectsDir), taskId);
const taskFile = (projectsDir: string, taskId: string): string =>
  join(taskDir(projectsDir, taskId), 'task.json');
export { runsRoot };

/** Mint a taskId, create `.runs/<taskId>/`, write the initial `task.json`. */
export async function createTask(projectsDir: string, input: CreateTaskInput): Promise<Task> {
  const taskId = Date.now().toString(); // 13-digit ms timestamp
  const workflow = input.workflow && input.workflow.trim() && input.workflow.trim() !== 'none'
    ? input.workflow.trim()
    : null;
  const slug = input.slug && input.slug.trim() ? sanitizeSlug(input.slug.trim()) : null;
  const task: Task = {
    taskId,
    project: slug,
    workflow,
    workflowFile: (input.workflowFile ?? 'main.yml').trim() || 'main.yml',
    requirement: input.requirement.trim(),
    seedPath: null,
    deploy: 'none',
    confirmMode: normalizeConfirmMode(input.confirmMode),
    phase: 'analyze',
    status: 'running',
    slug,
    name: input.name && input.name.trim() ? input.name.trim() : null,
    sessionIds: {},
    artifacts: {},
  };
  await mkdir(taskDir(projectsDir, taskId), { recursive: true });
  await saveTask(projectsDir, task);
  return task;
}

export async function loadTask(projectsDir: string, taskId: string): Promise<Task> {
  const raw = await readFile(taskFile(projectsDir, taskId), 'utf8');
  return JSON.parse(raw) as Task;
}

/** Atomic write: temp file then `rename` (so a crash never leaves a half-written task.json). */
export async function saveTask(projectsDir: string, task: Task): Promise<void> {
  const dir = taskDir(projectsDir, task.taskId);
  await mkdir(dir, { recursive: true });
  const final = taskFile(projectsDir, task.taskId);
  const tmp = `${final}.tmp`;
  await writeFile(tmp, JSON.stringify(task, null, 2));
  await rename(tmp, final);
}
