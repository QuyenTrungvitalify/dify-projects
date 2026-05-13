# Dify Projects — Base Workspace

Một **base workspace** để phát triển nhiều dự án Dify. Cung cấp:

- Reference skills + corpus + node-type schema để build YAML workflow nhanh
- CLI search 51+ template theo feature/complexity/plugin
- Cấu trúc folder thống nhất cho từng project con (`projects/<name>/`)
- Roadmap mở rộng (scaffolder, JSON Schema, test harness) — xem [docs/architecture.md](docs/architecture.md)

> 📖 **Quick start**: [docs/GUIDE.md](docs/GUIDE.md) — operations guide (quy trình build YAML, decision tree, troubleshooting).
> 🔍 **Tra template**: [INDEX.md](INDEX.md) hoặc `python3 tools/dify_base/find.py --has iteration`.

## Cấu trúc

```
dify-projects/
├── skills/                    # Claude Code skills (read-only clones)
│   ├── mango-svip/            # Node-type references + validator (SKILL.md, 26 node types)
│   ├── Tomatio13/             # DSL generator + checker (Japanese context)
│   └── lazeyliu/              # Validation-tier skills (structure idea)
│
├── corpus/                    # Reference YAML examples (read-only clone)
│   └── awesome-dify-workflow/ # svcvit/Awesome-Dify-Workflow (46 examples)
│
├── templates/                 # Project starter + workflow patterns
│   ├── _base/project/         # Scaffolded by init_project.py
│   └── patterns/              # 4 reusable workflow skeletons (Phase 1.C)
│       ├── file-iteration.yml   # File upload → split → iterate → aggregate
│       ├── multi-step-llm.yml   # 3 chained LLM calls (refine pattern)
│       ├── rag-qa.yml           # Knowledge retrieval + LLM
│       └── agent-with-tools.yml # Agent node with pluggable tools
│
├── schemas/                   # Auto-generated JSON Schema for Dify DSL (Phase 1.A done)
│   ├── gen_schema.py          # Reverse-engineer schema from dify pydantic models
│   └── dify-dsl-0.6.0.json    # Generated schema (DSL v0.6.0, 27 NodeData types)
│
├── tools/                     # Python tooling
│   └── dify_base/             # build_index, find — (planned: scaffold, validate, run_test)
│
├── tests/                     # (planned) pytest integration harness via dify-python-sdk
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
# Tra template theo feature
python3 tools/dify_base/find.py --has iteration --has file-input
python3 tools/dify_base/find.py --complexity Simple --has llm
python3 tools/dify_base/find.py --plugin md_exporter
python3 tools/dify_base/find.py --name translation
python3 tools/dify_base/find.py --list-features    # liệt kê available filters

# Rebuild index (sau khi thêm template/project mới)
python3 tools/dify_base/build_index.py

# Generate unique node IDs
python3 skills/mango-svip/scripts/generate_id.py 5

# Validate YAML
python3 skills/mango-svip/scripts/validate_workflow.py <file>.yml
```

## Bắt đầu một dự án mới

```bash
# Interactive: hỏi 5-6 câu (name, slug, app type, DSL version, language...)
python3 tools/dify_base/init_project.py

# Non-interactive (cho script / CI):
python3 tools/dify_base/init_project.py \
    --non-interactive \
    --name "My RAG Bot" \
    --slug my_rag_bot \
    --app-type workflow \
    --primary-lang en
```

Tạo `projects/<slug>/` với cấu trúc chuẩn (workflows/, prompts/, inputs/, tests/, envs/, .dify-workspace.yaml, README, .gitignore). Skeleton ở [templates/_base/project/](templates/_base/project/). DSL version auto-detect từ `schemas/dify-dsl-*.json`.

## Patterns sẵn có ([templates/patterns/](templates/patterns/))

| Pattern | Use case | Nodes | Key features |
|---|---|---|---|
| `file-iteration.yml` | Upload file → parse → process each item → aggregate | 7 | document-extractor, iteration, code |
| `multi-step-llm.yml` | Chain 3 LLM calls (generate → critique → refine) | 5 | llm × 3 |
| `rag-qa.yml` | Q&A grounded in knowledge base | 4 | knowledge-retrieval, llm |
| `agent-with-tools.yml` | ReAct agent with pluggable tools | 3 | agent |

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
5. **Validate**: `python3 skills/mango-svip/scripts/validate_workflow.py <file>`

Chi tiết: xem [docs/GUIDE.md](docs/GUIDE.md).

## JSON Schema cho Dify DSL

[schemas/gen_schema.py](schemas/gen_schema.py) reverse-engineer JSON Schema từ Dify pydantic models trong source clone (`~/Desktop/MyProjects/dify-workspace/`).

```bash
# Setup venv (Python 3.11 hoặc 3.12 — Dify yêu cầu)
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python pydantic pydantic-settings pyyaml jsonschema \
    pycryptodome httpx sqlalchemy charset-normalizer pytz flask redis yarl flask-login cachetools

# Generate
.venv/bin/python schemas/gen_schema.py

# Output: schemas/dify-dsl-<version>.json (DSL version đọc từ Dify source)
```

Strategy: auto-stub heavy deps (flask, redis, models, controllers...) bằng permissive pydantic-friendly classes → import pydantic NodeData từ `api/core/workflow/nodes/<type>/entities.py` → dump `model_json_schema()`. Hiện 23/25 node types thành công (27 NodeData schemas). Failed: `agent` (libs.exception submodule), `http_request` (timeout class default value với stubbed config).

VS Code đã wire trong [.vscode/settings.json](.vscode/settings.json) — YAML files trong `projects/*/workflows/*.yml` và `templates/patterns/*.yml` tự động hover/autocomplete/validate theo schema.

## Roadmap

- ✅ **Phase 0** — base setup (cấu trúc + tooling cũ)
- ✅ **Phase 1.A** — JSON Schema generator
- ✅ **Phase 1.B** — `tools/dify_base/init_project.py` interactive scaffolder + `templates/_base/project/` skeleton
- ✅ **Phase 1.C** — 4 reusable patterns in `templates/patterns/`: file-iteration, multi-step-llm, rag-qa, agent-with-tools (all validate against schema + skill validator)
- ⏳ **Phase 1.D** — `tests/conftest.py` pytest harness via dify-python-sdk
- ⏳ **Phase 2** — GitOps sync, pre-commit, devcontainer

Chi tiết design: xem [docs/architecture.md](docs/architecture.md) (planned).

## Limitations

- **DSL version**: schema reference từ mango-svip viết cho **v0.1.4**; Dify mainline đã ở **v1.14.x (5/2026)**. Khi build cho workspace target version mới, verify field naming → schema generation (Phase 1) sẽ fix triệt để.
- **Validator chỉ check structure** (unique IDs, edge references, required fields). Không guarantee import success.
- **Plugin versions**: marketplace identifier hash đổi theo time. Khi import fail vì plugin, check version trong target workspace.

## Sources

- [langgenius/dify](https://github.com/langgenius/dify) — source code (clone tham khảo ở `~/Desktop/MyProjects/dify-workspace/`)
- [mango-svip/dify-workflow-skills](https://github.com/mango-svip/dify-workflow-skills) — base skill
- [Tomatio13/DifyWorkFlowGenerator](https://github.com/Tomatio13/DifyWorkFlowGenerator) — JP-context DSL gen
- [lazeyliu/dify-dsl-generator-skills](https://github.com/lazeyliu/dify-dsl-generator-skills) — multi-tier skills
- [svcvit/Awesome-Dify-Workflow](https://github.com/svcvit/Awesome-Dify-Workflow) — corpus 46+ examples
- [Dify Official Docs](https://docs.dify.ai/) · [Dify v1.14.0 release](https://github.com/langgenius/dify/releases/tag/1.14.0)
