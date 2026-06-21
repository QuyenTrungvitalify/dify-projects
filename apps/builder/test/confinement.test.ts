/**
 * 013 D3 — confinementCheck baseline-delta + REVERT (the M-effort other half of T5, deferred by
 * spec 011 — porcelain.test.ts only covered the pure parsePorcelainPath). Over a REAL throwaway git
 * repo this proves the security-critical AC #23 behavior end-to-end:
 *   • a turn-introduced write OUTSIDE the whitelist is REVERTED (untracked → git clean; tracked-
 *     modified → git checkout) and reported as a breach;
 *   • baseline-dirty work (already dirty before the turn) is NEVER touched;
 *   • whitelisted writes (projects/<slug>/, the task's .runs dirs, .vscode/settings.json) survive.
 *
 * Needs `git` + a per-test tmp repo (spec 013 Q5 — confirmed acceptable on the CI builder runner).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { confinementCheck, gitDirtyPaths } from '../server/lib/post-turn.js';
import type { SessionLogger } from '../server/lib/claude-session.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;
const SLUG = 'wf_conf';
const TASK = '1700000000001';

const git = (dir: string, args: string[]): void => {
  execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
};

/** Write a file (creating parent dirs) relative to the repo root. */
const put = (dir: string, rel: string, content: string): void => {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
};

/**
 * A throwaway git repo with a committed skeleton. The skeleton dirs are TRACKED (via .gitkeep) so
 * `git status --porcelain` reports later writes at the granularity the whitelist expects (untracked
 * dirs would otherwise collapse, e.g. `?? .vscode/` instead of `?? .vscode/settings.json`).
 */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'confinement-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  put(dir, 'tracked.txt', 'v1\n'); // a committed file we later modify out-of-confinement
  put(dir, '.vscode/.gitkeep', '');
  put(dir, `projects/${SLUG}/.gitkeep`, '');
  put(dir, `apps/builder/.runs/${TASK}/.gitkeep`, '');
  put(dir, `.runs/${TASK}/.gitkeep`, '');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'skeleton']);
  return dir;
}

describe('confinementCheck (013 D3 — T5 revert half)', () => {
  test('reverts out-of-confinement writes; leaves baseline-dirty + whitelisted untouched', async () => {
    const dir = makeRepo();

    // Baseline-dirty work that PRE-DATES the turn (already dirty when the turn starts).
    put(dir, 'baseline-dirty.txt', 'pre-existing\n');
    const baseline = await gitDirtyPaths(dir);
    assert.ok(baseline.has('baseline-dirty.txt'), 'baseline captured the pre-existing dirty file');

    // The "turn" now writes: two BREACHES (a new root file + a modified tracked file) and several
    // WHITELISTED paths.
    put(dir, 'evil.txt', 'escaped the confinement\n'); // breach (untracked, outside whitelist)
    writeFileSync(join(dir, 'tracked.txt'), 'v2 (tampered)\n'); // breach (tracked-modified)
    put(dir, `projects/${SLUG}/workflows/main.yml`, 'workflow: {}\n'); // whitelisted
    put(dir, `apps/builder/.runs/${TASK}/task.json`, '{}'); // whitelisted
    put(dir, `.runs/${TASK}/scratch.txt`, 'shorthand run dir\n'); // whitelisted
    put(dir, '.vscode/settings.json', '{}'); // whitelisted (exact-path)

    const reasons = await confinementCheck({ projectsDir: dir, slug: SLUG, taskId: TASK, baseline, log });

    // Exactly the two breaches reverted, each reported.
    assert.equal(reasons.length, 2, 'two breaches reported');
    assert.ok(reasons.every((r) => r.startsWith('confinement breach (reverted):')));
    assert.ok(reasons.some((r) => r.includes('evil.txt')));
    assert.ok(reasons.some((r) => r.includes('tracked.txt')));

    // Breaches reverted: the untracked one is gone, the tracked one is restored to its committed state.
    assert.equal(existsSync(join(dir, 'evil.txt')), false, 'untracked breach removed (git clean)');
    assert.equal(readFileSync(join(dir, 'tracked.txt'), 'utf8'), 'v1\n', 'tracked breach restored (git checkout)');

    // Baseline-dirty work is NEVER touched.
    assert.equal(existsSync(join(dir, 'baseline-dirty.txt')), true);
    assert.equal(readFileSync(join(dir, 'baseline-dirty.txt'), 'utf8'), 'pre-existing\n');

    // Every whitelisted write survives.
    assert.ok(existsSync(join(dir, `projects/${SLUG}/workflows/main.yml`)), 'projects/<slug>/ kept');
    assert.ok(existsSync(join(dir, `apps/builder/.runs/${TASK}/task.json`)), 'canonical .runs kept');
    assert.ok(existsSync(join(dir, `.runs/${TASK}/scratch.txt`)), 'shorthand .runs kept');
    assert.ok(existsSync(join(dir, '.vscode/settings.json')), '.vscode/settings.json kept');
  });

  test('no breaches → no reverts, empty reasons (a fully in-confinement turn)', async () => {
    const dir = makeRepo();
    const baseline = await gitDirtyPaths(dir);
    put(dir, `projects/${SLUG}/workflows/main.yml`, 'workflow: {}\n');
    put(dir, `apps/builder/.runs/${TASK}/report.json`, '{}');

    const reasons = await confinementCheck({ projectsDir: dir, slug: SLUG, taskId: TASK, baseline, log });

    assert.deepEqual(reasons, []);
    assert.ok(existsSync(join(dir, `projects/${SLUG}/workflows/main.yml`)));
  });

  test('slug=null (pre-scaffold ①/②) → any write under projects/ is a breach', async () => {
    const dir = makeRepo();
    const baseline = await gitDirtyPaths(dir);
    put(dir, `projects/${SLUG}/leaked.yml`, 'should not exist before scaffold\n');

    const reasons = await confinementCheck({ projectsDir: dir, slug: null, taskId: TASK, baseline, log });

    assert.equal(reasons.length, 1);
    assert.ok(reasons[0].includes(`projects/${SLUG}/`), 'projects/ write flagged when no slug is active');
    assert.equal(existsSync(join(dir, `projects/${SLUG}/leaked.yml`)), false, 'reverted');
  });
});
