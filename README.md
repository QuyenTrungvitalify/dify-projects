# Dify Projects — Base Workspace

![CI](https://github.com/QuyenTrungvitalify/dify-projects/actions/workflows/ci.yml/badge.svg)

Một **base workspace** để phát triển nhiều dự án Dify. Cung cấp:

- Reference skills + corpus + node-type schema để build YAML workflow nhanh
- CLI search ~46 template theo feature/complexity/plugin
- Cấu trúc folder thống nhất cho từng project con (`projects/<name>/`)
- GitOps sync (pull/push/diff giữa Dify workspace ↔ git)
- pytest harness + pre-commit hooks
- Auto-generated JSON Schema cho Dify DSL (envelope-validated; 29 NodeData reference defs — node bodies not schema-enforced)

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
# 1. Scaffold a new project (non-interactive form for speed)
.venv/bin/python tools/dify_base/init_project.py \
    --non-interactive --name "My First" --slug my_first --app-type workflow

# 2. Copy the simplest pattern: file → 1 LLM call → output
cp templates/patterns/file-to-llm.yml projects/my_first/workflows/main.yml

# 3. Customize the 2 things every workflow needs (open in your editor):
#    a. LLM node `model.provider` + `model.name` — pick from plugins
#       installed in your target Dify workspace.
#    b. Plugin dependency hash (top of file). See AGENTS.md §4.3 for how to get it.

# 4. Validate locally before importing
.venv/bin/pre-commit run --files projects/my_first/workflows/main.yml
# Runs 12 hooks in <1s. Failures explain exactly what's wrong.

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
│   └── patterns/              # 6 reusable workflow skeletons
│       ├── file-to-llm.yml      # File upload → 1 LLM call → output (simplest)
│       ├── file-iteration.yml   # File upload → split → iterate → aggregate
│       ├── multi-step-llm.yml   # 3 chained LLM calls (refine pattern)
│       ├── rag-qa.yml           # Knowledge retrieval + LLM
│       ├── agent-with-tools.yml # Agent node with pluggable tools
│       └── meta-workflow-builder.yml # NL requirement → generate + auto-import a Dify workflow
│
├── examples/                  # Fully-worked projects (importable as-is)
│   └── md_en2ja/              # Markdown EN→JA translator w/ code-block masking
│

├── schemas/                   # Auto-generated JSON Schema for Dify DSL (Phase 1.A done)
│   ├── gen_schema.py          # Reverse-engineer schema from dify pydantic models
│   └── dify-dsl-0.6.0.json    # Generated schema (DSL v0.6.0; envelope-validated, 29 NodeData reference defs — node bodies not enforced)
│
├── tools/                     # Python tooling
│   └── dify_base/             # build_index, find, init_project, sync (Phase 2.A)
│
├── tests/                     # pytest harness (Phase 1.D)
│   ├── conftest.py            # DifyWorkflowClient + env-loading fixtures
│   ├── test_workflow_smoke.py # Example smoke + snapshot test
│   ├── requirements.txt       # pytest + syrupy + python-dotenv + requests
│   └── README.md              # How to test deployed workflows
│
├── projects/                  # Mỗi dự án 1 folder con (workflows/, prompts/, tests/...)
│
└── docs/                      # GUIDE.md + (planned) architecture.md, conventions.md
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

# === Pre-commit hooks (Phase 2.B) ===
.venv/bin/pre-commit install                                    # enable on git commit
.venv/bin/pre-commit run --all-files                            # run all hooks manually

# === Helpers from skills/ ===
python3 skills/mango-svip/scripts/generate_id.py 5              # unique node IDs
python3 tools/dify_base/validate_workflow.py <file>   # validate
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
| `meta-workflow-builder.yml` | NL requirement → generate + auto-import a new Dify workflow (meta) | 11 | llm, http-request (Dify console API) |

Mỗi pattern có comment `# TODO:` đánh dấu chỗ cần customize (model, prompt, plugin hash, dataset IDs, ...).

```bash
# Copy pattern vào project mới của bạn
cp templates/patterns/file-iteration.yml projects/<your_project>/workflows/main.yml
# Edit theo TODOs, import vào Dify, test
```

## Quy trình build workflow mới (5 bước)

1. **Phân rã task** → trả lời: input/output/loop/branching/external-API
2. **Tìm pattern** tương tự bằng `find.py` → ưu tiên `patterns/` > `corpus/` > `skill-assets/`
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
- ✅ **Phase 1.C** — 6 reusable patterns in `templates/patterns/`: file-to-llm, file-iteration, multi-step-llm, rag-qa, agent-with-tools, meta-workflow-builder (all validate against schema + skill validator)
- ✅ **Phase 1.D** — pytest harness ([tests/](tests/)) — minimal `DifyWorkflowClient` + env-loading fixtures + syrupy snapshot example. Skips cleanly without creds.
- ✅ **Phase 2.A** — GitOps sync ([tools/dify_base/sync.py](tools/dify_base/sync.py)) — `list/pull/diff/push` workflow apps via Console API. 8 tests passing (mocked HTTP, no real Dify needed). Polish: clean error messages for connection/timeout/HTTP failures.
- ✅ **Phase 2.B** — pre-commit hooks ([.pre-commit-config.yaml](.pre-commit-config.yaml), 12 hooks: yamllint + check-jsonschema + skill validator + DSL version guard + agents-md-refs + dify-lint-refs + dify-lint-plugin-hashes + 5 built-in) + bootstrap script ([scripts/setup.sh](scripts/setup.sh))
- ⏳ **Polish 1.A** — `http_request` schema-dump currently **fails** (`_error: SchemaSerializer` on `dify_config.HTTP_REQUEST_MAX_*` defaults); 25/25 node modules import and 29 schemas generate, but this one ships with an `_error` marker rather than a clean dump. Tracked as spec 024 **S1** (make a dump-fail fatal in `gen_schema.py`, then fix the stub).
- ⏳ **Phase 2.C** — `.devcontainer/` for VS Code

Chi tiết design: xem [docs/architecture.md](docs/architecture.md) (planned).

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
