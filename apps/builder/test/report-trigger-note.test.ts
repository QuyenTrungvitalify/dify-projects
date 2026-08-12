/**
 * Spec 057 S4 — the trigger-entry manual-enable advisory.
 *
 * A trigger-entry workflow (trigger-schedule / trigger-webhook / trigger-plugin) imports, publishes
 * and even API-runs fine (r3 probes) — but it does NOTHING by itself until the trigger is ENABLED in
 * Dify Studio Quick Settings. `runReport` surfaces that as a NOTE on the deploy paths that import
 * (selfhost/cloud); it NEVER flips `lintClean` or the gate. This pins the pure predicate + the
 * EN wording-stable string (web NOTE_JA keys off it — see web/src/lib/i18n.ts).
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasTriggerEntry, TRIGGER_ENTRY_NOTE, runReport } from '../server/lib/report.js';
import { createTask } from '../server/state/task.js';
import type { SessionLogger } from '../server/lib/claude-session.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;

// The EN string is wording-stable: web/src/lib/i18n.ts NOTE_JA matches it verbatim. Pin it byte-exact.
const EXPECTED_NOTE =
  'trigger-entry workflow: the run above was a manual fire — a schedule or webhook starts firing on ' +
  'its own only once you PUBLISH the workflow in Dify Studio. After publishing, the app page lists ' +
  'the trigger with an on/off switch; check that it is on. (Before you publish, that panel says no ' +
  'trigger has been added, even though the trigger is already in your draft.)';

const TRIGGER_YAML = [
  'workflow:',
  '  graph:',
  '    nodes:',
  '    - data:',
  '        type: trigger-schedule',
  '      id: trig',
  '',
].join('\n');

const START_YAML = TRIGGER_YAML.replace('trigger-schedule', 'start');

describe('TRIGGER_ENTRY_NOTE (wording-stable — NOTE_JA keys off this)', () => {
  test('the EN string is byte-exact', () => {
    assert.equal(TRIGGER_ENTRY_NOTE, EXPECTED_NOTE);
  });
});

describe('hasTriggerEntry (pure)', () => {
  test('trigger-* node type lines → true (bare, single- and double-quoted)', () => {
    assert.equal(hasTriggerEntry(TRIGGER_YAML), true);
    assert.equal(hasTriggerEntry("  type: 'trigger-webhook'\n"), true);
    assert.equal(hasTriggerEntry('  type: "trigger-plugin"\n'), true);
  });
  test('start workflow → false', () => {
    assert.equal(hasTriggerEntry(START_YAML), false);
  });
  test('the word trigger elsewhere (not a type: line) → false', () => {
    assert.equal(hasTriggerEntry('# a trigger-schedule would be nice\ntitle: trigger-happy\n'), false);
  });
});

// ── runReport integration: the advisory rides the import paths only, never flips lintClean ──────

const PROJECT = 'proj_trigger_note';
const SLUG = 'wf_trigger_note';
let dir: string;

/** A `.venv/bin/python` shim that makes every linter exit 0 → lintClean driven only by the codes. */
const SHIM = '#!/usr/bin/env bash\nexit 0\n';

function seedWorkflow(content: string): void {
  const wf = join(dir, 'projects', PROJECT, SLUG, 'workflows');
  mkdirSync(wf, { recursive: true });
  writeFileSync(join(wf, 'main.yml'), content);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trigger-note-'));
  const bin = join(dir, '.venv', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'python'), SHIM, { mode: 0o755 });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** createTask IGNORES input.deploy (spec 036 D3 — deploy is GATE-stamped), so stamp it after,
 *  exactly like the ④ gate / live-test re-entry does. */
async function taskWithDeploy(deploy: 'none' | 'selfhost' | 'cloud') {
  const task = await createTask(dir, { requirement: 'x', project: PROJECT, slug: SLUG });
  task.deploy = deploy;
  return task;
}

describe('runReport — spec 057 S4 trigger-entry advisory', () => {
  test('trigger yaml + selfhost → the pinned EN note is present; lintClean untouched', async () => {
    seedWorkflow(TRIGGER_YAML);
    const task = await taskWithDeploy('selfhost');
    const rep = await runReport(dir, task, log);
    assert.equal(rep.lintClean, true, 'the advisory must NOT flip the lint verdict');
    const report = JSON.parse(readFileSync(join(dir, rep.reportRel), 'utf8'));
    assert.ok(report.notes.includes(EXPECTED_NOTE), 'notes carry the wording-stable EN string');
  });

  test('trigger yaml + cloud → note present too (both import paths)', async () => {
    seedWorkflow(TRIGGER_YAML);
    const task = await taskWithDeploy('cloud');
    const rep = await runReport(dir, task, log);
    const report = JSON.parse(readFileSync(join(dir, rep.reportRel), 'utf8'));
    assert.ok(report.notes.includes(EXPECTED_NOTE));
  });

  test('trigger yaml + deploy=none → NO note (nothing was imported)', async () => {
    seedWorkflow(TRIGGER_YAML);
    const task = await taskWithDeploy('none');
    const rep = await runReport(dir, task, log);
    const report = JSON.parse(readFileSync(join(dir, rep.reportRel), 'utf8'));
    assert.equal(report.notes.includes('trigger-entry workflow'), false);
  });

  test('start yaml + selfhost → NO note (zero behavior change for start workflows)', async () => {
    seedWorkflow(START_YAML);
    const task = await taskWithDeploy('selfhost');
    const rep = await runReport(dir, task, log);
    const report = JSON.parse(readFileSync(join(dir, rep.reportRel), 'utf8'));
    assert.equal(report.notes.includes('trigger-entry workflow'), false);
  });
});
