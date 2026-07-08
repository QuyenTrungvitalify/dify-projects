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
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { difyTargets } from '../lib/dify-io.js';

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

/** Spec 032: Phase ④ test mode. `static` (default, always safe, never touches Dify — the pre-032
 *  behavior) vs `live` (import → auto-fix model → run → verify). `live` is only meaningful for
 *  `deploy=selfhost` with console creds; createTask force-downgrades it to `static` otherwise. */
export type TestMode = 'static' | 'live';

/** Spec 032 — the outcome of a live workflow test (S3-wiring-b), surfaced on the task for the gate/report
 *  render. The minted app-key is NEVER stored here (redacted, backend-only). */
/** Spec 032 T3 (S4) — the judge's per-criterion verdict (ADVISORY; a human still confirms at the gate). */
export interface JudgeCriterion {
  criterion: string;
  pass: boolean;
  evidence?: string;
}
export interface JudgeVerdict {
  criteria: JudgeCriterion[];
  summary?: string;
}

export type LiveVerdict = 'passed' | 'workflow_fail' | 'infra_fail' | 'need_input';
export interface LiveTestResult {
  verdict: LiveVerdict;
  /** `live-verified` = ran + T1 passed; `live-verified-fail` = ran but failed; `static-only` = couldn't
   *  run for an infra reason (lint result stands). */
  label: 'live-verified' | 'live-verified-fail' | 'static-only';
  model?: { provider: string; name: string } | null;
  modelAutofilled?: number; // # llm nodes whose model was auto-filled
  appId?: string | null;
  appUrl?: string | null;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  runError?: string | null;
  totalTokens?: number | null;
  t1Pass?: boolean; // mechanical: run succeeded + output non-empty
  needInputVars?: string[]; // set when verdict=need_input (couldn't derive a sample input)
  reason?: string; // human-facing one-line summary / infra reason
  /** T3 (S4): the judge's per-criterion grade against the Acceptance Criteria. ADVISORY — absent when
   *  there is no rubric (smoke-test) or the judge was inconclusive. Never flips T1/the gate outcome. */
  judge?: JudgeVerdict;
}

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
   *  the selfhost ④ Import gate (lint clean, import pending — `auto` auto-confirms it, AC #16). Spec 032:
   *  `test_result` = the live-test verdict gate (auto HARD-STOPS on a fail/subjective result, B4);
   *  `infra_degraded` = live couldn't run for an infra reason → degrade-to-static confirm (D1c). Spec 052
   *  (the `kind:'promote'` build's three parked gates): `promote_blocked` = the B1 eligibility gate failed
   *  (no turn spawned); `promote_distill_failed` = the distilled output failed the B2′ re-lint; `promote_review`
   *  = a clean distill parked for the human 1-click Approve (the ONLY write to `templates/patterns/`). */
  flag?:
    | 'still_failing'
    | 'awaiting_import'
    | 'test_result'
    | 'infra_degraded'
    | 'promote_blocked'
    | 'promote_distill_failed'
    | 'promote_review';
}

/** Spec 052 — the verbatim `promote_gate.py check --json` verdict (B1 before the turn, B2′ re-gate after).
 *  Mirrors the Python dict: `eligible`/`reasons` decide the gate; `probe` is 'ok'|'failed'|'skipped'
 *  (always 'skipped' from the Builder — `runPython` strips DIFY_* so the button never contacts Dify);
 *  `knownGoodDify` is non-null only on a probe 'ok' (stamped into `x-provenance` at finalize). */
export interface PromoteVerdict {
  eligible: boolean;
  reasons: string[];
  probe: string;
  probeDetail?: string;
  knownGoodDify?: string | null;
}

/** Spec 052 — the promotion source + staged outputs carried on a `kind:'promote'` Task. `source` is the
 *  proven build being distilled; `staged` is the run-dir pattern the distill turn writes (NEVER
 *  templates/); `target` is the proposed `templates/patterns/<slug>.yml` the human Approve finalizes to. */
export interface PromoteState {
  /** repo-relative source workflow file (the proven build being promoted). */
  sourceFile: string;
  /** the source `{project, workflow}` (for the header pill + provenance narration). */
  project: string;
  workflow: string;
  /** house-style pattern slug (hyphenated, matches the templates/patterns/ convention). */
  slug: string;
  /** repo-relative staged pattern path (`apps/builder/.runs/<taskId>/promote/<slug>.yml`). */
  staged?: string;
  /** repo-relative finalize target (`templates/patterns/<slug>.yml`), set on Approve. */
  target?: string;
  /** the B1 (pre-turn) then B2′ (post-turn re-gate) verdict, whichever ran last. */
  verdict?: PromoteVerdict;
  /** mechanical linter-rule candidates the distill surfaced + recorded via `promote_gate.py candidate`. */
  rules?: string[];
  /** a one-line human-facing note (a blocked reason summary, a slug collision, an index-rebuild warning). */
  note?: string;
}

export interface Task {
  taskId: string; // 13-digit ms-timestamp string
  // Spec 052: the build KIND. Absent ⇒ 'build' (the standard ①②③④ pipeline — back-compat: every existing
  // task.json loads as a build). 'promote' is the gated distill flow (B1 gate → distill turn → B2′ re-gate
  // → human Approve → templates/patterns/) — it NEVER runs the ①②③④ state machine; the routes delegate its
  // gate actions to lib/promote.ts on `kind==='promote'`, so the phase FSM is literally untouched (AC7).
  kind?: 'build' | 'promote';
  // Spec 052: the promotion state for a `kind:'promote'` Task (absent on a build).
  promote?: PromoteState;
  // Spec 030: the on-disk hierarchy is REAL — a build lives at `projects/<project>/<workflowSlug>/`.
  project: string | null; // the PROJECT folder (projects/<project>/); null pre-scaffold
  workflowSlug: string | null; // the WORKFLOW subfolder (…/<workflowSlug>/); null pre-scaffold
  workflow: string | null; // workflow name; null for new
  workflowFile: string; // "main.yml" for a new workflow
  requirement: string;
  // The local seed/base for the diff (§G). For a Dify-seed task this is set to the pulled file by the
  // backend scaffold-then-pull (Lát 5 Task 5); null for the no-seed/new-workflow path.
  seedPath: string | null;
  // The Dify workspace app id chosen in the seed picker (Lát 5). null = no Dify seed (local/no-seed).
  seedAppId: string | null;
  // Spec 036 D3: `deploy`/`testMode` are GATE-STAMPED, not start-bound — createTask defaults them
  // ('none'/'static') and they are (re)written at the test gate from reachable creds: 'selfhost' on the
  // human static→Import park, 'selfhost'/'live' on a `test_live` dispatch or the done-state live action.
  deploy: Deploy; // 'none' (default) | 'selfhost' (stamped at the ④ gate) | 'cloud' (§8, unused)
  // Phase ④ test mode. Absent on a pre-032 task.json ⇒ treated as `static` (back-compat: every
  // `task.testMode === 'live'` guard reads it as off). Stamped 'live' only by a gate live action (S3/S5).
  testMode: TestMode;
  // selfhost Phase ④ result (Lát 5 Task 6): the NEW Dify app id captured from the import + its url.
  appId?: string | null;
  appUrl?: string | null;
  confirmMode: ConfirmMode; // drives pause-vs-auto-advance at each boundary (§D)
  // Spec 028: opt-in "fast build" — merges Analyze+Spec into ONE merged draft turn (from-scratch
  // single-LLM only). Forced false when a seed/workflow/slug is set (§1). Absent on a pre-028
  // task.json ⇒ falsy (back-compat: every `task.fastMode && …` guard reads it as off).
  fastMode: boolean;
  phase: Phase;
  status: Status;
  name: string | null;
  // PERSIST per-phase session_id (Lát 3's /reply reads these back to --resume within a phase).
  // Spec 034 D2: `askTest` is a SEPARATE chat-continuity slot for a ④/terminal Ask (there is no `test`
  // phase session) — never read by computeGate/runPhaseAndGate/maybeAutoAdvance; only askTestWithin
  // consults it to decide fresh-spawn vs --resume for a follow-up question in the same conversation.
  sessionIds: { analyze?: string; spec?: string; implement?: string; askTest?: string };
  artifacts: { analyze?: string; spec?: string; implement?: string; report?: string; diff?: string; criteria?: string };
  // the live gate (set at awaiting_confirm; cleared/ignored in terminal states).
  gate?: Gate;
  error?: string;
  // Monotonic snapshot revision, bumped on every persisted UI-visible transition (orchestrator `emit`).
  // The web store drops any snapshot whose `rev` is strictly older than the last applied for this task,
  // so a late reconnect/init GET can never clobber a newer live `task:update` (spec 014 D5 / 011 R8).
  // Absent on a pre-014 task.json ⇒ treated as 0 (trivial migration: the next `emit` bumps it to 1).
  rev?: number;
  // F1/010: a one-line informational note surfaced on the next gate + in the report. Set when a
  // new-workflow build's DERIVED slug collided with an existing project and was auto-suffixed (F4), so
  // the user learns it built `<slug>_2` instead of overwriting `<slug>`.
  slugNote?: string;
  // O2 (spec 019): the chosen template pattern + the feature-set Analyze determined the build needs
  // (the `find.py --has` vocabulary) + the find.py query it ran, persisted from analyze.json so the
  // Analyze gate can surface them. ALL optional + back-compat — an old `.runs/<id>/task.json` without
  // them loads and reconciles unchanged.
  analysisPattern?: string;
  analysisFeatures?: string[];
  analysisFindQuery?: string;
  // O2 advisory (NOT a hard-fail): set when the chosen pattern lacks a feature the analysis needs.
  patternAdvisory?: string;
  // Spec 037 S1 advisory (NOT a hard-fail): the runnability preflight line — set (or cleared) on
  // EVERY implement verify and recomputed by the ④ report; itemizes what keeps the build from
  // running out-of-the-box (model fill / plugin hash / dataset_ids / sandbox trap).
  preflightNote?: string;
  // Spec 049 D2 advisory (NOT a hard-fail): the ④ import-probe verdict — the produced YAML was
  // really pushed to the configured Dify (probe app deleted immediately). Set/cleared per static ④
  // run; a Task field (not a ReportOpts) so it survives the Import/Skip re-report like preflightNote.
  probeNote?: string;
  // Spec 028 §5: set when an `auto`+fast build's merged draft found a NON-single-LLM shape (features
  // ⊄ {llm}, or absent) — the auto-advance hard-stops at the Spec gate and surfaces this note.
  fastReviewNote?: string;
  // Spec 012: repo-relative paths of images attached via the composer (saved under
  // `.runs/<taskId>/uploads/`). The orchestrator injects these paths into the turn prompt so the turn
  // can `Read` them. Appended across turns (create + each reply); lives/dies with the task dir.
  attachments?: string[];
  // Spec 032 (S3-wiring-b): the latest live-test result (surfaced at the Test-result gate) + the ids of
  // every test app created for this build (cleanup, S6). Absent on non-live builds. app-key NEVER here.
  liveTest?: LiveTestResult;
  testApps?: string[];
}

/**
 * Spec 036 S5 — the extra bits added when a `Task` is serialized to the SSE/GET wire. `liveTargets` is a
 * COMPUTED capability flag (never persisted): the FE can't probe the backend env, so the done-state
 * "Run test with workflow" foot (gate-foot.ts `terminalFootActions`) reads it to know self-host is
 * reachable RIGHT NOW. A boolean only (N5) — never the creds. `cloud` joins additively when §8 lands.
 */
export interface WireExtras {
  liveTargets: { selfhost: boolean };
}

/**
 * Serialize a `Task` for the wire (SSE `task:update` + GET /api/tasks/:id): the persisted task PLUS the
 * computed {@link WireExtras}. Recomputed from {@link difyTargets} on every emit, so a build that finished
 * before the operator exported creds still lights up its done-state live action on the next snapshot.
 */
export function toWireTask(task: Task): Task & WireExtras {
  return { ...task, liveTargets: { selfhost: !!difyTargets().selfhost } };
}

export interface CreateTaskInput {
  requirement: string;
  /** new-workflow path uses "main.yml"; accepted for forward-compat. */
  workflowFile?: string;
  /** existing-workflow name → edit-existing; omitted/"none" → new workflow. */
  workflow?: string | null;
  /** verbose `confirm_mode` OR internal value — normalized via {@link normalizeConfirmMode}. */
  confirmMode?: string;
  /** spec 036 D3: IGNORED by {@link createTask} — deploy is no longer start-bound (stamped at gate-time
   *  from reachable creds). Retained on the input for wire back-compat; a sent value is a no-op. */
  deploy?: string;
  /** spec 036 D3: IGNORED by {@link createTask} — testMode is no longer start-bound (stamped 'live' at a
   *  `test_live` dispatch / the done-state live action). Retained for wire back-compat; a sent value is a no-op. */
  testMode?: string;
  /** chosen Dify seed app id from the seed picker (null/empty = no Dify seed, Lát 5). */
  seed?: string | null;
  /** spec 030: the target PROJECT folder (sidebar project-"+" or the workflow-"+" parent, public
   *  `project`). null ⇒ the from-scratch build resolves to the `_drafts` project at the Spec gate (D5). */
  project?: string | null;
  /** user-supplied WORKFLOW slug/name (else Spec proposes at the gate, AC #18; public `workflow_slug`
   *  or legacy `slug`). Names the `projects/<project>/<workflowSlug>/` subfolder (D3). */
  slug?: string | null;
  name?: string | null;
  /** spec 028: `⚡ Fast build` switch (public `fast_mode`). Normalized via {@link normalizeFastMode};
   *  force-off in {@link createTask} when a seed/workflow/slug is set. */
  fast?: boolean | string | null;
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

/** Normalize the public `fast_mode`/`fast` field to a boolean (spec 028). Accepts a real boolean or
 *  the string forms the wire/curl demos send. Unknown/missing → `false` (the safe default; fast is
 *  strictly opt-in). NOTE: the seed/workflow/slug force-off is applied in {@link createTask}, not here. */
export function normalizeFastMode(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  const s = String(raw ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'on' || s === 'yes';
}

/** Normalize the public `deploy` field to {@link Deploy}. Unknown/missing → 'none' (the safe local
 *  default; never silently selfhost/cloud — those reach Dify). */
export function normalizeDeploy(raw: unknown): Deploy {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'selfhost' || s === 'self-host' || s === 'self host') return 'selfhost';
  if (s === 'cloud') return 'cloud';
  return 'none';
}

/** Normalize the public `test_mode`/`testMode` field to {@link TestMode} (spec 032). Unknown/missing →
 *  'static' (the safe default; live is strictly opt-in and reaches Dify). The deploy≠selfhost force-down
 *  to static is applied in {@link createTask}, not here. */
export function normalizeTestMode(raw: unknown): TestMode {
  return String(raw ?? '').trim().toLowerCase() === 'live' ? 'live' : 'static';
}

/** The phase ordering of a build: analyze → spec → implement → test. */
export const PHASE_ORDER: Phase[] = ['analyze', 'spec', 'implement', 'test'];

/**
 * The phase a cancelled build rewinds to on /restore: the PREVIOUS boundary. A phase only ever starts
 * after the previous phase's gate was confirmed, so the previous phase definitely completed and was
 * gated — re-parking there (`awaiting_confirm`) is always a valid state, and its artifacts are on disk
 * (the spec was already moved to `projects/<project>/<workflowSlug>/` by the spec-gate scaffold). `analyze` is the first
 * phase and has no prior gate → null (the caller reopens it as a retryable `error` instead).
 */
export function restoreTargetPhase(phase: Phase): Phase | null {
  const i = PHASE_ORDER.indexOf(phase);
  return i > 0 ? PHASE_ORDER[i - 1] : null;
}

/**
 * Spec 028 — the /restore rewind target for a build, fast-aware. A FAST build cancelled AT the merged
 * Spec turn (phase='spec', workflowSlug still null → the scaffold has not run) has NO prior gate:
 * rewinding to `analyze` (what `restoreTargetPhase('spec')` returns) would raise a phantom Analyze gate.
 * So it rewinds to null — the caller reopens it as a retryable error (Retry re-runs the merged draft),
 * exactly like the standard first phase (`analyze`). Every other case (standard build, OR a fast build
 * cancelled at 'implement' where the scaffold already set the slug) falls through to `restoreTargetPhase`.
 */
export function restoreTargetPhaseFor(task: Pick<Task, 'fastMode' | 'phase' | 'workflowSlug'>): Phase | null {
  if (task.fastMode && task.phase === 'spec' && !task.workflowSlug) return null;
  return restoreTargetPhase(task.phase);
}

/**
 * Spec 015 D5 (S4) — a `workflowFile` MUST be a plain basename ending in `.yml`/`.yaml`: no path
 * separators, no `..` traversal. `workflowFile` flows into `sync.py push --file workflows/<file>` at ④
 * (backend, OUTSIDE the turn — the hook can't gate it), so an un-sanitized `../../x/main.yml` would
 * escape `projects/<slug>/`. The basename charset `[A-Za-z0-9._-]` admits every real workflow name
 * (`main.yml`, `chatflow.yml`, an `app-name-slug.yml` pulled from Dify) while the explicit `..` reject
 * forecloses traversal even within the charset (Q5: no legitimate `*.yml` selection is rejected).
 */
export function isValidWorkflowFile(name: string): boolean {
  return /^[A-Za-z0-9._-]+\.ya?ml$/.test(name) && !name.includes('..');
}

/** Sanitize a user-supplied slug to snake_case `[a-z0-9_]` (Task 5 / arg-validation, spec §J). An
 *  intentional LEADING underscore is preserved so the reserved `_drafts` project (spec 030 D5) round-trips
 *  identically here and in `init_project.py`'s `slugify` (they must agree — confinement compares the
 *  stored `project` to the on-disk folder). */
export function sanitizeSlug(raw: string): string {
  const body =
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40)
      .replace(/_+$/, '') || 'workflow';
  return raw.trim().startsWith('_') ? `_${body}` : body;
}

/** Spec 030 (D5): the reserved project folder that holds "loose" workflows — a global "New task" with
 *  no chosen project builds here, keeping the invariant "every workflow is `projects/<project>/<workflow>/`". */
export const DRAFTS_PROJECT = '_drafts';

/** Spec 030: the repo-relative workflow subtree `projects/<project>/<workflowSlug>` for a task, or null
 *  pre-scaffold (either half unset). Centralizes the 2-level path so the many builders don't each
 *  re-concatenate it (and can't drift from the confinement whitelist). */
export function workflowDir(task: Pick<Task, 'project' | 'workflowSlug'>): string | null {
  return task.project && task.workflowSlug ? `projects/${task.project}/${task.workflowSlug}` : null;
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
  const workflowSlug = input.slug && input.slug.trim() ? sanitizeSlug(input.slug.trim()) : null;
  // Spec 030: the TARGET project folder (sidebar project-"+" or the workflow-"+" parent). null until
  // resolved — a from-scratch build defaults to `_drafts` at the Spec gate (D5); edit/seed builds
  // resolve it in localEditSeed / difySeedScaffoldAndPull. Sanitized as a dir name (same charset).
  const project = input.project && input.project.trim() ? sanitizeSlug(input.project.trim()) : null;
  const seedAppId = input.seed && input.seed.trim() ? input.seed.trim() : null;
  // Spec 028 §1: fast mode is FROM-SCRATCH ONLY — force it off whenever a seed/workflow/slug is set
  // (a seed/edit build assumes the standard 4-turn path; a user-supplied workflow slug would flip the
  // merged turn's `.runs/`-only artifact path + confinement whitelist to the nested workflow subtree).
  // A `project` target does NOT force it off (like the retired group): it names the folder, not the shape.
  const fastMode = normalizeFastMode(input.fast) && !workflow && !workflowSlug && !seedAppId;
  // Spec 036 D3/N3: `deploy` + `testMode` are NO LONGER start-bound — createTask defaults them and stops
  // reading `input.deploy`/`input.testMode`. They are (re)stamped at GATE-time from what creds are
  // reachable: 'selfhost'/'live' on a `test_live` dispatch (implement gate) or the D5 done-state live
  // action, and 'selfhost'/'static' on the human static→Import park (orchestrator, S3). The persisted
  // fields stay in the schema for report.ts + back-compat (N3); only their WRITE SITE moved to gate-time.
  const deploy: Deploy = 'none';
  const testMode: TestMode = 'static';
  const task: Task = {
    taskId,
    project,
    workflowSlug,
    workflow,
    workflowFile: (input.workflowFile ?? 'main.yml').trim() || 'main.yml',
    requirement: input.requirement.trim(),
    seedPath: null, // set by the Dify-seed scaffold-then-pull (Task 5) when seedAppId is present
    seedAppId,
    deploy,
    testMode,
    appId: null,
    appUrl: null,
    confirmMode: normalizeConfirmMode(input.confirmMode),
    fastMode,
    phase: 'analyze',
    status: 'running',
    name: input.name && input.name.trim() ? input.name.trim() : null,
    sessionIds: {},
    artifacts: {},
  };
  await mkdir(taskDir(projectsDir, taskId), { recursive: true });
  await saveTask(projectsDir, task);
  return task;
}

/** Spec 052 — mint a `kind:'promote'` Task: mint the id, create `.runs/<taskId>/`, write the initial
 *  task.json. Distinct from {@link createTask} (which defaults the ①②③④ build fields) — a promote task
 *  carries the {@link PromoteState} and pins `phase:'test'` so its parked gate renders INLINE (the phase
 *  is otherwise unused; the promote flow never runs the phase FSM). `slug` is the house-style pattern name. */
export async function createPromoteTask(
  projectsDir: string,
  input: { project: string; workflow: string; sourceFile: string; slug: string }
): Promise<Task> {
  const taskId = mintTaskId();
  const task: Task = {
    taskId,
    kind: 'promote',
    promote: {
      sourceFile: input.sourceFile,
      project: input.project,
      workflow: input.workflow,
      slug: input.slug,
    },
    project: input.project,
    workflowSlug: input.workflow,
    workflow: input.workflow,
    workflowFile: 'main.yml',
    requirement: `Promote projects/${input.project}/${input.workflow} to a reusable pattern`,
    seedPath: null,
    seedAppId: null,
    deploy: 'none',
    testMode: 'static',
    appId: null,
    appUrl: null,
    confirmMode: 'each_step',
    fastMode: false,
    // pinned so the parked gate renders inline (Chat.tsx `docked` is false for 'test'); the phase FSM is
    // never entered for a promote task — the routes delegate on `kind` before confirmAdvance is reached.
    phase: 'test',
    status: 'running',
    name: null,
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

/**
 * Bump the monotonic snapshot revision (spec 014 D5 / 011 R8). The orchestrator's `emit` bumps `rev`
 * for turn transitions, but the routes that broadcast a `task:update` DIRECTLY (cancel / restore /
 * failSafe / PATCH confirm_mode) bypass `emit` — call this before their `saveTask`+`broadcast` so the
 * relayed snapshot STRICTLY increases `rev`. Otherwise an in-flight same-rev enrichment GET (issued
 * when the prior gate was applied) can resolve afterwards and, because the web store applies on
 * `rev >= last`, RESURRECT the just-replaced gate over the cancelled/error state.
 */
export function bumpRev(task: Task): void {
  task.rev = (task.rev ?? 0) + 1;
}

// Monotonic, process-local — gives every saveTask call a UNIQUE temp filename. A FIXED `${final}.${process.pid}.${++_saveSeq}.tmp`
// raced when two saves ran concurrently for the same task (e.g. /cancel's save while the force-killed
// turn's own save was in flight): both wrote then renamed the SAME `.tmp`, so the second rename hit
// `ENOENT: rename task.json.tmp -> task.json` (the first had already consumed it) → an HTTP 500 on cancel.
let _saveSeq = 0;

/** Atomic write: UNIQUE temp file then `rename` (so a crash never leaves a half-written task.json, and
 *  concurrent saves for the same task can't collide on the temp path). Last rename wins on `final`. */
export async function saveTask(projectsDir: string, task: Task): Promise<void> {
  const dir = taskDir(projectsDir, task.taskId);
  await mkdir(dir, { recursive: true });
  const final = taskFile(projectsDir, task.taskId);
  const tmp = `${final}.${process.pid}.${++_saveSeq}.tmp`;
  await writeFile(tmp, JSON.stringify(task, null, 2));
  try {
    await rename(tmp, final);
  } catch (e) {
    await unlink(tmp).catch(() => {}); // don't leak the unique temp if the rename itself fails
    throw e;
  }
}
