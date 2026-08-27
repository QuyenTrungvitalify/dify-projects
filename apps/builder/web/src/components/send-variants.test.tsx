/**
 * Spec 105 M2 — the ⌄ that offers the second way to send, and the SHAPE it has to take.
 *
 * The caret was built as the right half of a pair: glued to the ✎ change pill, sharing its rounding,
 * with `border-left: none` and square left corners so the two read as one control. The door has no ask
 * lane, so M2 rendered the same caret ALONE there — and alone, those rules draw half a control floating
 * between the attach button and Send. It shipped that way and nothing caught it: no test touched this
 * control at all, so the first report came from a person looking at the Japanese UI.
 *
 * What is asserted is the CONTEXT-shape pairing, not the CSS: `solo` alone, paired inside the wrap. A
 * test that read the computed border would pass against a stylesheet that had dropped the rule for the
 * pair, which is the other half of the same mistake.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { Composer } from './Chat';
import type { Settings } from '../types';

let host: HTMLDivElement | null = null;
const noop = (): void => {};
const settings: Settings = { workflow: 'none', confirm: 'each step', fast: false } as Settings;

function composer(over: { canChange?: boolean; canPropose?: boolean }): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  render(
    <Composer value="x" onChange={noop} onSend={noop} placeholder="p"
      settings={settings} onSettings={noop} model="opus" onModel={noop} {...over} /> as never,
    host
  );
  return host;
}

afterEach(() => {
  if (host) { render(null, host); host.remove(); host = null; }
});

describe('105 M2 · the send-variants caret takes the shape of where it stands', () => {
  it('at the door it stands ALONE, so it is marked solo (it has no pill to be half of)', () => {
    const el = composer({ canChange: false, canPropose: true });
    const caret = el.querySelector('.composer-change-caret');
    expect(caret).not.toBeNull();
    expect(caret!.classList.contains('solo')).toBe(true);
    expect(el.querySelector('.composer-change-wrap')).toBeNull(); // nothing to glue to, and none pretended
  });

  it('beside the change pill it is NOT solo — there it really is half of a pair', () => {
    const el = composer({ canChange: true, canPropose: true });
    const caret = el.querySelector('.composer-change-wrap .composer-change-caret');
    expect(caret).not.toBeNull();
    expect(caret!.classList.contains('solo')).toBe(false);
  });

  it('no second send lane, no caret at all — the ⌄ never appears with nothing behind it', () => {
    expect(composer({ canChange: false, canPropose: false }).querySelector('.composer-change-caret')).toBeNull();
  });
});
