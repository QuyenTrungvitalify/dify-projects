# Verify spec 040 — D1–D4 fixes (Claude for Chrome + 1 terminal step)

> Prompt kiểm chứng **đúng 4 bug đã fix** (spec [040](../../040-builder-uat-fixes.md)). Khác các journey
> J1–J5: ở đây assertion **cụ thể** (mỗi bug có hành vi "trước/sau" rõ ràng).
>
> ⚠️ **BẮT BUỘC trước khi test** (người thao tác — nếu bỏ qua sẽ test nhầm code cũ):
> 1. **Restart backend** (D1 sửa ở server): `lsof -ti:4123 | xargs kill` → `cd apps/builder && npm start`.
> 2. **Hard-refresh trình duyệt** (D2/D3/D4 ở web bundle): `Cmd/Ctrl+Shift+R` tại http://127.0.0.1:4123.
> Cả hai đã được rebuild sẵn (backend `tsc` + web `dist` @ 10:20). Không cần Dify cho bộ này.

---

Bạn là QA agent điều khiển trình duyệt, kiểm chứng 4 bản vá của app **Dify Workflow Builder** tại
**http://127.0.0.1:4123**. Với mỗi mục: làm theo bước, so **Kỳ vọng (đã fix)** — nếu thấy **Hành vi cũ
(bug)** thì FAIL và chụp màn hình. Đánh giá theo hành vi thực tế, không cần so từng chữ.

**Luật an toàn**: mỗi phase là 1 lượt `claude` thật (tới ~5 phút) — poll tới khi có gate/badge/lỗi,
timeout 300s, **không bấm lại** khi đang chạy. Requirement rẻ để test: `R = "A workflow that takes a
topic string and returns a one-paragraph summary."`

---

## D2 — Gõ dở bị mất khi "turn busy" (409)  ✅ dễ nhất, làm trước

**Mục tiêu**: khi gửi lúc đang có lượt chạy, app báo bận NHƯNG **giữ nguyên chữ đã gõ**.

1. Bắt đầu một build với `R` (Confirm: `each step`). Chờ tới khi nó **đang chạy phase Analyze**
   (badge "Running"/"Working…", CHƯA tới gate).
2. Trong khi phase đang chạy: mở ô nhập một task mới (nút **+** ở sidebar / màn New task), gõ một câu
   dễ nhận ra, ví dụ: `reverses a text string`.
3. Bấm **gửi**.
4. **Kỳ vọng (đã fix)**: xuất hiện thông báo bận (đại loại *"a turn is already running — try again in a
   moment"*) **và câu `reverses a text string` VẪN còn nguyên trong ô nhập** — chỉ cần bấm gửi lại khi
   rảnh là được.
   **Hành vi cũ (bug)**: ô nhập bị **xoá trắng**, phải gõ lại từ đầu.
5. (Xác nhận thêm) Chờ build đầu tới gate, rồi bấm gửi lại câu đó → lần này phải đi được.

---

## D3 — Reload rơi về "New task" thay vì mở lại build đang xem

**Mục tiêu**: hard-reload phải **mở lại đúng build** bạn đang xem.

1. Có một build đang mở (dùng build ở D2, hoặc mở một build bất kỳ trong sidebar). Nó đang parked ở một
   gate hoặc đang chạy — miễn là **đang hiển thị build đó** (thấy phase track / thẻ gate của nó).
2. **Tải lại trang** (`Cmd/Ctrl+Shift+R`).
3. **Kỳ vọng (đã fix)**: sau khi tải lại, app **tự mở lại đúng build đó** (thấy lại phase/gate/hội thoại
   của nó), chấm kết nối về `Live`.
   **Hành vi cũ (bug)**: rơi về màn **"New task"** trống, phải tự bấm vào build trong sidebar mới quay lại.
4. (Xác nhận degrade an toàn) Nếu tiện: bấm **+** để về New task, rồi reload → giờ phải ở New task
   (không có build nào để mở) và **không** hiện banner lỗi.

---

## D4 — Nhãn "running" ở sidebar trễ so với trạng thái thật

**Mục tiêu**: khi build vừa tới gate, nhãn ở sidebar đổi **ngay** từ `running` → `gate`.

1. Bắt đầu một build với `R` (Confirm: `each step`).
2. Nhìn mục của nó trong sidebar **"In progress"**: trong lúc phase chạy, hint hiển thị `running`.
3. Poll tới khi build **parked ở gate Analyze** (thẻ gate "Analyze complete" hiện ở khung chính).
4. **Kỳ vọng (đã fix)**: ngay khi thẻ gate xuất hiện ở khung chính, hint ở sidebar đổi sang **`gate`**
   (không cần bạn bấm gì). Có thể trễ 1–2 giây là chấp nhận, nhưng không được kẹt ở `running`.
   **Hành vi cũ (bug)**: sidebar **vẫn ghi `running`** một lúc lâu (tới khi bạn thao tác khác) dù build
   đã tới gate.
5. (Xác nhận thêm) Cho build chạy tới xong (`done`) → mục đó phải **rời khỏi** "In progress".

---

## D1 — Confinement không còn revert nhầm việc chạy song song  ⭐ bug gốc (cần 1 lệnh terminal)

**Bối cảnh**: trước đây, nếu một tiến trình khác sửa file trong repo **trong lúc** build đang chạy, guard
`git status` toàn-repo gán nhầm cho build → **revert file đó + làm hỏng build** (lỗi
`confinement breach (reverted): …`). Fix: guard chỉ còn revert trong `projects/`; thay đổi ngoài
`projects/` được coi là "việc bên ngoài" → bỏ qua.

> Browser agent **không** sửa được file, nên bước tạo "sửa song song" do **người thao tác** chạy ở
> terminal đúng lúc build đang chạy. Agent quan sát kết quả.

1. (Browser) Bắt đầu một build với `R` (Confirm: `each step`). Xác nhận nó **bắt đầu chạy phase Analyze**.
2. (**Terminal — người thao tác, chạy NGAY khi Analyze đang chạy**) Từ repo root, tạo một file rác ở
   gốc repo để giả lập "việc bên ngoài chạy song song":
   ```bash
   echo "concurrent external edit" > CONCURRENT_TEST.txt
   ```
3. (Browser) Poll tới khi phase Analyze **kết thúc**.
4. **Kỳ vọng (đã fix)**: build **đi tiếp bình thường** — hiện gate "Analyze complete", **KHÔNG** có lỗi
   `confinement breach (reverted): CONCURRENT_TEST.txt`, và file `CONCURRENT_TEST.txt` **vẫn còn** trên đĩa.
   **Hành vi cũ (bug)**: build **báo lỗi** `Phase failed` với `confinement breach (reverted):
   CONCURRENT_TEST.txt`, và file bị **xoá mất** (git clean).
5. (Terminal — xác nhận file sống sót + dọn dẹp)
   ```bash
   ls CONCURRENT_TEST.txt && rm CONCURRENT_TEST.txt   # phải thấy file (đã fix), rồi xoá đi
   ```
6. (Đối chứng — vẫn chặn escape THẬT, tùy chọn) Để chắc bảo mật không thủng: một ghi ra **sibling
   project** trong `projects/` vẫn phải bị revert. Việc này khó ép qua browser (agent không tự viết
   `projects/other/…`), nên đã được test tự động ở `apps/builder/test/confinement.test.ts`
   (`projects/` cross-scope vẫn revert + báo breach). Không cần làm thủ công.

---

## Báo cáo cuối

Bảng: `| Fix | PASS/FAIL | Thấy gì |` cho D1, D2, D3, D4. Với FAIL: screenshot + mô tả *thấy gì vs kỳ
vọng*. Cuối cùng Discard/Cancel mọi build còn parked và (nếu có) xoá `CONCURRENT_TEST.txt`.
