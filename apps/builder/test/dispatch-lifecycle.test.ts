/**
 * The `dispatch()` lifecycle — the route-level wiring every other FSM test has to ASSUME.
 *
 * Until `TasksRoutesOptions.runners` existed, the 013 D2 seams stopped at the plugin boundary: a test
 * could only reach the state machine by calling startTask/confirmAdvance DIRECTLY and driving
 * acquireTurn/releaseTurn by hand (golden-build.test.ts's `withTurn`, advance-loop.test.ts). So the
 * three invariants that live INSIDE `dispatch()` — and nowhere else — had no coverage at all:
 *
 *   1. the turn lock is held for the WHOLE dispatched chain and released exactly once when it settles
 *      (the build parks at a gate, or goes terminal) — the `finally`;
 *   2. an unexpected throw converges to a relayed `status:error` instead of a silently stuck build —
 *      `failSafe`;
 *   3. the `cancelledTasks` flag is evicted ONLY on a terminal settle, so it neither leaks (unbounded
 *      Set) nor disappears while a post-await `isCancelled` check still needs it.
 *
 * These drive the REAL routes through `app.inject`, with the runner seams faked — no `claude`, no
 * python, no Dify. Each turn blocks on a deferred gate the test releases, so "held DURING" and "freed
 * AFTER" are asserted deterministically rather than raced.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import Fastify from 'fastify';
import tasksRoutes, { type TasksRoutesOptions } from '../server/routes/tasks.js';
import { loadTask, saveTask, type Task } from '../server/state/task.js';
import { PHASES } from '../server/lib/phases.js';
import { cancelledCount, releaseTurn, buildTurnBusy, buildHolderId } from '../server/lib/lock.js';
import { applyInitFake } from './helpers/scaffold-fake.js';
import type { ClaudeSession, SessionLogger } from '../server/lib/claude-session.js';
import type { TurnResult } from '../server/lib/turn-runner.js';
import type { PostTurnParams, PostTurnResult } from '../server/lib/post-turn.js';
import type { ReportOpts, ReportResult } from '../server/lib/report.js';
import type { ShellResult } from '../server/lib/shell.js';

/** A promise plus its resolver — the gate a faked turn blocks on. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = () => r();
  });
  return { promise, release };
}

/** Poll until `cond` holds (the dispatched chain is fire-and-forget, so there is nothing to await).
 *  Budget is generous: under the FULL parallel suite each fake-turn chain still spawns real `git`
 *  several times per phase, and a loaded box can stretch one chain well past 4s. */
async function waitFor(cond: () => boolean, what: string, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** A repo fixture with the skill bodies runPhase reads. */
async function fixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dispatch-'));
  const skill = join(dir, '.claude', 'skills', 'dify-build');
  await mkdir(skill, { recursive: true });
  for (const n of ['analyze', 'spec', 'implement']) await writeFile(join(skill, `${n}.md`), `# ${n}\n`);
  return dir;
}

interface Harness {
  app: Awaited<ReturnType<typeof Fastify>>;
  events: Array<{ status: string; error?: string }>;
  /** the ReportOpts each faked ④ report received — pins that a client body can't smuggle reuseLint. */
  reportCalls: Array<ReportOpts | undefined>;
}

/**
 * Build the routes with faked seams. `gate` (when given) blocks every turn until released, so the test
 * controls exactly when the dispatched chain settles. `onTurn` can throw to exercise failSafe.
 */
async function build(dir: string, opts: { gate?: Promise<void>; onTurn?: () => void } = {}): Promise<Harness> {
  const events: Harness['events'] = [];
  const runTurn = async (_s: ClaudeSession, _p: string, _cb?: (id: string) => void): Promise<TurnResult> => {
    if (opts.gate) await opts.gate;
    opts.onTurn?.(); // may throw → the failSafe path
    // Write the artifact the (real) ①/② verify demands, for whichever phase is running.
    const t = JSON.parse(await (await import('node:fs/promises')).readFile(join(dir, latestTaskFile!), 'utf8')) as Task;
    const phase = PHASES.find((p) => p.id === t.phase)!;
    const abs = join(dir, phase.artifactRel(t));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, t.phase === 'analyze' ? '{"seed":null,"summary":"ok"}' : '# SPEC\n');
    return { sessionId: `s-${t.phase}`, result: { type: 'result', is_error: false }, isError: false };
  };
  // init_project.py's disk effect is mirrored so the REAL scaffoldAtSpecGate (②→③ /confirm) works.
  const runPython = async (d: string, args: string[]): Promise<ShellResult> => {
    applyInitFake(d, args);
    return { code: 0, stdout: '', stderr: '' };
  };
  const reportCalls: Harness['reportCalls'] = [];
  const runReport = async (_d: string, t: Task, _log: SessionLogger, o?: ReportOpts): Promise<ReportResult> => {
    reportCalls.push(o);
    return { ok: true, reasons: [], reportRel: `apps/builder/.runs/${t.taskId}/report.json`, lintClean: true };
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

  const app = Fastify();
  const routeOpts: TasksRoutesOptions = {
    projectsDir: dir,
    settingsPath: '',
    broadcast: (_id, event, data) => {
      if (event !== 'task:update') return;
      const t = data as Task;
      events.push({ status: t.status, error: t.error });
    },
    runners: { runTurn, runPython, postTurnCheck, runReport },
  };
  await app.register(tasksRoutes, routeOpts);
  return { app, events, reportCalls };
}

/** The task.json path of the build under test — set by `start` so the faked turn can read the phase. */
let latestTaskFile: string | null = null;

/** POST /api/tasks and return the created task (each_step ⇒ it parks at the ① gate). */
async function start(h: Harness): Promise<Task> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/tasks',
    payload: { requirement: 'dispatch lifecycle', confirm_mode: 'each_step' },
  });
  assert.equal(res.statusCode, 200, res.body);
  const task = res.json() as Task;
  latestTaskFile = `apps/builder/.runs/${task.taskId}/task.json`;
  return task;
}

describe('dispatch() — the route-level lock/failSafe/evict wiring', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fixtureDir();
  });
  afterEach(async () => {
    if (buildHolderId()) releaseTurn(buildHolderId()!); // never leak the single global slot into the next test
    latestTaskFile = null;
    await rm(dir, { recursive: true, force: true });
  });

  test('the lock is held for the WHOLE dispatched chain and freed when the build PARKS at a gate', async () => {
    const gate = deferred();
    const h = await build(dir, { gate: gate.promise });
    const task = await start(h);

    // The route returns the id immediately (the UI needs it to open the SSE stream before ① finishes),
    // but the dispatched work is still running — so the lock is HELD, and it is held by THIS build.
    assert.ok(buildTurnBusy(), 'a turn is running → the lock is held after the route responded');
    assert.equal(buildHolderId(), task.taskId, 'held by the dispatched build');

    // A second build cannot start meanwhile — the 409 carries `holder` (the turn-collision shape).
    const busy = await h.app.inject({ method: 'POST', url: '/api/tasks', payload: { requirement: 'other' } });
    assert.equal(busy.statusCode, 409);
    assert.equal(busy.json().holder, task.taskId, 'the 409 names the build actually holding the turn');

    gate.release();
    await waitFor(() => !buildTurnBusy(), 'the dispatch finally to free the lock');

    // Freed because the build PARKED (not because it terminated) — the whole point of a turn-level lock.
    const parked = await loadTask(dir, task.taskId);
    assert.equal(parked.status, 'awaiting_confirm', 'parked at the ① gate');
    assert.equal(buildHolderId(), null, 'a build parked at a gate holds NOTHING');

    // And the slot is genuinely reusable now: the previously-rejected second build can start.
    const after = await h.app.inject({ method: 'POST', url: '/api/tasks', payload: { requirement: 'other' } });
    assert.equal(after.statusCode, 200, 'the freed slot is acquirable — release was real, not just a flag flip');
    await waitFor(() => !buildTurnBusy(), 'the second build to settle');
    await h.app.close();
  });

  test('the race-loser past the fast-path is pinned `rejected — another turn is running` (§5 / Q6)', async () => {
    const gate = deferred();
    const h = await build(dir, { gate: gate.promise });
    // Fire two POSTs in the same synchronous block. Both handlers pass the synchronous `buildTurnBusy()`
    // fast-path before either reaches `acquireTurn`: each handler yields at createTask's fs awaits
    // (macrotasks), and the second handler's start is queued as ticks/microtasks which run first. So
    // BOTH mint a task, and exactly one then loses the strict acquire — the branch under test.
    const [ra, rb] = await Promise.all([
      h.app.inject({ method: 'POST', url: '/api/tasks', payload: { requirement: 'racer A' } }),
      h.app.inject({ method: 'POST', url: '/api/tasks', payload: { requirement: 'racer B' } }),
    ]);
    const codes = [ra.statusCode, rb.statusCode].sort();
    assert.deepEqual(codes, [200, 409], 'exactly one winner, one 409');
    const winner = (ra.statusCode === 200 ? ra : rb).json() as Task;
    const busy = (ra.statusCode === 200 ? rb : ra).json() as { error: string; holder: string | null };
    assert.equal(busy.holder, winner.taskId, 'the collision 409 names the winner');
    latestTaskFile = `apps/builder/.runs/${winner.taskId}/task.json`;

    // The loser DID mint its own task (it was past the fast-path) — pinned `rejected`, never a stuck
    // `running`, and on a DISTINCT id (mintTaskId monotonic — a shared id would have acquired the
    // winner's own slot).
    const runs = await readdir(join(dir, 'apps/builder/.runs'));
    const loserId = runs.find((id) => id !== winner.taskId);
    assert.ok(loserId, 'the loser minted a distinct task id before losing acquireTurn');
    const loser = await loadTask(dir, loserId!);
    assert.equal(loser.status, 'error');
    assert.equal(loser.error, 'rejected — another turn is running');

    gate.release();
    await waitFor(() => !buildTurnBusy(), 'the winner to park');
    await h.app.close();
  });

  test('failSafe: an unexpected throw converges to a relayed status:error and still frees the lock', async () => {
    const h = await build(dir, {
      onTurn: () => {
        throw new Error('boom');
      },
    });
    const task = await start(h);
    await waitFor(() => !buildTurnBusy(), 'the throwing chain to settle');

    const t = await loadTask(dir, task.taskId);
    assert.equal(t.status, 'error', 'a throw must never leave the build stuck at running');
    assert.match(t.error ?? '', /internal error: boom/, 'the cause is surfaced verbatim, not swallowed');
    assert.ok(
      h.events.some((e) => e.status === 'error' && /internal error: boom/.test(e.error ?? '')),
      'failSafe RELAYS the error (a browser mirroring SSE must not sit on a stale `running`)'
    );
    assert.equal(buildHolderId(), null, 'the finally runs after the catch — a throw never leaks the lock');
    await h.app.close();
  });

  test('the cancelled flag is evicted once the chain settles terminal (the Set stays bounded)', async () => {
    const before = cancelledCount();
    const gate = deferred();
    const h = await build(dir, { gate: gate.promise });
    const task = await start(h);

    // Cancel while the turn is in flight: the route marks the flag and leaves eviction to the dispatch
    // `finally` (it must NOT evict here — the orchestrator's post-await isCancelled checks still need it).
    const res = await h.app.inject({ method: 'POST', url: `/api/tasks/${task.taskId}/cancel` });
    assert.equal(res.statusCode, 200);
    assert.equal(cancelledCount(), before + 1, 'flag tracked while the chain is still unwinding');

    gate.release();
    await waitFor(() => !buildTurnBusy(), 'the cancelled chain to settle');

    const t = await loadTask(dir, task.taskId);
    assert.equal(t.status, 'cancelled', 'converged terminal');
    assert.equal(cancelledCount(), before, 'terminal settle evicts the flag — the Set cannot grow unbounded');
    await h.app.close();
  });
});

describe('PATCH /api/tasks/:id — confirm_mode is only patchable at rest', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fixtureDir();
  });
  afterEach(async () => {
    if (buildHolderId()) releaseTurn(buildHolderId()!);
    latestTaskFile = null;
    await rm(dir, { recursive: true, force: true });
  });

  const patch = (h: Harness, id: string, mode: string) =>
    h.app.inject({ method: 'PATCH', url: `/api/tasks/${id}`, payload: { confirm_mode: mode } });

  test('a build with a turn RUNNING → 409 (the live orchestrator would clobber the write back)', async () => {
    const gate = deferred();
    const h = await build(dir, { gate: gate.promise });
    const task = await start(h);

    const res = await patch(h, task.taskId, 'auto');
    assert.equal(res.statusCode, 409, 'a patch mid-turn is both ineffective AND silently reverted — reject it');
    assert.match(res.json().error, /turn running/);

    gate.release();
    await waitFor(() => !buildTurnBusy(), 'the chain to park');
    const t = await loadTask(dir, task.taskId);
    assert.equal(t.confirmMode, 'each_step', 'the rejected patch never reached disk');
    await h.app.close();
  });

  test('spec 105 — a build with a PLAN PENDING refuses `auto`, and keeps the mode it had', async () => {
    // The chip withdraws `auto` while a proposal is open, but the chip is not the authority: a stale
    // tab or a hand-rolled request would otherwise land a mode that does nothing at all — autonomous
    // advance hard-stops on the proposal gate, so the build would sit there reading "don't stop"
    // while stopped, with nothing on screen saying why.
    const gate = deferred();
    const h = await build(dir, { gate: gate.promise });
    const task = await start(h);
    gate.release();
    await waitFor(() => !buildTurnBusy(), 'the chain to park');
    const parked = await loadTask(dir, task.taskId);
    parked.specRevise = true; // a plan is waiting for this human
    await saveTask(dir, parked);

    const res = await patch(h, task.taskId, 'auto');

    assert.equal(res.statusCode, 409);
    assert.match(res.json().error, /settle it before switching to unattended mode/);
    assert.equal((await loadTask(dir, task.taskId)).confirmMode, 'each_step', 'the refused patch never reached disk');
    await h.app.close();
  });

  test('spec 105 — the attended modes are still patchable while a plan is pending', async () => {
    // The rule is about `auto` specifically, not about freezing the chip: someone deciding on a plan
    // may still move between "stop everywhere" and "stop at the spec".
    const gate = deferred();
    const h = await build(dir, { gate: gate.promise });
    const task = await start(h);
    gate.release();
    await waitFor(() => !buildTurnBusy(), 'the chain to park');
    const parked = await loadTask(dir, task.taskId);
    parked.specRevise = true;
    await saveTask(dir, parked);

    const res = await patch(h, task.taskId, 'spec only');

    assert.equal(res.statusCode, 200);
    assert.equal((await loadTask(dir, task.taskId)).confirmMode, 'spec_only');
    await h.app.close();
  });

  test('a build PARKED at a gate → 200, persisted + relayed (the next boundary reads it fresh)', async () => {
    const gate = deferred();
    const h = await build(dir, { gate: gate.promise });
    const task = await start(h);
    gate.release();
    await waitFor(() => !buildTurnBusy(), 'the chain to park');

    const before = (await loadTask(dir, task.taskId)).rev ?? 0;
    const res = await patch(h, task.taskId, 'auto');
    assert.equal(res.statusCode, 200);
    const t = await loadTask(dir, task.taskId);
    assert.equal(t.confirmMode, 'auto');
    assert.ok((t.rev ?? 0) > before, 'this direct broadcast bypasses emit → it must bump rev itself, or a stale GET reverts it');
    assert.ok(h.events.some((e) => e.status === 'awaiting_confirm'), 'relayed to the SSE clients');
    await h.app.close();
  });

  test('unknown id → 404; missing confirm_mode → 400', async () => {
    const h = await build(dir);
    assert.equal((await patch(h, '9999999999999', 'auto')).statusCode, 404);
    const bad = await h.app.inject({ method: 'PATCH', url: '/api/tasks/9999999999999', payload: {} });
    assert.equal(bad.statusCode, 400, 'validated before the task is even loaded');
    await h.app.close();
  });
});

describe('POST /api/tasks/:id/confirm — the route layer itself', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fixtureDir();
  });
  afterEach(async () => {
    if (buildHolderId()) releaseTurn(buildHolderId()!);
    latestTaskFile = null;
    await rm(dir, { recursive: true, force: true });
  });

  const confirm = (h: Harness, id: string, payload: Record<string, unknown>) =>
    h.app.inject({ method: 'POST', url: `/api/tasks/${id}/confirm`, payload });

  test('a stale/unknown action → validation-409 (no `holder`) that leaks NO lock', async () => {
    const gate = deferred();
    const h = await build(dir, { gate: gate.promise });
    const task = await start(h);
    gate.release();
    await waitFor(() => !buildTurnBusy(), 'the ① chain to park');

    // The action is validated BEFORE acquireTurn — the early 409 must not take (or leak) the slot.
    const bad = await confirm(h, task.taskId, { actionId: 'not-a-real-action' });
    assert.equal(bad.statusCode, 409);
    assert.equal('holder' in bad.json(), false, 'validation-409 shape — NOT the turn-collision shape');
    assert.equal(buildTurnBusy(), false, 'rejected before acquireTurn — nothing held, nothing leaked');

    // The gate is still fully usable: the real `continue` advances ①→② through the same route.
    const ok = await confirm(h, task.taskId, { actionId: 'continue' });
    assert.equal(ok.statusCode, 200, ok.body);
    await waitFor(() => !buildTurnBusy(), 'the ② chain to park');
    const t = await loadTask(dir, task.taskId);
    assert.equal(t.phase, 'spec');
    assert.equal(t.status, 'awaiting_confirm');
    await h.app.close();
  });

  test('a client-supplied `reuseLint` in the /confirm body is IGNORED — the windowed ③→④ hop re-lints', async () => {
    const h = await build(dir); // no gate: each turn settles immediately, each_step parks every boundary
    const task = await start(h);
    const advance = async (payload: Record<string, unknown>) => {
      await waitFor(() => !buildTurnBusy(), 'park before the next confirm');
      const r = await confirm(h, task.taskId, payload);
      assert.equal(r.statusCode, 200, r.body);
    };
    await advance({ actionId: 'continue' }); // ①→② (spec turn)
    await advance({ actionId: 'continue' }); // ②→③ (REAL scaffoldAtSpecGate via the init fake, then implement)
    // ③→④ with a FORGED all-zero reuseLint riding the HTTP body: on this human-windowed path the
    // codes could be stale/fabricated, so the route must not forward them (spec 048 D2 — `internal`
    // is deliberately NOT a ConfirmPayload field).
    await advance({
      actionId: 'continue',
      reuseLint: { validate: 0, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 0 },
    });
    await waitFor(() => !buildTurnBusy(), 'the ④ chain to settle');

    const t = await loadTask(dir, task.taskId);
    assert.equal(t.status, 'done', 'the each_step deploy-none build finished ④');
    assert.equal(h.reportCalls.length, 1, '④ ran exactly one report');
    assert.equal(h.reportCalls[0]?.reuseLint, undefined, 'the body field never reached ReportOpts — ④ re-lints');
    assert.equal(h.reportCalls[0]?.acceptedLintFailure, false, 'and it was the plain continue, not an accept');
    await h.app.close();
  });
});
