/* ============================================================
   Modal.tsx — Create Project modal + reusable ConfirmModal
   (ported from design_handoff_modals/modal.jsx). CreateProjectModal
   wires the new-project flow; ConfirmModal is the common, site-styled
   replacement for window.confirm() — drive it via store.askConfirm().
   ============================================================ */
import { useEffect, useState } from 'preact/hooks';
import { I } from './Icon';
import { richText } from './Chat';
import { t as tr, tf } from '../lib/i18n';
import { createProject, importBase, promoteExternalYaml, tree } from '../store';
import { isValidProjectName, projectSlug } from '../lib/slug';
import { devMode } from '../lib/dev';

/**
 * CreateProjectModal (spec 031) — type an English name → POST /api/projects makes a real, empty
 * `projects/<slug>/` that shows in the sidebar. The old folder-linker mock (a hardcoded fake-folder pool
 * + linker button) is GONE: a project is one repo folder, not a bag of linked OS dirs (030). D2: a folder-slug
 * preview mirrors the server slug. D3: non-English input is refused with a red teaching error (client +
 * server enforce the identical regex). D4: a duplicate name shows the same red error + an [Open] jump.
 *
 * `onOpenProject(slug)` lands the caller on a fresh composer pre-targeted at that project (used for both
 * a successful create and the duplicate "open existing" jump). `onSkip` bails to a plain from-scratch task.
 */
export function CreateProjectModal({ onClose, onSkip, onOpenProject }: {
  onClose: () => void;
  onSkip: () => void;
  onOpenProject: (project: string) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = name.trim();
  const valid = isValidProjectName(name);
  const canCreate = valid && !submitting;

  async function submit(): Promise<void> {
    if (!valid) { setExisting(null); setError(tr('nameCharsetError')); return; } // D3 client guard
    setSubmitting(true);
    setError(null);
    setExisting(null);
    const r = await createProject(trimmed);
    if ('project' in r) { onOpenProject(r.project); return; } // success → composer pre-targeted (D5)
    // failure: 409 → "already exists" + [Open]; 400 name_charset → the teaching error (defensive)
    setSubmitting(false);
    if (r.existing) { setExisting(r.existing); setError(tf('projectExists', { name: trimmed })); }
    else { setError(r.error === 'name_charset' ? tr('nameCharsetError') : r.error); }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={tr('createProject')}>
        <div className="modal-head">
          <span className="modal-title">{tr('createProject')}</span>
          <button className="icon-btn modal-x" onClick={onClose} aria-label={tr('close')}><I.close /></button>
        </div>

        <div className="modal-field">
          <div className="modal-label">{tr('projectName')}</div>
          <input className="modal-input" autoFocus value={name}
            placeholder={tr('phProjectName')}
            onInput={(e) => { setName(e.currentTarget.value); if (error) { setError(null); setExisting(null); } }}
            onKeyDown={(e) => { if (e.key === 'Enter' && canCreate) void submit(); }}
          />
          {/* D2: live folder-slug preview — always rendered (stable layout); slug fills only for valid input,
              so the preview == the folder created and it never pops in/out while typing. */}
          <div className="modal-hint modal-slug">{tf('folderPreview', { slug: valid ? projectSlug(trimmed) : '' })}</div>
          {error && (
            <div className="modal-error" role="alert">
              <span>{error}</span>
              {existing && (
                <button className="modal-open-existing" onClick={() => onOpenProject(existing)}>{tr('openExisting')}</button>
              )}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="modal-skip" onClick={onSkip}>{tr('skip')}</button>
          <button className="btn primary modal-create" disabled={!canCreate} onClick={() => void submit()}>
            <I.check />{tr('createProjectBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** spec 070: SPDX ids offered for an external-YAML distill. The permissive set redistributes cleanly;
 *  `unknown`/`private` stamp honestly and let `check_provenance.py` flag them (warn-only). */
const INTAKE_LICENSES = ['unknown', 'MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC', 'CC0-1.0', 'CC-BY-4.0', 'private'];

/**
 * IntakeYamlModal (spec 051 D5 → generalized in spec 070) — the ONE door for a workflow YAML that comes
 * from OUTSIDE (doesn't exist in a project yet). Upload or paste it ONCE, then choose what to DO with it:
 *
 *   • Use as base   → POST /api/bases: validate (4-linter) → land as a local edit-existing base under
 *                     `projects/`; `onImported` auto-selects it (the caller's `newTask({baseWorkflow})`).
 *   • Distill       → POST /api/promote {origin:'paste'}: validate → stage → run the B1/distill/review
 *                     pipeline; hands off to the promote panel (a review you Approve). Provenance is stamped
 *                     HONESTLY (source=external + the declared license) — never source=original/MIT (D3).
 *
 * The Japanese `app.name` is preserved as the display label (the slug is a separate ASCII concern, derived
 * server-side). A validation reject returns the linter's verbatim message, shown inline for either action.
 *
 * `advanced` (defaults to the runtime dev flag) decides how much of the form a reader sees. The provenance
 * pair — source label + license — is hidden by default because it asks a REDISTRIBUTION question at intake
 * time, before there is anything to redistribute: neither field changes whether the YAML validates, distills,
 * or lands on the shelf. License only decides whether the finished pattern may later be offered to the team
 * shelf, and the hidden default (`unknown`) is exactly the conservative answer — the offer stays closed. A
 * reader who needs to claim a permissive license opens the same modal with `?dev=1`.
 */
export function IntakeYamlModal({ onClose, onImported, advanced = devMode }: {
  onClose: () => void;
  onImported: (r: { project: string; workflow: string }) => void;
  /** Show the provenance fields (source label + license) and the shelf path. Defaults to dev mode. */
  advanced?: boolean;
}) {
  const [yaml, setYaml] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [action, setAction] = useState<'base' | 'distill'>('distill');
  // base-only fields
  const [name, setName] = useState('');
  const [project, setProject] = useState(''); // '' = _drafts default
  // distill-only fields (spec 070)
  const [sourceLabel, setSourceLabel] = useState('');
  const [license, setLicense] = useState('unknown');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // spec 051: on a base success with an advisory note (a slug auto-suffix and/or an import-probe verdict)
  // we pause on a notice step instead of auto-advancing, so the message isn't lost when the modal closes.
  const [notice, setNotice] = useState<{ project: string; workflow: string; notes: string[] } | null>(null);

  // Existing projects for the override select, minus the reserved `_drafts` (it IS the blank default).
  const projects = tree.value.filter((p) => p.id !== '_drafts');
  const canSubmit = yaml.trim().length > 0 && !submitting;
  // A target-project select with nothing but the `_drafts` default is a question with one answer: it can
  // only teach the reader a word they don't need yet. It appears once there is a second project to pick.
  const showProject = advanced || projects.length > 0;
  const setAct = (a: 'base' | 'distill'): void => { setAction(a); if (error) setError(null); };

  function onFile(e: Event): void {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => { setYaml(String(reader.result ?? '')); if (error) setError(null); };
    reader.readAsText(f);
  }

  async function submit(): Promise<void> {
    if (!yaml.trim()) { setError(tr('importBaseEmpty')); return; }
    setSubmitting(true);
    setError(null);
    if (action === 'distill') {
      // spec 070: distill an EXTERNAL YAML. On success the promote build opens in the panel (task set) —
      // just close the modal; a 400 (bad YAML / linter reject) renders inline, same as the base action.
      const d = await promoteExternalYaml({
        yaml,
        ...(sourceLabel.trim() ? { sourceLabel: sourceLabel.trim() } : {}),
        ...(fileName ? { fileName } : {}),
        license,
      });
      if (d === true) { onClose(); return; }
      setSubmitting(false);
      setError(d.error);
      return;
    }
    const r = await importBase({
      yaml,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(project ? { project } : {}),
      // Only send fileName when the source was a file pick — it drives the .yml/.yaml server check;
      // a paste has no filename and must not be blocked by one.
      ...(fileName ? { fileName } : {}),
    });
    if ('workflow' in r) {
      const notes = [r.slugNote, r.probeNote].filter((n): n is string => !!n);
      if (notes.length) { setNotice({ project: r.project, workflow: r.workflow, notes }); return; } // pause on the note
      onImported({ project: r.project, workflow: r.workflow }); // clean success → auto-advance (AC7)
      return;
    }
    setSubmitting(false);
    setError(r.error);
  }

  // Advisory-note step: the base HAS landed; show the note(s) with an explicit "use this base" continue.
  if (notice) {
    return (
      <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onImported(notice); }}>
        <div className="modal" role="dialog" aria-modal="true" aria-label={tr('intakeTitle')}>
          <div className="modal-head">
            <span className="modal-title">{tr('intakeTitle')}</span>
            <button className="icon-btn modal-x" onClick={() => onImported(notice)} aria-label={tr('close')}><I.close /></button>
          </div>
          <div className="modal-field">
            <div className="modal-hint" style={{ marginBottom: 8 }}>{tf('importBaseLanded', { workflow: notice.workflow, project: notice.project })}</div>
            {notice.notes.map((n, i) => (
              <div key={i} className="modal-hint" style={{ whiteSpace: 'pre-wrap', padding: '6px 0' }}>{n}</div>
            ))}
          </div>
          <div className="modal-foot">
            <button className="btn primary modal-create" onClick={() => onImported(notice)}>
              <I.check />{tr('importBaseUse')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={tr('intakeTitle')}>
        <div className="modal-head">
          <span className="modal-title">{tr('intakeTitle')}</span>
          <button className="icon-btn modal-x" onClick={onClose} aria-label={tr('close')}><I.close /></button>
        </div>

        <div className="modal-field">
          <div className="modal-hint" style={{ marginBottom: 10 }}>{tr('intakeHint')}</div>

          {/* What to DO with this YAML comes FIRST: it decides which fields below exist, and the reader
              who pastes before choosing has to re-read the form once the choice swaps them out. The input
              itself is shared by both actions (no re-paste when the choice changes). */}
          <div className="modal-label">{tr('intakeActionLabel')}</div>
          <div className="artifact-tabs intake-actions" style={{ marginTop: 4 }}>
            <button className={'atab' + (action === 'distill' ? ' active' : '')} onClick={() => setAct('distill')}>{tr('intakeActionDistill')}</button>
            <button className={'atab' + (action === 'base' ? ' active' : '')} onClick={() => setAct('base')}>{tr('intakeActionBase')}</button>
          </div>
          {/* Both actions say what they LEAVE BEHIND — the two labels name mechanisms, and a reader meeting
              the shelf for the first time cannot tell from them which one ends in a file they can edit. */}
          <div className="modal-hint" style={{ marginTop: 8 }}>
            {action === 'distill' ? tr('intakeDistillHint') : tr('intakeBaseHint')}
          </div>
          {advanced && action === 'distill' && (
            <div className="modal-hint" style={{ marginTop: 4 }}>{tr('intakeDistillPath')}</div>
          )}

          <div style={{ marginTop: 14 }}>
            <label className="btn ghost" style={{ display: 'inline-flex', cursor: 'pointer' }}>
              <I.paperclip />{tr('importBaseFile')}
              <input type="file" accept=".yml,.yaml" style={{ display: 'none' }} onChange={onFile} />
            </label>
            {fileName && <span className="modal-hint" style={{ marginLeft: 8 }}>{fileName}</span>}
          </div>

          <div className="modal-label" style={{ marginTop: 12 }}>{tr('importBasePaste')}</div>
          <textarea className="modal-input" rows={7} value={yaml} spellcheck={false}
            style={{ fontFamily: 'var(--mono, monospace)', resize: 'vertical' }}
            placeholder={tr('phPasteYaml')}
            onInput={(e) => { setYaml(e.currentTarget.value); setFileName(null); if (error) setError(null); }}
          />

          {action === 'base' ? (
            <>
              <div className="modal-label" style={{ marginTop: 12 }}>{tr('importBaseName')}</div>
              <input className="modal-input" value={name} placeholder={tr('phImportBaseName')}
                onInput={(e) => setName(e.currentTarget.value)} />

              {showProject && (
                <>
                  <div className="modal-label" style={{ marginTop: 12 }}>{tr('importBaseProject')}</div>
                  <select className="modal-input" value={project} onChange={(e) => setProject(e.currentTarget.value)}>
                    <option value="">{tr('importBaseDrafts')}</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </>
              )}
            </>
          ) : advanced ? (
            <>
              <div className="modal-label" style={{ marginTop: 12 }}>{tr('intakeSourceLabel')}</div>
              <input className="modal-input" value={sourceLabel} placeholder={tr('phIntakeSourceLabel')}
                onInput={(e) => setSourceLabel(e.currentTarget.value)} />

              <div className="modal-label" style={{ marginTop: 12 }}>{tr('intakeLicense')}</div>
              <select className="modal-input" value={license} onChange={(e) => setLicense(e.currentTarget.value)}>
                {INTAKE_LICENSES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <div className="modal-hint" style={{ marginTop: 6 }}>{tr('intakeLicenseHint')}</div>
            </>
          ) : null}

          {error && (
            <div className="modal-error" role="alert" style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflowY: 'auto' }}>
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="modal-skip" onClick={onClose}>{tr('cancel')}</button>
          <button className="btn primary modal-create" disabled={!canSubmit} onClick={() => void submit()}>
            <I.check />{action === 'distill' ? tr('intakeDistillSubmit') : tr('importBaseSubmit')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   ConfirmModal — the common, site-styled OK/Cancel dialog that
   REPLACES window.confirm() (design_handoff_modals). Don't render
   it directly: call store.askConfirm({...}) → Promise<boolean> and
   let App render the single mounted instance. `danger` swaps the
   icon (warn triangle) + the OK button to the red variant. Message
   supports the app's `<c>mono</c>` chip convention (via richText).
   ============================================================ */
export function ConfirmModal({ title, message, okLabel = tr('ok'), cancelLabel = tr('cancel'), danger, onOk, onCancel }: {
  title: string;
  message?: string;
  okLabel?: string;
  /** `null` = ONE button, i.e. an alert rather than a choice — for a notice about something already
   *  done, where a second button could only ever mean the same thing as the first. Esc and a backdrop
   *  click still dismiss (they route to onCancel), so nothing traps the reader. */
  cancelLabel?: string | null;
  danger?: boolean;
  onOk: () => void;
  onCancel: () => void;
}) {
  // Esc → cancel, Enter → ok (global while mounted), mirroring the native confirm's keyboard affordances.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onOk();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOk, onCancel]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className={'confirm-modal' + (danger ? ' danger' : '')} role="alertdialog" aria-modal="true" aria-label={title}>
        <div className="confirm-icon">{danger ? <I.warn /> : <I.alert />}</div>
        <div className="confirm-body">
          <div className="confirm-title">{title}</div>
          {message && <div className="confirm-message">{richText(message)}</div>}
        </div>
        <div className="confirm-foot">
          {cancelLabel !== null && <button className="btn ghost" onClick={onCancel}>{cancelLabel}</button>}
          <button className={'btn ' + (danger ? 'danger' : 'primary')} autoFocus onClick={onOk}>{okLabel}</button>
        </div>
      </div>
    </div>
  );
}
