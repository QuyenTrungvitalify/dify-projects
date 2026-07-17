/**
 * Spec 037 S1 — the runnability preflight detector.
 *
 * Two layers:
 *   1. PURE classification (classifyRunnability/preflightNote) — AC 1/1b/1c semantics with planted
 *      facts, no python needed.
 *   2. PARITY (AC 2): run the REAL probe + classify AND the /report skill's report_structure.py
 *      over the SAME fixtures; compare `runnable_blocker_classes`. This is the STANDING guard
 *      against D1's two-sources-of-truth drift — under CI it HARD-FAILS if python is unavailable
 *      (a skipped guard must never look green in CI; the builder job installs python+pyyaml).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyRunnability,
  preflightNote,
  hasUnresolvedPluginTodo,
  RUNNABILITY_PROBE,
  type RunnabilityFacts,
  type RunnabilityBlocker,
} from '../server/lib/runnability.js';

const REPO = join(import.meta.dirname, '..', '..', '..');
const FIXTURES = join(import.meta.dirname, 'fixtures', 'runnability');
const REPORT_STRUCTURE = join(REPO, '.claude', 'skills', 'report', 'report_structure.py');

const facts = (partial: Partial<RunnabilityFacts>): RunnabilityFacts => ({
  kind: 'runnability_facts',
  model_nodes: [],
  code_nodes: [],
  kr_nodes: [],
  ...partial,
});

describe('classifyRunnability (pure — AC 1/1b/1c semantics)', () => {
  test('AC 1: each fact class maps to its blocker; a clean file maps to none', () => {
    const p = classifyRunnability(
      facts({
        model_nodes: [{ id: 'n1', type: 'llm', empty: true }],
        code_nodes: [{ id: 'n2', nonstdlib: ['requests'] }],
        kr_nodes: [{ id: 'n3', empty: true }],
      }),
      'dependencies: []  # TODO add plugin hash\n'
    );
    assert.deepEqual(
      p.blockers.map((b) => b.class).sort(),
      ['dataset_empty', 'model_empty', 'plugin_todo', 'sandbox_trap']
    );

    const clean = classifyRunnability(
      facts({
        model_nodes: [{ id: 'n1', type: 'llm', empty: false }],
        code_nodes: [{ id: 'n2', nonstdlib: [] }],
        kr_nodes: [{ id: 'n3', empty: false }],
      }),
      'dependencies:\n  - real\n'
    );
    assert.deepEqual(clean.blockers, []);
    assert.equal(preflightNote(clean), null, 'no blockers → null → the note is CLEARED');
  });

  test('the note is one advisory line, itemized, self-declaring as non-blocking', () => {
    const p = classifyRunnability(
      facts({ model_nodes: [{ id: 'n1', type: 'llm', empty: true }] }),
      ''
    );
    const note = preflightNote(p)!;
    // spec 066 S5: the FRAME is plain too — no "preflight"/"Advisory", capitalised and
    // self-terminating so `noteParts.join(' ')` can never fuse it onto the lint line again.
    assert.match(note, /^Before this workflow can run, you need to: /);
    for (const jargon of ['preflight', 'Advisory', 'out-of-the-box']) {
      assert.ok(!note.includes(jargon), `frame jargon "${jargon}" must not reach the user`);
    }
    // spec 064: the human detail is PLAIN reassurance and carries NO raw node id — `n1` stays on
    // the structured blocker (asserted below) for dev/`/report`, out of the text a user reads.
    assert.match(note, /the AI model \(filled in automatically when you test/);
    assert.ok(!note.includes('n1'), 'no raw node id in the human note (spec 064)');
    assert.equal(p.blockers[0].nodeId, 'n1', 'the id still rides the structured blocker');
    assert.match(note, /\(The build itself is finished — these are setup steps in Dify\.\)$/,
      'still self-declares as non-blocking — in words a user parses, and it TERMINATES (066 S5)');
  });

  // ── spec 066 S3: the model advisory may only PROMISE auto-fill when auto-fill can happen ────────
  test('S3: the model reassurance is only made when a model EXISTS to auto-fill', () => {
    const f = facts({ model_nodes: [{ id: 'n1', type: 'llm', empty: true }] });
    // no ctx → the pre-066 wording, byte-identical (every existing caller unchanged)
    assert.match(classifyRunnability(f, '').blockers[0].detail, /filled in automatically when you test/);
    // the REAL dossier's shape: workspace `models: []` → live-test.ts:269-270 takes the 0-model
    // degrade, so the llm node keeps provider:'' and the user MUST add a model. 064 told them
    // "nothing to set up" — the most reassuring line in the note, about the guaranteed failure.
    const lying = classifyRunnability(f, '', { workspaceModelCount: 0 }).blockers[0].detail;
    assert.ok(!lying.includes('nothing to set up'), 'must NOT promise auto-fill with no model to inject');
    assert.match(lying, /add one in Dify/);
    // a model exists → the reassurance is TRUE, so keep it
    assert.match(classifyRunnability(f, '', { workspaceModelCount: 3 }).blockers[0].detail,
      /filled in automatically when you test/);
    // NOT keyed on deploy: a `none` run can still be live-tested from the UI (live-test.ts never
    // reads task.deploy), so flipping the wording on deploy alone would be a lie in the other
    // direction. This assertion pins that deliberate scope.
    assert.match(classifyRunnability(f, '', { workspaceModelCount: 3 }).blockers[0].detail,
      /nothing to set up/);
  });

  // ── spec 066 S2: the fifth class ────────────────────────────────────────────────────────────────
  test('S2: env_secret_empty fires only when a var is BOTH empty AND referenced', () => {
    const withEnv = (env: RunnabilityFacts['env_vars']): RunnabilityBlocker[] =>
      classifyRunnability(facts({ env_vars: env }), '').blockers;

    assert.deepEqual(
      withEnv([{ name: 'SLACK_WEBHOOK_URL', value_type: 'secret', empty: true, referenced: true }])
        .map((b) => b.class),
      ['env_secret_empty'], 'empty + used → the user must paste a value'
    );
    assert.deepEqual(
      withEnv([{ name: 'UNUSED', value_type: 'string', empty: true, referenced: false }]), [],
      'empty but referenced by NOBODY → not a blocker (an unused var costs the user nothing)'
    );
    assert.deepEqual(
      withEnv([{ name: 'PRESET', value_type: 'string', empty: false, referenced: true }]), [],
      'already has a value → nothing to do'
    );
    const b = withEnv([{ name: 'SLACK_WEBHOOK_URL', value_type: 'secret', empty: true, referenced: true }])[0];
    assert.equal(b.varName, 'SLACK_WEBHOOK_URL', 'the name rides the structured blocker for dev');
    assert.match(b.detail, /SLACK_WEBHOOK_URL/, 'and the human text NAMES it — the user must find it in Dify');
    for (const jargon of ['env_secret_empty', 'value_selector', 'environment_variables']) {
      assert.ok(!b.detail.includes(jargon), `no jargon "${jargon}" in the human text`);
    }
  });

  test('S2: a pre-066 probe (no env_vars field) degrades to no blockers, never a crash', () => {
    assert.deepEqual(classifyRunnability(facts({}), '').blockers, []);
  });

  // The guard that was missing. The id-free / jargon-free invariant was only ever asserted for
  // `model_empty` (the test above builds `p` from model_nodes alone), so `sandbox_trap` and
  // `dataset_empty` kept shipping a bare 13-digit node id and `dataset_ids` into the text a user
  // reads — and failed the project's own comprehension gate. Assert it for EVERY class at once, so
  // a new class cannot be added without meeting the same bar.
  test('EVERY blocker detail is free of node ids and machine jargon — all five classes', () => {
    const p = classifyRunnability(
      facts({
        model_nodes: [{ id: '1784192635197', type: 'llm', empty: true }],
        code_nodes: [{ id: '1784192635198', nonstdlib: ['requests'] }],
        kr_nodes: [{ id: '1784192635199', empty: true }],
        env_vars: [{ name: 'SLACK_WEBHOOK_URL', value_type: 'secret', empty: true, referenced: true }],
      }),
      'dependencies: []  # TODO add plugin hash\n'
    );
    assert.equal(p.blockers.length, 5, 'all five classes fire — otherwise this test proves nothing');

    for (const b of p.blockers) {
      assert.doesNotMatch(b.detail, /\b\d{13}\b/, `${b.class}: a bare node id must not reach the user`);
      for (const jargon of ['dataset_ids', 'value_selector', 'provider_', 'tool_name', 'plugin hash',
        'dependencies', '# TODO', 'non-stdlib', 'knowledge-retrieval']) {
        assert.ok(!b.detail.includes(jargon), `${b.class}: leaks "${jargon}" into the human text`);
      }
    }
    // …and the ids are still on the structured object, for dev / `/report`.
    const byClass = Object.fromEntries(p.blockers.map((b) => [b.class, b]));
    assert.equal(byClass.model_empty.nodeId, '1784192635197');
    assert.equal(byClass.sandbox_trap.nodeId, '1784192635198');
    assert.equal(byClass.dataset_empty.nodeId, '1784192635199');
    assert.equal(byClass.env_secret_empty.varName, 'SLACK_WEBHOOK_URL');
    // sandbox_trap must still name the MODULES — that is the part the user can act on.
    assert.match(byClass.sandbox_trap.detail, /requests/);
  });

  test('plugin_todo rides hasUnresolvedPluginTodo (moved here from report.ts — same semantics)', () => {
    assert.equal(hasUnresolvedPluginTodo('dependencies: []  # TODO add plugin hash\n'), true);
    assert.equal(hasUnresolvedPluginTodo('dependencies:\n  - filled\n# TODO plugin hash stale\n'), false);
    assert.equal(hasUnresolvedPluginTodo('dependencies: []\n'), false, 'no marker → not flagged');
  });
});

// ── AC 2 parity: python probe + TS classify ⇔ report_structure.py, same fixtures ────────────────

/** `.venv/bin/python` locally; `python3` on CI (the builder job installs 3.12 + pyyaml). */
function resolvePython(): string | null {
  const venv = join(REPO, '.venv', 'bin', 'python');
  for (const bin of [venv, 'python3']) {
    if (bin !== venv || existsSync(venv)) {
      try {
        execFileSync(bin, ['-c', 'import yaml'], { stdio: 'pipe' });
        return bin;
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

describe('AC 2 — Python↔TS parity over shared fixtures', () => {
  const python = resolvePython();

  test('python with pyyaml is available (HARD requirement under CI)', (t) => {
    if (!python && process.env.CI) {
      assert.fail('CI has no usable python+pyyaml — the parity guard would silently rot (spec 037 AC 2)');
    }
    if (!python) t.skip('no python+pyyaml locally — parity ran nowhere (install the repo .venv)');
  });

  for (const fname of readdirSync(FIXTURES).filter((f) => f.endsWith('.yml'))) {
    test(`parity: ${fname}`, (t) => {
      if (!python) return t.skip('no python+pyyaml');
      const abs = join(FIXTURES, fname);

      // TS side: real probe → pure classify.
      const probeOut = execFileSync(python!, ['-c', RUNNABILITY_PROBE, abs], { encoding: 'utf8' });
      const p = classifyRunnability(JSON.parse(probeOut) as RunnabilityFacts, readFileSync(abs, 'utf8'));
      const tsClasses = [...new Set(p.blockers.map((b) => b.class))].sort();

      // Python side: the /report skill's analyzer (runnable_blocker_classes — the r2 machine field).
      const pyOut = execFileSync(python!, [REPORT_STRUCTURE, abs], { encoding: 'utf8' });
      const pyClasses = (JSON.parse(pyOut).builder.runnable_blocker_classes as string[]).sort();

      assert.deepEqual(tsClasses, pyClasses, `detector drift on ${fname}`);
    });
  }

  test('fixture coverage: all four classes + the OR-predicate + the 3-type model set exercised', (t) => {
    if (!python) return t.skip('no python+pyyaml');
    const classesOf = (fname: string): string[] => {
      const abs = join(FIXTURES, fname);
      const probeOut = execFileSync(python!, ['-c', RUNNABILITY_PROBE, abs], { encoding: 'utf8' });
      const p = classifyRunnability(JSON.parse(probeOut) as RunnabilityFacts, readFileSync(abs, 'utf8'));
      return [...new Set(p.blockers.map((b) => b.class))].sort();
    };
    assert.deepEqual(classesOf('all_four.yml'), ['dataset_empty', 'model_empty', 'plugin_todo', 'sandbox_trap']);
    assert.deepEqual(classesOf('clean.yml'), []);
    // 1b: provider set + name empty still flags — `!provider || !name`, a weaker `&&` port fails here.
    assert.deepEqual(classesOf('name_empty.yml'), ['model_empty']);
    // 1c: parameter-extractor + question-classifier flag too — an llm-only port fails here.
    const mt = classesOf('model_types.yml');
    assert.deepEqual(mt, ['model_empty']);
  });
});
