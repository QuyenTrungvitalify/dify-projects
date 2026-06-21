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
import type { FolderEntry } from '../types';

const FOLDER_POOL = [
  'grammar_check', 'jp_normalize', 'rubric_v2',
  'export_csv', 'seed_loader', 'judge_prompts',
];

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'workspace';
}

export function CreateProjectModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (project: { name: string; folders: FolderEntry[] }) => void;
}) {
  const [name, setName] = useState('');
  const [folders, setFolders] = useState<FolderEntry[]>([]);

  function addFolder() {
    const next = FOLDER_POOL[folders.length % FOLDER_POOL.length];
    const path = '~/code/' + (name.trim() ? slug(name) : 'workspace') + '/' + next;
    setFolders((f) => [...f, { id: 'f' + Date.now() + f.length, name: next, path }]);
  }
  function removeFolder(id: string) { setFolders((f) => f.filter((x) => x.id !== id)); }

  function submit() {
    onCreate({ name: name.trim() || 'Untitled project', folders });
  }

  const canCreate = name.trim().length > 0 || folders.length > 0;

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
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canCreate) submit(); }}
          />
        </div>

        <div className="modal-field">
          <div className="modal-label">{tr('selectFolders')}</div>
          {folders.length > 0 && (
            <div className="folder-list">
              {folders.map((f) => (
                <div key={f.id} className="folder-row">
                  <span className="fr-ic"><I.folder /></span>
                  <span className="fr-path">{f.path}</span>
                  <button className="icon-btn fr-x" onClick={() => removeFolder(f.id)} aria-label={tr('remove')}><I.close /></button>
                </div>
              ))}
            </div>
          )}
          <button className="add-folder-btn" onClick={addFolder}>
            <I.plus />{tr('addFolder')}
          </button>
        </div>

        <div className="modal-foot">
          {folders.length > 0 && (
            <span className="modal-hint">{tf('foldersLinked', { n: folders.length, s: folders.length > 1 ? 's' : '' })}</span>
          )}
          <button className="modal-skip" onClick={() => onCreate({ name: name.trim() || 'Untitled project', folders: [] })}>
            {tr('skip')}
          </button>
          <button className="btn primary modal-create" disabled={!canCreate} onClick={submit}>
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
