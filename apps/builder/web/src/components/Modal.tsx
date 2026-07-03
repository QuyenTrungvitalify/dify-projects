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
import { createProject } from '../store';
import { isValidProjectName, projectSlug } from '../lib/slug';

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
  cancelLabel?: string;
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
          <button className="btn ghost" onClick={onCancel}>{cancelLabel}</button>
          <button className={'btn ' + (danger ? 'danger' : 'primary')} autoFocus onClick={onOk}>{okLabel}</button>
        </div>
      </div>
    </div>
  );
}
