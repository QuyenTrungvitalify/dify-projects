# Dify Base — Operations Guide

> Tóm tắt nhanh: xem [README.md](../README.md). Thiết kế kiến trúc + roadmap: xem [architecture.md](architecture.md).

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
| Không biết bắt đầu từ đâu | `skills/mango-svip/assets/` (3 skeleton) + `templates/` (project-specific) |
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
python3 skills/mango-svip/scripts/validate_workflow.py ../../templates/patterns/file-iteration.yml
# → ✅ Workflow validation passed!

# 2. Import file vào Dify
# - Mở Dify workspace
# - Studio → Import DSL file → chọn templates/patterns/file-iteration.yml
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
version: 0.6.0                # DSL version — match your target Dify workspace
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

**project-specific** templates. ĐƯỢC edit + add mới.

Mỗi template:
- File `.yml` đã validate
- Có comment `# TODO:` ở chỗ cần customize
- Có version `0.6.0` match your target Dify workspace
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
python3 tools/dify_base/find.py --source project            # Chỉ tìm trong projects/ của bạn
python3 tools/dify_base/find.py --has iteration --full      # Show full info
```

**Available features** (cho `--has` / `--no`): `iteration, loop, code, llm, http-request, tool, if-else, document-extractor, knowledge-retrieval, agent, file-input, template-transform, parameter-extractor`

**Thứ tự ưu tiên khi pick reference**:
1. `patterns/` — 4 base patterns đã build cho workspace
2. `project` — workflow đã có trong projects/<your>/workflows/
3. `corpus/` — community examples
4. `skill-assets/` — bare-minimum skeleton từ Claude skills

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
cp templates/patterns/file-iteration.yml templates/<new_task>.yml
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
│   └─→ Reference: templates/patterns/file-iteration.yml
│       Hoặc: corpus/.../Text to Card Iteration.yml
│       Nodes: Code (split list) → Iteration → Code (aggregate)
│
├── Upload file (PDF/xlsx/CSV/Word)
│   └─→ Reference: templates/patterns/file-iteration.yml (Start + Document Extractor)
│       Plugin: built-in (không cần install thêm)
│
├── Gọi API ngoài (REST endpoint custom)
│   └─→ Reference: corpus/.../Jina Reader Jinja.yml
│       Node: http-request
│       Schema: skills/mango-svip/references/node_types.md → section "http-request"
│
├── Output file CSV/Markdown/PDF
│   └─→ Plugin: bowenliang123/md_exporter
│       Reference: templates/patterns/file-iteration.yml (Tool node cuối)
│
├── RAG (knowledge base Q&A)
│   └─→ Reference: templates/patterns/rag-qa.yml
│       Node: knowledge-retrieval
│       Schema: node_types.md → section "knowledge-retrieval"
│
├── Multi-step LLM (refine, translate-then-improve)
│   └─→ Reference: templates/patterns/multi-step-llm.yml
│       Reference: corpus/.../translation_workflow.yml
│       Reference: corpus/.../宝玉的英译中优化版.yml
│
├── Classification (route theo nội dung)
│   └─→ Node: question-classifier
│       Schema: node_types.md → section "question-classifier"
│
└── Agent (autonomous với tools)
    └─→ Reference: templates/patterns/agent-with-tools.yml
        Node: agent
        Schema: node_types.md → section "agent"
```

---

## 7. Conventions

### 7.1 Schema versioning

| Item | Quy ước |
|---|---|
| DSL version | `0.6.0` — hiện tại từ Dify source (`api/services/app_dsl_service.py: CURRENT_DSL_VERSION`) |
| Khi Dify update version | Re-run `python3 schemas/gen_schema.py` để regenerate JSON Schema; test 1 template với version mới trước khi migrate hàng loạt |
| Plugin marketplace identifier | Copy nguyên hash từ workflow đã export ra từ target workspace (hash đổi theo plugin version) |

### 7.2 Naming

| Loại | Format | Ví dụ |
|---|---|---|
| File template | snake_case mô tả `<input>_<pattern>_<output>.yml` | `pdf_rag_summary.yml`, `csv_iterate_translate.yml` |
| App name (trong YAML) | Free-form. Có thể prefix team/client nếu cần (vd `[Team] Task name`) | `RAG Q&A`, `Translation Refine` |
| Node title | Free-form (EN/JP/VI). Ngắn gọn mô tả chức năng | `File Input`, `Extract Text`, `Refine LLM` |
| Variable name | snake_case, English | `source_text`, `items_summary` |

### 7.3 Code node (Python)

- Luôn dùng `code_language: python3`
- Function entry: `def main(<args>) -> dict:`
- Return type: dict với keys match `outputs` schema
- Comment `# TODO:` cho phần cần customize sau
- Handle null/empty defensively (input từ document-extractor có thể là `None` hoặc empty string)

### 7.4 Plugin set

Plugin hash format: `<provider>/<plugin>:<version>@<sha256>`. Hash đổi theo plugin version → copy exact từ workflow đã export ra từ target workspace, đừng hard-code.

Common plugins (đặt vào `dependencies:` của YAML khi cần):

| Plugin | Use case |
|---|---|
| `langgenius/openai` | OpenAI models (GPT-4, etc.) |
| `langgenius/anthropic` | Claude models |
| `langgenius/gemini` | Gemini models |
| `langgenius/deepl` | DeepL Translate/Write API |
| `bowenliang123/md_exporter` | Export Markdown → CSV/Excel file |
| `langgenius/google_search` | Web search tool cho agent |

→ Check available plugins ở [marketplace.dify.ai](https://marketplace.dify.ai/) trước khi commit plugin choice vào pattern.

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
| Plugin update | Update version hash trong [Conventions section 7.4](#74-plugin-set) |
| Bug import lặp nhiều lần | Ghi vào `docs/troubleshooting.md` |
| Team có quy ước mới | Update [Conventions](#7-conventions) |

### Khi nào scope-up workshop (sang Medium / Full)

| Trigger | Scope mới |
|---|---|
| 5+ template tích lũy | Medium: build `templates/INDEX.md` + `docs/decision_tree.md` |
| 3+ project khác cùng dùng Dify | Medium: tách workshop thành repo riêng |
| Team có 5+ engineer build Dify | Full: package tools/dify_base/ thành pip-installable, setup CI validation |

---

## 10. Recipes & Walkthroughs

Task-specific migration/upgrade guides. Add 1 mục mới mỗi khi gặp pattern reusable.

### 10.1 Swap mock processor → real LLM/HTTP node trong iteration

Pattern `templates/patterns/file-iteration.yml` dùng Code node passthrough (`# TODO: Replace with LLM / HTTP / Tool node`) bên trong iteration. Swap sang real API như sau.

#### Option A: Swap sang HTTP Request (custom REST API)

**Step 1**: Setup env variable trong Dify workspace
- Workflow Editor → Environment Variables → Add `API_KEY` (type: secret)
- Reference: `{{#env.API_KEY#}}`

**Step 2**: Trong iteration, replace Code "Process Item" bằng HTTP Request node:

```yaml
- data:
    type: http-request
    title: "Call external API"
    method: POST
    url: 'https://api.example.com/endpoint'
    authorization:
      type: api-key
      config:
        type: bearer
        api_key: '{{#env.API_KEY#}}'
    headers: 'Content-Type: application/json'
    body:
      type: json
      data:
        - key: text
          type: text
          value: '{{#<iteration_node_id>.item#}}'   # iter_id.item or iter_id.item.<field>
    timeout: { connect: 10, read: 30, write: 30 }
    error_strategy: default-value
    default_value:
      body: '{"result": "[ERROR]"}'
    isInIteration: true
    iteration_id: '<iteration_node_id>'
  id: <new_node_id>
  parentId: '<iteration_node_id>'
  type: custom
```

**Step 3**: Update Iteration `output_selector` → HTTP node's `body`:
```yaml
output_selector: ['<http_node_id>', body]
output_type: array[object]
```

**Step 4**: Downstream aggregator code phải parse `array[object]` thay vì JSON strings:
```python
for r in results:
    # r is HTTP body object — extract field as needed
    text = r.get("result") if isinstance(r, dict) else str(r)
```

#### Option B: Swap sang LLM node (Claude/GPT/Gemini)

Đơn giản hơn — chỉ thay Code bằng LLM node. Pass `{{#<iteration_id>.item#}}` qua user prompt. Output đã là string nên downstream code không cần đổi parsing.

#### Option C: Swap sang Tool node (plugin)

Nếu có plugin đã cài (vd `langgenius/deepl` cho Translate API), dùng Tool node thay HTTP. Đơn giản hơn vì không phải config auth.

#### Validate + test

```bash
python3 tools/dify_base/build_index.py
python3 skills/mango-svip/scripts/validate_workflow.py projects/<your>/workflows/main.yml

# Test với 1-2 items trước khi run full để tránh tốn API quota
DIFY_PROJECT=<your> .venv/bin/pytest tests/ -v
```

---

## 11. References

### External resources
- [Dify Official Docs](https://docs.dify.ai/)
- [Dify GitHub](https://github.com/langgenius/dify)
- [mango-svip/dify-workflow-skills](https://github.com/mango-svip/dify-workflow-skills) — source của external skill
- [svcvit/Awesome-Dify-Workflow](https://github.com/svcvit/Awesome-Dify-Workflow) — source của corpus

### Internal references
- [README.md](../README.md) — overview
- [Template hiện tại](../templates/patterns/file-iteration.yml) — example đầy đủ
- [JSON Schema generated](../schemas/dify-dsl-0.6.0.json) cho Dify DSL v0.6.0 (27 NodeData)

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
