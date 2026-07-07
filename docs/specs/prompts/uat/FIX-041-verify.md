# Verify spec 041 — "Request changes" at every ④ gate (Claude for Chrome)

> Kiểm chứng: sau khi có Spec, **mọi gate ④ Test đều có nút "Request changes / 変更を依頼"** để sửa
> workflow — kể cả `LIVE ⚠` (infra), gate Import, và ④ lint-fail (trước đây các gate này KHÔNG có).
>
> ⚠️ **BẮT BUỘC trước khi test**:
> 1. **Rebuild + restart backend** (spec 041 sửa ở server): `lsof -ti:4123 | xargs kill` →
>    `cd apps/builder && npm run build && npm start`. **Hard-refresh** trình duyệt (`Cmd/Ctrl+Shift+R`).
> 2. **Cần Dify selfhost creds** trong `apps/builder/.env` (`DIFY_CONSOLE_URL`/`DIFY_CONSOLE_TOKEN`/
>    `DIFY_WORKSPACE_ID`) + Dify đang chạy. **Lý do**: các gate mới chỉ hiện khi ④ **dừng ở gate**; không
>    có creds thì ④ chạy thẳng `done` (không gate) → không có gì để test.

---

Bạn là QA agent điều khiển trình duyệt, kiểm chứng tính năng **"Request changes ở mọi gate ④"** của app
**Dify Workflow Builder** tại **http://127.0.0.1:4123**. Đánh giá theo hành vi thực tế, không so từng chữ
(UI có thể English hoặc tiếng Nhật: nút "Request changes" = "変更を依頼").

**Luật an toàn**: mỗi phase Analyze/Spec/Implement là 1 lượt `claude` thật (tới ~5 phút) — sau khi bấm
chạy/đi-tiếp, **poll trang** tới khi có gate/badge/lỗi, timeout 300s/phase, **không bấm lại** khi đang
chạy. Xong thì Discard/Cancel build còn treo.

**Requirement để test** (rẻ): `R = "A workflow that takes a topic string and returns a one-paragraph summary."`

## Bối cảnh (cái gì là PASS)

- **Trước fix (bug)**: ở gate ④ kiểu `LIVE ⚠` (không chạy được vì hạ tầng), gate **Import** (selfhost),
  hoặc ④ lint-fail, chỉ có các nút như *Retry live / Accept static / Import / Skip / Accept / Discard* —
  **KHÔNG có cách sửa workflow**; muốn sửa phải đi vòng Accept → done → "Edit this workflow".
- **Sau fix (PASS)**: các gate đó **đều có thêm nút "Request changes / 変更を依頼"**; bấm vào → gõ thay
  đổi → **build quay lại phase Implement**, sửa `main.yml`, rồi park lại ở gate Implement.

## Các bước

### Bước 1 — Build tới bước ④ và dừng ở một GATE ④
1. Nhập `R`, đặt **Confirm: each step**, gửi. Đi qua Analyze → Spec → Implement (poll giữa mỗi bước).
2. Ở **gate Implement** (badge "Implemented", có `main.yml` + lint xanh), chọn đường tới ④ sao cho nó
   **dừng ở một gate ④** (không chạy thẳng `done`). Thử theo thứ tự, dừng ngay khi thấy một gate ④:
   - **Ưu tiên**: bấm **"Test with workflow" / ワークフローでテスト** (chạy thật trong Dify). Nó sẽ park ở
     một gate LIVE: `LIVE ✓` / `LIVE ✗` (workflow chạy) **hoặc** `LIVE ⚠` (không chạy được vì hạ tầng,
     VD workspace 0 model).
   - Nếu thay vào đó bạn thấy nút **"Continue to Test"** dẫn tới gate **Import** (Import to Dify / Skip)
     — đó cũng là một gate ④ hợp lệ để test.
3. **Ghi rõ bạn đang ở gate ④ loại nào** (LIVE ✓/✗/⚠, Import, hay lint-fail).

### Bước 2 — Assert nút "Request changes" CÓ MẶT ở gate ④ đó  ⭐ trọng tâm
- Ở gate ④ vừa park, kiểm tra danh sách nút. **Kỳ vọng (PASS)**: có nút **"Request changes" / "変更を依頼"**
  (nút kiểu ghost, có icon message), bên cạnh các nút gốc của gate đó.
  - `LIVE ⚠`: phải có `Retry live` · `Accept static` · **`Request changes`** · (Delete apps) · Discard.
  - Gate Import: `Import to Dify` · `Skip import` · **`Request changes`** · Discard.
  - `LIVE ✓/✗`: `Accept result` · **`Request changes`** · `Re-test` · … (gate này vốn đã có — vẫn tính PASS).
- **FAIL** nếu ở `LIVE ⚠` / Import / lint-fail mà **không** thấy nút Request changes.

### Bước 3 — Bấm Request changes và xác nhận nó SỬA workflow (không no-op)
1. Bấm **"Request changes" / 変更を依頼**. Ô nhập chuyển sang chế độ sửa (placeholder kiểu "What should
   change?"), có nhãn "Request changes" + link "Back to Ask".
2. Gõ một thay đổi cụ thể, ví dụ: `Also return the word count of the summary as a separate field.`
3. Bấm **Send & re-run** (gửi & chạy lại). Poll (tới ~5 phút).
4. **Kỳ vọng (PASS)**:
   - Build **quay lại phase Implement (③)** — KHÔNG ở lại ④, KHÔNG chỉ chạy lại test trên workflow cũ.
   - Mở panel artifact → tab `main.yml` (hoặc `Diff`): **nội dung đã đổi** theo yêu cầu (có phần word
     count mới). Đây là bằng chứng nó **thật sự sửa workflow**, không no-op.
   - Nó **park lại ở gate Implement** ("main.yml built and linted") để bạn tiếp tục (Continue to Test /
     Test with workflow lại).
   - **FAIL** nếu: nó chỉ chạy lại test trên workflow y nguyên (main.yml không đổi), hoặc báo lỗi, hoặc
     không quay về Implement.

### Bước 4 — Dọn dẹp
- Discard/Cancel build còn treo. Nếu có nút "Delete test apps" và đã tạo app thử trong Dify → dọn.

## Báo cáo (bắt buộc)

Bảng: `| Mục | PASS/FAIL | Thấy gì |` cho:
1. Gate ④ đã park (loại nào) + nút "Request changes" có mặt không.
2. Sau Request changes: có quay về Implement không.
3. `main.yml` có thật sự đổi theo yêu cầu không (kèm trích đoạn thay đổi).

Kết luận: một câu — *"user có thể sửa workflow ngay tại gate ④ mà không phải đi vòng không?"*
Mỗi FAIL kèm screenshot + mô tả *thấy gì vs kỳ vọng*.

> **Nếu không có Dify creds**: ④ sẽ chạy thẳng `done` (không có gate ④) → không thể kiểm chứng spec 041.
> Khi đó dừng lại và báo: *"thiếu Dify selfhost creds — không tới được gate ④ để test"*. (Nút Request
> changes ở các gate Analyze/Spec/Implement thì vốn đã có từ trước, không phải phần của spec 041.)
