# P06 — Chatbot hỏi đáp nội quy công ty từ kho PDF

```
就業規則、経費精算ルール、出張旅費規程などのPDFが10個くらいあります。
社員が「出張のときの日当はいくら？」「有休の繰越は何日まで？」みたいに聞いたら、
該当するルールを引用付きで答えてくれるチャットボットを作りたいです。
ルールに書いていないことを聞かれたら、勝手に推測しないで
「規程に記載がないので総務部に確認してください」と答えてほしいです。
```

## Bối cảnh giả định
Tổng vụ (総務), mệt vì trả lời cùng một câu hỏi mỗi tuần. Yêu cầu then chốt: **có trích dẫn** và
**không được đoán** — người này hiểu rủi ro chatbot bịa quy định.

## Trục năng lực được thử
**advanced-chat mode** (validator đường answer-node) · knowledge-retrieval · grounding + citation ·
hành vi từ chối khi ngoài tài liệu · multi-turn.

## Hình dạng build tốt
- Mode `advanced-chat`: start → knowledge-retrieval → LLM (system cấm trả lời ngoài context, bắt
  quote điều khoản) → answer.
- **Dataset id là workspace-local** (bài học spec 037/{{KNOWLEDGE}}): build không được bịa id — hoặc
  lấy từ workspace facts, hoặc để TODO kèm hướng dẫn user tạo Knowledge trong Dify và upload 10 PDF
  (việc đó nằm NGOÀI workflow — note phải nói rõ).
- Nhánh "không tìm thấy" trả đúng câu 「規程に記載がないので総務部に確認してください」 — kiểm được
  bằng mắt.

## Bẫy đã biết
Validator từng chỉ nhận mode workflow — đường chatflow đã sửa (campaign cũ #6) nhưng đáng liếc lại
· knowledge-retrieval là node có **dataset id** — `checkRunnability` phải flag khi trống · digest
tiếng Nhật, không lộ jargon "knowledge-retrieval" cho user.

## MANUAL dự kiến
Tạo Knowledge + upload 10 PDF thật · chất lượng retrieval trên văn bản quy định JA (chunking) ·
hỏi 5 câu có trong quy định + 3 câu không có, đếm tỉ lệ trích đúng / từ chối đúng.
