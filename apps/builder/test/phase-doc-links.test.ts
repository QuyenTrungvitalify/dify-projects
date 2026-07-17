/**
 * A phase doc is INLINED into the prompt, so a relative link inside it cannot resolve.
 *
 * `runPhase` reads the doc and sends its TEXT; the subprocess's cwd is the repo root and it never
 * learns the doc's own path. A link like `[SKILL.md](SKILL.md)` is then looked for at the repo root
 * (it lives in .claude/skills/dify-build/), and `[AGENTS.md](../../../AGENTS.md)` climbs out of the
 * repo entirely.
 *
 * This is not theoretical — run 1784263317775 is the controlled experiment, three docs, one run:
 *
 *   implement.md — spells the path: `.claude/skills/dify-build/SKILL.md` → agent READ it →  1/14 calls denied
 *   spec.md      — `[SKILL.md](SKILL.md)`                                → never read     →  5/14 denied
 *   analyze.md   — `[SKILL.md](SKILL.md)`                                → never read     →  3/8  denied
 *
 * All five of spec's denials were the sandbox rules SKILL.md spells out (three `grep` attempts, two
 * pipes) — the very rules it calls "the #1 time-waster in the app". The doc had the answer; the link
 * to it was broken.
 *
 * So: inside a phase doc, reference repo files by their path FROM THE REPO ROOT, never relatively.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SKILL_DIR = '.claude/skills/dify-build';
const DOCS = ['analyze.md', 'spec.md', 'implement.md', 'draft.md', 'test.md'];

/** A markdown link target that is neither absolute-from-root, a URL, nor an anchor. */
const RELATIVE_LINK = /\]\((?!https?:|#|\/)([^)]+)\)/g;

describe('phase docs address repo files from the repo root (they are inlined, so relatives break)', () => {
  for (const name of DOCS) {
    const path = join(REPO, SKILL_DIR, name);
    if (!existsSync(path)) continue; // a doc may be retired; the ones present must hold

    test(`${name} has no relative markdown link`, () => {
      const body = readFileSync(path, 'utf8');
      const bad = [...body.matchAll(RELATIVE_LINK)].map((m) => m[1]);
      assert.deepEqual(
        bad,
        [],
        `${SKILL_DIR}/${name} links relatively to ${JSON.stringify(bad)}. The doc is inlined into the ` +
          `prompt, so the subprocess resolves this against the REPO ROOT and misses. Write the path ` +
          `from the repo root instead — e.g. \`${SKILL_DIR}/SKILL.md\`, as implement.md does.`
      );
    });

    test(`${name} points at SKILL.md by its full path, if it points at all`, () => {
      const body = readFileSync(path, 'utf8');
      if (!/SKILL\.md/.test(body)) return; // not every doc must cite it
      assert.ok(
        body.includes(`${SKILL_DIR}/SKILL.md`),
        `${name} mentions SKILL.md but never spells \`${SKILL_DIR}/SKILL.md\` — the form that is ` +
          `PROVEN to get read (implement.md), unlike the bare \`SKILL.md\` the other docs used.`
      );
    });
  }

  test('the ground rules the docs send the agent to actually exist and still name the sandbox limits', () => {
    // If SKILL.md ever stops documenting the deny-set, fixing the LINK stops being worth anything.
    const skill = readFileSync(join(REPO, SKILL_DIR, 'SKILL.md'), 'utf8');
    assert.match(skill, /Grep/, 'SKILL.md must still tell the agent the Grep TOOL is the way to search');
    assert.match(skill, /\bpipe\b|\bredirect\b/i, 'and that shell pipes/redirects are denied');
  });
});
