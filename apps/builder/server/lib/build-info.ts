/**
 * build-info.ts — spec 062 #1. Provenance stamp for a run export: which Builder code + model produced
 * it. Without this a fleet of client exports can't correlate behavior ↔ version — a reported issue
 * can't be told apart from an already-fixed one. Written to the bundle as `build-info.json`.
 *
 * BEST-EFFORT + non-fatal: git may be absent, the repo may be a tarball with no `.git`, package.json
 * may be unreadable — every probe degrades to `null` and NEVER throws (a bundle must always assemble).
 * `git` is run read-only with a short timeout; no writes, no network.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const pexec = promisify(execFile);

export interface BuildInfo {
  /** apps/builder/package.json version (the Builder release). */
  builderVersion: string | null;
  /** current commit of the Builder repo (which code ran). */
  gitSha: string | null;
  gitBranch: string | null;
  /** node runtime that hosted the build. */
  node: string;
  /** distinct claude model ids observed across the run's phases (from task.cost[*].model). */
  models: string[];
  /** ms timestamp the bundle was assembled (stamped by the caller for testability). */
  exportedAt: number;
}

/** Collect the provenance stamp. `models` is derived by the caller from `task.cost`. Never throws. */
export async function collectBuildInfo(projectsDir: string, models: string[], nowMs: number): Promise<BuildInfo> {
  const [builderVersion, gitSha, gitBranch] = await Promise.all([
    readVersion(projectsDir),
    gitOut(projectsDir, ['rev-parse', 'HEAD']),
    gitOut(projectsDir, ['rev-parse', '--abbrev-ref', 'HEAD']),
  ]);
  return { builderVersion, gitSha, gitBranch, node: process.version, models, exportedAt: nowMs };
}

async function readVersion(projectsDir: string): Promise<string | null> {
  try {
    const raw = await readFile(join(projectsDir, 'apps/builder/package.json'), 'utf8');
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

async function gitOut(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await pexec('git', args, { cwd, timeout: 3000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
