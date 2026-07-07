/**
 * Spec 046 D4 — the docs↔contract drift pin. test.md (the human/CLI ④ procedure) and implement.md
 * (the ③ self-fix loop) each drifted to 3 linters when 038 promoted the 4th; nothing caught it. This
 * pin makes a 5th linter (or a rename) fail loudly until BOTH docs are updated. Plus the slug-charset
 * pin: spec.md once said `[a-z0-9_-]` while slug.ts never emits hyphens.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LINTERS } from '../server/lib/linters.js';

const SKILL = join(import.meta.dirname, '..', '..', '..', '.claude', 'skills', 'dify-build');

describe('spec 046 D4 — docs↔contract drift pin', () => {
  test('every LINTERS script appears in BOTH test.md and implement.md', () => {
    for (const doc of ['test.md', 'implement.md']) {
      const body = readFileSync(join(SKILL, doc), 'utf8');
      for (const l of LINTERS) {
        const base = l.script.split('/').pop()!;
        assert.ok(body.includes(base), `${doc} is missing linter ${base} — update the doc with the contract`);
      }
    }
  });

  test('spec.md carries a single slug charset, matching slug.ts ([a-z0-9_])', () => {
    const body = readFileSync(join(SKILL, 'spec.md'), 'utf8');
    assert.ok(!body.includes('[a-z0-9_-]'), 'spec.md must not re-grow the hyphen charset slug.ts never emits');
    assert.ok(body.includes('[a-z0-9_]'), 'the canonical charset stays documented');
  });
});
