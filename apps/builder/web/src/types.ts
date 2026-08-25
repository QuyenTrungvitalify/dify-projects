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
  // spec 052: the promote build's three parked gates (blocked / distill-failed / review-before-Approve).
  // spec 081: the two post-finalize share gates (offer / preflight-review-before-push).
  flag?:
    | 'still_failing'
    | 'awaiting_import'
    | 'test_result'
    | 'infra_degraded'
    | 'promote_blocked'
    | 'promote_distill_failed'
    | 'promote_review'
    | 'promote_share_offer'
    | 'promote_share_review'
    /** spec 103 Lane B: a spec proposal is waiting for a human. `auto` hard-stops here server-side. */
    | 'spec_proposal';
}

/** spec 081 — the share-upstream state on a promote task (mirrors server PromoteShare). */
export interface WirePromoteShare {
  state: 'review' | 'pushed' | 'failed';
  /** spec 083: 'drop' = POSTed to the team drop URL (primary); 'git' = contrib/* branch (fallback). */
  mode?: 'drop' | 'git';
  findings?: { kind: string; line: number; excerpt: string }[];
  dup?: string;
  note?: string;
  branch?: string;
  error?: string;
}

/** spec 052 — the promotion state on a `kind:'promote'` Task (mirrors server PromoteState). */
export interface WirePromote {
  sourceFile: string;
  project: string;
  workflow: string;
  slug: string;
  staged?: string;
  target?: string;
  verdict?: { eligible: boolean; reasons: string[]; probe: string; probeDetail?: string; knownGoodDify?: string | null };
  note?: string;
  /** spec 081: present only while/after the share turn ran (absent = never offered or skipped). */
  share?: WirePromoteShare;
  /** spec 084: the distill turn's persisted output — replayed as a run disclosure when the task is opened
   *  after it finished (a bg distill's live SSE was never watched). Absent on a pre-084 snapshot. */
  distillLog?: string;
  /** spec 084 (DEV): a test distill — dry-run (never auto-finalizes) + tray-clearable. Absent ⇒ normal. */
  test?: boolean;
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
  /** spec 103 step 1: the unified diff of SPEC.md for the SAME fix round, rendered as a second section
   *  of the `差分` tab. `null` = no pre-round spec snapshot (a first build), which the panel renders as
   *  "no spec section" — NOT as "the spec did not change". */
  specDiff?: string | null;
}

export interface WireTask {
  taskId: string;
  /** spec 052: the build kind. Absent ⇒ 'build' (the ①②③④ pipeline). 'promote' = the gated distill flow.
   *  spec 082: 'consult' = the chat-first mode (born done, /ask-only, no phases/gates/artifacts). */
  kind?: 'build' | 'promote' | 'consult';
  /** spec 052: promotion state (present only on a `kind:'promote'` task). */
  promote?: WirePromote;
  /** spec 082 (rev): the persisted consult transcript — one {role,text} per message, in order. Only on a
   *  GET /api/tasks/:id for a `kind:'consult'` task; the FE rebuilds the chat thread from it on reopen. */
  chat?: {
    role: 'user' | 'assistant';
    text: string;
    /** spec: files the user's message carried — `idx` addresses `GET /api/tasks/:id/uploads/:idx`, so a
     *  reopened chat can still show them (the browser's copy of the bytes is long gone). */
    files?: { name: string; mime: string; idx: number }[];
    /** assistant lines: what that turn cost (the dev tip). A consult's thread is rebuilt from this
     *  transcript and that rebuild wins over localStorage, so the tip only survives a reload if it
     *  travels here. Absent on anything recorded before this field existed. */
    cost?: WirePhaseCost;
    /** this answer's turn started a fresh CLI session (the previous one had grown too expensive). */
    sessionReset?: boolean;
  }[];
  /** What each ATTEMPT of each phase cost, from the run timeline on disk — so a browser that never had
   *  this task open (or whose storage was cleared) still gets every round's numbers. `cost[phase]` keeps
   *  only the last re-run; this keeps them all, oldest first. */
  runCosts?: { phase: string; at: number; cost: WirePhaseCost }[];
  /** Every phase ATTEMPT this build streamed, oldest first, read from disk. A phase's output used to
   *  live only in the browser, so a cleared cache or another machine reduced a finished build to
   *  "requirement + current gate" — the reasoning was gone. Bounded server-side; `runsDropped` counts
   *  attempts left out rather than leaving an unmarked hole. */
  runs?: { ts: number; phase: WirePhase; output: string; cost?: WirePhaseCost; note?: string }[];
  runsDropped?: number;
  /** The LAST ask exchange on a BUILD, from the backend transcript — the one thing the client cannot
   *  rebuild by itself. `ask:answer` is excluded from the SSE replay buffer and a task switch drops the
   *  stream, so an answer that lands while the user is looking at another build is gone from the browser;
   *  this is what lets the reopened thread finish it instead of closing an empty bubble as "Answered".
   *  `q` is matched against the question the open bubble belongs to, so it can never graft the wrong
   *  answer. Absent on a consult (its full `chat` above is authoritative) and on any build never asked. */
  lastAsk?: { q: string; a: string; ok: boolean };
  project: string | null;
  workflow: string | null;
  workflowFile: string;
  requirement: string;
  seedPath: string | null;
  seedAppId?: string | null;
  deploy: 'none' | 'selfhost' | 'cloud';
  appId?: string | null;
  appUrl?: string | null;
  /** The Dify app this build's ④ Import owns — set once the first import lands, and the app every later
   *  import overwrites in place. Its presence is what tells the Import gate to promise an update rather
   *  than a new app. Distinct from `appId`, which the live-test path also writes (throwaway test apps). */
  importAppId?: string | null;
  /** spec 094 S1: the last ③ turn left the workflow file byte-identical — a fix round that changed
   *  nothing. `undefined` = not measured (pre-094 build): render nothing, never "unchanged". */
  artifactUnchanged?: boolean;
  /** spec 103 L0: the last ③ revision round changed the workflow and left SPEC.md untouched — the
   *  document no longer describes the file. `undefined` = not measured (a first Implement, or a build
   *  predating 103): render nothing, never "stale". Mutually exclusive with `artifactUnchanged:true`
   *  by construction — it requires the workflow to have changed. */
  specStale?: boolean;
  /** spec 103 step 1: a complete pre-round snapshot pair exists, so the ③ gate may offer to take the
   *  last fix back. A hint — the server re-checks and 409s rather than half-restoring. */
  fixUndoable?: boolean;
  /** spec 103 step 1 follow-up: how many places in SPEC.md the last fix round touched. Absent ⇒ the
   *  spec did not move (or was not measured) — the card then says nothing about it. */
  specEdits?: number;
  /** spec 103 Lane B: a spec proposal is open — `SPEC.next.md` exists and `SPEC.md` is untouched.
   *  Blocks a second proposal, and tells the composer not to offer one. */
  specRevise?: boolean;
  /** spec 103 Lane B: the last proposal found nothing to change in the spec — shown once, at the gate
   *  the build returned to, so the round trip is explained instead of looking like nothing happened. */
  specNoop?: boolean;
  /** spec 094 S1: sha256 of the file as of the last ③ verify, and of the file at the last successful
   *  ④ import (+ when). Equal hashes ⇒ the Import button would push what Dify already has. */
  artifactHash?: string | null;
  importedHash?: string | null;
  importedAt?: number;
  confirmMode: WireConfirmMode;
  /** The build's own reply language ('auto' | 'vi' | 'ja'); absent on a task.json predating the field
   *  ⇒ read as 'auto'. Live-patchable (PATCH /api/tasks/:id), so the ⚙ menu renders THIS over the
   *  global default whenever a build is open — see lib/chat-lang.ts. */
  chatLang?: string;
  /** spec 096: the model family alias this task's turns spawn with (`opus`/`sonnet`/`haiku`/`fable`).
   *  Absent ⇒ nothing was pinned and the CLI picks — every task created before 096 reads that way, so
   *  the composer must render "not recorded" there rather than a default. Changeable after start
   *  (PATCH), including on a FINISHED build, because its follow-up Ask turns still spawn with it. */
  model?: string;
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
  /** Spec 037 S1: the runnability preflight advisory (backend-computed, set/cleared per implement
   *  verify) — rendered leading the ③ gate card summary. Advisory only, never blocks. */
  preflightNote?: string;
  /** Spec 078 S2: the self-harvest promote nudge (dev-surface ONLY — rendered in DevPanel under
   *  devMode, never in the chat notes). Set at ④ when a from-scratch, lint-clean build proves a
   *  shape absent from the curated shelf. */
  promoteHint?: string;
  /** spec 028 §5: set when an `auto`+fast build's merged draft found a non-single-LLM shape — the
   *  auto-advance hard-stopped at the Spec gate; shown (leading) on the Spec gate card. */
  fastReviewNote?: string;
  /** spec 111 + 108 S5: file edits the phase's verify did not cover — cross-project writes, and a
   *  ①/② turn's edits to the build's own workflow (with an inline lint verdict). Advisory — leads the
   *  gate card of EVERY phase; never blocks, nothing is reverted. */
  strayNote?: string;
  /** spec 012: repo-relative paths of images attached via the composer (persisted on the task). */
  attachments?: string[];
  /** present on GET /api/tasks/:id (not on SSE task:update). */
  artifactContents?: WireArtifacts;
  /** spec 059: per-phase turn cost/metrics (dev panel — `?dev=1`). Rides the wire via `toWireTask`.
   *  Absent on a pre-059 snapshot or a build that ran on old backend code. Every field optional. */
  cost?: { analyze?: WirePhaseCost; spec?: WirePhaseCost; implement?: WirePhaseCost; test?: WirePhaseCost };
}

/** spec 059: one phase's cost/metrics, mirrored from the backend `PhaseCost` (state/task.ts). Pure
 *  observability; a phase whose turn died before a `result` event has no entry. `cacheReadTokens` is
 *  the cold-start-cache signal (≈0 ⇒ each spawn re-pays full input price). */
export interface WirePhaseCost {
  durationMs?: number;
  apiDurationMs?: number;
  numTurns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  totalCostUsd?: number;
  at?: number;
  /** spec 062 #1: the model id that actually ran. The backend has always sent it (cost.ts reads it off
   *  the result event); it was simply missing from this interface until the dev tip needed to read it. */
  model?: string;
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
  /** Spec 090 S2: display-only grouping row (the `(unsaved)` bucket) — never an edit-existing base.
   *  Optional: an older server omits it and every row stays selectable (pre-090 behavior). */
  synthetic?: boolean;
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

/** A tab is a FILE (plus the run report), not a view of one. `diff` used to sit here as a fourth tab
 *  and had to hold BOTH files at once, with a table of contents to get between them — the rail existed
 *  only because the tab was carrying two documents. A diff is a way of LOOKING at a file, so it is a
 *  view mode inside that file's tab now (SpecMode / YamlMode in ArtifactPanel.tsx). */
export type ArtifactTab = 'spec' | 'yaml' | 'report';

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
