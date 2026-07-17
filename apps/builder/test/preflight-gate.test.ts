/**
 * Spec 037 S1 — AC 3/3b/3c: the runnability preflight at the ③ Implement gate is ADVISORY.
 *
 * Harness = the advance-loop mini-harness (fake runTurn/postTurnCheck/runReport via the 013-D2
 * runners seam). The preflight probe rides the SAME injected runPython: the fake answers the
 * `runnability_facts` marker with PLANTED facts (steering model/trap/dataset classes), while the
 * `plugin_todo` class reads the REAL artifact text the fake turn wrote (steered per test).
 *
 *   AC 3  — a four-blocker build parks at the gate WITH the note + preflight.json on disk;
 *   AC 3b — anti-gaming: the GATE is deep-equal to a clean run's gate (advisory channel only —
 *           an implementation that also added a blocking flag/action fails this);
 *   AC 3c — a /reply whose fake writes a FIXED workflow CLEARS the note (recompute-per-verify;
 *           a set-once implementation fails);
 *   plus: a probe failure is non-fatal (warn-only) — the phase still parks normally.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
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
import type { RunnabilityFacts } from '../server/lib/runnability.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;

const CLEAN_FACTS: RunnabilityFacts = {
  kind: 'runnability_facts',
  model_nodes: [{ id: 'n1', type: 'llm', empty: false }],
  code_nodes: [],
  kr_nodes: [],
};
const BLOCKED_FACTS: RunnabilityFacts = {
  kind: 'runnability_facts',
  model_nodes: [{ id: 'n1', type: 'llm', empty: true }],
  code_nodes: [{ id: 'n2', nonstdlib: ['requests'] }],
  kr_nodes: [{ id: 'n3', empty: true }],
};
const TODO_YAML = 'dependencies: []  # TODO: add plugin hash\nworkflow:\n  graph:\n    nodes: []\n';
const CLEAN_YAML = 'workflow:\n  graph:\n    nodes: []\n';

interface Steer {
  facts: RunnabilityFacts;
  implementYaml: string;
  probeFails?: boolean;
}

function harness(dir: string, steer: Steer) {
  const runTurn = async (_s: ClaudeSession, _p: string): Promise<TurnResult> => {
    const task = current!;
    const phase = PHASES.find((p) => p.id === task.phase)!;
    const abs = join(dir, phase.artifactRel(task));
    mkdirSync(dirname(abs), { recursive: true });
    if (task.phase === 'analyze') writeFileSync(abs, '{"seed": null, "summary": "ok"}');
    else if (task.phase === 'spec') writeFileSync(abs, '# SPEC\nbuild it.\n');
    else writeFileSync(abs, steer.implementYaml);
    return { sessionId: `sess-${task.phase}`, result: { type: 'result', is_error: false }, isError: false };
  };
  const runPython = async (_d: string, args: string[]): Promise<ShellResult> => {
    if (args[0] === '-c' && String(args[1]).includes('runnability_facts')) {
      if (steer.probeFails) return { code: 1, stdout: '', stderr: 'planted probe failure' };
      return { code: 0, stdout: JSON.stringify(steer.facts), stderr: '' };
    }
    applyInitFake(dir, args);
    return { code: 0, stdout: '', stderr: '' };
  };
  const postTurnCheck = async (_p: PostTurnParams): Promise<PostTurnResult> => ({
    ok: true,
    status: 'done',
    reasons: [],
    detail: {
      artifactOk: true, yamlOk: true, idsOk: true, confinementBreaches: [], extraFiles: [],
      lintCodes: { validate: 0, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 0 },
    },
  });
  const runReport = async (_d: string, t: Task, _l: SessionLogger, _o?: ReportOpts): Promise<ReportResult> => ({
    ok: true, reasons: [], reportRel: `apps/builder/.runs/${t.taskId}/report.json`, lintClean: true,
  });
  const ctx: OrchestratorCtx = {
    projectsDir: dir,
    settingsPath: '',
    log,
    broadcast: () => {},
    runners: { runTurn, runPython, runReport, postTurnCheck },
  };
  return { ctx, steer };
}

let current: Task | null = null;
let dir: string;

function fixtureDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'preflight-'));
  const skill = join(d, '.claude', 'skills', 'dify-build');
  mkdirSync(skill, { recursive: true });
  for (const name of ['analyze', 'spec', 'implement']) {
    writeFileSync(join(skill, `${name}.md`), `# ${name}\nrequirement: {{REQUIREMENT}}\n`);
  }
  return d;
}

async function withTurn(taskId: string, work: () => Promise<void>): Promise<void> {
  assert.ok(acquireTurn(taskId), 'acquired the turn lock');
  try {
    await work();
  } finally {
    releaseTurn(taskId);
  }
}

/** Drive ① → ② → ③ to the parked Implement gate. The harness closes over the CALLER's `steer`
 *  object, so mutating it between calls steers a subsequent /reply re-run (AC 3c). */
async function driveToImplementGate(steer: Steer): Promise<{ task: Task; ctx: OrchestratorCtx }> {
  const h = harness(dir, steer);
  const task = await createTask(dir, { requirement: 'r', deploy: 'none' });
  current = task;
  await withTurn(task.taskId, () => startTask(task, h.ctx)); // spec 055: seedless parks at ① analyze
  await withTurn(task.taskId, () => confirmAdvance(task, 'continue', h.ctx)); // ① → ② spec
  await withTurn(task.taskId, () => confirmAdvance(task, 'continue', h.ctx)); // scaffold → ③
  assert.equal(task.phase, 'implement');
  assert.equal(task.status, 'awaiting_confirm', 'parked at the ③ gate');
  return { task, ctx: h.ctx };
}

afterEach(() => {
  current = null;
  rmSync(dir, { recursive: true, force: true });
});

describe('spec 037 — preflight at the ③ gate (advisory, recompute-per-verify)', () => {
  test('AC 3: all four blockers → note set + preflight.json persisted + gate parked normally', async () => {
    dir = fixtureDir();
    const { task } = await driveToImplementGate({ facts: BLOCKED_FACTS, implementYaml: TODO_YAML });

    assert.ok(task.preflightNote, 'preflightNote set');
    assert.match(task.preflightNote!, /^Before this workflow can run, you need to: /); // spec 066 S5
    // spec 064: the note still itemizes every blocker class — now in PLAIN language (the model and
    // plugin details lost their jargon; sandbox/dataset details are unchanged).
    // The note still itemizes every blocker class — each in plain language, naming the thing the
    // user can act on (the module name, the knowledge base) rather than the node it lives in.
    for (const frag of ['the AI model', 'a code step uses requests', 'a plugin this workflow needs',
      'a knowledge base to search']) {
      assert.ok(task.preflightNote!.includes(frag), `note itemizes "${frag}": ${task.preflightNote}`);
    }
    for (const jargon of ['plugin hash', 'dependencies TODO', 'preflight', 'Advisory',
      'non-stdlib', 'dataset_ids', 'knowledge-retrieval', 'code node']) {
      assert.ok(!task.preflightNote!.includes(jargon), `no jargon "${jargon}" reaches the user`);
    }
    assert.doesNotMatch(task.preflightNote!, /\b\d{13}\b/, 'no bare node id reaches the user');
    const pfPath = join(dir, `apps/builder/.runs/${task.taskId}/preflight.json`);
    assert.ok(existsSync(pfPath), 'preflight.json persisted');
    const pf = JSON.parse(readFileSync(pfPath, 'utf8'));
    assert.deepEqual(
      [...new Set(pf.blockers.map((b: { class: string }) => b.class))].sort(),
      ['dataset_empty', 'model_empty', 'plugin_todo', 'sandbox_trap']
    );
  });

  test('AC 3b (anti-gaming): the GATE is deep-equal to a clean run — advisory channel only', async () => {
    dir = fixtureDir();
    const blocked = await driveToImplementGate({ facts: BLOCKED_FACTS, implementYaml: TODO_YAML });
    const blockedGate = structuredClone(blocked.task.gate);
    rmSync(dir, { recursive: true, force: true });

    dir = fixtureDir();
    const clean = await driveToImplementGate({ facts: CLEAN_FACTS, implementYaml: CLEAN_YAML });
    assert.equal(clean.task.preflightNote, undefined, 'clean run has no note');
    assert.deepEqual(blockedGate, clean.task.gate,
      'the gates are IDENTICAL — blockers add no flag/action (an added blocking affordance fails here)');
  });

  test('AC 3c: a /reply whose turn FIXES the workflow clears the note (recompute, not set-once)', async () => {
    dir = fixtureDir();
    // The harness CLOSES OVER this object — mutating it steers the /reply re-run.
    const steer: Steer = { facts: BLOCKED_FACTS, implementYaml: TODO_YAML };
    const { task, ctx } = await driveToImplementGate(steer);
    assert.ok(task.preflightNote, 'note set after the first verify');

    steer.facts = CLEAN_FACTS;
    steer.implementYaml = CLEAN_YAML;
    await withTurn(task.taskId, () => replyWithin(task, 'fill the model + hash + datasets', ctx));

    assert.equal(task.phase, 'implement');
    assert.equal(task.preflightNote, undefined, 'note CLEARED on the re-verify (a set-once impl fails)');
  });

  test('a probe failure is non-fatal: warn-only, the phase still parks with no note', async () => {
    dir = fixtureDir();
    const { task } = await driveToImplementGate({
      facts: CLEAN_FACTS, implementYaml: CLEAN_YAML, probeFails: true,
    });
    assert.equal(task.status, 'awaiting_confirm', 'phase completed despite the probe failure');
    assert.equal(task.preflightNote, undefined);
  });
});
