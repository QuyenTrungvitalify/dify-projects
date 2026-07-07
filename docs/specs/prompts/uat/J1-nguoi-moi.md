# J1 — Người mới, ý tưởng đời thường → workflow chạy thật ⭐

> Luồng lõi. Copy **toàn bộ khối dưới** vào Claude for Chrome.
> **Cần Dify đang chạy + creds trong `apps/builder/.env`** để chấm C2 (chạy thật). Thiếu Dify thì vẫn
> chạy tới bước tạo file, và ghi "C2 không đánh giá được".
> Đọc luật an toàn & rubric ở [00-README.md](00-README.md) §2, §4 trước.

---

Bạn đóng vai **một người dùng mới hoàn toàn**, chưa từng dùng app này, chỉ biết mình có một nhu cầu
công việc. Bạn KHÔNG phải kỹ sư QA — bạn là người bình thường muốn app giúp mình xong việc. Đánh giá
theo **kết quả và trải nghiệm**, không so từng chữ (UI có thể là English hoặc tiếng Nhật — không sao).

**App:** http://127.0.0.1:4123 — mở lên là thấy ngay, không có đăng nhập.

**Nhu cầu của bạn (đóng vai):**
> *"Mình hay nhận phản hồi của khách hàng bằng tiếng Anh. Mình muốn một công cụ: dán một đoạn phản hồi
> vào, nó cho mình biết cảm xúc (tích cực / tiêu cực / trung tính) và tóm tắt 1 câu ý chính."*

Bạn sẽ diễn đạt nhu cầu này **bằng lời của chính mình** khi nhập vào app (có thể tiếng Việt, tiếng Anh,
hay tiếng Nhật — cứ tự nhiên như người thật gõ). Đừng dán y nguyên đoạn trên nếu thấy không tự nhiên.

## Việc bạn làm

### Bước 1 — Ấn tượng đầu (không tốn lượt build)
Mở app và **dừng lại quan sát như lần đầu thấy**. Tự hỏi:
- Mình có hiểu app này làm gì, và mình nên bắt đầu từ đâu không? (có gợi ý, ví dụ, chỗ nhập rõ ràng?)
- Các tùy chọn dưới ô nhập (Workflow / Confirm / Fast build) — mình có đoán được nghĩa không, hay khó hiểu?
- Ghi lại **cảm nhận thật** + bất kỳ chỗ nào gây bối rối. → Đây là dữ liệu cho **C3 (rõ ràng)**.

### Bước 2 — Nhập nhu cầu và đi qua từng bước
- Chọn chế độ để bạn được **xem và duyệt** (nên để Confirm dừng ở từng bước, Fast build tắt — nhưng nếu
  bạn là người mới không biết chọn gì, cứ để mặc định và ghi lại xem mặc định có hợp lý không).
- Gõ nhu cầu bằng lời của bạn → gửi.
- **Chờ đúng cách** (xem §4 luật an toàn: mỗi phase tới ~5 phút, poll tới khi có gate/badge/lỗi, timeout
  300s/phase, **không bấm lại** nếu chưa xong).
- Tại **mỗi cửa (gate)** — Analyze, Spec, Implement — hãy đọc như người dùng thật:
  - App có **giải thích được nó vừa làm gì** và **mình cần quyết định gì** không?
  - Ở gate **Spec**: mở bản thiết kế (SPEC.md trong panel). Đọc như người đặt hàng: **bản thiết kế này
    có đúng ý mình không?** Nếu chưa đúng ý — hãy dùng chức năng yêu cầu chỉnh (Request changes / Edit
    spec), gõ một chỉnh sửa thật (ví dụ *"thêm mức cảm xúc: rất tích cực / rất tiêu cực"*), và kiểm tra
    xem app có **chạy lại đúng bước đó** và phản ánh chỉnh sửa của bạn không (đừng nhảy sang bước sau).
  - Ở gate **Implement**: workflow (`main.yml`) đã sinh ra; app báo linter xanh. Bạn không cần đọc YAML,
    nhưng kiểm tra: app có cho bạn **tin tưởng rằng nó chạy được** không (báo cáo rõ ràng, không toàn
    thuật ngữ)?

### Bước 3 — Chạy thật trong Dify (đây là phần quan trọng nhất — C2)
Tới bước **Test ④**. App sẽ mời chạy thật trong Dify (nút kiểu "Test with workflow"/"Run test with
workflow") và/hoặc import ("Import to Dify"). Hãy:
1. Cho nó **chạy thật**. Chờ tới khi hiện **gate LIVE** (đạt / cần xem lại / không chạy được vì hạ tầng).
2. Đọc **output thật** mà workflow trả về, và phần **"judge (advisory)"** (nhận xét tham khảo).
3. **Tự chấm C2 như người dùng:** nếu bạn dán một phản hồi khách hàng thật vào workflow này, output
   (cảm xúc + tóm tắt 1 câu) có **đúng và dùng được** không? Nếu app cho bạn nhập input để thử → nhập
   một câu phản hồi thật (ví dụ *"The delivery was late but the product quality is excellent."*) và xem
   kết quả có hợp lý không (kỳ vọng: cảm xúc ~ trung tính/hỗn hợp, tóm tắt nắm được cả "giao trễ" lẫn
   "chất lượng tốt").
4. Nếu gate LIVE là "không chạy được vì hạ tầng" (`LIVE ⚠`) → **không tính là app hỏng**; ghi C2 = "không
   đánh giá được (hạ tầng)" và tiếp tục.
5. Nếu ổn, **Import** bản chính thức vào Dify, rồi **mở app trong Dify** qua link hiện ra → xác nhận app
   thật sự tồn tại và mở được trong workspace. Đây là bằng chứng "vòng đời khép kín".

### Bước 4 — Dọn dẹp
- Trong Dify có thể đã sinh vài app thử — nếu app có nút "Delete old apps"/"Delete test apps", dùng để dọn.
- Discard/Cancel build nếu còn treo ở gate.

## Bạn báo cáo gì (bắt buộc)

Xuất **bảng rubric** cho journey này (theo §2 của README):

| Tiêu chí | ✅/🟡/❌ | Bằng chứng (1 câu) |
|---|---|---|
| C1 Đạt mục tiêu | | Có ra được workflow phân tích cảm xúc + tóm tắt không? |
| C2 Chất lượng output | | Chạy thật ra kết quả có đúng/hữu ích với input thật không? (kèm output thấy được) |
| C3 Rõ ràng | | Người mới có tự đi hết được không? Chỗ nào bối rối? |
| C4 Phục hồi & an toàn | | (Nếu có lỗi/chỉnh sửa) app dẫn ra khỏi bế tắc chứ? |
| C5 Mượt / tốc độ | | Chờ đợi có được báo hiệu rõ không? Thao tác thừa? |

Sau bảng:
- **Verdict:** *"Người mới này có tự tay ra được một workflow chạy thật, output dùng được không?"* — Có / Có nhưng vất vả / Không. Một đoạn giải thích.
- **Findings** xếp mức: 🔴 chặn đường · 🟠 gây khó chịu · 🟡 gợi ý nhỏ. Mỗi finding kèm chỗ xảy ra + (nếu FAIL) screenshot & mô tả *thấy gì vs kỳ vọng gì*.
- **app_id / app_url** của app đã import (nếu có).
