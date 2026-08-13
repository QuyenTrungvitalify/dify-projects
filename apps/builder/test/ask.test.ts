/**
 * Spec 033 — the two-layer Ask containment mechanism (server/lib/ask.ts).
 *
 * AC#1b: layer 1 assumed DEFEATED (a fake `runTurn` deliberately writes despite `BUILDER_ASK_MODE`) →
 * the backend restores byte-IDENTICAL content to the phase's own gate artifact.
 * AC#1c (FIX-M, a DIFFERENT test — NOT a restatement of #1b): a write to some OTHER file within the
 * same writable roots (not the gate artifact) is ALSO detected + restored/removed. A test scoped only
 * to the known artifact (#1b) would still pass even if layer 2's broadened scope were silently dropped
 * in a future refactor — #1c is what actually proves FIX-M.
 * Plus: the normal (clean) path, and FIX-D (a resume failure never falls through to a write-intent turn).
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { askWithin, askTestWithin } from '../server/lib/ask.js';
import { createTask, saveTask } from '../server/state/task.js';
import { acquireTurn, releaseTurn, requestAskCancel } from '../server/lib/lock.js';
import type { ClaudeSession, SessionLogger } from '../server/lib/claude-session.js';
import type { TurnResult } from '../server/lib/turn-runner.js';
import type { OrchestratorCtx, OrchestratorRunners } from '../server/lib/orchestrator-shared.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ask-'));
}

interface Broadcasted {
  event: string;
  data: unknown;
}

function ctxWith(
  dir: string,
  runTurn: OrchestratorRunners['runTurn']
): { ctx: OrchestratorCtx; events: Broadcasted[] } {
  const events: Broadcasted[] = [];
  const ctx: OrchestratorCtx = {
    projectsDir: dir,
    settingsPath: '',
    log,
    broadcast: (_id, event, data) => {
      events.push({ event, data });
    },
    runners: { runTurn },
  };
  return { ctx, events };
}

describe('askWithin — AC#1b: byte-identical restore of the gate artifact itself', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await tmp();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('a fake write to SPEC.md despite BUILDER_ASK_MODE is reverted byte-identical', async () => {
    const task = await createTask(dir, { requirement: 'r', confirmMode: 'each_step' });
    task.phase = 'spec';
    task.status = 'awaiting_confirm';
    await saveTask(dir, task);
    const runDir = join(dir, `apps/builder/.runs/${task.taskId}`);
    await mkdir(runDir, { recursive: true });
    const specAbs = join(runDir, 'SPEC.md');
    const original = '# Spec\noriginal content\n';
    await writeFile(specAbs, original);

    const runTurn = async (
      _s: ClaudeSession,
      _p: string,
      onSessionId?: (id: string) => void
    ): Promise<TurnResult> => {
      onSessionId?.('sess-1');
      await writeFile(specAbs, 'TAMPERED CONTENT'); // simulate a hook bypass (layer 1 assumed defeated)
      return { sessionId: 'sess-1', result: { type: 'result', is_error: false }, isError: false };
    };
    const { ctx, events } = ctxWith(dir, runTurn);

    assert.ok(acquireTurn(task.taskId, 'ask'));
    try {
      await askWithin(task, 'what does this do?', ctx);
    } finally {
      releaseTurn(task.taskId);
    }

    assert.equal(await readFile(specAbs, 'utf8'), original, 'byte-identical restore');
    const done = events.find((e) => e.event === 'ask:done');
    assert.ok(done);
    const data = done!.data as { ok: boolean; anomaly?: { files: Array<{ path: string; kind: string }> } };
    assert.equal(data.ok, false);
    assert.equal(data.anomaly?.files.length, 1);
    assert.equal(data.anomaly?.files[0].kind, 'modified');
    assert.match(data.anomaly!.files[0].path, /SPEC\.md$/);
    assert.equal(events.some((e) => e.event === 'task:update'), false, 'no task:update, ever (FIX-B)');
  });
});

describe('askWithin — AC#1c (FIX-M): a write to a DIFFERENT in-scope file is ALSO caught', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await tmp();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('a stray NEW file elsewhere in the workflow project is detected + removed (not just the artifact)', async () => {
    const task = await createTask(dir, { requirement: 'r', confirmMode: 'each_step' });
    task.project = 'p';
    task.workflowSlug = 'wf';
    task.phase = 'implement';
    task.status = 'awaiting_confirm';
    await saveTask(dir, task);
    const wfDir = join(dir, 'projects/p/wf/workflows');
    await mkdir(wfDir, { recursive: true });
    const mainAbs = join(wfDir, 'main.yml');
    const mainContent = 'workflow:\n  graph:\n    nodes: []\n';
    await writeFile(mainAbs, mainContent);
    const strayAbs = join(dir, 'projects/p/wf/evil.txt');

    const runTurn = async (
      _s: ClaudeSession,
      _p: string,
      onSessionId?: (id: string) => void
    ): Promise<TurnResult> => {
      onSessionId?.('sess-2');
      // the gate artifact itself is left untouched — the bypass instead drops a NEW file elsewhere in
      // the SAME workflow project. A single-file layer 2 (the pre-FIX-M design) would miss this entirely.
      await writeFile(strayAbs, 'not supposed to be here');
      return { sessionId: 'sess-2', result: { type: 'result', is_error: false }, isError: false };
    };
    const { ctx, events } = ctxWith(dir, runTurn);

    assert.ok(acquireTurn(task.taskId, 'ask'));
    try {
      await askWithin(task, 'what does this do?', ctx);
    } finally {
      releaseTurn(task.taskId);
    }

    assert.equal(existsSync(strayAbs), false, 'the stray file was removed (restored to absent)');
    assert.equal(await readFile(mainAbs, 'utf8'), mainContent, 'the real artifact is untouched');
    const done = events.find((e) => e.event === 'ask:done');
    const data = done!.data as { ok: boolean; anomaly?: { files: Array<{ path: string; kind: string }> } };
    assert.equal(data.ok, false);
    assert.equal(data.anomaly?.files.length, 1);
    assert.equal(data.anomaly?.files[0].kind, 'created');
    assert.match(data.anomaly!.files[0].path, /evil\.txt$/);
  });
});

describe('askWithin — the normal (clean) path', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await tmp();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('no write attempted → ask:done{ok:true}, no task:update, streamed via ask:answer, session persisted (D5)', async () => {
    const task = await createTask(dir, { requirement: 'r', confirmMode: 'each_step' });
    task.phase = 'spec';
    task.status = 'awaiting_confirm';
    await saveTask(dir, task);
    const runDir = join(dir, `apps/builder/.runs/${task.taskId}`);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'SPEC.md'), '# Spec\n');

    const runTurn = async (
      _s: ClaudeSession,
      _p: string,
      onSessionId?: (id: string) => void,
      opts?: { onText?: (t: string) => void }
    ): Promise<TurnResult> => {
      onSessionId?.('sess-3');
      opts?.onText?.('Sure — ');
      opts?.onText?.('here is the answer.');
      return { sessionId: 'sess-3', result: { type: 'result', is_error: false }, isError: false };
    };
    const { ctx, events } = ctxWith(dir, runTurn);

    assert.ok(acquireTurn(task.taskId, 'ask'));
    try {
      await askWithin(task, 'explain the analysis', ctx);
    } finally {
      releaseTurn(task.taskId);
    }

    const answers = events.filter((e) => e.event === 'ask:answer').map((e) => (e.data as { text: string }).text);
    assert.deepEqual(answers, ['Sure — ', 'here is the answer.']);
    const done = events.find((e) => e.event === 'ask:done');
    assert.deepEqual(done!.data, { ok: true });
    assert.equal(events.some((e) => e.event === 'task:update'), false, 'FIX-B: no task:update on the normal path');
    assert.equal(task.sessionIds.spec, 'sess-3', 'D5: the session id is persisted back to sessionIds[phase]');
  });

  test('a saveTask atomic-write temp (task.json.<pid>.<seq>.tmp) left mid-window is NOT a false anomaly', async () => {
    const task = await createTask(dir, { requirement: 'r', confirmMode: 'each_step' });
    task.phase = 'spec';
    task.status = 'awaiting_confirm';
    await saveTask(dir, task);
    const runDir = join(dir, `apps/builder/.runs/${task.taskId}`);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'SPEC.md'), '# Spec\n');

    // The turn writes NOTHING, but a concurrent atomic saveTask happens to leave its staging temp
    // present during the turn (simulating the rename not having landed yet). It must be excluded from
    // the anomaly compare — else it would be flagged 'created' and deleted (clobbering a real save).
    const runTurn = async (_s: ClaudeSession, _p: string, onSessionId?: (id: string) => void): Promise<TurnResult> => {
      onSessionId?.('sess-tmp');
      await writeFile(join(runDir, 'task.json.99999.7.tmp'), '{"staging":true}');
      return { sessionId: 'sess-tmp', result: { type: 'result', is_error: false }, isError: false };
    };
    const { ctx, events } = ctxWith(dir, runTurn);

    assert.ok(acquireTurn(task.taskId, 'ask'));
    try {
      await askWithin(task, 'q', ctx);
    } finally {
      releaseTurn(task.taskId);
    }

    const done = events.find((e) => e.event === 'ask:done');
    assert.deepEqual(done!.data, { ok: true }, 'the staging temp is backend bookkeeping, not a turn anomaly');
  });
});

describe('askWithin — never throws past the snapshot (the gate must never be errored by an internal hiccup)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await tmp();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('an unexpected throw inside the turn is caught → ask:done{ok:false}, NOT propagated (no failSafe→error)', async () => {
    const task = await createTask(dir, { requirement: 'r', confirmMode: 'each_step' });
    task.phase = 'spec';
    task.status = 'awaiting_confirm';
    await saveTask(dir, task);
    const runDir = join(dir, `apps/builder/.runs/${task.taskId}`);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'SPEC.md'), '# Spec\n');

    // A runTurn that THROWS (e.g. a transient disk error deep inside askTurn). If askWithin let this
    // escape, the dispatch wrapper's failSafe would flip the gate to `error` — the exact clobber D3
    // forbids. askWithin must swallow it and emit a benign ask:done{ok:false}.
    const runTurn = async (): Promise<TurnResult> => {
      throw new Error('simulated transient backend error');
    };
    const { ctx, events } = ctxWith(dir, runTurn);

    assert.ok(acquireTurn(task.taskId, 'ask'));
    let threw = false;
    try {
      await askWithin(task, 'q', ctx); // must NOT reject
    } catch {
      threw = true;
    } finally {
      releaseTurn(task.taskId);
    }

    assert.equal(threw, false, 'askWithin must not propagate the throw (else failSafe errors the gate)');
    const done = events.find((e) => e.event === 'ask:done');
    assert.deepEqual(done!.data, { ok: false });
    // the gate/status on disk are untouched — no failSafe ran.
    const onDisk = JSON.parse(await readFile(join(runDir, 'task.json'), 'utf8'));
    assert.equal(onDisk.status, 'awaiting_confirm', 'the parked gate is left exactly as it was');
  });
});

describe('askWithin — FIX-D: a resume failure never falls through to a write-intent fresh turn', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await tmp();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('an errored turn with NO streamed text → a canned answer, NOT a second (fresh) spawn', async () => {
    const task = await createTask(dir, { requirement: 'r', confirmMode: 'each_step' });
    task.phase = 'spec';
    task.status = 'awaiting_confirm';
    task.sessionIds.spec = 'stale-session-id';
    await saveTask(dir, task);
    const runDir = join(dir, `apps/builder/.runs/${task.taskId}`);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'SPEC.md'), '# Spec\n');

    let calls = 0;
    const runTurn = async (): Promise<TurnResult> => {
      calls++;
      // a resume-attach failure: errored before any result/text event (turn-runner sets a `note`, but
      // the FIX-D branch is now gated on `!gotText`, not `!note`, so it fires here).
      return { sessionId: null, result: null, isError: true, note: 'process exited code 1 before a result event' };
    };
    const { ctx, events } = ctxWith(dir, runTurn);

    assert.ok(acquireTurn(task.taskId, 'ask'));
    try {
      await askWithin(task, 'a follow-up question', ctx);
    } finally {
      releaseTurn(task.taskId);
    }

    assert.equal(calls, 1, 'askTurn is invoked exactly once — no write-intent re-spawn');
    const answers = events.filter((e) => e.event === 'ask:answer').map((e) => (e.data as { text: string }).text);
    assert.equal(answers.length, 1);
    assert.match(answers[0], /couldn't get an answer|Request changes/);
    const done = events.find((e) => e.event === 'ask:done');
    assert.deepEqual(done!.data, { ok: false });
  });

  test('a turn that STREAMED partial text then errored keeps that text AND says it is incomplete', async () => {
    const task = await createTask(dir, { requirement: 'r', confirmMode: 'each_step' });
    task.phase = 'spec';
    task.status = 'awaiting_confirm';
    await saveTask(dir, task);
    const runDir = join(dir, `apps/builder/.runs/${task.taskId}`);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'SPEC.md'), '# Spec\n');

    const runTurn = async (_s: ClaudeSession, _p: string, _cb?: (id: string) => void, opts?: { onText?: (t: string) => void }): Promise<TurnResult> => {
      opts?.onText?.('Partial answer before it died…');
      return { sessionId: null, result: null, isError: true, note: 'process exited code 1 before a result event' };
    };
    const { ctx, events } = ctxWith(dir, runTurn);

    assert.ok(acquireTurn(task.taskId, 'ask'));
    try {
      await askWithin(task, 'q', ctx);
    } finally {
      releaseTurn(task.taskId);
    }

    const answers = events.filter((e) => e.event === 'ask:answer').map((e) => (e.data as { text: string }).text);
    // The original guard, unchanged: the partial text SURVIVES and is not replaced by a canned message.
    assert.equal(answers[0], 'Partial answer before it died…', 'partial text kept, NOT replaced');
    // Spec 097: and the reader is told it is partial. Keeping the text was only half the decision —
    // without this the answer finalized as "Answered", indistinguishable from a complete one, and the
    // reader waited for a continuation that could never come (task 1786505684286).
    assert.equal(answers.length, 2, 'exactly one notice appended, nothing else');
    assert.match(answers[1], /stopped early and is incomplete/);
    assert.match(answers[1], /process exited code 1/, 'the classified cause is carried, not swallowed');
    assert.match(answers[1], /Nothing was written to your files/, 'says what did NOT happen');
    const done = events.find((e) => e.event === 'ask:done');
    // ok:false now — `ok` only drives the graduate-to-build prefill, and a cut-off answer must never
    // become a requirement.
    assert.deepEqual(done!.data, { ok: false }, 'a truncated answer is not a successful one');
  });
});

describe('askWithin — review #2: a cancel during the pre-spawn snapshot window aborts (no spawn)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await tmp();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('requestAskCancel set before spawn → askWithin bails after snapshot, runTurn never called', async () => {
    const task = await createTask(dir, { requirement: 'r', confirmMode: 'each_step' });
    task.phase = 'spec';
    task.status = 'awaiting_confirm';
    await saveTask(dir, task);
    const runDir = join(dir, `apps/builder/.runs/${task.taskId}`);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'SPEC.md'), '# Spec\n');

    let spawned = false;
    const runTurn = async (): Promise<TurnResult> => {
      spawned = true;
      return { sessionId: 's', result: { type: 'result', is_error: false }, isError: false };
    };
    const { ctx, events } = ctxWith(dir, runTurn);

    assert.ok(acquireTurn(task.taskId, 'ask'));
    requestAskCancel(task.taskId); // a Stop landed in the [lock acquired → setSession] window
    try {
      await askWithin(task, 'q', ctx);
    } finally {
      releaseTurn(task.taskId);
    }

    assert.equal(spawned, false, 'the Ask turn is NOT spawned when cancel was requested pre-spawn');
    const done = events.find((e) => e.event === 'ask:done');
    assert.deepEqual(done!.data, { ok: false });
  });
});

describe('askWithin — review #4: a failing per-file restore is isolated + reported, not hidden', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await tmp();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('one un-revertable file (EISDIR) is flagged restoreFailed while the OTHER file is still restored', async () => {
    const task = await createTask(dir, { requirement: 'r', confirmMode: 'each_step' });
    task.project = 'p';
    task.workflowSlug = 'wf';
    task.phase = 'implement';
    task.status = 'awaiting_confirm';
    await saveTask(dir, task);
    const wfDir = join(dir, 'projects/p/wf');
    await mkdir(join(wfDir, 'workflows'), { recursive: true });
    const mainAbs = join(wfDir, 'workflows/main.yml');
    const original = 'workflow:\n  graph:\n    nodes: []\n';
    await writeFile(mainAbs, original);
    // a 2nd file that the turn will delete — its restore (recreate) will succeed normally.
    const okAbs = join(wfDir, 'keeper.txt');
    await writeFile(okAbs, 'keep me\n');

    const runTurn = async (_s: ClaudeSession, _p: string, onSessionId?: (id: string) => void): Promise<TurnResult> => {
      onSessionId?.('s');
      // File A (main.yml): delete the file, then create a DIRECTORY at its exact path → the restore's
      // writeFile(main.yml, bytes) fails with EISDIR (can't write a file over a directory) → restoreFailed.
      await rm(mainAbs);
      await mkdir(mainAbs);
      await writeFile(join(mainAbs, 'child'), 'x'); // a child so walkDir sees the dir as populated
      // File B (keeper.txt): a plain deletion → restore recreates it cleanly (no failure).
      await rm(okAbs);
      return { sessionId: 's', result: { type: 'result', is_error: false }, isError: false };
    };
    const { ctx, events } = ctxWith(dir, runTurn);

    assert.ok(acquireTurn(task.taskId, 'ask'));
    try {
      await askWithin(task, 'q', ctx);
    } finally {
      releaseTurn(task.taskId);
    }

    const done = events.find((e) => e.event === 'ask:done');
    const data = done!.data as { ok: boolean; anomaly?: { files: Array<{ path: string; kind: string; restoreFailed?: boolean }> } };
    assert.equal(data.ok, false);
    // File B was restored cleanly despite File A failing — the loop was NOT aborted by the first failure.
    assert.equal(await readFile(okAbs, 'utf8'), 'keep me\n', 'keeper.txt restored (isolation held)');
    // File A is reported with restoreFailed:true (surfaced, not hidden behind a clean settle).
    const failed = data.anomaly?.files.find((f) => /main\.yml$/.test(f.path));
    assert.ok(failed, 'main.yml is reported');
    assert.equal(failed?.restoreFailed, true, 'main.yml flagged restoreFailed (could not revert the file-over-dir)');
  });
});

// ─────────────────────── spec 034: the fresh-seeded ④/terminal Ask (askTestWithin) ───────────────────────
describe('askTestWithin — spec 034: fresh-seeded ④/terminal Ask', () => {
  let dir: string;
  beforeEach(async () => { dir = await tmp(); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  test('names the task attachments in the prompt (a file at ④ / on a terminal build was invisible to the turn)', async () => {
    const task = await createTask(dir, { requirement: 'r', confirmMode: 'each_step' });
    task.phase = 'test';
    task.status = 'done';
    task.attachments = [`apps/builder/.runs/${task.taskId}/uploads/0_shot.png`];
    await saveTask(dir, task);

    let seenPrompt = '';
    const runTurn = async (
      _s: ClaudeSession, prompt: string,
      onSessionId?: (id: string) => void, opts?: { onText?: (t: string) => void }
    ): Promise<TurnResult> => {
      seenPrompt = prompt;
      onSessionId?.('askTest-att');
      opts?.onText?.('ok');
      return { sessionId: 'askTest-att', result: { type: 'result', is_error: false }, isError: false };
    };
    const { ctx } = ctxWith(dir, runTurn);
    assert.ok(acquireTurn(task.taskId, 'ask'));
    try {
      await askTestWithin(task, 'what is red in this screenshot?', ctx);
    } finally {
      releaseTurn(task.taskId);
    }
    assert.match(seenPrompt, /Attached files:/);
    assert.ok(seenPrompt.includes(`uploads/0_shot.png`), 'the saved path is named, so the turn can Read it');
  });

  test('assembles the seed from artifacts + task fields, streams an answer, leaves the ④ gate untouched, persists askTest', async () => {
    const task = await createTask(dir, { requirement: 'my requirement', confirmMode: 'each_step' });
    task.project = 'p';
    task.workflowSlug = 'wf';
    task.phase = 'test';
    task.status = 'awaiting_confirm';
    task.gate = { actions: [{ id: 'accept', label: 'Accept result', kind: 'confirm', route: '/confirm' }], flag: 'test_result' };
    task.liveTest = { verdict: 'pass', label: 'live-verified' } as unknown as import('../server/state/task.js').LiveTestResult;
    await saveTask(dir, task);
    await mkdir(join(dir, 'projects/p/wf/workflows'), { recursive: true });
    await writeFile(join(dir, 'projects/p/wf/SPEC.md'), '# spec body');
    await writeFile(join(dir, 'projects/p/wf/workflows/main.yml'), 'workflow: {}');
    await mkdir(join(dir, `apps/builder/.runs/${task.taskId}`), { recursive: true });
    await writeFile(join(dir, `apps/builder/.runs/${task.taskId}/report.json`), '{"ok":true}');

    let seenPrompt = '';
    const runTurn = async (
      _s: ClaudeSession, prompt: string,
      onSessionId?: (id: string) => void, opts?: { onText?: (t: string) => void }
    ): Promise<TurnResult> => {
      seenPrompt = prompt;
      onSessionId?.('askTest-1');
      opts?.onText?.('the answer');
      return { sessionId: 'askTest-1', result: { type: 'result', is_error: false }, isError: false };
    };
    const { ctx, events } = ctxWith(dir, runTurn);
    assert.ok(acquireTurn(task.taskId, 'ask'));
    try {
      await askTestWithin(task, 'why did it pass?', ctx);
    } finally {
      releaseTurn(task.taskId);
    }

    for (const needle of ['my requirement', 'spec body', 'main.yml', 'report.json', 'Live-test result', 'why did it pass?']) {
      assert.ok(seenPrompt.includes(needle), `seed prompt contains "${needle}"`);
    }
    assert.ok(events.some((e) => e.event === 'ask:answer' && (e.data as { text: string }).text === 'the answer'));
    const done = events.find((e) => e.event === 'ask:done');
    const dd = done!.data as { ok: boolean; seededFrom?: string[] };
    assert.equal(dd.ok, true);
    assert.deepEqual(dd.seededFrom, ['requirement', 'SPEC.md', 'main.yml', 'report.json', 'liveTest']);
    // the ④ gate/status/phase are byte-unchanged (AC#1) and never a task:update
    assert.equal(task.status, 'awaiting_confirm');
    assert.equal(task.phase, 'test');
    assert.ok(task.gate);
    assert.equal(events.some((e) => e.event === 'task:update'), false);
    // the dedicated askTest slot is persisted; phase sessions are never touched (D2/AC#3)
    assert.equal(task.sessionIds.askTest, 'askTest-1');
    assert.equal(task.sessionIds.spec, undefined);
  });

  test('097: a TIMED-OUT terminal ask keeps its partial answer, says it is incomplete, and keeps seededFrom', async () => {
    // The reported failure (task 1786505684286): a 3-minute wall killed an ask mid-analysis, the partial
    // text was kept — correctly — but finalized as "Answered", so the reader waited for a continuation
    // that could never come. `seededFrom` must survive too: the answer WAS assembled from those files,
    // and being cut off does not unmake that. Nothing guarded that carry, so it was silently droppable.
    const task = await createTask(dir, { requirement: 'my requirement', confirmMode: 'each_step' });
    task.project = 'p';
    task.workflowSlug = 'wf';
    task.phase = 'test';
    task.status = 'awaiting_confirm';
    task.gate = { actions: [], flag: 'test_result' };
    await saveTask(dir, task);
    await mkdir(join(dir, 'projects/p/wf/workflows'), { recursive: true });
    await writeFile(join(dir, 'projects/p/wf/SPEC.md'), '# spec body');

    const runTurn = async (
      _s: ClaudeSession, _p: string,
      _cb?: (id: string) => void, opts?: { onText?: (t: string) => void }
    ): Promise<TurnResult> => {
      opts?.onText?.('Checking the patterns in the repo… I will report back shortly.');
      return { sessionId: null, result: null, isError: true, note: 'timed out after 180s' };
    };
    const { ctx, events } = ctxWith(dir, runTurn);
    assert.ok(acquireTurn(task.taskId, 'ask'));
    try {
      await askTestWithin(task, 'are you done analysing?', ctx);
    } finally {
      releaseTurn(task.taskId);
    }

    const answers = events.filter((e) => e.event === 'ask:answer').map((e) => (e.data as { text: string }).text);
    assert.equal(answers[0], 'Checking the patterns in the repo… I will report back shortly.', 'partial text kept');
    assert.equal(answers.length, 2, 'exactly one notice appended');
    assert.match(answers[1], /stopped early and is incomplete/);
    assert.match(answers[1], /timed out after 180s/, 'the wall-clock cause is named, not swallowed');
    const dd = events.find((e) => e.event === 'ask:done')!.data as { ok: boolean; seededFrom?: string[] };
    assert.equal(dd.ok, false, 'a truncated answer must never read as a successful one');
    assert.deepEqual(dd.seededFrom, ['requirement', 'SPEC.md'], 'the provenance caption survives truncation');
  });

  test('degrades gracefully: a cancelled-mid-Implement task with no report.json omits it from seededFrom (still ok:true)', async () => {
    const task = await createTask(dir, { requirement: 'r', confirmMode: 'each_step' });
    task.project = 'p';
    task.workflowSlug = 'wf';
    task.status = 'cancelled';
    await saveTask(dir, task);
    await mkdir(join(dir, 'projects/p/wf'), { recursive: true });
    await writeFile(join(dir, 'projects/p/wf/SPEC.md'), '# partial spec');
    // NO main.yml, NO report.json — cancelled before Implement wrote them.

    const runTurn = async (
      _s: ClaudeSession, _p: string,
      onSessionId?: (id: string) => void, opts?: { onText?: (t: string) => void }
    ): Promise<TurnResult> => {
      onSessionId?.('askTest-c');
      opts?.onText?.('ok');
      return { sessionId: 'askTest-c', result: { type: 'result', is_error: false }, isError: false };
    };
    const { ctx, events } = ctxWith(dir, runTurn);
    assert.ok(acquireTurn(task.taskId, 'ask'));
    try {
      await askTestWithin(task, 'what happened?', ctx);
    } finally {
      releaseTurn(task.taskId);
    }
    const dd = events.find((e) => e.event === 'ask:done')!.data as { ok: boolean; seededFrom?: string[] };
    assert.equal(dd.ok, true);
    assert.deepEqual(dd.seededFrom, ['requirement', 'SPEC.md']); // main.yml + report.json absent → dropped
    assert.equal(task.status, 'cancelled'); // Ask never flips a terminal status
  });

  test('a 2nd Ask --resumes sessionIds.askTest (D2), not a fresh spawn', async () => {
    const task = await createTask(dir, { requirement: 'r', confirmMode: 'each_step' });
    task.status = 'done';
    task.sessionIds.askTest = 'prior-sess';
    await saveTask(dir, task);

    let resumeSeen: string | undefined = 'UNSET';
    const runTurn = async (
      s: ClaudeSession, _p: string,
      onSessionId?: (id: string) => void, opts?: { onText?: (t: string) => void }
    ): Promise<TurnResult> => {
      resumeSeen = (s as unknown as { options: { resumeSessionId?: string } }).options.resumeSessionId;
      onSessionId?.('prior-sess');
      opts?.onText?.('a');
      return { sessionId: 'prior-sess', result: { type: 'result', is_error: false }, isError: false };
    };
    const { ctx } = ctxWith(dir, runTurn);
    assert.ok(acquireTurn(task.taskId, 'ask'));
    try {
      await askTestWithin(task, 'follow-up', ctx);
    } finally {
      releaseTurn(task.taskId);
    }
    assert.equal(resumeSeen, 'prior-sess', 'the 2nd Ask --resumes the persisted askTest session (D2)');
  });
});
