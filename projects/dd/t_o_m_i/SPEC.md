# Workflow LLM đơn giản

**Proposed slug / name**
- slug: `simple_llm`
- name: Workflow LLM đơn giản

**Goal**
Một workflow tối giản: nhận một đoạn văn bản đầu vào từ người dùng, đưa qua một node LLM để xử lý, và trả về kết quả. Đây là khung sườn single-LLM cơ bản để người dùng mở rộng sau này.

**Chosen shape** — `start → llm → end`
Chỉ có đúng một bước suy luận (một node `llm`), không có nhánh, vòng lặp, gọi công cụ hay truy xuất tri thức — nên đây là một transform single-LLM thuần túy dạng một-vào-một-ra.

**Nodes**

| id-placeholder | type | purpose |
| --- | --- | --- |
| start | start | Thu thập biến đầu vào `input` (văn bản người dùng nhập) |
| llm | llm | Node xử lý duy nhất — nhận đầu vào và sinh kết quả theo prompt |
| end | end | Trả về kết quả cuối cùng `output` |

**Variable flow**
- `{{#start.input#}}` → llm.prompt (đầu vào của người dùng được đưa vào prompt của node LLM)
- `{{#llm.text#}}` → end.output (văn bản do LLM sinh ra là kết quả trả về)

**Plugins**
- Node `llm` cần một model plugin. `# TODO: add plugin hash from target workspace` (hash thật sẽ được thêm sau từ workspace đích — không bịa `@sha256`).

## Acceptance Criteria
- Workflow gồm đúng ba node theo thứ tự: `start → llm → end`.
- Node `start` khai báo một biến đầu vào văn bản (`input`).
- Node `llm` nhận `{{#start.input#}}` làm đầu vào của prompt.
- Node `end` trả về `{{#llm.text#}}` dưới dạng đầu ra `output`.
- Cấu trúc một-vào-một-ra: đúng một đầu vào và đúng một đầu ra, không có node bị treo (dangling).

**Open questions**
- Cần chọn model/plugin cụ thể cho node `llm` (hash lấy từ workspace đích — hiện để `# TODO`).
- Yêu cầu `tạo mới 1 llm workflow đơn giản` không nêu rõ mục đích cụ thể của phép biến đổi (dịch, tóm tắt, sinh nội dung…) hay ngôn ngữ đầu ra; prompt của node `llm` đang để mở và có thể cần làm rõ trước khi triển khai.
