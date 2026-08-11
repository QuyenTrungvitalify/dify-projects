# Phase ①+② (Fast build) — Merged Analyze + Spec for a single-LLM workflow

> 🌐 **LANGUAGE — obey before anything else.** Your ENTIRE reply, from the very first character, is
> written in **the chat language**: the language named by the directive at the very TOP of this prompt if
> one is there, otherwise the language of `{{REQUIREMENT}}`. Do **not** emit a single sentence in any
> other language — not even an orienting lead-in like "This is a from-scratch build…" or "Let me…". There
> is NO English preamble; token one is already in the chat language. Never write one language then
> translate. (Machine identifiers / slugs / YAML keys stay ASCII, and `SPEC.md`'s body follows the
> requirement even when the chat does not — see *Output language*.)

> Body of ONE bounded step (spec 028 fast mode). This turn REPLACES the separate Analyze and Spec
> turns for a **from-scratch, single-LLM** build: do the (trivial) from-scratch analysis AND author the
> target spec, then **STOP — do not begin Phase ③ (Implement).**
>
> You are here because the user chose **⚡ Fast build**, asserting the requirement is a simple
> single-LLM transform (`start → llm → end`, or `start → llm → answer` for an advanced-chat/chatbot).
> Read `.claude/skills/dify-build/SKILL.md` ground rules **once** (esp. **honest provenance**, **never invent plugin
> hashes**). Do **not** re-read them per artifact — this is the whole point of the merge.

## Inputs
- `{{REQUIREMENT}}` — the target behavior the user wants.
- `{{WORKFLOW_SLUG}}` — usually **empty** on this path (fast mode is forced off when a slug is supplied);
  if so you must **propose** one. `{{PROJECT}}` — the target project folder (`_drafts` by default, D5).
- `{{DEPLOY}}` — for context (does not change the spec itself).

There is **no seed** and **no `{{PRIOR_ARTIFACT}}`** on this path — this turn WRITES `analyze.json`
fresh; do not look for a prior analyze file.

## Output language
**Two layers. Do not collapse them — the person you are talking to and the client who receives the build are not always the same person.**

**① What you SAY (chat prose)** — every word of your reply from the very first sentence, including the lead-in, running commentary, and the questions you put to the user at the gate: **the chat language** — the language named by the directive at the TOP of this prompt if one is present, otherwise the language of `{{REQUIREMENT}}`. Do not open with a lead-in in another language ("This is a from-scratch build…", "I'll start by…"), and do not write one language then translate.

**② What you WRITE into `SPEC.md`** — the app **name**, Goal, Chosen shape/pattern rationale, node **purpose** descriptions, Open questions, and every string destined for the workflow itself: **the language of `{{REQUIREMENT}}`**, even when the chat language differs. `SPEC.md` is a handover document; translating it into the chat language hands the client the wrong artifact.

**When the two languages differ, end `SPEC.md` with a review appendix in the CHAT language** — the last section of the file:

```
## <"Summary & questions" in the chat language>
- Key decisions: <3–6 bullets>
- Questions for you: a NUMBERED list; each question ends with
  "→ Suggested: <the default you would take>" so the reader can answer with a number,
  or just say "go with your suggestions".
```

A reviewer who cannot read the spec body cannot review it, and the gate is where they decide. Everything above this section stays in the requirement's language. (The numbering + `→ Suggested:` shape is the general rule — see *Questions you put to the reviewer* below; this appendix is one place it lands, not the only one.)

**Keep these in English/ASCII exactly, regardless of either language** (localizing any of them breaks the build — the validators reject a translated identifier):
- `slug` values (`[a-z0-9_]`), node **id-placeholders**, and minted 13-digit ids;
- node `type` values (`start`, `llm`, `end`, `answer`, `if-else`, …) and all YAML keys;
- `{{#node.field#}}` variable references;
- plugin hashes / `dependencies` / `@sha256`;
- the `find.py --has` feature vocabulary and the `pattern` name in `analyze.json`.

`analyze.json` is machine-read: its `pattern`/`features` stay English (above); only its free-text `note`/`risks` may follow the requirement's language.

## Writing for the reader (chat prose) — spec 094 S5
The person reading your chat is a **user of the app, not a workflow engineer**. Three rules, in force for
every sentence you write **in chat**. They do NOT apply to what you write INTO `SPEC.md` / `analyze.json`
— that follows *Output language* above. This is about HOW you write, not WHICH language.

1. **Meaning first, coordinates second.** Never open a sentence with a node label. Say what the step DOES
   in everyday words, then put the label in parentheses if the reader may want to click it on the canvas:
   「送信元の合言葉を照合します（node `C1`）」 — not 「`C1` が `secret` を照合」.
2. **Machine names only when the reader must see or type them** (the affordance rule). KEEP: environment
   variables they will create in Dify, plugin names, sheet column names, Studio button labels. SPELL OUT
   in words: `string` / `array[string]`, `flatten_output`, `error_strategy`, `value_selector`,
   `END_EMPTY_IMMEDIATE`, node `type` values — and internal cross-references like "(lesson #1)", which
   mean nothing to someone not holding the document you are counting in.
3. **Give the flow as a plain-word arrow chain first**, details after. The node table belongs in
   `SPEC.md` and the artifact panel — do not re-narrate it node-by-node in chat.

> **BAD** — `C0` webhook takes `secret` / `row_keys` / `message_id`, all three declared `string`
> (lesson #1). `C1` compares `secret` against `gas_shared_secret`; on mismatch it returns an empty list
> and the run falls into the empty branch.
>
> **GOOD** — This branch runs the moment APP 1 calls in: it receives the request → checks the shared
> password → reads the rows already ticked as approved in Sheets → stops early if there are none. A wrong
> password ends the workflow quietly, writing nothing to Sheets (node `C1`). The row list is accepted as
> one id, several ids separated by commas, or a list — so APP 1 needs no changes.

## Questions you put to the reviewer — spec 094 S4
**Whenever you ask the reviewer anything — in chat AND under `Open questions` — use a NUMBERED list, and
end each item with `→ Suggested: <the default you would take>`** (write the marker word itself in the
chat language). One question stays one numbered item. This is unconditional: it holds when the chat and
requirement languages are the SAME, not only in the bilingual appendix above.

The reader must be able to answer with a number, or with "go with your suggestions", without composing
prose. Measured need: a real build's reviewer had to write 「他の質問はよく分からないので説明し直して」
twice before settling on 「他はおすすめ通りで」. A question with no stated default costs them a round trip.

This never becomes a blocker: you still choose the default, build on it, and record it.

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
- **Plugins** — the plugins this workflow needs (the `llm` node's model plugin; any `tool` node's
  plugin). Name them; the hash is **resolved** from the public marketplace at Implement — it is
  version-keyed and workspace-independent, so a plugin nobody has installed is still buildable
  (§4.3 / spec 067). **Never invent** a `@sha256`; resolving one is not inventing.
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
