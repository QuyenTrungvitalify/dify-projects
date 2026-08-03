/* sidebar-prefs.ts — a client-side UI preference: how many rows each sidebar section shows before a
   "Show N more" / "Show less" toggle (spec 084 follow-up). A @preact/signals signal + localStorage, same
   pattern as theme/lang; no server involvement. Default 5. Read `.value` during render to auto-subscribe. */
import { signal } from '@preact/signals';

const KEY = 'builder:sidebarPageSize';
export const DEFAULT_PAGE_SIZE = 5;

function readInitial(): number {
  try {
    const v = parseInt(localStorage.getItem(KEY) ?? '', 10);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_PAGE_SIZE;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

/** Rows shown per section before collapsing. Components read `.value` and re-render on change. */
export const sidebarPageSize = signal<number>(readInitial());

/** Set + persist the page size (clamped to a sane 1..999). */
export function setSidebarPageSize(n: number): void {
  const v = Math.max(1, Math.min(999, Math.floor(n) || DEFAULT_PAGE_SIZE));
  sidebarPageSize.value = v;
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    /* private mode / quota — the in-memory signal still applies for this session */
  }
}

/** PURE — split a list for the collapse UI: `shown` is the visible slice, `overflow` is how many are
 *  hidden (0 ⇒ no toggle). `expanded` shows all. Unit-tested directly (no render). */
export function pageList<T>(items: T[], limit: number, expanded: boolean): { shown: T[]; overflow: number } {
  const overflow = Math.max(0, items.length - limit);
  const shown = expanded || overflow === 0 ? items : items.slice(0, limit);
  return { shown, overflow };
}
