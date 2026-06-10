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
import { I } from './Icon';
import { parsePatch, buildSplitRows, type SplitRow, type WordSegment } from '../lib/diff-parser';
import type { FileChange } from '../types';

function segs(parts: WordSegment[] | undefined, fallback: string) {
  if (!parts) return fallback;
  return parts.map((s, i) =>
    s.type === 'change' ? <span key={i} className="dl-word">{s.text}</span> : <Fragment key={i}>{s.text}</Fragment>
  );
}

export function SplitDiffView({ file }: { file: FileChange }) {
  const parsed = parsePatch(file.diff);
  if (parsed.isBinary || parsed.isTooLarge) {
    return <div className="secret-note">Binary or oversized diff — not shown.</div>;
  }
  const rows: SplitRow[] = buildSplitRows(parsed.hunks);
  if (rows.length === 0) {
    return <div className="secret-note">No textual changes in this file.</div>;
  }

  return (
    <div className="diff">
      <div className="diff-head">
        <I.diff style={{ width: 13, height: 13 }} />
        <span className="dh-name">{file.path}</span>
        <span className="dh-stat">
          <span className="dstat-add">+{file.additions}</span>
          <span className="dstat-del">−{file.deletions}</span>
        </span>
      </div>
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
