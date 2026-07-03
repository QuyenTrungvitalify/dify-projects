/**
 * Spec 030 (P2) — localizeNotes: the backend-built report `notes` English string follows the language
 * toggle, client-side (same spirit as tAction/ACTION_JA). EN passes through; JA translates each known
 * sentence frame while keeping interpolated slugs/URLs/paths literal, and leaves unknown text (validator
 * stderr, or a future wording drift in report.ts) untouched.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { localizeNotes, setLang } from './i18n';

afterEach(() => setLang('en'));

// The exact notes blob a from-scratch JP build produced (the reported case: workflow_12).
const SAMPLE =
  `all linters passed 'workflow' already exists — using 'workflow_12' to avoid overwriting it. ` +
  `deploy=none (no Dify contact). unresolved_plugin_todo: dependencies are empty but a ` +
  `"# TODO add plugin hash" remains — add the plugin hash before deploying.`;

describe('localizeNotes (spec 030 P2 — report notes follow the toggle)', () => {
  it('en: passes through unchanged (behaviour-equivalent to today)', () => {
    setLang('en');
    expect(localizeNotes(SAMPLE)).toBe(SAMPLE);
  });

  it('ja: translates every known frame, keeps interpolated slug names literal', () => {
    setLang('ja');
    const out = localizeNotes(SAMPLE);
    // frames translated
    expect(out).toContain('すべてのリンターが成功しました');
    expect(out).toContain('は既に存在するため');
    expect(out).toContain('Dify への接続なし');
    expect(out).toContain('プラグインハッシュを追加');
    // interpolated identifiers preserved verbatim
    expect(out).toContain("'workflow'");
    expect(out).toContain("'workflow_12'");
    // no English frame text survives
    expect(out).not.toContain('all linters passed');
    expect(out).not.toContain('already exists');
    expect(out).not.toContain('no Dify contact');
    expect(out).not.toContain('before deploying');
  });

  it('ja: unknown text passes through untouched (graceful on wording drift)', () => {
    setLang('ja');
    const novel = 'some brand-new note frame that is not mapped yet';
    expect(localizeNotes(novel)).toBe(novel);
  });

  it('ja: lint-failure prefix translated, raw validator stderr detail kept English', () => {
    setLang('ja');
    const out = localizeNotes('lint failures recorded: validate exit 1: dangling ref foo');
    expect(out).toContain('リンター失敗を記録: ');
    expect(out).toContain('validate exit 1: dangling ref foo'); // detail untouched (Non-goals §)
  });
});
