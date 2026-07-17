# P05 — Đối chiếu 2 file Excel → nháp email nhắc thanh toán

```
毎月、経理で「請求一覧」と「入金一覧」の2つのExcelを目視で突き合わせて、
まだ入金されていない会社を洗い出して、1社ずつ督促メールの下書きを作っています。
この2つのファイルをアップロードしたら、
・未入金の会社リスト（会社名・請求番号・金額・期日）
・各社向けの督促メール文面（丁寧なトーンで）
を出してくれるようにできますか？
金額と会社名は絶対に間違えないでほしいです。メールは自動送信しないでください、
下書きだけでいいです。
```

## Bối cảnh giả định
Kế toán, cẩn trọng đúng nghề: nhấn mạnh **không sai số tiền/tên**, và **cấm gửi tự động** — chỉ
nháp. Ranh giới an toàn do chính user vẽ.

## Trục năng lực được thử
2 file input cùng lúc · document-extractor với Excel · so khớp bằng **code** (không nhờ LLM đối
chiếu số!) · iteration sinh thư từng công ty · tôn trọng ranh giới "draft-only".

## Hình dạng build tốt
- Khớp hóa đơn ↔ thanh toán trong **code node** theo khóa (số hóa đơn/công ty) — LLM chỉ viết
  văn, KHÔNG được đụng vào phép so tiền. Build để LLM đối chiếu = fail tinh thần "絶対に間違えない".
- Số tiền/tên trong thư lấy bằng biến từ dòng dữ liệu, không để LLM chép lại (chép = cơ hội bịa).
- Không có node gửi mail nào — đúng lệnh cấm. Output = danh sách + các bản nháp.
- Extractor trả `None`/"" → phòng thủ (bài học §4.5).

## Bẫy đã biết
Excel qua document-extractor ra **text**, cấu trúc cột có thể vỡ — digest nên nêu giả định format
(hàng đầu là header?) như câu hỏi mở · encoding tên công ty JA · hai file khác schema nhau.

## MANUAL dự kiến
Chạy với file thật của phòng kế toán · rà 100% khớp tiền/tên ít nhất một chu kỳ trước khi tin.
