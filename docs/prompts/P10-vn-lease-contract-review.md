# P10 — Tóm tắt hợp đồng thuê nhà + cảnh báo điều khoản bất lợi (tiếng Việt)

```
Mình có các hợp đồng thuê văn phòng dạng file PDF hoặc Word. Mình muốn upload file lên
là nó tóm tắt giúp các điều khoản chính (giá thuê, thời hạn, đặt cọc, điều kiện chấm dứt),
và quan trọng nhất là cảnh báo những điều khoản bất lợi cho bên thuê — ví dụ phạt nặng,
tự động tăng giá, chủ nhà được đơn phương chấm dứt sớm... Kết quả trả về bằng tiếng Việt,
trình bày dễ đọc để gửi cho sếp duyệt. Lưu ý là nó chỉ để tham khảo nội bộ thôi,
không phải tư vấn pháp lý chính thức.
```

## Bối cảnh giả định
Nhân viên hành chính công ty Việt Nam, review hợp đồng thuê trước khi trình sếp. Tự biết giới hạn
("chỉ tham khảo, không phải tư vấn pháp lý") — build nên giữ đúng disclaimer đó.

## Trục năng lực được thử
**Content-language sync tiếng Việt** (spec 030 — toàn bộ chat + SPEC prose phải VI từ token đầu) ·
file input PDF/Word · document-extractor · trích cấu trúc + phân tích rủi ro · disclaimer.

## Hình dạng build tốt
- Start file input (PDF/Word) → extractor → LLM: phần 1 tóm tắt các trường user liệt kê, phần 2
  danh sách điều khoản bất lợi **kèm trích nguyên văn** điều khoản gốc (chống bịa), cuối bài
  disclaimer đúng tinh thần user dặn.
- Digest/note/SPEC prose **tiếng Việt** — một câu lạc sang EN/JA là fail trục lang-sync.
- Trích dẫn nguyên văn điều khoản khi cảnh báo — cùng lý do với P06: phán đoán rủi ro phải bám
  được vào văn bản.

## Bẫy đã biết
Language pin: run VI hiếm hơn JA trong lịch sử test — đây là ca canh hồi quy `languagePin` · PDF
hợp đồng scan (ảnh) thì extractor bó tay — digest nên nêu giả định "PDF dạng text" · extractor trả
None/"" (§4.5).

## MANUAL dự kiến
Hợp đồng VN thật (định dạng lộn xộn) · đối chiếu cảnh báo với người rành hợp đồng · thử file Word
lẫn PDF.
