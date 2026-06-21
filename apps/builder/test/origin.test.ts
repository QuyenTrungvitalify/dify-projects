/**
 * T3 — isOriginAllowed (the local-CSRF boundary). Allowlist = the builder's own origin on its port.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isOriginAllowed, isOriginAllowedForMutation, buildAllowedOrigins } from '../server/plugins/sse-origin-check.js';

describe('isOriginAllowed', () => {
  test('exact same-origin match (127.0.0.1 + localhost on the bound port) → allowed', () => {
    assert.equal(isOriginAllowed('http://127.0.0.1:4123', 4123), true);
    assert.equal(isOriginAllowed('http://localhost:4123', 4123), true);
  });

  test('cross-origin → blocked', () => {
    assert.equal(isOriginAllowed('http://evil.example', 4123), false);
    assert.equal(isOriginAllowed('https://127.0.0.1:4123', 4123), false); // wrong scheme
    assert.equal(isOriginAllowed('http://127.0.0.1:9999', 4123), false); // wrong port
  });

  test('absent Origin → allowed (curl / same-origin EventSource that omits it — R4, deliberate)', () => {
    assert.equal(isOriginAllowed(undefined, 4123), true);
    assert.equal(isOriginAllowed('', 4123), true);
  });

  test('buildAllowedOrigins always seeds both loopback hostnames for the port', () => {
    const s = buildAllowedOrigins(4123);
    assert.ok(s.has('http://127.0.0.1:4123'));
    assert.ok(s.has('http://localhost:4123'));
  });
});

describe('isOriginAllowedForMutation (015 D6 — the STRICT mutation gate, folds 011 R4)', () => {
  test('a present allowlisted Origin still passes', () => {
    assert.equal(isOriginAllowedForMutation('http://127.0.0.1:4123', 4123), true);
    assert.equal(isOriginAllowedForMutation('http://localhost:4123', 4123), true);
  });

  test('an ABSENT Origin is REJECTED on a mutation (the closed CSRF loophole)', () => {
    assert.equal(isOriginAllowedForMutation(undefined, 4123), false);
    assert.equal(isOriginAllowedForMutation('', 4123), false);
    // …while the lenient SSE-GET path still allows absent Origin (unchanged).
    assert.equal(isOriginAllowed(undefined, 4123), true);
  });

  test('a cross-origin mutation is rejected', () => {
    assert.equal(isOriginAllowedForMutation('http://evil.example', 4123), false);
    assert.equal(isOriginAllowedForMutation('http://127.0.0.1:9999', 4123), false);
  });
});
