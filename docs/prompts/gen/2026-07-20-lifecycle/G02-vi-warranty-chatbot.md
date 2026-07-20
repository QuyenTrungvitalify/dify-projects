# G02 — Chatbot tra cứu chính sách bảo hành cho đội CSKH (VI, chatflow + tài liệu)

```
Bên mình bán đồ gia dụng, khách nhắn hỏi về bảo hành suốt ngày: cái này bảo hành mấy năm,
rơi vỡ có được đổi không, mất hóa đơn thì sao...
Mình có 3 file PDF: chính sách bảo hành, quy trình đổi trả, và bảng thời hạn theo nhóm sản phẩm.
Mình muốn một con chatbot cho đội CSKH tra nhanh: hỏi là nó trả lời dựa đúng theo mấy tài liệu đó,
kèm cả đoạn nó trích từ tài liệu nào để mình kiểm tra lại được.
Cái nào trong tài liệu không có thì phải nói thẳng là "không có thông tin trong tài liệu",
đừng đoán bừa, và nhắc người hỏi chuyển câu hỏi cho trưởng nhóm.
```

## Bối cảnh giả định
Chủ shop gia dụng VN, đội CSKH 4 người tra tay 3 file PDF mỗi ngày. Cần trích nguồn để double-check
— nhu cầu kiểm soát thật của người quản lý. Bot cho NỘI BỘ (đội CSKH), không phải chat trực tiếp
với khách.

## Trục năng lực được thử
**Chatflow (advanced-chat) LẦN ĐẦU trong campaign** (P06 là đợt tay) · **knowledge-retrieval +
dataset id KHÔNG bịa** (id là workspace-local — build phải để TODO/hướng dẫn tạo KB, không phịa
id; lớp lỗi P06) · trích nguồn kèm câu trả lời · **từ chối có lối thoát** ("không có thông tin" +
nhắc chuyển trưởng nhóm — cả hai vế) · lang-sync VI.

## Hình dạng build tốt
- `mode: advanced-chat`: start → knowledge-retrieval (3 KB hoặc 1 KB gộp — quyết định khai trong
  SPEC) → LLM với system prompt: chỉ trả lời từ context, trích kèm nguồn đoạn, không có thì nói
  đúng câu user dặn + nhắc chuyển trưởng nhóm → answer.
- Dataset id để TODO + notes hướng dẫn user tạo Knowledge trong Dify rồi trỏ vào — không bịa id.
- Digest/SPEC/notes tiếng Việt.

## Bẫy đã biết
Bịa dataset id 13 chữ số (lớp P06) · retrieval rỗng nhưng LLM vẫn "chém" từ kiến thức nền — prompt
phải khóa "chỉ từ đoạn trích" · trích nguồn kiểu "tài liệu 1" vô nghĩa với user — cần tên
file/tiêu đề đoạn · quên vế "chuyển trưởng nhóm" (chỉ nói không biết là mới nửa yêu cầu) ·
chatflow cần `answer` node chứ không phải `end` (khác workflow — validator bắt).

## MANUAL dự kiến
Tạo 3 KB thật từ 3 PDF · hỏi câu CÓ trong tài liệu (xem trích đúng đoạn?) · câu KHÔNG có ("máy bay
phản lực bảo hành mấy năm") xem có nói thẳng + nhắc chuyển trưởng nhóm không · câu nửa-có (rơi vỡ =
lỗi người dùng, tài liệu nói gián tiếp) xem đoán hay thoát đúng.
