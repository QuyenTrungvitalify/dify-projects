# P07 — Biên bản họp → quyết định & việc cần làm → ghi vào Google Docs

```
会議の文字起こしテキスト（長いです、1万字くらいになることもあります）を貼り付けたら、
・決定事項
・宿題（誰が・何を・いつまでに）
を抜き出して、決まったフォーマットで指定のGoogleドキュメントに追記していってほしいです。
1つのドキュメントに会議ごとにどんどん下に足していくイメージです。
担当者がはっきりしない宿題は「担当未定」にしてください。
```

## Bối cảnh giả định
Trợ lý nhóm dev, sau mỗi họp phải chép tay action items. Có yêu cầu nghiệp vụ tinh: **append** vào
một Doc duy nhất (không tạo file mới mỗi lần), và xử lý ca "chưa rõ ai làm".

## Trục năng lực được thử
Input text dài (~10k chữ) · trích cấu trúc (决定/宿題/担当/期限) · **tool node Google Docs** —
hash resolution §4.3 + spec 067 (checklist plugin) · ngữ nghĩa append.

## Hình dạng build tốt
- Start paragraph input → LLM/param-extractor trích JSON có schema (người/việc/hạn, thiếu người →
  「担当未定」) → format template → tool node Google Docs append.
- Tool Google Docs: tra `templates/tool-catalog.json`, hash resolve từ marketplace **đúng version**
  — `dependencies:` phải non-empty (067: rỗng = import sạch, chết runtime, không prompt cài).
- Nếu catalog không có tool Docs phù hợp: fallback trung thực = xuất text + hướng dẫn dán, nói rõ —
  KHÔNG bịa provider id (chính là lỗi 3-build-liên-tiếp trong lịch sử §4.3).

## Bẫy đã biết
Bịa plugin hash (lịch sử: builder từng từ chối tool node vì tin doc sai — nay §4.3 đã sửa, kiểm nó
áp dụng đúng chiều) · 1万字 vượt khung context model nhỏ — digest nên nêu · append = quyền ghi Doc,
OAuth scope là việc user làm tay.

## MANUAL dự kiến
Cài plugin + OAuth Google · Doc id thật · dán biên bản 1 vạn chữ thật xem trích sót không · chạy
2 lần liên tiếp xem có append (không ghi đè).
