# G03 — 日英中の商品説明が食い違っていないかチェック (JA) [nguồn: LanguageConsistencyChecker]

```
うちの商品ページは日本語・英語・中国語の3か国語で用意しているんですが、
翻訳がバラバラに更新されて、内容が食い違うことがよくあります
（日本語だけ「送料無料」って書いてあって英語には無い、とか）。
3つの文章を貼り付けたら、意味が食い違っているところ、
どれかにしか書いていない情報を洗い出して、表にしてほしいです。
勝手にどれかに合わせて直すんじゃなくて、違いを教えてくれるだけでいいです。
```

## Bối cảnh giả định
EC đa ngôn ngữ, 3 bản mô tả hay lệch. Nguồn: "三语一致性检查" thật (code + llm + tool).

## Trục năng lực được thử
**Đối chiếu chéo 3 ngôn ngữ, chỉ NÊU khác biệt không tự sửa** — trục MỚI (khác dịch): tôn trọng ràng
buộc "勝手に直すな、違いを教えるだけ" (chỉ báo, đừng tự đồng bộ) · 3 input · output bảng có cấu trúc.

## Hình dạng build tốt
3 text input → LLM/code so từng mục thông tin qua 3 bản → bảng "mục | JP | EN | ZH | khác chỗ nào".
KHÔNG có nhánh tự-sửa (user cấm). LLM chỉ đối chiếu, không viết lại.

## Bẫy đã biết
Cám dỗ "sửa cho khớp" — user cấm rõ · 3 input cùng lúc · thông tin chỉ-có-ở-1-bản là ca chính · output
phải nêu được cả "食い違い" lẫn "どれかにしかない".

## MANUAL dự kiến
3 bản có lệch cài sẵn (送料無料 chỉ ở JP) xem bắt đủ + KHÔNG tự sửa.
