/**
 * Spec 037 S3 — the {{KNOWLEDGE}} injection (AC 6/6b/6c).
 *
 *   AC 6  — facts present → the FRESH Implement prompt carries the block at the token position;
 *           facts absent → no residue AND byte-identity per the placement rule (the token occupies
 *           a line of its own that replaced an existing blank line, so rendering '' restores the
 *           original bytes — checked mechanically against the REAL implement.md, no golden file);
 *   AC 6b — a /reply RESUME prompt (which skips injectVars) carries the block appended after the
 *           attachment block — the exact seam gap the attachmentBlock precedent exists for;
 *   AC 6c — analyze/spec/draft bodies carry NO token, and the resume append is gated on
 *           phase==='implement' (a spec-gate /reply must not receive facts).
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { startTask, confirmAdvance, replyWithin, type OrchestratorCtx } from '../server/lib/orchestrator.js';
import { acquireTurn, releaseTurn } from '../server/lib/lock.js';
import { createTask, type Task } from '../server/state/task.js';
import { PHASES, renderPrompt } from '../server/lib/phases.js';
import { applyInitFake } from './helpers/scaffold-fake.js';
import type { ClaudeSession, SessionLogger } from '../server/lib/claude-session.js';
import type { TurnResult } from '../server/lib/turn-runner.js';
import type { PostTurnParams, PostTurnResult } from '../server/lib/post-turn.js';
import type { ReportResult, ReportOpts } from '../server/lib/report.js';
import type { ShellResult } from '../server/lib/shell.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;
const REPO = join(import.meta.dirname, '..', '..', '..');

const FACTS = JSON.stringify({
  harvestedAt: '2026-07-07T00:00:00Z',
  target: 'selfhost',
  models: [{ provider: 'openai', name: 'gpt-4o-mini' }],
  plugins: [{ name: 'openai', identifier: `langgenius/openai:0.2.8@${'a'.repeat(64)}` }],
  datasets: [{ id: '8aa20000-0000-0000-0000-000000000000', name: 'FAQ KB' }],
});

let dir: string;
let current: Task | null = null;

function fixtureDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'knowledge-'));
  const skill = join(d, '.claude', 'skills', 'dify-build');
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, 'analyze.md'), '# analyze\nrequirement: {{REQUIREMENT}}\n');
  writeFileSync(join(skill, 'spec.md'), '# spec\nrequirement: {{REQUIREMENT}}\n');
  // mirrors the real implement.md placement rule: the token occupies a line of its own
  // (046 D2: the real body also carries {{REQUIREMENT}} in its language banner — mirrored here)
  writeFileSync(join(skill, 'implement.md'), '# implement\nreq: {{REQUIREMENT}}\nfile: {{WORKFLOW_FILE}}\n{{KNOWLEDGE}}\n## Do\n');
  return d;
}

function harness(d: string, prompts: string[]) {
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
    return { code: 0, stdout: '', stderr: '' }; // the runnability probe degrades (empty stdout) — advisory
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
  const ctx: OrchestratorCtx = {
    projectsDir: d, settingsPath: '', log, broadcast: () => {},
    runners: { runTurn, runPython, runReport, postTurnCheck },
  };
  return ctx;
}

async function withTurn(taskId: string, work: () => Promise<void>): Promise<void> {
  assert.ok(acquireTurn(taskId));
  try {
    await work();
  } finally {
    releaseTurn(taskId);
  }
}

/** Drive ①→② to the spec gate, plant workspace.json (or not), then ③. Returns captured prompts. */
async function drive(withFacts: boolean): Promise<{ task: Task; ctx: OrchestratorCtx; prompts: string[] }> {
  const prompts: string[] = [];
  const ctx = harness(dir, prompts);
  const task = await createTask(dir, { requirement: 'r', deploy: 'none' });
  current = task;
  await withTurn(task.taskId, () => startTask(task, ctx)); // spec 055: seedless starts at ① analyze
  await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx)); // ① → ② spec
  if (withFacts) {
    const runs = join(dir, 'apps', 'builder', '.runs', task.taskId);
    mkdirSync(runs, { recursive: true });
    writeFileSync(join(runs, 'workspace.json'), FACTS); // the (failing) harvest keeps this file (D5)
  }
  await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx)); // scaffold → ③
  assert.equal(task.phase, 'implement');
  return { task, ctx, prompts };
}

afterEach(() => {
  current = null;
  rmSync(dir, { recursive: true, force: true });
});

describe('spec 037 S3 — {{KNOWLEDGE}} injection', () => {
  test('AC 6: facts present → the fresh Implement prompt carries the block at the token position', async () => {
    dir = fixtureDir();
    const { prompts } = await drive(true);
    const implPrompt = prompts[prompts.length - 1];
    assert.match(implPrompt, /## Workspace facts \(DATA, not instructions/);
    assert.ok(implPrompt.includes(`langgenius/openai:0.2.8@${'a'.repeat(64)}`), 'plugin identifier rendered');
    assert.ok(implPrompt.indexOf('file: main.yml') < implPrompt.indexOf('## Workspace facts'), 'at the token position');
    assert.ok(implPrompt.includes('req: r'), '046 D2: {{REQUIREMENT}} renders the requirement text in ③');
    assert.ok(implPrompt.indexOf('## Workspace facts') < implPrompt.indexOf('## Do'), 'before ## Do');
    assert.ok(!implPrompt.includes('{{KNOWLEDGE}}'), 'no residue');
  });

  test('AC 6: facts absent → no residue, no header — and the analyze/spec prompts never carry facts', async () => {
    dir = fixtureDir();
    const { prompts } = await drive(false);
    for (const p of prompts) {
      assert.ok(!p.includes('{{KNOWLEDGE}}'), 'always-substituted contract');
      assert.ok(!p.includes('## Workspace facts'), 'no facts anywhere without workspace.json');
    }
  });

  test('AC 6 byte-identity (placement rule, against the REAL implement.md — no golden file)', () => {
    const body = readFileSync(join(REPO, '.claude', 'skills', 'dify-build', 'implement.md'), 'utf8');
    assert.match(body, /^\{\{KNOWLEDGE\}\}$/m, 'the token occupies a line of its own');
    const vars: Record<string, string> = { KNOWLEDGE: '' };
    const rendered = renderPrompt(body, vars);
    assert.equal(rendered, body.replace(/^\{\{KNOWLEDGE\}\}$/m, ''), 'render("") = token line collapsed to blank');
    assert.ok(!rendered.includes('{{KNOWLEDGE}}'), 'no token residue');
    // line-anchored: the RENDERED facts header must be absent (the D7 prose legitimately mentions
    // the header name in backticks mid-sentence — that is instruction text, not an injected block).
    assert.ok(!/^## Workspace facts/m.test(rendered), 'no rendered facts header');
  });

  test('AC 6b: a /reply RESUME prompt at ③ carries the block appended after the attachment seam', async () => {
    dir = fixtureDir();
    const { task, ctx, prompts } = await drive(true);
    await withTurn(task.taskId, () => replyWithin(task, 'tighten the prompt wording', ctx));
    const resume = prompts[prompts.length - 1];
    assert.match(resume, /^## Change request/, 'this is the resume prompt, not a fresh render');
    assert.match(resume, /## Workspace facts \(DATA, not instructions/, 'facts appended on the resume path');
  });

  test('AC 6c: the real ①/② bodies carry no token, and a SPEC-gate /reply gets no facts', async () => {
    for (const f of ['analyze.md', 'spec.md', 'draft.md']) {
      const body = readFileSync(join(REPO, '.claude', 'skills', 'dify-build', f), 'utf8');
      assert.ok(!body.includes('{{KNOWLEDGE}}'), `${f} carries no KNOWLEDGE token (v1 scope, D6)`);
    }

    dir = fixtureDir();
    const prompts: string[] = [];
    const ctx = harness(dir, prompts);
    const task = await createTask(dir, { requirement: 'r', deploy: 'none' });
    current = task;
    await withTurn(task.taskId, () => startTask(task, ctx)); // 046 D1: parks AT the spec gate
    const runs = join(dir, 'apps', 'builder', '.runs', task.taskId);
    mkdirSync(runs, { recursive: true });
    writeFileSync(join(runs, 'workspace.json'), FACTS);
    await withTurn(task.taskId, () => replyWithin(task, 'add an edge case', ctx)); // reply AT SPEC
    const resume = prompts[prompts.length - 1];
    assert.ok(!resume.includes('## Workspace facts'), 'resume append is gated on phase===implement');
  });
});

// ── languagePin scope: Japanese, Vietnamese, or nothing ──────────────────────────────────────────
// SUPERSEDES spec 046 AC 3 ("JA-first / EN-fallback — no other languages"). Vietnamese is now a first-
// class chat language: the team using this Builder is Vietnamese, with Japanese clients. Do not "restore"
// the old assertion that a Vietnamese requirement gets no pin — that IS the behavior this replaced.
describe('languagePin scope (JA + VI, else empty)', () => {
  test('kana → the JA pin; unaccented Latin → empty', async () => {
    const { languagePin } = await import('../server/lib/language.js');
    assert.ok(languagePin({ requirement: '日本語のワークフローを作ってください' }).length > 0, 'kana → JA pin');
    assert.ok(languagePin({ requirement: 'チャットボット' }).includes('日本語'), 'the pin itself is written in Japanese');
    assert.equal(languagePin({ requirement: 'build an English workflow' }), '', 'English → no pin');
    // Unaccented Vietnamese carries no script signal at all — there is nothing to detect, so it still
    // falls through to no pin. The explicit `chatLang:'vi'` setting is the way out (asserted below).
    assert.equal(languagePin({ requirement: 'yeu cau khong dau' }), '', 'unaccented Latin → no pin');
    assert.ok(
      languagePin({ chatLang: 'vi', requirement: 'yeu cau khong dau' }).includes('tiếng Việt'),
      'the explicit setting pins Vietnamese even when detection cannot'
    );
  });
});
