/**
 * Highlighting a sidebar row and SCROLLING TO IT are two different things. They were one, and the
 * seam is the `reveal` prop.
 *
 * The measured failure: a build lives under 進行中 *and* under ビルド. Clicking the 進行中 copy opens
 * the build, which lights the ビルド copy too — and that copy called `scrollIntoView` on itself,
 * dragging the whole list. Measured on a real sidebar: `scrollTop` went 0 → 158 in one step and the row
 * the pointer had just clicked slid from y=167 to y=9. Nothing was wrong with the highlight; the scroll
 * was answering a question nobody asked.
 *
 * The distinction that survives: a node the user AIMED at (the composer's target — the state
 * `createProject` leaves behind, which is what makes a freshly-created project reveal itself) still
 * scrolls. A node merely mirroring the open build does not.
 *
 * These assert the DOM effect, not the prop: a test that read `reveal` back would pass against a row
 * that ignored it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { WorkflowRow } from './Sidebar';
import type { WireTreeWorkflow } from '../types';

let host: HTMLDivElement | null = null;

const WF: WireTreeWorkflow = { id: 'wf_1', name: 'A workflow', tasks: [] };

/** Mount a row and report how many times anything inside it asked to be scrolled into view.
 *  jsdom ships no `scrollIntoView` at all, so this DEFINES it rather than spying on it — which is also
 *  the honest shape of the environment: in a real browser the method exists and does something. */
function mountRow(props: { active: boolean; reveal: boolean }): number {
  const calls: unknown[] = [];
  const proto = Element.prototype as unknown as Record<string, unknown>;
  const had = Object.prototype.hasOwnProperty.call(proto, 'scrollIntoView');
  const prev = proto.scrollIntoView;
  proto.scrollIntoView = function (...args: unknown[]): void {
    calls.push(args);
  };
  // A local binding, not `host` directly: inside the `act` closure below TS re-widens the module-level
  // `host` to include null, and `render` will not take that.
  const el = document.createElement('div');
  host = el;
  document.body.appendChild(el);
  // `act` flushes Preact's effect queue deterministically. Preact schedules effects on the next frame
  // (with a 100ms timeout fallback), so neither a synchronous read nor a `setTimeout(0)` reliably sees
  // them — the assertion would read zero for the scrolling case and the passing cases would prove nothing.
  act(() => {
  render(
    <WorkflowRow
      wf={WF}
      projectId="_drafts"
      activeTask={null}
      active={props.active}
      reveal={props.reveal}
      defaultOpen={false}
      onOpen={() => {}}
      onNewTask={() => {}}
    />,
    el,
  );
  });
  const n = calls.length;
  if (had) proto.scrollIntoView = prev;
  else delete proto.scrollIntoView;
  return n;
}

afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = null;
  }
});

describe('sidebar row — highlight vs. reveal', () => {
  it('an active row that was AIMED at scrolls itself into view', () => {
    // The behaviour that must survive: createProject / arming an edit target leaves no open build, so
    // `reveal` is true and a node off the bottom of the list still brings itself up.
    expect(mountRow({ active: true, reveal: true })).toBe(1);
  });

  it('an active row that is only MIRRORING the open build does not scroll', () => {
    // The bug. `active` is still true — the row lights up, which is the whole point of the co-highlight
    // and is what the user asked to keep — but it does not move the list.
    expect(mountRow({ active: true, reveal: false })).toBe(0);
  });

  it('an inactive row never scrolls, whatever reveal says', () => {
    // `reveal` must not be able to scroll a row that is not the selected one — it is a permission to
    // reveal the active node, not an instruction to reveal every node.
    expect(mountRow({ active: false, reveal: true })).toBe(0);
    expect(mountRow({ active: false, reveal: false })).toBe(0);
  });
});
