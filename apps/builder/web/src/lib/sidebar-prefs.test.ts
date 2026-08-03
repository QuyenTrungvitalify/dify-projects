/** spec 084 follow-up — the sidebar load-more helper. Pure `pageList` (no render): the visible slice +
 *  overflow count that drives the "Show N more" / "Show less" toggle across every sidebar section. */
import { describe, it, expect } from 'vitest';
import { pageList, DEFAULT_PAGE_SIZE } from './sidebar-prefs';

const items = [1, 2, 3, 4, 5, 6, 7];

describe('084 follow-up · pageList (sidebar load-more)', () => {
  it('collapsed: shows the first `limit`, reports the overflow', () => {
    const { shown, overflow } = pageList(items, 5, false);
    expect(shown).toEqual([1, 2, 3, 4, 5]);
    expect(overflow).toBe(2);
  });
  it('expanded: shows everything, overflow still reports the count beyond limit', () => {
    const { shown, overflow } = pageList(items, 5, true);
    expect(shown).toEqual(items);
    expect(overflow).toBe(2);
  });
  it('at or under the limit: no overflow, no toggle', () => {
    expect(pageList([1, 2, 3], 5, false)).toEqual({ shown: [1, 2, 3], overflow: 0 });
    expect(pageList([], 5, false)).toEqual({ shown: [], overflow: 0 });
  });
  it('the default page size is 5', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(5);
  });
});
