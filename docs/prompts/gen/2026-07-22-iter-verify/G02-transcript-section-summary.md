# G02 — 長い会議の文字起こしをセクションごとに要約 (JA)

```
会議の文字起こし（長いです、1〜2時間分になることも）を貼り付けたら、
話題の切れ目でセクションに分けて、それぞれ3行くらいで要約してほしいです。
長すぎて一度に処理できないと思うので、うまく分割して。
最後に全体を通した「決定事項」だけまとめて。要約で内容を省かないように。
```

## Bối cảnh giả định
Thư ký họp, transcript "1〜2時間分" rất dài. Test chunk long-doc (F1) + max_tokens (K).

## Trục năng lực được thử
**chunk long-doc + iteration ≤30 (F1) + max_tokens (K)** + "省かない" (không lược) — cùng lớp G04 nhưng
domain khác (transcript, không phải manual dịch).

## Hình dạng build tốt
start (text dài) → code chia đoạn + batch ≤30 → iteration tóm từng đoạn → LLM gom quyết định. max_tokens
đủ cho đoạn dài.

## Bẫy đã biết
"1〜2時間分" → rất dài → chia >30 chunk nếu size cố định → clamp ≤30 (F1) · max_tokens (K) · "省かない".

## MANUAL dự kiến
Transcript dài thật xem chia ≤30 + không lược.
