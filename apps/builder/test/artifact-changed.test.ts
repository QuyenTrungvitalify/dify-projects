/**
 * Spec 094 S1 — `artifactChanged`: did THIS ③ turn change the workflow file's bytes?
 *
 * The measured problem (run 1786089321835): two of five "Request changes" rounds ended without writing
 * a single byte, and the gate rendered them IDENTICALLY to the round that fixed two real bugs. The user
 * re-imported an unchanged file believing it was a new fix, then asked "bạn có chắc đang sửa đúng ko?".
 *
 * These tests exist mostly to defend the CHOICE OF MECHANISM, because the obvious mechanisms are all
 * wrong here and one of them was in the spec's first draft:
 *
 *   - `turnTouched` / `ConfinementResult.touched` (a git-porcelain delta) is BLIND to this file. A
 *     from-scratch build lands in `projects/_drafts/`, which the repo gitignores wholesale, so the
 *     artifact never appears in `git status` at all. `noGitDelta` below asserts that blindness directly,
 *     so the reason this code does not use git is a checked fact and not a comment.
 *   - even where git DOES see the file, a `/reply` turn's artifact is already dirty from the previous
 *     turn, so it sits in `baseline` and drops out of the delta — "unchanged" for a round that fixed
 *     something. `alreadyDirty` below pins that case.
 *   - `diff.json` answers a different question entirely (its base is the pre-EDIT state of the FIRST
 *     turn, because snapshotDiffBase is a deliberate no-op on /reply).
 *
 * So: rewire `artifactChanged` to any of those and this file goes red. That is its whole job.
 *
 * Drives the REAL postTurnCheck in-process over a REAL git repo (the gitignore is load-bearing), with
 * the `.venv/bin/python` shim technique from post-turn-ids.test.ts so no linter actually runs.
 */
import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { postTurnCheck, artifactHash, gitDirtyPaths } from '../server/lib/post-turn.js';
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

/**
 * A real git repo shaped like this one: `projects/_drafts/` ignored wholesale (the production default
 * — a from-scratch build resolves to the `_drafts` project), plus one ordinary tracked project so the
 * two cases can be told apart. `.gitignore` is COMMITTED so it never shows up as a turn-touched path
 * that confinementCheck would try to revert out from under the test.
 */
function repo(project: string): { dir: string; rel: string } {
  const dir = mkdtempSync(join(tmpdir(), 'artifact-changed-'));
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

  const wfDir = join(dir, 'projects', project, 'wf', 'workflows');
  mkdirSync(wfDir, { recursive: true });
  return { dir, rel: `projects/${project}/wf/workflows/main.yml` };
}

const YAML_A = 'workflow:\n  graph:\n    nodes: []\n';
const YAML_B = 'workflow:\n  graph:\n    nodes: []\n# edited by the turn\n';

const check = (dir: string, project: string, before: string | null | undefined, baseline: string[] = []) =>
  postTurnCheck({
    projectsDir: dir,
    project,
    workflowSlug: 'wf',
    workflowFile: 'main.yml',
    taskId: '1000000000001',
    baseline: new Set(baseline),
    artifactHashBefore: before,
    log,
  });

describe('094 S1 · artifactChanged — the empty fix round, named', () => {
  test('calibration: git CANNOT see a _drafts artifact (this is why the flag is not a git delta)', async () => {
    // If this ever fails, the repo stopped ignoring _drafts and the reasoning in post-turn.ts needs
    // revisiting — but the hash mechanism below stays correct either way.
    const { dir, rel } = repo('_drafts');
    writeFileSync(join(dir, rel), YAML_A);
    const dirty = await gitDirtyPaths(dir);
    assert.equal(dirty.has(rel), false, 'a gitignored artifact must be invisible to git status');
  });

  test('_drafts (the default project): a turn that REWRITES the file reads as changed', async () => {
    const { dir, rel } = repo('_drafts');
    writeFileSync(join(dir, rel), YAML_A);
    const before = await artifactHash(dir, rel);
    writeFileSync(join(dir, rel), YAML_B); // the turn edits it
    const r = await check(dir, '_drafts', before);
    // RED if artifactChanged is wired to turnTouched / ConfinementResult.touched / diff.json: all three
    // report "nothing" for a gitignored path, so a real fix would be announced as an empty round.
    assert.equal(r.detail.artifactChanged, true);
  });

  test('_drafts: a turn that writes NOTHING reads as unchanged (R3/R5 — the whole point)', async () => {
    const { dir, rel } = repo('_drafts');
    writeFileSync(join(dir, rel), YAML_A);
    const before = await artifactHash(dir, rel);
    const r = await check(dir, '_drafts', before); // no write between the two hashes
    assert.equal(r.detail.artifactChanged, false);
  });

  test('rewriting byte-identical content is NOT a change (what the user means by "nothing changed")', async () => {
    const { dir, rel } = repo('_drafts');
    writeFileSync(join(dir, rel), YAML_A);
    const before = await artifactHash(dir, rel);
    writeFileSync(join(dir, rel), YAML_A); // same bytes, new mtime
    const r = await check(dir, '_drafts', before);
    assert.equal(r.detail.artifactChanged, false, 'mtime/size must not be what this measures');
  });

  test('the FIRST implement (no file before the turn) reads as changed', async () => {
    const { dir, rel } = repo('_drafts');
    const before = await artifactHash(dir, rel); // null — nothing on disk yet
    assert.equal(before, null);
    writeFileSync(join(dir, rel), YAML_A);
    const r = await check(dir, '_drafts', before);
    assert.equal(r.detail.artifactChanged, true);
  });

  test('alreadyDirty: a /reply whose file was ALREADY dirty still reads as changed', async () => {
    // The second git trap: on a /reply the artifact is dirty from the previous turn, so it is in the
    // baseline and a `after \ baseline` delta drops it. Tracked project + the path pre-seeded in the
    // baseline reproduces that exactly. RED if the flag is a baseline delta.
    const { dir, rel } = repo('realproj');
    writeFileSync(join(dir, rel), YAML_A);
    const before = await artifactHash(dir, rel);
    writeFileSync(join(dir, rel), YAML_B);
    const r = await check(dir, 'realproj', before, [rel]);
    assert.equal(r.detail.artifactChanged, true);
  });

  test('no before-hash supplied ⇒ undefined, never a guess (pre-094 callers keep working)', async () => {
    const { dir, rel } = repo('_drafts');
    writeFileSync(join(dir, rel), YAML_A);
    const r = await check(dir, '_drafts', undefined);
    assert.equal(r.detail.artifactChanged, undefined);
  });

  test('a turn that DELETES the artifact reads as changed (and still hard-errors on artifactOk)', async () => {
    const { dir, rel } = repo('_drafts');
    writeFileSync(join(dir, rel), YAML_A);
    const before = await artifactHash(dir, rel);
    unlinkSync(join(dir, rel));
    const r = await check(dir, '_drafts', before);
    assert.equal(r.detail.artifactChanged, true);
    assert.equal(r.detail.artifactOk, false, 'the missing-artifact hard error is untouched by 094');
  });

  test('artifactHash: null for a missing file, stable and content-keyed otherwise', async () => {
    const { dir, rel } = repo('_drafts');
    assert.equal(await artifactHash(dir, rel), null);
    writeFileSync(join(dir, rel), YAML_A);
    const h1 = await artifactHash(dir, rel);
    assert.equal(await artifactHash(dir, rel), h1, 'same bytes ⇒ same hash');
    writeFileSync(join(dir, rel), YAML_B);
    assert.notEqual(await artifactHash(dir, rel), h1, 'different bytes ⇒ different hash');
    assert.ok(existsSync(join(dir, rel)));
  });
});
