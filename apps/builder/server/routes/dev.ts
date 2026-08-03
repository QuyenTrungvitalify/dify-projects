/**
 * dev.ts — spec 059 dev-only routes. Registered from index.ts ONLY when `BUILDER_DEV=1`, so a normal
 * or prod run never mounts this surface. `POST /api/dev/rebuild` rebuilds server+web and hot-restarts
 * the process (see lib/dev-rebuild.ts). The global onRequest hook Origin-checks it; the bind is
 * 127.0.0.1. Fixed commands, no user input.
 */
import type { FastifyPluginAsync } from 'fastify';
import { buildTurnBusy, chatTurnBusy } from '../lib/lock.js';
import { runBuild, scheduleRestart } from '../lib/dev-rebuild.js';
import { fetchShelfStats } from '../lib/shelf-stats.js';
import { resolveSettings, saveLocalSettings } from '../lib/settings.js';
import { loadTrackedShare } from '../lib/share.js';
import { runPython } from '../lib/shell.js';

export interface DevRoutesOpts {
  builderDir: string; // apps/builder (where `npm run build` runs; web/ is a subdir)
  port: number; // the bind port the restarter waits to free
  projectsDir: string; // repo root — where catalog.py stats runs (spec 080 S2)
}

const devRoutes: FastifyPluginAsync<DevRoutesOpts> = async (app, opts) => {
  app.post('/api/dev/rebuild', async (_req, reply) => {
    // Refuse while ANY turn is live (either lane, 082) — restarting kills every running `claude` child.
    if (buildTurnBusy() || chatTurnBusy()) {
      return reply.code(409).send({ ok: false, reason: 'a turn is running — cancel it before rebuilding' });
    }
    const build = await runBuild(opts.builderDir, app.log);
    if (!build.ok) {
      // 200 with ok:false (not an HTTP error) so the FE reads the log tail without ApiError-throwing.
      return reply.send({ ok: false, phase: 'build', log: build.tail });
    }
    // Build is clean → schedule the detached kill+restart and tell the FE to poll /health for the blip.
    scheduleRestart(opts.builderDir, opts.port, app.log);
    return reply.send({ ok: true, restarting: true });
  });

  // Spec 080 S2 — the shelf-dashboard feed: `catalog.py stats --json` passthrough. Read-only
  // (the CLI writes nothing); fetch-on-open from the dev overlay, no cache (<1s per call).
  app.get('/api/dev/shelf', async (_req, reply) => {
    return reply.send(await fetchShelfStats(opts.projectsDir, runPython));
  });

  // Dev Settings (spec 083 follow-up) — read/write the per-machine overrides in
  // .dify-settings.local.json. GET returns the field registry + local values (secrets masked to a
  // `set` flag) + the team-file fallback hint. POST applies a validated patch. Writes ONLY the
  // gitignored local file — never the team-committed .dify-share.json.
  app.get('/api/dev/settings', async (_req, reply) => {
    const tracked = await loadTrackedShare(opts.projectsDir);
    return reply.send({ ok: true, fields: await resolveSettings(opts.projectsDir, tracked) });
  });

  app.post('/api/dev/settings', async (req, reply) => {
    const body = (req.body ?? {}) as { values?: Record<string, unknown>; clearSecrets?: string[] };
    const values = body.values && typeof body.values === 'object' ? body.values : {};
    const clearSecrets = Array.isArray(body.clearSecrets) ? body.clearSecrets.filter((k) => typeof k === 'string') : [];
    const res = await saveLocalSettings(opts.projectsDir, { values, clearSecrets });
    if (!res.ok) return reply.code(400).send(res);
    const tracked = await loadTrackedShare(opts.projectsDir);
    return reply.send({ ok: true, fields: await resolveSettings(opts.projectsDir, tracked) });
  });
};

export default devRoutes;
