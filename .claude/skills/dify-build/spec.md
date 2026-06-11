# Phase ② — Spec the target workflow

> Body of ONE bounded step. Draft the target behavior + plan, write `SPEC.md`, then
> **STOP — do not begin Phase ③ (Implement).**

You are turning a requirement (and, if present, the Analyze summary) into a concrete build
plan. Read [SKILL.md](SKILL.md) ground rules first.

## Inputs
- `{{REQUIREMENT}}` — the target behavior the user wants.
- `{{PRIOR_ARTIFACT}}` — path to `analyze.json` from Phase ① (re-read it; may be `seed: null`).
- `{{SLUG}}` — may be **empty** (new-workflow path); if so you must **propose** one.
- `{{DEPLOY}}` — for context (does not change the spec itself).

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
4. **If `{{SLUG}}` is empty, propose `slug` + human `name`** (slug = lowercase, `[a-z0-9_-]`,
   from the app's purpose). The backend scaffolds `projects/<slug>/` on the gate confirm — do
   **not** run `init_project.py` yourself.
5. Prefer a **single-file branched** design (if-else + variable-aggregator) over multiple
   parallel YAMLs for "phase-1 demo + phase-2 pending" shapes (AGENTS.md §9).

## Output (authoritative artifact)
Write `SPEC.md`:
- to `.runs/{{TASK_ID}}/SPEC.md` if `{{SLUG}}` is empty (pre-slug),
- else to `projects/{{SLUG}}/SPEC.md`.

Structure: `# <name>` · **Goal** · **Chosen pattern** (+ why) · **Nodes** (table: id-placeholder,
type, purpose) · **Variable flow** · **Plugins** (+ `# TODO: hash`) · **Open questions**. If you
proposed a slug/name, state them at the top under **Proposed slug / name**.

## Stop
Present the spec + (if any) the proposed slug/name, then STOP. Do not scaffold, mint IDs, or
write any workflow YAML. (A human may edit `SPEC.md` at the gate; Implement re-reads it fresh.)
