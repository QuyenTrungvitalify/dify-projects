# Eiken Stem Proofread 84問

> Excel 84問から Stem に Answer Choice 1〜4 を入力した336文を作成し、校閲（DeepL Write API想定／実装後日）後 CSV形式で出力

**App type**: `workflow` · **DSL version**: `0.6.0` · **Primary language**: `ja-en`

Created: 2026-05-14

## Workflow (1 file, 2 branches)

[workflows/main.yml](workflows/main.yml) — single workflow với if-else branch ở trong iteration:

| Mode | Hành vi | Cần config |
|---|---|---|
| `mock` (default) | `[MOCK]` prefix passthrough, no API call | — chạy được ngay |
| `deepl` | Call DeepL Write API qua HTTP node | Fill 3 chỗ `<<< FILL`/`<<< VERIFY` trong YAML + add env var `DEEPL_API_KEY` (Secret) |

User chọn mode ở Start node (dropdown `mock` / `deepl`).

**Migration path:**
- Phase 1 (hiện tại): default `mock` → demo cho khách
- Phase 2 (khi có DeepL spec): fill HTTP URL + verify request/response schema, set `DEEPL_API_KEY`
- Phase 3 (sau khi DeepL ổn định): có thể remove MOCK branch + if-else + variable-aggregator → graph linear lại

## Cấu trúc

```
eiken_stem_proofread/
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
   python3 skills/mango-svip/scripts/validate_workflow.py projects/eiken_stem_proofread/workflows/<name>.yml
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
