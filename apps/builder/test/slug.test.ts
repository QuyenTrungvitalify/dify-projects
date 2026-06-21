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

describe('firstFreeSlug (F4 anti-clobber)', () => {
  test('free slug → returned unchanged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slug-'));
    assert.equal(firstFreeSlug(dir, 'unused'), 'unused');
  });

  test('collision → walks _2, _3, …', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slug-'));
    mkdirSync(join(dir, 'projects', 'myflow'), { recursive: true });
    assert.equal(firstFreeSlug(dir, 'myflow'), 'myflow_2');
    mkdirSync(join(dir, 'projects', 'myflow_2'), { recursive: true });
    assert.equal(firstFreeSlug(dir, 'myflow'), 'myflow_3');
  });

  test('near-40-char slug reserves room for the suffix (never collapses back onto the collider)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slug-'));
    const base = 'a234567890123456789012345678901234567890'; // exactly 40 chars
    mkdirSync(join(dir, 'projects', base), { recursive: true });
    const got = firstFreeSlug(dir, base);
    assert.notEqual(got, base);
    assert.ok(got.length <= 40, `len ${got.length}`);
    assert.ok(got.endsWith('_2'));
  });
});
