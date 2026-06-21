/**
 * Spec 019 L4 — boot-time smoke that the PreToolUse permission hook is LOADABLE. If the host node can't
 * run the `.ts` hook the turn sandbox fails OPEN; this catches that at boot. The two directions:
 *   1. the REAL configured command loads on this host → ok (no false-refuse on a healthy Node ≥22.6);
 *   2. an unloadable / non-emitting command → not ok (the fail-open condition is detected).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkHookLoadable, readPreToolUseCommand } from '../server/lib/hook-check.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SETTINGS = join(REPO_ROOT, 'apps/builder/headless-settings.json');

describe('readPreToolUseCommand (019 L4)', () => {
  test('parses the configured hook command from headless-settings.json', async () => {
    const cmd = await readPreToolUseCommand(SETTINGS);
    assert.ok(cmd, 'a PreToolUse command must be configured');
    assert.match(cmd!, /permission-gate\.ts/, 'it points at the permission hook');
  });

  test('a missing/garbage settings file → null (no throw)', async () => {
    assert.equal(await readPreToolUseCommand(join(REPO_ROOT, 'does-not-exist.json')), null);
  });
});

describe('checkHookLoadable (019 L4)', () => {
  test('the REAL configured command loads + emits a decision on this host (no false-refuse)', async () => {
    const cmd = await readPreToolUseCommand(SETTINGS);
    assert.ok(cmd);
    const r = await checkHookLoadable(REPO_ROOT, cmd!);
    assert.equal(r.ok, true, `expected the real hook to load; got: ${r.detail}`);
  });

  test('a missing hook file → not ok (the fail-open condition is detected)', async () => {
    const r = await checkHookLoadable(
      REPO_ROOT,
      'node --disable-warning=ExperimentalWarning apps/builder/server/hooks/__does_not_exist__.ts'
    );
    assert.equal(r.ok, false);
  });

  test('a command that runs but emits no JSON decision → not ok', async () => {
    const r = await checkHookLoadable(REPO_ROOT, 'node -e process.stdout.write("notjson")');
    assert.equal(r.ok, false);
  });

  test('an empty command → not ok (no throw)', async () => {
    const r = await checkHookLoadable(REPO_ROOT, '   ');
    assert.equal(r.ok, false);
  });
});
