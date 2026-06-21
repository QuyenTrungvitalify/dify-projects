/**
 * Spec 009 Builder backend — Lát 3 GATE.
 *
 * The real gated surface lives in `routes/tasks.ts` (`/api/tasks` + `/confirm` `/reply` `/cancel`):
 * a human-gated 4-phase build with a single-build run-lock, cancel, and boot reconcile. This file
 * wires that plugin, runs `reconcileOnBoot` at startup (any `running`/`scaffolding` task → `error`; a
 * paused `awaiting_confirm` build survives untouched — turn-level lock, gates hold nothing — and stays
 * reachable), and keeps the Lát-1 `/api/dev/run-implement` smoke endpoint (a single Implement turn +
 * post-turn verify).
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
import { randomUUID } from 'node:crypto';
import { existsSync, createReadStream, statSync, readFileSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeSession } from './lib/claude-session.js';
import { runTurn } from './lib/turn-runner.js';
import { postTurnCheck, gitDirtyPaths } from './lib/post-turn.js';
import { reconcileOnBoot, acquireTurn, releaseTurn, turnHolderId } from './lib/lock.js';
import { smokePermissionHook } from './lib/hook-check.js';
import { reconcilePushIntents } from './lib/recovery.js';
import { isValidWorkflowFile } from './state/task.js';
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

interface RunImplementBody {
  slug: string;
  workflowFile?: string;
  requirement: string;
  seedPath?: string;
}

/** Materialize the requirement as a mini-SPEC.md — implement.md reads {{PRIOR_ARTIFACT}} AS SPEC.md. */
function miniSpec(req: string, slug: string, workflowFile: string, seedPath: string): string {
  return `# SPEC — ${slug}/${workflowFile}

## Requirement
${req}

## Build notes
- Seed / pattern: ${seedPath || '(none — choose a templates/patterns/*.yml)'}
- Target artifact: \`projects/${slug}/workflows/${workflowFile}\`, top-level \`version: 0.6.0\`.
- Mint every node id with \`generate_id.py\` (13-digit). Leave \`dependencies: []\` + a # TODO if a plugin hash is needed.

This SPEC.md is the source of truth for what to build.
`;
}

// bodyLimit (BODY_LIMIT_BYTES, attachments.ts) is sized to clear a max multi-image turn — MAX_IMAGES(3)
// × 10 MB decoded, base64-inflated ~33% (≈40 MB) plus JSON overhead — so an over-limit image turn yields
// validateImages' friendly 400, never a raw Fastify 413 (spec 012 D1 / 014 D7; invariant unit-pinned).
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

app.post('/api/dev/run-implement', async (req, reply) => {
  const body = (req.body ?? {}) as Partial<RunImplementBody>;
  const slug = (body.slug ?? '').trim();
  const workflowFile = (body.workflowFile ?? 'main.yml').trim();
  const requirement = (body.requirement ?? '').trim();
  const seedPath = (body.seedPath ?? '').trim();

  if (!slug || !requirement) {
    return reply.code(400).send({ error: 'slug and requirement are required' });
  }
  // Defensive slug guard — keep it inside projects/<slug>/, no traversal.
  if (!/^[a-zA-Z0-9_]+$/.test(slug)) {
    return reply.code(400).send({ error: 'slug must match ^[a-zA-Z0-9_]+$' });
  }
  // Spec 015 D5 (S4): the workflowFile flows into projects/<slug>/workflows/<file> + sync.py push —
  // reject any non-`*.yml`/`*.yaml` basename or `..` traversal (same guard as POST /api/tasks).
  if (!isValidWorkflowFile(workflowFile)) {
    return reply.code(400).send({ error: 'workflowFile must be a plain *.yml/*.yaml basename (no path separators or "..")' });
  }

  const taskId = randomUUID();

  // L1 (spec 019): this dev smoke endpoint historically spawned a turn WITHOUT taking the turn-lock — an
  // un-gated 2nd-writer path that can violate the single-writer invariant the #3b post-turn confinement
  // check rests on (a curl here while a gated build's turn runs = two builds writing the tree at once, so
  // the baseline-delta is no longer attributable). Hard-gate it on the SAME turn-lock the gated surface
  // uses: 409 if any turn is running, and release in `finally` so the smoke path stays usable. The 409
  // body mirrors routes/tasks.ts `turnBusyError()` ({ error, holder }).
  if (!acquireTurn(taskId)) {
    return reply.code(409).send({ error: 'a turn is already running — try again in a moment', holder: turnHolderId() });
  }
  try {
    // 1. Confinement BASELINE — capture before any write/spawn. Only turn-introduced changes
    //    (delta vs this set) are evaluated against the whitelist; pre-existing work is preserved.
    const baseline = await gitDirtyPaths(DIFY_PROJECTS_DIR);

    // 2. Materialize the requirement as SPEC.md and point {{PRIOR_ARTIFACT}} at it.
    const runDir = join(DIFY_PROJECTS_DIR, 'apps/builder/.runs', taskId);
    await mkdir(runDir, { recursive: true });
    const specRel = `apps/builder/.runs/${taskId}/SPEC.md`;
    await writeFile(join(runDir, 'SPEC.md'), miniSpec(requirement, slug, workflowFile, seedPath));

    // 3. Ensure projects/<slug>/workflows/ exists (whitelisted; this slice runs no scaffold/init_project).
    await mkdir(join(DIFY_PROJECTS_DIR, 'projects', slug, 'workflows'), { recursive: true });

    // 4. Render the Implement (③) prompt. implement.md has {{SLUG}} {{WORKFLOW_FILE}}
    //    {{PRIOR_ARTIFACT}} {{SEED_PATH}} only — NO {{REQUIREMENT}} slot (it reads PRIOR_ARTIFACT as SPEC.md).
    const tmpl = await readFile(
      join(DIFY_PROJECTS_DIR, '.claude/skills/dify-build/implement.md'),
      'utf8'
    );
    const prompt = tmpl
      .replaceAll('{{SLUG}}', slug)
      .replaceAll('{{WORKFLOW_FILE}}', workflowFile)
      .replaceAll('{{PRIOR_ARTIFACT}}', specRel)
      .replaceAll('{{SEED_PATH}}', seedPath);

    // 5. Spawn ONE Implement turn (model C), capture session_id + terminal result.
    const session = new ClaudeSession(taskId, {
      taskId,
      workingDir: DIFY_PROJECTS_DIR,
      settingsPath: SETTINGS_PATH,
      log: app.log,
    });
    app.log.info({ taskId, slug, workflowFile, seedPath }, 'spawning Implement turn');
    const turn = await runTurn(session, prompt);

    // 6. Post-turn verify (authoritative — never trust turn.isError alone).
    const check = await postTurnCheck({
      projectsDir: DIFY_PROJECTS_DIR,
      slug,
      workflowFile,
      taskId,
      baseline,
      log: app.log,
    });

    const reasons = [...check.reasons];
    if (turn.note) reasons.push(turn.note);

    return {
      taskId,
      sessionId: turn.sessionId,
      turnIsError: turn.isError,
      status: check.status,
      reasons,
      workflowPath: `projects/${slug}/workflows/${workflowFile}`,
    };
  } finally {
    releaseTurn(taskId);
  }
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
  reply.header('Content-Type', MIME[extname(filePath)] ?? 'application/octet-stream');
  return reply.send(createReadStream(filePath));
});

async function start(): Promise<void> {
  // L4 (spec 019): smoke that the PreToolUse permission hook actually LOADS under this host's node. If
  // it can't (e.g. Node < 22.6 — no native `.ts`), the turn sandbox fails OPEN and nothing else detects
  // it; warn loudly (warn-not-fail for v1). Mirrors the real invocation, so a healthy host never trips.
  await smokePermissionHook(DIFY_PROJECTS_DIR, SETTINGS_PATH, app.log);
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
