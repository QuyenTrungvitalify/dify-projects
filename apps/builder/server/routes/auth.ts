/**
 * auth.ts — the in-app Claude sign-in, so being logged out is a thing you FIX where you hit it rather
 * than a thing that sends you to a terminal:
 *
 *   GET  /api/auth/status       → { available, loggedIn, authMethod }
 *   POST /api/auth/login        → { url }        — starts the CLI's login, hands back its sign-in page
 *   POST /api/auth/login/code   → { ok }         — the code pasted off that page
 *   POST /api/auth/login/cancel → { ok }
 *
 * Registered for EVERY run (the routes/update.ts precedent, not the BUILDER_DEV one): its whole point
 * is the bản-sạch user who has no terminal in their path at all.
 *
 * Guards: the global onRequest hook Origin-checks every POST and the bind is 127.0.0.1. One login at a
 * time, process-wide — a second start while one is live is a 409 rather than a second PTY racing the
 * first for the same keychain entry. No path, no command and no shell string is built from input; the
 * ONLY thing that crosses into the child is the code, through {@link sanitizeCode}.
 *
 * The pasted code never appears in a response body, and never in a log line.
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  LoginSession,
  realProbe,
  realSpawnLogin,
  sanitizeCode,
  type AuthProbeFn,
  type SpawnLogin,
} from '../lib/claude-auth.js';

export interface AuthRoutesOpts {
  /** test seams — the real ones run the `claude` CLI */
  probe?: AuthProbeFn;
  spawnLogin?: SpawnLogin;
}

const authRoutes: FastifyPluginAsync<AuthRoutesOpts> = async (app, opts) => {
  const probe = opts.probe ?? realProbe;
  const spawnLogin = opts.spawnLogin ?? realSpawnLogin;
  let session: LoginSession | null = null;

  app.get('/api/auth/status', async () => probe());

  app.post('/api/auth/login', async (_req, reply) => {
    // Joinable only while the page it printed is still the page to sign in on. An attempt already
    // EXCHANGING a code is not: its child is on its way out, so handing its URL to a second tab would
    // hand over a page whose code nothing will be alive to redeem.
    if (session && (session.state === 'starting' || session.state === 'awaiting_code')) {
      // A live attempt already owns a PTY and a `state` the user's open page belongs to. Hand that
      // one's URL back rather than starting a second: the code from the older page would be rejected
      // by the newer child, which reads as "the app lost my login" from the outside.
      const url = await session.waitForUrl();
      if (url) return reply.send({ url });
      return reply.code(409).send({ error: 'a sign-in is already in progress', reason: 'login_running' });
    }
    const s = new LoginSession(spawnLogin);
    session = s;
    s.start();
    const url = await s.waitForUrl();
    if (!url) {
      s.cancel();
      session = null;
      // Nothing to sign in WITH is the common cause (no `claude` on PATH), and it is not the same
      // failure as a login that started and broke — say which, using the CLI's own words when it left any.
      const p = await probe();
      return reply.code(500).send({
        error: p.available
          ? `could not start the sign-in${s.error ? ` — ${s.error}` : ''}`
          : 'the `claude` CLI is not available on this machine',
        reason: p.available ? 'login_failed' : 'cli_missing',
      });
    }
    return reply.send({ url });
  });

  app.post('/api/auth/login/code', async (req, reply) => {
    const s = session;
    if (!s || s.state === 'done' || s.state === 'failed') {
      return reply.code(409).send({ error: 'no sign-in is in progress — start one first', reason: 'no_login' });
    }
    const code = sanitizeCode((req.body as { code?: unknown } | undefined)?.code);
    if (!code) {
      return reply.code(400).send({ error: 'that does not look like a sign-in code', reason: 'bad_code' });
    }
    await s.submitCode(code);
    const p = await probe();
    session = null;
    if (p.loggedIn) return reply.send({ ok: true, authMethod: p.authMethod });
    // 200 + ok:false, the routes/update.ts shape: a wrong code is an ordinary answer for the user to
    // act on (copy it again), not an HTTP error for the client to throw on.
    return reply.send({ ok: false, error: s.error ?? 'sign-in did not complete' });
  });

  app.post('/api/auth/login/cancel', async () => {
    session?.cancel();
    session = null;
    return { ok: true };
  });
};

export default authRoutes;
