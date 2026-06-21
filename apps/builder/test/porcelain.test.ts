/**
 * T5 (pure half) — parsePorcelainPath: extract the repo-relative path from one `git status
 * --porcelain` v1 line. Renames resolve to the NEW path; git-quoted paths are unquoted; spaces
 * inside filenames survive. This feeds the confinement baseline-delta, so a parse miss = a
 * whitelisted path wrongly flagged (or a breach wrongly cleared).
 *
 * The full baseline-delta + revert path (confinementCheck over a temp git repo) is the M-effort
 * other half of T5 — tracked as a follow-up; this covers the pure parser exhaustively.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parsePorcelainPath } from '../server/lib/post-turn.js';

describe('parsePorcelainPath', () => {
  test('modified / added / untracked → the path after the XY status + space', () => {
    assert.equal(parsePorcelainPath(' M projects/foo/main.yml'), 'projects/foo/main.yml');
    assert.equal(parsePorcelainPath('A  apps/builder/.runs/123/task.json'), 'apps/builder/.runs/123/task.json');
    assert.equal(parsePorcelainPath('?? projects/bar/new.yml'), 'projects/bar/new.yml');
  });

  test('rename → resolves to the NEW path (after " -> ")', () => {
    assert.equal(parsePorcelainPath('R  projects/old.yml -> projects/new.yml'), 'projects/new.yml');
  });

  test('git-quoted special-char path → surrounding quotes stripped', () => {
    assert.equal(parsePorcelainPath('?? "projects/wéird.yml"'), 'projects/wéird.yml');
  });

  test('spaces inside the filename are preserved', () => {
    assert.equal(parsePorcelainPath(' M projects/my file.yml'), 'projects/my file.yml');
  });

  test('too-short / empty line → null (no spurious path)', () => {
    assert.equal(parsePorcelainPath(''), null);
    assert.equal(parsePorcelainPath('M'), null);
  });
});
