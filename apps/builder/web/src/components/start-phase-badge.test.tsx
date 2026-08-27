/**
 * Spec 105 — the door says where the build would BEGIN, before the send is spent.
 *
 * A workflow that already carries an analysis and a spec skips ① and ②. That has been true since
 * 57dca56 and the only way to learn it was to press send and read the dashes on the phase track
 * AFTERWARDS — the decision was made from disk, announced nowhere. The bit has been on the wire since
 * 034cc15 (`startsAtImplement` per tree row) with nothing reading it; this is the surface it was for.
 *
 * Two halves are load-bearing and both are asserted here:
 *   · it appears when steps really are skipped, and
 *   · it stays SILENT otherwise. The full path is the unsurprising case; a line that fires on it is a
 *     line nobody reads, and it would sit above the composer on every single new build.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { EmptyState } from './App';
import type { Settings } from '../types';
import type { NewTaskCrumb } from '../lib/crumb';

let host: HTMLDivElement | null = null;

function mount(startsAtImplement: boolean, over: Partial<Settings> = {}): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  const crumb: NewTaskCrumb = { icon: 'edit', label: 'Specced を編集', active: true };
  render(
    <EmptyState
      draft="" setDraft={() => {}} send={() => {}}
      settings={{ workflow: 'p1/specced', confirm: 'each step', fast: false, ...over } as Settings}
      onSettings={() => {}} model={undefined} onModel={() => {}} workflows={[]}
      projects={[]} onNewProject={() => {}}
      crumb={crumb} onClearCrumb={() => {}} startsAtImplement={startsAtImplement} pendingConv={null}
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

describe('105 · the start-phase badge at the door', () => {
  it('announces the skip when the workflow already has both artifacts', () => {
    const el = mount(true).querySelector('.empty-startphase');
    expect(el).not.toBeNull();
    expect(el!.textContent).toMatch(/実装から開始|Starts at/);
  });

  it('says nothing on the ordinary path', () => {
    // Not a style choice: this sits above the composer on the entry screen, so a line that fires on
    // every plain new build is a line the reader learns to skip — and then misses the one time it
    // carried news.
    expect(mount(false).querySelector('.empty-startphase')).toBeNull();
  });

  it('stays out of the composer row, which is pinned to two flex children', () => {
    // `composer-row.test.tsx` pins `.composer-row` to exactly two children with `flex-wrap: nowrap`;
    // a third puts the send button alone on a line at narrow widths. The badge is a sibling of the
    // crumb, above the composer — never inside the row.
    const host = mount(true);
    const row = host.querySelector('.composer-row');
    expect(row?.querySelector('.empty-startphase')).toBeFalsy();
    expect(host.querySelector('.empty-startphase')).not.toBeNull();
  });
});
