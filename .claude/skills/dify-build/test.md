# Phase ④ — Test & Report

> **In the Builder app this phase is run by the BACKEND, not a Claude turn** (it owns all Dify
> I/O; the bearer token never enters a turn). This file is for a **human / CLI agent** running
> the procedure outside the app, and documents what the backend reproduces.

You are validating the produced workflow and reporting the result; if `{{DEPLOY}}` requires it,
importing into Dify. Read [SKILL.md](SKILL.md) ground rules first.

## Inputs
- `projects/{{SLUG}}/workflows/{{WORKFLOW_FILE}}` — the file Phase ③ produced.
- `{{DEPLOY}}` ∈ `none | selfhost | cloud`. `{{TASK_ID}}` — for the report path.

## Do
1. **Validate** (must all exit 0 before any import):
   ```
   .venv/bin/python skills/mango-svip/scripts/validate_workflow.py projects/{{SLUG}}/workflows/{{WORKFLOW_FILE}}
   .venv/bin/python tools/dify_base/lint_refs.py            projects/{{SLUG}}/workflows/{{WORKFLOW_FILE}}
   .venv/bin/python tools/dify_base/lint_plugin_hashes.py  projects/{{SLUG}}/workflows/{{WORKFLOW_FILE}}
   ```
   **If any linter exits ≠ 0, the workflow did NOT pass.** Do **not** write a `done`-shaped
   `report.json` and do **not** import — surface the failing linter output and STOP, *unless* the user
   has explicitly accepted a known-failing build (then write the report with
   `"accepted_lint_failure": true` and never deploy it). A clean-looking report over a lint-failing
   workflow is the "done-but-broken" trap: `lint_refs`/id failures import fine but break at runtime.
   - **Unresolved plugin TODO (017 D2, advisory):** if the workflow still ships `dependencies: []`
     alongside a `# TODO: add plugin hash` marker, the linters pass (an empty `dependencies` is valid
     format) but a `selfhost`/`cloud` import will fail for the missing marketplace plugin. Record it as
     `"unresolved_plugin_todo": true` so the deploy step surfaces it **before** import. This is a NOTE,
     not a failure — it never flips the lint verdict and never blocks a `none` build.
2. **By `{{DEPLOY}}`:**
   - **`none`** (default, always safe): no Dify contact. Just validate + write the report below.
   - **`selfhost`**: requires `DIFY_CONSOLE_URL`/`DIFY_CONSOLE_TOKEN` in the environment. Import
     (always creates a **NEW** app — there is no in-place update):
     ```
     .venv/bin/python tools/dify_base/sync.py push --project {{SLUG}} --file workflows/{{WORKFLOW_FILE}} --yes
     ```
     (`--file` is **relative to** `projects/{{SLUG}}/` — do not prefix `projects/{{SLUG}}/`.)
     Capture the new app id from the import result; build `app_url` by stripping `/console/api`
     from `DIFY_CONSOLE_URL` and appending `/app/<app_id>/workflow`. ⚠ For an **edit-existing**
     workflow this still creates a *duplicate* app — say so prominently in the report.
   - **`cloud`**: do **not** auto-import (CSRF). Emit the YAML for the user to paste into Studio
     (Import DSL) and list the manual steps.

## Output (authoritative artifact)
Write `.runs/{{TASK_ID}}/report.json`:
```json
{ "workflow_file": "projects/{{SLUG}}/workflows/{{WORKFLOW_FILE}}",
  "lint": { "validate": 0, "lint_refs": 0, "lint_plugin_hashes": 0 },
  "deploy": "{{DEPLOY}}",
  "app_url": "<selfhost only, else null>",
  "duplicate_warning": "<set when selfhost + edit-existing>",
  "unresolved_plugin_todo": "<true when a needed plugin still has dependencies: [] + a # TODO hash; advisory>",
  "notes": "..." }
```
Then present the report (path + lint summary + any `app_url`) in chat.

## Note
There is no Phase ⑤. After the report, the run is done. (In the app, the backend writes this
report and the `push_intent` idempotency marker; a CLI user runs the steps above directly.)

## Stop
After presenting the report, **STOP** — the run is complete. Do not loop back into another phase,
re-import, or start a new build. (This mirrors the `## Stop` contract every other phase file ends
with; Phase ④ is the terminal step.)
