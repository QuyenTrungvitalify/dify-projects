/**
 * Spec 015 D7 (S8) — redactSecrets scrubs the Dify token (plain / URL-encoded / base64, ≥4 chars) AND
 * DIFY_CONSOLE_URL from captured sync.py output. redactSecrets reads difyCreds() fresh from process.env,
 * so each case sets the env, asserts, and restores it (node --test runs files in one process).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets } from '../server/lib/dify-io.js';

function withCreds<T>(url: string | undefined, token: string | undefined, fn: () => T): T {
  const prevUrl = process.env.DIFY_CONSOLE_URL;
  const prevTok = process.env.DIFY_CONSOLE_TOKEN;
  if (url === undefined) delete process.env.DIFY_CONSOLE_URL; else process.env.DIFY_CONSOLE_URL = url;
  if (token === undefined) delete process.env.DIFY_CONSOLE_TOKEN; else process.env.DIFY_CONSOLE_TOKEN = token;
  try {
    return fn();
  } finally {
    if (prevUrl === undefined) delete process.env.DIFY_CONSOLE_URL; else process.env.DIFY_CONSOLE_URL = prevUrl;
    if (prevTok === undefined) delete process.env.DIFY_CONSOLE_TOKEN; else process.env.DIFY_CONSOLE_TOKEN = prevTok;
  }
}

describe('redactSecrets (015 D7)', () => {
  test('scrubs the plain token, even a short one (≥4)', () => {
    withCreds(undefined, 'abc123tok', () => {
      assert.equal(redactSecrets('using token abc123tok now').includes('abc123tok'), false);
    });
    withCreds(undefined, 'shrt', () => {
      assert.equal(redactSecrets('t=shrt').includes('shrt'), false); // short token still scrubbed
    });
  });

  test('scrubs URL-encoded + base64 ENCODED forms of the token', () => {
    const token = 'tok/with+special=';
    withCreds(undefined, token, () => {
      const encoded = encodeURIComponent(token);
      const b64 = Buffer.from(token, 'utf8').toString('base64');
      const out = redactSecrets(`url=${encoded} header=${b64}`);
      assert.equal(out.includes(encoded), false, 'url-encoded form scrubbed');
      assert.equal(out.includes(b64), false, 'base64 form scrubbed');
    });
  });

  test('scrubs DIFY_CONSOLE_URL (and its no-trailing-slash form)', () => {
    withCreds('http://dify.internal/console/api/', undefined, () => {
      const out = redactSecrets('GET http://dify.internal/console/api/ and http://dify.internal/console/api failed');
      assert.equal(out.includes('dify.internal'), false);
    });
  });

  test('scrubs a Bearer header value', () => {
    withCreds(undefined, undefined, () => {
      const out = redactSecrets('Authorization: Bearer eyJhbG.cd.ef');
      assert.equal(out.includes('eyJhbG.cd.ef'), false, 'bearer value scrubbed');
      assert.equal(out, 'Authorization: Bearer ***');
    });
  });

  test('no creds set → text passes through unchanged', () => {
    withCreds(undefined, undefined, () => {
      assert.equal(redactSecrets('nothing secret here'), 'nothing secret here');
    });
  });
});
