/* ============================================================
   types.ts — shared shapes for the static design shell.
   The backend wiring (live store/SSE/endpoints) is lat4-ui;
   these types describe the mock fixtures ported from data.jsx.
   ============================================================ */

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
