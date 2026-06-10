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
import { CreateProjectModal } from './Modal';
import { I } from './Icon';
import { SUGGESTIONS } from '../data';
import * as store from '../store';
import type { ArtifactTab, Settings, WireTask, WireGateAction, Seed } from '../types';

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
  const [draft, setDraft] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [artifactTab, setArtifactTab] = useState<ArtifactTab>('spec');
  const threadRef = useRef<HTMLDivElement>(null);

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
  const settings = store.settings.value;

  useEffect(() => {
    void store.loadTree();
    void store.loadSeeds();
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
  function send(text?: string): void {
    const msg = (text ?? draft).trim();
    if (!msg) return;
    setDraft('');
    if (view === 'empty') {
      void store.start(msg);
    } else {
      void store.reply(msg);
    }
  }
  function openArtifact(tab: ArtifactTab): void {
    setArtifactTab(tab);
    setArtifactOpen(true);
    setSb(true);
  }
  function onConfirm(action: WireGateAction): void {
    void store.confirm(action);
  }
  function newTask(): void {
    store.resetToNew();
    setArtifactOpen(false);
  }

  const tabs = task ? availableTabs(task) : [];
  // Auto-open the panel once the Implement YAML exists (mirrors the design's behavior).
  useEffect(() => {
    if (task && task.artifactContents?.yaml && !artifactOpen) {
      setArtifactTab('yaml');
      setArtifactOpen(true);
      setSb(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.artifactContents?.yaml]);

  /* ---------- render ---------- */
  return (
    <div className={'app' + (sbCollapsed ? ' sb-collapsed' : '')}>
      <Sidebar collapsed={sbCollapsed} activeTask={activeTaskId} tree={tree}
        onOpen={(id) => { setArtifactOpen(false); void store.openTask(id); }}
        onNewTask={newTask}
        onNewProject={() => setCreateOpen(true)}
        onToggle={() => setSb((c) => !c)}
      />

      <div className={'main' + (artifactOpen ? ' has-artifact' : '')}>
        <div className="chat">
          <div className="chat-top">
            <button className="icon-btn sb-toggle" onClick={() => setSb((c) => !c)} title="Toggle sidebar">
              <I.sidebar />
            </button>
            {view === 'conversation'
              ? <PhaseTrack phaseStates={phaseStates} current={current} />
              : <span style={{ fontSize: 13, color: 'var(--tx-muted)' }}>New task</span>}
            <div className="chat-top-right">
              {view === 'conversation' && (
                <span className="conn-dot" title={connected ? 'Live' : 'Reconnecting…'}
                  style={{ width: 7, height: 7, borderRadius: 99, background: connected ? 'var(--ok)' : 'var(--tx-faint)' }} />
              )}
              {view === 'conversation' && tabs.length > 0 && !artifactOpen && (
                <button className="ghost-pill" onClick={() => { setArtifactOpen(true); setSb(true); }}>
                  <I.panel />Artifact
                </button>
              )}
            </div>
          </div>

          {view === 'empty' ? (
            <EmptyState draft={draft} setDraft={setDraft} send={send}
              settings={settingsSubset} onSettings={onSettings} workflows={workflows}
              seeds={seeds} selectedSeed={settings.seed}
              onSeed={(id) => { store.settings.value = { ...store.settings.value, seed: id }; }}
              startError={startError}
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
                        <Disclosure phaseKey={item.phase} running={item.running} output={item.output} />
                      </div>;
                    // gate
                    return <div key={item.id} className="msg msg-assistant">
                      <GateCard task={item.snapshot} resolved={item.resolved} busy={busy}
                        onConfirm={onConfirm}
                        onReply={(t) => void store.reply(t)}
                        onCancel={() => void store.cancel()}
                        onOpenArtifact={openArtifact}
                      />
                    </div>;
                  })}
                </div>
              </div>

              {startError && (
                <div className="start-error"><I.alert />{startError}</div>
              )}

              <div className="composer-dock">
                <div className="composer-wrap">
                  <Composer value={draft} onChange={setDraft} onSend={() => send()}
                    settings={settingsSubset} onSettings={onSettings} workflows={workflows}
                    placeholder="Reply, or describe another change…"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {artifactOpen && task && (
          <ArtifactPanel task={task} tab={artifactTab} setTab={setArtifactTab}
            available={tabs}
            onClose={() => { setArtifactOpen(false); setSb(false); }}
            onSaveSpec={store.saveSpec}
          />
        )}
      </div>

      {createOpen && (
        <CreateProjectModal
          onClose={() => setCreateOpen(false)}
          onCreate={() => { setCreateOpen(false); newTask(); }}
        />
      )}
    </div>
  );
}

/* ---------- empty / new-task surface ---------- */
function EmptyState({ draft, setDraft, send, settings, onSettings, workflows, seeds, selectedSeed, onSeed, startError }: {
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
}) {
  return (
    <div className="empty">
      <div className="empty-wrap">
        <button className="empty-crumb">
          <I.folder className="crumb-ic" />
          <span>New task</span>
        </button>

        <Composer value={draft} onChange={setDraft} onSend={() => send()}
          settings={settings} onSettings={onSettings} workflows={workflows}
          placeholder="Describe the workflow or change…"
        />

        {startError && <div className="start-error"><I.alert />{startError}</div>}

        {/* Seed picker (AC #2): lists /api/seeds; degrades to an empty list until Lát 5. */}
        <div className="seed-picker">
          <div className="suggest-label">SEED FROM</div>
          {seeds.length === 0 ? (
            <div className="secret-note" style={{ padding: '6px 0' }}>
              No seed apps — connect Dify to seed from a workspace app (Lát 5). New workflows start from scratch.
            </div>
          ) : (
            <div className="seed-list">
              <button className={'seed-chip' + (!selectedSeed ? ' on' : '')} onClick={() => onSeed(null)}>none</button>
              {seeds.map((s) => (
                <button key={s.id} className={'seed-chip' + (selectedSeed === s.id ? ' on' : '')} onClick={() => onSeed(s.id)}>
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="empty-suggest">
          <div className="suggest-label">TRY</div>
          {SUGGESTIONS.map((s, i) => (
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
