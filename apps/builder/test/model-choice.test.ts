/**
 * Spec 096 — the start-bound model choice.
 *
 * Before this, NOTHING in the repo chose a model: `claude-session.ts` had stripped the option, the
 * headless settings named none, and `--setting-sources local` even excludes the operator's own
 * ~/.claude preference. The model was ambient, and it drifted across three real builds
 * (haiku+opus, haiku+opus, all-haiku) while `cost.ts` faithfully recorded which one had run. That is
 * a measurement hole as much as a quality one: a before/after campaign could credit a prompt change
 * for a model change.
 *
 * Two properties are worth defending, and both are here:
 *   1. the flag is passed ONLY when asked — an absent choice must leave the spawn byte-identical to
 *      pre-096, so every task created before this shipped keeps behaving as it did;
 *   2. an unrecognised value is DROPPED, never coerced to the default — a typo that silently ran a
 *      different model than the one requested is the failure this whole spec exists to end.
 *
 * The aliases themselves were verified against the real CLI under the Builder's own flags on
 * 2026-08-12: opus→claude-opus-5, sonnet→claude-sonnet-5, haiku→claude-haiku-4-5-20251001,
 * fable→claude-fable-5. Aliases, not pinned ids, so "newest of that family" stays true over releases.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_CHOICES, DEFAULT_MODEL, normalizeModel } from '../server/state/task.js';
import { buildSpawnArgs } from '../server/lib/claude-session.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('096 · normalizeModel', () => {
  test('every offered alias round-trips', () => {
    for (const m of MODEL_CHOICES) assert.equal(normalizeModel(m), m);
  });

  test('case and padding are tolerated (a hand-typed curl / a copied value)', () => {
    assert.equal(normalizeModel('  OPUS '), 'opus');
    assert.equal(normalizeModel('Haiku'), 'haiku');
  });

  test('a full model id maps back to its family alias', () => {
    // Storing the alias (not the id) is the point: a task re-run months later should get that
    // family's newest model, not a version frozen at the moment someone clicked.
    assert.equal(normalizeModel('claude-opus-5'), 'opus');
    assert.equal(normalizeModel('claude-sonnet-5'), 'sonnet');
    assert.equal(normalizeModel('claude-haiku-4-5-20251001'), 'haiku');
    assert.equal(normalizeModel('claude-fable-5'), 'fable');
  });

  test('absent / unknown ⇒ undefined, NOT the default', () => {
    // Load-bearing. `undefined` is what keeps `--model` off the spawn, which is what makes a pre-096
    // task behave exactly as before. Defaulting here would silently pin every old task to opus, and
    // would turn a typo into "ran something else than you asked".
    for (const raw of [undefined, null, '', '   ', 'gpt-4o', 'opusss', 'claude', 'best']) {
      assert.equal(normalizeModel(raw), undefined, `${JSON.stringify(raw)} must not resolve`);
    }
  });

  test('the default is the first (most capable) offered choice', () => {
    assert.equal(DEFAULT_MODEL, MODEL_CHOICES[0]);
    assert.equal(DEFAULT_MODEL, 'opus', '③ Implement is where the graph, the cost and the risk are');
  });
});

describe('096 · the spawn passes --model only when chosen', () => {
  const base = {
    taskId: '1700000000001',
    workingDir: '/tmp',
    settingsPath: '/tmp/headless-settings.json',
    log: { info() {}, warn() {}, error() {} } as never,
  };

  test('chosen ⇒ `--model <alias>` present exactly once', () => {
    const argv = buildSpawnArgs({ ...base, model: 'opus' });
    const i = argv.indexOf('--model');
    assert.notEqual(i, -1, `--model missing from: ${argv.join(' ')}`);
    assert.equal(argv[i + 1], 'opus');
    assert.equal(argv.filter((a) => a === '--model').length, 1);
  });

  test('omitted ⇒ no `--model` at all, and the argv is the pre-096 set', () => {
    const argv = buildSpawnArgs(base);
    assert.equal(argv.includes('--model'), false, `--model must not appear: ${argv.join(' ')}`);
    // The exact pre-096 flag set, so "unchanged for an old task" is a checked fact, not a claim.
    assert.deepEqual(argv, [
      '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'acceptEdits',
      '--settings', '/tmp/headless-settings.json',
      '--setting-sources', 'local',
    ]);
  });

  test('--resume still precedes everything (the one ordering that matters)', () => {
    const argv = buildSpawnArgs({ ...base, model: 'haiku', resumeSessionId: 'sess-1' });
    assert.deepEqual(argv.slice(0, 2), ['--resume', 'sess-1']);
    assert.ok(argv.indexOf('--model') > 1);
  });
});

/**
 * The CALL SITES. The display rule lives in web/src/model-chip.test.ts, but the bug that actually
 * shipped three times in one sitting was never the rule — it was a Settings object built without
 * `model`, twice, plus a `?? 'opus'` fallback that made the omission look like a deliberate choice.
 * Typecheck passed all three times (the field is optional, by necessity — a pre-096 task has none).
 *
 * So pin it as what it is: a source-shape fact. Same technique as the prompt-file guards above, and it
 * lives here because reading source needs node fs, which the web tsconfig has no types for.
 */
describe('096 · every composer that can spawn a turn offers the model', () => {
  const WEB = join(HERE, '..', 'web', 'src', 'components');
  const app = readFileSync(join(WEB, 'App.tsx'), 'utf8');
  const chat = readFileSync(join(WEB, 'Chat.tsx'), 'utf8');

  // The chip has its OWN props rather than riding `settings` — precisely because `settings` vanishes
  // where build settings are meaningless (a finished build) while the MODEL is still in force there:
  // ask.ts spawns follow-up questions with `task.model`. Folding it into `settings` hid a live value.
  /**
   * The three composers, anchored by a prop unique to each rather than by slicing JSX. Slicing was the
   * first attempt and it was wrong twice over: `<Composer` also matches the type `<ComposerAttachment[]>`
   * in a useState, and cutting to the first `/>` can overrun into the NEXT element, so an unwired
   * composer could borrow its neighbour's `onModel` and the assert would pass.
   */
  const ANCHORS: Array<[name: string, anchor: RegExp]> = [
    ['entry (new task)', /onSend=\{\(\) => send\(\)\}/],
    ['in-task (running/parked build)', /lockConfirm=\{busy\}/],
    ['terminal (finished build — the reported gap)', /canChange=\{terminalFixable\}/],
  ];

  test('there are exactly three composers (a new one must be considered here too)', () => {
    // `[\s]` after the name so the ComposerAttachment TYPE is not counted as an element.
    assert.equal([...app.matchAll(/<Composer[\s]/g)].length, 3);
  });

  for (const [name, anchor] of ANCHORS) {
    test(`${name} offers the model`, () => {
      const at = app.search(anchor);
      assert.notEqual(at, -1, `anchor for the ${name} composer not found — did the wiring move?`);
      // Look in a window around the anchor: props of one element, not the whole file.
      const window = app.slice(Math.max(0, at - 1200), at + 1200);
      assert.match(
        window,
        /onModel=\{/,
        `the ${name} composer can send a message, so it must show and let you change the model — ` +
          'without it a turn spawns with one the user can neither see nor change'
      );
    });
  }

  test('the terminal composer is one of them (the reported gap)', () => {
    // A done build's composer omits `settings` by design (no next boundary for workflow/confirm/fast),
    // which is exactly how the model chip went missing there while ask turns kept using it.
    const terminal = app.slice(app.indexOf('canChange={terminalFixable}'));
    assert.match(terminal.slice(0, 900), /onModel=\{/, 'the finished-build composer must offer it too');
  });

  test('in-task and terminal both PATCH (a label that changes nothing is a lie)', () => {
    assert.equal(
      [...app.matchAll(/store\.patchModel\(/g)].length,
      2,
      'both task-bound composers must forward the change to PATCH /api/tasks/:id'
    );
  });

  test('the chip renders off its own prop, not `settings.model`', () => {
    assert.match(chat, /\{onModel && \(/, 'gated on onModel, so it survives a settings-less composer');
    assert.doesNotMatch(chat, /value=\{settings\.model/, 'must not read the build-settings object');
  });

  test('not start-bound-locked, but not mid-turn either', () => {
    const chip = chat.slice(chat.indexOf("label={tr('model')}"), chat.indexOf("title={tr('modelHint')}"));
    assert.doesNotMatch(chip, /disabled=\{lockStartBound\}/, 'model is changeable after start by design');
    assert.match(chip, /disabled=\{lockConfirm\}/, 'but not mid-turn — that write would be clobbered');
  });

  test('no default-value fallback (that fallback WAS the lie)', () => {
    assert.doesNotMatch(
      chat,
      /model \?\? '(opus|sonnet|haiku|fable)'/,
      'a chip must never assert a model nobody picked'
    );
  });
});
