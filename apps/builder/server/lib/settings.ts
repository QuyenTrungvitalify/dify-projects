/**
 * settings.ts — the dev Settings surface (a ⚙ modal under BUILDER_DEV, spec 083 follow-up).
 *
 * A small, EXTENSIBLE registry of runtime-settable values. Everything here is read from a file at
 * USE time (never cached, never needs a restart), so a change through the modal takes effect on the
 * next share/build. Overrides live in `.dify-settings.local.json` — GITIGNORED and per-machine, so
 * setting a value never edits the team-committed `.dify-share.json` nor produces a git diff. The
 * tracked file stays the team default; the local file overrides it per field.
 *
 * Adding a setting = one entry in FIELDS + one consumer that reads it. The modal renders whatever
 * FIELDS declares — no UI change needed for a new field.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** One settable value. `secret:true` fields are NEVER sent to the browser in plaintext — only a
 *  `set` boolean — and are cleared through the explicit `clearSecrets` channel. */
export interface SettingField {
  key: string; // dotted, e.g. 'share.url' — also the local-file key
  label: string;
  help: string;
  type: 'text' | 'password' | 'number';
  section: string;
  placeholder?: string;
  secret?: boolean;
  /** env var whose value is the fallback when no local override exists (shown as the effective hint). */
  envFallback?: string;
}

export const FIELDS: readonly SettingField[] = [
  {
    key: 'share.url', label: 'Team drop URL', type: 'text', section: 'Share (spec 083)',
    placeholder: 'https://script.google.com/macros/s/…/exec',
    help: 'The Apps Script Web App that receives shared patterns. Overrides .dify-share.json for this machine only.',
  },
  {
    key: 'share.secret', label: 'Drop secret', type: 'password', section: 'Share (spec 083)', secret: true,
    help: 'Must match the SECRET Script Property on the receiver. Stored locally, never committed.',
  },
  {
    key: 'share.maxKb', label: 'Upload cap (KB)', type: 'number', section: 'Share (spec 083)',
    placeholder: '512',
    help: 'Client-side ceiling on a shared pattern; a bigger file is stopped before it is sent.',
  },
  {
    key: 'contributor', label: 'Your display name', type: 'text', section: 'Identity',
    placeholder: 'e.g. Taro (defaults to your OS username)', envFallback: 'BUILDER_CONTRIBUTOR',
    help: 'Stamped on patterns you share so the admin knows who sent them.',
  },
] as const;

const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));
const LOCAL_FILE = '.dify-settings.local.json';

/** The local override map (dotted key → value). Absent/corrupt → {} (never throws — a broken local
 *  file must degrade to "no overrides", not break sharing). Only registry keys are kept. */
export async function loadLocalSettings(projectsDir: string): Promise<Record<string, string | number>> {
  try {
    const raw = JSON.parse(await readFile(join(projectsDir, LOCAL_FILE), 'utf8')) as Record<string, unknown>;
    const out: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!FIELD_BY_KEY.has(k)) continue;
      if (typeof v === 'string' || typeof v === 'number') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Read one setting's local override as a string (numbers stringified), or undefined when unset. */
export async function localOverride(projectsDir: string, key: string): Promise<string | undefined> {
  const v = (await loadLocalSettings(projectsDir))[key];
  return v === undefined ? undefined : String(v);
}

export interface SaveResult {
  ok: boolean;
  error?: string;
}

/** Apply a patch to the local overrides file. `values` sets/updates keys (an empty string or a
 *  blank number CLEARS that key — the field falls back to the team file / env / default);
 *  `clearSecrets` removes secret keys (secrets are never round-tripped through the browser).
 *  Validates every key against the registry and coerces/validates by type. */
export async function saveLocalSettings(
  projectsDir: string,
  patch: { values?: Record<string, unknown>; clearSecrets?: string[] }
): Promise<SaveResult> {
  const current = await loadLocalSettings(projectsDir);
  for (const key of patch.clearSecrets ?? []) {
    const f = FIELD_BY_KEY.get(key);
    if (!f) return { ok: false, error: `unknown setting: ${key}` };
    delete current[key];
  }
  for (const [key, rawVal] of Object.entries(patch.values ?? {})) {
    const f = FIELD_BY_KEY.get(key);
    if (!f) return { ok: false, error: `unknown setting: ${key}` };
    const s = typeof rawVal === 'number' ? String(rawVal) : String(rawVal ?? '').trim();
    if (s === '') { delete current[key]; continue; } // blank → clear the override
    if (f.type === 'number') {
      const n = Number(s);
      if (!Number.isFinite(n) || n <= 0) return { ok: false, error: `${f.label} must be a positive number` };
      current[key] = n;
    } else {
      if (f.key === 'share.url' && !s.startsWith('https://')) {
        return { ok: false, error: 'Team drop URL must start with https://' };
      }
      current[key] = s;
    }
  }
  try {
    await writeFile(join(projectsDir, LOCAL_FILE), JSON.stringify(current, null, 2) + '\n', 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** One field as the browser sees it: metadata + the LOCAL value (secrets masked to a `set` flag) +
 *  a human hint about the effective fallback when no local override exists. */
export interface ResolvedField {
  key: string;
  label: string;
  help: string;
  type: SettingField['type'];
  section: string;
  placeholder?: string;
  secret: boolean;
  /** the local override (non-secret only); null when unset. Secrets never send their value. */
  value: string | number | null;
  /** secret fields: whether a local override exists (so the UI shows "set" without the value). */
  set: boolean;
  /** where the value comes from if there's no local override: 'file' (.dify-share.json), 'env', or 'default'. */
  fallback: string;
}

/** The whole settings view for the modal — one ResolvedField per registry entry. `trackedShare` is
 *  the committed `.dify-share.json` (the team default), passed in so this module needs no import of
 *  share.ts (avoids a cycle). */
export async function resolveSettings(
  projectsDir: string,
  trackedShare: { url?: string; secret?: string; maxKb?: number } | null
): Promise<ResolvedField[]> {
  const local = await loadLocalSettings(projectsDir);
  const trackedByKey: Record<string, string | undefined> = {
    'share.url': trackedShare?.url,
    'share.secret': trackedShare?.secret ? '(set)' : undefined,
    'share.maxKb': trackedShare?.maxKb != null ? String(trackedShare.maxKb) : undefined,
  };
  return FIELDS.map((f) => {
    const has = f.key in local;
    const tracked = trackedByKey[f.key];
    const env = f.envFallback ? process.env[f.envFallback] : undefined;
    const fallback = tracked ? `team file: ${tracked}`
      : env ? `env ${f.envFallback}: ${env}`
      : f.key === 'share.maxKb' ? 'default 512'
      : f.key === 'contributor' ? 'default: your OS username'
      : '(not set)';
    return {
      key: f.key, label: f.label, help: f.help, type: f.type, section: f.section,
      placeholder: f.placeholder, secret: !!f.secret,
      value: f.secret ? null : (has ? local[f.key] : null),
      set: has,
      fallback,
    };
  });
}
