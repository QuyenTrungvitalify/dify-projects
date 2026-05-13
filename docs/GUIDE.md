# Dify Base — Operations Guide

> Sau khi pivot từ workshop (Vitalify-specific) sang base workspace generic, một số section dưới đây vẫn còn nội dung Eiken/Vitalify legacy. Cần dọn dần ở Phase 0+. Tóm tắt cấu trúc + CLI mới: xem [README.md](../README.md).

Hướng dẫn vận hành base workspace cho việc build Dify workflow. Đọc file này khi:
- Bắt đầu task Dify mới
- Quên cách dùng tool nào trong workshop
- Onboard người mới vào team

> Bổ trợ cho [README.md](../README.md) (overview). File này focus vào **cách thao tác**.

---

## 1. Workshop tồn tại để giải quyết vấn đề gì?

**Vấn đề**: Build Dify workflow YAML thủ công → dễ sai schema, không có pattern thống nhất, mỗi task lặp lại research, plugin/version inconsistency.

**Cách workshop giải quyết**:
| Vấn đề | Giải pháp trong workshop |
|---|---|
| Không nhớ schema YAML | `skills/mango-svip/references/node_types.md` |
| Không biết bắt đầu từ đâu | `skills/mango-svip/assets/` (3 skeleton) + `templates/` (Vitalify-specific) |
| Lo schema sai dẫn đến import fail | `skills/mango-svip/scripts/validate_workflow.py` |
| Không tìm được pattern tương tự | `corpus/awesome-dify-workflow/DSL/` (40+ examples) |
| Tạo ID trùng / sai format | `skills/mango-svip/scripts/generate_id.py` |
| Mỗi task build lại từ đầu | `templates/` (clone từ task trước, tinh chỉnh) |

---

## 2. Quick Start — chạy template có sẵn (5 phút)

Nếu chỉ muốn **import template hiện có** vào Dify khách:

```bash
# 1. Validate template trước
cd /Users/quyenbt/Desktop/MyProjects/dify-projects/skills/mango-svip
python3 skills/mango-svip/scripts/validate_workflow.py ../../templates/xlsx_iteration_proofread.yml
# → ✅ Workflow validation passed!

# 2. Import file vào Dify
# - Mở Dify workspace
# - Studio → Import DSL file → chọn templates/xlsx_iteration_proofread.yml
# - Confirm các plugin dependency (bowenliang123/md_exporter)

# 3. Test với 1 file xlsx
```

Nếu import fail → xem section [8. Troubleshooting](#8-troubleshooting).

---

## 3. Anatomy của 1 Dify Workflow YAML

Trước khi build, hiểu cấu trúc cơ bản:

```yaml
app:                          # Metadata: tên, icon, mô tả
  name: ...
  mode: workflow              # Luôn là "workflow" cho workflow app
dependencies:                 # Plugin marketplace cần cài
- type: marketplace
  value:
    marketplace_plugin_unique_identifier: <plugin>:<version>@<hash>
kind: app                     # Cố định
version: 0.6.0                # DSL version — match env Eiken
workflow:
  conversation_variables: []
  environment_variables: []   # Env vars (API key, config)
  features:                   # File upload, TTS, STT...
    file_upload: { ... }
  graph:
    nodes: [...]              # Mỗi node = 1 step trong workflow
    edges: [...]              # Connect nodes với nhau
  viewport: { x, y, zoom }    # Canvas position (cosmetic)
```

### Node structure (lặp lại pattern)

```yaml
- id: '1778674652462'         # Unix timestamp ms — UNIQUE
  type: custom                # Luôn "custom"
  data:
    type: start               # Actual node type (start/end/llm/code/...)
    title: "Tên hiển thị"
    # ... config riêng cho mỗi node type
  position: { x: 0, y: 419 }
  positionAbsolute: { x: 0, y: 419 }
  width: 242
  height: 107
  sourcePosition: right
  targetPosition: left
```

### Edge structure

```yaml
- id: <source_id>-source-<target_id>-target  # Naming convention
  source: '1778674652462'
  target: '1778674652464'
  sourceHandle: source        # Hoặc: true/false (if-else), fail-branch (error)
  targetHandle: target
  type: custom
  data:
    sourceType: start         # Loại node source
    targetType: document-extractor
    isInIteration: false
  zIndex: 0
```

### Variable references

Cú pháp gọi biến từ node khác: `{{#<node_id>.<field_name>#}}`

VD: `{{#1778674652466.csv_markdown#}}` = field `csv_markdown` output của node `1778674652466`.

---

## 4. Components Deep Dive

### 4.1 `skills/mango-svip/`

**External skill** clone từ GitHub. KHÔNG edit.

| File | Khi nào đọc |
|---|---|
| `SKILL.md` (810 lines) | Đọc 1 lần khi onboard. Hiểu methodology + 4 common patterns |
| `references/node_types.md` (22KB) | **Mở khi build mỗi node** — copy schema vào file của mình |
| `references/workflow_structure.md` | Đọc khi quên top-level structure |
| `references/edge_types.md` | Đọc khi cần fail-branch, if-else, iteration edges |
| `references/node_positioning.md` | (Optional) Khi muốn canvas đẹp |
| `assets/simple_llm_workflow.yml` | Base cho task đơn giản |
| `assets/conditional_workflow.yml` | Base cho task có if-else |
| `assets/error_handling_workflow.yml` | Base cho task cần xử lý lỗi |

**2 scripts quan trọng**:
```bash
# Tạo unique IDs
python3 skills/mango-svip/scripts/generate_id.py 5   # → 5 IDs

# Validate YAML
python3 skills/mango-svip/scripts/validate_workflow.py path/to/file.yml
```

### 4.2 `corpus/awesome-dify-workflow/`

**Reference corpus** — 40+ working YAML. KHÔNG edit.

Tìm pattern bằng grep:
```bash
cd /Users/quyenbt/Desktop/MyProjects/dify-projects/corpus/awesome-dify-workflow/DSL

# Tìm file có document-extractor
grep -l "document-extractor" *.yml

# Tìm file có iteration
grep -l "type: iteration" *.yml

# Tìm file có HTTP request
grep -l "type: http-request" *.yml

# Tìm file có template-transform (Jinja2)
grep -l "template-transform" *.yml
```

Hoặc xem theo task type (tên file gợi ý):
- `*translation*` → multi-step LLM
- `*Iteration*` → bulk processing
- `*RAG*` hoặc `*knowledge*` → knowledge retrieval
- `File_read.yml` → file input pattern

### 4.3 `templates/`

**Vitalify-specific** templates. ĐƯỢC edit + add mới.

Mỗi template:
- File `.yml` đã validate
- Có comment `# TODO:` ở chỗ cần customize
- Có version `0.6.0` match env Eiken
- Dùng plugin của workspace khách

### 4.4 `docs/`

Documentation team-specific. Hiện có:
- `GUIDE.md` (file này) — operations guide

Sẽ bổ sung khi scope mở rộng (decision tree, conventions, troubleshooting log).

---

## 5. Quy trình build task mới — 5 bước

### Bước 1: Phân rã task

Trả lời 5 câu:

| Câu hỏi | Quyết định |
|---|---|
| Input là gì? | Start node config: text / file / number / select |
| Output là gì? | End node config: text / file / structured |
| Cần xử lý nhiều items (lặp)? | Có Iteration node hay không |
| Có rẽ nhánh điều kiện? | Có If-Else hay không |
| Có gọi API ngoài / plugin? | HTTP node hoặc Tool node |

Vẽ flow đơn giản bằng text:
```
Start → Node A → Node B → ... → End
```

### Bước 2: Tìm pattern tương tự

**Cách tốt nhất** — dùng index có sẵn (51 file đã được index theo feature):

```bash
# Browse trực quan
open INDEX.md

# CLI search theo feature
python3 tools/dify_base/find.py --has iteration
python3 tools/dify_base/find.py --has http-request --no llm
python3 tools/dify_base/find.py --has file-input --has code
python3 tools/dify_base/find.py --complexity Simple
python3 tools/dify_base/find.py --plugin md_exporter
python3 tools/dify_base/find.py --name translation
python3 tools/dify_base/find.py --source eiken-prod         # Chỉ tìm trong production của khách
python3 tools/dify_base/find.py --has iteration --full      # Show full info
```

**Available features** (cho `--has` / `--no`): `iteration, loop, code, llm, http-request, tool, if-else, document-extractor, knowledge-retrieval, agent, file-input, template-transform, parameter-extractor`

**Thứ tự ưu tiên khi pick reference**:
1. `templates/` (Vitalify) — match env Eiken nhất
2. `eiken-prod` — workflow production của khách
3. `corpus/` — community examples
4. `assets/` — bare-minimum skeleton

**Nếu thêm template mới**, rebuild index:
```bash
python3 tools/dify_base/build_index.py
```

### Bước 3: Generate IDs

```bash
cd /Users/quyenbt/Desktop/MyProjects/dify-projects
python3 skills/mango-svip/scripts/generate_id.py <N>
# N = số node cần
```

Note: Cho Iteration node, **iteration-start node ID** = `<iteration_id>start` (vd: `1778674652469start`).

### Bước 4: Build YAML

Copy pattern reference vào file mới:
```bash
cp templates/xlsx_iteration_proofread.yml templates/<new_task>.yml
# Hoặc copy từ corpus example
```

Edit:
1. **Top-level**: đổi `app.name`, `app.description`, `app.icon`
2. **Dependencies**: thêm/bớt plugin (xem [section 7](#7-conventions))
3. **Nodes**: thay IDs cũ bằng IDs mới (Find & Replace), customize `data` mỗi node
4. **Edges**: update IDs trong edges để match nodes mới
5. **Variable references**: update `{{#<node_id>.<field>#}}` cho đúng IDs mới

→ Reference `skills/mango-svip/references/node_types.md` mỗi khi quên field nào.

### Bước 5: Validate + Test

```bash
# Validate structure
python3 skills/mango-svip/scripts/validate_workflow.py templates/<new_task>.yml

# Nếu PASS → import vào Dify khách → test với data thật
# Nếu FAIL → đọc error, fix
```

---

## 6. Decision Tree — Chọn pattern theo task type

```
┌─ Task của bạn:
│
├── Đơn giản: 1 input → 1 LLM call → 1 output
│   └─→ Base: skills/mango-svip/assets/simple_llm_workflow.yml
│
├── Cần rẽ nhánh theo điều kiện
│   └─→ Base: skills/mango-svip/assets/conditional_workflow.yml
│       Nodes: Start → If-Else → [2 branches] → Variable-Aggregator → End
│
├── Cần xử lý lỗi (không crash khi 1 node fail)
│   └─→ Base: skills/mango-svip/assets/error_handling_workflow.yml
│       Nodes: Code (error_strategy: fail-branch) → 2 paths → Aggregator
│
├── Lặp qua list/file nhiều items (>5)
│   └─→ Reference: templates/xlsx_iteration_proofread.yml
│       Hoặc: corpus/.../Text to Card Iteration.yml
│       Nodes: Code (split list) → Iteration → Code (aggregate)
│
├── Upload file (PDF/xlsx/CSV/Word)
│   └─→ Reference: templates/xlsx_iteration_proofread.yml (Start + Document Extractor)
│       Plugin: built-in (không cần install thêm)
│
├── Gọi API ngoài (REST endpoint custom)
│   └─→ Reference: corpus/.../Jina Reader Jinja.yml
│       Node: http-request
│       Schema: skills/mango-svip/references/node_types.md → section "http-request"
│
├── Output file CSV/Markdown/PDF
│   └─→ Plugin: bowenliang123/md_exporter
│       Reference: templates/xlsx_iteration_proofread.yml (Tool node cuối)
│
├── RAG (knowledge base Q&A)
│   └─→ Reference: P2_S_no2.yml (trong eiken-dify project)
│       Node: knowledge-retrieval
│       Schema: node_types.md → section "knowledge-retrieval"
│
├── Multi-step LLM (refine, translate-then-improve)
│   └─→ Reference: corpus/.../translation_workflow.yml
│       Reference: corpus/.../宝玉的英译中优化版.yml
│
├── Classification (route theo nội dung)
│   └─→ Node: question-classifier
│       Schema: node_types.md → section "question-classifier"
│
└── Agent (autonomous với tools)
    └─→ Node: agent
        Schema: node_types.md → section "agent"
```

---

## 7. Conventions

### 7.1 Schema versioning

| Item | Quy ước |
|---|---|
| DSL version | `0.6.0` (match env Eiken hiện tại) |
| Khi Dify update version | Build test 1 template với version mới, không migrate hàng loạt |
| Plugin marketplace identifier | Copy nguyên hash từ W01.yml hoặc P2_S_no2.yml của khách |

### 7.2 Naming

| Loại | Format | Ví dụ |
|---|---|---|
| File template | `<input>_<pattern>_<output>.yml` | `xlsx_iteration_proofread.yml` |
| App name | `【VF作成】<task name>` | `【VF作成】Stem校閲_84問` |
| Node title | Tiếng Nhật (nếu khách Nhật) hoặc EN | `Excelファイル入力`, `テキスト抽出` |
| Variable name | snake_case, English | `csv_text`, `items_summary` |

### 7.3 Code node (Python)

- Luôn dùng `code_language: python3`
- Function entry: `def main(<args>) -> dict:`
- Return type: dict với keys match `outputs` schema
- Comment `# TODO:` cho phần cần customize sau
- Handle null/empty: dùng helper `clean()` như trong template hiện tại

### 7.4 Plugin set chuẩn (Eiken env)

| Plugin | Dùng cho | Version dependency string |
|---|---|---|
| `langgenius/gemini` | LLM | `0.7.20@de0063a630a6d1b2c025fb84f3462ba5151fb60618309cd595c3f4711b1df847` |
| `bowenliang123/md_exporter` | Export CSV/Markdown | `3.6.9@3f027d63e80b44d5d5a9f706871afaef37905b8f8a89a2d152dc530211a8acb1` |
| `langgenius/openai` | OpenAI direct | (xem P2_S_no2.yml) |
| `langgenius/gemini_image` | Image gen | (xem P2_S_no2.yml) |

→ Copy exact string từ existing yml để tránh hash mismatch.

### 7.5 Mock-first principle

Khi API/LLM ngoài chưa sẵn sàng:
1. Dùng **Code node passthrough** thay tạm (như template hiện tại)
2. Comment `# TODO: Replace with HTTP node calling <API>` rõ ràng
3. Output schema giống y future-real → khi swap không cần đổi downstream

---

## 8. Troubleshooting

### Lỗi import vào Dify thường gặp

| Error message | Nguyên nhân | Fix |
|---|---|---|
| "Plugin not installed" | Plugin trong `dependencies` chưa cài trên workspace | Cài plugin trong Dify trước, hoặc xoá khỏi dependencies nếu không dùng |
| "Plugin version mismatch" | Hash trong YAML khác version đang cài | Update hash trong YAML để match version đang cài |
| "Invalid edge: node not found" | Edge tham chiếu node_id không tồn tại | Search node_id, đảm bảo node đó có trong `nodes:` array |
| "Variable reference error" | `{{#node_id.field#}}` sai | Verify field name khớp với `outputs` của source node |
| "Iteration input type mismatch" | `iterator_input_type` không match output của upstream | Check upstream code node `outputs` type = `array[string]` |
| Import "succeeds" nhưng workflow không chạy | Edge sai sourceHandle (vd dùng `source` cho if-else mà cần `true`/`false`) | Đọc lại `references/edge_types.md` |

### Runtime errors

| Error | Cause | Fix |
|---|---|---|
| Code node `Module not found` | Sandbox không có lib | Check sandbox doc; thường chỉ có stdlib + một số lib whitelist |
| Iteration node timeout | Quá nhiều items hoặc API chậm | Giảm `parallel_nums`, tăng timeout, hoặc batch |
| Document extractor trả text rỗng | File format không support | Convert sang format khác (xlsx → csv) trước upload |

### Validation script báo lỗi

```bash
python3 skills/mango-svip/scripts/validate_workflow.py templates/<file>.yml
```

| Output | Nghĩa |
|---|---|
| `✅ Workflow validation passed!` | Structure OK, nhưng vẫn cần test import |
| `❌ Duplicate node IDs` | Có ID trùng → regenerate IDs |
| `❌ Edge references non-existent node` | Edge trỏ tới node không có → fix edge.source/target |
| `❌ Missing required field` | Node thiếu field bắt buộc → đọc node_types.md |

---

## 9. Khi nào & cách mở rộng workshop

### Khi nào thêm template mới
- Build task không tìm thấy pattern trong `templates/` lẫn `corpus/`
- Pattern dự đoán sẽ reuse cho nhiều task

→ Save vào `templates/<name>.yml` + thêm 1 dòng note vào README.md mục "Template hiện có".

### Khi nào update workshop
| Event | Action |
|---|---|
| Dify release version mới | Test 1 template với version mới, ghi findings vào `docs/changelog.md` |
| Plugin update | Update version hash trong [Conventions section 7.4](#74-plugin-set-chuẩn-eiken-env) |
| Bug import lặp nhiều lần | Ghi vào `docs/troubleshooting.md` |
| Team có quy ước mới | Update [Conventions](#7-conventions) |

### Khi nào scope-up workshop (sang Medium / Full)

| Trigger | Scope mới |
|---|---|
| 5+ template tích lũy | Medium: build `templates/INDEX.md` + `docs/decision_tree.md` |
| 3+ project khác cùng dùng Dify | Medium: tách workshop thành repo riêng |
| Team có 5+ engineer build Dify | Full: package thành Claude Code skill (`eiken-dify-builder/`), setup CI validation |

---

## 10. Recipes & Walkthroughs

Task-specific migration/upgrade guides. Add 1 mục mới mỗi khi gặp pattern reusable.

### 10.1 Swap mock proofread → real DeepL HTTP

Template `templates/xlsx_iteration_proofread.yml` hiện dùng Code node "モック校閲 (DeepL代替)" với output `[MOCK] <text>`. Khi DeepL Write API spec sẵn sàng, swap như sau:

**Recommended: Restructure để dùng HTTP node trực tiếp**

#### Step 1: Setup env variable

Trong Dify workspace của khách:
- Workflow Editor → **Environment Variables** → Add `DEEPL_API_KEY` (type: secret)
- Reference trong workflow: `{{#env.DEEPL_API_KEY#}}`

#### Step 2: Upstream code node — đổi output type

Trong node `Excelをパースして336文を生成`:
- Đổi `outputs.fulltexts.type`: `array[string]` → `array[object]`
- Trong code, không gọi `json.dumps()` cho mỗi fulltext object, append object trực tiếp:
  ```python
  # Before:
  fulltexts.append(json.dumps({...}, ensure_ascii=False))
  # After:
  fulltexts.append({...})
  ```

#### Step 3: Iteration node config

Đổi `iterator_input_type: array[object]`. Trong inner nodes:
- **DELETE** node "モック校閲 (DeepL代替)" (code `1778674652471`)
- **ADD** HTTP Request node, sample config:

```yaml
- data:
    type: http-request
    title: "DeepL Write API"
    method: POST
    url: 'https://api.deepl.com/v2/write/rephrase'   # Confirm exact endpoint per khách
    authorization:
      type: api-key
      config:
        type: bearer
        api_key: '{{#env.DEEPL_API_KEY#}}'
    headers: |
      Content-Type: application/json
    params: ''
    body:
      type: json
      data:
        - key: text
          type: text
          value: '{{#1778674652469.item.fulltext#}}'   # iter_id.item.<field>
        - key: target_lang
          type: text
          value: EN-US
    timeout:
      connect: 10
      read: 30
      write: 30
    error_strategy: default-value
    default_value:
      body: '{"text": "[ERROR]"}'
  id: <new_node_id>
  type: custom
  # ... position, width, parentId, isInIteration, iteration_id
```

#### Step 4: Iteration output_selector

Đổi `output_selector` của Iteration trỏ về HTTP node's `body` field thay vì code's `result`:
```yaml
output_selector:
- '<http_node_id>'
- body
```

#### Step 5: Downstream code (Markdownテーブル) — update parsing

Iteration giờ output `array[object]` chứa HTTP response, không phải JSON strings. Update parsing:
```python
# Before:
for r in results:
    d = json.loads(r)
    ...
# After:
for r in results:
    # r is HTTP body object — extract DeepL response text
    proofread_text = r.get("text") if isinstance(r, dict) else str(r)
    ...
```

Cần kết hợp với `items_summary` upstream để link result về đúng row_no + choice_idx (vì HTTP body chỉ có text, mất metadata).

→ **Alternative**: Thêm 1 Code node "merge" inside iteration sau HTTP, gộp lại item + HTTP response để giữ metadata. 3-node inside iteration (extract → http → merge) — verbose hơn nhưng giữ structure cũ.

#### Step 6: Validate + test

```bash
python3 tools/dify_base/build_index.py     # Refresh index
python3 skills/mango-svip/scripts/validate_workflow.py templates/xlsx_iteration_proofread.yml
```

Test với 1-2 dòng Excel trước khi run full 84 items để tránh tốn API quota.

---

## 11. References

### External resources
- [Dify Official Docs](https://docs.dify.ai/)
- [Dify GitHub](https://github.com/langgenius/dify)
- [mango-svip/dify-workflow-skills](https://github.com/mango-svip/dify-workflow-skills) — source của external skill
- [svcvit/Awesome-Dify-Workflow](https://github.com/svcvit/Awesome-Dify-Workflow) — source của corpus

### Internal references
- [README.md](../README.md) — overview
- [Template hiện tại](../templates/xlsx_iteration_proofread.yml) — example đầy đủ
- W01.yml trong eiken-dify project — env-specific reference

### Cheatsheet 1 dòng cho mỗi tool
```bash
# Generate IDs
python3 skills/mango-svip/scripts/generate_id.py 5

# Validate YAML
python3 skills/mango-svip/scripts/validate_workflow.py <file>.yml

# Build/refresh index (sau khi thêm template mới)
python3 tools/dify_base/build_index.py

# Find template theo feature
python3 tools/dify_base/find.py --has iteration --has file-input
python3 tools/dify_base/find.py --complexity Simple --has llm
python3 tools/dify_base/find.py --name <keyword>

# Find schema 1 node type
grep -A 30 "^### .*<node_type>" skills/mango-svip/references/node_types.md
```

---

**Tóm lại quy trình chuẩn**:

```
Phân rã task (5 câu) 
  → Tìm pattern (templates → corpus → assets)
  → Generate IDs
  → Build YAML (copy + customize, reference node_types.md)
  → Validate
  → Import test
  → Save vào templates/ nếu reusable
```
