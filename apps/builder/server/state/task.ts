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

/** Deploy target for Phase ④ (Lát 5). `none` = local only (no Dify); `selfhost` = backend import +
 *  clickable `app_url`; `cloud` = skip import, emit copyable YAML + Studio steps (CSRF blocks auto). */
export type Deploy = 'none' | 'selfhost' | 'cloud';

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
  /** `still_failing` = the cap-5 lint≠0 Implement gate (`auto` HARD-STOPS, §D); `awaiting_import` =
   *  the selfhost ④ Import gate (lint clean, import pending — `auto` auto-confirms it, AC #16). */
  flag?: 'still_failing' | 'awaiting_import';
}

export interface Task {
  taskId: string; // 13-digit ms-timestamp string
  project: string | null; // slug; null until Spec proposes/derives one
  workflow: string | null; // workflow name; null for new
  workflowFile: string; // "main.yml" for a new workflow
  requirement: string;
  // The local seed/base for the diff (§G). For a Dify-seed task this is set to the pulled file by the
  // backend scaffold-then-pull (Lát 5 Task 5); null for the no-seed/new-workflow path.
  seedPath: string | null;
  // The Dify workspace app id chosen in the seed picker (Lát 5). null = no Dify seed (local/no-seed).
  seedAppId: string | null;
  deploy: Deploy; // 'none' (Lát 3 default) | 'selfhost' | 'cloud' (Lát 5)
  // selfhost Phase ④ result (Lát 5 Task 6): the NEW Dify app id captured from the import + its url.
  appId?: string | null;
  appUrl?: string | null;
  confirmMode: ConfirmMode; // drives pause-vs-auto-advance at each boundary (§D)
  phase: Phase;
  status: Status;
  slug: string | null; // == project once Spec proposes/derives one
  name: string | null;
  // PERSIST per-phase session_id (Lát 3's /reply reads these back to --resume within a phase).
  sessionIds: { analyze?: string; spec?: string; implement?: string };
  artifacts: { analyze?: string; spec?: string; implement?: string; report?: string; diff?: string };
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
  /** deploy target — 'none' | 'selfhost' | 'cloud' (normalized via {@link normalizeDeploy}, Lát 5). */
  deploy?: string;
  /** chosen Dify seed app id from the seed picker (null/empty = no Dify seed, Lát 5). */
  seed?: string | null;
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

/** Normalize the public `deploy` field to {@link Deploy}. Unknown/missing → 'none' (the safe local
 *  default; never silently selfhost/cloud — those reach Dify). */
export function normalizeDeploy(raw: unknown): Deploy {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'selfhost' || s === 'self-host' || s === 'self host') return 'selfhost';
  if (s === 'cloud') return 'cloud';
  return 'none';
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

// Monotonic taskId mint: two POSTs in the same millisecond must NOT collide. The turn lock keys on
// taskId, so a shared id would let the race-loser `acquireTurn` the SAME slot the winner holds (Q6 /
// AC #21). `acquireTurn` is synchronous + strict (one slot), so distinct ids guarantee the loser 409s.
let lastTaskMs = 0;
function mintTaskId(): string {
  let ms = Date.now();
  if (ms <= lastTaskMs) ms = lastTaskMs + 1;
  lastTaskMs = ms;
  return ms.toString();
}

/** Mint a taskId, create `.runs/<taskId>/`, write the initial `task.json`. */
export async function createTask(projectsDir: string, input: CreateTaskInput): Promise<Task> {
  const taskId = mintTaskId(); // 13-digit ms timestamp, monotonic-unique within the process
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
    seedPath: null, // set by the Dify-seed scaffold-then-pull (Task 5) when seedAppId is present
    seedAppId: input.seed && input.seed.trim() ? input.seed.trim() : null,
    deploy: normalizeDeploy(input.deploy),
    appId: null,
    appUrl: null,
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
