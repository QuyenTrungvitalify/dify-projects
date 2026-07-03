/**
 * 013 D3 + spec 030 §2 — confinementCheck baseline-delta + REVERT, now confined to the WORKFLOW
 * subtree `projects/<project>/<workflowSlug>/`. Over a REAL throwaway git repo this proves the
 * security-critical AC #23 behavior end-to-end:
 *   • a turn-introduced write OUTSIDE the whitelist is REVERTED (untracked → git clean; tracked-
 *     modified → git checkout) and reported as a breach;
 *   • a SIBLING workflow (same project) and a SIBLING project are reverted — nesting makes them
 *     disjoint subtrees, so the trailing-slash prefix rejects them by construction (§2);
 *   • baseline-dirty work (already dirty before the turn) is NEVER touched;
 *   • whitelisted writes (the workflow subtree, the task's .runs dirs, .vscode/settings.json) survive.
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
const PROJECT = 'my_app';
const WF = 'summarizer';
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
  put(dir, `projects/${PROJECT}/${WF}/.gitkeep`, ''); // the confined workflow subtree
  put(dir, `projects/${PROJECT}/${WF}_2/.gitkeep`, ''); // a PREFIX-sibling workflow (summarizer_2)
  put(dir, `projects/${PROJECT}/other/.gitkeep`, ''); // a SIBLING workflow in the same project
  put(dir, `projects/other/${WF}/.gitkeep`, ''); // a SIBLING project
  put(dir, `apps/builder/.runs/${TASK}/.gitkeep`, '');
  put(dir, `.runs/${TASK}/.gitkeep`, '');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'skeleton']);
  return dir;
}

describe('confinementCheck (013 D3 + spec 030 §2 — per-workflow subtree)', () => {
  test('reverts out-of-confinement writes; leaves baseline-dirty + whitelisted untouched', async () => {
    const dir = makeRepo();

    // Baseline-dirty work that PRE-DATES the turn (already dirty when the turn starts).
    put(dir, 'baseline-dirty.txt', 'pre-existing\n');
    const baseline = await gitDirtyPaths(dir);
    assert.ok(baseline.has('baseline-dirty.txt'), 'baseline captured the pre-existing dirty file');

    // The "turn" now writes: several BREACHES and several WHITELISTED paths.
    put(dir, 'evil.txt', 'escaped the confinement\n'); // breach (untracked, outside whitelist)
    writeFileSync(join(dir, 'tracked.txt'), 'v2 (tampered)\n'); // breach (tracked-modified)
    put(dir, `projects/${PROJECT}/other/main.yml`, 'sibling workflow\n'); // breach (sibling workflow)
    put(dir, `projects/other/${WF}/main.yml`, 'sibling project\n'); // breach (sibling project)
    put(dir, `projects/${PROJECT}/${WF}/workflows/main.yml`, 'workflow: {}\n'); // whitelisted
    put(dir, `apps/builder/.runs/${TASK}/task.json`, '{}'); // whitelisted
    put(dir, `.runs/${TASK}/scratch.txt`, 'shorthand run dir\n'); // whitelisted
    put(dir, '.vscode/settings.json', '{}'); // whitelisted (exact-path)

    const reasons = await confinementCheck({ projectsDir: dir, project: PROJECT, workflowSlug: WF, taskId: TASK, baseline, log });

    // Exactly the four breaches reverted, each reported.
    assert.equal(reasons.length, 4, 'four breaches reported');
    assert.ok(reasons.every((r) => r.startsWith('confinement breach (reverted):')));
    assert.ok(reasons.some((r) => r.includes('evil.txt')));
    assert.ok(reasons.some((r) => r.includes('tracked.txt')));
    assert.ok(reasons.some((r) => r.includes(`projects/${PROJECT}/other/main.yml`)), 'sibling workflow flagged');
    assert.ok(reasons.some((r) => r.includes(`projects/other/${WF}/main.yml`)), 'sibling project flagged');

    // Breaches reverted.
    assert.equal(existsSync(join(dir, 'evil.txt')), false, 'untracked breach removed (git clean)');
    assert.equal(readFileSync(join(dir, 'tracked.txt'), 'utf8'), 'v1\n', 'tracked breach restored (git checkout)');
    assert.equal(existsSync(join(dir, `projects/${PROJECT}/other/main.yml`)), false, 'sibling workflow reverted');
    assert.equal(existsSync(join(dir, `projects/other/${WF}/main.yml`)), false, 'sibling project reverted');

    // Baseline-dirty work is NEVER touched.
    assert.equal(existsSync(join(dir, 'baseline-dirty.txt')), true);
    assert.equal(readFileSync(join(dir, 'baseline-dirty.txt'), 'utf8'), 'pre-existing\n');

    // Every whitelisted write survives.
    assert.ok(existsSync(join(dir, `projects/${PROJECT}/${WF}/workflows/main.yml`)), 'workflow subtree kept');
    assert.ok(existsSync(join(dir, `apps/builder/.runs/${TASK}/task.json`)), 'canonical .runs kept');
    assert.ok(existsSync(join(dir, `.runs/${TASK}/scratch.txt`)), 'shorthand .runs kept');
    assert.ok(existsSync(join(dir, '.vscode/settings.json')), '.vscode/settings.json kept');
  });

  test('a prefix-of-sibling workflow name is NOT whitelisted (trailing-slash anchor)', async () => {
    const dir = makeRepo();
    const baseline = await gitDirtyPaths(dir);
    // `summarizer_2` starts with `summarizer` but the trailing `/` anchor rejects it.
    put(dir, `projects/${PROJECT}/${WF}_2/main.yml`, 'prefix sibling\n');

    const reasons = await confinementCheck({ projectsDir: dir, project: PROJECT, workflowSlug: WF, taskId: TASK, baseline, log });

    assert.equal(reasons.length, 1);
    assert.ok(reasons[0].includes(`${WF}_2/main.yml`), 'prefix-sibling flagged');
    assert.equal(existsSync(join(dir, `projects/${PROJECT}/${WF}_2/main.yml`)), false, 'reverted');
  });

  test('no breaches → no reverts, empty reasons (a fully in-confinement turn)', async () => {
    const dir = makeRepo();
    const baseline = await gitDirtyPaths(dir);
    put(dir, `projects/${PROJECT}/${WF}/workflows/main.yml`, 'workflow: {}\n');
    put(dir, `apps/builder/.runs/${TASK}/report.json`, '{}');

    const reasons = await confinementCheck({ projectsDir: dir, project: PROJECT, workflowSlug: WF, taskId: TASK, baseline, log });

    assert.deepEqual(reasons, []);
    assert.ok(existsSync(join(dir, `projects/${PROJECT}/${WF}/workflows/main.yml`)));
  });

  test('project/workflowSlug=null (pre-scaffold ①/②) → any write under projects/ is a breach', async () => {
    const dir = makeRepo();
    const baseline = await gitDirtyPaths(dir);
    put(dir, `projects/${PROJECT}/${WF}/leaked.yml`, 'should not exist before scaffold\n');

    const reasons = await confinementCheck({ projectsDir: dir, project: null, workflowSlug: null, taskId: TASK, baseline, log });

    assert.equal(reasons.length, 1);
    assert.ok(reasons[0].includes(`projects/${PROJECT}/${WF}/`), 'projects/ write flagged when unscaffolded');
    assert.equal(existsSync(join(dir, `projects/${PROJECT}/${WF}/leaked.yml`)), false, 'reverted');
  });
});
