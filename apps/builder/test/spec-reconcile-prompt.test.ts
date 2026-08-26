/**
 * Spec 103 L0 — the DELIVERY half: does the reconcile directive actually reach the turn that is being
 * measured?
 *
 * This file exists because it did not, and everything was green anyway.
 *
 * The instruction shipped in `implement.md` step 6 only. But a `/reply` prompt is
 * `languagePin + CHANGE_REQUEST + the user's text (+ attachments, + facts)` and carries **no skill
 * body** — so step 6 reached a FRESH ③ turn and nothing else. That is exactly inverted: a fresh ③ has
 * a SPEC.md that ② wrote minutes earlier (nothing to reconcile, and `specHashBefore` is not even
 * captured), while the fix round — the only place a spec can go stale, and the only place the
 * measurement runs — resumes.
 *
 * `spec-stale.test.ts` could not catch it: it tests the tripwire, and the tripwire was correct. What
 * was missing was the thing the tripwire watches. On the real build that exposed this (task
 * 1787190372697), the turn updated SPEC.md on its own initiative, so `specStale` read false and every
 * automated check passed — while the file itself now said the model was Claude Sonnet 5 in one section
 * and "the Claude Sonnet 5 option was withdrawn, provider is OpenAI" in another.
 *
 * So the load-bearing assertion here is not "the text is present" — it is **the delivery gate and the
 * measurement gate are the same gate**. Move one without the other and this file goes red.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/** The one phrase the directive is identified by. Deliberately the rendered heading, not a constant
 *  imported from orchestrator.ts: importing it would make the test pass even if the directive were
 *  never concatenated into a prompt, which is the entire bug this file exists for. */
const MARK = '## Also bring SPEC.md up to date';

let dir: string;
let current: Task | null = null;

/** Skill bodies are STUBS on purpose — the real `implement.md` also carries step 6, and a fixture that
 *  inlined it could not tell "delivered by the resume seam" from "delivered by the doc". */
function fixtureDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'spec-reconcile-'));
  const skill = join(d, '.claude', 'skills', 'dify-build');
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, 'analyze.md'), '# analyze\nrequirement: {{REQUIREMENT}}\n');
  writeFileSync(join(skill, 'spec.md'), '# spec\nrequirement: {{REQUIREMENT}}\n');
  writeFileSync(join(skill, 'implement.md'), '# implement\nreq: {{REQUIREMENT}}\nfile: {{WORKFLOW_FILE}}\n{{KNOWLEDGE}}\n## Do\n');
  return d;
}

interface Seen {
  prompts: string[];
  /** every `specHashBefore` postTurnCheck was handed, in order — `undefined` = "not measured". */
  specHashes: (string | null | undefined)[];
}

/** Per-call knobs for the failure tests: `dieMidWrite` makes the NEXT ③ turn scribble garbage over
 *  both files and then fail its verify — the truncated-YAML death that is the common real ③ error. */
interface Ctl {
  dieMidWrite?: boolean;
}

function harness(d: string, seen: Seen, ctl: Ctl = {}): OrchestratorCtx {
  const runTurn = async (_s: ClaudeSession, prompt: string): Promise<TurnResult> => {
    seen.prompts.push(prompt);
    const task = current!;
    const phase = PHASES.find((p) => p.id === task.phase)!;
    const abs = join(d, phase.artifactRel(task));
    mkdirSync(dirname(abs), { recursive: true });
    if (task.phase === 'analyze') writeFileSync(abs, '{"seed": null, "summary": "ok"}');
    else if (task.phase === 'spec') writeFileSync(abs, '# SPEC\nbuild it.\n');
    else if (ctl.dieMidWrite) {
      // A death mid-write is not a clean no-op: the turn got PART of its edits down first.
      writeFileSync(abs, 'workflow: CORRUPT-PARTIAL-WRITE');
      const spec = join(dirname(dirname(abs)), 'SPEC.md');
      writeFileSync(spec, '# SPEC CORRUPT-PARTIAL-WRITE');
    } else writeFileSync(abs, 'workflow:\n  graph:\n    nodes: []\n');
    return { sessionId: `sess-${task.phase}`, result: { type: 'result', is_error: false }, isError: false };
  };
  const runPython = async (_p: string, args: string[]): Promise<ShellResult> => {
    applyInitFake(d, args);
    return { code: 0, stdout: '', stderr: '' };
  };
  const postTurnCheck = async (p: PostTurnParams): Promise<PostTurnResult> => {
    seen.specHashes.push(p.specHashBefore);
    if (ctl.dieMidWrite) {
      ctl.dieMidWrite = false; // one death, then the retry verifies clean
      return {
        ok: false, status: 'error', reasons: ['yaml parse failed (truncated/corrupt)'],
        detail: {
          artifactOk: true, yamlOk: false, idsOk: false, confinementBreaches: [], extraFiles: [],
          lintCodes: null,
        },
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

/** ① → ② → scaffold → ③, i.e. a build parked at the Implement gate, exactly like a real one. */
async function driveToImplementGate(ctl: Ctl = {}): Promise<{ task: Task; ctx: OrchestratorCtx; seen: Seen }> {
  const seen: Seen = { prompts: [], specHashes: [] };
  const ctx = harness(dir, seen, ctl);
  const task = await createTask(dir, { requirement: 'r', deploy: 'none' });
  current = task;
  await withTurn(task.taskId, () => startTask(task, ctx));
  await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx)); // ① → ②
  await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx)); // ② → scaffold → ③
  assert.equal(task.phase, 'implement');
  return { task, ctx, seen };
}

afterEach(() => {
  current = null;
  rmSync(dir, { recursive: true, force: true });
});

describe('103 L0 · the reconcile directive reaches the turn that is measured', () => {
  test('a /reply fix round at ③ carries the directive — the case that shipped broken', async () => {
    dir = fixtureDir();
    const { task, ctx, seen } = await driveToImplementGate();
    await withTurn(task.taskId, () => replyWithin(task, 'lower the threshold to 0.2', ctx));

    const resume = seen.prompts[seen.prompts.length - 1];
    assert.match(resume, /^## Change request/, 'precondition: this is the resume prompt, not a fresh render');
    assert.ok(!resume.includes('# implement'), 'precondition: a resume carries NO skill body — the whole reason for this seam');
    assert.ok(resume.includes(MARK), 'the fix round must be told to reconcile SPEC.md');
  });

  test('THE INVARIANT: measured ⇔ instructed, on every turn of a real run', async () => {
    // The bug was a mismatch between these two gates, not a missing string. Pin them as one fact.
    dir = fixtureDir();
    const { task, ctx, seen } = await driveToImplementGate();
    await withTurn(task.taskId, () => replyWithin(task, 'first fix', ctx));
    await withTurn(task.taskId, () => replyWithin(task, 'second fix', ctx));

    const implementPrompts = seen.prompts.filter((p) => p.startsWith('## Change request') || p.includes('# implement'));
    assert.equal(seen.specHashes.length, implementPrompts.length, 'precondition: one verify per ③ turn');
    seen.specHashes.forEach((hash, i) => {
      const instructed = implementPrompts[i].includes(MARK);
      const measured = hash !== undefined;
      assert.equal(
        instructed, measured,
        `③ turn #${i + 1}: instructed=${instructed} but measured=${measured} — ` +
        'the directive and the measurement must ride the SAME condition, or the flag judges a turn ' +
        'that was never told the rule (or a turn is told a rule nobody checks).'
      );
    });
    assert.ok(seen.specHashes.some((h) => h !== undefined), 'at least one round was actually measured');
  });

  test('the FRESH ③ turn gets neither — ② wrote SPEC.md minutes ago, nothing to reconcile', async () => {
    dir = fixtureDir();
    const { seen } = await driveToImplementGate();
    const fresh = seen.prompts[seen.prompts.length - 1];
    assert.ok(fresh.includes('# implement'), 'precondition: a fresh turn DOES carry the skill body');
    assert.ok(!fresh.includes(MARK), 'no resume tail on the fresh path (the real implement.md covers it)');
    assert.deepEqual(seen.specHashes, [undefined], 'and it is not measured either');
  });

  test('spec 105 — a build that STARTS at ③ gets both, on its very first turn', async () => {
    // The same invariant, on the path that broke the assumption underneath it. "Fresh ③ ⇒ neither" was
    // never a rule about freshness — it was a rule about ② having written SPEC.md minutes ago. A build
    // editing an already-specced workflow has no ②: the document on disk describes the workflow from
    // BEFORE the edit, which is precisely the state the tripwire watches for. So this turn must be told
    // the rule AND judged by it, on turn one, with no `/reply` anywhere in sight.
    dir = fixtureDir();
    mkdirSync(join(dir, 'projects', '_drafts', 'specced', 'workflows'), { recursive: true });
    writeFileSync(join(dir, 'projects/_drafts/specced/workflows/main.yml'), 'workflow:\n  graph:\n    nodes: []\n');
    writeFileSync(join(dir, 'projects/_drafts/specced/SPEC.md'), '# Spec\n\n## Acceptance Criteria\n- it works\n');
    const seen: Seen = { prompts: [], specHashes: [] };
    const ctx = harness(dir, seen);
    const task = await createTask(dir, {
      requirement: 'add a retry branch', workflow: 'specced', startPhase: 'implement', deploy: 'none',
    });
    current = task;

    await withTurn(task.taskId, () => startTask(task, ctx));

    assert.equal(seen.prompts.length, 1, 'precondition: ① and ② really were skipped');
    assert.notEqual(seen.specHashes[0], undefined, 'measured — the document predates this round');
    // Instructed by the OTHER seam. This turn is FRESH (no resumeId), and a fresh prompt carries the
    // skill body, where step 6 states the rule in full — so the tail is correctly absent here rather
    // than missing. Widening the tail to cover this path was tried first and was DEAD CODE: fresh
    // prompts never concatenate it at all. Which is what makes `readSkillStep6` below load-bearing.
    assert.ok(seen.prompts[0].includes('# implement'), 'the skill body rode this prompt');
    assert.ok(!seen.prompts[0].includes(MARK), 'and the resume tail correctly did not');
    // And the ask itself, which is the whole reason the turn exists.
    const i = seen.prompts[0].indexOf('## Change request');
    assert.ok(i > -1 && seen.prompts[0].slice(i).includes('add a retry branch'), 'carrying the request');
  });

  test('spec 105 — and the REAL implement.md step 6 does not tell that turn to change nothing', async () => {
    // The fixture above stubs the skill body on purpose, so it can prove WHICH seam delivered. That
    // leaves the fresh path's actual delivery unproven by any test — and the fresh path is the only
    // one a start-at-③ build ever takes. So read the shipped document.
    //
    // Step 6 used to excuse a no-op with "the normal case on a first build, where Phase ② wrote it from
    // the same requirement minutes ago". A build editing an already-specced workflow IS on its first ③
    // and has no ② at all, so the excuse read as written for it — while its SPEC.md described the
    // workflow from before the edit. The rule has to name the CONDITION, not the round number.
    const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const step6 = readFileSync(
      join(REPO, '.claude/skills/dify-build/implement.md'), 'utf8'
    ).split('\n6. **Reconcile')[1] ?? '';
    assert.ok(step6, 'precondition: step 6 is where the reconcile rule lives');
    assert.ok(
      step6.includes('{{START_PHASE}}'),
      'the no-op excuse must be stated against START_PHASE — a turn whose build had no ② is never ' +
      'excused from re-reading the document written for the workflow it replaced'
    );
    // And NOT against `{{SEED_PATH}}`, which was the first attempt. That token is set by BOTH
    // `localEditSeed` and `difySeedScaffoldAndPull`, so it is non-blank on every edit-existing and
    // dify-seed build — including the ①②③ ones whose ② wrote this very document from this very
    // requirement minutes ago. Keying on it told those turns their fresh spec was stale, and
    // contradicted `SPEC_RECONCILE`, which still grants them the no-op on the resume seam.
    assert.ok(
      !/It is \*\*not\*\* the case when `\{\{SEED_PATH\}\}`/.test(step6),
      'the excuse must not be withdrawn from builds whose ② really did write the document'
    );
  });

  test('spec 105 — a text-less RETRY still carries the request; an empty string is not an answer', async () => {
    // The Retry button on an error gate is a one-click re-run and sends NO text — the route lets that
    // through as an empty string on purpose. The carrier fix read it with `??`, which only falls
    // through on null/undefined, so `''` passed a truthiness test it then failed: the change-request
    // block was dropped and the retry went in carrying no request at all. On the exact click a human
    // reaches for when the first turn already went wrong, the ask evaporated a second time.
    dir = fixtureDir();
    mkdirSync(join(dir, 'projects', '_drafts', 'specced', 'workflows'), { recursive: true });
    writeFileSync(join(dir, 'projects/_drafts/specced/workflows/main.yml'), 'workflow:\n  graph:\n    nodes: []\n');
    writeFileSync(join(dir, 'projects/_drafts/specced/SPEC.md'), '# Spec\n\n## Acceptance Criteria\n- it works\n');
    const seen: Seen = { prompts: [], specHashes: [] };
    const ctx = harness(dir, seen, { dieMidWrite: true });
    const task = await createTask(dir, {
      requirement: 'add a retry branch', workflow: 'specced', startPhase: 'implement', deploy: 'none',
    });
    current = task;

    await withTurn(task.taskId, () => startTask(task, ctx));
    assert.equal(task.status, 'error', 'precondition: the first ③ died');

    await withTurn(task.taskId, () => replyWithin(task, '', ctx)); // the Retry button: no text

    const retry = seen.prompts[seen.prompts.length - 1];
    const i = retry.indexOf('## Change request');
    assert.ok(i > -1, 'the retry is still told what was asked for');
    assert.ok(retry.slice(i).includes('add a retry branch'), 'and it is the request the human typed');
  });

  test('a /reply at the ② gate gets no directive — it is not an Implement turn', async () => {
    // Same guard the facts injection needed (knowledge-inject AC 6c): the tail is phase-gated, so a
    // spec-gate revision does not receive a rule about reconciling the file it is itself writing.
    dir = fixtureDir();
    const seen: Seen = { prompts: [], specHashes: [] };
    const ctx = harness(dir, seen);
    const task = await createTask(dir, { requirement: 'r', deploy: 'none' });
    current = task;
    await withTurn(task.taskId, () => startTask(task, ctx));
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx)); // ① → ②
    assert.equal(task.phase, 'spec');
    await withTurn(task.taskId, () => replyWithin(task, 'reword the goal', ctx));
    assert.ok(!seen.prompts[seen.prompts.length - 1].includes(MARK));
  });

  test('after an UNDO, the next fix round is told the files moved under it', async () => {
    // The resumed session still holds its own edits in context, and a `/reply` prompt carries no skill
    // body — so implement.md's "re-read it fresh" never reaches it. Without this note the next round
    // patches on top of a state that no longer exists.
    dir = fixtureDir();
    const { task, ctx, seen } = await driveToImplementGate();
    task.fixUndone = true; // what the undo route sets
    await withTurn(task.taskId, () => replyWithin(task, 'try something else', ctx));
    assert.match(seen.prompts[seen.prompts.length - 1], /previous edit in this session was UNDONE/);
  });

  test('the note is cleared AFTER the turn, and never repeats on later rounds', async () => {
    // Cleared after, not before: a spawn that never started must not consume the note, or the retry
    // goes in blind. And it must expire — a round three fixes later has nothing to do with that undo.
    dir = fixtureDir();
    const { task, ctx, seen } = await driveToImplementGate();
    task.fixUndone = true;
    await withTurn(task.taskId, () => replyWithin(task, 'first after undo', ctx));
    assert.equal(task.fixUndone, undefined, 'consumed once the turn actually ran');

    await withTurn(task.taskId, () => replyWithin(task, 'second, unrelated', ctx));
    assert.ok(
      !seen.prompts[seen.prompts.length - 1].includes('was UNDONE'),
      'a later round is not told about an undo it had nothing to do with'
    );
  });

  test('no undo → no note (it is not boilerplate on every fix round)', async () => {
    dir = fixtureDir();
    const { task, ctx, seen } = await driveToImplementGate();
    await withTurn(task.taskId, () => replyWithin(task, 'ordinary fix', ctx));
    assert.ok(!seen.prompts[seen.prompts.length - 1].includes('was UNDONE'));
  });

  test('a RETRY out of an errored round does NOT re-arm the snapshots — undo must never restore a corpse', async () => {
    // The failure this pins: a fix round dies mid-write (truncated main.yml — the common real ③
    // death), leaving partial garbage on disk. The user retries. Re-arming the snapshots on that
    // retry would enshrine the garbage as "the pre-round state", and the undo button — the one
    // safety net — would then restore corruption. The snapshots taken at the round's FIRST attempt
    // are the true base and must survive the retry untouched.
    dir = fixtureDir();
    const ctl: Ctl = {};
    const { task, ctx } = await driveToImplementGate(ctl);
    const specAbs = join(dir, `projects/${task.project}/${task.workflowSlug}/SPEC.md`);
    const trueSpec = readFileSync(specAbs, 'utf8'); // what ② wrote — the real pre-round state

    ctl.dieMidWrite = true;
    await withTurn(task.taskId, () => replyWithin(task, 'add a filter', ctx)); // round 1: dies mid-write
    assert.equal(task.status, 'error', 'precondition: the round errored');
    assert.match(readFileSync(specAbs, 'utf8'), /CORRUPT/, 'precondition: garbage really is on disk');

    await withTurn(task.taskId, () => replyWithin(task, 'try again', ctx)); // the RETRY
    assert.equal(task.status, 'awaiting_confirm', 'retry settled clean');

    const specBase = readFileSync(join(dir, `apps/builder/.runs/${task.taskId}/spec-base.md`), 'utf8');
    assert.equal(specBase, trueSpec,
      'the spec snapshot still holds the true pre-round state — NOT the failed attempt\'s garbage');
  });

  test('the directive names the failure that actually happened, not just "keep it in sync"', async () => {
    // On task 1787190372697 the turn DID write SPEC.md — and still broke it, by appending a decision
    // while the sentence it contradicted stayed. A directive that only says "update SPEC.md" would
    // have been satisfied by that turn. These two rules are what make it not satisfied.
    dir = fixtureDir();
    const { task, ctx, seen } = await driveToImplementGate();
    await withTurn(task.taskId, () => replyWithin(task, 'switch the provider', ctx));
    const resume = seen.prompts[seen.prompts.length - 1];
    assert.match(resume, /made untrue/, 'rule 1: hunt down statements the change falsified');
    assert.match(resume, /do not append an amendment/i, 'rule 2: fix in place, never append a block');
    // Handed over, not described. The first version said "task id" and the model wrote the workflow
    // slug into the change-log instead — the one column that makes a row traceable, guessed wrong.
    assert.ok(resume.includes(task.taskId), 'the change-log row must carry the REAL task id');
  });
});
