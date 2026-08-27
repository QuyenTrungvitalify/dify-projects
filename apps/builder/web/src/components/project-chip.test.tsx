/**
 * Spec 113 — the Project chip at the door: WHERE a from-scratch build gets created.
 *
 * `store.start` has resolved this since spec 029/031 (`editing?.project ?? s.targetProject`) and the
 * new-task crumb has DISPLAYED it just as long — but the only control that could SET it was the
 * sidebar's per-project "+". So the entry surface could tell you a build was headed somewhere while
 * offering no way to say where, and the unspoken default is `_drafts`: the folder whose own name says
 * it is scratch, and which every from-scratch build has therefore always filled.
 *
 * Three things are pinned here, and the last is the one with teeth: "+ New project…" is an ACTION
 * sharing an options list with DATA, so the sentinel must never reach `onSettings` — a build carrying
 * `targetProject: '__new_project__'` would scaffold a folder by that name.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { EmptyState } from './App';
import type { Settings } from '../types';
import type { NewTaskCrumb } from '../lib/crumb';

let host: HTMLDivElement | null = null;
const PROJECTS = [{ v: '_drafts', l: 'Drafts' }, { v: 'proj_a', l: 'Proj A' }];

function mount(over: Partial<Settings>, spy: { settings: Partial<Settings>[]; newProject: number }): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  const crumb: NewTaskCrumb = { icon: 'edit', label: 'x', active: false };
  render(
    <EmptyState
      draft="" setDraft={() => {}} send={() => {}}
      settings={{ workflow: 'none', confirm: 'each step', fast: false, ...over } as Settings}
      onSettings={(p) => { spy.settings.push(p); }}
      model={undefined} onModel={() => {}} workflows={[]}
      projects={PROJECTS} onNewProject={() => { spy.newProject++; }}
      crumb={crumb} onClearCrumb={() => {}} startsAtImplement={false} pendingConv={null}
      seeds={[]} selectedSeed={null} onSeed={() => {}}
      startError={null} busyHolder={null}
      files={[]} onAddFiles={() => {}} onRemoveFile={() => {}} mode="build"
    /> as never,
    host
  );
  return host;
}

/** The chip is identified by its LABEL cell, the way a reader finds it — not by DOM position. */
const chipOf = (el: HTMLElement, label: string): HTMLButtonElement | undefined =>
  [...el.querySelectorAll<HTMLButtonElement>('button.setting-chip')]
    .find((b) => b.querySelector('.sc-key')?.textContent?.startsWith(label));

/** Preact batches state, so the menu the chip opens is not in the DOM until the next tick. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  if (host) { render(null, host); host.remove(); host = null; }
});

describe('113 · the Project chip at the door', () => {
  it('shows the unfiled default, so where the build lands is visible before it is spent', () => {
    const spy = { settings: [] as Partial<Settings>[], newProject: 0 };
    const chip = chipOf(mount({}, spy), 'New in');
    expect(chip).toBeTruthy();
    expect(chip!.querySelector('.sc-val')?.textContent).toBe('Drafts');
  });

  // GONE, not greyed. An edit takes its project from the workflow, and the Workflow chip's own value is
  // the compound `Project / Workflow` — so a disabled chip here would repeat what the neighbour already
  // says, in the one state where it cannot be acted on, on a row that is already tight in Japanese.
  it('is absent while a workflow is armed — the Workflow chip already names that project', () => {
    const spy = { settings: [] as Partial<Settings>[], newProject: 0 };
    const el = mount({ workflow: '_drafts/news' }, spy);
    expect(chipOf(el, 'New in')).toBeUndefined();
    // and the row did not simply lose a control: the remaining chips are all still there
    expect(el.querySelectorAll('button.setting-chip').length).toBeGreaterThan(0);
  });

  it('routes "+ New project…" to the create door and NEVER into settings (it is not a folder name)', async () => {
    const spy = { settings: [] as Partial<Settings>[], newProject: 0 };
    const el = mount({}, spy);
    chipOf(el, 'New in')!.click();
    await tick();
    const opt = [...el.querySelectorAll<HTMLButtonElement>('.setting-menu .setting-opt')]
      .find((b) => b.textContent?.includes('New project'));
    expect(opt).toBeTruthy();
    opt!.click();
    expect(spy.newProject).toBe(1);
    expect(spy.settings).toEqual([]); // the sentinel never became a value
  });

  it('picking a real project sets it; picking the default clears it back to null', async () => {
    const spy = { settings: [] as Partial<Settings>[], newProject: 0 };
    const el = mount({}, spy);
    const pick = async (label: string): Promise<void> => {
      chipOf(el, 'New in')!.click();
      await tick();
      [...el.querySelectorAll<HTMLButtonElement>('.setting-menu .setting-opt')]
        .find((b) => b.textContent === label)!.click();
      await tick();
    };
    await pick('Proj A');
    await pick('Drafts');
    // null, not the string '_drafts': the wire's "no project" is absence, and store.start falls through
    // to the backend default. Sending the literal would hard-code a folder the server picks for itself.
    expect(spy.settings).toEqual([{ targetProject: 'proj_a' }, { targetProject: null }]);
  });
});
