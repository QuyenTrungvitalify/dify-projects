/* ============================================================
   types.ts — shared shapes for the shell.
   The Wire* types mirror the backend's JSON contract
   (apps/builder/server/state/task.ts); the rest are small
   view-model helpers used by the live components.
   ============================================================ */

/* ───── live backend wire types (lat4-ui) — mirror apps/builder/server/state/task.ts ───── */

export type WireStatus =
  | 'running'
  | 'scaffolding'
  | 'awaiting_confirm'
  | 'done'
  | 'error'
  | 'cancelled';
export type WirePhase = 'analyze' | 'spec' | 'implement' | 'test';
export type WireConfirmMode = 'each_step' | 'spec_only' | 'auto';

/** A backend gate button (gate.ts): kind distinguishes /confirm vs composer-focus /reply vs /cancel. */
export interface WireGateAction {
  id: string;
  label: string;
  kind: 'confirm' | 'reply' | 'cancel';
  route: '/confirm' | '/reply' | '/cancel';
}
export interface WireGate {
  actions: WireGateAction[];
  // spec 032: `test_result` = live-test verdict gate; `infra_degraded` = live couldn't run (degrade).
  flag?: 'still_failing' | 'awaiting_import' | 'test_result' | 'infra_degraded';
}

/** spec 032 — the live workflow-test result surfaced at the Test-result gate (mirrors the server). */
export interface WireLiveTest {
  verdict: 'passed' | 'workflow_fail' | 'infra_fail' | 'need_input';
  label: 'live-verified' | 'live-verified-fail' | 'static-only';
  model?: { provider: string; name: string } | null;
  modelAutofilled?: number;
  appId?: string | null;
  appUrl?: string | null;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  runError?: string | null;
  totalTokens?: number | null;
  t1Pass?: boolean;
  needInputVars?: string[];
  reason?: string;
  /** spec 032 T3: the judge's per-criterion grade (advisory). */
  judge?: { criteria: { criterion: string; pass: boolean; evidence?: string }[]; summary?: string };
}

/** Artifact contents inlined on GET /api/tasks/:id (artifacts.ts). diff is Lát-5 (null here). */
export interface WireArtifacts {
  spec: string | null;
  yaml: string | null;
  report: unknown | null;
  diff: string | null;
}

export interface WireTask {
  taskId: string;
  project: string | null;
  workflow: string | null;
  workflowFile: string;
  requirement: string;
  seedPath: string | null;
  seedAppId?: string | null;
  deploy: 'none' | 'selfhost' | 'cloud';
  appId?: string | null;
  appUrl?: string | null;
  confirmMode: WireConfirmMode;
  /** spec 028: whether this build ran in ⚡ Fast mode (merged Analyze+Spec). Start-bound; the
   *  conversation-view composer reflects it read-only. Absent on a pre-028 snapshot ⇒ off. */
  fastMode?: boolean;
  /** spec 032: Phase ④ test mode (start-bound). Absent ⇒ 'static'. */
  testMode?: 'static' | 'live';
  /** spec 032: the latest live-test result (Test-result gate render); test app ids (cleanup). */
  liveTest?: WireLiveTest;
  testApps?: string[];
  /** spec 036 S5: computed capability bit (server-side, `toWireTask`) — whether a self-host Dify target
   *  is reachable NOW. The FE can't probe env, so the done-state "Run test with workflow" foot reads this.
   *  A boolean only (N5), never creds. Absent on a pre-036 snapshot ⇒ treated as not reachable. */
  liveTargets?: { selfhost: boolean };
  phase: WirePhase;
  status: WireStatus;
  /** spec 030: the workflow subfolder — the build lives at `projects/<project>/<workflowSlug>/`. null
   *  pre-scaffold. (`project` above is the project folder.) */
  workflowSlug: string | null;
  name: string | null;
  sessionIds: Record<string, string | undefined>;
  artifacts: Record<string, string | undefined>;
  gate?: WireGate;
  error?: string;
  /** Monotonic snapshot revision (server `emit`); the store drops any snapshot whose `rev` is strictly
   *  older than the last applied for this task, so a late reconnect GET can't revert a newer live
   *  update (spec 014 D5 / 011 R8). Absent on a pre-014 snapshot ⇒ 0. */
  rev?: number;
  /** F4 (spec 010): set when a new-workflow build's derived slug collided + was auto-suffixed — shown
   *  on the next gate so the user learns it built `<slug>_2` rather than overwriting `<slug>`. */
  slugNote?: string;
  /** O2 (spec 019): the chosen template pattern + the feature-set Analyze said the build needs, shown
   *  at the Analyze gate. `patternAdvisory` is set (advisory only) when the pattern lacks a needed
   *  feature. All optional — absent on a pre-019 snapshot. */
  analysisPattern?: string;
  analysisFeatures?: string[];
  analysisFindQuery?: string;
  patternAdvisory?: string;
  /** spec 028 §5: set when an `auto`+fast build's merged draft found a non-single-LLM shape — the
   *  auto-advance hard-stopped at the Spec gate; shown (leading) on the Spec gate card. */
  fastReviewNote?: string;
  /** spec 012: repo-relative paths of images attached via the composer (persisted on the task). */
  attachments?: string[];
  /** present on GET /api/tasks/:id (not on SSE task:update). */
  artifactContents?: WireArtifacts;
}

/* ───── live sidebar tree (GET /api/tree) ───── */
export interface WireTreeTask {
  id: string;
  name: string;
  time: string;
  status: WireStatus;
  phase: WirePhase;
}
export interface WireTreeWorkflow {
  id: string;
  name: string;
  tasks: WireTreeTask[];
}
export interface WireTreeProject {
  id: string;
  name: string;
  workflows: WireTreeWorkflow[];
}

/** Seed selector item (GET /api/seeds — empty list until Lát 5). */
export interface Seed {
  id: string;
  name: string;
}

/** Local FileChange (lat4-ui task 9 — was nexus shared/types.ts). The diff producer is Lát 5. */
export interface FileChange {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  diff: string;
  oldPath?: string;
}


export type PhaseKey = 'analyze' | 'spec' | 'implement' | 'test';
export type PhaseState = 'pending' | 'running' | 'awaiting' | 'done' | 'error';
export type PhaseStates = Record<PhaseKey, PhaseState>;

export type ArtifactTab = 'spec' | 'yaml' | 'diff' | 'report';

export interface Settings {
  workflow: string;
  confirm: string;
  /** spec 028: `⚡ Fast build` toggle (merge Analyze+Spec). Optional so the conversation-view composer
   *  (which builds a Settings without it) still type-checks; absent ⇒ off. */
  fast?: boolean;
  // spec 036: `deploy` + `test` removed — they are no longer composer settings; deploy/testMode are
  // decided at the test gate from reachable creds (difyTargets), then stamped on the task at gate-time.
}

/** spec 030: the two sidebar "+" intents, carried from Sidebar → App.newTask. Workflow "+" pre-selects
 *  a workflow to EDIT — a COMPOUND `{project, workflow}` key, because the same workflow NAME can now
 *  exist in multiple projects (a bare name no longer identifies it). Project "+" TARGETS a project
 *  folder for a from-scratch build (`targetProject`). Both optional — footer "New task" passes neither. */
export interface NewTaskOpts {
  baseWorkflow?: { project: string; workflow: string };
  targetProject?: string;
}
