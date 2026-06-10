/* ============================================================
   data.ts — static UI seed text only.
   The mock fixtures that drove the design shell (TREE / GATES /
   RUN_DETAIL / SPEC_MD / YAML / DIFF / REPORT) were replaced by
   the live store + /api responses in lat4-ui; only the new-task
   suggestion prompts remain (they are UI copy, not backend data).
   ============================================================ */

export const SUGGESTIONS: string[] = [
  'A workflow that takes a topic string and returns a 3-sentence summary',
  'Classify an incoming support email into {billing, bug, other} with a reason',
  'Extract the title, authors and abstract from a pasted paper, as JSON',
];
