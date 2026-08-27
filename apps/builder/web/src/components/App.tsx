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
import { ArtifactPanel, type SpecMode, type YamlMode } from './ArtifactPanel';
import { CreateProjectModal, IntakeYamlModal, ConfirmModal } from './Modal';
import { AuthModal } from './AuthModal';
import { BgTray } from './BgTray';
import { DevPanel } from './DevPanel';
import { PrefsMenu } from './PrefsMenu';
import { devMode } from '../lib/dev';
import { I } from './Icon';
import { suggestions } from '../data';
import { t as tr, tf, lang, phaseLabel } from '../lib/i18n';
import { notifyOn, notifyBlocked, toggleNotify, notifyNudge, notifyNudgeKind, dismissNudge } from '../lib/notify';
import * as store from '../store';
import { type ComposerAttachment, MAX_ATTACHMENTS, isAcceptedFile, fileToDataUrl, toWire } from '../lib/attachments';
import type { ArtifactTab, Settings, WireTask, WireGateAction, Seed, NewTaskOpts } from '../types';
import { armedStartsAtImplement, newTaskCrumb, runContextCrumb, workflowOptions, activeSidebarProject, activeSidebarWorkflow, type NewTaskCrumb } from '../lib/crumb';
import { canPromoteFromConversation } from '../lib/promote-visibility';
import { pendingConversation } from '../lib/pending-conversation';
import { phaseIndex } from '../lib/phase';
import { composerTarget, replyLabel, type ComposerIntent } from '../lib/composer-route';
import { canPropose, confirmModeOptions } from '../lib/propose-lane';
import { gateOffersCancel, terminalFootActions, visibleGateActions } from '../lib/gate-foot';
import { confirmModeActs } from '../lib/confirm-chip';
import { endBuildCopy, endBuildPill } from '../lib/cancel-confirm';
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
  // `a.diff` counts toward the YAML tab now that the diff is a view mode inside it rather than a tab of
  // its own — otherwise a build that has a diff but no inlined yaml would have nowhere to show it.
  if ((a && (a.yaml || a.diff)) || (reached('implement') && task.phase !== 'analyze')) tabs.push('yaml');
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
  // The two tabs' VIEW MODES live here, not inside the tab components, for two reasons. A gate card's
  // 「仕様の差分」/「ワークフローの差分」 link has to be able to open a tab already in diff mode, and the
  // artifact refetch below keys off them: it used to fire when you switched to the 差分 TAB, which is how
  // a diff written after the panel opened ever appeared. With the tab gone, the mode change is the only
  // signal left, so it has to be visible from here.
  const [specMode, setSpecMode] = useState<SpecMode>('preview');
  const [yamlMode, setYamlMode] = useState<YamlMode>('code');
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
  // A different build starts on the rendered spec again (review-before-edit), and never inherits the
  // previous build's diff view — which would open on a diff belonging to something else.
  useEffect(() => { setSpecMode('preview'); setYamlMode('code'); }, [task?.taskId]);
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
    void store.checkAuth(); // signed out → the sign-in modal, before a prompt is composed against it
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
  // Spec 105 — would a send from this surface skip ① and ②? Read from the tree row the composer is
  // armed against, resolved the same way `store.start()` resolves it (crumb.ts explains why a bare slug
  // has to follow `targetProject` rather than the first name match). The bit itself has been on the
  // wire since 034cc15 with nothing reading it; this is the surface it was put there for.
  const startsAtImplement = armedStartsAtImplement(tree, settings.workflow, settings.targetProject);
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
        // spec 105 M2 — a new build no longer ignores the intent. It still cannot be a QUESTION (there
        // is nothing yet to ask about), so 'ask' and 'change' both mean "build it"; only 'propose' is a
        // different act, and it is offered only where a plan has something to draft against.
        void store.start(msg, atts, intent === 'propose' ? 'propose' : undefined).then(onDone);
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
  // The text-less re-run behind 「フェーズを再試行」 and 「再試行を続ける」. The action's own label rides
  // along so the resolved gate records which of the two was pressed — they end up at the same phase but
  // they are not the same decision, and a history that calls both "Retry phase" says the wrong one.
  function onRetry(action: WireGateAction): void {
    const atts = files.length ? toWire(files) : undefined;
    void store.reply('', action.label, atts).then((ok) => { if (ok) setFiles([]); });
  }
  /** Open the panel on `tab`. `view: 'diff'` also switches that tab into its diff mode — the gate cards'
   *  two 差分 links are deep links, and landing on the file's normal view would make the reader hunt for
   *  the thing the link named. */
  function openArtifact(tab: ArtifactTab, view?: 'diff'): void {
    setArtifactTab(tab);
    if (view === 'diff') {
      if (tab === 'spec') setSpecMode('diff');
      if (tab === 'yaml') setYamlMode('diff');
    }
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
  // spec 029: the two sidebar "+" intents flow in via opts. resetToNew() first (clears prior state incl.
  // any stale pre-selection), THEN re-apply this launch's opts — that ordering IS the non-clobber (the
  // footer/manual "New task" passes no opts → a clean from-scratch slate).
  async function newTask(opts?: NewTaskOpts): Promise<void> {
    // Spec 105 M4 — a workflow parked at a gate is waiting for an answer, and starting a second
    // conversation on it leaves that one stranded while both write the same `main.yml` and `SPEC.md`.
    // Asked ONLY there: `done`/`cancelled` have nothing to walk away from (the common path — finish a
    // build, click the pencil, start the next round), and a running turn is already refused by the
    // create route's 409. Two doors rather than yes/no, because a reader usually cannot remember what
    // state the old conversation is in — so the dialog says it, and offers the thing they likely wanted.
    if (opts?.baseWorkflow) {
      const slug = `${opts.baseWorkflow.project}/${opts.baseWorkflow.workflow}`;
      const waiting = pendingConversation(tree, slug, null);
      if (waiting) {
        const goNew = await store.askConfirm({
          title: tr('pendingConvTitle'),
          message: tf('pendingConvMsg', { phase: `${phaseIndex(waiting.phase as never)}. ${phaseLabel(waiting.phase as never)}` }),
          okLabel: tr('pendingConvNew'),
          cancelLabel: tr('pendingConvOpen'),
        });
        if (!goNew) { void store.openTask(waiting.id); return; }
      }
    }
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
  // The header pill that ends the OPEN build — one control for both states, because /cancel is one POST
  // either way and only the wording differs: a running turn is told its phase progress goes, a parked
  // one is told its spec and artifacts stay on disk. Confirmed through the common ConfirmModal (danger),
  // with the copy keyed on the PILL so the dialog repeats the word the button just said.
  async function onEndBuild(): Promise<void> {
    const t = store.task.value;
    if (!t || !endPill) return;
    const raw = t.name?.trim() || t.requirement;
    const title = raw.length > 46 ? raw.slice(0, 46) + '…' : raw;
    const copy = endBuildCopy(endPill);
    const ok = await store.askConfirm({
      title: tr(copy.titleKey),
      message: tf(copy.msgKey, { name: title }),
      okLabel: tr(copy.okKey),
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
  // EVERY parked gate's actions ride in the composer row — the four phases, the error gate, the promote
  // gates alike. It used to be ①②③ only, with ④ and error drawing their own buttons on the card, and the
  // split had no rule you could state: the reason the bar exists (an Ask never consumes the gate, so the
  // decision must survive any amount of chat) is just as true at ④, where asking two questions used to
  // scroll 「Difyにインポート」 off the screen. `visibleGateActions` is empty while a turn runs and at a
  // terminal build, which is exactly when there is nothing to decide.
  const gateActions = task ? visibleGateActions(task) : [];
  const dockedGate = gateActions.length > 0;
  // Stop-a-turn and discard-a-parked-build are the same POST under two names, so they are one header
  // pill. It follows the gate's own cancel action rather than the phase, so it appears exactly where the
  // backend offers one — and stays away from the promote share gates, which are confirm-only on purpose
  // so that declining to share can never mark a finished promotion `cancelled`.
  const endPill = endBuildPill(busy, gateOffersCancel(task));
  // Restore / Run-test: acts on the BUILD, so they are header pills beside Export and Edit rather than
  // buttons on the finished card. Same guards as before, still pure — a promote build reuses none of
  // them (its source project/workflowSlug would otherwise light Edit-again on a done promotion).
  const terminalFoot = task && task.kind !== 'promote'
    ? terminalFootActions(task, { restore: true, editAgain: true, runTest: true })
    : { restore: false, editAgain: false, runTest: false };
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
    // specMode/yamlMode are in here for the reason spelled out where they are declared: entering a diff
    // view is now what the 差分 TAB switch used to be, and that switch was the refetch's trigger.
  }, [artifactOpen, artifactTab, specMode, yamlMode, task?.taskId, task?.phase, task?.status]);

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
      {/* `revealActive`: the active node is only scrolled to when it was AIMED at (the composer's target,
          which is also what createProject leaves behind) — never when it is just mirroring the open
          build, which is the case that used to jerk the sidebar on every task you clicked. */}
      <Sidebar collapsed={sbCollapsed} activeTask={activeTaskId} activeProject={activeProject} activeWorkflow={activeWorkflow} revealActive={!task} tree={tree} active={active} consults={store.consults.value} promotes={store.promotes.value}
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
              {/* The docked bar below no longer draws 「ビルドを破棄」: it is this pill's second state, so
                  the one way to end a build sits in one place whether or not a turn is running.
                  Disabled while an Ask streams, and that is not politeness — /cancel aborts a LIVE ASK
                  and returns without touching the build (routes/tasks.ts), so a click here mid-answer
                  would kill the answer and leave the build exactly where it was. The Ask has its own
                  Stop, in its answer bubble. */}
              {view === 'conversation' && endPill && (
                <button className={'ghost-pill' + (endPill === 'stop' ? ' stop-pill' : '')}
                  onClick={() => void onEndBuild()}
                  disabled={endPill === 'discard' && asking}
                  title={endPill === 'stop' ? tr('stopRunningBuild') : tr('discardMsg')}>
                  {endPill === 'stop' ? <span className="stop-sq" /> : <I.close />}
                  {endPill === 'stop' ? tr('stop') : tr('discardOk')}
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
              {/* Restore — reopen a build you closed. It used to be a button on the cancelled card, which
                  is the one place it does not belong: reopening the build is an act on the BUILD, and the
                  card is the record of the moment it stopped. Cancelled-only, and deliberately NOT gated
                  on an on-disk workflow — a from-scratch build cancelled before the scaffold ran has none,
                  and that is exactly the build worth reopening. */}
              {view === 'conversation' && terminalFoot.restore && (
                <button className="ghost-pill" onClick={() => void store.restore()} title={tr('restoreBuild')}>
                  <I.undo />{tr('restoreBuild')}
                </button>
              )}
              {/* Run a live test on a finished autonomous build — its only live path (an each_step build
                  was already offered the button at its ③ gate). Same move from card to header, same
                  reason. Self-host reachability is checked on CLICK, not here, so the feature is
                  discoverable rather than invisible until configured. */}
              {view === 'conversation' && terminalFoot.runTest && (
                <button className="ghost-pill" onClick={() => void store.liveTest()} title={tr('runTestWithWorkflow')}>
                  <I.spark />{tr('runTestWithWorkflow')}
                </button>
              )}
              {/* "Edit this workflow" — the header has always carried this, and the done card carried it
                  too under a second name (「新しい会話で編集」 vs 「編集（新規）」): one act, two labels, two
                  places. The card's copy is gone; this is the one. Shown while viewing a build whose
                  workflow is on disk (done/cancelled OR the ④ test gate), so editing doesn't require first
                  clicking "承認". Click → a NEW edit-existing build on this workflow. */}
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
              crumb={crumb} onClearCrumb={clearNewTaskCrumb} startsAtImplement={startsAtImplement}
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
                      <GateCard task={item.snapshot} resolved={item.resolved}
                        /* A card carries no buttons: the gate's decisions are in the composer row and
                           Restore / Edit-again / Run-test are header pills. What is left are two links
                           scoped to this round — take the last fix back, and sweep the test apps. */
                        onUndoFix={() => void onUndoFix()}
                        onCleanupApps={(action, keepCurrent) =>
                          void onConfirm(action, keepCurrent ? { keepCurrent: true } : undefined)}
                        onOpenArtifact={openArtifact}
                      />
                    </div>;
                  })}
                </div>
              </div>

              <StartErrorBanner startError={startError} busyHolder={busyHolder}
                onOpen={(id) => { setArmed(null); void store.openTask(id); }} />

              <PersistDegradedBanner />

              <div className="composer-dock">
                <div className="composer-wrap">
                  {/* F2 (spec 010): while the active build is LIVE (non-terminal) the Confirm chip
                      reflects + live-patches its confirm_mode and Workflow is start-bound (read-only).
                      (spec 036: Deploy/Test are no longer chips.) spec 034 D3: at a terminal status the
                      composer is Ask-only (send() routes done/cancelled → store.ask), dropping the row. */}
                  {task && task.status !== 'done' && task.status !== 'cancelled' ? (
                      <Composer value={draft} onChange={onDraftChange} onSend={(intent) => send(undefined, intent)}
                        /* The parked gate's actions ride INSIDE the row, at its left end — every gate,
                           now: the four phases, the error gate, promote. Passed on every conversation
                           composer (`null` while a turn runs and there is nothing to decide) so the row
                           keeps one shape for the whole life of a build instead of re-arranging itself
                           each time the build parks and resumes. */
                        gate={dockedGate ? (
                          <GateActions task={task} busy={busy || asking} onConfirm={onConfirm}
                            onArmChange={(label) => { setArmed(label); setFocusToken((x) => x + 1); }}
                            onRetry={onRetry}
                          />
                        ) : null}
                        /* spec 092: at an askable gate BOTH send actions render — the chat/ask button
                           (Enter, cheap) and the ✎ change pill (deliberate, re-runs the phase). The old
                           mode-row indicator is gone: intent lives on the button pressed, not in state.
                           A promote/error composer keeps its single button (route is reply either way). */
                        canChange={askableGate} changeArmed={!!armed}
                        /* spec 103 Lane B — a plan can only be drafted against a workflow that exists,
                           and only one proposal at a time (the server re-checks both). */
                        canPropose={proposeLane}
                        proposalPending={!!task.specRevise}
                        /* The Confirm chip retires at ③: from there on every remaining gate stops for
                           a human whatever the mode says, so the value has nothing left to decide — and
                           the row needs the width for the gate's own buttons. See lib/confirm-chip.ts. */
                        confirmActs={confirmModeActs(task)}
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
                        /* No gate to put here, but the LAYOUT is the conversation's, not the entry
                           screen's: a build that finishes must not slide its remaining chip back across
                           the row as its parting move. */
                        gate={null}
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
              specMode={specMode} setSpecMode={setSpecMode} yamlMode={yamlMode} setYamlMode={setYamlMode}
              available={tabs}
              onClose={() => setArtifactOpen(false)}
              onSaveSpec={store.saveSpec}
              onReveal={(which) => store.revealFile(task.taskId, which)}
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

      {/* The sign-in door. Opened by a signed-out send (store.surfaceError) and by the boot probe —
          a Builder on a signed-out machine can run nothing, so the state is worth saying up front
          rather than at the moment the user's first prompt bounces. */}
      {store.authNeeded.value && (
        <AuthModal
          onClose={() => { store.authNeeded.value = false; }}
          onSignedIn={() => { store.startError.value = null; }}
        />
      )}

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
/** Exported for tests (the `GateActions` / `gateView` precedent): the entry surface owns the
 *  start-phase badge, and a test reading props would pass against a render that never drew it. */
export function EmptyState({ draft, setDraft, send, settings, onSettings, model, onModel, workflows, crumb, onClearCrumb, startsAtImplement, seeds, selectedSeed, onSeed, startError, busyHolder, files, onAddFiles, onRemoveFile, mode }: {
  draft: string;
  setDraft: (s: string) => void;
  /** spec 105 M2 — the entry surface can now send with an INTENT (the ⌄ plan lane), so the prop
   *  carries what App's own `send` takes rather than a text-only narrowing of it. */
  send: (text?: string, intent?: ComposerIntent) => void;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  /** spec 096: the model chip is NOT part of `settings` (it applies to every turn type, including a
   *  finished build's follow-up questions), so it travels as its own pair. */
  model?: string;
  onModel: (v: string) => void;
  workflows: { v: string; l: string }[];
  crumb: NewTaskCrumb;
  /** spec 105 — would a send from here skip ① and ②? Decided in App from the tree row the
   *  composer is armed against; EmptyState only draws it. */
  startsAtImplement: boolean;
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

        {/* Spec 105 — where this send would BEGIN, said before it is spent. A workflow that already has
            an analysis and a spec skips ① and ②, and until now the only way to learn that was to press
            send and read the dashes on the phase track afterwards.

            Shown ONLY when steps really are skipped: the full path is the unsurprising case, and a line
            that fires on it is a line nobody reads. Deliberately its own element under the crumb, not a
            chip — `.composer-row` is pinned to exactly two flex children (composer-row.test.tsx) and a
            third would put the send button on a line of its own at narrow widths. */}
        {!consult && startsAtImplement && (
          <div className="empty-startphase">
            <span className="track-mini" aria-hidden="true"><i>–</i><i>–</i><i className="on">3</i></span>
            <span>{tr('startsAtImplement')}</span>
          </div>
        )}

        <Composer value={draft} onChange={setDraft} onSend={(intent) => send(undefined, intent)}
          /* spec 105 M2 — the two send lanes, at the door. Offered on exactly the builds that start at
             ③, which is where a spec already exists for a plan to be drafted against: anywhere else
             `beginSpecProposal` declines and the choice would evaporate into an ordinary fix. Same bit
             the badge above reads, so the badge and the buttons can never say different things. */
          canPropose={startsAtImplement}
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
