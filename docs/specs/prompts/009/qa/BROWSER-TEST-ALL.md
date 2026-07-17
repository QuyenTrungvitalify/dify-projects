# Prompt: Test toàn bộ Builder bằng Claude browser extension

> Copy **toàn bộ khối dưới** vào Claude browser extension (Claude for Chrome). Extension sẽ tự
> điều khiển trình duyệt để test. Bộ QA chi tiết gốc ở cùng thư mục (`T01`–`T15`); prompt này là
> bản chạy nhanh gộp các luồng chính.
>
> **Trước khi chạy** (người thao tác): backend đang chạy tại `http://127.0.0.1:4123`
> (`cd apps/builder && npm start`), và nếu test import thì `apps/builder/.env` đã có creds Dify
> (`DIFY_CONSOLE_URL`, admin key, workspace id) — Dify đang chạy ở `http://localhost:8090`. Không
> cần khai trước đích deploy: hễ creds với tới được Dify, các nút chạm Dify tự hiện ở gate.

---

Bạn là QA agent điều khiển trình duyệt. Hãy test app **Dify Workflow Builder** tại
**http://127.0.0.1:4123**. Đây là app local single-user, không có màn login.

## Quy tắc bắt buộc (đọc kỹ trước)
1. **Pin ngôn ngữ về English** trước tiên: bấm nút đổi ngôn ngữ (góc trên phải) đến khi placeholder ô
   nhập hiện đúng `Describe the workflow or change…`. Mọi assertion dưới đây dùng chuỗi tiếng Anh.
2. **Chờ đúng cách**: mỗi bước build (Analyze/Spec/Implement) là 1 lượt `claude` thật, có thể mất
   **tới ~5 phút**. Sau khi bấm nút làm chạy/đi tiếp một phase, **poll trang** đến khi xuất hiện tín
   hiệu xác định (gate card / status badge / banner lỗi). Timeout mặc định **300 giây**/phase. Nếu
   quá timeout mà không thấy tín hiệu → **DỪNG và báo cáo**, **không bấm lại** (bấm lần 2 có thể gây
   409 turn-lock).
3. **Assert chính xác**: so đúng từng ký tự với chuỗi trong backtick. "Trông có vẻ đúng" = **FAIL**.
4. **Bằng chứng**: mỗi khi FAIL, chụp screenshot + ghi rõ *thấy gì* vs *mong đợi gì*.
5. **Dọn dẹp**: build nào bạn tạo mà không cần nữa → Discard/Cancel để không giữ turn-lock.
6. Ghi kết quả từng mục vào bảng report ở cuối (PASS/FAIL + evidence).

## Requirement dùng để test (rẻ, deterministic)
- `R1` = *"A workflow that takes a topic string as input and returns a one-paragraph summary of it."*
- `R2` = *"A workflow that takes a city name and returns a short weather-style description string."*

---

## PHASE 0 — Smoke UI (0 lượt build)
1. Mở app. Assert placeholder `Describe the workflow or change…`, crumb `New task`, nhãn `SEED FROM`,
   `TRY`.
2. Sidebar: heading `Projects`, nút `New project` / `New task`; section `In progress` (nếu có build
   đang chạy).
3. Settings chips dưới ô nhập: `Workflow` (mặc định `none (new)`), `Confirm` (mặc định `auto` hoặc
   `each step`), `Deploy`, `Fast build`. Mở từng chip xem option: Confirm = `each step` / `spec only`
   / `auto`; Deploy = `none` / `selfhost` / `cloud`; Fast build = `on` / `off`.
4. Test nút đổi ngôn ngữ EN ⇆ JA rồi trả lại **English**.

## PHASE 1 — Full build + IMPORT vào Dify (tốn ~3 lượt) ⭐ luồng chính
Đặt **Confirm: `each step`**, **Deploy: `selfhost`**, **Fast build: `off`**, **Workflow: `none (new)`**.
Nhập `R1` → gửi. Sau đó theo trình tự (poll giữa mỗi bước):
1. **Analyze gate**: assert badge `Analyze complete`, title `Ready to write the spec`, các nút
   `Continue to Spec` · `Request changes` · `Discard build`. → bấm `Continue to Spec`.
2. **Spec gate**: badge `Spec ready`, title `Spec drafted — review before I build`. Mở panel artifact
   → tab `Spec` (title `SPEC.md`). Sửa nội dung 1 dòng → bấm `Save spec` → assert status
   `Saved · feeds Implement`. → bấm `Implement this spec`.
3. **Implement gate (clean)**: badge `Implemented`, title `main.yml built and linted`. Mở tab
   `main.yml` (có nội dung), mục `Lint results` với 3 dòng `validate_workflow` · `lint_refs` ·
   `lint_plugin_hashes` đều `ok`. → bấm `Continue to Test`.
4. **Import gate** (selfhost): assert các nút `Import to Dify` · `Skip import` · `Discard build`. →
   bấm **`Import to Dify`**, poll đến khi Done.
5. **Done**: badge `Done`, title `Test passed — workflow updated`. Mở tab `Report`: có card
   `DEPLOYED · selfhost` + nút `Open`. Bấm `Open` (hoặc mở URL app hiện ra) → xác nhận app mở được
   trong Dify tại `localhost:8090`.
6. **Xác nhận trong Dify**: mở `http://localhost:8090` → app mới (tên theo build) xuất hiện trong
   workspace.

## PHASE 2 — Gate decisions (reuse, ~0–1 lượt)
Trên 1 build parked ở gate: bấm `Request changes` (Analyze) hoặc `Edit spec` (Spec) → gõ vào ô
`What should change before continuing?` → `Send & re-run` → assert phase **chạy lại chính nó**, KHÔNG
nhảy sang phase sau.

## PHASE 3 — Confirm modes + live-patch (tốn ~3 lượt)
1. Build mới, **Confirm: `auto`**, Deploy: `none`, nhập `R2` → gửi. Assert nó chạy hands-free
   ①→④ tới `Done` **không dừng ở gate giữa chừng** (import selfhost thì vẫn dừng, nhưng đây Deploy
   `none` nên tới thẳng Done).
2. **Live-patch**: trên 1 build đang parked ở gate với Confirm `each step`, đổi chip `Confirm` sang
   `auto` (PATCH) → assert nó tự đi tiếp. Kiểm tra chip `Workflow` và `Deploy` **read-only** giữa
   build (hover thấy tooltip `workflow target is fixed when the build starts` /
   `deploy target is fixed when the build starts`).

## PHASE 4 — Multi-build & turn-lock (tốn ~2 lượt)
1. Start build C (Confirm `each step`), để nó park ở **Analyze**. Start tiếp build D → assert **cả 2**
   nằm trong `In progress`, **không** có lỗi "Busy".
2. Trong khi 1 turn đang chạy, thử start/confirm 1 cái khác → assert banner turn-collision + nút
   `Open it` (backend trả 409 `a turn is already running — try again in a moment`).

## PHASE 5 — Recovery / reconnect (0 lượt)
Trên 1 build parked ở gate: **reload trang** (F5). Assert sau reload: phase/gate/status được khôi
phục đúng, chấm kết nối hiện `Live`, build vẫn trong `In progress`.

## PHASE 6 — Cancel / Discard (0–1 lượt)
1. Bấm `Discard build` ở 1 gate → build biến khỏi `In progress`.
2. Hover 1 build trong sidebar → nút × tooltip `Cancel this build`.
3. Với build đang chạy: nút `Stop` → dialog title `Stop this build?`, nút xác nhận `Stop build`.

## PHASE 7 — Negative / validation (0 lượt)
1. Ô nhập trống → gửi → assert lỗi `requirement is required` (không tạo build).
2. Ở tab Spec, xóa trắng nội dung → `Save spec` → assert lỗi `SPEC.md cannot be empty`.
3. Ở 1 gate, bấm nút advance **2 lần liên tiếp** → lần 2 báo bận (409), không tạo double-advance.

## PHASE 8 — Fast build (tốn ~1 lượt)
Build mới, **Fast build: `on`**, Confirm `auto`, Workflow `none`, nhập `R2` → gửi. Assert: **không**
có phase `Analyze` riêng, gộp thẳng và **dừng ở Spec gate** (fast build luôn dừng ở Spec để review).

---

## ⚠️ KHÔNG test được bằng browser (báo người thao tác chạy terminal)
Bảo mật cross-origin / bind 127.0.0.1 **không** forge được bằng Chrome agent — chạy bằng curl:
```bash
# cross-origin mutating request phải bị chặn 403 "origin not allowed"
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:4123/api/tasks \
  -H "Origin: http://evil.example" -H "Content-Type: application/json" -d '{"requirement":"x"}'   # → 403
# chỉ bind 127.0.0.1 (không nghe ra ngoài)
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4123/health   # → 200
```

## Báo cáo cuối (bắt buộc)
Xuất 1 bảng: `| Phase/Check | PASS/FAIL | Thấy gì (nếu FAIL) |`. Kết luận: tổng số PASS/FAIL, và
**app_id + app_url** của app đã import ở Phase 1. Cuối cùng **Discard/Cancel** mọi build còn parked.
