/**
 * sse-origin-check.ts — Origin allowlist (spec 009 §J, local-CSRF defense).
 *
 * ADAPTED from claude-nexus `src/server/plugins/sse-origin-check.ts`: same shape, but the default
 * allowlist points at the **builder's own origin** (127.0.0.1 / localhost on BUILDER_PORT) instead
 * of nexus's 3001/3002. The builder binds 127.0.0.1 only and is single-user localhost, so this is
 * defense-in-depth: a malicious page on another origin can't open the SSE stream or POST a mutation.
 *
 * `origin === undefined` is allowed BY {@link isOriginAllowed} (the SSE GET path — a same-origin
 * EventSource omits the Origin header in some browsers). Spec 015 D6 (S5, folds 011 R4) tightens the
 * MUTATING path: {@link isOriginAllowedForMutation} requires a PRESENT allowlisted Origin (absent →
 * reject), closing the absent-Origin CSRF loophole where a forged cross-origin POST that omits Origin
 * slipped through. A curl/script caller must now send `-H "Origin: http://127.0.0.1:<port>"` on a
 * mutation; a browser page cannot forge that header cross-origin, which is the whole point.
 */

/** Default origins = the builder's own bind (spec §F default port 4123). */
export function buildAllowedOrigins(port: number): Set<string> {
  const extra = (process.env.SSE_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    ...extra,
  ]);
}

export function isOriginAllowed(origin: string | undefined, port: number): boolean {
  if (!origin) return true; // curl / same-origin EventSource that omits Origin (SSE GET — lenient)
  return buildAllowedOrigins(port).has(origin);
}

/**
 * Spec 015 D6 — the STRICT variant for MUTATING requests (POST/PUT/PATCH/DELETE): an absent Origin is
 * REJECTED (no `if (!origin) return true` lenience). Only a present, allowlisted Origin passes. This
 * closes the CSRF hole where a forged mutation omitting Origin was treated as same-origin.
 */
export function isOriginAllowedForMutation(origin: string | undefined, port: number): boolean {
  if (!origin) return false; // mutation with no Origin → reject (the D6 tightening)
  return buildAllowedOrigins(port).has(origin);
}
