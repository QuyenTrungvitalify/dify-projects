/* DevPanel.tsx — spec 059. A small floating TIP at the top-right of the chat column (only when
   `?dev=1`) that surfaces the otherwise-hidden taskId (copyable, to feed `e2e-run.sh time <id>`) and
   the per-phase cost table (tokens / turns / cache%) read straight from the wire — so "where does ③
   spend the time" is answerable in-app without the CLI. Pure render off `task.cost`; no store writes,
   dev-only.

   It used to be a full-width strip in the flow between the header and the thread: it reserved a band
   of the reading column for a dev-only read-out and shoved every answer down by its height, collapsed
   or not. It now floats (absolute, out of flow) and is sized to its content — collapsed it is a pill
   the width of `dev …684286 copy`, dimmed until pointed at, so it costs the page nothing; expanded it
   is an opaque card that overlays (never displaces) the thread and scrolls inside its own max-height.
   Also hosts a collapse toggle (the table is tall). The `⟳ rebuild` action now lives in the sidebar
   header (RebuildButton) so it's reachable from any view, not just an open build. */
import { useEffect, useState } from 'preact/hooks';
import type { WireTask, WirePhaseCost } from '../types';
import { cachePct, fmt, diagnose, classify, shares, ls } from '../lib/dev';
import { api } from '../api';
import { Twist } from './Sidebar'; // the same chevron twisty the sidebar tree-rows use

const PHASES: Array<WirePhase> = ['analyze', 'spec', 'implement', 'test'];
type WirePhase = 'analyze' | 'spec' | 'implement' | 'test';

const COLLAPSED_KEY = 'builder:dev:collapsed'; // remember show/hide across reloads

export function DevPanel({ task }: { task: WireTask }) {
  const [collapsed, setCollapsed] = useState(() => ls.get(COLLAPSED_KEY) === '1');
  /**
   * Which branch is actually running. Fetched ONCE per mount — it can only change by restarting the
   * server, and this panel outlives no restart.
   *
   * Shown even when it says `main`, deliberately. The failure this exists for is believing you are on a
   * branch when you are not: the launcher used to switch to main silently, so a whole test session
   * could be spent on the wrong code with nothing to show for it. A chip that appears only off-main
   * cannot tell "I am on main" apart from "the chip is not implemented", which is the exact confusion
   * being fixed. Never blocks render; a failed fetch just leaves it blank.
   */
  const [branch, setBranch] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void api.devBuildInfo()
      .then((b) => { if (live) setBranch(b.gitBranch); })
      .catch(() => { /* not in dev mode, or git unavailable — the chip simply stays away */ });
    return () => { live = false; };
  }, []);

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
        {/* Collapsed, the id is a TAIL (`…684286`): the pill exists to be glanced at, and 13 digits of
            epoch is the half nobody reads — the whole id stays one hover (title) or one click (copy)
            away, and comes back in full, `user-select:all`, the moment the panel opens. */}
        <span className="dev-id" title={`taskId ${task.taskId} — feed to e2e-run.sh time`}>
          {collapsed ? `…${task.taskId.slice(-6)}` : task.taskId}
        </span>
        {branch && (
          /* Reuses `dev-tag` (the same pill as “dev”) on purpose — no new CSS, so this cannot collide
             with styling work in flight. Truncated while collapsed like the id above; the full name is
             always one hover away. */
          <span className="dev-tag" title={`git branch: ${branch}`}>
            {collapsed && branch.length > 14 ? `${branch.slice(0, 13)}…` : branch}
          </span>
        )}
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
              {/* One row per ATTEMPT when the run timeline has them (durable, survives any browser); the
                  per-phase `cost` map is the fallback for a build that predates the timeline record.
                  The distinction matters on a build with fix rounds: `cost[phase]` holds only the last. */}
              {(task.runCosts ?? []).map((r, i, all) => {
                const pct = cachePct(r.cost);
                // Share of WALL-CLOCK across the attempts shown. A column of em-dashes would have been
                // honest and useless; this answers the question the column exists for — which round ate
                // the time — which the per-phase table could never say, since it kept only the last.
                const total = all.reduce((s, x) => s + (x.cost.durationMs ?? 0), 0);
                const share = total > 0 && r.cost.durationMs != null
                  ? Math.round((100 * r.cost.durationMs) / total)
                  : null;
                return (
                  <tr key={`rc${i}`}>
                    <td className="dev-ph">{r.phase}</td>
                    <td>{share === null ? '—' : `${share}%`}</td>
                    <td>{fmt(r.cost.numTurns)}</td>
                    <td>{fmt(r.cost.inputTokens)}</td>
                    <td>{fmt(r.cost.outputTokens)}</td>
                    <td>{fmt(r.cost.cacheReadTokens)}</td>
                    <td>{pct === null ? '—' : `${pct}%`}</td>
                    <td className={`dev-cause dev-cause--${classify(r.cost)}`}>{classify(r.cost)}</td>
                  </tr>
                );
              })}
              {(task.runCosts ?? []).length === 0 && rows.map((k) => {
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
