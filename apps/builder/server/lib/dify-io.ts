/**
 * dify-io.ts — BACKEND-OWNED Dify I/O for spec 009 Lát 5 (§F/§J).
 *
 * The ONLY place the repo talks to Dify. Every call shells `.venv/bin/python tools/dify_base/sync.py
 * <list|pull|push>` in a backend subprocess (cwd = DIFY_PROJECTS_DIR) with the Dify console creds
 * injected into THAT child's env — `DIFY_CONSOLE_URL` + `DIFY_CONSOLE_TOKEN` (+ `DIFY_WORKSPACE_ID`
 * when the token is an ADMIN_API_KEY rather than a browser JWT). The token:
 *   - NEVER enters a `claude` turn (claude-session.ts strips every `DIFY_*` from the turn env);
 *   - NEVER reaches the SSE stream or any `.runs/` JSON ({@link redactSecrets} scrubs all captured
 *     stdout/stderr before it is logged, returned, or surfaced);
 *   - is read fresh from `process.env` here (the operator exports it / a boot `.env` load sets it).
 *
 * `--project` is intentionally omitted on `list` (the env is injected directly, not via
 * `projects/<project>/envs/dev.env`+dotenv — Cross-cutting). Spec 030: `pull`/`push` pass BOTH
 * `--project <project>` + `--workflow <workflowSlug>`; `--file` on `push` is relative to the workflow
 * folder `projects/<project>/<workflowSlug>/` (sync.py joins it), so callers pass `workflows/<file>`.
 * Envs stay PER-PROJECT (`projects/<project>/envs/dev.env`, D2).
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

/** Dify console creds, read fresh from the backend env. Absent → list/pull/push degrade gracefully.
 *  `workspaceId` (DIFY_WORKSPACE_ID) is set only when the token is an ADMIN_API_KEY — sync.py then sends
 *  it as X-WORKSPACE-ID (a session JWT ignores it). */
export function difyCreds(): { url?: string; token?: string; workspaceId?: string } {
  return {
    url: process.env.DIFY_CONSOLE_URL?.trim() || undefined,
    token: process.env.DIFY_CONSOLE_TOKEN?.trim() || undefined,
    workspaceId: process.env.DIFY_WORKSPACE_ID?.trim() || undefined,
  };
}

/** Spec 036 D1 — a fully-populated live target (both url AND token present; workspaceId when the token
 *  is an ADMIN_API_KEY). Unlike {@link difyCreds}'s all-optional shape, `url`/`token` are guaranteed. */
export interface TargetCreds {
  url: string;
  token: string;
  workspaceId?: string;
}

/**
 * Spec 036 D1 — the set of live Dify targets reachable RIGHT NOW, derived from separated creds. Replaces
 * the old start-bound `deploy==='selfhost' && creds` declaration with a capability probe: the gate offers
 * a live action for each populated slot. This spec ships ONLY `selfhost` (from the existing
 * `DIFY_CONSOLE_*` env, D2); `cloud` is a reserved seam (§8) — the field stays in the interface but is
 * never populated here. When cloud lands it reads its own `DIFY_CLOUD_*` and fills that slot additively,
 * touching only {@link difyTargets} and the cloud gate action — never the gate/orchestrator wiring.
 */
export interface DifyTargets {
  selfhost?: TargetCreds;
  cloud?: TargetCreds;
}

/**
 * Spec 036 D1/D2 — detect which live targets are configured. `selfhost` reads the EXISTING
 * `DIFY_CONSOLE_URL`/`DIFY_CONSOLE_TOKEN` (+ optional `DIFY_WORKSPACE_ID`) via {@link difyCreds} — zero
 * migration for existing operators (AC #6). Both url AND token must be present, else the slot is absent
 * (undefined). No new env vars, no `redactSecrets` change (N5). Pure — reads `process.env` fresh each call.
 */
export function difyTargets(): DifyTargets {
  const { url, token, workspaceId } = difyCreds();
  return {
    selfhost: url && token ? { url, token, ...(workspaceId ? { workspaceId } : {}) } : undefined,
    // cloud: reserved for §8 — always absent in this spec (no DIFY_CLOUD_* read here).
  };
}

/**
 * Spec 032 B3 — a per-run registry of secrets that are NOT in the env, so {@link difyCreds} can't see
 * them. The app-level API key (`app-…`) is MINTED at runtime by `mintAppKey`; without registering it,
 * the env-based scrub below would miss it and it could leak into a log / SSE / `.runs` JSON. Register it
 * the moment it's minted; unregister when the test app is torn down (bounded lifetime, no unbounded growth).
 */
const runtimeSecrets = new Set<string>();
export function registerSecret(secret: string | null | undefined): void {
  if (secret && secret.length >= 4) runtimeSecrets.add(secret);
}
export function unregisterSecret(secret: string | null | undefined): void {
  if (secret) runtimeSecrets.delete(secret);
}

/** Scrub one secret in its plain + URL-encoded + base64 forms (≥4 chars each, to avoid over-redaction). */
function scrubForms(text: string, secret: string): string {
  let out = text;
  const forms = [secret, encodeURIComponent(secret), Buffer.from(secret, 'utf8').toString('base64')];
  for (const form of forms) {
    if (form && form.length >= 4) out = out.split(form).join('***');
  }
  return out;
}

/**
 * Replace the live Dify token (and any obvious `Bearer <token>`) with `***` so it can never leak into a
 * log line, the SSE stream, or `.runs/` JSON. Defensive — `sync.py` should never echo it.
 *
 * Spec 015 D7 (S8) widens the scrub: (a) the token is redacted even when SHORT (≥4 chars, was ≥8) and
 * in its URL-encoded / base64 ENCODED forms (a trace may carry the token percent-encoded in a URL or
 * base64'd in a header); (b) `DIFY_CONSOLE_URL` is redacted too (the console host is sensitive and can
 * appear in sync.py error tails). Spec 032 B3: ALSO scrub every registered runtime secret (minted
 * app-key). This runs ONLY over captured sync.py stdout/stderr — the user-facing `app_url` is built
 * separately from the creds and is NOT redacted, so clickable links survive.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  const { url, token } = difyCreds();
  let out = text;
  if (token) out = scrubForms(out, token); // plain + encoded forms
  for (const secret of runtimeSecrets) out = scrubForms(out, secret); // B3: minted app-keys
  if (url) {
    out = out.split(url).join('***');
    const trimmed = url.replace(/\/+$/, '');
    if (trimmed && trimmed !== url) out = out.split(trimmed).join('***');
    // F4: scrub the bare origin (scheme://host) too, so the derived Service-API base (…/v1/…) HOST is
    // redacted in a rare catch-all sync.py error tail, not only the exact /console/api URL.
    const origin = trimmed.match(/^[a-z]+:\/\/[^/]+/i)?.[0];
    if (origin && origin !== trimmed) out = out.split(origin).join('***');
  }
  // Belt-and-suspenders: scrub any Authorization: Bearer header value that might appear in a trace.
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._-]{4,}/g, '$1***');
  return out;
}

/** Optional per-call knobs (spec 032). `env` adds child-only vars ON TOP of the injected creds (e.g. the
 *  minted `DIFY_APP_KEY` for `run`, kept off argv per B3); `timeoutMs` kills a hung child (B2) — on
 *  timeout execFile sends SIGTERM and `err.killed` → a non-zero code, so the caller degrades to infra_fail. */
export interface RunSyncPyOpts {
  env?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Run `.venv/bin/python tools/dify_base/sync.py <args>` with the Dify creds on the CHILD env only.
 * Returns the captured streams with the token already redacted. Never throws — a spawn failure (or a
 * B2 timeout) maps to `{code:1, stderr}` so callers branch on the code, exactly like `sync.py`'s own
 * exit codes.
 */
export function runSyncPy(projectsDir: string, args: string[], opts?: RunSyncPyOpts): Promise<SyncResult> {
  const { url, token, workspaceId } = difyCreds();
  // Inject the creds explicitly on top of the inherited env (the child IS sync.py, the intended
  // consumer). If they are absent, sync.py's `_client_from_env` exits 1 with "… not set" → degrade.
  const env = { ...process.env };
  if (url) env.DIFY_CONSOLE_URL = url;
  if (token) env.DIFY_CONSOLE_TOKEN = token;
  if (workspaceId) env.DIFY_WORKSPACE_ID = workspaceId; // admin-key path → sync.py sends X-WORKSPACE-ID
  if (opts?.env) Object.assign(env, opts.env); // B3: e.g. DIFY_APP_KEY on the child env, never argv
  const file = join(projectsDir, '.venv/bin/python');
  const argv = ['tools/dify_base/sync.py', ...args];
  return new Promise((resolve) => {
    execFile(
      file,
      argv,
      { cwd: projectsDir, env, maxBuffer: 32 * 1024 * 1024, timeout: opts?.timeoutMs ?? 0 },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: number | string }) | null;
        const code = e ? (typeof e.code === 'number' ? e.code : 1) : 0;
        resolve({
          code,
          stdout: redactSecrets(stdout?.toString() ?? ''),
          stderr: redactSecrets(stderr?.toString() ?? ''),
        });
      }
    );
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

/** Pull ONE app's DSL into `projects/<project>/<workflowSlug>/workflows/<app-name-slug>.yml` (the folder
 *  must pre-exist). Reports the EXACT file written (parsed from sync.py's `✓ …/workflows/<file> (<n>
 *  bytes)` line) so the caller seeds/diffs against the precise pulled YAML (spec 014 D7 / 011 R15). */
export async function pullApp(
  projectsDir: string,
  project: string,
  workflowSlug: string,
  appId: string
): Promise<{ ok: boolean; file: string | null; stderr: string }> {
  const r = await runSyncPy(projectsDir, ['pull', '--project', project, '--workflow', workflowSlug, '--app-id', appId, '--yes']);
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
 * Push `projects/<project>/<workflowSlug>/workflows/<file>` to Dify as a NEW app (`--json-out`). The new
 * app id lives under `app_id` (verified Cloud response, spec 008:51); read it first, fall back to `id`,
 * else null (the caller reconciles via {@link reconcileAppIdByName}). `--file` is relative to the
 * workflow folder `projects/<project>/<workflowSlug>/`.
 */
export async function pushApp(
  projectsDir: string,
  project: string,
  workflowSlug: string,
  file: string,
  appName: string
): Promise<{ ok: boolean; appId: string | null; stdout: string; stderr: string }> {
  const r = await runSyncPy(projectsDir, [
    'push',
    '--project',
    project,
    '--workflow',
    workflowSlug,
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

// ─────────────────────────── spec 032 live-test helpers (S1) ───────────────────────────
// Pure parse/pick helpers (unit-tested with injected data) + thin subprocess wrappers (the chokepoint
// invariant holds — every one shells `sync.py` via runSyncPy). No existing helper is modified.

/** The last `{…}`-looking stdout line, JSON-parsed (the `--json-out` convention). null if none parses. */
export function lastJsonLine(stdout: string): Record<string, unknown> | null {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith('{')) continue;
    try {
      return JSON.parse(lines[i]) as Record<string, unknown>;
    } catch {
      /* not the JSON line — keep scanning upward */
    }
  }
  return null;
}

/** A provider-qualified LLM model (what a Dify llm node's `model.{provider,name}` needs). */
export interface LlmModel {
  provider: string;
  name: string;
}

/** Parse `sync.py models` JSON: `{enabled: [{provider, models:[{model|name}]}], default: {model|name, provider}|null}`.
 *  Defensive about field names/shapes; the exact live shape is pinned by the S1 integration test (creds-gated). */
export function parseModels(stdout: string): { enabled: LlmModel[]; systemDefault: LlmModel | null } {
  const obj = lastJsonLine(stdout);
  if (!obj) return { enabled: [], systemDefault: null };
  const enabled: LlmModel[] = [];
  for (const prov of (Array.isArray(obj.enabled) ? obj.enabled : []) as Array<Record<string, unknown>>) {
    const provider = typeof prov.provider === 'string' ? prov.provider : '';
    for (const m of (Array.isArray(prov.models) ? prov.models : []) as Array<Record<string, unknown>>) {
      const name = typeof m.model === 'string' ? m.model : typeof m.name === 'string' ? m.name : '';
      // Verified real shape (self-host 2026-07-03): each model carries `status` ('active') + `deprecated`.
      // Only surface usable models so the resolve can't pick a listed-but-dead one → runtime "Model not
      // exist". Tolerate the field being absent (synthetic/other builds) → treated as usable.
      const usable = (m.status === undefined || m.status === 'active') && m.deprecated !== true;
      if (name && usable) enabled.push({ provider, name });
    }
  }
  const d = obj.default as Record<string, unknown> | null | undefined;
  const dName = d ? (typeof d.model === 'string' ? d.model : typeof d.name === 'string' ? d.name : '') : '';
  // `provider` is a string in some Dify builds, a nested `{provider}` object in others — accept both,
  // else '' (name-only match). F3.
  const dProvider =
    typeof d?.provider === 'string'
      ? d.provider
      : typeof (d?.provider as Record<string, unknown> | undefined)?.provider === 'string'
        ? ((d!.provider as Record<string, unknown>).provider as string)
        : '';
  const systemDefault = d && dName ? { provider: dProvider, name: dName } : null;
  return { enabled, systemDefault };
}

/** D4 / Q1(A): the system-default if it is actually enabled, else the "cheapest" enabled model (prefer
 *  `*-nano`, then `*-mini`), else the first enabled. null when nothing is enabled. Deterministic + pure. */
export function pickLlmModel(enabled: LlmModel[], systemDefault: LlmModel | null): LlmModel | null {
  if (!enabled.length) return null;
  if (systemDefault) {
    const match = enabled.find(
      (m) => m.name === systemDefault.name && (!systemDefault.provider || m.provider === systemDefault.provider)
    );
    if (match) return match; // default valid → use it
  }
  const rank = (name: string): number => {
    const n = name.toLowerCase();
    if (n.includes('nano')) return 0;
    if (n.includes('mini')) return 1;
    return 2;
  };
  // stable sort keeps first-enabled order within an equal rank (→ the "first enabled" fallback)
  return [...enabled].sort((a, b) => rank(a.name) - rank(b.name))[0];
}

/** Resolve the LLM model to auto-fill (§2). null = query failed (infra) OR 0 models enabled — the live
 *  caller treats null as `infra_fail` (0-model), never as a silent no-op. */
export async function resolveDefaultLlmModel(projectsDir: string): Promise<LlmModel | null> {
  const r = await runSyncPy(projectsDir, ['models']);
  if (r.code !== 0) return null;
  const { enabled, systemDefault } = parseModels(r.stdout);
  return pickLlmModel(enabled, systemDefault);
}

/** Query the workspace models ONCE and return both the enabled set (for `deployWithModel`'s
 *  `validNames`) and the D4 pick. `pick===null` ⇒ the caller treats it as `infra_fail` (0-model). */
export async function resolveLlmModels(
  projectsDir: string
): Promise<{ enabled: LlmModel[]; pick: LlmModel | null }> {
  const r = await runSyncPy(projectsDir, ['models']);
  if (r.code !== 0) return { enabled: [], pick: null };
  const { enabled, systemDefault } = parseModels(r.stdout);
  return { enabled, pick: pickLlmModel(enabled, systemDefault) };
}

/** Extract the minted app key (`app-…`) from `sync.py api-key` JSON out (`{token}`). */
export function appKeyFromStdout(stdout: string): string | null {
  const token = lastJsonLine(stdout)?.token;
  return typeof token === 'string' && token ? token : null;
}

/** Mint an app-level API key AND register it for redaction (B3) so it can never leak once captured. The
 *  caller unregisters it (unregisterSecret) when the test app is torn down. null on failure. */
export async function mintAppKey(projectsDir: string, appId: string): Promise<string | null> {
  const r = await runSyncPy(projectsDir, ['api-key', '--app-id', appId]);
  if (r.code !== 0) return null;
  const key = appKeyFromStdout(r.stdout);
  registerSecret(key); // B3: from here on redactSecrets scrubs this key in every captured stream
  return key;
}

/** Publish the app's workflow draft (import does NOT auto-publish). */
export async function publishWorkflow(projectsDir: string, appId: string): Promise<{ ok: boolean; stderr: string }> {
  const r = await runSyncPy(projectsDir, ['publish', '--app-id', appId]);
  return { ok: r.code === 0, stderr: r.stderr };
}

/** Delete a test app by id (Q3 cleanup). */
export async function deleteApp(projectsDir: string, appId: string): Promise<boolean> {
  const r = await runSyncPy(projectsDir, ['delete', '--app-id', appId]);
  return r.code === 0;
}

/** Structured result of a blocking workflow run. `ok` = status succeeded (T1's mechanical gate). */
export interface RunResult {
  ok: boolean;
  status: string | null;
  outputs: Record<string, unknown> | null;
  error: string | null;
  totalTokens: number | null;
}

/** Parse `sync.py run` JSON. Handles BOTH shapes: workflow (`{data:{status, outputs, error,
 *  total_tokens}}`) and chat/completion (`{answer, metadata:{usage:{total_tokens}}}` — no `data.status`). */
export function parseRunResult(stdout: string): RunResult {
  const obj = lastJsonLine(stdout);
  if (!obj) return { ok: false, status: null, outputs: null, error: 'unparseable run output', totalTokens: null };
  // chat-messages / completion-messages: the answer is a top-level string; success = a non-empty answer
  // (a run error would have been a non-200 → sync.py exits non-zero → this parser isn't reached).
  if (obj.data === undefined && typeof obj.answer === 'string') {
    const usage = (obj.metadata as Record<string, unknown> | undefined)?.usage as Record<string, unknown> | undefined;
    const totalTokens = typeof usage?.total_tokens === 'number' ? usage.total_tokens : null;
    const error = typeof obj.error === 'string' && obj.error ? obj.error : null;
    return {
      ok: !error && obj.answer.length > 0,
      status: error ? 'failed' : 'succeeded',
      outputs: obj.answer ? { answer: obj.answer } : null,
      error,
      totalTokens,
    };
  }
  const data = (typeof obj.data === 'object' && obj.data ? obj.data : obj) as Record<string, unknown>;
  const status = typeof data.status === 'string' ? data.status : null;
  const outputs = data.outputs && typeof data.outputs === 'object' ? (data.outputs as Record<string, unknown>) : null;
  const error = typeof data.error === 'string' && data.error ? data.error : null;
  const totalTokens = typeof data.total_tokens === 'number' ? data.total_tokens : null;
  return { ok: status === 'succeeded', status, outputs, error, totalTokens };
}

/** Run the published workflow via the Service API. The app key rides the CHILD ENV (B3), never argv;
 *  `timeoutMs` bounds a hung run (B2) — the outer execFile timeout is a hair beyond Python's own HTTP
 *  timeout so a clean error tail wins the race; either way code≠0 → ok:false (caller → infra_fail). */
export async function runWorkflow(
  projectsDir: string,
  appKey: string,
  mode: string,
  inputs: Record<string, unknown>,
  query: string,
  timeoutMs: number
): Promise<RunResult> {
  const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
  const args = ['run', '--inputs', JSON.stringify(inputs), '--timeout', String(timeoutSec)];
  if (mode) args.push('--mode', mode);
  if (query) args.push('--query', query); // chat-like apps need the message
  const r = await runSyncPy(projectsDir, args, { env: { DIFY_APP_KEY: appKey }, timeoutMs: timeoutMs + 5000 });
  if (r.code !== 0) {
    const tail = r.stderr.trim().split('\n').slice(-2).join(' ⏎ ') || 'sync.py run exited non-zero';
    return { ok: false, status: null, outputs: null, error: tail, totalTokens: null };
  }
  return parseRunResult(r.stdout);
}

/** A start-node input variable (spec 032 D8) — enough to build a sample run input or decide `need_input`. */
export interface InputVar {
  variable: string;
  type: string; // 'text-input' | 'paragraph' | 'number' | 'select' | 'file' | 'file-list' | …
  required: boolean;
  label?: string;
  options?: string[];
}

/** Result of `deployWithModel`: `nodeCount` llm nodes got a model filled (for the report's
 *  `model_autofilled`); `outFile` is the repo-relative temp deploy YAML to push; `inputs` is the
 *  start-node schema (D8). */
export interface DeployResult {
  ok: boolean;
  nodeCount: number;
  patched: string[];
  outFile: string | null;
  inputs: InputVar[];
  /** app mode — decides the run endpoint (workflow → /workflows/run; chat-like → /chat-messages). */
  mode: string;
  stderr: string;
}

/**
 * Spec 032 §2 — write a TEMP deploy YAML (`outRel`) with `model` filled into every llm node whose model
 * is empty (or set-but-not-in `validNames`). The on-disk source (`srcRel`, e.g. main.yml) is UNTOUCHED
 * so it stays workspace-agnostic/portable; only the throwaway copy carries the resolved model. Backed by
 * the `inject-model` sync.py subcommand (local file I/O, no creds). `nodeCount:0` ⇒ nothing to patch ⇒
 * the caller pushes the source as-is.
 */
export async function deployWithModel(
  projectsDir: string,
  srcRel: string,
  outRel: string,
  model: LlmModel,
  validNames: string[]
): Promise<DeployResult> {
  const args = ['inject-model', '--src', srcRel, '--out', outRel, '--provider', model.provider, '--name', model.name];
  if (validNames.length) args.push('--valid-names', validNames.join(','));
  const r = await runSyncPy(projectsDir, args);
  if (r.code !== 0) return { ok: false, nodeCount: 0, patched: [], outFile: null, inputs: [], mode: '', stderr: r.stderr };
  const obj = lastJsonLine(r.stdout);
  const nodeCount = typeof obj?.node_count === 'number' ? obj.node_count : 0;
  const patched = Array.isArray(obj?.patched) ? (obj!.patched as unknown[]).map(String) : [];
  const outFile = typeof obj?.out === 'string' ? obj.out : outRel;
  const inputs = (Array.isArray(obj?.inputs) ? obj!.inputs : []) as InputVar[];
  const mode = typeof obj?.mode === 'string' ? obj.mode : '';
  return { ok: true, nodeCount, patched, outFile, inputs, mode, stderr: r.stderr };
}

/**
 * Spec 032 A2 — the LIVE-test import: push a YAML as a NEW app and trust the `--json-out` app id.
 * Deliberately does NOT use `push_intent` / `reconcileAppIdByName` (the static path's crash-guard): live
 * test ACCEPTS a new app per run (D5) and tracks ids in `test_apps.json`; name-reconcile goes `ambiguous`
 * once ≥2 same-named apps exist (normal for repeated live tests). A missing app id here is an infra_fail
 * the caller retries — never a name-reconcile. Thin over {@link pushApp} (same `--name` + `--json-out`).
 */
export async function importForTest(
  projectsDir: string,
  project: string,
  workflowSlug: string,
  srcFileRel: string,
  appName: string
): Promise<{ ok: boolean; appId: string | null; stderr: string }> {
  // `--src-file` (repo-relative) pushes the temp `.runs/<id>/deploy.yml` that lives OUTSIDE the workflow
  // folder. `--name` pins the app name; `--json-out` gives the id. NO push_intent / reconcile (A2).
  const r = await runSyncPy(projectsDir, [
    'push',
    '--project',
    project,
    '--workflow',
    workflowSlug,
    '--src-file',
    srcFileRel,
    '--name',
    appName,
    '--yes',
    '--json-out',
  ]);
  const appId = r.code === 0 ? appIdFromJsonOut(r.stdout) : null;
  return { ok: r.code === 0, appId, stderr: r.stderr };
}
