# AGENTS.md — for AI coding agents

> **Đây là context file cho AI tools** (Claude Code, Codex CLI, Cursor, Aider, ...).
> Không phải tài liệu cho người đọc — human readers nên đọc [README.md](README.md) (overview)
> và [docs/GUIDE.md](docs/GUIDE.md) (operations chi tiết).
> Mục đích: cung cấp đủ rule + command để agent không phải re-discover repo mỗi session,
> và không lặp lại các failure mode đã biết (invent plugin hash, sai node ID format, ...).

---

## 1. What this repo is — and is NOT

This is a **base workspace** for authoring Dify workflow YAML across multiple projects. It
provides: a JSON Schema for Dify DSL, scaffolding tools, 6 vetted workflow patterns, a
~46-example corpus, pytest harness, and pre-commit hooks.

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
.venv/bin/python tools/dify_base/validate_workflow.py projects/<slug>/workflows/main.yml
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
- Typos here are the **#1 cause of silent import success + runtime failure**. `lint_refs.py` (pre-commit) checks that the referenced `<node_id>` exists and that `<field>` is a declared output of that node, **and** — since [spec 020](docs/specs/020-builder-graph-reachability-linter.md) promoted it — verifies **graph reachability**: a forward/dangling ref whose source node is not upstream-reachable over the edge DAG makes the linter **exit 1** and gates the commit (it no longer just warns). One documented exception: consumers **inside a container** (iteration/loop body) are skipped (`lint_refs` E3 — their refs resolve in container scope, not the main DAG), and a rare legitimate shape the BFS can't model can be waived via the reachability allowlist. Do not ignore its failures.

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

# Examples in the corpus (multilingual reference DSLs — bodies mostly Chinese).
grep -l "type: iteration"          corpus/awesome-dify-workflow-en/Workflow-Store/*.yml
grep -l "type: document-extractor" corpus/awesome-dify-workflow-en/Workflow-Store/*.yml
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
.venv/bin/python tools/dify_base/validate_workflow.py <file>.yml

# Regenerate JSON Schema from vendored Dify source (when bumping .dify-tag).
.venv/bin/python schemas/gen_schema.py

# Builder app (apps/builder) — separate TS/Node toolchain; pre-commit/pytest skip apps/ (see §10).
(cd apps/builder && npm run typecheck && npm test)   # server: tsc --noEmit + node:test via tsx
(cd apps/builder/web && npm run build && npm test)   # web: tsc --noEmit + vite build + vitest
```

## 8. Where to find what

| Need | Location |
|---|---|
| Repo overview, setup, roadmap | [README.md](README.md) |
| Step-by-step operations + decision tree | [docs/GUIDE.md](docs/GUIDE.md) |
| Architecture rationale | [docs/architecture.md](docs/architecture.md) |
| Active specs (numbered) | [docs/specs/](docs/specs/) |
| Node-type schema reference | [skills/mango-svip/references/node_types.md](skills/mango-svip/references/node_types.md) |
| Runtime constraints & gotchas (sandbox limits, iteration ≤30, plugin hash, md_exporter caveats) | [skills/mango-svip/references/constraints.md](skills/mango-svip/references/constraints.md) |
| Project-discovered runtime findings (supplements skills clone — committable) | [docs/runtime-supplement.md](docs/runtime-supplement.md) |
| Plugin per-tool behavior matrix (md_exporter formats etc.) | [docs/plugin-capabilities.md](docs/plugin-capabilities.md) |
| Code-node sandbox stdlib probe (run in your workspace to verify modules) | [templates/probes/stdlib_check.yml](templates/probes/stdlib_check.yml) |
| Workflow examples (multilingual reference, bodies mostly Chinese) | [corpus/awesome-dify-workflow-en/Workflow-Store/](corpus/awesome-dify-workflow-en/) |
| Vendored-source registry (one entry per corpus; add/refresh sources here) | [corpus/sources.yml](corpus/sources.yml) — read by `setup.sh`, `build_index.py`, `update_corpus.sh` (spec 022). Tagged `corpus:<name>` in INDEX. |
| Promoted curated templates (standardized from a corpus example) | [templates/library/](templates/library/) — each carries an `x-provenance` header; promote via `/template-promote` (spec 022 D5). Staleness: `tools/dify_base/check_provenance.py`. Attributions: [THIRD_PARTY.md](THIRD_PARTY.md). |
| 6 vetted starting patterns | [templates/patterns/](templates/patterns/) |
| Project scaffold skeleton | [templates/_base/project/](templates/_base/project/) |
| JSON Schema (DSL v0.6.0) | [schemas/dify-dsl-0.6.0.json](schemas/dify-dsl-0.6.0.json) |
| Schema generator (regen on Dify upgrade) | [schemas/gen_schema.py](schemas/gen_schema.py) |
| Project scaffolder | [tools/dify_base/init_project.py](tools/dify_base/init_project.py) — `--group` sets the optional `project.group` sub-key (app sidebar grouping) |
| Template search | [tools/dify_base/find.py](tools/dify_base/find.py) |
| GitOps sync (pull/push/diff) | [tools/dify_base/sync.py](tools/dify_base/sync.py) — `push --json-out` prints the raw import result on one line (machine-readable `app_id`) |
| Pre-commit config | [.pre-commit-config.yaml](.pre-commit-config.yaml) |
| Repo pinning files | `.dify-dsl-version`, `.dify-tag` |

## 9. Observed pitfalls

<!-- Append observed agent failures here as they occur. Keep terse: 1-2 lines each,
     prefixed with the date. Format: `- YYYY-MM-DD: <what went wrong> → <rule that
     would have prevented it>`. Do not invent failures — only log real ones. -->

- 2026-05-19: Designed if-else node with only `cases[].conditions` (modern Dify 0.6.0 schema) → `validate_workflow.py` rejected it because it checks for top-level `data.conditions` (legacy). → When emitting if-else nodes, include BOTH `conditions` (legacy, satisfies validator) AND `cases` (modern, real Dify behavior). See [constraints.md §7](skills/mango-svip/references/constraints.md).
- 2026-05-19: Built two separate workflow YAMLs (mock + DeepL skeleton) before user clarified preference for single-file branched design → wasted ~10min on the v2 file before deleting it. → For "Phase 1 demo + Phase 2 pending API" patterns, default to a single-file if-else+variable-aggregator branched workflow ([eiken main.yml](projects/eiken_stem_proofread/workflows/main.yml) is canonical), not 2 parallel files.
- 2026-05-19: Discovered the bowenliang123 md_exporter plugin collapses consecutive whitespace in Markdown table cells → 10-space placeholder became 1-space in output CSV. Functionally OK for human reviewers, but breaks byte-exact downstream parsers. → When CSV output requires exact whitespace, don't pipe through md_exporter — see [constraints.md §5](skills/mango-svip/references/constraints.md) for workarounds.
- 2026-05-21: Used string node IDs (`node-code-1`) in a workflow → downstream `{{#node-code-1.text#}}` rendered as literal template string in output, no error, no warning. → Dify template engine only resolves numeric-timestamp IDs. Always generate via `skills/mango-svip/scripts/generate_id.py` per §4.1.
- 2026-05-22: Proposed LanguageTool free tier for production proofread → ToS prohibits automated/non-interactive use. → For any tiered third-party API, read ToS for "automated requests" clause before designing free-tier production path. Tracker: [eiken/spec_todo/api_alternatives.md](projects/eiken_stem_proofread/spec_todo/api_alternatives.md).

## 10. The builder app (apps/builder)

`apps/builder` is a **separate tool**, not part of the DSL-authoring flow above: a local web app
(Fastify backend + Preact SPA) that drives the gated 4-phase build (Analyze → Spec → Implement →
Test) conversationally. It has its **own** TypeScript/Node toolchain — pre-commit and `pytest`
deliberately skip `apps/` ([.pre-commit-config.yaml](.pre-commit-config.yaml)); its regression net is
the npm test suites (§7) and the CI `builder` job ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

- **Run it**: `cd apps/builder && npm install && npm run dev` (binds 127.0.0.1:4123); web dev server
  `cd apps/builder/web && npm run dev`. Boot smokes the PreToolUse permission hook and **refuses to
  start** (SEC1) if it can't load (the turn sandbox would fail OPEN — usually a host Node < 22.6 that
  can't run the `.ts` hook); fix the runtime, or set `BUILDER_ALLOW_UNGUARDED=1` to start unguarded at
  your own risk.
- **Tests**: server `npm test` (node:test via tsx, in `apps/builder/test/`), web `npm test` (vitest,
  `apps/builder/web/src/**/*.test.ts`). The pure safety logic (gate / run-lock / Origin-CSRF / slug /
  auto-advance) is unit-tested; browser end-to-end is the **manual** QA suite at
  [docs/specs/prompts/009/qa/](docs/specs/prompts/009/qa/).
- **Specs**: [009](docs/specs/009-browser-workflow-builder.md) (the app),
  [010](docs/specs/010-builder-ux-hardening.md) (UX hardening),
  [011](docs/specs/011-builder-test-coverage-and-remediation.md) (tests + review remediation).
- **Builder QA writes scratch projects** to `projects/<slug>/` — gitignored regenerable throwaways
  (spec 011 R2; `build_index.py` skips gitignored YAMLs). Don't commit them. The hand-made projects
  `news_automation/` and `eiken_stem_proofread/` are kept and indexed.
