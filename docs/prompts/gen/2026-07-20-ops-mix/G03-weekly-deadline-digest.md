# G03 — Sáng thứ Hai: lọc case đến hạn trong tuần từ Sheets, gom theo người, nhắc từng nhóm (JA)

```
案件の一覧をGoogleスプレッドシートで管理しています(案件名・担当者・締切日・状況の列)。
毎週月曜の朝9時に、そのシートを見て「締切が今週中」の案件だけを抜き出して、
担当者ごとにまとめて、Chatworkのチームルームに送ってほしいです。
「田中さん:A案件(水)、B案件(金)」みたいに、誰が何をいつまでに、が一目でわかる形で。
状況の列が「完了」になっているものは入れないでください。
それと、締切がもう過ぎているのに完了になっていない案件は、
一番上に「期限切れ」として目立つように出してください。
```

## Bối cảnh giả định
Trưởng nhóm dự án JP, sáng thứ Hai nào cũng mở sheet lọc tay rồi gõ nhắc việc. Sheet 4 cột là có
thật và cấu trúc được khai ngay trong yêu cầu. Nguồn máy-đọc-được (Sheets) — hợp lệ với schedule.

## Trục năng lực được thử
**Schedule weekday-cụ-thể** (thứ Hai 9:00 — khác bẫy trừ-cuối-tuần P03; `Asia/Tokyo` bắt buộc) ·
**catalog-hit chiều ĐỌC** (đợt trước test append/write; batch_get đọc + code lọc là nhánh mới) ·
lọc theo NGÀY tương đối ("tuần này", "đã quá hạn" — ngày chạy phải lấy trong code, timezone-pinned,
GOTCHA per-row-notify) · **gom nhóm theo người** (group-by trong code — chưa campaign nào test) ·
loại 完了 · ưu tiên 期限切れ lên đầu.

## Hình dạng build tốt
- `trigger-schedule` (cron thứ Hai 9:00, `timezone: Asia/Tokyo` tường minh) → tool batch_get đọc
  range → `code`: parse ngày (nhiều format sheet hay gặp), tính "tuần này" từ ngày CHẠY (JST trong
  code — không naive now()), loại 完了, tách 期限切れ, group-by 担当者, format đúng mẫu
  「田中さん:A案件(水)…」 → http POST ChatWork room.
- Toàn bộ so sánh ngày + gom nhóm bằng code; LLM nhiều nhất là chuốt câu (hoặc không cần LLM —
  build không nhét LLM thừa là điểm cộng).
- ④ notes: SPREADSHEET_ID/token/room + bật trigger + nghĩa của "tuần" (đến Chủ nhật? — open point).

## Bẫy đã biết
Schedule timezone default UTC → 月曜9時 thành 18時 nếu quên (bài học §9 2026-07-13) · "締切が今週中"
mơ hồ (hết Chủ nhật hay hết thứ Sáu?) — phải thành open point chứ không tự quyết ngầm · ngày trong
sheet có thể `2026/07/21` lẫn `7月21日` — parse một format cứng là gãy · 期限切れ mà cũng 完了 thì
loại (điều kiện kép, dễ sai thứ tự lọc) · sheet trống/cột thiếu → thông điệp lỗi tử tế, đừng gửi
tin rỗng lên room.

## MANUAL dự kiến
Sheet thật có case 完了/quá hạn/tuần này/tuần sau xem lọc + gom + format · đợi qua một sáng thứ Hai
thật (hoặc đổi cron) xem giờ bắn đúng JST · ngày dạng lẫn lộn.
