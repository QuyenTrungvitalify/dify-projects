# G04 — 長い製品マニュアルを丸ごと英訳、用語は統一 (JA) [nguồn: BookTranslate]

```
製品マニュアル（けっこう長いです、何十ページ分のテキスト）を英語にしたいんです。
長すぎて一度に貼ると切れちゃうので、うまく分けて訳してほしい。
専門用語は毎回同じ英語に揃えてほしいです（バラバラだと困る）。
訳し終わったら、全部つなげて一つの英文にして返してください。
途中で内容を省略したり要約したりはしないで、ちゃんと全部訳して。
```

## Bối cảnh giả định
Kỹ thuật/tài liệu, dịch manual dài. Nguồn: 全书翻译 thật (iteration+code+llm).

## Trục năng lực được thử
**Chia khối dịch dài + nối lại + thuật ngữ nhất quán** — trục MỚI: iteration chia chunk (finding K họ
hàng: dài thì cắt), thuật ngữ đồng nhất qua các chunk, "省略・要約するな" (đừng lược/tóm) = dịch đủ.

## Hình dạng build tốt
start (text dài) → code chia chunk theo độ dài → iteration dịch từng chunk (giữ glossary nhất quán) →
code nối lại → end. Không tóm tắt. Cân nhắc iteration ≤30 với văn bản rất dài.

## Bẫy đã biết
Iteration ≤30 phần tử — manual "何十ページ" có thể vượt · thuật ngữ lệch giữa chunk (không có glossary
chung) · LLM "tóm tắt cho gọn" thay vì dịch đủ · max_tokens mỗi chunk (finding K).

## MANUAL dự kiến
Text dài thật xem chia chunk + không vượt trần iteration + thuật ngữ đồng nhất + không lược nội dung.
