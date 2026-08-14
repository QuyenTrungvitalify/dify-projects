/**
 * T8 — markdown renderer XSS-safety + the streamed-text guards. The load-bearing property is that
 * untrusted model/user text is HTML-escaped BEFORE any markup is produced (no innerHTML-of-raw path),
 * plus the two stream-specific fixes: code spans shield their contents, and intra-word
 * `snake_case` / `a*b` don't get italicized.
 */
import { describe, it, expect } from 'vitest';
import { renderMarkdownHtml } from './markdown';

describe('renderMarkdownHtml — XSS safety', () => {
  it('escapes HTML before rendering (no live tag survives)', () => {
    const out = renderMarkdownHtml('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('escapes HTML inside fenced code blocks', () => {
    const out = renderMarkdownHtml('```\n<b>x</b>\n```');
    expect(out).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(out).toContain('<pre');
  });

  it('drops a javascript: link target to #', () => {
    const out = renderMarkdownHtml('[x](javascript:void)');
    expect(out).toContain('href="#"');
    expect(out).not.toContain('javascript:');
  });

  it('keeps an http(s) link target', () => {
    const out = renderMarkdownHtml('[x](https://example.com)');
    expect(out).toContain('href="https://example.com"');
  });
});

describe('renderMarkdownHtml — bare-URL autolink', () => {
  it('autolinks a bare http(s) URL into a new-tab anchor', () => {
    const url = 'http://localhost:8090/app/73791c65-cd82-4a3b-8a98-171316d84e01/workflow';
    const out = renderMarkdownHtml(`app: ${url}`);
    expect(out).toContain(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  });

  it('does not swallow trailing sentence punctuation', () => {
    const out = renderMarkdownHtml('see http://example.com/foo.');
    expect(out).toContain('href="http://example.com/foo"');
    expect(out).not.toContain('foo."'); // the '.' stays as text, outside the href
  });

  it('links a URL wrapped in parentheses without eating the closing paren', () => {
    const out = renderMarkdownHtml('(http://example.com/x)');
    expect(out).toContain('href="http://example.com/x"');
    expect(out).toContain(')'); // the wrapping ) remains literal text
    expect(out).not.toContain('href="http://example.com/x)"');
  });

  it('does not autolink a bare non-http scheme', () => {
    const out = renderMarkdownHtml('run javascript:alert(1) now');
    expect(out).not.toContain('<a ');
  });

  it('does not double-link a URL already inside a markdown link', () => {
    const out = renderMarkdownHtml('[site](https://example.com)');
    // exactly one anchor — the autolink pass must not re-wrap the href's URL
    expect(out.match(/<a /g)?.length).toBe(1);
    expect(out).not.toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a>');
  });

  it('does not autolink a URL inside an inline code span', () => {
    const out = renderMarkdownHtml('use `curl http://example.com` here');
    expect(out).toContain('<code>curl http://example.com</code>');
    expect(out).not.toContain('<a ');
  });

  it('preserves a snake_case path segment in the URL (emphasis must not corrupt it)', () => {
    const out = renderMarkdownHtml('open http://example.com/a_b_c/d');
    expect(out).toContain('href="http://example.com/a_b_c/d"');
    expect(out).not.toContain('<em>');
  });
});

describe('renderMarkdownHtml — emphasis / code guards', () => {
  it('renders inline code and shields its contents from emphasis', () => {
    const out = renderMarkdownHtml('use `a_b_c` now');
    expect(out).toContain('<code>a_b_c</code>');
    expect(out).not.toContain('<em>');
  });

  it('does NOT italicize snake_case identifiers', () => {
    const out = renderMarkdownHtml('the my_var_name token');
    expect(out).toContain('my_var_name');
    expect(out).not.toContain('<em>');
  });

  it('does NOT italicize intra-word a*b (multiplication)', () => {
    const out = renderMarkdownHtml('compute a*b*c here');
    expect(out).not.toContain('<em>');
  });

  it('still renders real emphasis and bold at word boundaries', () => {
    expect(renderMarkdownHtml('an *emphatic* word')).toContain('<em>emphatic</em>');
    expect(renderMarkdownHtml('a **strong** word')).toContain('<strong>strong</strong>');
  });

  it('renders ~~strikethrough~~ (toolbar S button)', () => {
    expect(renderMarkdownHtml('a ~~struck~~ word')).toContain('<del>struck</del>');
  });
});

describe('renderMarkdownHtml — GFM tables', () => {
  const TABLE = ['| A | B |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |'].join('\n');

  it('renders a pipe table as a real <table>, not a joined paragraph', () => {
    const out = renderMarkdownHtml(TABLE);
    expect(out).toContain('<table class="md-table">');
    expect(out).toContain('<thead><tr><th>A</th><th>B</th></tr></thead>');
    expect(out).toContain('<tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody>');
    expect(out).not.toContain('<p>');
  });

  it('applies column alignment from the delimiter row', () => {
    const out = renderMarkdownHtml(['| L | C | R |', '| :--- | :---: | ---: |', '| a | b | c |'].join('\n'));
    expect(out).toContain('<th style="text-align:left">L</th>');
    expect(out).toContain('<th style="text-align:center">C</th>');
    expect(out).toContain('<th style="text-align:right">R</th>');
    expect(out).toContain('<td style="text-align:center">b</td>');
  });

  it('escapes cell content and renders inline markdown inside cells', () => {
    const out = renderMarkdownHtml(['| h |', '|---|', '| `code` & <b> |'].join('\n'));
    expect(out).toContain('<code>code</code>');
    expect(out).toContain('&amp;');
    expect(out).toContain('&lt;b&gt;');
  });

  it('handles escaped pipes inside a cell', () => {
    const out = renderMarkdownHtml(['| a | b |', '|---|---|', '| x \\| y | z |'].join('\n'));
    expect(out).toContain('<td>x | y</td>');
  });

  it('ends the table at a blank line', () => {
    const out = renderMarkdownHtml([TABLE, '', 'after the table'].join('\n'));
    expect(out).toContain('</table>');
    expect(out).toContain('<p>after the table</p>');
  });

  it('does NOT treat a lone pipe-bearing line (no delimiter row) as a table', () => {
    const out = renderMarkdownHtml('a | b | c');
    expect(out).not.toContain('<table');
    expect(out).toContain('<p>a | b | c</p>');
  });
});

/**
 * Fence LENGTH and the info string. The reported symptom was a hand-over block ("copy this whole
 * document") that rendered as a code box which stopped mid-document, with the remainder spilling into
 * the page as prose. Cause: the scanner only understood exactly three backticks and a `\w*` label, so
 * the one correct way to wrap content that itself contains ``` — a longer fence — was unreadable to it,
 * and every label with punctuation (`sh-session`, `c++`) fell out of the code path entirely.
 */
describe('renderMarkdownHtml — fenced blocks', () => {
  const blocks = (html: string): number => (html.match(/<pre class="md-code"/g) || []).length;

  it('a ````-fence holds content that itself contains ``` (the copy-a-document case)', () => {
    const out = renderMarkdownHtml(
      ['````markdown', '# Doc', '', '```', 'inner', '```', '', 'tail', '````'].join('\n')
    );
    // ONE block, and everything is inside it — no half-block plus loose prose.
    expect(blocks(out)).toBe(1);
    expect(out).toContain('data-lang="markdown"');
    expect(out).toContain('# Doc');
    expect(out).toContain('tail');
    expect(out).not.toContain('<p>tail</p>');
    expect(out).not.toContain('<h1>Doc</h1>'); // the wrapped text stays verbatim, never re-parsed
  });

  it('a shorter run inside a longer fence does not close it', () => {
    const out = renderMarkdownHtml(['`````', '```', 'x', '```', '`````'].join('\n'));
    expect(blocks(out)).toBe(1);
    // Assert the CONTENT, not just the count: before the fix this input also produced exactly one
    // block — the wrong one, opened by the inner ``` while the ````` lines fell out as paragraphs.
    expect(out).toContain('<code>```\nx\n```</code>');
  });

  it('a fence closes only on a run at least as long as the one that opened it', () => {
    const out = renderMarkdownHtml(['```', 'a', '````', 'b', '```'].join('\n'));
    // The 4-run closes the 3-fence (>= is the rule), so `b` lands outside it.
    expect(out).toContain('<code>a</code>');
    expect(out).toContain('<p>b</p>');
  });

  it('keeps a label with punctuation in it (and puts the code IN the block)', () => {
    for (const [label, expected] of [['sh-session', 'sh-session'], ['c++', 'c++'], ['js title="a.js"', 'js']] as const) {
      const out = renderMarkdownHtml(['```' + label, 'CODE_LINE', '```'].join('\n'));
      expect(out, label).toContain(`data-lang="${expected.replace(/"/g, '&quot;')}"`);
      expect(out, label).toContain('<code>CODE_LINE</code>');
      expect(out, label).not.toContain('<p>'); // the fence line used to be glued into a paragraph
    }
  });

  it('accepts up to 3 spaces of indent and strips that much from the content', () => {
    const out = renderMarkdownHtml(['   ```', '   code', '   ```'].join('\n'));
    expect(blocks(out)).toBe(1);
    expect(out).toContain('<code>code</code>');
  });

  it('supports ~~~ fences without eating them as strikethrough', () => {
    const out = renderMarkdownHtml(['~~~', 'code', '~~~'].join('\n'));
    expect(blocks(out)).toBe(1);
    expect(out).toContain('<code>code</code>');
    expect(out).not.toContain('<del>');
  });

  it('leaves an unterminated fence open to EOF (a half-streamed answer still renders)', () => {
    const out = renderMarkdownHtml(['```', 'still', 'streaming'].join('\n'));
    expect(blocks(out)).toBe(1);
    expect(out).toContain('still\nstreaming');
  });

  it('does not read an inline backtick run as a fence opener', () => {
    const out = renderMarkdownHtml('``` `a` and `b` ```');
    expect(blocks(out)).toBe(0);
  });

  it('emits a Copy button per block, OUTSIDE <code> so its glyphs never land in the copied text', () => {
    const out = renderMarkdownHtml(['```', 'CODE', '```', '', '```', 'OTHER', '```'].join('\n'));
    expect((out.match(/class="md-copy"/g) || []).length).toBe(2);
    expect((out.match(/class="md-codewrap"/g) || []).length).toBe(2);
    // the button follows </pre>: nothing it contains is inside the <code> the copy reads from
    expect(out).toMatch(/<\/pre><button class="md-copy"/);
    expect(out).toContain('<code>CODE</code>');
  });

  it('a code block with no fence (never happens) leaves no orphan button', () => {
    expect(renderMarkdownHtml('plain text')).not.toContain('md-copy');
  });
});
