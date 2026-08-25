// Regression lock for the c35cbfd bug: renaming a gate action label ('Skip import' →
// 'Finish without importing') removed its ACTION_JA entry, so a Japanese user saw raw English
// leak into the gate button. Gate labels translate by their ENGLISH STRING (i18n.ts ACTION_JA:
// `lang==='ja' ? ACTION_JA[label] ?? label : label`), so EVERY label gate.ts can emit must have a
// JA mapping or it silently falls back to English.
//
// Static cross-file check (server gate.ts ↔ web i18n.ts live in different packages, so we read the
// sources rather than importing across the boundary). It reads the same string literals the compiler
// does: add a CONFIRM/REPLY/CANCEL with a new label and this test fails until ACTION_JA gains the key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, '../server/lib/gate.ts');
const I18N = join(HERE, '../web/src/lib/i18n.ts');
const STORE = join(HERE, '../web/src/store.ts');

/** Every label string passed to CONFIRM/REPLY/CANCEL in gate.ts (labels are static single-quoted). */
function gateLabels(src: string): Set<string> {
  const out = new Set<string>();
  const re = /(?:CONFIRM|REPLY|CANCEL)\(\s*'[a-z_]+'\s*,\s*'([^']+)'\s*\)/g;
  for (const m of src.matchAll(re)) out.add(m[1]);
  return out;
}

/** The keys of the ACTION_JA dictionary in i18n.ts. */
function actionJaKeys(src: string): Set<string> {
  const block = src.match(/const ACTION_JA[^{]*\{([\s\S]*?)\n\};/);
  assert.ok(block, 'ACTION_JA block not found in i18n.ts — did it get renamed?');
  // Keys are either quoted ('Save as a new pattern' — needed for spaces) OR bare identifiers
  // (Discard:, Abandon: — valid unquoted). Scrape BOTH, or an unquoted key reads as "missing".
  const out = new Set<string>();
  for (const m of block![1].matchAll(/^\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*:/gm)) {
    out.add(m[1] ?? m[2]);
  }
  return out;
}

/** The resolution labels store.ts mints ITSELF — the other half of what reaches `tAction`, and the half
 *  the gate.ts scrape above is blind to. Three sources, because the label is minted three ways:
 *  `resolveLabel`'s returns, a literal `resolved:` assignment (the restore path), and the literal passed
 *  to `optimisticAdvance`. Only capitalised literals count: `optimisticAdvance(res, tr('...'))` passes an
 *  ALREADY-Japanese string through tAction and must not be scraped as a missing key. */
function storeResolvedLabels(src: string): Set<string> {
  const out = new Set<string>();
  const i = src.indexOf('function resolveLabel');
  assert.notEqual(i, -1, 'resolveLabel not found in store.ts — update this guard');
  const body = src.slice(i, src.indexOf('\n}', i));
  for (const m of body.matchAll(/'([A-Z][^']*)'/g)) out.add(m[1]);
  for (const m of src.matchAll(/resolved:\s*'([^']+)'/g)) out.add(m[1]);
  for (const m of src.matchAll(/optimisticAdvance\([^)]*?'([A-Z][^']*)'/g)) out.add(m[1]);
  return out;
}

test('every gate action label has a JA translation (no raw-English leak)', () => {
  const labels = gateLabels(readFileSync(GATE, 'utf8'));
  const ja = actionJaKeys(readFileSync(I18N, 'utf8'));

  assert.ok(labels.size >= 20, `sanity: expected to scrape many gate labels, got ${labels.size}`);
  assert.ok(labels.has('Finish without importing'), 'sanity: the renamed label should be scraped');

  const missing = [...labels].filter((l) => !ja.has(l));
  assert.deepEqual(
    missing,
    [],
    `Gate labels with no ACTION_JA entry (JA users would see raw English): ${missing.join(', ')}`,
  );
});

// The bug this one locks: a JA user cancelled a build, pressed Restore, and the card's receipt read a
// bare English 「Restored」 under three lines of Japanese. 'Done' and 'Errored' sat in the same hole.
// None of them are gate.ts labels — store.ts mints them — so the scrape above was green the whole time.
// A guard that only watches one producer of a shared dictionary key is a guard with a blind side.
test('every store-minted resolution label has a JA translation too', () => {
  const labels = storeResolvedLabels(readFileSync(STORE, 'utf8'));
  const ja = actionJaKeys(readFileSync(I18N, 'utf8'));

  // Sanity: the scrape must actually find all three mints, or an empty set would pass vacuously.
  for (const expected of ['Done', 'Errored', 'Cancelled', 'Continued', 'Restored', 'Requested changes']) {
    assert.ok(labels.has(expected), `sanity: '${expected}' should be scraped from store.ts`);
  }

  const missing = [...labels].filter((l) => !ja.has(l));
  assert.deepEqual(
    missing,
    [],
    `Resolution labels with no ACTION_JA entry (JA users would see raw English): ${missing.join(', ')}`,
  );
});
