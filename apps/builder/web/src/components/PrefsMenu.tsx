/* ============================================================
   PrefsMenu.tsx — the header's ⚙ preferences dropdown.

   Three GLOBAL settings used to sit in the header as three
   separate pills: UI-chrome language (🌐), the language the model
   answers in (💬), and light/dark. None of them is a run action,
   yet they took three of the header's scarce slots and pushed the
   pills that ARE run actions (Artifact / Export / Edit / Promote)
   toward the scroll edge. They now live behind ONE icon button.

   The menu stays OPEN while you flip switches — it is a
   preferences panel, not a command menu, and reply-language +
   theme are commonly changed in the same visit. Escape or a click
   on the scrim closes it.

   Positioned FIXED and anchored to the button: the header pill row
   (.chat-top-right) is overflow-x:auto, which clips an absolutely
   positioned child — the same reason the Export menu and the bell
   tip do this. Measured at open time and re-measured on
   resize/scroll while open.
   ============================================================ */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { VNode } from 'preact';
import { I } from './Icon';
import * as store from '../store';
import { t as tr, tf, lang, setLang } from '../lib/i18n';

type Theme = 'light' | 'dark';

/** One selectable option row — the check column is always reserved so labels stay aligned. */
function Row({ on, label, onPick }: { on: boolean; label: string; onPick: () => void }): VNode {
  return (
    <button className={'prefs-row' + (on ? ' on' : '')} role="menuitemradio" aria-checked={on}
      onClick={onPick}>
      <I.check className="prefs-check" />
      <span>{label}</span>
    </button>
  );
}

export function PrefsMenu({ theme, onTheme }: { theme: Theme; onTheme: (t: Theme) => void }): VNode {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const chatLang = store.settings.value.chatLang;

  const place = (): void => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
  };
  const toggle = (): void => {
    setOpen((o) => {
      if (!o) place(); // measure BEFORE the first paint of the menu, so it never flashes unplaced
      return !o;
    });
  };

  useEffect(() => {
    if (!open) return;
    // Escape also RETURNS focus to the ⚙ button: the row that had it is about to be unmounted, and
    // focus stranded on <body> makes the next Tab restart from the top of the page.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      btnRef.current?.focus();
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true); // capture: the pill row itself can scroll
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="prefs-wrap">
      <button ref={btnRef} className="ghost-pill" onClick={toggle}
        title={tr('prefs')} aria-label={tr('prefs')} aria-haspopup="menu" aria-expanded={open}>
        <I.sliders /><I.chevron className="export-caret" />
      </button>
      {open && (
        <>
          <div className="menu-scrim" onClick={() => setOpen(false)} />
          <div className="prefs-menu" role="menu"
            style={pos ? { position: 'fixed', top: pos.top, right: pos.right, left: 'auto' } : undefined}>
            <div className="prefs-sec" role="group" aria-label={tr('prefsUiLang')}>
              <div className="prefs-sec-title"><I.globe />{tr('prefsUiLang')}</div>
              <Row on={lang.value === 'en'} label="English" onPick={() => setLang('en')} />
              <Row on={lang.value === 'ja'} label="日本語" onPick={() => setLang('ja')} />
            </div>
            {/* The language the MODEL answers in — deliberately SEPARATE from the chrome language
                above: Japanese chrome + Vietnamese replies is a real combination here. */}
            <div className="prefs-sec" role="group" aria-label={tr('prefsReplyLang')}>
              <div className="prefs-sec-title"
                title={tf('chatLangHint', { name: store.CHAT_LANG_NAME[chatLang] || tr('chatLangAutoName') })}>
                <I.message />{tr('prefsReplyLang')}
              </div>
              <Row on={chatLang === 'auto'} label={tr('chatLangAuto')} onPick={() => store.setChatLang('auto')} />
              <Row on={chatLang === 'vi'} label={store.CHAT_LANG_NAME.vi} onPick={() => store.setChatLang('vi')} />
              <Row on={chatLang === 'ja'} label={store.CHAT_LANG_NAME.ja} onPick={() => store.setChatLang('ja')} />
            </div>
            <div className="prefs-sec" role="group" aria-label={tr('prefsTheme')}>
              <div className="prefs-sec-title">{theme === 'light' ? <I.sun /> : <I.moon />}{tr('prefsTheme')}</div>
              <Row on={theme === 'light'} label={tr('themeLight')} onPick={() => onTheme('light')} />
              <Row on={theme === 'dark'} label={tr('themeDark')} onPick={() => onTheme('dark')} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
