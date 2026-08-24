/**
 * ConfirmModal — the two-button confirm, and the one-button alert.
 *
 * WHY THIS TEST EXISTS. The layer-2 anomaly notice ("an unexpected write was reverted") used to pass the
 * SAME label as both `okLabel` and `cancelLabel`, so it rendered as two identical OK buttons — a choice
 * offered for something already done, which is not a choice. Passing `cancelLabel: null` now renders one
 * button. Both halves are asserted here: the alert has ONE button, and every other caller — fifteen of
 * them, none of which passes `null` — still gets TWO. Rendered output, not props: a test that read the
 * prop would go green against a renderer that ignored it. (spec 112)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { ConfirmModal } from './Modal';

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

describe('ConfirmModal — a notice about something already done is not a choice', () => {
  it('cancelLabel: null → exactly ONE button', () => {
    const el = mount(
      <ConfirmModal title="Reverted an unexpected write" okLabel="OK" cancelLabel={null} onOk={noop} onCancel={noop} />
    );
    expect(el.querySelectorAll('.confirm-foot button')).toHaveLength(1);
    expect(el.querySelector('.confirm-foot button')?.textContent).toBe('OK');
    expect(el.querySelector('.confirm-foot .btn.ghost')).toBeNull();
  });

  it('the ordinary confirm still has BOTH buttons', () => {
    const el = mount(
      <ConfirmModal title="Discard?" okLabel="Discard" cancelLabel="Cancel" onOk={noop} onCancel={noop} />
    );
    const btns = el.querySelectorAll('.confirm-foot button');
    expect(btns).toHaveLength(2);
    expect(btns[0].textContent).toBe('Cancel');
    expect(btns[1].textContent).toBe('Discard');
  });

  it('an omitted cancelLabel keeps the default two-button shape (no caller opts in by accident)', () => {
    const el = mount(<ConfirmModal title="Sure?" onOk={noop} onCancel={noop} />);
    expect(el.querySelectorAll('.confirm-foot button')).toHaveLength(2);
  });

  it('the one-button alert can still be dismissed with Esc', () => {
    let cancelled = false;
    // `act` flushes the effect that installs the keydown listener — without it the dispatch below
    // lands before the listener exists and the test passes/fails for the wrong reason.
    act(() => {
      mount(
        <ConfirmModal
          title="Reverted an unexpected write"
          okLabel="OK"
          cancelLabel={null}
          onOk={noop}
          onCancel={() => {
            cancelled = true;
          }}
        />
      );
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cancelled).toBe(true);
  });
});
