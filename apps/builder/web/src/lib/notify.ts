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
  retireNudges(); // enabled — BOTH invitations have done their job, permanently (spec 104 S1)
  try {
    localStorage.setItem(PREF_KEY, '1');
  } catch { /* ignore */ }
}

/* ───────────────────────── enable-notifications nudge banner ───────────────────────── */

const NUDGE_KEY = 'notifyNudgeDismissed';
/** Spec 104 S1 — a SECOND key, for the auto-mode invitation, deliberately INDEPENDENT of NUDGE_KEY.
 *  A "don't show again" clicked while sitting in front of a running build was answered for a context
 *  the user was IN; carrying it into an unattended four-phase auto run answers a question they were
 *  never asked. That carry-over is the whole hole this slice exists to close. */
const NUDGE_AUTO_KEY = 'notifyNudgeAutoDismissed';

/** True → App renders the slide-down "enable notifications?" banner. */
export const notifyNudge = signal<boolean>(false);

/** WHICH invitation is on screen: picks the banner's wording, and picks which key the ✕ retires.
 *  'run'  — spec 088: a build is running, so notifications are USEFUL.
 *  'auto' — spec 104: the user just chose an unattended mode, so they are NECESSARY. */
export const notifyNudgeKind = signal<'run' | 'auto'>('run');

/** The gate BOTH invitations share: still off, still askable, nothing already on screen.
 *  already-on, unsupported, granted-but-off, and denied (the bell tooltip explains that one) all stay
 *  silent — spec 088 closed those two permission cases on purpose and spec 104 §4 does not reopen them. */
function nudgeAskable(): boolean {
  if (notifyNudge.value || notifyOn.value) return false;
  return hasNotification() && Notification.permission === 'default';
}

const retired = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

const retire = (key: string): void => {
  try {
    localStorage.setItem(key, '1');
  } catch { /* ignore */ }
};

/** Called by the store whenever a build is RUNNING — the moment notifications become VALUABLE. */
export function maybeNudge(): void {
  if (!nudgeAskable() || retired(NUDGE_KEY)) return;
  notifyNudgeKind.value = 'run';
  notifyNudge.value = true;
}

/** Spec 104 S1 — called by the store when the user CHOOSES an unattended confirm-mode: the moment
 *  notifications become NECESSARY (four phases, no gate to come back to; a usage limit kills the run
 *  and nothing says so). First banner up wins — a 'run' banner already on screen is already making
 *  the same offer, so this stays quiet rather than swapping the text under the user. */
export function maybeNudgeAuto(): void {
  if (!nudgeAskable() || retired(NUDGE_AUTO_KEY)) return;
  notifyNudgeKind.value = 'auto';
  notifyNudge.value = true;
}

/** ✕ on the banner. Retires the invitation that is ON SCREEN — ASYMMETRICALLY: dismissing the 'auto'
 *  one also retires 'run', because declining the stronger, more specific offer leaves the weaker one
 *  nothing new to say (and untreated they fire back-to-back: choose auto → dismiss → send → the build
 *  runs → a second banner). The reverse must NOT hold: 'run' dismissed leaves 'auto' free to ask.
 *  Bound straight to onClick, so it takes NO arguments (it would be handed a MouseEvent). */
export function dismissNudge(): void {
  const auto = notifyNudgeKind.value === 'auto';
  notifyNudge.value = false;
  retire(auto ? NUDGE_AUTO_KEY : NUDGE_KEY);
  if (auto) retire(NUDGE_KEY);
}

/** Notifications are ON — neither invitation has anything left to offer, so both retire. */
function retireNudges(): void {
  notifyNudge.value = false;
  retire(NUDGE_KEY);
  retire(NUDGE_AUTO_KEY);
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
