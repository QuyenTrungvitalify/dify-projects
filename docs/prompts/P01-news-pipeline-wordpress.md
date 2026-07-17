# P01 — Pipeline tin tức AI/DX → WordPress (ca gốc từ bảng task của stakeholder)

```
社内でAI・DX系のニュースをまとめてWordPressに載せる作業を自動化したいです。
今は人手でやっていて、作業はだいたいこんな感じです：

・Chatworkに共有されたニュースのスクショ画像から、タイトル・URL・概要をOCRで抜き出す
・AI・DX関連のキーワードで定期的にWeb記事やRSSを収集して、タイトル・URL・抄録を集める
・画像から拾った分とWebから拾った分をマージして、URLが同じものは重複除去、どのソースから
　来たかも分かるようにする
・関連度と新しさでスコアリングして、優先順に「検討リスト」に整形する
・検討リストの各ニュースについて、記事の初稿（タイトル・リード文・本文・タグ案）をLLMで
　自動生成する
・WordPress投稿用のHTML（見出し・段落・リンクタグ）に変換する
・生成したHTMLと初稿テキストをGoogleスプレッドシートかドキュメントに書き込む

これ、全部まとめてDifyでできますか？無理な部分があるなら、できる範囲で組んでもらって、
できない部分は何が必要か教えてください。
```

## Bối cảnh giả định
Trưởng nhóm content marketing, nhận nguyên bảng task từ sếp (chính là ảnh bạn đưa), dán cả cục.
Không biết Dify làm được gì — và **hỏi thẳng** "được không, thiếu gì".

## Trục năng lực được thử
Scope lớn nhiều tầng · schedule trigger + thu thập web · vision LLM thay OCR · merge/dedup bằng
code · scoring · iteration sinh bài · template HTML · tool node Google Sheets/Docs.

## Hình dạng build tốt (cho người chấm — KHÔNG đưa builder)
- **Không cố nhồi tất cả vào một workflow.** Câu trả lời tốt tách ít nhất 2 flow (thu thập định kỳ
  ≠ xử lý ảnh Chatwork on-demand) và **nói rõ** vì sao; hoặc chọn một lát dọc kèm digest liệt kê
  phần chưa làm. Nhồi 30+ node một flow = red flag (bài học corpus cũ: All-in-One Ops 51 node).
- OCR: Dify không có OCR plugin mặc định → dùng LLM vision cho ảnh, và **nói thật** điều đó.
- Câu hỏi mở phải nêu: nguồn ảnh Chatwork vào bằng đường nào (webhook? upload tay?), WordPress
  đăng tự động hay chỉ xuất HTML (không có sẵn WordPress tool → HTML + Sheets là phần làm được).
- Google Sheets = tool node → hash phải resolve theo AGENTS.md §4.3, không bịa.

## Bẫy đã biết
Schedule mặc định **UTC → phải Asia/Tokyo** · scraping bừa bãi (robots/ToS — bài học LanguageTool)
· `dependencies: []` + tool node = import sạch chết runtime (067) · digest hứa "tự chạy" mà quên
note bật trigger (066).

## MANUAL dự kiến
Nguồn ảnh thật từ Chatwork · API key Sheets + model · chất lượng bài sinh ra · scoring có hợp mắt
người không.
