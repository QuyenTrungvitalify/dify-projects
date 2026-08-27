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

/**
 * The reveal-in-file-manager argv for a platform.
 *
 * `isDir` is not a detail — it inverts what every platform is being asked for. Revealing a FILE means
 * "show it selected inside its parent"; doing that to a folder would open the folder's parent and
 * highlight it, which is one level too high and the opposite of what a "open this task's folder" button
 * promises. The linux case is the one that would have been actively wrong: its file form opens
 * `dirname(path)`, so a directory argument would have opened the PARENT directory.
 */
export function revealCommand(platform: NodeJS.Platform, absPath: string, isDir = false): { cmd: string; args: string[] } {
  if (platform === 'win32') return { cmd: 'explorer', args: isDir ? [absPath] : [`/select,${absPath}`] };
  // No portable "reveal + select" on linux → open the containing directory (or the directory itself).
  if (platform === 'linux') return { cmd: 'xdg-open', args: [isDir ? absPath : dirname(absPath)] };
  // darwin (and default): open the folder, or reveal + select the file in Finder.
  return { cmd: 'open', args: isDir ? [absPath] : ['-R', absPath] };
}

/** Spawn the file manager to reveal `absPath`. Rejects if the launcher fails (except the Windows
 *  `explorer /select,` quirk, which exits non-zero even on success). */
export async function revealInFileManager(absPath: string, platform: NodeJS.Platform = process.platform, isDir = false): Promise<void> {
  const { cmd, args } = revealCommand(platform, absPath, isDir);
  try {
    await pExecFile(cmd, args);
  } catch (e) {
    if (platform === 'win32') return; // explorer's non-zero exit is not a real failure
    throw e;
  }
}
