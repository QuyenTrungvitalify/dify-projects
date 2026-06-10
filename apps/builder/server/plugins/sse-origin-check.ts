/**
 * sse-origin-check.ts — Origin allowlist (spec 009 §J, local-CSRF defense).
 *
 * ADAPTED from claude-nexus `src/server/plugins/sse-origin-check.ts`: same shape, but the default
 * allowlist points at the **builder's own origin** (127.0.0.1 / localhost on BUILDER_PORT) instead
 * of nexus's 3001/3002. The builder binds 127.0.0.1 only and is single-user localhost, so this is
 * defense-in-depth: a malicious page on another origin can't open the SSE stream or POST a mutation.
 *
 * `origin === undefined` is allowed (curl, and same-origin EventSource in browsers that omit the
 * Origin header on same-origin requests). Enforced on the SSE route AND the mutating POST/PUT
 * endpoints (index.ts onRequest hook).
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
  if (!origin) return true; // curl / same-origin EventSource that omits Origin
  return buildAllowedOrigins(port).has(origin);
}
