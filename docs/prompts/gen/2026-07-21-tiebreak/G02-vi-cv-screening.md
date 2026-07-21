# G02 — Sàng lọc CV ứng viên theo tiêu chí, chấm điểm và giải thích (VI)

```
Bên mình tuyển dụng, mỗi đợt nhận cả trăm CV, đọc không xuể.
Mình muốn đưa từng CV (file PDF) vào, kèm theo mô tả vị trí đang tuyển,
rồi nó chấm cho mình mấy điểm trên thang 10, và nói rõ vì sao được điểm đó:
hợp chỗ nào, thiếu chỗ nào so với vị trí.
Đừng loại thẳng ai cả, mình vẫn muốn tự xem, chỉ cần xếp hạng để đọc cái nào trước thôi.
Và tuyệt đối đừng nhìn tuổi tác, giới tính hay trường học ra để chấm, chỉ nhìn kinh nghiệm
và kỹ năng thôi, cái này bên mình rất kỹ.
```

## Bối cảnh giả định
HR công ty VN. Ràng buộc "không loại thẳng" + "không nhìn tuổi/giới/trường" là chính sách thật.

## Trục năng lực được thử
**Phá hòa finding I (mất dấu VI)** — mẫu VI thứ hai cùng đợt, prompt LLM dài tiếng Việt. Kèm:
ràng buộc công bằng trong prompt · không-quyết-thay-người · file PDF input.

## Hình dạng build tốt
start (file PDF + text mô tả vị trí) → document-extractor → LLM chấm theo rubric (điểm + lý do
hợp/thiếu, CẤM dùng tuổi/giới/trường) → end (điểm + giải thích, không có nhánh "loại").

## Bẫy đã biết
Cám dỗ thêm nhánh if-else tự loại (<5 điểm) — user cấm · tiêu chí công bằng phải NẰM TRONG prompt ·
nội dung VI phải CÓ DẤU · "xếp hạng" với 1 CV/lần là mơ hồ — nêu open point là điểm cộng.

## MANUAL dự kiến
CV thật + JD thật · thử CV ghi rõ tuổi/trường xem có bị dùng để chấm không · kiểm không có nhánh loại.
