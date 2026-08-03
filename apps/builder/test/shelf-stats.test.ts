/**
 * Spec 080 S2 — the shelf-dashboard feed seam (fetchShelfStats).
 *
 * Pins: verbatim passthrough of `catalog.py stats --json` (including the CLI's OWN ok:false —
 * its missing-index hint must reach the screen, not be flattened into "exited 1"), and that every
 * failure mode (non-zero exit with garbage, unparseable stdout, spawn throw) degrades to the
 * `{ok:false, reason, tail}` shape the dev overlay renders — never a throw.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fetchShelfStats } from '../server/lib/shelf-stats.js';
import type { runPython } from '../server/lib/shell.js';

function fake(stdout: string, code = 0, stderr = ''): { fn: typeof runPython; calls: string[][] } {
  const calls: string[][] = [];
  const fn = ((_dir: string, args: string[]) => {
    calls.push(args);
    return Promise.resolve({ code, stdout, stderr });
  }) as typeof runPython;
  return { fn, calls };
}

describe('spec 080 S2 — fetchShelfStats', () => {
  test('valid stats JSON passes through verbatim, via the exact CLI args', async () => {
    const stats = { ok: true, total: 44, tiers: [{ tier: 'patterns', count: 11 }] };
    const { fn, calls } = fake(JSON.stringify(stats));
    assert.deepEqual(await fetchShelfStats('/p', fn), stats);
    assert.deepEqual(calls, [['tools/dify_base/catalog.py', 'stats', '--json']]);
  });

  test("the CLI's own ok:false (missing index) passes through — hint intact, even on exit 1", async () => {
    const noIndex = { ok: false, reason: 'no index', hint: '.venv/bin/python tools/dify_base/build_index.py' };
    const { fn } = fake(JSON.stringify(noIndex), 1);
    assert.deepEqual(await fetchShelfStats('/p', fn), noIndex);
  });

  test('non-zero exit with garbage stdout → ok:false with the stderr tail', async () => {
    const { fn } = fake('Traceback …', 1, 'ModuleNotFoundError: yaml');
    const r = await fetchShelfStats('/p', fn);
    assert.equal(r.ok, false);
    assert.match(String((r as { reason: string }).reason), /exited 1/);
    assert.match(String((r as { tail: string }).tail), /ModuleNotFoundError/);
  });

  test('exit 0 with unparseable stdout → ok:false, never a throw', async () => {
    const { fn } = fake('✗ not json at all');
    const r = await fetchShelfStats('/p', fn);
    assert.equal(r.ok, false);
    assert.match(String((r as { reason: string }).reason), /unparseable/);
  });

  test('spawn throw → ok:false, never a rejection', async () => {
    const boom = (() => Promise.reject(new Error('spawn ENOENT'))) as unknown as typeof runPython;
    const r = await fetchShelfStats('/p', boom);
    assert.equal(r.ok, false);
    assert.match(String((r as { tail: string }).tail), /ENOENT/);
  });
});
