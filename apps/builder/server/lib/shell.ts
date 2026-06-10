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

function runExec(file: string, args: string[], cwd: string): Promise<ShellResult> {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
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

/** Run `${projectsDir}/.venv/bin/python <args>` (cwd = projectsDir). */
export function runPython(projectsDir: string, args: string[]): Promise<ShellResult> {
  return runExec(join(projectsDir, '.venv/bin/python'), args, projectsDir);
}

/** Run `git <args>` (cwd = projectsDir). */
export function runGit(projectsDir: string, args: string[]): Promise<ShellResult> {
  return runExec('git', args, projectsDir);
}
