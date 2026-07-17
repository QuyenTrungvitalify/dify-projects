# P08 — Dịch manual JA→EN với glossary bắt buộc, hai bước tự soát

```
製品マニュアルの文章を日本語から英語に翻訳したいです。
ただ、社内で決まっている訳語があるので（用語集を一緒に貼り付けます）、
その用語は必ず用語集どおりの英語を使ってほしいです。
一回訳したあとに、用語集どおりになっているか自分でチェックして、
違っていたら直したものを最終版として出す、という二段階にしてもらえますか。
最後に、どの用語を直したかのリストも付けてください。
```

## Bối cảnh giả định
Technical writer từng bị dịch ẩu làm loạn thuật ngữ — nên tự thiết kế quy trình dịch→soát→sửa và
đòi log những gì đã sửa. User "biết mình muốn gì" nhất trong kho.

## Trục năng lực được thử
Multi-step-llm (pattern có sẵn — kiểm chọn pattern đúng) · 2 input (văn bản + glossary) · bước
self-review có ràng buộc · output kép (bản cuối + danh sách sửa).

## Hình dạng build tốt
- Start: 2 paragraph input → LLM dịch (glossary trong system) → LLM soát (nhận bản dịch + glossary,
  xuất bản sửa + danh sách thay đổi) → end 2 output.
- Pattern gốc hợp lý: `multi-step-llm`. Nếu ① chọn `custom` cũng chấp nhận được (bài học: pattern
  pin là ý kiến) — chấm theo shape, không theo tên.
- Danh sách sửa nên do bước soát xuất **cùng lúc** với bản cuối (một lần gọi, JSON 2 trường) thay
  vì thêm LLM thứ ba đốt tiền.

## Bẫy đã biết
Glossary dài đẩy qua 2 tầng LLM = token ×2 — hợp lý, nhưng digest đừng hứa "chính xác 100%" (soát
bằng LLM là xác suất; muốn cứng phải code-check term — điểm cộng nếu build nêu) · giữ nguyên
placeholder/format trong manual (số, code block).

## MANUAL dự kiến
Dán glossary thật ~50 term + 1 trang manual: đếm term dịch đúng trước/sau bước soát — bước 2 có
thật sự bắt được lỗi không hay chỉ diễn.
