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
    assert.match(note, /^preflight: not runnable out-of-the-box — needs: /);
    assert.match(note, /llm n1/);
    assert.match(note, /Advisory — does not block the build\.$/);
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
