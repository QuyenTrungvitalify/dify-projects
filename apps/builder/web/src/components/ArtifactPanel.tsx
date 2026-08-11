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
import { activeTocIndex, tocSelector, yamlAnchors, type TocEntry } from '../lib/artifact-toc';
import { t as tr, tf, lang, localizeNotes } from '../lib/i18n';
import type { ArtifactTab, WireTask, WireArtifacts, FileChange } from '../types';

const EXPANDED_KEY = 'builder.artifactExpanded';

/**
 * The element that actually scrolls a given anchor into view — resolved, never assumed.
 *
 * Which element scrolls DIFFERS per tab: the Spec preview is its own `overflow-y:auto` box (it fills the
 * panel height so the toolbar and Save bar stay pinned), while main.yml/Diff/Report scroll the panel body
 * itself. Hard-coding `.artifact-body` made the rail's jumps silently do nothing on the Spec tab — the
 * one tab this feature exists for. Walking up to the nearest ancestor that can actually scroll keeps the
 * rail working if either layout changes again.
 */
function scrollContainer(el: HTMLElement, fallback: HTMLElement): HTMLElement {
  let p: HTMLElement | null = el.parentElement;
  while (p && p !== fallback.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p;
    p = p.parentElement;
  }
  return fallback;
}

/** An element's offset inside its scroll container — via rects, so it holds whatever the offsetParent
 *  chain looks like (nested flex/relative wrappers made `offsetTop` alone read against the wrong box). */
function offsetWithin(el: HTMLElement, container: HTMLElement): number {
  return el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
}

/**
 * The contents rail — a narrow right-hand column listing the sections of whatever tab is open, with the
 * one you are reading marked. Shown only while the panel is expanded: at the panel's normal width there
 * is no room to spend on it without squeezing the artifact itself.
 *
 * Entries are measured from the RENDERED body (`ArtifactPanel` builds them), so the rail can never list
 * a section the page does not have. `onJump` scrolls the body, which then re-runs the spy — clicking a
 * row and scrolling to it are the same code path, so they cannot disagree.
 */
function ContentsRail({ entries, active, onJump }: {
  entries: TocEntry[];
  active: number;
  /** By INDEX, not by pixel: where entry `i` sits is resolved fresh when the click happens. */
  onJump: (index: number) => void;
}) {
  return (
    <nav className="art-toc" aria-label={tr('contents')}>
      <div className="art-toc-head">{tr('contents')}</div>
      {entries.length === 0 ? (
        <div className="art-toc-empty">{tr('contentsEmpty')}</div>
      ) : (
        <ul className="art-toc-list">
          {entries.map((e, i) => (
            <li key={e.key}>
              <button
                className={'art-toc-item lv' + Math.min(e.level, 3) + (i === active ? ' on' : '')}
                onClick={() => onJump(i)}
                title={e.text}
              >
                {e.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

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
      ) : null}
      {report.notes && (
        <ul className="report-notes-list" style={{ marginTop: 10 }}>
          {localizeNotes(report.notes).split('\n').filter(Boolean).map((line, i) => (
            <li key={i} className="report-note-item">
              <span className="note-bullet">·</span>
              <span className="note-text">{line}</span>
            </li>
          ))}
        </ul>
      )}
      {!report.app_url && report.deploy !== 'cloud' && report.deploy !== 'selfhost' && (
        <div className="secret-note deploy-off-note" style={{ marginTop: 10 }}>
          <I.lock />※ {tr('noteDeployOff')}
        </div>
      )}
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

  // Expand is a display option of the PANEL, not of one tab: it is a viewport concern, and main.yml /
  // diff are the longest artifacts here — a zoom that only Spec had would read as an oversight. Persisted
  // because it is a working preference (someone reviewing specs all afternoon wants it to stay).
  const [expanded, setExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem(EXPANDED_KEY) === '1'; } catch { return false; }
  });
  const toggleExpanded = (): void => {
    setExpanded((x) => {
      try { localStorage.setItem(EXPANDED_KEY, x ? '0' : '1'); } catch { /* private mode — just don't persist */ }
      return !x;
    });
  };
  // Esc leaves expanded view. It deliberately does NOT close the panel: the panel has no Esc-to-close
  // today, and quietly adding one would change a behavior nobody asked about.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') toggleExpanded(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const bodyRef = useRef<HTMLDivElement>(null);
  // Whatever actually scrolls for the CURRENT tab (see scrollContainer), plus the anchors themselves:
  // a heading ELEMENT, or a LINE in main.yml. Positions are derived from these on demand — never stored.
  // Anchors are stored as ADDRESSES, never as element references: the nth match of the tab's selector,
  // or a line in main.yml. A held element goes stale on the next re-render — the Spec preview replaces
  // its whole subtree through innerHTML — and a detached node measures as all-zero, so every row quietly
  // scrolled to the top instead of to its section. An address survives any amount of re-rendering.
  const anchorsRef = useRef<{ domIndex: number; line: number }[]>([]);
  const [entries, setEntries] = useState<TocEntry[]>([]);
  const [active, setActive] = useState(-1);

  /** The element that scrolls for the current tab, resolved fresh (see scrollContainer). */
  const resolveScroller = (): HTMLElement | null => {
    const body = bodyRef.current;
    if (!body) return null;
    const sel = tocSelector(activeTab);
    const first = sel
      ? body.querySelector<HTMLElement>(sel)
      : body.querySelector<HTMLElement>('.codeblock pre');
    return first ? scrollContainer(first, body) : body;
  };

  /** Where each anchor sits inside the scroller, measured NOW — one rect per heading, or one rect total
   *  for main.yml (every line is `lineHeight` apart in a non-wrapping monospace block). */
  const currentTops = (): number[] => {
    const body = bodyRef.current;
    const scroller = resolveScroller();
    const anchors = anchorsRef.current;
    if (!body || !scroller || anchors.length === 0) return [];
    const sel = tocSelector(activeTab);
    if (sel) {
      const els = body.querySelectorAll<HTMLElement>(sel);
      return anchors.map((a) => {
        const el = els[a.domIndex];
        return el ? offsetWithin(el, scroller) : 0;
      });
    }
    const pre = body.querySelector<HTMLElement>('.codeblock pre');
    if (!pre) return [];
    const cs = getComputedStyle(pre);
    const lh = parseFloat(cs.lineHeight) || 0;
    const base = offsetWithin(pre, scroller) + (parseFloat(cs.paddingTop) || 0);
    return anchors.map((a) => base + a.line * lh);
  };

  // Measure the rail off the rendered body. Runs only while expanded (the rail is hidden otherwise, so
  // measuring would be work nobody sees) and re-runs whenever what is on screen could have moved: the
  // tab, the artifact bytes, or the language (which re-renders every section title).
  useEffect(() => {
    if (!expanded) { setEntries([]); return; }
    const body = bodyRef.current;
    if (!body) return;
    const collect = (): void => {
      const found: TocEntry[] = [];
      const anchors: { domIndex: number; line: number }[] = [];
      const sel = tocSelector(activeTab);
      if (sel) {
        // `i` is the index in the FULL match list — that is the address `currentTops` re-queries with,
        // so a heading skipped here for having no text must not shift the ones after it.
        [...body.querySelectorAll<HTMLElement>(sel)].forEach((el, i) => {
          const text = (el.textContent ?? '').trim();
          if (!text) return;
          found.push({ key: `d${i}`, text, level: el.tagName === 'H1' ? 1 : el.tagName === 'H3' ? 3 : 2 });
          anchors.push({ domIndex: i, line: 0 });
        });
      } else if (activeTab === 'yaml' && art.yaml) {
        // A <pre> is one text node — there is nothing to query. Anchor by LINE instead: the code block
        // is monospace and never wraps (`white-space: pre`), so every line is exactly one line-height and
        // line N sits at `<top of pre's text> + N * lineHeight`. Measured, never assumed — a theme or
        // browser zoom changes the line height, and re-measuring here keeps the rail honest.
        if (body.querySelector('.codeblock pre')) {
          for (const a of yamlAnchors(art.yaml)) {
            found.push({ key: `y${a.line}`, text: a.text, level: a.level });
            anchors.push({ domIndex: -1, line: a.line });
          }
        }
      }
      anchorsRef.current = anchors;
      // Only publish a real change — this runs on every content/tab update and an unconditional setState
      // would re-render the whole panel for an identical rail.
      setEntries((prev) =>
        prev.length === found.length && prev.every((p, i) => p.key === found[i].key && p.text === found[i].text)
          ? prev
          : found
      );
    };
    // Measure NOW, then refine one frame later. The sync pass is the one that must not be skipped:
    // `getBoundingClientRect` forces layout, so it is already accurate here — and a rAF-only measure
    // silently produced an empty rail whenever the window was in the background, because browsers do not
    // run animation frames for a hidden page. The extra frame only catches late reflow (fonts, a table
    // settling), so losing it to a cancel is harmless.
    // Collecting anchors is layout-independent (it reads elements and text, not pixels), so one pass
    // after render is enough — no resize handling, because nothing measured here can go stale.
    collect();
  }, [expanded, activeTab, art.spec, art.yaml, art.report, art.diff, lang.value]);

  // Scroll-spy. Passive listener + rAF coalescing: this fires on every wheel tick, and the work is a
  // linear scan that must never be the reason a long spec scrolls badly.
  useEffect(() => {
    const scroller = resolveScroller();
    if (!scroller || !expanded || entries.length === 0) { setActive(-1); return; }
    let queued = false;
    const onScroll = (): void => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        setActive(activeTocIndex(currentTops().map((top) => ({ top })), scroller.scrollTop));
      });
    };
    onScroll();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [expanded, entries]);

  return (
    <aside className={'artifact' + (expanded ? ' expanded' : '')}>
      <div className="artifact-head">
        <I.panel style={{ width: 15, height: 15, color: 'var(--tx-muted)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
          <span className="ah-title">{tr('artifact')}</span>
          <span className="ah-sub">{task.workflowSlug ?? task.name ?? tr('newWorkflow')}</span>
        </div>
        <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={toggleExpanded}
          title={expanded ? tr('collapsePanelHint') : tr('expandPanelHint')}
          aria-label={expanded ? tr('collapsePanel') : tr('expandPanel')} aria-pressed={expanded}>
          {expanded ? <I.shrink /> : <I.expand />}
        </button>
        <button className="icon-btn artifact-close" onClick={onClose} title={tr('hidePanel')}><I.close /></button>
      </div>

      <div className="artifact-tabs">
        {tabs.map((t) => (
          <button key={t.key} className={'atab' + (activeTab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>
            {t.icon}{t.label}
            {t.dot && <span className={'tab-dot ' + t.dot} />}
          </button>
        ))}
      </div>

      {/* The body and the rail scroll as one row so the rail can stay put while the artifact moves. */}
      <div className="artifact-main">
        <div className="artifact-body" ref={bodyRef}>
          {activeTab === 'spec' && <SpecTab task={task} content={art.spec ?? ''} onSave={onSaveSpec} />}
          {activeTab === 'yaml' && <YamlTab yaml={art.yaml} report={report} onReveal={onReveal} />}
          {activeTab === 'diff' && <DiffTab diff={art.diff} />}
          {activeTab === 'report' && <ReportTab report={report} onReveal={onReveal} />}
        </div>
        {expanded && (
          <ContentsRail entries={entries} active={active}
            onJump={(i) => {
              const top = currentTops()[i];
              const scroller = resolveScroller();
              // Assign scrollTop rather than scrollTo({behavior:'smooth'}): the smooth animation does not
              // run in this container (verified — an identical instant assignment lands exactly, the
              // smooth call leaves it a few pixels in), and a jump that silently goes nowhere is far worse
              // than one without an animation. A contents rail is expected to jump anyway.
              if (top !== undefined && scroller) scroller.scrollTop = top;
            }} />
        )}
      </div>
    </aside>
  );
}
