/**
 * Spec 062 S3 / AC #3 — the `summary.md` generator (lib/dossier.ts). Verifies a DONE run renders every
 * section (intent · flow · acceptance ✓/✗ · the 059 cost table + cause hint · gaps · process · files),
 * that acceptance criteria pick up the live-judge ✓/✗, and — the AC #3 partial-run guarantee — that an
 * errored / in-progress run still produces a COHERENT dossier that flags the missing pieces (no throw).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildDossier, buildDossierData } from '../server/lib/dossier.js';
import type { Task } from '../server/state/task.js';
import type { RunEvent } from '../server/lib/run-events.js';

function mkTask(over: Partial<Task> = {}): Task {
  return {
    taskId: '1784212050431',
    project: 'demo',
    workflowSlug: 'slack_news',
    workflow: 'Slack news',
    workflowFile: 'main.yml',
    requirement: '毎朝9時に指定RSSを取得し、要約してSlackに投稿する',
    seedPath: null,
    seedAppId: null,
    deploy: 'none',
    testMode: 'static',
    confirmMode: 'each_step',
    fastMode: false,
    phase: 'test',
    status: 'done',
    name: 'Slack news bot',
    sessionIds: {},
    artifacts: {},
    ...over,
  };
}

const events: RunEvent[] = [
  { ts: 1, phase: 'analyze', kind: 'phase_start', detail: 'fresh' },
  { ts: 2, phase: 'analyze', kind: 'gate_action', detail: 'confirm' },
  { ts: 3, phase: 'spec', kind: 'phase_start', detail: 'fresh' },
  { ts: 4, phase: 'spec', kind: 'request_changes', detail: 'đổi Slack → Teams' },
  { ts: 5, phase: 'implement', kind: 'phase_start', detail: 'fresh' },
  { ts: 6, phase: 'implement', kind: 'error', detail: 'lint gate: plugin hash TODO' },
  { ts: 7, phase: 'implement', kind: 'retry', detail: 'fix the hash' },
  { ts: 8, phase: 'implement', kind: 'phase_start', detail: 'retry' },
];

describe('buildDossier (spec 062 S3)', () => {
  test('a full done run renders every section', () => {
    const md = buildDossier({
      task: mkTask({
        analysisPattern: 'scheduled-fetch-notify',
        analysisFeatures: ['schedule-trigger', 'http-request', 'llm'],
        // the real note carries its OWN "preflight:" label — the Gaps row must not double it.
        preflightNote: 'preflight: plugin langgenius/slack missing → dependencies TODO',
        cost: {
          spec: { durationMs: 40000, numTurns: 4, cacheReadTokens: 6100, inputTokens: 3900 },
          implement: { durationMs: 120000, numTurns: 11, cacheReadTokens: 3800, inputTokens: 6200, outputTokens: 4000 },
        },
      }),
      events,
      criteria: [{ criterion: 'Posts to Slack at 09:00 JST' }, { criterion: 'Summarizes the feed' }],
      reportNotes: ['Slack node uses placeholder channel #general'],
      files: ['summary.md', 'task.json', 'workflows/main.yml', 'transcripts/implement.md', 'events.jsonl'],
      nodeCount: 6,
      toolStats: {
        implement: { total: 32, fails: 15, byTool: [{ name: 'Bash', count: 18 }, { name: 'Grep', count: 10 }, { name: 'Read', count: 3 }, { name: 'Write', count: 1 }] },
      },
    });

    assert.match(md, /# Run dossier — Slack news bot · 1784212050431/);
    assert.match(md, /\*\*Intent\*\* {4}毎朝9時/);
    assert.match(md, /runnable: no — see Gaps/); // preflightNote present
    assert.match(md, /\*\*Pattern\*\* {3}scheduled-fetch-notify · features \[schedule-trigger, http-request, llm\]/);
    // Flow
    assert.match(md, /## Flow/);
    assert.match(md, /⤺ request-changes {2}"đổi Slack → Teams"/);
    assert.match(md, /✗ ERROR {2}lint gate: plugin hash TODO/);
    // Acceptance
    assert.match(md, /- \[ \] Posts to Slack at 09:00 JST/);
    // Cost table + a cause hint arrow
    assert.match(md, /\| phase \| share \| turns \| cache% \| cause \|/);
    assert.match(md, /\| ③ implement \|/);
    assert.match(md, /→ /);
    // Gaps — the note's own "preflight:" label is stripped so the row isn't doubled
    assert.match(md, /- preflight: plugin langgenius\/slack missing/);
    assert.ok(!md.includes('preflight: preflight:'), 'no doubled label');
    assert.match(md, /- report: {4}Slack node uses placeholder channel #general/);
    // Process: implement had an error + a retry (2 phase-starts) AND the tool-activity tally
    assert.match(md, /③ Implement: 2 phase-starts \(1 error → 2 attempts\) · 32 tool calls, 15 ✗ \(47%\) — 18 Bash · 10 Grep · 3 Read · 1 Write — see transcripts\/implement\.md/);
    assert.match(md, /user steering: .*"đổi Slack → Teams"/);
    // Graph + files
    assert.match(md, /## Graph \(DSL\) {3}6 nodes — workflows\/main\.yml/);
    assert.match(md, /- transcripts\/implement\.md/);
  });

  test('live-judge verdicts mark acceptance ✓ / ✗', () => {
    const md = buildDossier({
      task: mkTask({
        liveTest: {
          verdict: 'workflow_fail',
          label: 'live-verified-fail',
          judge: {
            criteria: [
              { criterion: 'Posts to Slack at 09:00 JST', pass: true },
              { criterion: 'Summarizes the feed', pass: false },
            ],
          },
        },
      }),
      events: [],
      criteria: [{ criterion: 'Posts to Slack at 09:00 JST' }, { criterion: 'Summarizes the feed' }],
      files: ['summary.md'],
    });
    assert.match(md, /- \[x\] Posts to Slack at 09:00 JST ✓/);
    assert.match(md, /- \[ \] Summarizes the feed ✗/);
  });

  test('a partial (errored) run still renders a coherent dossier that flags the gaps', () => {
    const md = buildDossier({
      task: mkTask({ status: 'error', phase: 'implement', error: 'phase timed out after 600s', name: null }),
      events: [{ ts: 1, phase: 'implement', kind: 'error', detail: 'phase timed out after 600s' }],
      files: ['summary.md', 'task.json'],
    });
    assert.match(md, /> ⚠ PARTIAL RUN \(status=error\)/);
    assert.match(md, /- error: {5}phase timed out after 600s/);
    // no cost, no criteria → coherent placeholders, not a throw / blank
    assert.match(md, /no cost recorded/);
    assert.match(md, /no acceptance rubric/);
  });

  test('never throws on an empty/degenerate input', () => {
    assert.doesNotThrow(() =>
      buildDossier({ task: mkTask({ requirement: '', name: null }), events: [], files: [] })
    );
  });

  test('spec 062 #2: buildDossierData is the machine-readable twin (fleet-aggregatable)', () => {
    const d = buildDossierData({
      task: mkTask({
        analysisPattern: 'scheduled-fetch-notify',
        analysisFeatures: ['trigger', 'llm'],
        preflightNote: 'preflight: plugin missing',
        cost: { implement: { durationMs: 120000, numTurns: 11, model: 'claude-opus-4-8' } },
        liveTest: { verdict: 'passed', label: 'live-verified', judge: { criteria: [{ criterion: 'posts to Slack', pass: true }] } },
      }),
      events,
      criteria: [{ criterion: 'posts to Slack' }, { criterion: 'summarizes' }],
      reportNotes: ['channel is a placeholder'],
      files: ['summary.md', 'dossier.json'],
      toolStats: { implement: { total: 14, fails: 2, byTool: [{ name: 'Bash', count: 9 }] } },
    });
    // scalar facts a jq query would key on
    assert.equal(d.taskId, '1784212050431');
    assert.equal(d.status, 'done');
    assert.equal(d.pattern, 'scheduled-fetch-notify');
    assert.deepEqual(d.features, ['trigger', 'llm']);
    assert.equal(d.runnable, false); // preflight flagged
    // cost + cause are structured, not prose
    assert.equal(d.cost.perPhase.implement?.model, 'claude-opus-4-8');
    assert.equal(d.cost.cause?.cause, 'tool-loop');
    assert.equal(d.toolStats.implement?.total, 14);
    // acceptance carries the judge verdict as a boolean
    assert.deepEqual(d.acceptance, [
      { criterion: 'posts to Slack', pass: true },
      { criterion: 'summarizes', pass: null },
    ]);
    // gaps are split fields (labels stripped)
    assert.equal(d.gaps.preflight, 'plugin missing');
    assert.deepEqual(d.gaps.report, ['channel is a placeholder']);
    // round-trips through JSON (it IS the emitted file)
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(d)));
  });
});
