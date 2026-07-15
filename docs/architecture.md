# Architecture

Thiết kế chi tiết của `dify-projects` — base workspace cho dự án Dify.

## Mục tiêu

Workspace này nhắm tới việc giảm friction khi:
- Build YAML workflow mới (mỗi project lặp lại 80% steps)
- Maintain prompt/code version (Dify built-in version control yếu)
- Test workflow đã deploy (Dify chưa có test framework)
- Onboarding dev mới (mỗi project có convention riêng)

Không phải mục tiêu (sẽ làm sau hoặc không bao giờ):
- Replace Dify UI editor
- Host Dify (đã có docker-compose của upstream)
- Train custom models

## 4 trụ cột

```
                     ┌─────────────────────────────────┐
                     │      dify-projects (base)        │
                     └─────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            │                 │                 │
       ┌────▼──┐         ┌────▼──┐        ┌─────▼─────┐
       │  KNOW  │         │ BUILD │        │  VERIFY   │
       │        │         │       │        │           │
       │ skills │         │ tpl   │        │  schema   │
       │ corpus │         │ init  │        │  tests    │
       │ docs   │         │ pattern│        │           │
       └────────┘         └───────┘        └───────────┘
```

### Trụ 1 — Know (`skills/`, `corpus/`, `docs/`)
Knowledge base read-only. 3 Claude skills + 1 community corpus.
- **Tại sao cần**: Dify DSL không có official spec; phải reverse-engineer.
- **Update strategy**: re-clone khi upstream cập nhật. Gitignored để base repo nhẹ.

### Trụ 2 — Build (`templates/`, `tools/dify_base/init_project.py`)
Scaffolder + reusable patterns.
- `_base/project/` → cookiecutter target cho mỗi project mới.
- `patterns/` → 9 workflow skeletons phổ biến (file-to-llm, file-iteration, multi-step-llm, rag-qa, agent-with-tools, per-row-notify, per-row-notify-excel, scheduled-fetch-notify, meta-workflow-builder).
- `init_project.py` → CLI interactive prompt 6 câu, copy + substitute.

### Trụ 3 — Verify (`schemas/`, `tests/`)
JSON Schema cho DSL + pytest harness cho deployed workflow.
- `gen_schema.py` → reverse-engineer pydantic models của Dify upstream → JSON Schema Draft-7.
- VS Code wire qua `.vscode/settings.json` → autocomplete + lint trong editor.
- `tests/conftest.py` → `DifyWorkflowClient` minimal (~80 LOC) + env-loader fixture.
- `tests/test_*.py` → syrupy snapshot tests cho deployed workflow.

### Trụ 4 — Project ▸ Workflow (`projects/`, spec 030)
Hệ thống 2 tầng thật trên đĩa: 1 Project là 1 thư mục chứa nhiều Workflow con.
Tầng Project scaffold từ `templates/_base/project/`, tầng Workflow từ `templates/_base/workflow/`:
```
projects/<project>/
├── .dify-workspace.yaml   # PROJECT manifest (name + env → workspace URL mapping) — dùng chung
├── envs/                  # dev.env (gitignored) — creds Dify DÙNG CHUNG cho mọi workflow
├── README.md
├── <workflow>/            # 1 Workflow (thư mục con)
│   ├── workflows/         # Dify YAML (main.yml)
│   ├── SPEC.md
│   ├── prompts/           # Externalized prompts
│   ├── inputs/            # Sample/fixture data
│   └── tests/fixtures/    # JSON test fixtures
└── <workflow_2>/ …
```
`projects/_drafts/` là project dành riêng cho các build "loose" (New task không chọn project).

## Workflow end-to-end

```
1. Scaffold project:
      python3 tools/dify_base/init_project.py
      → projects/my_app/

2. Scaffold workflow trong project:
      .venv/bin/python tools/dify_base/init_project.py --kind workflow --project my_app --slug my_wf
      → projects/my_app/my_wf/

3. Pick pattern:
      python3 tools/dify_base/find.py --has iteration --has file-input
      cp templates/patterns/file-iteration.yml projects/my_app/my_wf/workflows/main.yml

4. Edit (VS Code autocomplete from JSON Schema):
      # Look for `# TODO:` markers
      # Replace plugin hashes from your target Dify workspace
      # Configure model provider+name

5. Validate:
      python3 tools/dify_base/validate_workflow.py projects/my_app/my_wf/workflows/main.yml

6. Import vào Dify workspace → copy app API key.

7. Fill creds:
      cp projects/my_app/envs/dev.env.example projects/my_app/envs/dev.env
      # Edit DIFY_BASE_URL (with /v1 suffix), DIFY_API_KEY

8. Test:
      DIFY_PROJECT=my_app .venv/bin/pytest tests/ --snapshot-update
```

## Phase roadmap

| Phase | Status | Output |
|---|---|---|
| 0 | ✅ | Base structure, git init, skills cloned |
| 1.A | ✅ | `schemas/gen_schema.py` + JSON Schema envelope (29 NodeData reference defs; node bodies not schema-enforced) |
| 1.B | ✅ | `init_project.py` + `_base/project/` skeleton |
| 1.C | ✅ | 9 patterns trong `templates/patterns/` |
| 1.D | ✅ | pytest harness via custom DifyWorkflowClient |
| 2.A | ✅ | GitOps sync: `sync.py pull/push/diff` workspace ↔ git |
| 2.B | ✅ | pre-commit hook (yamllint + schema check) |
| 2.C | ⏳ | `.devcontainer/` cho VS Code |
| Builder | ✅ | `apps/builder` — web UI build 4 phase có gate (specs 009–055): turn sandbox, 4-linter gate, live-test trên Dify thật, Ask mode, template library + promote-to-pattern, upload-YAML-as-base, retry/edit-again. Chi tiết: AGENTS.md §10 + `docs/specs/README.md` |
| Polish | ⏳ | Fix `http_request` schema-dump (`_error: SchemaSerializer`, tracked spec 024 S1); `agent` already dumps clean — 25/25 node modules import |
| Future | ⏳ | Prompt flatten/unflatten (split `.prompt.md` from YAML) |

## Tradeoffs đã chọn

| Vấn đề | Lựa chọn | Lý do |
|---|---|---|
| dify-python-sdk | Tự viết minimal client (~80 LOC) | PyPI version thiếu WorkflowClient; pin git revision fragile |
| Pydantic dep installation | Auto-stub heavy deps (~195 packages) | Chỉ cần extract schemas; installing tất cả mất 5+ phút |
| Project location | `projects/` inside base | Monorepo-style; 1 venv, 1 schema, 1 toolkit |
| Skills storage | Git clone, gitignored | Update upstream tự do; base repo nhẹ |
| Schema version | 0.6.0 (hard-coded từ Dify source clone) | Match upstream `CURRENT_DSL_VERSION` constant |
| Test strategy | Run against real Dify (skip without creds) | Mock-LLM phức tạp, real test catches integration bugs |

## Decisions cần review sau

1. **DSL version policy**: nếu Dify ra v1.x với DSL bumped, làm sao mass-migrate templates? — Phase 2+
2. **Plugin hash management**: hash thay đổi per workspace, hiện phải copy thủ công. Có nên có cli `plugin-resolve` lookup hash từ workspace? — Future
3. **Project-local vs base-shared venv**: hiện base `.venv/` shared cho mọi project. Nếu project có deps riêng (test fixtures import lib X) thì cần venv-per-project. — Phase 2+
4. **Multi-env GitOps**: dev/staging/prod sync — design ở Phase 2.A.
