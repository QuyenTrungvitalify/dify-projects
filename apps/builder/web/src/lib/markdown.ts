/**
 * markdown.ts — the SLIM markdown renderer for spec 009 Lát 4 (task 8).
 *
 * Replaces nexus's 888-LOC `lib/markdown.ts` (which pulls `marked` + `DOMPurify` + `highlight.js` —
 * none vendored here). Renders the streamed Claude text the chat shows: paragraphs, fenced + inline
 * code, bold/italic, headings, lists, blockquotes, links. **HTML is escaped by default** — every
 * piece of untrusted text passes through {@link esc} before it touches the output string, so there
 * is no `innerHTML`-of-raw-input path and no sanitizer is needed.
 *
 * Signature matches what ChatMessage expects: nexus's `renderMarkdownHtml(text, workingDir)` was
 * 2-arg (the file-link feature). That feature is dropped here, so `_workingDir` is accepted and
 * IGNORED — the ChatMessage copy compiles unchanged.
 */

import { t as tr } from './i18n';

/**
 * The per-block Copy button. Emitted as MARKUP (this renderer's output is injected with innerHTML on
 * three surfaces — chat answers, run output, the spec preview), so it carries no handler: one delegated
 * listener in `copy-code.ts` serves every block on the page. Both glyphs ship inline and CSS picks which
 * one shows, so confirming a copy is a class toggle rather than DOM surgery inside a `<pre>`.
 * Icon paths mirror `Icon.tsx`'s `copy` and `check` — duplicated because that module returns Preact
 * VNodes and this one builds a string.
 */
function copyButton(): string {
  const label = esc(tr('copyCode'));
  return (
    `<button class="md-copy" type="button" title="${label}" aria-label="${label}">` +
    '<svg class="mc-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>' +
    '<svg class="mc-ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M5 12.5l4.5 4.5L19 6.5" /></svg>' +
    '</button>'
  );
}

/** Escape the five HTML-significant chars so user/model text can never inject markup. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Inline spans: code → links (markdown + bare-URL autolink) → bold → italic. Operates on ALREADY-escaped text. */
function inline(escaped: string): string {
  // Pull inline `code` spans out to NUL sentinels FIRST so their contents are genuinely shielded from
  // the emphasis/link passes below (those .replace() calls scan the whole string, so a `*`/`_`/`[`
  // inside a code span would otherwise be wrongly rewritten). Re-inserted verbatim at the end.
  const codes: string[] = [];
  let out = escaped.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(`<code>${c}</code>`);
    return `\x00C${codes.length - 1}\x00`; // NUL can't occur in escaped model/user text
  });
  // Anchors (markdown links + bare-URL autolinks) are ALSO pulled to sentinels as they're created, so
  // (a) the emphasis/strike passes below can't corrupt a URL that contains `_`/`*` (e.g. a `foo_bar`
  // path segment), and (b) the bare-URL autolink can't re-link a URL already inside a markdown link.
  const anchors: string[] = [];
  const anchor = (href: string, label: string): string => {
    anchors.push(`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    return `\x00A${anchors.length - 1}\x00`;
  };
  // [label](url) — only http/https/relative; the url is escaped, javascript: is dropped.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => {
    const safe = /^(https?:\/\/|\/|\.\/|#)/i.test(url) ? url : '#';
    return anchor(safe, label);
  });
  // Bare-URL autolink: a plain http(s):// URL in the streamed output becomes clickable (opens a new
  // tab), so a model-emitted `app: http://…/workflow` is one click away. Runs AFTER markdown links (a
  // link's `(url)` is already a sentinel, so it can't double-match) and while code is a sentinel. The
  // body class excludes `\x00` (never eats a sentinel) + brackets/quotes; the final char class drops a
  // URL's trailing sentence punctuation so `see http://x.` links `http://x` not `http://x.`. The
  // matched text is already HTML-escaped, so it's safe as both the href and the visible label.
  out = out.replace(/\bhttps?:\/\/[^\s<>()[\]{}"'\x00]+[^\s<>()[\]{}"'\x00.,;:!?]/gi, (m) => anchor(m, m));
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Emphasis only when the marker is flanked by non-word chars, so intra-word `my_var_name` / `a*b`
  // (snake_case identifiers, multiplication — which Claude streams constantly) don't italicize.
  out = out.replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^\w_])_([^_\n]+)_(?=[^\w_]|$)/g, '$1<em>$2</em>');
  // Strikethrough: ~~text~~ (matches the spec-editor toolbar's S button).
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  // Re-insert the protected spans: anchors FIRST (a link label may itself hold a code sentinel), then code.
  out = out.replace(/\x00A(\d+)\x00/g, (_m, n) => anchors[Number(n)]);
  out = out.replace(/\x00C(\d+)\x00/g, (_m, n) => codes[Number(n)]);
  return out;
}

/**
 * Split one GFM table row into trimmed cells. Strips the optional leading/trailing pipe, splits on
 * unescaped `|`, and unescapes `\|` inside cells. Hand-rolled (no lookbehind) so it works on every
 * target browser.
 */
function splitRow(row: string): string[] {
  let s = row.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === '\\' && s[k + 1] === '|') {
      cur += '|';
      k++;
      continue;
    }
    if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/** A GFM delimiter row: must contain a pipe and every cell is `:?-+:?` (e.g. `| :--- | ---: |`). */
function isDelimiterRow(line: string): boolean {
  if (!line.includes('|')) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

/**
 * Render markdown → an HTML string. Block-level scan over lines: fenced code blocks are emitted
 * verbatim (escaped, never re-parsed), then tables / headings / lists / blockquotes / paragraphs.
 */
export function renderMarkdownHtml(text: string, _workingDir?: string): string {
  const src = String(text ?? '');
  const lines = src.split('\n');
  const html: string[] = [];

  let i = 0;
  let listOpen: 'ul' | 'ol' | null = null;
  const closeList = (): void => {
    if (listOpen) {
      html.push(`</${listOpen}>`);
      listOpen = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block, CommonMark rules — the length of the fence MATTERS. A run of 3+ backticks
    // (or tildes) opens, and only a run of AT LEAST that many closes it. That is the one escape hatch
    // for the case that broke here: an answer that hands over a whole document to copy, where the
    // document itself contains ``` blocks. Wrapping it in ```` is the correct way to say "all of this
    // is one block" — the old `^```(\w*)$` matched neither the 4-backtick open nor its close, so the
    // wrapper rendered as literal text and the document's own fences toggled at the wrong places:
    // half the block came out as a code box, the rest spilled into the page as prose.
    // The info string is now taken as-is instead of `\w*`, which had quietly rejected every ordinary
    // label with punctuation in it (```sh-session, ```c++, ```js title="a.js") — those pasted the fence
    // line into the paragraph above and left an empty code box behind.
    const fence = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
    // A backtick fence's info string may not itself contain a backtick (CommonMark), which is what
    // keeps an inline run like ``` `x` and `y` ``` from being read as the start of a block.
    if (fence && !(fence[2][0] === '`' && fence[3].includes('`'))) {
      closeList();
      const [, pad, marker, info] = fence;
      const lang = info.trim().split(/\s+/)[0] ?? '';
      const langAttr = lang ? ` data-lang="${esc(lang)}"` : '';
      // Same character, at least as long, nothing but whitespace after it.
      const closer = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
      const body: string[] = [];
      i++;
      while (i < lines.length && !closer.test(lines[i])) {
        // An indented fence indents its content too — strip the opener's indent, no more.
        body.push(lines[i].replace(new RegExp(`^ {0,${pad.length}}`), ''));
        i++;
      }
      i++; // consume the closing fence (or EOF — an unterminated block still renders, which is what
      //      a half-streamed answer needs)
      // The wrapper exists for the Copy button: `.md-code` is the horizontal SCROLL container, so a
      // button positioned inside it would slide out of view on a wide line. Anchoring it to a
      // non-scrolling parent keeps it pinned to the block's top-right corner instead.
      html.push(
        `<div class="md-codewrap"><pre class="md-code"${langAttr}><code>${esc(body.join('\n'))}</code></pre>` +
        `${copyButton()}</div>`
      );
      continue;
    }

    // GFM table: a header row with pipes immediately followed by a `|---|---|` delimiter row.
    if (line.includes('|') && i + 1 < lines.length && isDelimiterRow(lines[i + 1])) {
      closeList();
      const aligns = splitRow(lines[i + 1]).map((c) => {
        const l = c.startsWith(':');
        const r = c.endsWith(':');
        return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
      });
      const cell = (raw: string, idx: number, tag: 'th' | 'td'): string => {
        const a = aligns[idx] ? ` style="text-align:${aligns[idx]}"` : '';
        return `<${tag}${a}>${inline(esc(raw))}</${tag}>`;
      };
      const rowHtml = (cells: string[], tag: 'th' | 'td'): string =>
        `<tr>${cells.map((c, idx) => cell(c, idx, tag)).join('')}</tr>`;
      const out: string[] = [`<table class="md-table"><thead>${rowHtml(splitRow(line), 'th')}</thead><tbody>`];
      i += 2; // consume header + delimiter
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        out.push(rowHtml(splitRow(lines[i]), 'td'));
        i++;
      }
      out.push('</tbody></table>');
      html.push(out.join(''));
      continue;
    }

    // Heading: # … ######
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(esc(heading[2].trim()))}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote: > …
    if (/^>\s?/.test(line)) {
      closeList();
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      html.push(`<blockquote>${inline(esc(quote.join(' ')))}</blockquote>`);
      continue;
    }

    // Unordered list item: - / * / +
    const ul = line.match(/^[-*+]\s+(.*)$/);
    if (ul) {
      if (listOpen !== 'ul') {
        closeList();
        html.push('<ul>');
        listOpen = 'ul';
      }
      html.push(`<li>${inline(esc(ul[1]))}</li>`);
      i++;
      continue;
    }

    // Ordered list item: 1. …
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      if (listOpen !== 'ol') {
        closeList();
        html.push('<ol>');
        listOpen = 'ol';
      }
      html.push(`<li>${inline(esc(ol[1]))}</li>`);
      i++;
      continue;
    }

    // Blank line → close any open list, paragraph break.
    if (line.trim() === '') {
      closeList();
      i++;
      continue;
    }

    // Paragraph: gather consecutive non-special lines.
    closeList();
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      // Must match what the fence scanner above accepts, or a paragraph swallows the fence line that
      // was meant to end it (that is how ```sh-session ended up glued to the prose before it).
      !/^ {0,3}(`{3,}|~{3,})/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^[-*+]\s/.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i]) &&
      !/^>\s?/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    html.push(`<p>${inline(esc(para.join(' ')))}</p>`);
  }

  closeList();
  return html.join('\n');
}
