/**
 * orchestrator-shared.ts — leaf helpers shared by the gate FSM ([orchestrator.ts]) and the IO modules
 * extracted out of it ([scaffold.ts], [import.ts]) for spec 019 L2.
 *
 * Kept in a dependency-LEAF module so the extracted IO modules can import `emit` / `resolveRunners` /
 * the ctx types WITHOUT importing `orchestrator.ts` (which would form an import cycle: orchestrator →
 * scaffold → orchestrator). Every definition here is MOVED VERBATIM from orchestrator.ts — behavior is
 * unchanged; only its home moved. The 33 in-orchestrator call-sites reference these by the same names
 * via a plain `import`, so they are untouched.
 */
import type { SessionLogger } from './claude-session.js';
import { postTurnCheck as realPostTurnCheck } from './post-turn.js';
import { runPython as realRunPython } from './shell.js';
import { runTurn as realRunTurn } from './turn-runner.js';
import { runReport as realRunReport } from './report.js';
import {
  resolveLlmModels as realResolveLlmModels,
  deployWithModel as realDeployWithModel,
  importForTest as realImportForTest,
  mintAppKey as realMintAppKey,
  publishWorkflow as realPublishWorkflow,
  runWorkflow as realRunWorkflow,
  uploadSampleFile as realUploadSampleFile,
  deleteApp as realDeleteApp,
} from './dify-io.js';
import { saveTask, toWireTask, type Task } from '../state/task.js';

/**
 * Injectable subprocess seams (spec 013 D2, fixes C2). The orchestrator's verdict/advance code hard-
 * imports the runners that spawn a `claude` turn / a python subprocess / the report — so the riskiest
 * behaviors (AC #15 auto hands-free, AC #25 auto hard-stop / never-auto-import-lint≠0, AC #23
 * confinement revert) could only be exercised with a REAL claude turn + git tree. These optional seams
 * default to the real impls; production is untouched (absent ⇒ identical behavior) and only tests
 * inject fakes. `postTurnCheck` is included (beyond the spec's runTurn/runReport/runPython) because the
 * ③ Implement verdict flows through it — without it the advance ladder can't be driven without a real
 * `.venv` (013 Q3 seam scope).
 */
export interface OrchestratorRunners {
  runTurn: typeof realRunTurn;
  runPython: typeof realRunPython;
  runReport: typeof realRunReport;
  postTurnCheck: typeof realPostTurnCheck;
  /** Spec 032: the live-test Dify ops (each shells sync.py). Tests inject fakes here to drive
   *  runLiveTest without a real Dify; absent ⇒ the real dify-io impls. */
  liveOps?: Partial<LiveOps>;
}

/** Spec 032 (S3-wiring-b) — the injectable live-test Dify ops seam (resolved by {@link resolveLiveOps}). */
export interface LiveOps {
  resolveLlmModels: typeof realResolveLlmModels;
  deployWithModel: typeof realDeployWithModel;
  importForTest: typeof realImportForTest;
  mintAppKey: typeof realMintAppKey;
  publishWorkflow: typeof realPublishWorkflow;
  runWorkflow: typeof realRunWorkflow;
  uploadSampleFile: typeof realUploadSampleFile;
  deleteApp: typeof realDeleteApp;
}

export interface OrchestratorCtx {
  projectsDir: string;
  /** ABSOLUTE path to apps/builder/headless-settings.json. */
  settingsPath: string;
  log: SessionLogger;
  /**
   * Lát 4 SSE relay (optional — curl/dev runs pass nothing). Called at every phase/status/gate
   * transition with the full task (`task:update`) and with each streamed assistant fragment
   * (`phase:output`). Pure side-channel: it never alters the state machine (the orchestrator runs
   * identically with or without it).
   */
  broadcast?: (taskId: string, event: string, data: unknown) => void;
  /** 013 D2: tests inject subprocess fakes here; absent ⇒ the real impls (no behavior change). */
  runners?: Partial<OrchestratorRunners>;
}

/** A user-edited slug/name carried on the ②→③ `/confirm` (AC #18). Spec 036: `keepCurrent` rides a
 *  `cleanup_apps` confirm — delete only the OLD test apps (keep the current one) vs delete ALL. */
export interface ConfirmPayload {
  slug?: string;
  name?: string;
  keepCurrent?: boolean;
}

/** Resolve the runner seams once: each falls back to its real impl when not injected. */
export function resolveRunners(ctx: OrchestratorCtx): OrchestratorRunners {
  const r = ctx.runners ?? {};
  return {
    runTurn: r.runTurn ?? realRunTurn,
    runPython: r.runPython ?? realRunPython,
    runReport: r.runReport ?? realRunReport,
    postTurnCheck: r.postTurnCheck ?? realPostTurnCheck,
  };
}

/** Resolve the live-test Dify ops (spec 032): each falls back to its real dify-io impl when not injected. */
export function resolveLiveOps(ctx: OrchestratorCtx): LiveOps {
  const o = ctx.runners?.liveOps ?? {};
  return {
    resolveLlmModels: o.resolveLlmModels ?? realResolveLlmModels,
    deployWithModel: o.deployWithModel ?? realDeployWithModel,
    importForTest: o.importForTest ?? realImportForTest,
    mintAppKey: o.mintAppKey ?? realMintAppKey,
    publishWorkflow: o.publishWorkflow ?? realPublishWorkflow,
    runWorkflow: o.runWorkflow ?? realRunWorkflow,
    uploadSampleFile: o.uploadSampleFile ?? realUploadSampleFile,
    deleteApp: o.deleteApp ?? realDeleteApp,
  };
}

/**
 * Persist + relay the task state to the SSE clients (Lát 4). One call replaces a bare saveTask at
 * every UI-visible transition so the browser mirror stays in lock-step with task.json.
 */
export async function emit(task: Task, ctx: OrchestratorCtx): Promise<void> {
  // Bump the monotonic snapshot revision FIRST so the persisted file AND the broadcast carry the same
  // new `rev` (spec 014 D5 / 011 R8): the web store uses it to drop a late GET that would otherwise
  // clobber a newer live update. Every UI-visible transition flows through `emit`, so `rev` increases
  // exactly once per transition; direct `saveTask` calls (session-id persistence) never broadcast, so
  // they deliberately do not bump it.
  task.rev = (task.rev ?? 0) + 1;
  await saveTask(ctx.projectsDir, task);
  // Spec 036 S5: broadcast the WIRE shape — the persisted task + the computed `liveTargets` capability bit
  // (never persisted; recomputed here). saveTask above writes the plain task, so task.json stays clean.
  ctx.broadcast?.(task.taskId, 'task:update', toWireTask(task));
}

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Tag an Error with an HTTP status code the route maps to a response. */
export function httpError(statusCode: number, message: string): Error {
  const e = new Error(message) as Error & { statusCode?: number };
  e.statusCode = statusCode;
  return e;
}
