/**
 * Spec 066 AC-1 — the ④ note names the COMPLETE, TRUE set of what the user must do.
 *
 * This is the test the spec needed from the start. The real naive build (run 1784192313811) required
 * FOUR things of its user and its note named NONE of them — while saying "nothing to set up" and
 * promising 「自動起動・自走」 in the same breath. 066's first pass shipped two of the four and reported
 * the spec Implemented; every suite was green, because nothing asserted COMPLETENESS.
 *
 * The spec-063 comprehension oracle cannot catch this: it measures JARGON, never OMISSION — it scores
 * a note that forgets all four items as a clean PASS. That is 066's own warning ("its AC must not be
 * graded by the instrument it is fixing") turned into a test.
 *
 * The fixture (`fixtures/readiness/naive-slack-digest.yml`) freezes the build's shape; the workspace
 * is planted with 0 models, and deploy is `none` — the DEFAULT, and the mode the dossier actually ran.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runReport } from '../server/lib/report.js';
import { createTask } from '../server/state/task.js';
import type { SessionLogger } from '../server/lib/claude-session.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;
const PROJECT = 'proj_readiness';
const SLUG = 'wf_readiness';
const FIXTURE = join(import.meta.dirname, 'fixtures', 'readiness', 'naive-slack-digest.yml');

/** A `.venv/bin/python` shim: every linter exits 0, and the runnability probe answers for real by
 *  running the REAL embedded probe source against the fixture — so `env_secret_empty` and
 *  `model_empty` are detected the same way they are in production, not planted. */
const SHIM = `#!/usr/bin/env bash
if [ "$1" = "-c" ]; then exec /usr/bin/env python3 "$@"; fi
exit 0
`;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'readiness-'));
  const bin = join(dir, '.venv', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'python'), SHIM, { mode: 0o755 });
  const wf = join(dir, 'projects', PROJECT, SLUG, 'workflows');
  mkdirSync(wf, { recursive: true });
  copyFileSync(FIXTURE, join(wf, 'main.yml'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Plant the harvest the dossier actually had: creds present, all three arms OK, ZERO models. */
function plantWorkspace(taskId: string, models: unknown[] = []): void {
  const runDir = join(dir, 'apps', 'builder', '.runs', taskId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, 'workspace.json'),
    JSON.stringify({
      harvestedAt: '2026-07-16T09:03:34.577Z',
      target: 'selfhost',
      models,
      plugins: [],
      datasets: [],
      sources: {
        models: { ok: true, count: models.length },
        plugins: { ok: true, count: 0 },
        datasets: { ok: true, count: 0 },
      },
    })
  );
}

async function noteFor(deploy: 'none' | 'cloud' | 'selfhost', models: unknown[] = []): Promise<string> {
  const task = await createTask(dir, { requirement: '毎朝9時にSlackへ通知', project: PROJECT, slug: SLUG });
  // Spec 036 D3: `deploy` is GATE-stamped, not start-bound — createTask IGNORES it in its input, so
  // it must be set on the task afterwards. (Passing it to createTask silently yields `none`, which is
  // how the first cut of this test "proved" the cloud branch while actually re-testing `none`.)
  task.deploy = deploy;
  plantWorkspace(task.taskId, models);
  const rep = await runReport(dir, task, log);
  return JSON.parse(readFileSync(join(dir, rep.reportRel), 'utf8')).notes as string;
}

describe('spec 066 AC-1 — the deploy=none checklist is COMPLETE', () => {
  // The four things this build genuinely requires of its user. Each entry is a fact about the
  // fixture, not about the wording — so a reword keeps the test honest while a REMOVAL fails it.
  const REQUIRED: Array<[what: string, rx: RegExp]> = [
    ['add an AI model (workspace has 0)', /an AI model — add one in Dify first/],
    ['paste the Slack webhook secret', /a value for SLACK_WEBHOOK_URL/],
    // spec 095: the FACT is unchanged (the trigger needs an action in Dify before it ever fires);
    // what changed is which action — publish, not hunt for a switch that is not on screen yet.
    ['publish so the schedule trigger starts firing', /only once you PUBLISH it in Dify Studio/],
    ['import the workflow file', /Your workflow file is projects\/proj_readiness\/wf_readiness\/workflows\/main\.yml/],
  ];

  test('all four items are named — the note the dossier SHOULD have carried', async () => {
    const notes = await noteFor('none');
    const missing = REQUIRED.filter(([, rx]) => !rx.test(notes)).map(([what]) => what);
    assert.deepEqual(missing, [], `the note omits: ${missing.join(' · ')}\n\nnote was:\n${notes}`);
  });

  test('and it never claims there is nothing to do', async () => {
    const notes = await noteFor('none');
    assert.ok(!notes.includes('nothing to set up'),
      'the dossier said exactly this, about the one thing that guaranteed failure');
    assert.ok(!notes.includes('filled in automatically when you test'),
      'auto-fill cannot happen with 0 models in the workspace (live-test.ts 0-model degrade)');
  });

  test('a workspace WITH a model drops only the model item — the other three stay', async () => {
    const notes = await noteFor('none', [{ provider: 'openai', name: 'gpt-4o-mini' }]);
    assert.match(notes, /filled in automatically when you test/, 'now the reassurance is TRUE');
    for (const [what, rx] of REQUIRED.slice(1)) {
      assert.match(notes, rx, `${what} must still be named`);
    }
  });

  test('the ④ note is advisory — the four items never flip the lint verdict', async () => {
    const task = await createTask(dir, { requirement: 'x', project: PROJECT, slug: SLUG, deploy: 'none' });
    plantWorkspace(task.taskId);
    const rep = await runReport(dir, task, log);
    assert.equal(rep.lintClean, true, 'readiness is advice, never a gate (037 AC-3b spirit)');
  });

  test('selfhost/cloud keep the ran-just-now wording; only `none` gets the reworded variant', async () => {
    // spec 095 reworded both variants (publish first, then check the switch), but the SPLIT this test
    // guards is untouched: only a mode that actually ran against Dify may refer to that run.
    assert.match(await noteFor('cloud'), /the run above was a manual fire/,
      'a mode that DOES run against Dify still points at the run it just did');
    assert.ok(!(await noteFor('none')).includes('was a manual fire'),
      'a `none` build never ran anything — the clause would describe a fiction');
  });
});
