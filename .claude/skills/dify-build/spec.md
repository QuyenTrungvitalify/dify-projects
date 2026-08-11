# Phase ② — Spec the target workflow

> Body of ONE bounded step. Draft the target behavior + plan, write `SPEC.md`, then
> **STOP — do not begin Phase ③ (Implement).**

> 🌐 **LANGUAGE — obey before anything else.** Your ENTIRE reply, from the very first character, is
> written in **the chat language**: the language named by the directive at the very TOP of this prompt if
> one is there, otherwise the language of `{{REQUIREMENT}}`. Do **not** emit a single sentence in any
> other language — not even an orienting lead-in like "I'll start by re-reading…" or "Let me…". There is
> NO English preamble; token one is already in the chat language. Never write one language then
> translate. (Machine identifiers / slugs / YAML keys stay ASCII, and `SPEC.md`'s body follows the
> requirement even when the chat does not — see *Output language*.)

You are turning a requirement (and, if present, the Analyze summary) into a concrete build
plan. Read `.claude/skills/dify-build/SKILL.md` ground rules first.

## Inputs
- `{{REQUIREMENT}}` — the target behavior the user wants.
- `{{PRIOR_ARTIFACT}}` — path to `analyze.json` from Phase ① (re-read it; may be `seed: null`).
- `{{PROJECT}}` / `{{WORKFLOW_SLUG}}` — the project folder + workflow subfolder. `{{WORKFLOW_SLUG}}`
  may be **empty** (new-workflow path); if so you must **propose** it.
- `{{DEPLOY}}` — for context (does not change the spec itself).

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
every sentence you write **in chat**. They do NOT apply to what you write INTO `SPEC.md` / the YAML —
that follows *Output language* above. This is about HOW you write, not WHICH language.

1. **Meaning first, coordinates second.** Never open a sentence with a node label. Say what the step DOES
   in everyday words, then put the label in parentheses if the reader may want to click it on the canvas:
   「送信元の合言葉を照合します（node `C1`）」 — not 「`C1` が `secret` を照合」.
2. **Machine names only when the reader must see or type them** (the affordance rule). KEEP: environment
   variables they will create in Dify, plugin names, sheet column names, Studio button labels. SPELL OUT
   in words: `string` / `array[string]`, `flatten_output`, `error_strategy`, `value_selector`,
   `END_EMPTY_IMMEDIATE`, node `type` values — and internal cross-references like "(lesson #1)", which
   mean nothing to someone not holding the document you are counting in.
3. **Give the flow as a plain-word arrow chain first**, details after. The **Nodes** table belongs in
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

This never becomes a blocker: you still choose the default, build the spec on it, and record it (see
**NEVER end this turn without writing the file** below).

## Do
1. Re-read `{{PRIOR_ARTIFACT}}`.
2. **Pick the closest vetted pattern** with the real tool (do not guess):
   ```
   .venv/bin/python tools/dify_base/find.py --json --has <feature> [--has <feature> ...]
   .venv/bin/python tools/dify_base/find.py --list-features
   ```
   Priority order (AGENTS.md §3): `templates/patterns/` > `templates/library/` > `projects/*/workflows/` > `corpus/`.
3. Draft the **target spec**: intended behavior, chosen pattern, the nodes to add/modify/keep
   (with roles), the variable-flow you intend (`{{#id.field#}}` chains), and the plugins
   needed. **A needed plugin is never a reason to avoid a node.** Plugin hashes are **public and
   version-keyed** — resolved from the marketplace at Implement, whether or not the workspace has the
   plugin installed (§4.3 / spec 067). So if the requirement is best served by a Dify `tool` node, spec
   the `tool` node; do NOT downgrade it to `http-request` to dodge a `dependencies:` entry. Never
   invent a `@sha256`; resolving one is not inventing.

   **Check the tool catalog before you model an integration by hand.** `templates/tool-catalog.json`
   lists curated, version-pinned Dify tools with their real identifiers — Google Sheets, Slack, Google
   Search, GitHub, Notion, Markdown export. If one covers the requirement, name it in `## Plugins`
   (`provider_name` + `tool_name`) and spec a `type: tool` node. `.venv/bin/python
   tools/dify_base/marketplace.py resolve <org>/<name>` resolves anything not in the catalog — no
   login, no install needed.
   *This rule exists because of a measured failure:* three consecutive real builds modelled 「Slackに
   通知」 as an `http-request` to a webhook the user had to create by hand — while `langgenius/slack`
   sat in the marketplace with 14k installs. The reason recorded in one build's own SPEC was
   「プラグインハッシュ依存が増えないため」 (to avoid adding a plugin-hash dependency). That is no longer
   a cost worth avoiding: the hash is free to resolve, and the tool spares the user the setup.

   **Error branches (`error_strategy: fail-branch`) — do NOT search for the syntax (spec 085):** when
   the requirement calls for fail-soft / an error branch on `code` or `http-request` nodes, **Read**
   `.claude/skills/dify-build/references/error-strategy.yml` — a lint-clean worked example of both
   node kinds with the `success-branch`/`fail-branch` edges — and spec that shape. `grep`-ing for
   `fail-branch`/`error_strategy` is sandbox-denied, and `find.py` has no such feature: a real build
   burned 11 denied calls in THIS phase hunting exactly this before the pointer existed here
   (implement.md has carried it since 085 S1c; spec 091 F6 measured the gap).
4. **Trigger-surface rule (spec 056).** Every **required** Start variable must be something the runtime
   operator physically has. Anything derivable in-flow is derived by nodes — or made `required: false`
   with a documented default: a requirement that names a file format gets a `type: file-list` (or `file`)
   Start variable with `allowed_file_types` / `allowed_file_extensions` / `max_length` set, feeding a
   `document-extractor` front-end (with `is_array_file: true` its output is `array[string]` — unwrap the
   first element defensively in the parse code node); parsed/derived values (JSON arrays, maps, column
   names/positions, counts) live in code nodes, with fixed column positions documented in the Start
   `hint:`; a run date is an optional input with a timezone-pinned in-code fallback, or required when the
   caller is a machine (per-row-notify GOTCHA). State the Start variables and their variable types in the
   start row's *purpose* cell of the **Nodes** table; in **Open questions**, flag any required input you
   could not eliminate and why.
   - a self-running requirement (定期/毎日/webhook) gets a trigger entry instead of `start`: state
     `timezone: Asia/Tokyo` explicitly on schedule triggers (the Dify default is UTC — a 9AM JST reminder
     silently becomes 18:00), at most ONE **schedule** trigger per workflow (this cap is schedule-only —
     a webhook trigger and a schedule trigger CAN coexist in one workflow, each fires from its own root
     node; verified against vendor/dify-src), the data source must be
     machine-fetchable (http-request / tool / dataset — no required user-file inputs can coexist with a
     trigger entry), and delivery is a side-effect (notify/write) since no one watches the output.
5. **If `{{WORKFLOW_SLUG}}` is empty, propose a `slug` + human `name`** (slug = lowercase, `[a-z0-9_]` — the backend's deriveSlugName never emits hyphens,
   from the app's purpose). The backend scaffolds `projects/{{PROJECT}}/<slug>/` on the gate confirm — do
   **not** run `init_project.py` yourself.
6. Prefer a **single-file branched** design (if-else + variable-aggregator) over multiple
   parallel YAMLs for "phase-1 demo + phase-2 pending" shapes (AGENTS.md §9).
7. Draft **Acceptance Criteria** (spec 032 §3 / D6) — **3–7** one-line, *checkable* statements of "done
   right", derived ONLY from (a) what `{{REQUIREMENT}}` **explicitly** asks for, and (b) the structural
   correctness of the chosen shape (right nodes in order, variable flow, one-in→one-out). Phrase each as a
   testable assertion (format / length / must-mention-X / output-shape / must-not-do-Y), not a feeling.
   **Do NOT invent constraints the requirement never states** — no output-language, tone, persona, or
   length criterion unless the requirement explicitly asks for it. (The requirement's language governs
   YOUR SPEC prose per *Output language* above; it does NOT dictate the workflow's runtime output
   language — so never add "replies in <language>" unless the user asked for that language.)

## Output (authoritative artifact)
Write `SPEC.md` to exactly this path (repo-root-relative; your cwd IS the repo root):

    {{SPEC_PATH}}

That is the one path the backend verifies — no other location counts, and the file is REQUIRED
even if the target folder does not exist yet (create parent folders as needed; Write does this).
Do not re-derive the path from `{{WORKFLOW_SLUG}}` or from what you see on disk — the backend has
already resolved it. (Spec 090: the old two-branch rule here rendered as "if `<slug>` is empty",
which two independent builds resolved by looking at the DISK — the folder didn't exist yet, so
they wrote to `.runs/` and died on `artifact missing`.)

**NEVER end this turn without writing the file.** Autonomous modes (`auto`/`spec_only`) auto-confirm
this gate, so nobody will answer a question you ask here — a turn that stops to ask produces NO
`SPEC.md`, and the build dies with `artifact missing` (observed: run 1784375623443, where a
high-ambiguity requirement — unknown Excel columns, unknown match key — led this phase to write a
question into the chat instead of the file, believing it had written one). When the requirement leaves
something genuinely undecided: **choose a reasonable default, build the spec on it, and record it under
`Open questions`** — exactly what `analyze.md` does at ①. The gate exists so a human can *correct* your
assumption at the ② review; it does not exist to block on an answer. (In `each_step`, a human IS there —
you may still ask, but only AFTER the file is written.)

Structure (emit ALL of these sections, in order): `# <name>` · **Goal** · **Chosen pattern** (+ why) ·
**Nodes** (table: id-placeholder, type, purpose) · **Variable flow** · **Plugins** (+ `# TODO: hash`) ·
**`## Acceptance Criteria`** · **Open questions**. If you proposed a slug/name, state them at the top
under **Proposed slug / name**.

**`## Acceptance Criteria` is REQUIRED — never omit it.** Use that EXACT `##` heading (the backend parses
it) followed by a markdown list, ONE criterion per `-`/`*`/`1.` line, e.g.:
```
## Acceptance Criteria
- Output is in Japanese
- At most 3 bullet points
- Mentions the source document's title
```
Criteria prose follows the requirement's language (Output language above); the `## Acceptance Criteria`
heading itself stays ASCII.

## Stop
Present the spec + (if any) the proposed slug/name, then STOP. Do not scaffold, mint IDs, or
write any workflow YAML. (A human may edit `SPEC.md` at the gate; Implement re-reads it fresh.)
