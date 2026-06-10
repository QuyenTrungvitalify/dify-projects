/**
 * routes/ui.ts — the Lát 4 UI-only endpoints (spec 009 Endpoints), kept SEPARATE from the Lát 3
 * gated `routes/tasks.ts` so the gate state machine is untouched:
 *
 *   - GET  /api/tree            → the Project ▸ Workflow ▸ Task sidebar tree (artifacts.buildTree)
 *   - GET  /api/seeds           → existing Dify apps for the seed picker. The real producer
 *                                 (`sync.py list`) lands in Lát 5; here it DEGRADES to an empty list
 *                                 (`{seeds:[], note}`) so the UI renders gracefully (spec Endpoints).
 *   - GET  /api/tasks/:id/spec  → the current SPEC.md content (for the editable artifact panel)
 *   - PUT  /api/tasks/:id/spec  → persist an in-place SPEC.md edit (explicit Save, last-writer; the
 *                                 raw markdown body is written to the SAME path the §A gate-check +
 *                                 Implement re-read, so a manual edit wins — spec §Revision Cleanups).
 *
 * READ-only except the SPEC.md PUT — no gate/verify/spawn here (dumb-renderer guarantee). Origin is
 * checked on the mutating PUT by the global onRequest hook in index.ts (spec §J).
 */
import type { FastifyPluginAsync } from 'fastify';
import { writeFile } from 'node:fs/promises';
import { loadTask } from '../state/task.js';
import { buildTree, specPathFor } from '../lib/artifacts.js';

export interface UiRoutesOptions {
  projectsDir: string;
  /** Injected so the tree's relative-time labels are deterministic per request (no Date in lib). */
  now: () => number;
}

const uiRoutes: FastifyPluginAsync<UiRoutesOptions> = async (app, opts) => {
  const { projectsDir, now } = opts;

  // ── GET /api/tree — 3-level sidebar tree grouped by project.group ──
  app.get('/api/tree', async () => {
    return { projects: await buildTree(projectsDir, now()) };
  });

  // ── GET /api/seeds — degrades to empty until the Lát 5 sync.py producer lands ──
  app.get('/api/seeds', async () => {
    return { seeds: [], note: 'connect Dify to seed from a workspace app (available in Lát 5)' };
  });

  // ── GET /api/tasks/:id/spec — current SPEC.md content for the editable panel ──
  app.get<{ Params: { id: string } }>('/api/tasks/:id/spec', async (req, reply) => {
    let task;
    try {
      task = await loadTask(projectsDir, req.params.id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${req.params.id}` });
    }
    const { readFile } = await import('node:fs/promises');
    try {
      const content = await readFile(specPathFor(projectsDir, task), 'utf8');
      return { content };
    } catch {
      return { content: '' }; // pre-Spec phase → no SPEC.md yet; panel shows empty
    }
  });

  // ── PUT /api/tasks/:id/spec — persist an in-place SPEC.md edit (last-writer) ──
  app.put<{ Params: { id: string } }>('/api/tasks/:id/spec', async (req, reply) => {
    let task;
    try {
      task = await loadTask(projectsDir, req.params.id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${req.params.id}` });
    }
    // Accept the raw markdown body (text/plain) OR a JSON `{content}` envelope.
    const body = req.body;
    const content =
      typeof body === 'string'
        ? body
        : typeof (body as { content?: unknown })?.content === 'string'
          ? (body as { content: string }).content
          : null;
    if (content == null) {
      return reply.code(400).send({ error: 'spec content is required (raw markdown or {content})' });
    }
    await writeFile(specPathFor(projectsDir, task), content);
    return { ok: true, path: specPathFor(projectsDir, task) };
  });
};

export default uiRoutes;
