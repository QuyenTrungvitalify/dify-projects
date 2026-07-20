# G01 — Quay lại flow đơn hàng: thêm ghi log mọi đơn vào Sheets, KHÔNG đổi hành vi cũ (JA, edit)

```
この前作ってもらった、注文が入るたびにChatworkへ振り分けてくれる仕組み、すごく助かっています。
ひとつ足してほしいことがあって、承認に回したか倉庫に流したかに関係なく、
全部の注文を1件1行でGoogleスプレッドシートにも記録しておいてほしいんです。
月末にまとめて見返したいので、日付・注文番号・商品名・金額・お客様名・どっちに送ったか、
の列で残してください。
今の動き(ChatworkへのDMの振り分け)は変えないでください。
```

## Bối cảnh giả định
Chính user EC của đợt ops-mix quay lại sau vài ngày dùng — vòng đời bảo trì thật. Base:
`projects/_drafts/5_chatwork_5_52/workflows/main.yml` (build G01 đợt 3). Yêu cầu cột có "どっちに
送ったか" — nghĩa là log phải nằm SAU nhánh route, hoặc gom kết quả nhánh.

## Trục năng lực được thử
**Edit-existing LẦN ĐẦU trong campaign** (P12 chỉ chạy ở recheck; đường `fire --workflow` +
manifest `project/workflow`) · **giữ 100% node id + hành vi cũ** (「今の動き変えないで」) · chèn
nhánh ghi Sheets sau if-else 2 nhánh (aggregator? hay ghi ở từng nhánh?) · tận dụng catalog Sheets
(đã có mẫu 2 chiều) · cột "どっちに送ったか" = giá trị dẫn xuất từ nhánh — không nhờ LLM đoán.

## Hình dạng build tốt
- Diff so base: node/edge cũ **nguyên vẹn id**, chỉ THÊM (batch_get đếm dòng + code dựng row +
  batch_update append — hoặc pattern ghi 1 bước nếu hợp lý) sau mỗi nhánh HTTP, gom bằng
  variable-aggregator rồi ghi một lần.
- Cột đúng thứ tự user kể: 日付・注文番号・商品名・金額・お客様名・送り先(承認/出荷).
- 日付 lấy trong code pin JST (bài học §9) — user không gửi field ngày.
- Digest ① phải nói "mở rộng flow có sẵn", không phải build mới; ④ notes thêm đúng phần setup MỚI
  (SPREADSHEET_ID nếu chưa có), không lặp lại toàn bộ setup cũ như thể flow mới.

## Bẫy đã biết
Đè/sửa node cũ làm đổi hành vi (vi phạm ràng buộc số 1) · quên rằng flow này từng có finding
fail-open tiền (build TỐT sẽ không tự tiện "fix" nó — không được đổi hành vi — nhưng builder TRUNG
THỰC có thể nhắc trong notes; xem nó xử lý thế nào là dữ liệu propensity quý) · webhook flow
stateless: ghi log cần append an toàn (đợt 3 từng lộ rủi ro đè A1) · "どっちに送ったか" mà để LLM
suy từ text tin nhắn là sai — phải là biến nhánh.

## MANUAL dự kiến
Diff node id base↔built bằng tay · POST đơn ≥/< 5万 xem log ghi đúng nhánh · append không đè.
