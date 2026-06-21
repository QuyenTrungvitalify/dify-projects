/**
 * dify-io.ts — BACKEND-OWNED Dify I/O for spec 009 Lát 5 (§F/§J).
 *
 * The ONLY place the repo talks to Dify. Every call shells `.venv/bin/python tools/dify_base/sync.py
 * <list|pull|push>` in a backend subprocess (cwd = DIFY_PROJECTS_DIR) with the Dify console creds
 * injected into THAT child's env — `DIFY_CONSOLE_URL` + `DIFY_CONSOLE_TOKEN`. The token:
 *   - NEVER enters a `claude` turn (claude-session.ts strips every `DIFY_*` from the turn env);
 *   - NEVER reaches the SSE stream or any `.runs/` JSON ({@link redactSecrets} scrubs all captured
 *     stdout/stderr before it is logged, returned, or surfaced);
 *   - is read fresh from `process.env` here (the operator exports it / a boot `.env` load sets it).
 *
 * `--project` is intentionally omitted on `list` (the env is injected directly, not via
 * `projects/<slug>/envs/dev.env`+dotenv — Cross-cutting). `--file` on `push` is relative to
 * `projects/<slug>/` (sync.py joins `BASE/projects/<project>/<file>`), so callers pass
 * `workflows/<file>`, never a `projects/<slug>/` prefix.
 */
import { execFile } from 'node:child_process';
import { join } from 'node:path';

export interface SyncResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** A seed-picker row parsed from `sync.py list` (the table the UI's `/api/seeds` returns). */
export interface SeedRow {
  app_id: string;
  mode: string;
  name: string;
}

export type SeedsReason = 'no-credentials' | 'dify-unreachable' | 'unknown';

/** Dify console creds, read fresh from the backend env. Absent → list/pull/push degrade gracefully. */
export function difyCreds(): { url?: string; token?: string } {
  return {
    url: process.env.DIFY_CONSOLE_URL?.trim() || undefined,
    token: process.env.DIFY_CONSOLE_TOKEN?.trim() || undefined,
  };
}

/**
 * Replace the live Dify token (and any obvious `Bearer <token>`) with `***` so it can never leak into a
 * log line, the SSE stream, or `.runs/` JSON. Defensive — `sync.py` should never echo it.
 *
 * Spec 015 D7 (S8) widens the scrub: (a) the token is redacted even when SHORT (≥4 chars, was ≥8) and
 * in its URL-encoded / base64 ENCODED forms (a trace may carry the token percent-encoded in a URL or
 * base64'd in a header); (b) `DIFY_CONSOLE_URL` is redacted too (the console host is sensitive and can
 * appear in sync.py error tails). This runs ONLY over captured sync.py stdout/stderr — the user-facing
 * `app_url` is built separately from the creds and is NOT redacted, so clickable links survive.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  const { url, token } = difyCreds();
  let out = text;
  if (token) {
    // Plain + encoded forms. Skip a form shorter than 4 chars (over-redaction risk on a tiny token).
    const forms = [token, encodeURIComponent(token), Buffer.from(token, 'utf8').toString('base64')];
    for (const form of forms) {
      if (form && form.length >= 4) out = out.split(form).join('***');
    }
  }
  if (url) {
    out = out.split(url).join('***');
    const trimmed = url.replace(/\/+$/, '');
    if (trimmed && trimmed !== url) out = out.split(trimmed).join('***');
  }
  // Belt-and-suspenders: scrub any Authorization: Bearer header value that might appear in a trace.
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._-]{4,}/g, '$1***');
  return out;
}

/**
 * Run `.venv/bin/python tools/dify_base/sync.py <args>` with the Dify creds on the CHILD env only.
 * Returns the captured streams with the token already redacted. Never throws — a spawn failure maps
 * to `{code:1, stderr}` so callers branch on the code, exactly like `sync.py`'s own exit codes.
 */
export function runSyncPy(projectsDir: string, args: string[]): Promise<SyncResult> {
  const { url, token } = difyCreds();
  // Inject the creds explicitly on top of the inherited env (the child IS sync.py, the intended
  // consumer). If they are absent, sync.py's `_client_from_env` exits 1 with "… not set" → degrade.
  const env = { ...process.env };
  if (url) env.DIFY_CONSOLE_URL = url;
  if (token) env.DIFY_CONSOLE_TOKEN = token;
  const file = join(projectsDir, '.venv/bin/python');
  const argv = ['tools/dify_base/sync.py', ...args];
  return new Promise((resolve) => {
    execFile(file, argv, { cwd: projectsDir, env, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const e = err as (Error & { code?: number | string }) | null;
      const code = e ? (typeof e.code === 'number' ? e.code : 1) : 0;
      resolve({
        code,
        stdout: redactSecrets(stdout?.toString() ?? ''),
        stderr: redactSecrets(stderr?.toString() ?? ''),
      });
    });
  });
}

/** Map `sync.py`'s exit-1 stderr (ambiguous for no-cred AND request failure, plan §0) to a reason. */
function reasonFromStderr(stderr: string): SeedsReason {
  if (/not set/i.test(stderr)) return 'no-credentials';
  if (/list_apps failed:/i.test(stderr)) return 'dify-unreachable';
  return 'unknown';
}

/**
 * Parse the human table `cmd_list` prints (`  {id:<38} {mode:<14} {name}` after a header + dashes
 * separator) into rows. Robust to the header / dashes / "→ N total" footer lines, which are dropped.
 */
export function parseListTable(stdout: string): SeedRow[] {
  const rows: SeedRow[] = [];
  for (const raw of stdout.split('\n')) {
    if (!raw.startsWith('  ')) continue; // data + header rows are 2-space-indented
    const m = raw.match(/^\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const [, id, mode, name] = m;
    // Drop the header (`app_id`), the dashes separator, and the `→ N total` footer.
    if (id === 'app_id' || id === '→' || /^-+$/.test(id) || !/^[\w-]{8,}$/.test(id)) continue;
    rows.push({ app_id: id, mode, name: name.trim() });
  }
  return rows;
}

/**
 * `/api/seeds` producer: `sync.py list` (env-injected, no `--project`). On exit 1 (ambiguous), parse
 * stderr → reason and return an EMPTY list (HTTP 200 at the route; the picker degrades, never errors).
 */
export async function listSeeds(
  projectsDir: string
): Promise<{ seeds: SeedRow[]; reason?: SeedsReason; stderrTail?: string }> {
  const r = await runSyncPy(projectsDir, ['list']);
  if (r.code !== 0) {
    const reason = reasonFromStderr(r.stderr);
    return {
      seeds: [],
      reason,
      // token already redacted; keep a short tail for the unknown case (plan "On blocker").
      stderrTail: reason === 'unknown' ? r.stderr.trim().split('\n').slice(-3).join(' ⏎ ') : undefined,
    };
  }
  return { seeds: parseListTable(r.stdout) };
}

/** Pull ONE app's DSL into `projects/<slug>/workflows/<app-name-slug>.yml` (the folder must pre-exist).
 *  Reports the EXACT file written (parsed from sync.py's `✓ …/workflows/<file> (<n> bytes)` line) so the
 *  caller seeds/diffs against the precise pulled YAML, not a max-mtime guess (spec 014 D7 / 011 R15). */
export async function pullApp(
  projectsDir: string,
  slug: string,
  appId: string
): Promise<{ ok: boolean; file: string | null; stderr: string }> {
  const r = await runSyncPy(projectsDir, ['pull', '--project', slug, '--app-id', appId, '--yes']);
  return { ok: r.code === 0, file: pulledFileFromStdout(r.stdout), stderr: r.stderr };
}

/**
 * The basename of the workflow file `sync.py pull` wrote, parsed from its per-app line
 * `  ✓ projects/<slug>/workflows/<file>.yml (<n> bytes)` (cmd_pull). Used so a Dify-seed build seeds +
 * diffs against the EXACT pulled file instead of scanning the workflows dir by mtime — a clock-skew tie
 * (or another app's stale yml left by a partial prior run) could otherwise pick the wrong YAML (014 D7 /
 * 011 R15). Returns the last match's basename (single-app `--app-id` pull writes exactly one), or null
 * when the line is absent/unparseable (the caller then falls back to the mtime scan).
 */
export function pulledFileFromStdout(stdout: string): string | null {
  let found: string | null = null;
  for (const line of stdout.split('\n')) {
    if (!line.includes('✓')) continue; // only the per-app "saved" lines
    const m = line.match(/\/workflows\/([^\s/]+\.ya?ml)\b/i);
    if (m) found = m[1];
  }
  return found;
}

/**
 * Push `projects/<slug>/workflows/<file>` to Dify as a NEW app (`--json-out`). The new app id lives
 * under `app_id` (verified Cloud response, spec 008:51); read it first, fall back to `id`, else null
 * (the caller reconciles via {@link reconcileAppIdByName}). `--file` stays relative to the project.
 */
export async function pushApp(
  projectsDir: string,
  slug: string,
  file: string,
  appName: string
): Promise<{ ok: boolean; appId: string | null; stdout: string; stderr: string }> {
  const r = await runSyncPy(projectsDir, [
    'push',
    '--project',
    slug,
    '--file',
    `workflows/${file}`,
    // Pin the created app name so the crash-recovery reconcile (reconcileAppIdByName, AC #25) matches
    // the SAME string Dify stores it under. Without --name, Dify names the app from the YAML's
    // app.name (agent-chosen) and the slug-match silently fails. Dify still creates a NEW app each push.
    '--name',
    appName,
    '--yes',
    '--json-out',
  ]);
  let appId: string | null = null;
  if (r.code === 0) appId = appIdFromJsonOut(r.stdout);
  return { ok: r.code === 0, appId, stdout: r.stdout, stderr: r.stderr };
}

/** Extract the new app id from a `push --json-out` last stdout line. PRIMARY field `app_id`, then
 *  `id`, then a nested `app.id` — TODO: confirm `app_id` against a real SELF-HOSTED import response
 *  (verified only on Cloud, spec 008:51); the `list`-reconcile path is the crash/absent fallback. */
export function appIdFromJsonOut(stdout: string): string | null {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.startsWith('{')) continue;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const nested = (obj.app as Record<string, unknown> | undefined)?.id;
      const id = obj.app_id ?? obj.id ?? nested;
      return typeof id === 'string' && id ? id : null;
    } catch {
      /* not the JSON line — keep scanning upward */
    }
  }
  return null;
}

/** Outcome of a name-reconcile. `ambiguous` is set when ≥2 same-named apps match: we CANNOT tell which
 *  is this build's, so we refuse to attach one (the caller surfaces "ambiguous — verify in Dify"). */
export interface ReconcileResult {
  appId: string | null;
  ambiguous: boolean;
}

/**
 * Pure name-match (spec 014 D6 / C6 — the unit-tested core). Push always creates a NEW app, so the
 * crash/absent fallback finds the id by slugified name. `sync.py list` exposes ONLY id/mode/name — no
 * created-at or other disambiguator (cmd_list) — so when MORE THAN ONE app shares the name (a prior
 * crashed-then-retried import, or two builds with the same derived name) we cannot safely pick "the
 * newest": doing so could attach the WRONG app_id. Degrade to `ambiguous` instead of guessing.
 *   - 0 matches → { appId: null, ambiguous: false }  (nothing to reconcile)
 *   - exactly 1 → { appId, ambiguous: false }        (unambiguous — attach it)
 *   - ≥2 matches → { appId: null, ambiguous: true }  ("verify in Dify"; never a silent newest-pick)
 */
export function pickReconciledApp(rows: SeedRow[], appName: string): ReconcileResult {
  const want = slugifyName(appName);
  const matches = rows.filter((row) => slugifyName(row.name) === want);
  if (matches.length === 1) return { appId: matches[0].app_id, ambiguous: false };
  if (matches.length > 1) return { appId: null, ambiguous: true };
  return { appId: null, ambiguous: false };
}

/**
 * Crash/absent fallback: find the app id by slugified name via `sync.py list`. Delegates the match to
 * {@link pickReconciledApp} — exactly one name match attaches; ≥2 returns `ambiguous` so the caller
 * warns instead of silently attaching the wrong app (spec 014 D6 / C6). List unavailable (code≠0) →
 * `{ appId: null, ambiguous: false }` (→ "push may have completed — check Dify").
 */
export async function reconcileAppIdByName(
  projectsDir: string,
  appName: string
): Promise<ReconcileResult> {
  const r = await runSyncPy(projectsDir, ['list']);
  if (r.code !== 0) return { appId: null, ambiguous: false };
  return pickReconciledApp(parseListTable(r.stdout), appName);
}

/** Mirror `sync.py`'s `_slugify` (name → lowercase, non-alnum → "_") so name-matching agrees with it. */
export function slugifyName(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'untitled';
}

/**
 * Build the clickable workflow URL from the console base: strip a trailing `/console/api`, append
 * `/app/<appId>/workflow`. e.g. `http://localhost/console/api` → `http://localhost/app/<id>/workflow`.
 */
export function appUrlFrom(consoleUrl: string, appId: string): string {
  const base = consoleUrl.replace(/\/+$/, '').replace(/\/console\/api$/, '');
  return `${base}/app/${appId}/workflow`;
}
