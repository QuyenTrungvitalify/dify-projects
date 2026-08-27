import type { WireTreeTask } from '../types';

/** The i18n keys the "In progress" row × uses for its confirm dialog. */
export type CancelConfirmCopy = { titleKey: string; msgKey: string; okKey: string };

/**
 * Which confirm copy the × on an "In progress" row shows.
 *
 * There is no branch that skips the dialog: the × posts /cancel, which is terminal, so a stray click
 * on a row must never be able to end a build on its own. What the status decides is only the WORDING —
 * a live turn is being stopped mid-work ("this phase's progress discarded"), while a build parked at a
 * gate has nothing running and keeps its spec/artifacts, so saying "progress discarded" there would be
 * a lie that makes the user hesitate over a cheap, restorable action.
 */
export function cancelConfirmCopy(status: WireTreeTask['status']): CancelConfirmCopy {
  return status === 'awaiting_confirm'
    ? { titleKey: 'cancelGateTitle', msgKey: 'cancelGateMsg', okKey: 'cancelThisBuild' }
    : { titleKey: 'stopBuildTitle', msgKey: 'stopBuildMsg', okKey: 'stopBuild' };
}

/**
 * Which end-this-build pill the conversation header shows, if any.
 *
 * One control, two states, because there is one act underneath: `/cancel` is the same POST whether a
 * turn is running or the build is parked, and only the WORDING differs — the same split
 * {@link cancelConfirmCopy} already makes for the sidebar row ×.
 *
 * The second argument is whether the GATE offers a cancel, not whether one would be technically valid.
 * That distinction is load-bearing: the promote share gates are confirm-only on purpose, so that saying
 * "keep it local" can never mark a finished promotion `cancelled`. A pill that ignored the gate and
 * offered 破棄 there would undo a promotion the user had already completed.
 *
 * `null` everywhere else — a running-turn-less build with no cancel on offer has nothing for this pill
 * to do, and no card draws one either: gate cards carry no buttons at all now.
 */
export function endBuildPill(busy: boolean, gateOffersCancel: boolean): 'stop' | 'discard' | null {
  // A running turn outranks the parked reading. The two are exclusive in practice (a gate means
  // `awaiting_confirm`, which holds no turn), so this order is a statement about which fact wins if
  // they ever disagree, not a case that happens today.
  if (busy) return 'stop';
  return gateOffersCancel ? 'discard' : null;
}

/**
 * The confirm THAT pill opens — keyed on the pill's own state, not on the task's status, and that is the
 * whole point: a dialog has to repeat the word written on the button that opened it.
 *
 * Its discard half is deliberately NOT {@link cancelConfirmCopy}'s. The two functions serve two controls
 * that have always used different words for ending a build — the sidebar row × says 「キャンセル」, the
 * button this pill inherited says 「ビルドを破棄」 — and routing the pill through the sidebar's copy made a
 * 破棄 button open a キャンセル dialog: two names for one irreversible act, on one screen, half a second
 * apart. That older split is not settled here; what is guaranteed here is only that one control never
 * speaks both halves of it.
 */
export function endBuildCopy(pill: 'stop' | 'discard'): CancelConfirmCopy {
  return pill === 'stop'
    ? { titleKey: 'stopBuildTitle', msgKey: 'stopBuildMsg', okKey: 'stopBuild' }
    : { titleKey: 'discardTitle', msgKey: 'discardMsg', okKey: 'discardOk' };
}
