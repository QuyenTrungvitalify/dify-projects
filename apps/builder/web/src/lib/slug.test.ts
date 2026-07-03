/**
 * Spec 031 D2/risk-4 — the client projectSlug/PROJECT_NAME_RE must agree with the server on the same
 * fixtures (server outputs hard-coded here from state/task.ts `sanitizeSlug` + lib/project-create.ts).
 * If the server rule changes, this pins the drift so the modal preview never lies about the folder.
 */
import { describe, test, expect } from 'vitest';
import { projectSlug, isValidProjectName, PROJECT_NAME_RE } from './slug';

describe('projectSlug — agrees with server sanitizeSlug on valid names', () => {
  const cases: Array<[string, string]> = [
    ['Eiken Grammar', 'eiken_grammar'],
    ['TOEIC', 'toeic'],
    ['  Internal Tools  ', 'internal_tools'],
    ['rubric-v2', 'rubric_v2'],
    ['export_csv', 'export_csv'],
    ['A  B   C', 'a_b_c'],
  ];
  for (const [name, slug] of cases) {
    test(`${JSON.stringify(name)} → ${slug}`, () => expect(projectSlug(name)).toBe(slug));
  }
});

describe('PROJECT_NAME_RE / isValidProjectName — D3 gate', () => {
  test('accepts English + space/_/- names', () => {
    for (const n of ['Eiken', 'Eiken Grammar', 'rubric-v2', 'export_csv', 'a1'])
      expect(isValidProjectName(n)).toBe(true);
  });
  test('rejects non-English, leading underscore, and punctuation', () => {
    for (const n of ['英検', '日本語ツール', '_drafts', '-lead', 'grammar!', ''])
      expect(isValidProjectName(n)).toBe(false);
  });
  test('the exported regex is the exact server mirror', () => {
    expect(PROJECT_NAME_RE.source).toBe('^[A-Za-z0-9][A-Za-z0-9 _-]*$');
  });
});
