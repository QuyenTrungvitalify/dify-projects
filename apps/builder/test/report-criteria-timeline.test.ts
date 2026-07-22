/**
 * Spec 075 S1 — runReport INTEGRATION: report.json gains criteria_check + timeline, wired from the
 * criteria.json/events.jsonl the run already wrote. This is the end-to-end proof of the wire-up (the
 * classifier itself is unit-tested in report-analysis.test.ts). Uses the same python-shim +
 * temp-dir pattern as report-trigger-note.test.ts.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runReport } from '../server/lib/report.js';
import { createTask } from '../server/state/task.js';
import type { SessionLogger } from '../server/lib/claude-session.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;
const PROJECT = 'proj_ct';
const SLUG = 'wf_ct';
const SHIM = '#!/usr/bin/env bash\nexit 0\n'; // every linter exits 0 → lintClean
let dir: string;

const START_YAML = ['workflow:', '  graph:', '    nodes:', '    - data:', '        type: start', '      id: s', ''].join('\n');
const TRIGGER_YAML = START_YAML.replace('type: start', 'type: trigger-schedule');

function seedWorkflow(content: string): void {
  const wf = join(dir, 'projects', PROJECT, SLUG, 'workflows');
  mkdirSync(wf, { recursive: true });
  writeFileSync(join(wf, 'main.yml'), content);
}

/** Seed the run-dir artifacts runReport reads for 075: criteria.json + events.jsonl. */
function seedRunArtifacts(taskId: string, criteria: string[], events: object[]): void {
  const runDir = join(dir, 'apps', 'builder', '.runs', taskId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'criteria.json'), JSON.stringify({ criteria }));
  writeFileSync(join(runDir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'crit-tl-'));
  const bin = join(dir, '.venv', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'python'), SHIM, { mode: 0o755 });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function task(deploy: 'none' | 'selfhost' = 'none') {
  const t = await createTask(dir, { requirement: 'x', project: PROJECT, slug: SLUG });
  t.deploy = deploy;
  return t;
}

describe('runReport — spec 075 S1 criteria_check + timeline', () => {
  test('behavioral + validation criteria bucket correctly; timeline folds; note surfaces', async () => {
    seedWorkflow(START_YAML);
    const t = await task();
    seedRunArtifacts(
      t.taskId,
      ['ワークフローファイルがDifyにインポートできる', '売上の合計を日別に集計する'],
      [
        { ts: 1000, kind: 'phase_start', phase: 'analyze' },
        { ts: 1120, kind: 'gate_reached', phase: 'analyze', detail: 'success' },
        { ts: 1120, kind: 'phase_start', phase: 'spec' },
        { ts: 1300, kind: 'gate_reached', phase: 'spec', detail: 'success' },
      ]
    );
    const rep = await runReport(dir, t, log);
    const report = JSON.parse(readFileSync(join(dir, rep.reportRel), 'utf8'));

    assert.equal(report.criteria_check.length, 2);
    // validation-only claim + lint clean (shim) → auto_pass
    assert.equal(report.criteria_check[0].status, 'auto_pass');
    // behavioral claim → manual (never auto_pass)
    assert.equal(report.criteria_check[1].status, 'manual');
    // timeline folded from events
    assert.deepEqual(
      report.timeline.phases.map((p: { phase: string; workingMs: number }) => [p.phase, p.workingMs]),
      [['analyze', 120], ['spec', 180]]
    );
    assert.equal(report.timeline.totalMs, 300);
    // human-facing summary note appears
    assert.match(report.notes, /set 2 acceptance criteria/);
  });

  test('criterion needing a trigger + start-only build → auto_fail (structural impossibility)', async () => {
    seedWorkflow(START_YAML); // no trigger entry
    const t = await task();
    seedRunArtifacts(t.taskId, ['毎日スケジュールで自動起動して通知する'], []);
    const rep = await runReport(dir, t, log);
    const report = JSON.parse(readFileSync(join(dir, rep.reportRel), 'utf8'));
    assert.equal(report.criteria_check[0].status, 'auto_fail');
  });

  test('same trigger criterion + a trigger build → manual, not auto_fail (structure present)', async () => {
    seedWorkflow(TRIGGER_YAML);
    const t = await task();
    seedRunArtifacts(t.taskId, ['毎日スケジュールで自動起動して通知する'], []);
    const rep = await runReport(dir, t, log);
    const report = JSON.parse(readFileSync(join(dir, rep.reportRel), 'utf8'));
    assert.equal(report.criteria_check[0].status, 'manual'); // behavior still needs a live run
  });

  test('no criteria.json / no events → empty check, null timeline, no crash, no note', async () => {
    seedWorkflow(START_YAML);
    const t = await task(); // run-dir artifacts NOT seeded
    const rep = await runReport(dir, t, log);
    const report = JSON.parse(readFileSync(join(dir, rep.reportRel), 'utf8'));
    assert.deepEqual(report.criteria_check, []);
    assert.equal(report.timeline, null);
    assert.doesNotMatch(report.notes, /acceptance criteria/);
    // pre-075 fields still present (backward-compatible)
    assert.ok('workflow_file' in report && 'lint' in report && 'notes' in report);
  });
});
