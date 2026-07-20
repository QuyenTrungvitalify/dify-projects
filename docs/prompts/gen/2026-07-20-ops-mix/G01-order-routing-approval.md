# G01 — Đơn hàng đổ về: ≥5万円 xin duyệt sếp, còn lại lệnh xuất kho (JA)

```
ネットショップの注文データが、注文が入るたびにうちのシステムから飛んでくるようになっています。
それを受けて、注文金額が5万円以上のものは上長の承認が必要なので、
上長のChatworkルームに「承認お願いします」と注文内容つきで送ってほしいです。
5万円未満は倉庫チームのルームに出荷指示として流してください。
金額の書き方がバラバラで、「52,000」とか「52000円(税込)」みたいなのが混ざっているので、
そこはうまく数字として読んでください。
どちらに送るときも、注文番号・商品名・金額・お客様名は必ず入れてください。
```

## Bối cảnh giả định
Quản lý vận hành EC nhỏ, hệ thống đặt hàng có sẵn tính năng bắn thông báo mỗi đơn ("飛んでくる"),
không biết đó gọi là webhook. Ngưỡng duyệt 5万 là quy trình nội bộ thật. Biết dữ liệu bẩn (tiền có
phẩy, 円, 税込) vì tự tay xử lý mỗi ngày.

## Trục năng lực được thử
**Webhook per-event đơn nhịp** → mẫu **#2/≥2 cho advisory nguồn** (finding 9 — sau đợt này đủ điều
kiện khoá gate `notes_include`) · route 2 nhánh theo ngưỡng số · **làm sạch tiền tệ bằng code**
(「52,000」/「52000円(税込)」→ number — đúng lớp "code làm số, LLM viết văn") · truyền nguyên văn
4 field bắt buộc.

## Hình dạng build tốt
- `trigger-webhook` (body: order_no, item, amount_raw, customer…) → `code` parse phòng thủ chuỗi
  JSON + chuẩn hóa tiền (strip `,` `円` `(税込)` → int, giá trị không đọc được → nhánh lỗi/ghi chú,
  KHÔNG đoán bừa) → `if-else` ≥50000 → 2 nhánh http POST ChatWork (room 上長 / room 倉庫, token
  `X-ChatWorkToken` + `no-auth`, 2 room id là config lộ ra được).
- Advisory ④ nêu đúng field nguồn phải POST; ① nêu open point shape payload (builder tự giả định).
- LLM (nếu dùng) chỉ soạn câu chữ tin nhắn — số tiền và routing tuyệt đối bằng code.

## Bẫy đã biết
Webhook body string-JSON → parse phòng thủ (GOTCHA pattern) · tiền viết bẩn: naive `int()` chết với
`52,000` — regex/strip phải cover cả 全角数字? (nếu build nghĩ tới là điểm cộng) · amount parse fail
mà route mặc định về nhánh <5万 là **lỗi quy trình duyệt** (an toàn phải nghiêng về xin-duyệt hoặc
báo lỗi) · advisory nguồn phải khớp field thật của body.

## MANUAL dự kiến
POST thử 49999/50000/52,000/52000円(税込) xem route + parse · 2 room id thật · giả payload thiếu
field xem hành vi.
