/* ============================================================
   artifact.jsx — right slide-in panel: Spec / YAML+lint / Diff / Report
   ============================================================ */
const { useState: useStateA } = React;

function SpecTab({ scenario }) {
  const [val, setVal] = useStateA(SPEC_MD);
  const [saved, setSaved] = useStateA(true);
  return (
    <div>
      <div className="art-section-title">SPEC.md <span className="ast-line" /></div>
      <textarea className="spec-edit" value={val} spellCheck={false}
        onChange={(e) => { setVal(e.target.value); setSaved(false); }} />
      <div className="spec-bar">
        <button className="btn primary" disabled={saved}
          onClick={() => setSaved(true)} style={saved ? { opacity: 0.5 } : null}>
          <I.save />Save spec
        </button>
        <span className="sb-status">
          {saved
            ? <><I.check style={{ width: 13, height: 13, color: "var(--ok)" }} />Saved · feeds Implement</>
            : <><span className="dirty-dot" />Unsaved changes</>}
        </span>
      </div>
      <div className="secret-note"><I.lock />API token redacted · never shown</div>
    </div>
  );
}

function YamlTab({ scenario }) {
  const linters = scenario === "failing" ? LINTERS_FAIL : LINTERS;
  return (
    <div>
      <div className="art-section-title">main.yml <span className="ast-line" /></div>
      <div className="codeblock">
        <div className="cb-head"><I.yaml style={{ width: 13, height: 13 }} />
          <span className="cb-name">stem_proofread/main.yml</span>
          <span className="cb-lang">yaml · 142 lines</span>
        </div>
        <pre>{YAML_LINES.map(row => (
          <div key={row.n}>
            <span className="ln">{row.n}</span>
            {row.t.map((seg, i) => {
              const cls = seg[0] === "k" ? "tok-key" : seg[0] === "s" ? "tok-str" : "tok-com";
              return <span key={i} className={cls}>{seg[1]}</span>;
            })}
          </div>
        ))}</pre>
      </div>

      <div className="art-section-title" style={{ marginTop: 20 }}>
        Lint results <span className="ast-line" />
      </div>
      <div className="lint-list">
        {linters.map(l => (
          <div key={l.name} className={"lint-row " + (l.pass ? "pass" : "fail")}>
            <span className="lr-ic">{l.pass ? <I.checkCircle /> : <I.warn />}</span>
            <span className="lr-name">{l.name}</span>
            <span className="lr-msg">{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiffTab() {
  return (
    <div>
      <div className="art-section-title">Split diff <span className="ast-line" /></div>
      <div className="diff">
        <div className="diff-head">
          <I.diff style={{ width: 13, height: 13 }} />
          <span className="dh-name">main.yml</span>
          <span className="dh-stat">
            <span className="dstat-add">+5</span>
            <span className="dstat-del">−1</span>
          </span>
        </div>
        <div className="diff-cols">
          <div className="diff-col left">
            <div className="diff-col-head">seed · pattern/llm_judge.yml</div>
            {DIFF.map((row, i) => (
              <div key={i} className={"diff-line " + (row.l ? row.l.k : "empty")}>
                <span className="dl-gut">{row.l ? row.l.n : ""}</span>
                <span className="dl-txt">{row.l ? row.l.txt : ""}</span>
              </div>
            ))}
          </div>
          <div className="diff-col right">
            <div className="diff-col-head">new · main.yml</div>
            {DIFF.map((row, i) => (
              <div key={i} className={"diff-line " + (row.r ? row.r.k : "empty")}>
                <span className="dl-gut">{row.r ? row.r.n : ""}</span>
                <span className="dl-txt">{row.r ? row.r.txt : ""}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportTab({ deploy }) {
  const rows = REPORT.map(r => {
    if (r.k === "Deploy") return { ...r, v: deploy === "none" ? "not deployed (local)" : deploy };
    if (r.k === "Rollback" && deploy === "none") return null;
    return r;
  }).filter(Boolean);
  return (
    <div>
      <div className="art-section-title">Run report <span className="ast-line" /></div>
      <div>
        {rows.map(r => (
          <div key={r.k} className="report-row">
            <span className="rr-key">{r.k}</span>
            <span className={"rr-val" + (r.ok ? " ok" : "")}>{r.v}</span>
          </div>
        ))}
      </div>
      {deploy !== "none" ? (
        <div className="app-url-card">
          <div className="au-meta">
            <div className="au-label">DEPLOYED · staging</div>
            <a className="au-link" href="#" onClick={(e) => e.preventDefault()}>
              dify.local/app/stem_proofread
            </a>
          </div>
          <button className="btn ghost au-go"><I.external />Open</button>
        </div>
      ) : (
        <div className="secret-note" style={{ marginTop: 14 }}>
          <I.lock />Deploy is off — no app URL. Set Deploy ≠ none to import &amp; get a link.
        </div>
      )}
    </div>
  );
}

function ArtifactPanel({ tab, setTab, scenario, deploy, available, onClose }) {
  const lintDot = scenario === "failing" ? "warn" : "ok";
  const tabs = [
    { key: "spec",   label: "Spec",   icon: <I.doc /> },
    { key: "yaml",   label: "main.yml", icon: <I.yaml />, dot: lintDot },
    { key: "diff",   label: "Diff",   icon: <I.diff /> },
    { key: "report", label: "Report", icon: <I.report /> },
  ].filter(t => available.includes(t.key));

  return (
    <aside className="artifact">
      <div className="artifact-head">
        <I.panel style={{ width: 15, height: 15, color: "var(--tx-muted)" }} />
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
          <span className="ah-title">Artifact</span>
          <span className="ah-sub">stem_proofread</span>
        </div>
        <button className="icon-btn artifact-close" style={{ marginLeft: "auto" }}
          onClick={onClose} title="Hide panel"><I.close /></button>
      </div>

      <div className="artifact-tabs">
        {tabs.map(t => (
          <button key={t.key}
            className={"atab" + (tab === t.key ? " active" : "")}
            onClick={() => setTab(t.key)}>
            {t.icon}{t.label}
            {t.dot && <span className={"tab-dot " + t.dot} />}
          </button>
        ))}
      </div>

      <div className="artifact-body">
        {tab === "spec"   && <SpecTab scenario={scenario} />}
        {tab === "yaml"   && <YamlTab scenario={scenario} />}
        {tab === "diff"   && <DiffTab />}
        {tab === "report" && <ReportTab deploy={deploy} />}
      </div>
    </aside>
  );
}

window.ArtifactPanel = ArtifactPanel;
