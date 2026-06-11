# Phase ③ — Implement the workflow YAML

> Body of ONE bounded step. Instantiate/edit the YAML, run the validate→fix loop, then
> **STOP — do not begin Phase ④ (Test).** This is the engine's load-bearing phase.

You are producing a valid Dify workflow YAML that satisfies `SPEC.md`. Read [SKILL.md](SKILL.md)
ground rules first — every non-negotiable below comes from [AGENTS.md](../../../AGENTS.md)
§3/§4/§9 and is enforced after this turn by the backend.

## Inputs
- `{{SLUG}}` — the project (scaffolded by now). `{{WORKFLOW_FILE}}` — target file name
  (`main.yml` for new; the selected `*.yml` for edit-existing).
- `{{PRIOR_ARTIFACT}}` — path to `SPEC.md`. **Re-read it fresh at the start** — a human may
  have edited it at the gate; the file wins (last-writer).
- `{{SEED_PATH}}` — for edit-existing / dify-seed, the base file to modify (else empty).

## Do — follow AGENTS.md §3 exactly
1. **Re-read `{{PRIOR_ARTIFACT}}` (`SPEC.md`)** — treat it as the source of truth for what to build.
2. **Pick/confirm the pattern** (if not already chosen): `.venv/bin/python tools/dify_base/find.py --json --has <feature>`.
3. **Mint node IDs — MANDATORY:**
   ```
   .venv/bin/python skills/mango-svip/scripts/generate_id.py <count>
   ```
   Use these 13-digit quoted-string IDs for **every** node. **Never** hand-write or copy an ID
   from another workflow — hand IDs render as literal text, pass the validators, and break the
   app silently (§4.1/§9). Iteration-start child node id = `<iteration_id>start` (no separator).
4. **Instantiate** `projects/{{SLUG}}/workflows/{{WORKFLOW_FILE}}`:
   - new → copy the chosen `templates/patterns/*.yml` then customize every `# TODO:` marker;
   - edit-existing / dify-seed → modify `{{SEED_PATH}}`'s content per `SPEC.md`.
   Set `app.name` / `app.description`, replace all node IDs, write prompts, wire variable
   references `{{#<node_id>.<field>#}}` (field MUST exist in the source node's `outputs`,
   source MUST be upstream — §4.2), and set top-level `version: 0.6.0`.
   - **Plugins:** leave `dependencies: []` + `# TODO: add plugin hash from target workspace`
     — NEVER fabricate a `@sha256` (§4.3).
   - **Code nodes:** `code_language: python3`, `def main(...) -> dict`, stdlib-only, guard
     `None`/`""` from upstream (§4.5).
   - **if-else nodes:** emit BOTH legacy `conditions` AND modern `cases` (§9, validator quirk).
5. **Validate → fix loop (cap 5 passes):**
   ```
   .venv/bin/python skills/mango-svip/scripts/validate_workflow.py projects/{{SLUG}}/workflows/{{WORKFLOW_FILE}}
   .venv/bin/python tools/dify_base/lint_refs.py            projects/{{SLUG}}/workflows/{{WORKFLOW_FILE}}
   .venv/bin/python tools/dify_base/lint_plugin_hashes.py  projects/{{SLUG}}/workflows/{{WORKFLOW_FILE}}
   ```
   Fix and re-run until **all three exit 0**, or until 5 passes elapse. If a run reports a YAML
   parse error (truncated/corrupt file), **regenerate from the pattern + `SPEC.md`** rather than
   patching the broken file. Do not `git commit`, do not `--no-verify`.

## Output
`projects/{{SLUG}}/workflows/{{WORKFLOW_FILE}}`, passing all three linters (or, if it cannot
pass in 5 passes, the partial file + the last linter error verbatim). The backend computes the
diff-vs-seed and re-runs the linters itself — you just produce the file.

## Stop
Present a short summary (nodes created, lint status, any remaining error), then STOP. Do not
import, push, or write a report — Phase ④ is separate (and backend-run in the app).
