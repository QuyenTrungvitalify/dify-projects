/**
 * Spec 030 (content-language sync, Option B) — the "## Output language" directive guard.
 *
 * Option B adds NO code: the two SPEC-authoring skill bodies (draft.md on the fast path, spec.md on the
 * standard path) carry an identical directive telling the model to author prose in the REQUIREMENT's
 * language while pinning identifiers to English. These tests guard the checked-in directive so a future
 * edit can't silently regress it:
 *   (1) both bodies carry a "## Output language" section, byte-identical (drift guard, spec §2);
 *   (2) the section still names the load-bearing boundary rules (a gutted directive is caught);
 *   (3) renderPrompt substitutes {{REQUIREMENT}} (any language, intact) and leaves no stray inject
 *       token, while PRESERVING the {{#node.field#}} Dify-ref example the directive shows the model.
 *
 * No real turn is rendered — this is a pure prompt-shape assertion over the checked-in files.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderPrompt, PHASES } from '../server/lib/phases.js';
import { detectLang, languagePin, resolveLang } from '../server/lib/language.js';
import type { Task } from '../server/state/task.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..', '..', '.claude', 'skills', 'dify-build');
const read = (f: string): string => readFileSync(join(SKILL, f), 'utf8');

/** Extract the "## Output language" section: its heading up to (excluding) the next "## " heading.
 *  FENCE-AWARE: the section shows the model a markdown template that itself contains a `## …` line, and
 *  a naive scan ends the section there — silently shrinking what the drift guard below actually checks. */
function outputLanguageSection(body: string): string {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => l.trim() === '## Output language');
  assert.notEqual(start, -1, 'body must carry a "## Output language" section');
  let end = lines.length;
  let inFence = false;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith('```')) inFence = !inFence;
    else if (!inFence && lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trimEnd();
}

/** The `spec` phase inject map — it renders BOTH draft.md and spec.md (spec §Depends on). */
const mapFor = (requirement: string): Record<string, string> =>
  PHASES.find((p) => p.id === 'spec')!.injectVars({
    taskId: '1751000000000',
    project: null,
    workflowSlug: null,
    requirement,
    fastMode: true,
  } as Task);

describe('030 · Output-language directive (drift + render guard)', () => {
  test('draft.md and spec.md carry a byte-identical "## Output language" section', () => {
    assert.equal(
      outputLanguageSection(read('draft.md')),
      outputLanguageSection(read('spec.md')),
      'the directive must be identical across the two SPEC authors (drift guard)'
    );
  });

  test('the directive names the load-bearing boundary (not gutted)', () => {
    const s = outputLanguageSection(read('draft.md'));
    // The two tiers must BOTH be named. A directive that only says "write in the requirement's language"
    // is the pre-093 one: it made a Vietnamese-speaking user read Japanese gate questions. A directive
    // that only says "write in the chat language" is worse — it translates the client's deliverable.
    assert.match(s, /chat language/i, 'tier ①: chat prose follows the chat language');
    assert.match(s, /language of `\{\{REQUIREMENT\}\}`/, 'tier ②: what lands in SPEC.md follows the requirement');
    assert.match(s, /review appendix in the CHAT language/, 'the bilingual review section survives');
    assert.match(s, /Keep these in English\/ASCII exactly/);
    assert.match(s, /\{\{#node\.field#\}\}/, 'the ref-format example must be shown');
    assert.match(s, /`type` values/);
  });

  for (const [label, requirement] of [
    ['JP', '簡単ワークフロー作成して'],
    ['VI', 'Tạo workflow tóm tắt văn bản tiếng Việt'],
    ['EN', 'create a simple text summarizer'],
  ] as const) {
    for (const file of ['draft.md', 'spec.md'] as const) {
      test(`${label} · ${file}: {{REQUIREMENT}} substituted intact · no stray token · {{#…#}} preserved`, () => {
        const rendered = renderPrompt(read(file), mapFor(requirement));
        assert.ok(rendered.includes(requirement), 'requirement text present intact (non-ASCII survives)');
        assert.equal(rendered.match(/\{\{[A-Z_]+\}\}/g), null, 'no un-substituted inject token remains');
        assert.ok(
          rendered.includes('{{#node.field#}}'),
          'the Dify variable-ref example is preserved (renderPrompt must not substitute it)'
        );
      });
    }
  }

  /**
   * Spec 105 — the same contract for `implement.md`, which was outside this loop and so had nothing
   * holding its tokens to the map. It gained `{{START_PHASE}}` (a doc must be able to ask "does this
   * build have a ② of its own?" — `{{SEED_PATH}}` cannot answer that, it is set on every edit-existing
   * and dify-seed build), and a token named in the doc but absent from `injectVars` renders as a
   * literal `{{START_PHASE}}` for the model to puzzle over. Both directions are one assertion here.
   */
  for (const [label, startPhase, expect] of [
    ['a build that skipped ①②', 'implement', 'implement'],
    ['an ordinary build', undefined, ''],
  ] as const) {
    test(`implement.md · ${label}: every token substituted, START_PHASE carries the fact`, () => {
      const vars = PHASES.find((p) => p.id === 'implement')!.injectVars({
        taskId: '1751000000000',
        project: 'p',
        workflowSlug: 'wf',
        workflowFile: 'main.yml',
        requirement: 'add a retry branch',
        artifacts: {},
        seedPath: 'apps/builder/.runs/1751000000000/seed.yml',
        startPhase,
      } as Task);
      assert.equal(vars.START_PHASE, expect, 'the token reports where the build began');

      const rendered = renderPrompt(read('implement.md'), vars);
      assert.equal(rendered.match(/\{\{[A-Z_]+\}\}/g), null, 'no un-substituted inject token remains');
    });
  }
});

/**
 * Spec 094 S4/S5 — the gate-question shape and the write-for-the-reader rules.
 *
 * Same technique as the 093 guard above (pin a checked-in prompt string), and the same reason: both are
 * pure prompt-shape rules with no code to defend them. What each pins:
 *
 *   S4 — questions put to the reviewer are a NUMBERED list, each item carrying a stated default. 093
 *        shipped this shape but ONLY inside the "when the two languages differ" appendix, so a user who
 *        chatted and built in ONE language still got a wall of prose (measured: the reviewer of run
 *        1786089321835 had to ask twice for the questions to be re-explained). The assertion that matters
 *        is therefore that the rule exists OUTSIDE that appendix — hence `bodyMinusOutputLanguage`.
 *   S5 — the reader is a user, not a workflow engineer: meaning before node label, machine names only
 *        when the reader must see/type them, flow as words. Pinned per file because the failure they fix
 *        was per file (① carried the rule; ②③④ carried none).
 *
 * Pinned on the SHORTEST stable fragment (the `→ Suggested:` marker, a rule heading), never a whole
 * sentence — assert-on-prompt-text is brittle by design and the wording will keep being tuned.
 */
describe('094 · gate-question shape (S4) + writing-for-the-reader (S5)', () => {
  /** The body with its "## Output language" section CUT OUT — i.e. everything the 093 bilingual appendix
   *  does NOT cover. A rule found here is a rule that fires in the same-language case too. */
  const bodyMinusOutputLanguage = (f: string): string => {
    const body = read(f);
    const section = outputLanguageSection(body);
    assert.ok(body.includes(section), 'section must be a literal slice of the body');
    return body.replace(section, '');
  };

  for (const file of ['analyze.md', 'spec.md', 'draft.md'] as const) {
    test(`S4 · ${file}: numbered questions + a stated default, OUTSIDE the bilingual appendix`, () => {
      const rest = bodyMinusOutputLanguage(file);
      assert.match(rest, /NUMBERED/, 'questions to the reviewer are a numbered list');
      assert.match(rest, /→ Suggested:/, 'every question carries the default the model would take');
    });
  }

  for (const file of ['spec.md', 'draft.md', 'implement.md', 'promote.md'] as const) {
    test(`S5 · ${file}: the write-for-the-reader block with its BAD/GOOD pair`, () => {
      const body = read(file);
      assert.match(body, /## Writing for the reader/, 'the shared block is present');
      assert.match(body, /not a workflow engineer/, 'it names WHO the reader is');
      assert.match(body, /Meaning first, coordinates second/, 'rule (a)');
      assert.match(body, /must see or type them/, 'rule (b) — the affordance rule');
      // The few-shot is the load-bearing half: a prohibition list alone did not move ①→③ behavior.
      assert.match(body, /\*\*BAD\*\*/, 'the BAD example survives');
      assert.match(body, /\*\*GOOD\*\*/, 'the GOOD example survives');
    });
  }

  test('S5 · judge.md carries the two rules that apply to its JSON free-text fields', () => {
    // judge.md emits NO chat prose — one JSON object — so it gets the tailored pair, not the full block.
    // Pinning it separately keeps a future "make all five identical" edit from pasting chat-prose rules
    // into a data-only phase.
    const body = read('judge.md');
    assert.match(body, /## Writing for the reader/, 'the tailored block is present');
    assert.match(body, /`evidence` and `summary` only/, 'it is scoped to the two free-text fields');
    assert.match(body, /Meaning first, coordinates second/, 'rule (a)');
    assert.doesNotMatch(body, /\*\*BAD\*\*/, 'the chat-prose few-shot does NOT belong in a JSON-only phase');
  });

  test('095 · implement.md carries the fix-round diagnosis table, not just the write rule', () => {
    // S2 taught the GENERATOR how to write `variables`; a fix round is a different surface and was
    // left uncovered — a real /reply turn then diagnosed "invalid variable" as a fault inside the
    // node showing the error and told the user to delete its variable rows, which would have been
    // unrecoverable (the picker that refills them is fed by the very list that is missing).
    const body = read('implement.md');
    assert.match(body, /## Fix rounds/, 'the diagnosis section exists');
    assert.match(body, /invalid variable/, 'the symptom is named as Dify words it');
    assert.match(body, /do NOT touch the node showing the error/, 'it points at the SOURCE node');
    assert.match(body, /nothing to pick/, 'it warns off the picker dead end');
    assert.match(body, /webhook URL required/, 'the expected-after-import item is distinguished');
    assert.match(body, /authorization required/, 'the tool-credential case is distinguished');
    // The two additions after the first real fix round on the corrected code (2026-08-12): that round
    // cleared the known causes correctly, then invented a new one and rewired a graph that a full
    // reference check says was already clean.
    assert.match(body, /NEVER the cause of "invalid variable"/, 'env/sys refs ruled out explicitly');
    assert.match(body, /STOP — do NOT edit the file/, 'a no-cause-found round must not write');
    assert.match(body, /What is left in the checklist that no file change can fix/,
      'the user gets an explicit report of what cannot be fixed — their stated requirement');
  });

  test('S2(a) · SKILL.md no longer claims Grep/Glob are callable without ToolSearch', () => {
    // The claim it used to make ("the Grep and Glob TOOLS themselves ARE available") contradicted the
    // permission gate's own recorded evidence (hooks/permission-gate.ts: deferred in the child session,
    // 25-call thrash in run 1784267358546). Pin the corrected instruction, not the deleted sentence.
    const body = read('SKILL.md');
    assert.doesNotMatch(body, /TOOLS themselves ARE available/, 'the false claim must stay deleted');
    assert.match(body, /ToolSearch/, 'the turn is told how to actually open Grep/Glob');
  });
});

describe('Layer 1 · languagePin (native-language reply pin)', () => {
  test('a kana-bearing (Japanese) requirement returns a Japanese pin', () => {
    const pin = languagePin({ requirement: 'Exel表からPDFのURLを抜き出して一覧にしたい。' });
    assert.ok(pin.includes('日本語'), 'pin instructs replying in Japanese');
    assert.ok(pin.endsWith('\n\n'), 'pin ends with a blank-line separator so it leads cleanly');
    assert.match(pin, /機械識別子/, 'pin still carves out ASCII machine identifiers');
  });

  test('a katakana-only requirement (still Japanese) is pinned', () => {
    assert.notEqual(languagePin({ requirement: 'ワークフロー' }), '', 'katakana alone ⇒ Japanese');
  });

  test('an accented Vietnamese requirement returns a Vietnamese pin', () => {
    const pin = languagePin({ requirement: 'Tạo workflow tóm tắt văn bản tiếng Việt' });
    assert.ok(pin.includes('tiếng Việt'), 'pin instructs replying in Vietnamese');
    assert.ok(pin.endsWith('\n\n'), 'pin ends with a blank-line separator so it leads cleanly');
    // The boundary this whole feature exists to protect: chat switches language, the DELIVERABLE does not.
    assert.match(pin, /artifact bàn giao/, 'the VI pin carves out what ships inside the artifact');
  });

  for (const [label, requirement] of [
    ['EN', 'create a simple text summarizer'],
    ['VI unaccented', 'tao workflow tom tat van ban'],
    ['ZH (kanji, no kana)', '从表格中提取数据'],
  ] as const) {
    test(`${label} requirement returns no pin (English-authored prompt reads as-is; no false-positive)`, () => {
      assert.equal(languagePin({ requirement }), '');
    });
  }
});

// ── The resolve CHAIN. Each case below is a bug that shipped, or would ship if a rung were dropped. ──
describe('Layer 1 · resolveLang (setting → this turn → sticky hint → requirement)', () => {
  test('a Vietnamese message with Japanese nouns embedded still resolves Vietnamese', () => {
    // The misfire this ordering exists to prevent: real messages here read
    // "phần 合流後 chính là phần 共通ワークフロー C…". Kana-first would call that Japanese.
    assert.equal(resolveLang({ latest: 'phần 合流後 chính là phần 共通ワークフロー C, đúng không?' }), 'vi');
  });

  test('the explicit setting beats detection in both directions', () => {
    assert.equal(resolveLang({ chatLang: 'ja', latest: 'giải thích lại giúp mình' }), 'ja');
    assert.equal(resolveLang({ chatLang: 'vi', latest: '確認していただきたいこと' }), 'vi');
  });

  test('a Vietnamese reply on a Japanese requirement resolves Vietnamese (the original bug)', () => {
    // 12 turns answered in Japanese while all 9 user messages were Vietnamese, because the pin read the
    // requirement (Japanese headings) instead of the message. Reversing this fails the fix.
    assert.equal(
      resolveLang({ chatLang: 'auto', latest: 'các câu hỏi khác thì mình không rõ lắm', requirement: '目的とスコープ — Tóm tắt…' }),
      'vi'
    );
  });

  test('this turn\'s text outranks a stale hint (the user switched language mid-task)', () => {
    // Ordering rung 2 > rung 3. Today every entry point refreshes `langHint` before the pin is computed,
    // so swapping these two rungs would not change a single shipped behavior — which is exactly why the
    // ordering needs a test of its own: the day someone adds an entry point that forgets `noteUserLang`,
    // this turn's own text is the only rung left that still knows what language the human just wrote in.
    assert.equal(resolveLang({ chatLang: 'auto', latest: 'đổi lại giúp mình phần này', hint: 'ja' }), 'vi');
  });

  test('a turn with NO user text falls back to the sticky hint, not the requirement', () => {
    // A Continue past a gate is a fresh turn carrying no text. Drop the hint rung and the same task
    // answers Vietnamese on replies and Japanese on continues.
    assert.equal(resolveLang({ chatLang: 'auto', latest: '', hint: 'vi', requirement: '日本語の要件' }), 'vi');
  });

  test('a signal-free reply on a Japanese task keeps the Japanese pin (back-compat)', () => {
    // Before the setting existed, EVERY turn pinned off the requirement. A user replying "OK" must not
    // lose the pin and get an English preamble back.
    assert.equal(resolveLang({ chatLang: 'auto', latest: 'OK', requirement: 'ワークフローを作って' }), 'ja');
  });

  test('nothing anywhere ⇒ no pin', () => {
    assert.equal(resolveLang({ chatLang: 'auto', latest: 'just build it', requirement: 'a summarizer' }), '');
  });

  test('an unknown/absent setting reads as auto (an old task.json has no field)', () => {
    assert.equal(resolveLang({ chatLang: undefined, requirement: 'ワークフロー' }), 'ja');
    assert.equal(resolveLang({ chatLang: 'en', requirement: 'ワークフロー' }), 'ja');
  });
});

describe('Layer 1 · detectLang', () => {
  for (const [label, text, want] of [
    ['đ/ư/ơ modified letters', 'khong dau nhung co chu đường', 'vi'],
    ['precomposed accents only', 'tài liệu', 'vi'],
    ['U+1EA0 block', 'yêu cầu mới', 'vi'],
    ['hiragana', 'ワークフローを作って', 'ja'],
    ['katakana only', 'チャットボット', 'ja'],
    ['kanji without kana (Chinese)', '从表格中提取数据', ''],
    ['plain ASCII', 'build a summarizer', ''],
    ['empty', '', ''],
  ] as const) {
    test(`${label} ⇒ ${want || 'no signal'}`, () => assert.equal(detectLang(text), want));
  }
});
