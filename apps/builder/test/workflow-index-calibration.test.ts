/**
 * Spec 098 R-calib — the node map, checked against a real YAML parser.
 *
 * `workflow-index.ts` reads Dify YAML without a parser (the server ships one runtime dependency, on
 * purpose). The failure that matters is not "it crashes" but "it is confidently wrong": a map that omits
 * a node, or reports no edges, sends the model off to answer about a workflow that does not exist.
 * Development produced three such maps before anyone noticed — items at the same indent as their key
 * (24 of 25 real files), a comment between items (2 files), and a quoted scalar whose continuation lines
 * start at column 0 (a 6-node file reported as 5, missing its `end` node).
 *
 * So the scan is calibrated against `python yaml` and the answer is FROZEN in
 * `fixtures/workflow-index-golden.json`. This test needs no python: it compares the scan to that golden
 * on every run. Regenerate with `python3 apps/builder/test/helpers/workflow-index-golden.py` whenever
 * `workflow-index.ts` changes or a pinned workflow is edited on purpose — and read the diff.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildWorkflowIndex } from '../server/lib/workflow-index.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const GOLDEN = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'workflow-index-golden.json'), 'utf8')
) as Record<string, { ids: string[]; edges: string[]; types: Record<string, string>; parents: Record<string, string> }>;

/** Parse the rendered map back into the facts it claims — the prompt is the only surface that matters,
 *  so the assertions read what the model would read, not internal state. */
function claims(text: string): { ids: string[]; types: Record<string, string>; parents: Record<string, string>; edges: string[] } {
  const ids: string[] = [];
  const types: Record<string, string> = {};
  const parents: Record<string, string> = {};
  const edges: string[] = [];
  let mode = '';
  for (const line of text.split('\n')) {
    if (/^\d+ nodes:$/.test(line)) { mode = 'n'; continue; }
    if (/^\d+ edges:$/.test(line)) { mode = 'e'; continue; }
    if (!line.startsWith('  ')) { mode = ''; continue; }
    const t = line.trim();
    if (mode === 'n') {
      const inside = t.match(/ \[inside ([^\]]+)\]$/);
      const parts = t.replace(/ \[inside [^\]]+\]$/, '').split(' | ');
      ids.push(parts[0]);
      if (parts[1]) types[parts[0]] = parts[1];
      if (inside) parents[parts[0]] = inside[1];
    } else if (mode === 'e') edges.push(t);
  }
  return { ids, types, parents, edges };
}

describe('spec 098 R-calib — the map matches a real parser on every committed workflow', () => {
  const paths = Object.keys(GOLDEN);

  test('the golden covers the real corpus (a shrunken pin is a silent loss of coverage)', () => {
    assert.ok(paths.length >= 15, `golden pins only ${paths.length} workflows — regenerate it`);
    assert.ok(paths.some((p) => p.startsWith('templates/patterns/')), 'the curated patterns are pinned');
    assert.ok(
      paths.some((p) => Object.keys(GOLDEN[p].parents).length > 0),
      'at least one pinned workflow has an iteration body — that shape broke the map once'
    );
  });

  for (const rel of paths) {
    test(`${rel} — every node id, type, parent and edge matches the parser`, () => {
      const idx = buildWorkflowIndex(readFileSync(join(ROOT, rel), 'utf8'));
      const want = GOLDEN[rel];
      assert.equal(idx.ok, true, `${rel}: the scan gave up on a workflow it used to understand`);
      const got = claims(idx.text);
      assert.deepEqual(got.ids, want.ids, `${rel}: node ids drifted from the parser's`);
      assert.deepEqual(got.edges, want.edges, `${rel}: edges drifted from the parser's`);
      for (const [id, type] of Object.entries(want.types)) {
        // A title long enough to be clipped is the only reason a rendered type line can differ.
        assert.equal(got.types[id], type, `${rel}: node ${id} reported as ${got.types[id]}, parser says ${type}`);
      }
      assert.deepEqual(got.parents, want.parents, `${rel}: iteration membership drifted`);
    });
  }

  // The other half of R-calib: shapes the scan must REFUSE. `lint_refs` fixtures are written flow-style
  // (`data: {type: llm}`), which yields ids and nothing else — the map would claim a workflow with no
  // connections. Refusing sends the caller to the file itself, which is merely expensive, not wrong.
  for (const rel of ['tests/fixtures/lint_refs/reach_allow.yml', 'tests/fixtures/lint_refs/reach_loop_valid.yml']) {
    test(`${rel} — a shape the scan does not understand is refused, not guessed`, () => {
      const idx = buildWorkflowIndex(readFileSync(join(ROOT, rel), 'utf8'));
      assert.equal(idx.ok, false, `${rel}: flow-style YAML must not render as a map`);
      assert.equal(idx.text, '', 'a refused scan publishes nothing');
    });
  }
});
