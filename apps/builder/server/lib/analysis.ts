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
  [k: string]: unknown; // `has_<feature>` booleans + node_types/plugins/etc.
}

/** Normalize a feature name ('http-request') to its index.json key ('has_http_request') — mirrors
 *  find.py `feature_key`. */
function featureKey(name: string): string {
  return 'has_' + name.replace(/-/g, '_');
}

/** The feature-set a template pattern PROVIDES, read from index.json (source of truth = what find.py
 *  queries). Returns null when the pattern is "custom"/absent or not indexed (→ no ⊇ advisory). */
export function patternFeatures(projectsDir: string, pattern: string): Set<string> | null {
  if (!pattern || pattern === 'custom') return null;
  const indexPath = join(projectsDir, 'tools/dify_base/index.json');
  if (!existsSync(indexPath)) return null;
  let entries: IndexEntry[];
  try {
    entries = JSON.parse(readFileSync(indexPath, 'utf8')) as IndexEntry[];
  } catch {
    return null;
  }
  const base = pattern.endsWith('.yml') ? pattern : pattern + '.yml';
  const entry = entries.find(
    (e) => e?.source === 'patterns' && (e.file === base || e.file === pattern)
  );
  if (!entry) return null;
  const feats = new Set<string>();
  for (const k of Object.keys(entry)) {
    if (k.startsWith('has_') && entry[k] === true) feats.add(k.slice(4).replace(/_/g, '-'));
  }
  return feats;
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

/** A human advisory line, or null when there is nothing to warn about (pattern covers all / N/A). */
export function patternAdvisory(
  projectsDir: string,
  pattern: string,
  needed: string[] | undefined
): string | null {
  const gap = patternFeatureGap(projectsDir, pattern, needed);
  if (gap.length === 0) return null;
  return `advisory: pattern '${pattern}' is missing feature(s) the analysis needs — ${gap.join(', ')}. Verify the generated graph or pick a closer pattern (this does not block the build).`;
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
  if (typeof parsed.find_query === 'string' && parsed.find_query.trim()) {
    task.analysisFindQuery = parsed.find_query.trim();
  }
  task.patternAdvisory =
    patternAdvisory(projectsDir, task.analysisPattern ?? '', task.analysisFeatures) ?? undefined;
}
