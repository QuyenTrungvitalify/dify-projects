# G02 — 設定ファイル(JSON)の文言だけ英語にしたい、構造はそのまま (JA) [nguồn: json_translate]

```
アプリの文言をまとめたJSONファイルがあって、日本語の値だけ英語にしたいんです。
キーの名前や、JSONの構造・入れ子は絶対に変えないでほしい。値の文字列だけ翻訳して。
数字やtrue/false、URLみたいなのは翻訳せずそのまま残してください。
翻訳したJSONを、そのまま貼り付けて使えるようにきれいな形で返してほしいです。
```

## Bối cảnh giả định
Dev/PM localize app. Nguồn: json_translate thật (iteration+code+tool).

## Trục năng lực được thử
**Biến đổi giữ CẤU TRÚC** — trục MỚI: chỉ dịch value chuỗi, giữ key/nesting/số/bool/URL nguyên · output
JSON hợp lệ dán-là-dùng · code duyệt JSON (không để LLM viết lại cả file → hỏng cấu trúc).

## Hình dạng build tốt
start (JSON text) → code parse + duyệt value chuỗi → (LLM/tool dịch từng value) → code ghép lại JSON
đúng cấu trúc → end. KHÔNG để LLM "dịch cả file" (dễ hỏng JSON/đổi key).

## Bẫy đã biết
LLM dịch nguyên file → đổi key, hỏng escape, dịch cả URL/số · cấu trúc lồng sâu · output phải parse
được (JSON hợp lệ) · giữ true/false/số/URL.

## MANUAL dự kiến
JSON lồng sâu có URL+số xem key giữ nguyên + value dịch + parse được.
