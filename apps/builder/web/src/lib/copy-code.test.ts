/**
 * The per-block Copy button's behavior. Worth its own tests because the listener is DELEGATED: nothing
 * re-attaches it when a streaming answer replaces its subtree, so the properties that matter are
 * "works on a block that appeared after install" and "copies the code, not the button's own glyphs".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderMarkdownHtml } from './markdown';
import { installCodeCopy } from './copy-code';

const writeText = vi.fn<(t: string) => Promise<void>>();

/** Render markdown into the document the way the real surfaces do (innerHTML), then click a button. */
function mount(md: string): HTMLElement {
  const host = document.createElement('div');
  host.className = 'md-stream';
  host.innerHTML = renderMarkdownHtml(md);
  document.body.appendChild(host);
  return host;
}
const click = (btn: Element): void => {
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '';
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  installCodeCopy(); // idempotent by contract — every test calls it, only the first installs
});

describe('installCodeCopy', () => {
  it('copies the block text — the code only, without the button glyphs', async () => {
    const host = mount(['```js', 'const a = 1;', 'const b = 2;', '```'].join('\n'));
    click(host.querySelector('.md-copy')!);
    await settle();
    expect(writeText).toHaveBeenCalledWith('const a = 1;\nconst b = 2;');
  });

  it('copies the block the button belongs to, not the first one on the page', async () => {
    const host = mount(['```', 'FIRST', '```', '', '```', 'SECOND', '```'].join('\n'));
    click(host.querySelectorAll('.md-copy')[1]!);
    await settle();
    expect(writeText).toHaveBeenCalledWith('SECOND');
  });

  it('works on a block inserted AFTER install (a streaming answer re-renders its subtree)', async () => {
    mount('```\nEARLY\n```');
    document.body.innerHTML = ''; // the subtree the first render created is gone
    const later = mount('```\nLATE\n```');
    click(later.querySelector('.md-copy')!);
    await settle();
    expect(writeText).toHaveBeenCalledWith('LATE');
  });

  it('un-escapes what it copies (the DOM text, not the escaped HTML)', async () => {
    const host = mount('```\n<b>x</b> & "y"\n```');
    click(host.querySelector('.md-copy')!);
    await settle();
    expect(writeText).toHaveBeenCalledWith('<b>x</b> & "y"');
  });

  it('confirms with the copied class + label, and reverts', async () => {
    vi.useFakeTimers();
    try {
      const host = mount('```\nX\n```');
      const btn = host.querySelector('.md-copy') as HTMLElement;
      const idle = btn.title;
      click(btn);
      await vi.advanceTimersByTimeAsync(0);
      expect(btn.classList.contains('copied')).toBe(true);
      expect(btn.title).not.toBe(idle);
      expect(btn.getAttribute('aria-label')).toBe(btn.title); // the tick alone says nothing to a reader
      await vi.advanceTimersByTimeAsync(1500);
      expect(btn.classList.contains('copied')).toBe(false);
      expect(btn.title).toBe(idle);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT claim success when the clipboard rejects (denied / insecure context)', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    const host = mount('```\nX\n```');
    const btn = host.querySelector('.md-copy') as HTMLElement;
    click(btn);
    await settle();
    expect(btn.classList.contains('copied')).toBe(false);
  });

  it('ignores a click anywhere else in the block', async () => {
    const host = mount('```\nX\n```');
    click(host.querySelector('code')!);
    await settle();
    expect(writeText).not.toHaveBeenCalled();
  });
});
