/* ============================================================
   App.tsx — orchestrator: run engine, surfaces, scenario switcher
   Ported from app.jsx. ReactDOM.createRoot → render (main.tsx).
   Drives the static shell off mock fixtures across the four run
   states: running · awaiting_confirm · error · done.
   ============================================================ */
import { useState, useRef, useEffect } from 'preact/hooks';
import { Sidebar } from './Sidebar';
import { PhaseTrack, Disclosure, GateCard, Composer } from './Chat';
import { ArtifactPanel } from './ArtifactPanel';
import { CreateProjectModal } from './Modal';
import { I } from './Icon';
import { TREE, SUGGESTIONS, GATES } from '../data';
import type {
  PhaseKey, PhaseStates, ArtifactTab, GateKey, GateItem, Scenario,
  Settings, Crumb, TreeProject, TreeTask, ThreadItem, ThreadInput, FolderEntry,
} from '../types';

let _uid = 0;
const uid = () => 'x' + (++_uid);
const uniq = <T,>(a: T[]): T[] => [...new Set(a)];

const INIT_PHASES: PhaseStates = { analyze: 'pending', spec: 'pending', implement: 'pending', test: 'pending' };

type PhaseOpts = { clearError?: boolean; forceClean?: boolean };

export function App() {
  const [view, setView] = useState<'empty' | 'conversation'>('empty');
  const [sbCollapsed, setSb] = useState(false);
  const [draft, setDraft] = useState('');
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [phaseStates, setPhases] = useState<PhaseStates>(INIT_PHASES);
  const [current, setCurrent] = useState<PhaseKey | null>(null);
  const [activeTask, setActiveTask] = useState<string | null>('t-jp');
  const [, setTaskTitle] = useState('Add JP grammar step');
  const [tree, setTree] = useState<TreeProject[]>(TREE);
  const [createOpen, setCreateOpen] = useState(false);
  const [crumb, setCrumb] = useState<Crumb>({ project: 'Eiken', workflow: 'stem_proofread' });

  const [settings, setSettings] = useState<Settings>({ workflow: 'stem_proofread', confirm: 'each step', deploy: 'none' });

  const [artifactOpen, setArtifactOpen] = useState(false);
  const [artifactTab, setArtifactTab] = useState<ArtifactTab>('yaml');
  const [artifactAvail, setAvail] = useState<ArtifactTab[]>([]);

  // scenario switcher
  const [scenario, setScenario] = useState<Scenario>('clean');
  const [forceError, setForceError] = useState(false);
  const [protoOpen, setProtoOpen] = useState(false);

  const timer = useRef<number | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [thread]);

  const append = (item: ThreadInput) => setThread((t) => [...t, { id: uid(), ...item }]);
  const setRunDone = (id: string) => setThread((t) => t.map((it) => (it.type === 'run' && it.id === id ? { ...it, running: false } : it)));
  const resolveGate = (id: string, label: string) => setThread((t) => t.map((it) => (it.type === 'gate' && it.id === id ? { ...it, resolved: label } : it)));

  /* ---------- run engine ---------- */
  function startPhase(key: PhaseKey, opts: PhaseOpts = {}) {
    if (timer.current) clearTimeout(timer.current);
    setCurrent(key);
    setPhases((s) => ({ ...s, [key]: 'running' }));
    const runId = uid();
    setThread((t) => [...t, { id: runId, type: 'run', phase: key, running: true }]);

    if (key === 'implement') {
      setAvail((a) => uniq([...a, 'spec', 'yaml', 'diff'] as ArtifactTab[]));
      setArtifactTab('yaml');
      setArtifactOpen(true);
      setSb(true);
    }
    timer.current = window.setTimeout(() => finishPhase(key, runId, opts), 2000);
  }

  function finishPhase(key: PhaseKey, runId: string, opts: PhaseOpts) {
    setRunDone(runId);

    if (key === 'implement' && forceError && !opts.clearError) {
      setPhases((s) => ({ ...s, implement: 'error' }));
      append({ type: 'gate', gateKey: 'error' });
      return;
    }
    setPhases((s) => ({ ...s, [key]: 'awaiting' }));

    if (key === 'analyze') append({ type: 'gate', gateKey: 'analyze' });
    else if (key === 'spec') { setAvail((a) => uniq([...a, 'spec'] as ArtifactTab[])); append({ type: 'gate', gateKey: 'spec' }); }
    else if (key === 'implement') {
      const failing = opts.forceClean ? false : scenario === 'failing';
      append({ type: 'gate', gateKey: failing ? 'implement_failing' : 'implement_clean' });
    }
    else if (key === 'test') {
      if (settings.deploy !== 'none') append({ type: 'gate', gateKey: 'import' });
      else { setPhases((s) => ({ ...s, test: 'done' })); setAvail((a) => uniq([...a, 'report'] as ArtifactTab[])); append({ type: 'gate', gateKey: 'done' }); }
    }
  }

  /* ---------- entry points ---------- */
  function send(text?: string) {
    const msg = (text ?? draft).trim();
    if (!msg) return;
    setDraft('');
    if (view === 'empty') {
      setView('conversation');
      setTaskTitle(msg.length > 42 ? msg.slice(0, 42) + '…' : msg);
      setThread([{ id: uid(), type: 'user', text: msg }]);
      setPhases(INIT_PHASES);
      setAvail([]); setArtifactOpen(false);
      window.setTimeout(() => startPhase('analyze'), 280);
    } else {
      append({ type: 'user', text: msg });
      // a mid-conversation message nudges the current phase to re-run
      const target = current || 'analyze';
      window.setTimeout(() => startPhase(target), 240);
    }
  }

  /* ---------- gate handlers ---------- */
  function onGatePrimary(entry: GateItem) {
    const g = entry.gateKey;
    if (g === 'analyze') { resolveGate(entry.id, 'Continued to Spec'); markDone('analyze'); startPhase('spec'); }
    else if (g === 'spec') { resolveGate(entry.id, 'Continued to Implement'); markDone('spec'); startPhase('implement'); }
    else if (g === 'implement_clean') { resolveGate(entry.id, 'Implemented — running tests'); markDone('implement'); startPhase('test'); }
    else if (g === 'import') {
      resolveGate(entry.id, 'Imported into Dify · staging');
      markDone('test'); setAvail((a) => uniq([...a, 'report'] as ArtifactTab[]));
      append({ type: 'gate', gateKey: 'done' });
    }
  }

  function markDone(key: PhaseKey) { setPhases((s) => ({ ...s, [key]: 'done' })); }

  function onGateAction(entry: GateItem, action: string) {
    const g = entry.gateKey;
    if (g === 'implement_failing') {
      if (action === 'accept') { resolveGate(entry.id, 'Accepted with 1 warning'); markDone('implement'); startPhase('test'); }
      else if (action === 'retry') { resolveGate(entry.id, 'Re-running implement'); setScenario('clean'); startPhase('implement', { forceClean: true }); }
      else if (action === 'abandon') { resolveGate(entry.id, 'Abandoned — spec preserved'); setPhases((s) => ({ ...s, implement: 'pending' })); }
    } else if (g === 'error' && action === 'retry-phase') {
      resolveGate(entry.id, 'Retrying Implement');
      setForceError(false);
      startPhase('implement', { clearError: true });
    } else if (g === 'import' && action === 'skip-import') {
      resolveGate(entry.id, 'Skipped import — changes stay local');
      markDone('test'); setAvail((a) => uniq([...a, 'report'] as ArtifactTab[]));
    }
  }

  function onRequestChanges(entry: GateItem, text: string) {
    resolveGate(entry.id, 'Requested changes');
    append({ type: 'user', text: text || 'Please revise this.' });
    const phase: PhaseKey = entry.gateKey === 'analyze' ? 'analyze' : entry.gateKey === 'spec' ? 'spec' : 'implement';
    setPhases((s) => ({ ...s, [phase]: 'pending' }));
    window.setTimeout(() => startPhase(phase), 240);
  }

  function openArtifact(tab: ArtifactTab) { setAvail((a) => uniq([...a, tab])); setArtifactTab(tab); setArtifactOpen(true); setSb(true); }

  function openTask(task: TreeTask) {
    setActiveTask(task.id);
    setTaskTitle(task.name);
    if (task.id === 't-jp') return; // keep current demo conversation
    reset(true);
  }

  function reset(toEmpty: boolean) {
    if (timer.current) clearTimeout(timer.current);
    setThread([]); setPhases(INIT_PHASES); setCurrent(null);
    setArtifactOpen(false); setAvail([]); setDraft('');
    setView(toEmpty ? 'empty' : 'empty');
  }

  function handleCreateProject({ name, folders }: { name: string; folders: FolderEntry[] }) {
    const pid = 'p' + Date.now();
    const wfs = folders.map((f, i) => ({ id: pid + 'w' + i, name: f.name, open: false, tasks: [] }));
    const proj: TreeProject = { id: pid, name, open: true, workflows: wfs };
    setTree((t) => [proj, ...t]);
    setCreateOpen(false);
    setActiveTask(null);
    setCrumb({ project: name, workflow: folders[0] ? folders[0].name : null });
    reset(true);
  }

  const busy = !!current && phaseStates[current] === 'running';

  /* ---------- render ---------- */
  return (
    <div className={'app' + (sbCollapsed ? ' sb-collapsed' : '')}>
      <Sidebar collapsed={sbCollapsed} activeTask={activeTask} tree={tree}
        onOpen={openTask}
        onNewTask={() => { setActiveTask(null); reset(true); }}
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
              {view === 'conversation' && artifactAvail.length > 0 && !artifactOpen && (
                <button className="ghost-pill" onClick={() => { setArtifactOpen(true); setSb(true); }}>
                  <I.panel />Artifact
                </button>
              )}
            </div>
          </div>

          {view === 'empty' ? (
            <EmptyState draft={draft} setDraft={setDraft} send={send} settings={settings} crumb={crumb} />
          ) : (
            <>
              <div className="thread" ref={threadRef}>
                <div className="thread-inner">
                  {thread.map((item) => {
                    if (item.type === 'user')
                      return <div key={item.id} className="msg msg-user"><div className="bubble-user">{item.text}</div></div>;
                    if (item.type === 'run')
                      return <div key={item.id} className="msg msg-assistant">
                        <Disclosure phaseKey={item.phase} running={item.running} openDefault={item.running} />
                      </div>;
                    if (item.type === 'gate')
                      return <div key={item.id} className="msg msg-assistant">
                        <GateCard gate={GATES[item.gateKey]} busy={busy} resolved={item.resolved}
                          onPrimary={() => onGatePrimary(item)}
                          onAction={(a) => onGateAction(item, a)}
                          onRequestChanges={(t) => onRequestChanges(item, t)}
                          onOpenArtifact={openArtifact}
                        />
                      </div>;
                    return null;
                  })}
                </div>
              </div>

              <div className="composer-dock">
                <div className="composer-wrap">
                  <Composer slim value={draft} onChange={setDraft} onSend={() => send()}
                    settings={settings} placeholder="Reply, or describe another change…"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {artifactOpen && (
          <ArtifactPanel tab={artifactTab} setTab={setArtifactTab}
            scenario={scenario} deploy={settings.deploy} available={artifactAvail}
            onClose={() => { setArtifactOpen(false); setSb(false); }}
          />
        )}
      </div>

      <ProtoSwitcher
        open={protoOpen} setOpen={setProtoOpen}
        scenario={scenario} setScenario={setScenario}
        deploy={settings.deploy} setDeploy={(d) => setSettings((s) => ({ ...s, deploy: d }))}
        confirm={settings.confirm} setConfirm={(c) => setSettings((s) => ({ ...s, confirm: c }))}
        forceError={forceError} setForceError={setForceError}
        onReset={() => { reset(true); setActiveTask('t-jp'); setTaskTitle('Add JP grammar step'); }}
      />

      {createOpen && (
        <CreateProjectModal
          onClose={() => setCreateOpen(false)}
          onCreate={handleCreateProject}
        />
      )}
    </div>
  );
}

/* ---------- empty / new-task surface ---------- */
function EmptyState({ draft, setDraft, send, settings, crumb }: {
  draft: string;
  setDraft: (s: string) => void;
  send: (text?: string) => void;
  settings: Settings;
  crumb: Crumb;
}) {
  return (
    <div className="empty">
      <div className="empty-wrap">
        <button className="empty-crumb">
          <I.folder className="crumb-ic" />
          <span>{crumb.project}</span>
          {crumb.workflow && <>
            <span style={{ color: 'var(--tx-faint)' }}>/</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>{crumb.workflow}</span>
          </>}
          <span className="tw-twist"><I.chevDown /></span>
        </button>

        <Composer value={draft} onChange={setDraft} onSend={() => send()}
          settings={settings} placeholder="Describe the workflow or change…"
        />

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

/* ---------- prototype scenario switcher ---------- */
function Seg({ value, set, options }: {
  value: string;
  set: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.v} className={value === o.v ? 'on' : ''} onClick={() => set(o.v)}>{o.l}</button>
      ))}
    </div>
  );
}

function ProtoSwitcher({ open, setOpen, scenario, setScenario, deploy, setDeploy,
  confirm, setConfirm, forceError, setForceError, onReset }: {
  open: boolean;
  setOpen: (fn: (o: boolean) => boolean) => void;
  scenario: Scenario;
  setScenario: (s: Scenario) => void;
  deploy: string;
  setDeploy: (d: string) => void;
  confirm: string;
  setConfirm: (c: string) => void;
  forceError: boolean;
  setForceError: (b: boolean) => void;
  onReset: () => void;
}) {
  return (
    <div className="proto">
      {open && (
        <div className="proto-panel">
          <h4>Prototype scenarios</h4>
          <div className="proto-group">
            <label>Implement result</label>
            <Seg value={scenario} set={(v) => setScenario(v as Scenario)}
              options={[{ v: 'clean', l: 'Clean' }, { v: 'failing', l: 'Lint fails' }]} />
          </div>
          <div className="proto-group">
            <label>Deploy target (adds Import gate)</label>
            <Seg value={deploy} set={setDeploy}
              options={[{ v: 'none', l: 'none' }, { v: 'staging', l: 'staging' }]} />
          </div>
          <div className="proto-group">
            <label>Confirm mode</label>
            <Seg value={confirm} set={setConfirm}
              options={[{ v: 'each step', l: 'Each step' }, { v: 'end only', l: 'End only' }]} />
          </div>
          <div className="proto-group">
            <label>Implement phase</label>
            <Seg value={forceError ? 'err' : 'ok'} set={(v) => setForceError(v === 'err')}
              options={[{ v: 'ok', l: 'Succeeds' }, { v: 'err', l: 'Errors' }]} />
          </div>
          <button className="proto-reset" onClick={onReset}>↻ Reset to empty state</button>
        </div>
      )}
      <button className="proto-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="pt-dot" />Scenarios
      </button>
    </div>
  );
}
