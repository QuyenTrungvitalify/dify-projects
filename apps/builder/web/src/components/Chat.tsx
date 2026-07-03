/* ============================================================
   Chat.tsx — phase track · run disclosure · gate cards · composer.
   DESIGN OVERRIDE: the visual shell (classes/markup) is the design's
   surface-blocks; the LOGIC is live (lat4-ui). PhaseTrack reads the
   store's derived phaseStates; Disclosure shows the streamed Claude
   output (slim markdown renderer); GateCard renders the backend's
   gate.actions[] (AC #16) and the Composer puts the 3 run-settings
   BELOW the input (AC #14) — no model/pattern picker.
   ============================================================ */
import { Fragment } from 'preact';
import type { JSX, VNode } from 'preact';
import { useState, useRef, useEffect, useMemo } from 'preact/hooks';
import { I } from './Icon';
import { Twist } from './Sidebar';
import { renderMarkdownHtml } from '../lib/markdown';
import { PHASE_LABELS, phaseIndex, phaseLabelAt } from '../lib/phase';
import { t as tr, tf, phaseLabel, tAction } from '../lib/i18n';
import {
  type ComposerAttachment,
  ACCEPTED_IMAGE_MIME,
  ACCEPTED_EXT,
  isImageMime,
} from '../lib/attachments';
import type {
  PhaseStates,
  PhaseKey,
  ArtifactTab,
  Settings,
  WireTask,
  WireGateAction,
} from '../types';

/* render text with <c>mono</c> chips (kept for any chip-bearing summary line) */
export function richText(str: string): (VNode | string)[] {
  const parts = String(str).split(/(<c>.*?<\/c>)/g);
  return parts.map((p, i) => {
    const m = p.match(/^<c>(.*?)<\/c>$/);
    if (m) return <span key={i} className="mchip">{m[1]}</span>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

export function numCircle(n: number): string {
  return ['①', '②', '③', '④'][n - 1] || String(n);
}

/* ---- phase indicator ---- */
export function PhaseTrack({ phaseStates, current }: { phaseStates: PhaseStates; current: PhaseKey | null }) {
  return (
    <div className="phase-track">
      {PHASE_LABELS.map((ph, i) => {
        const st = phaseStates[ph.key];
        const cls = st === 'done' ? 'done'
          : st === 'error' ? 'error'
          : (ph.key === current && (st === 'running' || st === 'awaiting')) ? 'active'
          : '';
        return (
          <Fragment key={ph.key}>
            <div className={'phase-step ' + cls}>
              <span className="phase-num">
                {st === 'done' ? <I.check style={{ width: 11, height: 11 }} /> : (i + 1)}
              </span>
              {phaseLabel(ph.key)}
            </div>
            {i < PHASE_LABELS.length - 1 && <span className="phase-sep">·</span>}
          </Fragment>
        );
      })}
    </div>
  );
}

/* ---- disclosure: "Running ① Analyze…" / "Stopped during ① Analyze" / streamed output ---- */
export function Disclosure({ phaseKey, running, output, stopped }: {
  phaseKey: PhaseKey;
  running: boolean;
  output: string;
  /** the phase's turn was cancelled mid-flight — muted "Stopped during …" + alert icon (design handoff). */
  stopped?: boolean;
}) {
  const [open, setOpen] = useState(running);
  useEffect(() => { if (running) setOpen(true); }, [running]);
  const idx = phaseIndex(phaseKey);
  const phLabel = phaseLabel(phaseLabelAt(idx));
  const label = running
    ? <>{tr('running')} <b style={{ color: 'var(--tx-1)', fontWeight: 500 }}>{numCircle(idx)} {phLabel}</b><span className="dots" /></>
    : stopped
      ? <>{tr('stoppedDuring')} <b style={{ color: 'var(--tx-2)', fontWeight: 500 }}>{numCircle(idx)} {phLabel}</b></>
      : <>{numCircle(idx)} {phLabel}</>;
  // D6 (017): memoize the markdown render on the buffer so an unrelated re-render (another thread
  // item, a sibling signal) doesn't re-parse the whole accumulated output. Byte-identical HTML.
  const html = useMemo(() => (output.trim() ? renderMarkdownHtml(output) : ''), [output]);
  return (
    <div>
      <button className="disclosure" onClick={() => setOpen((o) => !o)}>
        {running ? <span className="spin" />
          : stopped ? <I.alert style={{ width: 14, height: 14, color: 'var(--tx-faint)' }} />
          : <I.checkCircle style={{ width: 14, height: 14, color: 'var(--ok)' }} />}
        <span className="disc-label">{label}</span>
        <Twist open={open} />
      </button>
      {open && html && (
        <div className="disc-detail md-stream" dangerouslySetInnerHTML={{ __html: html }} />
      )}
      {open && !html && running && (
        <div className="disc-detail"><div className="dd-line">{tr('working')}</div></div>
      )}
    </div>
  );
}

/* ---- gate card (renders the backend gate.actions[]) ---- */
interface GateView {
  tone: '' | 'warn' | 'danger' | 'error' | 'done' | 'deploy';
  badge: string;
  title: string;
  meta: string;
  summary: string[];
  showSpecLink?: boolean;
  showReportLink?: boolean;
  showDiffLink?: boolean;
}

/** Synthesize the gate's presentational copy from the live task (the backend sends only actions). */
function gateView(t: WireTask): GateView {
  const idx = phaseIndex(t.phase as PhaseKey);
  const meta = tf('phaseMeta', { idx });
  const errLines = (t.error ?? '').split(' | ').map((s) => s.trim()).filter(Boolean);

  if (t.status === 'error') {
    return { tone: 'error', badge: tr('gateErrorBadge'), title: tf('gateErroredTitle', { phase: phaseLabel(phaseLabelAt(idx)) }), meta: tr('exit1'),
      summary: errLines.length ? errLines : [tr('gateErrorSummary')] };
  }
  if (t.status === 'cancelled') {
    return { tone: 'error', badge: tr('gateCancelledBadge'), title: tr('gateCancelledTitle'), meta, summary: [tr('gateCancelledSummary')] };
  }
  if (t.status === 'done') {
    return { tone: 'done', badge: tr('gateDoneBadge'), title: tr('gateDoneTitle'), meta: tr('phaseMeta4'),
      summary: [tr('gateDoneSummary1'), tr('gateDoneSummary2')], showReportLink: true };
  }
  // F4 (spec 010): the slug-collision note rides on the task from the Spec-gate scaffold → surface it
  // (once) at the Implement gate, leading the summary, so the user sees the rename before continuing.
  const slugLine = (lines: string[]): string[] => (t.slugNote ? [t.slugNote, ...lines] : lines);
  // awaiting_confirm
  if (t.gate?.flag === 'still_failing') {
    return { tone: 'warn', badge: tr('gateFailBadge'), title: tr('gateFailTitle'), meta,
      summary: slugLine(errLines.length ? errLines : [tr('gateFailSummary1'), tr('gateFailSummary2')]),
      showDiffLink: true };
  }
  // D1 (spec 016): the deploy gate. After 014 D1 EVERY selfhost build (incl. auto/spec_only) parks here
  // with the `awaiting_import` flag — name the target + explain Import vs Skip so the card isn't blank.
  if (t.gate?.flag === 'awaiting_import') {
    const summary = [tr('gateImportSummary1'), tr('gateImportSummary2'), tr('gateImportSummary3')];
    if (t.workflow) summary.push(tf('gateImportSummaryEdit', { workflow: t.workflow })); // edit-existing footgun
    return { tone: 'deploy', badge: tr('gateImportBadge'),
      title: tf('gateImportTitle', { file: t.workflowFile }),
      meta, summary, showReportLink: true };
  }
  // spec 032: the live-test verdict gate — show the verdict, the auto-filled model, an output preview,
  // and the app link so the human can judge the real result (never auto-passed).
  if (t.gate?.flag === 'test_result') {
    const lt = t.liveTest;
    const pass = lt?.verdict === 'passed';
    const summary: string[] = [];
    if (lt?.reason) summary.push(lt.reason);
    if (lt?.model) summary.push(tf('gateLiveModel', { model: lt.model.name, n: String(lt.modelAutofilled ?? 0) }));
    if (lt?.output != null) {
      const out = typeof lt.output === 'string' ? lt.output : JSON.stringify(lt.output);
      summary.push(tf('gateLiveOutput', { out: out.length > 400 ? out.slice(0, 400) + '…' : out }));
    }
    if (lt?.appUrl) summary.push(tf('gateLiveApp', { url: lt.appUrl }));
    return { tone: pass ? 'done' : 'warn', badge: pass ? tr('gateLivePassBadge') : tr('gateLiveFailBadge'),
      title: pass ? tr('gateLivePassTitle') : tr('gateLiveFailTitle'), meta, summary, showReportLink: true };
  }
  // spec 032 D1c: live couldn't run for an infra reason — the static lint result stands.
  if (t.gate?.flag === 'infra_degraded') {
    const lt = t.liveTest;
    return { tone: 'warn', badge: tr('gateLiveInfraBadge'), title: tr('gateLiveInfraTitle'), meta,
      summary: [lt?.reason ?? tr('gateLiveInfraSummary'), tr('gateLiveStaticStands')], showReportLink: true };
  }
  switch (t.phase) {
    case 'analyze': {
      // O2 (spec 019): surface the chosen pattern + any pattern-coverage advisory at the Analyze gate.
      const lines = [tr('gateAnalyzeSummary1'), tr('gateAnalyzeSummary2')];
      if (t.patternAdvisory) lines.unshift(t.patternAdvisory);
      if (t.analysisPattern) lines.unshift(tf('gatePattern', { pattern: t.analysisPattern }));
      return { tone: '', badge: tr('gateAnalyzeBadge'), title: tr('gateAnalyzeTitle'), meta, summary: lines };
    }
    case 'spec': {
      // spec 028 §5: a fast build's auto+guard hard-stop surfaces its review note leading the summary,
      // so the human sees "non-trivial shape — review" before confirming the (possibly under-built) spec.
      const lines = [tr('gateSpecSummary1')];
      if (t.fastReviewNote) lines.unshift(t.fastReviewNote);
      return { tone: t.fastReviewNote ? 'warn' : '', badge: tr('gateSpecBadge'), title: tr('gateSpecTitle'), meta,
        summary: lines, showSpecLink: true };
    }
    case 'implement':
      return { tone: '', badge: tr('gateImplBadge'), title: tr('gateImplTitle'), meta,
        summary: slugLine([tr('gateImplSummary1')]), showDiffLink: true };
    default:
      return { tone: '', badge: tr('gateReadyBadge'), title: tr('gateReadyTitle'), meta, summary: [] };
  }
}

export function GateCard({ task, resolved, busy, onConfirm, onReply, onCancel, onRestore, onOpenArtifact }: {
  task: WireTask;
  resolved?: string;
  busy?: boolean;
  onConfirm: (action: WireGateAction, extra?: { slug?: string; name?: string }) => void;
  /** `label` is the chosen reply action's English label (Edit spec / Keep trying / Request changes) so
   *  the resolved gate reads true instead of a generic "Requested changes" (spec 016 D4). */
  onReply: (text: string, label: string) => void;
  onCancel: (action: WireGateAction) => void;
  onRestore?: () => void;
  onOpenArtifact: (tab: ArtifactTab) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [reply, setReplyText] = useState('');
  const v = gateView(task);
  const actions = task.gate?.actions ?? [];
  const tone = v.tone ? ' tone-' + v.tone : '';
  const badgeIcon = v.tone === 'error' ? <I.alert /> : v.tone === 'warn' ? <I.warn />
    : v.tone === 'danger' ? <I.lock /> : v.tone === 'done' ? <I.checkCircle />
    : v.tone === 'deploy' ? <I.external /> : <I.spark />;

  const replyAction = actions.find((a) => a.kind === 'reply');

  const btnClass = (a: WireGateAction): string => {
    if (a.kind === 'cancel') return 'ghost';
    if (a.kind === 'reply') return 'ghost';
    if (task.gate?.flag === 'still_failing') return 'warn'; // "Accept anyway"
    // D4 (spec 016): at the deploy gate, Import is the one primary (green) button; Skip is a quiet
    // secondary so the irreversible push isn't a coin-flip between two identical green buttons.
    if (task.gate?.flag === 'awaiting_import' && a.id === 'skip_import') return 'ghost';
    return 'ok';
  };

  return (
    <div className={'gate' + tone}>
      <div className="gate-head">
        <span className="gate-badge">{badgeIcon}{v.badge}</span>
        <span className="gate-title">{v.title}</span>
        <span className="gate-meta">{v.meta}</span>
      </div>

      {v.summary.length > 0 && (
        <div className="gate-body">
          <ul className="gate-list">
            {v.summary.map((s, i) => <li key={i}>{richText(s)}</li>)}
          </ul>
        </div>
      )}

      {(v.showSpecLink || v.showReportLink || v.showDiffLink) && (
        <div className="gate-strip" style={{ background: 'transparent', border: 'none', paddingTop: 0 }}>
          {v.showSpecLink && (
            <button className="gs-link" style={{ marginLeft: 0 }} onClick={() => onOpenArtifact('spec')}><I.doc />{tr('openSpec')}</button>
          )}
          {v.showDiffLink && (
            <>
              <button className="gs-link" style={{ marginLeft: 0 }} onClick={() => onOpenArtifact('yaml')}><I.yaml />main.yml</button>
              <button className="gs-link" onClick={() => onOpenArtifact('diff')}><I.diff />{tr('viewDiff')}</button>
            </>
          )}
          {v.showReportLink && (
            <button className="gs-link" style={{ marginLeft: 0 }} onClick={() => onOpenArtifact('report')}><I.report />{tr('openReport')}</button>
          )}
        </div>
      )}

      {resolved ? (
        <div className="gate-foot" style={{ background: 'transparent' }}>
          <span className="secret-note" style={{ color: 'var(--ok)', padding: 0 }}>
            <I.check style={{ width: 13, height: 13 }} />{tAction(resolved)}
          </span>
        </div>
      ) : replying && replyAction ? (
        <div className="gate-reply">
          <textarea autoFocus placeholder={tr('phWhatShouldChange')}
            value={reply} onChange={(e) => setReplyText(e.currentTarget.value)}
          />
          <div className="gr-actions">
            <button className="btn ghost" onClick={() => { setReplying(false); setReplyText(''); }}>{tr('cancel')}</button>
            <button className="btn primary" disabled={!reply.trim()}
              onClick={() => { onReply(reply, replyAction.label); setReplying(false); setReplyText(''); }}>
              <I.arrowUp style={{ width: 13, height: 13 }} />{tr('sendRerun')}
            </button>
          </div>
        </div>
      ) : task.status === 'cancelled' && onRestore ? (
        <div className="gate-foot">
          <button className="btn ghost" disabled={busy} onClick={() => onRestore()}>
            <I.undo />{tr('restoreBuild')}
          </button>
        </div>
      ) : actions.length > 0 ? (
        <div className="gate-foot">
          {actions.map((a) => {
            if (a.kind === 'reply') {
              return <button key={a.id} className="btn ghost" disabled={busy} onClick={() => setReplying(true)}><I.message />{tAction(a.label)}</button>;
            }
            if (a.kind === 'cancel') {
              return <button key={a.id} className="btn ghost" disabled={busy} onClick={() => onCancel(a)}>{tAction(a.label)}</button>;
            }
            return (
              <button key={a.id} className={'btn ' + btnClass(a)} disabled={busy} onClick={() => onConfirm(a)}>
                {task.gate?.flag === 'awaiting_import' && a.id === 'import' ? <I.external /> : <I.check />}{tAction(a.label)}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ---- setting dropdown (below-input run settings, AC #14) ---- */
function SettingSelect({ icon, label, value, options, onChange, mono, shrink, disabled, title }: {
  icon?: VNode;
  label: string;
  value: string;
  options: { v: string; l: string }[];
  onChange: (v: string) => void;
  mono?: boolean;
  /** The one chip allowed to shrink+truncate on a full row (the workflow slug). Fixed-label chips omit
   *  it so they hold their natural width and never clip, keeping attach/send on the same row. */
  shrink?: boolean;
  /** F2 (spec 010): a read-only chip (Workflow/Deploy in conversation view — start-bound, not patchable). */
  disabled?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const sel = options.find((o) => o.v === value);
  return (
    <div className={'setting-select' + (shrink ? ' shrink' : '')} ref={ref} style={{ position: 'relative' }}>
      <button className={'setting-chip' + (mono ? ' mono' : '') + (disabled ? ' disabled' : '')}
        onClick={() => { if (!disabled) setOpen((o) => !o); }} type="button"
        disabled={disabled} title={disabled ? (title ?? tr('setAtStart')) : undefined}>
        {icon}<span className="sc-key">{label}:</span>
        <span className="sc-val">{sel ? sel.l : value}</span>
        {!disabled && <Twist open={open} />}
      </button>
      {open && !disabled && (
        <div className="setting-menu">
          {options.map((o) => (
            <button key={o.v} type="button" className={'setting-opt' + (o.v === value ? ' on' : '')}
              onClick={() => { onChange(o.v); setOpen(false); }}>
              {o.l}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- composer (shared empty + dock); 3 settings BELOW the input (AC #14) ---- */
/** The composer's `<input accept>` allowlist — image MIME + the non-image extensions (spec 025 D1),
 *  built from the shared constants so it can't drift from the validator. */
const ACCEPT_ATTR = [...ACCEPTED_IMAGE_MIME, ...[...ACCEPTED_EXT].map((e) => `.${e}`)].join(',');

export function Composer({ value, onChange, onSend, settings, onSettings, workflows, placeholder, disabled, lockStartBound, lockConfirm, files, onAddFiles, onRemoveFile }: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  /** spec 030: existing workflows from /api/tree as `{ v: 'project/workflow', l: 'Project / Workflow' }`
   *  (project-qualified — the same name can exist in several projects). Lists in the Workflow dropdown (AC #14). */
  workflows?: { v: string; l: string }[];
  placeholder: string;
  disabled?: boolean;
  /** F2 (spec 010): conversation view — Workflow + Deploy are start-bound (read-only); only Confirm is
   *  live-patchable. In the empty view all three are editable (they feed the next build). */
  lockStartBound?: boolean;
  /** F2 (spec 010): also freeze the Confirm chip while the live build's turn is RUNNING — a patch then
   *  would 409 (the backend rejects it; the in-memory orchestrator can't honor it). Editable once parked. */
  lockConfirm?: boolean;
  /** spec 012/025: file attachments held by the parent (App). Absent → the attach affordance is hidden. */
  files?: ComposerAttachment[];
  onAddFiles?: (files: File[]) => void;
  onRemoveFile?: (id: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  // Auto-grow the textarea to fit its content. `autosize` resets height then reads scrollHeight.
  // We call it on every `input` (live — incl. mid-IME composition) so the box grows AS you wrap,
  // AND on value/resize changes, since soft-wrapping (line count → height) depends on width.
  const autosize = () => {
    const el = ref.current; if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  };
  useEffect(() => {
    autosize();
    window.addEventListener('resize', autosize);
    return () => window.removeEventListener('resize', autosize);
  }, [value]);
  const ready = value.trim().length > 0 && !disabled;
  const onKeyDown: JSX.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    // IME guard: while composing (e.g. picking a kanji from the JP candidate list),
    // Enter confirms the candidate — it must NOT submit. `isComposing` is the standard
    // signal; keyCode 229 covers Safari/older IMEs that don't set it (spec: JP input).
    if (e.isComposing || (e as unknown as { keyCode: number }).keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (ready) onSend(); }
  };

  // spec 012/025: the attach affordance is active only when the parent wired a handler and input is enabled.
  const canAttach = !!onAddFiles && !disabled;
  const takeFiles = (list: FileList | null | undefined): void => {
    const dropped = Array.from(list ?? []); // local name avoids shadowing the `files` prop (the chips)
    if (dropped.length && onAddFiles) onAddFiles(dropped);
  };
  const onPaste: JSX.ClipboardEventHandler<HTMLTextAreaElement> = (e) => {
    const pasted = e.clipboardData?.files;
    if (canAttach && pasted && pasted.length) { e.preventDefault(); takeFiles(pasted); }
  };
  const onDrop: JSX.DragEventHandler<HTMLDivElement> = (e) => {
    if (!canAttach) return;
    e.preventDefault(); setDragOver(false);
    takeFiles(e.dataTransfer?.files);
  };
  const onDragOver: JSX.DragEventHandler<HTMLDivElement> = (e) => {
    if (!canAttach || !Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
    e.preventDefault(); setDragOver(true);
  };

  const workflowOpts = [{ v: 'none', l: tr('noneNew') }, ...(workflows ?? [])];
  const atts = files ?? [];

  return (
    <div className={'composer' + (dragOver ? ' drag-over' : '')}
      onDrop={onDrop} onDragOver={onDragOver} onDragLeave={() => setDragOver(false)}>
      {dragOver && (
        <div className="composer-drop-hint"><I.paperclip />{tr('dropFiles')}</div>
      )}
      {atts.length > 0 && (
        <div className="composer-attachments">
          {atts.map((att) => (
            <div key={att.id} className="img-chip" title={att.name}>
              {/* spec 025: an image shows its thumbnail; a PDF/text file shows a generic doc icon. */}
              {isImageMime(att.mime) ? (
                <img src={att.dataUrl} alt={att.name} />
              ) : (
                <span className="ic-file"><I.doc /></span>
              )}
              <span className="ic-name">{att.name}</span>
              <button className="ic-rm" type="button" aria-label={tr('removeFile')} title={tr('removeFile')}
                onClick={() => onRemoveFile?.(att.id)}>
                <I.close />
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea ref={ref} className="composer-input" rows={1}
        placeholder={placeholder} value={value} disabled={disabled}
        /* preact maps onChange → the native `change` event (fires on blur, not per keystroke),
           so the value must commit on `input` — otherwise `ready`/autosize only update on blur. */
        onInput={(e) => { onChange(e.currentTarget.value); autosize(); }}
        onKeyDown={onKeyDown} onPaste={onPaste}
      />
      <div className="composer-row">
        <SettingSelect mono shrink icon={<I.sliders style={{ width: 12, height: 12 }} />} label={tr('workflow')}
          value={settings.workflow} options={workflowOpts} onChange={(v) => onSettings({ workflow: v })}
          disabled={lockStartBound} title={tr('workflowFixed')} />
        <SettingSelect label={tr('confirm')} value={settings.confirm}
          options={[{ v: 'each step', l: tr('eachStep') }, { v: 'spec only', l: tr('specOnly') }, { v: 'auto', l: tr('auto') }]}
          onChange={(v) => onSettings({ confirm: v })}
          disabled={lockConfirm} title={tr('confirmModeHint')} />
        <SettingSelect label={tr('deploy')} value={settings.deploy}
          options={[{ v: 'none', l: tr('none') }, { v: 'selfhost', l: tr('selfhost') }, { v: 'cloud', l: tr('cloud') }]}
          onChange={(v) => onSettings({ deploy: v })}
          disabled={lockStartBound} title={tr('deployFixed')} />
        {/* spec 028: ⚡ Fast build — start-bound (like deploy) and only for a from-scratch build
            (disabled when an existing workflow is chosen; the backend also force-offs on seed/slug). */}
        <SettingSelect label={tr('fast')} value={settings.fast ? 'on' : 'off'}
          options={[{ v: 'off', l: tr('fastOff') }, { v: 'on', l: tr('fastOn') }]}
          onChange={(v) => onSettings({ fast: v === 'on' })}
          disabled={lockStartBound || settings.workflow !== 'none'} title={tr('fastHint')} />
        {/* spec 032: ④ test mode — start-bound, selfhost-only (backend force-offs to static otherwise). */}
        <SettingSelect label={tr('testMode')} value={settings.deploy === 'selfhost' ? (settings.test ?? 'static') : 'static'}
          options={[{ v: 'static', l: tr('testStatic') }, { v: 'live', l: tr('testLive') }]}
          onChange={(v) => onSettings({ test: v })}
          disabled={lockStartBound || settings.deploy !== 'selfhost'} title={tr('testHint')} />
        <span className="spacer" />
        {onAddFiles && (
          <>
            <input ref={fileRef} type="file" accept={ACCEPT_ATTR} multiple
              style={{ display: 'none' }}
              onChange={(e) => { takeFiles(e.currentTarget.files); e.currentTarget.value = ''; }} />
            <button className="composer-attach" type="button" disabled={!canAttach}
              aria-label={tr('attachFile')} title={tr('attachFile')}
              onClick={() => fileRef.current?.click()}>
              <I.paperclip />
            </button>
          </>
        )}
        <button className={'composer-send' + (ready ? ' ready' : '')} onClick={() => { if (ready) onSend(); }} disabled={!ready}>
          <I.arrowUp />
        </button>
      </div>
    </div>
  );
}
