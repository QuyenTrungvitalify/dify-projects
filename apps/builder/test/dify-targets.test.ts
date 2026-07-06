/**
 * Spec 036 S2 — difyTargets() capability detector. Reads the EXISTING DIFY_CONSOLE_* env fresh via
 * difyCreds(), so each case sets the env, asserts, and restores it (node --test runs a file in one
 * process). Guards: selfhost detected iff BOTH url+token present (AC #6); cloud is ALWAYS absent in this
 * spec (§8 reserved seam, AC #8); DIFY_WORKSPACE_ID rides through when set (admin-key path).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { difyTargets } from '../server/lib/dify-io.js';

/** Set DIFY_CONSOLE_URL/TOKEN/WORKSPACE_ID for the body, then restore whatever was there before. */
function withEnv<T>(
  url: string | undefined,
  token: string | undefined,
  workspaceId: string | undefined,
  fn: () => T
): T {
  const prev = {
    url: process.env.DIFY_CONSOLE_URL,
    tok: process.env.DIFY_CONSOLE_TOKEN,
    ws: process.env.DIFY_WORKSPACE_ID,
  };
  const setOrDel = (k: string, v: string | undefined): void => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };
  setOrDel('DIFY_CONSOLE_URL', url);
  setOrDel('DIFY_CONSOLE_TOKEN', token);
  setOrDel('DIFY_WORKSPACE_ID', workspaceId);
  try {
    return fn();
  } finally {
    setOrDel('DIFY_CONSOLE_URL', prev.url);
    setOrDel('DIFY_CONSOLE_TOKEN', prev.tok);
    setOrDel('DIFY_WORKSPACE_ID', prev.ws);
  }
}

describe('difyTargets (036 S2)', () => {
  test('both url+token present → selfhost slot populated (AC #6)', () => {
    withEnv('http://localhost/console/api', 'tok-abc', undefined, () => {
      const t = difyTargets();
      assert.deepEqual(t.selfhost, { url: 'http://localhost/console/api', token: 'tok-abc' });
    });
  });

  test('DIFY_WORKSPACE_ID rides through when set (admin-key path)', () => {
    withEnv('http://localhost/console/api', 'tok-abc', 'ws-1', () => {
      assert.deepEqual(difyTargets().selfhost, {
        url: 'http://localhost/console/api',
        token: 'tok-abc',
        workspaceId: 'ws-1',
      });
    });
  });

  test('no creds → selfhost absent (AC #2 relies on this)', () => {
    withEnv(undefined, undefined, undefined, () => {
      assert.equal(difyTargets().selfhost, undefined);
    });
  });

  test('url without token (or token without url) → selfhost absent (both required)', () => {
    withEnv('http://localhost/console/api', undefined, undefined, () => {
      assert.equal(difyTargets().selfhost, undefined, 'url alone is not a target');
    });
    withEnv(undefined, 'tok-abc', undefined, () => {
      assert.equal(difyTargets().selfhost, undefined, 'token alone is not a target');
    });
  });

  test('cloud slot is ALWAYS absent in this spec (§8 reserved seam, AC #8)', () => {
    withEnv('http://localhost/console/api', 'tok-abc', undefined, () => {
      assert.equal(difyTargets().cloud, undefined);
    });
    withEnv(undefined, undefined, undefined, () => {
      assert.equal(difyTargets().cloud, undefined);
    });
  });
});
