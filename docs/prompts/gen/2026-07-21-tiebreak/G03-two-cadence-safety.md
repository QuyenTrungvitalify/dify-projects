# G03 — Báo cáo sự cố an toàn: ghi nhận ngay + tổng hợp tuần (JA)

```
工場で小さなヒヤリハット（事故になりかけた事例）の報告を集めています。
現場の担当者がスマホのフォームから報告を送ると、その都度、安全管理者のChatworkに
すぐ流れるようにしてほしいです。危険度が「高」のものは件名に【至急】とつけてください。
それとは別に、毎週金曜の夕方に、その週に集まった報告を種類別に集計して、
工場長あてに一覧でまとめて送ってほしいです。件数の多い順に並べてもらえると助かります。
報告の内容は全部、あとで見返せるようにスプレッドシートにも残しておきたいです。
```

## Bối cảnh giả định
Quản lý an toàn nhà máy. Hai nhịp (mỗi báo cáo / thứ Sáu hàng tuần) + lưu trữ — user không biết đó
là hai cơ chế trigger khác nhau.

## Trục năng lực được thử
**Phá hòa finding A (④ giả định 1-file)** — yêu cầu 2 nhịp rõ ràng như R2-G03 đã sinh 2 file. Nếu
build lại ra 2 file: kiểm ④ có lint + nhắc file thứ 2 không (A lên n=2, đủ fix). Kèm: webhook
advisory (mẫu 3) · schedule thứ Sáu JST · sort giảm dần · 【至急】 theo mức độ.

## Hình dạng build tốt
Flow A: `trigger-webhook` nhận báo cáo → if-else 危険度=高 → Chatwork (【至急】 hoặc thường) → ghi Sheets.
Flow B: `trigger-schedule` thứ Sáu chiều JST → đọc Sheets tuần này → gom theo 種類 + sort giảm dần →
Chatwork 工場長. Cả hai file PHẢI được ④ lint + notes nhắc đủ.

## Bẫy đã biết
1 trigger/flow → tách 2 file (đúng) NHƯNG ④ chỉ khai 1 file (finding A) · timezone UTC → 金曜夕方
lệch · "週に集まった" cần lọc theo tuần (bài học R3-G03: aggregate quên lọc) · sort giảm dần.

## MANUAL dự kiến
Gắn nguồn form thật · kiểm CẢ HAI file có được nhắc trong notes không · chờ thứ Sáu hoặc đổi cron.
