/**
 * Spec 037 S2 — the workspace-facts harvest (AC 5/5b/5c/8) + the AC 9 creds-gated live shape pin.
 *
 * harvestWorkspaceFacts rides the injectable `sync` seam (a fake runSyncPy per test — the
 * live-test suite's injectable-runner style). The planted-secret test (5b) is the load-bearing
 * one: a fake whose stdout DELIBERATELY carries the console token proves redaction end-to-end —
 * a clean fake proves nothing.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  harvestWorkspaceFacts,
  loadWorkspaceFacts,
  knowledgeBlock,
  parsePlugins,
  parseDatasets,
  type WorkspaceFacts,
} from '../server/lib/dify-io.js';
import type { SyncResult } from '../server/lib/dify-io.js';
import type { SessionLogger } from '../server/lib/claude-session.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;
const TASK = '1700000000042';
const TOKEN = 'tok-super-secret-037';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wsfacts-'));
  mkdirSync(join(dir, 'apps', 'builder', '.runs', TASK), { recursive: true });
  process.env.DIFY_CONSOLE_URL = 'http://localhost/console/api';
  process.env.DIFY_CONSOLE_TOKEN = TOKEN;
});
afterEach(() => {
  delete process.env.DIFY_CONSOLE_URL;
  delete process.env.DIFY_CONSOLE_TOKEN;
  rmSync(dir, { recursive: true, force: true });
});

type FakeSync = (projectsDir: string, args: string[]) => Promise<SyncResult>;

const okSync: FakeSync = async (_d, args) => {
  if (args[0] === 'models') {
    return { code: 0, stdout: JSON.stringify({ enabled: [{ provider: 'openai', models: [{ model: 'gpt-4o-mini', status: 'active' }] }], default: null }), stderr: '' };
  }
  if (args[0] === 'plugins') {
    return { code: 0, stdout: JSON.stringify({ plugins: [{ name: 'openai', identifier: `langgenius/openai:0.2.8@${'a'.repeat(64)}` }] }), stderr: '' };
  }
  if (args[0] === 'datasets') {
    return { code: 0, stdout: JSON.stringify({ datasets: [{ id: '8aa20000-0000-0000-0000-000000000000', name: 'FAQ KB' }] }), stderr: '' };
  }
  return { code: 1, stdout: '', stderr: `unexpected: ${args[0]}` };
};

const wsPath = (): string => join(dir, 'apps', 'builder', '.runs', TASK, 'workspace.json');

describe('spec 037 S2 — harvestWorkspaceFacts', () => {
  test('AC 5: writes the §2 schema with harvestedAt stamped', async () => {
    await harvestWorkspaceFacts(dir, TASK, log, okSync);
    const facts = JSON.parse(readFileSync(wsPath(), 'utf8')) as WorkspaceFacts;
    assert.equal(facts.target, 'selfhost');
    assert.ok(facts.harvestedAt, 'harvestedAt stamped');
    assert.deepEqual(facts.models, [{ provider: 'openai', name: 'gpt-4o-mini' }]);
    assert.equal(facts.plugins[0].identifier, `langgenius/openai:0.2.8@${'a'.repeat(64)}`);
    assert.deepEqual(facts.datasets, [{ id: '8aa20000-0000-0000-0000-000000000000', name: 'FAQ KB' }]);
  });

  test('AC 5b (planted secret): the console token in the fake stdout NEVER reaches workspace.json', async () => {
    const leaky: FakeSync = async (_d, args) => {
      const r = await okSync(_d, args);
      if (args[0] === 'datasets') {
        // plant the token INSIDE a value the parser keeps (a dataset name)
        return { code: 0, stdout: JSON.stringify({ datasets: [{ id: 'x'.repeat(36), name: `evil ${TOKEN} name` }] }), stderr: '' };
      }
      return r;
    };
    await harvestWorkspaceFacts(dir, TASK, log, leaky);
    const bytes = readFileSync(wsPath(), 'utf8');
    assert.ok(!bytes.includes(TOKEN), 'token redacted from workspace.json bytes');
  });

  test('AC 5c: total harvest failure keeps a pre-existing file; with none, writes none — turn never blocks', async () => {
    const failing: FakeSync = async () => ({ code: 1, stdout: '', stderr: 'down' });

    writeFileSync(wsPath(), '{"harvestedAt":"prev","target":"selfhost","models":[],"plugins":[],"datasets":[]}');
    await harvestWorkspaceFacts(dir, TASK, log, failing);
    assert.equal(JSON.parse(readFileSync(wsPath(), 'utf8')).harvestedAt, 'prev', 'previous file KEPT');

    rmSync(wsPath());
    await harvestWorkspaceFacts(dir, TASK, log, failing);
    assert.equal(existsSync(wsPath()), false, 'no file written on total failure');
  });

  test('AC 8: no creds → harvest skipped without error, no file, knowledgeBlock renders empty', async () => {
    delete process.env.DIFY_CONSOLE_URL;
    delete process.env.DIFY_CONSOLE_TOKEN;
    let called = 0;
    await harvestWorkspaceFacts(dir, TASK, log, async () => { called++; return { code: 0, stdout: '', stderr: '' }; });
    assert.equal(called, 0, 'sync never invoked without creds');
    assert.equal(existsSync(wsPath()), false);
    assert.equal(await loadWorkspaceFacts(dir, TASK), null);
    assert.equal(knowledgeBlock(null), '', 'KNOWLEDGE renders empty — byte-unchanged prompt');
  });

  test('parsers are defensive: garbage stdout → empty arrays, never a throw', () => {
    assert.deepEqual(parsePlugins('not json at all'), []);
    assert.deepEqual(parseDatasets('{"datasets": "wrong-shape"}'), []);
    assert.deepEqual(parsePlugins(JSON.stringify({ plugins: [{ name: 'x' }] })), [], 'identifier-less entries dropped');
  });
});

// ── AC 9: creds-gated LIVE shape pin (the 032 parseModels discipline) ───────────────────────────

describe('AC 9 — live shape pin (skipped without real creds)', () => {
  test('sync.py plugins/datasets: real shapes match the D5 contract', (t) => {
    const repo = join(import.meta.dirname, '..', '..', '..');
    const envFile = join(repo, 'apps', 'builder', '.env');
    const venv = join(repo, '.venv', 'bin', 'python');
    if (!existsSync(envFile) || !existsSync(venv)) return t.skip('no real creds/.venv — pin runs on demand');
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
    if (!env.DIFY_CONSOLE_URL || !env.DIFY_CONSOLE_TOKEN) return t.skip('creds absent from .env');

    let plugins: string;
    try {
      plugins = execFileSync(venv, [join(repo, 'tools/dify_base/sync.py'), 'plugins'], { env, encoding: 'utf8', timeout: 20000 });
    } catch {
      return t.skip('live Dify unreachable — pin runs on demand');
    }
    const parsedP = parsePlugins(plugins);
    assert.ok(parsedP.length >= 1, 'at least one plugin installed');
    assert.match(parsedP[0].identifier, /@[0-9a-f]{64}$/, 'bare hex64 after @, NO sha256: literal (verified live 2026-07-06)');

    const datasets = execFileSync(venv, [join(repo, 'tools/dify_base/sync.py'), 'datasets'], { env, encoding: 'utf8', timeout: 20000 });
    const parsedD = parseDatasets(datasets);
    for (const d of parsedD) assert.match(d.id, /^[0-9a-f-]{36}$/, 'UUID-shaped dataset id');
  });
});
