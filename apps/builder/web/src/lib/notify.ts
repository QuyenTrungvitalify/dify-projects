/* ============================================================
   notify.ts — phase-completion notifications (spec 088).
   Two layers, both CLIENT-only (the SSE stream already delivers
   every transition — no server change):

   1. Tab badge (always on, no permission): when a phase settles
      while the tab is HIDDEN, prefix document.title with ✅/❌ and
      swap the favicon to the badged variant. Cleared the moment
      the tab becomes visible again.
   2. Browser Notification (opt-in via the header bell): fired for
      the same transitions, only while hidden, only when the user
      enabled it AND the browser granted permission. Click focuses
      the tab.

   Transition source of truth: store.applyTask's prevStatus →
   t.status edge. Guards that live HERE (so every caller is safe):
   - prev must be a run-ish status (running/scaffolding). Opening
     an already-gated task arrives as undefined→awaiting_confirm
     and must NOT fire (the false-fire-on-load hazard).
   - `cancelled` never notifies — the user clicked Stop themself.
   - jsdom / older browsers: every Notification access is
     feature-guarded, so tests and odd embedders degrade to the
     title badge alone.
   ============================================================ */
import { signal } from '@preact/signals';
import { t, tf, phaseLabel } from './i18n';
import type { WireStatus, WireTask } from '../types';

/* Captured at module load (main.tsx runs after <head> is parsed); fallback for tests. */
const BASE_TITLE =
  typeof document !== 'undefined' && document.title ? document.title : 'Dify Workflow Builder';

const PREF_KEY = 'notify';
const FAVICON = '/favicon.svg';
const FAVICON_ALERT = '/favicon-alert.svg';

const hasNotification = (): boolean => typeof Notification !== 'undefined';

/** The user's toggle. Re-armed on load ONLY if the browser still grants permission — a revoked
 *  site-setting silently degrades to "off" instead of a toggle that looks on but never fires. */
export const notifyOn = signal<boolean>(
  (() => {
    try {
      return localStorage.getItem(PREF_KEY) === '1' && hasNotification() && Notification.permission === 'granted';
    } catch {
      return false;
    }
  })(),
);

/** True when the browser permission is DENIED — the bell tooltip explains it can only be re-allowed
 *  from the browser's own site settings (we cannot re-prompt a denied origin). */
export const notifyBlocked = signal<boolean>(
  hasNotification() && Notification.permission === 'denied',
);

/** Bell click. Enabling runs inside the click handler — the user gesture requestPermission wants. */
export async function toggleNotify(): Promise<void> {
  if (notifyOn.value) {
    notifyOn.value = false;
    try {
      localStorage.setItem(PREF_KEY, '0');
    } catch { /* ignore */ }
    return;
  }
  if (!hasNotification()) return; // unsupported browser — title badge still works
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  notifyBlocked.value = perm === 'denied';
  if (perm !== 'granted') return;
  notifyOn.value = true;
  dismissNudge(); // enabled — the nudge banner has done its job, permanently
  try {
    localStorage.setItem(PREF_KEY, '1');
  } catch { /* ignore */ }
}

/* ───────────────────────── enable-notifications nudge banner ───────────────────────── */

const NUDGE_KEY = 'notifyNudgeDismissed';

/** True → App renders the slide-down "enable notifications?" banner. */
export const notifyNudge = signal<boolean>(false);

/** Called by the store whenever a build is RUNNING — the exact moment notifications become
 *  valuable. Shows the banner only while asking is still possible (permission 'default'):
 *  already-on, unsupported, granted-but-off, and denied (the bell tooltip explains that one)
 *  all stay silent, as does a past dismissal (persisted). */
export function maybeNudge(): void {
  if (notifyNudge.value || notifyOn.value) return;
  if (!hasNotification() || Notification.permission !== 'default') return;
  try {
    if (localStorage.getItem(NUDGE_KEY) === '1') return;
  } catch { /* ignore */ }
  notifyNudge.value = true;
}

/** ✕ on the banner (or a successful enable): hide now and never nudge again. */
export function dismissNudge(): void {
  notifyNudge.value = false;
  try {
    localStorage.setItem(NUDGE_KEY, '1');
  } catch { /* ignore */ }
}

/* ───────────────────────── tab badge (title + favicon) ───────────────────────── */

let badged = false;

function faviconLink(): HTMLLinkElement | null {
  return document.querySelector('link[rel="icon"]');
}

function setBadge(marker: string, label: string): void {
  document.title = `${marker} ${label} — ${BASE_TITLE}`;
  faviconLink()?.setAttribute('href', FAVICON_ALERT);
  badged = true;
}

export function clearBadge(): void {
  if (!badged) return;
  document.title = BASE_TITLE;
  faviconLink()?.setAttribute('href', FAVICON);
  badged = false;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) clearBadge();
  });
}

/* ───────────────────────── firing ───────────────────────── */

const FROM_RUN = new Set<WireStatus>(['running', 'scaffolding']);

function fire(marker: string, label: string, body: string, tag: string): void {
  if (!document.hidden) return; // the user is watching — badge/noti would be noise
  setBadge(marker, label);
  if (!notifyOn.value || !hasNotification() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(label, { body, tag, icon: FAVICON });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch { /* notification failure must never break the store update */ }
}

/** Hooked from store.applyTask on every status edge (build tasks only — a consult's thread is driven
 *  by the ask machinery; its notifications come from notifyAskDone below). */
export function notifyTransition(prev: WireStatus | undefined, task: WireTask): void {
  if (!prev || !FROM_RUN.has(prev) || prev === task.status) return;
  if (task.status === 'awaiting_confirm') {
    fire('✅', tf('notifGate', { phase: phaseLabel(task.phase) }), task.name ?? '', 'builder-' + task.taskId);
  } else if (task.status === 'done') {
    fire('✅', t('notifDone'), task.name ?? '', 'builder-' + task.taskId);
  } else if (task.status === 'error') {
    fire('❌', t('notifError'), task.name ?? '', 'builder-' + task.taskId);
  }
  // cancelled: deliberate silence — the user stopped it themself.
}

/** Hooked from store.applyAskDone — an Ask/consult answer finished streaming. */
export function notifyAskDone(taskName?: string): void {
  fire('✅', t('notifAnswer'), taskName ?? '', 'builder-ask');
}
