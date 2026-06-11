/**
 * shell — repo-tool runner for spec 009 Lát 1.
 *
 * Runs the repo's pinned interpreter `${DIFY_PROJECTS_DIR}/.venv/bin/python <args>` and `git`
 * with cwd = DIFY_PROJECTS_DIR, capturing { code, stdout, stderr }. Always uses execFile with an
 * argv array — NEVER a shell string — so a malicious slug/path can't inject shell metacharacters.
 */
import { execFile } from 'node:child_process';
import { join } from 'node:path';

export interface ShellResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runExec(file: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<ShellResult> {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, env, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      // execFile sets err.code to the numeric exit code on a non-zero exit; a string code
      // (e.g. 'ENOENT') means the spawn itself failed → treat as exit 1.
      const e = err as (Error & { code?: number | string }) | null;
      const code = e ? (typeof e.code === 'number' ? e.code : 1) : 0;
      resolve({
        code,
        stdout: stdout?.toString() ?? '',
        stderr: stderr?.toString() ?? '',
      });
    });
  });
}

/** Run `${projectsDir}/.venv/bin/python <args>` (cwd = projectsDir). Strips `DIFY_*` from the child
 *  env: the linters / `init_project.py` never need the Dify token, and the §F/§J contract is that the
 *  token enters ONLY the `sync.py` subprocess (dify-io's `runSyncPy` injects it there itself). */
export function runPython(projectsDir: string, args: string[]): Promise<ShellResult> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('DIFY_')) delete env[k];
  return runExec(join(projectsDir, '.venv/bin/python'), args, projectsDir, env);
}

/** Run `git <args>` (cwd = projectsDir). */
export function runGit(projectsDir: string, args: string[]): Promise<ShellResult> {
  return runExec('git', args, projectsDir);
}
