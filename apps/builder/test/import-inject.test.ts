/**
 * Spec 087 S4 — resolveImportSource: the static selfhost import ('Import to Dify' at awaiting_import)
 * mirrors the live-test model inject on a TEMP copy, best-effort:
 *   • model picked + ≥1 node patched → push the copy (srcFileRel), never the source
 *   • 0-model / models arm failed (pick null) → {} — source as-is (S3 advisory covers)
 *   • inject ok but nothing patched → {} — the copy adds nothing
 *   • inject failed / threw → {} — an inject hiccup must never block the import
 * Plus pushApp's srcFileRel plumbing: `--src-file <rel>` replaces `--file workflows/<file>`
 * (arg-capturing python shim — the dify-inject-model shim precedent).
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveImportSource } from '../server/lib/import.js';
import { pushApp } from '../server/lib/dify-io.js';

const TASK = { taskId: 't1', project: 'p', workflowSlug: 'w', workflowFile: 'main.yml' };
const PICK = { provider: 'openai', name: 'gpt-mini' };
const DEP_OK = { ok: true, nodeCount: 1, llmCount: 1, patched: ['n1'], outFile: 'apps/builder/.runs/t1/import-deploy.yml', inputs: [], mode: 'workflow', stderr: '' };

describe('resolveImportSource (spec 087 S4 — best-effort inject, never blocks the push)', () => {
  test('model picked + node patched → the injected copy is pushed', async () => {
    const out = await resolveImportSource('/pd', TASK, {
      resolveLlmModels: async () => ({ enabled: [PICK], pick: PICK }),
      deployWithModel: async (_d, srcRel, outRel) => {
        assert.equal(srcRel, 'projects/p/w/workflows/main.yml');
        assert.equal(outRel, 'apps/builder/.runs/t1/import-deploy.yml', 'own name — never the live-test deploy.yml');
        return { ...DEP_OK, outFile: outRel };
      },
    });
    assert.equal(out.srcFileRel, 'apps/builder/.runs/t1/import-deploy.yml');
    assert.equal(out.injectedModel, 'gpt-mini');
  });

  test('pick null (0-model / models arm failed) → source as-is, deployWithModel never called', async () => {
    const out = await resolveImportSource('/pd', TASK, {
      resolveLlmModels: async () => ({ enabled: [], pick: null }),
      deployWithModel: async () => { throw new Error('must not be called'); },
    });
    assert.deepEqual(out, {});
  });

  test('inject ok but nothing patched (nodeCount 0) → source as-is', async () => {
    const out = await resolveImportSource('/pd', TASK, {
      resolveLlmModels: async () => ({ enabled: [PICK], pick: PICK }),
      deployWithModel: async () => ({ ...DEP_OK, nodeCount: 0, patched: [] }),
    });
    assert.deepEqual(out, {});
  });

  test('inject failed (ok:false) → source as-is', async () => {
    const out = await resolveImportSource('/pd', TASK, {
      resolveLlmModels: async () => ({ enabled: [PICK], pick: PICK }),
      deployWithModel: async () => ({ ...DEP_OK, ok: false, outFile: null }),
    });
    assert.deepEqual(out, {});
  });

  test('a throwing dep → source as-is (never throws out of the helper)', async () => {
    const out = await resolveImportSource('/pd', TASK, {
      resolveLlmModels: async () => { throw new Error('models arm down'); },
      deployWithModel: async () => DEP_OK,
    });
    assert.deepEqual(out, {});
  });
});

// ── pushApp `srcFileRel` plumbing (087 S4) ──────────────────────────────────────────────────────
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** projectsDir whose `.venv/bin/python` shim records its argv and prints a push `--json-out` line. */
function argShimDir(): { dir: string; argsFile: string } {
  const dir = mkdtempSync(join(tmpdir(), 'push-args-'));
  dirs.push(dir);
  const bin = join(dir, '.venv', 'bin');
  mkdirSync(bin, { recursive: true });
  const argsFile = join(dir, 'argv.txt');
  writeFileSync(join(bin, 'python'), `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > '${argsFile}'\necho '{"app_id":"a1"}'\n`, { mode: 0o755 });
  return { dir, argsFile };
}

describe('pushApp — srcFileRel switches --file → --src-file (spec 087 S4)', () => {
  test('without srcFileRel: workflow-relative --file (pre-087, byte-identical)', async () => {
    const { dir, argsFile } = argShimDir();
    const r = await pushApp(dir, 'p', 'w', 'main.yml', 'app');
    assert.equal(r.ok, true);
    const argv = readFileSync(argsFile, 'utf-8');
    assert.match(argv, /--file\nworkflows\/main\.yml/);
    assert.ok(!argv.includes('--src-file'));
  });

  test('with srcFileRel: repo-relative --src-file, no workflow-relative --file', async () => {
    const { dir, argsFile } = argShimDir();
    const r = await pushApp(dir, 'p', 'w', 'main.yml', 'app', 'apps/builder/.runs/t1/import-deploy.yml');
    assert.equal(r.ok, true);
    assert.equal(r.appId, 'a1');
    const argv = readFileSync(argsFile, 'utf-8');
    assert.match(argv, /--src-file\napps\/builder\/\.runs\/t1\/import-deploy\.yml/);
    assert.ok(!argv.includes('--file\nworkflows'));
  });
});
