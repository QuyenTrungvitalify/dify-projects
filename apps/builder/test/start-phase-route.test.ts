/**
 * Spec 105 — the start-phase decision, through the door the user actually knocks on.
 *
 * Every other test for this feature hands `createTask` a `startPhase` that was already resolved, which
 * proves the FSM honours the value and proves nothing about who computes it. The two filesystem
 * questions live in the route, and they are the whole feature: get the directory wrong, forget to
 * forward the answer, read the wrong body key, and the build silently runs all four phases again (the
 * bug this shipped to fix) or skips ① and ② on a workflow nobody analysed.
 *
 * Same trick as `phantom-target-route.test.ts`: the turn lock is held, so a request that reaches the
 * dispatch returns 409 without spending a turn — except here the task IS minted first, so the response
 * body carries the decision. That is the point: the decision is observable at the door.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import tasksRoutes, { type TasksRoutesOptions } from '../server/routes/tasks.js';
import { buildTurnBusy } from '../server/lib/lock.js';

describe('POST /api/tasks — where the build starts (spec 105)', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof Fastify>>;

  /** A workflow as this Builder leaves them: the file, and the document describing it. */
  async function specced(project: string, slug: string, file = 'main.yml'): Promise<void> {
    await mkdir(join(dir, 'projects', project, slug, 'workflows'), { recursive: true });
    await writeFile(join(dir, 'projects', project, slug, 'workflows', file), 'workflow:\n  graph:\n    nodes: []\n');
    await writeFile(join(dir, 'projects', project, slug, 'SPEC.md'), '# Spec\n\n## Acceptance Criteria\n- it works\n');
  }

  /** What `POST /api/bases` leaves: the YAML, and NO spec. */
  async function imported(project: string, slug: string): Promise<void> {
    await mkdir(join(dir, 'projects', project, slug, 'workflows'), { recursive: true });
    await writeFile(join(dir, 'projects', project, slug, 'workflows', 'main.yml'), 'workflow:\n  graph:\n    nodes: []\n');
  }

  const post = (body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/tasks', payload: { requirement: 'add a retry branch', ...body } });

  /** The dispatch runs in the background and holds the lock; let it settle so temp dirs unlink cleanly. */
  async function settled(): Promise<void> {
    for (let i = 0; i < 400 && buildTurnBusy(); i++) await new Promise((r) => setTimeout(r, 10));
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'start-phase-'));
    app = Fastify();
    const opts: TasksRoutesOptions = { projectsDir: dir, settingsPath: '' };
    await app.register(tasksRoutes, opts);
  });
  afterEach(async () => {
    await settled();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  test('a workflow with both artifacts starts at ③ — and the response says so', async () => {
    await specced('p1', 'wf');

    const res = await post({ workflow: 'wf', project: 'p1' });

    assert.equal(res.statusCode, 200, res.body);
    const t = res.json();
    assert.equal(t.startPhase, 'implement', 'the route resolved it from the two files on disk');
    assert.equal(t.phase, 'implement', 'and the build really is standing there, not at ①');
  });

  test('an imported YAML with no spec keeps all four phases', async () => {
    // The case ① and ② exist FOR: nobody has read this file, and the document explaining it does not
    // exist. Same door, different thing coming through it — which is why nothing had to be configured.
    await imported('p1', 'fresh');

    const t = (await post({ workflow: 'fresh', project: 'p1' })).json();

    assert.equal(t.startPhase, undefined, 'not marked as having skipped anything');
    assert.equal(t.phase, 'analyze');
  });

  test('a workflow whose file is named something else is still found', async () => {
    // The route must ask about the file ③ will WRITE, not about `main.yml` by habit — otherwise a
    // multi-file workflow is answered by the absence of a file it never had.
    await specced('p1', 'multi', 'reporting.yml');

    const t = (await post({ workflow: 'multi', project: 'p1', workflowFile: 'reporting.yml' })).json();

    assert.equal(t.startPhase, 'implement');
  });

  test('a spec beside a DIFFERENT file does not count', async () => {
    // The mirror of the case above, and the one that matters: `reporting.yml` on disk, `main.yml`
    // requested. Answering "both present" from the wrong filename would skip ① on a file that is
    // not there.
    await specced('p1', 'multi', 'reporting.yml');

    const t = (await post({ workflow: 'multi', project: 'p1' })).json(); // defaults to main.yml

    assert.equal(t.startPhase, undefined, 'no workflow file at the path this build would write');
    assert.equal(t.phase, 'analyze');
  });

  test('a from-scratch build is untouched', async () => {
    const t = (await post({})).json();
    assert.equal(t.startPhase, undefined);
    assert.equal(t.phase, 'analyze');
  });

  test('the project is read from the body, not assumed to be _drafts', async () => {
    // The composer sends the spec-030 compound `project/workflow` split into two fields. Looking in
    // `_drafts` regardless would answer about a directory belonging to someone else — or to nobody.
    await specced('client_acme', 'wf');

    const t = (await post({ workflow: 'wf', project: 'client_acme' })).json();

    assert.equal(t.startPhase, 'implement');
  });

  test('an explicit start_phase can say "re-read it from scratch", and is honoured', async () => {
    await specced('p1', 'wf');

    const t = (await post({ workflow: 'wf', project: 'p1', start_phase: 'analyze' })).json();

    assert.equal(t.startPhase, undefined);
    assert.equal(t.phase, 'analyze');
  });

  test('an explicit start_phase cannot skip a phase whose output is missing', async () => {
    await imported('p1', 'fresh');

    const t = (await post({ workflow: 'fresh', project: 'p1', start_phase: 'implement' })).json();

    assert.equal(t.startPhase, undefined, 'there is no spec to skip ② WITH');
    assert.equal(t.phase, 'analyze');
  });

  test('a Dify seed beside a workflow target never skips ①②', async () => {
    // Both controls are live at once in the UI, and `startTask` resolves the pair seed-first: it pulls
    // the YAML from Dify and never touches the local directory the route just inspected. Two components
    // answering "which workflow is this" differently is how a build skips its analysis on the strength
    // of some other workflow's files.
    await specced('p1', 'wf');

    const t = (await post({ workflow: 'wf', project: 'p1', seed: 'app-123' })).json();

    assert.equal(t.startPhase, undefined);
    assert.equal(t.phase, 'analyze');
  });
});
