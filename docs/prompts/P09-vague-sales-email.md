# P09 — Yêu cầu siêu mơ hồ: "tự động trả lời mail sales"

```
営業メールの返信、だいたい毎回同じようなことしか書いてないので自動化したいです。
いい感じにお願いします。
```

## Bối cảnh giả định
Sales bận, gõ một câu rồi đi họp. Không nói: mail nào (inbound? outbound?), "同じようなこと" là gì,
gửi tự động hay nháp, tiếng gì, tích hợp mail ra sao. **Prompt này là bài test về sự mơ hồ — không
được làm rõ hộ nó.**

## Trục năng lực được thử
Underspecification: ① digest có **nêu giả định + câu hỏi mở** thay vì im lặng tự quyết không? ·
spec 055 (digest kiểm được) · spec 063 (user ngây thơ đọc digest có hiểu mình sắp nhận gì không).

## Hình dạng build tốt
- ① đưa digest kiểu: "Tôi hiểu là: dán mail nhận được → sinh **nháp** trả lời theo tông lịch sự —
  đúng không? Chưa rõ: phân loại mail trước không, có mẫu câu công ty không, gửi tự động không
  (mặc định KHÔNG gửi)." — tức biến mơ hồ thành giả định rõ + mặc định an toàn.
- Build hợp lý sau đó: start(paragraph mail đến) → LLM nháp trả lời → end. **Nhỏ là đúng** — build
  to phức tạp cho prompt này là over-build (bài học lean của campaign cũ).
- Mặc định **không** node gửi mail — không được tự ý thêm side-effect user chưa xin.

## Bẫy đã biết
Builder "đoán to": tự thêm phân loại/CRM/gửi tự động không ai xin · digest tiếng Anh cho prompt JA
(language pin) · gate Ask mode: nếu chạy each_step, đây là ca đáng thử reply/hỏi ngược.

## MANUAL dự kiến
Đọc digest bằng mắt "user thật": có dám đưa cho người viết câu prompt này đọc không? · dán 2 mail
thật xem nháp có "いい感じ" theo chuẩn người Nhật không.
