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

/** Escape the five HTML-significant chars so user/model text can never inject markup. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Inline spans: code → bold → italic → links. Operates on ALREADY-escaped text. */
function inline(escaped: string): string {
  // Pull inline `code` spans out to NUL sentinels FIRST so their contents are genuinely shielded from
  // the emphasis/link passes below (those .replace() calls scan the whole string, so a `*`/`_`/`[`
  // inside a code span would otherwise be wrongly rewritten). Re-inserted verbatim at the end.
  const codes: string[] = [];
  let out = escaped.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(`<code>${c}</code>`);
    return `\x00${codes.length - 1}\x00`; // NUL can't occur in escaped model/user text
  });
  // [label](url) — only http/https/relative; the url is escaped, javascript: is dropped.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => {
    const safe = /^(https?:\/\/|\/|\.\/|#)/i.test(url) ? url : '#';
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Emphasis only when the marker is flanked by non-word chars, so intra-word `my_var_name` / `a*b`
  // (snake_case identifiers, multiplication — which Claude streams constantly) don't italicize.
  out = out.replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^\w_])_([^_\n]+)_(?=[^\w_]|$)/g, '$1<em>$2</em>');
  // Re-insert the protected code spans.
  out = out.replace(/\x00(\d+)\x00/g, (_m, n) => codes[Number(n)]);
  return out;
}

/**
 * Render markdown → an HTML string. Block-level scan over lines: fenced code blocks are emitted
 * verbatim (escaped, never re-parsed), then headings / lists / blockquotes / paragraphs.
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

    // Fenced code block: ```lang … ```
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      closeList();
      const lang = fence[1] ? ` data-lang="${esc(fence[1])}"` : '';
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // consume the closing fence (or EOF)
      html.push(`<pre class="md-code"${lang}><code>${esc(body.join('\n'))}</code></pre>`);
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
      !/^```/.test(lines[i]) &&
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
