# G03 — 月別売上の数字をグラフ画像にして (JA) [nguồn: chart_demo]

```
毎月の売上を数字で貼り付けるので（1月 120万、2月 95万…みたいに）、
それを棒グラフの画像にして返してほしいです。パッと見で増減がわかるように。
一番売上が高かった月がひと目でわかるようにしてもらえると助かります。
数字は勝手に変えないでね。貼り付けたとおりに。
```

## Bối cảnh giả định
Quản lý shop, muốn số → biểu đồ. Nguồn: chart_demo/matplotlib thật (http/code render).

## Trục năng lực được thử
**Render biểu đồ từ số** (code matplotlib / http chart service) — trục MỚI: build vẽ chart bằng code
thật hay giả · "数字を勝手に変えるな" (đừng đổi số) = code parse chính xác, LLM không đụng số.

## Hình dạng build tốt
start (text số) → code parse cặp tháng-số → code matplotlib (hoặc http chart service) vẽ bar chart,
tô nổi tháng cao nhất → end (ảnh). Số do code đọc, KHÔNG để LLM.

## Bẫy đã biết
Sandbox code có matplotlib không (constraints.md) — nếu không thì cần http chart service ngoài · parse
số "120万" (đơn vị 万) · "đừng đổi số" = LLM không được đụng · tô nổi max.

## MANUAL dự kiến
Số thật 12 tháng xem chart ra + số đúng + tháng max nổi bật.
