# Spec 084 — Chưng cất chạy nền: tray panel góc phải, gate-preserved

**Status**: Draft v1.5 (2026-08-01). UX redesign của promote (spec 052): chuyển distill từ **foreground
task chiếm cả màn hình** sang **background job + panel TƯƠNG TÁC góc phải**. Mô hình: **giống hệt task đang
chạy hiện tại, chỉ thêm panel để user thao tác gate ở MỌI NƠI mà không phải quay lại màn hình chưng cất.**
Cái gì auto được thì auto (**no-collision → tự Approve**, kèm [Undo] + [Xem report] trên panel); cái gì
**không** auto được thì **đẩy nút gate lên panel cho user quyết ngay tại chỗ** (collision, distill-fail,
team-share). **collision vẫn gated**; **Share = Push** (bấm [Share to team] = đồng ý đẩy luôn, KHÔNG gate
thứ 2) — **trừ đúng 1 cầu chì: preflight quét ra secret thật → CHẶN push**. **Undo = xoá file local +
rebuild index — KHÔNG dính git** (bản sạch 074 nhiều user không có git để commit; §4 S2.3).
Số spec: **084** (082 đã thuộc consult-mode, 083 thuộc share-drop-url — đã rename tránh trùng).
**Effort**: S1 (MVP) ≈ M · S2 ≈ M — tổng ≈ M. Làm phased: S1 = nền + panel tương tác (dùng lại gate sẵn có,
chưa auto); S2 = auto-approve no-collision + Undo. **Đóng spec**: qua `/spec-close 084`.

> **Δ v1.4→v1.5** (chốt với user 2026-08-01): **Section "蒸留" riêng cho promote task** (S1.5 làm nốt) —
> distill hiện trộn vào tree Build (`listTreeTasks` không loại promote); tách thành section riêng mirror
> section consult, hiện TẤT CẢ promote (lịch sử, newest-first, cap ~20), "+" = nút intake YAML ngoài. Loại
> promote khỏi `/api/tree`. Tray↔section phân vai: tray=active/phiên, section=lịch sử; hiện cả 2 là cố ý.
>
> **Δ v1.3→v1.4** (chốt với user 2026-07-31): (1) **Distill-fail đổi bề mặt** — panel KHÔNG hỏi note tại
> chỗ; chỉ [Resend] (chạy lại) + [Chi tiết] (mở task). Task view có cả [Resend] lẫn gate đầy đủ (Request
> changes + note / Discard). (2) **Share = Push** — bấm [Share to team] là đẩy luôn, bỏ gate xác nhận thứ
> hai (`share_review`); cầu chì DUY NHẤT giữ lại: preflight bắt secret thật → chặn push, báo lỗi. Near-dup
> chỉ advisory (admin lọc ở /shelf-inbox). (3) **Nút [Close] trên panel** — terminal → tắt thẳng; chưa
> terminal (đang chạy HOẶC parked ở gate) → hỏi xác nhận rồi cancel. (4) **[Undo] tự ẩn sau khi đã Share**
> (chỉ gỡ được bản local, không rút bản team). (5) **Một-làn-ghi** — chỉ 1 turn-ghi chạy tại một thời điểm
> (lock 'phase' single-slot); background distill gặp làn bận → panel trạng thái "Đang chờ" + tự dispatch
> khi rảnh (KHÔNG ra lỗi đỏ).
>
> **Δ v1.2→v1.3**: (1) Panel TƯƠNG TÁC (bấm gate cho task nền, không mở lại màn hình). (2) Bỏ upfront
> share-dropdown. (3) Undo bỏ hẳn logic git-commit.

---

## 1. Bối cảnh — vì sao đổi

Promote (052) là một `Task kind:'promote'` chạy **foreground**: `store.promote()` (`store.ts:877`) làm
`task.value=null; applyTask(t); openStream(t.taskId)` → **thay cả view hiện tại** bằng promote task. Hệ quả
người dùng phàn nàn (thật):
- **Cảm giác "đang build workflow mới"** — distill turn hiện y hệt một build phase (đã sửa nhãn "蒸留" ở
  a13734c, nhưng vẫn là foreground task).
- **Chiếm màn hình** — bấm distill trên build đang mở là bị khoá vào view promote, rời việc đang làm.
- **Nhiều bước** — flow gate: `review` → Approve → `share_offer` → share/skip → (`share_review` push) → done
  (gate.ts:85-111). 5 lần tương tác cho một hành động phái sinh.
- **Lộn xộn sidebar** — "Promote projects/_drafts/… to a reusable pattern" nằm chung tree với build thật,
  ở lại cả khi terminal.

**Điều KHÔNG đổi:** distill *là* một LLM turn có gate (đọc source → generic-hoá → staged → **Approve mới
ghi kệ**). Máy đó (Task/turn/gate/SSE + `finalizePromotion` là đường ghi duy nhất) đúng và tái dùng. Đây là
**đổi bề mặt + một nhánh finalize sớm**, KHÔNG đổi kiến trúc.

## 2. Nguyên tắc (BẤT KHẢ XÂM PHẠM khi implement)

- **`finalizePromotion` là đường ghi DUY NHẤT vào `templates/patterns/`** (promote.ts:333). Auto-approve chỉ
  *gọi sớm hơn* cùng hàm đó — TUYỆT ĐỐI không mở đường ghi thứ 2. Đây là cột chống lây lan; mọi slice tôn trọng.
- **Auto-Approve CHỈ khi no-collision, KÈM lưới post-hoc bắt buộc** (quyết định user 2026-07-30). Approve
  gate chặn 2 thứ tách biệt: **clobber** (đè pattern cũ) và **genericity** (distill có tốt/sạch-secret
  không). Auto-approve pattern MỚI (no-collision) bỏ *genericity-gate pre-write* — chấp nhận cho bối cảnh
  **1 dev, build của chính mình, file gỡ được bằng 1-click Undo**, vì B2′ đã đảm bảo lint/schema và
  genericity bắt được **post-hoc**. NHƯNG auto-approve = pattern **live ngay** (dạy build sau). Rủi ro tệ
  nhất: **distill sót secret thật** — B2′ lint KHÔNG bắt secret-leak. ⇒ hai điều kiện KHÔNG được bỏ:
  **(a) panel hiện "✓ Promoted `<slug>` — [Xem report] [Undo]"** (report nổi bật 1-click, không giấu sau
  "Done"); **(b) Undo/Gỡ 1-click** từ panel (live rồi thì đường lùi phải không ma sát; cơ chế = xoá file +
  rebuild index, §4 S2.3).
- **Panel TƯƠNG TÁC — thao tác gate cho task nền tại chỗ, KHÔNG mở lại màn hình.** Đây là cột UX của v1.3:
  panel không chỉ *hiển thị* mà *bấm-gate-được*. Mọi bước KHÔNG auto (collision, distill-fail, team-share)
  render đúng nút gate của nó lên panel; user bấm ngay → gọi `confirm(action, **taskId**)` cho task nền (KHÔNG
  phải `task.value`). Backend đã sẵn (`POST /api/tasks/:id/confirm` nhận `:id`); chỉ thêm bản `confirm`/`reply`
  nhận taskId ở frontend (§3). Mở màn hình task giờ **chỉ để xem report**, không bắt buộc để hành động.
- **Collision VẪN gated** — `reviewCollision` (Overwrite / Save-as-new / Discard, gate.ts:75) khi slug
  trùng. KHÔNG auto-clobber (update một pattern đã vetted = đáng review; heuristic: mới→auto, update→gated).
  Nút này surface **lên panel** — quyết tại chỗ.
- **Team-push KHÔNG auto — nhưng "Share = Push" (1 quyết định người)** — "Share to team shelf" là publish ra
  ngoài (POST lên Drive/PR, spec 081/083). Con-mắt-người CHÍNH LÀ cú bấm **[Share to team]**; bấm = đồng ý
  đẩy luôn, **BỎ gate xác nhận thứ 2** (`share_review`). Không upfront-dropdown (đã bỏ). **Cầu chì DUY NHẤT
  giữ lại:** preflight (`sharePreflight`, share.ts:129) quét ra **secret thật** (findings ≠ rỗng) → **CHẶN
  push**, panel báo "⚠ Không share được — lộ secret" + [Chi tiết]/[Resend]. Đây KHÔNG phải gate ma sát mà là
  cầu chì an toàn: secret một khi lên Drive/PR là **đã lộ, không rút lại được** (rủi ro tệ nhất, §9).
  **Near-dup KHÔNG chặn** (advisory — admin lọc ở /shelf-inbox). Vẫn đúng tinh thần "không auto-push": không
  cú bấm người thì không có gì rời máy.
- **Một-làn-ghi (single write-lane) — background KHÔNG mở song song vô tư** — lock 'phase' single-slot
  (lock.ts:10-11,79-81): tại một thời điểm CHỈ 1 turn-ghi chạy (build HOẶC distill). ⇒ bấm Distill lúc một
  turn-ghi đang chạy sẽ **409**. Background KHÔNG được ra lỗi đỏ: gặp làn bận → panel trạng thái **"Đang chờ"**
  + FE tự dispatch lại khi làn rảnh (§4 S1.6). Nhiều distill → **serialize**, không chạy đồng thời.
- **Không dựng lại turn-engine** — tái dùng promote Task + gate + SSE; chỉ đổi cách frontend *theo dõi*
  và *surface* task (background thay foreground).
- **Không mất task** — background distill chờ review phải luôn reachable (parked, không tự land/discard),
  đúng tinh thần "In progress" section hiện có (Sidebar.tsx:150).

## 3. Cơ chế — neo đã verify trong code

- `store.ts:877` `promote(project, workflow)` — hiện `task.value=null; applyTask(t); openStream(taskId)`
  (foreground). Đây là seam đổi: KHÔNG chiếm foreground, đẩy vào tray state.
  **⚠ `promoteExternalYaml` (store.ts:903) dùng CÙNG seam** (distill YAML dán/upload) — S1 xử **cùng một
  cách** (cả hai vào `bgDistills`); không được để một cái nền, một cái foreground (§4 S1.1).
- **SSE là single-stream**: một biến global `teardown` (store.ts:638); `openStream` teardown stream cũ khi
  mở mới. ⇒ theo dõi một task-id ≠ `task.value` KHÔNG được mở stream thứ 2 ngây thơ (đụng chùm reconnect
  FIX-H + consult `ask:done`, store.ts:648-672). **Chốt: POLL** (§7 Q1 đã quyết).
- `gate.ts:85-111` `computePromoteGate`: `blocked | distill_failed | review | reviewCollision` +
  `share_offer`/`share_review`/`share_retry`. Auto path *bỏ qua* `review` khi no-collision (S2.1);
  Share=Push *bỏ qua* `share_review` khi preflight sạch (S2.2); `collision`/`distill_failed`/`share_offer`
  + secret-fuse giữ nguyên.
- `promote.ts:299-317` `promoteConfirm` — check collision `existsSync(join(projectsDir, targetRel(slug)))`
  ĐÃ TỒN TẠI ở Approve-time. Auto path **move check này lên cuối `runDistillTurn`** (slug deterministic =
  tên folder workflow, biết trước) → no-collision thì gọi thẳng `finalizePromotion`, collision thì park
  `reviewCollision` như nay.
- `promote.ts:333` `finalizePromotion` — move staged→target + stamp x-provenance + rebuild INDEX/provenance
  (runPython). Undo phải chạy **nghịch đảo trọn gói** cái này (§4 S2.3), không chỉ `unlink`.
- `Sidebar.tsx:150` "In progress" section + `ConsultRow`/`SectionHeader` (Sidebar.tsx:193-210) — khuôn sẵn
  cho khối "蒸留" và tray.
- **`store.ts:926` `confirm()` + `store.ts:941` `reply()` bám `task.value`** (`const t = task.value; if
  (!t) return`). ⚠ Panel tương tác (§2) cần bấm gate cho task **nền** ≠ task đang mở ⇒ thêm bản nhận
  `taskId` (POST thẳng `/api/tasks/:id/confirm`, KHÔNG `optimisticAdvance` vào `task.value`; poll §4 S1.2
  refresh `bgDistills`). Backend `POST /api/tasks/:id/confirm` (tasks.ts:349) đã nhận `:id` — chỉ sửa FE.
  **[Resend]** (distill-fail) = `reply(taskId)` note-RỖNG → `promoteReply`→`runDistillTurn` không note
  (promote.ts:324, noteText optional). ⚠ FE `reply()` chặn text rỗng trừ status='error' (store.ts:947);
  `distill_failed` là `awaiting_confirm` ⇒ thêm action "resend" riêng (hoặc nới note-rỗng ở gate này).
- **`lock.ts:79-81` `acquireTurn`** — làn 'phase' single-slot; `holders[kind] !== null → return false`
  (→ route map 409). Background trigger phải xử 409 = "Đang chờ" + retry, KHÔNG surfaceError đỏ (§4 S1.6).
- **`share.ts:377` `runSharePreflight`** — hiện **luôn** park `share_review` (dòng 387). Share=Push đổi:
  chạy preflight → findings rỗng → gọi thẳng `runShareShip` (share.ts:394); findings ≠ rỗng → CHẶN (không
  park confirm-để-tiếp, mà báo lỗi secret). `sharePreflight` (share.ts:129) trả `{findings, dup}` — chỉ
  `findings` (leak scan) mới chặn; `dup` (near-dup) advisory, không chặn.
- **`tasks.ts:576` `POST /api/tasks/:id/cancel`** — có sẵn; [Close] khi chưa-terminal dùng lại route này.

## 4. Slices

### S1 — MVP: background execution + panel TƯƠNG TÁC (dùng lại gate sẵn có) (M)
Đạt ~80% "cảm giác tiện" bằng cách **dùng lại toàn bộ gate hiện tại**, chỉ đổi surface + cho bấm gate tại
chỗ. Chưa auto — an toàn 100% như hôm nay.

1. **Background trigger** — `store.promote()` VÀ `store.promoteExternalYaml()` KHÔNG `task.value=null/
   openStream` nữa. Thay vào: mint task, thêm vào **`bgDistills` state** (map taskId → {slug, status,
   gate, kind}), giữ nguyên `task.value` hiện tại (user ở nguyên màn hình).
2. **Theo dõi nền = POLL** (KHÔNG multiplex SSE, §3) — poll `GET /api/tasks/<id>` mỗi ~2s cho từng task
   trong `bgDistills`; dừng poll khi task terminal. Distill hiếm + ngắn nên poll nhẹ, và tránh chạm máy SSE
   single-stream. Cập nhật status/gate → parked ở gate hiện tại (`review`/`collision`/`distill_failed`/`share_offer`).
3. **Panel TƯƠNG TÁC góc phải** — component mới, đọc `bgDistills`; mỗi item có **[Close]** (§4 S1.7):
   - **đang chờ làn** (409): ⏳ "Đang chờ…" (S1.6)
   - **đang chạy**: ⏳ spinner + "Chưng cất `<slug>`…"
   - **parked `review`/`collision`**: hiện **đúng nút của gate** (`gate.actions` đã poll) + mini-summary (path).
   - **parked `distill_failed`**: KHÔNG hỏi note tại chỗ → chỉ **[Resend]** (chạy lại) + **[Chi tiết]** (mở task).
   - **parked `share_offer`**: **[Share to team]** (= Push, §2) + **[Keep local]**.
   - nhiều distill → **stack/tray** (không chỉ 1 toast).
4. **Bấm nút trên panel → hành động TẠI CHỖ** (cột v1.3, §2) — mỗi nút gọi `confirm(action, taskId)` /
   `reply(text, taskId)` bản-nhận-taskId (§3) cho task nền, KHÔNG `openStream`/không rời màn hình. Poll (S1.2)
   nhặt gate kế tiếp về panel. **[Xem report]/[Chi tiết]** (link phụ) mới `openStream(taskId)` mở task để đọc
   chi tiết + gate ĐẦY ĐỦ (distill-fail ở task: [Request changes+note] / [Resend] / [Discard]) — optional.
5. **Khối "蒸留" sidebar — section RIÊNG cho promote task** (chốt v1.5, user 2026-08-01). Distill hiện
   **trộn vào tree Build** vì `listTreeTasks` KHÔNG loại promote (nó chỉ loại consult — [artifacts.ts:303](../../apps/builder/server/lib/artifacts.ts)).
   Tách thành section riêng, **mirror 1:1 section consult** (bản mẫu sẵn):
   - **Loại promote khỏi tree** — thêm `if (task.kind === 'promote') continue;` ở artifacts.ts:303 (cạnh
     dòng consult), để không hiện ở cả 2 chỗ.
   - **`listPromoteTasks` + `GET /api/promotes`** — mirror `listConsultTasks`/`/api/consults` (artifacts.ts:243):
     trả **TẤT CẢ** promote task (kể cả done/shared — làm lịch sử), **newest-first, cap ~20**.
   - **Section "蒸留 / Distill" trong Sidebar** — mirror `sectionChat`/`ConsultRow`. **"+" của section =
     `onAddYaml`** (nút 外部YAMLを追加 sẵn có, Sidebar.tsx:272) — "tạo distill mới" = distill YAML ngoài.
     Row click → `openTask` (dùng lại S2-B: replay cả distill log).
   - **Phân vai tray ↔ section** (bất biến): tray = active/vừa-xong TRONG PHIÊN (Approve/Undo/Clear nhanh);
     section = **lịch sử TẤT CẢ**, click mở lại. Một task hiện ở **cả hai** là **CỐ Ý** (§2 "reachable via
     tray + sidebar"), KHÔNG phải trùng lỗi.
   - **KHÔNG đổi** cửa (b) "Promote from build" (pill header giữ nguyên); KHÔNG tách modal intake lưỡng dụng
     (base-OR-distill, spec 070) — "+" mở modal đó như hiện tại.
6. **Trạng thái "Đang chờ" khi làn bận** (§2 một-làn-ghi) — `POST /api/promote` gặp 409 (làn 'phase' đang
   chạy turn khác) → KHÔNG surfaceError đỏ; đánh dấu item `queued`, poll làn, **tự dispatch lại khi rảnh**.
   Nhiều distill → serialize qua cơ chế này.
7. **[Close] item** — **terminal** (done/shared/discarded) → xoá khỏi `bgDistills` (không đụng file kệ).
   **chưa-terminal** (đang chạy HOẶC parked ở bất kỳ gate) → **hỏi xác nhận** → `POST /api/tasks/:id/cancel`
   (tasks.ts:576, có sẵn). KHÔNG để Close im lặng mất một task đang chờ.

- Test: `promote()` + `promoteExternalYaml()` không đổi `task.value` (unit trên store); poll cập nhật
  `bgDistills` đúng theo response giả; panel render running + từng gate (review/collision/distill_failed/
  share_offer); **bấm nút trên panel gọi `confirm/reply(…, taskId)` đúng taskId nền, KHÔNG openStream**;
  [Resend] gọi reply note-rỗng; [Chi tiết]/[Xem report] mới openStream; **409 → item `queued` + retry, KHÔNG
  surfaceError**; [Close] terminal xoá item; [Close] chưa-terminal → confirm rồi cancel.

### S2 — Cắt bước: auto-approve-on-no-collision + Share=Push + Undo (M)
Sau khi S1 chạy êm (đã surface mọi gate lên panel), S2 cắt các bước dư: auto-approve no-collision, gộp
share về 1-bấm (Share=Push), và Undo. *(S1 vẫn dùng gate share 2-bước sẵn có; S2 mới gộp.)*

1. **Auto-approve khi NO-collision** — cuối `runDistillTurn` (chỗ hiện set `review`, promote.ts:224-228),
   backend check collision (move từ promoteConfirm:301). Slug **chưa tồn tại** → **tự `finalizePromotion(
   p.slug)`** (không park `review`). `finalizePromotion` vẫn đi tiếp đường 081: no-collision + share-eligible
   → park `share_offer` (panel hiện [Share to team]/[Keep local]); không eligible → `done`. Panel trạng thái
   thành-công-có-lưới: **"✓ Promoted `<slug>` — [Xem report] [Undo]"** (+ nút share nếu parked share_offer).
   [Xem report] → openStream mở task chi tiết (report + "What I genericized" + pattern YAML).
   **Collision** (slug tồn tại) → KHÔNG auto: park `reviewCollision`; **panel hiện [Overwrite / Save-as-new /
   Discard]**, bấm tại chỗ (S1.4).
2. **Share = Push** (gộp gate share) — `runSharePreflight` (share.ts:377) hiện luôn park `share_review`.
   Đổi: bấm [Share to team] → preflight → **`findings` rỗng → gọi thẳng `runShareShip`** (đẩy luôn, panel →
   "✓ Shared"). **`findings` ≠ rỗng (secret thật) → CHẶN**: KHÔNG push, panel "⚠ Không share được — lộ secret:
   …" + [Chi tiết]/[Resend] (cầu chì §2, không phải gate ma sát). **`dup` near-dup KHÔNG chặn** (advisory).
3. **Undo endpoint** (MỚI — cơ chế ĐƠN GIẢN, KHÔNG git) — `POST /api/tasks/<id>/undo-promote`:
   - **Luôn** nghịch đảo trọn gói `finalizePromotion`: `unlink` `templates/patterns/<slug>.yml` (unlink đã
     import ở promote.ts:24) **+ rebuild INDEX/provenance** (cùng `runPython` finalize dùng — KHÔNG chỉ xoá
     file, nếu không catalog lệch). File đã mất (đã gỡ / bị promote đè) → **no-op, báo "đã gỡ"**, không lỗi.
   - **KHÔNG check git, KHÔNG "cửa sổ pre-commit"** — bản sạch 074 nhiều user không có git. Nếu user tự
     `git commit` file rồi thì đó là việc của họ; Undo vẫn chỉ thao tác trên file working-tree.
   - Panel: nút [Undo] hiện chừng nào item còn trên panel (trong phiên) **VÀ chưa Share**. **Đã Share team →
     ẩn [Undo]** (chỉ gỡ được bản local, không rút bản Drive/PR — tránh cảm giác sai gỡ được cả bản team).
     Reload → task terminal, panel dựng lại không còn item → Undo hết. Undo = "hối hận tức thì", KHÔNG phải
     thùng rác vĩnh viễn (§7 Q2).
4. **(Tuỳ chọn) Secret-scan trước auto-finalize** (§9, Q5) — grep nhẹ pattern token/api-key trong B2′;
   nghi ngờ → rớt về `review` (panel hiện [Approve]/[Request changes]) thay vì auto. Rẻ, đóng đúng rủi ro
   tệ nhất của auto-approve.

- Test: no-collision → auto-finalize, kệ có file, panel [Undo] gỡ được **+ index rebuild** (assert catalog
  khớp, không chỉ file mất); no-collision + share-eligible → park `share_offer`, panel hiện nút share;
  **Share=Push: findings rỗng → runShareShip chạy (không park review); findings ≠ rỗng → CHẶN, KHÔNG push**;
  collision → KHÔNG auto, park `reviewCollision`, panel hiện 3 nút; Undo → file + index sạch; Undo khi file
  đã mất → no-op không lỗi; **[Undo] ẩn sau khi đã Share**; mọi đường ghi vẫn `finalizePromotion` (không mới).

### S4 (không có S3) — deferred: panel B "overlay gắn build nguồn"
Bản "đúng concept nhất" (overlay inline thay task-row) — KHÔNG làm; tray (S1) đã giải quyết. Ghi để không
đề xuất lại. Mở lại chỉ nếu tray dùng vẫn thấy vướng.

## 5. Validation
- **Cảm giác tiện (đo bằng dùng thật)**: distill xong không rời màn hình; số click từ trigger→lên-kệ giảm
  từ ~5 (gate cũ) xuống 1–2 (S2). Đếm qua vài lần promote thật.
- **An toàn — bất biến theo slice**:
  - S1: pattern KHÔNG lên kệ khi chưa Approve (kể cả background) — regression test + 1 thử thật.
  - S2: no-collision → tự lên kệ nhưng LUÔN qua `finalizePromotion` + panel nổi report/Undo; collision
    KHÔNG BAO GIỜ auto-clobber; team-push KHÔNG BAO GIỜ tự chạy. Regression cho cả 3.
- **Không mất task**: distill nền (S1 parked review, hoặc S2 collision) bị ignore → vẫn reachable qua
  tray + sidebar sau reload; S2 auto-approved → panel Undo còn trong phiên tới khi user dismiss/reload (§7 Q2).

## 6. Guard / test phải xanh
- `promote.test.ts` — đường ghi `finalizePromotion` sau Approve KHÔNG đổi; thêm nhánh auto-finalize
  no-collision + reject-collision.
- `gap-references`/gate tests — không đụng.
- Store unit: `promote()` + `promoteExternalYaml()` không chiếm foreground; `bgDistills` reducer; poll loop;
  **`confirm(action, taskId)`/`reply(text, taskId)` bản-nền POST đúng `/api/tasks/:id/...` mà KHÔNG đụng
  `task.value`/`optimisticAdvance`**.
- Vitest: panel render running + từng gate (review/collision/distill_failed/share_offer); **bấm nút gate trên
  panel gọi confirm bản-nền đúng taskId, KHÔNG openStream**; [Xem report] mới openStream; S2 auto-approve
  panel state (✓ Promoted + [Xem report] + [Undo]) render đúng; [Undo] gọi đúng route.
- Backend S2: no-collision auto-finalize CHỈ khi `!existsSync(targetRel(slug))`; collision → `reviewCollision`,
  KHÔNG finalize; team-push KHÔNG chạy khi không có cú bấm; **Share=Push: findings rỗng → `runShareShip`
  chạy (không park `share_review`); findings ≠ rỗng → CHẶN, KHÔNG push**; Undo → unlink + rebuild index
  (assert catalog khớp); Undo khi file đã mất → no-op không lỗi. (KHÔNG còn test git-commit — đã bỏ.)
- Concurrency: `POST /api/promote` khi làn 'phase' bận → 409; FE map thành `queued` + retry, KHÔNG surfaceError.
- i18n: nhãn tray/panel/Undo/Promoted EN+JA (gate-i18n-labels test đã gác nhãn gate; thêm vào EN/JA dict).
- Permission/finalize (052): mọi ghi vào `templates/` (thủ công HAY auto S2) vẫn qua `finalizePromotion` —
  background/auto KHÔNG mở đường ghi thứ 2.
- S1.5 section: promote task **KHÔNG còn trong `/api/tree`** (loại như consult); `GET /api/promotes` trả
  đúng danh sách promote newest-first; Sidebar render section "蒸留" + "+" mở intake; row → openTask.

## 7. Open questions (đã chốt phần nóng)
1. **SSE multiplex vs poll** (S1 bước 2) — ✅ **CHỐT: POLL** `GET /api/tasks/<id>` mỗi ~2s. Lý do: SSE
   single-stream (một `teardown` global), stream thứ 2 đụng reconnect FIX-H + consult ask:done. Distill
   hiếm/ngắn nên poll rẻ. Lên SSE-multiplex chỉ nếu sau này thấy trễ rõ.
2. **Tray persistence** — ✅ **CHỐT** (user 2026-07-31): tray non-terminal = view của promote-tasks-non-terminal
   → reload tự khôi phục (parked review/collision/share vẫn reachable). Nhưng **[Undo] sau auto-approve KHÔNG
   sống qua reload** (task đã terminal): Undo là "hối hận tức thì" trong phiên, không phải thùng rác vĩnh viễn.
3. **Quick-approve có nên cho phép KHÔNG xem report?** (S2) — với auto-approve-on-no-collision, câu này
   thành: report có ép xem không? Chốt §2: KHÔNG ép, nhưng [Xem report] luôn nổi + [Undo] luôn sẵn — user
   liếc khi muốn, gỡ 1-click khi thấy sai.
4. **Vị trí khối "蒸留"** trong sidebar vs tray — ✅ **CHỐT** (v1.5): section riêng cho promote (mirror
   consult), hiện **TẤT CẢ** promote task làm lịch sử; tray = active/vừa-xong. Trùng ở 2 nơi là cố ý.
   Cơ chế chi tiết ở §4 S1.5.
5. **Secret-scan trước auto-finalize?** (S2.4, §9) — thêm grep nhẹ trong B2′ chặn auto khi nghi ngờ (rớt
   về review)? Đề xuất: có, rẻ và đóng đúng rủi ro tệ nhất. Chốt khi làm S2.
6. **Một-làn-ghi khi trigger nền** — ✅ **CHỐT** (user 2026-07-31): 409 (làn 'phase' bận) → panel "Đang chờ"
   + FE tự retry khi rảnh, KHÔNG lỗi đỏ. Nhiều distill serialize. (Không làm queue ở BE — retry phía FE đủ
   cho tần suất distill hiếm.)
7. **Share=Push có bỏ leak-scan luôn không?** — ✅ **CHỐT** (user 2026-07-31): KHÔNG. Bấm Share = push, bỏ
   gate confirm thứ 2; nhưng leak-scan (`findings`) GIỮ như cầu chì cứng — findings ≠ rỗng thì chặn push.

## 8. Non-goals (đã cân, KHÔNG làm — đừng đề xuất lại)
- **Auto-approve khi CÓ collision** — update pattern đã vetted phải qua `reviewCollision`. Auto CHỈ khi
  no-collision (§2).
- **Auto-approve mà GIẤU report** — auto-approve = pattern live ngay (dạy build sau); panel PHẢI nổi report +
  Undo 1-click (§2 a/b). "✓ Done" trơn = vi phạm.
- **Auto-push team KHÔNG cú bấm người** — publish ra ngoài PHẢI có cú bấm [Share to team]. (Share=Push nghĩa
  là cú bấm đó = push luôn, bỏ gate thứ 2 — KHÔNG phải "tự push không ai bấm".)
- **Cho push khi preflight bắt secret** — findings ≠ rỗng → CHẶN cứng, KHÔNG có nút "bấm-để-đẩy-anyway".
- **Chặn share vì near-dup** — near-dup chỉ advisory; admin lọc ở /shelf-inbox, không chặn push.
- **Undo dính git** (git-commit detection, `git revert`, "cửa sổ pre-commit") — ĐÃ BỎ (v1.3): bản sạch 074
  nhiều user không có git. Undo LUÔN = xoá file working-tree + rebuild index, không quan tâm git (§4 S2.2).
- **Upfront share-dropdown (Local/Team lúc nhấn nút)** — ĐÃ BỎ (v1.3): nhấn nút không chọn gì; nút [Share to
  team] surface lên panel sau finalize, bấm = push (Share=Push, S2.2).
- **Panel chỉ để mở-lại task (không bấm-gate-được)** — v1.3 bắt panel TƯƠNG TÁC; mở task chỉ còn để xem report.
- **SSE multiplex cho task nền** — dùng POLL (§7 Q1). Không chạm máy SSE single-stream.
- **Dựng lại turn-engine ngoài Task** — vứt máy sẵn có, không lợi.
- **Overlay-gắn-build-nguồn (panel B)** — tray đã đủ; refactor lớn, để dành.

## 9. Rủi ro đã ghi (auto-approve)
- **Secret-leak vào file local auto-approved**: distill sót token/room_id thật → B2′ lint không bắt → file
  tự lên kệ local (và nếu user tự commit/share sau thì lan xa). Giảm thiểu: report "What I genericized" nổi
  bật (§2a) + Undo 1-click (§2b) + tuỳ chọn secret-scan nhẹ trong B2′ (§4 S2.4, Q5).
- **Secret-leak ra TEAM (tệ nhất)**: distill sót secret + user bấm Share → lên Drive/PR = đã lộ, không rút
  lại. Chặn: cầu chì cứng — `sharePreflight` findings ≠ rỗng → KHÔNG push (§2, §4 S2.2). Đây là lý do Share
  giữ leak-scan dù đã "Share=Push".
- **Undo lệch catalog**: xoá file mà quên rebuild INDEX/provenance → catalog trỏ pattern không còn. Chặn:
  Undo chạy nghịch đảo trọn gói finalize (§4 S2.3), test assert catalog khớp (§6).
