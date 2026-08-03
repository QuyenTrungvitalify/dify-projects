/* ShelfOverlay.tsx — spec 080 S3: the dev-only shelf dashboard ("kệ tham khảo đang giàu đến đâu").
   A 📊 button in the sidebar header (next to RebuildButton, same devMode gate) opens a full-pane
   overlay that answers three questions in one glance: what's on the shelf per tier, where the
   diversity gaps are (thin features), and whether the 078 self-harvest flywheel is turning.

   Read-only glass: fetch-on-open of GET /api/dev/shelf (BUILDER_DEV=1 — a 404 shows the same
   disabled hint RebuildButton uses), a manual ↻, no store writes, no actions. All derivations are
   pure helpers in lib/shelf.ts (vitest'ed); this file is markup. Dev-surface strings stay literal
   English (the RebuildButton precedent) — no i18n/NOTE_JA. */
import { useEffect, useState } from 'preact/hooks';
import { I } from './Icon';
import { api, ApiError } from '../api';
import {
  daysBetween, featureRows, promotesWithin, s4Progress, tierBars,
  type ShelfResponse, type ShelfStats,
} from '../lib/shelf';

export function ShelfButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="icon-btn" title="shelf dashboard (dev)" aria-label="shelf dashboard (dev)"
        onClick={() => setOpen(true)}><I.chart /></button>
      {open && <ShelfOverlay onClose={() => setOpen(false)} />}
    </>
  );
}

function ShelfOverlay({ onClose }: { onClose: () => void }) {
  const [resp, setResp] = useState<ShelfResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load(): Promise<void> {
    setResp(null);
    setErr(null);
    try {
      setResp(await api.devShelf());
    } catch (e) {
      // Route absent shows up TWO ways, both meaning "this server has no dev routes": a plain 404,
      // or — because the SPA wildcard (index.ts `GET /*`) catches unmatched GETs including /api/*
      // — a 200 serving index.html, which JSON.parse rejects with a SyntaxError ("<!DOCTYPE …").
      const routeAbsent = (e instanceof ApiError && e.status === 404) || e instanceof SyntaxError;
      setErr(routeAbsent
        ? 'This server has no /api/dev/shelf — restart it with BUILDER_DEV=1 on code that includes spec 080 to enable the dashboard.'
        : String(e));
    }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal shelf-modal" role="dialog" aria-modal="true" aria-label="shelf dashboard (dev)">
        <div className="modal-head">
          <span className="dev-tag">dev</span>
          <span className="modal-title">Shelf — reference data</span>
          <button className="dev-copy" onClick={() => void load()} title="Refresh">↻</button>
          <button className="icon-btn modal-x" onClick={onClose} aria-label="Close"><I.close /></button>
        </div>

        {/* Only THIS wrapper scrolls (the modal is a fixed flex column) — scrolling the whole modal
            let content slide through the padding zone above the sticky head and bleed over it. */}
        <div className="shelf-scroll">
          {err && <div className="modal-error" role="alert"><span>{err}</span></div>}
          {!err && resp === null && <div className="shelf-loading">loading…</div>}
          {!err && resp !== null && (resp.ok
            ? <ShelfBody s={resp} />
            : (
              <div className="modal-error" role="alert">
                <span>{resp.reason}{resp.hint ? ` — ${resp.hint}` : ''}{resp.tail ? `\n${resp.tail}` : ''}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

/** Pure render off the stats payload — every number is derived in lib/shelf.ts or python. */
function ShelfBody({ s }: { s: ShelfStats }) {
  const today = s.generated_at;
  const doctorClean = s.doctor.curated_problems.length === 0;
  const lastPromote = s.promotes[0] ?? null;
  const sincePromote = lastPromote ? daysBetween(lastPromote.promoted, today) : null;
  const s4 = s4Progress(s);
  const feats = featureRows(s);
  const gaps = feats.filter((f) => f.thin);

  return (
    <div className="shelf-body">
      {/* 1 — tiles: the two-second read */}
      <div className="shelf-tiles">
        <Tile label="examples" value={String(s.total)} />
        <Tile label="unique shapes"
          value={s.diversity ? `${s.diversity.unique_fingerprints}/${s.diversity.files}` : '—'} />
        <Tile label="enrichment"
          value={s.enrichment ? `${s.enrichment.covered}/${s.enrichment.total}` : '—'}
          warn={!!s.enrichment && (s.enrichment.missing > 0 || s.enrichment.stale > 0)} />
        <Tile label="doctor" value={doctorClean ? '✓ curated clean' : `✗ ${s.doctor.curated_problems.length} problem(s)`}
          ok={doctorClean} warn={!doctorClean} />
      </div>
      {s.seed_coverage.stale && (
        <div className="shelf-warnchip">
          ⚠ collected.json is out of sync with the index ({s.seed_coverage.seeded}/{s.seed_coverage.indexed} seeded)
          — run <code>catalog.py seed</code>; shape numbers above are only as fresh as the seed.
        </div>
      )}

      {/* 2 — per-tier bars: corpus vs distilled, in one look */}
      <div className="shelf-sec">by tier</div>
      {tierBars(s).map((t) => (
        <div key={t.tier} className="shelf-bar-row">
          <span className="shelf-bar-label">{t.tier}</span>
          <span className="shelf-bar-track"><span className="shelf-bar-fill" style={{ width: `${t.pct}%` }} /></span>
          <span className="shelf-bar-count">{t.count}</span>
        </div>
      ))}

      <div className="shelf-cols">
        {/* 3 — diversity gaps: the action zone */}
        <div>
          <div className="shelf-sec">diversity gaps (fewest examples first)</div>
          <table className="shelf-table">
            {feats.slice(0, 8).map((f) => (
              <tr key={f.key} className={f.thin ? 'shelf-thin' : undefined}>
                <td>{f.key.replace(/^has_/, '')}</td>
                <td className="shelf-num">{f.count}</td>
              </tr>
            ))}
          </table>
          {gaps.length > 0 && (
            <div className="shelf-hint">{gaps.length} feature(s) ≤1 example — candidates for /scout or a build-to-promote.</div>
          )}
        </div>

        {/* 5 — flywheel (078): is self-harvest turning? */}
        <div>
          <div className="shelf-sec">flywheel (spec 078)</div>
          <div className="shelf-fly">
            <div>latest promote: {lastPromote
              ? <>
                  <b>{lastPromote.promoted}</b> · {lastPromote.file} ({lastPromote.tier})
                  {sincePromote !== null && sincePromote > 14 && (
                    <span className="shelf-warn"> — {sincePromote} days ago</span>
                  )}
                </>
              : '— (none stamped)'}
            </div>
            <div>promotes in 30 days: <b>{promotesWithin(s, 30, today)}</b> · total stamped: {s.promotes.length}</div>
            <div>hunts: <b>{s4.hunts}</b>{s.hunts.last ? ` · last ${s.hunts.last}` : ''} · S4 gate: {s4.hunts}/3
              {s4.medianNew !== null ? ` (median new ${s4.medianNew})` : ''}{s4.met ? ' — MET' : ''}</div>
            {s.diversity && <div>weak shapes (&lt;4 nodes): {s.diversity.weak_shapes}/{s.diversity.files}</div>}
            <div>tags: {s.tags.unique} unique</div>
          </div>

          <div className="shelf-sec">complexity</div>
          <div className="shelf-fly">
            {Object.entries(s.complexity).map(([k, v]) => <div key={k}>{k}: {v}</div>)}
          </div>
        </div>
      </div>

      {/* sources + doctor notes: the audit tail */}
      <div className="shelf-sec">sources</div>
      {s.sources.map((src) => (
        <div key={src.name} className="shelf-src">
          <code>{src.name}</code> · {src.license} · {src.indexed ? 'indexed' : 'intake-only'}
          {src.locked_sha ? ` · pinned ${src.locked_sha.slice(0, 7)}` : ' · unpinned'}
          {src.cloned ? '' : ' · NOT CLONED (run scripts/setup.sh)'}
        </div>
      ))}
      {s.doctor.house_notes.length > 0 && (
        <>
          <div className="shelf-sec">doctor notes (house — informational)</div>
          {s.doctor.house_notes.map((n, i) => <div key={i} className="shelf-note">! {n}</div>)}
        </>
      )}
      {s.doctor.curated_problems.map((p, i) => <div key={i} className="shelf-problem">✗ {p}</div>)}
      <div className="shelf-foot">generated {s.generated_at} · read-only — promote/seed/scout stay CLI/skill actions</div>
    </div>
  );
}

function Tile({ label, value, ok, warn }: { label: string; value: string; ok?: boolean; warn?: boolean }) {
  return (
    <div className={'shelf-tile' + (ok ? ' shelf-tile-ok' : '') + (warn ? ' shelf-tile-warn' : '')}>
      <div className="shelf-tile-label">{label}</div>
      <div className="shelf-tile-value">{value}</div>
    </div>
  );
}
