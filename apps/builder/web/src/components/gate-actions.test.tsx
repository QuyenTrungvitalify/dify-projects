/**
 * GateActions — what the composer's gate group draws, and what it leaves to other surfaces.
 *
 * WHY THIS TEST EXISTS. Every gate now renders here and nowhere else, so this one component decides
 * whether a decision is reachable at all. Three things must stay dropped, each owned elsewhere: the
 * cancel (header pill), the test-app sweep (the card's link row), and `changes` (the composer's own ✎
 * pill). Draw any of them here and the same act has two doors on one screen; drop a fourth thing by
 * accident and a gate becomes a dead end. Rendered output, not props — a test reading the filter would
 * go green against a renderer that ignored it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { GateActions } from './Chat';
import type { WireTask } from '../types';

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

/** A build parked at ② with the gate the server actually sends there: continue, changes, discard. */
const parked = (): WireTask =>
  ({
    taskId: 'T1',
    project: null,
    workflow: null,
    workflowFile: 'main.yml',
    requirement: 'r',
    seedPath: null,
    deploy: 'none',
    confirmMode: 'each_step',
    phase: 'spec',
    status: 'awaiting_confirm',
    workflowSlug: null,
    name: null,
    sessionIds: {},
    artifacts: {},
    gate: {
      actions: [
        { id: 'continue', label: 'Implement this spec', kind: 'confirm', route: '/confirm' },
        { id: 'changes', label: 'Edit spec', kind: 'reply', route: '/reply' },
        { id: 'discard', label: 'Discard build', kind: 'cancel', route: '/cancel' },
      ],
    },
  }) as unknown as WireTask;

const noop = (): void => {};

function foot(task: WireTask): HTMLDivElement {
  return mount(<GateActions task={task} onConfirm={noop} onArmChange={noop} onRetry={noop} />);
}

/** The ④ import gate: two ways forward, plus the two the group must not draw. */
const importGate = (): WireTask =>
  ({
    ...parked(),
    phase: 'test',
    gate: {
      flag: 'awaiting_import',
      actions: [
        { id: 'import', label: 'Import to Dify', kind: 'confirm', route: '/confirm' },
        { id: 'skip_import', label: 'Finish without importing', kind: 'confirm', route: '/confirm' },
        { id: 'changes', label: 'Request changes', kind: 'reply', route: '/reply' },
        { id: 'discard', label: 'Discard build', kind: 'cancel', route: '/cancel' },
      ],
    },
  }) as unknown as WireTask;

describe('GateActions — one door per act', () => {
  it('draws the ways FORWARD and nothing else', () => {
    const el = foot(parked());
    const labels = [...el.querySelectorAll('.gate-foot button')].map((b) => b.textContent);
    // One: `changes` belongs to the ✎ pill, `discard` to the header pill.
    expect(labels).toHaveLength(1);
    expect(el.querySelector('.gate-foot .btn.ok')).not.toBeNull();
    expect(el.querySelector('.gate-foot .btn.ghost')).toBeNull();
  });

  it('the ④ import gate keeps BOTH of its ways forward', () => {
    // The one gate where the second confirm is a real choice rather than a decline: finishing without
    // importing is a legitimate end, so it must survive the filter that drops cancel and `changes`.
    const el = foot(importGate());
    const labels = [...el.querySelectorAll('.gate-foot button')].map((b) => b.textContent ?? '');
    expect(labels).toHaveLength(2);
    expect(labels.some((l) => l.includes('インポート') || l.includes('Import'))).toBe(true);
  });

  it('a still-failing Implement draws Keep-trying as a CLICK, beside Accept-anyway', () => {
    // It used to arm the composer — a button asking you to type before a re-run that needs no words.
    const el = foot({
      ...parked(),
      phase: 'implement',
      gate: {
        flag: 'still_failing',
        actions: [
          { id: 'accept', label: 'Accept anyway', kind: 'confirm', route: '/confirm' },
          { id: 'keep', label: 'Keep trying', kind: 'reply', route: '/reply' },
          { id: 'abandon', label: 'Abandon', kind: 'cancel', route: '/cancel' },
        ],
      },
    } as unknown as WireTask);
    const buttons = [...el.querySelectorAll('.gate-foot button')];
    expect(buttons).toHaveLength(2);
    // Both are primary here: one accepts the lint failure, one pays for another attempt. Neither is the
    // quiet ghost an arm-the-composer button would have been.
    expect(el.querySelectorAll('.gate-foot .btn.ghost')).toHaveLength(0);
  });

  it('the test-app sweep never appears here — it is a link on the card', () => {
    const el = foot({
      ...parked(),
      phase: 'test',
      appId: 'a1',
      testApps: ['a1', 'a2'],
      gate: {
        flag: 'test_result',
        actions: [
          { id: 'accept', label: 'Accept result', kind: 'confirm', route: '/confirm' },
          { id: 'cleanup_apps', label: 'Delete test apps', kind: 'confirm', route: '/confirm' },
        ],
      },
    } as unknown as WireTask);
    const labels = [...el.querySelectorAll('.gate-foot button')].map((b) => b.textContent ?? '');
    expect(labels).toHaveLength(1);
    expect(labels.some((l) => l.includes('削除') || l.includes('Delete'))).toBe(false);
  });

  it('a gate with nothing forward renders no foot at all', () => {
    // The promote `blocked` gate: its only action is the discard, which the header owns. An empty
    // bordered strip in the composer row would read as a control that failed to load.
    const el = foot({
      ...parked(),
      gate: { flag: 'promote_blocked', actions: [{ id: 'discard', label: 'Discard', kind: 'cancel', route: '/cancel' }] },
    } as unknown as WireTask);
    expect(el.querySelector('.gate-foot')).toBeNull();
  });
});
