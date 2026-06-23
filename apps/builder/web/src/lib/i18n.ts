/* ============================================================
   i18n.ts — UI-chrome localization (EN ⇆ JA), client-side only.
   Same pattern as the theme toggle: a @preact/signals signal +
   localStorage, no server involvement. Components read strings via
   t()/tf(), which read `lang.value` during render → they auto-
   subscribe and re-render on a language switch.

   SCOPE (v1): fixed UI strings only. LLM/tool-generated content —
   the streamed run output, SPEC.md, YAML, diff, report details,
   error/lint lines — stays in whatever language the build produced
   (out of scope; that needs a prompt/server change).

   EN values are byte-identical to the original hardcoded strings,
   so English behavior (and the string-asserting unit tests) is
   unchanged; only `ja` adds a second column.
   ============================================================ */
import { signal } from '@preact/signals';
import type { PhaseKey } from '../types';

export type Lang = 'en' | 'ja';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'en' || saved === 'ja') return saved;
  } catch {
    /* ignore */
  }
  return 'en';
}

export const lang = signal<Lang>(initialLang());

export function setLang(l: Lang): void {
  lang.value = l;
  try {
    localStorage.setItem('lang', l);
  } catch {
    /* ignore */
  }
}

export function toggleLang(): void {
  setLang(lang.value === 'ja' ? 'en' : 'ja');
}

type Dict = Record<string, string>;

const EN: Dict = {
  /* chat-top / shell */
  newTask: 'New task',
  toggleSidebar: 'Toggle sidebar',
  stop: 'Stop',
  stopRunningBuild: 'Stop the running build',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  artifact: 'Artifact',
  switchToDark: 'Switch to dark theme',
  switchToLight: 'Switch to light theme',
  switchToEnglish: 'Switch to English',
  switchToJapanese: '日本語に切り替え',
  changeLanguage: 'Change language',

  /* empty / new-task surface */
  phDescribeWorkflow: 'Describe the workflow or change…',
  seedFrom: 'SEED FROM',
  noSeedApps: 'No seed apps — connect Dify to seed from a workspace app. New workflows start from scratch.',
  none: 'none',
  try: 'TRY',
  phReplyOrDescribe: 'Reply, or describe another change…',
  phDescribeAnother: 'Describe another change to start a new build…',
  openIt: 'Open it',

  /* stop-build confirm (shared App + Sidebar) */
  stopBuildTitle: 'Stop this build?',
  stopBuildMsg: "Cancel <c>{name}</c>? Its running turn will be stopped and this phase's progress discarded.",
  stopBuild: 'Stop build',

  /* destructive gate confirms (spec 016 D4) */
  acceptAnywayTitle: 'Ship a workflow that failed validation?',
  acceptAnywayMsg: 'The linters did not pass after the cap-5 attempts. Accepting marks this build done with the failure recorded — the workflow may not run correctly in Dify.',
  acceptAnywayOk: 'Accept anyway',
  importConfirmTitle: 'Import to your self-hosted Dify?',
  importConfirmMsg: "Push <c>{file}</c> to your Dify workspace. This creates a NEW app — it won't update an existing one.",
  importConfirmOk: 'Import',
  discardTitle: 'Discard this build?',
  discardMsg: 'Abandon this build. The spec and any artifacts so far stay on disk, but the build is closed.',
  discardOk: 'Discard build',

  /* phase labels */
  phase_analyze: 'Analyze',
  phase_spec: 'Spec',
  phase_implement: 'Implement',
  phase_test: 'Test',

  /* disclosure */
  running: 'Running',
  stoppedDuring: 'Stopped during',
  working: 'Working…',

  /* gate — meta + per-state copy */
  phaseMeta: 'phase {idx} / 4',
  phaseMeta4: 'phase 4 / 4',
  exit1: 'exit 1',
  gateErrorBadge: 'Phase failed',
  gateErroredTitle: '{phase} errored',
  gateErrorSummary: 'No files were written. Retry re-runs only this phase from the approved input.',
  gateCancelledBadge: 'Cancelled',
  gateCancelledTitle: 'Build abandoned',
  gateCancelledSummary: 'Cancelled by user — the spec/artifacts so far are preserved.',
  restoreBuild: 'Restore build',
  gateDoneBadge: 'Done',
  gateDoneTitle: 'Test passed — workflow updated',
  gateDoneSummary1: 'Linters re-run on the produced main.yml.',
  gateDoneSummary2: 'Open the report in the panel for the details.',
  gateFailBadge: 'Lint still failing',
  gateFailTitle: 'Still failing after the cap-5 attempts',
  gateFailSummary1: 'The agent self-corrected as far as it could in one turn.',
  gateFailSummary2: 'Your call: accept anyway, keep trying, or abandon.',
  gateAnalyzeBadge: 'Analyze complete',
  gateAnalyzeTitle: 'Ready to write the spec',
  gateAnalyzeSummary1: 'Requirement analyzed.',
  gateAnalyzeSummary2: 'Continue to draft the spec, or request changes.',
  gatePattern: 'Pattern: {pattern}',
  gateSpecBadge: 'Spec ready',
  gateSpecTitle: 'Spec drafted — review before I build',
  gateSpecSummary1: 'SPEC.md is editable in the panel — tweak it before implement (last-writer wins).',
  gateImplBadge: 'Implemented',
  gateImplTitle: 'main.yml built and linted',
  gateImplSummary1: 'Workflow YAML generated; all linters green.',
  gateReadyBadge: 'Ready',
  gateReadyTitle: 'Continue',

  /* deploy gate — awaiting_import (spec 016 D1) */
  gateImportBadge: 'Ready to deploy',
  gateImportTitle: 'Import {file} to your self-hosted Dify',
  gateImportSummary1: 'Import pushes the linted workflow to your Dify workspace.',
  gateImportSummary2: "Dify import always creates a NEW app — re-importing duplicates it (it won't update an existing app in place).",
  gateImportSummary3: 'Skip finishes the build locally without deploying.',
  gateImportSummaryEdit: "You're editing <c>{workflow}</c> — importing still creates a separate new app, not an update to it.",

  /* gate links */
  openSpec: 'open SPEC.md',
  viewDiff: 'view diff',
  openReport: 'open report',

  /* gate reply */
  phWhatShouldChange: 'What should change before continuing?',
  cancel: 'Cancel',
  sendRerun: 'Send & re-run',

  /* composer settings */
  workflow: 'Workflow',
  confirm: 'Confirm',
  deploy: 'Deploy',
  workflowFixed: 'workflow target is fixed when the build starts',
  confirmModeHint: 'change confirm-mode once the build pauses at a gate',
  deployFixed: 'deploy target is fixed when the build starts',
  setAtStart: 'set when the build started — not changeable mid-build',
  noneNew: 'none (new)',
  eachStep: 'each step',
  specOnly: 'spec only',
  auto: 'auto',
  selfhost: 'selfhost',
  cloud: 'cloud',

  /* composer file attachments (spec 012 → 025) */
  attachFile: 'Attach file',
  removeFile: 'Remove file',
  dropFiles: 'Drop files to attach',

  /* sidebar */
  projects: 'Projects',
  newProject: 'New project',
  newTaskInWorkflow: 'New task in this workflow',
  noTasksYet: 'no tasks yet',
  inProgress: 'In progress',
  noProjectsYet: 'No projects yet',
  cancelThisBuild: 'Cancel this build',
  hintGate: 'gate',
  hintRunning: 'running',

  /* create-project modal */
  createProject: 'Create Project',
  close: 'Close',
  projectName: 'Project name',
  phProjectName: 'e.g. Eiken, TOEIC, Internal tools…',
  selectFolders: 'Select folder(s)',
  remove: 'Remove',
  addFolder: 'Add Folder',
  foldersLinked: '{n} folder{s} linked',
  skip: 'Skip',
  createProjectBtn: 'Create project',
  ok: 'OK',

  /* artifact panel */
  hidePanel: 'Hide panel',
  newWorkflow: 'new workflow',
  tab_spec: 'Spec',
  tab_diff: 'Diff',
  tab_report: 'Report',

  /* spec tab */
  specEdit: 'Edit',
  specPreview: 'Preview',
  specSplit: 'Split',
  noSpecYet: 'No SPEC.md yet — it appears after the Spec phase.',
  nothingToPreview: 'Nothing to preview yet.',
  saving: 'Saving…',
  saveSpec: 'Save spec',
  savedFeedsImplement: 'Saved · feeds Implement',
  unsavedChanges: 'Unsaved changes',
  tokenRedacted: 'API token redacted · never shown',
  tbBold: 'Bold',
  tbItalic: 'Italic',
  tbStrike: 'Strikethrough',
  tbInlineCode: 'Inline code',
  tbH1: 'Heading 1',
  tbH2: 'Heading 2',
  tbH3: 'Heading 3',
  tbBullet: 'Bullet list',
  tbNumbered: 'Numbered list',
  tbQuote: 'Quote',
  tbCodeBlock: 'Code block',
  tbLink: 'Link',
  tbVariable: 'Variable',

  /* yaml tab */
  yamlLines: 'yaml · {n} lines',
  noYamlYet: 'No main.yml yet — it appears after the Implement phase.',
  lintResults: 'Lint results',
  lintOk: 'ok',
  copyYaml: 'Copy',
  copied: 'Copied',

  /* diff tab */
  splitDiff: 'Split diff',
  noDiffYet: 'No diff yet — a diff appears once a workflow is seeded from a Dify app or pattern.',
  diffBinary: 'Binary or oversized diff — not shown.',
  diffNoChanges: 'No textual changes in this file.',

  /* report tab */
  runReport: 'Run report',
  noReportYet: 'No report yet — it appears after the Test phase.',
  rWorkflowFile: 'Workflow file',
  rLint: 'Lint',
  rDeploy: 'Deploy',
  rAccepted: 'Accepted',
  rLintAllPassed: 'all passed',
  rLintFailures: 'failures recorded',
  rNotDeployed: 'not deployed (local)',
  rLintOverridden: 'lint failure overridden (human)',
  deployedTag: 'DEPLOYED · {deploy}',
  open: 'Open',
  noteCloud: 'Cloud deploy — import the YAML manually in Dify Studio (steps in the notes below; the YAML is in the main.yml tab).',
  noteSelfhost: 'Not imported — use the Import button, or check Dify (see notes).',
  noteDeployOff: 'Deploy is off — no app URL. Set Deploy ≠ none to import & get a link.',
};

const JA: Dict = {
  /* chat-top / shell */
  newTask: '新規タスク',
  toggleSidebar: 'サイドバーの切り替え',
  stop: '停止',
  stopRunningBuild: '実行中のビルドを停止',
  live: 'ライブ',
  reconnecting: '再接続中…',
  artifact: '成果物',
  switchToDark: 'ダークテーマに切り替え',
  switchToLight: 'ライトテーマに切り替え',
  switchToEnglish: 'Switch to English',
  switchToJapanese: '日本語に切り替え',
  changeLanguage: '言語を変更',

  /* empty / new-task surface */
  phDescribeWorkflow: 'ワークフローや変更内容を入力…',
  seedFrom: 'ベースにする',
  noSeedApps: 'シードアプリがありません — Dify を接続するとワークスペースのアプリをベースにできます。新規ワークフローはゼロから作成されます。',
  none: 'なし',
  try: '例',
  phReplyOrDescribe: '返信、または別の変更を入力…',
  phDescribeAnother: '別の変更を入力して新しいビルドを開始…',
  openIt: '開く',

  /* stop-build confirm */
  stopBuildTitle: 'このビルドを停止しますか？',
  stopBuildMsg: '<c>{name}</c> をキャンセルしますか？ 実行中のターンが停止され、このフェーズの進捗は破棄されます。',
  stopBuild: 'ビルドを停止',

  /* destructive gate confirms (spec 016 D4) */
  acceptAnywayTitle: '検証に失敗したワークフローを出力しますか？',
  acceptAnywayMsg: '最大5回の試行後もリンターが通りませんでした。承認するとこのビルドは失敗を記録したうえで完了扱いになります — Dify で正しく動作しない可能性があります。',
  acceptAnywayOk: 'このまま承認',
  importConfirmTitle: 'セルフホストの Dify にインポートしますか？',
  importConfirmMsg: '<c>{file}</c> を Dify ワークスペースに送信します。新しいアプリが作成されます — 既存のアプリは更新されません。',
  importConfirmOk: 'インポート',
  discardTitle: 'このビルドを破棄しますか？',
  discardMsg: 'このビルドを中止します。これまでの仕様や成果物はディスクに残りますが、ビルドは閉じられます。',
  discardOk: 'ビルドを破棄',

  /* phase labels */
  phase_analyze: '分析',
  phase_spec: '仕様',
  phase_implement: '実装',
  phase_test: 'テスト',

  /* disclosure */
  running: '実行中',
  stoppedDuring: '停止しました：',
  working: '処理中…',

  /* gate */
  phaseMeta: 'フェーズ {idx} / 4',
  phaseMeta4: 'フェーズ 4 / 4',
  exit1: 'exit 1',
  gateErrorBadge: 'フェーズ失敗',
  gateErroredTitle: '{phase} でエラー',
  gateErrorSummary: 'ファイルは書き込まれていません。再試行すると、承認済みの入力からこのフェーズだけを再実行します。',
  gateCancelledBadge: 'キャンセル',
  gateCancelledTitle: 'ビルドを中止しました',
  gateCancelledSummary: 'ユーザーによりキャンセルされました — これまでの仕様・成果物は保持されます。',
  restoreBuild: 'ビルドを復元',
  gateDoneBadge: '完了',
  gateDoneTitle: 'テスト合格 — ワークフローを更新しました',
  gateDoneSummary1: '生成された main.yml に対してリンターを再実行しました。',
  gateDoneSummary2: '詳細はパネルのレポートを開いてください。',
  gateFailBadge: 'リンターが失敗のまま',
  gateFailTitle: '最大5回の試行後も失敗しています',
  gateFailSummary1: 'エージェントは1ターンでできる限り自己修正しました。',
  gateFailSummary2: '判断してください：このまま承認、再試行を続ける、または中止。',
  gateAnalyzeBadge: '分析完了',
  gateAnalyzeTitle: '仕様を書く準備ができました',
  gateAnalyzeSummary1: '要件を分析しました。',
  gateAnalyzeSummary2: '続けて仕様を起草するか、変更を依頼してください。',
  gatePattern: 'パターン: {pattern}',
  gateSpecBadge: '仕様準備完了',
  gateSpecTitle: '仕様を起草しました — ビルド前にご確認ください',
  gateSpecSummary1: 'SPEC.md はパネルで編集できます — 実装前に調整してください（後勝ち）。',
  gateImplBadge: '実装完了',
  gateImplTitle: 'main.yml をビルドしリンターを実行しました',
  gateImplSummary1: 'ワークフロー YAML を生成、すべてのリンターが成功。',
  gateReadyBadge: '準備完了',
  gateReadyTitle: '続行',

  /* deploy gate — awaiting_import (spec 016 D1) */
  gateImportBadge: 'デプロイ準備完了',
  gateImportTitle: '{file} をセルフホストの Dify にインポート',
  gateImportSummary1: 'インポートすると、リンター済みのワークフローが Dify ワークスペースに送信されます。',
  gateImportSummary2: 'Dify のインポートは常に新しいアプリを作成します — 再インポートすると複製されます（既存アプリはその場で更新されません）。',
  gateImportSummary3: 'スキップするとデプロイせずにローカルでビルドを完了します。',
  gateImportSummaryEdit: '<c>{workflow}</c> を編集中です — インポートしても別の新規アプリが作成され、このアプリは更新されません。',

  /* gate links */
  openSpec: 'SPEC.md を開く',
  viewDiff: '差分を表示',
  openReport: 'レポートを開く',

  /* gate reply */
  phWhatShouldChange: '続行する前に何を変更しますか？',
  cancel: 'キャンセル',
  sendRerun: '送信して再実行',

  /* composer settings */
  workflow: 'ワークフロー',
  confirm: '確認',
  deploy: 'デプロイ',
  workflowFixed: 'ワークフローの対象はビルド開始時に固定されます',
  confirmModeHint: 'ビルドがゲートで一時停止したら確認モードを変更できます',
  deployFixed: 'デプロイ対象はビルド開始時に固定されます',
  setAtStart: 'ビルド開始時に設定されます — ビルド中は変更できません',
  noneNew: 'なし（新規）',
  eachStep: '各ステップ',
  specOnly: '仕様のみ',
  auto: '自動',
  selfhost: 'セルフホスト',
  cloud: 'クラウド',

  /* composer file attachments (spec 012 → 025) */
  attachFile: 'ファイルを添付',
  removeFile: 'ファイルを削除',
  dropFiles: 'ファイルをドロップして添付',

  /* sidebar */
  projects: 'プロジェクト',
  newProject: '新規プロジェクト',
  newTaskInWorkflow: 'このワークフローに新規タスク',
  noTasksYet: 'タスクはまだありません',
  inProgress: '進行中',
  noProjectsYet: 'プロジェクトはまだありません',
  cancelThisBuild: 'このビルドをキャンセル',
  hintGate: 'ゲート',
  hintRunning: '実行中',

  /* create-project modal */
  createProject: 'プロジェクトを作成',
  close: '閉じる',
  projectName: 'プロジェクト名',
  phProjectName: '例：英検、TOEIC、社内ツール…',
  selectFolders: 'フォルダを選択',
  remove: '削除',
  addFolder: 'フォルダを追加',
  foldersLinked: '{n} 個のフォルダをリンク済み',
  skip: 'スキップ',
  createProjectBtn: 'プロジェクトを作成',
  ok: 'OK',

  /* artifact panel */
  hidePanel: 'パネルを隠す',
  newWorkflow: '新規ワークフロー',
  tab_spec: '仕様',
  tab_diff: '差分',
  tab_report: 'レポート',

  /* spec tab */
  specEdit: '編集',
  specPreview: 'プレビュー',
  specSplit: '分割',
  noSpecYet: 'SPEC.md はまだありません — 仕様フェーズの後に表示されます。',
  nothingToPreview: 'プレビューする内容がまだありません。',
  saving: '保存中…',
  saveSpec: '仕様を保存',
  savedFeedsImplement: '保存済み · 実装に反映',
  unsavedChanges: '未保存の変更',
  tokenRedacted: 'API トークンは秘匿 · 表示されません',
  tbBold: '太字',
  tbItalic: '斜体',
  tbStrike: '取り消し線',
  tbInlineCode: 'インラインコード',
  tbH1: '見出し1',
  tbH2: '見出し2',
  tbH3: '見出し3',
  tbBullet: '箇条書き',
  tbNumbered: '番号付きリスト',
  tbQuote: '引用',
  tbCodeBlock: 'コードブロック',
  tbLink: 'リンク',
  tbVariable: '変数',

  /* yaml tab */
  yamlLines: 'yaml · {n} 行',
  noYamlYet: 'main.yml はまだありません — 実装フェーズの後に表示されます。',
  lintResults: 'リンター結果',
  lintOk: 'ok',
  copyYaml: 'コピー',
  copied: 'コピーしました',

  /* diff tab */
  splitDiff: '分割差分',
  noDiffYet: '差分はまだありません — Dify アプリやパターンからシードすると差分が表示されます。',
  diffBinary: 'バイナリまたはサイズ超過の差分 — 表示されません。',
  diffNoChanges: 'このファイルにテキストの変更はありません。',

  /* report tab */
  runReport: '実行レポート',
  noReportYet: 'レポートはまだありません — テストフェーズの後に表示されます。',
  rWorkflowFile: 'ワークフローファイル',
  rLint: 'リンター',
  rDeploy: 'デプロイ',
  rAccepted: '承認',
  rLintAllPassed: 'すべて成功',
  rLintFailures: '失敗を記録',
  rNotDeployed: '未デプロイ（ローカル）',
  rLintOverridden: 'リンター失敗を上書き承認（人間）',
  deployedTag: 'デプロイ済み · {deploy}',
  open: '開く',
  noteCloud: 'クラウドデプロイ — Dify Studio で YAML を手動インポートしてください（手順は下記のノート、YAML は main.yml タブにあります）。',
  noteSelfhost: '未インポート — インポートボタンを使うか、Dify を確認してください（ノート参照）。',
  noteDeployOff: 'デプロイはオフ — アプリ URL はありません。インポートしてリンクを得るには Deploy を「なし」以外に設定してください。',
};

const DICT: Record<Lang, Dict> = { en: EN, ja: JA };

/* Gate action / resolution labels are produced by the SERVER in English (gate.ts) and reach the dumb
   renderer as display strings. To localize without a server change we map them here, keyed by their
   stable English text (the action `id` alone is ambiguous — 'continue'/'changes' differ per phase).
   Unknown labels pass through unchanged. */
const ACTION_JA: Dict = {
  'Continue to Spec': '仕様へ進む',
  'Request changes': '変更を依頼',
  'Implement this spec': 'この仕様で実装',
  'Edit spec': '仕様を編集',
  'Continue to Test': 'テストへ進む',
  'Accept anyway': 'このまま承認',
  'Keep trying': '再試行を続ける',
  Abandon: '中止',
  'Import to Dify': 'Dify にインポート',
  'Skip import': 'インポートをスキップ',
  'Retry phase': 'フェーズを再試行',
  'Discard build': 'ビルドを破棄',
  /* resolved-state labels (store.ts resolveLabel / reply) */
  Cancelled: 'キャンセル済み',
  Continued: '続行済み',
  'Requested changes': '変更を依頼済み',
};

/** Localize a server-provided gate action / resolution label (keyed by its English text). */
export function tAction(label: string): string {
  return lang.value === 'ja' ? ACTION_JA[label] ?? label : label;
}

/** Translate a key for the current language (EN fallback, then the raw key). Reading lang.value here
 *  subscribes the calling component, so a language switch re-renders it. */
export function t(key: string): string {
  const l = lang.value;
  return DICT[l][key] ?? EN[key] ?? key;
}

/** Like t(), with {placeholder} substitution. `{s}` is a convenience plural marker for English.
 *  The replacement is a function so a value containing `$` (e.g. a task name) is inserted literally,
 *  not interpreted as a String.replace special pattern ($&, $1, …). */
export function tf(key: string, params: Record<string, string | number>): string {
  let out = t(key);
  for (const [k, v] of Object.entries(params)) {
    out = out.replace(new RegExp('\\{' + k + '\\}', 'g'), () => String(v));
  }
  return out;
}

/** Localized phase label by canonical key (PHASE_LABELS stays the English index table for logic/tests). */
export function phaseLabel(key: PhaseKey): string {
  return t('phase_' + key);
}
