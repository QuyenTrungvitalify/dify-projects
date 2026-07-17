/**
 * The ① pattern-coverage advisory must be RE-CHECKED against the delivered workflow before ④ repeats it.
 *
 * `patternAdvisory` runs inside the Analyze turn — before ③ has written a single line of YAML — so the
 * only comparison available to it is "what the analysis says it needs" vs "what the seed template
 * ships". That is a fair heads-up AT THE ① GATE. It is not a fair claim at ④, because ③ routinely
 * closes the gap itself.
 *
 * Observed on run 1784263317775 (a JA trigger→GAS→ChatWork build): the analysis needed
 * ['trigger','http-request','code','if-else','llm','iteration'] and picked the `scheduled-fetch-notify`
 * seed, which ships no `iteration`. ③ then built the per-row send WITH an iteration node — and ④ still
 * told the user the template "doesn't cover ... iteration ... worth checking it does what you need",
 * sending them hunting for a hole that was already filled.
 *
 * `if-else` in that same run is the counter-case: the build deliberately folded the row filter into a
 * `code` node, so the delivered file really has no if-else and the user genuinely may want to know.
 * The re-check must drop ONLY what it can PROVE is present.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliveredFeature, runReport } from '../server/lib/report.js';
import { patternAdvisoryLine } from '../server/lib/analysis.js';
import { createTask } from '../server/state/task.js';
import type { SessionLogger } from '../server/lib/claude-session.js';

/** The shape run 1784263317775 delivered: a trigger entry + iteration, and NO if-else. */
const DELIVERED = [
  'workflow:',
  '  graph:',
  '    nodes:',
  '    - data:',
  '        type: trigger-schedule',
  '        timezone: Asia/Tokyo',
  '    - data:',
  '        type: http-request',
  '    - data:',
  '        type: code',
  '    - data:',
  '        type: iteration',
  '    - data:',
  "        type: 'llm'",
  '    - data:',
  '        type: iteration-start',
].join('\n');

describe('deliveredFeature — is the feature really in the built workflow?', () => {
  test('a node type present in the file reads true, quoted or bare', () => {
    assert.equal(deliveredFeature(DELIVERED, 'iteration'), true);
    assert.equal(deliveredFeature(DELIVERED, 'http-request'), true);
    assert.equal(deliveredFeature(DELIVERED, 'code'), true);
    assert.equal(deliveredFeature(DELIVERED, 'llm'), true, 'quoted `type: \'llm\'` must still match');
  });

  test('a node type ABSENT from the file reads false — the advisory must survive for it', () => {
    assert.equal(deliveredFeature(DELIVERED, 'if-else'), false);
    assert.equal(deliveredFeature(DELIVERED, 'agent'), false);
  });

  test('`trigger` is the FAMILY key — any trigger-* node satisfies it (mirrors build_index.py has_trigger)', () => {
    assert.equal(deliveredFeature(DELIVERED, 'trigger'), true);
    assert.equal(deliveredFeature('workflow:\n  graph:\n    nodes:\n    - data:\n        type: start\n', 'trigger'), false);
  });

  test('a hyphenated feature is matched literally, not as a regex', () => {
    // 'if-else' must not let '-' or any metachar widen the match; `type: ifXelse` is a different node.
    assert.equal(deliveredFeature('    - data:\n        type: ifXelse\n', 'if-else'), false);
  });

  test('a type PREFIXED by the feature name is not a match (`llm` must not match `llm-foo`)', () => {
    assert.equal(deliveredFeature('    - data:\n        type: llm-foo\n', 'llm'), false);
  });
});

describe('the ④ re-check — run 1784263317775, the regression this fixes', () => {
  // What ① computed against the seed pattern (scheduled-fetch-notify ships neither).
  const gapAtAnalyze = ['if-else', 'iteration'];

  test('① keeps its full heads-up: at the Analyze gate no YAML exists yet', () => {
    const note = patternAdvisoryLine(gapAtAnalyze);
    assert.ok(note?.includes('if-else') && note.includes('iteration'));
  });

  test('④ drops `iteration` — ③ built it — and keeps `if-else`, which really is absent', () => {
    const still = gapAtAnalyze.filter((f) => !deliveredFeature(DELIVERED, f));
    assert.deepEqual(still, ['if-else']);
    const note = patternAdvisoryLine(still);
    assert.ok(note?.includes('if-else'), 'a genuinely missing feature is still reported');
    assert.ok(!note?.includes('iteration'), 'the delivered iteration must NOT be reported as a gap');
  });

  test('a build that fills the WHOLE gap emits no advisory at all', () => {
    const still = ['iteration', 'http-request'].filter((f) => !deliveredFeature(DELIVERED, f));
    assert.deepEqual(still, []);
    assert.equal(patternAdvisoryLine(still), null, 'nothing missing ⇒ no note (not an empty-parens line)');
  });
});

// ── runReport integration: the wiring, not just the predicates ───────────────────────────────────
// The units above stay green even if report.ts goes back to pushing task.patternAdvisory verbatim.
// This is the test that actually fails on the old code.

const PROJECT = 'proj_adv';
const SLUG = 'wf_adv';
const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;
let dir: string;

/** The seed ships trigger/http/code/llm and NO iteration — `scheduled-fetch-notify`'s real shape. */
const INDEX = JSON.stringify([
  {
    source: 'patterns',
    file: 'seed-no-iteration.yml',
    has_trigger: true,
    has_http_request: true,
    has_code: true,
    has_llm: true,
    has_iteration: false,
    has_if_else: false,
  },
]);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'adv-'));
  const bin = join(dir, '.venv', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'python'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 }); // linters → 0
  mkdirSync(join(dir, 'tools', 'dify_base'), { recursive: true });
  writeFileSync(join(dir, 'tools', 'dify_base', 'index.json'), INDEX);
  const wf = join(dir, 'projects', PROJECT, SLUG, 'workflows');
  mkdirSync(wf, { recursive: true });
  writeFileSync(join(wf, 'main.yml'), DELIVERED); // ③ built the iteration the seed lacked
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('runReport — the ④ note names only what the delivered file still lacks', () => {
  test('the gap ③ closed is not repeated to the user; the one it left is', async () => {
    const task = await createTask(dir, { requirement: 'x', project: PROJECT, slug: SLUG, deploy: 'none' });
    task.analysisPattern = 'seed-no-iteration';
    task.analysisFeatures = ['iteration', 'if-else'];
    // What ① wrote, verbatim — the string ④ used to echo no matter what ③ delivered.
    task.patternAdvisory = patternAdvisoryLine(['if-else', 'iteration'])!;

    const rep = await runReport(dir, task, log);
    const report = JSON.parse(readFileSync(join(dir, rep.reportRel), 'utf8'));

    assert.ok(
      !/doesn't cover everything you asked for \([^)]*iteration/.test(report.notes),
      'the delivered iteration must not be reported as a gap (the run-1784263317775 regression)'
    );
    assert.match(report.notes, /doesn't cover everything you asked for \(if-else\)/);
    assert.equal(rep.lintClean, true, 'the advisory never touches the lint verdict');
  });

  test('an unreadable workflow FAILS OPEN — ①\'s line survives rather than vanishing', async () => {
    rmSync(join(dir, 'projects', PROJECT, SLUG, 'workflows', 'main.yml'));
    const task = await createTask(dir, { requirement: 'x', project: PROJECT, slug: SLUG, deploy: 'none' });
    task.analysisPattern = 'seed-no-iteration';
    task.analysisFeatures = ['iteration', 'if-else'];
    task.patternAdvisory = patternAdvisoryLine(['if-else', 'iteration'])!;

    const rep = await runReport(dir, task, log);
    const report = JSON.parse(readFileSync(join(dir, rep.reportRel), 'utf8'));
    assert.match(report.notes, /if-else, iteration/, 'no file to check ⇒ keep the ① warning, never drop it');
  });
});
