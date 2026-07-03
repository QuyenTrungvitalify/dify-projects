/**
 * post-turn.ts idsOk — the implement-gate node-id check.
 *
 * Regression for #9 (campaign): an *iteration* workflow has a legitimate iteration-start child node
 * whose id is `<13-digit-id>start` (AGENTS.md §4.1, accepted by validate_workflow.py). The gate's
 * idsOk regex was `^\d{13}$`, which rejected that suffix → `idsOk:false` → every iteration workflow
 * false-parked at the `still_failing` gate despite clean lint. Fixed to `^\d{13}(start)?$`.
 *
 * Drives the REAL postTurnCheck (in-process, so it exercises the shipped regex) via a python shim
 * whose `node_ids` probe returns a chosen id set and whose linter calls all pass — mirrors linters.test.ts.
 */
import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { postTurnCheck } from '../server/lib/post-turn.js';
import type { SessionLogger } from '../server/lib/claude-session.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;
const PROJECT = 'proj_idcheck';
const WF = 'wf_idcheck';

/** `.venv/bin/python` shim: the `-c` node_ids probe returns `nodeIdsJson`; every linter call exits 0. */
const shimReturning = (nodeIdsJson: string) => `#!/usr/bin/env bash
if [ "$1" = "-c" ]; then
  case "$2" in
    *node_ids*) printf '%s' '{"node_ids": ${nodeIdsJson}}'; exit 0 ;;
    *) exit 0 ;;
  esac
fi
exit 0
`;

let dir: string;
function setup(nodeIdsJson: string): void {
  dir = mkdtempSync(join(tmpdir(), 'idcheck-'));
  const bin = join(dir, '.venv', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'python'), shimReturning(nodeIdsJson), { mode: 0o755 });
  const wf = join(dir, 'projects', PROJECT, WF, 'workflows');
  mkdirSync(wf, { recursive: true });
  writeFileSync(join(wf, 'main.yml'), 'workflow:\n  graph:\n    nodes: []\n');
}
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = () =>
  postTurnCheck({
    projectsDir: dir,
    project: PROJECT,
    workflowSlug: WF,
    workflowFile: 'main.yml',
    taskId: '1000000000001',
    baseline: new Set<string>(),
    log,
  });

describe('post-turn idsOk — iteration-start `<id>start` (AGENTS.md §4.1)', () => {
  test('a <13-digit>start iteration-start id passes idsOk (regression: #9 false-parked still_failing)', async () => {
    setup('["1782556995650", "1782556995650start"]');
    const r = await run();
    assert.equal(r.detail.idsOk, true, `idsOk should be true; reasons: ${r.reasons.join(' | ')}`);
    assert.ok(!r.reasons.some((x) => x.includes('non-13-digit')), r.reasons.join(' | '));
  });

  test('a hand-written string id still fails idsOk (safety property preserved)', async () => {
    setup('["node-code-1"]');
    const r = await run();
    assert.equal(r.detail.idsOk, false);
    assert.ok(r.reasons.some((x) => x.includes('non-13-digit')), r.reasons.join(' | '));
  });

  test('a bare 13-digit id still passes idsOk (unchanged)', async () => {
    setup('["1782556995650"]');
    const r = await run();
    assert.equal(r.detail.idsOk, true, r.reasons.join(' | '));
  });

  test('a `<id>start` mixed with a hand-written id still fails (start suffix is not a blanket pass)', async () => {
    setup('["1782556995650start", "node-1"]');
    const r = await run();
    assert.equal(r.detail.idsOk, false);
    assert.ok(r.reasons.some((x) => x.includes('node-1')), r.reasons.join(' | '));
  });
});
