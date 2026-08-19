/**
 * Spec 099 S4 / 101 §2.3 — ONE origin.
 *
 * NAMED after the module it covers, not "origin": `test/origin.test.ts` already exists and covers a
 * DIFFERENT boundary (the CSRF Origin allowlist — `isOriginAllowed`). Two unrelated concerns sharing one
 * filename is how one of them quietly disappears; that very thing happened while writing this file.
 *
 * `localhost:<port>` and `127.0.0.1:<port>` are the same socket but two BROWSER origins, so each keeps
 * its own localStorage — and the Builder stores a build's chat thread there. Arriving by the wrong URL
 * therefore shows a different conversation for the same build, silently. Measured: `localhost:4123` was
 * really used on 05/08, 12/08 and 17/08, so this trap has already been walked into.
 *
 * The two assertions that carry weight here are the NEGATIVE ones:
 *   - a mutation must never be redirected (a 301/302 lets the browser turn POST into GET → a bodyless
 *     request → 404 → a silently failed /ask). The old spec draft said "301"; this is the test that
 *     would have caught it, so it asserts the CODE, not just the path.
 *   - the Location must never be built from an attacker-shaped `req.url`: a path beginning `//` is
 *     protocol-relative, i.e. an open redirect off this machine.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { canonicalHostRedirect, CANONICAL_REDIRECT_STATUS } from '../server/plugins/canonical-host.js';

const PORT = 4123;
const nav = (url: string, host = `localhost:${PORT}`, method = 'GET') => ({
  method,
  url,
  headers: { host, accept: 'text/html,application/xhtml+xml', 'sec-fetch-mode': 'navigate' },
});

describe('canonicalHostRedirect — send document navigations to the canonical origin', () => {
  test('a navigation to localhost is redirected to 127.0.0.1, path + query INTACT', () => {
    assert.equal(canonicalHostRedirect(nav('/'), PORT), `http://127.0.0.1:${PORT}/`);
    assert.equal(
      canonicalHostRedirect(nav('/?task=1786505684286&tab=spec'), PORT),
      `http://127.0.0.1:${PORT}/?task=1786505684286&tab=spec`,
      'the query is what carries which build is open — dropping it lands the user on a blank app',
    );
  });

  test('a hostname is case-insensitive — `LOCALHOST` is the same origin to a browser', () => {
    assert.equal(canonicalHostRedirect(nav('/', `LOCALHOST:${PORT}`), PORT), `http://127.0.0.1:${PORT}/`);
    assert.equal(canonicalHostRedirect(nav('/', `LocalHost:${PORT}`), PORT), `http://127.0.0.1:${PORT}/`);
  });

  test('already canonical → left alone (no redirect loop)', () => {
    assert.equal(canonicalHostRedirect(nav('/', `127.0.0.1:${PORT}`), PORT), null);
    assert.equal(canonicalHostRedirect(nav('/', '127.0.0.1'), PORT), null);
  });

  test('a Host naming some OTHER port is not ours to canonicalise', () => {
    assert.equal(canonicalHostRedirect(nav('/', 'localhost:9999'), PORT), null);
    assert.equal(canonicalHostRedirect(nav('/', 'localhost'), PORT), `http://127.0.0.1:${PORT}/`,
      'a port-less Host (served on :80) is still ours');
  });

  test('MUTATIONS are never redirected — the 301-turns-POST-into-GET trap', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal(canonicalHostRedirect(nav('/api/tasks/1/ask', `localhost:${PORT}`, m), PORT), null, m);
    }
  });

  test('the API is never redirected, even when something claims to accept HTML', () => {
    assert.equal(canonicalHostRedirect(nav('/api/tasks/1'), PORT), null);
    assert.equal(canonicalHostRedirect(nav('/api/tasks/1/stream'), PORT), null);
    assert.equal(canonicalHostRedirect(nav('/api'), PORT), null);
    assert.equal(canonicalHostRedirect(nav('/apiary'), PORT), `http://127.0.0.1:${PORT}/apiary`,
      'the guard matches the /api segment, not the prefix — a page named /apiary is still a page');
  });

  test('a non-navigation (fetch/XHR) is left alone — swapping origin mid-session helps nobody', () => {
    assert.equal(
      canonicalHostRedirect({ method: 'GET', url: '/assets/app.js', headers: { host: `localhost:${PORT}`, accept: '*/*' } }, PORT),
      null,
    );
    assert.equal(
      canonicalHostRedirect({ method: 'GET', url: '/x', headers: { host: `localhost:${PORT}`, accept: 'application/json', 'sec-fetch-mode': 'cors' } }, PORT),
      null,
    );
  });

  test('OPEN REDIRECT guard: a protocol-relative or absolute target is refused, not forwarded', () => {
    assert.equal(canonicalHostRedirect(nav('//evil.example/'), PORT), null, '`//host` is protocol-relative');
    assert.equal(canonicalHostRedirect(nav('http://evil.example/'), PORT), null, 'not a path at all');
    assert.equal(canonicalHostRedirect(nav('///evil.example'), PORT), null);
  });

  test('no Host header at all (curl --http1.0) → no redirect, no crash', () => {
    assert.equal(canonicalHostRedirect({ method: 'GET', url: '/', headers: {} }, PORT), null);
  });
});

describe('the redirect as WIRED — status code and Location on a real reply', () => {
  /** The hook exactly as index.ts registers it, so the status code itself is pinned. */
  async function build() {
    const app = Fastify();
    app.addHook('onRequest', async (req, reply) => {
      const canonical = canonicalHostRedirect(req, PORT);
      if (canonical) return reply.code(CANONICAL_REDIRECT_STATUS).header('location', canonical).send();
    });
    app.get('/', async () => 'the app');
    app.post('/api/tasks/:id/ask', async () => ({ ok: true }));
    return app;
  }

  test('308 — NOT 301/302, which are the codes that let a browser drop the method and body', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/?task=1',
      headers: { host: `localhost:${PORT}`, accept: 'text/html', 'sec-fetch-mode': 'navigate' },
    });
    assert.equal(res.statusCode, 308, 'a 301/302 here would silently break every POST to localhost');
    // The SAME constant `index.ts` passes to `reply.code`, so this pins the real wiring rather than a
    // copy of it. (A `!== 301` assertion belongs here in spirit but not in fact: the constant is typed
    // as the literal `308`, so `tsc` rejects the comparison as unreachable — the compiler is already
    // enforcing what the assertion would have checked, at every call site.)
    assert.equal(CANONICAL_REDIRECT_STATUS, 308);
    assert.equal(res.headers.location, `http://127.0.0.1:${PORT}/?task=1`);
    await app.close();
  });

  test('POST /api/... to localhost reaches the route unchanged — never a redirect', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks/1786505684286/ask',
      headers: { host: `localhost:${PORT}` },
      payload: { text: 'hi' },
    });
    assert.equal(res.statusCode, 200, 'the mutation was served, not bounced');
    assert.deepEqual(res.json(), { ok: true });
    await app.close();
  });

  test('a canonical navigation is served normally', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/',
      headers: { host: `127.0.0.1:${PORT}`, accept: 'text/html', 'sec-fetch-mode': 'navigate' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, 'the app');
    await app.close();
  });
});
