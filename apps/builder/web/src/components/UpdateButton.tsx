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
import { t as tr, tf } from '../lib/i18n';
import { askConfirm } from '../store';
import { waitForRestart } from './RebuildButton';

const UPDATED_KEY = 'builder:updated'; // timestamp stashed before the restart reload → toast after

export function UpdateButton({ collapsed = false }: { collapsed?: boolean }) {
  const [updating, setUpdating] = useState(false);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);

  // Hover-only callout bubble under the button (the spec-088 bell-tip look, but NOT always-on).
  // The bubble stays in the DOM (position measured from the button rect — FIXED, same reasoning as
  // the bell: an absolutely-positioned child could be clipped by scrolling ancestors) and CSS
  // `.sb-rebuild:hover + .upd-tip` reveals it — pure :hover, no JS mouse events. Suppressed while
  // the sidebar is collapsed (the button itself is hidden), while updating, and while a toast shows.
  const btnRef = useRef<HTMLButtonElement>(null);
  const [tipPos, setTipPos] = useState<{ top: number; left: number } | null>(null);
  const tipMounted = !collapsed && !updating && !msg;
  useEffect(() => {
    if (!tipMounted) { setTipPos(null); return; }
    const place = (): void => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r && r.width > 0) setTipPos({ top: r.bottom + 7, left: r.left });
      else setTipPos(null);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [tipMounted]);

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
        const lines = (r.log ?? '').split('\n').filter(Boolean);
        if (r.step === 'branch') {
          // NOT a failure — the update declined on purpose because HEAD is not main, and `log` carries
          // the branch name. Naming it is the whole point: the previous behaviour switched to main
          // silently, so someone testing a branch ended up testing main with nothing to show for it.
          setMsg(tf('updateOnBranch', { branch: (r.log ?? '').trim() || '?' }));
          return;
        }
        const lastLine = lines.slice(-1)[0] ?? '';
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
        aria-label={tr('updateBtnHint')}
      >
        <I.retry />
      </button>
      {tipMounted && tipPos && (
        <span className="notify-tip tip-left upd-tip" aria-hidden="true"
          style={{ top: tipPos.top, left: tipPos.left }}>{tr('updateTip')}</span>
      )}
      {msg && <div className={'sb-rebuild-msg' + (ok ? ' ok' : '')}>{msg}</div>}
    </>
  );
}
