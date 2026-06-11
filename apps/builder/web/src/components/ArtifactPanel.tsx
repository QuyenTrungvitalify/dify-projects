/* ============================================================
   ArtifactPanel.tsx — right slide-in: Spec / main.yml+lint / Diff / Report
   Live (lat4-ui): renders the task's artifactContents (GET /api/tasks/:id).
   SPEC.md is editable in place → PUT /api/tasks/:id/spec (AC #3); the diff
   uses SplitDiffView when a payload is present, else degrades (producer is
   Lát 5, AC #4 render-half). Secrets are never rendered — token stays
   backend-side; only the .secret-note reminder shows.
   ============================================================ */
import { useState, useEffect } from 'preact/hooks';
import type { VNode } from 'preact';
import { I } from './Icon';
import { SplitDiffView } from './SplitDiffView';
import type { ArtifactTab, WireTask, WireArtifacts, FileChange } from '../types';

interface ReportShape {
  workflow_file?: string;
  lint?: { validate?: number; lint_refs?: number; lint_plugin_hashes?: number };
  deploy?: string;
  app_url?: string | null;
  duplicate_warning?: string | null;
  accepted_lint_failure?: boolean;
  notes?: string;
}

function SpecTab({ task, content, onSave }: { task: WireTask; content: string; onSave: (c: string) => Promise<void> }) {
  const [val, setVal] = useState(content);
  const [saved, setSaved] = useState(true);
  const [saving, setSaving] = useState(false);
  // Re-seed when the task or its server content changes (e.g. switching tasks / a re-fetch).
  useEffect(() => { setVal(content); setSaved(true); }, [content, task.taskId]);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await onSave(val);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="art-section-title">SPEC.md <span className="ast-line" /></div>
      {content === '' && <div className="secret-note" style={{ marginBottom: 8 }}>No SPEC.md yet — it appears after the Spec phase.</div>}
      <textarea className="spec-edit" value={val} spellcheck={false}
        onChange={(e) => { setVal(e.currentTarget.value); setSaved(false); }}
      />
      <div className="spec-bar">
        <button className="btn primary" disabled={saved || saving} onClick={save} style={saved ? { opacity: 0.5 } : undefined}>
          <I.save />{saving ? 'Saving…' : 'Save spec'}
        </button>
        <span className="sb-status">
          {saved
            ? <><I.check style={{ width: 13, height: 13, color: 'var(--ok)' }} />Saved · feeds Implement</>
            : <><span className="dirty-dot" />Unsaved changes</>}
        </span>
      </div>
      <div className="secret-note"><I.lock />API token redacted · never shown</div>
    </div>
  );
}

function YamlTab({ yaml, report }: { yaml: string | null; report: ReportShape | null }) {
  const lint = report?.lint;
  const linters = lint
    ? [
        { name: 'validate_workflow', code: lint.validate },
        { name: 'lint_refs', code: lint.lint_refs },
        { name: 'lint_plugin_hashes', code: lint.lint_plugin_hashes },
      ]
    : [];
  return (
    <div>
      <div className="art-section-title">main.yml <span className="ast-line" /></div>
      {yaml ? (
        <div className="codeblock">
          <div className="cb-head"><I.yaml style={{ width: 13, height: 13 }} />
            <span className="cb-name">main.yml</span>
            <span className="cb-lang">yaml · {yaml.split('\n').length} lines</span>
          </div>
          <pre>{yaml}</pre>
        </div>
      ) : (
        <div className="secret-note">No main.yml yet — it appears after the Implement phase.</div>
      )}

      {linters.length > 0 && (
        <>
          <div className="art-section-title" style={{ marginTop: 20 }}>Lint results <span className="ast-line" /></div>
          <div className="lint-list">
            {linters.map((l) => {
              const pass = l.code === 0;
              return (
                <div key={l.name} className={'lint-row ' + (pass ? 'pass' : 'fail')}>
                  <span className="lr-ic">{pass ? <I.checkCircle /> : <I.warn />}</span>
                  <span className="lr-name">{l.name}</span>
                  <span className="lr-msg">{pass ? 'ok' : `exit ${l.code}`}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function DiffTab({ diff }: { diff: string | null }) {
  if (!diff) {
    return (
      <div>
        <div className="art-section-title">Split diff <span className="ast-line" /></div>
        <div className="secret-note">No diff yet — the seed/pattern diff producer lands in Lát 5.</div>
      </div>
    );
  }
  const file: FileChange = { path: 'main.yml', status: 'modified', additions: 0, deletions: 0, diff };
  return (
    <div>
      <div className="art-section-title">Split diff <span className="ast-line" /></div>
      <SplitDiffView file={file} />
    </div>
  );
}

function ReportTab({ report }: { report: ReportShape | null }) {
  if (!report) {
    return (
      <div>
        <div className="art-section-title">Run report <span className="ast-line" /></div>
        <div className="secret-note">No report yet — it appears after the Test phase.</div>
      </div>
    );
  }
  const lint = report.lint ?? {};
  const lintPass = lint.validate === 0 && lint.lint_refs === 0 && lint.lint_plugin_hashes === 0;
  const rows: { k: string; v: string; ok: boolean }[] = [
    { k: 'Workflow file', v: report.workflow_file ?? '—', ok: false },
    { k: 'Lint', v: lintPass ? 'all passed' : 'failures recorded', ok: lintPass },
    { k: 'Deploy', v: report.deploy === 'none' ? 'not deployed (local)' : report.deploy ?? '—', ok: false },
  ];
  if (report.accepted_lint_failure) rows.push({ k: 'Accepted', v: 'lint failure overridden (human)', ok: false });
  return (
    <div>
      <div className="art-section-title">Run report <span className="ast-line" /></div>
      <div>
        {rows.map((r) => (
          <div key={r.k} className="report-row">
            <span className="rr-key">{r.k}</span>
            <span className={'rr-val' + (r.ok ? ' ok' : '')}>{r.v}</span>
          </div>
        ))}
      </div>
      {report.app_url ? (
        <div className="app-url-card">
          <div className="au-meta">
            <div className="au-label">DEPLOYED · {report.deploy}</div>
            <a className="au-link" href={report.app_url} target="_blank" rel="noopener noreferrer">{report.app_url}</a>
          </div>
          <a className="btn ghost au-go" href={report.app_url} target="_blank" rel="noopener noreferrer"><I.external />Open</a>
        </div>
      ) : report.deploy === 'cloud' ? (
        <div className="secret-note" style={{ marginTop: 14 }}>
          <I.lock />Cloud deploy — import the YAML manually in Dify Studio (steps in the notes below; the YAML is in the main.yml tab).
        </div>
      ) : report.deploy === 'selfhost' ? (
        <div className="secret-note" style={{ marginTop: 14 }}>
          <I.lock />Not imported — use the Import button, or check Dify (see notes).
        </div>
      ) : (
        <div className="secret-note" style={{ marginTop: 14 }}>
          <I.lock />Deploy is off — no app URL. Set Deploy ≠ none to import &amp; get a link.
        </div>
      )}
      {report.notes && <div className="secret-note" style={{ marginTop: 10 }}>{report.notes}</div>}
    </div>
  );
}

export function ArtifactPanel({ task, tab, setTab, available, onClose, onSaveSpec }: {
  task: WireTask;
  tab: ArtifactTab;
  setTab: (tab: ArtifactTab) => void;
  available: ArtifactTab[];
  onClose: () => void;
  onSaveSpec: (content: string) => Promise<void>;
}) {
  const art: WireArtifacts = task.artifactContents ?? { spec: null, yaml: null, report: null, diff: null };
  const report = (art.report as ReportShape | null) ?? null;
  const lintWarn = report ? !(report.lint?.validate === 0 && report.lint?.lint_refs === 0 && report.lint?.lint_plugin_hashes === 0) : false;

  const allTabs: { key: ArtifactTab; label: string; icon: VNode; dot?: string }[] = [
    { key: 'spec', label: 'Spec', icon: <I.doc /> },
    { key: 'yaml', label: 'main.yml', icon: <I.yaml />, dot: report ? (lintWarn ? 'warn' : 'ok') : undefined },
    { key: 'diff', label: 'Diff', icon: <I.diff /> },
    { key: 'report', label: 'Report', icon: <I.report /> },
  ];
  const tabs = allTabs.filter((t) => available.includes(t.key));
  const activeTab = tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key ?? 'spec';

  return (
    <aside className="artifact">
      <div className="artifact-head">
        <I.panel style={{ width: 15, height: 15, color: 'var(--tx-muted)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
          <span className="ah-title">Artifact</span>
          <span className="ah-sub">{task.slug ?? task.name ?? 'new workflow'}</span>
        </div>
        <button className="icon-btn artifact-close" style={{ marginLeft: 'auto' }} onClick={onClose} title="Hide panel"><I.close /></button>
      </div>

      <div className="artifact-tabs">
        {tabs.map((t) => (
          <button key={t.key} className={'atab' + (activeTab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>
            {t.icon}{t.label}
            {t.dot && <span className={'tab-dot ' + t.dot} />}
          </button>
        ))}
      </div>

      <div className="artifact-body">
        {activeTab === 'spec' && <SpecTab task={task} content={art.spec ?? ''} onSave={onSaveSpec} />}
        {activeTab === 'yaml' && <YamlTab yaml={art.yaml} report={report} />}
        {activeTab === 'diff' && <DiffTab diff={art.diff} />}
        {activeTab === 'report' && <ReportTab report={report} />}
      </div>
    </aside>
  );
}
