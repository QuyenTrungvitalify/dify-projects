# Dify Projects — Base Workspace

![CI](https://github.com/QuyenTrungvitalify/dify-projects/actions/workflows/ci.yml/badge.svg)

Một **base workspace** để phát triển nhiều dự án Dify. Cung cấp:

- Reference skills + corpus + node-type schema để build YAML workflow nhanh
- CLI search ~44 template theo feature/complexity/plugin
- Cấu trúc folder 2 tầng cho từng dự án (`projects/<project>/<workflow>/`, spec 030)
- GitOps sync (pull/push/diff giữa Dify workspace ↔ git)
- pytest harness + pre-commit hooks
- Auto-generated JSON Schema cho Dify DSL (envelope-validated; 29 NodeData reference defs — node bodies not schema-enforced)
- **Builder app** ([apps/builder/](apps/builder/)) — web UI local điều khiển build 4 phase có gate (Analyze → Spec → Implement → Test) bằng Claude Code; hướng dẫn cài đặt: [HUONG_DAN.md](HUONG_DAN.md)

> 📖 **Quick start**: [docs/GUIDE.md](docs/GUIDE.md) — operations guide (quy trình build YAML, decision tree, troubleshooting).
> 🏛️ **Architecture**: [docs/architecture.md](docs/architecture.md) — 4 trụ cột, workflow end-to-end, tradeoffs.
> 🔍 **Tra template**: [INDEX.md](INDEX.md) hoặc `python3 tools/dify_base/find.py --has iteration`.
> 🤖 **AI agents**: see [AGENTS.md](AGENTS.md) — universal context file (Claude Code, Codex CLI, Cursor, ...).

## Setup từ fresh clone

```bash
git clone <repo> dify-projects && cd dify-projects
./scripts/setup.sh
# → re-clones skills/corpus, creates .venv, installs deps, rebuilds INDEX, runs smoke tests
```

## 5-minute Hello World

Build + validate your first workflow end-to-end:

```bash
# 1. Scaffold tầng project rồi tầng workflow bên trong (2 tầng, spec 030)
.venv/bin/python tools/dify_base/init_project.py \
    --non-interactive --kind project --name "My First" --slug my_first
.venv/bin/python tools/dify_base/init_project.py \
    --non-interactive --kind workflow --project my_first \
    --name "Main" --slug main --app-type workflow

# 2. Copy the simplest pattern: file → 1 LLM call → output
cp templates/patterns/file-to-llm.yml projects/my_first/main/workflows/main.yml

# 3. Customize the 2 things every workflow needs (open in your editor):
#    a. LLM node `model.provider` + `model.name` — pick from plugins
#       installed in your target Dify workspace.
#    b. Plugin dependency hash (top of file). See AGENTS.md §4.3 for how to get it.

# 4. Validate locally before importing
.venv/bin/pre-commit run --files projects/my_first/main/workflows/main.yml
# Runs 13 hooks in <1s. Failures explain exactly what's wrong.

# 5. Import into Dify
#    Studio → top-right "+" → Import DSL file → upload main.yml → run it.
```

**Real worked example**: [examples/md_en2ja/](examples/md_en2ja/) — a complete
5-node Markdown EN→JA translator with code-block masking. Importable as-is
after adding your LLM plugin hash.

## Cấu trúc

```
dify-projects/
├── skills/                    # Claude Code skills (read-only clones)
│   ├── mango-svip/            # Node-type references + validator (SKILL.md, 26 node types)
│   ├── Tomatio13/             # DSL generator + checker (Japanese context)
│   └── lazeyliu/              # Validation-tier skills (structure idea)
│
├── corpus/                    # Reference YAML (gitignored clones; registry-driven)
│   ├── sources.yml            # Source registry (spec 022) — add/refresh corpora here
│   └── awesome-dify-workflow-en/ # Formyselfonly/Awesome-Dify-Workflow-EN (reference corpus — bodies mostly Chinese)
│
├── templates/                 # Project starter, patterns + promoted library/ (spec 022)
│   ├── _base/project/         # Scaffolded by init_project.py
│   ├── library/               # Promoted, provenance-stamped templates (spec 022; curated English, v0.6.0)
│   └── patterns/              # 11 reusable workflow skeletons
│       ├── file-to-llm.yml      # File upload → 1 LLM call → output (simplest)
│       ├── file-iteration.yml   # File upload → split → iterate → aggregate
│       ├── multi-step-llm.yml   # 3 chained LLM calls (refine pattern)
│       ├── rag-qa.yml           # Knowledge retrieval + LLM
│       ├── agent-with-tools.yml # Agent node with pluggable tools
│       ├── per-row-notify.yml   # Iterate rows → judge per-row → notify external API (spec 050)
│       ├── per-row-notify-excel.yml # Excel upload → extract/parse in-flow → per-row notify (spec 056)
│       ├── scheduled-fetch-notify.yml # Schedule trigger → fetch data → LLM → notify (trigger entry, spec 057)
│       ├── scheduled-tool-append.yml # Schedule trigger → tool node (marketplace, hash resolved) → append (spec 067)
│       └── meta-workflow-builder.yml # NL requirement → generate + auto-import a Dify workflow
│
├── examples/                  # Fully-worked projects (importable as-is)
│   └── md_en2ja/              # Markdown EN→JA translator w/ code-block masking
│
├── apps/
│   └── builder/               # Builder app: Fastify backend + Preact SPA, gated 4-phase
│                              # AI build (specs 009–067, retired). Own Node toolchain; see HUONG_DAN.md
│
├── schemas/                   # Auto-generated JSON Schema for Dify DSL (Phase 1.A done)
│   ├── gen_schema.py          # Reverse-engineer schema from dify pydantic models
│   └── dify-dsl-0.6.0.json    # Generated schema (DSL v0.6.0; envelope-validated, 29 NodeData reference defs — node bodies not enforced)
│
├── tools/                     # Python tooling
│   └── dify_base/             # 13 modules: build_index, find, init_project, sync,
│                              # 4 linters, promote_gate, provenance, sources
│
├── tests/                     # pytest harness (Phase 1.D)
│   ├── conftest.py            # DifyWorkflowClient + env-loading fixtures
│   ├── test_workflow_smoke.py # Example smoke + snapshot test
│   ├── requirements.txt       # pytest + syrupy + python-dotenv + requests
│   └── README.md              # How to test deployed workflows
│
├── projects/                  # 2 tầng (spec 030): projects/<project>/<workflow>/{workflows/,SPEC.md,...}
│
└── docs/                      # GUIDE.md, architecture.md, project-overview-{vi,ja}.md,
                               # state/ (hiện trạng hệ thống), specs/ (mới từ 071 — 001–067 đã retire),
                               # prompts/ (12 prompt test), plugin-capabilities.md, runtime-supplement.md

```

## Skills hiện có

| Skill | Source | Mục đích |
|---|---|---|
| `mango-svip/` | [mango-svip/dify-workflow-skills](https://github.com/mango-svip/dify-workflow-skills) | Schema 26 node types, validate script, working YAML assets |
| `Tomatio13/` | [Tomatio13/DifyWorkFlowGenerator](https://github.com/Tomatio13/DifyWorkFlowGenerator) | Japanese-context DSL generator + `difyDslGenCheck.py` |
| `lazeyliu/` | [lazeyliu/dify-dsl-generator-skills](https://github.com/lazeyliu/dify-dsl-generator-skills) | 11 sub-skills theo tier (entry/foundation/validation) |

## CLI cheatsheet

```bash
# === Search & Index ===
python3 tools/dify_base/find.py --has iteration --has file-input
python3 tools/dify_base/find.py --complexity Simple --has llm
python3 tools/dify_base/find.py --plugin md_exporter
python3 tools/dify_base/find.py --list-features      # available filters
python3 tools/dify_base/build_index.py               # rebuild INDEX

# === Project scaffolding ===
python3 tools/dify_base/init_project.py              # interactive new project

# === GitOps sync (Phase 2.A) ===
python3 tools/dify_base/sync.py list --project my_app           # list workspace apps
python3 tools/dify_base/sync.py pull --project my_app           # fetch all apps to projects/my_app/workflows/
python3 tools/dify_base/sync.py pull --project my_app --name-contains RAG
python3 tools/dify_base/sync.py diff --project my_app           # local vs remote diff
python3 tools/dify_base/sync.py push --project my_app --file workflows/main.yml
# ... + 9 subcommand khác: models/plugins/datasets/api-key/publish/delete/inject-model/run/upload

# === 4 linter của gate (chạy tay khi cần) ===
python3 tools/dify_base/validate_workflow.py <file>             # cấu trúc DSL
python3 tools/dify_base/lint_refs.py <file>                     # biến tham chiếu + graph reachability (spec 020)
python3 tools/dify_base/lint_node_bodies.py <file>              # thân node vs NodeData_* schema (spec 038)
python3 tools/dify_base/lint_plugin_hashes.py <file>            # định dạng plugin hash

# === Template promotion (specs 022/050/052) ===
python3 tools/dify_base/promote_gate.py <workflow.yml>          # cổng chất lượng trước khi thăng cấp thành pattern
python3 tools/dify_base/check_provenance.py                     # staleness/license của templates/library/

# === Pre-commit hooks (Phase 2.B) ===
.venv/bin/pre-commit install                                    # enable on git commit
.venv/bin/pre-commit run --all-files                            # run all hooks manually

# === Helpers from skills/ ===
python3 skills/mango-svip/scripts/generate_id.py 5              # unique node IDs
```

## Bắt đầu một dự án mới

```bash
# Interactive: hỏi 5-6 câu (name, slug, app type, DSL version, language...)
python3 tools/dify_base/init_project.py

# Non-interactive (cho script / CI):
# Tầng project (manifest + envs dùng chung):
python3 tools/dify_base/init_project.py \
    --non-interactive --kind project \
    --name "My RAG Bot" --slug my_rag_bot --primary-lang en
# Tầng workflow (bên trong project):
python3 tools/dify_base/init_project.py \
    --non-interactive --kind workflow --project my_rag_bot \
    --name "Summarizer" --slug summarizer --app-type workflow --primary-lang en
```

Hệ thống 2 tầng (spec 030): `projects/<project>/` (manifest `.dify-workspace.yaml` + `envs/` dùng chung, skeleton ở [templates/_base/project/](templates/_base/project/)) chứa nhiều `projects/<project>/<workflow>/` (workflows/, SPEC.md, prompts/, inputs/, tests/ — skeleton ở [templates/_base/workflow/](templates/_base/workflow/)). DSL version auto-detect từ `schemas/dify-dsl-*.json`.

## Patterns sẵn có ([templates/patterns/](templates/patterns/))

| Pattern | Use case | Nodes | Key features |
|---|---|---|---|
| `file-to-llm.yml` | Upload file → 1 LLM call → output (simplest) | 4 | document-extractor, llm |
| `file-iteration.yml` | Upload file → parse → process each item → aggregate | 7 | document-extractor, iteration, code |
| `multi-step-llm.yml` | Chain 3 LLM calls (generate → critique → refine) | 5 | llm × 3 |
| `rag-qa.yml` | Q&A grounded in knowledge base | 4 | knowledge-retrieval, llm |
| `agent-with-tools.yml` | ReAct agent with pluggable tools | 3 | agent |
| `per-row-notify.yml` | Iterate rows → judge per-row condition → notify external API (ChatWork...) | 9 | iteration, if-else, llm, http-request |
| `per-row-notify-excel.yml` | Upload 2 Excel (rows + mapping) → extract/parse in-flow → per-row judge → notify (start-node-as-trigger, spec 056) | 12 | file-input, document-extractor, iteration, if-else, llm, http-request |
| `scheduled-fetch-notify.yml` | 定期実行: schedule trigger → fetch data → LLM → notify (chạy tự động sau khi enable) | 6 | trigger-schedule, http-request, llm |
| `scheduled-tool-append.yml` | Schedule trigger → fetch → LLM → marketplace **tool node** (hash đã resolve) append kết quả (spec 067) | 6 | trigger-schedule, http-request, code, llm, tool |
| `meta-workflow-builder.yml` | NL requirement → generate + auto-import a new Dify workflow (meta) | 11 | llm, http-request (Dify console API) |

Mỗi pattern có comment `# TODO:` đánh dấu chỗ cần customize (model, prompt, plugin hash, dataset IDs, ...).

```bash
# Copy pattern vào workflow mới của bạn (2 tầng: projects/<project>/<workflow>/)
cp templates/patterns/file-iteration.yml projects/<project>/<workflow>/workflows/main.yml
# Edit theo TODOs, import vào Dify, test
```

## Quy trình build workflow mới (5 bước)

1. **Phân rã task** → trả lời: input/output/loop/branching/external-API
2. **Tìm pattern** tương tự bằng `find.py` → ưu tiên `patterns/` > `library/` > `project` > `corpus/` > `skill-assets/`
3. **Generate IDs**: `python3 skills/mango-svip/scripts/generate_id.py <N>`
4. **Build YAML**: copy skeleton, customize. Schema reference: [skills/mango-svip/references/node_types.md](skills/mango-svip/references/node_types.md)
5. **Validate**: `python3 tools/dify_base/validate_workflow.py <file>`

Chi tiết: xem [docs/GUIDE.md](docs/GUIDE.md).

## JSON Schema cho Dify DSL

[schemas/gen_schema.py](schemas/gen_schema.py) reverse-engineer JSON Schema từ Dify pydantic models trong vendored source clone (`vendor/dify-src/`, pinned via `.dify-tag` — currently `1.13.0` để giữ full node set; v1.13.1+ refactored sang `graphon` package, only 7 nodes inline).

```bash
# Setup venv (Python 3.11 hoặc 3.12 — Dify yêu cầu)
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python pydantic pydantic-settings pyyaml jsonschema \
    pycryptodome httpx sqlalchemy charset-normalizer pytz flask redis yarl flask-login cachetools

# Generate
.venv/bin/python schemas/gen_schema.py

# Output: schemas/dify-dsl-<version>.json (DSL version đọc từ Dify source)
```

Strategy: auto-stub heavy deps (flask, redis, models, controllers...) bằng permissive pydantic-friendly classes → import pydantic NodeData từ `api/core/workflow/nodes/<type>/entities.py` → dump `model_json_schema()`. Cả **25/25 node modules** import OK và sinh **29 NodeData schemas**; trong đó đúng **1 schema-dump fail**: `http_request` (pydantic `SchemaSerializer` trên `dify_config.HTTP_REQUEST_MAX_*` defaults) — node này ship kèm marker `_error`. `agent` dump sạch. Tracked làm spec 024 **S1** (làm schema-dump-fail thành fatal + fix stub); chưa fixed.

VS Code đã wire trong [.vscode/settings.json](.vscode/settings.json) — YAML files trong `projects/*/*/workflows/*.yml` và `templates/patterns/*.yml` tự động hover/autocomplete/validate theo schema.

## Roadmap

- ✅ **Phase 0** — base setup (cấu trúc + tooling cũ)
- ✅ **Phase 1.A** — JSON Schema generator
- ✅ **Phase 1.B** — `tools/dify_base/init_project.py` interactive scaffolder + `templates/_base/project/` skeleton
- ✅ **Phase 1.C** — 11 reusable patterns in `templates/patterns/`: file-to-llm, file-iteration, multi-step-llm, rag-qa, agent-with-tools, meta-workflow-builder, per-row-notify, per-row-notify-excel, scheduled-fetch-notify, scheduled-tool-append, webhook-per-row-notify (all validate against the repo linters; the upstream skill-clone validator predates trigger entries)
- ✅ **Phase 1.D** — pytest harness ([tests/](tests/)) — minimal `DifyWorkflowClient` + env-loading fixtures + syrupy snapshot example. Skips cleanly without creds.
- ✅ **Phase 2.A** — GitOps sync ([tools/dify_base/sync.py](tools/dify_base/sync.py)) — 13 subcommands via Console API: `list/pull/diff/push` + `models/plugins/datasets/api-key/publish/delete/inject-model/run/upload`. 12 tests passing (mocked HTTP, no real Dify needed). Polish: clean error messages for connection/timeout/HTTP failures.
- ✅ **Phase 2.B** — pre-commit hooks ([.pre-commit-config.yaml](.pre-commit-config.yaml), 13 hooks: yamllint + check-jsonschema + skill validator + DSL version guard + agents-md-refs + dify-lint-refs + dify-lint-node-bodies (spec 038) + dify-lint-plugin-hashes + 5 built-in) + bootstrap script ([scripts/setup.sh](scripts/setup.sh))
- ✅ **Builder app** ([apps/builder/](apps/builder/)) — web UI local, build workflow qua 4 phase có gate người duyệt. Đã có: turn sandbox + write-allowlist, 4 linter gate (refs, node bodies, plugin hashes, graph reachability), file/image attachments, live-test trên Dify thật (kể cả file input, và workflow không có LLM), Ask mode tại mọi gate, Request-changes ở mọi gate, workspace facts + runnability preflight, chống import-blocker, promote build → pattern, upload YAML làm base, one-click retry khi lỗi, trigger-entry (workflow tự chạy theo lịch/webhook), tool-node support, run dossier export, cost instrumentation theo phase.
- ✅ **Curated template library** ([templates/library/](templates/library/)) — promote qua `/template-promote`, có provenance-stamp
- ✅ **E2E simulation harness** ([apps/builder/scripts/e2e-run.sh](apps/builder/scripts/e2e-run.sh) + skill `/e2e`) — bắn prompt vào Builder như user thật, chấm cơ học theo 3 bucket **AUTO-PASS / AUTO-FAIL / MANUAL** (phần không tự test được luôn được báo cáo, không im lặng bỏ qua), tái dùng `/report` để chấm nội dung
- ⏳ **Polish 1.A** — `http_request` schema-dump đang **fail** (`_error: SchemaSerializer` trên default `dify_config.HTTP_REQUEST_MAX_*`); 25/25 node module import được và 29 schema generate được, nhưng cái này ship kèm marker `_error` thay vì dump sạch.

Specs 001–067 đã hoàn thành và retire khỏi cây (xem `git show ca5e39e:docs/specs/`). Spec đang mở: [docs/specs/](docs/specs/) (mới từ 071).

Chi tiết design: xem [docs/architecture.md](docs/architecture.md).

## Limitations

- **DSL version**: repo tự sinh JSON Schema cho DSL **v0.6.0**, reverse-engineer từ Dify **1.13.0** (pin ở `.dify-tag` / `.dify-dsl-version`, khớp với phần "JSON Schema" ở trên). Skill `mango-svip` bundled tham chiếu DSL cũ hơn; khi build cho workspace target version mới, verify field naming và regen schema (`schemas/gen_schema.py`) với `.dify-tag` tương ứng.
- **Validator chỉ check structure** (unique IDs, edge references, required fields). Không guarantee import success.
- **Plugin versions**: marketplace identifier hash đổi theo time. Khi import fail vì plugin, check version trong target workspace.

## Sources

- [langgenius/dify](https://github.com/langgenius/dify) — source code (vendored ở `vendor/dify-src/` via `setup.sh --dify-tag`)
- [mango-svip/dify-workflow-skills](https://github.com/mango-svip/dify-workflow-skills) — base skill
- [Tomatio13/DifyWorkFlowGenerator](https://github.com/Tomatio13/DifyWorkFlowGenerator) — JP-context DSL gen
- [lazeyliu/dify-dsl-generator-skills](https://github.com/lazeyliu/dify-dsl-generator-skills) — multi-tier skills
- [Formyselfonly/Awesome-Dify-Workflow-EN](https://github.com/Formyselfonly/Awesome-Dify-Workflow-EN) — reference corpus, bodies mostly Chinese (MIT)
- [Dify Official Docs](https://docs.dify.ai/) · [Dify v1.14.0 release](https://github.com/langgenius/dify/releases/tag/1.14.0)
