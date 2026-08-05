/**
 * Doc↔gate contract audit (spec 091 follow-up) — every promise between the phase docs and the code
 * that enforces them, checked from BOTH sides on every commit.
 *
 * The 071→085→091 saga was one repeating failure: a doc instructs command X, the gate denies X, and
 * the drift stays invisible until a real build burns turns on it (`find.py --name "…"` — the 076 E2b
 * intent pass — was dead for its entire life, ≥54 denials; `marketplace.py` was doc-instructed and
 * hook-denied until 085 S1b). No review process makes a human read both sides on every edit; this
 * file does it mechanically.
 *
 * SCOPE (honest): only backticked literal/template commands of the shape `.venv/bin/python tools/…`
 * inside the TURN docs are checked — commands written any other way are NOT covered. ④ test.md is
 * excluded: it is a backend procedure, its commands never meet the gate.
 *
 * NOT here (already guarded elsewhere — a copy of a guard is the disease this file fights):
 *   - linter set ts↔py↔campaign  → tests/test_campaign.py::test_lint_keys_match_linters_contract
 *   - hint WORDING + decisions    → permission-gate-hints.test.ts (this file adds the missing half:
 *     EVERY hint in the SUBSTITUTE map, end-to-end through decide(), not analyzeBashCommand)
 *
 * CALIBRATION FIRST (the 2026-08-06 lesson: an uncalibrated instrument produced 4 false positives
 * and missed the one known-true positive): the extractor and the gate-path must reproduce known
 * answers before any contract verdict below is trusted.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from '../server/hooks/permission-gate.js';
import { PHASES } from '../server/lib/phases.js';
import type { Task } from '../server/state/task.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILDER = join(HERE, '..');
const REPO = join(BUILDER, '..', '..');
const SKILL = join(REPO, '.claude', 'skills', 'dify-build');
const read = (p: string): string => readFileSync(p, 'utf8');

/** The REAL pipeline (091 §0 lesson: never test a sub-function — checkForbiddenPath runs first). */
const gate = (command: string): string =>
  decide({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: REPO } as unknown as Parameters<typeof decide>[0]).decision;

/** A doc snippet → the concrete command an agent would run, or null when it is prose, not a command.
 *  Calibrated over 4 rounds (2026-08-06): per-line blockquote strip BEFORE joining (a joined `>`
 *  reads as a redirect), `…` = prose abbreviation, tokens substituted (the agent never sees `{{…}}`),
 *  `<placeholder>` → kw, `[optional]` dropped. */
function concretize(raw: string): string | null {
  let c = raw.split('\n').map((l) => l.replace(/^\s*>\s?/, '').trim()).join(' ').trim();
  if (c.includes('…')) return null;
  c = c
    .replace(/\{\{TASK_ID\}\}/g, '1785900000000')
    .replace(/\{\{PROJECT\}\}/g, 'p')
    .replace(/\{\{WORKFLOW_SLUG\}\}/g, 's')
    .replace(/\{\{WORKFLOW_FILE\}\}/g, 'main.yml')
    .replace(/\{\{[A-Z_]+\}\}/g, 'x')
    .replace(/<[^>]*>/g, 'kw')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return c.includes('tools/') ? c : null;
}

const COMMAND_RE = /`([^`]*?(?:\.venv\/bin\/python|python3?)\s+tools\/[^`]*?)`/gs;
/** Docs whose text is INLINED into a turn prompt (phases.ts promptFile + the promote turn). */
const TURN_DOCS = ['analyze.md', 'spec.md', 'draft.md', 'implement.md', 'promote.md', 'SKILL.md'];

function extractAll(): Array<{ doc: string; cmd: string }> {
  const out: Array<{ doc: string; cmd: string }> = [];
  for (const doc of TURN_DOCS) {
    for (const m of read(join(SKILL, doc)).matchAll(COMMAND_RE)) {
      const cmd = concretize(m[1]);
      if (cmd) out.push({ doc, cmd });
    }
  }
  return out;
}

const fakeTask = {
  taskId: 'T1', project: 'p', workflowSlug: 's', workflowFile: 'main.yml', requirement: 'r',
  seedPath: null, artifacts: {}, fastMode: false,
} as never as Task;

// ── K. CALIBRATION — known answers first; a failure here means NO verdict below is trustworthy ──
describe('K calibration (instrument reproduces known truth)', () => {
  test('K1: the historically-dead E2b command is ALLOWED post-091', () => {
    assert.equal(gate('.venv/bin/python tools/dify_base/find.py --name "kw kw" --full'), 'allow');
  });
  test('K2: the 015-C2 quote-split secret bypass stays DENIED forever', () => {
    assert.equal(gate(`cat apps/builder/.e''nv`), 'deny');
  });
  test('K3: extractor POSITIVE — a piped command in doc-shaped text is seen and would be flagged', () => {
    const cmd = concretize('.venv/bin/python tools/dify_base/find.py --has kw 2>&1 | head -50');
    assert.ok(cmd, 'extractor kept the runnable-but-bad command');
    assert.equal(gate(cmd!), 'deny', 'the checker CAN catch a bad doc command');
  });
  test('K4: extractor NEGATIVE — prose abbreviation (`…`) is skipped, never a false positive', () => {
    assert.equal(concretize('.venv/bin/python tools/…'), null);
  });
  test('K5: anchor — analyze.md still carries the find.py --name command this guard exists for', () => {
    const cmds = extractAll().filter((e) => e.doc === 'analyze.md' && e.cmd.includes('--name'));
    assert.ok(cmds.length >= 1, 'the E2b intent-pass command is extracted from analyze.md');
  });
});

// ── C2 — every command a phase doc INSTRUCTS must pass the gate ─────────────────────────────────
describe('C2 doc-instructed commands pass the gate', () => {
  test('all extracted commands → decide() allow (denied list must be empty)', () => {
    const all = extractAll();
    // Extractor-rot floor: today this finds 10 commands. Falling under 8 means the extraction
    // broke (doc format drifted past the regex) — fail LOUDLY instead of green-by-blindness.
    assert.ok(all.length >= 8, `extractor rotted: only ${all.length} commands found (floor 8)`);
    const denied = all
      .map((e) => ({ ...e, decision: gate(e.cmd) }))
      .filter((e) => e.decision === 'deny');
    assert.deepEqual(
      denied.map((d) => `${d.doc}: ${d.cmd}`), [],
      'a phase doc instructs a command the gate denies — fix the doc or the gate, never ship the contradiction'
    );
  });
});

// ── C3 — EVERY denial hint names a door that decide() actually opens ────────────────────────────
describe('C3 denial hints point at allowed doors (full SUBSTITUTE map, real pipeline)', () => {
  test('each hinted command → allow', () => {
    const src = read(join(BUILDER, 'server', 'hooks', 'permission-gate.ts'));
    const map = src.match(/const SUBSTITUTE[\s\S]*?\n\]\);/)?.[0];
    assert.ok(map, 'SUBSTITUTE map not found — update this extraction');
    const hints = [...map!.matchAll(/`(\.venv\/bin\/python[^`]+)`/g)].map((m) => m[1]);
    assert.ok(hints.length >= 3, `hint-extractor rotted: ${hints.length} found`);
    for (const h of hints) {
      const cmd = concretize(h);
      assert.ok(cmd, `hint is not concretizable: ${h}`);
      assert.equal(gate(cmd!), 'allow', `a denial hint names a door the gate keeps shut: ${h}`);
    }
  });
});

// ── C1 — the token map phases.ts emits ↔ the table SKILL.md documents ───────────────────────────
describe('C1 token map ↔ SKILL.md table', () => {
  test('every emitted token is documented, and the "all N" claim matches', () => {
    const md = read(join(SKILL, 'SKILL.md'));
    const documented = new Set([...md.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]));
    const emitted = new Set<string>();
    for (const p of PHASES) if (p.injectVars) for (const k of Object.keys(p.injectVars(fakeTask))) emitted.add(k);
    const missing = [...emitted].filter((k) => !documented.has(k));
    assert.deepEqual(missing, [], 'phases.ts emits tokens SKILL.md does not document');
    const claimed = md.match(/all (\d+) always substituted/);
    assert.ok(claimed, 'SKILL.md "all N always substituted" claim not found');
    assert.equal(Number(claimed![1]), emitted.size, 'the token COUNT claim drifted (serially mislabeled before 090)');
  });
});

// ── C4 — e2e-suite predicate keys ⊆ e2e_check vocabulary ────────────────────────────────────────
describe('C4 suite predicates ↔ e2e_check vocabulary', () => {
  test('no unknown expect-keys at commit time', () => {
    // NUANCE: the RUNTIME degrade (unknown key → MANUAL row) is a DELIBERATE 058 contract for
    // split-version runs and stays. This check only pins commit-time sync in the monorepo, where
    // suite and checker ship together: a typo'd key here means the intended assertion never runs.
    const suite = read(join(BUILDER, 'scripts', 'e2e-suite.yml'));
    const checker = read(join(BUILDER, 'scripts', 'e2e_check.py'));
    const vocab = checker.match(/KNOWN_PREDICATES[^=]*=\s*\{([\s\S]*?)\n\}/)?.[1];
    assert.ok(vocab, 'KNOWN_PREDICATES not found — update this extraction');
    const known = new Set([...vocab!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
    assert.ok(known.size >= 7, `vocabulary-extractor rotted: ${known.size} keys`);
    const used = new Set([...suite.matchAll(/^\s{6}([a-z_]+):/gm)].map((m) => m[1]));
    const unknown = [...used].filter((k) => !known.has(k));
    assert.deepEqual(unknown, [], 'suite uses expect-keys the checker does not know — they would silently become MANUAL');
  });
});

// ── C6 — each phase doc names the artifact path verify will stat ────────────────────────────────
describe('C6 skill names the artifact path verify stats', () => {
  test('every phase doc mentions its artifactRel shape (token or shorthand form)', () => {
    const misses: string[] = [];
    for (const p of PHASES) {
      const rel = p.artifactRel(fakeTask);
      const doc = read(join(SKILL, `${p.id}.md`));
      const canonical = rel
        .replace('T1', '{{TASK_ID}}')
        .replace('/p/', '/{{PROJECT}}/')
        .replace('/s/', '/{{WORKFLOW_SLUG}}/');
      const shapes = [
        canonical,
        canonical.replace('apps/builder/.runs/', '.runs/'), // documented shorthand (relocateRunArtifacts reconciles)
        canonical.replace('main.yml', '{{WORKFLOW_FILE}}'),
        canonical.replace('apps/builder/.runs/', '.runs/').replace('main.yml', '{{WORKFLOW_FILE}}'),
      ];
      const named = shapes.some((s) => doc.includes(s)) || doc.includes('{{SPEC_PATH}}');
      if (!named) misses.push(`${p.id}: doc never names ${rel}`);
    }
    assert.deepEqual(misses, [], 'a phase doc does not name the path verify will stat — the 090 ambiguity class');
  });
});
