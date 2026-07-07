# Phase ② — Spec the target workflow

> Body of ONE bounded step. Draft the target behavior + plan, write `SPEC.md`, then
> **STOP — do not begin Phase ③ (Implement).**

> 🌐 **LANGUAGE — obey before anything else.** Your ENTIRE reply, from the very first character, is
> written in the language of `{{REQUIREMENT}}`. If it is Japanese, do **not** emit a single English
> sentence — not even an orienting lead-in like "I'll start by re-reading…" or "Let me…". There is NO
> English preamble; token one is already in the requirement's language. Never write English then
> translate. (Machine identifiers / slugs / YAML keys stay ASCII — see *Output language*.)

You are turning a requirement (and, if present, the Analyze summary) into a concrete build
plan. Read [SKILL.md](SKILL.md) ground rules first.

## Inputs
- `{{REQUIREMENT}}` — the target behavior the user wants.
- `{{PRIOR_ARTIFACT}}` — path to `analyze.json` from Phase ① (re-read it; may be `seed: null`).
- `{{PROJECT}}` / `{{WORKFLOW_SLUG}}` — the project folder + workflow subfolder. `{{WORKFLOW_SLUG}}`
  may be **empty** (new-workflow path); if so you must **propose** it.
- `{{DEPLOY}}` — for context (does not change the spec itself).

## Output language
Write all **human-facing prose** in the **same language as the requirement** (`{{REQUIREMENT}}`). This means **every word you write in chat — starting from your very first sentence** (do **not** open with an English lead-in such as "This is a from-scratch build…" / "I'll start by…" or any running commentary in English), and in `SPEC.md` the app **name**, Goal, Chosen shape/pattern rationale, node **purpose** descriptions, and Open questions. If the requirement is Japanese, the **entire** turn is Japanese from the first token; if English, write English. Do not narrate in English and translate afterward.

**Keep these in English/ASCII exactly, regardless of the requirement's language** (localizing any of them breaks the build — the validators reject a translated identifier):
- `slug` values (`[a-z0-9_]`), node **id-placeholders**, and minted 13-digit ids;
- node `type` values (`start`, `llm`, `end`, `answer`, `if-else`, …) and all YAML keys;
- `{{#node.field#}}` variable references;
- plugin hashes / `dependencies` / `@sha256`;
- the `find.py --has` feature vocabulary and the `pattern` name in `analyze.json`.

`analyze.json` is machine-read: its `pattern`/`features` stay English (above); only its free-text `note`/`risks` may follow the requirement's language.

## Do
1. Re-read `{{PRIOR_ARTIFACT}}`.
2. **Pick the closest vetted pattern** with the real tool (do not guess):
   ```
   .venv/bin/python tools/dify_base/find.py --json --has <feature> [--has <feature> ...]
   .venv/bin/python tools/dify_base/find.py --list-features
   ```
   Priority order (AGENTS.md §3): `templates/patterns/` > `projects/*/workflows/` > `corpus/`.
3. Draft the **target spec**: intended behavior, chosen pattern, the nodes to add/modify/keep
   (with roles), the variable-flow you intend (`{{#id.field#}}` chains), and the plugins
   needed (note: real plugin hashes are added later from the target workspace — never invent).
4. **If `{{WORKFLOW_SLUG}}` is empty, propose a `slug` + human `name`** (slug = lowercase, `[a-z0-9_-]`,
   from the app's purpose). The backend scaffolds `projects/{{PROJECT}}/<slug>/` on the gate confirm — do
   **not** run `init_project.py` yourself.
5. Prefer a **single-file branched** design (if-else + variable-aggregator) over multiple
   parallel YAMLs for "phase-1 demo + phase-2 pending" shapes (AGENTS.md §9).
6. Draft **Acceptance Criteria** (spec 032 §3 / D6) — **3–7** one-line, *checkable* statements of "done
   right", derived ONLY from (a) what `{{REQUIREMENT}}` **explicitly** asks for, and (b) the structural
   correctness of the chosen shape (right nodes in order, variable flow, one-in→one-out). Phrase each as a
   testable assertion (format / length / must-mention-X / output-shape / must-not-do-Y), not a feeling.
   **Do NOT invent constraints the requirement never states** — no output-language, tone, persona, or
   length criterion unless the requirement explicitly asks for it. (The requirement's language governs
   YOUR SPEC prose per *Output language* above; it does NOT dictate the workflow's runtime output
   language — so never add "replies in <language>" unless the user asked for that language.)

## Output (authoritative artifact)
Write `SPEC.md`:
- to `.runs/{{TASK_ID}}/SPEC.md` if `{{WORKFLOW_SLUG}}` is empty (pre-slug),
- else to `projects/{{PROJECT}}/{{WORKFLOW_SLUG}}/SPEC.md`.

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
