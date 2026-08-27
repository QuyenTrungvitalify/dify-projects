/**
 * cancelConfirmCopy — the confirm shown by the × on an "In progress" sidebar row.
 *
 * WHY THIS TEST EXISTS. That × used to skip the dialog entirely for a build parked at a gate, so one
 * stray click on a hover-revealed button ended the build with no way back on the same screen. The
 * regression is silent — the row just disappears — so the "every status confirms" half is pinned
 * separately from the wording half, and the wording half exists because a parked build keeps its
 * spec/artifacts and must NOT be told its progress is discarded.
 */
import { describe, it, expect } from 'vitest';
import { cancelConfirmCopy, endBuildCopy, endBuildPill } from './cancel-confirm';
import type { WireStatus } from '../types';
import { t, tf, lang } from './i18n';

describe('cancelConfirmCopy', () => {
  it('returns copy for every status — no branch skips the confirm', () => {
    // The whole WireStatus union — a status added later without copy here fails the typecheck, not
    // this test, which is the point: there must be no way to reach the × with nothing to confirm.
    const all: WireStatus[] = ['running', 'scaffolding', 'awaiting_confirm', 'done', 'error', 'cancelled'];
    for (const status of all) {
      const copy = cancelConfirmCopy(status);
      expect(copy.titleKey).toBeTruthy();
      expect(copy.msgKey).toBeTruthy();
      expect(copy.okKey).toBeTruthy();
    }
  });

  it('a parked build is not told its progress is discarded', () => {
    expect(cancelConfirmCopy('awaiting_confirm')).toEqual({
      titleKey: 'cancelGateTitle', msgKey: 'cancelGateMsg', okKey: 'cancelThisBuild',
    });
    expect(cancelConfirmCopy('running')).toEqual({
      titleKey: 'stopBuildTitle', msgKey: 'stopBuildMsg', okKey: 'stopBuild',
    });
  });

  it('every key it names resolves in both locales', () => {
    const before = lang.value;
    try {
      for (const l of ['en', 'ja'] as const) {
        lang.value = l;
        for (const status of ['awaiting_confirm', 'running'] as const) {
          const copy = cancelConfirmCopy(status);
          expect(t(copy.titleKey)).not.toBe(copy.titleKey);
          expect(t(copy.okKey)).not.toBe(copy.okKey);
          // tf must actually substitute — a missing key would echo the key back untouched.
          expect(tf(copy.msgKey, { name: 'X' })).toContain('X');
        }
      }
    } finally {
      lang.value = before;
    }
  });
});

/**
 * endBuildPill — the header's one way to end the open build.
 *
 * WHY THIS TEST EXISTS. Gate cards carry no buttons any more, so this pill is the ONLY discard there
 * is: widen it and it offers to end builds the backend deliberately refuses to end (the promote share
 * gates), narrow it and a parked build has no exit at all. Neither failure raises anything — the screen
 * just quietly has the wrong number of doors.
 */
describe('endBuildPill', () => {
  it('a running turn shows Stop; a gate that offers cancel shows Discard', () => {
    expect(endBuildPill(true, false)).toBe('stop');
    expect(endBuildPill(false, true)).toBe('discard');
  });

  it('the running turn wins if both are somehow true', () => {
    // Exclusive in practice (a gate means `awaiting_confirm`, which holds no turn). Pinned so the
    // pill can never read "discard" while a turn is mid-write, which is the more destructive misread.
    expect(endBuildPill(true, true)).toBe('stop');
  });

  it('renders nothing where the gate deliberately offers no cancel', () => {
    // The promote share gates are confirm-only on purpose — declining to share must not mark a finished
    // promotion `cancelled` — and a terminal build has nothing left to end. Following the gate's own
    // action list rather than "is this build technically cancellable" is what keeps the pill honest.
    expect(endBuildPill(false, false)).toBeNull();
  });

  it('both of its labels resolve in both locales', () => {
    const before = lang.value;
    try {
      for (const l of ['en', 'ja'] as const) {
        lang.value = l;
        for (const key of ['stop', 'stopRunningBuild', 'discardOk', 'discardMsg']) {
          expect(t(key)).not.toBe(key);
        }
      }
    } finally {
      lang.value = before;
    }
  });
});

/**
 * endBuildCopy — the dialog the pill opens.
 *
 * WHY THIS TEST EXISTS. Caught in the browser, not in review: the pill was routed through
 * `cancelConfirmCopy` because both end a build, and a button reading 「ビルドを破棄」 opened a dialog
 * titled 「このビルドをキャンセルしますか？」. Nothing failed — the wrong word is just a hesitation, on the
 * one control in the app you cannot undo. The two vocabularies are older than this pill and are NOT
 * reconciled here; this pins that the pill stays on one side of the split.
 */
describe('endBuildCopy', () => {
  it('the dialog repeats the word written on the pill', () => {
    const before = lang.value;
    try {
      lang.value = 'ja';
      // The confirm button is the pill's own label, not a synonym of it.
      expect(t(endBuildCopy('discard').okKey)).toBe(t('discardOk'));
      expect(t(endBuildCopy('discard').titleKey)).toContain('破棄');
      expect(t(endBuildCopy('stop').titleKey)).toContain('停止');
      expect(t(endBuildCopy('stop').okKey)).toContain(t('stop'));
    } finally {
      lang.value = before;
    }
  });

  it('does NOT borrow the sidebar row wording for a parked build', () => {
    // The divergence is deliberate and is the fix itself: that row's × says 「キャンセル」 and this pill
    // says 「破棄」. Collapsing them here is what produced the mismatch above.
    expect(endBuildCopy('discard').okKey).not.toBe(cancelConfirmCopy('awaiting_confirm').okKey);
    // The running half genuinely IS the same sentence — same act, same words, nothing to diverge.
    expect(endBuildCopy('stop')).toEqual(cancelConfirmCopy('running'));
  });
});
