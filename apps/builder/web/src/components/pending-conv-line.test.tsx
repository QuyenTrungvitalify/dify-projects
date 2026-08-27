/**
 * Spec 105 M4 follow-up — the standing "this workflow already has a conversation" line.
 *
 * M4 asked that question in a MODAL, from `newTask({baseWorkflow})` — the sidebar pencil, the done-gate
 * edit button, the import-base modal. The composer's Workflow dropdown is a fourth door onto the same
 * workflows and it does not pass through `newTask`; it was covered only by accident, because the
 * dropdown used to hide `_drafts`, and `_drafts` is where every from-scratch build lands. Listing those
 * rows opened the door, so the question needs an answer on this surface too.
 *
 * Both halves are asserted, and the SILENT half is the one that decides the design: 7 of the 23
 * workflows measured on the author's machine are parked at a gate and they sort to the TOP of the
 * recency-ordered menu, so anything that fires per selection fires almost always. A line that appears
 * on the ordinary case is a line nobody reads.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { EmptyState } from './App';
import type { Settings, WireTreeTask } from '../types';
import type { NewTaskCrumb } from '../lib/crumb';

let host: HTMLDivElement | null = null;

const task = (over: Partial<WireTreeTask> = {}): WireTreeTask =>
  ({ id: '1787801569541', name: 't', time: '', status: 'awaiting_confirm', phase: 'implement', ...over }) as WireTreeTask;

function mount(pendingConv: WireTreeTask | null): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  const crumb: NewTaskCrumb = { icon: 'edit', label: 'Chatbot を編集', active: true };
  render(
    <EmptyState
      draft="" setDraft={() => {}} send={() => {}}
      settings={{ workflow: '_drafts/chatbot', confirm: 'each step', fast: false } as Settings}
      onSettings={() => {}} model={undefined} onModel={() => {}} workflows={[]}
      crumb={crumb} onClearCrumb={() => {}} startsAtImplement={false} pendingConv={pendingConv}
      seeds={[]} selectedSeed={null} onSeed={() => {}}
      startError={null} busyHolder={null}
      files={[]} onAddFiles={() => {}} onRemoveFile={() => {}} mode="build"
    /> as never,
    host
  );
  return host;
}

afterEach(() => {
  if (host) { render(null, host); host.remove(); host = null; }
});

describe('105 M4 follow-up · the pending-conversation line at the door', () => {
  it('names the gate the other conversation is parked at, and offers a way into it', () => {
    const el = mount(task()).querySelector('.pending-conv');
    expect(el).not.toBeNull();
    // The phase is the POINT: "there is another conversation" is not actionable, "it is waiting at ③"
    // is — it tells you whether the thing you are about to ask for was already asked there.
    expect(el!.textContent).toMatch(/3/);
    expect(el!.querySelector('button')).not.toBeNull(); // the way in, not just the warning
  });

  it('stays silent when nothing is waiting — the ordinary case must not carry a banner', () => {
    expect(mount(null).querySelector('.pending-conv')).toBeNull();
  });

  it('never takes the keyboard — the composer stays sendable with the line up', () => {
    const el = mount(task());
    // A dialog would have blocked here. The whole design choice is that this one does not: it informs
    // while the requirement is being typed and leaves the decision one keystroke away.
    expect(el.querySelector('textarea')).not.toBeNull();
    expect(el.querySelector('.pending-conv')).not.toBeNull();
  });
});
