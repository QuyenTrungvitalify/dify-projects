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

  // Spec 048 D3: implement.md's de-accretion promises, pinned mechanically — before 048 NOTHING
  // asserted the ③ language banner or the Output-language section of THIS file (review finding 3.3),
  // and the structural checklist was enumerated twice (drift bait — each copy grew independently).
  test('implement.md keeps the 🌐 banner + Output-language section, and ONE structural checklist', () => {
    const body = readFileSync(join(SKILL, 'implement.md'), 'utf8');
    assert.ok(body.includes('🌐 **LANGUAGE — obey before anything else.**'), 'the ③ language banner survives');
    assert.match(body, /^## Output language$/m, 'the Output-language section survives');
    const copies = body.match(/`kind: app`/g) ?? [];
    assert.equal(copies.length, 1, 'the mandatory-elements checklist occurs exactly once (048 D3)');
    assert.ok(body.includes('advanced-chat: `answer` instead'), 'the trivial-branch delta survived the merge (048 r2)');
  });
});
