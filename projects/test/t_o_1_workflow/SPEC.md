# Chatbot LLM đơn giản

**Proposed slug / name**
- slug: `simple_chatbot`
- name: Chatbot LLM đơn giản

**Goal**
Một chatbot hội thoại đơn giản: người dùng nhập tin nhắn, một node LLM sinh câu trả lời và trả về trực tiếp cho người dùng.

**Chosen shape**
`start → llm → code → answer` (advanced-chat). Một node `llm` xử lý câu hỏi của người dùng và tạo ra câu trả lời, sau đó một node `code` hậu xử lý (chuẩn hoá + chèn footer test) trước khi trả về. Không có nhánh hay công cụ nào khác — luồng vẫn một-vào-một-ra.

**Nodes**

| id-placeholder | type | purpose |
| --- | --- | --- |
| start | start | nhận tin nhắn của người dùng (biến hội thoại `sys.query`) |
| llm | llm | prompt trả lời hội thoại — nhận câu hỏi người dùng và sinh câu trả lời |
| code | code | hậu xử lý câu trả lời của LLM (cắt khoảng trắng, guard rỗng, chèn footer test) |
| answer | answer | trả câu trả lời đã hậu xử lý về cho người dùng |

**Variable flow**
- `{{#sys.query#}}` → llm (user prompt / biến trong prompt của node llm)
- `{{#llm.text#}}` → code (biến `text` của node code)
- `{{#code.result#}}` → answer.answer

**Chi tiết node dự kiến build**
> Cấu hình cụ thể (id 13 chữ số, plugin hash, toạ độ) do Implement mint sau — dưới đây là ý định build, chưa phải YAML thật.

- **start** (`start`)
  - Node mở đầu của advanced-chat. Không cần khai báo input field tuỳ biến — tin nhắn người dùng đến qua biến hệ thống `sys.query`.
  - Không cấu hình thêm; chỉ là điểm vào của luồng hội thoại.

- **llm** (`llm`)
  - Model: `# TODO` chọn chat model + plugin hash từ workspace đích (ví dụ Anthropic / OpenAI có sẵn trong workspace).
  - Prompt template:
    - (tuỳ chọn) SYSTEM: để trống hoặc một câu trung tính kiểu "Bạn là trợ lý hữu ích." — chưa bắt buộc vì yêu cầu không nêu persona.
    - USER: chứa `{{#sys.query#}}` để đưa câu hỏi người dùng vào.
  - `memory`: bật để giữ ngữ cảnh hội thoại nhiều lượt (mặc định hợp lý cho chatbox); có thể tắt nếu muốn one-shot.
  - Output: `text` (dùng ở node answer).

- **code** (`code`)
  - `code_language: python3`, `def main(text: str) -> dict`, chỉ dùng stdlib.
  - Biến vào: `text` ← `{{#llm.text#}}` (value_selector `[llm_id, text]`).
  - Guard `None`/`""` từ upstream (§4.5): nếu LLM trả rỗng thì thay bằng câu mặc định.
  - Output: `result` (string) — câu trả lời đã chuẩn hoá + footer test.

- **answer** (`answer`)
  - Template answer: `{{#code.result#}}` — trả câu trả lời đã hậu xử lý về người dùng.
  - Node kết thúc luồng, một luồng vào từ `code`, không nhánh ra.

**Plugins**
- Node `llm` cần một model plugin (ví dụ OpenAI / Anthropic / model có sẵn trong workspace đích).
  `# TODO: add plugin hash from target workspace` — hash thật sẽ thêm sau từ workspace đích, không bịa `@sha256`.

## Acceptance Criteria
- Workflow là advanced-chat với đúng bốn node theo thứ tự `start → llm → code → answer`.
- Node `llm` nhận tin nhắn của người dùng (`{{#sys.query#}}`) làm đầu vào.
- Node `code` nhận `{{#llm.text#}}`, hậu xử lý (python3, guard rỗng) và xuất `result`.
- Node `answer` trả về nội dung `{{#code.result#}}` từ node `code`.
- Cấu trúc một-vào → một-ra: mỗi node có đúng một luồng vào và một luồng ra, không có nhánh.

**Open questions**
- Model/plugin cho node `llm` chưa xác định — cần chọn model và thêm plugin hash từ workspace đích (`# TODO`).
- Yêu cầu không nêu system prompt / tính cách / ngôn ngữ trả lời cụ thể; mặc định để prompt hội thoại trung tính. Nếu cần persona hay ngôn ngữ cố định, bổ sung sau.
