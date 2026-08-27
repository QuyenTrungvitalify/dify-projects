/**
 * The "Reveal in Finder" argv mapping. `revealCommand` is the pure platform→argv function behind
 * POST /api/tasks/:id/reveal; testing it (no spawn) locks in that we reveal-and-select on macOS,
 * open the folder on linux (no portable select), and select on Windows — and that the file path is
 * always a single argv element (execFile, no shell → the path can't be interpreted as a command).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { revealCommand } from '../server/lib/reveal.js';

const P = '/Users/me/dify/projects/wf_1/workflows/main.yml';

describe('revealCommand', () => {
  test('darwin reveals + selects the file', () => {
    assert.deepEqual(revealCommand('darwin', P), { cmd: 'open', args: ['-R', P] });
  });

  test('linux opens the containing directory (no portable select)', () => {
    assert.deepEqual(revealCommand('linux', P), {
      cmd: 'xdg-open',
      args: ['/Users/me/dify/projects/wf_1/workflows'],
    });
  });

  test('win32 selects the file in explorer', () => {
    assert.deepEqual(revealCommand('win32', P), { cmd: 'explorer', args: [`/select,${P}`] });
  });

  // A DIRECTORY inverts what each platform is being asked for, which is why `isDir` is a parameter and
  // not something the caller can forget. "Reveal a file" means show it selected inside its parent; doing
  // that to a folder opens the folder's PARENT with the folder highlighted — one level too high, and the
  // opposite of what an "open this build's folder" button promises.
  const DIR = '/Users/me/dify/projects/_drafts/news_2';

  test('darwin OPENS a directory rather than selecting it in its parent', () => {
    assert.deepEqual(revealCommand('darwin', DIR, true), { cmd: 'open', args: [DIR] });
  });

  test('linux opens the directory ITSELF — its file form would have opened the parent', () => {
    // The one that would have been silently wrong: the file branch passes `dirname(path)`, so a
    // directory argument lands one level above the folder the button names.
    assert.deepEqual(revealCommand('linux', DIR, true), { cmd: 'xdg-open', args: [DIR] });
    assert.deepEqual(revealCommand('linux', DIR, false), { cmd: 'xdg-open', args: ['/Users/me/dify/projects/_drafts'] });
  });

  test('win32 opens the directory instead of /select,-ing it', () => {
    assert.deepEqual(revealCommand('win32', DIR, true), { cmd: 'explorer', args: [DIR] });
  });

  test('isDir defaults to false, so every existing file caller keeps its behaviour', () => {
    assert.deepEqual(revealCommand('darwin', P), revealCommand('darwin', P, false));
    assert.deepEqual(revealCommand('linux', P), revealCommand('linux', P, false));
    assert.deepEqual(revealCommand('win32', P), revealCommand('win32', P, false));
  });

  test('a shell-metachar path stays a single argv element (no injection surface)', () => {
    const evil = '/tmp/a b; rm -rf ~/`whoami`.yml';
    const { cmd, args } = revealCommand('darwin', evil);
    assert.equal(cmd, 'open');
    assert.deepEqual(args, ['-R', evil]); // one element — never split/interpreted by a shell
  });
});
