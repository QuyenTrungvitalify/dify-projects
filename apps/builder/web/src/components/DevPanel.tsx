/* DevPanel.tsx — spec 059. A thin strip under the header (only when `?dev=1`) that surfaces the
   otherwise-hidden taskId (copyable, to feed `e2e-run.sh time <id>`) and the per-phase cost table
   (tokens / turns / cache%) read straight from the wire — so "where does ③ spend the time" is
   answerable in-app without the CLI. Pure render off `task.cost`; no store writes, dev-only.
   Also hosts the dev-only `⟳ rebuild` button, a collapse toggle (the table is tall), and a
   survives-the-reload "✓ rebuilt" toast (the rebuild restarts the server → the page reloads). */
import { useEffect, useState } from 'preact/hooks';
import type { WireTask, WirePhaseCost } from '../types';
import { cachePct, fmt, diagnose, classify, shares } from '../lib/dev';
import { api, ApiError } from '../api';
import { Twist } from './Sidebar'; // the same chevron twisty the sidebar tree-rows use

const PHASES: Array<WirePhase> = ['analyze', 'spec', 'implement', 'test'];
type WirePhase = 'analyze' | 'spec' | 'implement' | 'test';

const REBUILT_KEY = 'builder:dev:rebuilt'; // timestamp stashed before the rebuild reload → toast after
const COLLAPSED_KEY = 'builder:dev:collapsed'; // remember show/hide across reloads

const LS = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* no-op */
    }
  },
  del(k: string): void {
    try {
      localStorage.removeItem(k);
    } catch {
      /* no-op */
    }
  },
};

/** Poll /health for the restart blip: wait until it goes DOWN (connection refused / not ok) then comes
 *  back UP, so we reload onto the fresh server — not the dying old one. Bounded (~2min) then gives up. */
async function waitForRestart(): Promise<boolean> {
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

export function DevPanel({ task }: { task: WireTask }) {
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState('');
  const [rebuiltOk, setRebuiltOk] = useState(false);
  const [collapsed, setCollapsed] = useState(() => LS.get(COLLAPSED_KEY) === '1');

  // Post-reload "done" toast: the rebuild reloads the page, so the success signal is stashed in
  // localStorage BEFORE the reload and surfaced here on the fresh mount (spec 040 D3 reopens the task).
  useEffect(() => {
    const ts = Number(LS.get(REBUILT_KEY));
    LS.del(REBUILT_KEY);
    if (!ts || Date.now() - ts > 30_000) return; // ignore stale / unrelated reloads
    setRebuiltOk(true);
    setRebuildMsg('✓ rebuilt & restarted');
    const t = setTimeout(() => {
      setRebuiltOk(false);
      setRebuildMsg('');
    }, 5000);
    return () => clearTimeout(t);
  }, []);

  const toggleCollapsed = (): void => {
    setCollapsed((c) => {
      const next = !c;
      LS.set(COLLAPSED_KEY, next ? '1' : '0');
      return next;
    });
  };

  const rebuild = async (): Promise<void> => {
    setRebuilding(true);
    setRebuiltOk(false);
    setRebuildMsg('building server + web…');
    try {
      const r = await api.devRebuild();
      if (!r.ok) {
        setRebuilding(false);
        const lastLine = (r.log ?? '').split('\n').filter(Boolean).slice(-1)[0] ?? '';
        setRebuildMsg(r.reason ?? `build failed — ${lastLine || 'see .runs/dev-restart.log'}`);
        return;
      }
      setRebuildMsg('restarting… (reloads when back up)');
      LS.set(REBUILT_KEY, String(Date.now())); // survives the reload → toast on the fresh mount
      await waitForRestart();
      location.reload();
    } catch (e) {
      setRebuilding(false);
      LS.del(REBUILT_KEY);
      if (e instanceof ApiError && e.status === 404) setRebuildMsg('disabled — start the server with BUILDER_DEV=1');
      else if (e instanceof ApiError && e.status === 409) setRebuildMsg('a build is running — cancel it first');
      else setRebuildMsg(e instanceof Error ? e.message : 'rebuild failed');
    }
  };

  const cost = task.cost ?? {};
  const rows = PHASES.filter((k) => cost[k]);
  const share = shares(task.cost); // per-phase % of total durationMs (the `share` column)
  const diag = diagnose(task.cost); // spec 059 S3 — the auto cause-analysis (heuristic hint)
  const copy = (): void => {
    try {
      void navigator.clipboard?.writeText(task.taskId);
    } catch {
      /* clipboard blocked (insecure ctx) — the id stays selectable via `user-select:all` */
    }
  };
  return (
    <div className={'dev-strip' + (collapsed ? ' dev-collapsed' : '')}>
      <div className="dev-strip-top">
        <Twist open={!collapsed} onClick={toggleCollapsed} />
        <span className="dev-tag">dev</span>
        <span className="dev-id" title="taskId — feed to e2e-run.sh time">{task.taskId}</span>
        <span className="dev-actions">
          <button className="dev-copy" onClick={copy} title="Copy taskId">copy</button>
          <button
            className="dev-copy dev-rebuild"
            onClick={rebuild}
            disabled={rebuilding}
            title="Rebuild server + web, then restart this process (needs BUILDER_DEV=1)"
          >
            {rebuilding ? '⟳ …' : '⟳ rebuild'}
          </button>
          {rebuildMsg && <span className={'dev-msg' + (rebuiltOk ? ' dev-msg--ok' : '')}>{rebuildMsg}</span>}
        </span>
      </div>
      {!collapsed &&
        (rows.length > 0 ? (
          <table className="dev-cost">
            <thead>
              <tr>
                <th>phase</th><th>share</th><th>turns</th><th>in</th><th>out</th><th>cache_rd</th><th>cache%</th><th>cause</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((k) => {
                const c = cost[k] as WirePhaseCost;
                const pct = cachePct(c);
                const cause = classify(c);
                const sh = share[k];
                return (
                  <tr key={k} class={k === diag?.phase ? 'dev-slow' : undefined}>
                    <td className="dev-ph">{k}</td>
                    <td>{sh == null ? '—' : `${sh}%`}</td>
                    <td>{fmt(c.numTurns)}</td>
                    <td>{fmt(c.inputTokens)}</td>
                    <td>{fmt(c.outputTokens)}</td>
                    <td>{fmt(c.cacheReadTokens)}</td>
                    <td>{pct === null ? '—' : `${pct}%`}</td>
                    <td className={`dev-cause dev-cause--${cause}`}>{cause}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="dev-empty">no per-phase cost yet (phase in progress, or pre-059 build)</div>
        ))}
      {!collapsed && diag && (
        <div className={`dev-diag dev-diag--${diag.balanced ? 'balanced' : diag.cause}`}>
          <span className="dev-diag-tag">hint</span>
          {diag.balanced ? (
            <span className="dev-diag-phase">
              balanced (top {diag.num} {diag.phase}
              {diag.sharePct !== null ? ` ${diag.sharePct}%` : ''})
            </span>
          ) : (
            <span className="dev-diag-phase">
              {diag.num} {diag.phase}
              {diag.sharePct !== null ? ` · ${diag.sharePct}%` : ''}
            </span>
          )}
          {diag.balanced && diag.allSameCause && (
            <span className="dev-diag-cause">all {diag.allSameCause}</span>
          )}
          <span className="dev-diag-arrow">→</span>
          <span className="dev-diag-lever">{diag.lever}</span>
        </div>
      )}
    </div>
  );
}
