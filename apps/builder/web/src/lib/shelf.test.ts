/**
 * Spec 080 S3 — pure derivations behind the shelf dashboard (lib/shelf.ts).
 * The component is markup-only (DevPanel precedent — no component-test harness in this app);
 * every number the overlay shows funnels through these helpers or arrives verbatim from python.
 */
import { describe, expect, test } from 'vitest';
import {
  daysBetween, featureRows, promotesWithin, s4Progress, tierBars,
  THIN_FEATURE_MAX, type ShelfStats,
} from './shelf';

function stats(over: Partial<ShelfStats> = {}): ShelfStats {
  return {
    ok: true,
    generated_at: '2026-07-28',
    hints: [],
    total: 44,
    tiers: [
      { tier: 'corpus:awesome-dify-workflow-en', count: 26 },
      { tier: 'patterns', count: 11 },
      { tier: 'library', count: 1 },
    ],
    features: [
      { key: 'has_loop', count: 0 },
      { key: 'has_agent', count: 1 },
      { key: 'has_llm', count: 36 },
    ],
    complexity: { Simple: 15, Medium: 10, Complex: 19 },
    complexity_per_tier: {},
    tags: { unique: 30, top: [] },
    diversity: { files: 44, unique_fingerprints: 39, weak_shapes: 10, per_tier: [] },
    seed_coverage: { indexed: 44, seeded: 44, stale: false },
    enrichment: { covered: 44, total: 44, missing: 0, stale: 0, orphan: 0 },
    doctor: { curated_problems: [], house_notes: [] },
    promotes: [
      { file: 'a.yml', tier: 'patterns', promoted: '2026-07-15' },
      { file: 'b.yml', tier: 'library', promoted: '2026-06-22' },
    ],
    sources: [],
    hunts: { count: 1, last: '2026-07-28', median_new: 2 },
    ...over,
  };
}

describe('tierBars', () => {
  test('scales to the largest tier; tiny-but-nonzero never rounds to 0 width', () => {
    const bars = tierBars(stats());
    expect(bars[0]).toEqual({ tier: 'corpus:awesome-dify-workflow-en', count: 26, pct: 100 });
    const library = bars.find((b) => b.tier === 'library')!;
    expect(library.pct).toBeGreaterThanOrEqual(2); // 1/26 rounds to 4% — floor keeps it visible
  });

  test('empty tier list does not divide by zero', () => {
    expect(tierBars(stats({ tiers: [] }))).toEqual([]);
  });
});

describe('featureRows — the diversity-gap flag', () => {
  test('flags counts ≤ THIN_FEATURE_MAX including the 0-example hole', () => {
    const rows = featureRows(stats());
    expect(rows.find((r) => r.key === 'has_loop')!.thin).toBe(true);
    expect(rows.find((r) => r.key === 'has_agent')!.thin).toBe(true);
    expect(rows.find((r) => r.key === 'has_llm')!.thin).toBe(false);
    expect(THIN_FEATURE_MAX).toBe(1); // the spec 080 §4b threshold — change deliberately
  });
});

describe('daysBetween / promotesWithin', () => {
  test('day math is UTC-midnight based and null-safe', () => {
    expect(daysBetween('2026-07-15', '2026-07-28')).toBe(13);
    expect(daysBetween(null, '2026-07-28')).toBeNull();
    expect(daysBetween('not-a-date', '2026-07-28')).toBeNull();
  });

  test('counts only stamps inside the trailing window', () => {
    const s = stats(); // stamps at 13 days (07-15) and 36 days (06-22) before today
    expect(promotesWithin(s, 30, '2026-07-28')).toBe(1);
    expect(promotesWithin(s, 40, '2026-07-28')).toBe(2);
    expect(promotesWithin(s, 5, '2026-07-28')).toBe(0);
  });
});

describe('s4Progress — the spec 078 §5-b gate', () => {
  test('below 3 hunts is never met, whatever the median', () => {
    expect(s4Progress(stats())).toEqual({ hunts: 1, medianNew: 2, met: false });
  });
  test('met needs BOTH ≥3 hunts and median ≥3', () => {
    expect(s4Progress(stats({ hunts: { count: 3, last: 'x', median_new: 3 } })).met).toBe(true);
    expect(s4Progress(stats({ hunts: { count: 3, last: 'x', median_new: 2 } })).met).toBe(false);
    expect(s4Progress(stats({ hunts: { count: 4, last: 'x', median_new: null } })).met).toBe(false);
  });
});
