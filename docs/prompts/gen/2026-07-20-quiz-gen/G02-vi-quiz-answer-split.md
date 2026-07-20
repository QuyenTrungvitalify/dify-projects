# G02 — Đề trắc nghiệm 3 mức độ từ tài liệu buổi học, đề và đáp án tách riêng (VI)

```
Tôi phụ trách lớp ôn tập nội bộ cho nhân viên mới, tuần nào cũng phải tự soạn đề trắc nghiệm nên
rất mất thời gian.
Tôi muốn: đưa file tài liệu của buổi học vào (thường là Word hoặc PDF), rồi nhận về một đề
15 câu trắc nghiệm 4 đáp án, chia làm 3 mức từ dễ đến khó, mỗi mức 5 câu.
Quan trọng nhất là phần đề phát cho học viên và phần đáp án phải tách riêng hẳn nhau,
vì tôi in đề phát trước, đáp án chỉ dùng lúc chữa bài. Đừng để lộ đáp án lẫn vào phần đề.
Câu hỏi chỉ được lấy từ nội dung trong tài liệu thôi, đừng tự thêm kiến thức bên ngoài vào.
```

## Bối cảnh giả định
Trưởng nhóm kiêm đào tạo nội bộ ở công ty Việt Nam, soạn đề in giấy hàng tuần. Ràng buộc "tách
riêng đề và đáp án" đến từ quy trình thật (in phát trước, chữa sau). Không biết Dify.

## Trục năng lực được thử
**Lang-sync VI không-base** (cùng họ finding #6 — ① digest từng ra EN cho prompt JA không-base,
n=1; mẫu VI này thêm dữ liệu cho nghi vấn "lệch khi thiếu ngữ cảnh") · file input đa định dạng
(Word/PDF → `allowed_file_extensions`) · sinh có cấu trúc phân tầng (3 mức × 5 câu) · **ràng buộc
tách kênh output** (đề ≠ đáp án — hai output rõ ràng, không rò).

## Hình dạng build tốt
- `start` (file) → `document-extractor` → LLM sinh 15 câu JSON (câu + 4 lựa chọn + mức + đáp án +
  giải thích) → `code` tách thành HAI văn bản: "ĐỀ PHÁT HỌC VIÊN" (không chứa đáp án) và "ĐÁP ÁN +
  GIẢI THÍCH" → `end` với 2 output tách biệt.
- Việc tách đề/đáp án là của CODE trên dữ liệu cấu trúc — không nhờ LLM "viết hai bản" (dễ rò đáp
  án sang bản đề).
- Digest ①, SPEC ②, notes ④ toàn bộ tiếng Việt.

## Bẫy đã biết
Đáp án rò vào phần đề (in đậm lựa chọn đúng, đánh dấu *, giải thích lộ ngay dưới câu hỏi) — lớp
lỗi "LLM trộn kênh" · mức dễ/khó không có tiêu chí thì model chia tùy hứng — spec nên định nghĩa
ngắn (dễ = nhớ, vừa = hiểu, khó = vận dụng) · file Word cần `allowed_file_extensions` đúng (.docx)
· cấm-bịa như G01.

## MANUAL dự kiến
Chạy với tài liệu VI thật · đọc bản đề xem CÓ chỗ nào suy ra được đáp án không · đếm 5-5-5 đúng
mức · kiểm digest/SPEC/notes không rơi sang EN.
