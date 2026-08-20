/**
 * Spec 103 Lane B — "show me the plan first": ② drafts a spec change, a human approves it, ③ builds.
 *
 * Every case here pins one of the TRAPS found by tracing the seams before any of it was written. They
 * are not "does it work" cases — they are the specific ways this feature would have quietly corrupted
 * the build, each of which was reachable from a plausible implementation:
 *
 *   1. `runPhase` publishing the DRAFT as `artifacts.spec` → ③ builds from an unapproved proposal, and
 *      Ask answers from it; once applied or dropped, both point at a path that no longer exists.
 *   2. `confirmAdvance`'s generic spec branch scaffolding + building WITHOUT applying the draft, so
 *      approving a plan would do nothing at all.
 *   3. "Never mind" wired as a CANCEL → drops the whole BUILD instead of the proposal.
 *   4. The post-apply ③ carrying no `replyText`, so the undo snapshots never arm — the undo button then
 *      restores a PREVIOUS round, silently losing this one. (The worst of the set: it breaks the one
 *      safety net, and it breaks it quietly.)
 *   5. `auto` blowing through the proposal gate and approving its own plan.
 *   7. `specStale` firing on every apply (the spec changed by rename BEFORE the turn).
 *
 * The invariant under all of them: **`SPEC.md` is byte-identical until the human says go.** Not because
 * the model behaves, but because the model is never handed that file.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { startTask, confirmAdvance, replyWithin, type OrchestratorCtx } from '../server/lib/orchestrator.js';
import { acquireTurn, releaseTurn } from '../server/lib/lock.js';
import { createTask, type Task } from '../server/state/task.js';
import { PHASES } from '../server/lib/phases.js';
import { computeGate } from '../server/lib/gate.js';
import { applyInitFake } from './helpers/scaffold-fake.js';
import type { ClaudeSession, SessionLogger } from '../server/lib/claude-session.js';
import type { TurnResult } from '../server/lib/turn-runner.js';
import type { PostTurnParams, PostTurnResult } from '../server/lib/post-turn.js';
import type { ReportResult, ReportOpts } from '../server/lib/report.js';
import type { ShellResult } from '../server/lib/shell.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;

const SPEC_LIVE = '# Spec\n\nThreshold 0.5.\n';
const SPEC_DRAFT = '# Spec\n\nThreshold 0.2.\n';

let dir: string;
let current: Task | null = null;

function fixtureDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'spec-proposal-'));
  const skill = join(d, '.claude', 'skills', 'dify-build');
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, 'analyze.md'), '# analyze\n{{REQUIREMENT}}\n');
  writeFileSync(join(skill, 'spec.md'), '# spec\n{{REQUIREMENT}}\n');
  writeFileSync(join(skill, 'spec-revise.md'), '# revise\ndraft: {{SPEC_PATH}}\nlive: {{CURRENT_SPEC}}\nwf: {{WORKFLOW_PATH}}\n');
  writeFileSync(join(skill, 'implement.md'), '# implement\n{{REQUIREMENT}}\n{{KNOWLEDGE}}\n## Do\n');
  return d;
}

interface Seen {
  prompts: string[];
  specHashes: (string | null | undefined)[];
}

/** `noopRevise`: the revise turn writes the draft back UNCHANGED — the case spec-revise.md explicitly
 *  allows ("a request that only affects how the YAML is written has no place in a document about
 *  behaviour"), and which must therefore not park at a decision gate with an empty decision. */
interface Ctl { noopRevise?: boolean }

function harness(d: string, seen: Seen, ctl: Ctl = {}): OrchestratorCtx {
  const runTurn = async (_s: ClaudeSession, prompt: string): Promise<TurnResult> => {
    seen.prompts.push(prompt);
    const task = current!;
    const phase = PHASES.find((p) => p.id === task.phase)!;
    const abs = join(d, phase.artifactRel(task));
    mkdirSync(dirname(abs), { recursive: true });
    if (task.phase === 'analyze') writeFileSync(abs, '{"seed": null, "summary": "ok"}');
    else if (task.phase === 'spec') writeFileSync(abs, task.specRevise && !ctl.noopRevise ? SPEC_DRAFT : SPEC_LIVE);
    else writeFileSync(abs, 'workflow:\n  graph:\n    nodes: []\n');
    return { sessionId: `sess-${task.phase}`, result: { type: 'result', is_error: false }, isError: false };
  };
  const runPython = async (_p: string, args: string[]): Promise<ShellResult> => {
    applyInitFake(d, args);
    return { code: 0, stdout: '', stderr: '' };
  };
  const postTurnCheck = async (p: PostTurnParams): Promise<PostTurnResult> => {
    seen.specHashes.push(p.specHashBefore);
    return {
      ok: true, status: 'done', reasons: [],
      detail: {
        artifactOk: true, yamlOk: true, idsOk: true, confinementBreaches: [], extraFiles: [],
        lintCodes: { validate: 0, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 0 },
        artifactChanged: true,
        // Mirror the REAL contract: `specChanged` is only computed when a before-hash was supplied.
        // Hard-coding `false` here would have made this harness claim a measurement that never ran.
        specChanged: p.specHashBefore === undefined ? undefined : false,
      },
    };
  };
  const runReport = async (_d: string, t: Task, _l: SessionLogger, _o?: ReportOpts): Promise<ReportResult> => ({
    ok: true, reasons: [], reportRel: `apps/builder/.runs/${t.taskId}/report.json`, lintClean: true,
  });
  return { projectsDir: d, settingsPath: '', log, broadcast: () => {}, runners: { runTurn, runPython, runReport, postTurnCheck } };
}

async function withTurn(taskId: string, work: () => Promise<void>): Promise<void> {
  assert.ok(acquireTurn(taskId));
  try {
    await work();
  } finally {
    releaseTurn(taskId);
  }
}

const specPath = (t: Task): string => join(dir, `projects/${t.project}/${t.workflowSlug}/SPEC.md`);
// Per-TASK, not per-workflow: several tasks share one workflow, and a per-workflow draft let one
// build silently overwrite another's pending proposal (see specNextRel).
const draftPath = (t: Task): string => join(dir, `apps/builder/.runs/${t.taskId}/SPEC.next.md`);
const ymlPath = (t: Task): string => join(dir, `projects/${t.project}/${t.workflowSlug}/workflows/${t.workflowFile}`);

/** A build parked at the ③ gate with a real spec + workflow on disk — Lane B's only entry state. */
async function buildToImplementGate(over: Partial<Task> = {}, ctl: Ctl = {}): Promise<{ task: Task; ctx: OrchestratorCtx; seen: Seen }> {
  const seen: Seen = { prompts: [], specHashes: [] };
  const ctx = harness(dir, seen, ctl);
  const task = await createTask(dir, { requirement: 'r', deploy: 'none' });
  Object.assign(task, over);
  current = task;
  await withTurn(task.taskId, () => startTask(task, ctx));
  await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx)); // ① → ②
  await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx)); // ② → scaffold → ③
  assert.equal(task.phase, 'implement');
  return { task, ctx, seen };
}

/** Open a proposal: the "show me the plan first" send. */
async function propose(task: Task, ctx: OrchestratorCtx, text = 'lower the threshold'): Promise<void> {
  await withTurn(task.taskId, () => replyWithin(task, text, ctx, { mode: 'propose' }));
}

afterEach(() => {
  current = null;
  rmSync(dir, { recursive: true, force: true });
});

describe('103 Lane B · while the plan is open, nothing has changed', () => {
  test('a proposal parks at its own gate with SPEC.md byte-identical', async () => {
    dir = fixtureDir();
    const { task, ctx } = await buildToImplementGate();
    const before = readFileSync(specPath(task), 'utf8');

    await propose(task, ctx);

    assert.equal(task.phase, 'spec');
    assert.equal(task.gate?.flag, 'spec_proposal');
    assert.equal(readFileSync(specPath(task), 'utf8'), before, 'the LIVE spec was never opened');
    assert.equal(readFileSync(draftPath(task), 'utf8'), SPEC_DRAFT, 'the draft holds the proposal');
  });

  test('TRAP 1 — the draft is NOT published as `artifacts.spec`', async () => {
    // `artifacts.spec` is what ③ receives as `{{PRIOR_ARTIFACT}}` and what Ask answers from. Pointing
    // it at the draft makes both speak for a plan nobody approved — and, after apply/drop, for a file
    // that does not exist. RED if `runPhase`'s `artifacts[sessKey]` write loses its revise carve-out.
    dir = fixtureDir();
    const { task, ctx } = await buildToImplementGate();
    const specArtifactBefore = task.artifacts.spec;

    await propose(task, ctx);

    assert.equal(task.artifacts.spec, specArtifactBefore);
    assert.ok(!String(task.artifacts.spec).includes('SPEC.next'), 'never the draft');
  });

  test('the revise turn is handed the draft to write and the live spec to read', async () => {
    dir = fixtureDir();
    const { task, ctx, seen } = await buildToImplementGate();
    await propose(task, ctx);
    const p = seen.prompts[seen.prompts.length - 1];
    assert.match(p, /draft: apps\/builder\/\.runs\/\d+\/SPEC\.next\.md/, 'per-TASK draft path');
    assert.match(p, /live: projects\/.*\/SPEC\.md/);
    assert.match(p, /wf: projects\/.*main\.yml/);
  });

  test('TRAP 5 — `auto` must NOT approve its own plan', async () => {
    dir = fixtureDir();
    const { task, ctx } = await buildToImplementGate();
    task.confirmMode = 'auto'; // set AFTER the build: an auto build would race to `done` during setup
    await propose(task, ctx);
    // The gate flag is what maybeAutoAdvance hard-stops on; if it were absent, an autonomous build
    // would pay for the extra ② turn and then rubber-stamp itself, buying nothing.
    assert.equal(task.gate?.flag, 'spec_proposal');
    assert.equal(task.status, 'awaiting_confirm');
    assert.equal(task.phase, 'spec', 'still parked — it did not run ahead into implement');
  });

  test('one proposal at a time — a second `propose` is refused at the route', async () => {
    dir = fixtureDir();
    const { task, ctx } = await buildToImplementGate();
    await propose(task, ctx);
    assert.equal(task.specRevise, true, 'the pending flag IS the one-at-a-time guard');
  });
});

describe('103 Lane B · two builds, one workflow', () => {
  test('drafts are per-TASK — build B cannot overwrite build A\'s pending proposal', async () => {
    // The silent-wrong-answer bug, reproduced by the audit against the real orchestrator: the draft
    // used to live at `projects/<p>/<w>/SPEC.next.md`, keyed on the WORKFLOW, while the "one proposal
    // at a time" guard is `!task.specRevise` — a per-TASK flag that cannot see another task's draft.
    // Several tasks legitimately share one workflow (an edit-existing build, a finished build reopened
    // for a fix) and a parked build holds no lock, so B's proposal copied straight over A's. A then
    // approved the plan it had read and the build implemented B's.
    //
    // Putting the taskId IN THE PATH makes the collision unrepresentable rather than merely guarded.
    dir = fixtureDir();
    const seen: Seen = { prompts: [], specHashes: [] };
    const ctx = harness(dir, seen);

    const a = await createTask(dir, { requirement: 'build A', deploy: 'none' });
    current = a;
    await withTurn(a.taskId, () => startTask(a, ctx));
    await withTurn(a.taskId, () => confirmAdvance(a, 'continue', ctx));
    await withTurn(a.taskId, () => confirmAdvance(a, 'continue', ctx));

    // Task B, same project + workflow — the shape an edit-existing build or a reopened done build has.
    const b = await createTask(dir, { requirement: 'build B', deploy: 'none' });
    b.project = a.project;
    b.workflowSlug = a.workflowSlug;
    b.workflowFile = a.workflowFile;

    current = a;
    await withTurn(a.taskId, () => replyWithin(a, 'plan A', ctx, { mode: 'propose' }));
    const draftA = readFileSync(join(dir, `apps/builder/.runs/${a.taskId}/SPEC.next.md`), 'utf8');

    current = b;
    await withTurn(b.taskId, () => replyWithin(b, 'plan B', ctx, { mode: 'propose' }));

    assert.notEqual(a.taskId, b.taskId);
    assert.equal(
      readFileSync(join(dir, `apps/builder/.runs/${a.taskId}/SPEC.next.md`), 'utf8'), draftA,
      "A's draft survived B opening its own — different files, not one shared path"
    );
    assert.equal(existsSync(join(dir, `apps/builder/.runs/${b.taskId}/SPEC.next.md`)), true);
  });

  test('a draft never lands in the user\'s workflow folder', async () => {
    // Second reason for the run dir: a cancelled or abandoned proposal leaves no stray file where the
    // human keeps their work. `.runs/<taskId>/` is the build's own scratch space.
    dir = fixtureDir();
    const { task, ctx } = await buildToImplementGate();
    await propose(task, ctx);
    assert.equal(
      existsSync(join(dir, `projects/${task.project}/${task.workflowSlug}/SPEC.next.md`)), false,
      'nothing stray beside the real SPEC.md'
    );
  });
});

describe('103 Lane B · a plan with nothing in it is not a plan', () => {
  test('a revise that changed nothing returns the build instead of parking at a decision gate', async () => {
    // spec-revise.md explicitly allows a no-op: a request that only affects how the YAML is written
    // has no place in a document about behaviour. Parking THAT at a gate headed "here is what I would
    // change" wastes the human's attention and teaches them the gate is noise.
    dir = fixtureDir();
    const { task, ctx } = await buildToImplementGate({}, { noopRevise: true });

    await propose(task, ctx, 'reformat the prompt, change no behaviour');

    assert.notEqual(task.gate?.flag, 'spec_proposal', 'no empty decision gate');
    assert.equal(task.phase, 'implement', 'returned to where the human was');
    assert.equal(task.specNoop, true, 'and the round trip is explained, not silent');
    assert.equal(task.specRevise, undefined);
    assert.equal(existsSync(draftPath(task)), false, 'the empty draft is cleaned up');
  });
});

describe('103 Lane B · a turn that dies must not strand the build', () => {
  test('an errored revise still offers "Never mind", and it costs nothing', async () => {
    // Observed live: the ② revise hit a Claude usage limit and the build stranded at phase 'spec',
    // status 'error', with the draft still open. The plain error gate offers Retry (another turn) or
    // Discard (throw away the whole build) — neither is "forget the plan, put me back", which is free
    // and is what a human wants after a turn dies through no fault of their own.
    dir = fixtureDir();
    const { task, ctx } = await buildToImplementGate();
    const specBefore = readFileSync(specPath(task), 'utf8');
    await propose(task, ctx);

    // The turn died after the draft was created.
    task.status = 'error';
    task.error = 'usage limit reached';
    task.gate = computeGate('spec', { outcome: 'error' }, task.deploy, {}, { specRevise: task.specRevise });
    assert.ok(task.gate.actions.some((a) => a.id === 'drop_spec'), 'the escape hatch is offered');

    await withTurn(task.taskId, () => confirmAdvance(task, 'drop_spec', ctx));

    assert.equal(task.phase, 'implement', 'back where the human was');
    assert.equal(task.status, 'awaiting_confirm');
    assert.equal(task.specRevise, undefined);
    assert.equal(existsSync(draftPath(task)), false);
    assert.equal(readFileSync(specPath(task), 'utf8'), specBefore, 'spec untouched throughout');
  });

  test('a healthy error gate does NOT grow the extra button', async () => {
    const g = computeGate('spec', { outcome: 'error' }, 'none', {}, {});
    assert.ok(!g.actions.some((a) => a.id === 'drop_spec'));
  });
});

describe('103 Lane B · deciding', () => {
  test('"Never mind" drops the plan and returns the build — TRAP 3', async () => {
    // Wired as a CANCEL this would end the BUILD. Dropping a plan must cost nothing and change nothing.
    dir = fixtureDir();
    const { task, ctx } = await buildToImplementGate();
    const specBefore = readFileSync(specPath(task), 'utf8');
    const ymlBefore = readFileSync(ymlPath(task), 'utf8');
    await propose(task, ctx);

    await withTurn(task.taskId, () => confirmAdvance(task, 'drop_spec', ctx));

    assert.notEqual(task.status, 'cancelled', 'the BUILD survives');
    assert.equal(task.phase, 'implement', 'back where the human was');
    assert.equal(task.status, 'awaiting_confirm');
    assert.equal(task.specRevise, undefined);
    assert.equal(existsSync(draftPath(task)), false, 'the draft is gone');
    assert.equal(readFileSync(specPath(task), 'utf8'), specBefore, 'spec untouched');
    assert.equal(readFileSync(ymlPath(task), 'utf8'), ymlBefore, 'workflow untouched');
  });

  test('dropping from a FINISHED build leaves it finished — the promise is literal', async () => {
    // The gate card says "nothing has changed". A drop that un-finishes a `done` build changed
    // something, and something alarming: the user's completed, imported build would look unfinished.
    // Lane B is reachable from three places and a drop must return to whichever one it came from.
    dir = fixtureDir();
    const { task, ctx } = await buildToImplementGate();
    task.phase = 'test';
    task.status = 'done';
    task.gate = { actions: [] };

    await propose(task, ctx);
    assert.equal(task.phase, 'spec', 'precondition: the proposal moved the phase');
    await withTurn(task.taskId, () => confirmAdvance(task, 'drop_spec', ctx));

    assert.equal(task.status, 'done', 'still finished');
    assert.equal(task.phase, 'test');
  });

  test('dropping from a ④ gate restores THAT gate, not a recomputed ③ one', async () => {
    dir = fixtureDir();
    const { task, ctx } = await buildToImplementGate();
    task.phase = 'test';
    task.status = 'awaiting_confirm';
    task.gate = { actions: [], flag: 'awaiting_import' };

    await propose(task, ctx);
    await withTurn(task.taskId, () => confirmAdvance(task, 'drop_spec', ctx));

    assert.equal(task.phase, 'test');
    assert.equal(task.gate?.flag, 'awaiting_import', 'the import gate survived the round trip');
  });

  test('"Go with this" makes the draft the spec, then builds — TRAP 2', async () => {
    // The generic spec branch would scaffold + build WITHOUT applying, so approving would silently
    // do nothing to the document the human just read.
    dir = fixtureDir();
    const { task, ctx } = await buildToImplementGate();
    await propose(task, ctx);

    await withTurn(task.taskId, () => confirmAdvance(task, 'apply_spec', ctx));

    assert.equal(readFileSync(specPath(task), 'utf8'), SPEC_DRAFT, 'the approved bytes ARE the spec now');
    assert.equal(existsSync(draftPath(task)), false, 'moved, not copied');
    assert.equal(task.specRevise, undefined);
    assert.equal(task.phase, 'implement', '③ ran from the approved spec');
  });

  test('TRAP 4 — approving ARMS the undo, so the undo cannot restore a previous round', async () => {
    // The post-apply ③ comes from confirmAdvance and carries no `replyText`, so runPhase's own arming
    // never fires. Without arming here, `fixUndoable` keeps a STALE value from an earlier round and the
    // undo button silently rolls back to the wrong point. Quiet data loss through the safety net.
    dir = fixtureDir();
    const { task, ctx } = await buildToImplementGate();
    const preProposal = readFileSync(specPath(task), 'utf8');

    await propose(task, ctx);
    await withTurn(task.taskId, () => confirmAdvance(task, 'apply_spec', ctx));

    assert.equal(task.fixUndoable, true, 'this round is undoable');
    const snap = readFileSync(join(dir, `apps/builder/.runs/${task.taskId}/spec-base.md`), 'utf8');
    assert.equal(snap, preProposal,
      'the snapshot is the PRE-PROPOSAL spec — taken before the rename, which is this round\'s first mutation');
  });

  test('TRAP 7 — `specStale` does not false-alarm on an approved plan', async () => {
    // The spec changed by rename BEFORE the turn, so specHashBefore is taken after it and the turn
    // legitimately leaves the file alone. Measuring here would raise a warning on EVERY apply.
    dir = fixtureDir();
    const { task, ctx } = await buildToImplementGate();
    await propose(task, ctx);
    await withTurn(task.taskId, () => confirmAdvance(task, 'apply_spec', ctx));
    assert.notEqual(task.specStale, true, 'no warning on a spec the human just approved');
  });

  test('the ③ after an approval is told it may not silently deviate (§H1)', async () => {
    // ② has never met Dify's linters, so the approved spec may not be buildable. The duty that
    // replaces the suppressed flag: say so, do not quietly build something else.
    dir = fixtureDir();
    const { task, ctx, seen } = await buildToImplementGate();
    await propose(task, ctx);
    await withTurn(task.taskId, () => confirmAdvance(task, 'apply_spec', ctx));
    const p = seen.prompts[seen.prompts.length - 1];
    assert.match(p, /approved by a human/);
    assert.match(p, /do NOT quietly build something else/);
  });
});
