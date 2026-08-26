/**
 * Spec 105 — the composer has to be able to say where a build on this workflow would BEGIN.
 *
 * The decision itself belongs to `POST /api/tasks` and stays there; this bit is the same question
 * asked early. That makes AGREEMENT the property worth pinning, not the bit's value: a badge that
 * says "starts at ③" over a build the route then starts at ① is worse than no badge, because the
 * user has no way to tell which of the two lied.
 *
 * So the last test here drives both sides on the same fixture and asserts they match — including the
 * case where the two could plausibly diverge (a workflow whose file is not `main.yml`).
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { buildTree, type TreeWorkflowNode } from '../server/lib/artifacts.js';
import tasksRoutes, { type TasksRoutesOptions } from '../server/routes/tasks.js';
import { buildTurnBusy } from '../server/lib/lock.js';

describe('buildTree — where arming this workflow would start (spec 105)', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'tree-start-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  /** A workflow as this Builder leaves them: the file, and the document describing it. */
  async function specced(slug: string, file = 'main.yml'): Promise<void> {
    await mkdir(join(dir, 'projects', 'p1', slug, 'workflows'), { recursive: true });
    await writeFile(join(dir, 'projects', 'p1', slug, 'workflows', file), 'app: {}\n');
    await writeFile(join(dir, 'projects', 'p1', slug, 'SPEC.md'), '# Spec\n');
  }

  const rowFor = async (slug: string): Promise<TreeWorkflowNode> => {
    const tree = await buildTree(dir, Date.now());
    const row = tree.flatMap((p) => p.workflows).find((w) => w.id === slug);
    assert.ok(row, `the ${slug} row exists`);
    return row!;
  };

  test('both artifacts present → the row says so', async () => {
    await specced('wf');
    assert.equal((await rowFor('wf')).startsAtImplement, true);
  });

  test('an imported YAML with no spec carries NO flag (the pre-105 wire shape)', async () => {
    // The case ① and ② exist FOR — nobody has read this file yet. Absent, not `false`: the field is
    // additive, and an older client reads a missing key exactly as it read the whole pre-105 payload.
    await mkdir(join(dir, 'projects', 'p1', 'fresh', 'workflows'), { recursive: true });
    await writeFile(join(dir, 'projects', 'p1', 'fresh', 'workflows', 'main.yml'), 'app: {}\n');
    assert.equal((await rowFor('fresh')).startsAtImplement, undefined);
  });

  test('a spec with no workflow file beside it carries no flag either', async () => {
    await mkdir(join(dir, 'projects', 'p1', 'docsonly', 'workflows'), { recursive: true });
    await writeFile(join(dir, 'projects', 'p1', 'docsonly', 'SPEC.md'), '# Spec\n');
    assert.equal((await rowFor('docsonly')).startsAtImplement, undefined);
  });

  test('the synthetic `(unsaved)` row is never flagged — there is no folder to ask about', async () => {
    // It is not a workflow, so every question about its files is meaningless. Answering one would put a
    // "starts at ③" badge on the exact row spec 090 made unselectable.
    await mkdir(join(dir, 'apps', 'builder', '.runs'), { recursive: true });
    await specced('wf');
    const tree = await buildTree(dir, Date.now());
    for (const w of tree.flatMap((p) => p.workflows)) {
      if (w.synthetic) assert.equal(w.startsAtImplement, undefined, `${w.id} is display-only`);
    }
  });

  test('THE INVARIANT: the badge and the route agree, on the same files', async () => {
    // Two components answering one question. If they can disagree, the badge is worse than nothing —
    // the user cannot tell which one is lying. `reporting.yml` is the case where they plausibly could:
    // the tree knows no filename, and the composer's start body carries none either, so BOTH must land
    // on `main.yml` and BOTH must say "not ready".
    await specced('ready');
    await specced('otherfile', 'reporting.yml');

    const app = Fastify();
    await app.register(tasksRoutes, { projectsDir: dir, settingsPath: '' } as TasksRoutesOptions);
    try {
      for (const slug of ['ready', 'otherfile']) {
        const badge = (await rowFor(slug)).startsAtImplement === true;
        const res = await app.inject({
          method: 'POST', url: '/api/tasks',
          payload: { requirement: 'change it', workflow: slug, project: 'p1' },
        });
        assert.equal(res.statusCode, 200, res.body);
        const routeSaid = res.json().startPhase === 'implement';
        assert.equal(badge, routeSaid, `${slug}: the badge and the route must answer alike`);
        for (let i = 0; i < 400 && buildTurnBusy(); i++) await new Promise((r) => setTimeout(r, 10));
      }
    } finally {
      await app.close();
    }
  });
});
