/* RebuildButton.tsx — the dev-only `⟳ rebuild` action (spec 059), lifted out of the DevPanel and into
   the sidebar header so it's reachable from ANY view (home, gate, a running build) — not just when a
   build is open. Rebuilds server + web then hot-restarts the process; the restart reloads the page, so
   the "✓ rebuilt" success signal is stashed in localStorage BEFORE the reload and surfaced on the fresh
   mount. Self-contained: owns its state, poll, and the post-reload toast. Renders nothing user-facing
   unless mounted under `devMode`. Needs BUILDER_DEV=1 on the server (404 → the disabled hint). */
import { useEffect, useState } from 'preact/hooks';
import { I } from './Icon';
import { api, ApiError } from '../api';
import { ls } from '../lib/dev';

const REBUILT_KEY = 'builder:dev:rebuilt'; // timestamp stashed before the rebuild reload → toast after

/** Poll /health for the restart blip: wait until it goes DOWN (connection refused / not ok) then comes
 *  back UP, so we reload onto the fresh server — not the dying old one. Bounded (~2min) then gives up.
 *  Exported for UpdateButton (the user-facing update shares the same restart choreography). */
export async function waitForRestart(): Promise<boolean> {
  const up = async (): Promise<boolean> => {
    try {
      return (await fetch('/health', { cache: 'no-store' })).ok;
    } catch {
      return false;
    }
  };
  const started = Date.now();
  let wentDown = false;
  while (Date.now() - started < 120_000) {
    const isUp = await up();
    if (!isUp) wentDown = true;
    else if (wentDown) return true; // back up after going down → the new server is live
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export function RebuildButton() {
  const [rebuilding, setRebuilding] = useState(false);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);

  // Post-reload "done" toast: the rebuild reloads the page, so the success signal is stashed in
  // localStorage BEFORE the reload and surfaced here on the fresh mount.
  useEffect(() => {
    const ts = Number(ls.get(REBUILT_KEY));
    ls.del(REBUILT_KEY);
    if (!ts || Date.now() - ts > 30_000) return; // ignore stale / unrelated reloads
    setOk(true);
    setMsg('✓ rebuilt & restarted');
    const t = setTimeout(() => {
      setOk(false);
      setMsg('');
    }, 5000);
    return () => clearTimeout(t);
  }, []);

  const rebuild = async (): Promise<void> => {
    setRebuilding(true);
    setOk(false);
    setMsg('building server + web…');
    try {
      const r = await api.devRebuild();
      if (!r.ok) {
        setRebuilding(false);
        const lastLine = (r.log ?? '').split('\n').filter(Boolean).slice(-1)[0] ?? '';
        setMsg(r.reason ?? `build failed — ${lastLine || 'see .runs/dev-restart.log'}`);
        return;
      }
      setMsg('restarting… (reloads when back up)');
      ls.set(REBUILT_KEY, String(Date.now())); // survives the reload → toast on the fresh mount
      await waitForRestart();
      location.reload();
    } catch (e) {
      setRebuilding(false);
      ls.del(REBUILT_KEY);
      if (e instanceof ApiError && e.status === 404) setMsg('disabled — start the server with BUILDER_DEV=1');
      else if (e instanceof ApiError && e.status === 409) setMsg('a build is running — cancel it first');
      else setMsg(e instanceof Error ? e.message : 'rebuild failed');
    }
  };

  return (
    <>
      <button
        className={'icon-btn sb-rebuild' + (rebuilding ? ' spinning' : '')}
        onClick={() => void rebuild()}
        disabled={rebuilding}
        title="Rebuild server + web, then restart this process (needs BUILDER_DEV=1)"
      >
        <I.retry />
      </button>
      {msg && <div className={'sb-rebuild-msg' + (ok ? ' ok' : '')}>{msg}</div>}
    </>
  );
}
