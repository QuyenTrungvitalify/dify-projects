# G02 — Trợ lý hỏi-đáp nội quy cho nhân viên mới, nhớ ngữ cảnh câu trước (VI)

```
Bên mình có cái sổ tay nội quy công ty (1 file PDF dài), nhân viên mới hay hỏi linh tinh:
nghỉ phép thế nào, đi trễ có bị trừ lương không, wifi mật khẩu gì...
Mình muốn làm một trợ lý để nhân viên mới nhắn hỏi, nó dựa vào sổ tay trả lời.
Cái mình cần là nó nói chuyện được liên tục: ví dụ hỏi "nghỉ phép mấy ngày một năm"
nó trả lời xong, mình hỏi tiếp "thế xin trước bao lâu" thì nó phải hiểu là mình vẫn đang hỏi về nghỉ phép,
chứ không phải bắt mình hỏi lại từ đầu mỗi lần.
Cái gì trong sổ tay không có thì nói không có, đừng chế.
```

## Bối cảnh giả định
HR/admin công ty VN làm trợ lý onboarding. Ràng buộc **nhớ ngữ cảnh liên tục** được user mô tả bằng
ví dụ cụ thể rất rõ ("thế xin trước bao lâu" → hiểu vẫn đang nói nghỉ phép) — đây là yêu cầu hội
thoại KHÔNG THỂ nhầm, khác hẳn Q&A một-phát.

## Trục năng lực được thử
**Chatflow hội thoại nhớ ngữ cảnh** = mẫu #2 cho **finding H** (đợt 4 G02: user xin "chatbot" →
build ra `mode: workflow` không nhớ). Ở đây user tả follow-up tường minh — nếu build LẠI ra
`mode: workflow` không memory thì finding H lên n=2 (đủ nghi cơ chế); nếu ra `advanced-chat` +
memory thì H là nhiễu 1 lần. RAG không bịa dataset (nền cũ). Lang VI.

## Hình dạng build tốt
- `mode: advanced-chat` (chatflow) với `sys.query` + memory bật — vì user đòi follow-up hiểu ngữ cảnh.
- knowledge-retrieval trỏ dataset (placeholder + TODO, KHÔNG bịa id) → LLM có `memory.enabled: true`
  để mang lịch sử hội thoại → trả lời + "không có trong sổ tay" khi thiếu.
- Digest/SPEC/notes tiếng Việt.

## Bẫy đã biết
Đây là bài kiểm tra ① CÓ nhận ra ý định hội thoại không (đợt 4 trượt: "chatbot" → workflow) — lần này
tín hiệu mạnh hơn nhiều (mô tả follow-up) · chatflow cần `answer` node không phải `end` · memory bật
đúng chỗ (LLM node) · vẫn không bịa dataset id · "không có thì nói không có" như đợt trước.

## MANUAL dự kiến
Nạp PDF + dataset + model → hỏi chuỗi 2-3 câu nối tiếp ("nghỉ phép mấy ngày" → "xin trước bao lâu")
xem có giữ ngữ cảnh không · 1 câu ngoài sổ tay test fallback.
