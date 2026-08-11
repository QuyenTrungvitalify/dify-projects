// artifact-toc.ts — the pure half of the artifact panel's contents sidebar (the small right-hand rail
// that anchors the sections of whatever tab is open, shown when the panel is expanded).
//
// The DOM half lives in ArtifactPanel: headings/section titles are read straight off the rendered
// output, so the TOC can never disagree with what is on screen. Two things are NOT readable that way and
// live here instead: main.yml is one `<pre>` text blob with no elements to anchor to (so its entries are
// derived from the text and addressed by LINE), and the scroll-spy's "which entry am I in" rule.

/**
 * One row in the contents rail.
 *
 * Note what is NOT here: a pixel offset. Storing measured tops was the first design and it was wrong —
 * offsets go stale the instant the layout moves (window resize, panel expand, a tab rendered while the
 * window was inactive and therefore laid out at ~zero height), and a stale offset fails SILENTLY: the
 * rail still looks right, its rows just scroll to the wrong place. Positions are now computed fresh at
 * the moment they are used, from the anchor the panel holds (an element, or a line in main.yml).
 */
export interface TocEntry {
  key: string;
  text: string;
  /** 1 = top-level, 2 = nested. Drives the rail's indent only. */
  level: number;
}

/** A `main.yml` anchor before it is turned into a pixel offset: which source LINE it sits on. */
export interface YamlAnchor {
  line: number;
  text: string;
  level: number;
}

const MAX_YAML_ANCHORS = 200; // a runaway file must not build a rail longer than the document

/**
 * Anchors for a Dify DSL: the top-level keys (`app`, `kind`, `workflow`, …) plus every graph node's
 * title, nested under them.
 *
 * Node titles are the point. A 2,000-line main.yml has four top-level keys, and "jump to `workflow:`"
 * helps nobody — what a person looks for is "the LLM node" or "the HTTP request node". Titles are read
 * from each node's `data:` block, and the node's `type:` rides along in the label because Dify lets two
 * nodes share a title (and an untitled node would otherwise be a blank row).
 *
 * Deliberately a line scanner, not a YAML parse: the server ships no YAML dependency, this needs LINE
 * numbers (which a parse discards), and it must degrade to "fewer anchors" rather than throw on a file
 * that is mid-edit or malformed. Anything unrecognized simply produces no entry.
 */
export function yamlAnchors(yaml: string): YamlAnchor[] {
  if (!yaml) return [];
  const lines = yaml.split('\n');
  const out: YamlAnchor[] = [];
  // Node `data:` blocks carry `title:` and `type:` at the same indent; pair them per block so a title
  // is labelled with its own node's type and never with a neighbour's.
  let pendingTitle: { line: number; text: string; indent: number } | null = null;
  const flush = (type?: string): void => {
    if (!pendingTitle) return;
    if (out.length < MAX_YAML_ANCHORS) {
      out.push({ line: pendingTitle.line, text: type ? `${pendingTitle.text} · ${type}` : pendingTitle.text, level: 2 });
    }
    pendingTitle = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const top = line.match(/^([A-Za-z_][\w-]*):/);
    if (top) {
      flush(); // a new top-level key ends any node block still waiting for its type
      if (out.length < MAX_YAML_ANCHORS) out.push({ line: i, text: top[1], level: 1 });
      continue;
    }
    const title = line.match(/^(\s+)title:\s*(?:['"])?(.*?)(?:['"])?\s*$/);
    if (title && title[2]) {
      flush(); // two titles in a row ⇒ the previous node simply had no type line
      pendingTitle = { line: i, text: title[2], indent: title[1].length };
      continue;
    }
    if (pendingTitle) {
      const type = line.match(/^(\s+)type:\s*(?:['"])?([\w-]+)(?:['"])?\s*$/);
      // Same indent = the same `data:` block. A deeper/shallower `type:` belongs to something else.
      if (type && type[1].length === pendingTitle.indent) flush(type[2]);
    }
  }
  flush();
  return out;
}

/**
 * Which entry the reader is currently inside, given the body's scrollTop. `-1` when the reader is above
 * the first entry.
 *
 * The `lookahead` is what makes the rail feel right rather than correct-but-late: an entry counts as
 * current once its heading reaches the top REGION of the viewport, not once it passes the very top edge
 * — otherwise clicking a row highlights the row above it, because scrollTop lands the heading exactly at
 * 0 and `top <= scrollTop` is off by a pixel of rounding.
 */
export function activeTocIndex(entries: { top: number }[], scrollTop: number, lookahead = 24): number {
  let active = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].top <= scrollTop + lookahead) active = i;
    else break; // entries are in document order, so the first one below the fold ends the scan
  }
  return active;
}

/** Which rendered elements are the anchors, per tab. `null` = this tab has no DOM-anchored entries
 *  (main.yml builds its rail from the text instead — see {@link yamlAnchors}). */
export function tocSelector(tab: string): string | null {
  if (tab === 'spec') return '.spec-preview h1, .spec-preview h2, .spec-preview h3';
  if (tab === 'report' || tab === 'diff') return '.art-section-title';
  return null;
}
