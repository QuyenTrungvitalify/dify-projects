/**
 * Spec 111 — what a turn changed under `projects/` OUTSIDE its own folder.
 *
 * WHY A SECOND DETECTOR EXISTS. `confinementCheck` reads `git status`, and `.gitignore` holds
 * `projects/_drafts/` WHOLESALE — the project 33 of the 35 real runs on the author's machine live in.
 * So for almost every build the git delta is empty and every cross-project write lands in a blind spot.
 * Two measured incidents rode it out in silence:
 *
 *   run 1787273481220 — ③ wrote the entire deliverable into ANOTHER project's folder and died
 *                       `artifact missing`, naming a path nobody had written to. Four later turns spent
 *                       $19.25 editing that other folder while the gate said `success`, because the
 *                       file it grades was unchanged and lint-clean.
 *   run 1787544155222 — the turns labelled ② rewrote `main.yml` and `appScript.js`; ②'s verify checks
 *                       only SPEC.md, so none of it met a linter, a diff, or the undo button.
 *
 * NOTHING IS EVER REVERTED, and the tests pin that: a file under `projects/_drafts/` has no copy in
 * git, so "revert" would mean DELETE — on the first run above that would have destroyed the only
 * usable artifact the build produced.
 *
 * Spec 114 split the rest in two, and the tests pin the LINE as much as the behaviour:
 *   · a stray WORKFLOW YAML fails the phase. Spec 111 left it passing, and "passing" is what the money
 *     went to — the gate said `success` over a build whose deliverable was in another folder, and four
 *     more turns were spent on top of that.
 *   · anything else stays advisory, because this scan is mtime-based and the BUILDER can trip it:
 *     `PUT /api/tasks/:id/spec` lets a human save another task's spec while this turn runs. That is the
 *     only writer of its kind and it writes SPEC.md, so the yaml scope puts it out of reach by
 *     construction rather than by luck.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { strayWrites, changedWorkflowYmls } from '../server/lib/post-turn.js';
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

let dir: string;
let current: Task | null = null;

afterEach(() => {
  current = null;
  rmSync(dir, { recursive: true, force: true });
});

/** Write a file and stamp its mtime, so a test never depends on wall-clock resolution. */
function fileAt(abs: string, body: string, mtimeSec: number): void {
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  utimesSync(abs, mtimeSec, mtimeSec);
}

describe('111 · strayWrites — the detector git cannot be', () => {
  test('finds a gitignored cross-project write, and skips the build\'s own folder', async () => {
    dir = mkdtempSync(join(tmpdir(), 'stray-unit-'));
    const t0 = 1_000_000;
    fileAt(join(dir, 'projects/_drafts/mine/workflows/main.yml'), 'own\n', t0 + 60); // own folder, changed
    fileAt(join(dir, 'projects/_drafts/other/workflows/main.yml'), 'stray\n', t0 + 60); // ← the incident
    fileAt(join(dir, 'projects/_drafts/other/SPEC-FIX.md'), 'stray\n', t0 + 60); // ← and its sibling
    fileAt(join(dir, 'projects/_drafts/untouched/workflows/main.yml'), 'old\n', t0 - 60);

    const strays = await strayWrites(dir, t0 * 1000, 'projects/_drafts/mine');

    assert.deepEqual(strays, [
      'projects/_drafts/other/SPEC-FIX.md',
      'projects/_drafts/other/workflows/main.yml',
    ]);
  });

  test('a stray is not only a .yml — the real ones were a .md and a .js', async () => {
    // A detector scoped to `workflows/*.yml` would have missed every file the 2026-08-24 turns wrote:
    // `SPEC-FIX.md` and `SPEC-APP1-NG.md` sit at the project ROOT, and `appScript.js` is not YAML.
    dir = mkdtempSync(join(tmpdir(), 'stray-shape-'));
    const t0 = 2_000_000;
    fileAt(join(dir, 'projects/_drafts/other/SPEC-APP1-NG.md'), 'x\n', t0 + 60);
    fileAt(join(dir, 'projects/_drafts/other/workflows/appScript.js'), 'x\n', t0 + 60);

    const strays = await strayWrites(dir, t0 * 1000, 'projects/_drafts/mine');

    assert.equal(strays.length, 2, 'both, not just the YAML');
  });

  test('finder droppings and tool dirs never make the list', async () => {
    dir = mkdtempSync(join(tmpdir(), 'stray-junk-'));
    const t0 = 3_000_000;
    fileAt(join(dir, 'projects/_drafts/other/.DS_Store'), 'x\n', t0 + 60);
    fileAt(join(dir, 'projects/_drafts/other/node_modules/pkg/index.js'), 'x\n', t0 + 60);
    fileAt(join(dir, 'projects/_drafts/other/real.md'), 'x\n', t0 + 60);

    assert.deepEqual(await strayWrites(dir, t0 * 1000, null), ['projects/_drafts/other/real.md']);
  });

  test('a pre-scaffold turn (no own folder yet) still gets a report', async () => {
    dir = mkdtempSync(join(tmpdir(), 'stray-null-'));
    const t0 = 4_000_000;
    fileAt(join(dir, 'projects/_drafts/other/workflows/main.yml'), 'x\n', t0 + 60);
    assert.equal((await strayWrites(dir, t0 * 1000, null)).length, 1);
  });

  test('an unreadable tree is silence, never a throw — this must not be able to fail a phase', async () => {
    dir = mkdtempSync(join(tmpdir(), 'stray-empty-'));
    assert.deepEqual(await strayWrites(dir, 0, null), []); // no projects/ at all
  });

  test('changedWorkflowYmls — the own-folder complement: ymls only, mtime-gated, no dir is fine', async () => {
    // strayWrites SKIPS the build folder by design; this is what covers it for ①/② turns.
    dir = mkdtempSync(join(tmpdir(), 'own-edits-'));
    const t0 = 5_000_000;
    fileAt(join(dir, 'projects/_drafts/mine/workflows/main.yml'), 'edited\n', t0 + 60);
    fileAt(join(dir, 'projects/_drafts/mine/workflows/old.yaml'), 'old\n', t0 - 60);
    fileAt(join(dir, 'projects/_drafts/mine/workflows/appScript.js'), 'x\n', t0 + 60); // not a yml — not GRADED here
    fileAt(join(dir, 'projects/_drafts/mine/SPEC.md'), 'x\n', t0 + 60); // the phase's own artifact

    assert.deepEqual(
      await changedWorkflowYmls(dir, 'projects/_drafts/mine/workflows', t0 * 1000),
      ['projects/_drafts/mine/workflows/main.yml'],
    );
    assert.deepEqual(await changedWorkflowYmls(dir, 'projects/none/workflows', 0), [], 'pre-scaffold → empty, no throw');
  });
});

describe('111 · the gate says what changed outside the build folder', () => {
  function fixtureDir(): string {
    const d = mkdtempSync(join(tmpdir(), 'stray-e2e-'));
    const skill = join(d, '.claude', 'skills', 'dify-build');
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, 'analyze.md'), '# analyze\n{{REQUIREMENT}}\n');
    writeFileSync(join(skill, 'spec.md'), '# spec\n{{REQUIREMENT}}\n');
    writeFileSync(join(skill, 'implement.md'), '# implement\n{{WORKFLOW_FILE}}\n{{KNOWLEDGE}}\n');
    return d;
  }

  /** A file written "by the turn": stamped 1s into the future so a same-millisecond spawn can never flake. */
  function turnWrite(abs: string, body: string): void {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
    const t = Date.now() / 1000 + 1;
    utimesSync(abs, t, t);
  }

  interface E2eCtl {
    /** the 1787273481220 shape: ③ builds a fine workflow — in someone else's folder. */
    strayDuringImplement?: boolean;
    /** the 1787544155222 shape: a "spec" turn edits the build's own main.yml. */
    specEditsWorkflow?: boolean;
    /** spec 114: a stray that is NOT a workflow yaml — the class that must stay advisory, because the
     *  builder itself can produce it (`PUT /api/tasks/:id/spec` while this turn runs). */
    strayNonYamlDuringImplement?: boolean;
    /** grading fake: validate_workflow.py exits 1 on every graded file. */
    lintFail?: boolean;
  }

  function harness(d: string, ctl: E2eCtl): OrchestratorCtx {
    const runTurn = async (_s: ClaudeSession, _p: string): Promise<TurnResult> => {
      const task = current!;
      const phase = PHASES.find((p) => p.id === task.phase)!;
      const abs = join(d, phase.artifactRel(task));
      mkdirSync(dirname(abs), { recursive: true });
      if (task.phase === 'analyze') writeFileSync(abs, '{"seed": null, "summary": "ok"}');
      else if (task.phase === 'spec') {
        writeFileSync(abs, '# SPEC\n');
        // Only once the folder EXISTS. Pre-scaffold `task.project`/`workflowSlug` are null, and writing
        // `projects/null/null/workflows/main.yml` is not something a ② turn can do — it is the fixture
        // interpolating nulls. Spec 114 surfaced it by failing on stray yaml: a pre-scaffold turn has no
        // folder of its own, so ANY workflow yaml under `projects/` is out of bounds there, exactly as
        // `confinementCheck` already treats it (confinement.test.ts, project/workflowSlug=null).
        if (ctl.specEditsWorkflow && task.project && task.workflowSlug) {
          turnWrite(join(d, `projects/${task.project}/${task.workflowSlug}/workflows/main.yml`), 'workflow: edited by phase 2\n');
        }
      } else {
        writeFileSync(abs, 'workflow:\n  graph:\n    nodes: []\n');
        if (ctl.strayDuringImplement) {
          turnWrite(join(d, 'projects/_drafts/app2/workflows/main.yml'), 'workflow: the deliverable, in the wrong folder\n');
        }
        if (ctl.strayNonYamlDuringImplement) {
          turnWrite(join(d, 'projects/_drafts/app2/SPEC.md'), '# someone else spec, saved from the panel\n');
        }
      }
      return { sessionId: `sess-${task.phase}`, result: { type: 'result', is_error: false }, isError: false };
    };
    const runPython = async (_p: string, args: string[]): Promise<ShellResult> => {
      applyInitFake(d, args);
      // The grading pass (spec 108 S5) reaches THIS fake via resolveRunners — answer its two shapes.
      if (args[0] === '-c') return { code: 0, stdout: JSON.stringify({ node_ids: ['1234567890123'] }), stderr: '' };
      if (ctl.lintFail && args[0]?.includes('validate_workflow')) return { code: 1, stdout: 'node x: broken', stderr: '' };
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

  async function driveToImplement(ctl: E2eCtl): Promise<{ task: Task; ctx: OrchestratorCtx }> {
    const ctx = harness(dir, ctl);
    const task = await createTask(dir, { requirement: 'r', deploy: 'none' });
    current = task;
    await withTurn(task.taskId, () => startTask(task, ctx));
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx));
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx));
    return { task, ctx };
  }

  // Spec 114 — this is the run-1787273481220 shape, and the assertion that changed. Under spec 111 the
  // phase still PASSED here: the gate said `success` over a build whose deliverable had gone to another
  // folder, and four more turns spent $19.25 on top of that. Failing is the third option between
  // "say nothing" and "revert" — the file stays put, and the gate stops vouching for the build.
  test('a ③ that builds into another project FAILS the phase — and the file is still left alone', async () => {
    dir = fixtureDir();
    const { task } = await driveToImplement({ strayDuringImplement: true });

    assert.equal(task.phase, 'implement');
    assert.equal(task.status, 'error', 'the gate no longer vouches for a build that went elsewhere');
    assert.match(task.error ?? '', /app2\/workflows\/main\.yml/, 'the error NAMES the misplaced file');
    assert.ok(task.strayNote, 'and the human-readable note is still there beside it');
    assert.match(task.strayNote!, /app2\/workflows\/main\.yml \(4 linter xanh\)/, 'graded, not merely listed');
    assert.equal(
      existsSync(join(dir, 'projects/_drafts/app2/workflows/main.yml')),
      true,
      'still on disk — a revert here would delete the one artifact that has no git copy',
    );
  });

  // The other half of the rule, and the reason the failure is scoped to yaml at all. `strayWrites` is
  // mtime-based, so ANY writer under `projects/` lands in it mid-turn — including the builder itself:
  // `PUT /api/tasks/:id/spec` lets a human save ANOTHER task's spec from the panel while this turn
  // runs. That route is the only writer of its kind and it writes SPEC.md, so keeping the failure to
  // `workflows/*.ya?ml` puts it out of reach by construction rather than by luck.
  test('a stray that is NOT a workflow yaml is still only REPORTED — the builder can write those itself', async () => {
    dir = fixtureDir();
    const { task } = await driveToImplement({ strayNonYamlDuringImplement: true });

    assert.equal(task.status, 'awaiting_confirm', 'a SPEC.md next door must not be able to kill a build');
    assert.ok(task.strayNote, 'but it is still reported');
    assert.match(task.strayNote!, /app2\/SPEC\.md/, 'and named');
  });

  test('an ordinary turn says nothing at all', async () => {
    dir = fixtureDir();
    const { task } = await driveToImplement({});
    assert.equal(task.strayNote, undefined, 'silence is the everyday case, or the note stops being read');
  });

  test('a ② turn that edits the build\'s own workflow is graded like ③ would have graded it', async () => {
    // The 1787544155222 shape: the build was parked, the human steered from the ② gate, and the "spec"
    // turns rewrote main.yml — which ②'s verify (stat SPEC.md) never looked at. The phase model may
    // bend (the human chose "let it edit"); the BOOKS may not.
    dir = fixtureDir();
    const { task, ctx } = await driveToImplement({ specEditsWorkflow: true });
    // Put the build where the incident had it: parked at the ② gate with the slug already set (the
    // restored-build state). A /reply from here resumes phase ② — not ③.
    task.phase = 'spec';
    task.status = 'awaiting_confirm';

    await withTurn(task.taskId, () => replyWithin(task, 'sửa lại node lọc giùm', ctx));

    assert.equal(task.phase, 'spec', 'precondition: the reply ran as a ② turn');
    assert.ok(task.strayNote, 'the edit is on the books');
    assert.match(task.strayNote!, /phase ②/);
    assert.match(task.strayNote!, /workflows\/main\.yml \(4 linter xanh\)/, 'same four linters, same verdict format');
    assert.match(task.strayNote!, /差分/, 'and the diff tab was told');
  });

  test('a broken off-phase edit says lint đỏ instead of passing silently', async () => {
    dir = fixtureDir();
    const { task, ctx } = await driveToImplement({ specEditsWorkflow: true, lintFail: true });
    task.phase = 'spec';
    task.status = 'awaiting_confirm';

    await withTurn(task.taskId, () => replyWithin(task, 'sửa tiếp đi', ctx));

    assert.match(task.strayNote!, /lint đỏ/);
    assert.equal(task.status, 'awaiting_confirm', 'still advisory — a red verdict informs, it does not fail the phase');
  });
});
