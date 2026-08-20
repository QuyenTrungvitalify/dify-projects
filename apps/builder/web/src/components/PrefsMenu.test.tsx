/**
 * PrefsMenu — the ⚙ header dropdown that replaced three always-on header pills.
 *
 * WHY THIS TEST EXISTS. Folding three one-click toggles into a menu trades away a property nobody
 * writes down: with the pills, applying a setting was self-evident. In a menu it depends on three
 * things that a refactor can quietly break — the option has to APPLY, the menu has to STAY OPEN so
 * the next setting is one click away, and the current value has to be MARKED so the menu can be read
 * as state rather than as a list of commands. Each was decided deliberately (a preferences panel, not
 * a command menu), and each is invisible to a type-checker.
 *
 * Follows the Disclosure precedent: assert what is RENDERED and what the click actually did, not the
 * internal flag. The vitest config already runs jsdom with the Preact preset.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render } from 'preact';
// Preact batches state updates from event handlers into a microtask — without act() every query
// below runs against the PREVIOUS render and sees an empty menu.
import { act } from 'preact/test-utils';
import { PrefsMenu } from './PrefsMenu';
import { lang, setLang } from '../lib/i18n';
import * as store from '../store';

let host: HTMLDivElement | null = null;

function mount(el: preact.ComponentChild): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  render(el as never, host);
  return host;
}

beforeEach(() => {
  setLang('en');
  store.setChatLang('auto');
});

afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = null;
  }
  setLang('en');
  store.setChatLang('auto');
});

/** Open the menu and hand back the host — every assertion here starts from an open menu. */
function open(theme: 'light' | 'dark' = 'light', onTheme: (t: 'light' | 'dark') => void = () => {}): HTMLDivElement {
  const h = mount(<PrefsMenu theme={theme} onTheme={onTheme} />);
  act(() => h.querySelector<HTMLButtonElement>('.prefs-wrap > button')!.click());
  return h;
}

/** The row whose visible label is `label`. */
function row(h: HTMLDivElement, label: string): HTMLButtonElement {
  const el = [...h.querySelectorAll<HTMLButtonElement>('.prefs-row')]
    .find((b) => b.textContent?.trim() === label);
  if (!el) throw new Error(`no option row labelled "${label}" — menu has: ${
    [...h.querySelectorAll('.prefs-row')].map((b) => b.textContent?.trim()).join(', ')}`);
  return el;
}

describe('PrefsMenu — three header pills folded into one ⚙ menu', () => {
  it('offers all three settings, so nothing was lost when the pills went away', () => {
    const h = open();
    const labels = [...h.querySelectorAll('.prefs-row')].map((b) => b.textContent?.trim());
    expect(labels).toEqual(['English', '日本語', 'Auto', 'Tiếng Việt', '日本語', 'Light', 'Dark']);
  });

  it('groups the options, so a screen reader announces which setting a row belongs to', () => {
    const h = open();
    const groups = [...h.querySelectorAll('[role=group]')].map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual(['Interface', 'Reply language', 'Theme']);
  });

  it('applies the UI language, and keeps the menu open for the next pick', () => {
    const h = open();
    act(() => row(h, '日本語').click());
    expect(lang.value).toBe('ja');
    // still open — the whole point of a preferences panel over a command menu
    expect(h.querySelector('.prefs-menu')).not.toBeNull();
  });

  it('applies the reply language independently of the UI language', () => {
    const h = open();
    act(() => row(h, 'Tiếng Việt').click());
    expect(store.settings.value.chatLang).toBe('vi');
    expect(lang.value).toBe('en'); // the two are deliberately separate settings
  });

  it('applies the theme through the callback the header owns', () => {
    const picked: string[] = [];
    const h = open('light', (t) => picked.push(t));
    act(() => row(h, 'Dark').click());
    expect(picked).toEqual(['dark']);
  });

  it('marks the value in force, so the menu reads as state and not as a list of commands', () => {
    const h = open('light');
    const checked = (label: string): string | null => row(h, label).getAttribute('aria-checked');
    expect([checked('English'), checked('Auto'), checked('Light')]).toEqual(['true', 'true', 'true']);
    expect([checked('日本語'), checked('Tiếng Việt'), checked('Dark')]).toEqual(['false', 'false', 'false']);
  });

  it('closes on Escape and hands focus back to the ⚙ button', () => {
    const h = open();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(h.querySelector('.prefs-menu')).toBeNull();
    expect(document.activeElement).toBe(h.querySelector('.prefs-wrap > button'));
  });
});
