# AGENTS.md — for AI coding agents

> **Đây là context file cho AI tools** (Claude Code, Codex CLI, Cursor, Aider, ...).
> Không phải tài liệu cho người đọc — human readers nên đọc [README.md](README.md) (overview)
> và [docs/GUIDE.md](docs/GUIDE.md) (operations chi tiết).
> Mục đích: cung cấp đủ rule + command để agent không phải re-discover repo mỗi session,
> và không lặp lại các failure mode đã biết (invent plugin hash, sai node ID format, ...).

---

## 1. What this repo is — and is NOT

This is a **base workspace** for authoring Dify workflow YAML across multiple projects. It
provides: a JSON Schema for Dify DSL, scaffolding tools, 10 vetted workflow patterns, a
~27-example vendored corpus (45-file template index), pytest harness, and pre-commit hooks.

**It is NOT** a fork of Dify, a Dify plugin, or a runtime. We only produce DSL YAML that gets
imported into a Dify workspace. Source pin: `.dify-tag` = `1.13.0`. DSL pin: `.dify-dsl-version` = `0.6.0`.

## 2. MUST-DO before any task

- Read [docs/GUIDE.md](docs/GUIDE.md) section 3 ("Anatomy của 1 Dify Workflow YAML") if you have not seen Dify DSL.
- If `skills/` or `corpus/` or `vendor/` is missing/empty, run `./scripts/setup.sh` — they are gitignored read-only clones.
- Identify the target project: `ls projects/`. If creating new, use `init_project.py` (do not hand-create the folder).
- Read the project's DSL version: `cat projects/<project>/.dify-workspace.yaml`. Fallback: `.dify-dsl-version` at repo root.
- **Never edit** anything under `skills/`, `corpus/`, or `vendor/` — they are external clones, changes will be wiped by `setup.sh`.

## 3. Building a new workflow — exact 5-step sequence

All commands run from repo root. Use `.venv/bin/python` (created by `./scripts/setup.sh`).

```bash
# 1. Scaffold project tier, then workflow tier inside it (2 tầng, spec 030 — both required;
#    `--kind` defaults to `project`, which has NO workflows/ dir).
.venv/bin/python tools/dify_base/init_project.py   # interactive (project tier)
#    Non-interactive form (2 commands):
#    .venv/bin/python tools/dify_base/init_project.py --non-interactive --kind project \
#        --name "My App" --slug my_app --primary-lang en
#    .venv/bin/python tools/dify_base/init_project.py --non-interactive --kind workflow \
#        --project my_app --name "Main" --slug main --app-type workflow --primary-lang en

# 2. Find the closest existing pattern (filter by feature).
.venv/bin/python tools/dify_base/find.py --has iteration --has file-input
.venv/bin/python tools/dify_base/find.py --list-features    # see all features
# Priority order: templates/patterns/ > templates/library/ > projects/*/*/workflows/ > corpus/ > skills/*/assets/

# 3. Generate node IDs (Unix-timestamp-ms strings, guaranteed unique).
.venv/bin/python skills/mango-svip/scripts/generate_id.py 7

# 4. Copy chosen pattern into your project, then customize all # TODO: markers.
cp templates/patterns/multi-step-llm.yml projects/<project>/<workflow>/workflows/main.yml
#    Edit: app.name, app.description, node IDs (find&replace), prompts,
#    variable references {{#<node_id>.<field>#}}, plugin dependencies.

# 5. Validate (structure + schema). Pre-commit will re-run these on git commit.
.venv/bin/python tools/dify_base/validate_workflow.py projects/<project>/<workflow>/workflows/main.yml
.venv/bin/pre-commit run --files projects/<project>/<workflow>/workflows/main.yml
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
- Typos here are the **#1 cause of silent import success + runtime failure**. `lint_refs.py` (pre-commit) checks that the referenced `<node_id>` exists and that `<field>` is a declared output of that node, **and** verifies **graph reachability**: a forward/dangling ref whose source node is not upstream-reachable over the edge DAG makes the linter **exit 1** and gates the commit (it no longer just warns). One documented exception: consumers **inside a container** (iteration/loop body) are skipped (`lint_refs` E3 — their refs resolve in container scope, not the main DAG), and a rare legitimate shape the BFS can't model can be waived via the reachability allowlist. Do not ignore its failures.

### 4.3 Plugin marketplace hashes
- Format: `<provider>/<plugin>:<version>@<sha256>` in `dependencies[].value.marketplace_plugin_unique_identifier`.
- The `@<sha256>` part is **real, public, and keyed to (plugin, version)** — **not** workspace-specific. It is the marketplace package checksum: the same plugin+version yields the same hash in every workspace. **Resolve it, never invent it.** `tools/dify_base/lint_plugin_hashes.py` (pre-commit) enforces the format.
- Resolving a hash needs **no login and no install**: `GET https://marketplace.dify.ai/api/v1/plugins/<org>/<name>/<version>` returns `unique_identifier` — paste that whole string into `dependencies[].value.marketplace_plugin_unique_identifier`. Verified 2026-07-16: exports from this repo's own workspace match the public API byte-for-byte (`langgenius/openai:0.2.8@aae2be09…`, `langgenius/gemini:0.9.1@324a17a2…`).
- **A workflow that uses a marketplace plugin MUST list it in `dependencies:`.** An empty `dependencies: []` + a `# TODO` is *not* a safe default: Dify only raises its own "install this plugin" prompt when the imported DSL carries a **non-empty** top-level `dependencies:` (the graph-derived fallback is dead above DSL 0.1.5). With `dependencies: []` the import succeeds, nothing prompts, and the tool fails at runtime.
- Pin the **version** you resolved. The hash changes when the plugin is upgraded, so `latest_package_identifier` drifts — use the version-specific endpoint. On a "plugin version mismatch" import error, re-resolve for the version the workspace has.

> **History**: this section previously said the hash was "workspace-specific — copy it from a YAML exported by the target Dify workspace. NEVER fabricate", with a 7-step Export-DSL procedure. That was **false**, and it cost real user value: `②Spec` obeyed it and refused to build tool nodes at all (rationale in one real run: 「プラグインハッシュ依存が増えないため」), so three consecutive builds shipped `http-request` instead of the Dify tool, and a stakeholder asking for spreadsheet integration was told it could not be done. Resolve the hash; do not avoid the tool.

### 4.4 DSL version
- Every workflow YAML MUST have a top-level `version: 0.6.0` (or whatever the project's `dsl_version` says).
- `scripts/check_dsl_version.sh` enforces this in pre-commit. If you need a different version, regenerate the schema first (`.venv/bin/python schemas/gen_schema.py`) and update the project's `.dify-workspace.yaml` — do not just change the workflow's `version:` field.

### 4.5 Code nodes
- `code_language: python3` (the only supported value here).
- Entry point: `def main(<args>) -> dict:` — return type must be a dict whose keys match the node's declared `outputs`.
- Sandbox = stdlib + a small whitelist. No `requests`, no `pip install`. If you need an HTTP call, use an `http-request` node.
- Defensive defaults: upstream `document-extractor` can return `None` or `""`. Handle both before iterating / regexing.

## 5. DO NOT

- Do NOT fabricate plugin sha256 hashes — **resolve** them from the marketplace (§4.3). Do NOT drop a tool node just because the workspace has not installed its plugin, and do NOT ship a tool node with `dependencies: []` (Dify then never prompts to install it).
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
ls projects/<project>/<workflow>/workflows/
cat projects/<project>/.dify-workspace.yaml

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

# Project-scoped harness tests (loads projects/<project>/envs/dev.env).
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

# E2E simulation harness (specs 058/059/060) — fire a prompt at the running Builder like a real user,
# grade it (3-bucket), and gate build speed/cost. Full usage guide: apps/builder/scripts/README.md
apps/builder/scripts/e2e-run.sh check <taskId> --expect <suite-id>   # OFFLINE 3-bucket verdict (+cost)
apps/builder/scripts/e2e-run.sh bench --entry <suite-id>             # fire→wait→check→timing/cost
apps/builder/scripts/e2e-run.sh fire "<prompt>" --mode auto          # needs backend + `claude` login
# or the /e2e skill for the full fire→wait→gate→check→/report procedure + MANUAL-residue report.
```

## 8. Where to find what

| Need | Location |
|---|---|
| Repo overview, setup, roadmap | [README.md](README.md) |
| Step-by-step operations + decision tree | [docs/GUIDE.md](docs/GUIDE.md) |
| Architecture rationale | [docs/architecture.md](docs/architecture.md) |
| Active specs (numbered) | [docs/specs/](docs/specs/) — open work only; a spec is deleted when it ships. Retired specs: `git show ca5e39e:docs/specs/` |
| Node-type schema reference | [skills/mango-svip/references/node_types.md](skills/mango-svip/references/node_types.md) |
| Runtime constraints & gotchas (sandbox limits, iteration ≤30, plugin hash, md_exporter caveats) | [skills/mango-svip/references/constraints.md](skills/mango-svip/references/constraints.md) |
| Project-discovered runtime findings (supplements skills clone — committable) | [docs/runtime-supplement.md](docs/runtime-supplement.md) |
| Plugin per-tool behavior matrix (md_exporter formats etc.) | [docs/plugin-capabilities.md](docs/plugin-capabilities.md) |
| Code-node sandbox stdlib probe (run in your workspace to verify modules) | [templates/probes/stdlib_check.yml](templates/probes/stdlib_check.yml) |
| Workflow examples (multilingual reference, bodies mostly Chinese) | [corpus/awesome-dify-workflow-en/Workflow-Store/](corpus/awesome-dify-workflow-en/) |
| Vendored-source registry (one entry per corpus; add/refresh sources here) | [corpus/sources.yml](corpus/sources.yml) — read by `setup.sh`, `build_index.py`, `update_corpus.sh` (spec 022). Tagged `corpus:<name>` in INDEX. |
| Promoted curated templates (standardized from a corpus example) | [templates/library/](templates/library/) — each carries an `x-provenance` header; promote via `/template-promote` (spec 022 D5). Staleness: `tools/dify_base/check_provenance.py`. Attributions: [THIRD_PARTY.md](THIRD_PARTY.md). |
| 10 vetted starting patterns | [templates/patterns/](templates/patterns/) |
| Curated Dify tools + their real identifiers | [templates/tool-catalog.json](templates/tool-catalog.json) (§4.3; regenerate with `tools/dify_base/marketplace.py`) |
| Project scaffold skeleton | [templates/_base/project/](templates/_base/project/) |
| JSON Schema (DSL v0.6.0) | [schemas/dify-dsl-0.6.0.json](schemas/dify-dsl-0.6.0.json) |
| Schema generator (regen on Dify upgrade) | [schemas/gen_schema.py](schemas/gen_schema.py) |
| Project scaffolder | [tools/dify_base/init_project.py](tools/dify_base/init_project.py) — `--kind project` scaffolds `projects/<project>/` (manifest + envs); `--kind workflow --project <p>` scaffolds `projects/<project>/<workflow>/` |
| Template search | [tools/dify_base/find.py](tools/dify_base/find.py) |
| GitOps sync (pull/push/diff) | [tools/dify_base/sync.py](tools/dify_base/sync.py) — `push --json-out` prints the raw import result on one line (machine-readable `app_id`) |
| Pre-commit config | [.pre-commit-config.yaml](.pre-commit-config.yaml) |
| Repo pinning files | `.dify-dsl-version`, `.dify-tag` |

## 9. Observed pitfalls

<!-- Append observed agent failures here as they occur. Keep terse: 1-2 lines each,
     prefixed with the date. Format: `- YYYY-MM-DD: <what went wrong> → <rule that
     would have prevented it>`. Do not invent failures — only log real ones. -->

- 2026-05-19: Designed if-else node with only `cases[].conditions` (modern Dify 0.6.0 schema) → `validate_workflow.py` rejected it because it checks for top-level `data.conditions` (legacy). → When emitting if-else nodes, include BOTH `conditions` (legacy, satisfies validator) AND `cases` (modern, real Dify behavior). See [constraints.md §7](skills/mango-svip/references/constraints.md).
- 2026-05-19: Built two separate workflow YAMLs (mock + DeepL skeleton) before user clarified preference for single-file branched design → wasted ~10min on the v2 file before deleting it. → For "Phase 1 demo + Phase 2 pending API" patterns, default to a single-file if-else+variable-aggregator branched workflow (eiken main.yml is canonical — project removed from the tree 2026-07-03; view via `git show 565480c^:projects/eiken_stem_proofread/workflows/main.yml`), not 2 parallel files.
- 2026-05-19: Discovered the bowenliang123 md_exporter plugin collapses consecutive whitespace in Markdown table cells → 10-space placeholder became 1-space in output CSV. Functionally OK for human reviewers, but breaks byte-exact downstream parsers. → When CSV output requires exact whitespace, don't pipe through md_exporter — see [constraints.md §5](skills/mango-svip/references/constraints.md) for workarounds.
- 2026-05-21: Used string node IDs (`node-code-1`) in a workflow → downstream `{{#node-code-1.text#}}` rendered as literal template string in output, no error, no warning. → Dify template engine only resolves numeric-timestamp IDs. Always generate via `skills/mango-svip/scripts/generate_id.py` per §4.1.
- 2026-05-22: Proposed LanguageTool free tier for production proofread → ToS prohibits automated/non-interactive use. → For any tiered third-party API, read ToS for "automated requests" clause before designing free-tier production path. Tracker (project removed from the tree 2026-07-03): `git show 565480c^:projects/eiken_stem_proofread/spec_todo/api_alternatives.md`.
- 2026-07-08: ChatWork per-row reminder (spec 050's worked example) — two design gotchas worth reusing: (a) date-boundary judgments computed inside a code node silently shift with the sandbox timezone → inject the run date (`today`) as a START input from the caller; (b) services with a custom auth header (X-ChatWorkToken 等) need `authorization: {type: no-auth}` + the token in `headers:` via an env-var secret (`name:` form) — api-key auth types rewrite headers. Distilled into `templates/patterns/per-row-notify.yml` (`# GOTCHA:` header).
- 2026-07-13: Builder shipped 6 required text inputs (list JSON, column names, today) for an Excel-shaped requirement; stakeholder rework (スタートノードをトリガー) → required Start inputs = only raw artifacts the operator holds. `today` is required only for a machine caller; for a human operator make it `required: false` with an in-code fallback pinned to the business timezone (JST: `datetime.now(timezone(timedelta(hours=9)))`) — never naive `now()`. See `templates/patterns/per-row-notify-excel.yml` + spec 056 (refines the 2026-07-08 run-date rule).
- 2026-07-13: Stakeholder confirmed 「スタートノードをトリガーにする仕様」 means TRIGGER-entry workflows (schedule/webhook) — the Builder could not produce them (validator required a start node; spec 020 reachability silently disabled itself on trigger entries). GOTCHA: Dify schedule triggers default to timezone UTC — always set Asia/Tokyo explicitly. Probes: import/publish/API-run all work on Dify 1.15. See `templates/patterns/scheduled-fetch-notify.yml` + spec 057.

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
  auto-advance) is unit-tested; browser end-to-end was a manual QA suite (deleted 2026-07-17 — view via
  `git show ca5e39e:docs/specs/prompts/009/qa/`).
- **Specs**: all builder specs shipped and retired — the spec directory was deleted 2026-07-17. To read
  any spec: `git show ca5e39e:docs/specs/<filename>`, or `git show ca5e39e:docs/specs/` to list all 77.
- **Ask vs Request-changes** (spec 033): at a parked Analyze/Spec/Implement gate, the composer's Send
  defaults to **Ask** — a resumed, answer-only turn (message↔message, no phase re-run) that can never
  write `SPEC.md`/`main.yml`, enforced by two independent layers (`BUILDER_ASK_MODE` permission-gate
  deny + a byte-snapshot/restore backstop over the build's own writable roots, `apps/builder/server/lib/ask.ts`), not
  by trusting the model. **Request changes** (explicit, via a gate action) is the only path that re-runs
  the phase and revises the artifact — never inferred from the message text. **Spec 034** extends Ask to
  the ④ Test gates AND to a terminal `done`/`cancelled` build via a **fresh-seeded** turn (`askTestWithin`
  — there is no phase session to resume, so the seed is assembled from whatever of
  requirement/SPEC.md/main.yml/report.json/liveTest exist, surfaced as a `seededFrom` caption; a dedicated
  `sessionIds.askTest` slot carries follow-up continuity; layer-1 `BUILDER_ASK_MODE` only — no snapshot
  backstop, since report.json is backend-authored and there is no in-progress artifact to protect). At a
  terminal build the composer is Ask-only (starting a NEW build moved to the sidebar "+"). **Spec 035**
  adds an "Edit this workflow" button on the done/cancelled gate foot that starts a new edit-existing
  build via the same `newTask({baseWorkflow})` the sidebar "+" uses.
- **Builder QA writes scratch workflows** into the reserved `projects/_drafts/<workflow>/` project
  (spec 030) — gitignored regenerable throwaways (spec 011 R2; `build_index.py` skips gitignored
  YAMLs). Don't commit them. Real projects live at `projects/<project>/<workflow>/` and are indexed.
- **The ③ gate lints every turn-touched `workflows/*.ya?ml`** (spec 039), not just the declared
  file; an extension twin of the declared file (`main.yaml` beside `main.yml`) is a hard error.
- **The gate runs 4 linters** (spec 038): `validate_workflow.py` + `lint_refs.py` +
  `lint_plugin_hashes.py` + `lint_node_bodies.py` (node bodies vs the generated `NodeData_*`
  schemas; escape hatch = a column-0 `# lint-bodies: allow <node_id>` line).
- **Sanctioned sources of plugin hashes / dataset ids in a Builder turn**:
  (1) the **workspace facts** the backend harvests into the `{{KNOWLEDGE}}` block — copy verbatim; these
  are authoritative for **dataset ids** (workspace-local) and for the plugin **versions** actually
  installed. (2) the **marketplace catalog/resolver** for plugin hashes — public and version-keyed
  (§4.3), so a plugin the workspace has not installed is still resolvable and still buildable.
  Never *invent* a hash; resolving one is not inventing. An **empty** `{{KNOWLEDGE}}` block means the
  harvest found nothing — it is **not** evidence that a plugin does not exist, and it is never a reason
  to drop a tool node (§4.3's history note). Dataset ids have no public source: no fact → the TODO form.
  The ③ gate shows an advisory `preflight:` note when a build is not runnable out-of-the-box.
