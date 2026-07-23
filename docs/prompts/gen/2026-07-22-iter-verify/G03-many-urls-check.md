# G03 — 商品URLのリストを1件ずつチェックして表に (JA)

```
自社の商品ページのURLを一覧で貼り付けます（数が多いときは100件以上あります）。
1件ずつアクセスして、ページのタイトルと、価格が表示されているかどうかを確認して、
一覧表にまとめてほしいです。数が多くてもちゃんと全部見てほしい。
```

## Bối cảnh giả định
Quản lý EC, list URL "100件以上" động. Test iteration qua list lớn (F1 clamp) + http fetch.

## Trục năng lực được thử
**iteration qua list URL N động (F1 clamp ≤30)** + http fetch từng URL + "全部見て" (không bỏ sót).

## Hình dạng build tốt
start (text URL) → code tách URL thành list + **batch ≤30** → iteration (http fetch + trích title/giá
từng URL, hoặc từng batch) → gom bảng.

## Bẫy đã biết
"100件以上" → >30 URL → iterate thẳng vượt trần → phải batch ≤30 (F1) · fetch URL ngoài (external) ·
"全部見て" không bỏ sót.

## MANUAL dự kiến
100+ URL thật xem batch ≤30 + đủ số dòng.
