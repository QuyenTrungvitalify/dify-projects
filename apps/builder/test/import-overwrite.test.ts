/**
 * ④-import overwrite — a re-import UPDATES the app it already made instead of creating another one.
 *
 * The problem: every fix round used to leave a fresh Dify app behind (`push` never sent `app_id`), so a
 * workflow fixed three times became four apps and the user had no way to tell which was current. Probed
 * against self-hosted Dify (DSL 0.6.0): `POST /console/api/apps/imports` WITH `app_id` overwrites that
 * app in place — same id, same URL, workspace count unchanged — and a stale id fails HTTP 400
 * `{status:"failed", app_id:null, error:"App not found"}` rather than falling back to creating.
 *
 * These drive the REAL `runImportAndFinish` through a `.venv/bin/python` shim (the import-inject.test.ts
 * technique), so the whole chain runs for real: argv construction in `pushApp`, `runSyncPy`, the
 * `--json-out` parse, the push-intent marker, and the human note. Only the subprocess is fake.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAppMode, runImportAndFinish } from '../server/lib/import.js';
import { writePushIntent } from '../server/lib/recovery.js';
import type { OrchestratorCtx } from '../server/lib/orchestrator-shared.js';
import type { Task } from '../server/state/task.js';
import type { ReportResult, ReportOpts } from '../server/lib/report.js';
import type { SessionLogger } from '../server/lib/claude-session.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;

/** How the shim answers a `push` that carries `--app-id` (a plain create always succeeds with NEWID). */
type OverwriteMode = 'ok' | 'app-gone' | 'pending';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * A projectsDir whose `.venv/bin/python` shim appends every invocation's argv to `argv.txt` and answers
 * `push` like Dify does. Non-push subcommands answer `{}` so the spec-087 model probe finds nothing and
 * the import pushes the source file as-is (no injected copy to reason about here).
 */
function shimDir(mode: OverwriteMode): { dir: string; argvFile: string } {
  const dir = mkdtempSync(join(tmpdir(), 'import-overwrite-'));
  dirs.push(dir);
  const bin = join(dir, '.venv', 'bin');
  mkdirSync(bin, { recursive: true });
  const argvFile = join(dir, 'argv.txt');
  // The real DSL on disk — runImportAndFinish reads its `app.mode` to decide whether the remembered app
  // is still the right KIND to overwrite (Dify's update path never reassigns app.mode).
  writeWorkflow(dir, 'workflow');
  const onOverwrite =
    mode === 'ok'
      ? `echo "{\\"id\\":\\"rec-ov\\",\\"status\\":\\"completed\\",\\"app_id\\":\\"$target\\"}"`
      : mode === 'app-gone'
        ? `echo '❌ import_app failed: HTTP 400 — {"status":"failed","app_id":null,"error":"App not found"}' >&2; exit 1`
        : // A DSL version mismatch: HTTP 200, but the import is NOT done (awaits confirmation) and there
          // is no app_id. The dangerous case — exit 0 must not read as success.
          `echo '{"id":"rec-pending","status":"pending","app_id":null}'`;
  writeFileSync(
    join(bin, 'python'),
    `#!/usr/bin/env bash
printf '%s\\n' "$@" >> '${argvFile}'
printf -- '---\\n' >> '${argvFile}'
# runSyncPy passes the script path first, so the subcommand is $2 — not $1.
[ "$2" = "push" ] || { echo '{}'; exit 0; }
target=""
prev=""
for a in "$@"; do [ "$prev" = "--app-id" ] && target="$a"; prev="$a"; done
if [ -n "$target" ]; then
  ${onOverwrite}
else
  echo '{"id":"rec-new","status":"completed","app_id":"NEWID"}'
fi
`,
    { mode: 0o755 }
  );
  return { dir, argvFile };
}

/** Put a minimal DSL of the given `app.mode` at the path the import reads. */
function writeWorkflow(dir: string, mode: string): void {
  const wf = join(dir, 'projects', 'p', 'wf', 'workflows');
  mkdirSync(wf, { recursive: true });
  writeFileSync(join(wf, 'main.yml'), `app:\n  description: ''\n  mode: ${mode}\n  name: My App\nkind: app\nversion: 0.6.0\nworkflow:\n  graph:\n    nodes: []\n`);
}

/** Each recorded subprocess invocation, as a newline-joined argv string. */
const invocations = (argvFile: string): string[] =>
  existsSync(argvFile)
    ? readFileSync(argvFile, 'utf-8').split('---\n').map((s) => s.trim()).filter(Boolean)
    : [];

/** argv arrives as `tools/dify_base/sync.py\n<subcommand>\n…`, so the subcommand is the 2nd line. */
const subcommand = (argv: string): string => argv.split('\n')[1] ?? '';
const pushes = (argvFile: string): string[] => invocations(argvFile).filter((a) => subcommand(a) === 'push');

const mkTask = (over: Partial<Task> = {}): Task =>
  ({
    taskId: 'T-imp', project: 'p', workflowSlug: 'wf', workflow: 'p/wf', workflowFile: 'main.yml',
    requirement: 'r', seedPath: null, seedAppId: null, deploy: 'selfhost', confirmMode: 'each_step',
    phase: 'test', status: 'awaiting_confirm', name: 'My App', sessionIds: {}, artifacts: {},
    testMode: 'static', fastMode: false, ...over,
  }) as Task;

/** Runs the body with Dify creds present (difyCreds reads process.env), then restores them. */
async function withDify<T>(fn: () => Promise<T>): Promise<T> {
  const prev = { u: process.env.DIFY_CONSOLE_URL, t: process.env.DIFY_CONSOLE_TOKEN };
  process.env.DIFY_CONSOLE_URL = 'http://localhost:8090/console/api';
  process.env.DIFY_CONSOLE_TOKEN = 'tok';
  try {
    return await fn();
  } finally {
    if (prev.u === undefined) delete process.env.DIFY_CONSOLE_URL; else process.env.DIFY_CONSOLE_URL = prev.u;
    if (prev.t === undefined) delete process.env.DIFY_CONSOLE_TOKEN; else process.env.DIFY_CONSOLE_TOKEN = prev.t;
  }
}

function harness(dir: string): { ctx: OrchestratorCtx; reportOpts: ReportOpts[] } {
  const reportOpts: ReportOpts[] = [];
  const ctx: OrchestratorCtx = {
    projectsDir: dir,
    settingsPath: '',
    log,
    broadcast: () => {},
    runners: {
      runReport: async (_d: string, _t: Task, _l: SessionLogger, opts?: ReportOpts): Promise<ReportResult> => {
        reportOpts.push(opts ?? {});
        return { ok: true, reasons: [], reportRel: 'r.json', lintClean: true };
      },
    },
  };
  return { ctx, reportOpts };
}

describe('④ import — first import creates, re-import OVERWRITES (no duplicate app)', () => {
  test('a build that has never imported sends NO --app-id and remembers what it created', async () => {
    const { dir, argvFile } = shimDir('ok');
    const { ctx, reportOpts } = harness(dir);
    const task = mkTask();

    await withDify(() => runImportAndFinish(task, ctx));

    assert.equal(task.status, 'done');
    assert.equal(task.appId, 'NEWID');
    assert.equal(task.importAppId, 'NEWID', 'the next round needs this to overwrite instead of duplicating');
    assert.equal(task.importAppMode, 'workflow', 'the mode rides along so a later round can spot a type change');
    assert.ok(!pushes(argvFile)[0].includes('--app-id'), 'nothing to overwrite yet');
    // An edit-existing build still gets the duplicate footgun warning on a CREATE (nothing changed there).
    assert.match(reportOpts[0].duplicateWarning ?? '', /DUPLICATE/);
  });

  test('the SECOND import targets the same app and reports no duplicate', async () => {
    const { dir, argvFile } = shimDir('ok');
    const { ctx, reportOpts } = harness(dir);
    const task = mkTask({ importAppId: 'NEWID', importAppMode: 'workflow', appId: 'NEWID' });

    await withDify(() => runImportAndFinish(task, ctx));

    assert.equal(task.status, 'done');
    assert.match(pushes(argvFile)[0], /--app-id\nNEWID/, 'the push must carry the remembered app id');
    assert.equal(task.appId, 'NEWID', 'same app — the URL the user already has open still works');
    assert.equal(task.importAppId, 'NEWID');
    assert.equal(reportOpts[0].duplicateWarning, null, 'nothing was duplicated, so nothing to warn about');
    assert.equal(pushes(argvFile).length, 1, 'exactly one push — no create alongside the overwrite');
  });

  test('a live-test app is NEVER the overwrite target (its re-test would delete the imported workflow)', async () => {
    const { dir, argvFile } = shimDir('ok');
    const { ctx } = harness(dir);
    // What a build looks like after a live test but before any import: appId points at a throwaway test
    // app (auto-deleted on the next re-test), and no import has happened.
    const task = mkTask({ appId: 'TESTAPP', testApps: ['TESTAPP'], importAppId: null });

    await withDify(() => runImportAndFinish(task, ctx));

    assert.ok(!pushes(argvFile)[0].includes('--app-id'), 'must create its own app, not hijack the test app');
    assert.equal(task.importAppId, 'NEWID');
  });
});

describe('④ import — the remembered app was deleted in Dify', () => {
  test('falls back to creating a new app instead of dead-ending the import', async () => {
    const { dir, argvFile } = shimDir('app-gone');
    const { ctx, reportOpts } = harness(dir);
    const task = mkTask({ importAppId: 'GONE', importAppMode: 'workflow', appId: 'GONE' });

    await withDify(() => runImportAndFinish(task, ctx));

    const attempts = pushes(argvFile);
    assert.equal(attempts.length, 2, 'one overwrite attempt, then one create');
    assert.match(attempts[0], /--app-id\nGONE/);
    assert.ok(!attempts[1].includes('--app-id'), 'the retry must not repeat the dead id');
    assert.equal(task.status, 'done', 'a user deleting the app in Dify is allowed, not an error');
    assert.equal(task.appId, 'NEWID');
    assert.equal(task.importAppId, 'NEWID', 'the new app becomes the one future rounds overwrite');
    assert.match(reportOpts[0].duplicateWarning ?? '', /no longer exists/, 'say why a new app appeared');
  });
});

describe('④ import — an overwrite that never confirms must NOT finish done', () => {
  test('HTTP 200 with status:"pending" (DSL version mismatch) errors and keeps the marker', async () => {
    const { dir } = shimDir('pending');
    const { ctx, reportOpts } = harness(dir);
    const task = mkTask({ importAppId: 'KEEPME', importAppMode: 'workflow', appId: 'KEEPME' });

    await withDify(() => runImportAndFinish(task, ctx));

    assert.equal(task.status, 'error', 'exit 0 is not proof the new DSL landed');
    assert.equal(reportOpts.length, 0, 'no report is written for an import that did not happen');
    assert.equal(task.importAppId, 'KEEPME', 'the target is unchanged — the next attempt retries it');
    const marker = JSON.parse(readFileSync(join(dir, 'apps/builder/.runs/T-imp/push_intent.json'), 'utf-8'));
    assert.equal(marker.targetAppId, 'KEEPME', 'the marker records the INTENT so recovery can redo it');
    assert.equal(marker.appId, null, 'and never as a confirmed result — that would report a false success');
  });
});

describe('④ import — crash recovery', () => {
  test('a crashed OVERWRITE re-pushes (idempotent) instead of name-reconciling', async () => {
    const { dir, argvFile } = shimDir('ok');
    const { ctx } = harness(dir);
    const task = mkTask({ importAppId: 'CRASHED', importAppMode: 'workflow', appId: 'CRASHED' });
    // What a mid-push crash leaves behind: the intent recorded, the result not.
    await writePushIntent(dir, task.taskId, {
      project: 'p', workflowSlug: 'wf', file: 'main.yml', appName: 'My App', appId: null, targetAppId: 'CRASHED',
    });

    await withDify(() => runImportAndFinish(task, ctx));

    assert.match(pushes(argvFile)[0] ?? '', /--app-id\nCRASHED/, 're-push is safe: same id in, same app out');
    assert.equal(task.status, 'done');
    assert.equal(task.appId, 'CRASHED');
    // A `list`-reconcile would have proved only that SOME app exists — never that the fix landed in it.
    assert.ok(!invocations(argvFile).some((a) => subcommand(a) === 'list'), 'no name-reconcile on this path');
  });

  test('a crashed CREATE still reconciles and never re-pushes (the duplicate guard is untouched)', async () => {
    const { dir, argvFile } = shimDir('ok');
    const { ctx } = harness(dir);
    const task = mkTask();
    await writePushIntent(dir, task.taskId, {
      project: 'p', workflowSlug: 'wf', file: 'main.yml', appName: 'My App', appId: 'ALREADY',
    });

    await withDify(() => runImportAndFinish(task, ctx));

    assert.equal(pushes(argvFile).length, 0, 'a create that may have landed must never be pushed again');
    assert.equal(task.appId, 'ALREADY');
  });
});

// ── the three defects an adversarial review of this change found, each reproduced before it was fixed ──

describe('④ import — the overwrite target must never be a GUESS', () => {
  test('a name-reconciled id is used as the app link but NEVER remembered as the overwrite target', async () => {
    // The launder: a create push that returns no app id (the probed DSL-mismatch shape) falls through to
    // reconcileAppIdByName, which matches on NAME — and this build's live-test throwaway apps carry the
    // same name. Remembering that guess would make the next round overwrite the test app, which the next
    // re-test then deletes, taking the imported workflow with it.
    const { dir } = shimDir('ok');
    // Answer the create push with exit-0-but-no-app-id, and let `list` offer exactly one same-named app.
    writeFileSync(
      join(dir, '.venv', 'bin', 'python'),
      `#!/usr/bin/env bash
case "$2" in
  push) echo '{"id":"rec","status":"pending","app_id":null}' ;;
  list) printf '  %-38s %-14s %s\\n' 'TESTAPP-1' 'workflow' 'My App' ;;
  *) echo '{}' ;;
esac
`,
      { mode: 0o755 }
    );
    const { ctx } = harness(dir);
    const task = mkTask({ testApps: ['TESTAPP-1'] });

    await withDify(() => runImportAndFinish(task, ctx));

    assert.equal(task.appId, 'TESTAPP-1', 'the reconcile still fills the link, exactly as before');
    assert.equal(task.importAppId, undefined, 'but a guess must never become something we overwrite');
  });
});

describe('④ import — a workflow that changes TYPE cannot be overwritten', () => {
  test('workflow → advanced-chat creates a NEW app and says why', async () => {
    // Dify's import-into-existing-app path installs the graph but never reassigns `app.mode`, and the
    // draft workflow is typed from the APP's mode — so overwriting here yields a structurally mismatched
    // app instead of an error. A fix round can legitimately change the type ("make it a chatbot").
    const { dir, argvFile } = shimDir('ok');
    writeWorkflow(dir, 'advanced-chat');
    const { ctx, reportOpts } = harness(dir);
    const task = mkTask({ importAppId: 'OLDAPP', importAppMode: 'workflow', appId: 'OLDAPP' });

    await withDify(() => runImportAndFinish(task, ctx));

    assert.ok(!pushes(argvFile)[0].includes('--app-id'), 'a type change disqualifies the overwrite');
    assert.equal(task.status, 'done');
    assert.equal(task.importAppId, 'NEWID', 'the new app of the right type takes over');
    assert.equal(task.importAppMode, 'advanced-chat');
    assert.match(reportOpts[0].duplicateWarning ?? '', /changed type/);
  });

  test('an unreadable mode is treated as "cannot prove it is unchanged" → create, never a broken app', async () => {
    const { dir, argvFile } = shimDir('ok');
    writeFileSync(join(dir, 'projects', 'p', 'wf', 'workflows', 'main.yml'), 'kind: app\nworkflow: {}\n');
    const { ctx } = harness(dir);
    const task = mkTask({ importAppId: 'OLDAPP', importAppMode: 'workflow', appId: 'OLDAPP' });

    await withDify(() => runImportAndFinish(task, ctx));

    assert.ok(!pushes(argvFile)[0].includes('--app-id'));
  });
});

describe('④ import — the failure message must describe the real failure', () => {
  test('an exit-0 "pending" reports the response, not an invented non-zero exit', async () => {
    const { dir } = shimDir('pending');
    const { ctx } = harness(dir);
    const task = mkTask({ importAppId: 'KEEPME', importAppMode: 'workflow', appId: 'KEEPME' });

    await withDify(() => runImportAndFinish(task, ctx));

    assert.equal(task.status, 'error');
    assert.match(task.error ?? '', /pending/, 'the actual Dify response is what the user needs to see');
    assert.doesNotMatch(task.error ?? '', /exited non-zero/, 'it exited ZERO — sending them to hunt a crash wastes their time');
  });
});

describe('readAppMode', () => {
  test('reads the top-level app.mode and ignores a node mode deeper in the graph', () => {
    const yaml = [
      'app:', "  description: ''", '  mode: advanced-chat', '  name: X',
      'kind: app', 'workflow:', '  graph:', '    nodes:', '    - data:', '        mode: chat', '        type: llm',
    ].join('\n');
    assert.equal(readAppMode(yaml), 'advanced-chat');
  });

  test('quoted values, and null when there is no app block or no mode', () => {
    assert.equal(readAppMode("app:\n  mode: 'workflow'\n"), 'workflow');
    assert.equal(readAppMode('kind: app\nworkflow: {}\n'), null);
    assert.equal(readAppMode("app:\n  name: X\nkind: app\n"), null);
    assert.equal(readAppMode(''), null);
  });
});
