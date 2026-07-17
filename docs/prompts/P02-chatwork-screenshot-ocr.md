# P02 — Trích chữ từ ảnh screenshot tin tức → dạng CSV

```
Chatworkに毎日ニュース記事のスクリーンショットが10枚くらい投稿されます。
その画像から「記事タイトル」「URL」「概要（2〜3行）」だけ抜き出して、
コピペで表に貼れるようなカンマ区切りのテキストにまとめてほしいです。
画像はこちらでまとめてアップロードする想定でいいです。
URLが画像に写っていないときは空欄でいいです。
```

## Bối cảnh giả định
Nhân viên vận hành, hàng ngày gõ tay lại nội dung từ screenshot. Đã chấp nhận tự upload ảnh
(không đòi tích hợp Chatwork tự động) — user dễ tính, yêu cầu gọn.

## Trục năng lực được thử
File input **kiểu ảnh, nhiều file** · vision LLM đọc ảnh (không có OCR plugin) · iteration per-ảnh
· output CSV có quy ước cột · xử lý thiếu dữ liệu (URL trống).

## Hình dạng build tốt
- Start có biến file-list (ảnh) → iteration từng ảnh → LLM vision trích 3 trường → gộp CSV.
- Model phải là **vision-capable** — build ship model rỗng thì note phải nói rõ cần model đọc được
  ảnh, không phải model text bất kỳ.
- Escape dấu phẩy/xuống dòng trong tiêu đề khi ghép CSV (code node, không nhờ LLM ghép).

## Bẫy đã biết
`has_file_input` phải là biến file thật trên start (build_index chỉ nhận `type: file/file-list`) ·
LLM bịa URL không có trong ảnh — prompt phải cấm suy đoán, thiếu thì để trống (chính user đã cho
phép) · md_exporter nuốt whitespace nếu build lại đi đường xuất file (không cần ở đây).

## MANUAL dự kiến
Độ chính xác đọc ảnh thật (JA font nhỏ) · 10 ảnh/lần có vượt giới hạn file của workspace không.
