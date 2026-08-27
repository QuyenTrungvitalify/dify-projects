// diff-parser.ts — COPIED VERBATIM from claude-nexus `src/client/lib/diff-parser.ts` (spec 009
// Lát 4 task 9). Pure + language-agnostic: parsePatch / buildSplitRows / computeWordDiff (Myers on
// tokens) + the ParsedDiff/DiffHunk/SplitRow types. Vendored (no cross-repo import — AC #11). The
// diff *producer* (the `{path, diff}` payload) lands in Lát 5; SplitDiffView renders this when present.

// ─── Types ───────────────────────────────────────────────

/** A single line in the diff with its origin */
export interface DiffLine {
  type: 'context' | 'add' | 'del';
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

/** Discriminated union: content row vs hunk header */
export type SplitRow = SplitContentRow | SplitHunkHeaderRow;

export interface SplitContentRow {
  type: 'content';
  left: DiffLine | null;
  right: DiffLine | null;
  wordDiff?: { left: WordSegment[]; right: WordSegment[] };
}

export interface SplitHunkHeaderRow {
  type: 'hunk-header';
  header: string;
}

export interface WordSegment {
  text: string;
  type: 'equal' | 'change';
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header: string;
  lines: DiffLine[];
}

export interface ParsedDiff {
  hunks: DiffHunk[];
  isBinary: boolean;
  isTooLarge: boolean;
}

// ─── Parser ──────────────────────────────────────────────

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parsePatch(raw: string): ParsedDiff {
  if (!raw || raw === '[new untracked file]') {
    return { hunks: [], isBinary: false, isTooLarge: false };
  }
  if (raw === '[diff too large or binary file]') {
    return { hunks: [], isBinary: true, isTooLarge: true };
  }

  const lines = raw.split('\n');
  // Trim trailing empty string from split (artifact of trailing \n)
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    const hunkMatch = HUNK_RE.exec(line);
    if (hunkMatch) {
      current = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newCount: hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1,
        header: line,
        lines: [],
      };
      oldLine = current.oldStart;
      newLine = current.newStart;
      hunks.push(current);
      continue;
    }

    if (!current) continue; // skip file headers before first @@

    if (line.startsWith('\\ ')) continue; // "\ No newline at end of file"

    if (line.startsWith('+') && !line.startsWith('+++')) {
      current.lines.push({ type: 'add', content: line.slice(1), oldLineNo: null, newLineNo: newLine++ });
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      current.lines.push({ type: 'del', content: line.slice(1), oldLineNo: oldLine++, newLineNo: null });
    } else {
      // context line (space prefix or empty)
      const content = line.startsWith(' ') ? line.slice(1) : line;
      current.lines.push({ type: 'context', content, oldLineNo: oldLine++, newLineNo: newLine++ });
    }
  }

  return { hunks, isBinary: false, isTooLarge: false };
}

// ─── Split Row Builder ───────────────────────────────────

export function buildSplitRows(hunks: DiffHunk[]): SplitRow[] {
  const rows: SplitRow[] = [];

  for (const hunk of hunks) {
    rows.push({ type: 'hunk-header', header: hunk.header });

    const delBuffer: DiffLine[] = [];
    const addBuffer: DiffLine[] = [];

    function flushBuffers() {
      const paired = Math.min(delBuffer.length, addBuffer.length);

      for (let i = 0; i < paired; i++) {
        const wd = computeWordDiff(delBuffer[i].content, addBuffer[i].content);
        const row: SplitContentRow = { type: 'content', left: delBuffer[i], right: addBuffer[i] };
        if (wd) row.wordDiff = wd;
        rows.push(row);
      }

      // remaining dels (no matching add)
      for (let i = paired; i < delBuffer.length; i++) {
        rows.push({ type: 'content', left: delBuffer[i], right: null });
      }

      // remaining adds (no matching del)
      for (let i = paired; i < addBuffer.length; i++) {
        rows.push({ type: 'content', left: null, right: addBuffer[i] });
      }

      delBuffer.length = 0;
      addBuffer.length = 0;
    }

    for (const line of hunk.lines) {
      if (line.type === 'del') {
        delBuffer.push(line);
      } else if (line.type === 'add') {
        addBuffer.push(line);
      } else {
        // context line → flush pending dels/adds first
        flushBuffers();
        rows.push({ type: 'content', left: line, right: line });
      }
    }

    // flush at end of hunk
    flushBuffers();
  }

  return rows;
}

// ─── Word-Level Diff (Myers on tokens) ───────────────────

function tokenize(line: string): string[] {
  return line.match(/\S+|\s+/g) || [];
}

/**
 * Lightweight Myers diff on two token arrays.
 * Returns edit script: 'keep' | 'insert' | 'delete' for each token.
 */
function myersDiff(a: string[], b: string[]): Array<{ op: 'keep' | 'insert' | 'delete'; token: string }> {
  const n = a.length;
  const m = b.length;
  const max = n + m;

  if (max === 0) return [];

  // V array indexed by k = x - y, shifted by max to avoid negative indices
  const v = new Int32Array(2 * max + 1);
  v.fill(-1);
  v[max + 1] = 0; // v[1] = 0

  // Store trace for backtracking
  const trace: Int32Array[] = [];

  outer:
  for (let d = 0; d <= max; d++) {
    const vCopy = new Int32Array(v);
    trace.push(vCopy);

    for (let k = -d; k <= d; k += 2) {
      const idx = k + max;
      let x: number;
      if (k === -d || (k !== d && v[idx - 1] < v[idx + 1])) {
        x = v[idx + 1]; // move down
      } else {
        x = v[idx - 1] + 1; // move right
      }

      let y = x - k;

      // follow diagonal (matching tokens)
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }

      v[idx] = x;

      if (x >= n && y >= m) break outer;
    }
  }

  // Backtrack to build edit script
  const edits: Array<{ op: 'keep' | 'insert' | 'delete'; token: string }> = [];
  let x = n;
  let y = m;

  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d]; // V saved before d-th pass = V after (d-1) edits
    const k = x - y;
    const idx = k + max;

    let prevK: number;
    if (k === -d || (k !== d && vd[idx - 1] < vd[idx + 1])) {
      prevK = k + 1; // came from down (insertion)
    } else {
      prevK = k - 1; // came from right (deletion)
    }

    const prevIdx = prevK + max;
    const prevX = vd[prevIdx];
    const prevY = prevX - prevK;

    // Diagonal moves (keep)
    while (x > prevX && y > prevY) {
      x--;
      y--;
      edits.push({ op: 'keep', token: a[x] });
    }

    if (d > 0) {
      if (x === prevX) {
        // insertion (moved down: y changed)
        y--;
        edits.push({ op: 'insert', token: b[y] });
      } else {
        // deletion (moved right: x changed)
        x--;
        edits.push({ op: 'delete', token: a[x] });
      }
    }
  }

  edits.reverse();
  return edits;
}

export function computeWordDiff(
  oldLine: string,
  newLine: string,
): { left: WordSegment[]; right: WordSegment[] } | null {
  const oldTokens = tokenize(oldLine);
  const newTokens = tokenize(newLine);

  // Performance guard
  if (oldTokens.length + newTokens.length > 200) return null;

  // Identical lines
  if (oldLine === newLine) {
    return {
      left: oldLine ? [{ text: oldLine, type: 'equal' }] : [],
      right: newLine ? [{ text: newLine, type: 'equal' }] : [],
    };
  }

  const edits = myersDiff(oldTokens, newTokens);

  const left: WordSegment[] = [];
  const right: WordSegment[] = [];

  for (const edit of edits) {
    if (edit.op === 'keep') {
      // Merge adjacent equal segments
      if (left.length > 0 && left[left.length - 1].type === 'equal') {
        left[left.length - 1].text += edit.token;
      } else {
        left.push({ text: edit.token, type: 'equal' });
      }
      if (right.length > 0 && right[right.length - 1].type === 'equal') {
        right[right.length - 1].text += edit.token;
      } else {
        right.push({ text: edit.token, type: 'equal' });
      }
    } else if (edit.op === 'delete') {
      if (left.length > 0 && left[left.length - 1].type === 'change') {
        left[left.length - 1].text += edit.token;
      } else {
        left.push({ text: edit.token, type: 'change' });
      }
    } else {
      // insert
      if (right.length > 0 && right[right.length - 1].type === 'change') {
        right[right.length - 1].text += edit.token;
      } else {
        right.push({ text: edit.token, type: 'change' });
      }
    }
  }

  return { left, right };
}

/**
 * Spec 103 step 1 — how the `差分` tab should present the spec side of a round.
 *
 * Three states, and collapsing any two of them tells the reader something false:
 *
 *  - `absent`   — no pre-round spec snapshot exists. A first build: ② wrote SPEC.md minutes ago, so
 *                 there is no "before". The section is omitted entirely.
 *  - `unchanged`— there WAS a before, and this round left the spec alone. After spec 103 L0 that is a
 *                 fact worth stating, not a blank.
 *  - `changed`  — render the diff.
 *
 * `absent` vs `unchanged` is the pair that matters: "we could not look" must never render like "we
 * looked and nothing moved". Same three-state contract the `specStale` measurement keeps server-side.
 */
/**
 * How many lines a patch adds and removes.
 *
 * The file header shows this, and it has to be COUNTED rather than carried: `FileChange.additions` is
 * part of a payload shape the panel builds by hand, and both of its call sites were passing a literal
 * `0` — so the diff view advertised "+0 −0" over a patch that added a hundred lines.
 *
 * `+++`/`---` are the patch's own file markers, not content; `@@` and `\ No newline…` start with
 * neither sign. A bare `+` (an added EMPTY line) counts — an earlier inline version of this used
 * `/^[+-][^+-]/`, which requires a second character and silently skipped exactly those.
 */
export function diffStats(raw: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of raw.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions++;
    else if (line.startsWith('-')) deletions++;
  }
  return { additions, deletions };
}

export function specDiffState(specDiff: string | null | undefined): 'absent' | 'unchanged' | 'changed' {
  if (specDiff === null || specDiff === undefined) return 'absent';
  return specDiff.trim() ? 'changed' : 'unchanged';
}
