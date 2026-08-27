/**
 * A turn may read inside this repo, and nowhere else.
 *
 * The gate's read protection was a DENY-list — `.env`/`.ssh`/`.aws`/credentials — so everything NOT on
 * it was readable anywhere on the machine. Measured on the real hook before this change:
 *
 *   cat /etc/passwd                        → allow
 *   cat /Users/<me>/Documents/notes.txt    → allow
 *   ls -R /Users/<me>                      → allow
 *
 * That is an exfil channel, not a theoretical gap: a turn MAY write `projects/` (pathIsProtectedWrite
 * permits it) and the build IMPORTS that file into Dify. read-anything → write-workflow → import moves
 * data off the machine without ever touching the `curl`/`wget` bans. The WRITE side has been
 * repo-scoped since spec 018; the read side never was. This closes the asymmetry.
 *
 * Nothing legitimate is lost: across runs 1784263317775 / 1784265851924 / 1784267358546 the phases
 * touched only .claude, .runs, apps, docs, projects, skills, templates, tools — all in-repo.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeBashCommand, checkForbiddenPath } from '../server/hooks/permission-gate.js';

// A turn runs at cwd = repo root, so the gate's default `process.cwd()` IS the root there. The test
// runner's cwd is apps/builder, so pass the root explicitly — otherwise this file would assert against
// a boundary the product never has (and the first draft did: it "failed" on paths that are really fine).
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const bash = (command: string): string | null => checkForbiddenPath('Bash', { command }, undefined, REPO);

describe('reads outside the repo are refused', () => {
  test('the three the gate used to wave through', () => {
    for (const cmd of ['cat /etc/passwd', 'ls -R /Users/someone', 'cat /Users/someone/Documents/notes.txt']) {
      assert.match(bash(cmd) ?? '', /outside the repo/, `${cmd} must not be readable`);
    }
  });

  test('a dot-dot climb is refused (resolve collapses it before the test)', () => {
    assert.match(bash('cat ../../secrets.txt') ?? '', /outside the repo/);
    assert.match(bash('cat projects/../../../etc/passwd') ?? '', /outside the repo/);
  });

  test('a SYMLINK out is refused — the case path-math alone cannot see', () => {
    // vendor/dify-src → ../../dify-workspace: 8.5 GB of Dify source, lexically "inside", really outside.
    // A first cut skipped relative tokens to save a syscall and let exactly this through.
    assert.match(bash('ls vendor/dify-src') ?? '', /outside the repo/);
    assert.match(bash('cat vendor/dify-src/AGENTS.md') ?? '', /outside the repo/);
  });

  test('the Read tool is scoped too — Bash is not the only way to read a file', () => {
    assert.match(checkForbiddenPath('Read', { file_path: '/etc/passwd' }, undefined, REPO) ?? '', /outside the repo/);
    assert.equal(checkForbiddenPath('Read', { file_path: 'AGENTS.md' }, undefined, REPO), null);
  });

  test('Grep/Glob search roots are scoped', () => {
    assert.match(
      checkForbiddenPath('Grep', { pattern: 'x', path: '/Users/someone' }, undefined, REPO) ?? '',
      /outside the repo/
    );
    assert.equal(checkForbiddenPath('Grep', { pattern: 'x', path: 'templates' }, undefined, REPO), null);
  });
});

describe('everything the phases really run still runs', () => {
  // Verbatim from the three measured runs' transcripts. A false positive here breaks every build.
  const REAL = [
    '.venv/bin/python tools/dify_base/find.py --has trigger --has llm --has http-request',
    '.venv/bin/python skills/mango-svip/scripts/generate_id.py 9',
    '.venv/bin/python tools/dify_base/validate_workflow.py projects/_drafts/x/workflows/main.yml',
    '.venv/bin/python tools/dify_base/lint_refs.py projects/_drafts/x/workflows/main.yml',
    '.venv/bin/python tools/dify_base/lint_node_bodies.py --list-coverage',
    'ls tools/dify_base/find.py .venv/bin/python',
    'cat AGENTS.md',
    'wc -l skills/mango-svip/references/node_types.md',
    // Absolute paths pointing INTO the repo must stay allowed. Built from REPO, never typed out: a
    // hardcoded author path passes only on the machine it was written on and refuses everywhere else
    // (CI runners, every other clone), which is a green suite that proves nothing.
    `ls -la ${REPO}`,
    `ls -R ${join(REPO, 'templates')}`,
    'ls schemas/_latest.json', // an in-repo symlink — must stay fine
  ];
  for (const cmd of REAL) {
    test(`allows: ${cmd.slice(0, 56)}`, () => {
      assert.equal(bash(cmd), null, 'no forbidden-path reason');
      assert.equal(analyzeBashCommand(cmd).decision, 'allow', 'and the analyzer still allows it');
    });
  }

  test('a flag or bare word is never mistaken for an escaping path', () => {
    // Tokens resolve UNDER the root, so `-la`/`--has`/`9` are inside by construction — no special-casing.
    for (const cmd of ['ls -la', 'head -50 AGENTS.md', 'echo hello', 'wc -l AGENTS.md']) {
      assert.equal(bash(cmd), null, cmd);
    }
  });
});

describe('.venv is exempt from the symlink half — and cannot be used as a springboard', () => {
  test('the interpreter symlinks OUT by design (uv), so the exemption is load-bearing', () => {
    // .venv/bin/python → ~/.local/share/uv/python/…: realpath says "outside". Without the exemption
    // every `.venv/bin/python <script>` — i.e. every build — would be denied.
    assert.equal(bash('.venv/bin/python tools/dify_base/find.py --has llm'), null);
    assert.equal(bash('ls .venv/bin/python'), null);
  });

  test('but the exemption is LEXICAL: climbing out of .venv is still caught', () => {
    assert.match(bash('cat .venv/bin/../../../../etc/passwd') ?? '', /outside the repo/);
    assert.match(bash('cat .venv/../../../etc/passwd') ?? '', /outside the repo/);
  });

  test('and it grants no new power: what may RUN through it is still the 6 pinned scripts', () => {
    assert.equal(analyzeBashCommand('.venv/bin/python -c print(1)').decision, 'deny');
    assert.equal(analyzeBashCommand('.venv/bin/python tools/dify_base/sync.py list').decision, 'deny');
  });
});

describe('the older guarantees are untouched', () => {
  test('secrets stay denied — the deny-list layer runs first and independently', () => {
    assert.match(bash('cat apps/builder/.env') ?? '', /secret path/);
    assert.match(bash('cat projects/x/envs/dev.env') ?? '', /secret path/);
  });

  test('writes stay repo-scoped and allowlisted', () => {
    assert.match(checkForbiddenPath('Write', { file_path: '/etc/hosts' }, undefined, REPO) ?? '', /protected path/);
    assert.match(
      checkForbiddenPath('Write', { file_path: 'tools/dify_base/find.py' }, undefined, REPO) ?? '',
      /protected path/
    );
    assert.equal(checkForbiddenPath('Write', { file_path: 'projects/p/w/workflows/main.yml' }, undefined, REPO), null);
  });
});
