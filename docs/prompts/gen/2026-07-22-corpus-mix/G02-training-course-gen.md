# G02 — 研修コースの目次と各章の内容を自動生成 (JA) [nguồn: dify_course_demo]

```
新人研修の教材を作るのに毎回すごく時間がかかっています。
「接客の基本」みたいにテーマを入れたら、
まず章立て（目次）を作って、それから各章ごとに本文をある程度書いてほしいです。
章の数はテーマによって変わっていいですが、多すぎても読みきれないので5〜8章くらいで。
実在しない事例や、根拠のない数字は入れないでください。あとで私が確認して直します。
```

## Bối cảnh giả định
HR đào tạo, muốn nháp giáo trình từ chủ đề. Nguồn: "自动化生成全套教程" thật (iteration + long gen).

## Trục năng lực được thử
**Sinh dài có cấu trúc + iteration qua các chương** (5-8 chương động) — nhắm THẲNG finding K (thiếu
max_tokens khi N lớn) · ràng buộc cấm-bịa ("実在しない事例・根拠のない数字を入れない") · số chương động.

## Hình dạng build tốt
LLM sinh목차 → iteration/lặp từng chương sinh nội dung → gom. Có ràng buộc cấm bịa trong prompt.
Cân nhắc max_tokens cho nội dung dài (điểm cộng nếu build nghĩ tới).

## Bẫy đã biết
Iteration ≤30 (5-8 chương thì an toàn) · nội dung dài → có thể cắt output (finding K) · cấm-bịa số/ca ·
LLM tự "viết cho đủ" bịa ví dụ nếu chủ đề mỏng.

## MANUAL dự kiến
Chủ đề thật xem목차 hợp lý + nội dung có bịa ví dụ không + đủ số chương.
