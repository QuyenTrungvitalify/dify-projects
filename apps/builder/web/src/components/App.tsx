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
import { PhaseTrack, Disclosure, GateCard, Composer } from './Chat';
import { ArtifactPanel } from './ArtifactPanel';
import { CreateProjectModal, ConfirmModal } from './Modal';
import { I } from './Icon';
import { suggestions } from '../data';
import { t as tr, tf, lang, toggleLang } from '../lib/i18n';
import * as store from '../store';
import { type ComposerAttachment, MAX_ATTACHMENTS, isAcceptedFile, fileToDataUrl, toWire } from '../lib/attachments';
import type { ArtifactTab, Settings, WireTask, WireGateAction, Seed } from '../types';

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

  const view: 'empty' | 'conversation' = task ? 'conversation' : 'empty';
  const activeTaskId = task?.taskId ?? null;
  const settingsSubset: Settings = { workflow: settings.workflow, confirm: settings.confirm, deploy: settings.deploy };
  const onSettings = (patch: Partial<Settings>): void => {
    store.settings.value = { ...store.settings.value, ...patch };
  };
  const workflows = tree
    .filter((p) => p.id !== '__drafts__')
    .flatMap((p) => p.workflows.map((w) => w.id))
    .filter((s, i, arr) => arr.indexOf(s) === i);

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
    // A finished/cancelled build can't be replied to (/reply only applies while awaiting_confirm or
    // in error→Retry). So at a terminal status, "describe another change" starts a NEW build instead
    // of erroring — matching the composer's intent. awaiting_confirm/error still route to reply.
    const st = store.task.value?.status;
    if (view === 'empty' || st === 'done' || st === 'cancelled') {
      void store.start(msg, atts);
    } else {
      void store.reply(msg, undefined, atts); // free-form dock reply → generic resolved-label
    }
  }
  function openArtifact(tab: ArtifactTab): void {
    setArtifactTab(tab);
    setArtifactOpen(true);
  }
  // spec 016 D4: the irreversible/destructive gate confirms route through the shared ConfirmModal first
  // (mirroring the Stop pill). Accept-anyway ships a lint-failing build; Import pushes to a live Dify
  // workspace (creates a NEW app). The benign advances (Continue/Implement/Skip) fire with no dialog.
  async function onConfirm(action: WireGateAction): Promise<void> {
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
    void store.confirm(action);
  }
  // The cancel-kind gate action (Discard/Abandon) is terminal — confirm before abandoning the build.
  async function onDiscard(): Promise<void> {
    const ok = await store.askConfirm({
      title: tr('discardTitle'), message: tr('discardMsg'),
      okLabel: tr('discardOk'), danger: true,
    });
    if (ok) void store.cancel();
  }
  function newTask(): void {
    store.resetToNew();
    setArtifactOpen(false);
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

  /* ---------- render ---------- */
  return (
    <div className={'app' + (sbCollapsed ? ' sb-collapsed' : '')}>
      <Sidebar collapsed={sbCollapsed} activeTask={activeTaskId} tree={tree} active={active}
        onOpen={(id) => { setArtifactOpen(false); void store.openTask(id); }}
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
            {view === 'conversation'
              ? <PhaseTrack phaseStates={phaseStates} current={current} />
              : <span style={{ fontSize: 13, color: 'var(--tx-muted)' }}>{tr('newTask')}</span>}
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
                    // gate
                    return <div key={item.id} className="msg msg-assistant">
                      <GateCard task={item.snapshot} resolved={item.resolved} busy={busy}
                        onConfirm={onConfirm}
                        onReply={(t, label) => void store.reply(t, label)}
                        onCancel={() => void onDiscard()}
                        onRestore={() => void store.restore()}
                        onOpenArtifact={openArtifact}
                      />
                    </div>;
                  })}
                </div>
              </div>

              <StartErrorBanner startError={startError} busyHolder={busyHolder} />

              <div className="composer-dock">
                <div className="composer-wrap">
                  {/* F2 (spec 010): while the active build is LIVE (non-terminal) the Confirm chip
                      reflects + live-patches its confirm_mode and Workflow/Deploy are start-bound
                      (read-only). At a terminal status the composer starts a NEW build (send() routes
                      done/cancelled → start), so the chips revert to editing the next-build settings. */}
                  {task && task.status !== 'done' && task.status !== 'cancelled' ? (
                    <Composer value={draft} onChange={setDraft} onSend={() => send()}
                      settings={{ workflow: task.workflow ?? 'none', confirm: store.confirmModeLabel(task.confirmMode), deploy: task.deploy }}
                      onSettings={(patch) => { if (patch.confirm) void store.patchConfirmMode(task.taskId, patch.confirm); }}
                      workflows={workflows} lockStartBound lockConfirm={busy}
                      placeholder={tr('phReplyOrDescribe')}
                      files={files} onAddFiles={(f) => void addFiles(f)} onRemoveFile={removeFile}
                    />
                  ) : (
                    <Composer value={draft} onChange={setDraft} onSend={() => send()}
                      settings={settingsSubset} onSettings={onSettings} workflows={workflows}
                      placeholder={tr('phDescribeAnother')}
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
            />
          </>
        )}
      </div>

      {createOpen && (
        <CreateProjectModal
          onClose={() => setCreateOpen(false)}
          onCreate={() => { setCreateOpen(false); newTask(); }}
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
 *  to the build whose turn is running, so a "busy" is actionable rather than a dead end (AC #21). */
function StartErrorBanner({ startError, busyHolder }: { startError: string | null; busyHolder: string | null }) {
  if (!startError) return null;
  return (
    <div className="start-error">
      <I.alert />
      <span>{startError}</span>
      {busyHolder && (
        <button className="gs-link" style={{ marginLeft: 6 }} onClick={() => void store.openTask(busyHolder)}>
          {tr('openIt')}
        </button>
      )}
    </div>
  );
}

/* ---------- empty / new-task surface ---------- */
function EmptyState({ draft, setDraft, send, settings, onSettings, workflows, seeds, selectedSeed, onSeed, startError, busyHolder, files, onAddFiles, onRemoveFile }: {
  draft: string;
  setDraft: (s: string) => void;
  send: (text?: string) => void;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  workflows: string[];
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
        <button className="empty-crumb">
          <I.folder className="crumb-ic" />
          <span>{tr('newTask')}</span>
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
