# J5 — Người cần workflow phức tạp thật (không chỉ 1 node LLM)

> Copy **toàn bộ khối dưới** vào Claude for Chrome.
> **Cần Dify đang chạy + creds** để chấm C2 (chạy thật). Đây là journey tốn lượt nhất (~3+ lượt).
> Đọc [00-README.md](00-README.md) §2, §4 trước. **Tắt Fast build** — Fast chỉ tạo 1-node đơn giản.

---

Bạn đóng vai **một người dùng có nghề**, cần một workflow **thật sự có logic**, không phải "hỏi AI một
câu". Bạn muốn kiểm chứng: **app có xây được workflow nhiều bước có rẽ nhánh/lặp/xử lý — và chạy ra kết
quả đúng** không, hay chỉ giỏi mấy ví dụ đồ chơi. Bạn đọc được kết quả nghiệp vụ, nhưng **không** cần
soi YAML; bạn chấm bằng **"nó có làm đúng việc phức tạp mình cần không"**. Chấm theo **năng lực thật của
engine + độ đúng của output**, không so từng chữ.

**App:** http://127.0.0.1:4123

**Nhu cầu (đóng vai) — chọn MỘT, hoặc tự nghĩ một cái tương đương có logic thật:**

> **Phương án A (rẽ nhánh + phân loại):** *"Nhập một email khách hàng. Phân loại nó thành một trong ba
> nhóm: KHIẾU NẠI, HỎI ĐÁP, hoặc SPAM. Nếu là KHIẾU NẠI thì soạn một email xin lỗi + hướng xử lý; nếu là
> HỎI ĐÁP thì soạn câu trả lời; nếu là SPAM thì chỉ trả về nhãn SPAM. Trả về nhãn + nội dung soạn (nếu
> có)."* — buộc phải có **rẽ nhánh** (if/else), không thể là 1 node.

> **Phương án B (lặp/tổng hợp):** *"Nhập một danh sách nhiều đoạn phản hồi (mỗi dòng một đoạn). Với từng
> đoạn, chấm điểm hài lòng 1–5; sau đó tổng hợp: điểm trung bình + 3 vấn đề bị nhắc nhiều nhất."* — buộc
> phải **lặp qua danh sách** rồi **tổng hợp**.

## Việc bạn làm

### Bước 1 — Đặt yêu cầu có logic
- **Tắt Fast build**, đặt Confirm để bạn xem được bản thiết kế (dừng ở Spec là đủ). Gõ nhu cầu (A hoặc B).
- **Chờ đúng cách** (mỗi phase tới ~5 phút; poll; timeout 300s; không bấm lại).

### Bước 2 — Nghiệm thu bản thiết kế: nó có "hiểu độ phức tạp" không?
Ở gate **Spec/Analyze**, đọc bản thiết kế như người có nghề:
- Nó có nhận ra đây là việc **nhiều bước có rẽ nhánh/lặp** không, hay định nhét tất cả vào một prompt LLM
  duy nhất (dấu hiệu engine yếu)?
- Nó có nêu được các nhánh/các bước tương ứng với nghiệp vụ bạn mô tả không?
- Nếu bản thiết kế **quá đơn giản so với nhu cầu** → dùng Request changes/Edit spec để nói rõ:
  *"Đây cần các nhánh xử lý khác nhau theo phân loại, không phải một prompt duy nhất."* — rồi xem app có
  nâng cấp thiết kế không. Đây là một phép thử C1/C3 quan trọng.

### Bước 3 — Kiểm chứng workflow thật sự phức tạp (không cần đọc YAML kỹ)
Sau Implement, mở tab `main.yml` trong panel. Bạn **không** cần hiểu từng dòng — chỉ **lướt tìm dấu hiệu
cấu trúc** khớp nhu cầu:
- Phương án A: có dấu hiệu **rẽ nhánh** (nhiều đường xử lý theo phân loại) không, hay chỉ một node?
- Phương án B: có dấu hiệu **lặp qua danh sách** + một bước **tổng hợp** không?
- Nếu chỉ thấy đúng một node LLM làm tất → **finding**: engine không dựng được độ phức tạp đã mô tả.
(Nếu không chắc đọc cấu trúc, cứ dựa vào **output khi chạy thật** ở bước 4 để kết luận.)

### Bước 4 — Chạy thật với input thật (phần quyết định — C2)
Tới Test ④, cho **chạy thật trong Dify**. Nhập input thật để ép các nhánh/logic lộ ra:
- **Phương án A:** chạy ít nhất **hai** input khác nhóm — ví dụ một email khiếu nại thật ("Sản phẩm hỏng,
  tôi rất bực!") và một câu hỏi đáp ("Cho hỏi giờ mở cửa?"). Kỳ vọng: **phân loại đúng** + nội dung soạn
  **khớp nhánh** (khiếu nại → xin lỗi; hỏi đáp → trả lời; nếu thử spam → chỉ nhãn). Nếu mọi input đều ra
  cùng một kiểu output → nhánh không hoạt động → C2 ❌.
- **Phương án B:** nhập một danh sách 3–4 đoạn có sắc thái khác nhau. Kỳ vọng: có **điểm cho từng đoạn**
  + **trung bình** + **các vấn đề nổi bật** hợp lý.
- Đọc phần **"judge (advisory)"** như ý kiến tham khảo, nhưng **bạn tự quyết** output có đúng nhu cầu
  không (judge chỉ là gợi ý, không phải phán quyết).
- Nếu `LIVE ⚠` (không chạy được vì hạ tầng) → ghi C2 "không đánh giá được (hạ tầng)", không tính app hỏng.

### Bước 5 — Dọn dẹp
- Import bản chính thức nếu muốn giữ; dùng "Delete old apps"/"Delete test apps" dọn app thử; Discard build treo.

## Bạn báo cáo gì (bắt buộc)

| Tiêu chí | ✅/🟡/❌ | Bằng chứng |
|---|---|---|
| C1 Đạt mục tiêu | | Ra được workflow **nhiều bước có logic** (không phải 1 node đồ chơi) không? |
| C2 Chất lượng output | | Chạy thật: các nhánh/lặp có **đúng** với nhiều input khác nhau không? (kèm input→output thấy được) |
| C3 Rõ ràng | | Bản thiết kế có phản ánh đúng độ phức tạp? Có cho bạn ép nâng cấp khi nó làm đơn giản quá không? |
| C4 Phục hồi & an toàn | | (Nếu phải Request changes) app nâng cấp thiết kế đúng hướng, không phá phần đã đúng? |
| C5 Mượt / tốc độ | | Việc phức tạp có làm quy trình rối/chậm bất hợp lý không? |

- **Verdict:** *"App có phải công cụ xây workflow THẬT (đủ sức việc có nghề) hay chỉ hợp ví dụ đơn giản?"*
- **Findings** xếp mức 🔴/🟠/🟡, kèm **bằng chứng input→output** cho C2 (quan trọng nhất ở journey này).
- **app_id / app_url** đã import (nếu có).
