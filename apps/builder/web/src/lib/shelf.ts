/**
 * shelf.ts — spec 080 S3: wire types + PURE derivations for the dev shelf dashboard.
 *
 * The wire shape is `catalog.py stats --json` verbatim (GET /api/dev/shelf is a passthrough —
 * python owns every number, spec 080 §1). Everything here is render-prep only: scaling bars,
 * flagging thin features, date math. Pure functions → vitest'able without a DOM (this web app
 * has no component-test harness; DevPanel set the render-off-props precedent).
 */

export interface ShelfTier { tier: string; count: number }
export interface ShelfFeature { key: string; count: number }
export interface ShelfPromote {
  file: string;
  tier: 'patterns' | 'library';
  promoted: string; // YYYY-MM-DD from the x-provenance stamp
  source?: string | null;
  license?: string | null;
}
export interface ShelfDiversity {
  files: number;
  unique_fingerprints: number;
  weak_shapes: number;
  per_tier: { tier: string; files: number; unique_shapes: number }[];
}
export interface ShelfStats {
  ok: true;
  generated_at: string;
  hints: string[];
  total: number;
  tiers: ShelfTier[];
  features: ShelfFeature[]; // ascending by count — the gaps lead (stats sorts)
  complexity: Record<string, number>;
  complexity_per_tier: Record<string, Record<string, number>>;
  tags: { unique: number; top: { tag: string; count: number }[] };
  diversity: ShelfDiversity | null;
  seed_coverage: { indexed: number; seeded: number; stale: boolean };
  enrichment: { covered: number; total: number; missing: number; stale: number; orphan: number } | null;
  doctor: { curated_problems: string[]; house_notes: string[] };
  promotes: ShelfPromote[];
  sources: { name: string; license: string; indexed: boolean; locked_sha: string | null; cloned: boolean }[];
  hunts: { count: number; last: string | null; median_new: number | null };
}
/** The CLI's own not-ok (missing index → `hint`) or the S2 seam's failure (`tail`). */
export interface ShelfFailure { ok: false; reason: string; hint?: string; tail?: string }
export type ShelfResponse = ShelfStats | ShelfFailure;

/** Tier bars scaled to the largest tier (CSS width %). Never 0-wide for a non-zero count. */
export function tierBars(s: ShelfStats): { tier: string; count: number; pct: number }[] {
  const max = Math.max(1, ...s.tiers.map((t) => t.count));
  return s.tiers.map((t) => ({ ...t, pct: Math.max(t.count > 0 ? 2 : 0, Math.round((t.count / max) * 100)) }));
}

/** A feature with ≤ this many examples is a diversity gap the dashboard highlights (spec 080 §4b). */
export const THIN_FEATURE_MAX = 1;

export function featureRows(s: ShelfStats): { key: string; count: number; thin: boolean }[] {
  return s.features.map((f) => ({ ...f, thin: f.count <= THIN_FEATURE_MAX }));
}

/** Whole days from `fromISO` to `todayISO` (UTC midnights); null when `from` is absent/invalid. */
export function daysBetween(fromISO: string | null | undefined, todayISO: string): number | null {
  if (!fromISO) return null;
  const from = Date.parse(`${fromISO}T00:00:00Z`);
  const today = Date.parse(`${todayISO}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(today)) return null;
  return Math.round((today - from) / 86_400_000);
}

/** Promotes whose stamp falls within the trailing `days` ending at `todayISO` (inclusive). */
export function promotesWithin(s: ShelfStats, days: number, todayISO: string): number {
  return s.promotes.filter((p) => {
    const d = daysBetween(p.promoted, todayISO);
    return d !== null && d >= 0 && d <= days;
  }).length;
}

/** Spec 078 §5-b gate progress: hunter-UI is on the table only after ≥3 hunts with median-new ≥3. */
export function s4Progress(s: ShelfStats): { hunts: number; medianNew: number | null; met: boolean } {
  const { count, median_new } = s.hunts;
  return { hunts: count, medianNew: median_new, met: count >= 3 && (median_new ?? 0) >= 3 };
}
