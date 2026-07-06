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
import { PhaseTrack, Disclosure, GateCard, GateActions, QaAnswer, Composer } from './Chat';
import { ArtifactPanel } from './ArtifactPanel';
import { CreateProjectModal, ConfirmModal } from './Modal';
import { I } from './Icon';
import { suggestions } from '../data';
import { t as tr, tf, lang, toggleLang } from '../lib/i18n';
import * as store from '../store';
import { type ComposerAttachment, MAX_ATTACHMENTS, isAcceptedFile, fileToDataUrl, toWire } from '../lib/attachments';
import type { ArtifactTab, Settings, WireTask, WireGateAction, Seed, NewTaskOpts } from '../types';
import { newTaskCrumb, runContextCrumb, workflowOptions, type NewTaskCrumb } from '../lib/crumb';

let _attUid = 0;
const attUid = (): string => 'att' + ++_attUid;

/** Which artifact tabs are available for a task (contents-driven, with a phase fallback). */
function availableTabs(task: WireTask): ArtifactTab[] {
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
  const toggleTheme = (): void => setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  const [draft, setDraft] = useState('');
  // spec 012/025: files attached in the composer (shared empty + dock — the two views are exclusive).
  const [files, setFiles] = useState<ComposerAttachment[]>([]);
  // spec 033 D2/FIX-I: the composer's mode at a live gate — 'ask' (default, chat) vs 'change' (the
  // explicit Request-changes/Edit-spec path). `changeLabel` remembers the ARMING action's label (FIX-G)
  // so the resolved gate reads true ("Edit spec") instead of a generic "Requested changes". `focusToken`
  // bumps to focus the composer the moment change-mode is armed from a gate action.
  const [mode, setMode] = useState<'ask' | 'change'>('ask');
  const [changeLabel, setChangeLabel] = useState<string>('Requested changes');
  const [focusToken, setFocusToken] = useState(0);
  const asking = store.asking.value;
  const [createOpen, setCreateOpen] = useState(false);
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [artifactTab, setArtifactTab] = useState<ArtifactTab>('spec');
  const threadRef = useRef<HTMLDivElement>(null);
  // Tracks the previously-seen (taskId, hasYaml) so the panel auto-opens ONLY when YAML
  // newly appears during the live build of the task you're viewing — not when navigating
  // to a task that already has YAML.
  const prevYamlRef = useRef<{ id?: string; had: boolean }>({ had: false });

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
  }, []);
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [thread]);
  // spec 033 FIX-I: reset the composer's mode to 'ask' on every phase transition (incl. auto-advance) —
  // an undefined reset point here would leave `mode` stuck at 'change' at a NEW gate, so a plain Send
  // there would silently re-run the phase instead of defaulting to Ask (the exact confusion D2 exists to
  // prevent). openTask/newTask (below) also reset it for the open-a-different-task / new-build cases.
  useEffect(() => {
    setMode('ask');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.taskId, task?.phase]);

  const view: 'empty' | 'conversation' = task ? 'conversation' : 'empty';
  const activeTaskId = task?.taskId ?? null;
  // UX: the sidebar's active/selected menu node. When a build is open it's that build's project/workflow;
  // on the new-task surface it mirrors the pre-selection (project "+"/workflow "+"/a freshly-created
  // project via targetProject). `activeWorkflow` is the compound `project/workflow` key the tree rows use.
  const editingSel = task ? null : store.splitWorkflowSetting(settings.workflow);
  const activeProject = task ? (task.project ?? null) : (editingSel?.project ?? settings.targetProject ?? null);
  const activeWorkflow = task
    ? (task.project && task.workflowSlug ? `${task.project}/${task.workflowSlug}` : null)
    : (editingSel?.project ? `${editingSel.project}/${editingSel.workflow}` : null);
  const settingsSubset: Settings = { workflow: settings.workflow, confirm: settings.confirm, fast: settings.fast };
  const onSettings = (patch: Partial<Settings>): void => {
    store.settings.value = { ...store.settings.value, ...patch };
  };
  // spec 029: the new-task crumb + its clear action (reads the FULL signal, incl. targetProject).
  const crumb = newTaskCrumb(settings.workflow, settings.targetProject, tree);
  const clearNewTaskCrumb = (): void => {
    store.settings.value = { ...store.settings.value, workflow: 'none', targetProject: null };
  };
  // spec 029: context breadcrumb for the OPEN build — which project/workflow it belongs to (shown in
  // the conversation-view chat-top, left of the phase track). null ⇒ no project context to show.
  const runCtx = task ? runContextCrumb(task, tree) : null;
  // spec 030: a workflow is identified by its {project, workflow} pair (the same name can exist in
  // several projects), so the composer's Workflow dropdown carries a COMPOUND `project/workflow` value
  // with a readable "Project / Workflow" label — `_drafts` scratch is excluded. Sorted by RECENCY
  // (most-recently-touched first) so it stays usable when there are many workflows (workflowOptions).
  const workflows = workflowOptions(tree);

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

  function send(text?: string): void {
    const msg = (text ?? draft).trim();
    if (!msg) return; // files augment, never replace, the text (spec 012 Q2)
    const atts = files.length ? toWire(files) : undefined;
    setDraft('');
    setFiles([]);
    // Routing (spec 033 FIX-F + spec 034 D3/D5):
    //   empty-view                        → store.start()  (a brand-new build)
    //   done | cancelled  (034 D3)        → store.ask()    (ask about THIS finished/abandoned build;
    //                                                        starting a NEW build lives at the sidebar "+")
    //   error                             → store.reply()  (Retry-out-of-error, byte-unchanged)
    //   awaiting_confirm, mode==='change' → store.reply(text, label) — Request-changes (incl. ④, 034 D5)
    //   awaiting_confirm, mode==='ask'    → store.ask(text) — default at analyze/spec/implement AND ④ (034 D5)
    const st = store.task.value?.status;
    if (view === 'empty') {
      void store.start(msg, atts); // a new build ignores `mode`; the next gate's useEffect resets it
      return;
    }
    // spec 034 D3: a terminal build's composer is Ask-only — no change-mode exists (nothing to resume or
    // re-run), attach is hidden (no files), and starting a new build moved to the sidebar "+".
    if (st === 'done' || st === 'cancelled') {
      void store.ask(msg);
      setMode('ask');
      return;
    }
    // awaiting_confirm or error, non-empty. error-Retry always /reply; ④ Test (034 D5) now follows the
    // ask|change mode chip exactly like analyze/spec/implement — the `phase==='test'` carve-out is gone.
    // The armed `changeLabel` (FIX-G) carries through so the resolved gate reads the TRUE action.
    if (st === 'error') {
      void store.reply(msg, mode === 'change' ? changeLabel : undefined, atts);
    } else if (mode === 'change') {
      void store.reply(msg, changeLabel, atts); // Request-changes — re-run the phase, revise the artifact
    } else {
      void store.ask(msg); // default at analyze/spec/implement AND ④ (034 D5)
    }
    // FIX-I: reset mode after EVERY send that could have armed change-mode — including the error-Retry path.
    setMode('ask');
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
    // spec 030: workflow-"+" pre-selects the COMPOUND `project/workflow` value (the dropdown format), so
    // edit-existing resolves the right pair; project-"+" sets just the target project folder (workflow
    // stays 'none' from resetToNew → a from-scratch build).
    if (opts?.baseWorkflow) store.settings.value = { ...store.settings.value, workflow: `${opts.baseWorkflow.project}/${opts.baseWorkflow.workflow}`, targetProject: null };
    if (opts?.targetProject) store.settings.value = { ...store.settings.value, targetProject: opts.targetProject };
    setArtifactOpen(false);
    setMode('ask'); // spec 033 FIX-I
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

  const tabs = task ? availableTabs(task) : [];
  // spec 033 D7/FIX-J: the docked action bar is scoped to a live gate at phase∈{analyze,spec,implement}
  // — ④ Test gates render their actions INLINE exactly as today (D4), so the bar must NOT extend to ④.
  const dockedGate = !!task && task.status === 'awaiting_confirm' &&
    (task.phase === 'analyze' || task.phase === 'spec' || task.phase === 'implement');
  // spec 034 D5: the ask|change mode-chip machinery (the mode chip, the attach-hide guard, the Ask-aware
  // placeholder) DOES extend to ④ — Ask works at all four ④ gates now. This is a DIFFERENT predicate from
  // `dockedGate` (which drives the docked action BAR, deliberately NOT wanted at ④): decoupling them lets
  // the chip render at ④ while ④'s gate actions stay inline.
  const askableGate = !!task && task.status === 'awaiting_confirm' &&
    (task.phase === 'analyze' || task.phase === 'spec' || task.phase === 'implement' || task.phase === 'test');
  // spec 033 FIX-L / 034 D5: the parked placeholder no longer says "Reply" once Ask is the default — split
  // by mode; only `error` keeps the original wording (Ask isn't offered there — no live parked gate).
  const livePlaceholder = askableGate
    ? (mode === 'change' ? tr('phChangeMode') : tr('phAskGate'))
    : tr('phReplyOrDescribe');
  // Auto-open the panel the moment the Implement YAML first appears DURING a build of the
  // task you're viewing (mirrors the design's behavior). Switching to a task that already
  // has YAML must NOT pop the panel open — only a false→true transition on the same task does.
  useEffect(() => {
    const id = task?.taskId;
    const had = !!task?.artifactContents?.yaml;
    const prev = prevYamlRef.current;
    if (had && !prev.had && prev.id === id && !artifactOpen) {
      setArtifactTab('yaml');
      setArtifactOpen(true);
    }
    prevYamlRef.current = { id, had };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.taskId, task?.artifactContents?.yaml]);

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
      <Sidebar collapsed={sbCollapsed} activeTask={activeTaskId} activeProject={activeProject} activeWorkflow={activeWorkflow} tree={tree} active={active}
        onOpen={(id) => { setArtifactOpen(false); setMode('ask'); void store.openTask(id); }}
        onCancel={(id) => void store.cancelById(id)}
        onNewTask={newTask}
        onNewProject={() => setCreateOpen(true)}
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
                  <span className="run-crumb" title={tr('runContextHint')}>
                    <I.folder className="crumb-ic" />
                    {runCtx.group && <span className="run-crumb-seg">{runCtx.group}</span>}
                    {runCtx.group && runCtx.leaf && <span className="run-crumb-sep">›</span>}
                    {runCtx.leaf && <span className="run-crumb-seg run-crumb-leaf">{runCtx.leaf}</span>}
                  </span>
                )}
                <PhaseTrack phaseStates={phaseStates} current={current} />
              </>
            ) : <span style={{ fontSize: 13, color: 'var(--tx-muted)' }}>{crumb.label}</span>}
            <div className="chat-top-right">
              <button className="ghost-pill" onClick={toggleLang}
                title={lang.value === 'ja' ? tr('switchToEnglish') : tr('switchToJapanese')}
                aria-label={tr('changeLanguage')}>
                <I.globe />{lang.value === 'ja' ? '日本語' : 'EN'}
              </button>
              <button className="ghost-pill" onClick={toggleTheme}
                title={theme === 'light' ? tr('switchToDark') : tr('switchToLight')}
                aria-label={theme === 'light' ? tr('switchToDark') : tr('switchToLight')}>
                {theme === 'light' ? <I.sun /> : <I.moon />}
              </button>
              {view === 'conversation' && busy && (
                <button className="ghost-pill stop-pill" onClick={() => void onStop()} title={tr('stopRunningBuild')}>
                  <span className="stop-sq" />{tr('stop')}
                </button>
              )}
              {view === 'conversation' && (
                <span className="conn-dot" title={connected ? tr('live') : tr('reconnecting')}
                  style={{ width: 7, height: 7, borderRadius: 99, background: connected ? 'var(--ok)' : 'var(--tx-faint)' }} />
              )}
              {view === 'conversation' && tabs.length > 0 && !artifactOpen && (
                <button className="ghost-pill" onClick={() => setArtifactOpen(true)}>
                  <I.panel />{tr('artifact')}
                </button>
              )}
            </div>
          </div>

          {view === 'empty' ? (
            <EmptyState draft={draft} setDraft={setDraft} send={send}
              settings={settingsSubset} onSettings={onSettings} workflows={workflows}
              crumb={crumb} onClearCrumb={clearNewTaskCrumb}
              seeds={seeds} selectedSeed={settings.seed}
              onSeed={(id) => { store.settings.value = { ...store.settings.value, seed: id }; }}
              startError={startError} busyHolder={busyHolder}
              files={files} onAddFiles={(f) => void addFiles(f)} onRemoveFile={removeFile}
            />
          ) : (
            <>
              <div className="thread" ref={threadRef}>
                <div className="thread-inner">
                  {thread.map((item) => {
                    if (item.kind === 'user')
                      return <div key={item.id} className="msg msg-user"><div className="bubble-user">{item.text}</div></div>;
                    if (item.kind === 'run')
                      return <div key={item.id} className="msg msg-assistant">
                        <Disclosure phaseKey={item.phase} running={item.running} output={item.output} stopped={item.stopped} />
                      </div>;
                    if (item.kind === 'qa')
                      return <div key={item.id} className="msg msg-assistant">
                        <QaAnswer answer={item.answer} done={item.done} seededFrom={item.seededFrom} />
                      </div>;
                    // gate
                    return <div key={item.id} className="msg msg-assistant">
                      <GateCard task={item.snapshot} resolved={item.resolved} busy={busy || asking}
                        onConfirm={onConfirm}
                        onArmChange={(label) => { setChangeLabel(label); setMode('change'); setFocusToken((x) => x + 1); }}
                        onCancel={() => void onDiscard()}
                        onRestore={() => void store.restore()}
                        /* spec 035: "Edit this workflow" — a done/cancelled gate-foot button that starts a
                           NEW edit-existing build via the SAME newTask({baseWorkflow}) the sidebar "+" uses. */
                        onEditAgain={(project, workflow) => newTask({ baseWorkflow: { project, workflow } })}
                        /* spec 036 D5: "Run test with workflow" — re-enter the live sub-orchestrator from a
                           done autonomous build (terminalFootActions gates it on creds + auto/spec_only). */
                        onRunTest={() => void store.liveTest()}
                        onOpenArtifact={openArtifact}
                      />
                    </div>;
                  })}
                </div>
              </div>

              <StartErrorBanner startError={startError} busyHolder={busyHolder}
                onOpen={(id) => { setMode('ask'); void store.openTask(id); }} />

              {/* spec 033 D7/FIX-J: the docked action bar — pinned above the composer while parked at
                  an analyze/spec/implement gate, so the phase's next-step actions stay reachable through
                  any amount of Ask chat. Disabled during a live Ask OR a live Reply (FIX-H). */}
              {task && dockedGate && (
                <div className="docked-gate-dock">
                  <div className="composer-wrap">
                    <GateActions task={task} busy={busy || asking} onConfirm={onConfirm}
                      onArmChange={(label) => { setChangeLabel(label); setMode('change'); setFocusToken((x) => x + 1); }}
                      onCancel={() => void onDiscard()}
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
                    <>
                      {/* spec 033 D2 / 034 D5: the mode indicator shows ONLY when the composer is in the
                          non-default `change` mode (armed by a gate's reply-kind action) — Ask is the
                          default and already signalled by the `Ask a question…` placeholder, so an always-on
                          "Ask" chip was redundant clutter. In change mode it reads "Request changes" + a
                          one-tap way back to Ask, so the mode is unmistakable exactly when it deviates. */}
                      {askableGate && mode === 'change' && (
                        <div className="mode-row">
                          <span className="mode-chip on">{tr('modeChange')}</span>
                          <button type="button" className="mode-back"
                            onClick={() => { setMode('ask'); setFiles([]); }} title={tr('modeBackToAsk')}>
                            {tr('modeBackToAsk')}
                          </button>
                        </div>
                      )}
                      <Composer value={draft} onChange={setDraft} onSend={() => send()}
                        settings={{ workflow: task.workflow ?? 'none', confirm: store.confirmModeLabel(task.confirmMode), fast: task.fastMode ?? false }}
                        onSettings={(patch) => { if (patch.confirm) void store.patchConfirmMode(task.taskId, patch.confirm); }}
                        workflows={workflows} lockStartBound lockConfirm={busy}
                        placeholder={livePlaceholder} focusToken={focusToken}
                        /* FIX-H: send-readiness is disabled while a phase/Reply turn runs (busy) OR a
                           live Ask streams (asking) — sending during either just 409s. */
                        disabled={busy || asking}
                        files={files}
                        /* spec 033 F5 / 034 D5: Ask is answer-only and /ask takes no files, so hide the
                           attach affordance while Ask is the active send path (at any askable gate incl. ④)
                           — a file attached there would be silently dropped. It returns in change-mode
                           (Request-changes /reply DOES carry files). */
                        onAddFiles={askableGate && mode === 'ask' ? undefined : (f) => void addFiles(f)}
                        onRemoveFile={removeFile}
                      />
                    </>
                  ) : (
                    // spec 034 D3: a terminal (done/cancelled) build's composer is Ask-only — the settings
                    // row is DROPPED (Send no longer starts a new build) and attach is hidden (/ask takes no
                    // files). Starting a new build lives at the sidebar "+". Just a question box.
                    <Composer value={draft} onChange={setDraft} onSend={() => send()}
                      placeholder={tr('phAskAboutBuild')} disabled={asking}
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

/* ---------- empty / new-task surface ---------- */
function EmptyState({ draft, setDraft, send, settings, onSettings, workflows, crumb, onClearCrumb, seeds, selectedSeed, onSeed, startError, busyHolder, files, onAddFiles, onRemoveFile }: {
  draft: string;
  setDraft: (s: string) => void;
  send: (text?: string) => void;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
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
}) {
  return (
    <div className="empty">
      <div className="empty-wrap">
        {/* spec 029: the crumb reflects the "+" pre-selection and, when one is active, clicking it clears
            back to a plain new task (the crumb IS the "×"). Inert when nothing is pre-selected (as before). */}
        <button className={'empty-crumb' + (crumb.active ? ' clearable' : '')}
          onClick={crumb.active ? onClearCrumb : undefined}
          title={crumb.active ? tr('clearPreselection') : undefined}>
          {crumb.icon === 'message' ? <I.message className="crumb-ic" /> : <I.folder className="crumb-ic" />}
          <span>{crumb.label}</span>
        </button>

        <Composer value={draft} onChange={setDraft} onSend={() => send()}
          settings={settings} onSettings={onSettings} workflows={workflows}
          placeholder={tr('phDescribeWorkflow')}
          files={files} onAddFiles={onAddFiles} onRemoveFile={onRemoveFile}
        />

        <StartErrorBanner startError={startError} busyHolder={busyHolder} />

        {/* Seed picker (AC #2): lists /api/seeds; degrades to an empty list until Lát 5. */}
        <div className="seed-picker">
          <div className="suggest-label">{tr('seedFrom')}</div>
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
