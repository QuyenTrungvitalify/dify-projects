/**
 * The composer row's two groups.
 *
 * WHY THIS TEST EXISTS. The row holds a dozen loose controls and was pinned `flex-wrap: nowrap` for one
 * reason: let it wrap and the send button ends up alone on a line of its own, in a different place every
 * time the labels change. Putting the parked gate's actions IN the row made that unavoidable at narrow
 * widths — something has to give — so the row now has exactly TWO flex children, and the wrap has only
 * one place it can happen: between the gate and the controls.
 *
 * That is a structural fact, not a style: the CSS is only safe while the row really does have two
 * children. Asserted on rendered output, since a test reading props would pass against a renderer that
 * flattened them back into one list.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { Composer } from './Chat';
import type { Settings } from '../types';

let host: HTMLDivElement | null = null;

function mount(el: preact.ComponentChild): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  render(el as never, host);
  return host;
}

afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = null;
  }
});

const noop = (): void => {};
const settings: Settings = { workflow: 'none', confirm: 'each step', fast: false } as Settings;

/** `gate: undefined` is the entry surface; anything else (including null) is a conversation. */
function composer(gate?: preact.ComponentChildren, confirmActs?: boolean): HTMLDivElement {
  return mount(
    <Composer value="" onChange={noop} onSend={noop} placeholder="p"
      settings={settings} onSettings={noop} model="opus" onModel={noop}
      lockStartBound gate={gate} confirmActs={confirmActs} />
  );
}

describe('composer row — two groups, one place to break', () => {
  it('with a gate: the row has exactly two children, and the send button is in the right-hand one', () => {
    const el = composer(<button className="probe-gate">go</button>);
    const row = el.querySelector('.composer-row') as HTMLElement;
    expect(row.className).toContain('has-gate');
    expect(row.children).toHaveLength(2);
    expect(row.children[0].className).toContain('composer-gate');
    expect(row.children[1].className).toContain('composer-tools');
    // The gate content really is in the left group, and every message control in the right one.
    expect(row.querySelector('.composer-gate .probe-gate')).not.toBeNull();
    expect(row.querySelector('.composer-tools .composer-send')).not.toBeNull();
    // The chips move INTO the right group here — that is what puts the row's left at the gate's disposal.
    expect(row.querySelector('.composer-tools .setting-select')).not.toBeNull();
  });

  it('without a gate: the entry surface keeps its chips at the left, outside the group', () => {
    const el = composer(undefined);
    const row = el.querySelector('.composer-row') as HTMLElement;
    expect(row.className).not.toContain('has-gate');
    expect(row.querySelector('.composer-gate')).toBeNull();
    // Chips are direct children of the row, NOT inside the tools group: on that screen they are the
    // subject, not a setting attached to the send button.
    expect([...row.children].some((c) => c.className.includes('setting-select'))).toBe(true);
    expect(row.querySelector('.composer-tools .setting-select')).toBeNull();
    expect(row.querySelector('.composer-tools .composer-send')).not.toBeNull();
  });

  it('a conversation with no parked gate still uses the conversation layout', () => {
    // `gate={null}` — a done build. The chips must not slide back across the row as its parting move.
    const el = composer(null);
    const row = el.querySelector('.composer-row') as HTMLElement;
    expect(row.className).toContain('has-gate');
    expect(row.querySelector('.composer-tools .setting-select')).not.toBeNull();
  });
});

describe('the Confirm chip retires when it stops deciding anything', () => {
  it('confirmActs=false removes it, and takes nothing else with it', () => {
    const el = composer(null, false);
    const tools = el.querySelector('.composer-tools') as HTMLElement;
    const labels = [...tools.querySelectorAll('.setting-select')].map((c) => c.textContent ?? '');
    expect(labels.some((l) => l.includes('確認') || l.toLowerCase().includes('confirm'))).toBe(false);
    // The Model chip applies to every turn there is, including the ask turns of a finished build, so it
    // must survive the same render that drops Confirm.
    expect(labels).toHaveLength(1);
    expect(tools.querySelector('.composer-send')).not.toBeNull();
  });

  it('absent means yes — the entry surface still gets it', () => {
    const el = composer(undefined);
    const chips = [...el.querySelectorAll('.setting-select')].map((c) => c.textContent ?? '');
    expect(chips.some((l) => l.includes('確認') || l.toLowerCase().includes('confirm'))).toBe(true);
  });
});
