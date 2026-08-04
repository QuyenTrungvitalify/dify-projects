/**
 * Spec 030 (P2) — localizeNotes: the backend-built report `notes` English string follows the language
 * toggle, client-side (same spirit as tAction/ACTION_JA). EN passes through; JA translates each known
 * sentence frame while keeping interpolated slugs/URLs/paths literal, and leaves unknown text (validator
 * stderr, or a future wording drift in report.ts) untouched.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { localizeNotes, setLang } from './i18n';

afterEach(() => setLang('en'));

// The exact notes blob a from-scratch JP build produces (the reported case: workflow_12).
// Spec 064: the plugin advisory is now PLAIN (the old `deploy=none` / `unresolved_plugin_todo` /
// "plugin hash" jargon is no longer emitted into the human note).
const SAMPLE =
  `The workflow file passed every automated check. 'workflow' already exists in this project — using 'workflow_12' to avoid overwriting it. ` +
  `this workflow relies on a Dify plugin — install it in Dify Studio → Plugins if a run reports it missing.`;

// ── spec 066 S2/S3: the details this spec ADDS must localize ─────────────────────────────────────
// The preflight WRAPPER is framed, and it keeps `$1` (the needs-list) literal — so an unframed detail
// renders as a Japanese sentence with an English list inside it. That mixed render is the exact thing
// spec 064 set out to end, and the whole 066 finding came from a JP prompt, so the JA path is the
// primary audience. A test for the wrapper alone would have passed while the payload stayed English.
describe('localizeNotes (spec 066 — every ADDED string ships its frame)', () => {
  const ADDED: Array<[label: string, en: string, jaFragment: string]> = [
    ['S3 model (honest variant)',
      "an AI model — add one in Dify first (this workflow can't summarize or write without it)",
      'AI モデル — 先に Dify で追加してください'],
    ['087 S3 model (conditional variant — count unverifiable)',
      'the AI model (filled in automatically when you test, if your Dify has a model enabled — this could not be checked right now)',
      '今回は確認できませんでした'],
    ['S2 env_secret_empty',
      "a value for SLACK_WEBHOOK_URL — you'll paste this into Dify (the workflow can't run without it)",
      'SLACK_WEBHOOK_URL の値 — Dify に貼り付けてください'],
    ['S4 probe OK',
      'Checked automatically: Dify accepts this workflow file.',
      '自動チェック済み: このワークフローファイルは Dify に取り込めます。'],
    ['S4 probe OK + stray copy',
      'Checked automatically: Dify accepts this workflow file. (A temporary copy named "[probe] 123" was left in Dify — you can delete it.)',
      '"[probe] 123" という一時コピーが Dify に残っています'],
    ['S4 probe rejected', 'Dify rejected this workflow file — HTTP 400', 'Dify がこのワークフローファイルを受け付けませんでした'],
    ['S4 probe catch-branch', 'Could not check the import automatically (timeout)', '取り込みの自動チェックができませんでした（'],
  ];

  it('ja: each added string translates — no English payload survives', () => {
    setLang('ja');
    for (const [label, en, ja] of ADDED) {
      expect(localizeNotes(en), label).toContain(ja);
    }
  });

  it('ja: the real preflight blob localizes WHOLE — wrapper AND both details', () => {
    setLang('ja');
    // Exactly what runnability.ts emits for the dossier scenario (0-model workspace + an empty
    // referenced Slack secret) — the case that started spec 066.
    const out = localizeNotes(
      "Before this workflow can run, you need to: an AI model — add one in Dify first (this workflow " +
      "can't summarize or write without it); a value for SLACK_WEBHOOK_URL — you'll paste this into " +
      "Dify (the workflow can't run without it). (The build itself is finished — these are setup steps in Dify.)"
    );
    expect(out).toContain('次の準備が必要です');
    expect(out).toContain('AI モデル');
    expect(out).toContain('SLACK_WEBHOOK_URL の値');
    expect(out).not.toContain('add one in Dify first');
    expect(out).not.toContain("you'll paste this");
  });

  it('en: passes through unchanged', () => {
    setLang('en');
    for (const [label, en] of ADDED) expect(localizeNotes(en), label).toBe(en);
  });
});

describe('localizeNotes (spec 030 P2 — report notes follow the toggle)', () => {
  it('en: passes through unchanged (behaviour-equivalent to today)', () => {
    setLang('en');
    expect(localizeNotes(SAMPLE)).toBe(SAMPLE);
  });

  it('ja: translates every known frame, keeps interpolated slug names literal', () => {
    setLang('ja');
    const out = localizeNotes(SAMPLE);
    // frames translated
    expect(out).toContain('ワークフローファイルは自動チェックをすべて通過しました');
    expect(out).toContain('このプロジェクトに既に存在するため');
    // spec 064: the plain plugin advisory localizes WHOLE (no jargon in either language)
    expect(out).toContain('Dify のプラグインを使用します');
    expect(out).toContain('Studio → Plugins でインストール');
    // interpolated identifiers preserved verbatim
    expect(out).toContain("'workflow'");
    expect(out).toContain("'workflow_12'");
    // no English frame text survives
    expect(out).not.toContain('passed every automated check');
    expect(out).not.toContain('already exists');
    expect(out).not.toContain('relies on a Dify plugin');
    // spec 064/066: the retired jargon must not reappear in either language
    expect(out).not.toContain('プラグインハッシュ');
    expect(out).not.toContain('plugin hash');
    expect(out).not.toContain('リンター');
    expect(out).not.toContain('プリフライト');
    expect(out).not.toContain('アドバイザリ');
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

// ── Spec 057 S4 — the trigger-entry manual-enable advisory (report notes + ④ live reason) ───────
describe('localizeNotes (spec 057 S4 — trigger-entry frame)', () => {
  // Wording-stable: report.ts TRIGGER_ENTRY_NOTE byte-exact (also appended by live-test.ts).
  const EN =
    'trigger-entry workflow: an API run is a manual fire — the schedule/webhook only runs ' +
    'automatically after you ENABLE the trigger in Dify Studio Quick Settings';
  const JA =
    'トリガー起動のワークフローです。上のテスト実行は手動実行です — スケジュール/Webhook の自動起動は ' +
    'Studio の Quick Settings でトリガーを有効化した後に作動します';

  it('ja: translates the frame in full (no English residue)', () => {
    setLang('ja');
    expect(localizeNotes(EN)).toBe(JA);
  });

  it('ja: translates it embedded in a larger notes blob / appended to the live reason', () => {
    setLang('ja');
    const out = localizeNotes(`The workflow file passed every automated check. ${EN}`);
    expect(out).toContain('ワークフローファイルは自動チェックをすべて通過しました');
    expect(out).toContain('トリガー起動のワークフローです');
    expect(out).not.toContain('manual fire');
  });

  it('en: passes through unchanged', () => {
    setLang('en');
    expect(localizeNotes(EN)).toBe(EN);
  });
});
