// ask-notice.test.ts — spec 097: how a truncated answer's notice RENDERS.
//
// The notice is injected server-side as `\n\n---\n⚠ …` and appended to whatever the model had already
// streamed. Two things could go wrong in markdown and neither is visible from the server side:
//   - `---` on the line after text, with only ONE newline between, is a setext H2 underline — it would
//     turn the answer's last line into a giant heading instead of drawing a rule;
//   - the notice must survive rendering at all (it is the only thing telling the reader the answer is
//     incomplete, so silently losing it restores the exact bug 097 fixed).
import { describe, it, expect } from 'vitest';
import { renderMarkdownHtml } from './markdown';

/** Mirrors the server's `truncationNotice` shape (ask.ts). */
const NOTICE =
  '\n\n---\n⚠ This answer stopped early and is incomplete (timed out after 180s). ' +
  'Nothing was written to your files. Ask again — a narrower question finishes faster.';

describe('097 · the truncation notice renders as a rule, not a heading', () => {
  it('the last line of the partial answer does NOT become a heading', () => {
    const html = renderMarkdownHtml('Đang đối chiếu với các workflow mẫu trong kho…' + NOTICE);
    expect(html).not.toMatch(/<h[12]/);
    expect(html).toMatch(/đối chiếu/);
  });

  it('the notice text survives rendering', () => {
    const html = renderMarkdownHtml('partial…' + NOTICE);
    expect(html).toMatch(/stopped early and is incomplete/);
    expect(html).toMatch(/timed out after 180s/);
    expect(html).toMatch(/Nothing was written to your files/);
  });

  it('a partial answer ending mid-list still separates cleanly', () => {
    // The realistic shape: the model was mid-bullet when the wall hit.
    const html = renderMarkdownHtml('- checked the pattern\n- checking default_value' + NOTICE);
    expect(html).not.toMatch(/<h[12]/);
    expect(html).toMatch(/stopped early/);
  });
});
