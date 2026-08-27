/**
 * 013 D3 + spec 030 §2 + spec 040 D1 — confinementCheck baseline-delta + REVERT, confined to the
 * WORKFLOW subtree `projects/<project>/<workflowSlug>/`. Over a REAL throwaway git repo this proves the
 * security-critical AC #23 behavior end-to-end:
 *   • a turn-introduced write to a SIBLING workflow (same project) or a SIBLING project — both under
 *     `projects/`, the class the PreToolUse hook blanket-allows and defers here — is REVERTED (untracked
 *     → git clean; tracked-modified → git checkout) and reported as a breach;
 *   • spec 040 D1: a turn-delta path OUTSIDE `projects/` (root files, docs/, templates/, a sibling
 *     `.runs/`) is IGNORED — it is hook-denied pre-execution, so a dirty one is a CONCURRENT external
 *     edit, and reverting it would destroy unrelated work + fail an innocent build. Root-write defense
 *     lives entirely in the hook now (see permission-gate.test.ts).
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
  test('reverts projects/ cross-scope writes; ignores out-of-projects/ dirt; leaves baseline + whitelisted untouched', async () => {
    const dir = makeRepo();

    // Baseline-dirty work that PRE-DATES the turn (already dirty when the turn starts).
    put(dir, 'baseline-dirty.txt', 'pre-existing\n');
    const baseline = await gitDirtyPaths(dir);
    assert.ok(baseline.has('baseline-dirty.txt'), 'baseline captured the pre-existing dirty file');

    // The "turn" delta now includes: the two BREACHES the hook defers here (projects/ cross-scope),
    // several out-of-projects/ paths that spec 040 D1 IGNORES (hook-denied → concurrent external), and
    // several WHITELISTED paths.
    put(dir, `projects/${PROJECT}/other/main.yml`, 'sibling workflow\n'); // breach (sibling workflow)
    put(dir, `projects/other/${WF}/main.yml`, 'sibling project\n'); // breach (sibling project)
    // ── spec 040 D1: out-of-projects/ dirt = concurrent external edit → ignored, NOT reverted ──
    put(dir, 'evil.txt', 'concurrent external edit\n'); // ignored (untracked, root)
    writeFileSync(join(dir, 'tracked.txt'), 'v2 (concurrent)\n'); // ignored (tracked-modified, root)
    put(dir, 'INDEX.md', 'concurrent index rebuild\n'); // ignored (root)
    put(dir, 'docs/specs/x-fp-report.md', 'concurrent spec work\n'); // ignored (docs/)
    put(dir, 'apps/builder/.runs/9999999999999/task.json', '{}'); // ignored (SIBLING .runs — hook-denied)
    // ── whitelisted ──
    put(dir, `projects/${PROJECT}/${WF}/workflows/main.yml`, 'workflow: {}\n'); // whitelisted
    put(dir, `apps/builder/.runs/${TASK}/task.json`, '{}'); // whitelisted
    put(dir, `.runs/${TASK}/scratch.txt`, 'shorthand run dir\n'); // whitelisted
    put(dir, '.vscode/settings.json', '{}'); // whitelisted (exact-path)

    const { breaches: reasons } = await confinementCheck({ projectsDir: dir, project: PROJECT, workflowSlug: WF, taskId: TASK, baseline, log });

    // EXACTLY the two projects/ cross-scope breaches reverted, each reported. No root/docs/sibling-.runs breach.
    assert.equal(reasons.length, 2, 'two breaches reported (projects/ cross-scope only)');
    assert.ok(reasons.every((r) => r.startsWith('confinement breach (reverted):')));
    assert.ok(reasons.some((r) => r.includes(`projects/${PROJECT}/other/main.yml`)), 'sibling workflow flagged');
    assert.ok(reasons.some((r) => r.includes(`projects/other/${WF}/main.yml`)), 'sibling project flagged');
    assert.ok(!reasons.some((r) => /evil\.txt|tracked\.txt|INDEX\.md|docs\/|9999999999999/.test(r)), 'no out-of-projects/ breach');

    // The projects/ breaches were reverted.
    assert.equal(existsSync(join(dir, `projects/${PROJECT}/other/main.yml`)), false, 'sibling workflow reverted');
    assert.equal(existsSync(join(dir, `projects/other/${WF}/main.yml`)), false, 'sibling project reverted');

    // spec 040 D1: out-of-projects/ dirt is NEVER touched (would be concurrent external work).
    assert.equal(existsSync(join(dir, 'evil.txt')), true, 'root untracked ignored (not git clean-ed)');
    assert.equal(readFileSync(join(dir, 'tracked.txt'), 'utf8'), 'v2 (concurrent)\n', 'root tracked-modified NOT reverted');
    assert.equal(existsSync(join(dir, 'INDEX.md')), true, 'root INDEX.md ignored');
    assert.equal(existsSync(join(dir, 'docs/specs/x-fp-report.md')), true, 'docs/ ignored');
    assert.equal(existsSync(join(dir, 'apps/builder/.runs/9999999999999/task.json')), true, 'sibling .runs ignored (concurrent build state)');

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

    const { breaches: reasons } = await confinementCheck({ projectsDir: dir, project: PROJECT, workflowSlug: WF, taskId: TASK, baseline, log });

    assert.equal(reasons.length, 1);
    assert.ok(reasons[0].includes(`${WF}_2/main.yml`), 'prefix-sibling flagged');
    assert.equal(existsSync(join(dir, `projects/${PROJECT}/${WF}_2/main.yml`)), false, 'reverted');
  });

  test('no breaches → no reverts, empty reasons (a fully in-confinement turn)', async () => {
    const dir = makeRepo();
    const baseline = await gitDirtyPaths(dir);
    put(dir, `projects/${PROJECT}/${WF}/workflows/main.yml`, 'workflow: {}\n');
    put(dir, `apps/builder/.runs/${TASK}/report.json`, '{}');

    const { breaches: reasons } = await confinementCheck({ projectsDir: dir, project: PROJECT, workflowSlug: WF, taskId: TASK, baseline, log });

    assert.deepEqual(reasons, []);
    assert.ok(existsSync(join(dir, `projects/${PROJECT}/${WF}/workflows/main.yml`)));
  });

  test('project/workflowSlug=null (pre-scaffold ①/②) → any write under projects/ is a breach', async () => {
    const dir = makeRepo();
    const baseline = await gitDirtyPaths(dir);
    put(dir, `projects/${PROJECT}/${WF}/leaked.yml`, 'should not exist before scaffold\n');

    const { breaches: reasons } = await confinementCheck({ projectsDir: dir, project: null, workflowSlug: null, taskId: TASK, baseline, log });

    assert.equal(reasons.length, 1);
    assert.ok(reasons[0].includes(`projects/${PROJECT}/${WF}/`), 'projects/ write flagged when unscaffolded');
    assert.equal(existsSync(join(dir, `projects/${PROJECT}/${WF}/leaked.yml`)), false, 'reverted');
  });
  /**
   * Spec 112 — `projects/_drafts/` leaves `.gitignore`, so confinementCheck stops being a no-op there.
   *
   * The worry that has to be settled before that flip: `revertPath` ends in `git clean -fd`, which
   * DELETES untracked files, and every file under `_drafts` is untracked. Spec 111 declined to revert
   * there for exactly this reason ("revert would mean DELETE"). What makes the flip safe is the
   * baseline delta, not the whitelist: `turnTouched = after − baseline`, and porcelain prints an
   * untracked file as `?? <path>` BOTH before and after the turn — so a draft that already existed is
   * in the baseline and can never be a breach, no matter what the turn does to it.
   *
   * This test proves that property directly, because the whole flip rests on it: a NEIGHBOUR draft's
   * pre-existing file survives untouched, while a file the turn newly creates next door is reverted.
   */
  test('spec 112: un-ignored _drafts — a neighbour draft that pre-dates the turn survives; only the turn-created stray is reverted', async () => {
    const dir = makeRepo();
    const MINE = `projects/_drafts/mine`;
    const NEIGHBOUR = `projects/_drafts/neighbour`;

    // A neighbour draft that already exists — untracked, exactly as an un-ignored `_drafts` would be.
    put(dir, `${NEIGHBOUR}/workflows/main.yml`, 'the human work that must not be deleted\n');
    put(dir, `${MINE}/workflows/main.yml`, 'my draft, pre-existing\n');

    const baseline = await gitDirtyPaths(dir);
    assert.ok(baseline.has(`${NEIGHBOUR}/workflows/main.yml`), 'porcelain -uall reports the untracked neighbour into the baseline');

    // The turn: writes its own folder (whitelisted), OVERWRITES the neighbour's existing file
    // (baseline-covered → invisible, unchanged from today), and CREATES a new file next door (breach).
    put(dir, `${MINE}/workflows/main.yml`, 'my draft, edited by the turn\n');
    put(dir, `${NEIGHBOUR}/workflows/main.yml`, 'OVERWRITTEN by a stray turn\n');
    put(dir, `${NEIGHBOUR}/workflows/stray.yml`, 'created next door by the turn\n');

    const { breaches: reasons } = await confinementCheck({
      projectsDir: dir, project: '_drafts', workflowSlug: 'mine', taskId: TASK, baseline, log,
    });

    // Only the NEW path is a breach. The overwrite is not — that half of the hole stays open until the
    // drafts are actually committed, and saying so here keeps the limit honest rather than implied.
    assert.equal(reasons.length, 1, `only the turn-created path breaches: ${reasons.join(' | ')}`);
    assert.ok(reasons[0].includes(`${NEIGHBOUR}/workflows/stray.yml`), 'the stray is named');
    assert.equal(existsSync(join(dir, `${NEIGHBOUR}/workflows/stray.yml`)), false, 'turn-created stray reverted');

    // THE POINT: `git clean -fd` did not walk into the neighbour and take the rest with it.
    assert.equal(
      readFileSync(join(dir, `${NEIGHBOUR}/workflows/main.yml`), 'utf8'),
      'OVERWRITTEN by a stray turn\n',
      'the pre-existing neighbour file is baseline-covered — neither reverted nor deleted'
    );
    // And the build's own folder is untouched by the sweep.
    assert.equal(readFileSync(join(dir, `${MINE}/workflows/main.yml`), 'utf8'), 'my draft, edited by the turn\n', 'own folder kept');
  });
});
