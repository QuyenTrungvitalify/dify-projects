# UAT — Test Builder theo góc nhìn người dùng thật (Claude for Chrome)

> **Đây KHÔNG phải bộ QA nghiệm thu.** Bộ QA giòn (assert đúng từng ký tự, truy vết acceptance
> criteria) nằm ở [`../009/qa/`](../009/qa/) (T01–T15 + BROWSER-TEST-ALL). Bộ này **bổ sung**, không
> thay thế: nó test **trải nghiệm** — *người dùng có ý tưởng → app có giúp họ ra được một workflow
> chạy được thật trong Dify, cho output đúng nhu cầu không?*
>
> Mỗi file `J*.md` là **một nhân vật (persona) + một mục tiêu thật**. Copy **nguyên khối** một file
> vào Claude for Chrome; extension sẽ tự lái trình duyệt đóng vai người dùng đó.

---

## 1. Triết lý test (đọc kỹ — khác hẳn bộ QA cũ)

Bạn đóng vai **một người dùng thật**, không phải máy dò chuỗi. Ba nguyên tắc:

1. **Chấm theo KẾT QUẢ, không theo chữ.** UI có thể là **English hoặc 日本語**, chữ có thể đổi giữa
   các phiên bản. **Đừng FAIL vì sai chữ.** FAIL khi *mục tiêu của người dùng không đạt* — ví dụ:
   không ra được workflow, workflow chạy ra output sai/vô nghĩa, người dùng bị kẹt không biết làm gì
   tiếp, hoặc lỗi hiện ra mà người thường không hiểu để tự xử lý.
2. **Hành xử như người thật.** Đọc màn hình, **tự quyết** bước tiếp theo (không cần ai cầm tay). Nếu
   một chỗ khó hiểu → ghi lại đúng chỗ đó như một điểm ma sát (friction), rồi thử cách một người bình
   thường sẽ thử. Được phép khám phá tự do ngoài kịch bản khung.
3. **Ghi nhận ma sát là "phát hiện", không chỉ pass/fail.** Nút không rõ nghĩa, phải chờ mà không có
   dấu hiệu gì, thông báo lỗi kỹ thuật khó hiểu, phải cuộn/mò mới thấy chức năng — tất cả là **findings
   về UX**, đáng ghi ngang với lỗi chức năng.

## 2. Rubric chấm điểm (mỗi journey chấm 5 tiêu chí)

Cho mỗi tiêu chí: **✅ Tốt / 🟡 Tạm được (có ma sát) / ❌ Hỏng**. Kèm 1 câu bằng chứng.

| # | Tiêu chí | Câu hỏi cốt lõi |
|---|---|---|
| C1 | **Đạt mục tiêu** | Người dùng có ra được thứ họ cần (workflow hoàn chỉnh, đúng việc) không? |
| C2 | **Chất lượng output** | Khi chạy thật trong Dify với input thật, output có **đúng & hữu ích** cho nhu cầu không? |
| C3 | **Rõ ràng / dễ hiểu** | Ở mỗi bước người dùng có biết *đang ở đâu, làm gì tiếp, tại sao* không? |
| C4 | **Phục hồi & an toàn** | Khi làm sai / lỗi / mất kết nối, app có dẫn người dùng ra khỏi bế tắc không? |
| C5 | **Mượt / tốc độ** | Chờ đợi có được báo hiệu rõ không? Có phải làm thao tác thừa/khó hiểu không? |

Cuối mỗi journey: **Verdict tổng** (Người dùng này có thành công không?) + danh sách **findings** xếp
theo mức độ (chặn đường / gây khó chịu / gợi ý nhỏ).

## 3. Chuẩn bị (người thao tác làm trước khi giao prompt)

Từ repo root `/Users/quyenbt/Desktop/MyProjects/dify-projects`:

```bash
./scripts/setup.sh && ./scripts/setup-node.sh   # lần đầu
claude auth login                                # bắt buộc — Builder gọi claude
cd apps/builder && npm start                     # phục vụ UI tại http://127.0.0.1:4123
```

- **App:** http://127.0.0.1:4123 (chỉ bind `127.0.0.1`, single-user, không có màn login).
- **Để chạy thật trong Dify (C2)** — bắt buộc với J1/J5, tùy chọn với J2/J3:
  - `apps/builder/.env` có `DIFY_CONSOLE_URL`, `DIFY_CONSOLE_TOKEN` (admin key), `DIFY_WORKSPACE_ID`.
  - Dify đang chạy (ví dụ `http://localhost:8090`). Xem [HUONG_DAN.md](../../../../HUONG_DAN.md) §3.
  - Nếu **không** có creds Dify: vẫn chạy được J1–J5 tới bước tạo file local, nhưng **bỏ qua** phần
    import + live-run và ghi rõ "C2 không đánh giá được — thiếu Dify".

## 4. Luật an toàn & chi phí (áp dụng cho MỌI journey)

Đây là điều kiện để test không tự phá chính nó — **đọc trước khi bắt đầu**:

1. **Mỗi phase Analyze/Spec/Implement = 1 lượt `claude` THẬT, có thể tới ~5 phút và tốn tiền.** Sau khi
   bấm nút làm chạy/đi tiếp một phase, **poll trang** tới khi có tín hiệu xác định (thẻ gate mới, badge
   trạng thái, banner lỗi). Timeout mặc định **300 giây/phase**. Quá timeout mà không có tín hiệu →
   **DỪNG và báo cáo**, **KHÔNG bấm lại** (bấm lần 2 có thể gây khoá lượt 409).
2. **Không tạo build thừa.** Một journey chỉ cần 1–2 build. Đừng khởi động build mới cho mỗi bước.
3. **Import luôn tạo app MỚI trong Dify.** Đừng import lặp một workflow nhiều lần (tạo app trùng). Nếu
   app có nút "Delete old apps"/"Delete test apps" → dùng để dọn.
4. **Dọn dẹp khi xong:** Discard/Cancel mọi build còn treo ở gate để không giữ khoá lượt cho journey
   sau. Discard **không** xoá `projects/`, chỉ đóng build.
5. **Ngôn ngữ:** cứ để nguyên ngôn ngữ mặc định của app (EN hoặc JA). Không cần ép English — bạn chấm
   theo nghĩa, không theo chữ. (Nếu muốn, có nút đổi ngôn ngữ ở góc trên phải.)

## 5. Bản đồ 4 phase + vòng đời (để bạn biết đang ở đâu)

`Analyze ①` → `Spec ②` (duyệt SPEC.md) → `Implement ③` (sinh `main.yml` + 3 linter) → `Test ④`.

Ở **Test ④**, tùy khả năng workspace (có creds Dify hay không) app sẽ mời:
- **Chạy thật trong Dify** ("Test with workflow"/"Run test with workflow") → app import bản thử, chạy
  với input, rồi hiện **gate LIVE**: đạt (`LIVE ✓`), cần xem lại (`LIVE ✗`), hoặc không chạy được vì hạ
  tầng (`LIVE ⚠`). Gate LIVE hiển thị **output thật** + một **"judge (advisory)"** (nhận xét tham
  khảo, không phải phán quyết) + link app trong Dify.
- **Import** bản chính thức vào Dify ("Import to Dify") hoặc **Skip** để kết thúc local.

Chế độ **Confirm**: `each step` (dừng mỗi gate) · `spec only` (chỉ dừng ở Spec) · `auto` (tự chạy —
nhưng **import/chạy-thật luôn chờ người bấm**). Chế độ **Fast build**: gộp Analyze+Spec, chỉ dùng khi
làm mới từ đầu, luôn dừng ở Spec để duyệt.

## 6. Các journey

| File | Nhân vật | Mục tiêu thật | Cần Dify? | Chi phí |
|---|---|---|---|---|
| [J1-nguoi-moi.md](J1-nguoi-moi.md) ⭐ | Người mới, ý tưởng đời thường | Từ 0 → workflow chạy thật, output đúng nhu cầu | **Có** | ~3 lượt |
| [J2-nhanh-gon.md](J2-nhanh-gon.md) | Người bận, muốn nhanh | Fast + auto, ít can thiệp, ra bản chạy được nhanh | Tùy chọn | ~1–2 lượt |
| [J3-sua-workflow-cu.md](J3-sua-workflow-cu.md) | Người sửa workflow cũ | Đổi/nâng cấp workflow đã có, không làm hỏng | Tùy chọn | ~1–3 lượt |
| [J4-kho-tinh.md](J4-kho-tinh.md) | Người khó tính / hay thao tác vụng | Nhập mơ hồ/mâu thuẫn, bấm bậy, reload, hủy — app có đỡ được không | Không | ~1 lượt |
| [J5-workflow-phuc-tap.md](J5-workflow-phuc-tap.md) | Người cần workflow phức tạp thật | Cần rẽ nhánh/lặp/nhiều node — chạy thật ra kết quả đúng | **Có** | ~3+ lượt |

**Gợi ý thứ tự:** J4 (rẻ, không cần Dify, làm nóng) → J1 (luồng lõi ⭐) → J2 → J3 → J5.
Có thể chạy độc lập từng file; không bắt buộc theo thứ tự.
