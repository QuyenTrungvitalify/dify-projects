/**
 * slug.ts — deterministic project-slug derivation + collision-free suffixing (spec 019 L2 3.2).
 *
 * Pure helpers moved VERBATIM out of orchestrator.ts (covered by test/slug.test.ts). No orchestrator
 * state — just the requirement string / the projects dir. Re-exported from orchestrator.ts so existing
 * importers (slug.test.ts) are unchanged.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Deterministic slug/name from the requirement: lowercase, [a-z0-9_], ≤4 content words. */
export function deriveSlugName(requirement: string): { slug: string; name: string } {
  const stop = new Set([
    'a', 'an', 'the', 'that', 'this', 'takes', 'take', 'and', 'returns', 'return', 'of', 'to',
    'with', 'for', 'in', 'on', 'is', 'are', 'it', 'its',
  ]);
  const words = requirement
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    // Drop single-character fragments: they're never a meaningful slug token and are what a non-ASCII
    // requirement decays into — e.g. Vietnamese "yêu cầu" strips its diacritics to "y u c u" (4 stray
    // letters). Keeping them produced the "y_u_c_u" / "Y U C U" garbage slug (spec 084 follow-up).
    .filter((w) => w.length > 1);
  const content = words.filter((w) => !stop.has(w));
  const picked = (content.length ? content : words).slice(0, 4);
  // A CJK requirement whose ONLY surviving Latin is a short stray fragment is not a usable name: e.g. a
  // long all-Japanese requirement that happens to contain "…記事URLから…" scavenges just "url". When the
  // requirement is a large non-ASCII blob (≥20 CJK chars) and the Latin we picked is tiny (<6 chars),
  // treat it as "no usable ASCII content" and fall back to GENERIC_SLUG — the DISPLAY name (requirementName)
  // carries the real meaning. Short JP names with a real acronym (e.g. "SEO対策") stay under the CJK gate.
  const cjk = (requirement.match(/[぀-ヿ㐀-鿿豈-﫿＀-￯]/g) ?? []).length;
  if (cjk >= 20 && picked.join('').length < 6) return { slug: GENERIC_SLUG, name: titleCaseSlug(GENERIC_SLUG) };
  const slug = (picked.join('_') || GENERIC_SLUG).slice(0, 40).replace(/_+$/, '') || GENERIC_SLUG;
  return { slug, name: titleCaseSlug(slug) };
}

/** The generic slug `deriveSlugName` falls back to when a requirement yields no usable ASCII content
 *  (e.g. a purely-Japanese requirement, which `[^a-z0-9]` strips to nothing → words is empty). Callers
 *  use this to detect "the derived name is meaningless" and substitute a better base (spec 029 naming:
 *  the target project) instead of a generic `workflow_N`. */
export const GENERIC_SLUG = 'workflow';

/** Human-readable Title Case from a snake_case slug ("workflow_11" → "Workflow 11"). */
export function titleCaseSlug(slug: string): string {
  return (
    slug
      .split('_')
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(' ') || 'Workflow'
  );
}

/**
 * F4 (spec 010) / spec 030 D3: the first workflow slug in `slug, slug_2, slug_3, …` whose
 * `projects/<project>/<slug>/` does NOT exist. Collisions are resolved PER-PROJECT (a `summarizer` may
 * coexist in two different projects), so the scan is scoped to the given project folder. Returns `slug`
 * unchanged when it is already free. Synchronous `existsSync` is fine here — this runs once per Spec-gate
 * confirm, single-writer under the turn lock.
 */
export function firstFreeSlug(projectsDir: string, project: string, slug: string): string {
  const exists = (s: string): boolean => existsSync(join(projectsDir, 'projects', project, s));
  if (!exists(slug)) return slug;
  for (let n = 2; n < 1000; n++) {
    const suffix = `_${n}`;
    // Reserve room for the suffix BEFORE the 40-char cap, else a near-40-char slug truncates the
    // suffix away and collapses back onto the colliding slug (never finding a free candidate).
    const cand = `${slug.slice(0, 40 - suffix.length).replace(/_+$/, '')}${suffix}`;
    if (!exists(cand)) return cand;
  }
  return `${slug.slice(0, 26)}_${Date.now()}`; // pathological fallback (≤40, never expected); non-colliding
}
