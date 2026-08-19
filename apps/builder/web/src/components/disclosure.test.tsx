/**
 * Disclosure — the collapsed/expanded phase-output block, and the one notice case that must NOT collapse.
 *
 * WHY THIS TEST EXISTS. Spec 099 S1 appends a line saying "N exchanges below were restored from the
 * transcript on disk". Its whole purpose is to be read: without it the restored block claims an order it
 * cannot know. The line was correct in the data and **invisible on screen** — it travels as a `run` item,
 * so it rendered as a collapsed button labelled "④ Test", indistinguishable from a phase's own output,
 * and its text was not in the document at all until clicked.
 *
 * That was found by opening a real browser, not by a unit test — every unit test passed. So this file is
 * the one that keeps it fixed: it asserts the RENDERED result, not the flag. A test that only checked
 * `note.open === true` would have gone green against the broken renderer.
 *
 * The first component test in this app; the vitest config already runs jsdom with the Preact preset for
 * exactly this, so no setup was needed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { Disclosure } from './Chat';

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

const OUTPUT = '[… 3 exchange(s) below were restored from the transcript on disk …]';

describe('Disclosure — a notice must be readable without being clicked', () => {
  it('open → the text is in the document immediately', () => {
    const el = mount(<Disclosure phaseKey="test" running={false} output={OUTPUT} open />);
    expect(el.textContent).toContain('restored from the transcript on disk');
  });

  it('REGRESSION: without `open`, a finished phase run still collapses — its output is NOT rendered', () => {
    // This is the behaviour the flag had to be added around: a build with four phases must not unfurl
    // four logs on every reopen. It is also the exact state the notice was stuck in before the fix.
    const el = mount(<Disclosure phaseKey="test" running={false} output="the implement log" />);
    expect(el.textContent).not.toContain('the implement log');
    expect(el.querySelector('button.disclosure'), 'the button is there — only the body is hidden').toBeTruthy();
  });

  it('a RUNNING phase is open regardless, as before — `open` only adds a second reason', () => {
    const el = mount(<Disclosure phaseKey="implement" running output="streaming right now" />);
    expect(el.textContent).toContain('streaming right now');
  });

  it('clicking a collapsed disclosure still reveals it (the notice case did not break the normal one)', async () => {
    const el = mount(<Disclosure phaseKey="test" running={false} output="the implement log" />);
    el.querySelector<HTMLButtonElement>('button.disclosure')!.click();
    // Preact batches state updates, so the DOM is one tick behind the click. Asserting immediately
    // reads the pre-click markup and fails for a reason that has nothing to do with the component.
    await new Promise((r) => setTimeout(r, 0));
    expect(el.textContent).toContain('the implement log');
  });
});
