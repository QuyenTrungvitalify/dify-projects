# P03 — Bản tin sáng AI → Slack, nghỉ cuối tuần

```
毎朝8時に、生成AI関連の新しいニュースを集めて、重要そうなものを5件だけ選んで、
1件につき日本語3行以内でまとめてSlackのチャンネルに投稿してほしいです。
土日は動かなくていいです。
ニュースの取り方はRSSでもWeb検索でもお任せしますが、同じニュースが
毎日何回も出てくるのは避けたいです。
```

## Bối cảnh giả định
Quản lý sản phẩm muốn "bản tin sáng" tự động. Nói giờ và lịch rất tự nhiên (「毎朝8時」「土日は
動かなくていい」) — không hề biết cron.

## Trục năng lực được thử
Schedule trigger + **weekday-only** · nguồn ngoài (RSS/HTTP) · chọn lọc & tóm tắt · Slack webhook
· khử trùng lặp giữa các NGÀY (state — Dify không có storage giữa các run!).

## Hình dạng build tốt
- `trigger-schedule` daily 8:00 **Asia/Tokyo**; weekday-only: visual daily + code node check thứ →
  thoát sớm cuối tuần (visual_config không có weekday mask) — hoặc nói rõ hạn chế này.
- Khử lặp giữa ngày là bài toán **state**: Dify thuần không giữ nhớ giữa run → giải pháp trung thực
  là lọc theo ngày đăng bài viết (chỉ lấy bài <24h), và NÓI rõ giới hạn "cùng bài đăng lại nhiều
  nguồn có thể lọt". Hứa dedup tuyệt đối = red flag.
- Slack incoming webhook = http POST thường (không cần plugin) — URL là env secret.

## Bẫy đã biết
Timezone UTC mặc định — 8:00 UTC = 17:00 JST, sai cả mục đích "sáng" · 「重要そう」 là phán đoán
LLM — digest nên nêu tiêu chí thay vì im lặng tự quyết · nguồn RSS cụ thể nào? (câu hỏi mở hợp lệ).

## MANUAL dự kiến
Bật trigger · webhook URL Slack thật · chạy thử qua đêm xem 8:00 JST đúng không · chất lượng chọn
5 bài.
