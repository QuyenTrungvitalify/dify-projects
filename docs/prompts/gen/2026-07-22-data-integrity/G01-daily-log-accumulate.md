# G01 — Ghi dồn đơn hàng mỗi ngày vào một sheet để cuối tháng xem lại (JA)

```
毎日、その日に入った注文を1件ずつGoogleスプレッドシートにためていきたいんです。
日付・注文番号・商品名・金額の列で、下にどんどん足していく感じで。
月末にまとめて見返したいので、前の日に書いたものが消えないようにだけ気をつけてほしいです。
注文のデータは、うちの受注システムから1件ずつ飛んでくるようになっています。
```

## Bối cảnh giả định
Vận hành EC, muốn nhật ký đơn tích luỹ. Ràng buộc "前の日のが消えないように" (đừng để mất dòng cũ) là
nỗi lo THẬT — chính là trục S1 (append vs overwrite).

## Trục năng lực được thử
**S1 — ghi DỒN vào Sheets** (catalog chỉ có batch_update = ghi-đè, không có append primitive): build
có đọc số dòng hiện có (batch_get) rồi ghi dòng kế, hay ghi đè A:D từ đầu? · webhook per-order.

## Hình dạng build tốt
webhook nhận đơn → (batch_get đếm dòng → ghi A{n+1}) HOẶC ghi có ý thức không đè · KHÔNG range A:D cứng.

## Bẫy đã biết
`batch_update` với range `A:D` hoặc mảng trần → ĐÈ từ A1, mất lịch sử — chính điều user sợ · không có
tool append trong catalog nên phải tự đọc-rồi-ghi.

## MANUAL dự kiến
Chạy live 2 lần vào cùng sheet → dòng 2 nối hay đè (đây là VERIFY thật cho S1).
