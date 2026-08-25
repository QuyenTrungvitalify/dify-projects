/**
 * The two "where is this file" routes, for both files the artifact panel shows:
 *   GET  /api/tasks/:id/artifact-path?which=spec|workflow  → the absolute path, as text
 *   POST /api/tasks/:id/reveal?which=spec|workflow         → open the OS file manager there
 *
 * They back the panel's Reveal / Copy-path buttons, which SPEC.md and main.yml now share. A caller
 * names WHICH file; the path is resolved server-side from the task. That is the whole security model
 * of these routes, so the tests that matter most are the ones pinning it: an unknown `which` is a 400
 * rather than a default, a caller-supplied path changes nothing, and a traversal id never reaches fs.
 *
 * The path route is deliberately separate from reveal rather than a flag on it — wanting the path is
 * not wanting a window — and the last test holds that line.
 *
 * Route-level via Fastify `inject` against a real temp projects dir: a unit test on `specPathFor` /
 * `workflowPathFor` alone would not prove the routes apply the same confinement or the same on-disk
 * precondition.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import uiRoutes from '../server/routes/ui.js';

const TASK_ID = '1784212050777';
const WF_REL = 'projects/proj_a/wf_1/workflows/main.yml';
const SPEC_REL = 'projects/proj_a/wf_1/SPEC.md';

/** A scaffolded task. `files` picks which of the two artifacts actually exist on disk — they appear at
 *  DIFFERENT times in a real build (SPEC.md lands a phase before the workflow YAML), which is exactly
 *  why `which` has to be answered per-file rather than once per task. */
function mkFixture(
  over: Record<string, unknown> = {},
  files: Array<'spec' | 'workflow'> = ['spec', 'workflow'],
): { projectsDir: string; cleanup: () => void } {
  const projectsDir = mkdtempSync(join(tmpdir(), 'artpath-'));
  const runDir = join(projectsDir, 'apps/builder/.runs', TASK_ID);
  mkdirSync(runDir, { recursive: true });
  const task = {
    taskId: TASK_ID, requirement: 'r', phase: 'implement', status: 'awaiting_confirm',
    confirmMode: 'each_step', project: 'proj_a', workflowSlug: 'wf_1', workflowFile: 'main.yml',
    ...over,
  };
  if (task.project && task.workflowSlug) {
    const base = join(projectsDir, 'projects', String(task.project), String(task.workflowSlug));
    mkdirSync(join(base, 'workflows'), { recursive: true });
    if (files.includes('workflow')) writeFileSync(join(base, 'workflows', String(task.workflowFile)), 'app:\n  mode: workflow\n');
    if (files.includes('spec')) writeFileSync(join(base, 'SPEC.md'), '# Spec\n');
  }
  writeFileSync(join(runDir, 'task.json'), JSON.stringify(task));
  return { projectsDir, cleanup: () => rmSync(projectsDir, { recursive: true, force: true }) };
}

async function build(projectsDir: string) {
  const app = Fastify();
  await app.register(uiRoutes, { projectsDir, now: () => 0 });
  return app;
}

/** Run `fn` against a fresh app+fixture and always tear both down. */
async function withApp(
  fx: { projectsDir: string; cleanup: () => void },
  fn: (app: Awaited<ReturnType<typeof build>>) => Promise<void>,
): Promise<void> {
  const app = await build(fx.projectsDir);
  try {
    await fn(app);
  } finally {
    await app.close();
    fx.cleanup();
  }
}

describe('GET /api/tasks/:id/artifact-path', () => {
  for (const [which, rel] of [['workflow', WF_REL], ['spec', SPEC_REL]] as const) {
    test(`?which=${which} returns that file's absolute path`, async () => {
      const fx = mkFixture();
      await withApp(fx, async (app) => {
        const res = await app.inject({ method: 'GET', url: `/api/tasks/${TASK_ID}/artifact-path?which=${which}` });
        assert.equal(res.statusCode, 200, res.body);
        const { path } = res.json() as { path: string };
        // Absolute, and the file itself — not its folder, not a repo-relative fragment. A relative path
        // looks right in the UI and is useless the moment it is pasted anywhere but the repo root.
        assert.equal(path, join(fx.projectsDir, rel));
        assert.ok(path.startsWith('/'), 'must be absolute — pasting it elsewhere is the entire point');
      });
    });
  }

  test('the two files are answered independently — a spec exists before its workflow does', async () => {
    // The real ordering: SPEC.md is written at the Spec gate, main.yml only after Implement. If `which`
    // were ignored, the spec button would vanish for the whole phase where it is most useful.
    const fx = mkFixture({}, ['spec']);
    await withApp(fx, async (app) => {
      const spec = await app.inject({ method: 'GET', url: `/api/tasks/${TASK_ID}/artifact-path?which=spec` });
      const wf = await app.inject({ method: 'GET', url: `/api/tasks/${TASK_ID}/artifact-path?which=workflow` });
      assert.equal(spec.statusCode, 200, spec.body);
      assert.equal(wf.statusCode, 404, wf.body);
    });
  });

  test('no `which` means the workflow — the shape this route shipped with', async () => {
    const fx = mkFixture();
    await withApp(fx, async (app) => {
      const res = await app.inject({ method: 'GET', url: `/api/tasks/${TASK_ID}/artifact-path` });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal((res.json() as { path: string }).path, join(fx.projectsDir, WF_REL));
    });
  });

  test('an unknown `which` is a 400, never a silent fallback to some default file', async () => {
    const fx = mkFixture();
    await withApp(fx, async (app) => {
      for (const w of ['report', 'diff', '../../etc/passwd', 'constructor', '__proto__', 'toString']) {
        const res = await app.inject({ method: 'GET', url: `/api/tasks/${TASK_ID}/artifact-path?which=${encodeURIComponent(w)}` });
        // 'constructor'/'__proto__'/'toString' are the reason `which` is two literal comparisons and not
        // a lookup table: `w in TABLE` answers true for every Object.prototype key.
        assert.equal(res.statusCode, 400, `which=${w} should be rejected, got ${res.statusCode} ${res.body}`);
      }
    });
  });

  test('404 while the file is not on disk yet — the UI hides the button rather than offering a dead path', async () => {
    const fx = mkFixture({}, []);
    await withApp(fx, async (app) => {
      const res = await app.inject({ method: 'GET', url: `/api/tasks/${TASK_ID}/artifact-path?which=workflow` });
      assert.equal(res.statusCode, 404, res.body);
    });
  });

  test('404 pre-scaffold, when the task has no project/slug to build a workflow path from', async () => {
    const fx = mkFixture({ project: null, workflowSlug: null }, []);
    await withApp(fx, async (app) => {
      const res = await app.inject({ method: 'GET', url: `/api/tasks/${TASK_ID}/artifact-path?which=workflow` });
      assert.equal(res.statusCode, 404, res.body);
    });
  });

  test('404 for an unknown task', async () => {
    await withApp(mkFixture(), async (app) => {
      const res = await app.inject({ method: 'GET', url: '/api/tasks/1999999999999/artifact-path?which=spec' });
      assert.equal(res.statusCode, 404, res.body);
    });
  });

  test('a traversal id is rejected as malformed, before any fs access', async () => {
    // `isTaskId` is a confinement predicate, not a formatting one — the id reaches `join`.
    await withApp(mkFixture(), async (app) => {
      const res = await app.inject({ method: 'GET', url: '/api/tasks/..%2F..%2Fetc/artifact-path?which=spec' });
      assert.equal(res.statusCode, 400, res.body);
    });
  });

  test('the client cannot name the path — a supplied one is ignored, not echoed', async () => {
    const fx = mkFixture();
    await withApp(fx, async (app) => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/tasks/${TASK_ID}/artifact-path?which=spec&path=/etc/passwd`,
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal((res.json() as { path: string }).path, join(fx.projectsDir, SPEC_REL));
    });
  });

  test('asking for the path opens no window (reveal is the only spawner)', async () => {
    // The distinction the route exists for. If someone later "simplifies" by routing this through
    // reveal, a Finder window would open on every panel render. Static, because intercepting the spawn
    // would mean stubbing node:child_process for the whole module graph.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, '../server/routes/ui.ts'), 'utf8');
    const i = src.indexOf("'/api/tasks/:id/artifact-path'");
    assert.notEqual(i, -1, 'route moved — update this guard');
    const body = src.slice(i, src.indexOf('\n  );', i));
    assert.ok(!body.includes('revealInFileManager'), 'the path route must not spawn the file manager');
  });
});

describe('POST /api/tasks/:id/reveal — the same file selection', () => {
  // The launcher itself is not spawned here: `revealInFileManager` would open a real Finder window on
  // the machine running the suite. What these pin is the part that decides WHICH file it would be
  // handed — the validation the panel's new spec button depends on.
  test('an unknown `which` is rejected before anything is spawned', async () => {
    await withApp(mkFixture(), async (app) => {
      const res = await app.inject({ method: 'POST', url: `/api/tasks/${TASK_ID}/reveal?which=report` });
      assert.equal(res.statusCode, 400, res.body);
    });
  });

  test('404 for a file that is not on disk, per `which`', async () => {
    const fx = mkFixture({}, ['spec']); // spec written, workflow not
    await withApp(fx, async (app) => {
      const res = await app.inject({ method: 'POST', url: `/api/tasks/${TASK_ID}/reveal?which=workflow` });
      assert.equal(res.statusCode, 404, res.body);
    });
  });

  test('a traversal id is rejected as malformed', async () => {
    await withApp(mkFixture(), async (app) => {
      const res = await app.inject({ method: 'POST', url: '/api/tasks/..%2F..%2Fetc/reveal?which=spec' });
      assert.equal(res.statusCode, 400, res.body);
    });
  });

  test('both routes share one resolver, so the two can never disagree about a file', async () => {
    // They validate the same id, the same `which`, and the same on-disk precondition. Two copies of
    // that logic is how a button ends up revealing one file and copying the path of another.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, '../server/routes/ui.ts'), 'utf8');
    assert.equal((src.match(/resolveArtifactFile\(req, reply\)/g) ?? []).length, 2);
  });
});
