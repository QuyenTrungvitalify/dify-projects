// vocab-one-root.test.ts — spec 103 S1: one root word for one action.
//
// The measured problem (spec 103 §1.5): on a finished build the composer pill said 「変更を依頼」 while
// the button an inch away on the same card said 「修正を依頼」. The two mechanisms genuinely differ —
// the gate button ARMS the composer, the pill FIRES it — but the user cannot read that division of
// labour out of two different words, so they read it as two different features and hesitated over which
// one they were supposed to press.
//
// 修正 is now the single root. This file is the grep that keeps it single: add a surface that says
// 変更を依頼 and it goes red.
//
// It lives in the SERVER suite (not web/) by the same convention as gate-i18n-labels.test.ts: this is a
// static cross-package source check, and only this package has node types. It also catches the strings
// the web unit tests cannot — the prose that NAMES the button inside an unrelated summary, which is
// exactly where the four surviving instances were hiding.
//
// Scope note: only the phrase 「変更を依頼」 is banned, not the word 変更 — 「変更履歴」(the change log
// spec 103 L0 appends to SPEC.md) and 「変更点」(what a fix changed) are the right words for their jobs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_SRC = join(HERE, '../web/src');
// TWO forms, and the second one is why this list exists. The first pass banned only 「変更を依頼」 and
// shipped green — while the composer's own PLACEHOLDER still read 「質問または変更依頼を入力…」, the
// most-read string on the screen, because it uses the compound 変更依頼 with no を. A ban that misses
// the busiest surface is a ban that proves nothing.
const BANNED = ['変更を依頼', '変更依頼'];

/** Every source file under web/src, minus `dist/` — the committed production bundle carries whatever
 *  string was current when it was last built, so grepping it would fail on a stale artifact and pass on
 *  a fresh one. That measures the build, not the vocabulary. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'dist' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx|css|html)$/.test(name)) out.push(p);
  }
  return out;
}

test('103 S1 — no form of the old wording survives in web/src (dist/ excluded: it is a build artifact)', () => {
  const hits = sources(WEB_SRC)
    .filter((p) => {
      const src = readFileSync(p, 'utf8');
      return BANNED.some((b) => src.includes(b));
    })
    .map((p) => relative(WEB_SRC, p));
  // The four that survived the first pass were all PROSE naming the button, not the button itself:
  // the ① gate summary, the promote distill-failed summary, the ask-anomaly message, and the
  // past-tense resolution label. A key-by-key review would have missed every one of them.
  assert.deepEqual(hits, [], `still saying 「${BANNED.join('」/「')}」 in: ${hits.join(', ')}`);
});

test('103 S1 — the server still emits the English labels ACTION_JA is keyed by (no architecture change)', () => {
  // S1 moves DISPLAY STRINGS only. The gate action labels are the stable keys the JA map is keyed by
  // (gate-i18n-labels.test.ts pins the mapping itself); renaming one here would silently un-map it.
  const gate = readFileSync(join(HERE, '../server/lib/gate.ts'), 'utf8');
  assert.ok(gate.includes("REPLY('changes', 'Request changes')"), "the 'Request changes' label moved");
  assert.ok(gate.includes("REPLY('changes', 'Edit spec')"), "the 'Edit spec' label moved");
});

test('103 Lane B — canPropose gates on `artifacts.implement`, the key that actually exists', () => {
  // `task.artifacts` is keyed by PHASE ID (runPhase writes `artifacts[sessKey]`), so the workflow path
  // lives under `implement`. Gating on `artifacts.yaml` — which is a key of the SEPARATE
  // `artifactContents` object — silently disabled the whole feature: the expression is always
  // undefined, the caret never rendered, and nothing failed. A static check because the predicate is
  // an inline JSX expression with no unit-test seam of its own.
  const app = readFileSync(join(HERE, '../web/src/components/App.tsx'), 'utf8');
  const m = app.match(/const canPropose\s*=\s*([^;]+);/);
  assert.ok(m, 'canPropose is no longer a named const — update this guard');
  assert.match(m![1], /artifacts\?\.implement/, 'must read artifacts.implement');
  assert.ok(!/artifacts\?\.yaml/.test(m![1]), 'artifacts.yaml does not exist on the wire task');

  // And the key really is written by the phase id, not invented here.
  const orch = readFileSync(join(HERE, '../server/lib/orchestrator.ts'), 'utf8');
  assert.match(orch, /task\.artifacts\[sessKey\] = phase\.artifactRel\(task\)/);
});

test('103 — undo / drop / apply re-read the panel from disk', () => {
  // `setTaskValue` carries the previous `artifactContents` forward whenever a snapshot omits them.
  // Correct for a running phase (SSE sends no contents); WRONG right after undo / drop / apply, which
  // MOVE FILES and then settle without a fresh GET. The panel then renders text the disk no longer
  // holds — and after a drop that text is the REJECTED draft, now titled `SPEC.md` (the draft banner
  // keys on `specRevise`, just cleared) with Save re-enabled. One click writes the declined plan into
  // the live spec. Observed live: a drop from a finished build left exactly that state on screen.
  //
  // Static, and in the SERVER suite, because the seam is a store side-effect with nothing to assert on
  // and `node:fs` is unavailable in the web vitest environment.
  const store = readFileSync(join(HERE, '../web/src/store.ts'), 'utf8');
  const bodyOf = (sig: string): string => {
    const i = store.indexOf(sig);
    assert.notEqual(i, -1, `${sig} not found — update this guard`);
    const rest = store.slice(i);
    return rest.slice(0, rest.indexOf('\n}'));
  };
  assert.match(bodyOf('export async function undoFix('), /refreshArtifacts\(\)/);
  const confirmBody = bodyOf('export async function confirm(');
  assert.match(confirmBody, /drop_spec/);
  assert.match(confirmBody, /apply_spec/);
  assert.match(confirmBody, /refreshArtifacts\(\)/);
});
