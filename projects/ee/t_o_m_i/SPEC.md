# Workflow LLM đơn giản

**Proposed slug / name**
- slug: `simple_llm`
- name: Workflow LLM đơn giản
- (backend sẽ scaffold `projects/ee/simple_llm/` khi confirm ở gate — không tự chạy `init_project.py`)

## Goal
Tạo mới một workflow LLM tối giản: người dùng nhập một đoạn văn bản, đưa qua **một** node
LLM để xử lý, và trả kết quả ra ngoài. Đây là bộ khung 3 node chuẩn (start → llm → end),
không thêm nhánh, tool, file hay code — đúng nghĩa "đơn giản" mà yêu cầu nêu ra.

## Chosen pattern
**Linear single-LLM (start → llm → end), `mode: workflow`.**

Vì sao chọn shape này:
- Yêu cầu chỉ nói "1 llm workflow đơn giản" — không có bước tinh chỉnh nhiều lượt, không
  file input, không knowledge retrieval. Các pattern trong `templates/patterns/`
  (`multi-step-llm`, `file-to-llm`, `rag-qa`) đều thêm node mà yêu cầu không cần.
- Shape 3 node start→llm→end là dạng vetted nhỏ nhất (tham chiếu
  `skills/mango-svip/assets/simple_llm_workflow.yml`), sẽ được nâng lên DSL `0.6.0` khi
  Implement (asset gốc là `0.1.4`).
- `analyze.json` cho `pattern: custom`, `features: [llm]`, `seed: null` → Spec sở hữu toàn
  bộ graph, và graph tối giản là lựa chọn khớp nhất.

## Nodes
| id-placeholder | type  | purpose |
|----------------|-------|---------|
| `START`        | start | Nhận một biến input dạng văn bản (`user_input`, kiểu `paragraph`, bắt buộc). |
| `LLM`          | llm   | Một lần gọi LLM: system prompt là trợ lý tổng quát, user prompt truyền thẳng input của người dùng. |
| `END`          | end   | Xuất kết quả sinh ra từ node LLM dưới biến `result`. |

> id-placeholder ở trên là nhãn tạm; Implement sẽ mint id 13 chữ số qua
> `generate_id.py` và thay thế. Edge chuẩn: `START→LLM`, `LLM→END`.

## Variable flow
- `START.user_input` → prompt user của LLM: `{{#START.user_input#}}`
- `LLM.text` → output của END: biến `result` với `value_selector: [LLM, text]`
  (tham chiếu logic `{{#LLM.text#}}`)

Chuỗi tuyến tính, không forward-reference, mọi ref đều reachable upstream.

## Plugins
- Một model provider cho node LLM (ví dụ `langgenius/openai` hoặc `langgenius/anthropic`).
  `dependencies: []` để trống ở bản nháp.
  ```
  # TODO: hash — lấy marketplace_plugin_unique_identifier thật từ workspace đích khi Implement
  ```
  (Không bịa hash — theo AGENTS.md §4.3.)

## Acceptance Criteria
- Workflow gồm đúng 3 node theo thứ tự tuyến tính: `start` → `llm` → `end`
- Có đúng một node `type: llm` (không thêm tool/code/file/if-else)
- Node `start` khai báo đúng một biến input kiểu văn bản (`paragraph`), `required: true`
- Node `llm` tham chiếu biến input qua `{{#<start_id>.<field>#}}` và field đó tồn tại trong outputs của start
- Node `end` xuất một biến lấy từ `{{#<llm_id>.text#}}`
- One-in → one-out: mỗi node (trừ start/end) có đúng một cạnh vào và một cạnh ra; không có node treo
- `mode: workflow` và `version: 0.6.0`

## Open questions
- Chọn provider/model cụ thể nào (OpenAI vs Anthropic) khi Implement? Mặc định đề xuất một
  model chat phổ biến sẵn có trong workspace đích; điều chỉnh theo plugin đã cài.
- Có cần đặt tên biến input/output khác `user_input`/`result` không? Yêu cầu không nêu, nên
  giữ mặc định.
