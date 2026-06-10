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
import { useState, useRef, useEffect } from 'preact/hooks';
import { I } from './Icon';
import { Twist } from './Sidebar';
import { renderMarkdownHtml } from '../lib/markdown';
import type {
  PhaseStates,
  PhaseKey,
  ArtifactTab,
  Settings,
  WireTask,
  WireGateAction,
} from '../types';

const PHASE_LABELS: { key: PhaseKey; label: string }[] = [
  { key: 'analyze', label: 'Analyze' },
  { key: 'spec', label: 'Spec' },
  { key: 'implement', label: 'Implement' },
  { key: 'test', label: 'Test' },
];

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

const phaseIndex = (key: PhaseKey): number => PHASE_LABELS.findIndex((p) => p.key === key) + 1;

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
              {ph.label}
            </div>
            {i < PHASE_LABELS.length - 1 && <span className="phase-sep">·</span>}
          </Fragment>
        );
      })}
    </div>
  );
}

/* ---- disclosure: "Running ① Analyze…" / streamed output ---- */
export function Disclosure({ phaseKey, running, output }: {
  phaseKey: PhaseKey;
  running: boolean;
  output: string;
}) {
  const [open, setOpen] = useState(running);
  useEffect(() => { if (running) setOpen(true); }, [running]);
  const idx = phaseIndex(phaseKey);
  const label = running
    ? <>Running <b style={{ color: 'var(--tx-1)', fontWeight: 500 }}>{numCircle(idx)} {PHASE_LABELS[idx - 1].label}</b><span className="dots" /></>
    : <>{numCircle(idx)} {PHASE_LABELS[idx - 1].label}</>;
  const html = output.trim() ? renderMarkdownHtml(output) : '';
  return (
    <div>
      <button className="disclosure" onClick={() => setOpen((o) => !o)}>
        {running ? <span className="spin" /> : <I.checkCircle style={{ width: 14, height: 14, color: 'var(--ok)' }} />}
        <span className="disc-label">{label}</span>
        <Twist open={open} />
      </button>
      {open && html && (
        <div className="disc-detail md-stream" dangerouslySetInnerHTML={{ __html: html }} />
      )}
      {open && !html && running && (
        <div className="disc-detail"><div className="dd-line">Working…</div></div>
      )}
    </div>
  );
}

/* ---- gate card (renders the backend gate.actions[]) ---- */
interface GateView {
  tone: '' | 'warn' | 'danger' | 'error' | 'done';
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
  const meta = `phase ${idx} / 4`;
  const errLines = (t.error ?? '').split(' | ').map((s) => s.trim()).filter(Boolean);

  if (t.status === 'error') {
    return { tone: 'error', badge: 'Phase failed', title: `${PHASE_LABELS[idx - 1].label} errored`, meta: 'exit 1',
      summary: errLines.length ? errLines : ['No files were written. Retry re-runs only this phase from the approved input.'] };
  }
  if (t.status === 'cancelled') {
    return { tone: 'error', badge: 'Cancelled', title: 'Build abandoned', meta, summary: ['Cancelled by user — the spec/artifacts so far are preserved.'] };
  }
  if (t.status === 'done') {
    return { tone: 'done', badge: 'Done', title: 'Test passed — workflow updated', meta: 'phase 4 / 4',
      summary: ['Linters re-run on the produced main.yml.', 'Open the report in the panel for the details.'], showReportLink: true };
  }
  // awaiting_confirm
  if (t.gate?.flag === 'still_failing') {
    return { tone: 'warn', badge: 'Lint still failing', title: 'Still failing after the cap-5 attempts', meta,
      summary: errLines.length ? errLines : ['The agent self-corrected as far as it could in one turn.', 'Your call: accept anyway, keep trying, or abandon.'],
      showDiffLink: true };
  }
  switch (t.phase) {
    case 'analyze':
      return { tone: '', badge: 'Analyze complete', title: 'Ready to write the spec', meta,
        summary: ['Requirement analyzed.', 'Continue to draft the spec, or request changes.'] };
    case 'spec':
      return { tone: '', badge: 'Spec ready', title: 'Spec drafted — review before I build', meta,
        summary: ['SPEC.md is editable in the panel — tweak it before implement (last-writer wins).'], showSpecLink: true };
    case 'implement':
      return { tone: '', badge: 'Implemented', title: 'main.yml built and linted', meta,
        summary: ['Workflow YAML generated; all linters green.'], showDiffLink: true };
    default:
      return { tone: '', badge: 'Ready', title: 'Continue', meta, summary: [] };
  }
}

export function GateCard({ task, resolved, busy, onConfirm, onReply, onCancel, onOpenArtifact }: {
  task: WireTask;
  resolved?: string;
  busy?: boolean;
  onConfirm: (action: WireGateAction, extra?: { slug?: string; name?: string }) => void;
  onReply: (text: string) => void;
  onCancel: (action: WireGateAction) => void;
  onOpenArtifact: (tab: ArtifactTab) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [reply, setReplyText] = useState('');
  const v = gateView(task);
  const actions = task.gate?.actions ?? [];
  const tone = v.tone ? ' tone-' + v.tone : '';
  const badgeIcon = v.tone === 'error' ? <I.alert /> : v.tone === 'warn' ? <I.warn />
    : v.tone === 'danger' ? <I.lock /> : v.tone === 'done' ? <I.checkCircle /> : <I.spark />;

  const replyAction = actions.find((a) => a.kind === 'reply');

  const btnClass = (a: WireGateAction): string => {
    if (a.kind === 'cancel') return 'ghost';
    if (a.kind === 'reply') return 'ghost';
    if (task.gate?.flag === 'still_failing') return 'warn'; // "Accept anyway"
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
            <button className="gs-link" style={{ marginLeft: 0 }} onClick={() => onOpenArtifact('spec')}><I.doc />open SPEC.md</button>
          )}
          {v.showDiffLink && (
            <>
              <button className="gs-link" style={{ marginLeft: 0 }} onClick={() => onOpenArtifact('yaml')}><I.yaml />main.yml</button>
              <button className="gs-link" onClick={() => onOpenArtifact('diff')}><I.diff />view diff</button>
            </>
          )}
          {v.showReportLink && (
            <button className="gs-link" style={{ marginLeft: 0 }} onClick={() => onOpenArtifact('report')}><I.report />open report</button>
          )}
        </div>
      )}

      {resolved ? (
        <div className="gate-foot" style={{ background: 'transparent' }}>
          <span className="secret-note" style={{ color: 'var(--ok)', padding: 0 }}>
            <I.check style={{ width: 13, height: 13 }} />{resolved}
          </span>
        </div>
      ) : replying && replyAction ? (
        <div className="gate-reply">
          <textarea autoFocus placeholder="What should change before continuing?"
            value={reply} onChange={(e) => setReplyText(e.currentTarget.value)}
          />
          <div className="gr-actions">
            <button className="btn ghost" onClick={() => { setReplying(false); setReplyText(''); }}>Cancel</button>
            <button className="btn primary" disabled={!reply.trim()}
              onClick={() => { onReply(reply); setReplying(false); setReplyText(''); }}>
              <I.arrowUp style={{ width: 13, height: 13 }} />Send &amp; re-run
            </button>
          </div>
        </div>
      ) : actions.length > 0 ? (
        <div className="gate-foot">
          {actions.map((a) => {
            if (a.kind === 'reply') {
              return <button key={a.id} className="btn ghost" disabled={busy} onClick={() => setReplying(true)}><I.message />{a.label}</button>;
            }
            if (a.kind === 'cancel') {
              return <button key={a.id} className="btn ghost" disabled={busy} onClick={() => onCancel(a)}>{a.label}</button>;
            }
            return (
              <button key={a.id} className={'btn ' + btnClass(a)} disabled={busy} onClick={() => onConfirm(a)}>
                {task.gate?.flag === 'still_failing' ? <I.check /> : <I.check />}{a.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ---- setting dropdown (below-input run settings, AC #14) ---- */
function SettingSelect({ icon, label, value, options, onChange, mono }: {
  icon?: VNode;
  label: string;
  value: string;
  options: { v: string; l: string }[];
  onChange: (v: string) => void;
  mono?: boolean;
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
    <div className="setting-select" ref={ref} style={{ position: 'relative' }}>
      <button className={'setting-chip' + (mono ? ' mono' : '')} onClick={() => setOpen((o) => !o)} type="button">
        {icon}<span className="sc-key">{label}:</span>
        <span className="sc-val">{sel ? sel.l : value}</span>
        <Twist open={open} />
      </button>
      {open && (
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
export function Composer({ value, onChange, onSend, settings, onSettings, workflows, placeholder, disabled }: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  /** existing workflow slugs from /api/tree, lazily lists in the Workflow dropdown (AC #14). */
  workflows?: string[];
  placeholder: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }, [value]);
  const ready = value.trim().length > 0 && !disabled;
  const onKeyDown: JSX.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (ready) onSend(); }
  };

  const workflowOpts = [{ v: 'none', l: 'none (new)' }, ...(workflows ?? []).map((w) => ({ v: w, l: w }))];

  return (
    <div className="composer">
      <textarea ref={ref} className="composer-input" rows={1}
        placeholder={placeholder} value={value} disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <div className="composer-row">
        <SettingSelect mono icon={<I.sliders style={{ width: 12, height: 12 }} />} label="Workflow"
          value={settings.workflow} options={workflowOpts} onChange={(v) => onSettings({ workflow: v })} />
        <SettingSelect label="Confirm" value={settings.confirm}
          options={[{ v: 'each step', l: 'each step' }, { v: 'spec only', l: 'spec only' }, { v: 'auto', l: 'auto' }]}
          onChange={(v) => onSettings({ confirm: v })} />
        <SettingSelect label="Deploy" value={settings.deploy}
          options={[{ v: 'none', l: 'none' }, { v: 'selfhost', l: 'selfhost' }, { v: 'cloud', l: 'cloud' }]}
          onChange={(v) => onSettings({ deploy: v })} />
        <span className="spacer" />
        <button className={'composer-send' + (ready ? ' ready' : '')} onClick={() => { if (ready) onSend(); }} disabled={!ready}>
          <I.arrowUp />
        </button>
      </div>
    </div>
  );
}
