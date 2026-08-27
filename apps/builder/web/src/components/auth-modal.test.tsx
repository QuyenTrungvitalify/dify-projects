/**
 * The sign-in modal, as a user meets it.
 *
 * WHY THIS TEST EXISTS. This surface appears at exactly one moment: the app is unusable and the user
 * has just been stopped. Everything that makes it worth having is a rendering decision, and each one
 * fails silently if it regresses:
 *
 *   - The link must carry the URL the SERVER handed back, verbatim. The code the user will paste is
 *     only redeemable against the PKCE challenge of the child that printed THAT url; a stale or
 *     rewritten link produces a code that fails with nothing on screen explaining why.
 *   - The code box may not exist before there is a page to get a code from — a box you can type into
 *     while nothing has opened invites pasting the wrong thing.
 *   - A rejected code must NOT leave the box sitting there. The attempt is dead server-side, so the
 *     honest next step is a new page; a box that still accepts input is a dead end that looks live.
 *   - It must finish ON ITS OWN. `[ĐO]` The CLI opens its page against its own localhost callback, so
 *     the ordinary sign-in completes with nothing coming back through this modal — no code, no click.
 *     The first version waited for a paste and would have sat there forever on every normal machine.
 *   - Closing must cancel. The child holds a PTY for ten minutes otherwise.
 *   - And nothing may start on mount. `claude auth login` opens a browser tab by itself, so a modal
 *     that began on mount would have the app spawning tabs unasked — on every load, and every reload,
 *     for anyone signed out. The first press is what makes that tab something the user asked for.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { AuthModal } from './AuthModal';
import { api } from '../api';

const URL_ = 'https://claude.com/cai/oauth/authorize?code=true&state=abc123';

let host: HTMLDivElement | null = null;

async function mount(props: Parameters<typeof AuthModal>[0]): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    render(<AuthModal {...props} />, host!);
  });
  return host;
}

beforeEach(() => {
  vi.spyOn(api, 'authLogin').mockResolvedValue({ url: URL_ });
  vi.spyOn(api, 'authLoginCancel').mockResolvedValue({ ok: true });
  // The default machine is signed out and stays that way, so the poll below never fires by accident.
  vi.spyOn(api, 'authStatus').mockResolvedValue({ available: true, loggedIn: false, authMethod: 'none' });
});

afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = null;
  }
  vi.restoreAllMocks();
});

const codeBox = (h: HTMLElement): HTMLInputElement | null => h.querySelector('input.auth-code');
const link = (h: HTMLElement): HTMLAnchorElement | null => h.querySelector('a.auth-open');
const foot = (h: HTMLElement): HTMLButtonElement[] => [...h.querySelectorAll('.confirm-foot .btn')] as HTMLButtonElement[];

/** Press the button that starts the sign-in — the modal does nothing until this happens. */
async function press(h: HTMLElement, match: RegExp): Promise<void> {
  const b = foot(h).find((x) => match.test(x.textContent ?? ''));
  if (!b) throw new Error(`no footer button matching ${match}`);
  await act(async () => { b.click(); });
}

describe('AuthModal', () => {
  it('starts nothing until the button is pressed — no tab appears on its own', async () => {
    const h = await mount({ onClose: () => {} });
    expect(api.authLogin).not.toHaveBeenCalled();
    expect(link(h)).toBeNull();
    expect(codeBox(h)).toBeNull();
    await press(h, /Open the sign-in page/);
    expect(api.authLogin).toHaveBeenCalled();
  });

  it('sends the user to the URL the server returned, unaltered, in a new tab', async () => {
    const h = await mount({ onClose: () => {} });
    await press(h, /Open the sign-in page/);
    expect(link(h)?.getAttribute('href')).toBe(URL_);
    expect(link(h)?.getAttribute('target')).toBe('_blank');
    // A new tab that can reach back into this one would be handing an outside page the app's window.
    expect(link(h)?.getAttribute('rel')).toContain('noopener');
  });

  it('cannot be submitted with an empty box', async () => {
    const submit = vi.spyOn(api, 'authLoginCode');
    const h = await mount({ onClose: () => {} });
    await press(h, /Open the sign-in page/);
    const finish = foot(h).find((b) => b.textContent?.includes('signing in'));
    expect((finish as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      codeBox(h)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it('offers no code box until there is a page to get a code from', async () => {
    let resolveLogin: (v: { url: string }) => void = () => {};
    vi.spyOn(api, 'authLogin').mockReturnValue(new Promise((r) => { resolveLogin = r; }));
    const h = await mount({ onClose: () => {} });
    await press(h, /Open the sign-in page/);
    expect(codeBox(h)).toBeNull(); // the CLI has not printed a URL yet
    await act(async () => { resolveLogin({ url: URL_ }); });
    expect(codeBox(h)).not.toBeNull();
  });

  it('sends the pasted code and reports success — nothing about the code is kept on screen', async () => {
    const submit = vi.spyOn(api, 'authLoginCode').mockResolvedValue({ ok: true, authMethod: 'claudeai' });
    const onSignedIn = vi.fn();
    const h = await mount({ onClose: () => {}, onSignedIn });
    await press(h, /Open the sign-in page/);

    const box = codeBox(h)!;
    await act(async () => {
      box.value = 'the-users-pasted-code-1234';
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(submit).toHaveBeenCalledWith('the-users-pasted-code-1234');
    expect(onSignedIn).toHaveBeenCalled();
    expect(codeBox(h)).toBeNull();
    expect(h.textContent).not.toContain('the-users-pasted-code-1234');
  });

  it('a rejected code closes the box and offers a fresh page — not another try at a dead one', async () => {
    vi.spyOn(api, 'authLoginCode').mockResolvedValue({ ok: false, error: 'Login failed: Request failed with status code 400' });
    const h = await mount({ onClose: () => {} });
    await press(h, /Open the sign-in page/);
    const box = codeBox(h)!;
    await act(async () => {
      box.value = 'wrong-code-abcdef';
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(codeBox(h)).toBeNull();
    expect(h.querySelector('.auth-err')?.textContent).toContain('400');
    // The way back is a NEW sign-in page, and it is on screen.
    expect(foot(h).length).toBeGreaterThan(1);
  });

  it('finishes by itself once the machine reports signed in — nothing typed, nothing clicked', async () => {
    // This is the ordinary path, and it is invisible from here: the user signs in on the tab the CLI
    // opened, the CLI takes the callback, and the only way this modal can know is by asking again.
    const onSignedIn = vi.fn();
    const submit = vi.spyOn(api, 'authLoginCode');
    vi.useFakeTimers();
    try {
      const h = await mount({ onClose: () => {}, onSignedIn });
      await press(h, /Open the sign-in page/);
      expect(codeBox(h)).not.toBeNull();

      vi.mocked(api.authStatus).mockResolvedValue({ available: true, loggedIn: true, authMethod: 'claude.ai' });
      await act(async () => { await vi.advanceTimersByTimeAsync(2500); });

      expect(onSignedIn).toHaveBeenCalled();
      expect(codeBox(h)).toBeNull();
      expect(submit).not.toHaveBeenCalled(); // no paste was involved anywhere
    } finally {
      vi.useRealTimers();
    }
  });

  it('closing cancels the login — the child does not outlive the modal', async () => {
    const cancel = vi.spyOn(api, 'authLoginCancel').mockResolvedValue({ ok: true });
    const h = await mount({ onClose: () => {} });
    await press(h, /Open the sign-in page/);
    await act(async () => { render(null, h); });
    expect(cancel).toHaveBeenCalled();
  });
});
