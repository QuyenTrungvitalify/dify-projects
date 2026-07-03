/**
 * lib/reveal.ts — open the OS file manager at a given file ("Reveal in Finder").
 *
 * Local-dev convenience only: the server binds 127.0.0.1 and the caller (the SPA) is same-origin.
 * The path is always computed server-side from a task (never taken from the client), and we spawn via
 * `execFile` (NO shell) so even a hostile path is an argv element, not a command — no injection.
 *
 * `revealCommand` is a pure platform→argv mapping so it can be unit-tested without spawning anything.
 */
import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

const pExecFile = promisify(execFile);

/** The reveal-in-file-manager argv for a platform (darwin selects the file; linux opens its folder). */
export function revealCommand(platform: NodeJS.Platform, absPath: string): { cmd: string; args: string[] } {
  if (platform === 'win32') return { cmd: 'explorer', args: [`/select,${absPath}`] };
  // No portable "reveal + select" on linux → open the containing directory.
  if (platform === 'linux') return { cmd: 'xdg-open', args: [dirname(absPath)] };
  // darwin (and default): reveal + select in Finder.
  return { cmd: 'open', args: ['-R', absPath] };
}

/** Spawn the file manager to reveal `absPath`. Rejects if the launcher fails (except the Windows
 *  `explorer /select,` quirk, which exits non-zero even on success). */
export async function revealInFileManager(absPath: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  const { cmd, args } = revealCommand(platform, absPath);
  try {
    await pExecFile(cmd, args);
  } catch (e) {
    if (platform === 'win32') return; // explorer's non-zero exit is not a real failure
    throw e;
  }
}
