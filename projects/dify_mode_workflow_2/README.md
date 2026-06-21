# Dify Mode Workflow 2

> Dify Mode Workflow 2

**App type**: `workflow` · **DSL version**: `0.6.0` · **Primary language**: `en`

Created: 2026-06-19

## Cấu trúc

```
dify_mode_workflow_2/
├── workflows/         # Dify workflow YAML (export từ Dify hoặc build từ pattern)
├── prompts/           # Externalized prompts (linked từ workflows/ qua future flatten tool)
├── inputs/            # Sample input data cho testing
├── tests/             # Pytest specs (qua harness ở dify-projects/tests/)
│   └── fixtures/      # JSON test fixtures
├── envs/              # Per-env config (dev.env, staging.env, prod.env) — gitignored
│   └── *.env.example  # Template, commit được
├── .dify-workspace.yaml   # Mapping env → Dify workspace URL + API key var
└── README.md          # This file
```

## Bắt đầu

1. **Copy env template** và điền secret thật (chỉ ở local):
   ```bash
   cp envs/dev.env.example envs/dev.env
   # Mở envs/dev.env, fill DIFY_BASE_URL, DIFY_API_KEY, ...
   ```

2. **Tạo workflow đầu tiên**: chọn 1 pattern từ `dify-projects/templates/patterns/` (khi có) hoặc copy 1 example từ `dify-projects/corpus/`. Save vào `workflows/<name>.yml`.

3. **Validate**:
   ```bash
   cd /Users/quyenbt/Desktop/MyProjects/dify-projects
   python3 skills/mango-svip/scripts/validate_workflow.py projects/dify_mode_workflow_2/workflows/<name>.yml
   ```

4. **Import vào Dify workspace**: Studio → Import DSL → chọn file.

## Convention

- **Naming**: file YAML dùng snake_case, mô tả input + pattern + output. VD: `pdf_rag_summary.yml`.
- **App name trong YAML**: prefix theo team convention nếu cần. Free-form ở scope này.
- **Plugin hash**: copy y nguyên từ Dify workspace export (đừng hard-code, hash đổi theo plugin version).
- **Mock-first**: code node mock với output schema giống real-API → swap sau dễ.

## Sources

- Base workspace: `~/Desktop/MyProjects/dify-projects/`
- Schema reference: [schemas/dify-dsl-0.6.0.json](../../schemas/dify-dsl-0.6.0.json)
- Node-type docs: [skills/mango-svip/references/node_types.md](../../skills/mango-svip/references/node_types.md)
- Search corpus: `python3 tools/dify_base/find.py --has <feature>`
