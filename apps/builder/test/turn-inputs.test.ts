/**
 * The input header — a turn must be told, by NAME, what it is running on.
 *
 * Run 1787725122513 (haiku-4-5, 2026-08-26): ① replied 「tôi chưa nhận được yêu cầu cụ thể」, made
 * zero tool calls, and died `artifact missing: …/analyze.json`. The requirement was in the prompt —
 * eight times — but only as substituted VALUES inside a payload the prompt introduces as an inlined
 * skill file, so the turn read the whole thing as a manual it had been shown and waited for a user
 * message that was never coming. The Retry re-sent the same body plus the verdict (spec 111) and got
 * the identical answer: deterministic, therefore unrecoverable by retry.
 *
 * Replay of that exact prompt, one variable at a time: haiku asks (1 turn) · sonnet on the SAME
 * prompt writes the overview (8 turns) · haiku WITH this header writes it (11 turns) · haiku with
 * only the empty `{{SEED_PATH}}` slot filled still asks. The name on the value is what carries it.
 *
 * So the assertions here are not "some text is present". They are the three properties that failure
 * had no one of: the requirement arrives NAMED, an absent seed says so IN WORDS, and the graded path
 * is handed over. Plus the two boundaries — the header rides the Retry (which is exactly the round
 * that needs it), and ③ does not get it (its carrier is the approved SPEC.md, spec 105).
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { startTask, confirmAdvance, replyWithin, type OrchestratorCtx } from '../server/lib/orchestrator.js';
import { acquireTurn, releaseTurn } from '../server/lib/lock.js';
import { createTask, type Task } from '../server/state/task.js';
import { PHASES, inputHeader } from '../server/lib/phases.js';
import { applyInitFake } from './helpers/scaffold-fake.js';
import type { ClaudeSession, SessionLogger } from '../server/lib/claude-session.js';
import type { TurnResult } from '../server/lib/turn-runner.js';
import type { PostTurnParams, PostTurnResult } from '../server/lib/post-turn.js';
import type { ReportResult, ReportOpts } from '../server/lib/report.js';
import type { ShellResult } from '../server/lib/shell.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;

/** The real requirement of the run this file exists for. */
const REQ = '簡単LLMチャットボット作成お願いします。';
/** Present in the ③ skill body and nowhere else. */
const IMPLEMENT_MARK = '# implement';
/** The header's own marker — one string, so a rename has to come through here. */
const HEADER = '## Inputs for THIS turn';

let dir: string;
let current: Task | null = null;

function fixtureDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'turn-inputs-'));
  const skill = join(d, '.claude', 'skills', 'dify-build');
  mkdirSync(skill, { recursive: true });
  // The fixture bodies deliberately carry the SAME shape the real docs do — a bare substituted value
  // with no label — so a test that passes cannot be passing on the body's own wording.
  writeFileSync(join(skill, 'analyze.md'), '# analyze\n- `{{REQUIREMENT}}` — what the user wants.\n- `{{SEED_PATH}}` — a seed.\n');
  writeFileSync(join(skill, 'spec.md'), '# spec\n- `{{REQUIREMENT}}` — the target behavior.\n');
  writeFileSync(join(skill, 'implement.md'), '# implement\nreq: {{REQUIREMENT}}\nfile: {{WORKFLOW_FILE}}\n{{KNOWLEDGE}}\n## Do\n');
  return d;
}

interface Ctl {
  /** Fail ① the way the real run failed: the turn "completes" and writes nothing. */
  failNextAnalyze?: boolean;
}

function harness(d: string, prompts: string[], ctl: Ctl = {}): OrchestratorCtx {
  const runTurn = async (_s: ClaudeSession, prompt: string): Promise<TurnResult> => {
    prompts.push(prompt);
    const task = current!;
    const phase = PHASES.find((p) => p.id === task.phase)!;
    const abs = join(d, phase.artifactRel(task));
    const skip = task.phase === 'analyze' && ctl.failNextAnalyze;
    if (skip) ctl.failNextAnalyze = false; // one failure; the retry then behaves
    if (!skip) {
      mkdirSync(dirname(abs), { recursive: true });
      if (task.phase === 'analyze') writeFileSync(abs, '{"seed": null, "summary": "ok"}');
      else if (task.phase === 'spec') writeFileSync(abs, '# SPEC\nbuild it.\n');
      else writeFileSync(abs, 'workflow:\n  graph:\n    nodes: []\n');
    }
    return { sessionId: `sess-${task.phase}`, result: { type: 'result', is_error: false }, isError: false };
  };
  const runPython = async (_p: string, args: string[]): Promise<ShellResult> => {
    applyInitFake(d, args);
    return { code: 0, stdout: '', stderr: '' };
  };
  const postTurnCheck = async (_p: PostTurnParams): Promise<PostTurnResult> => ({
    ok: true, status: 'done', reasons: [],
    detail: {
      artifactOk: true, yamlOk: true, idsOk: true, confinementBreaches: [], extraFiles: [],
      lintCodes: { validate: 0, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 0 },
    },
  });
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

afterEach(() => {
  current = null;
  rmSync(dir, { recursive: true, force: true });
});

describe('the input header — a turn is told by name what it is running on', () => {
  test('① is handed the requirement NAMED, the absent seed IN WORDS, and the graded path', async () => {
    dir = fixtureDir();
    const prompts: string[] = [];
    const ctx = harness(dir, prompts);
    const task = await createTask(dir, { requirement: REQ, deploy: 'none' });
    current = task;

    await withTurn(task.taskId, () => startTask(task, ctx));

    const p = prompts[0];
    assert.ok(p.includes(HEADER), 'the header rides ①');
    assert.ok(
      /REQUIREMENT — what the user asked for, verbatim: 簡単LLMチャットボット作成お願いします。/.test(p),
      'the requirement arrives with a NAME on it, not as a bare value inside the manual',
    );
    assert.ok(
      p.includes('EMPTY: no seed workflow, this is a from-scratch build'),
      'an absent seed is stated in words — the rendered manual can only show an empty `` span',
    );
    assert.ok(
      p.includes(`apps/builder/.runs/${task.taskId}/analyze.json`),
      'and the path the backend grades is handed over, not left to be derived',
    );
    // Order is load-bearing on both sides: the language pin must stay token-one (spec 093), and
    // `docOrigin`'s "the document below" must still name the manual directly beneath it.
    assert.ok(p.indexOf(HEADER) < p.indexOf('# analyze'), 'the header stands ABOVE the manual');
    assert.ok(p.indexOf(HEADER) < p.indexOf('inlined here'), 'and above the doc-origin line it must not displace');
  });

  test('② gets it too — its input is the same requirement', async () => {
    dir = fixtureDir();
    const prompts: string[] = [];
    const ctx = harness(dir, prompts);
    const task = await createTask(dir, { requirement: REQ, deploy: 'none' });
    current = task;
    await withTurn(task.taskId, () => startTask(task, ctx));
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx));

    const p = prompts[prompts.length - 1];
    assert.equal(task.phase, 'spec');
    assert.ok(p.includes(HEADER) && p.includes(REQ), 'named requirement at ② as well');
    assert.ok(p.includes('SPEC.md'), 'pointing at the file ② is graded on');
  });

  test('③ does NOT get it — its carrier is the approved SPEC.md, not the raw sentence', async () => {
    // Deliberate boundary, not an omission: hoisting the user's original words above the document ②
    // wrote from them (and a human approved) argues with the file ③ is ordered to build. Spec 105
    // hands ③ the requirement only when there IS no ② — and then as a change request.
    dir = fixtureDir();
    const prompts: string[] = [];
    const ctx = harness(dir, prompts);
    const task = await createTask(dir, { requirement: REQ, deploy: 'none' });
    current = task;
    await withTurn(task.taskId, () => startTask(task, ctx));
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx));
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx));

    const p = prompts[prompts.length - 1];
    assert.ok(p.includes(IMPLEMENT_MARK), 'precondition: this is the ③ prompt');
    assert.ok(!p.includes(HEADER), '③ is left alone');
  });

  test('the Retry out of error carries the header — that is the round that needs it most', async () => {
    dir = fixtureDir();
    const prompts: string[] = [];
    const ctx = harness(dir, prompts, { failNextAnalyze: true });
    const task = await createTask(dir, { requirement: REQ, deploy: 'none' });
    current = task;
    await withTurn(task.taskId, () => startTask(task, ctx));
    assert.equal(task.status, 'error', 'precondition: ① died with nothing written, as run 1787725122513 did');

    await withTurn(task.taskId, () => replyWithin(task, '', ctx));

    const retry = prompts[prompts.length - 1];
    assert.ok(retry.includes(HEADER) && retry.includes(REQ), 'the re-sent round names its inputs');
    assert.ok(retry.includes('đánh trượt'), 'and still carries the verdict it failed on (spec 111)');
  });

  test('a multi-line requirement survives verbatim, and cannot be read as the header\'s own prose', () => {
    const task = { requirement: 'sửa workflow này:\n/tmp/a.yml\n- thêm retry', seedPath: null, taskId: '42' } as Task;
    const analyze = PHASES.find((p) => p.id === 'analyze')!;
    const h = inputHeader(analyze, task);
    for (const line of task.requirement.split('\n')) assert.ok(h.includes(line), `line kept: ${line}`);
    assert.ok(h.includes('\n  /tmp/a.yml\n'), 'continuation lines are indented under the bullet, not left flush');
  });

  test('a seeded build names the seed FILE instead of claiming there is none', () => {
    const task = { requirement: 'r', seedPath: 'projects/p/w/workflows/main.yml', taskId: '42' } as Task;
    const h = inputHeader(PHASES.find((p) => p.id === 'analyze')!, task);
    assert.ok(h.includes('the existing workflow this build edits: `projects/p/w/workflows/main.yml`'));
    assert.ok(!h.includes('from-scratch'), 'and never both at once');
  });
});
