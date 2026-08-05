/* UpdateButton.tsx — the user-facing "update & restart" (in-app equivalent of
   scripts/update-and-run.command, minus opening a new tab): POST /api/update pulls the latest code,
   reinstalls+rebuilds (setup-node.sh), and hot-restarts the server; we poll /health for the restart
   blip and reload onto the fresh bundle (the SPA shell is no-cache since spec 059, so a plain reload
   IS the hard reload). Rendered for EVERYONE in the sidebar header — unlike the dev-only
   RebuildButton — because its whole point is that bản-sạch users update without a terminal.
   Confirm-gated (it's a minutes-long op that restarts the app); success toast survives the reload
   via localStorage (the RebuildButton pattern). */
import { useEffect, useRef, useState } from 'preact/hooks';
import { I } from './Icon';
import { api, ApiError } from '../api';
import { ls } from '../lib/dev';
import { t as tr } from '../lib/i18n';
import { askConfirm } from '../store';
import { waitForRestart } from './RebuildButton';

const UPDATED_KEY = 'builder:updated'; // timestamp stashed before the restart reload → toast after

export function UpdateButton({ collapsed = false }: { collapsed?: boolean }) {
  const [updating, setUpdating] = useState(false);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);

  // Always-on callout bubble under the button (the spec-088 bell-tip pattern) so the in-app update is
  // discoverable without hovering. FIXED-positioned from the measured button rect — same reasoning as
  // the bell: an absolutely-positioned child could be clipped by scrolling ancestors. Hidden while the
  // sidebar is collapsed (the button itself is hidden), while updating, and while a toast msg shows.
  const btnRef = useRef<HTMLButtonElement>(null);
  const [tipPos, setTipPos] = useState<{ top: number; left: number } | null>(null);
  const tipVisible = !collapsed && !updating && !msg;
  useEffect(() => {
    if (!tipVisible) { setTipPos(null); return; }
    const place = (): void => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r && r.width > 0) setTipPos({ top: r.bottom + 7, left: r.left });
      else setTipPos(null);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [tipVisible]);

  // Post-reload "done" toast (stashed before the reload, surfaced on the fresh mount).
  useEffect(() => {
    const ts = Number(ls.get(UPDATED_KEY));
    ls.del(UPDATED_KEY);
    if (!ts || Date.now() - ts > 60_000) return; // ignore stale / unrelated reloads
    setOk(true);
    setMsg(tr('updateDone'));
    const t = setTimeout(() => {
      setOk(false);
      setMsg('');
    }, 6000);
    return () => clearTimeout(t);
  }, []);

  const update = async (): Promise<void> => {
    const go = await askConfirm({ title: tr('updateConfirmTitle'), message: tr('updateConfirmMsg') });
    if (!go) return;
    setUpdating(true);
    setOk(false);
    setMsg(tr('updateRunning'));
    try {
      const r = await api.update();
      if (!r.ok) {
        setUpdating(false);
        const lastLine = (r.log ?? '').split('\n').filter(Boolean).slice(-1)[0] ?? '';
        setMsg(`${r.step === 'pull' ? tr('updatePullFailed') : tr('updateBuildFailed')}${lastLine ? ` — ${lastLine}` : ''}`);
        return;
      }
      setMsg(tr('updateRestarting'));
      ls.set(UPDATED_KEY, String(Date.now())); // survives the reload → toast on the fresh mount
      await waitForRestart();
      location.reload();
    } catch (e) {
      setUpdating(false);
      ls.del(UPDATED_KEY);
      if (e instanceof ApiError && e.status === 409) setMsg(tr('updateBusy'));
      else setMsg(e instanceof Error ? e.message : tr('updateBuildFailed'));
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        className={'icon-btn sb-rebuild' + (updating ? ' spinning' : '')}
        onClick={() => void update()}
        disabled={updating}
        title={tr('updateBtnHint')}
        aria-label={tr('updateBtnHint')}
      >
        <I.retry />
      </button>
      {tipVisible && tipPos && (
        <span className="notify-tip tip-left" aria-hidden="true"
          style={{ top: tipPos.top, left: tipPos.left }}>{tr('updateTip')}</span>
      )}
      {msg && <div className={'sb-rebuild-msg' + (ok ? ' ok' : '')}>{msg}</div>}
    </>
  );
}
