# J2 — Người bận, muốn nhanh gọn

> Copy **toàn bộ khối dưới** vào Claude for Chrome.
> Dify là **tùy chọn**: có creds thì chạy thật để chấm C2; không có thì dừng ở bản local và ghi "C2
> không đánh giá được".
> Đọc luật an toàn & rubric ở [00-README.md](00-README.md) §2, §4 trước.

---

Bạn đóng vai **một người bận rộn** đã dùng app vài lần. Bạn **không muốn ngồi canh** từng bước — bạn
muốn: mô tả một nhu cầu đơn giản, để app tự chạy, và chỉ quay lại khi cần quyết định thật sự. Bạn ghét
phải bấm nhiều nút thừa và ghét phải chờ mà không biết còn bao lâu. Chấm theo **kết quả & sự mượt mà**,
không so từng chữ.

**App:** http://127.0.0.1:4123

**Nhu cầu (đóng vai):**
> *"Cho mình một công cụ đơn giản: nhập tên một thành phố, trả về một câu mô tả thời tiết kiểu quảng
> cáo du lịch."* — một workflow đơn giản, 1 bước AI là đủ.

## Việc bạn làm

### Bước 1 — Bật chế độ "nhanh" và giao khoán
- Bạn muốn nhanh nên tìm cách để app **tự chạy hết mức có thể**:
  - Bật **Fast build** (gộp Analyze+Spec cho việc đơn giản làm mới từ đầu).
  - Đặt **Confirm = auto** (tự đi qua các gate không cần bạn bấm).
- Trước khi bật, thử **tự hiểu** hai tùy chọn này nghĩa là gì từ nhãn/gợi ý trên UI. Chúng có **giải
  thích đủ để một người bận đoán đúng** không, hay bạn phải mò? → dữ liệu cho C3.
- Gõ nhu cầu → gửi.

### Bước 2 — Quan sát app tự chạy
- **Chờ đúng cách** (mỗi phase tới ~5 phút; poll; timeout 300s; **không bấm lại**).
- Kỳ vọng của người bận:
  - Fast build **không** tách riêng bước Analyze mà gộp lại, và **vẫn dừng ở Spec** để bạn liếc qua bản
    thiết kế (đây là điểm dừng hợp lý — kiểm tra app có dừng đúng chỗ đó không).
  - Với Confirm = auto, app **không** bắt bạn bấm ở các gate trung gian.
  - **Nhưng**: bước import/chạy-thật vào Dify **luôn phải chờ bạn bấm** (không được tự đẩy lên Dify).
    Kiểm tra: app có tôn trọng ranh giới này không? (auto ≠ tự deploy)
- Trong lúc chờ: app có **báo hiệu tiến độ rõ ràng** không (đang chạy phase nào, còn sống hay treo)?
  Là người bận, cảm giác "không biết nó có đang làm gì không" là một **finding C5** đáng ghi.

### Bước 3 — Nghiệm thu nhanh + chạy thật (nếu có Dify)
- Ở gate Spec: liếc bản thiết kế. Với người bận, câu hỏi là *"đủ đúng để mình bấm tiếp trong 10 giây
  không?"* — nếu phải đọc lâu mới hiểu thì ghi finding.
- Tới Test ④: nếu có Dify, cho **chạy thật** một lần, xem output với input thật (ví dụ thành phố
  *"Đà Nẵng"* hoặc *"Kyoto"*) — câu mô tả thời tiết trả về có **dùng được ngay** không? → C2.
- Nếu không có Dify: dừng ở bản local, ghi "C2 không đánh giá được".

### Bước 4 — Dọn dẹp
- Discard/Cancel build còn treo; xoá app thử trong Dify nếu có nút dọn.

## So sánh phụ (tùy chọn, nếu còn thời gian & ngân sách lượt)
Nếu muốn kiểm chứng "nhanh có thật sự nhanh hơn": có thể so sánh cảm nhận số-bước / thời-gian giữa
**Fast build ON** và một lần chạy **Fast build OFF** cho cùng nhu cầu. Đừng chạy nếu sợ tốn lượt —
đây chỉ là tùy chọn.

## Bạn báo cáo gì (bắt buộc)

| Tiêu chí | ✅/🟡/❌ | Bằng chứng |
|---|---|---|
| C1 Đạt mục tiêu | | Ra được workflow đơn giản như ý không? |
| C2 Chất lượng output | | (Nếu chạy thật) câu mô tả thời tiết dùng được không? |
| C3 Rõ ràng | | Fast/auto có tự-giải-thích để người bận đoán đúng không? |
| C4 Phục hồi & an toàn | | auto có **đúng** là không tự deploy (chờ người bấm import) không? |
| C5 Mượt / tốc độ | | Ít thao tác thừa? Báo tiến độ rõ khi chờ? |

- **Verdict:** *"Người bận này có xong việc nhanh mà vẫn kiểm soát được điểm quan trọng (import) không?"*
- **Findings** xếp mức 🔴/🟠/🟡 kèm bằng chứng.
