/**
 * Spec 009 Builder backend — Lát 3 GATE.
 *
 * The real gated surface lives in `routes/tasks.ts` (`/api/tasks` + `/confirm` `/reply` `/cancel`):
 * a human-gated 4-phase build with a single-build run-lock, cancel, and boot reconcile. This file
 * wires that plugin, runs `reconcileOnBoot` at startup (any `running` task → `error`, lock cleared;
 * a paused gated build re-acquires the lock), and keeps the Lát-1 `/api/dev/run-implement` smoke
 * endpoint (a single Implement turn + post-turn verify).
 *
 * Binds 127.0.0.1:4123 (hardcoded — NOT env-overridable). Only the projects dir path may be
 * overridden, via DIFY_PROJECTS_DIR.
 */
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeSession } from './lib/claude-session.js';
import { runTurn } from './lib/turn-runner.js';
import { postTurnCheck, gitDirtyPaths } from './lib/post-turn.js';
import { reconcileOnBoot } from './lib/lock.js';
import tasksRoutes from './routes/tasks.js';

const HOST = '127.0.0.1'; // hardcoded — never env-overridable
const PORT = 4123;

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

const DIFY_PROJECTS_DIR = process.env.DIFY_PROJECTS_DIR
  ? resolve(process.env.DIFY_PROJECTS_DIR)
  : findRepoRoot(__dirname);
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

const app = Fastify({ logger: true });

app.get('/health', async () => ({
  ok: true,
  projectsDir: DIFY_PROJECTS_DIR,
  settingsPath: SETTINGS_PATH,
}));

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

  const taskId = randomUUID();

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
});

// The real gated surface (Lát 3): POST /api/tasks · GET /api/tasks/:id · POST .../confirm /reply
// /cancel — run-lock (409), pause/confirm, within-phase reply, cancel, scaffold-at-Spec-gate.
await app.register(tasksRoutes, {
  projectsDir: DIFY_PROJECTS_DIR,
  settingsPath: SETTINGS_PATH,
});

async function start(): Promise<void> {
  // Boot reconcile BEFORE listening: a crash/restart left no live process, so any `running` task →
  // `error` (lock cleared); a paused `awaiting_confirm` gated build re-acquires the lock (AC #19/#24).
  await reconcileOnBoot(DIFY_PROJECTS_DIR, app.log);
  await app.listen({ host: HOST, port: PORT });
  app.log.info({ host: HOST, port: PORT, projectsDir: DIFY_PROJECTS_DIR }, 'builder up');
}

start().catch((err) => {
  app.log.error(err, 'failed to start');
  process.exit(1);
});
