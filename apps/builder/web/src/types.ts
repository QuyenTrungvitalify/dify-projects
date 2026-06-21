/* ============================================================
   types.ts — shared shapes for the shell.
   The presentational types (Gate descriptor, TreeProject, …)
   drive the design components; the Wire* types (added for
   lat4-ui) mirror the backend's JSON contract.
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

export type GateKey =
  | 'analyze'
  | 'spec'
  | 'implement_clean'
  | 'implement_failing'
  | 'import'
  | 'done'
  | 'error';

export type Scenario = 'clean' | 'failing';

export interface Settings {
  workflow: string;
  confirm: string;
  deploy: string;
}

export interface Crumb {
  project: string;
  workflow: string | null;
}

/* ---- sidebar tree ---- */
export interface TreeTask {
  id: string;
  name: string;
  time: string;
  active?: boolean;
}
export interface TreeWorkflow {
  id: string;
  name: string;
  open: boolean;
  tasks: TreeTask[];
}
export interface TreeProject {
  id: string;
  name: string;
  open: boolean;
  workflows: TreeWorkflow[];
}

/* ---- phases ---- */
export interface Phase {
  key: PhaseKey;
  label: string;
}
export interface RunDetail {
  label: string;
  lines: string[];
}

/* ---- gate card content ---- */
export interface GateAction {
  label: string;
  cls: string;
  key: string;
}
export interface GateStrip {
  file: string;
  pass?: string;
  fail?: string;
  diff?: boolean;
}
export interface Gate {
  tone?: 'warn' | 'danger' | 'error' | 'done';
  badge: string;
  title: string;
  meta: string;
  summary: string[];
  strip?: GateStrip;
  showSpecLink?: boolean;
  showReportLink?: boolean;
  primary?: string;
  next?: string;
  danger?: boolean;
  actions?: GateAction[];
  error?: boolean;
  retryPhase?: string;
}

/* ---- artifact fixtures ---- */
export type YamlSeg = [string, string];
export interface YamlLine {
  n: number;
  t: YamlSeg[];
}
export interface Linter {
  name: string;
  pass: boolean;
  msg: string;
}
export interface DiffCell {
  n: number;
  txt: string;
  k: string;
}
export interface DiffRow {
  l: DiffCell | null;
  r: DiffCell | null;
}
export interface ReportRow {
  k: string;
  v: string;
  ok: boolean;
}

/* ---- chat thread ---- */
export type ThreadItem =
  | { id: string; type: 'user'; text: string }
  | { id: string; type: 'run'; phase: PhaseKey; running: boolean }
  | { id: string; type: 'gate'; gateKey: GateKey; resolved?: string };

export type ThreadInput =
  | { type: 'user'; text: string }
  | { type: 'run'; phase: PhaseKey; running: boolean }
  | { type: 'gate'; gateKey: GateKey; resolved?: string };

export type GateItem = Extract<ThreadItem, { type: 'gate' }>;

/* ---- create-project modal ---- */
export interface FolderEntry {
  id: string;
  name: string;
  path: string;
}
