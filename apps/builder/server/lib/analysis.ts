/**
 * analysis.ts — O2 (spec 019): persist the chosen pattern + needed feature-set from `analyze.json`
 * onto the task, and compute the pattern-coverage ADVISORY (never a hard-fail).
 *
 * The truth for "what features does template pattern X provide" is the committed `tools/dify_base/
 * index.json` (the same data `find.py` queries — each entry has `has_<feature>` boolean keys). We read
 * it directly rather than reimplementing node-type→feature detection, so the vocabulary can never drift
 * from `find.py`. A `custom` (from-scratch) pattern or an unindexed name yields no advisory.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Task } from '../state/task.js';

interface IndexEntry {
  source?: string;
  file?: string;
  node_count?: number; // gapReferences tie-breaks on it: the leanest example of a shape
  [k: string]: unknown; // `has_<feature>` booleans + node_types/plugins/etc.
}

/** Normalize a feature name ('http-request') to its index.json key ('has_http_request') — mirrors
 *  find.py `feature_key`. */
function featureKey(name: string): string {
  return 'has_' + name.replace(/-/g, '_');
}

/** Every indexed `patterns` entry, or [] when the index is missing/corrupt. Never throws. */
function patternEntries(projectsDir: string): IndexEntry[] {
  const indexPath = join(projectsDir, 'tools/dify_base/index.json');
  if (!existsSync(indexPath)) return [];
  try {
    const all = JSON.parse(readFileSync(indexPath, 'utf8')) as IndexEntry[];
    return Array.isArray(all) ? all.filter((e) => e?.source === 'patterns') : [];
  } catch {
    return [];
  }
}

/** `has_<feature>: true` keys → the feature vocabulary ('has_http_request' → 'http-request'). */
function featuresOf(entry: IndexEntry): Set<string> {
  const feats = new Set<string>();
  for (const k of Object.keys(entry)) {
    if (k.startsWith('has_') && entry[k] === true) feats.add(k.slice(4).replace(/_/g, '-'));
  }
  return feats;
}

/** The feature-set a template pattern PROVIDES, read from index.json (source of truth = what find.py
 *  queries). Returns null when the pattern is "custom"/absent or not indexed (→ no ⊇ advisory). */
export function patternFeatures(projectsDir: string, pattern: string): Set<string> | null {
  if (!pattern || pattern === 'custom') return null;
  const base = pattern.endsWith('.yml') ? pattern : pattern + '.yml';
  const entry = patternEntries(projectsDir).find((e) => e.file === base || e.file === pattern);
  return entry ? featuresOf(entry) : null;
}

/** The features the analysis says the build NEEDS that the chosen pattern does NOT provide. Empty when
 *  the pattern covers everything OR the check is N/A (custom/unindexed/no features). Never throws. */
export function patternFeatureGap(
  projectsDir: string,
  pattern: string,
  needed: string[] | undefined
): string[] {
  if (!needed || needed.length === 0) return [];
  const provided = patternFeatures(projectsDir, pattern);
  if (!provided) return []; // custom / unindexed → no advisory
  // Compare on the canonical `has_*` key so 'http-request' vs 'http_request' can't slip through.
  return needed.filter((f) => !provided.has(f) && !provided.has(featureKey(f).slice(4).replace(/_/g, '-')));
}

/** The advisory sentence for an ALREADY-COMPUTED gap, or null for an empty one. Split out so ④ can
 *  re-word the SAME line from a gap it re-checked against the delivered workflow (report.ts) without
 *  re-deriving the sentence — the web i18n keys off this exact wording (i18n.ts, JA translation). */
export function patternAdvisoryLine(gap: string[]): string | null {
  if (gap.length === 0) return null;
  // Spec 066 S5: plain. This was `advisory: pattern '<p>' is missing feature(s) the analysis needs —
  // <gap>. Verify the generated graph or pick a closer pattern (this does not block the build).` —
  // "advisory"/"pattern"/"feature(s)"/"graph" are all builder-internal vocabulary, and the review
  // caught that adding `advisory` to the jargon blocklist would have bricked every pattern-gap run
  // (permanent AUTO-FAIL) because no slice retired this line. Same meaning, said to the user.
  return `Heads up: the template this build started from doesn't cover everything you asked for (${gap.join(', ')}). The workflow was still built — worth checking it does what you need.`;
}

/** A human advisory line, or null when there is nothing to warn about (pattern covers all / N/A).
 *
 *  This is the ① voice: it runs BEFORE ③ writes any YAML, so the only thing it can compare is
 *  "what the analysis says it needs" vs "what the seed template ships" — a genuine heads-up at the
 *  Analyze gate. It is NOT the ④ voice: by then the workflow exists and ③ may have built the missing
 *  feature itself, so report.ts re-checks the gap against the delivered file (see deliveredFeature). */
export function patternAdvisory(
  projectsDir: string,
  pattern: string,
  needed: string[] | undefined
): string | null {
  return patternAdvisoryLine(patternFeatureGap(projectsDir, pattern, needed));
}

/**
 * Vetted pattern files that COVER what the chosen pattern lacks — the paths ③ must open instead of
 * hunting for an example. Empty when the pattern covers everything, or when nothing is known.
 *
 * WHY THIS EXISTS. ③ is told (implement.md) to build from the approved pattern and to NEVER search for
 * one — the pick was measured at ~40% of a phase's tool calls. But a real build composes SHAPES, and the
 * approved pattern is ONE file: a trigger→fetch→notify build that must send per row needs
 * `scheduled-fetch-notify` (trigger/http/llm) AND an `iteration` example, which that file has none of.
 * ③ then has a rule it cannot obey and no sanctioned way out, so it searches — and search is the one
 * thing the sandbox denies. Run 1784267358546 burned 25 denied greps and 53 turns there; run
 * 1784263317775, whose SPEC.md happened to name `per-row-notify`, spent 15.
 *
 * That SPEC.md was LUCKY: naming the file breaks SKILL.md's "never surface the machinery … don't cite
 * where it lives" rule, which is correct for the human reading SPEC.md at the ② gate. So the pointer
 * must not travel in human prose at all — it belongs in the machine channel, beside `{{PATTERN_PATH}}`.
 * The gap is already computed at ① ({@link patternFeatureGap}); index.json already knows which pattern
 * carries the missing feature. This just joins the two — deterministically, with no agent turn.
 *
 * Greedy by coverage, then by SMALLEST node_count: fewest files to read, and the leanest example of the
 * shape. On the run above that resolves gap {if-else, iteration} → `per-row-notify.yml` (9 nodes, has
 * both) over `per-row-notify-excel.yml` (12, has both) — i.e. exactly what the fast run used.
 */
export function gapReferences(
  projectsDir: string,
  pattern: string,
  needed: string[] | undefined,
  max = 2
): string[] {
  const gap = new Set(patternFeatureGap(projectsDir, pattern, needed));
  if (gap.size === 0) return [];
  const chosen = (pattern.endsWith('.yml') ? pattern : `${pattern}.yml`).trim();
  // index.json is generated from disk by build_index.py, but `file` still reaches a path the turn is
  // told to open WITHOUT checking — so hold it to patternPath's allowlist (bare filename, `.yml` only).
  const pool = patternEntries(projectsDir).filter(
    (e) => typeof e.file === 'string' && e.file !== chosen && /^[A-Za-z0-9_-]+\.yml$/.test(e.file)
  );
  const out: string[] = [];
  while (gap.size > 0 && out.length < max) {
    let best: { file: string; covers: string[]; nodes: number } | null = null;
    for (const e of pool) {
      const covers = [...gap].filter((f) => featuresOf(e).has(f));
      if (covers.length === 0) continue;
      const nodes = typeof e.node_count === 'number' ? e.node_count : Number.MAX_SAFE_INTEGER;
      // Deterministic: most gap covered → fewest nodes → filename. No Math.random, no fs order.
      const better =
        !best ||
        covers.length > best.covers.length ||
        (covers.length === best.covers.length &&
          (nodes < best.nodes || (nodes === best.nodes && (e.file as string) < best.file)));
      if (better) best = { file: e.file as string, covers, nodes };
    }
    if (!best) break; // nothing indexed covers the rest — ③ falls back to today's behavior
    out.push(`templates/patterns/${best.file}`);
    for (const f of best.covers) gap.delete(f);
    pool.splice(pool.findIndex((e) => e.file === best!.file), 1);
  }
  return out;
}

/** The subset of analyze.json O2 reads. Everything optional — an old/minimal analyze.json is fine. */
interface AnalysisJson {
  pattern?: unknown;
  features?: unknown;
  find_query?: unknown;
}

/**
 * Parse `analyze.json` and fold its pattern/features/find_query onto the task, then compute the
 * coverage advisory. Mutates `task` in place (the caller persists it via the orchestrator's `emit`).
 * THROWS on invalid JSON — the caller keeps its existing "analyze.json invalid JSON" error path. A
 * pattern-less / feature-less analyze.json simply leaves the optional fields unset (back-compat).
 */
export function applyAnalysisToTask(task: Task, analyzeJsonText: string, projectsDir: string): void {
  const parsed = JSON.parse(analyzeJsonText) as AnalysisJson; // throws on invalid JSON (intentional)
  if (typeof parsed.pattern === 'string' && parsed.pattern.trim()) {
    task.analysisPattern = parsed.pattern.trim();
  }
  if (Array.isArray(parsed.features)) {
    task.analysisFeatures = parsed.features.filter((f): f is string => typeof f === 'string' && !!f.trim());
  }
  // find_query is PROVENANCE, not an instruction: persisted for human-audit of the seed-present path
  // and as the anchor for the deferred pattern-delta diff (diff.ts Phase-3+). The advisory NEVER
  // executes it — so it reads as unused, but don't delete it as "dead data" (019 keeps it on purpose).
  // (spec 027 A3)
  if (typeof parsed.find_query === 'string' && parsed.find_query.trim()) {
    task.analysisFindQuery = parsed.find_query.trim();
  }
  task.patternAdvisory =
    patternAdvisory(projectsDir, task.analysisPattern ?? '', task.analysisFeatures) ?? undefined;
}
