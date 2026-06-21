/* ============================================================
   data.ts — static UI seed text only.
   The mock fixtures that drove the design shell (TREE / GATES /
   RUN_DETAIL / SPEC_MD / YAML / DIFF / REPORT) were replaced by
   the live store + /api responses in lat4-ui; only the new-task
   suggestion prompts remain (they are UI copy, not backend data).
   Localized (EN/JA) — see lib/i18n.ts.
   ============================================================ */
import { lang } from './lib/i18n';

const SUGGESTIONS_EN: string[] = [
  'A workflow that takes a topic string and returns a 3-sentence summary',
  'Classify an incoming support email into {billing, bug, other} with a reason',
  'Extract the title, authors and abstract from a pasted paper, as JSON',
];

const SUGGESTIONS_JA: string[] = [
  'トピック文字列を受け取り、3文の要約を返すワークフロー',
  'サポートメールを {billing, bug, other} に理由付きで分類する',
  '貼り付けた論文からタイトル・著者・要旨を JSON で抽出する',
];

/** Suggestions for the current language. A function (not a const) so it re-evaluates per render and
 *  follows the language toggle. */
export function suggestions(): string[] {
  return lang.value === 'ja' ? SUGGESTIONS_JA : SUGGESTIONS_EN;
}
