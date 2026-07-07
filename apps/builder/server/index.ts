/**
 * Spec 009 Builder backend — Lát 3 GATE.
 *
 * The real gated surface lives in `routes/tasks.ts` (`/api/tasks` + `/confirm` `/reply` `/cancel`):
 * a human-gated 4-phase build with a single-build run-lock, cancel, and boot reconcile. This file
 * wires that plugin, and runs `reconcileOnBoot` at startup (any `running`/`scaffolding` task → `error`;
 * a paused `awaiting_confirm` build survives untouched — turn-level lock, gates hold nothing — and stays
 * reachable).
 *
 * Binds 127.0.0.1 (HOST hardcoded — never 0.0.0.0, spec §J). The port is BUILDER_PORT (default
 * 4123, spec §F — the vite dev proxy targets the same var); the projects dir is DIFY_PROJECTS_DIR.
 *
 * Lát 4 adds the UI surface on top of the Lát 3 gate: the SSE relay (`plugins/sse.ts` +
 * `GET /api/tasks/:id/stream`), the UI read endpoints (`routes/ui.ts`: `/api/tree`, `/api/seeds`,
 * SPEC.md GET/PUT), an Origin/same-origin check on mutating requests (spec §J), and static serving
 * of the built SPA (`web/dist`) at `/`.
 */
import Fastify from 'fastify';
import { execFile } from 'node:child_process';
import { existsSync, createReadStream, statSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileOnBoot } from './lib/lock.js';
import { smokePermissionHook, gateBootOnHook } from './lib/hook-check.js';
import { reconcilePushIntents } from './lib/recovery.js';
import tasksRoutes from './routes/tasks.js';
import uiRoutes from './routes/ui.js';
import { BODY_LIMIT_BYTES } from './lib/attachments.js';
import ssePlugin, { createSSEState } from './plugins/sse.js';
import { isOriginAllowedForMutation } from './plugins/sse-origin-check.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repo root = the dir containing `.dify-tag`, walking up from this file. */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, '.dify-tag'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: two levels above apps/builder/ — works for both dev (server/) and built (dist/server/).
  return resolve(start, '..', '..');
}

/**
 * Load `apps/builder/.env` (non-secret config + Dify console creds) into process.env BEFORE anything
 * reads it. Existing process.env wins (an explicit export overrides the file). DIFY_CONSOLE_TOKEN may
 * land here, but claude-session.ts strips every `DIFY_*` from the turn env — so the token still never
 * reaches a claude turn (§J). No dependency: a tiny `KEY=value` parser (quotes + `#` comments).
 */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

// Locate the repo + load .env from a path independent of DIFY_PROJECTS_DIR (which .env itself may set).
const REPO_ROOT = findRepoRoot(__dirname);
loadEnvFile(join(REPO_ROOT, 'apps/builder/.env'));

const HOST = '127.0.0.1'; // hardcoded — never env-overridable (spec §J)
// Spec §F: BUILDER_PORT (default 4123) is the ONLY configurable bind knob; HOST stays 127.0.0.1.
const PORT = Number(process.env.BUILDER_PORT) || 4123;

const DIFY_PROJECTS_DIR = process.env.DIFY_PROJECTS_DIR
  ? resolve(process.env.DIFY_PROJECTS_DIR)
  : REPO_ROOT;
const SETTINGS_PATH = join(DIFY_PROJECTS_DIR, 'apps/builder/headless-settings.json');

// bodyLimit (BODY_LIMIT_BYTES, attachments.ts) is sized to clear a max multi-file turn — MAX_ATTACHMENTS(3)
// × 10 MB decoded, base64-inflated ~33% (≈40 MB) plus JSON overhead — so an over-limit turn yields
// validateAttachments' friendly 400, never a raw Fastify 413 (spec 012 D1 / 014 D7 / 025; unit-pinned).
// Localhost-only bind + Origin-CSRF check (below) bound the DoS surface this opens.
const app = Fastify({ logger: true, bodyLimit: BODY_LIMIT_BYTES });

// Raw-body parser so PUT /api/tasks/:id/spec can take the SPEC.md markdown as text/plain (routes/ui.ts).
app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => done(null, body));

// ── /health — readiness gate (AC #1): non-OK with a clear message if the repo bootstrap is missing ──
app.get('/health', async (_req, reply) => {
  const checks = [
    { path: '.venv/bin/python', label: 'Python venv (.venv/bin/python) — run ./scripts/setup.sh' },
    { path: 'skills', label: 'skills/ directory (repo not bootstrapped at DIFY_PROJECTS_DIR)' },
  ];
  const missing = checks.filter((c) => !existsSync(join(DIFY_PROJECTS_DIR, c.path)));
  if (missing.length) {
    return reply.code(503).send({
      ok: false,
      projectsDir: DIFY_PROJECTS_DIR,
      missing: missing.map((m) => m.label),
      message: `builder not ready — missing: ${missing.map((m) => m.path).join(', ')}`,
    });
  }
  return { ok: true, projectsDir: DIFY_PROJECTS_DIR, settingsPath: SETTINGS_PATH };
});

// ── Origin / same-origin check on mutating requests (spec §J + 015 D6, local-CSRF defense) ──
// A browser page on another origin can't POST/PUT a mutation here. Spec 015 D6: an ABSENT Origin is now
// REJECTED on mutations (isOriginAllowedForMutation) — closing the absent-Origin CSRF loophole; a
// curl/script caller must send `-H "Origin: http://127.0.0.1:<port>"`. The SSE GET route keeps the
// lenient isOriginAllowed (a same-origin EventSource may omit Origin) and runs its own check before hijack.
app.addHook('onRequest', async (req, reply) => {
  const mutating = req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE' || req.method === 'PATCH';
  if (mutating && !isOriginAllowedForMutation(req.headers.origin, PORT)) {
    return reply.code(403).send({ error: 'origin not allowed' });
  }
});

// ── SSE relay state (shared: the plugin serves /stream, the routes broadcast into it) ──
const sse = createSSEState();
await app.register(ssePlugin, { sse, port: PORT });

// The gated surface (Lát 3): POST /api/tasks · GET /api/tasks/:id · POST .../confirm /reply /cancel
// — run-lock (409), pause/confirm, within-phase reply, cancel, scaffold-at-Spec-gate. Lát 4 wires
// the SSE `broadcast` so every transition + streamed turn reaches the browser live.
await app.register(tasksRoutes, {
  projectsDir: DIFY_PROJECTS_DIR,
  settingsPath: SETTINGS_PATH,
  broadcast: sse.broadcast,
});

// The UI read endpoints (Lát 4): GET /api/tree · GET /api/seeds · GET+PUT /api/tasks/:id/spec.
await app.register(uiRoutes, { projectsDir: DIFY_PROJECTS_DIR, now: () => Date.now() });

// ── Static SPA (web/dist) served at "/" — dependency-free handler (spec task 1) ──
// A wildcard GET catches everything not matched by the api/health/sse routes (Fastify prefers
// specific routes over the wildcard). Single-page app: unknown paths fall back to index.html.
const WEB_DIST = join(DIFY_PROJECTS_DIR, 'apps/builder/web/dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
};
const INDEX_HTML = join(WEB_DIST, 'index.html');
app.get('/*', async (req, reply) => {
  // Resolve the request path inside WEB_DIST; reject traversal; fall back to index.html for the SPA
  // (an empty/`.`/directory path or any unknown route → the single page).
  const star = (req.params as { '*': string })['*'] || '';
  const clean = normalize(decodeURIComponent(star)).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(WEB_DIST, clean);
  if (
    !filePath.startsWith(WEB_DIST) ||
    !existsSync(filePath) ||
    statSync(filePath).isDirectory()
  ) {
    filePath = INDEX_HTML;
  }
  if (!existsSync(filePath)) {
    return reply.code(404).send({ error: 'SPA not built — run `npm --prefix apps/builder/web run build`' });
  }
  const ext = extname(filePath);
  reply.header('Content-Type', MIME[ext] ?? 'application/octet-stream');
  // The SPA shell (index.html, or any unknown route that falls back to it) points at hash-versioned
  // assets that change on every `vite build`. With NO cache header the browser heuristically caches the
  // shell and keeps loading the OLD bundle after a rebuild (the "rebuilt but the fix isn't live" trap).
  // Force revalidation for the shell; the hashed assets under /assets/ are content-addressed → cache hard.
  if (ext === '.html' || filePath === INDEX_HTML) {
    reply.header('Cache-Control', 'no-cache');
  } else if (clean.startsWith('assets/')) {
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
  }
  return reply.send(createReadStream(filePath));
});

async function start(): Promise<void> {
  // L4 (spec 019) → SEC1 (spec 024): smoke that the PreToolUse permission hook LOADS under this host's
  // node. If not (e.g. Node < 22.6 — no native `.ts`), the turn sandbox fails OPEN. SEC1 flips v1's
  // warn-not-fail to fail-CLOSED: refuse to boot unless the operator opts out with
  // BUILDER_ALLOW_UNGUARDED=1. The smoke mirrors the real invocation, so a healthy host never refuses.
  const hookSmoke = await smokePermissionHook(DIFY_PROJECTS_DIR, SETTINGS_PATH, app.log);
  const gate = gateBootOnHook(hookSmoke, process.env.BUILDER_ALLOW_UNGUARDED === '1');
  if (gate.refuse) throw new Error(gate.reason);
  if (!hookSmoke.ok) {
    app.log.warn(
      { detail: hookSmoke.detail },
      'SEC1: PreToolUse hook unloadable but BUILDER_ALLOW_UNGUARDED=1 — starting UNGUARDED by operator override.'
    );
  }
  // Spec 045 D4 — WARN-only claude CLI presence check (no auth/quota probe: both cost tokens and
  // expire anyway; classifyTurnFailure covers them at the first failing turn). Unlike SEC1 nothing
  // fails open here — builds just fail loudly, now with an actionable note — so this never gates boot.
  await new Promise<void>((res) => {
    execFile('claude', ['--version'], { timeout: 5000 }, (err, stdout) => {
      if (err) {
        app.log.warn(
          { err: err.message },
          '045: `claude` CLI not found or not runnable — every build will fail at its first turn. ' +
            'Install it and run `claude` once to log in.'
        );
      } else {
        app.log.info({ version: String(stdout).trim() }, 'claude CLI present');
      }
      res();
    });
  });
  // Boot reconcile BEFORE listening: a crash/restart left no live process, so any `running`/
  // `scaffolding` task → `error`; a paused `awaiting_confirm` build survives untouched (turn-level
  // lock — it holds nothing) and stays reachable. `turnHolder` starts null (in-memory) (AC #19/#24).
  await reconcileOnBoot(DIFY_PROJECTS_DIR, app.log);
  // Then recover push idempotency (AC #25): a task whose push_intent marker lacks an app_id crashed
  // mid-import → reconcile the id via `sync.py list` (never re-push) or surface "check Dify".
  await reconcilePushIntents(DIFY_PROJECTS_DIR, app.log);
  await app.listen({ host: HOST, port: PORT });
  app.log.info({ host: HOST, port: PORT, projectsDir: DIFY_PROJECTS_DIR }, 'builder up');
}

start().catch((err) => {
  app.log.error(err, 'failed to start');
  process.exit(1);
});
