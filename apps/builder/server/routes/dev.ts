/**
 * dev.ts — spec 059 dev-only routes. Registered from index.ts ONLY when `BUILDER_DEV=1`, so a normal
 * or prod run never mounts this surface. `POST /api/dev/rebuild` rebuilds server+web and hot-restarts
 * the process (see lib/dev-rebuild.ts). The global onRequest hook Origin-checks it; the bind is
 * 127.0.0.1. Fixed commands, no user input.
 */
import type { FastifyPluginAsync } from 'fastify';
import { turnBusy } from '../lib/lock.js';
import { runBuild, scheduleRestart } from '../lib/dev-rebuild.js';

export interface DevRoutesOpts {
  builderDir: string; // apps/builder (where `npm run build` runs; web/ is a subdir)
  port: number; // the bind port the restarter waits to free
}

const devRoutes: FastifyPluginAsync<DevRoutesOpts> = async (app, opts) => {
  app.post('/api/dev/rebuild', async (_req, reply) => {
    // Refuse while a build turn is live — restarting would abandon the running `claude` turn.
    if (turnBusy()) {
      return reply.code(409).send({ ok: false, reason: 'a build turn is running — cancel it before rebuilding' });
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
};

export default devRoutes;
