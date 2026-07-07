/**
 * Spec 030 (content-language sync, Option B) — the "## Output language" directive guard.
 *
 * Option B adds NO code: the two SPEC-authoring skill bodies (draft.md on the fast path, spec.md on the
 * standard path) carry an identical directive telling the model to author prose in the REQUIREMENT's
 * language while pinning identifiers to English. These tests guard the checked-in directive so a future
 * edit can't silently regress it:
 *   (1) both bodies carry a "## Output language" section, byte-identical (drift guard, spec §2);
 *   (2) the section still names the load-bearing boundary rules (a gutted directive is caught);
 *   (3) renderPrompt substitutes {{REQUIREMENT}} (any language, intact) and leaves no stray inject
 *       token, while PRESERVING the {{#node.field#}} Dify-ref example the directive shows the model.
 *
 * No real turn is rendered — this is a pure prompt-shape assertion over the checked-in files.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderPrompt, PHASES, languagePin } from '../server/lib/phases.js';
import type { Task } from '../server/state/task.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..', '..', '.claude', 'skills', 'dify-build');
const read = (f: string): string => readFileSync(join(SKILL, f), 'utf8');

/** Extract the "## Output language" section: its heading up to (excluding) the next "## " heading. */
function outputLanguageSection(body: string): string {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => l.trim() === '## Output language');
  assert.notEqual(start, -1, 'body must carry a "## Output language" section');
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trimEnd();
}

/** The `spec` phase inject map — it renders BOTH draft.md and spec.md (spec §Depends on). */
const mapFor = (requirement: string): Record<string, string> =>
  PHASES.find((p) => p.id === 'spec')!.injectVars({
    taskId: '1751000000000',
    project: null,
    workflowSlug: null,
    requirement,
    fastMode: true,
  } as Task);

describe('030 · Output-language directive (drift + render guard)', () => {
  test('draft.md and spec.md carry a byte-identical "## Output language" section', () => {
    assert.equal(
      outputLanguageSection(read('draft.md')),
      outputLanguageSection(read('spec.md')),
      'the directive must be identical across the two SPEC authors (drift guard)'
    );
  });

  test('the directive names the load-bearing boundary (not gutted)', () => {
    const s = outputLanguageSection(read('draft.md'));
    assert.match(s, /same language as the requirement/i);
    assert.match(s, /Keep these in English\/ASCII exactly/);
    assert.match(s, /\{\{#node\.field#\}\}/, 'the ref-format example must be shown');
    assert.match(s, /`type` values/);
  });

  for (const [label, requirement] of [
    ['JP', '簡単ワークフロー作成して'],
    ['VI', 'Tạo workflow tóm tắt văn bản tiếng Việt'],
    ['EN', 'create a simple text summarizer'],
  ] as const) {
    for (const file of ['draft.md', 'spec.md'] as const) {
      test(`${label} · ${file}: {{REQUIREMENT}} substituted intact · no stray token · {{#…#}} preserved`, () => {
        const rendered = renderPrompt(read(file), mapFor(requirement));
        assert.ok(rendered.includes(requirement), 'requirement text present intact (non-ASCII survives)');
        assert.equal(rendered.match(/\{\{[A-Z_]+\}\}/g), null, 'no un-substituted inject token remains');
        assert.ok(
          rendered.includes('{{#node.field#}}'),
          'the Dify variable-ref example is preserved (renderPrompt must not substitute it)'
        );
      });
    }
  }
});

describe('Layer 1 · languagePin (native-language reply pin)', () => {
  test('a kana-bearing (Japanese) requirement returns a Japanese pin', () => {
    const pin = languagePin('Exel表からPDFのURLを抜き出して一覧にしたい。');
    assert.ok(pin.includes('日本語'), 'pin instructs replying in Japanese');
    assert.ok(pin.endsWith('\n\n'), 'pin ends with a blank-line separator so it leads cleanly');
    assert.match(pin, /機械識別子/, 'pin still carves out ASCII machine identifiers');
  });

  test('a katakana-only requirement (still Japanese) is pinned', () => {
    assert.notEqual(languagePin('ワークフロー'), '', 'katakana alone ⇒ Japanese');
  });

  for (const [label, requirement] of [
    ['EN', 'create a simple text summarizer'],
    ['VI', 'Tạo workflow tóm tắt văn bản tiếng Việt'],
    ['ZH (kanji, no kana)', '从表格中提取数据'],
  ] as const) {
    test(`${label} requirement returns no pin (English-authored prompt reads as-is; no false-positive)`, () => {
      assert.equal(languagePin(requirement), '');
    });
  }
});
