/**
 * T6 — deriveSlugName (deterministic slug/name from the NL requirement) + firstFreeSlug (the F4
 * anti-clobber suffix). A wrong slug overwrites someone else's project, so the collision walk and
 * the 40-char cap (which must leave room for the suffix) are the load-bearing cases.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveSlugName, firstFreeSlug } from '../server/lib/orchestrator.js';
import { requirementName } from '../server/lib/scaffold.js';

describe('deriveSlugName', () => {
  test('strips stopwords, joins ≤4 content words, snake_cases the name', () => {
    const { slug, name } = deriveSlugName('A workflow that takes the input string and returns it uppercased');
    assert.equal(slug, 'workflow_input_string_uppercased');
    assert.equal(name, 'Workflow Input String Uppercased');
  });

  test('caps the join at 4 content words', () => {
    const { slug } = deriveSlugName('alpha beta gamma delta epsilon zeta');
    assert.equal(slug, 'alpha_beta_gamma_delta');
  });

  test('truncates to 40 chars, no trailing underscore', () => {
    const { slug } = deriveSlugName('abcdefghij klmnopqrst uvwxyzabcd efghijklmn opqrst');
    assert.ok(slug.length <= 40, `len ${slug.length}`);
    assert.ok(!slug.endsWith('_'));
  });

  test('empty / punctuation-only requirement → the safe "workflow" default', () => {
    assert.deepEqual(deriveSlugName(''), { slug: 'workflow', name: 'Workflow' });
    assert.equal(deriveSlugName('!!! ??? ...').slug, 'workflow');
  });
});

describe('firstFreeSlug (F4 anti-clobber — spec 030 D3: PER-PROJECT)', () => {
  const PROJ = 'my_app';

  test('free slug → returned unchanged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slug-'));
    assert.equal(firstFreeSlug(dir, PROJ, 'unused'), 'unused');
  });

  test('collision within the project → walks _2, _3, …', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slug-'));
    mkdirSync(join(dir, 'projects', PROJ, 'myflow'), { recursive: true });
    assert.equal(firstFreeSlug(dir, PROJ, 'myflow'), 'myflow_2');
    mkdirSync(join(dir, 'projects', PROJ, 'myflow_2'), { recursive: true });
    assert.equal(firstFreeSlug(dir, PROJ, 'myflow'), 'myflow_3');
  });

  test('collisions are scoped PER-PROJECT — the same slug is free in a different project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slug-'));
    mkdirSync(join(dir, 'projects', 'client_a', 'summarizer'), { recursive: true });
    // `summarizer` is taken in client_a but FREE in client_b (D3).
    assert.equal(firstFreeSlug(dir, 'client_a', 'summarizer'), 'summarizer_2');
    assert.equal(firstFreeSlug(dir, 'client_b', 'summarizer'), 'summarizer');
  });

  test('near-40-char slug reserves room for the suffix (never collapses back onto the collider)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slug-'));
    const base = 'a234567890123456789012345678901234567890'; // exactly 40 chars
    mkdirSync(join(dir, 'projects', PROJ, base), { recursive: true });
    const got = firstFreeSlug(dir, PROJ, base);
    assert.notEqual(got, base);
    assert.ok(got.length <= 40, `len ${got.length}`);
    assert.ok(got.endsWith('_2'));
  });
});

// spec 084 follow-up — the human DISPLAY name is the requirement prefix (original language), NOT the
// ASCII slug title-cased (which mangles VN diacritics into "Y U C U" and blanks CJK).
describe('requirementName (spec 084 follow-up — display name preserves the input language)', () => {
  test('Vietnamese keeps its diacritics (not shattered into single letters like "Y U C U")', () => {
    assert.equal(requirementName('yêu cầu tóm tắt văn bản'), 'yêu cầu tóm tắt văn bản');
    // the ASCII slug of the SAME input is the mangled one → name ≠ slug (the whole point).
    assert.notEqual(deriveSlugName('yêu cầu tóm tắt văn bản').name, requirementName('yêu cầu tóm tắt văn bản'));
  });
  test('Japanese is kept as-is (its ASCII slug blanks to the generic fallback)', () => {
    assert.equal(requirementName('文章を要約する'), '文章を要約する');
    assert.equal(deriveSlugName('文章を要約する').slug, 'workflow'); // slug meaningless → the name carries the meaning
  });
  test('collapses whitespace and truncates long input to 46 chars + ellipsis', () => {
    const long = 'Build a  workflow   that summarizes a long article into three concise sentences';
    const out = requirementName(long);
    assert.ok(out.endsWith('…'));
    assert.equal(out.length, 47); // 46 chars + the ellipsis
    assert.ok(!/\s\s/.test(out), 'whitespace collapsed');
  });
});
