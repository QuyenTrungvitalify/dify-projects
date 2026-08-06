/* ============================================================
   BgTray.tsx — spec 084: the background-distill tray (corner panel).
   Reads store.bgDistills and lets the user drive each distill's gate
   IN PLACE (Approve / Overwrite / Share / Resend / Discard) without
   leaving their current screen — the promote task never hijacks the
   conversation view. [Details]/[View report] opens it foreground only
   when the user asks. Poll (store) keeps each item fresh; this is a
   dumb renderer of that state.
   ============================================================ */
import type { JSX } from 'preact';
import { I } from './Icon';
import { t as tr, tf } from '../lib/i18n';
import { devMode } from '../lib/dev';
import * as store from '../store';
import type { BgDistill } from '../store';

/** action.id → tray button label key (the backend labels are English; localize the ones the tray shows). */
const ACTION_LABEL: Record<string, string> = {
  approve: 'trayApprove',
  approve_overwrite: 'trayOverwrite',
  approve_rename: 'traySaveAsNew',
  share: 'trayShareTeam',
  share_skip: 'trayKeepLocal',
  share_confirm: 'trayPush',
  discard: 'trayDiscard',
};
/** confirm actions rendered in the affirmative (ok) tone; the rest are ghost. */
const OK_ACTIONS = new Set(['approve', 'approve_overwrite', 'approve_rename', 'share', 'share_confirm']);

/** A slug collision surfaces the Overwrite/Save-as-new choice under the same review flag (gate.ts:129). */
function isCollision(b: BgDistill): boolean {
  return !!b.gate?.actions.some((a) => a.id === 'approve_overwrite');
}

type Tone = 'run' | 'ok' | 'warn';
function headline(b: BgDistill): { icon: JSX.Element; text: string; tone: Tone } {
  if (b.status === 'queued') return { icon: <span className="spin" />, text: tr('trayQueued'), tone: 'run' };
  if (b.status === 'running') return { icon: <span className="spin" />, text: tf('trayDistilling', { slug: b.slug }), tone: 'run' };
  if (b.status === 'error' || b.status === 'cancelled') return { icon: <I.warn />, text: tr('trayFailed'), tone: 'warn' };
  if (b.status === 'done')
    return {
      icon: <I.checkCircle />,
      text: b.share?.state === 'pushed' ? tf('trayShared', { slug: b.slug }) : tf('trayPromoted', { slug: b.slug }),
      tone: 'ok',
    };
  // awaiting_confirm — the parked gate decides the headline.
  const flag = b.gate?.flag;
  if (flag === 'promote_distill_failed') return { icon: <I.warn />, text: tr('trayFailed'), tone: 'warn' };
  if (flag === 'promote_blocked') return { icon: <I.warn />, text: tr('trayBlocked'), tone: 'warn' };
  if (flag === 'promote_share_offer') return { icon: <I.checkCircle />, text: tf('trayPromoted', { slug: b.slug }), tone: 'ok' };
  if (flag === 'promote_share_review') {
    // spec 084 v1.4 — the share_review flag now covers two warn states: a failed push (retry) and the
    // leak fuse (findings present, keep-local-only). A plain promoted-awaiting-share stays ok-toned.
    if (b.share?.state === 'failed') return { icon: <I.warn />, text: tr('trayShareFailed'), tone: 'warn' };
    if (b.share?.findings?.length) return { icon: <I.warn />, text: tr('trayLeakBlocked'), tone: 'warn' };
    return { icon: <I.checkCircle />, text: tf('trayPromoted', { slug: b.slug }), tone: 'ok' };
  }
  if (isCollision(b)) return { icon: <I.warn />, text: tf('trayCollision', { slug: b.slug }), tone: 'warn' };
  return { icon: <I.checkCircle />, text: tr('trayReady'), tone: 'ok' };
}

/** Close a tray item: terminal / queued → drop it; a running or parked one → confirm, then cancel + drop. */
async function closeItem(b: BgDistill): Promise<void> {
  const active = !store.isBgTerminal(b) && b.status !== 'queued';
  if (active) {
    const ok = await store.askConfirm({
      title: tr('trayCloseRunningTitle'),
      message: tf('trayCloseRunningMsg', { slug: b.slug }),
      okLabel: tr('trayCloseRunningOk'),
      danger: true,
    });
    if (!ok) return;
  }
  void store.closeBg(b.key);
}

function ActionRow({ b }: { b: BgDistill }): JSX.Element | null {
  const btns: JSX.Element[] = [];
  const flag = b.gate?.flag;
  const acts = b.gate?.actions ?? [];
  if (b.status === 'awaiting_confirm') {
    if (flag === 'promote_distill_failed') {
      // §4 S1: a failed distill offers Resend (note-less re-run) here; the note-steered Request-changes
      // lives in the task view, reached via [Details].
      btns.push(
        <button key="resend" className="btn ok" onClick={() => void store.resendBg(b.key)}>
          <I.retry />
          {tr('trayResend')}
        </button>,
      );
    } else {
      for (const a of acts) {
        if (a.kind === 'confirm') {
          const label = ACTION_LABEL[a.id] ? tr(ACTION_LABEL[a.id]) : a.label;
          btns.push(
            <button key={a.id} className={'btn ' + (OK_ACTIONS.has(a.id) ? 'ok' : 'ghost')} onClick={() => void store.confirmBg(b.key, a.id)}>
              {label}
            </button>,
          );
        } else if (a.kind === 'cancel') {
          // Discard = cancel the promote task (closeBg cancels + drops the item).
          btns.push(
            <button key={a.id} className="btn ghost" onClick={() => void store.closeBg(b.key)}>
              {tr('trayDiscard')}
            </button>,
          );
        }
        // reply-kind ('changes') → not shown inline; [Details] opens the task to type the note.
      }
    }
  }
  // [Undo] — spec 084 S2: only on a promoted (done) item that has NOT been shared to team (a pushed
  // pattern can't be recalled from Drive/PR, so undoing only the local copy would mislead).
  if (b.status === 'done' && b.share?.state !== 'pushed') {
    btns.push(
      <button key="undo" className="btn ghost" onClick={() => void store.undoBg(b.key)}>
        <I.undo />
        {tr('trayUndo')}
      </button>,
    );
  }
  // [Details] / [View report] — open the distill in the foreground (only once a task exists).
  if (b.taskId) {
    btns.push(
      <button key="open" className="btn ghost" onClick={() => void store.openBg(b.key)}>
        <I.report />
        {b.status === 'done' ? tr('trayViewReport') : tr('trayDetails')}
      </button>,
    );
  }
  return btns.length ? <div className="bg-tray-acts">{btns}</div> : null;
}

export function BgTray(): JSX.Element | null {
  const items = store.bgDistills.value;
  if (!items.length) return null;
  const testCount = items.filter((b) => b.test).length;
  return (
    <div className="bg-tray" role="region" aria-label={tr('trayTitle')}>
      {/* spec 084 (DEV): wipe all test distills — rendered LAST so column-reverse floats it to the top. */}
      {devMode && testCount > 0 && (
        <div className="bg-tray-clear">
          <button className="ghost-pill" onClick={() => void store.clearTestDistills()}>
            <I.close />
            {tf('trayClearTest', { n: testCount })}
          </button>
        </div>
      )}
      {items.map((b) => {
        const h = headline(b);
        const showSub = !!b.target && (b.status === 'awaiting_confirm' || b.status === 'done');
        // While a distill is merely running/queued there is nothing to act on, so render a COMPACT
        // one-line card (no sub, no [Details] row) that hugs the corner instead of blanketing the
        // composer beneath it. The full card (with actions) returns the moment a decision is needed.
        const compact = b.status === 'running' || b.status === 'queued';
        return (
          <div key={b.key} className={'bg-tray-card tone-' + h.tone + (compact ? ' bg-tray-card--compact' : '') + (b.taskId ? ' has-open' : '')}>
            {/* header-level [Details] icon (left of the ×): opens the distill task foreground — the same
                store.openBg as the ActionRow [Details], but reachable on the COMPACT running card too. */}
            {/* one flex row for the header controls so the two icons always align (independent absolute
                positions drifted apart on the full card). data-tip drives the CSS hover bubble (clearer
                than a delayed native title, which is dropped so tooltips don't double up). */}
            <div className="bg-tray-btns">
              {b.taskId && (
                <button className="bg-tray-open" data-tip={tr('trayDetailsTip')} aria-label={tr('trayDetails')} onClick={() => void store.openBg(b.key)}>
                  <I.report />
                </button>
              )}
              <button className="bg-tray-x" data-tip={tr('trayCloseTip')} aria-label={tr('trayClose')} onClick={() => void closeItem(b)}>
                <I.close />
              </button>
            </div>
            <div className="bg-tray-head">
              {h.icon}
              <span className="bg-tray-title">{h.text}</span>
              {b.test && <span className="bg-tray-dev">{tr('trayTestBadge')}</span>}
            </div>
            {!compact && showSub && <div className="bg-tray-sub">{b.target}</div>}
            {!compact && <ActionRow b={b} />}
          </div>
        );
      })}
    </div>
  );
}
