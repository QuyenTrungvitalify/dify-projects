/**
 * T7 — the word-diff parser: hunk parsing, add/del/context row classification, the sentinel payloads
 * ([new untracked file] / [diff too large or binary file]), and the 200-token perf guard that makes
 * computeWordDiff bail to null on pathological lines.
 */
import { describe, it, expect } from 'vitest';
import { parsePatch, buildSplitRows, computeWordDiff } from './diff-parser';

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
