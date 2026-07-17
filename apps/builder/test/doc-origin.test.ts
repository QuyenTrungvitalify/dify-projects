/**
 * An inlined phase doc must NAME its own path, or its relative links resolve against the wrong root.
 *
 * `runPhase` reads the phase doc and inlines its TEXT into the prompt, so the subprocess never learns
 * which file the text came from. Its cwd is the repo root, so the two links that actually appear in
 * `.claude/skills/dify-build/analyze.md` both miss:
 *
 *   [SKILL.md](SKILL.md)            → looked for at the repo root; the real file is
 *                                     .claude/skills/dify-build/SKILL.md — and it carries the ground
 *                                     rules every phase is ordered to read FIRST.
 *   [AGENTS.md](../../../AGENTS.md) → climbs three levels OUT of the repo.
 *
 * With no ground rules, each phase re-derived the shell-sandbox rules by trial and error (one Analyze
 * burned 8 consecutive hook-denied `find` calls; ~12 turns/run). `docOrigin` is the two-line header
 * that fixes it for every phase of every build.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { docOrigin } from '../server/lib/orchestrator.js';

const ANALYZE = '.claude/skills/dify-build/analyze.md';

describe('docOrigin', () => {
  test('names the doc, its directory, and resolves the SKILL.md link the doc actually contains', () => {
    const h = docOrigin(ANALYZE);
    assert.ok(h.includes(ANALYZE), 'the reader must learn which file this text is');
    assert.ok(h.includes('.claude/skills/dify-build/'), 'and the directory its relative links resolve from');
    assert.ok(
      h.includes('.claude/skills/dify-build/SKILL.md'),
      'the worked example must be the REAL resolution of [SKILL.md](SKILL.md) — the link that was missing'
    );
  });

  test('it is a prefix that leaves the document untouched below it', () => {
    const h = docOrigin(ANALYZE);
    assert.ok(h.endsWith('\n\n'), 'a blank line separates the header from the doc body');
    assert.ok(h.startsWith('>'), 'a blockquote reads as meta, not as part of the doc');
    // No {{TOKEN}}: the header rides through renderPrompt unchanged, so it cannot eat an inject var.
    assert.ok(!/\{\{|\}\}/.test(h), 'the header must carry no renderPrompt token');
  });

  test('the directory is derived, not hardcoded — it tracks whatever promptFile returns', () => {
    const h = docOrigin('.claude/skills/dify-build/implement.md');
    assert.ok(h.includes('.claude/skills/dify-build/implement.md'));
    const other = docOrigin('some/other/place/draft.md');
    assert.ok(other.includes('some/other/place/'), 'a moved skill dir must not need this code edited');
    assert.ok(other.includes('some/other/place/SKILL.md'));
  });
});
