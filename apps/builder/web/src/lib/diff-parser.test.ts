/**
 * T7 — the word-diff parser: hunk parsing, add/del/context row classification, the sentinel payloads
 * ([new untracked file] / [diff too large or binary file]), and the 200-token perf guard that makes
 * computeWordDiff bail to null on pathological lines.
 */
import { describe, it, expect } from 'vitest';
import { parsePatch, buildSplitRows, computeWordDiff, diffStats } from './diff-parser';

const PATCH = `@@ -1,3 +1,3 @@
 context
-old line
+new line
 tail`;

describe('parsePatch', () => {
  it('parses a hunk header and its line origins', () => {
    const { hunks } = parsePatch(PATCH);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].oldStart).toBe(1);
    expect(hunks[0].newStart).toBe(1);
    expect(hunks[0].lines.map((l) => l.type)).toEqual(['context', 'del', 'add', 'context']);
    expect(hunks[0].lines[1].content).toBe('old line');
    expect(hunks[0].lines[2].content).toBe('new line');
  });

  it('sentinel: new untracked file → empty, not binary', () => {
    expect(parsePatch('[new untracked file]')).toEqual({ hunks: [], isBinary: false, isTooLarge: false });
  });

  it('sentinel: too large / binary → flagged', () => {
    const p = parsePatch('[diff too large or binary file]');
    expect(p.isBinary).toBe(true);
    expect(p.isTooLarge).toBe(true);
  });
});

describe('buildSplitRows', () => {
  it('emits a hunk header then pairs a del with its add (carrying a word diff)', () => {
    const rows = buildSplitRows(parsePatch(PATCH).hunks);
    expect(rows[0]).toEqual({ type: 'hunk-header', header: '@@ -1,3 +1,3 @@' });
    const paired = rows.find((r) => r.type === 'content' && r.left?.type === 'del' && r.right?.type === 'add');
    expect(paired).toBeTruthy();
    expect((paired as { wordDiff?: unknown }).wordDiff).toBeTruthy();
  });
});

describe('computeWordDiff', () => {
  it('identical lines → equal segments only', () => {
    const wd = computeWordDiff('same text', 'same text');
    expect(wd).not.toBeNull();
    expect(wd!.left.every((s) => s.type === 'equal')).toBe(true);
  });

  it('empty lines → empty segment arrays', () => {
    expect(computeWordDiff('', '')).toEqual({ left: [], right: [] });
  });

  it('marks the changed token on each side', () => {
    const wd = computeWordDiff('old line', 'new line')!;
    expect(wd.left.some((s) => s.type === 'change')).toBe(true);
    expect(wd.right.some((s) => s.type === 'change')).toBe(true);
  });

  it('200-token perf guard → null (no O(n·m) blowup)', () => {
    const big = 'x '.repeat(200); // ~400 tokens (words + spaces)
    expect(computeWordDiff(big, big)).toBeNull();
  });
});

/**
 * The header prints these. They were never counted before: `FileChange.additions` is part of a payload
 * the panel hand-builds, and both call sites passed a literal `0` — so a first Implement, which adds a
 * whole file, advertised "+0 −0" directly above 115 green lines.
 */
describe('diffStats', () => {
  const PATCH = [
    '--- a/main.yml',
    '+++ b/main.yml',
    '@@ -1,3 +1,4 @@',
    ' unchanged context',
    '-removed one',
    '-removed two',
    '+added one',
    '+added two',
    '+added three',
    '\\ No newline at end of file',
  ].join('\n');

  it('counts added and removed lines', () => {
    expect(diffStats(PATCH)).toEqual({ additions: 3, deletions: 2 });
  });

  it("does not count the patch's own +++/--- file markers as content", () => {
    // Without this the simplest possible diff reads one addition and one deletion too many.
    expect(diffStats('--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+b\n')).toEqual({ additions: 1, deletions: 1 });
  });

  it('counts a bare "+" — an added EMPTY line is a line', () => {
    // The bug in the inline version this replaced: /^[+-][^+-]/ needs a SECOND character, so every
    // blank line a patch adds or removes was invisible to it. Blank lines are most of a YAML diff.
    expect(diffStats('@@ -0,0 +1,2 @@\n+\n+text\n')).toEqual({ additions: 2, deletions: 0 });
    expect(diffStats('@@ -1,2 +0,0 @@\n-\n-text\n')).toEqual({ additions: 0, deletions: 2 });
  });

  it('ignores hunk headers and context lines', () => {
    expect(diffStats('@@ -1,2 +1,2 @@\n context\n context\n')).toEqual({ additions: 0, deletions: 0 });
  });

  it('an empty patch is zero, not a crash', () => {
    expect(diffStats('')).toEqual({ additions: 0, deletions: 0 });
  });

  it('a whole-file add (the first Implement) counts every line', () => {
    const whole = '@@ -0,0 +1,115 @@\n' + Array.from({ length: 115 }, (_, i) => '+line ' + i).join('\n');
    expect(diffStats(whole)).toEqual({ additions: 115, deletions: 0 });
  });
});
