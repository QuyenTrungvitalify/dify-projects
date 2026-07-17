/**
 * spec 070 — POST /api/promote's EXTERNAL (pasted-YAML) door, at the ROUTE level.
 *
 * The distill FLOW itself (staging the pasted bytes, finalize, honest `source=external` provenance) is
 * covered by promote.test.ts driving the functions directly. THIS file covers the route glue that the flow
 * test assumes: a pasted payload is routed to the external door (not the local {project,workflow} door),
 * and a poisonous YAML is rejected INLINE (400) BEFORE any task is minted (AC3 / G5) — the same 4-linter
 * gate as POST /api/bases (via the shared `lintStandaloneYaml`).
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import tasksRoutes, { type TasksRoutesOptions } from '../server/routes/tasks.js';
import type { ShellResult } from '../server/lib/shell.js';
import { releaseTurn, turnHolderId } from '../server/lib/lock.js';

describe('POST /api/promote — external (pasted YAML) door (spec 070)', () => {
  let dir: string;
  /** basename of the linter script to fail (e.g. 'lint_node_bodies.py'), or null = all clean. */
  let failLinter: string | null;

  const runPython = async (_cwd: string, args: string[]): Promise<ShellResult> => {
    // A linter invocation is `[<script>, <tmpfile>]` (base-import's gate, reused by the paste door).
    if (failLinter && args[0]?.endsWith(failLinter)) return { code: 1, stdout: '', stderr: 'bad node body' };
    return { code: 0, stdout: '', stderr: '' };
  };

  async function build() {
    const app = Fastify();
    const opts: TasksRoutesOptions = { projectsDir: dir, settingsPath: '', runners: { runPython } };
    await app.register(tasksRoutes, opts);
    return app;
  }
  const post = async (payload: unknown) => {
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/promote', payload: payload as object });
    await app.close();
    return res;
  };
  /** No task.json was minted anywhere under the runs dir. */
  async function noTaskMinted(): Promise<boolean> {
    const runs = join(dir, 'apps/builder/.runs');
    if (!existsSync(runs)) return true;
    return (await readdir(runs)).length === 0;
  }

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'promote-ext-')); failLinter = null; });
  afterEach(async () => {
    if (turnHolderId()) releaseTurn(turnHolderId()!); // never leak the single global turn slot
    await rm(dir, { recursive: true, force: true });
  });

  test('AC3/G5 — a paste that fails a linter → 400 inline, NO task minted', async () => {
    failLinter = 'lint_node_bodies.py';
    const res = await post({ origin: 'paste', yaml: 'app:\n  name: Bad\n' });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /lint_node_bodies\.py exit 1/);
    assert.ok(await noTaskMinted(), 'nothing minted on a rejected paste');
  });

  test('an empty pasted yaml → 400 (the paste door, not the local "project required" path)', async () => {
    const res = await post({ origin: 'paste', yaml: '   ' });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /yaml is required/);
    assert.ok(await noTaskMinted());
  });

  test('a payload with neither yaml nor origin still routes to the local door (unchanged)', async () => {
    const res = await post({ project: '', workflow: '' });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /project and workflow are required/);
  });
});
