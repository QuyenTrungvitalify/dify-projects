/**
 * The external-YAML intake form's default (non-advanced) shape.
 *
 * WHY THIS TEST EXISTS. The form used to ask every reader for a source label and a license before it
 * asked for the YAML. Neither field decides whether the YAML validates, distills, or reaches the shelf —
 * license only decides whether the FINISHED pattern may later be offered to the team shelf, and the
 * hidden default ('unknown') is the conservative answer to that question. So they are dev-only now, and
 * this file pins that: hiding them is a deliberate default, not an omission a later edit may "restore".
 *
 * The order assertion is the other half. What the reader is about to DO with the YAML decides which
 * fields exist below it, so the choice has to precede the paste box — a reader who pastes first has the
 * form rearranged under them.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { IntakeYamlModal } from './Modal';
import { tree } from '../store';
import type { WireTreeProject } from '../types';

let host: HTMLDivElement | null = null;

function mount(advanced: boolean): HTMLDivElement {
  unmount();
  host = document.createElement('div');
  document.body.appendChild(host);
  render(<IntakeYamlModal advanced={advanced} onClose={() => {}} onImported={() => {}} />, host);
  return host;
}

function unmount(): void {
  if (!host) return;
  render(null, host);
  host.remove();
  host = null;
}

afterEach(() => {
  unmount();
  tree.value = [];
});

/** Click the "use as base" tab — the second of the two action tabs — and let the re-render land
 *  (a Preact state update from an event handler flushes on a later tick, not inside dispatchEvent). */
function pickBase(el: HTMLElement): void {
  const tabs = el.querySelectorAll<HTMLButtonElement>('.intake-actions .atab');
  expect(tabs.length).toBe(2);
  act(() => {
    tabs[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const project = (id: string): WireTreeProject =>
  ({ id, name: id, workflows: [] }) as unknown as WireTreeProject;

describe('external-YAML intake · the default form', () => {
  it('asks nothing about provenance — no source label, no license', () => {
    const el = mount(false);
    expect(el.querySelector('input[placeholder*="provenance"]')).toBeNull();
    // The license dropdown is the only <select> the distill action renders.
    expect(el.querySelectorAll('select').length).toBe(0);
  });

  it('asks both in dev mode, so a permissive license can still be claimed', () => {
    const el = mount(true);
    expect(el.querySelector('input[placeholder*="provenance"]')).not.toBeNull();
    const sel = el.querySelector<HTMLSelectElement>('select');
    expect(sel).not.toBeNull();
    expect([...sel!.options].map((o) => o.value)).toContain('unknown');
  });

  it('puts the choice above the paste box — it decides what the rest of the form asks', () => {
    const el = mount(false);
    const tabs = el.querySelector('.intake-actions');
    const paste = el.querySelector('textarea');
    expect(tabs).not.toBeNull();
    expect(paste).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING: `paste` comes after `tabs` in document order.
    expect(tabs!.compareDocumentPosition(paste!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hides the target-project select while _drafts is the only answer', () => {
    const el = mount(false);
    pickBase(el);
    expect(el.querySelectorAll('select').length).toBe(0);

    tree.value = [project('acme')];
    const el2 = mount(false);
    pickBase(el2);
    const sel = el2.querySelector<HTMLSelectElement>('select');
    expect(sel).not.toBeNull();
    expect([...sel!.options].map((o) => o.value)).toEqual(['', 'acme']);
  });
});
