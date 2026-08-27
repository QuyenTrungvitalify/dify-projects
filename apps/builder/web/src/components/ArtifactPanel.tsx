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
import { diffStats, specDiffState } from '../lib/diff-parser';
import { renderMarkdownHtml } from '../lib/markdown';
import { activeTocIndex, tocSelector, usesYamlAnchors, yamlAnchors, type TocEntry } from '../lib/artifact-toc';
import { t as tr, tAction, tf, lang, localizeNotes } from '../lib/i18n';
import { api } from '../api';
import type { ArtifactTab, WireTask, WireArtifacts, FileChange } from '../types';
import type { ArtifactFile } from '../api';

const EXPANDED_KEY = 'builder.artifactExpanded';

/**
 * Where the reader was in each artifact, so closing the panel and reopening it lands back there.
 *
 * Closing UNMOUNTS the panel (App renders it behind `artifactOpen`), which is what made every reopen
 * start at the top — and the working pattern this exists for is exactly the one that suffers: read the
 * spec, close, ask about what you read, reopen, keep reading. So the memory has to outlive the component:
 * module-level, not state (nothing here should cause a render).
 *
 * Keyed by task AND tab — each artifact is its own document, and the tab survives a close (App owns it),
 * so coming back to main.yml must not inherit the spec's offset. `len` is a cheap content fingerprint:
 * a phase re-run rewrites the artifact underneath, and restoring a pre-rewrite offset would drop the
 * reader somewhere unrelated while looking deliberate — so a changed length forgets the position instead.
 * In memory only: after a page reload, "top" is the honest answer.
 */
const scrollMemory = new Map<string, { top: number; len: number }>();

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

/**
 * How you are looking at a file. `diff` is one of these — not a tab.
 *
 * It used to be a fourth tab, which meant ONE tab had to hold BOTH files' diffs, stacked, with a table
 * of contents to get between them. That rail existed only to undo the stacking. A diff is a way of
 * reading a document, not a document, so it belongs beside Preview/Edit/Split, where the answer to
 * "diff of what?" is the tab you are already standing in.
 */
export type SpecMode = 'edit' | 'preview' | 'split' | 'diff';
export type YamlMode = 'code' | 'diff';
// Preview FIRST (review-before-edit): the panel opens on the rendered spec; Edit is one click away.
// `diff` is appended at render time — only when there is a spec diff to show (see SpecTab).
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

/** A diff's size, in the header slot where a file shows its line count. This is the `+N −M` the diff
 *  view used to print in a head row of its own — same numbers, one row up, and COUNTED this time. */
function DiffStat({ diff }: { diff: string }) {
  const { additions, deletions } = diffStats(diff);
  return (
    <>
      {tr('diffStat')}
      {' · '}
      <span className="dstat-add">+{additions}</span>
      {' '}
      <span className="dstat-del">−{deletions}</span>
    </>
  );
}

/**
 * The bar at the top of a file: what it is, how big it is, and what you can do with it. SPEC.md and
 * main.yml render the SAME one — the panel is a set of files now, and a file that looks different from
 * the file beside it reads as a different kind of thing.
 *
 * It sits ABOVE the view switch, not inside one view: you still want the path while you are reading a
 * diff. (It used to live inside main.yml's code block, so switching to 差分 took the three actions away
 * with it — you had to go back to the code to copy the path of the file you were looking at.)
 */
function FileHeader({ icon, name, meta, taskId, which, contents, onReveal }: {
  icon: VNode;
  name: string;
  /** The small grey line after the name — "yaml · 6652 行", or a diff's coloured +/− tally. Describes
   *  what is ON SCREEN, so it changes with the view. */
  meta: VNode | string;
  taskId: string;
  which: ArtifactFile;
  contents: string | null;
  onReveal: (which: ArtifactFile) => void;
}) {
  return (
    <div className="cb-head">
      {icon}
      <span className="cb-name">{name}</span>
      <span className="cb-lang">{meta}</span>
      {/* The three actions wrap as ONE group. Loose in the flex row they wrap individually, so a narrow
          panel broke them across two lines of their own and the header grew to 100px. */}
      <span className="fc-actions">
        <FileActions taskId={taskId} which={which} contents={contents} onReveal={onReveal} />
      </span>
    </div>
  );
}

/**
 * The three things you can do with a file the panel is showing: open it in Finder, take its path, take
 * its contents. Shared by SPEC.md and main.yml so the two rows cannot drift into behaving differently —
 * before this, main.yml had all three and SPEC.md had none.
 *
 * Ordering is the point: Reveal and Copy-path sit together because both answer *where is this file*,
 * and Copy-contents trails because it answers *what is in it*. Copy keeps the bare one-word label a
 * code block's copy button carries everywhere; the tooltips are what tell the two copies apart.
 */
function FileActions({ taskId, which, contents, onReveal }: {
  taskId: string;
  which: ArtifactFile;
  /** What Copy puts on the clipboard — the text ON SCREEN, so an unsaved spec edit copies what you see.
   *  `null` hides the button: there is nothing to take. */
  contents: string | null;
  onReveal: (which: ArtifactFile) => void;
}) {
  // The file's ABSOLUTE path. Fetched when the tab opens, NOT on click: a fetch sitting between the
  // click and `writeText` is what a browser's transient-activation rule rejects, and the failure mode
  // is a button that silently does nothing. Held in state, so the handler writes with no await in
  // front of it.
  //
  // Resolved server-side from the task (a client names WHICH file, never a path), and 404s until the
  // file is actually on disk. That 404 is a normal state, not an error: `null` means no button, rather
  // than a button offering a path that leads nowhere.
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void api.artifactPath(taskId, which).then(
      (r) => { if (live) setPath(r.path); },
      () => { if (live) setPath(null); },
    );
    return () => { live = false; };
  }, [taskId, which]);

  // spec 016 D3: one-click Copy — essential for deploy=cloud (paste into Studio → Import DSL), useful
  // for every deploy. Transient feedback; clipboard failures (e.g. denied permission) no-op.
  // ONE flash state for both copy buttons: two independent booleans would let both read "copied" at
  // once after a quick double-press, which is the one moment the label has to say which thing you took.
  const [flash, setFlash] = useState<'body' | 'path' | null>(null);
  const copy = async (what: 'body' | 'path', text: string | null): Promise<void> => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setFlash(what);
      // Guarded: a later press of the OTHER button must not have its label cleared by this timer.
      setTimeout(() => setFlash((f) => (f === what ? null : f)), 1500);
    } catch {
      /* clipboard blocked — leave the button idle */
    }
  };

  // Both location actions hang off `path`. Resolving it IS the "this exists on disk" check — the route
  // 404s otherwise — and it is the same check reveal needs, so offering Reveal without it would be
  // offering a button whose only outcome is an error banner.
  if (!path) return null;
  const pathHint = tr(which === 'folder' ? 'copyFolderPathHint' : 'copyPathHint');
  return (
    <>
      {/* Icon-only. Five labelled pills across one panel was more words than the files they act on, and
          these three repeat on every tab — the reader was re-reading the same three sentences all day.
          The name lives in `title` (the tooltip) and `aria-label` (the only name a screen reader gets,
          so it is not optional here the way it was when the label was on screen). */}
      <button className="cb-reveal" onClick={() => onReveal(which)}
        title={tr('revealInFinder')} aria-label={tr('revealInFinder')}>
        <I.folder />
      </button>
      {/* A LINK icon, not a second copy icon. The two copies sit next to each other and the labels that
          used to tell them apart are gone — two identical glyphs whose outcomes differ (a path vs. the
          whole file) is exactly the confusion spec 103 §1.5 exists to remove. A link reads as "a
          reference to where this is", which is what a path is.
          Still a .cb-reveal by class: it belongs with Finder, both answer "where is this". The tooltip
          names the action AND shows the path under it — with no label, that is the only place to read
          either. */}
      <button className={'cb-reveal' + (flash === 'path' ? ' copied' : '')}
        onClick={() => void copy('path', path)}
        title={`${pathHint}\n${path}`} aria-label={pathHint}>
        {flash === 'path' ? <I.check /> : <I.link />}
      </button>
      {contents !== null && (
        <button className={'cb-copy' + (flash === 'body' ? ' copied' : '')}
          onClick={() => void copy('body', contents)}
          title={tr('copyFileHint')} aria-label={tr('copyFileHint')}>
          {flash === 'body' ? <I.check /> : <I.copy />}
        </button>
      )}
    </>
  );
}

/** Spec 103 Lane B — while a proposal is open this tab shows the DRAFT (the backend swaps the content
 *  in `readArtifactContents`), so it must SAY so and must not offer to save: `PUT /spec` 409s during a
 *  proposal, and a Save that appeared to work would be destroyed by `apply`'s rename moments later. */
function SpecTab({ task, content, specDiff, mode, setMode, onSave, onReveal, onDecide }: {
  task: WireTask;
  content: string;
  /** The unified diff of SPEC.md for this round; drives whether the 差分 mode is offered at all. */
  specDiff: string | null;
  mode: SpecMode;
  setMode: (m: SpecMode) => void;
  onSave: (c: string) => Promise<void>;
  onReveal: (which: ArtifactFile) => void;
  onDecide?: (id: 'apply_spec' | 'changes' | 'drop_spec') => void;
}) {
  const draft = task.specRevise === true;
  const [val, setVal] = useState(content);
  const [saved, setSaved] = useState(true);
  const [saving, setSaving] = useState(false);
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

  // `specDiffState` keeps three answers apart, and they are three different sentences on screen:
  // `absent` (this build has no spec-diff at all — the mode is not offered), `unchanged` (there IS a
  // round to compare and it left the spec alone — say so), `changed` (render it).
  const specState = specDiffState(specDiff);
  const modes = specState === 'absent' ? SPEC_MODES : [...SPEC_MODES, { key: 'diff' as SpecMode, labelKey: 'specDiffMode' }];
  // A mode can stop being available under a live panel (a new round lands with no spec change). Falling
  // back at RENDER, not by writing state, keeps this a pure consequence of what exists.
  const view: SpecMode = mode === 'diff' && specState === 'absent' ? 'preview' : mode;
  const diffPane = specState === 'changed'
    ? <div className="spec-diff"><SplitDiffView file={{ path: 'SPEC.md', status: 'modified', ...diffStats(specDiff ?? ''), diff: specDiff ?? '' }} /></div>
    : <div className="spec-diff secret-note">{tr('diffSpecUnchanged')}</div>;

  return (
    <div className="spec-tab">
      <div className="art-section-title">{draft ? tr('specDraftTitle') : 'SPEC.md'} <span className="ast-line" />
        <div className="seg spec-mode">
          {modes.map((m) => (
            <button key={m.key} className={view === m.key ? 'on' : ''} onClick={() => setMode(m.key)}>{tr(m.labelKey)}</button>
          ))}
        </div>
      </div>
      {draft && <div className="secret-note" style={{ marginBottom: 8 }}>{tr('specDraftNote')}</div>}
      {content === '' && <div className="secret-note" style={{ marginBottom: 8 }}>{tr('noSpecYet')}</div>}
      {(view === 'edit' || view === 'split') && (
        <div className="spec-toolbar">
          {tools.map((t, i) => 'sep' in t
            ? <span key={i} className="stb-sep" />
            // preventDefault on mousedown keeps focus (and the selection) in the textarea while clicking.
            : <button key={i} className="stb" title={t.title} onMouseDown={(e) => e.preventDefault()} onClick={t.run}>{t.label}</button>)}
        </div>
      )}
      {/* The same card main.yml is in, with the same header: name, size, and the three file actions.
          SPEC.md is a file on disk exactly like main.yml, and a panel whose two files look like two
          different kinds of object makes you re-learn it on every tab switch. `val` (not `content`) is
          both the size and what Copy takes — an unsaved edit shows and copies what is on screen. */}
      <div className="filecard spec-card">
        <FileHeader icon={<I.doc style={{ width: 13, height: 13 }} />} name="SPEC.md"
          meta={view === 'diff' ? <DiffStat diff={specDiff ?? ''} /> : tf('mdLines', { n: val ? val.split('\n').length : 0 })}
          taskId={task.taskId} which="spec" contents={val.trim() ? val : null} onReveal={onReveal} />
        <div className="fc-body">
          {view === 'diff' ? diffPane
            : view === 'split' ? <div className="spec-split">{editor}{preview}</div>
            : view === 'preview' ? preview : editor}
        </div>
      </div>
      {/* Lane B: decide right here. Same three actions as the gate, same ids, same handlers — the gate
          is not replaced, it is duplicated at the one place the human is actually looking. The order
          and weighting mirror the gate exactly (approve primary, decline quiet) so the two doors can
          never teach different things about which button is which. */}
      {draft && onDecide && (
        <div className="spec-decide">
          <button className="btn ok" onClick={() => onDecide('apply_spec')}>
            <I.check />{tAction('Go with this')}
          </button>
          <button className="btn ghost" onClick={() => onDecide('changes')}>
            <I.message />{tAction('Change the plan')}
          </button>
          <button className="btn ghost" onClick={() => onDecide('drop_spec')}>
            <I.close />{tAction('Never mind')}
          </button>
        </div>
      )}
      <div className="spec-bar">
        {/* Lane B: no Save on a draft. `PUT /spec` 409s while a proposal is open, and a button that
            reports success before `apply`'s rename erases the write is worse than no button. */}
        <button className="btn primary" disabled={draft || saved || saving || view === 'diff'} onClick={save}
          title={draft ? tr('specDraftNote') : undefined}
          style={draft || saved ? { opacity: 0.5 } : undefined}>
          <I.save />{saving ? tr('saving') : tr('saveSpec')}
        </button>
        <span className="sb-status">
          {/* Lane B: on a DRAFT the normal status is a lie. 「保存済み・実装に反映」 claims the file is
              saved and feeding the build — but a proposal is neither: it is not the live spec, and
              nothing reaches the workflow until the human approves at the gate. Say what is true. */}
          {draft
            ? <><span className="dirty-dot" />{tr('specDraftPending')}</>
            : saved
              ? <><I.check style={{ width: 13, height: 13, color: 'var(--ok)' }} />{tr('savedFeedsImplement')}</>
              : <><span className="dirty-dot" />{tr('unsavedChanges')}</>}
        </span>
      </div>
      <div className="secret-note"><I.lock />{tr('tokenRedacted')}</div>
    </div>
  );
}

function YamlTab({ yaml, report, diff, mode, setMode, taskId, onReveal }: {
  yaml: string | null;
  report: ReportShape | null;
  /** The unified diff of main.yml for this round; drives whether the 差分 mode is offered at all. */
  diff: string | null;
  mode: YamlMode;
  setMode: (m: YamlMode) => void;
  taskId: string;
  onReveal: (which: ArtifactFile) => void;
}) {
  const lint = report?.lint;
  const linters = lint
    ? [
        { name: 'validate_workflow', code: lint.validate },
        { name: 'lint_refs', code: lint.lint_refs },
        { name: 'lint_plugin_hashes', code: lint.lint_plugin_hashes },
      ]
    : [];
  // The same two-mode row SPEC.md carries, for the same reason: "diff of what?" is answered by the tab
  // you are standing in. Offered only when this build HAS a workflow diff — `null` means there is no
  // base to compare against (a from-scratch build before its first round), which is not the same as
  // "compared and nothing moved". The render-time fallback mirrors SpecTab's.
  const hasDiff = diff !== null;
  const view: YamlMode = mode === 'diff' && !hasDiff ? 'code' : mode;
  const YAML_MODES: { key: YamlMode; labelKey: string }[] = [
    { key: 'code', labelKey: 'yamlCodeMode' },
    { key: 'diff', labelKey: 'specDiffMode' },
  ];
  return (
    <div>
      <div className="art-section-title">main.yml <span className="ast-line" />
        {hasDiff && (
          <div className="seg spec-mode">
            {YAML_MODES.map((m) => (
              <button key={m.key} className={view === m.key ? 'on' : ''} onClick={() => setMode(m.key)}>{tr(m.labelKey)}</button>
            ))}
          </div>
        )}
      </div>
      {yaml || view === 'diff' ? (
        <div className="filecard codeblock">
          <FileHeader icon={<I.yaml style={{ width: 13, height: 13 }} />} name="main.yml"
            meta={view === 'diff'
              ? <DiffStat diff={diff ?? ''} />
              : tf('yamlLines', { n: (yaml ?? '').split('\n').length })}
            taskId={taskId} which="workflow" contents={yaml} onReveal={onReveal} />
          <div className="fc-body">
            {view === 'diff'
              ? (diff && diff.trim()
                ? <SplitDiffView file={{ path: 'main.yml', status: 'modified', ...diffStats(diff), diff }} />
                : <div className="secret-note">{tr('diffWorkflowUnchanged')}</div>)
              : <pre>{yaml}</pre>}
          </div>
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

/**
 * Spec 103 step 1 — the tab answers ONE question ("what did this round change?") about TWO files.
 *
 * `SPEC.md` comes FIRST: after a fix round the human is checking whether the document still describes
 * the workflow, and the workflow diff is the part they already watched happen. A missing `specDiff`
 * means "there was no previous spec to compare with" (a first build) — that section is then absent,
 * which is a different statement from an empty diff ("the spec did not change"), and the two must not
 * render alike.
 */
function ReportTab({ report, onReveal }: { report: ReportShape | null; onReveal: (which: ArtifactFile) => void }) {
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
              <button className="rr-reveal" onClick={() => onReveal('workflow')}
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

export function ArtifactPanel({ task, tab, setTab, specMode, setSpecMode, yamlMode, setYamlMode, available, onClose, onSaveSpec, onReveal, onProposalDecide }: {
  task: WireTask;
  tab: ArtifactTab;
  setTab: (tab: ArtifactTab) => void;
  /** The two file tabs' view modes. They live in App, not here, because a gate card's 差分 link opens a
   *  tab already in diff mode, and because App's artifact refetch keys off them — entering a diff view
   *  is what switching to the old 差分 TAB used to be. */
  specMode: SpecMode;
  setSpecMode: (m: SpecMode) => void;
  yamlMode: YamlMode;
  setYamlMode: (m: YamlMode) => void;
  available: ArtifactTab[];
  onClose: () => void;
  onSaveSpec: (content: string) => Promise<void>;
  /** Reveal one of the task's two panel files (SPEC.md / the workflow YAML) in the OS file manager. */
  onReveal: (which: ArtifactFile) => void;
  /**
   * Spec 103 Lane B — decide on a spec proposal from INSIDE the panel.
   *
   * The panel is a modal with a scrim, so while it is open the gate's three buttons are physically
   * unclickable. And the gate's own card tells the human to open it ("SPEC.md を開く") — so the action
   * the UI encourages blocks the action it requires: read the plan, then hunt for buttons that are
   * behind what you are reading. Verified by hit-testing: `elementFromPoint` over 「やめる」 returned
   * the panel body.
   *
   * So the decision moves to where the evidence is, which is what spec 103 §3.9 asked for in the first
   * place. The gate keeps its buttons too — this is a second door, not a relocation.
   */
  onProposalDecide?: (id: 'apply_spec' | 'changes' | 'drop_spec') => void;
}) {
  const art: WireArtifacts = task.artifactContents ?? { spec: null, yaml: null, report: null, diff: null };
  const report = (art.report as ReportShape | null) ?? null;
  const lintWarn = report ? !(report.lint?.validate === 0 && report.lint?.lint_refs === 0 && report.lint?.lint_plugin_hashes === 0) : false;

  const allTabs: { key: ArtifactTab; label: string; icon: VNode; dot?: string }[] = [
    { key: 'spec', label: tr('tab_spec'), icon: <I.doc /> },
    { key: 'yaml', label: 'main.yml', icon: <I.yaml />, dot: report ? (lintWarn ? 'warn' : 'ok') : undefined },
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
    const sel = tocSelector(activeTab, view);
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
    const sel = tocSelector(activeTab, view);
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

  // The bytes on screen for the CURRENT tab — the fingerprint scrollMemory keys its position against,
  // and the signal that content has actually arrived (App refetches artifacts when the panel opens, so
  // the first render after a reopen is usually still empty).
  // What is actually on screen right now — which depends on the VIEW, not just the tab: reading the diff
  // of main.yml shows different bytes than reading main.yml.
  const view = activeTab === 'spec' ? specMode : activeTab === 'yaml' ? yamlMode : 'report';
  const tabLen = (view === 'diff'
    ? (activeTab === 'spec' ? art.specDiff : art.diff)
    : activeTab === 'spec' ? art.spec
    : activeTab === 'yaml' ? art.yaml
    : art.report ? JSON.stringify(art.report) : null)?.length ?? 0;
  // Keyed by VIEW too. Code and diff are two documents of different lengths, so without the view in the
  // key the `len` fingerprint would simply throw the saved position away on every switch — safe, but it
  // means losing your place in a long YAML every time you glance at its diff and come back.
  const memKey = `${task.taskId}:${activeTab}:${view}`;

  // Remember the scroll position (see scrollMemory). Passive + no state: this fires on every wheel tick.
  useEffect(() => {
    const scroller = resolveScroller();
    if (!scroller || !tabLen) return;
    const onScroll = (): void => { scrollMemory.set(memKey, { top: scroller.scrollTop, len: tabLen }); };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
    // `expanded` re-resolves the scroller: expanding changes the layout the position was measured in.
  }, [memKey, tabLen, expanded]);

  // Restore it. Deliberately waits for content (`tabLen`): assigning scrollTop to an empty box clamps to
  // 0, which is how a naive restore silently does nothing. Even with content the box can need a frame or
  // two to lay out (fonts, a wide table settling), so retry until it can actually scroll — bounded, so a
  // genuinely short artifact costs ~half a second of idle frames and never spins.
  useEffect(() => {
    const saved = scrollMemory.get(memKey);
    if (!saved || saved.top <= 0 || !tabLen) return;
    if (saved.len !== tabLen) { scrollMemory.delete(memKey); return; } // rewritten underneath — start at top
    let raf = 0;
    let tries = 0;
    const apply = (): void => {
      const scroller = resolveScroller();
      if (scroller && scroller.scrollHeight > scroller.clientHeight + 1) {
        scroller.scrollTop = saved.top; // clamps itself if the box got shorter
        return;
      }
      if (tries++ < 30) raf = requestAnimationFrame(apply);
    };
    apply();
    return () => cancelAnimationFrame(raf);
  }, [memKey, tabLen]);

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
      const sel = tocSelector(activeTab, view);
      if (sel) {
        // `i` is the index in the FULL match list — that is the address `currentTops` re-queries with,
        // so a heading skipped here for having no text must not shift the ones after it.
        [...body.querySelectorAll<HTMLElement>(sel)].forEach((el, i) => {
          const text = (el.textContent ?? '').trim();
          if (!text) return;
          found.push({ key: `d${i}`, text, level: el.tagName === 'H1' ? 1 : el.tagName === 'H3' ? 3 : 2 });
          anchors.push({ domIndex: i, line: 0 });
        });
      } else if (usesYamlAnchors(activeTab, view) && art.yaml) {
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
  }, [expanded, activeTab, view, art.spec, art.yaml, art.report, art.diff, art.specDiff, lang.value]);

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
        {/* The build's FOLDER — the thing the subtitle names. The tabs below reach the two files inside
            it; this reaches everything else the build wrote (inputs/, prompts/, tests/), which until now
            had no door at all. `contents={null}`: a directory has no text to copy, so FileActions renders
            only its two location actions. It renders nothing at all pre-scaffold, when there is no
            folder yet. */}
        <span className="fc-actions ah-actions">
          <FileActions taskId={task.taskId} which="folder" contents={null} onReveal={onReveal} />
        </span>
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
          {activeTab === 'spec' && (
            <SpecTab task={task} content={art.spec ?? ''} specDiff={art.specDiff ?? null}
              mode={specMode} setMode={setSpecMode}
              onSave={onSaveSpec} onReveal={onReveal} onDecide={onProposalDecide} />
          )}
          {activeTab === 'yaml' && <YamlTab yaml={art.yaml} report={report} diff={art.diff ?? null}
            mode={yamlMode} setMode={setYamlMode} taskId={task.taskId} onReveal={onReveal} />}
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
