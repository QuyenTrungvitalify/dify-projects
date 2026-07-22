# G02 — Tổng hợp yêu cầu trong TUẦN NÀY từ sheet, gửi quản lý (JA)

```
問い合わせの記録をスプレッドシートに残しています（受付日・種類・担当・状況の列）。
毎週月曜の朝に、先週から今週にかけて「今週対応が必要なもの」だけを抜き出して、
種類ごとに件数を数えて、多い順に並べてマネージャーに送ってほしいです。
古いものまで全部数えられても困るので、今週分だけでお願いします。
```

## Bối cảnh giả định
Quản lý CS, gom số theo tuần. Ràng buộc "古いものまで数えられても困る/今週分だけ" là trục S2 (lọc cửa
sổ thời gian) — và ca biên: dòng thiếu/sai ngày xử lý sao.

## Trục năng lực được thử
**S2 — lọc theo tuần hiện tại**: build tính "tuần này" từ ngày chạy (JST) chưa? Dòng KHÔNG parse được
ngày → đếm vào (over-count) / drop (under-count) / xử lý tường minh? · sort giảm dần · schedule thứ Hai.

## Hình dạng build tốt
schedule thứ Hai JST → batch_get → code: tính tuần từ ngày chạy, lọc trong tuần, **dòng thiếu ngày
loại tường minh** (không mặc định tính vào), gom theo 種類 sort giảm dần → gửi.

## Bẫy đã biết
`if dt is not None and dt < cutoff` → dòng None lọt vào đếm (over-count) · timezone UTC default ·
"今週" mơ hồ (đến CN hay thứ Sáu) nên là open point.

## MANUAL dự kiến
Sheet có dòng thiếu ngày + ngày sai format → xem có bị đếm nhầm không (VERIFY cho S2).
