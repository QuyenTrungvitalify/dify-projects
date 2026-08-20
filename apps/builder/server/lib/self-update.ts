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
 * wedging in a merge the user can't resolve from the UI, and the pull is pinned to `origin main`
 * (the release branch) so a stray local branch can't silently update from somewhere else.
 *
 * Branch handling: update ONLY on `main`. On any other branch (or detached HEAD) this REFUSES with
 * step:'branch' and changes nothing.
 *
 * It used to `git checkout main` first. That succeeds silently on a clean tree, which meant anyone who
 * had checked out a branch to try it got moved back, rebuilt main, and tested main — with nothing on
 * screen to say so. The conclusions drawn from such a session are worthless, and there is no way to
 * tell afterwards that it happened. Silently discarding what the user chose is the failure; auto-healing
 * a stray branch is not worth it, because a refusal is VISIBLE and a switch is not. (spec 099 principle:
 * nothing that is thrown away may be thrown away silently.)
 *
 * A user on `main` — every ordinary run — sees no difference whatsoever.
 *
 * The old step:'checkout' is gone; it reported a failing checkout (usually "local changes would be
 * overwritten", i.e. the user
 * edited files). We deliberately do NOT pre-scan for local edits: edits that don't collide with the
 * update are none of our business, git decides.
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
  /** which step stopped us (absent on success): 'branch' → HEAD is not main so nothing was done,
   *  'pull' → git, 'setup' → install/build */
  step?: 'branch' | 'pull' | 'setup';
  /** 'branch' → the branch name, so the UI can name it. Otherwise the last ~20 output lines of the
   *  failed step (for the FE detail line / admin triage). */
  tail: string;
}

/** Pull (main only), then install+build (scripts/setup-node.sh builds BOTH server and web). Stops at
 *  the first failure — the caller must NOT restart unless ok. */
export async function runUpdate(repoDir: string, log: FastifyBaseLogger, runStep: RunStep = realRunStep): Promise<UpdateResult> {
  const branch = await runStep('git', ['rev-parse', '--abbrev-ref', 'HEAD'], repoDir);
  const current = branch.ok ? branch.out.trim() : '';
  if (current !== 'main') {
    // Refuse, do not switch. Nothing has run yet at this point, so returning here leaves the checkout
    // exactly as the user left it — which is the whole purpose of this branch.
    log.warn({ branch: current }, 'self-update: not on main — refusing to update (checkout left untouched)');
    return { ok: false, step: 'branch', tail: current || '(detached HEAD)' };
  }
  log.info('self-update: git pull --ff-only origin main…');
  const pull = await runStep('git', ['pull', '--ff-only', 'origin', 'main'], repoDir);
  if (!pull.ok) return { ok: false, step: 'pull', tail: tail(pull.out) };
  log.info('self-update: scripts/setup-node.sh (install + build server/web)…');
  const setup = await runStep('bash', ['scripts/setup-node.sh'], repoDir);
  if (!setup.ok) return { ok: false, step: 'setup', tail: tail(setup.out) };
  return { ok: true, tail: '' };
}
