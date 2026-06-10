/* ============================================================
   Modal.tsx — Create Project modal (ported from modal.jsx)
   Used by the new-project flow; lat4-ui wires it to the
   new-task / project-create endpoints.
   ============================================================ */
import { useState } from 'preact/hooks';
import { I } from './Icon';
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
      <div className="modal" role="dialog" aria-modal="true" aria-label="Create Project">
        <div className="modal-head">
          <span className="modal-title">Create Project</span>
          <button className="icon-btn modal-x" onClick={onClose} aria-label="Close"><I.close /></button>
        </div>

        <div className="modal-field">
          <div className="modal-label">Project name</div>
          <input className="modal-input" autoFocus value={name}
            placeholder="e.g. Eiken, TOEIC, Internal tools…"
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canCreate) submit(); }}
          />
        </div>

        <div className="modal-field">
          <div className="modal-label">Select folder(s)</div>
          {folders.length > 0 && (
            <div className="folder-list">
              {folders.map((f) => (
                <div key={f.id} className="folder-row">
                  <span className="fr-ic"><I.folder /></span>
                  <span className="fr-path">{f.path}</span>
                  <button className="icon-btn fr-x" onClick={() => removeFolder(f.id)} aria-label="Remove"><I.close /></button>
                </div>
              ))}
            </div>
          )}
          <button className="add-folder-btn" onClick={addFolder}>
            <I.plus />Add Folder
          </button>
        </div>

        <div className="modal-foot">
          {folders.length > 0 && (
            <span className="modal-hint">{folders.length} folder{folders.length > 1 ? 's' : ''} linked</span>
          )}
          <button className="modal-skip" onClick={() => onCreate({ name: name.trim() || 'Untitled project', folders: [] })}>
            Skip
          </button>
          <button className="btn primary modal-create" disabled={!canCreate} onClick={submit}>
            <I.check />Create project
          </button>
        </div>
      </div>
    </div>
  );
}
