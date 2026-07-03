/**
 * Spec 032 A3 — parseAcceptanceCriteria extracts the `## Acceptance Criteria` list from SPEC.md into the
 * judge rubric. A wrong parse silently weakens (or fabricates) the live-test rubric, so it is tabled:
 * heading match (level-agnostic, case-insensitive), list-marker variety, checkbox strip, section end at
 * the next heading, and the absent-section → [] (smoke-test) degrade.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseAcceptanceCriteria } from '../server/lib/criteria.js';

describe('parseAcceptanceCriteria', () => {
  test('extracts the list under ## Acceptance Criteria, stops at the next heading', () => {
    const md = [
      '# My App',
      '**Goal** do things',
      '## Acceptance Criteria',
      '- Output is in Japanese',
      '- At most 3 bullet points',
      '* Mentions the source title',
      '',
      '## Open questions',
      '- not a criterion',
    ].join('\n');
    assert.deepEqual(parseAcceptanceCriteria(md), [
      'Output is in Japanese',
      'At most 3 bullet points',
      'Mentions the source title',
    ]);
  });

  test('handles numbered markers and strips a [ ]/[x] checkbox', () => {
    const md = ['## Acceptance Criteria', '1. First', '2) Second', '- [ ] Third', '- [x] Fourth'].join('\n');
    assert.deepEqual(parseAcceptanceCriteria(md), ['First', 'Second', 'Third', 'Fourth']);
  });

  test('heading is case-insensitive and level-agnostic; prose lines inside are ignored', () => {
    const md = ['### acceptance criteria (draft)', 'some intro prose, not a bullet', '- Real criterion'].join('\n');
    assert.deepEqual(parseAcceptanceCriteria(md), ['Real criterion']);
  });

  test('absent section → [] (judge degrades to smoke-test)', () => {
    assert.deepEqual(parseAcceptanceCriteria('# App\n**Goal** x\n## Nodes\n- a'), []);
    assert.deepEqual(parseAcceptanceCriteria(''), []);
  });

  test('empty section (heading, no items) → []', () => {
    assert.deepEqual(parseAcceptanceCriteria('## Acceptance Criteria\n\n## Next\n- x'), []);
  });

  test('fenced code block under the heading is ignored (F2 — no bogus criteria)', () => {
    const md = [
      '## Acceptance Criteria',
      '- Real one',
      '```yaml',
      '- name: not a criterion',
      '- provider: also not',
      '```',
      '- Real two',
    ].join('\n');
    assert.deepEqual(parseAcceptanceCriteria(md), ['Real one', 'Real two']);
  });

  test('a fenced ## heading before the real section does not enter early (F2)', () => {
    const md = ['```', '## Acceptance Criteria', '- fake', '```', '## Acceptance Criteria', '- real'].join('\n');
    assert.deepEqual(parseAcceptanceCriteria(md), ['real']);
  });
});
