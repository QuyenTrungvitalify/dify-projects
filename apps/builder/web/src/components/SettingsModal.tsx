/* SettingsModal.tsx — the dev-only ⚙ Settings surface (spec 083 follow-up). A ⚙ button in the
   sidebar header (same `devMode` gate as RebuildButton / ShelfButton) opens a generic form that
   renders whatever the server's field registry declares (GET /api/dev/settings) and writes
   per-machine overrides to the gitignored .dify-settings.local.json (POST) — never the team-
   committed .dify-share.json. Adding a setting server-side needs NO change here.

   Secrets are never received in plaintext: a set secret shows "(set)" and can be replaced by
   typing a new value or removed via its "clear" toggle. Dev-surface strings stay literal English
   (the RebuildButton / ShelfOverlay precedent) — no i18n. */
import { useEffect, useState } from 'preact/hooks';
import { I } from './Icon';
import { api, ApiError, type DevSettingField } from '../api';
import { sidebarPageSize, setSidebarPageSize, DEFAULT_PAGE_SIZE } from '../lib/sidebar-prefs';
import { bgTestMode, setBgTestMode } from '../store';

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="icon-btn" title="settings (dev)" aria-label="settings (dev)"
        onClick={() => setOpen(true)}><I.sliders /></button>
      {open && <SettingsModal onClose={() => setOpen(false)} />}
    </>
  );
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const [fields, setFields] = useState<DevSettingField[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [clear, setClear] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');

  function hydrate(fs: DevSettingField[]): void {
    setFields(fs);
    // Non-secret fields prefill with their current local value; secrets start blank (never sent).
    const e: Record<string, string> = {};
    for (const f of fs) e[f.key] = !f.secret && f.value != null ? String(f.value) : '';
    setEdits(e);
    setClear({});
  }

  async function load(): Promise<void> {
    setErr(null);
    setSaved('');
    try {
      hydrate((await api.devSettings()).fields);
    } catch (e) {
      const absent = (e instanceof ApiError && e.status === 404) || e instanceof SyntaxError;
      setErr(absent
        ? 'This server has no /api/dev/settings — restart it with BUILDER_DEV=1 on code that includes spec 083.'
        : String(e));
    }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save(): Promise<void> {
    if (!fields) return;
    setSaving(true);
    setErr(null);
    setSaved('');
    const values: Record<string, string | number> = {};
    const clearSecrets: string[] = [];
    for (const f of fields) {
      const v = (edits[f.key] ?? '').trim();
      if (f.secret) {
        if (clear[f.key]) clearSecrets.push(f.key);
        else if (v) values[f.key] = v; // only send a secret the user actually typed
      } else {
        values[f.key] = v; // empty string → server clears the override
      }
    }
    try {
      hydrate((await api.devSaveSettings({ values, clearSecrets })).fields);
      setSaved('✓ saved locally');
      setTimeout(() => setSaved(''), 4000);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const sections = fields ? [...new Set(fields.map((f) => f.section))] : [];

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal settings-modal" role="dialog" aria-modal="true" aria-label="settings (dev)">
        <div className="modal-head">
          <span className="dev-tag">dev</span>
          <span className="modal-title">Settings</span>
          <button className="icon-btn modal-x" onClick={onClose} aria-label="Close"><I.close /></button>
        </div>

        <div className="settings-scroll">
          {/* spec 084 follow-up — a CLIENT-side UI preference (localStorage), always shown regardless of the
              backend field load: how many rows each sidebar section shows before "Show N more". */}
          <div className="settings-section">
            <div className="settings-sec-title">Local UI (this browser)</div>
            <label className="settings-field settings-toggle">
              <div className="settings-toggle-row">
                <input type="checkbox" checked={bgTestMode.value}
                  onChange={(e) => setBgTestMode((e.target as HTMLInputElement).checked)} />
                <div className="settings-label">Test distill (dry-run)</div>
              </div>
              <div className="settings-help">
                When on, every distill runs as a dry-run — never written to the shelf — and can be wiped via the tray’s “Clear test”.
              </div>
            </label>
            <label className="settings-field">
              <div className="settings-label">Sidebar items per section</div>
              <input className="settings-input" type="number" min={1} max={999}
                value={String(sidebarPageSize.value)}
                onInput={(e) => setSidebarPageSize(parseInt((e.target as HTMLInputElement).value, 10))}
              />
              <div className="settings-help">
                Rows shown before a “Show N more” toggle. <span className="settings-fallback">· default: {DEFAULT_PAGE_SIZE}</span>
              </div>
            </label>
          </div>

          {/* A save error is a BANNER over the still-visible form; only a LOAD error (no fields yet,
              e.g. 404 without BUILDER_DEV) replaces the form entirely. */}
          {err && <div className="modal-error" role="alert"><span>{err}</span></div>}
          {err && fields === null ? null : fields === null ? <div className="shelf-loading">loading…</div> : (
            <>
              <p className="settings-intro">
                Saved to <code>.dify-settings.local.json</code> — this machine only, never committed.
                Blank a field to fall back to the team default.
              </p>
              {sections.map((sec) => (
                <div key={sec} className="settings-section">
                  <div className="settings-sec-title">{sec}</div>
                  {fields.filter((f) => f.section === sec).map((f) => (
                    <Field
                      key={f.key} f={f}
                      value={edits[f.key] ?? ''}
                      cleared={!!clear[f.key]}
                      onValue={(v) => setEdits((m) => ({ ...m, [f.key]: v }))}
                      onClear={(c) => setClear((m) => ({ ...m, [f.key]: c }))}
                    />
                  ))}
                </div>
              ))}
            </>
          )}
        </div>

        {fields !== null && (
          <div className="settings-foot">
            {saved && <span className="settings-saved">{saved}</span>}
            <button className="btn ghost" onClick={onClose} disabled={saving}>Close</button>
            <button className="btn ok" onClick={() => void save()} disabled={saving}>
              {saving ? 'saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ f, value, cleared, onValue, onClear }: {
  f: DevSettingField;
  value: string;
  cleared: boolean;
  onValue: (v: string) => void;
  onClear: (c: boolean) => void;
}) {
  const secretSet = f.secret && f.set && !cleared;
  return (
    <label className="settings-field">
      <div className="settings-label">{f.label}</div>
      <input
        className="settings-input"
        type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
        value={value}
        placeholder={secretSet ? '•••••••• (set — type to replace)' : (f.placeholder ?? '')}
        disabled={cleared}
        onInput={(e) => onValue((e.target as HTMLInputElement).value)}
      />
      <div className="settings-help">
        {f.help} <span className="settings-fallback">· fallback: {f.fallback}</span>
      </div>
      {f.secret && f.set && (
        <label className="settings-clear">
          <input type="checkbox" checked={cleared} onChange={(e) => onClear((e.target as HTMLInputElement).checked)} />
          clear the saved secret (fall back to the team default)
        </label>
      )}
    </label>
  );
}
