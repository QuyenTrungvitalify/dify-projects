/**
 * canonical-host.ts — spec 099 S4 / 101 §2.3: the app must live on exactly ONE origin.
 *
 * THE FAILURE THIS EXISTS FOR. The launcher opens `http://127.0.0.1:<port>`, but the server also answers
 * to `http://localhost:<port>` (same socket — `localhost` resolves to 127.0.0.1). A browser treats those
 * as two DIFFERENT origins, so each gets its OWN localStorage. The Builder keeps a build's chat thread
 * there, which means the same build shows a different conversation depending on which URL you arrived
 * by — with nothing on screen to say so. Measured on the real machine: `localhost:4123` was used on
 * 05/08, 12/08 and 17/08, so this is a trap that has already been walked into, not a hypothetical.
 * A user reports "my history comes and goes"; the maintainer chases a ghost.
 *
 * THREE DELIBERATE NARROWINGS, each closing a way this could do harm:
 *
 *  1. **308, never 301/302.** Browsers are permitted to turn a redirected POST into a GET on 301/302.
 *     A mutation aimed at `localhost` (`/ask`, `/confirm`, `/cancel`) would then arrive as a bodyless
 *     GET, 404, and fail SILENTLY. 308 preserves method and body. (Belt: rule 2 keeps mutations out of
 *     here entirely — the two guards are independent on purpose.)
 *  2. **Document navigations only.** Redirecting mid-session API calls would swap the origin underneath
 *     a running page for no benefit — the point is where the DOCUMENT is loaded from, and everything
 *     else follows from that. So: GET/HEAD, not under `/api/`, and the request must look like a browser
 *     navigation.
 *  3. **The target is built from CONSTANTS.** Only the path+query travels, and only after it is checked
 *     to start with a single `/`. A `Location` built from an attacker-shaped `req.url` beginning `//` is
 *     protocol-relative — `//evil.example` — which is an open redirect. The Host header is likewise
 *     attacker-supplied, so it is only ever COMPARED, never interpolated.
 *
 * Direction is not arbitrary: the launcher already uses `127.0.0.1` and every existing thread lives
 * there, so canonicalising the other way would strand the data this is meant to protect.
 */

/**
 * The status code, single-sourced HERE rather than written inline at the call site — so the one number
 * that must never drift to 301/302 lives beside the paragraph explaining why, and a test can pin it.
 * (`index.ts` boots a server on import, so a test cannot reach the hook itself; without this constant a
 * test could only re-declare the number, and would then keep passing while the real wiring changed.)
 */
export const CANONICAL_REDIRECT_STATUS = 308;

/** The minimum of a request this decision reads. Shaped for the test, satisfied by Fastify's request. */
export interface HostRedirectInput {
  method: string;
  /** path + query, as Node/Fastify give it (`req.url`) — never an absolute URL. */
  url: string;
  headers: {
    host?: string;
    accept?: string;
    'sec-fetch-mode'?: string;
  };
}

/**
 * The absolute URL to 308 a document navigation to, or `null` to leave the request alone.
 *
 * `null` is the answer for every case that is not unambiguously "a browser is loading the app's page
 * from the wrong hostname" — an unknown shape is left alone rather than guessed at.
 */
export function canonicalHostRedirect(req: HostRedirectInput, port: number): string | null {
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return null; // narrowing 2

  // Lower-cased because a hostname is case-insensitive (RFC 3986 §3.2.2) — `Host: LOCALHOST:4123` is the
  // same origin to a browser. Without this the comparison below silently declines to canonicalise it:
  // fails safe, but leaves the split-history trap open for the one caller that happens to shout.
  const host = req.headers.host?.toLowerCase();
  if (!host) return null;
  // Compare only. A Host of `localhost` with no port appears when the app is served on :80.
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  const hostPort = host.startsWith('[') ? host.slice(host.indexOf(']') + 1).replace(/^:/, '') : host.split(':')[1];
  if (hostname !== 'localhost') return null;
  // Only OUR port. A Host naming some other port did not come from this server's own page.
  if (hostPort && hostPort !== String(port)) return null;

  const url = req.url;
  if (!url.startsWith('/') || url.startsWith('//')) return null; // narrowing 3 — no protocol-relative target
  if (url === '/api' || url.startsWith('/api/')) return null; // narrowing 2 — the API is never redirected

  // A browser navigation announces itself one of two ways; older engines send only Accept.
  const navigate = req.headers['sec-fetch-mode'] === 'navigate';
  const wantsHtml = (req.headers.accept ?? '').includes('text/html');
  if (!navigate && !wantsHtml) return null;

  return `http://127.0.0.1:${port}${url}`;
}
