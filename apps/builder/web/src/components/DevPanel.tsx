/* DevPanel.tsx — spec 059. A thin strip under the header (only when `?dev=1`) that surfaces the
   otherwise-hidden taskId (copyable, to feed `e2e-run.sh time <id>`) and the per-phase cost table
   (tokens / turns / cache%) read straight from the wire — so "where does ③ spend the time" is
   answerable in-app without the CLI. Pure render off `task.cost`; no store writes, dev-only.
   Also hosts a collapse toggle (the table is tall). The `⟳ rebuild` action now lives in the sidebar
   header (RebuildButton) so it's reachable from any view, not just an open build. */
import { useState } from 'preact/hooks';
import type { WireTask, WirePhaseCost } from '../types';
import { cachePct, fmt, diagnose, classify, shares, ls } from '../lib/dev';
import { Twist } from './Sidebar'; // the same chevron twisty the sidebar tree-rows use

const PHASES: Array<WirePhase> = ['analyze', 'spec', 'implement', 'test'];
type WirePhase = 'analyze' | 'spec' | 'implement' | 'test';

const COLLAPSED_KEY = 'builder:dev:collapsed'; // remember show/hide across reloads

export function DevPanel({ task }: { task: WireTask }) {
  const [collapsed, setCollapsed] = useState(() => ls.get(COLLAPSED_KEY) === '1');

  const toggleCollapsed = (): void => {
    setCollapsed((c) => {
      const next = !c;
      ls.set(COLLAPSED_KEY, next ? '1' : '0');
      return next;
    });
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
      {/* spec 078 S2 — the self-harvest promote nudge. Dev-surface by construction: this panel only
          mounts under devMode (App.tsx), and the hint is a separate wire field, never a chat note. */}
      {!collapsed && task.promoteHint && (
        <div className="dev-diag dev-diag--balanced">
          <span className="dev-diag-tag">promote</span>
          <span className="dev-diag-lever">{task.promoteHint}</span>
        </div>
      )}
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
