/**
 * self-update.ts — the user-facing "update & restart" (the in-app equivalent of
 * scripts/update-and-run.command, minus opening a new tab): pull the latest code, reinstall+rebuild
 * via scripts/setup-node.sh, then hand off to the spec-059 detached restarter. Mounted for EVERY run
 * (not just BUILDER_DEV) — bản-sạch users update without touching a terminal.
 *
 * SAFETY mirrors dev-rebuild: every step runs while THIS server is still alive, and the kill+restart
 * is scheduled ONLY after a clean pull+build — a failed pull/build never leaves the user serverless
 * (they just see the error). Fixed commands, no user input; Origin-checked by the global hook;
 * 127.0.0.1 bind. `--ff-only` so a dirty/diverged clone fails FAST with a message instead of
 * wedging in a merge the user can't resolve from the UI.
 */
import { execFile } from 'node:child_process';
import type { FastifyBaseLogger } from 'fastify';

const tail = (s: string, n = 20): string => s.split('\n').slice(-n).join('\n');

export type RunStep = (cmd: string, args: string[], cwd: string) => Promise<{ ok: boolean; out: string }>;

/** 15 min: `npm install` after a dependency bump can be slow on user machines (the .command has no
 *  timeout at all — this is the bounded version). */
const STEP_TIMEOUT_MS = 15 * 60_000;

export const realRunStep: RunStep = (cmd, args, cwd) =>
  new Promise((resolve) => {
    execFile(cmd, args, { cwd, maxBuffer: 32 * 1024 * 1024, timeout: STEP_TIMEOUT_MS }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout ?? ''}\n${stderr ?? ''}`.trim() });
    });
  });

export interface UpdateResult {
  ok: boolean;
  /** which step failed (absent on success): 'pull' → git, 'setup' → install/build */
  step?: 'pull' | 'setup';
  /** last ~20 output lines of the failed step (for the FE detail line / admin triage) */
  tail: string;
}

/** Pull then install+build (scripts/setup-node.sh builds BOTH server and web). Stops at the first
 *  failure — the caller must NOT restart unless ok. */
export async function runUpdate(repoDir: string, log: FastifyBaseLogger, runStep: RunStep = realRunStep): Promise<UpdateResult> {
  log.info('self-update: git pull --ff-only…');
  const pull = await runStep('git', ['pull', '--ff-only'], repoDir);
  if (!pull.ok) return { ok: false, step: 'pull', tail: tail(pull.out) };
  log.info('self-update: scripts/setup-node.sh (install + build server/web)…');
  const setup = await runStep('bash', ['scripts/setup-node.sh'], repoDir);
  if (!setup.ok) return { ok: false, step: 'setup', tail: tail(setup.out) };
  return { ok: true, tail: '' };
}
