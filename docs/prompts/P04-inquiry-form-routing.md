# P04 — Phân loại inquiry từ Google Form → chuyển đúng phòng ban

```
会社の問い合わせフォーム（Googleフォーム）に来た内容を、
「営業」「サポート」「採用」「その他」に自動で仕分けして、
それぞれの担当のChatworkルームに転送したいです。
フォームが送信されたタイミングで自動で動いてほしいです。
判断に迷うものは「その他」に入れて、人が見る運用にします。
転送するときは、元の問い合わせ文とフォームに入っていた会社名・名前・メールアドレスも
一緒に送ってください。
```

## Bối cảnh giả định
Admin công ty nhỏ, đang chuyển tay từng inquiry. Hiểu nghiệp vụ tốt (có nhánh "khó phân thì dồn
その他 cho người xem") nhưng không biết webhook là gì — chỉ nói 「フォームが送信されたタイミング」.

## Trục năng lực được thử
**Webhook trigger** (đúng lớp lỗi spec 071 — GAS/Apps Script push) · phân loại (question-classifier
hoặc LLM + if-else) · route 4 nhánh → 4 room Chatwork · truyền nguyên văn field form.

## Hình dạng build tốt
- `trigger-webhook` nhận payload từ Apps Script của Form (build phải NÓI user cần gắn Apps Script
  gửi POST — Google Form không tự gọi webhook) — shape body khai rõ.
- Phân loại: 4 lớp + mặc định その他 khi confidence thấp — đúng như user dặn.
- 4 nhánh → http POST ChatWork từng room (`X-ChatWorkToken` + `no-auth`; room id là 4 giá trị cấu
  hình — env hoặc code map, phải lộ ra chỗ user sửa được).
- Nguyên văn inquiry + company/name/email đi kèm — không để LLM viết lại làm méo dữ liệu gốc.

## Bẫy đã biết
Webhook body là **string JSON → parse phòng thủ** (GOTCHA của pattern webhook tương lai) · node
`question-classifier` là MODEL node — ship model rỗng thì runtime "Model not exist" · `--dump-schema
trigger-webhook` là đường tra field (kiểm transcript xem có dùng không, hay lại săn).

## MANUAL dự kiến
Gắn Apps Script vào Form thật · 4 room id + token · bật trigger · gửi thử 4 loại inquiry xem route
đúng không.
