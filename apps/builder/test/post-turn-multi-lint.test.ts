/**
 * Spec 039 — post-turn lint completeness: every turn-touched `workflows/*.ya?ml` gets the FULL ③
 * gate (YAML probe + 3 linters + idsOk), and an extension twin of the declared workflow file
 * hard-errors even when lint-clean (two canonical-looking artifacts = correctness ambiguity).
 *
 * Harness = confinement.test.ts's real tmp git repo (extras are enumerated from the confinement
 * delta, so a real `git status` is load-bearing) + an EXTENDED copy of linters.test.ts's python
 * shim. The stock shim records only the script path and cannot support per-file assertions; this
 * copy records `<script> <file>` per linter invocation AND a `probe <file>` line in the `-c`
 * branch, and accepts `script:file` keys in LINT_FAIL for per-file failure injection (039 S1).
 * The stock shim in linters.test.ts stays byte-unchanged so its pinned suites stay green.
 *
 * The hard/success/still_failing fold is asserted at the layer that owns it: the exported pure
 * `resolveImplementOutcome` (039 AC 2 — do NOT assert `PostTurnResult.status`, which is 'error'
 * for ANY failure and cannot distinguish hard from still_failing).
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { postTurnCheck, gitDirtyPaths } from '../server/lib/post-turn.js';
import { resolveImplementOutcome } from '../server/lib/orchestrator.js';
import { timeoutNote } from '../server/lib/turn-runner.js';
import { LINTERS } from '../server/lib/linters.js';
import type { SessionLogger } from '../server/lib/claude-session.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;
const PROJECT = 'my_app';
const WF = 'summarizer';
const TASK = '1700000000001';

const git = (dir: string, args: string[]): void => {
  execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
};

const put = (dir: string, rel: string, content: string): void => {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
};

/** EXTENDED shim (039 S1): records `probe <file>` / `<script> <file>` per invocation; LINT_FAIL
 *  accepts both bare `script` keys (fail every file) and `script:file` keys (fail one file);
 *  PROBE_FAIL forces the YAML probe to fail for the named file(s). */
const SHIM = `#!/usr/bin/env bash
if [ "$1" = "-c" ]; then
  case "$2" in
    *node_ids*)
      [ -n "$LINT_RECORD" ] && printf '%s\\n' "probe $3" >> "$LINT_RECORD"
      case ",$PROBE_FAIL," in
        *",$3,"*) echo "parse error: forced by PROBE_FAIL" >&2; exit 1 ;;
      esac
      printf '%s' '{"node_ids": ["1234567890123"]}'; exit 0 ;;
    *) exit 0 ;;
  esac
fi
script="$1"; file="$2"
[ -n "$LINT_RECORD" ] && printf '%s\\n' "$script $file" >> "$LINT_RECORD"
case ",$LINT_FAIL," in
  *",$script:$file,"*|*",$script,"*) echo "lint failure: $script $file" >&2; exit 1 ;;
esac
exit 0
`;

let dir: string;
let recordFile: string;

/** Throwaway git repo: committed skeleton (incl. the shim and a tracked deletable workflow file)
 *  so `git status --porcelain` reports turn writes at path granularity. */
function makeRepo(declaredFile = 'main.yml'): void {
  dir = mkdtempSync(join(tmpdir(), 'multi-lint-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  const bin = join(dir, '.venv', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'python'), SHIM, { mode: 0o755 });
  put(dir, `projects/${PROJECT}/${WF}/workflows/${declaredFile}`, 'workflow: {}\n');
  put(dir, `projects/${PROJECT}/${WF}/workflows/todel.yml`, 'workflow: {}\n'); // tracked; some tests delete it
  put(dir, `projects/other/${WF}/.gitkeep`, '');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'skeleton']);
  recordFile = join(dir, 'record.txt');
  writeFileSync(recordFile, '');
  process.env.LINT_RECORD = recordFile;
}

afterEach(() => {
  delete process.env.LINT_RECORD;
  delete process.env.LINT_FAIL;
  delete process.env.PROBE_FAIL;
  rmSync(dir, { recursive: true, force: true });
});

const WFDIR = `projects/${PROJECT}/${WF}/workflows`;

function recorded(): string[] {
  const raw = existsSync(recordFile) ? readFileSync(recordFile, 'utf8') : '';
  return raw.split('\n').filter(Boolean);
}

async function runCheck(workflowFile = 'main.yml', baseline?: Set<string>) {
  return postTurnCheck({
    projectsDir: dir,
    project: PROJECT,
    workflowSlug: WF,
    workflowFile,
    taskId: TASK,
    baseline: baseline ?? new Set(),
    log,
  });
}

describe('spec 039 — every turn-touched workflows/*.ya?ml is fully gated', () => {
  test('AC 1/1b: extra.yml gets probe + all 3 linters, each as its own single-file spawn', async () => {
    makeRepo();
    const baseline = await gitDirtyPaths(dir);
    put(dir, `${WFDIR}/extra.yml`, 'workflow: {}\n');

    const res = await runCheck('main.yml', baseline);
    const rec = recorded();

    const extraRel = `${WFDIR}/extra.yml`;
    assert.ok(rec.includes(`probe ${extraRel}`), `probe ran on the extra: ${rec.join(' | ')}`);
    for (const lint of LINTERS) {
      // 1b anti-gaming: the record line is `<script> <file>` — one spawn per (linter, file) with the
      // extra as its OWN single argv file. A batched-argv call would record `<script> <main> <extra>`
      // on one line (validate_workflow.py silently ignores argv[2+]) and fail this exact-match.
      assert.ok(rec.includes(`${lint.script} ${extraRel}`), `${lint.key} ran on ${extraRel}`);
      assert.ok(rec.includes(`${lint.script} ${WFDIR}/main.yml`), `${lint.key} still ran on the declared file`);
    }
    assert.equal(res.detail.extraFiles.length, 1);
    assert.equal(res.detail.extraFiles[0].path, extraRel);
    assert.equal(res.detail.extraFiles[0].twin, false);
    assert.equal(resolveImplementOutcome(res.detail, undefined), 'success', 'clean extra does not block');
  });

  test('AC 1: a per-file lint failure on the extra alone → still_failing, reason names the extra', async () => {
    makeRepo();
    const baseline = await gitDirtyPaths(dir);
    put(dir, `${WFDIR}/extra.yml`, 'workflow: {}\n');
    process.env.LINT_FAIL = `tools/dify_base/lint_refs.py:${WFDIR}/extra.yml`;

    const res = await runCheck('main.yml', baseline);

    assert.equal(resolveImplementOutcome(res.detail, undefined), 'still_failing');
    assert.equal(res.detail.lintCodes?.lint_refs, 0, 'declared file stayed clean (per-file injection)');
    assert.equal(res.detail.extraFiles[0].lintCodes?.lint_refs, 1, 'extra carries its own exit code');
    assert.ok(res.reasons.some((r) => r.includes('extra.yml')), `reason names the extra: ${res.reasons.join(' | ')}`);
  });

  test('AC 1c: a .yaml extra (non-twin name) is swept by the \\.ya?ml filter', async () => {
    makeRepo();
    const baseline = await gitDirtyPaths(dir);
    put(dir, `${WFDIR}/helper.yaml`, 'workflow: {}\n');

    const res = await runCheck('main.yml', baseline);

    assert.equal(res.detail.extraFiles.length, 1);
    assert.equal(res.detail.extraFiles[0].path, `${WFDIR}/helper.yaml`);
    assert.equal(res.detail.extraFiles[0].twin, false, 'helper.yaml is not a twin of main.yml');
    assert.ok(recorded().includes(`probe ${WFDIR}/helper.yaml`));
  });

  test('AC 2: extension twin hard-errors in BOTH directions, even lint-clean', async () => {
    // direction 1: declared main.yml, turn writes main.yaml
    makeRepo();
    let baseline = await gitDirtyPaths(dir);
    put(dir, `${WFDIR}/main.yaml`, 'workflow: {}\n');
    let res = await runCheck('main.yml', baseline);
    assert.equal(res.detail.extraFiles[0].twin, true);
    assert.equal(resolveImplementOutcome(res.detail, undefined), 'error', 'twin = hard error, not still_failing');
    assert.ok(res.reasons.some((r) => r.includes(`extension twin of main.yml: ${WFDIR}/main.yaml`)), res.reasons.join(' | '));
    assert.ok(recorded().includes(`probe ${WFDIR}/main.yaml`), 'twin is still fully linted (diagnostic value)');
    rmSync(dir, { recursive: true, force: true });

    // direction 2: declared main.yaml, turn writes main.yml — proves stem-relative detection
    makeRepo('main.yaml');
    baseline = await gitDirtyPaths(dir);
    put(dir, `${WFDIR}/main.yml`, 'workflow: {}\n');
    res = await runCheck('main.yaml', baseline);
    assert.equal(res.detail.extraFiles[0].twin, true, 'reverse direction detected');
    assert.equal(resolveImplementOutcome(res.detail, undefined), 'error');
  });

  test('AC 2b: a lint-clean, ids-clean, non-twin extra yields success (no blanket sibling ban)', async () => {
    makeRepo();
    const baseline = await gitDirtyPaths(dir);
    put(dir, `${WFDIR}/probe_helper.yml`, 'workflow: {}\n');
    const res = await runCheck('main.yml', baseline);
    assert.equal(resolveImplementOutcome(res.detail, undefined), 'success');
  });

  test('AC 2c: nested workflows/sub/main.yaml is an ordinary extra, NOT a twin', async () => {
    makeRepo();
    const baseline = await gitDirtyPaths(dir);
    put(dir, `${WFDIR}/sub/main.yaml`, 'workflow: {}\n');
    const res = await runCheck('main.yml', baseline);
    assert.equal(res.detail.extraFiles.length, 1);
    assert.equal(res.detail.extraFiles[0].twin, false, 'same stem but nested → plain extra (D4 scope)');
    assert.ok(recorded().includes(`probe ${WFDIR}/sub/main.yaml`), 'nested extra still linted');
    assert.equal(resolveImplementOutcome(res.detail, undefined), 'success');
  });

  test('AC 3: baseline-dirty workflow files are NOT enumerated (turn delta, not a readdir glob)', async () => {
    makeRepo();
    put(dir, `${WFDIR}/old.yml`, 'pre-existing dirty\n'); // dirty BEFORE the baseline snapshot
    const baseline = await gitDirtyPaths(dir);
    const res = await runCheck('main.yml', baseline);
    assert.deepEqual(res.detail.extraFiles, []);
    assert.ok(!recorded().some((l) => l.includes('old.yml')), 'baseline file never linted');
  });

  test('AC 4: breach reverted; breach reason LAST; reverted path absent from the lint record', async () => {
    makeRepo();
    const baseline = await gitDirtyPaths(dir);
    put(dir, `${WFDIR}/extra.yml`, 'workflow: {}\n');
    put(dir, `projects/other/${WF}/evil.yml`, 'sibling project breach\n');
    process.env.LINT_FAIL = `tools/dify_base/lint_refs.py:${WFDIR}/extra.yml`; // a correctness reason to order against

    const res = await runCheck('main.yml', baseline);

    assert.equal(existsSync(join(dir, `projects/other/${WF}/evil.yml`)), false, 'breach reverted');
    const breachIdx = res.reasons.findIndex((r) => r.startsWith('confinement breach (reverted):'));
    assert.ok(breachIdx >= 0, 'breach reported');
    assert.equal(breachIdx, res.reasons.length - 1, `breach reason last: ${res.reasons.join(' | ')}`);
    assert.ok(!recorded().some((l) => l.includes('evil.yml')), 'reverted path never linted (defense in depth)');
    assert.equal(resolveImplementOutcome(res.detail, undefined), 'error', 'breach = hard error, unchanged');
  });

  test('AC 5: subtree YAML outside workflows/ (tests/ fixture) is confinement-only, never linted', async () => {
    makeRepo();
    const baseline = await gitDirtyPaths(dir);
    put(dir, `projects/${PROJECT}/${WF}/tests/fixture.yml`, 'not dify dsl\n');
    const res = await runCheck('main.yml', baseline);
    assert.deepEqual(res.detail.extraFiles, []);
    assert.ok(!recorded().some((l) => l.includes('fixture.yml')), 'fixture exempt (D2)');
    assert.ok(existsSync(join(dir, `projects/${PROJECT}/${WF}/tests/fixture.yml`)), 'whitelisted, survives');
    assert.equal(resolveImplementOutcome(res.detail, undefined), 'success');
  });

  test('AC 6: single-file turn → extraFiles deep-equals [] (byte-identical happy path)', async () => {
    makeRepo();
    const baseline = await gitDirtyPaths(dir);
    // turn touches ONLY the declared file
    writeFileSync(join(dir, `${WFDIR}/main.yml`), 'workflow: {}\n# revised\n');
    const res = await runCheck('main.yml', baseline);
    assert.deepEqual(res.detail.extraFiles, []);
    assert.equal(resolveImplementOutcome(res.detail, undefined), 'success');
  });

  test('AC 6: probe-failing extra is STILL fully linted (linters gate on size, not probe result)', async () => {
    makeRepo();
    const baseline = await gitDirtyPaths(dir);
    put(dir, `${WFDIR}/extra.yml`, 'workflow: {}\n');
    process.env.PROBE_FAIL = `${WFDIR}/extra.yml`;

    const res = await runCheck('main.yml', baseline);
    const f = res.detail.extraFiles[0];

    assert.equal(f.yamlOk, false);
    assert.ok(f.lintCodes, 'linters ran despite the probe failure (mirrors the declared-file contract)');
    for (const lint of LINTERS) {
      assert.ok(recorded().includes(`${lint.script} ${WFDIR}/extra.yml`), `${lint.key} ran on the probe-failing extra`);
    }
    assert.equal(resolveImplementOutcome(res.detail, undefined), 'error', 'unparseable extra folds to hard error');
  });

  test('AC 6: a turn-DELETED tracked workflow file reports yamlOk:false + lintCodes:null → hard error', async () => {
    makeRepo();
    const baseline = await gitDirtyPaths(dir);
    rmSync(join(dir, `${WFDIR}/todel.yml`)); // deletion is turn-touched in porcelain (` D`)
    const res = await runCheck('main.yml', baseline);
    const f = res.detail.extraFiles.find((x) => x.path === `${WFDIR}/todel.yml`);
    assert.ok(f, 'deleted tracked file enumerated');
    assert.equal(f!.yamlOk, false);
    assert.equal(f!.lintCodes, null);
    assert.equal(resolveImplementOutcome(res.detail, undefined), 'error');
  });
});

describe('spec 085 — salvage a timeout that left a clean artifact (do not rebuild from scratch)', () => {
  const TIMEOUT = timeoutNote(600_000);

  test('timeout + present/parseable/lint-clean artifact → success (the file is kept, not discarded)', async () => {
    makeRepo();
    const baseline = await gitDirtyPaths(dir);
    const res = await runCheck('main.yml', baseline);
    // Same detail with NO note is a success — so the timeout was the ONLY thing forcing a hard error.
    assert.equal(resolveImplementOutcome(res.detail, undefined), 'success');
    assert.equal(resolveImplementOutcome(res.detail, TIMEOUT), 'success', 'a clean artifact survives the 600s cap');
  });

  test('timeout + a NOT-clean artifact → still hard error (never ship a half-fixed file)', async () => {
    makeRepo();
    const baseline = await gitDirtyPaths(dir);
    process.env.LINT_FAIL = `tools/dify_base/lint_refs.py:${WFDIR}/main.yml`; // declared file dirty
    const res = await runCheck('main.yml', baseline);
    assert.equal(resolveImplementOutcome(res.detail, undefined), 'still_failing', 'no note → cap-5 gate (unchanged)');
    assert.equal(resolveImplementOutcome(res.detail, TIMEOUT), 'error', 'a timed-out dirty file is discarded');
  });

  test('a NON-timeout note (spawn/exit failure) is never salvaged, even when lint-clean', async () => {
    makeRepo();
    const baseline = await gitDirtyPaths(dir);
    const res = await runCheck('main.yml', baseline);
    assert.equal(resolveImplementOutcome(res.detail, 'child exited before any result'), 'error');
  });
});
