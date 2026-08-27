/* ============================================================
   SplitDiffView.tsx — split add/del diff (spec 009 Lát 4 task 9).
   Uses the vendored, language-agnostic diff-parser (parsePatch +
   buildSplitRows + word-diff) from nexus, rendered into the design's
   `.diff` / `.diff-cols` / `.diff-line` shell (DESIGN OVERRIDE — the
   look comes from surface-blocks.css, the logic from nexus). The diff
   PRODUCER (the `{path, diff}` payload) lands in Lát 5; until then the
   ArtifactPanel passes no diff and this never renders (panel degrades).
   ============================================================ */
import { Fragment } from 'preact';
import { useMemo } from 'preact/hooks';
import { parsePatch, buildSplitRows, type SplitRow, type WordSegment } from '../lib/diff-parser';
import { t as tr } from '../lib/i18n';
import type { FileChange } from '../types';

function segs(parts: WordSegment[] | undefined, fallback: string) {
  if (!parts) return fallback;
  return parts.map((s, i) =>
    s.type === 'change' ? <span key={i} className="dl-word">{s.text}</span> : <Fragment key={i}>{s.text}</Fragment>
  );
}

export function SplitDiffView({ file }: { file: FileChange }) {
  // D7 (017): memoize the parse + Myers word-diff on the diff text — it's pure in `file.diff`, so an
  // unrelated re-render (panel resize, sibling state) no longer re-parses the whole patch.
  const { parsed, rows } = useMemo(() => {
    const p = parsePatch(file.diff);
    return { parsed: p, rows: p.isBinary || p.isTooLarge ? ([] as SplitRow[]) : buildSplitRows(p.hunks) };
  }, [file.diff]);
  if (parsed.isBinary || parsed.isTooLarge) {
    return <div className="secret-note">{tr('diffBinary')}</div>;
  }
  if (rows.length === 0) {
    return <div className="secret-note">{tr('diffNoChanges')}</div>;
  }

  // No head of its own. Every caller renders this INSIDE a file card whose header already names the file
  // and carries its +/− count, so a head here was a second row saying "main.yml" directly under the
  // first — and saying it wrong, since both callers passed a literal `additions: 0, deletions: 0`.
  return (
    <div className="diff">
      <div className="diff-cols">
        <div className="diff-col left">
          <div className="diff-col-head">{file.oldPath ?? 'old'}</div>
          {rows.map((row, i) =>
            row.type === 'hunk-header' ? (
              <div key={i} className="diff-line hunk"><span className="dl-gut" /><span className="dl-txt">{row.header}</span></div>
            ) : (
              <div key={i} className={'diff-line ' + (row.left ? row.left.type : 'empty')}>
                <span className="dl-gut">{row.left?.oldLineNo ?? ''}</span>
                <span className="dl-txt">{row.left ? segs(row.wordDiff?.left, row.left.content) : ''}</span>
              </div>
            )
          )}
        </div>
        <div className="diff-col right">
          <div className="diff-col-head">{file.path}</div>
          {rows.map((row, i) =>
            row.type === 'hunk-header' ? (
              <div key={i} className="diff-line hunk"><span className="dl-gut" /><span className="dl-txt">{row.header}</span></div>
            ) : (
              <div key={i} className={'diff-line ' + (row.right ? row.right.type : 'empty')}>
                <span className="dl-gut">{row.right?.newLineNo ?? ''}</span>
                <span className="dl-txt">{row.right ? segs(row.wordDiff?.right, row.right.content) : ''}</span>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
