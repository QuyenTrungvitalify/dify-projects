/**
 * ③ must be HANDED the shapes its pattern lacks — never sent looking for them.
 *
 * implement.md tells ③ to build from the approved pattern and to NEVER search for one (the pick was
 * ~40% of a phase's tool calls). But a build composes SHAPES and the approved pattern is ONE file. A
 * trigger→fetch→notify build that sends per row needs `scheduled-fetch-notify` (trigger/http/llm) AND
 * an `iteration` example — which that pattern has none of. ③ then holds a rule it cannot obey and no
 * sanctioned way out, so it searches, and search is precisely what the sandbox denies:
 *
 *   run 1784267358546 — SPEC named no file → 25 hook-denied greps for an iteration example → 53 turns
 *   run 1784263317775 — SPEC happened to name `per-row-notify`  → ③ just opened it       → 15 turns
 *
 * The fast run was LUCKY, not correct: naming the path in SPEC.md breaks SKILL.md's "never surface the
 * machinery … don't cite where it lives", which is right for the human reading SPEC.md at the ② gate.
 * So the pointer cannot live in human prose. It rides the machine channel beside {{PATTERN_PATH}},
 * resolved by the backend from data it already has — the ① gap and index.json. Zero agent turns.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gapReferences, patternFeatureGap } from '../server/lib/analysis.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('gapReferences — the real regression (run 1784267358546)', () => {
  // Verbatim from that run's analyze.json.
  const PATTERN = 'scheduled-fetch-notify';
  const FEATURES = ['trigger', 'http-request', 'code', 'if-else', 'llm', 'iteration'];

  test('the gap the run hit is still the gap', () => {
    assert.deepEqual(patternFeatureGap(REPO, PATTERN, FEATURES), ['if-else', 'iteration']);
  });

  test('it resolves to the same file the FAST run used — one Read instead of 25 denied greps', () => {
    assert.deepEqual(gapReferences(REPO, PATTERN, FEATURES), ['templates/patterns/per-row-notify.yml']);
  });

  test('it prefers the LEANEST file that covers the gap (per-row-notify 9 nodes, not -excel 12)', () => {
    const out = gapReferences(REPO, PATTERN, FEATURES);
    assert.ok(!out.some((p) => p.includes('excel')), `picked the bigger twin: ${out}`);
  });

  test('it is deterministic — the same inputs give the same answer every time', () => {
    const a = gapReferences(REPO, PATTERN, FEATURES);
    for (let i = 0; i < 5; i++) assert.deepEqual(gapReferences(REPO, PATTERN, FEATURES), a);
  });
});

describe('gapReferences — every unknown degrades to today’s behavior (never a wrong pointer)', () => {
  test('a pattern that covers everything needs no reference', () => {
    assert.deepEqual(gapReferences(REPO, 'per-row-notify', ['iteration', 'llm']), []);
  });
  test('custom / blank / featureless builds are silent', () => {
    assert.deepEqual(gapReferences(REPO, 'custom', ['iteration']), []);
    assert.deepEqual(gapReferences(REPO, '', ['iteration']), []);
    assert.deepEqual(gapReferences(REPO, 'scheduled-fetch-notify', []), []);
    assert.deepEqual(gapReferences(REPO, 'scheduled-fetch-notify', undefined), []);
  });
  test('a gap NOTHING indexed can cover yields nothing — not a guess', () => {
    assert.deepEqual(gapReferences(REPO, 'scheduled-fetch-notify', ['quantum-blockchain']), []);
  });
  test('a missing index is not an error — ③ simply gets no extra pointer', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gapref-empty-'));
    try {
      assert.deepEqual(gapReferences(dir, 'scheduled-fetch-notify', ['iteration']), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('gapReferences — the index is data, and ③ opens what it names WITHOUT checking', () => {
  let dir: string;
  const withIndex = (entries: unknown[]): string => {
    dir = mkdtempSync(join(tmpdir(), 'gapref-'));
    mkdirSync(join(dir, 'tools', 'dify_base'), { recursive: true });
    writeFileSync(join(dir, 'tools/dify_base/index.json'), JSON.stringify(entries));
    return dir;
  };
  const base = { source: 'patterns', file: 'seed.yml', node_count: 3, has_llm: true };

  test('a traversal in `file` is refused — implement.md says open it, so this is a handed-over path', () => {
    const d = withIndex([base, { source: 'patterns', file: '../../../etc/passwd', node_count: 1, has_iteration: true }]);
    try {
      assert.deepEqual(gapReferences(d, 'seed', ['iteration']), [], 'must not hand ③ a path out of templates/');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('a nested or non-.yml `file` is refused (patternPath’s allowlist, same reasoning)', () => {
    const d = withIndex([
      base,
      { source: 'patterns', file: 'sub/dir/x.yml', node_count: 1, has_iteration: true },
      { source: 'patterns', file: 'x.yaml', node_count: 1, has_iteration: true },
    ]);
    try {
      assert.deepEqual(gapReferences(d, 'seed', ['iteration']), []);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('a corrupt index is survivable', () => {
    const d = mkdtempSync(join(tmpdir(), 'gapref-bad-'));
    mkdirSync(join(d, 'tools', 'dify_base'), { recursive: true });
    writeFileSync(join(d, 'tools/dify_base/index.json'), '{not json');
    try {
      assert.deepEqual(gapReferences(d, 'seed', ['iteration']), []);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('the chosen pattern is never handed back to itself as a reference', () => {
    const d = withIndex([{ source: 'patterns', file: 'seed.yml', node_count: 3, has_llm: true, has_iteration: true }]);
    try {
      assert.deepEqual(gapReferences(d, 'seed', ['iteration']), [], 'it IS the pattern — already open');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('the file count is capped — reading examples is not free either', () => {
    const d = withIndex([
      base,
      { source: 'patterns', file: 'a.yml', node_count: 1, has_iteration: true },
      { source: 'patterns', file: 'b.yml', node_count: 1, has_if_else: true },
      { source: 'patterns', file: 'c.yml', node_count: 1, has_code: true },
    ]);
    try {
      assert.equal(gapReferences(d, 'seed', ['iteration', 'if-else', 'code'], 2).length, 2);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('one file covering two gap features beats two files covering one each', () => {
    const d = withIndex([
      base,
      { source: 'patterns', file: 'both.yml', node_count: 9, has_iteration: true, has_if_else: true },
      { source: 'patterns', file: 'iter-only.yml', node_count: 2, has_iteration: true },
    ]);
    try {
      assert.deepEqual(gapReferences(d, 'seed', ['iteration', 'if-else']), ['templates/patterns/both.yml']);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
