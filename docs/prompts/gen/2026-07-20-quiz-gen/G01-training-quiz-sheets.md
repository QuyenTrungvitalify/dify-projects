# G01 — Đề kiểm tra hiểu bài từ PDF nghiên cứu đào tạo → tích vào Google Sheets

```
新入社員研修の理解度テストを毎回手作りしていて、けっこう時間がかかっています。
研修資料のPDFを渡したら、そこから4択の確認テストを20問作ってほしいです。
条件があります。
・正解は1つだけ。まぎらわしい選択肢もまぜてください
・各問題に「なぜそれが正解か」の短い解説をつける
・資料に書いていないことを勝手に問題にしないでください
・正解の位置（1番とか4番とか）がかたよらないようにしてください
できあがった問題は、いつも使っているGoogleスプレッドシートの一覧
（問題・選択肢4つ・正解・解説の列で管理しています）にためていきたいです。
```

## Bối cảnh giả định
Nhân sự đào tạo công ty vừa, mỗi khóa nhập môn tự soạn đề bằng tay. Quản lý ngân hàng câu hỏi trên
một Google Sheets quen dùng. Không biết gì về Dify; nói "ためていきたい" chứ không nói append/API.

## Trục năng lực được thử
**Tool-trong-catalog** (`google_sheets` CÓ trong `templates/tool-catalog.json` — P07 test đường
catalog-trượt, đường catalog-**trúng** chưa từng test: ② có tra catalog trước không, hash resolve
offline, `dependencies` có entry thật) · file input PDF → document-extractor · sinh có cấu trúc 20
mục · ràng buộc cấm-bịa (chỉ hỏi trong tài liệu) · ràng buộc phân bố (vị trí đáp án không lệch —
việc của CODE, không phải của model sinh).

## Hình dạng build tốt
- `start` (file PDF) → `document-extractor` → LLM sinh câu hỏi dạng JSON có cấu trúc → `code`
  validate + xáo vị trí đáp án cân bằng → `tool` google_sheets append → `end`.
- `dependencies:` mang hash google_sheets thật từ catalog — KHÔNG `dependencies: []`, KHÔNG hạ cấp
  thành http-request.
- Cân bằng vị trí đáp án làm bằng code (đếm/xáo tất định) — LLM tự hứa "sẽ chia đều" là không đủ.
- ④ notes nói rõ: cài tool Sheets + cấp key + id/tên sheet là việc user làm trong Dify.

## Bẫy đã biết
LLM bịa câu hỏi ngoài tài liệu khi PDF ngắn (ràng buộc cấm-bịa phải vào prompt node LLM) · 20 câu
một lượt dễ đuối/lặp — chia batch hay một lượt là quyết định thiết kế cần lý do · vị trí đáp án
thiên về 1–2 nếu để model tự nhiên · sheet có sẵn 4 cột cụ thể — build tự chế cột khác là sai yêu
cầu · tool node là MODEL-less nhưng LLM node đi kèm ship model rỗng → "Model not exist" lúc chạy.

## MANUAL dự kiến
Cài plugin Sheets + OAuth/key thật · chạy với一 PDF đào tạo thật xem 20 câu có bám tài liệu không ·
kiểm phân bố đáp án trên sheet thật · kiểm append không ghi đè dòng cũ.
