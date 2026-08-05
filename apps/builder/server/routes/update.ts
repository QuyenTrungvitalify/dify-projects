/**
 * update.ts — POST /api/update: the user-facing update & restart (see lib/self-update.ts). Registered
 * for EVERY run from index.ts (unlike routes/dev.ts, which is BUILDER_DEV-only): this is how bản-sạch
 * users pull new code without a terminal. Guards:
 *  - 409 while ANY turn is live (either lane) — the restart would kill the running `claude` child.
 *  - 409 while another update is already in flight (double-click / second tab).
 *  - a failed pull/build returns HTTP 200 `{ok:false, step, log}` (not an HTTP error) so the FE can
 *    show the step + tail without ApiError-throwing; the server keeps running untouched.
 * The global onRequest hook Origin-checks the POST; the bind is 127.0.0.1. Fixed commands, no input.
 */
import type { FastifyPluginAsync } from 'fastify';
import { buildTurnBusy, chatTurnBusy } from '../lib/lock.js';
import { scheduleRestart } from '../lib/dev-rebuild.js';
import { runUpdate, type RunStep } from '../lib/self-update.js';

export interface UpdateRoutesOpts {
  repoDir: string; // repo root — where `git pull` + scripts/setup-node.sh run
  builderDir: string; // apps/builder — passed to the spec-059 restarter
  port: number; // the bind port the restarter waits to free
  /** test seams — the real impls run git/npm and kill the process */
  runStep?: RunStep;
  schedule?: typeof scheduleRestart;
  busy?: () => boolean;
}

const updateRoutes: FastifyPluginAsync<UpdateRoutesOpts> = async (app, opts) => {
  const busy = opts.busy ?? ((): boolean => buildTurnBusy() || chatTurnBusy());
  const schedule = opts.schedule ?? scheduleRestart;
  let inFlight = false; // per-process: one update at a time (the steps are minutes-long)

  app.post('/api/update', async (_req, reply) => {
    if (busy()) {
      return reply.code(409).send({ ok: false, reason: 'turn_running' });
    }
    if (inFlight) {
      return reply.code(409).send({ ok: false, reason: 'update_running' });
    }
    inFlight = true;
    try {
      const res = await runUpdate(opts.repoDir, app.log, opts.runStep);
      if (!res.ok) {
        // 200 + ok:false so the FE reads {step, log} without throwing; the old server keeps serving.
        return reply.send({ ok: false, step: res.step, log: res.tail });
      }
      // Pull + build are clean → schedule the detached kill+restart (spec 059 restarter) and tell the
      // FE to poll /health for the down→up blip, then hard-reload onto the fresh bundle.
      schedule(opts.builderDir, opts.port, app.log);
      return reply.send({ ok: true, restarting: true });
    } finally {
      inFlight = false;
    }
  });
};

export default updateRoutes;
