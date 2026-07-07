# J4 — Người khó tính / hay thao tác vụng (stress & phục hồi)

> Copy **toàn bộ khối dưới** vào Claude for Chrome.
> **Không cần Dify.** Journey rẻ nhất — dùng để làm nóng. Đọc [00-README.md](00-README.md) §2, §4 trước.

---

Bạn đóng vai **một người dùng khó tính, thiếu kiên nhẫn, hay làm sai thao tác** — kiểu người sẽ nhập nhu
cầu mơ hồ, đổi ý giữa chừng, bấm nhầm, sốt ruột bấm hai lần, đóng nhầm tab rồi mở lại. Mục tiêu của bạn
**không phải** để app chạy đẹp, mà để xem: **khi người dùng làm những việc "kỳ cục nhưng có thật", app có
đỡ được và dẫn họ ra khỏi bế tắc không?** App **không được**: treo cứng, mất dữ liệu đang làm, hiện lỗi
kỹ thuật khó hiểu, hoặc rơi vào trạng thái không thoát ra được. Chấm theo **mức độ app che chở người dùng
vụng**, không so từng chữ.

**App:** http://127.0.0.1:4123

> Lưu ý an toàn (§4): dù bạn "thử phá", vẫn tôn trọng **timeout 300s/phase** và **đừng bấm lại một nút
> làm-chạy-phase khi phase chưa xong** — trừ khi chính bước test dưới đây yêu cầu (double-click), và khi
> đó bạn **kỳ vọng app chặn lần bấm thừa**, không phải tự mình gây hỏng.

## Việc bạn làm (mỗi mục là một "kiểu quậy" — ghi app phản ứng ra sao)

### A. Gửi khi chưa nhập gì
- Ô nhập để trống → bấm gửi. Kỳ vọng: app **từ chối một cách rõ ràng** ("hãy mô tả yêu cầu…" đại loại
  thế), **không** tạo build rỗng, **không** văng lỗi kỹ thuật. Thông báo có **dễ hiểu với người thường**
  không?

### B. Nhu cầu mơ hồ / mâu thuẫn / ngoài phạm vi
Thử lần lượt vài kiểu nhập "khó" (mỗi cái chỉ cần chạy tới gate Spec rồi dừng — **đừng** đi hết để tiết
kiệm lượt; Discard sau mỗi cái):
- **Mơ hồ:** *"làm cho tôi cái gì đó hữu ích với văn bản"* — app có **hỏi lại / nêu câu hỏi mở / ghi chú
  phạm vi** thay vì đoán bừa rồi làm sai không?
- **Mâu thuẫn:** *"một workflow không dùng AI nhưng tự viết một bài luận sáng tạo"* — app có nhận ra mâu
  thuẫn và nói ra không, hay giả vờ làm được?
- **Ngoài phạm vi:** *"đặt vé máy bay cho tôi đi Tokyo ngày mai"* (app chỉ tạo Dify workflow, không đặt
  vé) — app có **lịch sự chỉ ra giới hạn** thay vì crash/hứa hão không?
- **(Tùy chọn) đa ngôn ngữ / rất dài / hơi khiêu khích:** nhập một đoạn tiếng Nhật, hoặc một đoạn rất
  dài, xem app xử lý mượt không.

Với mỗi cái: bạn **không** chấm "nó có làm được việc bất khả thi không" — bạn chấm **app có phản hồi
trung thực, không sập, và giữ người dùng ở thế kiểm soát** không (C4).

### C. Sốt ruột bấm hai lần
- Bắt đầu một build bình thường (một nhu cầu đơn giản). Ở một gate, **bấm nút đi-tiếp hai lần thật
  nhanh**. Kỳ vọng: lần thứ hai **bị chặn nhẹ nhàng** (kiểu "đang bận, thử lại sau") chứ **không** tạo
  hai lần chạy / không hỏng trạng thái. Thông báo bận có khó chịu/khó hiểu không?

### D. Reload giữa chừng (mất kết nối giả lập)
- Khi một build đang dừng ở gate, **tải lại trang (F5)**. Kỳ vọng: sau khi tải lại, app **khôi phục
  đúng** chỗ bạn đang ở (đúng phase/gate, dấu hiệu "đã kết nối lại"), build vẫn còn trong danh sách đang
  chạy — **không** mất việc đang làm. Đây là phép thử C4 quan trọng nhất.

### E. Đổi ý — Hủy rồi làm lại
- Ở một gate, **Discard/Cancel** build. Kỳ vọng: build đóng gọn, **không kẹt khoá** khiến bạn không start
  được cái mới. Sau đó **start một build mới** ngay → nó phải chạy được (chứng tỏ hủy đã giải phóng khoá).
- Với build đang chạy: thử nút **Stop** → app có hỏi xác nhận rõ ràng ("dừng build này?") trước khi dừng
  không, hay dừng phũ làm mất việc bất ngờ?

### F. (Tùy chọn) Hai việc cùng lúc
- Start build 1, để nó dừng ở gate. Start tiếp build 2. Kỳ vọng: **cả hai cùng tồn tại**, không báo "bận"
  chỉ vì có 2 build đang treo (chỉ khi **cùng lúc chạy 2 lượt** mới nên bị chặn). Người dùng có bị chặn
  oan không?

## Bạn báo cáo gì (bắt buộc)

| Tiêu chí | ✅/🟡/❌ | Bằng chứng |
|---|---|---|
| C1 Đạt mục tiêu | | Sau mọi trò quậy, người dùng vẫn hoàn tất được một build bình thường chứ? |
| C3 Rõ ràng | | Các thông báo từ chối/bận/lỗi có **dễ hiểu với người thường** không? |
| C4 Phục hồi & an toàn | | Reload khôi phục đúng? Hủy giải phóng khoá? Double-click bị chặn? Không mất việc? |
| C5 Mượt / tốc độ | | App có làm người vụng thấy **được che chở** hay thấy **bị phạt** vì lỡ tay? |

*(C2 không áp dụng ở journey này trừ khi bạn chạy hết một build tới output.)*

- **Verdict:** *"App có tha thứ cho người dùng vụng và giữ họ luôn có đường thoát không?"*
- **Findings** xếp mức 🔴 (mất việc / kẹt cứng / lỗi khó hiểu chặn đường) · 🟠 (khó chịu) · 🟡 (gợi ý).
  Nhấn mạnh mọi trường hợp **treo cứng, mất dữ liệu, hoặc lỗi kỹ thuật lộ ra cho người dùng cuối**.
