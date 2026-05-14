# AGENTS.md — for AI coding agents

> **Đây là context file cho AI tools** (Claude Code, Codex CLI, Cursor, Aider, ...).
> Không phải tài liệu cho người đọc — human readers nên đọc [README.md](README.md) (overview)
> và [docs/GUIDE.md](docs/GUIDE.md) (operations chi tiết).
> Mục đích: cung cấp đủ rule + command để agent không phải re-discover repo mỗi session,
> và không lặp lại các failure mode đã biết (invent plugin hash, sai node ID format, ...).

---

## 1. What this repo is — and is NOT

This is a **base workspace** for authoring Dify workflow YAML across multiple projects. It
provides: a JSON Schema for Dify DSL, scaffolding tools, 4 vetted workflow patterns, a
51+ example corpus, pytest harness, and pre-commit hooks.

**It is NOT** a fork of Dify, a Dify plugin, or a runtime. We only produce DSL YAML that gets
imported into a Dify workspace. Source pin: `.dify-tag` = `1.13.0`. DSL pin: `.dify-dsl-version` = `0.6.0`.

## 2. MUST-DO before any task

- Read [docs/GUIDE.md](docs/GUIDE.md) section 3 ("Anatomy của 1 Dify Workflow YAML") if you have not seen Dify DSL.
- If `skills/` or `corpus/` or `vendor/` is missing/empty, run `./scripts/setup.sh` — they are gitignored read-only clones.
- Identify the target project: `ls projects/`. If creating new, use `init_project.py` (do not hand-create the folder).
- Read the project's DSL version: `cat projects/<slug>/.dify-workspace.yaml`. Fallback: `.dify-dsl-version` at repo root.
- **Never edit** anything under `skills/`, `corpus/`, or `vendor/` — they are external clones, changes will be wiped by `setup.sh`.

## 3. Building a new workflow — exact 5-step sequence

All commands run from repo root. Use `.venv/bin/python` (created by `./scripts/setup.sh`).

```bash
# 1. Scaffold project (interactive, asks 5-6 questions).
.venv/bin/python tools/dify_base/init_project.py
#    Non-interactive form:
#    .venv/bin/python tools/dify_base/init_project.py --non-interactive \
#        --name "My App" --slug my_app --app-type workflow --primary-lang en

# 2. Find the closest existing pattern (filter by feature).
.venv/bin/python tools/dify_base/find.py --has iteration --has file-input
.venv/bin/python tools/dify_base/find.py --list-features    # see all features
# Priority order: templates/patterns/ > projects/*/workflows/ > corpus/ > skills/*/assets/

# 3. Generate node IDs (Unix-timestamp-ms strings, guaranteed unique).
.venv/bin/python skills/mango-svip/scripts/generate_id.py 7

# 4. Copy chosen pattern into your project, then customize all # TODO: markers.
cp templates/patterns/multi-step-llm.yml projects/<slug>/workflows/main.yml
#    Edit: app.name, app.description, node IDs (find&replace), prompts,
#    variable references {{#<node_id>.<field>#}}, plugin dependencies.

# 5. Validate (structure + schema). Pre-commit will re-run these on git commit.
.venv/bin/python skills/mango-svip/scripts/validate_workflow.py projects/<slug>/workflows/main.yml
.venv/bin/pre-commit run --files projects/<slug>/workflows/main.yml
```

## 4. Conventions agents trip on

### 4.1 Node IDs
- Format: Unix timestamp in **milliseconds**, as a **quoted string** (e.g. `'1778674652462'`).
- ALWAYS get IDs from `skills/mango-svip/scripts/generate_id.py`. Never invent / copy-paste from another workflow.
- For an **iteration** node, the iteration-start child node ID is `<iteration_id>start` — no underscore, no dash. Example: parent `1778674652469` → child `1778674652469start`.
- Edge IDs follow `<source_id>-source-<target_id>-target`.

### 4.2 Variable references
- Syntax: `{{#<node_id>.<field>#}}`. The `<field>` MUST exist in the source node's declared `outputs`.
- The source `<node_id>` MUST be reachable upstream in the graph (no forward references).
- Typos here are the **#1 cause of silent import success + runtime failure**. Pre-commit lints this; do not ignore failures.

### 4.3 Plugin marketplace hashes
- Format: `<provider>/<plugin>:<version>@<sha256>` in `dependencies[].value.marketplace_plugin_unique_identifier`.
- The `@<sha256>` part is **real and workspace-specific** — copy it from a YAML exported by the target Dify workspace. NEVER fabricate. `tools/dify_base/lint_plugin_hashes.py` (pre-commit) enforces the format.
- When authoring a new pattern in `templates/patterns/`, leave `dependencies: []` empty and put a `# TODO: add plugin hash from target workspace` comment near the node that needs it.

**How to obtain a real plugin hash** (one-time per plugin per workspace):

1. Log in to the target Dify workspace (Cloud or self-host).
2. Studio → open any app that already uses the plugin you need (or install the plugin first if no app uses it).
3. Click the `⋯` menu (top-right of the app editor) → **Export DSL**.
4. Open the downloaded `.yml` in a text editor.
5. Search for `marketplace_plugin_unique_identifier:` inside the `dependencies:` section.
6. Copy the **full** value string — looks like `langgenius/openai:0.0.31@abc123...64-hex...`.
7. Paste into your workflow's `dependencies[].value.marketplace_plugin_unique_identifier`.

The hash changes when the plugin is upgraded in the workspace. If you see a "plugin version mismatch" error on import, re-export and copy the fresh hash.

### 4.4 DSL version
- Every workflow YAML MUST have a top-level `version: 0.6.0` (or whatever the project's `dsl_version` says).
- `scripts/check_dsl_version.sh` enforces this in pre-commit. If you need a different version, regenerate the schema first (`.venv/bin/python schemas/gen_schema.py`) and update the project's `.dify-workspace.yaml` — do not just change the workflow's `version:` field.

### 4.5 Code nodes
- `code_language: python3` (the only supported value here).
- Entry point: `def main(<args>) -> dict:` — return type must be a dict whose keys match the node's declared `outputs`.
- Sandbox = stdlib + a small whitelist. No `requests`, no `pip install`. If you need an HTTP call, use an `http-request` node.
- Defensive defaults: upstream `document-extractor` can return `None` or `""`. Handle both before iterating / regexing.

## 5. DO NOT

- Do NOT fabricate plugin sha256 hashes — leave `dependencies: []` empty + add `# TODO:` instead.
- Do NOT mix DSL versions in one project's workflows.
- Do NOT commit a new `templates/patterns/*.yml` without `# TODO:` markers on every customization point.
- Do NOT commit `projects/*/envs/*.env` (gitignored — only `.example` files are tracked).
- Do NOT hand-edit [INDEX.md](INDEX.md) — it is regenerated by `tools/dify_base/build_index.py`.
- Do NOT edit anything under `skills/`, `corpus/`, or `vendor/dify-src/` — read-only external clones.
- Do NOT `pip install` directly — use `./scripts/setup.sh` (re-creates `.venv` deterministically).
- Do NOT pass `--no-verify` to `git commit`. If a hook fails, fix the underlying issue.
- Do NOT invent node IDs by hand or reuse IDs from another workflow.
- Do NOT push to remote unless the user explicitly asks.

## 6. When stuck — discovery commands

```bash
# What features does a workflow have? What plugins? What complexity?
.venv/bin/python tools/dify_base/find.py --has <feature> --full
.venv/bin/python tools/dify_base/find.py --plugin <plugin-name>
.venv/bin/python tools/dify_base/find.py --source corpus --has knowledge-retrieval

# Look up the schema for a specific node type.
grep -A 30 "^### .*<node_type>" skills/mango-svip/references/node_types.md

# What's the current state of a project?
ls projects/<slug>/workflows/
cat projects/<slug>/.dify-workspace.yaml

# Diff local vs remote Dify workspace (requires DIFY_CONSOLE_TOKEN in envs/dev.env).
.venv/bin/python tools/dify_base/sync.py diff --project <slug>

# Examples in the corpus (40+ working DSLs).
grep -l "type: iteration"          corpus/awesome-dify-workflow/DSL/*.yml
grep -l "type: document-extractor" corpus/awesome-dify-workflow/DSL/*.yml
```

## 7. Test commands

All assumed to run from repo root.

```bash
# Unit + harness tests (skips cleanly without Dify creds).
.venv/bin/pytest tests/

# Project-scoped harness tests (loads projects/<slug>/envs/dev.env).
DIFY_PROJECT=<slug> .venv/bin/pytest tests/ -v

# Pre-commit on all files (yamllint + JSON Schema + skill validator + DSL version guard).
.venv/bin/pre-commit run --all-files

# Validate one workflow YAML directly.
.venv/bin/python skills/mango-svip/scripts/validate_workflow.py <file>.yml

# Regenerate JSON Schema from vendored Dify source (when bumping .dify-tag).
.venv/bin/python schemas/gen_schema.py
```

## 8. Where to find what

| Need | Location |
|---|---|
| Repo overview, setup, roadmap | [README.md](README.md) |
| Step-by-step operations + decision tree | [docs/GUIDE.md](docs/GUIDE.md) |
| Architecture rationale | [docs/architecture.md](docs/architecture.md) |
| Active specs (numbered) | [docs/specs/](docs/specs/) |
| Node-type schema reference | [skills/mango-svip/references/node_types.md](skills/mango-svip/references/node_types.md) |
| 40+ community workflow examples | [corpus/awesome-dify-workflow/DSL/](corpus/awesome-dify-workflow/) |
| 4 vetted starting patterns | [templates/patterns/](templates/patterns/) |
| Project scaffold skeleton | [templates/_base/project/](templates/_base/project/) |
| JSON Schema (DSL v0.6.0) | [schemas/dify-dsl-0.6.0.json](schemas/dify-dsl-0.6.0.json) |
| Schema generator (regen on Dify upgrade) | [schemas/gen_schema.py](schemas/gen_schema.py) |
| Project scaffolder | [tools/dify_base/init_project.py](tools/dify_base/init_project.py) |
| Template search | [tools/dify_base/find.py](tools/dify_base/find.py) |
| GitOps sync (pull/push/diff) | [tools/dify_base/sync.py](tools/dify_base/sync.py) |
| Pre-commit config | [.pre-commit-config.yaml](.pre-commit-config.yaml) |
| Repo pinning files | `.dify-dsl-version`, `.dify-tag` |

## 9. Observed pitfalls

<!-- Append observed agent failures here as they occur. Keep terse: 1-2 lines each,
     prefixed with the date. Format: `- YYYY-MM-DD: <what went wrong> → <rule that
     would have prevented it>`. Do not invent failures — only log real ones. -->
