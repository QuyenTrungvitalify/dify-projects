/* AuthModal.tsx — signing in to Claude without a terminal (the UpdateButton principle applied to the
   one failure that stops EVERYTHING: a signed-out machine cannot run a single turn, so telling the
   user to "run `claude` in a terminal and log in" is telling them the app is over for now).

   The flow is dictated by what the CLI does, not by what we would prefer (see server/lib/claude-auth.ts
   for the measurements). The ordinary path asks NOTHING of this modal: the CLI opens a page against its
   own localhost callback, the user signs in there, and the CLI is signed in — no code, no paste, no
   click back here. So the modal's real job while it waits is to KEEP ASKING whether the machine is
   signed in yet, and to finish itself when the answer changes.

   The code box below is the fallback, and only that: the URL the CLI PRINTS (the one behind the link
   here) goes through the paste flow instead, which is what a machine with no browser to open — WSL2, a
   headless host — is left with. Wording it as the main event, which this modal did at first, is how the
   user ends up staring at a box waiting for a code no page is ever going to show them.

   NOTHING HAPPENS UNTIL THE BUTTON IS PRESSED, and that is the whole reason this starts `idle`.
   Starting the sign-in runs `claude auth login`, which OPENS A BROWSER TAB by itself — so a modal that
   began on mount would make the app spawn a tab of its own accord every time a signed-out user loaded
   the page, and again on every reload. The first press is what turns that tab from a surprise into the
   thing the user just asked for; it also makes the anchor below what it really is — a fallback for when
   the CLI could not open a browser (a headless host, WSL2), not the primary way through.

   The code box is a plain text input and stays one: it carries a one-use OAuth code, so it is never
   remembered, never prefilled, and never sent anywhere except this machine's own backend. */
import { useEffect, useState } from 'preact/hooks';
import { I } from './Icon';
import { api, ApiError } from '../api';
import { t as tr } from '../lib/i18n';

type Phase = 'idle' | 'starting' | 'ready' | 'exchanging' | 'done' | 'error';

export function AuthModal({ onClose, onSignedIn }: { onClose: () => void; onSignedIn?: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string>('');
  const [code, setCode] = useState('');

  async function begin(): Promise<void> {
    setPhase('starting');
    setErr('');
    setCode('');
    try {
      const r = await api.authLogin();
      setUrl(r.url);
      setPhase('ready');
    } catch (e) {
      setPhase('error');
      // `reason` decides the wording, not the sentence: "there is no claude here" is an admin problem
      // and "the login broke" is a retry, and they must not read the same.
      const reason = e instanceof ApiError ? e.reason : null;
      setErr(reason === 'cli_missing' ? tr('authCliMissing') : tr('authStartFailed'));
    }
  }

  useEffect(() => {
    // No start here — see the header. The login child holds a PTY for as long as this modal is open, so
    // closing it is the user walking away from the attempt and the child goes with it: best-effort, and
    // harmless both when nothing was started and when the attempt already finished (the server has
    // dropped the session by then).
    return () => {
      void api.authLoginCancel().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // While the page is open, keep asking. This is what makes the ordinary path work at all: the sign-in
  // completes inside the CLI, and nothing about it comes back through this modal. Asking the backend is
  // also strictly more general than watching our own child — it notices a sign-in done in a terminal, or
  // in another tab, just as well. Stops on unmount, and gives up after the server-side attempt would
  // have expired anyway, so a modal left open overnight is not a subprocess every two seconds forever.
  useEffect(() => {
    if (phase !== 'ready' && phase !== 'exchanging') return;
    let ticks = 0;
    const timer = setInterval(() => {
      if (++ticks > 300) { clearInterval(timer); return; } // 300 × 2s = the 10-minute session TTL
      void api
        .authStatus()
        .then((st) => {
          if (!st.loggedIn) return;
          clearInterval(timer);
          setPhase('done');
          onSignedIn?.();
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [phase, onSignedIn]);

  async function submit(): Promise<void> {
    const c = code.trim();
    if (!c || phase === 'exchanging') return;
    setPhase('exchanging');
    setErr('');
    try {
      const r = await api.authLoginCode(c);
      if (r.ok) {
        setPhase('done');
        onSignedIn?.();
        return;
      }
      // A rejected code kills the CLI's attempt, so there is nothing left to paste INTO: the honest
      // next step is a fresh page, which is what `begin()` produces.
      setErr(r.error ? `${tr('authFailed')} (${r.error})` : tr('authFailed'));
      setPhase('error');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="confirm-modal auth-modal" role="dialog" aria-modal="true" aria-label={tr('authTitle')}>
        <div className="confirm-icon">{phase === 'done' ? <I.check /> : <I.alert />}</div>
        <div className="confirm-body">
          <div className="confirm-title">{tr('authTitle')}</div>

          {phase === 'done' ? (
            <div className="confirm-message auth-ok">{tr('authDone')}</div>
          ) : (
            <>
              <div className="confirm-message">{tr('authWhy')}</div>

              {phase === 'starting' && <div className="confirm-message auth-dim">{tr('authStarting')}</div>}

              {url && phase !== 'error' && (
                <>
                  <div className="confirm-message">{tr('authOpened')}</div>
                  {phase === 'ready' && <div className="confirm-message auth-dim">{tr('authWaiting')}</div>}
                  <div className="confirm-message auth-dim auth-fallback">{tr('authFallback')}</div>
                  <a className="btn ghost auth-open" href={url} target="_blank" rel="noreferrer noopener">
                    {tr('authOpenPage')}
                  </a>
                  <label className="auth-code-label" for="auth-code">{tr('authCodeLabel')}</label>
                  <input
                    id="auth-code"
                    className="auth-code"
                    type="text"
                    autoComplete="off"
                    spellcheck={false}
                    value={code}
                    disabled={phase === 'exchanging'}
                    onInput={(e) => setCode((e.target as HTMLInputElement).value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                  />
                  {phase === 'exchanging' && <div className="confirm-message auth-dim">{tr('authExchanging')}</div>}
                </>
              )}

              {err && <div className="confirm-message auth-err">{err}</div>}
            </>
          )}
        </div>

        <div className="confirm-foot">
          <button className="btn ghost" onClick={onClose}>
            {phase === 'done' ? tr('close') : tr('cancel')}
          </button>
          {phase === 'idle' && (
            <button className="btn primary" autoFocus onClick={() => void begin()}>{tr('authOpenPage')}</button>
          )}
          {phase === 'error' && (
            <button className="btn primary" onClick={() => void begin()}>{tr('authRetry')}</button>
          )}
          {(phase === 'ready' || phase === 'exchanging') && (
            <button className="btn primary" disabled={!code.trim() || phase === 'exchanging'} onClick={() => void submit()}>
              {tr('authSubmit')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
