# Chatbox ChatGPT

**Proposed slug / name**
- **slug:** `chatgpt_chatbot`
- **name:** `Chatbox ChatGPT`
- Đường dẫn sẽ được backend scaffold khi xác nhận gate: `projects/new/chatgpt_chatbot/`
- File workflow: `main.yml` (mới)

## Goal
Tạo một workflow dạng **chatbox** (hội thoại nhiều lượt) kết nối tới một mô hình LLM của
**ChatGPT (OpenAI)**. Người dùng gõ câu hỏi trong khung chat, workflow gửi câu hỏi tới model
ChatGPT (kèm lịch sử hội thoại để giữ ngữ cảnh), rồi trả lời trực tiếp trở lại khung chat.
Đây là chatbot đa lượt tối giản — không có nhánh, không có công cụ ngoài.

## Chosen pattern (+ why)
- **Pattern:** `custom` chatflow tối giản `start → llm → answer` ở chế độ **`advanced-chat`**.
- **Mẫu tham chiếu đã kiểm chứng:** `corpus/awesome-dify-workflow-en/Workflow-Store/Python Coding Prompt.yml`
  (mode `advanced-chat`, 3 node `start/llm/answer`, complexity **Simple**) — trùng khớp gần như
  hoàn toàn với yêu cầu "chatbox liên kết LLM". Điểm khác biệt duy nhất: mẫu dùng provider
  `deepseek`, ta đổi sang **`openai`** (ChatGPT) theo yêu cầu.
- **Vì sao advanced-chat, không phải workflow:** yêu cầu là "chatbox" → cần khung chat có
  `sys.query` và trí nhớ hội thoại (memory). Chỉ mode `advanced-chat` mới có node `answer`
  và biến hệ thống `sys.query`. Mode `workflow` thuần không phù hợp cho chatbox nhiều lượt.
- Đây là shape đơn một-file, không nhánh → **không** cần `if-else` / `variable-aggregator`.

## Nodes
| id-placeholder | type | purpose |
|---|---|---|
| `<start_id>` | `start` | Điểm vào chatflow. Không cần khai báo biến người dùng — câu hỏi đến qua biến hệ thống `sys.query` của khung chat. |
| `<llm_id>` | `llm` | Gọi model **ChatGPT (OpenAI)**. Có `system` prompt định hình vai "trợ lý hữu ích", bật **memory** (window size 10) để giữ ngữ cảnh nhiều lượt, và nhận câu hỏi hiện tại qua `sys.query`. |
| `<answer_id>` | `answer` | Trả lời trực tiếp: phát nội dung `{{#<llm_id>.text#}}` ra khung chat. |

> **ID:** tất cả `<*_id>` sẽ được **mint từ `generate_id.py`** (13 chữ số timestamp ms, chuỗi
> có dấu nháy) ở Phase ③ — không đặt ID chuỗi thủ công (AGENTS.md §4.1 / §9).

## Variable flow
```
sys.query  ──(query người dùng + memory hội thoại)──▶  <llm_id>
<llm_id>.text  ──▶  <answer_id>.answer   =  {{#<llm_id>.text#}}
```
- `sys.query`: biến hệ thống của chatflow, chứa câu hỏi lượt hiện tại. LLM node ở mode
  `advanced-chat` với memory bật sẽ tự đưa `sys.query` + lịch sử vào lời gọi model.
- `answer` node dùng `{{#<llm_id>.text#}}` — trường `text` nằm trong `outputs` của node `llm`
  và `llm` là node upstream, nên qua được `lint_refs.py` (AGENTS.md §4.2).
- **Tùy chọn** (nếu muốn tường minh): thêm một `prompt_template` role `user` với nội dung
  `{{#sys.query#}}` trong LLM node. Mẫu tham chiếu không có và vẫn chạy nhờ memory — sẽ giữ
  theo mẫu, trừ khi Implement thấy cần.

## Plugins
- **OpenAI (ChatGPT):** cần plugin model provider `langgenius/openai/openai`.
  - Model đề xuất: `gpt-4o-mini` (nhanh, rẻ cho chatbox demo) — hoặc `gpt-4o` nếu cần chất lượng cao hơn.
  - `completion_params`: `temperature` ~ 0.7 (hội thoại tự nhiên; mẫu code dùng 0, ta nới lỏng cho chat).
- **Hash plugin:** để `dependencies: []` kèm `# TODO: add plugin hash from target workspace`.
  **Không** bịa `@<sha256>` — hash thật lấy từ workspace đích lúc push (AGENTS.md §4.3).
- **DSL version:** đặt `version: 0.6.0` ở top-level (AGENTS.md §4.4).

## Open questions
1. **Model cụ thể của ChatGPT?** Mặc định đề xuất `gpt-4o-mini`. Nếu bạn muốn `gpt-4o`,
   `gpt-4-turbo`, hay `gpt-3.5-turbo` thì nêu ở gate.
2. **Persona / system prompt?** Hiện đặt "trợ lý AI hữu ích, trả lời bằng tiếng Việt".
   Nếu cần vai chuyên biệt (vd. hỗ trợ khách hàng, gia sư…) thì bổ sung.
3. **Opening statement / câu hỏi gợi ý** cho khung chat: để trống. Có muốn thêm lời chào mở đầu không?
