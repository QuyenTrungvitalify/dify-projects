/**
 * Spec 111 — a RETRY out of error must carry the phase's own instructions, and the verdict it failed on.
 *
 * The evidence is a natural experiment inside one task, one session, one afternoon (1787273481220,
 * 2026-08-21). Three retries of the same failing ③:
 *
 *   10:31  "bạn đan gặp lỗi gì v"   → 0 tool calls, same error       ($1.42)
 *   12:49  "tiếp tục đi dc ko?"     → 0 tool calls, same error       ($1.52)
 *   17:24  (Retry button, no text)  → wrote main.yml, build recovered ($4.58)
 *
 * The difference is not the wording. `resumePrompt` branched on `opts?.replyText`, and an empty string
 * is FALSY — so the button-with-no-text fell through to `freshPrompt` and got the skill body back,
 * including the one sentence naming the path the backend actually grades. A retry that types a single
 * word lost it, and the model — which had built a perfectly good workflow in ANOTHER project's folder —
 * kept answering "there are no errors left", because from inside the session that was true.
 *
 * So the assertion is not "the reason string appears". It is: **a retry gets the same prompt the button
 * gets, plus what went wrong.** Drop either half and one of these goes red.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { startTask, confirmAdvance, replyWithin, type OrchestratorCtx } from '../server/lib/orchestrator.js';
import { acquireTurn, releaseTurn } from '../server/lib/lock.js';
import { createTask, type Task } from '../server/state/task.js';
import { PHASES } from '../server/lib/phases.js';
import { applyInitFake } from './helpers/scaffold-fake.js';
import type { ClaudeSession, SessionLogger } from '../server/lib/claude-session.js';
import type { TurnResult } from '../server/lib/turn-runner.js';
import type { PostTurnParams, PostTurnResult } from '../server/lib/post-turn.js';
import type { ReportResult, ReportOpts } from '../server/lib/report.js';
import type { ShellResult } from '../server/lib/shell.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;

/** The verdict the real run died on, verbatim — including the path nobody wrote to. */
const VERDICT = 'artifact missing: projects/_drafts/wf/workflows/main.yml';
/** Present in the ③ skill body and nowhere else: the marker for "this turn was told what phase it is". */
const SKILL_MARK = '# implement';

let dir: string;
let current: Task | null = null;

function fixtureDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'retry-prompt-'));
  const skill = join(d, '.claude', 'skills', 'dify-build');
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, 'analyze.md'), '# analyze\nrequirement: {{REQUIREMENT}}\n');
  writeFileSync(join(skill, 'spec.md'), '# spec\nrequirement: {{REQUIREMENT}}\n');
  writeFileSync(join(skill, 'implement.md'), '# implement\nreq: {{REQUIREMENT}}\nfile: {{WORKFLOW_FILE}}\n{{KNOWLEDGE}}\n## Do\n');
  return d;
}

interface Ctl {
  /** Fail the NEXT ③ verify the way the real run failed: the artifact the backend grades is not there. */
  failNextImplement?: boolean;
}

function harness(d: string, prompts: string[], ctl: Ctl = {}): OrchestratorCtx {
  const runTurn = async (_s: ClaudeSession, prompt: string): Promise<TurnResult> => {
    prompts.push(prompt);
    const task = current!;
    const phase = PHASES.find((p) => p.id === task.phase)!;
    const abs = join(d, phase.artifactRel(task));
    mkdirSync(dirname(abs), { recursive: true });
    if (task.phase === 'analyze') writeFileSync(abs, '{"seed": null, "summary": "ok"}');
    else if (task.phase === 'spec') writeFileSync(abs, '# SPEC\nbuild it.\n');
    else writeFileSync(abs, 'workflow:\n  graph:\n    nodes: []\n');
    return { sessionId: `sess-${task.phase}`, result: { type: 'result', is_error: false }, isError: false };
  };
  const runPython = async (_p: string, args: string[]): Promise<ShellResult> => {
    applyInitFake(d, args);
    return { code: 0, stdout: '', stderr: '' };
  };
  const postTurnCheck = async (_p: PostTurnParams): Promise<PostTurnResult> => {
    if (ctl.failNextImplement) {
      ctl.failNextImplement = false; // one failure, then the retry verifies clean
      return {
        ok: false, status: 'error', reasons: [VERDICT],
        detail: { artifactOk: false, yamlOk: false, idsOk: false, confinementBreaches: [], extraFiles: [], lintCodes: null },
      };
    }
    return {
      ok: true, status: 'done', reasons: [],
      detail: {
        artifactOk: true, yamlOk: true, idsOk: true, confinementBreaches: [], extraFiles: [],
        lintCodes: { validate: 0, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 0 },
      },
    };
  };
  const runReport = async (_d: string, t: Task, _l: SessionLogger, _o?: ReportOpts): Promise<ReportResult> => ({
    ok: true, reasons: [], reportRel: `apps/builder/.runs/${t.taskId}/report.json`, lintClean: true,
  });
  return {
    projectsDir: d, settingsPath: '', log, broadcast: () => {},
    runners: { runTurn, runPython, runReport, postTurnCheck },
  };
}

async function withTurn(taskId: string, work: () => Promise<void>): Promise<void> {
  assert.ok(acquireTurn(taskId));
  try {
    await work();
  } finally {
    releaseTurn(taskId);
  }
}

/** ① → ② → ③, with ③ dying on the verdict above: a build parked at `status:'error'`. */
async function driveToFailedImplement(): Promise<{ task: Task; ctx: OrchestratorCtx; prompts: string[] }> {
  const prompts: string[] = [];
  const ctx = harness(dir, prompts, { failNextImplement: true });
  const task = await createTask(dir, { requirement: 'r', deploy: 'none' });
  current = task;
  await withTurn(task.taskId, () => startTask(task, ctx));
  await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx));
  await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx));
  assert.equal(task.phase, 'implement');
  assert.equal(task.status, 'error', 'precondition: ③ failed the way the real run failed');
  return { task, ctx, prompts };
}

afterEach(() => {
  current = null;
  rmSync(dir, { recursive: true, force: true });
});

describe('111 · a retry out of error is not a bare change request', () => {
  test('typing a word with the Retry must not cost the turn its instructions', async () => {
    dir = fixtureDir();
    const { task, ctx, prompts } = await driveToFailedImplement();

    await withTurn(task.taskId, () => replyWithin(task, 'bạn đang gặp lỗi gì vậy', ctx));

    const retry = prompts[prompts.length - 1];
    assert.ok(retry.includes(SKILL_MARK), 'the phase body rides the retry — this is what the no-text Retry got for free');
    assert.ok(retry.includes('bạn đang gặp lỗi gì vậy'), 'and the human\'s words are still there');
  });

  test('the retry is told what it failed on, verbatim, and where the backend looks', async () => {
    dir = fixtureDir();
    const { task, ctx, prompts } = await driveToFailedImplement();

    await withTurn(task.taskId, () => replyWithin(task, 'tiếp tục đi', ctx));

    const retry = prompts[prompts.length - 1];
    assert.ok(retry.includes(VERDICT), 'the backend verdict, not a paraphrase');
    assert.ok(
      retry.includes('projects/_drafts/wf/workflows/main.yml'),
      'and the graded path — the fact the failing session provably did not have',
    );
  });

  test('an ORDINARY revision is untouched: no verdict, no re-sent body', async () => {
    // The gate is `status === 'error'`, not "is a /reply". A fix round on a healthy build must keep
    // costing one short prompt — re-sending the skill body to a session mid-conversation is the exact
    // waste `resumePrompt` exists to avoid (and it reads as "start over" to the model).
    dir = fixtureDir();
    const prompts: string[] = [];
    const ctx = harness(dir, prompts);
    const task = await createTask(dir, { requirement: 'r', deploy: 'none' });
    current = task;
    await withTurn(task.taskId, () => startTask(task, ctx));
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx));
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx));
    assert.equal(task.status, 'awaiting_confirm', 'precondition: a clean ③, parked at its gate');

    await withTurn(task.taskId, () => replyWithin(task, 'hạ ngưỡng xuống 0.2', ctx));

    const revision = prompts[prompts.length - 1];
    // `includes`, not `^`: a Vietnamese reply prepends the language pin (spec 093), so the change
    // request is not necessarily the first line — only the whole prompt.
    assert.ok(revision.includes('## Change request'), 'still the short resume shape');
    assert.ok(!revision.includes(SKILL_MARK), 'no skill body');
    assert.ok(!revision.includes('đánh trượt'), 'and nothing about a verdict that never happened');
  });
});
