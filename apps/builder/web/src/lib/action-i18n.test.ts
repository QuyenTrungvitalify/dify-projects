/**
 * The RUNTIME half of the raw-English-leak guard. `test/gate-i18n-labels.test.ts` (server suite) is a
 * source scrape: it proves the ACTION_JA dictionary holds a key. It cannot prove the key resolves — a
 * duplicate key later in the object literal, or a typo'd label at the call site, both leave the scrape
 * green while a Japanese user still reads English. This file goes through `tAction` itself.
 *
 * The observed bug: a cancelled build, Restore pressed, and the card's receipt read a bare English
 * 「Restored」 sitting under three lines of Japanese. 'Done' and 'Errored' had the same hole.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { tAction, lang } from './i18n';

afterEach(() => {
  lang.value = 'en';
});

describe('tAction · resolution labels store.ts mints client-side', () => {
  // Every label `resolveLabel` / the restore path / `optimisticAdvance` can put in a gate's `resolved`.
  const RESOLVED: [en: string, ja: string][] = [
    ['Done', '完了'],
    ['Errored', 'エラーで終了'],
    ['Cancelled', 'キャンセル済み'],
    ['Continued', '続行済み'],
    ['Restored', '復元済み'],
    ['Requested changes', '修正を依頼済み'],
  ];

  it('every one of them resolves to Japanese — none falls through in English', () => {
    lang.value = 'ja';
    for (const [en, ja] of RESOLVED) {
      expect(tAction(en), `'${en}' leaks raw English into a JA card`).toBe(ja);
      expect(tAction(en)).not.toBe(en);
    }
  });

  it('English mode still passes them through untouched', () => {
    lang.value = 'en';
    for (const [en] of RESOLVED) expect(tAction(en)).toBe(en);
  });

  it('an unknown label degrades to itself rather than to undefined', () => {
    // The fallback is what keeps an in-flight build with a cached older label renderable at all.
    lang.value = 'ja';
    expect(tAction('Some future label')).toBe('Some future label');
  });

  it('a label already translated by `t` survives tAction unchanged', () => {
    // store.ts hands `optimisticAdvance` a `tr('runTestWithWorkflow')` result — already Japanese — and it
    // reaches the same `tAction(resolved)` render. It must not be mangled by a second lookup.
    lang.value = 'ja';
    expect(tAction('ワークフローでテスト')).toBe('ワークフローでテスト');
  });
});
