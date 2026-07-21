# G01 — Gom một loạt đánh giá khách hàng, mỗi cái tóm thành 1 dòng cảm xúc + vấn đề (JA)

```
毎日、商品レビューがたくさん届くんですが、全部読むのが大変で。
1日分のレビューをまとめて貼り付けるので(1件ずつ改行で区切って入れます)、
それぞれについて、良い評価か悪い評価か、それとどんな点について言っているか(配送・品質・値段・対応など)を
1行ずつ整理してほしいです。
最後に、悪い評価だけを別でまとめて、多かった不満トップ3も出してもらえると助かります。
レビューの件数はその日によってバラバラで、5件のときも50件のときもあります。
```

## Bối cảnh giả định
Vận hành shop EC, mỗi ngày dán một mớ review (số lượng thay đổi 5–50). Không biết "iteration" là gì —
chỉ mô tả "từng cái một" (1件ずつ) và "số lượng khác nhau mỗi ngày" — đó chính là tín hiệu cần loop
qua mảng độ dài động.

## Trục năng lực được thử
**Iteration/loop qua mảng độ dài động** — CHƯA campaign nào test. Input 1 khối text nhiều dòng → tách
→ lặp phân loại từng review (sentiment + khía cạnh) → gom. Số phần tử không cố định (5–50) là lý do
bắt buộc iteration chứ không hardcode N node. Cuối: lọc negative + top-3 bất mãn (aggregate sau loop).

## Hình dạng build tốt
- `start` (paragraph) → `code` tách theo dòng thành array → `iteration` node bọc một LLM phân loại
  (mỗi item → {sentiment, aspect}) → sau iteration: `code`/LLM gom bảng 1-dòng-mỗi-review + lọc
  negative + đếm top-3 aspect bị chê → `end`.
- Iteration là node thật (`iteration-start` con), KHÔNG phải nhồi 50 câu vào 1 prompt (đuối + không
  co giãn được). Nếu build chọn "1 LLM xử cả khối" thì phải cân nhắc giới hạn — nêu ra là điểm cộng.
- Không hardcode số lượng review.

## Bẫy đã biết
Iteration ≤30 phần tử (constraint runtime) — 50 review vượt trần, build có biết/nêu không · tách dòng
ngây thơ gãy với review có xuống dòng trong nội dung · top-3 khi <3 loại bất mãn phải xử lý gọn ·
sentiment/aspect là phán đoán LLM — prompt phải định nghĩa tập aspect (配送・品質・値段・対応…) chứ
không thả trôi.

## MANUAL dự kiến
Dán 5 review thật + 50 review thật xem iteration chạy + trần 30 · review có ký tự đặc biệt/xuống dòng
· top-3 khi chỉ có 1 loại chê.
