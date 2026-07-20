---
name: spec-close
description: Close (retire) a shipped spec in docs/specs/ without losing knowledge — dissect it into knowledge types, verify each piece landed in its permanent home (grep-checked, not promise-based), then delete the spec file. Use when the user asks to delete/close/retire a spec, or says a spec has shipped. Refuses to delete while any piece is homeless.
---

# spec-close — đóng một spec mà không mất tri thức

Thực thi quy trình trong [docs/specs/README.md](../../../docs/specs/README.md). Nguyên lý: spec là
bảng phân loại tạm; nó chỉ được chết khi **mọi mảnh tri thức đã về nhà cố định**, chứng minh bằng
grep chứ không bằng lời hứa.

**Input**: số spec (vd `071`) hoặc tên file. Nhiều spec một lần được (`071 072`) — chạy tuần tự.

## Quy trình

### 1. Đọc và mổ

Đọc TOÀN BỘ file spec. Phân loại từng section theo bảng "loại tri thức → nhà" trong
`docs/specs/README.md`. Kết quả bước này là một **bảng mổ**: mảnh → loại → nhà đích. Chú ý:

- Mảnh đắt nhất thường là **nguyên tắc thiết kế / non-goal dạng "đừng bao giờ"** — không phải danh
  sách slice. Đừng để nó lọt vì "không phải việc".
- Slice đã ship nhưng chỉ có trong CHANGELOG chưa đủ: CHANGELOG là *sự kiện theo version*,
  `docs/state` mới là *hành vi hiện tại*. Cần cả hai vai.
- Open question đã được code trả lời → kiểm comment inline tại chỗ, KHÔNG chép về docs.
- Spec chết non (bị bác bỏ / thay thế / sai hướng): không có gì để chuyển ngoài **một dòng §9**
  ghi vì sao nó chết — rồi xoá luôn. Đừng ép mổ đủ 6 loại.

### 2. Kiểm nhà (grep thật)

Với từng mảnh, grep nhà đích bằng keyword đặc trưng (tên hàm, tên file pattern, cụm từ khoá).
Ra bảng nghiệm thu:

```
| Mảnh | Nhà | Bằng chứng grep | ✅/❌ |
```

- ✅ chỉ khi grep RA KẾT QUẢ và đoạn đó thực sự nói điều spec nói (đọc lại, đừng tin số dòng match).
- Nhà `docs/state` chọn theo doc chủ: xem mục "Bộ doc" trong `docs/state/README.md`; nếu bề mặt
  chưa có doc chủ, chọn doc gần nhất và nói rõ trong output — KHÔNG tạo file docs/state mới khi
  chưa được người dùng đồng ý.

### 3. Chuyển các mảnh ❌

Viết mảnh còn thiếu vào nhà của nó. Luật viết:

- **Chưng cất, không chép nguyên văn**: docs/state nhận *bất biến* (không số đo, không ngày tháng,
  không "run 1784…"); AGENTS.md §9 nhận đúng định dạng `- YYYY-MM-DD: <sai gì> → <luật>`;
  CAMPAIGNS.md nhận việc-để-ngỏ dạng bảng đang có sẵn.
- Viết khớp giọng văn + ngôn ngữ của file đích (docs/state đang là tiếng Việt, AGENTS.md tiếng Anh).
- Một mảnh một nhà — nếu thấy cần chép hai nơi thì một trong hai chỉ được là **con trỏ**.
- Nếu mảnh trùng một mục nhà đã có (vd finding trong CAMPAIGNS.md cùng gốc) → **gộp**, đừng thêm
  dòng mới gần-trùng.

### 4. Nghiệm thu và xoá

Chạy lại bước 2 cho đến khi **mọi hàng ✅**. Trình bảng nghiệm thu cuối cho người dùng trong output.

- Tất cả ✅ → `git rm docs/specs/<file>` (đừng `rm` thường — giữ việc xoá trong stage để commit
  message kể được chuyện).
- Còn ❌ bất kỳ → **DỪNG, không xoá**, nói rõ mảnh nào chưa về nhà và vì sao (vd cần quyết định
  của người dùng về doc chủ mới).

### 5. Ghi sổ

- Nếu tri thức chuyển đi làm thay đổi hành vi campaign quan sát được → cân nhắc dòng CHANGELOG
  (thường KHÔNG — đóng spec là việc docs).
- Nhắc người dùng commit; gợi ý message dạng `docs(spec): close NNN — knowledge moved to <homes>`.

## Chống lỗi đã biết

- **Đừng tin "đã ghi rồi"** — 5/5 hành vi 071/072 từng được tin là "có nhà" mà grep ra 0. Luôn grep.
- **Đừng xoá README.md của docs/specs** khi đóng spec cuối cùng — nó là vật mang quy trình này.
- **Đừng sửa hàng loạt comment `spec NNN` trong code nhân tiện** — ngoài phạm vi; luật comment nằm ở
  docs/specs/README.md mục "Quy ước viết spec mới".
