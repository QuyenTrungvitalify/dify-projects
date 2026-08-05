/**
 * Spec 090 S3 — ② verify adopts a misplaced SPEC.md before declaring it missing.
 *
 * The field failure (bundle builder-unsaved-1785901684698, reproduced as run 1785916628346): a
 * slug-set task whose ② turn wrote a GOOD SPEC.md to `.runs/<id>/` instead of `projects/…` died
 * `artifact missing` — and retry was a PERMANENT loop (the resume re-read the misplaced file,
 * concluded "already written", wrote nothing, died identically). With S3 the first verify adopts
 * the file into the canonical path, so the very first attempt survives.
 *
 * Same harness style as advance-loop.test.ts: real orchestrator/verify, stubbed runTurn that
 * plays the MISBEHAVING agent (writes to the run dir despite the slug being set).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { startTask, type OrchestratorCtx } from '../server/lib/orchestrator.js';
import { acquireTurn, releaseTurn, unmarkCancelled } from '../server/lib/lock.js';
import { createTask, type Task } from '../server/state/task.js';
import { PHASES } from '../server/lib/phases.js';
import type { ClaudeSession } from '../server/lib/claude-session.js';
import type { TurnResult } from '../server/lib/turn-runner.js';
import type { ShellResult } from '../server/lib/shell.js';

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spec-salvage-'));
  const skill = join(dir, '.claude', 'skills', 'dify-build');
  mkdirSync(skill, { recursive: true });
  for (const name of ['analyze', 'spec']) {
    writeFileSync(join(skill, `${name}.md`), `# ${name}\nrequirement: {{REQUIREMENT}}\npath: {{SPEC_PATH}}\n`);
  }
  return dir;
}

/** ctx whose runTurn writes ① correctly, then plays the LOST agent at ②: SPEC.md → run dir. */
function harness(dir: string, task: Task, specWrite: 'misplaced' | 'nothing' | 'canonical' | 'misplaced-empty') {
  const runTurn = async (_s: ClaudeSession, _p: string): Promise<TurnResult> => {
    if (task.phase === 'analyze') {
      const rel = PHASES.find((p) => p.id === 'analyze')!.artifactRel(task);
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), '{"seed": null, "summary": "ok"}');
    } else if (task.phase === 'spec') {
      const runsSpec = join(dir, `apps/builder/.runs/${task.taskId}/SPEC.md`);
      const canonical = join(dir, PHASES.find((p) => p.id === 'spec')!.artifactRel(task));
      mkdirSync(dirname(runsSpec), { recursive: true });
      if (specWrite === 'misplaced') writeFileSync(runsSpec, '# SPEC\ngood content, wrong house.\n');
      else if (specWrite === 'misplaced-empty') writeFileSync(runsSpec, '');
      else if (specWrite === 'canonical') {
        mkdirSync(dirname(canonical), { recursive: true });
        writeFileSync(canonical, '# SPEC\nright house.\n');
      } // 'nothing' → write nothing
    }
    return { sessionId: `sess-${task.phase}`, result: { type: 'result', is_error: false }, isError: false };
  };
  const runPython = async (): Promise<ShellResult> => ({ code: 0, stdout: '{}', stderr: '' });
  const ctx: OrchestratorCtx = {
    projectsDir: dir,
    settingsPath: '',
    log: { info() {}, warn() {}, error() {}, debug() {} } as unknown as OrchestratorCtx['log'],
    broadcast: () => {},
    runners: {
      runTurn,
      runPython,
      runReport: async () => {},
      postTurnCheck: async () => ({
        ok: true, status: 'done', reasons: [],
        detail: { artifactOk: true, yamlOk: true, idsOk: true, confinementBreaches: [], extraFiles: [], lintCodes: { validate: 0, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 0 } },
      }),
    },
  } as unknown as OrchestratorCtx;
  return ctx;
}

/** An edit-existing-shaped task (project+slug resolved) in each_step so ② parks at its gate. */
async function editTask(dir: string): Promise<Task> {
  mkdirSync(join(dir, 'projects', 'p1', 'wf', 'workflows'), { recursive: true });
  writeFileSync(join(dir, 'projects', 'p1', 'wf', 'workflows', 'main.yml'), 'app: {mode: workflow}\n');
  return createTask(dir, {
    requirement: 'edit it', confirmMode: 'confirm each step', workflow: 'wf', project: 'p1',
  });
}

async function runToSpecGate(_dir: string, task: Task, ctx: OrchestratorCtx): Promise<void> {
  assert.ok(acquireTurn(task.taskId));
  try {
    await startTask(task, ctx); // ① runs, parks at the analyze gate (each_step)
  } finally { releaseTurn(task.taskId); unmarkCancelled(task.taskId); }
  assert.equal(task.status, 'awaiting_confirm');
  assert.equal(task.phase, 'analyze');
  const { confirmAdvance } = await import('../server/lib/orchestrator.js');
  assert.ok(acquireTurn(task.taskId));
  try {
    await confirmAdvance(task, 'continue', ctx); // ② turn runs + verifies
  } finally { releaseTurn(task.taskId); unmarkCancelled(task.taskId); }
}

describe('② SPEC.md salvage (spec 090 S3)', () => {
  test('misplaced non-empty SPEC.md → adopted: build parks at the ② gate, file in projects/, artifacts.spec canonical', async () => {
    const dir = fixtureDir();
    const task = await editTask(dir);
    await runToSpecGate(dir, task, harness(dir, task, 'misplaced'));
    assert.equal(task.status, 'awaiting_confirm', task.error ?? '');
    assert.equal(task.phase, 'spec');
    const canonical = join(dir, 'projects', 'p1', 'wf', 'SPEC.md');
    assert.ok(existsSync(canonical), 'file moved into the canonical projects/ path');
    assert.match(readFileSync(canonical, 'utf8'), /wrong house/);
    assert.ok(!existsSync(join(dir, `apps/builder/.runs/${task.taskId}/SPEC.md`)), 'run-dir copy is GONE (moved, not copied)');
    assert.equal(task.artifacts.spec, 'projects/p1/wf/SPEC.md');
  });

  test('turn wrote NOTHING → the pre-090 error is untouched (asked-instead-of-writing stays an error)', async () => {
    const dir = fixtureDir();
    const task = await editTask(dir);
    await runToSpecGate(dir, task, harness(dir, task, 'nothing'));
    assert.equal(task.status, 'error');
    assert.match(task.error ?? '', /artifact missing: projects\/p1\/wf\/SPEC\.md/);
  });

  test('misplaced but EMPTY → NOT adopted (never nurse a stub); error preserved', async () => {
    const dir = fixtureDir();
    const task = await editTask(dir);
    await runToSpecGate(dir, task, harness(dir, task, 'misplaced-empty'));
    assert.equal(task.status, 'error');
    assert.match(task.error ?? '', /artifact missing/);
  });

  test('canonical write (healthy edit build) → no salvage involved, byte-identical behavior', async () => {
    const dir = fixtureDir();
    const task = await editTask(dir);
    await runToSpecGate(dir, task, harness(dir, task, 'canonical'));
    assert.equal(task.status, 'awaiting_confirm', task.error ?? '');
    assert.match(readFileSync(join(dir, 'projects', 'p1', 'wf', 'SPEC.md'), 'utf8'), /right house/);
  });

  test('pre-slug from-scratch: .runs/ IS canonical — file stays put, no move (the fast/standard new-build invariant)', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'new thing', confirmMode: 'confirm each step' });
    const ctx = harness(dir, task, 'misplaced'); // "misplaced" write = the run dir = CANONICAL here
    await runToSpecGate(dir, task, ctx);
    assert.equal(task.status, 'awaiting_confirm', task.error ?? '');
    const runsSpec = join(dir, `apps/builder/.runs/${task.taskId}/SPEC.md`);
    assert.ok(existsSync(runsSpec), 'run-dir file untouched');
    assert.equal(task.artifacts.spec, `apps/builder/.runs/${task.taskId}/SPEC.md`);
  });
});
