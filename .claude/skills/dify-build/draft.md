# Phase ①+② (Fast build) — Merged Analyze + Spec for a single-LLM workflow

> 🌐 **LANGUAGE — obey before anything else.** Your ENTIRE reply, from the very first character, is
> written in the language of `{{REQUIREMENT}}`. If it is Japanese, do **not** emit a single English
> sentence — not even an orienting lead-in like "This is a from-scratch build…" or "Let me…". There is NO
> English preamble; token one is already in the requirement's language. Never write English then
> translate. (Machine identifiers / slugs / YAML keys stay ASCII — see *Output language*.)

> Body of ONE bounded step (spec 028 fast mode). This turn REPLACES the separate Analyze and Spec
> turns for a **from-scratch, single-LLM** build: do the (trivial) from-scratch analysis AND author the
> target spec, then **STOP — do not begin Phase ③ (Implement).**
>
> You are here because the user chose **⚡ Fast build**, asserting the requirement is a simple
> single-LLM transform (`start → llm → end`, or `start → llm → answer` for an advanced-chat/chatbot).
> Read [SKILL.md](SKILL.md) ground rules **once** (esp. **honest provenance**, **never invent plugin
> hashes**). Do **not** re-read them per artifact — this is the whole point of the merge.

## Inputs
- `{{REQUIREMENT}}` — the target behavior the user wants.
- `{{WORKFLOW_SLUG}}` — usually **empty** on this path (fast mode is forced off when a slug is supplied);
  if so you must **propose** one. `{{PROJECT}}` — the target project folder (`_drafts` by default, D5).
- `{{DEPLOY}}` — for context (does not change the spec itself).

There is **no seed** and **no `{{PRIOR_ARTIFACT}}`** on this path — this turn WRITES `analyze.json`
fresh; do not look for a prior analyze file.

## Output language
Write all **human-facing prose** in the **same language as the requirement** (`{{REQUIREMENT}}`). This means **every word you write in chat — starting from your very first sentence** (do **not** open with an English lead-in such as "This is a from-scratch build…" / "I'll start by…" or any running commentary in English), and in `SPEC.md` the app **name**, Goal, Chosen shape/pattern rationale, node **purpose** descriptions, and Open questions. If the requirement is Japanese, the **entire** turn is Japanese from the first token; if English, write English. Do not narrate in English and translate afterward.

**Keep these in English/ASCII exactly, regardless of the requirement's language** (localizing any of them breaks the build — the validators reject a translated identifier):
- `slug` values (`[a-z0-9_]`), node **id-placeholders**, and minted 13-digit ids;
- node `type` values (`start`, `llm`, `end`, `answer`, `if-else`, …) and all YAML keys;
- `{{#node.field#}}` variable references;
- plugin hashes / `dependencies` / `@sha256`;
- the `find.py --has` feature vocabulary and the `pattern` name in `analyze.json`.

`analyze.json` is machine-read: its `pattern`/`features` stay English (above); only its free-text `note`/`risks` may follow the requirement's language.

## Do — write TWO artifacts, then stop

### 1. `analyze.json` (honest, from-scratch) → `.runs/{{TASK_ID}}/analyze.json`
No seed was classified, so record only what is true. **`features` is MANDATORY on this path** (unlike
`analyze.md`, where it is optional) — the backend's fast-mode safety check reads it.

```json
{ "seed": null,
  "pattern": "custom",
  "features": ["llm"],
  "note": "from-scratch single-LLM build (fast mode); no seed to analyze" }
```

- **MUST** set `"seed": null` and `"pattern": "custom"` (no seed classification ran).
- **MUST** write `"features"` as a **non-empty** array using the find.py vocabulary VERBATIM
  (`iteration, loop, code, llm, http-request, tool, if-else, document-extractor,
  knowledge-retrieval, agent, file-input, template-transform, parameter-extractor, trigger`):
  - a **pure single-LLM** transform → `"features": ["llm"]` (exactly).
  - **If the requirement is NOT actually a pure single-LLM transform** (it needs a tool call, HTTP,
    iteration/loop, branching/if-else, file input, code, retrieval, an agent, etc.) → write the **real**
    needed set (e.g. `["llm","iteration"]`), and **flag it in the SPEC.md Open questions** rather than
    forcing a `start → llm → end`. Be honest: the user may have mis-picked fast mode, and the backend
    will pause the build for human review when `features ⊄ {llm}`. A requirement that names a file
    format (Excel / CSV / PDF / 画像 …) is NEVER a pure single-LLM transform: its input surface is
    `file-input` (plus `document-extractor` for parsing) — write those features honestly so the backend
    pauses fast mode; do NOT re-shape a file artifact into a pasted-text Start input to stay eligible.
    A requirement with a self-running cadence or webhook (毎日・定期・自動で・webhook) is NEVER a pure
    single-LLM transform either: its entry is a `trigger` node — write the `trigger` feature honestly so
    fast mode pauses.
- **MUST OMIT `find_query`** (no `find.py` query was run — recording one is invented provenance).
- **MUST NOT** invent `change_points` (there is no prior graph; the spec below owns the target graph).

### 2. `SPEC.md` (the target spec) → `.runs/{{TASK_ID}}/SPEC.md`
Author the spec **directly from the single-LLM shape** — do **NOT** run `find.py` and do **NOT** read
`templates/patterns/*` (that search is exactly the cost fast mode skips). Pick the shape from the
requirement:
- a one-shot transform/generation → `start → llm → end`.
- an interactive chat / assistant reply → `start → llm → answer` (advanced-chat).

Write `SPEC.md` with this structure:
- `# <name>` — a human-facing app name.
- **Proposed slug / name** — **if `{{WORKFLOW_SLUG}}` is empty, propose both** (slug = lowercase `[a-z0-9_]`,
  from the app's purpose). The backend scaffolds `projects/{{PROJECT}}/<slug>/` at the gate confirm; do
  **not** run `init_project.py` yourself.
- **Goal** — one or two lines restating `{{REQUIREMENT}}` as the target behavior.
- **Chosen shape** — `start → llm → end` (or `→ answer`), and one line on why it is single-LLM.
- **Nodes** — a table of `id-placeholder | type | purpose` (e.g. `start | start | collect input`,
  `llm | llm | the transform prompt`, `end | end | return the result`). Use **placeholders**, not real
  ids — Implement mints the 13-digit ids.
- **Variable flow** — the `{{#id.field#}}` chain (e.g. `{{#start.input#}} → llm.prompt`,
  `{{#llm.text#}} → end.output`).
- **Plugins** — the model plugin the `llm` node needs, left as `# TODO: add plugin hash from target
  workspace` (real hashes are added later from the target workspace — **never invent** a `@sha256`).
- **`## Acceptance Criteria`** (spec 032) — **REQUIRED, never omit.** Use that EXACT `##` heading (the
  backend parses it) + a markdown list, ONE *checkable* criterion per `-` line. Derive criteria ONLY from
  what `{{REQUIREMENT}}` explicitly asks + the shape's structural correctness (right nodes in order,
  variable flow, one-in→one-out). **Do NOT invent unstated constraints** — no output-language, tone, or
  length criterion unless the requirement asks for it (the requirement's language governs your SPEC prose,
  NOT the chatbot's reply language). The heading stays ASCII.
- **Open questions** — the model/plugin TODO, any ambiguity, and (if applicable) the honest note that
  the requirement looked non-trivial (see step 1).

## Stop
Present the proposed slug/name (if any) + a short prose summary of the spec, then **STOP**. Do **not**
mint IDs, write any workflow YAML, run `init_project.py`, or scaffold. (A human reviews `SPEC.md` at the
Spec gate; Implement re-reads it fresh.)
