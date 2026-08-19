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
import { replyButtonKind, terminalFootActions } from '../lib/gate-foot';
import type { ComposerIntent } from '../lib/composer-route';
import { t as tr, tf, phaseLabel, tAction, localizeNotes } from '../lib/i18n';
import {
  type ComposerAttachment,
  ACCEPTED_IMAGE_MIME,
  ACCEPTED_EXT,
  isImageMime,
} from '../lib/attachments';
import { MODEL_OPTIONS, type ThreadAttachment } from '../store';
import type {
  PhaseStates,
  PhaseKey,
  ArtifactTab,
  Settings,
  WireTask,
  WireGateAction,
  WirePhaseCost,
} from '../types';
import { devMode, askCostLine } from '../lib/dev';

/* Bare http(s) URL matcher — mirrors the markdown renderer's autolink: the body excludes brackets/
   quotes and the final char drops trailing sentence punctuation so `see http://x.` links `http://x`. */
const URL_RE = /https?:\/\/[^\s<>()[\]{}"']+[^\s<>()[\]{}"'.,;:!?]/gi;

/** Split a plain-text segment into text + clickable new-tab anchors for any bare URL it contains.
 *  The input is plain text (JSX escapes it on render; href is set as a prop → no injection). */
function linkify(text: string, keyBase: string): (VNode | string)[] {
  const out: (VNode | string)[] = [];
  let last = 0;
  let n = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const url = m[0];
    out.push(
      <a key={`${keyBase}-l${n++}`} className="out-link" href={url} target="_blank" rel="noopener noreferrer">{url}</a>,
    );
    last = m.index + url.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* render text with <c>mono</c> chips (kept for any chip-bearing summary line); bare URLs in the
   plain-text segments are autolinked so a model-emitted `app: http://…` is one click away. */
export function richText(str: string): (VNode | string)[] {
  const parts = String(str).split(/(<c>.*?<\/c>)/g);
  const out: (VNode | string)[] = [];
  parts.forEach((p, i) => {
    if (!p) return;
    const m = p.match(/^<c>(.*?)<\/c>$/);
    if (m) { out.push(<span key={i} className="mchip">{m[1]}</span>); return; }
    out.push(...linkify(p, `t${i}`));
  });
  return out;
}

export function numCircle(n: number): string {
  return ['①', '②', '③', '④'][n - 1] || String(n);
}

/** A gate-summary line that jams a "; "-separated list into one bullet (the readiness/setup note, the
 *  lint-failure list) reads as one wall of text. Split on "; " → one item per line (a soft break inside
 *  the bullet). A line with no "; " renders unchanged (single richText call). */
export function summaryLineParts(s: string): (VNode | string)[] {
  const parts = s.split('; ');
  if (parts.length < 2) return richText(s);
  return parts.flatMap((p, i) => (i === 0 ? richText(p) : [<br key={`br${i}`} />, ...richText(p)]));
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
export function Disclosure({ phaseKey, running, output, stopped, promote, cost, open: openInitially }: {
  phaseKey: PhaseKey;
  running: boolean;
  output: string;
  /** Start expanded. Set by NOTICES that ride the `run` shape (spec 099 S1's "restored from disk" line,
   *  the "N earlier attempts not shown" line): a notice nobody opens has not disclosed anything, and
   *  collapsed it is indistinguishable from a phase's own output. Real phase runs leave it unset. */
  open?: boolean;
  /** spec 059-shaped cost of the turn(s) behind THIS run — dev-only, and per run rather than per phase,
   *  so three fix rounds read as three different numbers instead of the newest one three times. */
  cost?: WirePhaseCost;
  /** the phase's turn was cancelled mid-flight — muted "Stopped during …" + alert icon (design handoff). */
  stopped?: boolean;
  /** spec 052: a `kind:'promote'` task does NOT run the ①②③④ FSM — its single turn is the distillation.
   *  Label it "Distillation", never "④ Test" (promote tasks carry phase:'test' as a default). */
  promote?: boolean;
}) {
  const [open, setOpen] = useState(running || !!openInitially);
  useEffect(() => { if (running) setOpen(true); }, [running]);
  const idx = phaseIndex(phaseKey);
  const phLabel = phaseLabel(phaseLabelAt(idx));
  const step = promote ? <>{tr('distillStep')}</> : <>{numCircle(idx)} {phLabel}</>;
  const label = running
    ? <>{tr('running')} <b style={{ color: 'var(--tx-1)', fontWeight: 500 }}>{step}</b><span className="dots" /></>
    : stopped
      ? <>{tr('stoppedDuring')} <b style={{ color: 'var(--tx-2)', fontWeight: 500 }}>{step}</b></>
      : <>{step}</>;
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
      {/* Same meter as an answer's, same reasons — but on a build turn, where the money actually is:
          a single implement round was measured at $6.61, and a per-phase table sums the rounds into one
          cell where the expensive one disappears. Shown once the run has settled. */}
      {!running && devMode && askCostLine(cost) && <div className="qa-devcost">{askCostLine(cost)}</div>}
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
  /** spec 052: open the staged/promoted pattern YAML (the review gate's "view pattern" link). */
  showYamlLink?: boolean;
}

/** spec 052 — the `kind:'promote'` build's gate copy (blocked / distill-failed / review / done / error).
 *  Fully owns rendering for a promote task (dispatched at the top of gateView) — the ①②③④ phase FSM is
 *  never entered, so `phase` is meaningless here and `meta` is blank. */
function promoteGateView(t: WireTask): GateView {
  const p = t.promote;
  const reasons = (p?.verdict?.reasons ?? []).map((s) => s.trim()).filter(Boolean);
  const note = p?.note ? localizeNotes(p.note) : '';
  if (t.status === 'error') {
    const errLines = (t.error ?? '').split(' | ').map((s) => localizeNotes(s.trim())).filter(Boolean);
    return { tone: 'error', badge: tr('gateErrorBadge'), title: tr('promoteErrorTitle'), meta: '',
      summary: errLines.length ? errLines : [tr('gateErrorSummary')] };
  }
  if (t.status === 'cancelled') {
    return { tone: 'error', badge: tr('gateCancelledBadge'), title: tr('promoteCancelledTitle'), meta: '',
      summary: [tr('promoteCancelledSummary')] };
  }
  if (t.status === 'done') {
    // spec 081/083: a shared promotion narrates its shipped transport — drop (team inbox, primary)
    // shows the admin-review line; git (fallback) shows the pushed branch (the hub opens the PR).
    const shared = p?.share?.state === 'pushed'
      ? [p.share.mode === 'git' && p.share.branch
          ? tf('promoteSharePushedLine', { branch: p.share.branch })
          : tr('promoteShareSentLine')]
      : [];
    return { tone: 'done', badge: tr('promoteDoneBadge'), title: tr('promoteDoneTitle'), meta: '',
      summary: [p?.target ? tf('promoteTargetLine', { target: p.target }) : tr('promoteDoneSummary'), ...shared, ...(note ? [note] : [])],
      showYamlLink: true };
  }
  // awaiting_confirm — keyed on the promote gate flag.
  if (t.gate?.flag === 'promote_blocked') {
    return { tone: 'warn', badge: tr('promoteBlockedBadge'), title: tr('promoteBlockedTitle'), meta: '',
      summary: reasons.length ? reasons : [note || tr('promoteBlockedSummary')] };
  }
  if (t.gate?.flag === 'promote_distill_failed') {
    return { tone: 'warn', badge: tr('promoteDistillFailedBadge'), title: tr('promoteDistillFailedTitle'), meta: '',
      summary: reasons.length ? reasons : [note || tr('promoteDistillFailedSummary')] };
  }
  // spec 081 — the share-offer gate: the pattern is already promoted locally; ask whether to push it.
  // `note` must ride along: finalize parks HERE (not at done), so an INDEX-rebuild warning would
  // otherwise stay invisible until the share question is answered.
  if (t.gate?.flag === 'promote_share_offer') {
    return { tone: 'done', badge: tr('promoteDoneBadge'), title: tr('promoteShareOfferTitle'), meta: '',
      summary: [
        p?.target ? tf('promoteTargetLine', { target: p.target }) : tr('promoteDoneSummary'),
        ...(note ? [note] : []),
        tr('promoteShareOfferSummary'),
      ],
      showYamlLink: true };
  }
  // spec 081 — the share-review gate (cổng 1): preflight results + the MIT line, parked for the confirm.
  if (t.gate?.flag === 'promote_share_review') {
    const sh = p?.share;
    const lines: string[] = [];
    if (sh?.state === 'failed' && sh.error) lines.push(tf('promoteShareFailedLine', { error: sh.error }));
    if (sh?.note) lines.push(sh.note);
    const found = sh?.findings ?? [];
    if (found.length) {
      lines.push(tf('promoteShareFindingsLine', { n: String(found.length) }));
      for (const f of found.slice(0, 8)) lines.push(`L${f.line} [${f.kind}] ${f.excerpt}`);
      if (found.length > 8) lines.push(tf('promoteShareMoreFindings', { n: String(found.length - 8) }));
    } else if (sh?.state !== 'failed') {
      lines.push(tr('promoteShareScanClean'));
    }
    if (sh?.dup) lines.push(tf('promoteShareDupLine', { dup: sh.dup }));
    lines.push(tr('promoteShareLicenseLine'));
    return { tone: found.length || sh?.state === 'failed' ? 'warn' : 'deploy',
      badge: tr('promoteShareReviewBadge'), title: tr('promoteShareReviewTitle'), meta: '',
      summary: lines, showYamlLink: true };
  }
  // promote_review (incl. the collision variant, which carries `note`).
  const summary = [tr('promoteReviewSummary')];
  if (note) summary.unshift(note);
  if (p?.target) summary.push(tf('promoteTargetLine', { target: p.target }));
  summary.push(tf('promoteProbeLine', { probe: p?.verdict?.probe ?? 'skipped' }));
  return { tone: 'deploy', badge: tr('promoteReviewBadge'), title: tr('promoteReviewTitle'), meta: '',
    summary, showYamlLink: true };
}

/** Synthesize the gate's presentational copy from the live task (the backend sends only actions).
 *  Exported for tests (the `GateActions` / `summaryLineParts` precedent): it is pure task→copy, so the
 *  gate-card branches are assertable without mounting a build. */
export function gateView(t: WireTask): GateView {
  if (t.kind === 'promote') return promoteGateView(t); // spec 052 — promote owns its whole render
  const idx = phaseIndex(t.phase as PhaseKey);
  const meta = tf('phaseMeta', { idx });
  // Spec 045 (review blocker #2): the error/still_failing cards render task.error lines RAW — run
  // them through localizeNotes so the turn-failure triage notes (quota/login/network) reach a JA
  // user in Japanese, exactly like the other gate-note surfaces above.
  const errLines = (t.error ?? '').split(' | ').map((s) => localizeNotes(s.trim())).filter(Boolean);

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
  const slugLine = (lines: string[]): string[] => (t.slugNote ? [localizeNotes(t.slugNote), ...lines] : lines);
  // awaiting_confirm
  if (t.gate?.flag === 'still_failing') {
    return { tone: 'warn', badge: tr('gateFailBadge'), title: tr('gateFailTitle'), meta,
      summary: slugLine(errLines.length ? errLines : [tr('gateFailSummary1'), tr('gateFailSummary2')]),
      showDiffLink: true };
  }
  // D1 (spec 016): the deploy gate. After 014 D1 EVERY selfhost build (incl. auto/spec_only) parks here
  // with the `awaiting_import` flag — name the target + explain Import vs Skip so the card isn't blank.
  if (t.gate?.flag === 'awaiting_import') {
    // `importAppId` = this build already imported once, so THIS import overwrites that same app in place
    // (same id, same URL, no second app). Saying "import always creates a new app" there would be plainly
    // false, and the edit-existing footgun below is about creating a separate app — also not what happens.
    const updating = !!t.importAppId;
    const summary = [
      tr('gateImportSummary1'),
      updating ? tr('gateImportSummaryUpdate') : tr('gateImportSummary2'),
      tr('gateImportSummary3'),
    ];
    if (t.workflow && !updating) summary.push(tf('gateImportSummaryEdit', { workflow: t.workflow }));
    // Spec 094 S1 — the R3→R4 moment: a fix round changed nothing, the flow returned to THIS gate, and
    // the Import button looked identical to the one that had shipped a real fix. State the fact and let
    // the user decide; the button stays enabled (re-importing is their call, and since the ④-overwrite
    // work it is harmless — same app, same URL). Needs BOTH hashes: no import yet ⇒ nothing to compare.
    if (t.importedHash && t.artifactHash && t.importedHash === t.artifactHash) {
      summary.unshift(
        tf('gateNoChangeImport', {
          time: t.importedAt ? new Date(t.importedAt).toLocaleTimeString() : '—',
        })
      );
    }
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
    if (lt?.reason) summary.push(localizeNotes(lt.reason));
    if (lt?.model) summary.push(tf('gateLiveModel', { model: lt.model.name, n: String(lt.modelAutofilled ?? 0) }));
    if (lt?.output != null) {
      const out = typeof lt.output === 'string' ? lt.output : JSON.stringify(lt.output);
      summary.push(tf('gateLiveOutput', { out: out.length > 400 ? out.slice(0, 400) + '…' : out }));
    }
    // spec 032 T3: the judge's per-criterion grade (advisory) — one ✓/✗ line each.
    if (lt?.judge?.criteria?.length) {
      summary.push(tr('gateLiveJudge') + (lt.judge.summary ? ` (${lt.judge.summary})` : ''));
      for (const c of lt.judge.criteria) summary.push(`${c.pass ? '✓' : '✗'} ${c.criterion}${c.evidence ? ` — ${c.evidence}` : ''}`);
    }
    if (lt?.appUrl) summary.push(tf('gateLiveApp', { url: lt.appUrl }));
    return { tone: pass ? 'done' : 'warn', badge: pass ? tr('gateLivePassBadge') : tr('gateLiveFailBadge'),
      title: pass ? tr('gateLivePassTitle') : tr('gateLiveFailTitle'), meta, summary, showReportLink: true };
  }
  // spec 032 D1c: live couldn't run for an infra reason — the static lint result stands.
  if (t.gate?.flag === 'infra_degraded') {
    const lt = t.liveTest;
    const summary = [lt?.reason ? localizeNotes(lt.reason) : tr('gateLiveInfraSummary'), tr('gateLiveStaticStands')];
    // spec 057 S4 (card fix): a post-import infra park DID create the app — surface its link like the
    // test_result branch does, so the human can open it instead of hunting through Dify Studio.
    if (lt?.appUrl) summary.push(tf('gateLiveApp', { url: lt.appUrl }));
    return { tone: 'warn', badge: tr('gateLiveInfraBadge'), title: tr('gateLiveInfraTitle'), meta,
      summary, showReportLink: true };
  }
  switch (t.phase) {
    case 'analyze': {
      // O2 (spec 019): surface the chosen pattern + any pattern-coverage advisory at the Analyze gate.
      const lines = [tr('gateAnalyzeSummary1'), tr('gateAnalyzeSummary2')];
      if (t.patternAdvisory) lines.unshift(localizeNotes(t.patternAdvisory));
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
    case 'implement': {
      // Spec 037 S1: surface the runnability preflight advisory at the ③ gate (the patternAdvisory
      // precedent at the Analyze gate above) — backend-computed string, rendered as-is.
      const implLines = slugLine([tr('gateImplSummary1')]);
      if (t.preflightNote) implLines.unshift(localizeNotes(t.preflightNote));
      // Spec 094 S1: a round that changed nothing gets its own badge and LEADS the summary — the
      // measured failure was that it looked exactly like a round that fixed two bugs, so the user
      // re-imported an unchanged file. `=== true` on purpose: `undefined` means "not measured".
      if (t.artifactUnchanged === true) {
        return { tone: 'warn', badge: tr('gateNoChangeBadge'), title: tr('gateImplTitle'), meta,
          summary: [tr('gateNoChangeSummary'), ...implLines], showDiffLink: true };
      }
      return { tone: '', badge: tr('gateImplBadge'), title: tr('gateImplTitle'), meta,
        summary: implLines, showDiffLink: true };
    }
    default:
      return { tone: '', badge: tr('gateReadyBadge'), title: tr('gateReadyTitle'), meta, summary: [] };
  }
}

/** The awaiting_confirm action-foot (confirm/reply/cancel), extracted (spec 033 FIX-J) so it can render
 *  BOTH inline (GateCard, when phase==='test' — unchanged from today) AND in the docked bar App.tsx
 *  renders for phase∈{analyze,spec,implement} (D7). `onArmChange` replaces the old inline reply textarea:
 *  clicking a reply-kind action now arms the COMPOSER's change-mode (the one reply surface) instead of
 *  opening a second, parallel textarea. */
export function GateActions({ task, busy, onConfirm, onArmChange, onCancel, onRetry }: {
  task: WireTask;
  busy?: boolean;
  onConfirm: (action: WireGateAction, extra?: { slug?: string; name?: string; keepCurrent?: boolean }) => void;
  /** `label` is the chosen reply action's English label (Edit spec / Keep trying / Request changes) so
   *  the resolved gate reads true instead of a generic "Requested changes" (spec 016 D4). */
  onArmChange: (label: string) => void;
  onCancel: (action: WireGateAction) => void;
  /** spec 053: the error gate's sole `retry` reply action fires a one-click, text-less re-run (App owns
   *  the composer-files closure) instead of arming the composer. Absent → the button falls back to arm. */
  onRetry?: () => void;
}) {
  const actions = task.gate?.actions ?? [];
  if (actions.length === 0) return null;

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
    <div className="gate-foot">
      {actions.map((a) => {
        // spec 032 S6: the "delete test apps" cleanup shows only when this build actually has test
        // apps to remove, rendered as a quiet ghost button with the count.
        if (a.id === 'cleanup_apps') {
          const apps = task.testApps ?? [];
          if (!apps.length) return null;
          // spec 036: a re-test auto-deletes the prior apps, so the list is usually just the current one.
          // Two clean buttons (no per-app clutter): "Delete old apps (N-1)" (keep the current) shows only
          // when there ARE old apps; "Delete test apps (N)" removes everything.
          const oldCount = apps.filter((id) => id !== task.appId).length;
          return (
            <Fragment key={a.id}>
              {oldCount > 0 && (
                <button className="btn ghost" disabled={busy} onClick={() => onConfirm(a, { keepCurrent: true })}>
                  🗑 {tf('deleteOldApps', { n: String(oldCount) })}
                </button>
              )}
              <button className="btn ghost" disabled={busy} onClick={() => onConfirm(a)}>🗑 {tAction(a.label)} ({apps.length})</button>
            </Fragment>
          );
        }
        if (a.kind === 'reply') {
          // spec 053: the error gate's `retry` action is a one-click re-run (primary/green + ↻), NOT a
          // composer-arm — `replyButtonKind` scopes the carve-out to `id==='retry' && status==='error'`.
          if (replyButtonKind(a, task.status) === 'retry') {
            return <button key={a.id} className="btn ok" disabled={busy} onClick={() => onRetry?.()}><I.retry />{tAction(a.label)}</button>;
          }
          return <button key={a.id} className="btn ghost" disabled={busy} onClick={() => onArmChange(a.label)}><I.message />{tAction(a.label)}</button>;
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
  );
}

/** spec 033 — a conversational Ask exchange's answer bubble (message↔message, no phase re-run). The
 *  question itself is already rendered as a preceding plain user bubble (store.ask() pushes both). */
export function QaAnswer({ answer, done, seededFrom, cost, sessionReset, onStop }: {
  answer: string;
  done: boolean;
  seededFrom?: string[];
  /** spec 059-shaped cost of the turn that produced THIS answer. Rendered only under `devMode`, and
   *  only when the turn reported numbers — see `askCostLine`. */
  cost?: WirePhaseCost;
  /** dev tip: this turn started a fresh session because the previous one had grown too expensive. */
  sessionReset?: boolean;
  /**
   * spec 097 — stop THIS answer. Offered on every ask, not just a consult: the top-bar pill was gated
   * `asking && kind === 'consult'`, so an ask on a build (the common case — asking about a finished
   * build) had no way out at all and the wall-clock was the only escape. It sits in the head, beside
   * the "Answering…" badge, which is where every chat UI puts it and where the eye already is.
   */
  onStop?: () => void;
}) {
  const html = useMemo(() => (answer.trim() ? renderMarkdownHtml(answer) : ''), [answer]);
  return (
    // `qa-thin` while there is nothing but the badge: the bubble stretched the full column to hold two
    // words and a spinner, reading as an empty answer rather than a pending one.
    <div className={'qa-bubble' + (html ? '' : ' qa-thin')}>
      <div className="qa-head">
        {done ? <I.checkCircle style={{ width: 13, height: 13, color: 'var(--ok)' }} /> : <span className="spin" />}
        {/* spec 082: a Q&A/consult reply is NOT a build phase — the badge said tr('running')="実行中" +
            a "処理中" body, which reads as "a phase is executing" during a plain chat. Use a chat-native
            "Answering…" label (shared: improves Ask-at-gate too) and let the spinner+badge stand alone
            while waiting — no redundant body line. */}
        <span className="qa-badge">{done ? tr('qaAnswered') : tr('qaAnswering')}</span>
        {!done && onStop && (
          <button className="qa-stop" onClick={onStop} type="button" title={tr('stopAnswerHint')}>
            <span className="stop-sq" />{tr('stop')}
          </button>
        )}
      </div>
      {html ? (
        <div className="qa-body md-stream" dangerouslySetInnerHTML={{ __html: html }} />
      ) : null}
      {/* spec 034 §2: a ④/terminal fresh-seeded answer captions which sources were folded into its seed,
          so a possibly-incomplete answer is visible rather than silently trusted. Phase Asks omit this. */}
      {done && seededFrom && seededFrom.length > 0 && (
        <div className="qa-seeded">{tf('qaSeededFrom', { sources: seededFrom.join(', ') })}</div>
      )}
      {/* Dev-only meter for THIS answer: which model replied and what the turn cost. Deliberately not
          translated and not in the reader's language — the dev panel it belongs to is English, and this
          is instrumentation, not product copy. Absent when the turn reported no numbers. */}
      {done && devMode && askCostLine(cost, sessionReset) && (
        <div className="qa-devcost">{askCostLine(cost, sessionReset)}</div>
      )}
    </div>
  );
}

export function GateCard({ task, resolved, busy, onConfirm, onArmChange, onCancel, onRetry, onRestore, onEditAgain, onRunTest, onRequestFix, onOpenArtifact }: {
  task: WireTask;
  resolved?: string;
  busy?: boolean;
  onConfirm: (action: WireGateAction, extra?: { slug?: string; name?: string; keepCurrent?: boolean }) => void;
  /** spec 033 FIX-J: arms the composer's change-mode with the chosen reply action's label — replaces
   *  the old inline reply textarea (removed; the composer is now the ONE reply surface). */
  onArmChange: (label: string) => void;
  onCancel: (action: WireGateAction) => void;
  /** spec 053: one-click re-run for the error gate's `retry` action (threaded to the inline GateActions —
   *  an error gate renders inline here, not in the docked bar, since `docked` needs awaiting_confirm). */
  onRetry?: () => void;
  onRestore?: () => void;
  /** spec 035: start a NEW edit-existing build from a done/cancelled gate foot (same newTask({baseWorkflow})
   *  the sidebar "+" uses). Only fired when task.project/task.workflowSlug are both set. */
  onEditAgain?: (project: string, workflowSlug: string) => void;
  /** spec 036 D5: run a live workflow test from a done AUTONOMOUS build (its only live path). Rendered
   *  only when terminalFootActions.runTest holds (done + creds reachable + auto/spec_only). */
  onRunTest?: () => void;
  /** The post-import fix loop: arm change-mode on a DONE build so the fix found while testing in Dify is
   *  typed into THIS conversation (→ POST /reply, which resumes the implement session) instead of
   *  starting a new build. Contrast with `onEditAgain`, which deliberately opens a NEW conversation. */
  onRequestFix?: () => void;
  onOpenArtifact: (tab: ArtifactTab) => void;
}) {
  const v = gateView(task);
  const actions = task.gate?.actions ?? [];
  const tone = v.tone ? ' tone-' + v.tone : '';
  const badgeIcon = v.tone === 'error' ? <I.alert /> : v.tone === 'warn' ? <I.warn />
    : v.tone === 'danger' ? <I.lock /> : v.tone === 'done' ? <I.checkCircle />
    : v.tone === 'deploy' ? <I.external /> : <I.spark />;
  // spec 033 D7/FIX-J: at an awaiting_confirm gate for phase∈{analyze,spec,implement}, the action-foot
  // docks (App.tsx, above the composer) instead of rendering inline here — Ask never consumes the gate,
  // so the SAME actions stay valid through any amount of chat. ④ Test gates are UNSCOPED (still inline,
  // unchanged from today, D4) and error/cancelled stay inline too (handled by the branches below).
  const docked = task.status === 'awaiting_confirm' && (task.phase === 'analyze' || task.phase === 'spec' || task.phase === 'implement');
  // spec 035 D2: two INDEPENDENT terminal-foot actions (Restore cancelled-only, NOT gated on
  // project/workflowSlug so a pre-scaffold cancel keeps it; Edit-again needs an on-disk target). Extracted
  // to a pure helper (gate-foot.ts) with the four regression-guard cases in gate-foot.test.ts (§S1).
  // spec 052: a promote build reuses none of the ①②③④ terminal-foot actions (Edit-this-workflow /
  // Run-test / Restore) — its source project/workflowSlug would otherwise wrongly light Edit-again on a
  // done promotion. Suppress them so only the promote gate's own actions render.
  const isPromote = task.kind === 'promote';
  const { restore: canRestore, editAgain: canEditAgain, runTest: canRunTest, requestFix: canRequestFix } =
    terminalFootActions(task, {
      restore: !!onRestore && !isPromote,
      editAgain: !!onEditAgain && !isPromote,
      runTest: !!onRunTest && !isPromote,
      requestFix: !!onRequestFix && !isPromote,
    });

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
            {v.summary.map((s, i) => (
              <li key={i}>{summaryLineParts(s)}</li>
            ))}
          </ul>
        </div>
      )}

      {(v.showSpecLink || v.showReportLink || v.showDiffLink || v.showYamlLink) && (
        <div className="gate-strip" style={{ background: 'transparent', border: 'none', paddingTop: 0 }}>
          {v.showSpecLink && (
            <button className="gs-link" style={{ marginLeft: 0 }} onClick={() => onOpenArtifact('spec')}><I.doc />{tr('openSpec')}</button>
          )}
          {v.showYamlLink && (
            <button className="gs-link" style={{ marginLeft: 0 }} onClick={() => onOpenArtifact('yaml')}><I.yaml />{tr('openPattern')}</button>
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
      ) : canRestore || canEditAgain || canRunTest || canRequestFix ? (
        // spec 035 D2 / 036 D5: Restore (cancelled-only — reopens THIS build), Edit-this-workflow (both
        // statuses — starts a NEW edit-existing build), and Run-test-with-workflow (done autonomous +
        // creds — re-enters the live sub-orchestrator) coexist as independent actions in one foot.
        // Request-a-fix (done-only) leads: it is the "keep working right here" action, and the one the
        // user reaches for after importing into Dify and finding something to change.
        <div className="gate-foot">
          {canRequestFix && (
            <button className="btn ghost" disabled={busy} onClick={() => onRequestFix!()} title={tr('requestFixHint')}>
              <I.message />{tr('requestFix')}
            </button>
          )}
          {canRestore && (
            <button className="btn ghost" disabled={busy} onClick={() => onRestore!()}>
              <I.undo />{tr('restoreBuild')}
            </button>
          )}
          {canEditAgain && (
            <button className="btn ghost" disabled={busy} onClick={() => onEditAgain!(task.project!, task.workflowSlug!)}>
              <I.edit />{tr('editThisWorkflow')}
            </button>
          )}
          {canRunTest && (
            <button className="btn ghost" disabled={busy} onClick={() => onRunTest!()}>
              <I.spark />{tr('runTestWithWorkflow')}
            </button>
          )}
        </div>
      ) : docked ? null : actions.length > 0 ? (
        <GateActions task={task} busy={busy} onConfirm={onConfirm} onArmChange={onArmChange} onCancel={onCancel} onRetry={onRetry} />
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
  // Where the menu may go, decided at OPEN time (see fitMenu). Null until then — the CSS default (upward,
  // 280px) is what renders while it is null, which is also what every pre-measurement render used.
  const [fit, setFit] = useState<{ up: boolean; maxH: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  /**
   * Fit the menu inside whatever would CLIP it.
   *
   * The menu opens upward out of a chip that sits at the bottom of its surface. That was free while no
   * ancestor scrolled — it simply overhung. The new-task surface now scrolls (it has to: a long
   * requirement plus the seed list overflows, and centering the overflow used to push content up under
   * the header), and a scroll container clips: measured, a 96px menu opened from a scrolled composer was
   * ENTIRELY hidden above the surface's top edge. So: measure the room above the chip inside the nearest
   * scrolling ancestor (the viewport when there is none), cap the menu to it, and flip downward when
   * there is more room the other way. The menu scrolls internally either way, so no option is ever lost.
   */
  const fitMenu = (): void => {
    const chip = ref.current?.getBoundingClientRect();
    if (!chip) return;
    let clipTop = 0;
    let clipBottom = window.innerHeight;
    for (let p = ref.current?.parentElement ?? null; p; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) {
        const r = p.getBoundingClientRect();
        clipTop = Math.max(clipTop, r.top);
        clipBottom = Math.min(clipBottom, r.bottom);
        break; // the nearest one is what actually clips
      }
    }
    const GAP = 10; // the CSS 6px offset plus a little breathing room
    const above = chip.top - clipTop - GAP;
    const below = clipBottom - chip.bottom - GAP;
    // Upward is the established direction, so KEEP it whenever the menu actually fits — flipping a menu
    // that had room would be a gratuitous change to how the composer has always looked. The natural
    // height isn't measurable before the menu renders, so estimate it from the option count (row 28px +
    // the 4px padding either side), capped like the CSS. Only when it does not fit above, and there is
    // more room below, does it flip.
    const wanted = Math.min(280, options.length * 28 + 8);
    const up = above >= wanted || above >= below;
    setFit({ up, maxH: Math.max(80, Math.min(280, up ? above : below)) });
  };

  const sel = options.find((o) => o.v === value);
  return (
    <div className={'setting-select' + (shrink ? ' shrink' : '')} ref={ref} style={{ position: 'relative' }}>
      <button className={'setting-chip' + (mono ? ' mono' : '') + (disabled ? ' disabled' : '')}
        onClick={() => {
          if (disabled) return;
          if (!open) fitMenu(); // measure BEFORE showing it, so it never renders in the wrong place first
          setOpen((o) => !o);
        }} type="button"
        disabled={disabled} title={disabled ? (title ?? tr('setAtStart')) : undefined}>
        {icon}<span className="sc-key">{label}:</span>
        <span className="sc-val">{sel ? sel.l : value}</span>
        {!disabled && <Twist open={open} />}
      </button>
      {open && !disabled && (
        <div className="setting-menu"
          style={fit ? { maxHeight: `${fit.maxH}px`, ...(fit.up ? {} : { top: 'calc(100% + 6px)', bottom: 'auto' }) } : undefined}>
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

/**
 * The files a user message carried, rendered INSIDE its bubble (Claude Nexus does the same: the server
 * serves each upload by id and the bubble points an <img> at it). Two sources for the same file:
 * `dataUrl` is the composer's in-memory copy — instant, no request, available before the POST answers —
 * and `idx` addresses the saved copy at `/api/tasks/:id/uploads/:idx`, which is what still works after a
 * reload (the data-URL is stripped when the thread is persisted; see lib/thread-persist).
 * An attachment with neither (a pre-fix persisted thread) simply renders as a nameplate chip.
 */
export function MsgAttachments({ atts, taskId }: { atts: ThreadAttachment[]; taskId?: string }) {
  const srcOf = (a: ThreadAttachment): string =>
    a.dataUrl ?? (taskId && a.idx !== undefined ? `/api/tasks/${encodeURIComponent(taskId)}/uploads/${a.idx}` : '');
  return (
    <div className="msg-atts">
      {atts.map((a, i) => {
        const src = srcOf(a);
        if (isImageMime(a.mime) && src) {
          return (
            <a key={i} href={src} target="_blank" rel="noreferrer" title={a.name}>
              <img className="msg-att-img" src={src} alt={a.name} loading="lazy" />
            </a>
          );
        }
        const chip = (
          <div className="img-chip" title={a.name}>
            <span className="ic-file"><I.doc /></span>
            <span className="ic-name">{a.name}</span>
          </div>
        );
        return src ? <a key={i} href={src} target="_blank" rel="noreferrer">{chip}</a> : <Fragment key={i}>{chip}</Fragment>;
      })}
    </div>
  );
}

export function Composer({ value, onChange, onSend, settings, onSettings, model, onModel, workflows, placeholder, disabled, lockStartBound, lockConfirm, files, onAddFiles, onRemoveFile, focusToken, mode, onMode, canChange, changeArmed, sendGlyph }: {
  value: string;
  onChange: (value: string) => void;
  /** spec 092: intent is PER-MESSAGE — 'ask' from Enter / the chat button, 'change' from the labeled
   *  change pill / ⌘⌃Enter. Call sites where only one target exists just ignore it (composerTarget
   *  decides the route either way, so a stray intent can never mis-route — pinned in its tests). */
  onSend: (intent: ComposerIntent) => void;
  /** spec 034 D3: optional — a terminal (done/cancelled) Ask composer omits both so the settings row
   *  (workflow/confirm/fast — spec 036 dropped deploy/test) does not render; it becomes a plain question box. */
  settings?: Settings;
  onSettings?: (patch: Partial<Settings>) => void;
  /** spec 030: existing workflows from /api/tree as `{ v: 'project/workflow', l: 'Project / Workflow' }`
   *  (project-qualified — the same name can exist in several projects). Lists in the Workflow dropdown (AC #14). */
  workflows?: { v: string; l: string }[];
  placeholder: string;
  disabled?: boolean;
  /** F2 (spec 010): conversation view — Workflow is start-bound (read-only); only Confirm is
   *  live-patchable. In the empty view both are editable (they feed the next build). (spec 036: Deploy
   *  is no longer a chip — deploy is decided at the test gate from reachable creds.) */
  /**
   * spec 096 — the model chip has its OWN props, deliberately not part of `settings`. Workflow/confirm/
   * fast are BUILD settings and vanish with them (a consult has no phases; a finished build has no next
   * boundary). The model is not like that: it is read by every turn type there is — build phases,
   * consult, and the ask-about-this-build turns on a FINISHED build. Folding it into `settings` is what
   * hid it from the terminal composer while ask.ts was already spawning with it: a value in force that
   * the user could neither see nor change. Rendered whenever `onModel` is given.
   */
  model?: string;
  onModel?: (v: string) => void;
  lockStartBound?: boolean;
  /** F2 (spec 010): also freeze the Confirm chip while the live build's turn is RUNNING — a patch then
   *  would 409 (the backend rejects it; the in-memory orchestrator can't honor it). Editable once parked. */
  lockConfirm?: boolean;
  /** spec 012/025: file attachments held by the parent (App). Absent → the attach affordance is hidden. */
  files?: ComposerAttachment[];
  onAddFiles?: (files: File[]) => void;
  onRemoveFile?: (id: string) => void;
  /** spec 033 FIX-J: bump this (any changing value) to focus the textarea — used when arming the
   *  composer's change-mode from a gate's reply-kind action, so typing the change starts immediately. */
  focusToken?: number;
  /** spec 082 §4.5: the entry-mode chip (`モード: 相談|ビルド`) — EMPTY VIEW ONLY (inside a task the kind
   *  is fixed, so conversation composers omit both). Renders FIRST in the row, same chip style as the
   *  others; while mode==='consult' the build chips (workflow/confirm/fast) are hidden — they are
   *  meaningless for a chat and the row stays short (the nowrap rule keeps its slack). */
  mode?: 'consult' | 'build';
  onMode?: (mode: 'consult' | 'build') => void;
  /** spec 092: render the second send action (the ✎ change pill) — only where a change-intent send is
   *  actually legal (a parked ①—④ gate, kind≠promote; a fixable done build). Everywhere else the
   *  composer keeps its single send button. */
  canChange?: boolean;
  /** spec 092: a gate action ("Edit spec", "Request a fix") armed a PRESENTATION hint — highlight the
   *  change pill for the next message. Never changes what Enter does (Enter stays the cheap 'ask'). */
  changeArmed?: boolean;
  /** spec 092: glyph for the send button. Default is the ↵ return-arrow — the button IS the Enter key,
   *  which is exactly what it should teach. 'edit' only where every send is a revision (promote), so
   *  that box doesn't dress a change request up as a plain send. */
  sendGlyph?: 'enter' | 'edit';
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  useEffect(() => {
    if (focusToken !== undefined) ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken]);
  // Auto-grow the textarea to fit its content. `autosize` resets height then reads scrollHeight.
  // We call it on every `input` (live — incl. mid-IME composition) so the box grows AS you wrap,
  // AND on value/resize changes, since soft-wrapping (line count → height) depends on width.
  // The 180px ceiling is viewport-aware: on a very short window a full-height input pushed the chip/send
  // row past the bottom edge (the dock cannot shrink, and the thread's padding floors its own height), so
  // the send buttons became unreachable. 35vh keeps the ceiling at a flat 180px for any window taller than
  // ~515px — i.e. unchanged in normal use — and yields only when the window is too short to afford it.
  const autosize = () => {
    const el = ref.current; if (!el) return;
    const cap = Math.max(90, Math.min(180, window.innerHeight * 0.35));
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, cap) + 'px';
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!ready) return;
      // spec 092: ⌘Enter (mac) / Ctrl+Enter = the change-intent send, only where the change pill exists.
      // Plain Enter is ALWAYS the cheap ask — a wrong Enter costs one answer, never a phase re-run.
      onSend(canChange && (e.metaKey || e.ctrlKey) ? 'change' : 'ask');
    }
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
        {/* spec 082 §4.5: the Mode chip — first in the row, entry-only (empty view). Same SettingSelect
            as every other chip for style/interaction parity (the user's explicit call). */}
        {mode && onMode && (
          <SettingSelect label={tr('mode')} value={mode}
            options={[{ v: 'consult', l: tr('modeConsult') }, { v: 'build', l: tr('modeBuild') }]}
            onChange={(v) => onMode(v as 'consult' | 'build')} title={tr('modeHint')} />
        )}
        {/* spec 096: the Model chip sits OUTSIDE the build-only block below — it applies to a consult
            chat exactly as much as to a build, and offering a choice that is silently dropped in one of
            the two modes would be worse than not offering it. Start-bound like Workflow/Fast: locked
            once the task is running, so every phase of one build is the same bet. Values are family
            ALIASES, so each one means "the newest of that family this environment can reach".
            `shrink` is load-bearing, not cosmetic: measured at an 820px viewport this chip added 93px
            to a row that fit exactly without it, and `.composer-row` is `flex-wrap: nowrap` by design
            (only the workflow chip was allowed to truncate). Marking this one shrinkable too keeps the
            invariant the row exists to hold — everything on ONE line, Send never pushed off. */}
        {onModel && (
          <SettingSelect shrink label={tr('model')} value={model ?? ''}
            /* No `?? 'opus'` fallback: that default LIED three times over — it showed "Opus" for a
               task that had actually run on something else, and for a pre-096 task that recorded no
               choice at all. A chip must never assert a value nobody picked. The sentinel appears only
               when there is genuinely nothing to show (a pre-096 task in the conversation view, where
               the chip is disabled anyway), so the entry composer never sees it. */
            options={[
              ...(model ? [] : [{ v: '', l: tr('modelUnset') }]),
              ...MODEL_OPTIONS.map((m) => ({ v: m, l: tr(`model_${m}` as never) })),
            ]}
            onChange={onModel}
            /* spec 096: NOT `lockStartBound`. The first message's choice is the DEFAULT, not a
               life sentence — the requirement said "if you don't change it", which presumes you can,
               and the CLI this mirrors lets you switch mid-session. `lockConfirm` (busy) is the right
               guard: the same one confirm-mode uses, because a patch mid-turn would be clobbered by
               the running orchestrator's own write — a lying control. */
            disabled={lockConfirm} title={tr('modelHint')} />
        )}
        {/* spec 034 D3: the settings row is optional — a terminal Ask composer omits settings/onSettings,
            so this whole block disappears and only the spacer + attach + send remain. spec 082: the build
            chips also hide while the Mode chip says consult — meaningless for a chat. */}
        {settings && onSettings && mode !== 'consult' && (<>
        <SettingSelect mono shrink icon={<I.sliders style={{ width: 12, height: 12 }} />} label={tr('workflow')}
          value={settings.workflow} options={workflowOpts} onChange={(v) => onSettings({ workflow: v })}
          disabled={lockStartBound} title={tr('workflowFixed')} />
        <SettingSelect label={tr('confirm')} value={settings.confirm}
          options={[{ v: 'each step', l: tr('eachStep') }, { v: 'spec only', l: tr('specOnly') }, { v: 'auto', l: tr('auto') }]}
          onChange={(v) => onSettings({ confirm: v })}
          disabled={lockConfirm} title={tr('confirmModeHint')} />
        {/* spec 028: ⚡ Fast build — start-bound, from-scratch only (disabled when an existing workflow is
            chosen; the backend also force-offs on seed/slug). spec 036: the Deploy + Test chips were
            removed here — deploy/test are decided at the test gate from reachable creds (difyTargets),
            not declared up front. Row is now Workflow · Confirm · Fast build. */}
        <SettingSelect label={tr('fast')} value={settings.fast ? 'on' : 'off'}
          options={[{ v: 'off', l: tr('fastOff') }, { v: 'on', l: tr('fastOn') }]}
          onChange={(v) => onSettings({ fast: v === 'on' })}
          disabled={lockStartBound || settings.workflow !== 'none'} title={tr('fastHint')} />
        </>)}
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
        {/* spec 092: the change pill — the deliberate, labeled door to the expensive send (re-runs the
            phase / reopens a done build). Sits LEFT of the ask button so the rightmost position — the
            old single-send spot, where muscle memory clicks — stays the cheap default. */}
        {canChange && (
          <button className={'composer-change' + (ready ? ' ready' : '') + (changeArmed ? ' armed' : '')}
            type="button" onClick={() => { if (ready) onSend('change'); }} disabled={!ready}
            title={tr('sendChangeTip')}>
            <I.edit /><span className="cc-label">{tr('modeChange')}</span>
          </button>
        )}
        {/* Labeled like its sibling pill so the pair reads as two SENDS, not toggle+send. Next to the
            change pill the label says WHAT it sends (質問を送信) — a bare 送信 there would re-create the
            old trap: click 変更を依頼 expecting a mode, type, press "送信", message leaves as a question. */}
        <button className={'composer-send' + (ready ? ' ready' : '')}
          onClick={() => { if (ready) onSend('ask'); }} disabled={!ready}
          title={canChange ? tr('sendAskTip') : undefined}>
          {sendGlyph === 'edit' ? <I.edit /> : <I.enter />}
          <span className="cs-label">{canChange ? tr('sendAskBtn') : tr('sendBtn')}</span>
        </button>
      </div>
    </div>
  );
}
