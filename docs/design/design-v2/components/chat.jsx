/* ============================================================
   chat.jsx — phase indicator, messages, disclosure, gate cards, composers
   ============================================================ */
const { useState: useS, useRef, useEffect } = React;

/* render text with <c>mono</c> chips */
function richText(str) {
  const parts = String(str).split(/(<c>.*?<\/c>)/g);
  return parts.map((p, i) => {
    const m = p.match(/^<c>(.*?)<\/c>$/);
    if (m) return <span key={i} className="mchip">{m[1]}</span>;
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

/* ---- phase indicator ---- */
function PhaseTrack({ phaseStates, current }) {
  return (
    <div className="phase-track">
      {PHASES.map((ph, i) => {
        const st = phaseStates[ph.key];
        const cls = st === "done" ? "done"
          : st === "error" ? "error"
          : (ph.key === current && (st === "running" || st === "awaiting")) ? "active"
          : "";
        return (
          <React.Fragment key={ph.key}>
            <div className={"phase-step " + cls}>
              <span className="phase-num">
                {st === "done" ? <I.check style={{ width: 11, height: 11 }} /> : (i + 1)}
              </span>
              {ph.label}
            </div>
            {i < PHASES.length - 1 && <span className="phase-sep">·</span>}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ---- disclosure ("Running ① Analyze…" / "Worked for 2m") ---- */
function Disclosure({ phaseKey, running, stopped, openDefault }) {
  const [open, setOpen] = useS(!!openDefault);
  useEffect(() => { setOpen(running); }, [running]);
  const detail = RUN_DETAIL[phaseKey];
  const idx = PHASES.findIndex(p => p.key === phaseKey) + 1;
  const label = running
    ? <>Running <b style={{ color: "var(--tx-1)", fontWeight: 500 }}>{numCircle(idx)} {PHASES[idx-1].label}</b><span className="dots" /></>
    : stopped
    ? <>Stopped during <b style={{ color: "var(--tx-2)", fontWeight: 500 }}>{numCircle(idx)} {PHASES[idx-1].label}</b></>
    : <>{detail.label} · {numCircle(idx)} {PHASES[idx-1].label}</>;
  return (
    <div>
      <button className="disclosure" onClick={() => setOpen(o => !o)}>
        {running ? <span className="spin" />
          : stopped ? <I.alert style={{ width: 14, height: 14, color: "var(--tx-faint)" }} />
          : <I.checkCircle style={{ width: 14, height: 14, color: "var(--ok)" }} />}
        <span className="disc-label">{label}</span>
        <Twist open={open} />
      </button>
      {open && (
        <div className="disc-detail">
          {detail.lines.map((ln, i) => (
            <div key={i} className="dd-line"><I.check />{richText(ln)}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function numCircle(n) {
  return ["①","②","③","④"][n - 1] || n;
}

/* ---- gate card ---- */
function GateCard({ gate, onPrimary, onRequestChanges, onAction, onOpenArtifact, busy, resolved }) {
  const [replying, setReplying] = useS(false);
  const [reply, setReply] = useS("");
  const tone = gate.tone ? " tone-" + gate.tone : "";
  const badgeIcon = gate.error ? <I.alert /> : gate.tone === "warn" ? <I.warn />
    : gate.tone === "danger" ? <I.lock /> : gate.tone === "done" ? <I.checkCircle /> : <I.spark />;

  return (
    <div className={"gate" + tone}>
      <div className="gate-head">
        <span className="gate-badge">{badgeIcon}{gate.badge}</span>
        <span className="gate-title">{gate.title}</span>
        <span className="gate-meta">{gate.meta}</span>
      </div>

      <div className="gate-body">
        <ul className="gate-list">
          {gate.summary.map((s, i) => <li key={i}>{richText(s)}</li>)}
        </ul>
      </div>

      {gate.strip && (
        <div className="gate-strip">
          <span className="gs-file">{gate.strip.file}</span>
          <span className="gs-dot" />
          {gate.strip.pass && <span className="gs-pass"><I.checkCircle />{gate.strip.pass}</span>}
          {gate.strip.fail && <span className="gs-fail"><I.warn />{gate.strip.fail}</span>}
          {gate.strip.diff && (
            <button className="gs-link" onClick={() => onOpenArtifact("diff")}>
              <I.diff />view diff
            </button>
          )}
        </div>
      )}

      {(gate.showSpecLink || gate.showReportLink) && (
        <div className="gate-strip" style={{ background: "transparent", border: "none", paddingTop: 0 }}>
          {gate.showSpecLink && (
            <button className="gs-link" style={{ marginLeft: 0 }} onClick={() => onOpenArtifact("spec")}>
              <I.doc />open SPEC.md
            </button>
          )}
          {gate.showReportLink && (
            <button className="gs-link" style={{ marginLeft: 0 }} onClick={() => onOpenArtifact("report")}>
              <I.report />open report
            </button>
          )}
        </div>
      )}

      {replying ? (
        <div className="gate-reply">
          <textarea autoFocus placeholder="What should change before continuing?"
            value={reply} onChange={(e) => setReply(e.target.value)} />
          <div className="gr-actions">
            <button className="btn ghost" onClick={() => { setReplying(false); setReply(""); }}>Cancel</button>
            <button className="btn primary" onClick={() => { onRequestChanges(reply); setReplying(false); setReply(""); }}>
              <I.arrowUp style={{ width: 13, height: 13 }} />Send &amp; re-run
            </button>
          </div>
        </div>
      ) : resolved ? (
        <div className="gate-foot" style={{ background: "transparent" }}>
          <span className="secret-note" style={{ color: "var(--ok)", padding: 0 }}>
            <I.check style={{ width: 13, height: 13 }} />{resolved}
          </span>
        </div>
      ) : (
        <div className="gate-foot">
          {/* custom multi-action gates (still-failing) */}
          {gate.actions ? gate.actions.map(a => (
            <button key={a.key} className={"btn " + a.cls} disabled={busy}
              onClick={() => onAction(a.key)}>
              {a.key === "retry" && <I.retry />}{a.key === "accept" && <I.check />}{a.label}
            </button>
          )) : gate.error ? (
            <button className="btn danger" disabled={busy} onClick={() => onAction("retry-phase")}>
              <I.retry />Retry {gate.retryPhase} phase
            </button>
          ) : gate.primary ? (
            <>
              <button className={"btn " + (gate.danger ? "danger" : "ok")} disabled={busy}
                onClick={onPrimary}>
                {gate.danger ? <I.lock /> : <I.check />}{gate.primary}
              </button>
              {!gate.danger && (
                <button className="btn ghost" disabled={busy} onClick={() => setReplying(true)}>
                  <I.message />Request changes
                </button>
              )}
              {gate.danger && (
                <button className="btn ghost" disabled={busy} onClick={() => onAction("skip-import")}>
                  Skip import
                </button>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ---- composer (shared empty + dock) ---- */
function SettingChip({ icon, k, v, mono }) {
  return (
    <button className={"setting-chip" + (mono ? " mono" : "")}>
      {icon}<span className="sc-key">{k}:</span>
      <span className="sc-val">{v}</span>
      <Twist open={false} />
    </button>
  );
}

function Composer({ slim, value, onChange, onSend, settings, placeholder }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [value]);
  const ready = value.trim().length > 0;
  return (
    <div className={"composer" + (slim ? " slim" : "")}>
      <textarea ref={ref} className="composer-input" rows={1}
        placeholder={placeholder} value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ready && onSend(); } }} />
      <div className="composer-row">
        {!slim ? (
          <>
            <SettingChip k="Workflow" v={settings.workflow} mono />
            <SettingChip k="Confirm" v={settings.confirm} />
            <SettingChip k="Deploy" v={settings.deploy} />
            <span className="spacer" />
            <button className="composer-circle" title="Voice"><I.mic /></button>
            <button className={"composer-send" + (ready ? " ready" : "")} onClick={() => ready && onSend()}>
              <I.arrowUp />
            </button>
          </>
        ) : (
          <>
            <div className="mini-settings">
              <button className="mini-chip"><I.sliders style={{ width: 12, height: 12 }} />Workflow <span className="mc-val">{settings.workflow}</span></button>
              <button className="mini-chip">Confirm <span className="mc-val">{settings.confirm}</span></button>
              <button className="mini-chip">Deploy <span className="mc-val">{settings.deploy}</span></button>
            </div>
            <span className="spacer" />
            <button className="composer-circle" title="Voice"><I.mic /></button>
            <button className={"composer-send" + (ready ? " ready" : "")} onClick={() => ready && onSend()}>
              <I.arrowUp />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

window.Chat = { PhaseTrack, Disclosure, GateCard, Composer, SettingChip, richText, numCircle };
