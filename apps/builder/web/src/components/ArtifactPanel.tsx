/* ============================================================
   ArtifactPanel.tsx — right slide-in: Spec / main.yml+lint / Diff / Report
   Live (lat4-ui): renders the task's artifactContents (GET /api/tasks/:id).
   SPEC.md is editable in place → PUT /api/tasks/:id/spec (AC #3); the diff
   uses SplitDiffView when a payload is present, else degrades (producer is
   Lát 5, AC #4 render-half). Secrets are never rendered — token stays
   backend-side; only the .secret-note reminder shows.
   ============================================================ */
import { useState, useEffect, useRef } from 'preact/hooks';
import type { VNode } from 'preact';
import { I } from './Icon';
import { SplitDiffView } from './SplitDiffView';
import { renderMarkdownHtml } from '../lib/markdown';
import { t as tr, tf, localizeNotes } from '../lib/i18n';
import type { ArtifactTab, WireTask, WireArtifacts, FileChange } from '../types';

type SpecMode = 'edit' | 'preview' | 'split';
// Preview FIRST (review-before-edit): the panel opens on the rendered spec; Edit is one click away.
const SPEC_MODES: { key: SpecMode; labelKey: string }[] = [
  { key: 'preview', labelKey: 'specPreview' },
  { key: 'edit', labelKey: 'specEdit' },
  { key: 'split', labelKey: 'specSplit' },
];

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
  const [mode, setMode] = useState<SpecMode>('preview'); // review-before-edit: open on the rendered spec
  const taRef = useRef<HTMLTextAreaElement>(null);
  // After a toolbar edit re-renders the controlled textarea, re-apply focus + selection here (the
  // value isn't in the DOM until the next render, so it can't be set synchronously in the handler).
  const pendingSel = useRef<[number, number] | null>(null);
  // Re-seed when the task or its server content changes (e.g. switching tasks / a re-fetch).
  useEffect(() => { setVal(content); setSaved(true); }, [content, task.taskId]);
  useEffect(() => {
    const sel = pendingSel.current;
    if (sel && taRef.current) {
      pendingSel.current = null;
      taRef.current.focus();
      taRef.current.setSelectionRange(sel[0], sel[1]);
    }
  });

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await onSave(val);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  // --- toolbar primitives (operate on the textarea's current selection) ---
  const commit = (next: string, selStart: number, selEnd: number): void => {
    setVal(next); setSaved(false); pendingSel.current = [selStart, selEnd];
  };
  // Wrap the selection (or a placeholder when empty) in before/after markers; selects the inner text.
  const wrap = (before: string, after: string, placeholder = 'text'): void => {
    const el = taRef.current; if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    const inner = val.slice(s, e) || placeholder;
    commit(val.slice(0, s) + before + inner + after + val.slice(e), s + before.length, s + before.length + inner.length);
  };
  // Prepend a marker to every line the selection touches (headings / lists / quote).
  const prefix = (mark: string): void => {
    const el = taRef.current; if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    const from = val.lastIndexOf('\n', s - 1) + 1;
    const toNl = val.indexOf('\n', e);
    const to = toNl === -1 ? val.length : toNl;
    const block = val.slice(from, to).split('\n').map((ln) => mark + ln).join('\n');
    commit(val.slice(0, from) + block + val.slice(to), from, from + block.length);
  };
  // Fenced code block; cursor lands on the empty middle line when nothing is selected.
  const codeBlock = (): void => {
    const el = taRef.current; if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    const inner = val.slice(s, e), open = '```\n', close = '\n```';
    commit(val.slice(0, s) + open + inner + close + val.slice(e), s + open.length, s + open.length + inner.length);
  };
  // Markdown link: selection becomes the label, the literal "url" is selected for quick typing.
  const link = (): void => {
    const el = taRef.current; if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    const label = val.slice(s, e) || 'text';
    const urlAt = s + 1 + label.length + 2;
    commit(val.slice(0, s) + `[${label}](url)` + val.slice(e), urlAt, urlAt + 3);
  };

  type Tool = { sep: true } | { label: VNode; title: string; run: () => void };
  const tools: Tool[] = [
    { label: <b>B</b>, title: tr('tbBold'), run: () => wrap('**', '**') },
    { label: <i>I</i>, title: tr('tbItalic'), run: () => wrap('*', '*') },
    { label: <s>S</s>, title: tr('tbStrike'), run: () => wrap('~~', '~~') },
    { label: <span className="stb-mono">{'</>'}</span>, title: tr('tbInlineCode'), run: () => wrap('`', '`', 'code') },
    { sep: true },
    { label: <>H1</>, title: tr('tbH1'), run: () => prefix('# ') },
    { label: <>H2</>, title: tr('tbH2'), run: () => prefix('## ') },
    { label: <>H3</>, title: tr('tbH3'), run: () => prefix('### ') },
    { sep: true },
    { label: <>•</>, title: tr('tbBullet'), run: () => prefix('- ') },
    { label: <>1.</>, title: tr('tbNumbered'), run: () => prefix('1. ') },
    { label: <>""</>, title: tr('tbQuote'), run: () => prefix('> ') },
    { label: <span className="stb-mono">{'{ }'}</span>, title: tr('tbCodeBlock'), run: codeBlock },
    { sep: true },
    { label: <I.link />, title: tr('tbLink'), run: link },
    { label: <span className="stb-mono">{'{{ }}'}</span>, title: tr('tbVariable'), run: () => wrap('{{', '}}', '') },
  ];

  // Preview renders the LIVE (possibly unsaved) text so edits show immediately; the renderer
  // escapes HTML, so this is safe to inject. Empty draft → a muted placeholder.
  const editor = (
    <textarea ref={taRef} className="spec-edit" value={val} spellcheck={false}
      onChange={(e) => { setVal(e.currentTarget.value); setSaved(false); }}
    />
  );
  const preview = val.trim()
    ? <div className="spec-preview md-stream" dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(val) }} />
    : <div className="spec-preview md-stream spec-preview-empty">{tr('nothingToPreview')}</div>;

  return (
    <div className="spec-tab">
      <div className="art-section-title">SPEC.md <span className="ast-line" />
        <div className="seg spec-mode">
          {SPEC_MODES.map((m) => (
            <button key={m.key} className={mode === m.key ? 'on' : ''} onClick={() => setMode(m.key)}>{tr(m.labelKey)}</button>
          ))}
        </div>
      </div>
      {content === '' && <div className="secret-note" style={{ marginBottom: 8 }}>{tr('noSpecYet')}</div>}
      {mode !== 'preview' && (
        <div className="spec-toolbar">
          {tools.map((t, i) => 'sep' in t
            ? <span key={i} className="stb-sep" />
            // preventDefault on mousedown keeps focus (and the selection) in the textarea while clicking.
            : <button key={i} className="stb" title={t.title} onMouseDown={(e) => e.preventDefault()} onClick={t.run}>{t.label}</button>)}
        </div>
      )}
      {mode === 'split'
        ? <div className="spec-split">{editor}{preview}</div>
        : mode === 'preview' ? preview : editor}
      <div className="spec-bar">
        <button className="btn primary" disabled={saved || saving} onClick={save} style={saved ? { opacity: 0.5 } : undefined}>
          <I.save />{saving ? tr('saving') : tr('saveSpec')}
        </button>
        <span className="sb-status">
          {saved
            ? <><I.check style={{ width: 13, height: 13, color: 'var(--ok)' }} />{tr('savedFeedsImplement')}</>
            : <><span className="dirty-dot" />{tr('unsavedChanges')}</>}
        </span>
      </div>
      <div className="secret-note"><I.lock />{tr('tokenRedacted')}</div>
    </div>
  );
}

function YamlTab({ yaml, report, onReveal }: { yaml: string | null; report: ReportShape | null; onReveal: () => void }) {
  const lint = report?.lint;
  const linters = lint
    ? [
        { name: 'validate_workflow', code: lint.validate },
        { name: 'lint_refs', code: lint.lint_refs },
        { name: 'lint_plugin_hashes', code: lint.lint_plugin_hashes },
      ]
    : [];
  // spec 016 D3: one-click Copy — essential for deploy=cloud (paste into Studio → Import DSL), useful
  // for every deploy. Transient "Copied" feedback; clipboard failures (e.g. denied permission) no-op.
  const [copied, setCopied] = useState(false);
  const copyYaml = async (): Promise<void> => {
    if (!yaml) return;
    try {
      await navigator.clipboard.writeText(yaml);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — leave the button idle */
    }
  };
  return (
    <div>
      <div className="art-section-title">main.yml <span className="ast-line" /></div>
      {yaml ? (
        <div className="codeblock">
          <div className="cb-head"><I.yaml style={{ width: 13, height: 13 }} />
            <span className="cb-name">main.yml</span>
            <span className="cb-lang">{tf('yamlLines', { n: yaml.split('\n').length })}</span>
            <button className="cb-reveal" onClick={onReveal}
              title={tr('revealInFinder')} aria-label={tr('revealInFinder')}>
              <I.folder style={{ width: 12, height: 12 }} />{tr('revealInFinder')}
            </button>
            <button className={'cb-copy' + (copied ? ' copied' : '')} onClick={() => void copyYaml()}
              title={tr('copyYaml')} aria-label={tr('copyYaml')}>
              {copied
                ? <><I.check style={{ width: 12, height: 12 }} />{tr('copied')}</>
                : <><I.copy style={{ width: 12, height: 12 }} />{tr('copyYaml')}</>}
            </button>
          </div>
          <pre>{yaml}</pre>
        </div>
      ) : (
        <div className="secret-note">{tr('noYamlYet')}</div>
      )}

      {linters.length > 0 && (
        <>
          <div className="art-section-title" style={{ marginTop: 20 }}>{tr('lintResults')} <span className="ast-line" /></div>
          <div className="lint-list">
            {linters.map((l) => {
              const pass = l.code === 0;
              return (
                <div key={l.name} className={'lint-row ' + (pass ? 'pass' : 'fail')}>
                  <span className="lr-ic">{pass ? <I.checkCircle /> : <I.warn />}</span>
                  <span className="lr-name">{l.name}</span>
                  <span className="lr-msg">{pass ? tr('lintOk') : `exit ${l.code}`}</span>
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
        <div className="art-section-title">{tr('splitDiff')} <span className="ast-line" /></div>
        <div className="secret-note">{tr('noDiffYet')}</div>
      </div>
    );
  }
  const file: FileChange = { path: 'main.yml', status: 'modified', additions: 0, deletions: 0, diff };
  return (
    <div>
      <div className="art-section-title">{tr('splitDiff')} <span className="ast-line" /></div>
      <SplitDiffView file={file} />
    </div>
  );
}

function ReportTab({ report, onReveal }: { report: ReportShape | null; onReveal: () => void }) {
  if (!report) {
    return (
      <div>
        <div className="art-section-title">{tr('runReport')} <span className="ast-line" /></div>
        <div className="secret-note">{tr('noReportYet')}</div>
      </div>
    );
  }
  const lint = report.lint ?? {};
  const lintPass = lint.validate === 0 && lint.lint_refs === 0 && lint.lint_plugin_hashes === 0;
  const rows: { k: string; v: string; ok: boolean; reveal?: boolean }[] = [
    { k: tr('rWorkflowFile'), v: report.workflow_file ?? '—', ok: false, reveal: !!report.workflow_file },
    { k: tr('rLint'), v: lintPass ? tr('rLintAllPassed') : tr('rLintFailures'), ok: lintPass },
    { k: tr('rDeploy'), v: report.deploy === 'none' ? tr('rNotDeployed') : report.deploy ?? '—', ok: false },
  ];
  if (report.accepted_lint_failure) rows.push({ k: tr('rAccepted'), v: tr('rLintOverridden'), ok: false });
  return (
    <div>
      <div className="art-section-title">{tr('runReport')} <span className="ast-line" /></div>
      <div>
        {rows.map((r) => (
          <div key={r.k} className="report-row">
            <span className="rr-key">{r.k}</span>
            <span className={'rr-val' + (r.ok ? ' ok' : '')}>{r.v}</span>
            {r.reveal && (
              <button className="rr-reveal" onClick={onReveal}
                title={tr('revealInFinder')} aria-label={tr('revealInFinder')}>
                <I.folder />
              </button>
            )}
          </div>
        ))}
      </div>
      {report.app_url ? (
        <div className="app-url-card">
          <div className="au-meta">
            <div className="au-label">{tf('deployedTag', { deploy: report.deploy ?? '' })}</div>
            <a className="au-link" href={report.app_url} target="_blank" rel="noopener noreferrer">{report.app_url}</a>
          </div>
          <a className="btn ghost au-go" href={report.app_url} target="_blank" rel="noopener noreferrer"><I.external />{tr('open')}</a>
        </div>
      ) : report.deploy === 'cloud' ? (
        <div className="secret-note" style={{ marginTop: 14 }}>
          <I.lock />{tr('noteCloud')}
        </div>
      ) : report.deploy === 'selfhost' ? (
        <div className="secret-note" style={{ marginTop: 14 }}>
          <I.lock />{tr('noteSelfhost')}
        </div>
      ) : (
        <div className="secret-note" style={{ marginTop: 14 }}>
          <I.lock />{tr('noteDeployOff')}
        </div>
      )}
      {report.notes && <div className="secret-note" style={{ marginTop: 10 }}>{localizeNotes(report.notes)}</div>}
    </div>
  );
}

export function ArtifactPanel({ task, tab, setTab, available, onClose, onSaveSpec, onReveal }: {
  task: WireTask;
  tab: ArtifactTab;
  setTab: (tab: ArtifactTab) => void;
  available: ArtifactTab[];
  onClose: () => void;
  onSaveSpec: (content: string) => Promise<void>;
  /** Reveal the task's workflow YAML in the OS file manager (Finder). */
  onReveal: () => void;
}) {
  const art: WireArtifacts = task.artifactContents ?? { spec: null, yaml: null, report: null, diff: null };
  const report = (art.report as ReportShape | null) ?? null;
  const lintWarn = report ? !(report.lint?.validate === 0 && report.lint?.lint_refs === 0 && report.lint?.lint_plugin_hashes === 0) : false;

  const allTabs: { key: ArtifactTab; label: string; icon: VNode; dot?: string }[] = [
    { key: 'spec', label: tr('tab_spec'), icon: <I.doc /> },
    { key: 'yaml', label: 'main.yml', icon: <I.yaml />, dot: report ? (lintWarn ? 'warn' : 'ok') : undefined },
    { key: 'diff', label: tr('tab_diff'), icon: <I.diff /> },
    { key: 'report', label: tr('tab_report'), icon: <I.report /> },
  ];
  const tabs = allTabs.filter((t) => available.includes(t.key));
  const activeTab = tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key ?? 'spec';

  return (
    <aside className="artifact">
      <div className="artifact-head">
        <I.panel style={{ width: 15, height: 15, color: 'var(--tx-muted)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
          <span className="ah-title">{tr('artifact')}</span>
          <span className="ah-sub">{task.workflowSlug ?? task.name ?? tr('newWorkflow')}</span>
        </div>
        <button className="icon-btn artifact-close" style={{ marginLeft: 'auto' }} onClick={onClose} title={tr('hidePanel')}><I.close /></button>
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
        {activeTab === 'yaml' && <YamlTab yaml={art.yaml} report={report} onReveal={onReveal} />}
        {activeTab === 'diff' && <DiffTab diff={art.diff} />}
        {activeTab === 'report' && <ReportTab report={report} onReveal={onReveal} />}
      </div>
    </aside>
  );
}
