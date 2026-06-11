# DESIGN PROMPT — Dify Workflow Builder (Spec 009) UI layouts

> Prompt để gửi cho **Claude Design**. Mục tiêu: design lại layout các surface của web app
> "Dify Workflow Builder". Lấy **cảm hứng aesthetic** từ 2 ảnh claude-nexus đính kèm —
> **tương tự ý tưởng, KHÔNG giống hệt**; adapt cho các surface riêng của Builder.

---

## Bối cảnh
App local 1 user, frontend **Preact + Vite + TS**, **dark-only** v1. Người dùng mở 1 chat,
mô tả workflow Dify cần build/sửa; app dẫn qua 4 phase **① Analyze → ② Spec → ③ Implement →
④ Test**, **dừng cho người duyệt giữa mỗi phase** bằng nút gate inline. Đây là sibling đơn
giản hơn của claude-nexus (2 ảnh đính kèm CHÍNH LÀ nexus) — giữ cùng **design language**,
nhưng các surface khác đi.

## Design language (giữ nhất quán với nexus trong ảnh)
- Nền near-black, chữ low-contrast/muted, **rounded card + viền mảnh**, **monospace** cho
  code/identifier/đường-dẫn chip, nhiều whitespace.
- Disclosure row kiểu **"Worked for 2m ›"** (gập/mở hoạt động).
- **Inline action card** kiểu **"1 file changed +89 −182 · [Review]"** — đây là khuôn mẫu
  cho các *gate card* của Builder.
- Bottom **sticky input bar**; empty-state thì input **căn giữa màn**.
- Nếu có sẵn design tokens / file CSS (vd `surface-blocks.css`), **follow đúng pattern + tái
  dùng token**, đừng tự chế hệ màu mới.

## Các surface cần design (mỗi surface 1 layout + CSS theo pattern sẵn có)

**1. App shell** — sidebar trái (collapsible, ~18–22% rộng) + main area. Khi có artifact thì
main chia 2: chat (giữa) + artifact panel (phải, trượt vào).

**2. Sidebar** (giống ảnh, nhưng cây **3 cấp**) — header "Projects" + icon filter + icon
"new task"; nút **"+ New task"** nổi trên cùng; cây **Project ▸ Workflow ▸ Task**:
  - **Project** = nhãn nhóm dự án thực tế (vd "Eiken") — KHÔNG phải folder; hover hiện **chỉ
    nút "+"** (New task), không gear.
  - **Workflow** = một workflow (vd `stem_proofread`).
  - **Task** = một lần build/sửa (vd "Build", "Add JP step") + thời gian tương đối (16d…).
  - Task đang mở: highlight pill. Đáy sidebar: **Settings**.
  *(Khác nexus: nexus chỉ Project▸Conversation; Builder thêm cấp Workflow ở giữa.)*

**3. Empty / new-task state** (lấy bố cục ảnh 1) — căn giữa: breadcrumb chip
**`📁 <project> ⌄`**; input lớn bo tròn placeholder **"Describe the workflow or change…"**;
**NGAY DƯỚI input** là hàng **3 settings chip** (thay cho model/Local của nexus):
  **`Workflow: none ▾`** · **`Confirm: each step ▾`** · **`Deploy: none ▾`**
  → **KHÔNG có model picker, KHÔNG pattern picker.** Nhiều khoảng trắng, tối giản.

**4. Active conversation** (lấy bố cục ảnh 2) — trên cùng: **phase indicator slim**
`① Analyze · ② Spec · ③ Implement · ④ Test` (bước hiện tại nổi). Thread: **user bubble bên
phải** + **output stream bên trái** (full-width, không bubble); disclosure
**"Đang chạy ① Analyze… ›"**. Bottom sticky input bar (settings thu gọn sau lần gửi đầu).

**5. GATE CARDS** *(điểm nhấn — thay cho card "1 file changed/Review" của nexus)* — ở mỗi
ranh giới phase, một card tóm tắt kết quả + nút inline:
  - **Analyze / Spec:** `[ ✔ Continue to <phase> ] [ 💬 Request changes ]`
  - **Implement (clean):** card "`main.yml` · 3 linters passed · xem diff" + `[ ✔ Implement this spec ] [ 💬 ]`
  - **Implement (still-failing)** — tông cảnh báo: "lint còn lỗi sau 5 lần" + `[ Accept anyway ] [ Keep trying ] [ Abandon ]`
  - **Import (chỉ khi Deploy≠none):** `[ ✔ Import into Dify ]` (nút "nguy hiểm/primary" vì chạm Dify thật)
  - **Error:** card đỏ nhạt + `[ ↻ Retry phase ]`

**6. Right artifact panel** *(009-specific, không có trong ảnh)* — trượt vào từ phải khi liên
quan: tab/section cho **`SPEC.md`** (editable + nút Save), **`main.yml` + kết quả lint**,
**split diff** (vs seed/pattern — 2 cột thêm/bớt), và **report cuối** (link `app_url` bấm
được khi Deploy≠none). Dark + monospace, đồng bộ với chat.

**7. States** cần thể hiện rõ: `running` (spinner/disclosure) · `awaiting_confirm` (gate card)
· `error` (card đỏ + retry) · `done`. Token/secret **KHÔNG bao giờ hiển thị**.

## Khác biệt chính so với ảnh nexus (nhấn mạnh — adapt, đừng copy)
1. Settings dưới input = **Workflow / Confirm / Deploy**, KHÔNG phải model/Local.
2. Thêm **phase indicator 4 bước**.
3. **Gate card** thay cho review-card chung chung.
4. Thêm **artifact/diff panel** bên phải.
5. Sidebar **3 cấp** Project ▸ Workflow ▸ Task (nexus chỉ 2).

## Output mong muốn
Layout cho **từng surface ở trên** (markup + CSS theo pattern/token sẵn có), gọn cho 1 cửa sổ
desktop, dark-only. Ưu tiên: **sidebar**, **empty/new-task state**, **active conversation +
gate cards** trước; **artifact panel** sau.
