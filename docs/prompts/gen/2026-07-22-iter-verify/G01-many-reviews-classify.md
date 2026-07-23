# G01 — 大量のアンケート自由記述を1件ずつ分類 (JA)

```
アンケートの自由記述回答をまとめて貼り付けます（日によって数十件〜数百件とバラバラです）。
1件ずつ、内容を「満足」「不満」「要望」「その他」に分類して、
さらに一言で要約もつけてほしいです。1件1行の表で。
件数が多い日でもちゃんと全部処理してほしいです。途中で打ち切らないで。
```

## Bối cảnh giả định
Vận hành CS, số review "数十〜数百件" động. Test iteration-qua-N-động (clamp ≤30 khi N lớn).

## Trục năng lực được thử
**iteration qua N động + clamp ≤30 (F1)** + "途中で打ち切らないで/全部処理" (không lược) → build có
batch ≤30 khi N lớn không · LLM node phân loại có max_tokens không (K).

## Hình dạng build tốt
start (text) → code tách dòng thành list + **batch ≤30** (ceil(N/30)) → iteration phân loại từng batch →
gom bảng. Không cắt ngang.

## Bẫy đã biết
"数百件" → >30 item nếu iterate thẳng từng review → phải batch ≤30 (F1) · max_tokens cho output nhiều
dòng (K) · "全部処理" = không bỏ sót.

## MANUAL dự kiến
Dán 数百件 thật xem batch ≤30 + đủ số dòng.
