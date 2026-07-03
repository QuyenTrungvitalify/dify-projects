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

  test('a shell-metachar path stays a single argv element (no injection surface)', () => {
    const evil = '/tmp/a b; rm -rf ~/`whoami`.yml';
    const { cmd, args } = revealCommand('darwin', evil);
    assert.equal(cmd, 'open');
    assert.deepEqual(args, ['-R', evil]); // one element — never split/interpreted by a shell
  });
});
