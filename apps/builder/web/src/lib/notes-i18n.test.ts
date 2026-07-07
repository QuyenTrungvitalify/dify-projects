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
  `all linters passed 'workflow' already exists in this project — using 'workflow_12' to avoid overwriting it. ` +
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
    expect(out).toContain('このプロジェクトに既に存在するため');
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

// ── Spec 045 — turn-failure triage notes reach a JA user in Japanese (AC 5) ─────────────────────
describe('localizeNotes (spec 045 — turn-failure triage frames)', () => {
  const CASES: Array<[en: string, jaFragment: string]> = [
    [
      "Claude CLI usage limit reached — builds cannot run until the limit resets. (You've hit your usage limit · resets 11:20pm)",
      'Claude CLIの利用上限に達しました',
    ],
    [
      'Claude CLI is not authenticated on this machine — run `claude` in a terminal and log in. (Invalid API key)',
      'Claude CLIが未認証です',
    ],
    [
      'Cannot reach the Anthropic API from this machine (network/proxy). (fetch failed)',
      'Anthropic APIに接続できません',
    ],
    [
      'failed to spawn claude process — is the `claude` CLI installed? (stderr: spawn claude ENOENT)',
      '`claude` CLIはインストールされていますか',
    ],
    [
      'process exited code 1 before a result event — stderr tail: (empty)',
      'プロセスが結果イベントの前に終了しました（exit 1）',
    ],
    [
      'phase timed out after 600s — retry or simplify',
      'フェーズが 600 秒でタイムアウトしました',
    ],
  ];

  it('ja: every triage frame translates; the verbatim stderr fragment stays literal', () => {
    setLang('ja');
    for (const [en, ja] of CASES) {
      const out = localizeNotes(en);
      expect(out, en).toContain(ja);
    }
    // the machine tail passes through untranslated
    expect(localizeNotes(CASES[0][0])).toContain('resets 11:20pm');
    expect(localizeNotes(CASES[3][0])).toContain('spawn claude ENOENT');
  });

  it('en: passes through unchanged', () => {
    setLang('en');
    for (const [en] of CASES) expect(localizeNotes(en)).toBe(en);
  });
});
