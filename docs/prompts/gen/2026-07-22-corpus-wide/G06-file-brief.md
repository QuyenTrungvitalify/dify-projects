# G06 — 資料ファイルを渡すと要点ブリーフにしてくれる (JA) [nguồn: simple-kimi]

```
会議資料や企画書のファイル（PDFやWord）を渡すので、
中身を読んで、A4一枚くらいの「要点ブリーフ」にまとめてほしいです。
・何についての資料か ・決めたいこと/論点 ・数字やデータのポイント ・次のアクション
の見出しで整理して。資料に書いてないことは推測で埋めないで、「記載なし」と書いて。
```

## Bối cảnh giả định
Quản lý bận, muốn brief nhanh từ tài liệu. Nguồn: simple-kimi thật (doc-extract+llm).

## Trục năng lực được thử
**File→trích→brief cấu trúc cố định** + cấm-suy-đoán — trục file-input + honesty: 4 heading cố định ·
"書いてないことは推測で埋めるな、記載なしと書け" (thiếu thì ghi "không có", đừng đoán).

## Hình dạng build tốt
start (file PDF/Word) → document-extractor → LLM tóm theo 4 heading cố định, mục thiếu ghi 「記載なし」→
end. Cấm suy đoán trong prompt.

## Bẫy đã biết
File đa định dạng (allowed_file_extensions .pdf/.docx) · LLM "điền cho đủ" khi tài liệu thiếu mục →
phải ghi 記載なし · 4 heading cố định không đổi.

## MANUAL dự kiến
File thật thiếu 1 mục xem có ghi 記載なし hay bịa.
