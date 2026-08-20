/* ============================================================
   notify.test.ts — spec 088 phase-completion notifications.
   Covers the three spec'd hazards:
   1. false-fire-on-load: undefined → awaiting_confirm (opening an
      already-gated task) must NOT badge or notify;
   2. hidden-only: a transition while the tab is visible is silent;
   3. cancelled is the user's own click — always silent.
   Plus: badge set/clear on visibility, Notification firing (tag,
   gating on notifyOn+permission), and the toggle's permission flow.
   jsdom has no Notification — tests install a mock on globalThis.
   ============================================================ */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { notifyOn, notifyBlocked, toggleNotify, notifyTransition, notifyAskDone, clearBadge, notifyNudge, notifyNudgeKind, maybeNudge, maybeNudgeAuto, dismissNudge } from './notify';
import type { WireStatus, WireTask } from '../types';

const BASE = 'Dify Workflow Builder';

const mk = (status: WireStatus, name: string | null = 'My flow'): WireTask =>
  ({
    taskId: 't1',
    project: null,
    workflow: null,
    workflowFile: 'main.yml',
    requirement: 'r',
    seedPath: null,
    deploy: 'none',
    confirmMode: 'each_step',
    phase: 'analyze',
    status,
    workflowSlug: null,
    name,
    sessionIds: {},
    artifacts: {},
  }) as WireTask;

let hidden = false;

class MockNotification {
  static permission: NotificationPermission = 'default';
  static requested: NotificationPermission | null = null; // what the next requestPermission resolves to
  static instances: { title: string; opts?: NotificationOptions }[] = [];
  onclick: (() => void) | null = null;
  constructor(title: string, opts?: NotificationOptions) {
    MockNotification.instances.push({ title, opts });
  }
  close(): void {}
  static requestPermission(): Promise<NotificationPermission> {
    const p = MockNotification.requested ?? 'default';
    MockNotification.permission = p;
    return Promise.resolve(p);
  }
}

beforeEach(() => {
  // fresh favicon link + visible tab + clean badge/signals for every test
  document.querySelectorAll('link[rel="icon"]').forEach((l) => l.remove());
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = '/favicon.svg';
  document.head.appendChild(link);
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  clearBadge();
  document.title = BASE;
  notifyOn.value = false;
  notifyBlocked.value = false;
  MockNotification.permission = 'default';
  MockNotification.requested = null;
  MockNotification.instances = [];
  (globalThis as unknown as { Notification: unknown }).Notification = MockNotification;
  localStorage.clear();
  notifyNudge.value = false;
  notifyNudgeKind.value = 'run'; // spec 104: the banner slot is shared — never leak a kind between tests
});

afterEach(() => {
  delete (globalThis as unknown as { Notification?: unknown }).Notification;
});

const favicon = (): string => document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.getAttribute('href')!;

describe('notifyTransition — badge (no permission needed)', () => {
  it('running → awaiting_confirm while hidden badges title + favicon', () => {
    hidden = true;
    notifyTransition('running', mk('awaiting_confirm'));
    expect(document.title).toBe(`✅ Analyze finished — ready for review — ${BASE}`);
    expect(favicon()).toBe('/favicon-alert.svg');
  });

  it('becoming visible again clears the badge', () => {
    hidden = true;
    notifyTransition('running', mk('done'));
    expect(document.title).toContain('✅');
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(document.title).toBe(BASE);
    expect(favicon()).toBe('/favicon.svg');
  });

  it('hazard 1 — undefined → awaiting_confirm (opening a gated task) never fires', () => {
    hidden = true;
    notifyTransition(undefined, mk('awaiting_confirm'));
    expect(document.title).toBe(BASE);
    expect(favicon()).toBe('/favicon.svg');
  });

  it('hazard 2 — a transition while the tab is VISIBLE is silent', () => {
    hidden = false;
    notifyTransition('running', mk('awaiting_confirm'));
    expect(document.title).toBe(BASE);
    expect(favicon()).toBe('/favicon.svg');
  });

  it('hazard 3 — running → cancelled is silent (user clicked Stop)', () => {
    hidden = true;
    notifyTransition('running', mk('cancelled'));
    expect(document.title).toBe(BASE);
  });

  it('gate-ish prev (awaiting_confirm → done, the terminal-echo path) is silent', () => {
    hidden = true;
    notifyTransition('awaiting_confirm', mk('done'));
    expect(document.title).toBe(BASE);
  });

  it('scaffolding → error badges with ❌', () => {
    hidden = true;
    notifyTransition('scaffolding', mk('error'));
    expect(document.title).toBe(`❌ Build failed — ${BASE}`);
  });
});

describe('notifyTransition — browser Notification', () => {
  it('fires with a per-task tag when enabled + granted + hidden', () => {
    hidden = true;
    notifyOn.value = true;
    MockNotification.permission = 'granted';
    notifyTransition('running', mk('done'));
    expect(MockNotification.instances).toHaveLength(1);
    expect(MockNotification.instances[0].title).toBe('Build finished');
    expect(MockNotification.instances[0].opts?.tag).toBe('builder-t1');
    expect(MockNotification.instances[0].opts?.body).toBe('My flow');
  });

  it('badges but does NOT construct a Notification when the toggle is off', () => {
    hidden = true;
    MockNotification.permission = 'granted';
    notifyTransition('running', mk('done'));
    expect(document.title).toContain('✅');
    expect(MockNotification.instances).toHaveLength(0);
  });

  it('notifyAskDone fires the answer notification while hidden', () => {
    hidden = true;
    notifyOn.value = true;
    MockNotification.permission = 'granted';
    notifyAskDone('My flow');
    expect(document.title).toBe(`✅ Answer ready — ${BASE}`);
    expect(MockNotification.instances[0]?.opts?.tag).toBe('builder-ask');
  });
});

describe('maybeNudge — the enable-notifications banner', () => {
  it('shows while permission is still askable (default) and not previously dismissed', () => {
    maybeNudge();
    expect(notifyNudge.value).toBe(true);
  });

  it('never shows when permission is already granted or denied', () => {
    MockNotification.permission = 'granted';
    maybeNudge();
    expect(notifyNudge.value).toBe(false);
    MockNotification.permission = 'denied';
    maybeNudge();
    expect(notifyNudge.value).toBe(false);
  });

  it('never shows when notifications are already on', () => {
    notifyOn.value = true;
    maybeNudge();
    expect(notifyNudge.value).toBe(false);
  });

  it('dismiss persists — a later running build stays silent', () => {
    maybeNudge();
    dismissNudge();
    expect(notifyNudge.value).toBe(false);
    expect(localStorage.getItem('notifyNudgeDismissed')).toBe('1');
    maybeNudge();
    expect(notifyNudge.value).toBe(false);
  });

  it('enabling via toggleNotify hides the banner and never re-nudges', async () => {
    maybeNudge();
    expect(notifyNudge.value).toBe(true);
    MockNotification.requested = 'granted';
    await toggleNotify();
    expect(notifyNudge.value).toBe(false);
    expect(localStorage.getItem('notifyNudgeDismissed')).toBe('1');
    notifyOn.value = false; // even switched off again, the nudge stays retired
    maybeNudge();
    expect(notifyNudge.value).toBe(false);
  });
});

describe('toggleNotify — permission flow', () => {
  it('granted → on + persisted; second click → off', async () => {
    MockNotification.requested = 'granted';
    await toggleNotify();
    expect(notifyOn.value).toBe(true);
    expect(localStorage.getItem('notify')).toBe('1');
    await toggleNotify();
    expect(notifyOn.value).toBe(false);
    expect(localStorage.getItem('notify')).toBe('0');
  });

  it('denied → stays off and surfaces blocked', async () => {
    MockNotification.requested = 'denied';
    await toggleNotify();
    expect(notifyOn.value).toBe(false);
    expect(notifyBlocked.value).toBe(true);
    expect(localStorage.getItem('notify')).toBe(null);
  });
});

/* ============================================================
   spec 104 S1 — the SECOND invitation, at the moment the user
   chooses an unattended mode. A new `describe` beside the 088
   block above, never edits into it (spec 104 §6).

   The hole being closed: "don't show again", clicked while
   sitting in front of a running build, used to silence the offer
   forever — including for auto mode, a context the user had not
   been asked about yet.
   ============================================================ */
describe('maybeNudgeAuto — the unattended-mode banner (spec 104 S1)', () => {
  it('THE HOLE: a dismissed run-banner does NOT silence the auto invitation', () => {
    maybeNudge();
    dismissNudge(); // "don't show again", answered for the watching-a-build context
    expect(localStorage.getItem('notifyNudgeDismissed')).toBe('1');
    expect(notifyNudge.value).toBe(false);

    maybeNudgeAuto(); // …days later, the user switches to auto
    expect(notifyNudge.value).toBe(true);
    expect(notifyNudgeKind.value).toBe('auto');
  });

  it('shows exactly once per machine — choosing auto again stays silent', () => {
    maybeNudgeAuto();
    expect(notifyNudge.value).toBe(true);
    dismissNudge();
    expect(notifyNudge.value).toBe(false);
    expect(localStorage.getItem('notifyNudgeAutoDismissed')).toBe('1');
    maybeNudgeAuto();
    expect(notifyNudge.value).toBe(false);
  });

  it('inherits 088\'s guards: already-on, granted-but-off, and denied all stay silent', () => {
    notifyOn.value = true;
    maybeNudgeAuto();
    expect(notifyNudge.value).toBe(false);

    notifyOn.value = false;
    MockNotification.permission = 'granted'; // permission held, bell switched off — 088 chose silence
    maybeNudgeAuto();
    expect(notifyNudge.value).toBe(false);

    MockNotification.permission = 'denied'; // the bell's own tooltip explains this one
    maybeNudgeAuto();
    expect(notifyNudge.value).toBe(false);
  });

  it('dismissing AUTO also retires the run banner — no two invitations back to back', () => {
    maybeNudgeAuto();
    dismissNudge();
    // choose auto → dismiss → send → the build starts running: must NOT re-ask
    maybeNudge();
    expect(notifyNudge.value).toBe(false);
    expect(localStorage.getItem('notifyNudgeDismissed')).toBe('1');
  });

  it('enabling from the auto banner retires BOTH keys', async () => {
    maybeNudgeAuto();
    expect(notifyNudgeKind.value).toBe('auto');
    MockNotification.requested = 'granted';
    await toggleNotify();
    expect(notifyOn.value).toBe(true);
    expect(notifyNudge.value).toBe(false);
    expect(localStorage.getItem('notifyNudgeDismissed')).toBe('1');
    expect(localStorage.getItem('notifyNudgeAutoDismissed')).toBe('1');
    notifyOn.value = false; // even switched back off, neither invitation returns
    maybeNudgeAuto();
    maybeNudge();
    expect(notifyNudge.value).toBe(false);
  });

  it('never enables notifications by itself — the permission stays the user\'s to grant', () => {
    maybeNudgeAuto();
    expect(notifyOn.value).toBe(false);
    expect(MockNotification.permission).toBe('default');
    expect(MockNotification.instances).toHaveLength(0);
  });

  it('a run banner already on screen keeps its wording — first up wins the slot', () => {
    maybeNudge();
    expect(notifyNudgeKind.value).toBe('run');
    maybeNudgeAuto();
    expect(notifyNudgeKind.value).toBe('run');
  });
});
