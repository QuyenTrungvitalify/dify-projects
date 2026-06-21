/* ============================================================
   app.jsx — orchestrator: run engine, surfaces, scenario switcher
   ============================================================ */
const { useState: use, useRef: ref, useEffect: eff } = React;
const { PhaseTrack, Disclosure, GateCard, Composer } = window.Chat;
const CreateProjectModal = window.CreateProjectModal;
const ConfirmModal = window.ConfirmModal;

let _uid = 0;
const uid = () => "x" + (++_uid);
const uniq = (a) => [...new Set(a)];

const INIT_PHASES = { analyze: "pending", spec: "pending", implement: "pending", test: "pending" };

function App() {
  const [view, setView] = use("empty");            // empty | conversation
  const [sbCollapsed, setSb] = use(false);
  const [draft, setDraft] = use("");
  const [thread, setThread] = use([]);
  const [phaseStates, setPhases] = use(INIT_PHASES);
  const [current, setCurrent] = use(null);
  const [activeTask, setActiveTask] = use("t-jp");
  const [taskTitle, setTaskTitle] = use("Add JP grammar step");
  const [tree, setTree] = use(TREE);
  const [createOpen, setCreateOpen] = use(false);
  const [crumb, setCrumb] = use({ project: "Eiken", workflow: "stem_proofread" });
  const [confirmState, setConfirmState] = use(null);   // {title, message, danger, okLabel, onOk}

  const [settings, setSettings] = use({ workflow: "stem_proofread", confirm: "each step", deploy: "none" });

  const [artifactOpen, setArtifactOpen] = use(false);
  const [artifactTab, setArtifactTab] = use("yaml");
  const [artifactAvail, setAvail] = use([]);

  // scenario switcher
  const [scenario, setScenario] = use("clean");     // clean | failing
  const [forceError, setForceError] = use(false);
  const [protoOpen, setProtoOpen] = use(false);

  // theme (dark default; initial value set pre-mount by inline script in index.html)
  const [theme, setTheme] = use(() => document.documentElement.dataset.theme || "dark");
  eff(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("theme", theme); } catch (e) {}
  }, [theme]);
  const toggleTheme = () => setTheme(t => (t === "light" ? "dark" : "light"));

  const timer = ref(null);
  const threadRef = ref(null);

  eff(() => () => clearTimeout(timer.current), []);
  eff(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [thread]);

  const append = (item) => setThread(t => [...t, { id: uid(), ...item }]);
  const setRunDone = (id) => setThread(t => t.map(it => it.id === id ? { ...it, running: false } : it));
  const resolveGate = (id, label) => setThread(t => t.map(it => it.id === id ? { ...it, resolved: label } : it));

  /* ---------- run engine ---------- */
  function startPhase(key, opts = {}) {
    clearTimeout(timer.current);
    setCurrent(key);
    setPhases(s => ({ ...s, [key]: "running" }));
    const runId = uid();
    setThread(t => [...t, { id: runId, type: "run", phase: key, running: true }]);

    if (key === "implement") {
      setAvail(a => uniq([...a, "spec", "yaml", "diff"]));
      setArtifactTab("yaml");
      setArtifactOpen(true);
      setSb(true);
    }
    timer.current = setTimeout(() => finishPhase(key, runId, opts), 3500);
  }

  function finishPhase(key, runId, opts) {
    setRunDone(runId);

    if (key === "implement" && forceError && !opts.clearError) {
      setPhases(s => ({ ...s, implement: "error" }));
      append({ type: "gate", gateKey: "error" });
      return;
    }
    setPhases(s => ({ ...s, [key]: "awaiting" }));

    if (key === "analyze") append({ type: "gate", gateKey: "analyze" });
    else if (key === "spec") { setAvail(a => uniq([...a, "spec"])); append({ type: "gate", gateKey: "spec" }); }
    else if (key === "implement") {
      const failing = opts.forceClean ? false : scenario === "failing";
      append({ type: "gate", gateKey: failing ? "implement_failing" : "implement_clean" });
    }
    else if (key === "test") {
      if (settings.deploy !== "none") append({ type: "gate", gateKey: "import" });
      else { setPhases(s => ({ ...s, test: "done" })); setAvail(a => uniq([...a, "report"])); append({ type: "gate", gateKey: "done" }); }
    }
  }

  /* ---------- entry points ---------- */
  function send(text) {
    const msg = (text ?? draft).trim();
    if (!msg) return;
    setDraft("");
    if (view === "empty") {
      setView("conversation");
      setTaskTitle(msg.length > 42 ? msg.slice(0, 42) + "…" : msg);
      setThread([{ id: uid(), type: "user", text: msg }]);
      setPhases(INIT_PHASES);
      setAvail([]); setArtifactOpen(false);
      setTimeout(() => startPhase("analyze"), 280);
    } else {
      append({ type: "user", text: msg });
      // a mid-conversation message nudges the current phase to re-run
      const target = current || "analyze";
      setTimeout(() => startPhase(target), 240);
    }
  }

  /* ---------- gate handlers ---------- */
  function onGatePrimary(entry) {
    const g = entry.gateKey;
    if (g === "analyze") { resolveGate(entry.id, "Continued to Spec"); markDone("analyze"); startPhase("spec"); }
    else if (g === "spec") { resolveGate(entry.id, "Continued to Implement"); markDone("spec"); startPhase("implement"); }
    else if (g === "implement_clean") { resolveGate(entry.id, "Implemented — running tests"); markDone("implement"); startPhase("test"); }
    else if (g === "import") {
      resolveGate(entry.id, "Imported into Dify · staging");
      markDone("test"); setAvail(a => uniq([...a, "report"]));
      append({ type: "gate", gateKey: "done" });
    }
  }

  function markDone(key) { setPhases(s => ({ ...s, [key]: "done" })); }

  function onGateAction(entry, action) {
    const g = entry.gateKey;
    if (g === "implement_failing") {
      if (action === "accept") { resolveGate(entry.id, "Accepted with 1 warning"); markDone("implement"); startPhase("test"); }
      else if (action === "retry") { resolveGate(entry.id, "Re-running implement"); setScenario("clean"); startPhase("implement", { forceClean: true }); }
      else if (action === "abandon") { resolveGate(entry.id, "Abandoned — spec preserved"); setPhases(s => ({ ...s, implement: "pending" })); }
    } else if (g === "error" && action === "retry-phase") {
      resolveGate(entry.id, "Retrying Implement");
      setForceError(false);
      startPhase("implement", { clearError: true });
    } else if (g === "import" && action === "skip-import") {
      resolveGate(entry.id, "Skipped import — changes stay local");
      markDone("test"); setAvail(a => uniq([...a, "report"]));
    }
  }

  function onRequestChanges(entry, text) {
    resolveGate(entry.id, "Requested changes");
    append({ type: "user", text: text || "Please revise this." });
    const phase = entry.gateKey === "analyze" ? "analyze" : entry.gateKey === "spec" ? "spec" : "implement";
    setPhases(s => ({ ...s, [phase]: "pending" }));
    setTimeout(() => startPhase(phase), 240);
  }

  function openArtifact(tab) { setAvail(a => uniq([...a, tab])); setArtifactTab(tab); setArtifactOpen(true); setSb(true); }

  function openTask(task) {
    setActiveTask(task.id);
    setTaskTitle(task.name);
    if (task.id === "t-jp") return; // keep current demo conversation
    reset(true);
  }

  function reset(toEmpty) {
    clearTimeout(timer.current);
    setThread([]); setPhases(INIT_PHASES); setCurrent(null);
    setArtifactOpen(false); setAvail([]); setDraft("");
    setView(toEmpty ? "empty" : "empty");
  }

  function handleCreateProject({ name, folders }) {
    const pid = "p" + Date.now();
    const wfs = folders.map((f, i) => ({ id: pid + "w" + i, name: f.name, open: false, tasks: [] }));
    const proj = { id: pid, name, open: true, workflows: wfs };
    setTree(t => [proj, ...t]);
    setCreateOpen(false);
    setActiveTask(null);
    setCrumb({ project: name, workflow: folders[0] ? folders[0].name : null });
    reset(true);
  }

  const busy = current && phaseStates[current] === "running";

  /* ---------- confirm helper (common dialog) ---------- */
  function askConfirm(opts, onOk) {
    setConfirmState({ ...opts, onOk });
  }
  function closeConfirm() { setConfirmState(null); }
  // run an action, but if a turn is in flight, confirm interrupting it first
  function guard(action, label) {
    if (busy) {
      const t = taskTitle.length > 46 ? taskTitle.slice(0, 46) + "…" : taskTitle;
      askConfirm({
        title: "Stop the running turn?",
        message: <>Leaving <q>{t}</q> now will stop its running turn. Unsaved progress in this phase is discarded.</>,
        okLabel: label || "Stop & leave",
        danger: true,
      }, () => { stopRun(true); action(); closeConfirm(); });
    } else {
      action();
    }
  }

  /* ---------- stop a running turn ---------- */
  function stopRun(silent) {
    clearTimeout(timer.current);
    setThread(t => t.map(it => (it.type === "run" && it.running) ? { ...it, running: false, stopped: true } : it));
    if (current) setPhases(s => ({ ...s, [current]: "pending" }));
    if (!silent) append({ type: "note", text: "Turn stopped. Reply to continue, or pick another task." });
  }
  function requestStop() {
    const t = taskTitle.length > 46 ? taskTitle.slice(0, 46) + "…" : taskTitle;
    askConfirm({
      title: "Stop this turn?",
      message: <>Cancel <q>{t}</q>? Its running turn will be stopped.</>,
      okLabel: "Stop turn",
      danger: true,
    }, () => { stopRun(false); closeConfirm(); });
  }
  // lets the user preview the common confirm dialog on demand (from Scenarios)
  function previewConfirm() {
    askConfirm({
      title: "Stop this turn?",
      message: <>Cancel <q>Add a Japanese grammar-check step…</q>? Its running turn will be stopped.</>,
      okLabel: "Stop turn",
      danger: true,
    }, closeConfirm);
  }

  /* ---------- render ---------- */
  return (
    <div className={"app" + (sbCollapsed ? " sb-collapsed" : "")}>
      <Sidebar collapsed={sbCollapsed} activeTask={activeTask} tree={tree}
        onOpen={(task) => guard(() => openTask(task))}
        onNewTask={() => guard(() => { setActiveTask(null); reset(true); })}
        onNewProject={() => guard(() => setCreateOpen(true))}
        onToggle={() => setSb(c => !c)} />

      <div className={"main" + (artifactOpen ? " has-artifact" : "")}>
        <div className="chat">
          <div className="chat-top">
            <button className="icon-btn sb-toggle" onClick={() => setSb(c => !c)} title="Toggle sidebar">
              <I.sidebar />
            </button>
            {view === "conversation"
              ? <PhaseTrack phaseStates={phaseStates} current={current} />
              : <span style={{ fontSize: 13, color: "var(--tx-muted)" }}>New task</span>}
            <div className="chat-top-right">
              <button className="ghost-pill" onClick={toggleTheme}
                title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
                aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}>
                {theme === "light" ? <I.sun /> : <I.moon />}
              </button>
              {busy && (
                <button className="ghost-pill stop-pill" onClick={requestStop} title="Stop the running turn">
                  <span className="stop-sq" />Stop
                </button>
              )}
              {view === "conversation" && artifactAvail.length > 0 && !artifactOpen && (
                <button className="ghost-pill" onClick={() => { setArtifactOpen(true); setSb(true); }}>
                  <I.panel />Artifact
                </button>
              )}
            </div>
          </div>

          {view === "empty" ? (
            <EmptyState draft={draft} setDraft={setDraft} send={send} settings={settings} crumb={crumb} />
          ) : (
            <>
              <div className="thread" ref={threadRef}>
                <div className="thread-inner">
                  {thread.map(item => {
                    if (item.type === "user")
                      return <div key={item.id} className="msg msg-user"><div className="bubble-user">{item.text}</div></div>;
                    if (item.type === "run")
                      return <div key={item.id} className="msg msg-assistant">
                        <Disclosure phaseKey={item.phase} running={item.running} stopped={item.stopped} openDefault={item.running} />
                      </div>;
                    if (item.type === "note")
                      return <div key={item.id} className="msg msg-assistant">
                        <div className="thread-note"><I.alert />{item.text}</div>
                      </div>;
                    if (item.type === "gate")
                      return <div key={item.id} className="msg msg-assistant">
                        <GateCard gate={GATES[item.gateKey]} busy={busy} resolved={item.resolved}
                          onPrimary={() => onGatePrimary(item)}
                          onAction={(a) => onGateAction(item, a)}
                          onRequestChanges={(t) => onRequestChanges(item, t)}
                          onOpenArtifact={openArtifact} />
                      </div>;
                    return null;
                  })}
                </div>
              </div>

              <div className="composer-dock">
                <div className="composer-wrap">
                  <Composer slim value={draft} onChange={setDraft} onSend={() => send()}
                    settings={settings} placeholder="Reply, or describe another change…" />
                </div>
              </div>
            </>
          )}
        </div>

        {artifactOpen && (
          <ArtifactPanel tab={artifactTab} setTab={setArtifactTab}
            scenario={scenario} deploy={settings.deploy} available={artifactAvail}
            onClose={() => { setArtifactOpen(false); setSb(false); }} />
        )}
      </div>

      <ProtoSwitcher
        open={protoOpen} setOpen={setProtoOpen}
        scenario={scenario} setScenario={setScenario}
        deploy={settings.deploy} setDeploy={(d) => setSettings(s => ({ ...s, deploy: d }))}
        confirm={settings.confirm} setConfirm={(c) => setSettings(s => ({ ...s, confirm: c }))}
        forceError={forceError} setForceError={setForceError}
        onPreviewConfirm={previewConfirm}
        onReset={() => guard(() => { reset(true); setActiveTask("t-jp"); setTaskTitle("Add JP grammar step"); })}
      />

      {createOpen && (
        <CreateProjectModal
          onClose={() => setCreateOpen(false)}
          onCreate={handleCreateProject} />
      )}

      {confirmState && (
        <ConfirmModal
          title={confirmState.title}
          message={confirmState.message}
          okLabel={confirmState.okLabel}
          cancelLabel={confirmState.cancelLabel}
          danger={confirmState.danger}
          onOk={confirmState.onOk}
          onCancel={closeConfirm} />
      )}
    </div>
  );
}

/* ---------- empty / new-task surface ---------- */
function EmptyState({ draft, setDraft, send, settings, crumb }) {
  return (
    <div className="empty">
      <div className="empty-wrap">
        <button className="empty-crumb">
          <I.folder className="crumb-ic" />
          <span>{crumb.project}</span>
          {crumb.workflow && <>
            <span style={{ color: "var(--tx-faint)" }}>/</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}>{crumb.workflow}</span>
          </>}
          <span className="tw-twist"><I.chevDown /></span>
        </button>

        <Composer value={draft} onChange={setDraft} onSend={() => send()}
          settings={settings} placeholder="Describe the workflow or change…" />

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
function Seg({ value, set, options }) {
  return (
    <div className="seg">
      {options.map(o => (
        <button key={o.v} className={value === o.v ? "on" : ""} onClick={() => set(o.v)}>{o.l}</button>
      ))}
    </div>
  );
}

function ProtoSwitcher({ open, setOpen, scenario, setScenario, deploy, setDeploy,
  confirm, setConfirm, forceError, setForceError, onPreviewConfirm, onReset }) {
  return (
    <div className="proto">
      {open && (
        <div className="proto-panel">
          <h4>Prototype scenarios</h4>
          <div className="proto-group">
            <label>Implement result</label>
            <Seg value={scenario} set={setScenario}
              options={[{ v: "clean", l: "Clean" }, { v: "failing", l: "Lint fails" }]} />
          </div>
          <div className="proto-group">
            <label>Deploy target (adds Import gate)</label>
            <Seg value={deploy} set={setDeploy}
              options={[{ v: "none", l: "none" }, { v: "staging", l: "staging" }]} />
          </div>
          <div className="proto-group">
            <label>Confirm mode</label>
            <Seg value={confirm} set={setConfirm}
              options={[{ v: "each step", l: "Each step" }, { v: "end only", l: "End only" }]} />
          </div>
          <div className="proto-group">
            <label>Implement phase</label>
            <Seg value={forceError ? "err" : "ok"} set={(v) => setForceError(v === "err")}
              options={[{ v: "ok", l: "Succeeds" }, { v: "err", l: "Errors" }]} />
          </div>
          <button className="proto-reset" onClick={onPreviewConfirm} style={{ marginBottom: 8 }}>⚠ Preview confirm dialog</button>
          <button className="proto-reset" onClick={onReset}>↻ Reset to empty state</button>
        </div>
      )}
      <button className="proto-toggle" onClick={() => setOpen(o => !o)}>
        <span className="pt-dot" />Scenarios
      </button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
