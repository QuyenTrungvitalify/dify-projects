/* ============================================================
   data.jsx — sample content for the Dify Workflow Builder prototype
   Domain: Eiken / stem_proofread (from brief)
   ============================================================ */

// ---- sidebar tree: Project ▸ Workflow ▸ Task ----
const TREE = [
  {
    id: "eiken", name: "Eiken", open: true,
    workflows: [
      {
        id: "stem_proofread", name: "stem_proofread", open: true,
        tasks: [
          { id: "t-build",  name: "Build initial pipeline", time: "16d" },
          { id: "t-jp",     name: "Add JP grammar step",    time: "16d", active: true },
          { id: "t-fix",    name: "Fix false positives",    time: "9d" },
        ],
      },
      {
        id: "rubric_score", name: "rubric_score", open: false,
        tasks: [
          { id: "t-rs1", name: "Build", time: "1mo" },
          { id: "t-rs2", name: "Tune weights", time: "23d" },
        ],
      },
    ],
  },
  {
    id: "toeic", name: "TOEIC", open: false,
    workflows: [
      { id: "part5_gen", name: "part5_gen", open: false,
        tasks: [{ id: "t-p5", name: "Build", time: "2mo" }] },
      { id: "listening_tag", name: "listening_tag", open: false,
        tasks: [{ id: "t-lt", name: "Add speaker diarize", time: "1mo" }] },
    ],
  },
  {
    id: "internal", name: "Internal tools", open: false,
    workflows: [
      { id: "pdf_extract", name: "pdf_extract", open: false,
        tasks: [{ id: "t-pdf", name: "Build", time: "3mo" }] },
    ],
  },
];

const SUGGESTIONS = [
  "Add a Japanese grammar-check step after the English proofread node",
  "The proofreader flags correct passive voice — tighten the rubric prompt",
  "Split the single LLM node into extract → judge → format",
];

// ---- phases ----
const PHASES = [
  { key: "analyze",   label: "Analyze" },
  { key: "spec",      label: "Spec" },
  { key: "implement", label: "Implement" },
  { key: "test",      label: "Test" },
];

// ---- per-phase run detail (disclosure lines) ----
const RUN_DETAIL = {
  analyze: {
    label: "Analyzing current workflow",
    lines: [
      "Loaded stem_proofread/main.yml · 6 nodes",
      "Mapped node graph: start → extract → proofread → format → end",
      "Located insertion point after proofread node",
      "Checked Dify schema compat for LLM node v0.9",
    ],
  },
  spec: {
    label: "Drafting spec",
    lines: [
      "Wrote acceptance criteria (4)",
      "Defined new node jp_grammar (LLM)",
      "Mapped input vars from proofread.output",
      "Noted seed pattern: pattern/llm_judge.yml",
    ],
  },
  implement: {
    label: "Implementing spec",
    lines: [
      "Generated jp_grammar node config",
      "Rewired edges proofread → jp_grammar → format",
      "Rendered main.yml (142 lines)",
      "Ran 3 linters",
    ],
  },
  test: {
    label: "Running test pass",
    lines: [
      "Dry-run on 12 seed stems",
      "Validated output schema",
      "Diffed against golden set",
      "Generated report",
    ],
  },
};

// ---- gate card content per phase ----
const GATES = {
  analyze: {
    badge: "Analyze complete",
    title: "Ready to write the spec",
    meta: "phase 1 / 4",
    summary: [
      "Insertion point confirmed: a new node sits after <c>proofread</c>, before <c>format</c>.",
      "The English proofreader stays untouched — JP grammar runs in parallel scope on the same stem text.",
      "One open question I'll resolve in spec: whether to fail-soft or hard on low-confidence grammar flags.",
    ],
    primary: "Continue to Spec",
    next: "spec",
  },
  spec: {
    badge: "Spec ready",
    title: "Spec drafted — review before I build",
    meta: "phase 2 / 4",
    summary: [
      "New LLM node <c>jp_grammar</c> reads <c>proofread.output</c>, emits <c>{flags[], severity}</c>.",
      "4 acceptance criteria, incl. \"no flag on correct keigo\".",
      "Full spec is editable in the panel — open it to tweak before implement.",
    ],
    showSpecLink: true,
    primary: "Continue to Implement",
    next: "implement",
  },
  implement_clean: {
    badge: "Implemented",
    title: "main.yml built and linted",
    meta: "phase 3 / 4",
    strip: { file: "main.yml", pass: "3 linters passed", diff: true },
    summary: [
      "Added <c>jp_grammar</c> node and rewired two edges.",
      "Schema, dead-node and var-binding linters all green.",
    ],
    primary: "Implement this spec",
    next: "test",
  },
  implement_failing: {
    tone: "warn",
    badge: "Lint still failing",
    title: "Still 1 lint error after 5 attempts",
    meta: "phase 3 / 4",
    strip: { file: "main.yml", fail: "var-binding: 1 error", diff: true },
    summary: [
      "<c>jp_grammar.inputs.text</c> binds to <c>proofread.output</c>, but that var is <c>object</c>, not <c>string</c>.",
      "I keep coercing it; Dify's validator rejects the implicit cast. Your call on how to proceed.",
    ],
    actions: [
      { label: "Accept anyway", cls: "warn", key: "accept" },
      { label: "Keep trying",  cls: "ghost", key: "retry" },
      { label: "Abandon",      cls: "ghost", key: "abandon" },
    ],
  },
  import: {
    tone: "danger",
    badge: "Touches live Dify",
    title: "Import into Dify?",
    meta: "deploy · staging",
    summary: [
      "This overwrites <c>stem_proofread</c> on the <c>staging</c> workspace via the Dify API.",
      "The current published version is backed up first; you can roll back from the report.",
    ],
    primary: "Import into Dify",
    danger: true,
    next: "done",
  },
  done: {
    tone: "done",
    badge: "Done",
    title: "Test passed — workflow updated",
    meta: "phase 4 / 4",
    summary: [
      "12/12 seed stems validated, 0 schema errors.",
      "Imported to <c>staging</c>. Open the report in the panel for the app URL and rollback point.",
    ],
    showReportLink: true,
  },
  error: {
    tone: "error",
    badge: "Phase failed",
    title: "Implement phase errored",
    meta: "exit 1",
    summary: [
      "Renderer crashed: <c>yaml: mapping values not allowed in this context</c> at line 88.",
      "No files were written. Retry re-runs only the Implement phase from the approved spec.",
    ],
    error: true,
    retryPhase: "implement",
  },
};

// ---- artifact content ----
const SPEC_MD = `# Spec — Add JP grammar step
workflow: stem_proofread
seed:     pattern/llm_judge.yml

## Goal
Run a Japanese grammar check on each stem
*after* the English proofread node, without
altering the proofreader's behaviour.

## New node — jp_grammar  (type: LLM)
inputs:
  text:  {{ proofread.output.stem }}
  level: {{ start.exam_level }}
output:
  flags:    array<{rule, span, severity}>
  severity: enum[none, minor, major]

## Acceptance criteria
1. No flag raised on grammatically correct keigo.
2. Major flags block downstream format node.
3. Latency budget: < 1.8s p95 per stem.
4. Falls soft (severity=none) on model timeout.

## Edges
proofread -> jp_grammar -> format`;

const YAML_LINES = [
  { n: 84, t: [["k","  jp_grammar:"]] },
  { n: 85, t: [["k","    type:"], ["s"," llm"]] },
  { n: 86, t: [["k","    model:"], ["s"," gpt-4o-mini"]] },
  { n: 87, t: [["k","    prompt:"], ["s"," prompts/jp_grammar.j2"]] },
  { n: 88, t: [["k","    inputs:"]] },
  { n: 89, t: [["k","      text:"], ["s"," \"{{ proofread.output.stem }}\""]] },
  { n: 90, t: [["k","      level:"], ["s"," \"{{ start.exam_level }}\""]] },
  { n: 91, t: [["k","    outputs:"], ["c"," # flags[], severity"]] },
];

const LINTERS = [
  { name: "schema-validate",   pass: true,  msg: "ok" },
  { name: "dead-node-check",   pass: true,  msg: "0 orphans" },
  { name: "var-binding",       pass: true,  msg: "8 bound" },
];
const LINTERS_FAIL = [
  { name: "schema-validate",   pass: true,  msg: "ok" },
  { name: "dead-node-check",   pass: true,  msg: "0 orphans" },
  { name: "var-binding",       pass: false, msg: "type mismatch · L89" },
];

// left = seed/pattern, right = new
const DIFF = [
  { l: { n: 80, txt: "  proofread:", k: "" },        r: { n: 80, txt: "  proofread:", k: "" } },
  { l: { n: 81, txt: "    type: llm", k: "" },        r: { n: 81, txt: "    type: llm", k: "" } },
  { l: { n: 82, txt: "    next: format", k: "del" },  r: { n: 82, txt: "    next: jp_grammar", k: "add" } },
  { l: null,                                          r: { n: 83, txt: "  jp_grammar:", k: "add" } },
  { l: null,                                          r: { n: 84, txt: "    type: llm", k: "add" } },
  { l: null,                                          r: { n: 85, txt: "    next: format", k: "add" } },
  { l: { n: 83, txt: "  format:", k: "" },            r: { n: 86, txt: "  format:", k: "" } },
];

const REPORT = [
  { k: "Workflow",   v: "stem_proofread", ok: false },
  { k: "Nodes",      v: "6 → 7 (+jp_grammar)", ok: false },
  { k: "Tests",      v: "12 / 12 passed", ok: true },
  { k: "Lint",       v: "3 / 3 passed", ok: true },
  { k: "Deploy",     v: "staging", ok: false },
  { k: "Rollback",   v: "v0.9.3 (backed up)", ok: false },
];

Object.assign(window, {
  TREE, SUGGESTIONS, PHASES, RUN_DETAIL, GATES,
  SPEC_MD, YAML_LINES, LINTERS, LINTERS_FAIL, DIFF, REPORT,
});
