/**
 * dev-rebuild.ts — spec 059 dev affordance, **BUILDER_DEV=1 ONLY** (the route is registered from
 * index.ts only under that flag, so a normal/prod run never exposes it). Backs the dev panel's
 * "rebuild & restart" button: rebuild server (tsc → dist) + web (vite → web/dist), then hot-swap the
 * running process for a fresh one.
 *
 * SAFETY by construction:
 *  - the build runs FIRST, while THIS server is still alive; the kill+restart is scheduled ONLY on a
 *    clean build — a broken build never leaves you without a server (you just see the error).
 *  - fixed commands, no user input (not an arbitrary-exec endpoint); the POST is Origin-checked by the
 *    global onRequest hook and the bind is 127.0.0.1.
 *  - the restart runs in a DETACHED child (scripts/dev-restart.sh) that outlives our death — the one
 *    piece a server can't do to itself.
 */
import { execFile, spawn } from 'node:child_process';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';

const tail = (s: string, n = 20): string => s.split('\n').slice(-n).join('\n');

const run = (cmd: string, args: string[], cwd: string): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => {
    execFile(cmd, args, { cwd, maxBuffer: 32 * 1024 * 1024, timeout: 10 * 60_000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout ?? ''}\n${stderr ?? ''}`.trim() });
    });
  });

/** Rebuild server then web. Returns `{ok:false, tail}` (the last ~20 log lines) on the first failure —
 *  the caller does NOT restart on a failed build. */
export async function runBuild(builderDir: string, log: FastifyBaseLogger): Promise<{ ok: boolean; tail: string }> {
  log.info('dev-rebuild: building server (tsc)…');
  const server = await run('npm', ['run', 'build'], builderDir);
  if (!server.ok) return { ok: false, tail: tail(server.out) };
  log.info('dev-rebuild: building web (vite)…');
  const web = await run('npm', ['run', 'build'], join(builderDir, 'web'));
  if (!web.ok) return { ok: false, tail: tail(web.out) };
  return { ok: true, tail: '' };
}

/**
 * Spawn the DETACHED restarter that outlives this process: it waits for the HTTP reply to flush, kills
 * THIS server (pid), waits for the port to free (SIGKILL-escalates), then execs a fresh
 * `node dist/server/index.js`. `env`/`cwd` are inherited so the new server re-reads apps/builder/.env
 * exactly like a manual `npm start`. stdio is ignored here (the script writes its own .runs log).
 */
export function scheduleRestart(builderDir: string, port: number, log: FastifyBaseLogger): void {
  const script = join(builderDir, 'scripts', 'dev-restart.sh');
  const entry = join(builderDir, 'dist', 'server', 'index.js');
  const child = spawn('bash', [script, String(process.pid), String(port), entry], {
    cwd: builderDir,
    env: process.env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  log.warn({ pid: process.pid, port }, 'dev-rebuild: restart scheduled — this server will exit and respawn');
}
