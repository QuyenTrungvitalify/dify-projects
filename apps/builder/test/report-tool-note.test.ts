/**
 * Spec 061 — the plain-language tool post-import checklist.
 *
 * When a workflow has a `tool` node with an unresolved plugin, `runReport` replaces the
 * developer-jargon "add the plugin hash" line with a checklist that NAMES the tool and tells the
 * user what to do after importing (install → set up key → test). It never flips lintClean/the gate.
 * This pins the pure predicates + the wording-stable EN string (web NOTE_JA keys off it) + that the
 * checklist carries NO jargon (so it passes the spec-063 comprehension gate: FAIL → PASS).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hasToolNode, toolLabels, toolInstallNote, joinNotes } from '../server/lib/report.js';

const TOOL_YAML = [
  'workflow:',
  '  graph:',
  '    nodes:',
  '    - data:',
  '        title: JinaReader',
  '        type: tool',
  '        provider_id: jina',
  '        provider_name: jina',
  '        tool_name: jina_reader',
  '        tool_label: JinaReader',
].join('\n');

const NON_TOOL_YAML = 'workflow:\n  graph:\n    nodes:\n    - data:\n        type: llm\n';

// jargon a layperson can't act on — MUST NOT appear in the checklist (mirrors the 063 blocklist).
const JARGON = ['plugin hash', 'dependencies', 'provider_id', '# TODO', 'unresolved_plugin_todo'];

// ── spec 066 S5: the join seam can never fuse two sentences again ────────────────────────────────
// The separator is '\n' (was ' '): the report UI renders notes as a bullet list by splitting on
// newlines (ArtifactPanel `.split('\n')` → <li>), per "format report notes as bullet list" (a4a2942).
describe('spec 066 S5 — joinNotes', () => {
  test('the historical run-on: an unterminated part is terminated BEFORE the join', () => {
    // The real dossier (run 1784192313811) read "all linters passed preflight: not runnable…" —
    // which parses as "all linters passed preflight", i.e. a PASS. The verdict was mid-sentence.
    const out = joinNotes(['all linters passed', 'preflight: not runnable out-of-the-box']);
    assert.ok(!out.includes('passed preflight'), 'the two sentences must not fuse');
    assert.equal(out, 'all linters passed.\npreflight: not runnable out-of-the-box.');
  });

  test('parts that already self-terminate are untouched (. ! ? 。 and a closing paren)', () => {
    assert.equal(joinNotes(['Done.', 'Really?', 'Yes!', '完了しました。', 'See it (here)']),
      'Done.\nReally?\nYes!\n完了しました。\nSee it (here)');
  });

  test('blank/whitespace parts are dropped, never punctuated into noise', () => {
    assert.equal(joinNotes(['A', '', '   ', 'B']), 'A.\nB.');
    assert.equal(joinNotes([]), '');
  });
});

describe('spec 061 — tool install checklist', () => {
  test('hasToolNode detects a tool node, not other node types', () => {
    assert.equal(hasToolNode(TOOL_YAML), true);
    assert.equal(hasToolNode(NON_TOOL_YAML), false);
  });

  // A Dify export — and ANY python `yaml.safe_dump` round-trip — sorts each `data:` block
  // alphabetically, so `type: tool` lands LAST, after every label field. The first cut of toolLabels
  // split at `type:` and read forward, so the sorted form lost every label: hasToolNode still fired,
  // and the checklist rendered "install each from Studio → Plugins" naming NOTHING. Hand-written YAML
  // (every fixture in this file, and the pattern) puts `type` first — which is exactly why no test
  // caught it. This is the shape the user's own workflows actually have.
  const SORTED_EXPORT = [
    'workflow:',
    '  graph:',
    '    nodes:',
    '    - data:',
    '        provider_id: omluc/google_sheets/google_sheets',
    '        provider_name: omluc/google_sheets/google_sheets',
    '        provider_type: builtin',
    '        title: Sheets',
    '        tool_configurations: {}',
    '        tool_label: Batch Update',
    '        tool_name: batch_update',
    '        type: tool',
    '      id: n1',
    '    - data:',
    '        provider_name: langgenius/slack/slack',
    '        provider_type: builtin',
    '        tool_label: Slack Post',
    '        type: tool',
    '      id: n2',
    '',
  ].join('\n');

  test('a SORTED Dify export (type: tool LAST) still names every tool — the ordering regression', () => {
    assert.equal(hasToolNode(SORTED_EXPORT), true);
    assert.deepEqual(toolLabels(SORTED_EXPORT), ['Batch Update', 'Slack Post'],
      'labels must be read per-NODE, not from the text after a `type:` marker');
    assert.match(toolInstallNote(toolLabels(SORTED_EXPORT)), /Batch Update, Slack Post/);
  });

  test('toolLabels extracts one label per tool node (tool_label pref), deduped', () => {
    assert.deepEqual(toolLabels(TOOL_YAML), ['JinaReader']);   // single label, not also "jina"
  });

  test('toolLabels names EVERY tool in a multi-tool workflow (impl-review major)', () => {
    const twoTools = [
      'nodes:',
      '- data:', '    type: tool', '    provider_name: duckduckgo', '    tool_label: DuckDuckGo',
      '- data:', '    type: tool', '    provider_name: jina', '    tool_label: Jina Reader',
    ].join('\n');
    assert.deepEqual(toolLabels(twoTools), ['DuckDuckGo', 'Jina Reader']);
  });

  test('toolInstallNote names ALL tools + is plain-language (no jargon)', () => {
    const note = toolInstallNote(['DuckDuckGo', 'Jina Reader']);
    assert.match(note, /DuckDuckGo/);
    assert.match(note, /Jina Reader/);        // the second tool is NOT dropped
    assert.match(note, /install/i);
    assert.match(note, /test it/i);
    for (const j of JARGON) assert.ok(!note.includes(j), `checklist must not contain jargon "${j}": ${note}`);
  });

  test('empty labels fall back gracefully (never crash, never a raw id)', () => {
    assert.match(toolInstallNote([]), /the tool it needs/);
  });

  test('hasToolNode tolerates a trailing comment but not type: tool-request', () => {
    assert.equal(hasToolNode('        type: tool  # jina reader'), true);
    assert.equal(hasToolNode('        type: tool-request'), false);
  });
});
