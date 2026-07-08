/**
 * Spec 051 S1 — POST /api/bases (import one standalone YAML as a local edit-existing base) + the
 * `importYamlAsBase` helper.
 *
 * Route-level via Fastify `inject` with the 013-D2 `runPython` seam faked (no real init_project.py /
 * linter spawn): the fake routes an `init_project.py` argv to the scaffold-fake's on-disk effect and a
 * linter argv to a configurable exit code. Asserts the happy path (200 + file written verbatim +
 * derived slug), the D2 gate (a failing linter → 400 with its verbatim message, NOTHING written), the
 * JP-name path (Japanese `app.name` preserved for display, ASCII slug, `firstFreeSlug` auto-suffix), the
 * AC4 traversal rejects, and the AC6 size/extension limits.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import uiRoutes from '../server/routes/ui.js';
import { MAX_ATTACHMENT_BYTES, BODY_LIMIT_BYTES } from '../server/lib/attachments.js';
import { applyInitFake } from './helpers/scaffold-fake.js';
import type { ShellResult } from '../server/lib/shell.js';

const VALID_YAML = 'app:\n  name: My Cool Flow\n  mode: workflow\nversion: 0.6.0\n';
// A real field artifact: Japanese app.name with embedded Latin ("ChatWork") — deriveSlugName lowercases
// then keeps the Latin run, so the slug is a meaningful ASCII `chatwork` while the JP name stays in the file.
const JP_YAML = 'app:\n  name: リスト入力催促ChatWork通知フロー\n  mode: workflow\nversion: 0.6.0\n';
// A pure-Japanese app.name (no Latin) → deriveSlugName collapses to the GENERIC_SLUG `workflow`.
const PURE_JP_YAML = 'app:\n  name: 顧客対応催促フロー\n  mode: workflow\nversion: 0.6.0\n';

describe('POST /api/bases (spec 051 S1)', () => {
  let dir: string;
  let calls: Array<{ cwd: string; args: string[] }>;
  /** basename of the linter script to fail (e.g. 'validate_workflow.py'), or null = all clean. */
  let failLinter: string | null;
  let failMsg: string;
  let scaffoldCode: number;
  /** injected import-probe verdict — undefined = no note (the hermetic default, never touches Dify). */
  let probeNote: string | undefined;

  const fakeRunPython = async (cwd: string, args: string[]): Promise<ShellResult> => {
    calls.push({ cwd, args });
    if (args.some((a) => a.includes('init_project.py'))) {
      applyInitFake(cwd, args);
      return { code: scaffoldCode, stdout: '', stderr: scaffoldCode ? 'scaffold boom' : '' };
    }
    // A linter invocation: `[<script>, <tmpfile>]`.
    if (failLinter && args[0]?.endsWith(failLinter)) return { code: 1, stdout: '', stderr: failMsg };
    return { code: 0, stdout: '', stderr: '' };
  };

  async function build() {
    // Mirror production's body cap (index.ts) so the 10 MB guard is reachable, not masked by Fastify's 1 MB default.
    const app = Fastify({ bodyLimit: BODY_LIMIT_BYTES });
    // Inject a hermetic probe (never hits Dify) — returns the configurable `probeNote`.
    await app.register(uiRoutes, {
      projectsDir: dir, now: () => 0, runPython: fakeRunPython, importProbe: async () => probeNote,
    });
    return app;
  }

  const post = async (payload: unknown) => {
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/bases', payload: payload as object });
    await app.close();
    return res;
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'base-import-'));
    calls = [];
    failLinter = null;
    failMsg = '';
    scaffoldCode = 0;
    probeNote = undefined;
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('valid YAML → 200; file written verbatim at projects/_drafts/<slug>/workflows/main.yml', async () => {
    const res = await post({ yaml: VALID_YAML });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { project: '_drafts', workflow: 'my_cool_flow' });
    const written = await readFile(join(dir, 'projects/_drafts/my_cool_flow/workflows/main.yml'), 'utf8');
    assert.equal(written, VALID_YAML); // verbatim (D4) — app.name intact for the display label
    // All 4 linters ran on a TEMP file (not under projects/), then project + workflow scaffold.
    const linted = calls.filter((c) => !c.args.some((a) => a.includes('init_project.py')));
    assert.equal(linted.length, 4);
    for (const c of linted) assert.ok(!c.args[1].includes('/projects/'), 'linted a temp file, not projects/');
  });

  test('JP app.name + no name → 200; ASCII slug, Japanese name kept verbatim in the file', async () => {
    const res = await post({ yaml: JP_YAML });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().workflow, 'chatwork'); // embedded Latin extracted → meaningful ASCII slug
    const written = await readFile(join(dir, 'projects/_drafts/chatwork/workflows/main.yml'), 'utf8');
    assert.match(written, /リスト入力催促ChatWork通知フロー/); // the chip label source, preserved
  });

  test('pure-Japanese app.name → GENERIC_SLUG (workflow)', async () => {
    const res = await post({ yaml: PURE_JP_YAML });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().workflow, 'workflow');
    assert.match(await readFile(join(dir, 'projects/_drafts/workflow/workflows/main.yml'), 'utf8'), /顧客対応催促フロー/);
  });

  test('second same-named upload → firstFreeSlug auto-suffix with a slugNote, never overwrites', async () => {
    assert.equal((await post({ yaml: JP_YAML })).json().workflow, 'chatwork');
    const res = await post({ yaml: JP_YAML });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().workflow, 'chatwork_2');
    assert.match(res.json().slugNote, /already exists/);
    assert.ok(existsSync(join(dir, 'projects/_drafts/chatwork/workflows/main.yml')), 'first base untouched');
    assert.ok(existsSync(join(dir, 'projects/_drafts/chatwork_2/workflows/main.yml')));
  });

  test('an explicit project override lands the base there', async () => {
    const res = await post({ yaml: VALID_YAML, project: 'my_project' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().project, 'my_project');
    assert.ok(existsSync(join(dir, 'projects/my_project/my_cool_flow/workflows/main.yml')));
  });

  test('(D2 advisory) an import-probe verdict is attached to the 200 response, never blocks the write', async () => {
    probeNote = 'import-probe: OK — Dify accepted this DSL (probe app deleted)';
    const res = await post({ yaml: VALID_YAML });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().probeNote, probeNote);
    assert.ok(existsSync(join(dir, 'projects/_drafts/my_cool_flow/workflows/main.yml')), 'base still landed');
  });

  test('(D2) a failing linter → 400 carrying its verbatim message; nothing written to projects/', async () => {
    failLinter = 'validate_workflow.py';
    failMsg = 'root is not a mapping (expected top-level app:)';
    const res = await post({ yaml: 'not a workflow' });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /validate_workflow\.py exit 1/);
    assert.match(res.json().error, /root is not a mapping/);
    assert.ok(!existsSync(join(dir, 'projects')), 'no write on a rejected base');
    assert.ok(!calls.some((c) => c.args.some((a) => a.includes('init_project.py'))), 'never scaffolded');
  });

  test('(D2) a NON-validate linter failure (e.g. lint_refs) also blocks — full 4-linter gate', async () => {
    failLinter = 'lint_refs.py';
    failMsg = 'dangling ref {{#999.text#}}';
    const res = await post({ yaml: VALID_YAML });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /lint_refs\.py exit 1/);
    assert.ok(!existsSync(join(dir, 'projects')));
  });

  test('(AC4) a crafted name/project with ../separators → 400, no spawn, no write', async () => {
    for (const bad of [{ yaml: VALID_YAML, name: '../evil' }, { yaml: VALID_YAML, project: '../../etc' }]) {
      calls = [];
      const res = await post(bad);
      assert.equal(res.statusCode, 400);
      assert.match(res.json().error, /path separators/);
      assert.equal(calls.length, 0);
    }
    assert.ok(!existsSync(join(dir, 'projects')));
  });

  test('(AC6) missing yaml → 400; oversize → 400; non-.yml fileName → 400 — none spawn', async () => {
    assert.equal((await post({})).statusCode, 400);
    const big = '#'.repeat(MAX_ATTACHMENT_BYTES + 1);
    assert.equal((await post({ yaml: big })).statusCode, 400);
    const extRes = await post({ yaml: VALID_YAML, fileName: 'workflow.txt' });
    assert.equal(extRes.statusCode, 400);
    assert.match(extRes.json().error, /only \.yml\/\.yaml/);
    assert.equal(calls.length, 0);
  });

  test('scaffold exit≠0 → 500 with the stderr tail', async () => {
    scaffoldCode = 1;
    const res = await post({ yaml: VALID_YAML });
    assert.equal(res.statusCode, 500);
    assert.match(res.json().error, /scaffold (project|workflow) failed/);
  });
});
