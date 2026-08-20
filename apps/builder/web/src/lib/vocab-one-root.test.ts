// vocab-one-root.test.ts — spec 103 S1: one root word for one action.
//
// The measured problem (spec 103 §1.5): on a finished build the composer pill led with 変更 while the
// button an inch away on the same card led with 修正. The two mechanisms genuinely differ —
// the gate button ARMS the composer, the pill FIRES it — but the user cannot read that division of
// labour out of two different words, so they read it as two different features and hesitated over which
// one they were supposed to press.
//
// 修正 is now the single root. This file pins the RUNTIME half — that the surfaces which used to
// disagree now resolve to the same string through the real dictionary. The static grep over web/src
// lives in the server suite (test/vocab-one-root.test.ts), which is where cross-package source checks
// live and where node types exist.
import { describe, it, expect } from 'vitest';
import { t, tAction, lang, type Lang } from './i18n';

describe('103 S1 · one root word for "change this build"', () => {
  it('the composer pill and the gate button now say the SAME thing in Japanese', () => {
    // These were the two surfaces that rendered side by side on a finished build.
    lang.value = 'ja';
    expect(t('modeChange')).toBe('修正を依頼');
    expect(t('requestFix')).toBe('修正を依頼');
  });

  it('the ② gate reply keeps its own noun but joins the same verb', () => {
    // 「仕様を編集」→「仕様を修正」: editing the spec is a different OBJECT, not a different ACTION.
    // These arrive from the server as English labels and are mapped by `tAction`, not `t`.
    lang.value = 'ja';
    expect(tAction('Edit spec')).toBe('仕様を修正');
    expect(tAction('Request changes')).toBe('修正を依頼');
  });

  it('every language the app actually ships resolves the new spec-stale line', () => {
    // Lang is 'en' | 'ja' — there is no VI dictionary, and a test asserting three would be asserting a
    // language that does not exist. If a third is ever added, this list is where it must be declared.
    for (const l of ['en', 'ja'] as Lang[]) {
      lang.value = l;
      const s = t('gateSpecStale');
      expect(s.length).toBeGreaterThan(0);
      expect(s).not.toBe('gateSpecStale'); // a missing key falls through to its own name
    }
  });
});
