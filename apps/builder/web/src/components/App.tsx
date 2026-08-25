/* ============================================================
   App.tsx — live orchestrator (lat4-ui). Replaces the static
   mock run-engine with the signals store: SSE drives the phase
   track, the thread, and the gate cards; the composer posts
   start/confirm/reply; the artifact panel reads/writes SPEC.md.
   The SPA adds NO build logic — it only renders what the backend
   sends and posts the user's gate decisions (dumb-renderer, §H).
   ============================================================ */
import { useState, useRef, useEffect } from 'preact/hooks';
import { Sidebar } from './Sidebar';
import { PhaseTrack, Disclosure, GateCard, GateActions, QaAnswer, Composer, MsgAttachments } from './Chat';
import { ArtifactPanel } from './ArtifactPanel';
import { CreateProjectModal, IntakeYamlModal, ConfirmModal } from './Modal';
import { BgTray } from './BgTray';
import { DevPanel } from './DevPanel';
import { PrefsMenu } from './PrefsMenu';
import { devMode } from '../lib/dev';
import { I } from './Icon';
import { suggestions } from '../data';
import { t as tr, tf, lang } from '../lib/i18n';
import { notifyOn, notifyBlocked, toggleNotify, notifyNudge, notifyNudgeKind, dismissNudge } from '../lib/notify';
import * as store from '../store';
import { type ComposerAttachment, MAX_ATTACHMENTS, isAcceptedFile, fileToDataUrl, toWire } from '../lib/attachments';
import type { ArtifactTab, Settings, WireTask, WireGateAction, Seed, NewTaskOpts } from '../types';
import { newTaskCrumb, runContextCrumb, workflowOptions, activeSidebarProject, activeSidebarWorkflow, type NewTaskCrumb } from '../lib/crumb';
import { canPromoteFromConversation } from '../lib/promote-visibility';
import { composerTarget, replyLabel, type ComposerIntent } from '../lib/composer-route';
import { canPropose, confirmModeOptions } from '../lib/propose-lane';
import { api, ApiError } from '../api';

let _attUid = 0;
const attUid = (): string => 'att' + ++_attUid;

/** Which artifact tabs are available for a task (contents-driven, with a phase fallback). */
function availableTabs(task: WireTask): ArtifactTab[] {
  // spec 082: a consult chat produces no artifacts at all — no tabs (its phase='test' pin would
  // otherwise fall through to the reached() fallback and offer empty panes).
  if (task.kind === 'consult') return [];
  // spec 052: a promote build has only its distilled pattern (no SPEC.md / report / diff) — show the yaml
  // tab alone (the phase='test' fallback would otherwise offer empty Spec/Report panes).
  if (task.kind === 'promote') return task.artifactContents?.yaml ? ['yaml'] : [];
  const order: ('analyze' | 'spec' | 'implement' | 'test')[] = ['analyze', 'spec', 'implement', 'test'];
  const reached = (p: string): boolean => order.indexOf(task.phase) >= order.indexOf(p as never);
  const a = task.artifactContents;
  const tabs: ArtifactTab[] = [];
  if ((a && a.spec) || reached('spec')) tabs.push('spec');
  if ((a && a.yaml) || (reached('implement') && task.phase !== 'analyze')) tabs.push('yaml');
  if (a && a.diff) tabs.push('diff');
  if ((a && a.report) || task.status === 'done') tabs.push('report');
  return tabs;
}

/** Spec 062 S4 — trigger the browser download of the run dossier zip. The endpoint responds with
 *  `Content-Disposition: attachment`, so the click downloads (server-named) without navigating away. */
function downloadBundle(taskId: string): void {
  const a = document.createElement('a');
  a.href = `/api/tasks/${encodeURIComponent(taskId)}/bundle`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function App() {
  const [sbCollapsed, setSb] = useState(false);
  // theme: initial value already set on <html> pre-mount by the index.html script.
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'),
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch { /* ignore */ }
  }, [theme]);
  const [draft, setDraft] = useState('');
  // spec 012/025: files attached in the composer (shared empty + dock — the two views are exclusive).
  const [files, setFiles] = useState<ComposerAttachment[]>([]);
  // spec 092: intent is per-message (the send button pressed), so the composer holds NO ask|change mode
  // anymore. What remains is `armed` — a PRESENTATION hint set by a gate's reply-kind action ("Edit
  // spec", "Request a fix"): it highlights the change pill, switches the placeholder, and remembers the
  // arming action's label so the resolved gate reads true ("Edit spec") instead of the generic
  // "Requested changes". It never changes where Enter sends (Enter stays 'ask'). `focusToken` bumps to
  // focus the composer the moment the hint is armed.
  const [armed, setArmed] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const asking = store.asking.value;
  const [createOpen, setCreateOpen] = useState(false);
  const [importBaseOpen, setImportBaseOpen] = useState(false); // spec 051 D5
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [artifactTab, setArtifactTab] = useState<ArtifactTab>('spec');
  const [exportMenuOpen, setExportMenuOpen] = useState(false); // spec 062 follow-up: the Export dropdown
  const exportBtnRef = useRef<HTMLButtonElement>(null); // anchor for the fixed-positioned menu (see below)
  const [exportMenuPos, setExportMenuPos] = useState<{ top: number; left: number } | null>(null);
  // Open/close the Export menu. On OPEN, snapshot the button's viewport rect so the fixed-positioned menu
  // (which must escape the header's overflow-x:auto clip) anchors right under the button. Anchored by the
  // button's LEFT edge (no window.innerWidth dependency — that read was flaky) and measured at click time.
  const toggleExportMenu = (): void => {
    setExportMenuOpen((o) => {
      if (!o) {
        const r = exportBtnRef.current?.getBoundingClientRect();
        if (r) setExportMenuPos({ top: r.bottom + 6, left: r.left });
      }
      return !o;
    });
  };
  const [exportingDrive, setExportingDrive] = useState(false); // spec 062 follow-up: the Drive upload in-flight
  const threadRef = useRef<HTMLDivElement>(null);

  // spec 088: the bell's callout bubble. The pill row (.chat-top-right) scrolls horizontally, so an
  // absolutely-positioned child would be clipped — measure the bell and render the tip FIXED instead.
  const tipWrapRef = useRef<HTMLSpanElement>(null);
  const [tipPos, setTipPos] = useState<{ top: number; right: number } | null>(null);
  // Hidden while the artifact panel is open: the tip is position:fixed (to escape the pill row's
  // overflow clip), so it would float OVER the slid-in panel even though its anchor bell is covered.
  const tipVisible = !notifyOn.value && !notifyBlocked.value && !artifactOpen;
  useEffect(() => {
    if (!tipVisible) { setTipPos(null); return; }
    const place = (): void => {
      const r = tipWrapRef.current?.getBoundingClientRect();
      if (r) setTipPos({ top: r.bottom + 7, right: window.innerWidth - r.right });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true); // capture: the pill row itself can scroll
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [tipVisible, lang.value]);

  // Live signals.
  const task = store.task.value;
  const thread = store.thread.value;
  const tree = store.tree.value;
  const seeds = store.seeds.value;
  const phaseStates = store.phaseStates.value;
  const current = store.currentPhase.value;
  const busy = store.busy.value;
  const connected = store.connected.value;
  const startError = store.startError.value;
  const busyHolder = store.busyHolder.value;
  const active = store.active.value;
  const settings = store.settings.value;
  const confirmReq = store.confirmState.value;

  useEffect(() => {
    void store.loadTree();
    void store.loadSeeds();
    void store.loadActive(); // load-recovery: list in-progress builds so a parked one isn't stranded (Lát 6)
    void store.loadConsults(); // spec 082: the sidebar's Trao đổi section
    void store.loadPromotes(); // spec 084 S1.5: the sidebar's 蒸留 (distill) section
    void store.restoreBgDistills(); // spec 084 §7 Q2: rebuild the distill tray from non-terminal promote tasks
  }, []);
  // spec 082 §4.4 — the graduate bridge: when the distill answer lands, open the new-task surface in
  // BUILD mode with the requirement prefilled (user edits, then Run → the normal POST /api/tasks door).
  const gradDraft = store.graduateDraft.value;
  useEffect(() => {
    if (!gradDraft) return;
    store.graduateDraft.value = null; // consume exactly once
    newTask();
    store.settings.value = { ...store.settings.value, mode: 'build' };
    setDraft(gradDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradDraft]);
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [thread]);
  // spec 092 (FIX-I's successor): the arm hint dissolves on every phase transition (incl. auto-advance)
  // — a hint left over at a NEW gate would mislabel the next change send and keep a stale highlight.
  // Unlike the sticky mode this replaced, a stale hint can no longer mis-ROUTE anything (intent is
  // per-send), so this is cosmetics + label hygiene, not a routing guard.
  useEffect(() => {
    setArmed(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.taskId, task?.phase]);

  const view: 'empty' | 'conversation' = task ? 'conversation' : 'empty';
  const activeTaskId = task?.taskId ?? null;
  // UX: the sidebar's active/selected menu node. When a build is open it's that build's project/workflow;
  // on the new-task surface it mirrors the pre-selection (project "+"/workflow "+"/a freshly-created
  // project via targetProject). `activeWorkflow` is the compound `project/workflow` key the tree rows use.
  const editingSel = task ? null : store.splitWorkflowSetting(settings.workflow);
  // spec 084 S1.5: a promote/distill task lives in the Distill section, so it must NOT co-highlight its
  // SOURCE project/workflow in the Build tree (activeSidebarProject/Workflow null it out for promote).
  const activeProject = task ? activeSidebarProject(task) : (editingSel?.project ?? settings.targetProject ?? null);
  const activeWorkflow = task
    ? activeSidebarWorkflow(task)
    : (editingSel?.project ? `${editingSel.project}/${editingSel.workflow}` : null);
  const settingsSubset: Settings = { workflow: settings.workflow, confirm: settings.confirm, fast: settings.fast };
  const onSettings = (patch: Partial<Settings>): void => {
    store.settings.value = { ...store.settings.value, ...patch };
  };
  /**
   * spec 096 — the model is NOT a build setting, so it gets its own funnel (see Composer's `onModel`).
   * On the entry composer there is no task yet, so the choice lands on the remembered default: it
   * outlives the tab because a team that decided on Opus decided once, and re-picking every reload is
   * how a default quietly becomes "whatever was there".
   */
  const onEntryModel = (v: string): void => {
    store.settings.value = { ...store.settings.value, model: v };
    store.rememberModel(v);
  };
  // spec 029: the new-task crumb + its clear action (reads the FULL signal, incl. targetProject).
  const crumb = newTaskCrumb(settings.workflow, settings.targetProject, tree);
  const clearNewTaskCrumb = (): void => {
    store.settings.value = { ...store.settings.value, workflow: 'none', targetProject: null };
  };
  // spec 029: context breadcrumb for the OPEN build — which project/workflow it belongs to (shown in
  // the conversation-view chat-top, left of the phase track). null ⇒ no project context to show.
  const runCtx = task ? runContextCrumb(task, tree) : null;
  // "Running with a base" indicator: an edit-existing build carries the chosen base workflow
  // (`task.workflow`), a Dify-seed build carries `seedAppId`. Either → the run-crumb shows a `ベース:`
  // badge so the base is pinned in the header (replacing the old auto-open of the base YAML). Promote
  // builds render their own header, so exclude them.
  const editingBase = !!task && task.kind !== 'promote' && (!!task.workflow || !!task.seedAppId);
  // spec 030: a workflow is identified by its {project, workflow} pair (the same name can exist in
  // several projects), so the composer's Workflow dropdown carries a COMPOUND `project/workflow` value
  // with a readable "Project / Workflow" label — `_drafts` scratch is excluded. Sorted by RECENCY
  // (most-recently-touched first) so it stays usable when there are many workflows (workflowOptions).
  // `settings.workflow` rides along so the ARMED target always has an option of its own: a `_drafts`
  // edit falls outside the list, and without an entry the chip printed the raw compound slug instead of
  // the name the crumb right above it shows (the two disagreed on what you were editing).
  const workflows = workflowOptions(tree, settings.workflow);

  /* ---------- actions ---------- */
  // spec 012/025: read dropped/pasted/picked files → base64 chips, honoring the 3-file cap + type/size
  // guard (the backend re-validates and is authoritative — a bad request still 400s).
  async function addFiles(dropped: File[]): Promise<void> {
    const accepted = dropped.filter(isAcceptedFile);
    if (!accepted.length) return;
    const room = MAX_ATTACHMENTS - files.length;
    if (room <= 0) return;
    const loaded = await Promise.all(
      accepted.slice(0, room).map(async (f) => ({
        id: attUid(), name: f.name, mime: f.type, dataUrl: await fileToDataUrl(f),
      })),
    );
    setFiles((prev) => [...prev, ...loaded].slice(0, MAX_ATTACHMENTS));
  }
  function removeFile(id: string): void {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  // spec 103 Lane B / spec 105 — see `lib/propose-lane.ts` for why this is a pure function.
  const proposeLane = canPropose(task);

  function send(text?: string, intent: ComposerIntent = 'ask'): void {
    const msg = (text ?? draft).trim();
    if (!msg) return; // files augment, never replace, the text (spec 012 Q2)
    const atts = files.length ? toWire(files) : undefined;
    const prevFiles = files;
    setDraft('');
    setFiles([]);
    // spec 040 D2: the store dispatches CATCH internally and resolve (they never reject), so a 409 turn-busy
    // is signalled by a `false` return — restore the composer so the user just re-sends. The guards
    // (`d => d || msg`) never clobber text typed during the in-flight window.
    // spec 092: on failure the arm hint is deliberately NOT touched — the draft and files come back and
    // the change pill stays highlighted, so the retry is one click on the same button. (Under the old
    // sticky mode, a failed /reply once silently disarmed change-mode and the retry became a question —
    // observed in the field on a done build against a not-yet-restarted server. Per-message intent makes
    // that class of bug unrepresentable: routing reads the button pressed, never composer state.)
    const onDone = (ok: boolean): void => {
      if (ok) {
        setArmed(null); // the hint served its one message
        return;
      }
      setDraft((d) => d || msg);
      setFiles((f) => (f.length ? f : prevFiles));
    };
    // Where this message goes (spec 033 FIX-F + 034 D3/D5 + the post-import fix loop) is decided by the
    // PURE `composerTarget` — see lib/composer-route.ts for the whole rule and its tests. The branches
    // below only carry out the verdict, so the decision can never drift from what the tests pin.
    const t = store.task.value;
    const target = composerTarget(t, intent);
    if (target === 'start') {
      // spec 082 §4.5: the Mode chip routes the entry — consult (chat lane, default) vs build (as today).
      if (settings.mode === 'consult') {
        void store.startConsult(msg, atts).then(onDone);
      } else {
        void store.start(msg, atts).then(onDone); // a new build ignores the send intent (composerTarget: no task → start)
      }
      return;
    }
    if (target === 'ask') {
      // The default at every gate AND at a terminal build (034 D3/D5) — with files, since attach is live
      // for questions too (they'd otherwise be dropped on send, the worst kind of silent loss).
      void store.ask(msg, atts).then(onDone);
      return;
    }
    // 'reply' — a Request-changes at a parked gate, a Retry out of error, a promote note, or the
    // post-import fix on a DONE build (which reopens it server-side and resumes the implement session).
    // spec 103 Lane B: 'propose' rides the SAME /reply route and differs only in the mode flag — the
    // server decides whether a proposal is legal and falls back to a direct fix if not, so the FE never
    // has to model the eligibility rules twice.
    void store
      .reply(msg, replyLabel(t!.status, t!.kind, intent, armed ?? 'Requested changes'), atts,
             intent === 'propose' ? 'propose' : undefined)
      .then(onDone);
  }
  // spec 053: the error gate's one-click "Retry phase" — a text-less re-run of the failed phase that
  // CARRIES any staged composer files (attach is live at an error gate, so dropping them would be silent
  // data loss). Empty text is allowed only because store.reply/​the server relax the guard for status==='error'.
  // Files are cleared only on success (mirrors send()'s reset), so a 409 turn-busy keeps them staged.
  function onRetry(): void {
    const atts = files.length ? toWire(files) : undefined;
    void store.reply('', 'Retry phase', atts).then((ok) => { if (ok) setFiles([]); });
  }
  function openArtifact(tab: ArtifactTab): void {
    setArtifactTab(tab);
    setArtifactOpen(true);
  }
  // spec 016 D4: the irreversible/destructive gate confirms route through the shared ConfirmModal first
  // (mirroring the Stop pill). Accept-anyway ships a lint-failing build; Import pushes to a live Dify
  // workspace (creates a NEW app). The benign advances (Continue/Implement/Skip) fire with no dialog.
  async function onConfirm(action: WireGateAction, extra?: { slug?: string; name?: string; keepCurrent?: boolean }): Promise<void> {
    const flag = store.task.value?.gate?.flag;
    if (flag === 'still_failing' && action.id === 'accept') {
      const ok = await store.askConfirm({
        title: tr('acceptAnywayTitle'), message: tr('acceptAnywayMsg'),
        okLabel: tr('acceptAnywayOk'), danger: true,
      });
      if (!ok) return;
    }
    if (flag === 'awaiting_import' && action.id === 'import') {
      const file = store.task.value?.workflowFile ?? 'main.yml';
      const ok = await store.askConfirm({
        title: tr('importConfirmTitle'), message: tf('importConfirmMsg', { file }),
        okLabel: tr('importConfirmOk'),
      });
      if (!ok) return;
    }
    void store.confirm(action, extra);
  }
  // The cancel-kind gate action (Discard/Abandon) is terminal — confirm before abandoning the build.
  async function onDiscard(): Promise<void> {
    const ok = await store.askConfirm({
      title: tr('discardTitle'), message: tr('discardMsg'),
      okLabel: tr('discardOk'), danger: true,
    });
    if (ok) void store.cancel();
  }
  // spec 029: the two sidebar "+" intents flow in via opts. resetToNew() first (clears prior state incl.
  // any stale pre-selection), THEN re-apply this launch's opts — that ordering IS the non-clobber (the
  // footer/manual "New task" passes no opts → a clean from-scratch slate).
  function newTask(opts?: NewTaskOpts): void {
    store.resetToNew();
    // spec 082 §4.5 rev: every newTask entry (Build "+", a workflow-row edit, a project preselect) is a
    // BUILD action — force the composer's entry mode to build so the empty surface shows the build chips.
    store.settings.value = { ...store.settings.value, mode: 'build' };
    // spec 030: workflow-"+" pre-selects the COMPOUND `project/workflow` value (the dropdown format), so
    // edit-existing resolves the right pair; project-"+" sets just the target project folder (workflow
    // stays 'none' from resetToNew → a from-scratch build).
    if (opts?.baseWorkflow) store.settings.value = { ...store.settings.value, workflow: `${opts.baseWorkflow.project}/${opts.baseWorkflow.workflow}`, targetProject: null };
    if (opts?.targetProject) store.settings.value = { ...store.settings.value, targetProject: opts.targetProject };
    setArtifactOpen(false);
    setArmed(null); // a fresh surface carries no leftover arm hint (spec 092)
  }
  // spec 082 §4.5 rev: the Chat "+" — a fresh empty surface in CONSULT mode (the sibling of newTask).
  function newChat(): void {
    store.resetToNew();
    store.settings.value = { ...store.settings.value, mode: 'consult' };
    setArtifactOpen(false);
    setArmed(null);
  }
  // Stop pill (design handoff): the in-conversation way to cancel the OPEN build while its turn is
  // running (the gate card — the only other cancel affordance in the main view — isn't shown mid-turn).
  // Real-app semantics: /cancel is terminal, so this confirms via the common ConfirmModal (danger).
  async function onStop(): Promise<void> {
    const t = store.task.value;
    if (!t) return;
    const raw = t.name?.trim() || t.requirement;
    const title = raw.length > 46 ? raw.slice(0, 46) + '…' : raw;
    const ok = await store.askConfirm({
      title: tr('stopBuildTitle'),
      message: tf('stopBuildMsg', { name: title }),
      okLabel: tr('stopBuild'),
      danger: true,
    });
    if (ok) void store.cancel();
  }

  // Spec 103 step 1 — take back the last fix round. Confirmed, and DANGER-styled, for one reason: it
  // throws away a turn the human already paid for (~$0.4–1.0 measured), and redoing it costs that
  // again. The link itself is small and lives among read-only links, so a misclick is unlikely; this
  // is the second guard, not the first.
  async function onUndoFix(): Promise<void> {
    const ok = await store.askConfirm({
      title: tr('undoFixTitle'),
      message: tr('undoFixMsg'),
      okLabel: tr('undoFix'),
      danger: true,
    });
    if (ok) void store.undoFix();
  }

  // spec 062 follow-up: "Export to Drive" — upload the run dossier straight to the team's Drive (exports/).
  // No team Drive configured → the backend 409s and we fall back to the plain local download, so the button
  // always does SOMETHING useful. Success/fallback both surface a small info dialog.
  async function onExportDrive(): Promise<void> {
    const t = store.task.value;
    if (!t || exportingDrive) return; // guard against a double-submit while the upload is in flight
    setExportingDrive(true);
    try {
      const res = await api.exportToDrive(t.taskId);
      // `unconfirmed`: the upload reached Google but its redirect echo didn't return a JSON ack (a known
      // Apps Script flakiness). The write almost certainly landed — tell the user to verify in exports/
      // rather than claiming a path we never received.
      if (res.unconfirmed) {
        await store.askConfirm({ title: tr('exportDriveUnconfirmedTitle'), message: tr('exportDriveUnconfirmedMsg'), okLabel: tr('gotIt') });
      } else {
        await store.askConfirm({ title: tr('exportDriveDoneTitle'), message: tf('exportDriveDoneMsg', { path: res.path ?? '' }), okLabel: tr('gotIt') });
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        downloadBundle(t.taskId); // no team Drive → plain download
        await store.askConfirm({ title: tr('exportNoDriveTitle'), message: tr('exportNoDriveMsg'), okLabel: tr('gotIt') });
      } else {
        store.startError.value = e instanceof ApiError ? e.message : String(e);
      }
    } finally {
      setExportingDrive(false);
    }
  }

  const tabs = task ? availableTabs(task) : [];
  // spec 033 D7/FIX-J: the docked action bar is scoped to a live gate at phase∈{analyze,spec,implement}
  // — ④ Test gates render their actions INLINE exactly as today (D4), so the bar must NOT extend to ④.
  const dockedGate = !!task && task.status === 'awaiting_confirm' &&
    (task.phase === 'analyze' || task.phase === 'spec' || task.phase === 'implement');
  // spec 034 D5 (recut by 092): where BOTH send actions exist — the composer renders the ✎ change pill
  // next to the chat/ask button. Extends to ④ (Ask works at all four ④ gates). This is a DIFFERENT
  // predicate from `dockedGate` (which drives the docked action BAR, deliberately NOT wanted at ④):
  // decoupling them lets the pill render at ④ while ④'s gate actions stay inline.
  // spec 052: a promote task is pinned to phase='test' for inline gate rendering but has NO Ask surface —
  // exclude it so the composer stays reply-oriented (its typed text is a "Request changes", not an Ask).
  const askableGate = !!task && task.status === 'awaiting_confirm' && task.kind !== 'promote' &&
    (task.phase === 'analyze' || task.phase === 'spec' || task.phase === 'implement' || task.phase === 'test');
  // spec 092: one neutral placeholder covers both send actions; an armed hint narrows it to the change
  // wording. Only `error` keeps the original reply wording (Ask isn't offered there — no live parked gate).
  const livePlaceholder = askableGate
    ? (armed ? tr('phChangeMode') : tr('phAskOrChange'))
    : tr('phReplyOrDescribe');
  // The post-import fix loop: a DONE build whose workflow is on disk can still be revised in place, so its
  // terminal composer is no longer Ask-ONLY — change-mode is reachable there (armed by the gate foot's
  // Request-a-fix button, sent as POST /reply). Mirrors the server's `canRequestFix` minus `sessionIds`,
  // which is not on the wire; the impossible session-less case 409s rather than silently doing nothing.
  const terminalFixable = !!task && task.status === 'done' && task.kind !== 'promote' &&
    task.kind !== 'consult' && !!task.project && !!task.workflowSlug;
  // Arm the change hint on a finished build (the post-import fix loop) — fired by the done card's
  // Request-a-fix button. spec 092: a hint only (focus + pill highlight + placeholder); the old mode-row
  // indicator and its composer-side arm button are gone — the ✎ change pill is always visible wherever a
  // change send is legal, so no separate door is needed.
  function armFix(): void {
    setArmed('Request changes');
    setFocusToken((x) => x + 1);
  }
  // spec 092: typing-away the whole draft dissolves the arm hint — emptying the box reads as "never
  // mind", and a hint that lingers past it would mislabel an unrelated later send. Only a NON-empty →
  // empty edit counts: arming legitimately happens over an empty box (focus first, type second).
  function onDraftChange(v: string): void {
    if (armed && draft.trim() && !v.trim()) setArmed(null);
    setDraft(v);
  }
  // Note: the panel NEVER auto-opens (spec 051-followup UX). It only opens on an explicit user action
  // (the 成果物 button / a gate-card "open report"·"view diff" link → openArtifact). Auto-opening on the
  // first YAML made sense for from-scratch, but for an edit-existing build the base file exists from
  // submit, so it popped the (unchanged) base immediately — noise. The header run-crumb's `ベース:` badge
  // is the "running with a base" indicator instead.

  // Auto-mode artifact race: in `auto` confirm-mode the Spec (and other) gates are auto-confirmed, so
  // the client never runs the gate re-fetch that inlines SPEC.md — the panel shows it empty during
  // Implement though it's on disk. Pull the artifacts from disk whenever the panel is open and the
  // task/tab OR the phase/status changes (a phase transition is exactly when a new artifact lands, and
  // covers the "panel left open across an auto spec→implement advance" case). Deps deliberately EXCLUDE
  // artifactContents so the refetch that fills them never re-triggers itself (no loop). Cheap GET;
  // applyTask's rev-guard keeps it safe.
  useEffect(() => {
    if (artifactOpen && task) void store.refreshArtifacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactOpen, artifactTab, task?.taskId, task?.phase, task?.status]);

  /* ---------- render ---------- */
  return (
    <div className={'app' + (sbCollapsed ? ' sb-collapsed' : '')}>
      {/* spec 088: slide-down nudge — shown by maybeNudge() while a build runs and the browser
          permission is still askable. Enable runs the same bell flow (permission prompt in-click);
          a denial flips the text to the blocked explanation (the Enable button disappears).
          spec 104 S1: ONE banner slot, two invitations — `notifyNudgeKind` picks the wording
          ('auto' = the user just chose an unattended mode) and ✕ retires the matching key. */}
      {notifyNudge.value && (
        <div className="notify-nudge" role="status">
          <I.bell className="notify-nudge-ic" />
          <span className="notify-nudge-text">
            {notifyBlocked.value
              ? tr('notifyBlockedHint')
              : tr(notifyNudgeKind.value === 'auto' ? 'notifyNudgeAutoText' : 'notifyNudgeText')}
          </span>
          {!notifyBlocked.value && (
            <button className="btn ok" onClick={() => void toggleNotify()}>{tr('notifyNudgeEnable')}</button>
          )}
          <button className="icon-btn" onClick={dismissNudge} title={tr('notifyNudgeDismiss')}
            aria-label={tr('notifyNudgeDismiss')}><I.close /></button>
        </div>
      )}
      <Sidebar collapsed={sbCollapsed} activeTask={activeTaskId} activeProject={activeProject} activeWorkflow={activeWorkflow} tree={tree} active={active} consults={store.consults.value} promotes={store.promotes.value}
        onOpen={(id) => { setArtifactOpen(false); setArmed(null); void store.openTask(id); }}
        onCancel={(id) => void store.cancelById(id)}
        onNewTask={newTask}
        onNewChat={newChat}
        onNewProject={() => setCreateOpen(true)}
        onAddYaml={() => setImportBaseOpen(true)}
        onToggle={() => setSb((c) => !c)}
      />

      <div className={'main' + (artifactOpen ? ' has-artifact' : '')}>
        <div className="chat">
          <div className="chat-top">
            <button className="icon-btn sb-toggle" onClick={() => setSb((c) => !c)} title={tr('toggleSidebar')}>
              <I.sidebar />
            </button>
            {view === 'conversation' ? (
              <>
                {runCtx && (
                  <span className="run-crumb" title={editingBase ? tr('runningWithBaseHint') : tr('runContextHint')}>
                    <I.folder className="crumb-ic" />
                    {runCtx.group && <span className="run-crumb-seg">{runCtx.group}</span>}
                    {runCtx.group && runCtx.leaf && <span className="run-crumb-sep">›</span>}
                    {editingBase && <span className="run-crumb-base">{tr('baseLabel')}</span>}
                    {runCtx.leaf && <span className="run-crumb-seg run-crumb-leaf">{runCtx.leaf}</span>}
                  </span>
                )}
                {/* spec 052/082: promote + consult are not ①②③④ pipelines — a label in place of the track. */}
                {task?.kind === 'promote'
                  ? <span className="chat-top-label">{tr('promoteToPattern')}</span>
                  : task?.kind === 'consult'
                    ? <span className="chat-top-label">{tr('consultChat')}</span>
                    : <PhaseTrack phaseStates={phaseStates} current={current} />}
              </>
            ) : <span className="chat-top-label">{crumb.label}</span>}
            <div className="chat-top-right">
              {/* spec 082: a consult's live turn is an ask (busy never flips) — offer Stop during one,
                  and skip the "stop build?" modal there (aborting an answer is harmless + scoped: the
                  /cancel route's ask branch kills the child without touching status). */}
              {/* spec 097: the ask case moved INTO the answer bubble (beside "Answering…", where chat UIs
                  put it and where the eye already is). Two stops for one action read as two different
                  ones, so this pill is now build-only again. */}
              {view === 'conversation' && busy && (
                <button className="ghost-pill stop-pill"
                  onClick={() => void onStop()}
                  title={tr('stopRunningBuild')}>
                  <span className="stop-sq" />{tr('stop')}
                </button>
              )}
              {view === 'conversation' && tabs.length > 0 && !artifactOpen && (
                <button className="ghost-pill" onClick={() => setArtifactOpen(true)}>
                  <I.panel />{tr('artifact')}
                </button>
              )}
              {/* spec 062 S4: "Export" — download a zip that explains this run (dossier + artifacts +
                  per-phase transcripts + timeline + attachments). Shown once the run has any artifact
                  (running/done/error); a first-class user feature (NOT dev-gated). */}
              {/* spec 062 (+follow-up): one "Export" pill → a dropdown with Download and Export-to-Drive
                  (the Drive path falls back to the local download when no team Drive is configured). */}
              {view === 'conversation' && task && task.kind !== 'promote' && tabs.length > 0 && (
                <div className="export-menu-wrap">
                  <button ref={exportBtnRef} className="ghost-pill" disabled={exportingDrive}
                    onClick={toggleExportMenu}
                    title={exportingDrive ? tr('exportingDrive') : tr('exportRunHint')}>
                    {exportingDrive ? <span className="spin" /> : <I.download />}
                    {exportingDrive ? tr('exportingDrive') : tr('exportRun')}
                    {!exportingDrive && <I.chevron className="export-caret" />}
                  </button>
                  {exportMenuOpen && !exportingDrive && (
                    <>
                      <div className="menu-scrim" onClick={() => setExportMenuOpen(false)} />
                      {/* position:fixed anchored to the button — the header pill row is an overflow-x:auto
                          scroll container (which also clips overflow-y), so an absolutely-positioned menu
                          would be clipped out of view. Fixed positioning escapes that ancestor clip. */}
                      <div className="export-menu" role="menu"
                        style={exportMenuPos ? { position: 'fixed', top: exportMenuPos.top, left: exportMenuPos.left, right: 'auto' } : undefined}>
                        <button role="menuitem" onClick={() => { setExportMenuOpen(false); downloadBundle(task.taskId); }}>
                          <I.download />{tr('exportDownload')}
                        </button>
                        <button role="menuitem" onClick={() => { setExportMenuOpen(false); void onExportDrive(); }} title={tr('exportDriveHint')}>
                          <I.external />{tr('exportDrive')}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {/* "Edit this workflow" — always-visible in the header while viewing a build whose workflow
                  is on disk (done/cancelled OR the ④ test gate), so editing doesn't require first clicking
                  "承認" to reach the terminal gate-foot. Click → a NEW edit-existing build on this workflow. */}
              {view === 'conversation' && task && task.kind !== 'promote' && task.project && task.workflowSlug &&
                (task.status === 'done' || task.status === 'cancelled' ||
                  (task.status === 'awaiting_confirm' && task.phase === 'test')) && (
                <button className="ghost-pill" onClick={() => newTask({ baseWorkflow: { project: task.project!, workflow: task.workflowSlug! } })} title={tr('editThisWorkflowHint')}>
                  <I.edit />{tr('editWorkflowShort')}
                </button>
              )}
              {/* spec 052 D1: "Promote to pattern" — always-visible when the view has a RESOLVED on-disk
                  workflow. In the conversation view: a proven build (not itself a promote). On the
                  new-task surface: a base pre-selected from the sidebar workflow row (editingSel). Absent on
                  a from-scratch new task. Click → POST /api/promote and opens the promote build.
                  Visible at the ④ gate (awaiting_confirm@test), NOT only at `done`: main.yml is final and
                  lint-clean the moment ④ opens, and many users treat "I have the yml" as finished and never
                  click import/skip — gating promote behind `done` hid it exactly when they'd want it. This
                  matches the "edit this workflow" button's condition above, and the moment the 078 nudge fires. */}
              {/* spec 082 §4.4: the graduate bridge — visible on a consult; disabled while an answer
                  streams. Sends the canned distill prompt through the normal ask machinery; the
                  finished answer prefills the new-build composer (the graduateDraft effect above). */}
              {view === 'conversation' && task?.kind === 'consult' && (
                <button className="ghost-pill" disabled={asking} onClick={() => void store.graduate()} title={tr('graduateHint')}>
                  <I.spark />{tr('graduateBtn')}
                </button>
              )}
              {canPromoteFromConversation(view, task) && (
                <button className="ghost-pill" onClick={() => void store.promote(task!.project!, task!.workflowSlug!)} title={tr('promoteToPatternHint')}>
                  <I.spark />{tr('promoteToPattern')}
                </button>
              )}
              {view === 'empty' && editingSel?.project && editingSel.workflow && (
                <button className="ghost-pill" onClick={() => void store.promote(editingSel.project!, editingSel.workflow)} title={tr('promoteToPatternHint')}>
                  <I.spark />{tr('promoteToPattern')}
                </button>
              )}
              {/* live/reconnecting indicator — a slim bar sitting just before the settings toggles. */}
              {view === 'conversation' && (
                <span className="conn-dot" title={connected ? tr('live') : tr('reconnecting')}
                  style={{ width: 2, height: 20, borderRadius: 3, background: connected ? 'var(--ok)' : 'var(--tx-faint)' }} />
              )}
              {/* Notifications + the ⚙ settings menu are global, not run actions — parked at the
                  far-right end so the run's action pills (Artifact/Export/Edit/Promote) lead. */}
              {/* spec 088: phase-completion notification bell — enabling runs inside this click (the
                  user gesture requestPermission wants). Denied → tooltip explains the browser block.
                  While OFF (and still askable), a tiny always-on chat-bubble callout hangs under the
                  bell so the feature is discoverable without hovering. */}
              <span className="notify-tip-wrap" ref={tipWrapRef}>
                <button className="ghost-pill" onClick={() => void toggleNotify()}
                  title={notifyBlocked.value ? tr('notifyBlockedHint') : notifyOn.value ? tr('notifyDisableHint') : tr('notifyEnableHint')}
                  aria-label={tr('notifyToggle')}>
                  {notifyOn.value ? <I.bell /> : <I.bellOff />}
                </button>
                {tipVisible && tipPos && (
                  <span className="notify-tip" aria-hidden="true"
                    style={{ top: tipPos.top, right: tipPos.right }}>{tr('notifyTip')}</span>
                )}
              </span>
              {/* One ⚙ dropdown in place of three pills — UI language, reply language and light/dark
                  are all global SETTINGS, and three always-on pills crowded the run's own actions
                  off the header. See PrefsMenu.tsx. */}
              <PrefsMenu theme={theme} onTheme={setTheme} />
            </div>
          </div>

          {/* spec 059: dev strip (taskId + per-phase cost) — only under `?dev=1`, only for an open build. */}
          {devMode && view === 'conversation' && task && <DevPanel task={task} />}

          {view === 'empty' ? (
            <EmptyState draft={draft} setDraft={setDraft} send={send}
              settings={settingsSubset} onSettings={onSettings}
              model={settings.model} onModel={onEntryModel} workflows={workflows}
              crumb={crumb} onClearCrumb={clearNewTaskCrumb}
              seeds={seeds} selectedSeed={settings.seed}
              onSeed={(id) => { store.settings.value = { ...store.settings.value, seed: id }; }}
              startError={startError} busyHolder={busyHolder}
              files={files} onAddFiles={(f) => void addFiles(f)} onRemoveFile={removeFile}
              mode={settings.mode}
            />
          ) : (
            <>
              <div className="thread" ref={threadRef}>
                <div className="thread-inner">
                  {thread.map((item) => {
                    if (item.kind === 'user')
                      return <div key={item.id} className="msg msg-user">
                        <div className="bubble-user">
                          {item.text}
                          {/* the files this message carried — the history used to drop them on send */}
                          {item.atts && item.atts.length > 0 && (
                            <MsgAttachments atts={item.atts} taskId={task?.taskId} />
                          )}
                        </div>
                      </div>;
                    if (item.kind === 'run')
                      return <div key={item.id} className="msg msg-assistant">
                        <Disclosure phaseKey={item.phase} running={item.running} output={item.output} stopped={item.stopped} cost={item.cost} open={item.open} promote={task?.kind === 'promote'} />
                      </div>;
                    if (item.kind === 'qa')
                      return <div key={item.id} className="msg msg-assistant">
                        <QaAnswer answer={item.answer} done={item.done} seededFrom={item.seededFrom}
                          cost={item.cost} sessionReset={item.sessionReset}
                          /* spec 097: Stop on EVERY ask, not consult-only. An ask on a build had no
                             escape at all — the wall-clock was it. The /cancel route's ask branch keys
                             on the LANE (`liveKind === 'ask'`), never on task kind, so this was always
                             safe; it simply had not been offered. */
                          onStop={item.done ? undefined : () => void store.cancel()} />
                      </div>;
                    // spec 082 S3: the YAML report card — machine facts, rendered before the model's take.
                    if (item.kind === 'card')
                      return <div key={item.id} className="msg msg-assistant">
                        <div className="yaml-card" style={{ border: '1px solid var(--bd)', borderRadius: 10, padding: '10px 12px', fontSize: 13 }}>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>
                            {tr('cardTitle')} — <code>{item.file}</code>
                          </div>
                          <div style={{ color: item.lint.length ? 'var(--err, #c33)' : 'var(--ok)' }}>
                            {item.lint.length ? item.lint.map((l, i) => <div key={i}>✕ {l}</div>) : <>✓ {tr('cardLintClean')}</>}
                          </div>
                          {item.preflight && <div style={{ color: 'var(--tx-muted)', marginTop: 4 }}>{item.preflight}</div>}
                          {item.contract && <div style={{ color: 'var(--tx-muted)', marginTop: 4 }}>{item.contract}</div>}
                          {item.note && <div style={{ color: 'var(--tx-muted)', marginTop: 4 }}>⚠ {item.note}</div>}
                        </div>
                      </div>;
                    // gate
                    return <div key={item.id} className="msg msg-assistant">
                      <GateCard task={item.snapshot} resolved={item.resolved} busy={busy || asking}
                        onConfirm={onConfirm}
                        onArmChange={(label) => { setArmed(label); setFocusToken((x) => x + 1); }}
                        onCancel={() => void onDiscard()}
                        onRetry={onRetry}
                        onRestore={() => void store.restore()}
                        onUndoFix={() => void onUndoFix()}
                        /* spec 035: "Edit this workflow" — a done/cancelled gate-foot button that starts a
                           NEW edit-existing build via the SAME newTask({baseWorkflow}) the sidebar "+" uses. */
                        onEditAgain={(project, workflow) => newTask({ baseWorkflow: { project, workflow } })}
                        /* spec 036 D5: "Run test with workflow" — re-enter the live sub-orchestrator from a
                           done autonomous build (terminalFootActions gates it on creds + auto/spec_only). */
                        onRunTest={() => void store.liveTest()}
                        /* The post-import fix loop: keep working in THIS conversation — arm change-mode so
                           the next message is a revision (POST /reply resumes the implement session),
                           instead of onEditAgain's new build. */
                        onRequestFix={armFix}
                        onOpenArtifact={openArtifact}
                      />
                    </div>;
                  })}
                </div>
              </div>

              <StartErrorBanner startError={startError} busyHolder={busyHolder}
                onOpen={(id) => { setArmed(null); void store.openTask(id); }} />

              <PersistDegradedBanner />

              {/* spec 033 D7/FIX-J: the docked action bar — pinned above the composer while parked at
                  an analyze/spec/implement gate, so the phase's next-step actions stay reachable through
                  any amount of Ask chat. Disabled during a live Ask OR a live Reply (FIX-H). */}
              {task && dockedGate && (
                <div className="docked-gate-dock">
                  <div className="composer-wrap">
                    <GateActions task={task} busy={busy || asking} onConfirm={onConfirm}
                      onArmChange={(label) => { setArmed(label); setFocusToken((x) => x + 1); }}
                      onCancel={() => void onDiscard()}
                      onRetry={onRetry}
                    />
                  </div>
                </div>
              )}

              <div className="composer-dock">
                <div className="composer-wrap">
                  {/* F2 (spec 010): while the active build is LIVE (non-terminal) the Confirm chip
                      reflects + live-patches its confirm_mode and Workflow is start-bound (read-only).
                      (spec 036: Deploy/Test are no longer chips.) spec 034 D3: at a terminal status the
                      composer is Ask-only (send() routes done/cancelled → store.ask), dropping the row. */}
                  {task && task.status !== 'done' && task.status !== 'cancelled' ? (
                      <Composer value={draft} onChange={onDraftChange} onSend={(intent) => send(undefined, intent)}
                        /* spec 092: at an askable gate BOTH send actions render — the chat/ask button
                           (Enter, cheap) and the ✎ change pill (deliberate, re-runs the phase). The old
                           mode-row indicator is gone: intent lives on the button pressed, not in state.
                           A promote/error composer keeps its single button (route is reply either way). */
                        canChange={askableGate} changeArmed={!!armed}
                        /* spec 103 Lane B — a plan can only be drafted against a workflow that exists,
                           and only one proposal at a time (the server re-checks both). */
                        canPropose={proposeLane}
                        proposalPending={!!task.specRevise}
                        sendGlyph={task.kind === 'promote' ? 'edit' : undefined}
                        /* spec 052: a promote build has no ①②③④ run-settings — omit the Workflow/Confirm/Fast
                           chips (and their confirm_mode PATCH) so the promote-gate composer is a plain reply box. */
                        settings={task.kind === 'promote' ? undefined : { workflow: task.workflow ?? 'none', confirm: store.confirmModeLabel(task.confirmMode), fast: task.fastMode ?? false }}
                        onSettings={task.kind === 'promote' ? undefined : (patch) => {
                          if (patch.confirm) void store.patchConfirmMode(task.taskId, patch.confirm);
                          // spec 096: the model does NOT arrive here — the chip has its own onModel prop
                          // (it is not a build setting; see Composer). Routing it through `settings` is
                          // what hid it from the terminal composer.
                        }}
                        model={task.model} onModel={(v) => void store.patchModel(task.taskId, v)}
                        workflows={workflows} lockStartBound lockConfirm={busy}
                        placeholder={livePlaceholder} focusToken={focusToken}
                        /* FIX-H: send-readiness is disabled while a phase/Reply turn runs (busy) OR a
                           live Ask streams (asking) — sending during either just 409s. */
                        disabled={busy || asking}
                        files={files}
                        /* Attach is live for BOTH intents, exactly like the chat composer below. It used to
                           be hidden for questions (spec 033 F5 / 034 D5) on the argument that handing over
                           material at a gate IS a change request — but that costs more than it teaches:
                           paste/drop silently did nothing at the very moment a user wants to show a
                           screenshot of what looks wrong, and the workaround (a change send, which
                           re-runs the phase) is the wrong action for a question. /ask carries files
                           end-to-end since spec 089; a question with a screenshot answers as a question and
                           leaves the artifact untouched. */
                        onAddFiles={(f) => void addFiles(f)}
                        onRemoveFile={removeFile}
                      />
                  ) : (
                    // spec 034 D3: a terminal (done/cancelled) build's composer is Ask-only — the settings
                    // row is DROPPED (Send no longer starts a new build). Starting a new build lives at the
                    // sidebar "+". Just a question box — plus attach.
                    // spec 082: a consult lives in this branch too (born done) — its own placeholder.
                    // spec 089: attach IS offered here. A chat's first message can bring a document (POST
                    // /api/consult) and /ask now carries files too, so every later message can as well —
                    // without it, a reference raised mid-conversation had no way into the chat at all.
                    // The post-import fix loop: a done build is Ask-BY-DEFAULT, not Ask-only — on a fixable
                    // build the ✎ change pill routes the same box to POST /reply (spec 092: per-message
                    // intent; the old mode-arm row is gone since the pill is always visible here).
                      <Composer value={draft} onChange={onDraftChange} onSend={(intent) => send(undefined, intent)}
                        canChange={terminalFixable} changeArmed={!!armed}
                        /* spec 103 Lane B — a plan can only be drafted against a workflow that exists,
                           and only one proposal at a time (the server re-checks both). */
                        canPropose={proposeLane}
                        /* spec 096: a finished build still takes follow-up questions, and those Ask
                           turns spawn with `task.model` — so the chip belongs here too. Without it the
                           model was in force but invisible and unchangeable. It is the ONLY chip here:
                           workflow/confirm/fast have no next boundary to act on. */
                        model={task?.model} onModel={task ? (v) => void store.patchModel(task.taskId, v) : undefined}
                        placeholder={terminalFixable && armed ? tr('phChangeMode')
                          : task?.kind === 'consult' ? tr('phConsultChat') : tr('phAskAboutBuild')}
                        /* Request-a-fix bumps focusToken to put the caret in the box — without this prop the
                           click armed the hint but left focus on the BUTTON, so typing went nowhere and
                           the user had to click the composer to discover that. */
                        focusToken={focusToken}
                        disabled={busy || asking}
                        files={files} onAddFiles={(f) => void addFiles(f)} onRemoveFile={removeFile}
                      />
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {artifactOpen && task && (
          <>
            {/* click-away: dismiss the panel when clicking the chat area outside it */}
            <div className="artifact-scrim" onClick={() => setArtifactOpen(false)} />
            <ArtifactPanel task={task} tab={artifactTab} setTab={setArtifactTab}
              available={tabs}
              onClose={() => setArtifactOpen(false)}
              onSaveSpec={store.saveSpec}
              onReveal={() => store.revealWorkflow(task.taskId)}
              /* spec 103 Lane B — the panel is a modal, so while it is open the gate's own buttons are
                 unclickable; and the gate tells the human to open it. Route the in-panel decision
                 through the SAME store calls the gate uses (never a parallel path), and close the
                 panel first so the result lands where the human can see it. `changes` arms the
                 composer exactly as the gate's reply action does. */
              onProposalDecide={(id) => {
                setArtifactOpen(false);
                const a = task.gate?.actions.find((x) => x.id === id);
                if (!a) return; // the gate moved on (another tab decided) — the server would 409 anyway
                if (id === 'changes') { setArmed(a.label); setFocusToken((x) => x + 1); return; }
                void store.confirm(a);
              }}
            />
          </>
        )}
      </div>

      {createOpen && (
        <CreateProjectModal
          onClose={() => setCreateOpen(false)}
          onSkip={() => { setCreateOpen(false); newTask(); }}
          // spec 031 D5: create (or "open existing") → fresh composer pre-targeted at the project. newTask
          // resets then re-applies targetProject, so the empty/new-task surface lands inside projects/<slug>/.
          onOpenProject={(project) => { setCreateOpen(false); newTask({ targetProject: project }); }}
        />
      )}

      {/* spec 051 D5: import a standalone YAML → a local edit-existing base, then auto-select it via the
          SAME newTask({baseWorkflow}) the sidebar "+" / "Edit this workflow" use. */}
      {importBaseOpen && (
        <IntakeYamlModal
          onClose={() => setImportBaseOpen(false)}
          onImported={({ project, workflow }) => { setImportBaseOpen(false); newTask({ baseWorkflow: { project, workflow } }); }}
        />
      )}

      {/* spec 084: the background-distill tray — a fixed corner panel, independent of the open view. */}
      <BgTray />

      {/* The single mounted ConfirmModal — driven by store.askConfirm() from anywhere (replaces confirm()). */}
      {confirmReq && (
        <ConfirmModal
          title={confirmReq.title}
          message={confirmReq.message}
          okLabel={confirmReq.okLabel}
          cancelLabel={confirmReq.cancelLabel}
          danger={confirmReq.danger}
          onOk={() => store.resolveConfirm(true)}
          onCancel={() => store.resolveConfirm(false)}
        />
      )}
    </div>
  );
}

/* ---------- turn-collision-aware error banner (Lát 6) ---------- */
/** Renders a start/action error; on a turn-collision 409 (`busyHolder` set) it offers a one-tap jump
 *  to the build whose turn is running, so a "busy" is actionable rather than a dead end (AC #21).
 *  `onOpen` lets the caller wrap the jump (spec 033 FIX-I: the conversation view resets composer mode to
 *  'ask' here, one of FIX-I's mandated openTask reset points); defaults to a bare openTask. */
function StartErrorBanner({ startError, busyHolder, onOpen = (id) => void store.openTask(id) }: {
  startError: string | null;
  busyHolder: string | null;
  onOpen?: (id: string) => void;
}) {
  if (!startError) return null;
  return (
    <div className="start-error">
      <I.alert />
      <span>{startError}</span>
      {busyHolder && (
        <button className="gs-link" style={{ marginLeft: 6 }} onClick={() => onOpen(busyHolder)}>
          {tr('openIt')}
        </button>
      )}
    </div>
  );
}

/**
 * Spec 099 S2′ — "this browser is no longer keeping your conversation."
 *
 * A banner, NOT a thread item. Every item pushed into `thread` wakes the persistence effect, which is
 * precisely the write that just failed — a notice rendered that way would re-trigger its own cause.
 *
 * The wording is only honest because 099 S1 shipped first: the exchanges really are on the server and
 * really do come back on reopen. Before backfill existed this sentence would have been a comforting
 * lie, which is why S2 was ordered after S1 rather than beside it.
 */
function PersistDegradedBanner() {
  const state = store.persistDegraded.value;
  if (!state) return null;
  return (
    <div className="start-error" role="status">
      <I.alert />
      <span>{state.reason === 'quota' ? tr('persistQuota') : tr('persistFailed')}</span>
    </div>
  );
}

/* ---------- empty / new-task surface ---------- */
function EmptyState({ draft, setDraft, send, settings, onSettings, model, onModel, workflows, crumb, onClearCrumb, seeds, selectedSeed, onSeed, startError, busyHolder, files, onAddFiles, onRemoveFile, mode }: {
  draft: string;
  setDraft: (s: string) => void;
  send: (text?: string) => void;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  /** spec 096: the model chip is NOT part of `settings` (it applies to every turn type, including a
   *  finished build's follow-up questions), so it travels as its own pair. */
  model?: string;
  onModel: (v: string) => void;
  workflows: { v: string; l: string }[];
  crumb: NewTaskCrumb;
  onClearCrumb: () => void;
  seeds: Seed[];
  selectedSeed: string | null;
  onSeed: (id: string | null) => void;
  startError: string | null;
  busyHolder: string | null;
  files: ComposerAttachment[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
  /** spec 082 §4.5 rev: the entry mode is now set by the sidebar Chat "+"/Build "+" (no composer chip);
   *  the empty surface reads it to pick the placeholder + which chips to show. */
  mode: 'consult' | 'build';
}) {
  const consult = mode === 'consult';
  return (
    <div className="empty">
      <div className="empty-wrap">
        {/* spec 029: the crumb reflects the "+" pre-selection and, when one is active, clicking it clears
            back to a plain new task (the crumb IS the "×"). Inert when nothing is pre-selected (as before).
            spec 082: consult mode has no project/workflow target — show the chat crumb instead. */}
        {consult ? (
          <button className="empty-crumb">
            <I.message className="crumb-ic" />
            <span>{tr('consultChat')}</span>
          </button>
        ) : (
        <button className={'empty-crumb' + (crumb.active ? ' clearable' : '')}
          onClick={crumb.active ? onClearCrumb : undefined}
          title={crumb.active ? tr('clearPreselection') : undefined}>
          {crumb.icon === 'edit' ? <I.edit className="crumb-ic" /> : <I.folder className="crumb-ic" />}
          <span>{crumb.label}</span>
        </button>
        )}

        <Composer value={draft} onChange={setDraft} onSend={() => send()}
          model={model} onModel={onModel}
          settings={settings} onSettings={onSettings} workflows={workflows}
          placeholder={consult ? tr('phConsult') : tr('phDescribeWorkflow')}
          files={files} onAddFiles={onAddFiles} onRemoveFile={onRemoveFile}
          mode={mode}
        />

        <StartErrorBanner startError={startError} busyHolder={busyHolder} />

        {/* Seed picker (AC #2): lists /api/seeds; degrades to an empty list until Lát 5.
            spec 082: hidden in consult mode — a seed is a build concept. */}
        {!consult && (
        <div className="seed-picker">
          <div className="suggest-label seed-label-row">
            <span>{tr('seedFrom')}</span>
            {/* spec 070: the external-YAML door moved to the Projects sidebar header (a general intake for
                base OR distill) — it is no longer a per-surface link here. */}
          </div>
          {seeds.length === 0 ? (
            <div className="secret-note" style={{ padding: '6px 0' }}>
              {tr('noSeedApps')}
            </div>
          ) : (
            <div className="seed-list">
              <button className={'seed-chip' + (!selectedSeed ? ' on' : '')} onClick={() => onSeed(null)}>{tr('none')}</button>
              {seeds.map((s) => (
                <button key={s.id} className={'seed-chip' + (selectedSeed === s.id ? ' on' : '')} onClick={() => onSeed(s.id)}>
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>
        )}

        <div className="empty-suggest">
          <div className="suggest-label">{tr('try')}</div>
          {suggestions().map((s, i) => (
            <button key={i} className="suggest-row" onClick={() => send(s)}>
              <I.spark className="sg-ic" />
              <span>{s}</span>
              <I.chevron className="sg-arrow" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
