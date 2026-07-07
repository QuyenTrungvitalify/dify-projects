# J3 — Người sửa workflow cũ (không muốn làm hỏng)

> Copy **toàn bộ khối dưới** vào Claude for Chrome.
> Dify là **tùy chọn** (dùng để re-test sau khi sửa). Đọc [00-README.md](00-README.md) §2, §4 trước.
> **Điều kiện:** cần **ít nhất một workflow đã có sẵn** để sửa. Nếu chưa có, hãy chạy nhanh J2 trước
> để tạo một workflow, hoặc mở một project có sẵn trong sidebar.

---

Bạn đóng vai **người đã có một workflow từ lần trước** và giờ muốn **thay đổi/nâng cấp nó**, chứ không
làm mới từ đầu. Nỗi sợ lớn nhất của bạn: *"sửa xong nó hỏng thứ đang chạy ngon"*. Bạn cũng có thói quen
**hỏi trước khi làm** — muốn hiểu app đang định làm gì trước khi cho nó sửa file. Chấm theo **kết quả &
sự an tâm khi sửa**, không so từng chữ.

**App:** http://127.0.0.1:4123

## Việc bạn làm

### Bước 1 — Tìm và mở workflow cũ
- Trong sidebar (cây Projects), tìm một workflow đã có. Nếu đang ở một build đã xong (done), tìm nút
  kiểu **"Edit this workflow"**; hoặc từ sidebar bắt đầu một task mới **nhắm vào workflow đã có** (chọn
  workflow ở tùy chọn Workflow thay vì "none (new)").
- Kiểm tra: app có làm cho việc **"sửa cái đã có" khác rõ với "làm mới từ đầu"** không? (Ví dụ: nó có
  cho biết bạn đang sửa workflow tên gì?) → C3.

### Bước 2 — HỎI trước (chế độ Ask), chưa cho sửa
Nhiều app trộn lẫn "hỏi" và "ra lệnh sửa". App này tách hai chế độ: **Ask** (hỏi — chỉ trả lời, **không
đụng vào file**) và **Request changes** (yêu cầu sửa — thật sự chạy lại phase và sửa `main.yml`).
- Ở chế độ **Ask**, hỏi một câu về workflow hiện tại, ví dụ: *"Workflow này hiện đang làm gì, và nếu tôi
  muốn thêm một bước dịch sang tiếng Việt thì cần đổi gì?"*
- Kiểm tra quan trọng (C4 — an toàn): sau câu hỏi Ask này, **file có bị đổi không?** Kỳ vọng: **không** —
  Ask chỉ trả lời, không sửa gì. Nếu app trả lời hữu ích mà không âm thầm sửa file → rất tốt. Nếu bạn
  thấy nó thay đổi artifact chỉ vì bạn hỏi → **finding 🔴**.

### Bước 3 — Yêu cầu một thay đổi THẬT (chế độ Request changes)
- Chuyển sang **Request changes** và yêu cầu một thay đổi cụ thể, ví dụ:
  *"Thêm một bước: sau khi có kết quả, dịch nó sang tiếng Việt và trả về cả bản gốc lẫn bản dịch."*
- **Chờ đúng cách** (phase chạy lại tới ~5 phút; poll; timeout 300s; không bấm lại).
- Sau khi Implement lại, tìm **"view diff"/xem khác biệt** trong panel artifact. Kiểm tra:
  - Diff có **base không rỗng** (so với bản trước khi sửa) không? → bằng chứng "đây là sửa tại chỗ, không
    phải tạo lại từ 0".
  - Thay đổi bạn yêu cầu **có thật sự xuất hiện** không? (có bước dịch mới?)
  - Những phần **không liên quan có bị giữ nguyên** không (không bị viết lại toàn bộ, không mất thứ cũ)?
    → đây là nỗi sợ chính của bạn; app có làm bạn an tâm không?

### Bước 4 — Re-test sau khi sửa (nếu có Dify)
- Tới Test ④, cho **chạy lại thật** ("Re-test"/"Test with workflow"). Xem output:
  - Thay đổi có hoạt động không (giờ có bản tiếng Việt trong output)?
  - Chức năng cũ có **còn nguyên** không (không bị vỡ)?
- Lưu ý: import lại sẽ tạo **app mới** trong Dify (không cập nhật app cũ tại chỗ). Kiểm tra app có **nói
  rõ điều này** để bạn không tưởng nhầm đã ghi đè app cũ không → C3/C4. Dọn app thử nếu có nút.

### Bước 5 — Dọn dẹp
- Discard/Cancel build còn treo; xoá app thử trong Dify nếu có nút dọn.

## Bạn báo cáo gì (bắt buộc)

| Tiêu chí | ✅/🟡/❌ | Bằng chứng |
|---|---|---|
| C1 Đạt mục tiêu | | Thay đổi yêu cầu có được thực hiện đúng không? |
| C2 Chất lượng output | | (Nếu re-test) tính năng mới chạy + tính năng cũ còn nguyên? |
| C3 Rõ ràng | | "Sửa cái cũ" có khác rõ "làm mới"? Diff dễ hiểu? Cảnh báo tạo-app-mới rõ? |
| C4 Phục hồi & an toàn | | **Ask KHÔNG sửa file**; Request-changes chỉ sửa đúng chỗ; không phá phần cũ? |
| C5 Mượt / tốc độ | | Chuyển Ask ⇄ Request-changes có tự nhiên không? |

- **Verdict:** *"Người này có dám sửa workflow đang chạy mà không sợ hỏng không?"*
- **Findings** xếp mức 🔴/🟠/🟡. Đặc biệt nhấn mạnh bất kỳ trường hợp **Ask lại âm thầm sửa file**
  (nghiêm trọng) hoặc **sửa nhỏ lại viết lại toàn bộ / làm mất phần cũ**.
