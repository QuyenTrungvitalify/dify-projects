/**
 * workflow-index.ts — a compact map of a Dify workflow, for prompts that must not carry the whole file.
 *
 * WHY (spec 098): the terminal ask inlined `main.yml` in FULL on every question — measured 99.8–115KB
 * per ask, ~85% of a 143KB seed, re-sent 46 times in one observed session. The map of the same 52-node
 * file is 3.5KB (3.2%), and it answers the questions people actually ask ("what does this do", "what
 * runs after what") without the model reading a byte. Details still live in the file, whose path rides
 * along in the prompt.
 *
 * NO YAML PARSER: this server's only runtime dependency is fastify, on purpose. So the scan is
 * STRUCTURAL — it walks indentation the way the document is actually shaped — rather than regex-matching
 * keys wherever they appear. That distinction is load-bearing: `type:` occurs at three different depths
 * in a real workflow (an edge's `type: custom`, a node's `data.type`, and `body[].type: string` inside
 * an HTTP node), so a key-anywhere regex reports confident nonsense. Everything here is anchored to the
 * exact indent its container sits at.
 *
 * WRONG IS WORSE THAN ABSENT: a misleading index would have the model answer about nodes that do not
 * exist. So the scan self-checks (every item must yield an id) and reports `ok:false` instead of a
 * half-map — the caller then falls back to the raw file, saying so.
 */

export interface WorkflowIndex {
  /** The rendered map — node lines then edge lines. Empty when `ok` is false. */
  text: string;
  nodes: number;
  edges: number;
  /** false ⇒ the document did not have the shape this scan understands; use the raw file instead. */
  ok: boolean;
  /** Set when the node list was capped, so the caller can say so rather than imply completeness. */
  truncated?: number;
}

/** Indent width of a line (spaces only — YAML forbids tabs for indentation). */
function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
}

/** `key: value` at EXACTLY `want` indent → the value, else null. Quotes are stripped; `|`/`>` blocks
 *  return null (a folded scalar's body is not on this line, and we never want it in a map). */
function scalarAt(line: string, want: number, key: string): string | null {
  if (indentOf(line) !== want) return null;
  const m = line.trim().match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
  if (!m || m[1] !== key) return null;
  const v = m[2].trim();
  if (!v || v === '|' || v === '>' || v === '|-' || v === '>-') return null;
  return v.replace(/^['"]|['"]$/g, '');
}

/** The line index of `^ *<key>:$` — a block key with no inline value. -1 when absent.
 *
 *  KNOWN LIMIT (spec 098 §C1): this takes the FIRST match in the document, so a `nodes:` written inside
 *  a prompt or a code node's script would win over the real graph. Measured on every YAML in this repo:
 *  1 file of 155 has a duplicate key, and it is a prompt template, not a workflow. The failure mode is
 *  benign anyway — reading the wrong block yields no ids, which the guards below turn into `ok:false`
 *  and a fallback to the file itself. Costly, not wrong. */
function blockKeyLine(lines: string[], key: string): number {
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trimEnd();
    if (t.trim() === `${key}:`) return i;
  }
  return -1;
}

/** A line that plausibly IS document structure at its own indent: a key, or a sequence marker. Used to
 *  tell "the array ended" from "we fell out of the array into the middle of a multi-line scalar" — see
 *  `unstructuredBreak`. Dify keys are ASCII, so a prose line (`回答は…`, `- but not a key`) fails here. */
function looksStructural(trimmed: string): boolean {
  return /^(- )?["']?[A-Za-z_][\w .-]*["']?:(\s|$)/.test(trimmed) || /^- ["'[{]?/.test(trimmed);
}

/**
 * Walk the array under `key:` and hand each ITEM's lines to `take`. An item starts at `<indent>- ` and
 * runs until the next item at that indent or the first line that dedents out of the array.
 *
 * `unstructuredBreak` reports the failure this scan cannot otherwise see: a QUOTED MULTI-LINE SCALAR
 * whose continuation lines start at column 0 (hand-written Japanese prompts do this) dedents out of the
 * array in the middle of it, so the items after it are never counted — and the count-vs-count guard in
 * `buildWorkflowIndex` compares two numbers that BOTH stopped early. Observed on a real file in this
 * repo: `skills/Tomatio13/example/manual_search.yml` reported 5 nodes for a 6-node workflow, dropping
 * the `end` node, with `ok:true`. The line that ends the array is now inspected: if it is not shaped
 * like structure, the whole scan is disowned rather than trusted.
 *
 * RESIDUAL RISK (spec 098 §C2), stated plainly: this catches a continuation line that does NOT look like
 * a key. A prose line that happens to (`Note: check this`, at column 0) still ends the array silently.
 * Closing that hole needs a real parser, which needs a dependency this server does not take. The bound
 * is empirical, not proven: 153 real workflows, zero misses.
 */
function eachItem(
  lines: string[],
  key: string,
  take: (item: string[], itemIndent: number) => void
): { count: number; unstructuredBreak: boolean } {
  const at = blockKeyLine(lines, key);
  if (at === -1) return { count: 0, unstructuredBreak: false };
  const keyIndent = indentOf(lines[at]);
  let i = at + 1;
  let itemIndent = -1;
  let cur: string[] | null = null;
  let count = 0;
  let unstructuredBreak = false;
  const flush = (): void => {
    if (cur && cur.length) { take(cur, itemIndent); count++; }
    cur = null;
  };
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { if (cur) cur.push(line); continue; }
    // A comment can sit at ANY indent, including the array's own — `templates/patterns/` writes
    // `    # ── THE TOOL NODE ──` between items. Treating that as "the array ended" silently dropped the
    // two nodes after it (4 of 6), which the calibration caught as a confident-but-wrong index.
    if (line.trim().startsWith('#')) { if (cur) cur.push(line); continue; }
    const ind = indentOf(line);
    // A sequence under a mapping key is conventionally written at the SAME indent as the key
    // (`nodes:` / `- data:` both at 4). Requiring the marker to be deeper than the key made this scan
    // return "unknown shape" on 24 of 25 real workflows — caught by calibrating against a real YAML
    // parser before shipping, which is the only reason it is not still wrong.
    const isItem = line.trim().startsWith('- ') && (itemIndent === -1 || ind === itemIndent);
    if (isItem && ind >= keyIndent) {
      flush();
      itemIndent = ind;
      cur = [line];
      continue;
    }
    // dedented out of the array (a sibling key of `nodes:`) → done
    if (ind < keyIndent || (ind === keyIndent && !isItem)) {
      if (!looksStructural(line.trim())) unstructuredBreak = true;
      break;
    }
    if (cur) cur.push(line);
  }
  flush();
  return { count, unstructuredBreak };
}

// See spec 098 S1: a map with no bound just trades one unbounded thing for another. All three bounds
// below are that same rule applied to the three things that can grow — how many nodes, how many edges,
// and how long a single title is (a node title is free-form text, so one node can be a paragraph).
const MAX_NODES = 200;
const MAX_EDGES = 300;
const MAX_TITLE = 60;

/**
 * Build the map. `ok:false` means "this file is not shaped the way we understand" — the caller must
 * fall back to the raw bytes rather than send a partial picture.
 */
export function buildWorkflowIndex(yamlText: string): WorkflowIndex {
  const lines = yamlText.split('\n');
  const nodes: { id: string; type: string; title: string; parent: string }[] = [];

  const nodeScan = eachItem(lines, 'nodes', (item, itemIndent) => {
    // Item-level keys sit one level in from the `- ` marker; `data:`'s own keys one level further.
    const lvl = itemIndent + 2;
    let id = '';
    let type = '';
    let title = '';
    let parent = '';
    let inData = false;
    for (const line of item) {
      const first = line.replace(/^(\s*)- /, '$1  '); // normalise the `- ` marker to plain indent
      if (!id) id = scalarAt(first, lvl, 'id') ?? '';
      // Dify puts an iteration/loop child in the SAME top-level array as its container, tied to it by
      // `parentId` — so the map must say which nodes are inside what, or its flat edge list reads as
      // one straight-line flow when part of it is a loop body.
      if (!parent) parent = scalarAt(first, lvl, 'parentId') ?? '';
      if (first.trim() === 'data:' && indentOf(first) === lvl) { inData = true; continue; }
      if (inData) {
        if (indentOf(first) <= lvl && first.trim() && !first.trim().startsWith('- ')) inData = false;
        else {
          if (!type) type = scalarAt(first, lvl + 2, 'type') ?? '';
          if (!title) title = scalarAt(first, lvl + 2, 'title') ?? '';
        }
      }
    }
    if (id) nodes.push({ id, type: type || '?', title: title || '', parent });
  });

  // Self-check: every array item must have produced a node. A shortfall means the shape is not what
  // this scan assumes, and a partial map is exactly the misleading artifact this guard exists to stop.
  if (nodeScan.count === 0 || nodes.length !== nodeScan.count || nodeScan.unstructuredBreak) {
    return { text: '', nodes: nodes.length, edges: 0, ok: false };
  }
  // Not one node's type could be read ⇒ this is not the block shape this scan understands (a flow-style
  // `data: {type: llm}` yields ids and nothing else). Ids alone are a map of a workflow with no parts.
  if (nodes.every((n) => n.type === '?')) {
    return { text: '', nodes: nodes.length, edges: 0, ok: false };
  }

  const edges: string[] = [];
  const edgeScan = eachItem(lines, 'edges', (item, itemIndent) => {
    const lvl = itemIndent + 2;
    let s = '';
    let t = '';
    for (const line of item) {
      const first = line.replace(/^(\s*)- /, '$1  ');
      if (!s) s = scalarAt(first, lvl, 'source') ?? '';
      if (!t) t = scalarAt(first, lvl, 'target') ?? '';
    }
    if (s && t) edges.push(`${s} -> ${t}`);
  });
  // The edges needed their own guard: a file whose `edges:` items exist but yield no pair used to render
  // as "no edge line at all", which reads as "this workflow has no connections" — a confident lie about
  // the one thing the map is for. (A workflow that genuinely has no `edges:` key trips nothing: the scan
  // sees zero items, so there is no shortfall to report.)
  if (edgeScan.unstructuredBreak || (edgeScan.count > 0 && edges.length !== edgeScan.count)) {
    return { text: '', nodes: nodes.length, edges: edges.length, ok: false };
  }

  const shown = nodes.slice(0, MAX_NODES);
  const truncated = nodes.length - shown.length;
  // An iteration/loop node has a body. In Dify's DSL that body is NOT a separate graph: its nodes sit in
  // this same array carrying `parentId`, and its edges sit in this same edge list. So the honest thing is
  // to mark membership — the earlier "not expanded here" note was simply false, and it hid the real
  // hazard, which is that `a -> b` says nothing about whether that step runs once or once per item.
  const containers = nodes.filter((n) => n.type === 'iteration' || n.type === 'loop').map((n) => n.id);
  const childless = containers.filter((c) => !nodes.some((n) => n.parent === c));
  const anyChild = nodes.some((n) => n.parent);
  const clip = (t: string): string => (t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE)}…` : t);
  const shownEdges = edges.slice(0, MAX_EDGES);
  const body = [
    `${nodes.length} nodes:`,
    ...shown.map(
      (n) => `  ${n.id} | ${n.type}${n.title ? ` | ${clip(n.title)}` : ''}${n.parent ? ` [inside ${n.parent}]` : ''}`
    ),
    ...(truncated > 0 ? [`  … and ${truncated} more (read the file for the rest)`] : []),
    ...(edges.length
      ? [
          `${edges.length} edges:`,
          ...shownEdges.map((e) => `  ${e}`),
          ...(edges.length > shownEdges.length
            ? [`  … and ${edges.length - shownEdges.length} more (read the file for the rest)`]
            : []),
        ]
      : []),
    ...(anyChild
      ? ['([inside X] = the node runs in container X\'s body, once per item — the edges between such nodes are part of that body, not of the main flow)']
      : []),
    ...(childless.length
      ? [`(${childless.join(', ')} declare a body this map could not resolve — read the file)`]
      : []),
  ].join('\n');

  return { text: body, nodes: nodes.length, edges: edges.length, ok: true, ...(truncated ? { truncated } : {}) };
}
