/**
 * Spec 103 L0 — `specChanged` / `isSpecStale`: the tripwire that says a fix round moved the workflow
 * and left `SPEC.md` behind.
 *
 * Deliberately the SIBLING of `artifact-changed.test.ts` — same repo fixture, same python shim, same
 * shape — because the two flags are one measurement taken twice, and a reader comparing them should
 * see one pattern, not two inventions.
 *
 * What each mechanism choice is pinned against:
 *
 *   - **git cannot see `SPEC.md` either.** A from-scratch build lands in `projects/_drafts/`, which the
 *     repo gitignores wholesale, so the spec never appears in `git status`. `noGitDelta` asserts that
 *     blindness directly, so "this is why it is a content hash" is a checked fact and not a comment.
 *   - **mtime would lie.** A turn that rewrites `SPEC.md` byte-identically has changed nothing, and the
 *     user must be told nothing changed. The hash gets that right; a timestamp does not.
 *   - **a missing measurement is not an all-clear.** `undefined` in ⇒ `undefined` out, never `false`.
 *     This is the direction that costs the most if it is wrong: a silent "fine" in front of real drift.
 *
 * So: rewire this to git, to mtime, or to a `?? false` and this file goes red. That is its whole job.
 *
 * Drives the REAL postTurnCheck in-process over a REAL git repo (the gitignore is load-bearing), with
 * the `.venv/bin/python` shim technique from artifact-changed.test.ts so no linter actually runs.
 */
import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  postTurnCheck, artifactHash, gitDirtyPaths, specRelFor, isSpecStale,
} from '../server/lib/post-turn.js';
import { snapshotDiffBase } from '../server/lib/diff.js';
import type { Task } from '../server/state/task.js';
import type { SessionLogger } from '../server/lib/claude-session.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;

/** `.venv/bin/python` shim: the node_ids probe answers with one valid id; every linter call exits 0. */
const SHIM = `#!/usr/bin/env bash
if [ "$1" = "-c" ]; then
  case "$2" in
    *node_ids*) printf '%s' '{"node_ids": ["1782556995650"]}'; exit 0 ;;
    *) exit 0 ;;
  esac
fi
exit 0
`;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A real git repo shaped like this one: `projects/_drafts/` ignored wholesale, plus one ordinary
 *  tracked project so the two cases can be told apart. `.gitignore` is COMMITTED so it never shows up
 *  as a turn-touched path that confinementCheck would try to revert out from under the test. */
function repo(project: string): { dir: string; ymlRel: string; specRel: string } {
  const dir = mkdtempSync(join(tmpdir(), 'spec-stale-'));
  dirs.push(dir);
  const bin = join(dir, '.venv', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'python'), SHIM, { mode: 0o755 });

  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  };
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  writeFileSync(join(dir, '.gitignore'), 'projects/_drafts/\n.venv/\n');
  git('add', '.gitignore');
  git('commit', '-qm', 'base');

  mkdirSync(join(dir, 'projects', project, 'wf', 'workflows'), { recursive: true });
  return {
    dir,
    ymlRel: `projects/${project}/wf/workflows/main.yml`,
    specRel: specRelFor(project, 'wf'),
  };
}

const YAML_A = 'workflow:\n  graph:\n    nodes: []\n';
const YAML_B = 'workflow:\n  graph:\n    nodes: []\n# edited by the turn\n';
const SPEC_A = '# Spec\n\nThreshold 0.5.\n';
const SPEC_B = '# Spec\n\nThreshold 0.2.\n';

const check = (
  dir: string,
  project: string,
  before: { yml?: string | null; spec?: string | null },
  baseline: string[] = []
) =>
  postTurnCheck({
    projectsDir: dir,
    project,
    workflowSlug: 'wf',
    workflowFile: 'main.yml',
    taskId: '1000000000001',
    baseline: new Set(baseline),
    artifactHashBefore: before.yml,
    specHashBefore: before.spec,
    log,
  });

describe('103 L0 · specChanged — the measurement', () => {
  test('calibration: git CANNOT see a _drafts SPEC.md (this is why the flag is not a git delta)', async () => {
    // Same calibration as its 094 sibling, one artifact over. If this fails, the repo stopped ignoring
    // _drafts and the reasoning in post-turn.ts needs revisiting — the hash stays correct either way.
    const { dir, specRel } = repo('_drafts');
    writeFileSync(join(dir, specRel), SPEC_A);
    const dirty = await gitDirtyPaths(dir);
    assert.equal(dirty.has(specRel), false, 'a gitignored SPEC.md must be invisible to git status');
  });

  test('a turn that REWRITES SPEC.md reads as changed', async () => {
    const { dir, ymlRel, specRel } = repo('_drafts');
    writeFileSync(join(dir, ymlRel), YAML_A);
    writeFileSync(join(dir, specRel), SPEC_A);
    const before = { yml: await artifactHash(dir, ymlRel), spec: await artifactHash(dir, specRel) };
    writeFileSync(join(dir, ymlRel), YAML_B); // the turn edits the workflow
    writeFileSync(join(dir, specRel), SPEC_B); // …and reconciles the spec (implement.md step 6)
    const r = await check(dir, '_drafts', before);
    assert.equal(r.detail.artifactChanged, true);
    assert.equal(r.detail.specChanged, true);
  });

  test('a turn that leaves SPEC.md alone reads as unchanged — the drift case', async () => {
    const { dir, ymlRel, specRel } = repo('_drafts');
    writeFileSync(join(dir, ymlRel), YAML_A);
    writeFileSync(join(dir, specRel), SPEC_A);
    const before = { yml: await artifactHash(dir, ymlRel), spec: await artifactHash(dir, specRel) };
    writeFileSync(join(dir, ymlRel), YAML_B); // workflow moves…
    const r = await check(dir, '_drafts', before); // …spec does not
    assert.equal(r.detail.artifactChanged, true);
    assert.equal(r.detail.specChanged, false);
  });

  test('a byte-identical SPEC.md rewrite is NOT a change (mtime would say otherwise)', async () => {
    const { dir, ymlRel, specRel } = repo('_drafts');
    writeFileSync(join(dir, ymlRel), YAML_A);
    writeFileSync(join(dir, specRel), SPEC_A);
    const before = { yml: await artifactHash(dir, ymlRel), spec: await artifactHash(dir, specRel) };
    writeFileSync(join(dir, ymlRel), YAML_B);
    writeFileSync(join(dir, specRel), SPEC_A); // rewritten, same bytes
    const r = await check(dir, '_drafts', before);
    // RED the moment this is wired to a timestamp: the user would be told the spec was updated when
    // nothing about it is different.
    assert.equal(r.detail.specChanged, false);
  });

  test('SPEC.md absent before, written by the turn → changed (null compares correctly)', async () => {
    const { dir, ymlRel, specRel } = repo('_drafts');
    writeFileSync(join(dir, ymlRel), YAML_A);
    const before = { yml: await artifactHash(dir, ymlRel), spec: await artifactHash(dir, specRel) };
    assert.equal(before.spec, null, 'precondition: no SPEC.md yet');
    writeFileSync(join(dir, ymlRel), YAML_B);
    writeFileSync(join(dir, specRel), SPEC_A);
    const r = await check(dir, '_drafts', before);
    assert.equal(r.detail.specChanged, true);
  });

  test('SPEC.md absent on BOTH sides → unchanged, and nothing throws', async () => {
    const { dir, ymlRel } = repo('_drafts');
    writeFileSync(join(dir, ymlRel), YAML_A);
    const r = await check(dir, '_drafts', { yml: await artifactHash(dir, ymlRel), spec: null });
    assert.equal(r.detail.specChanged, false);
  });

  test('no before-hash supplied → NOT MEASURED (undefined), never a false "unchanged"', async () => {
    const { dir, ymlRel, specRel } = repo('_drafts');
    writeFileSync(join(dir, ymlRel), YAML_A);
    writeFileSync(join(dir, specRel), SPEC_A);
    const before = { yml: await artifactHash(dir, ymlRel) }; // spec omitted → not measured
    writeFileSync(join(dir, ymlRel), YAML_B); // the turn does edit the workflow
    const r = await check(dir, '_drafts', before);
    assert.equal(r.detail.specChanged, undefined);
    assert.equal(r.detail.artifactChanged, true, 'its sibling is still measured — the two are independent');
  });

  test('a stale spec never fails the phase — advisory, per §3.4', async () => {
    const { dir, ymlRel, specRel } = repo('_drafts');
    writeFileSync(join(dir, ymlRel), YAML_A);
    writeFileSync(join(dir, specRel), SPEC_A);
    const before = { yml: await artifactHash(dir, ymlRel), spec: await artifactHash(dir, specRel) };
    writeFileSync(join(dir, ymlRel), YAML_B);
    const r = await check(dir, '_drafts', before);
    assert.equal(r.detail.specChanged, false, 'precondition: this IS the stale case');
    // Killing a lint-clean workflow over bookkeeping costs more than it protects, and a hard stop here
    // re-opens the ③ thrash spec 085 paid to close.
    assert.equal(r.ok, true);
    assert.equal(r.status, 'done');
    assert.deepEqual(r.reasons, []);
  });

  test('a TRACKED project: writing SPEC.md is not a confinement breach (it is inside the workflow subtree)', async () => {
    // The _drafts cases above cannot exercise this — git is blind there. A tracked project is where a
    // wrongly-scoped whitelist would actually revert the turn's spec edit out from under it.
    const { dir, ymlRel, specRel } = repo('acme');
    writeFileSync(join(dir, ymlRel), YAML_A);
    writeFileSync(join(dir, specRel), SPEC_A);
    const before = { yml: await artifactHash(dir, ymlRel), spec: await artifactHash(dir, specRel) };
    writeFileSync(join(dir, ymlRel), YAML_B);
    writeFileSync(join(dir, specRel), SPEC_B);
    const r = await check(dir, 'acme', before);
    assert.deepEqual(r.detail.confinementBreaches, []);
    assert.equal(existsSync(join(dir, specRel)), true);
    assert.equal(r.detail.specChanged, true, 'the edit survived — it was not reverted');
  });
});

describe('103 L0 · isSpecStale — the verdict', () => {
  test('workflow moved, spec did not → STALE', () => {
    assert.equal(isSpecStale(true, false), true);
  });

  test('workflow moved and spec moved with it → fine', () => {
    assert.equal(isSpecStale(true, true), false);
  });

  test('workflow did not move → fine, whatever the spec did', () => {
    // An empty round is 094's story, not this one. Firing here would put a warning on every round that
    // legitimately changed nothing, and a badge that cries wolf is a badge nobody reads.
    assert.equal(isSpecStale(false, false), false);
    assert.equal(isSpecStale(false, true), false);
  });

  test('either side unmeasured → UNDEFINED, never false', () => {
    // The load-bearing direction: a `?? false` here would render a silent all-clear over real drift.
    assert.equal(isSpecStale(undefined, false), undefined);
    assert.equal(isSpecStale(true, undefined), undefined);
    assert.equal(isSpecStale(undefined, undefined), undefined);
  });
});

describe('103 L0 · snapshotDiffBase — the diff base follows the fix round', () => {
  const task = (project: string): Task =>
    ({ taskId: '1000000000002', project, workflowSlug: 'wf', workflowFile: 'main.yml' }) as Task;
  const baseRel = 'apps/builder/.runs/1000000000002/diff-base.yml';
  const read = (dir: string, rel: string): string =>
    execFileSync('cat', [join(dir, rel)], { encoding: 'utf8' });

  test('first Implement captures the pre-edit state', async () => {
    const { dir, ymlRel } = repo('_drafts');
    writeFileSync(join(dir, ymlRel), YAML_A);
    await snapshotDiffBase(dir, task('_drafts'));
    assert.equal(read(dir, baseRel), YAML_A);
  });

  test('a re-run WITHOUT restart keeps the original base (unchanged from pre-103)', async () => {
    const { dir, ymlRel } = repo('_drafts');
    writeFileSync(join(dir, ymlRel), YAML_A);
    await snapshotDiffBase(dir, task('_drafts'));
    writeFileSync(join(dir, ymlRel), YAML_B);
    await snapshotDiffBase(dir, task('_drafts'));
    assert.equal(read(dir, baseRel), YAML_A, 'idempotent: the first capture stands');
  });

  test('a REVISION round re-arms the base, so `差分` reads "this round" not "since the build began"', async () => {
    const { dir, ymlRel } = repo('_drafts');
    writeFileSync(join(dir, ymlRel), YAML_A);
    await snapshotDiffBase(dir, task('_drafts'));
    writeFileSync(join(dir, ymlRel), YAML_B); // round 1 edited the file
    await snapshotDiffBase(dir, task('_drafts'), { restart: true }); // round 2 starts here
    assert.equal(read(dir, baseRel), YAML_B);
  });

  test('restart still respects the DIFY-SEED base (the KNOWN GAP, pinned so it stays deliberate)', async () => {
    const { dir, ymlRel } = repo('_drafts');
    writeFileSync(join(dir, ymlRel), YAML_A);
    // Both fields, as a real Dify-seed build carries them: the app id, and the pulled file that IS
    // the diff base. The id alone would mean a failed pull, which has no base and must be snapshotted.
    const seeded = { ...task('_drafts'), seedAppId: 'app-abc123', seedPath: 'projects/_drafts/wf/workflows/pulled.yml' } as Task;
    await snapshotDiffBase(dir, seeded, { restart: true });
    assert.equal(existsSync(join(dir, baseRel)), false, 'a build seeded from a Dify app diffs against that app, always');
  });

  test('but a LOCAL edit-existing build IS snapshotted — the gap was wider than its own comment (spec 105)', async () => {
    // `localEditSeed` sets `seedPath` for every local edit-existing build, so keying the exclusion on
    // that field swallowed a case the KNOWN GAP never claimed: a human fixing a workflow already on
    // disk got no pre-round snapshot, hence no undo. `seedAppId` is the field that actually means
    // "seeded from Dify".
    const { dir, ymlRel } = repo('_drafts');
    writeFileSync(join(dir, ymlRel), YAML_A);
    const local = { ...task('_drafts'), seedPath: 'apps/builder/.runs/1780000000000/seed.yml' } as Task;
    await snapshotDiffBase(dir, local, { restart: true });
    assert.equal(existsSync(join(dir, baseRel)), true, 'the pre-round workflow is captured');
  });
});
