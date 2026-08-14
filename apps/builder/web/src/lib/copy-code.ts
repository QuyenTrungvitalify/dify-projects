/**
 * copy-code.ts — the click behavior behind the Copy button `markdown.ts` puts on every fenced block.
 *
 * ONE delegated listener on the document, not a handler per block. The rendered markdown reaches the
 * page as an innerHTML string on three separate surfaces (a chat answer, streamed run output, the spec
 * preview), and those strings are rebuilt on every token of a streaming answer — per-node listeners
 * would have to be re-attached after each of those renders, and the ones missed would be dead buttons
 * that look alive. Delegation has no attach step at all, so a block that appears mid-stream works.
 *
 * The copied text is read from the `<code>` element, never from the model string that produced it: what
 * the user sees IS what they get, and the button's own glyphs sit outside `<code>` so they cannot leak in.
 */
import { t as tr } from './i18n';

/** How long the ✓ confirmation stays — matches the main.yml Copy button's own 1.5s. */
const CONFIRM_MS = 1500;

/** Per-button revert timer, so double-clicking one button (or copying two blocks) can't cross-cancel. */
const timers = new WeakMap<HTMLElement, number>();

let installed = false;

async function onClick(e: MouseEvent): Promise<void> {
  const target = e.target as HTMLElement | null;
  const btn = target?.closest<HTMLElement>('.md-copy');
  if (!btn) return;
  const code = btn.closest('.md-codewrap')?.querySelector('code');
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code.textContent ?? '');
  } catch {
    // Clipboard denied or an insecure context — say nothing and change nothing. A "copied" tick that
    // lied would be worse than a button that visibly did nothing: the text is still selectable by hand.
    return;
  }
  btn.classList.add('copied');
  // The title carries the confirmation too: the tick is a 12px glyph, and a keyboard/screen-reader user
  // gets nothing from a CSS swap.
  btn.title = tr('copied');
  btn.setAttribute('aria-label', tr('copied'));
  clearTimeout(timers.get(btn));
  timers.set(btn, window.setTimeout(() => {
    // The block may have been re-rendered out from under us mid-timer (a streaming answer replaces its
    // whole subtree); touching a detached node is harmless, so this needs no liveness check.
    btn.classList.remove('copied');
    btn.title = tr('copyCode');
    btn.setAttribute('aria-label', tr('copyCode'));
    timers.delete(btn);
  }, CONFIRM_MS));
}

/** Install once (idempotent — a second call is a no-op, not a second listener). */
export function installCodeCopy(): void {
  if (installed) return;
  installed = true;
  document.addEventListener('click', (e) => void onClick(e));
}
