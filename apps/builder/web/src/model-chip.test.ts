// model-chip.test.ts — spec 096, the display contract of the composer's Model chip.
//
// Why this file exists: the same bug shipped THREE times in one sitting, each time passing typecheck
// and the whole suite. `value={settings.model ?? 'opus'}` made the chip assert a choice nobody had
// made, and two separate call sites built a Settings object without `model` at all:
//   - App.tsx `settingsSubset` (entry composer) → the chip read "Opus" forever while the picked value
//     was already stored and already being sent;
//   - App.tsx in-task composer → the chip read "Opus" for every running build regardless of its model,
//     including a pre-096 build that recorded no choice.
// None of that is catchable by looking at the chip in isolation, so what is pinned HERE is the pure
// rule: what the chip DISPLAYS for a given Settings, including the absent case. The CALL SITES are
// pinned in apps/builder/test/model-choice.test.ts (a source-shape guard, which needs node fs — the
// web tsconfig carries no node types).
import { describe, it, expect } from 'vitest';
import { MODEL_OPTIONS } from './store';
import { t as tr, setLang } from './lib/i18n';

/** The chip's display resolution, mirroring SettingSelect: an option's label when the value matches
 *  one, else the raw value. Kept as a tiny local mirror rather than mounting the composer — the point
 *  is the VALUE→LABEL mapping, and mounting would test preact, not this rule. */
const shown = (model: string | undefined): string => {
  const value = model ?? '';
  const options = [
    ...(model ? [] : [{ v: '', l: tr('modelUnset') }]),
    ...MODEL_OPTIONS.map((m) => ({ v: m, l: tr(`model_${m}` as never) })),
  ];
  return options.find((o) => o.v === value)?.l ?? value;
};

describe('096 · what the Model chip displays', () => {
  it('a picked model shows that model — never a default', () => {
    expect(shown('opus')).toBe('Opus');
    expect(shown('sonnet')).toBe('Sonnet');
    expect(shown('fable')).toBe('Fable');
    // A build that RAN on the retired alias still shows what it ran on, verbatim. The chip's job is to
    // report, and rewriting history to a model the task never used is the exact lie the test below pins.
    expect(shown('haiku')).toBe('haiku');
  });

  it('no model recorded ⇒ says so, and does NOT claim Opus', () => {
    // The regression that shipped three times. A pre-096 task genuinely has no choice on it; showing
    // the default there tells the user a build ran on Opus when it may well have run on Haiku.
    const out = shown(undefined);
    expect(out).toBe('not recorded');
    expect(out).not.toBe('Opus');
  });

  it('the unset sentinel appears ONLY when unset (the entry composer never shows it)', () => {
    // The entry composer always carries a value from the store, so a stray sentinel there would be a
    // selectable empty option — a way to silently un-pick the model.
    const optsFor = (model: string | undefined) => [
      ...(model ? [] : [{ v: '', l: tr('modelUnset') }]),
      ...MODEL_OPTIONS.map((m) => ({ v: m, l: m })),
    ];
    expect(optsFor('opus').some((o) => o.v === '')).toBe(false);
    expect(optsFor('opus')).toHaveLength(MODEL_OPTIONS.length);
    expect(optsFor(undefined).some((o) => o.v === '')).toBe(true);
  });

  it('ja: the unset label is translated too (a JA user must not read English here)', () => {
    setLang('ja');
    try {
      expect(shown(undefined)).toBe('記録なし');
      expect(shown('opus')).toBe('Opus'); // product name, identical in both languages
    } finally {
      setLang('en');
    }
  });

  it('the offered list mirrors the server, most capable first — and no longer offers haiku', () => {
    // Mirrors the server's MODEL_CHOICES; the server is what drops an unknown value, so a list that
    // drifted from it would offer something the backend silently discards. `haiku` left after run
    // 1787826393000, where ③ made zero tool calls and the build died `artifact missing`.
    expect([...MODEL_OPTIONS]).toEqual(['opus', 'sonnet', 'fable']);
    expect(MODEL_OPTIONS[0]).toBe('opus'); // the default every fresh machine lands on
  });
});
