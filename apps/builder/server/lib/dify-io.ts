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

/** Replace the live Dify token (and any obvious `Bearer <token>`) with `***` so it can never leak
 *  into a log line, the SSE stream, or `.runs/` JSON. Defensive — `sync.py` should never echo it. */
export function redactSecrets(text: string): string {
  if (!text) return text;
  const { token } = difyCreds();
  let out = text;
  if (token && token.length >= 8) out = out.split(token).join('***');
  // Belt-and-suspenders: scrub any Authorization: Bearer header value that might appear in a trace.
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/g, '$1***');
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

/** Pull ONE app's DSL into `projects/<slug>/workflows/<app-name-slug>.yml` (the folder must pre-exist). */
export async function pullApp(
  projectsDir: string,
  slug: string,
  appId: string
): Promise<{ ok: boolean; stderr: string }> {
  const r = await runSyncPy(projectsDir, ['pull', '--project', slug, '--app-id', appId, '--yes']);
  return { ok: r.code === 0, stderr: r.stderr };
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

/**
 * Crash/absent fallback: find the app id by slugified name via `sync.py list`. Push always creates a
 * NEW app, so repeated pushes of the same name slugify identically → pick the MOST-RECENTLY-CREATED
 * match (Dify returns newest first; we also tie-break by list order). Returns null if no match / list
 * unavailable (→ "push may have completed — check Dify").
 */
export async function reconcileAppIdByName(
  projectsDir: string,
  appName: string
): Promise<string | null> {
  const r = await runSyncPy(projectsDir, ['list']);
  if (r.code !== 0) return null;
  const want = slugifyName(appName);
  const matches = parseListTable(r.stdout).filter((row) => slugifyName(row.name) === want);
  // `sync.py list` page 1 returns newest-first; the first match is the most-recently-created.
  return matches.length ? matches[0].app_id : null;
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
