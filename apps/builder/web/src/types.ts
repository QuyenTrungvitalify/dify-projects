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
  flag?: 'still_failing' | 'awaiting_import';
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
  phase: WirePhase;
  status: WireStatus;
  slug: string | null;
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
  deploy: string;
}

/* ---- create-project modal ---- */
export interface FolderEntry {
  id: string;
  name: string;
  path: string;
}
