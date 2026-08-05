# Spec 090 — Build ma từ target không tồn tại: chặn cửa vào, tự cứu ở ②, và hàng `(unsaved)` hết click-được

**Status**: v4 (2026-08-06) — **S1–S4 IMPLEMENTED + REVIEWED + validated live**. Review bắt **1 bug
thật trong chính bản implement**: S2 v3 chỉ gắn `synthetic` cho **1 trong 2** nguồn sinh hàng ma —
nhánh orphan-task-trong-project-đã-tồn-tại ([artifacts.ts:457](../../apps/builder/server/lib/artifacts.ts))
đẻ hàng ma thứ hai, *nguy hiểm hơn* vì mang tên thân thiện (prefix requirement) + đủ nút edit/delete;
phát hiện bằng cách click thật trên UI (chip vẫn arm `_drafts/unsaved` sau "fix"). Đã sửa + test.
Verify live sau sửa: `/api/tree` trả `synthetic=true`, click hàng ma = **chỉ mở nhóm, không arm chip**
(`chip: []`), task con vẫn mở được, không nút "Edit this workflow" nào cho task dưới nhóm đó.
Các điểm review khác đều SẠCH (§8.1). Suite: server **837/0**, web **252/0**, typecheck + build sạch.
v3 = S1–S4 implemented + validated live hai chiều (§6.0b): phantom
fire → HTTP 400 tại cửa, không mint task; edit-existing thật (`workflow_llm_gi_ti`, each_step)
→ ①→② sống nguyên, agent Write THẲNG vào projects path nhờ `{{SPEC_PATH}}` (transcript: 0 vòng
qua `.runs/`). Suite: server 836/0 (typecheck sạch; +12 test mới: 6 route-guard, 5 salvage,
3 SPEC_PATH, 1 tree-synthetic — đếm theo file), web 252/0 + vite build sạch. UNCOMMITTED —
`routes/tasks.ts` đang chia file với spec 089 dở, commit sau khi 089 land. Sự cố phụ khi smoke:
SPEC.md gốc của `workflow_llm_gi_ti` bị smoke đè rồi dọn nhầm → đã TÁI TẠO từ criteria.json +
transcript + main.yml, đánh dấu rõ trong file. v2 = review đa chiều sau repro: **S4 nâng cấp** từ reword →
inject token `{{SPEC_PATH}}` (nguyên nhân mắt 3 xác định lại: điều kiện 2-nhánh sau render thành
câu bắt agent tự diễn dịch — "if `unsaved` is empty" — đọc sai nhưng cho kết quả đúng khi bất
biến còn nguyên, nên ẩn qua mọi campaign); S1 thêm lập luận vòng-tự-khuếch-đại (build ma chết →
thêm task mồ côi → thêm mồi click); S3 thêm cửa thứ hai (create-time `project`+`slug` qua API);
§8 ghi đổi-hành-vi-ngầm-thành-lỗi-tường-minh của S1. v1 = forensics bundle user thật
`builder-unsaved-1785901684698.zip` (Builder 0.2.0, branch contrib — mọi mắt xích **tái xác nhận
trên main**, neo file:line ở §4) + repro tất định §6.0.
**Effort**: S1 ≈ S (backend guard + message) · S2 ≈ XS (FE sidebar) · S3 ≈ S (salvage ②) ·
S4 ≈ XS (guidance spec.md).
**Đóng spec**: qua `/spec-close 090`.

---

## 1. Sự cố — chuỗi 4 mắt xích, mỗi mắt có bằng chứng

User (máy ngoài, bản contrib) yêu cầu: 「添付するymlに『実行結果TSVを…Webhook URLへ能動的に
送りつける』役目のノードを追加して欲しい」 — **sửa file yml ĐÍNH KÈM**. Build chết ở ② với
`artifact missing: projects/_drafts/unsaved/SPEC.md`, Retry lặp vô hạn (mỗi lần ~$0.48, 23s,
không ghi gì).

- **Mắt 0 — ý định không có cửa.** "Sửa file đính kèm" không phải flow chính danh: attachment là
  DATA tham khảo (spec 015 D4), cửa đúng là **Import base** (spec 070 — nạp yml thành workflow
  thật rồi edit-existing). User đi cửa tự nhiên hơn: đính file + mô tả yêu cầu.
- **Mắt 1 — hàng ảo click được, và click-để-XEM kiêm luôn chọn-làm-target.** Sidebar có hàng
  tổng hợp `(unsaved)` (nhãn hiển thị cho các task chưa scaffold —
  [artifacts.ts:464](../../apps/builder/server/lib/artifacts.ts), nơi DUY NHẤT sinh chuỗi này).
  `WorkflowRow.select` quy định click hàng = expand **VÀ** select-as-edit-target cùng lúc (chỉ
  chevron là expand-đơn-thuần — [Sidebar.tsx:115](../../apps/builder/web/src/components/Sidebar.tsx));
  flow user thật (xác nhận với chính user, 2026-08-06) cho thấy cú click gần như chắc chắn chỉ để
  **mở nhóm ra xem lần thử trước** — thao tác vô hại ở mọi tree-UI khác. Chip composer thành
  `_drafts/(unsaved)`, **không tự reset** (chỉ clear khi bấm ✕ trên crumb, không persist nhưng
  sống hết session), hiển thị nhỏ/truncate nên lần gõ-yêu-cầu-mới sau đó user tin là from-scratch;
  `splitWorkflowSetting` ([store.ts:889-892](../../apps/builder/web/src/store.ts)) tách ra
  `project:"_drafts"`, `workflow:"(unsaved)"` — khớp byte với `task.json` của bundle. (Bundle chỉ
  chứa task này nên lần-thử-trước cụ thể nào sinh ra hàng `(unsaved)` là suy ra từ ràng buộc —
  hàng chỉ tồn tại khi có task mồ côi — không phải quan sát trực tiếp.)
- **Mắt 2 — backend nuốt target ma.** `createTask` sanitize `"(unsaved)"` → slug `unsaved`;
  `localEditSeed` thấy `projects/_drafts/unsaved/workflows/main.yml` KHÔNG tồn tại thì chỉ
  `log.warn` rồi đi tiếp như build edit-existing bình thường
  ([scaffold.ts:158-165](../../apps/builder/server/lib/scaffold.ts)) — không seed, không chặn.
- **Mắt 3 — ② ghi đúng chỗ theo cách hiểu của nó, sai chỗ theo verify.** Vì `workflowSlug` đã set,
  `artifactRel` = `projects/_drafts/unsaved/SPEC.md` ([phases.ts:99-102](../../apps/builder/server/lib/phases.ts));
  nhưng thư mục không tồn tại, agent (sau ~50% tool-call bị sandbox chặn khi định vị) đọc điều kiện
  "`{{WORKFLOW_SLUG}}` is empty" của [spec.md:94-96](../../.claude/skills/dify-build/spec.md) theo
  nghĩa "workflow rỗng/không có gì" và ghi vào `.runs/<id>/SPEC.md` (tự thuật trong transcript:
  「`unsaved` が空だったため」). Verify fail. **Retry (resume) là vòng chết**: agent Read lại file
  nó đã ghi → "SPEC.md đã có, không cần tạo lại" → không ghi → fail y hệt.

Nội dung KHÔNG phải vấn đề: ① phân tích đúng file đính kèm (2 lần pass), SPEC.md viết ra đạt
(goal/bảng node/6 AC) — chết thuần ở targeting + đường dẫn. Lỗi "② không ghi file" từng có tiền
lệ khác nguyên nhân (P05 run 1784375623443 — hỏi thay vì ghi); ca này là biến thể mới: **ghi rồi,
nhưng vào nhà không được công nhận**.

## 2. Chẩn đoán gốc — MỘT nguyên lý

> **Một target build phải hoặc TỒN TẠI hoặc bị TỪ CHỐI ngay cửa — không bao giờ được đi tiếp ở
> trạng thái nửa-thật** (slug có giá trị nhưng thư mục không có). Mọi tầng sau (`artifactRel`,
> spec.md guidance, verify) đều giả định bất biến "slug set ⇔ thư mục tồn tại (hoặc sẽ được
> scaffold TRƯỚC khi cần)"; mắt 2 phá bất biến đó và mắt 3 chỉ là hệ quả.

Kèm một nguyên tắc phụ cho ②: **verify chỉ nên chết vì thiếu NỘI DUNG, không vì nội dung nằm
nhầm nhà mà máy tự chuyển được** (cùng triết lý salvage-on-timeout 085 S4).

## 3. Nguyên tắc (giữ khi implement)

- **Chặn ở cửa, không chặn giữa đường**: guard đặt tại `POST /api/tasks` (S1) — trước khi mint
  task, giữ lock, hay đốt turn. `localEditSeed` giữ nguyên fallback hiện có (nó còn phục vụ
  đường cũ — xem Open Q1).
- **Thông báo lỗi phải chỉ ĐÚNG CỬA cho ý định thật** (mắt 0): nếu request có attachment
  `*.yml`, message nói thẳng "muốn sửa file yml đính kèm → dùng Import base"; không jargon
  (chuẩn 064/066).
- **Hàng ảo là hiển thị, không phải lối đi** (S2): sửa ở FE, không đổi wire shape (thêm field
  optional — additive).
- **Salvage không nới chuẩn nội dung** (S3): chỉ nhận nuôi khi file ĐÚNG artifact của ② và
  non-empty; from-scratch (slug null, `.runs/` là đường chuẩn) không đổi một byte hành vi.
- Mỗi mắt xích một slice test được độc lập; không slice nào phụ thuộc slice khác để an toàn.

## 4. Cơ chế — neo file:line (đã tái xác nhận trên main)

- Sinh hàng ảo: [artifacts.ts:460-464](../../apps/builder/server/lib/artifacts.ts) (`loose` →
  `draftsRow.workflows.push({id:'(unsaved)',…})`); type `TreeWorkflowNode` :107-111, wire
  `WireTreeWorkflow` [types.ts:201-205](../../apps/builder/web/src/types.ts).
- Click-để-edit: [Sidebar.tsx:115](../../apps/builder/web/src/components/Sidebar.tsx) (`select`),
  :89 (nút "+" project row), :135 (`TaskRow` nhận `workflowSlug={wf.id}` → nút edit từng task
  trong nhóm `(unsaved)` cũng dính); compound key set tại
  [App.tsx:339](../../apps/builder/web/src/components/App.tsx).
- Split + submit: [store.ts:889-910](../../apps/builder/web/src/store.ts) (`splitWorkflowSetting`
  + `start`).
- Route nhận: [tasks.ts:177](../../apps/builder/server/routes/tasks.ts) (`body.workflow` — hiện
  KHÔNG validate tồn tại); `createTask` sanitize slug
  [task.ts:496-506](../../apps/builder/server/state/task.ts).
- Prelude edit: `localEditSeed` [scaffold.ts:148-176](../../apps/builder/server/lib/scaffold.ts)
  — nhánh warn-and-continue :158-165. Gọi từ [orchestrator.ts:84-95](../../apps/builder/server/lib/orchestrator.ts)
  (throw → error gate — khung sẵn cho một guard nếu cần tầng 2).
- Đường artifact ②: `artifactRel` [phases.ts:99-102](../../apps/builder/server/lib/phases.ts)
  (slug set → `projects/…/SPEC.md`; null → `.runs/<id>/SPEC.md`); guidance 2 nhánh
  [spec.md:94-96](../../.claude/skills/dify-build/spec.md).
- Verify ②: `verifyPhase` [orchestrator.ts:642-712](../../apps/builder/server/lib/orchestrator.ts)
  — `relocateRunArtifacts` chạy TRƯỚC (:654, chỉ chuyển root-`.runs` → `apps/builder/.runs`,
  không đụng `projects/`), stat :704-706, mint lỗi :710-712; `task.artifacts.spec` chỉ set khi
  không error (:585-586); `persistCriteria` dùng cùng `abs` (:739-745).
- `scaffoldAtSpecGate` chạy SAU verify, tại confirm ②→③ ([orchestrator.ts:145](../../apps/builder/server/lib/orchestrator.ts));
  nó move `.runs/<id>/SPEC.md → projects/…` (:229-250) — tức kiến trúc ĐÃ CÓ tiền lệ "SPEC.md
  sinh ở .runs rồi được chuyển nhà".
- Consumer SPEC.md sau ②: ③ qua token `PRIOR_ARTIFACT` = `t.artifacts.spec ?? …`
  ([phases.ts:136](../../apps/builder/server/lib/phases.ts)); GET/PUT `/spec` + panel + bundle
  qua `specPathFor` ([artifacts.ts:33-38](../../apps/builder/server/lib/artifacts.ts)) — mọi
  reader tự tính lại theo CÙNG quy tắc slug, nên S3 di chuyển file về đường chuẩn là đủ cho cả
  chuỗi, không cần vá từng reader.
- Test liên quan: không test nào assert literal `artifact missing:` (khoá dương qua
  `phase.artifactRel` — advance-loop/fast-mode/dispatch-lifecycle…); `spec-save-lock.test.ts` +
  `ask.test.ts` pin đường `.runs/` cho build CHƯA slug — S3 không đụng nhánh đó.

## 5. Slices

### S1 — Guard tại cửa `POST /api/tasks` (S, backend — diệt cả lớp lỗi)

Tại [tasks.ts](../../apps/builder/server/routes/tasks.ts), sau parse body, TRƯỚC `buildTurnBusy`/
`createTask`: nếu `body.workflow` có giá trị (≠ null/'none') → resolve `projects/<project ??
'_drafts'>/<sanitizeSlug(workflow)>/` ; thư mục **không tồn tại** → `400` với message hành động
được, phân nhánh theo attachment:
- có file `*.yml` đính kèm → *"Workflow「<tên>」không tồn tại. Muốn sửa file yml đính kèm: dùng
  Import base (nạp file thành workflow rồi sửa). Muốn tạo mới từ đầu: bỏ chọn workflow."*
- không → *"Workflow「<tên>」không tồn tại — có thể đã bị xoá. Bỏ chọn workflow để tạo mới."*
(JA/EN theo cùng cơ chế lỗi hiện có của route; FE hiển thị qua `startError` sẵn — kiểm khi
implement xem message route có đi qua localize không, nếu không thì thêm frame i18n theo lệ 066.)
Sanitize path (`sanitizeSlug` cho cả project lẫn workflow) trước khi chạm fs — không mở lỗ
traversal mới. **Không đổi hành vi** cho: from-scratch, seed Dify, slug tự đặt (slug ≠ workflow
— slug là ĐẶT TÊN mới, được phép chưa tồn tại; UI không bao giờ gửi slug lúc create —
[store.ts](../../apps/builder/web/src/store.ts) tự ghi chú "Slug is proposed by the build").
**Vì sao chặn ở ROUTE chứ không trong prelude**: một build ma chết đi tự thành MỘT TASK MỒ CÔI
MỚI → nhóm `(unsaved)` càng phình → càng dễ bị click tiếp (vòng tự-khuếch-đại). 400 trước khi
mint task = không đẻ thêm mồi.
Test: route test — 4 case (workflow tồn tại → như cũ; không tồn tại + yml attachment → 400
message import-base; không tồn tại không attachment → 400 message kia; `workflow:'none'` →
như cũ). Case hồi quy nguyên văn bundle: `{project:'_drafts', workflow:'(unsaved)'}` → 400.

### S2 — Hàng `(unsaved)` hết là lối đi (XS, FE + 1 field additive)

`TreeWorkflowNode`/`WireTreeWorkflow` thêm `synthetic?: true` — set duy nhất tại
[artifacts.ts:464](../../apps/builder/server/lib/artifacts.ts). Sidebar: hàng `synthetic` —
click chỉ expand/collapse (không `onNewTask`), ẩn nút edit của `WorkflowRow` **và** của
`TaskRow` con (:135 — kẽ hở thứ hai cùng gốc), thêm `title` giải thích ("các bản nháp chưa có
thư mục — không sửa được như một workflow"). Task con vẫn mở xem bình thường.
Phòng thủ chiều sâu: S1 đã chặn nên S2 thuần UX (không còn đường tạo build hỏng kể cả khi FE cũ).
Test: web test — tree fixture có hàng synthetic → click không đổi `settings.workflow`; hàng
thường → hành vi cũ giữ nguyên.

### S3 — ② tự cứu: nhận nuôi SPEC.md lạc nhà (S, orchestrator — biến chết-vĩnh-viễn thành tự khỏi)

Trong `verifyPhase` nhánh spec ([orchestrator.ts:704-712](../../apps/builder/server/lib/orchestrator.ts)):
khi `artifactRel` là đường `projects/…` (slug ĐÃ set) mà stat fail → thử
`apps/builder/.runs/<taskId>/SPEC.md`; nếu TỒN TẠI + non-empty → `mkdir -p` thư mục đích +
**move** (rename, fallback copy+unlink qua device) về đường chuẩn rồi verify tiếp như thường —
mint note salvage vào log (không vào lỗi user). Mọi nhánh khác giữ nguyên message
`artifact missing`. From-scratch (slug null) không chạm nhánh này theo cấu trúc điều kiện.
An toàn với chuỗi sau: `task.artifacts.spec` set như path chuẩn (:585-586), `persistCriteria`
đọc `abs` chuẩn, ③/`specPathFor`/bundle đều tự tính cùng quy tắc — **một lần move phục vụ mọi
reader** (§4). Tiền lệ kiến trúc: chính `scaffoldAtSpecGate` đã move đúng file này ở nhánh khác.
Trên bundle thật: lần Retry đầu tiên đã tự khỏi thay vì lặp vô hạn.
**S3 không chỉ là lưới cho S1** — trạng thái slug-set-thư-mục-chưa-có còn một cửa thứ hai mà S1
CỐ Ý không chặn: API caller gửi `project`+`slug` ngay lúc create (UI không làm, API cho phép;
slug là đặt-tên nên hợp lệ) → ② verify gặp đúng dạng này. S3 là tầng duy nhất đỡ nó; và với
edit-existing THẬT mà agent lỡ ghi lạc (sự mơ hồ S4 mô tả), S3 cũng cứu nốt.
Test: orchestrator test — (a) slug set + SPEC.md chỉ có ở `.runs/` → verify pass, file nằm ở
`projects/…`, `artifacts.spec` đúng; (b) slug set + không có ở đâu → error y nguyên; (c) slug
null + `.runs/` có → đường cũ, KHÔNG move (khoá from-scratch bất biến); (d) file `.runs/` rỗng
→ error (không nuôi file rác).

### S4 — Backend giải điều kiện, agent hết phải diễn dịch (S, token — NÂNG CẤP sau review 2026-08-06)

**Nguyên nhân mắt 3 sâu hơn draft v1 nhận định**: điều kiện 2 nhánh của
[spec.md:94-96](../../.claude/skills/dify-build/spec.md) sau khi render token thành câu
tự-mâu-thuẫn — *"to `.runs/<id>/SPEC.md` if `unsaved` is empty"*. Điều kiện vốn để MÁY đánh giá
lúc render (chuỗi rỗng?), sau substitution lại bắt AGENT đánh giá — và agent nhìn ra đĩa: thư mục
`unsaved` không tồn tại → "empty" → `.runs/`. Cả hai agent quan sát được (sonnet-5, haiku-4-5)
nói cùng một câu 「`unsaved` が空だったため」. Cách đọc sai này cho kết quả ĐÚNG khi bất biến còn
nguyên (edit thật → thư mục có đồ) — nên ẩn qua mọi campaign.

**Fix đúng tầng — đừng dạy agent đọc điều kiện giỏi hơn, hãy xoá điều kiện**: `phases.ts` inject
token mới **`{{SPEC_PATH}}` = `artifactRel(t)`** (đường đã giải xong, một giá trị); spec.md §Output
còn một câu: "Write `SPEC.md` to `{{SPEC_PATH}}`" + neo cwd = repo root (transcript cho thấy agent
đốt nửa budget đoán prefix `apps/builder/`). Cập nhật bảng token (11→12) + docstring "every known
token substituted". `draft.md` (fast, pre-slug) giữ nguyên — đường của nó vốn là hằng số `.runs/`.
Fallback nếu implement lộ ràng buộc không ngờ: quay về bản reword ("empty **string**"… "kể cả khi
thư mục chưa tồn tại: cứ tạo và ghi").
Test: seam `PHASES[spec].injectVars` đã có test khoá (`content-language.test.ts` precedent) —
thêm case SPEC_PATH cho cả hai nhánh slug null/set; resume prompt render cùng body nên không có
nhánh lọt.

## 6. Validation (bắt buộc)

### 6.0 Tái hiện ĐÃ CHẠY (2026-08-06, main + Builder đang chạy local) ✅

Một lệnh, không cần UI, không cần attachment:

```bash
apps/builder/scripts/e2e-run.sh fire "このワークフローに、実行結果TSVを…ノードを追加して欲しい。…" \
  --project _drafts --workflow "(unsaved)" --mode auto
```

Run `1785916628346` (①② đều claude-haiku-4-5): **tái hiện trọn cả chuỗi** —
- task.json khớp byte với bundle (`workflow:"(unsaved)"`, slug `unsaved`, `seedPath:null`);
- ② chết đúng nguyên văn `artifact missing: projects/_drafts/unsaved/SPEC.md`;
- SPEC.md 6.4KB nội dung tốt nằm ở `.runs/<id>/SPEC.md`; `projects/_drafts/` KHÔNG có thư mục
  `unsaved` (target ma chưa từng được tạo);
- transcript: agent thậm chí **đề xuất slug mới** (`send_tsv`) — não trạng của nó là pre-slug
  toàn phần, dù `{{WORKFLOW_SLUG}}=unsaved` đã inject.

⇒ **Mắt 3 không phụ thuộc thrash sandbox như giả thuyết ban đầu**: run này chỉ 5 denied call
(vs 11 của bundle) mà vẫn chọn `.runs/` — propensity **2/2 trên hai model khác nhau**
(claude-sonnet-5 @ 0.2.0-contrib · claude-haiku-4-5 @ main), hai máy khác nhau. Trạng thái
nửa-thật đọc như "pre-slug" với MỌI agent đã quan sát; attachment xác nhận không có vai trò
nhân quả (repro không đính file). Retry-loop không đốt lại (bundle đã có 2 mẫu chết-y-hệt).
Lệnh trên là smoke-repro trước/sau cho S1 (sau fix: HTTP 400) và S3 (nếu lọt: tự cứu).

1. **Replay bundle**: dựng task giả lập đúng trạng thái bundle (project `_drafts`, slug `unsaved`,
   thư mục không tồn tại, SPEC.md ở `.runs/`) → S3 cứu, build đi tiếp; và POST body nguyên văn
   `{workflow:'(unsaved)'}` → S1 chặn 400 đúng message. (Cả hai là test tự động trong S1/S3.)
2. **/e2e re-fire** một build edit-existing THẬT (workflow tồn tại — entry `edit-existing` sẵn
   trong suite) → PASS như cũ, chứng minh S1 không chặn nhầm đường sống.
3. Suite server + web + pytest xanh; `spec-save-lock`/`ask`/`fast-mode` (các test pin đường
   `.runs/` pre-slug) không đổi một assert nào.

## 7. Guard / test phải xanh

- Route test mới (S1) + web test tree/sidebar (S2) + orchestrator verify test (S3) như §5.
- KHÔNG đụng: `artifactRel` (quy tắc đường giữ nguyên — S3 chỉ thêm bước cứu trước khi kết luận),
  `scaffoldAtSpecGate`, `relocateRunArtifacts`, promote flow, linter set.
- Grep nghiệm thu khi đóng: `'(unsaved)'` chỉ còn ở artifacts.ts (+ synthetic flag) và test.

## 8.1 Review sau implement (2026-08-06) — điểm đã soi và KẾT LUẬN SẠCH

Ngoài bug S2 đã sửa (§Status), bốn điểm nghi ngờ nhất đều kiểm tận code, không phải suy đoán:

- **S3 × confinement**: file được move nằm trong whitelist `projects/<project>/<slug>/` của
  `confinementCheck` (task lúc đó CHẮC CHẮN có cả project lẫn slug — đó là điều kiện vào nhánh
  salvage), nên không sinh breach. Thứ tự cũng đúng: salvage → `persistCriteria(abs)` → confinement,
  nên criteria.json parse được từ chính file vừa nhận nuôi. File nguồn ở `.runs/` gitignored nên
  không bao giờ xuất hiện trong `gitDirtyPaths`.
- **Resume/reply không rò token thô**: nhánh có `replyText` gửi prompt ngắn (CHANGE_REQUEST, không
  chứa body → không có `{{SPEC_PATH}}`); nhánh Retry-không-text dùng chính `freshPrompt` **đã render**.
  Hệ quả phụ đáng giá: retry của ca gốc (không có text) từ nay nhận đúng đường → **vòng lặp chết bị
  phá kể cả khi không có S3**.
- **S1 sanitize ≡ prelude**: guard dùng đúng `sanitizeSlug` + cùng fallback `_drafts` như
  `createTask`/`localEditSeed`, nên đường được kiểm CHÍNH LÀ đường build sẽ đi. `sanitizeSlug` có
  fallback `|| 'workflow'` (không bao giờ rỗng) và nuốt sạch dấu chấm → không có traversal.
- **S1 đọc `body.files` trước `validateAttachments`**: `Array.isArray` + `String(f?.name ?? '')` chịu
  được files không-phải-mảng / phần tử null / name không-phải-chuỗi.
- **Ẩn nút × của hàng synthetic không mất đường dọn**: `DELETE …/workflows/:workflow` vốn **404 khi
  thư mục không tồn tại** (routes/ui.ts) — nút đó đã chết sẵn với hàng ma; × từng task vẫn chạy.

## 8. Rủi ro đã biết

- **S1 có thể chặn một flow hợp lệ chưa biết** truyền `workflow` trỏ chỗ chưa tồn tại — đã rà:
  seed Dify đi `seedAppId` (không đụng), slug tự đặt đi `body.slug`, promote đi route riêng có
  `resolvePromoteSource` (đã tự validate). Còn lại duy nhất fallback warn của `localEditSeed`
  (Open Q1). Nếu campaign lộ flow nào khác → nới message, không nới guard.
- **S1 đổi một hành-vi-ngầm thành lỗi tường minh, CÓ CHỦ ĐÍCH**: trên workspace trắng,
  `fire --workflow <slug-chưa-có>` trước đây âm thầm build MỚI (chính là bug gốc, đã ghi nhận từ
  run 1784380636506); giờ 400. Suite entry `edit-existing` không bị ảnh hưởng (manual note của
  nó đã đòi base thật từ trước), nhưng script/campaign nào khác dựa vào fallback ngầm sẽ thấy
  lỗi rõ — đó là điều mong muốn; ghi vào SUMMARY đợt đầu chạy sau fix.
- **S3 move file khi user đang mở panel SPEC** — GET/PUT `/spec` dùng `specPathFor` tính lại mỗi
  request nên sau move tự trúng nhà mới; khoảnh khắc race giữa stat và move hẹp (verify chạy
  trong dispatch giữ turn-lock, PUT /spec bị 409 khi turn chạy — spec-save-lock đã pin).
- **Message S1 là user-facing JA/EN** — theo đường localize hiện có; đừng hardcode chuỗi ngoài
  frame (vết 066).
- Bundle đến từ 0.2.0/contrib — mọi neo đã re-verify trên main; nếu branch contrib lệch thêm ở
  vùng khác thì ngoài phạm vi spec này.

## 9. Open questions

1. **Fallback warn của `localEditSeed` (:158-165) còn lối vào hợp lệ nào sau S1 không?** (VD
   thư mục bị xoá GIỮA lúc tạo task và lúc prelude chạy — cửa sổ hẹp.) Đề xuất: giữ nguyên warn
   ở v1 (S1 đã chặn 99% lối vào), chỉ nâng thành error nếu campaign còn thấy build ma.
2. **Có nên thêm cửa chính danh "sửa file yml đính kèm"** (auto-import-base khi requirement +
   attachment khớp dạng này)? Ngoài phạm vi 090 — S1 message đã dẫn user tới Import base; mở
   spec riêng nếu tần suất trong share-inbox/campaign cho thấy đáng.

## 10. Non-goals (KHÔNG làm trong spec này)

- **Không đổi quy tắc `artifactRel`/2-nhánh đường SPEC.md** — kiến trúc pre-slug↔post-scaffold
  giữ nguyên; 090 chỉ vá trạng thái nửa-thật lọt giữa hai nhánh.
- **Không auto-import attachment thành workflow** (Open Q2 — spec riêng nếu cần).
- **Không sửa tỉ lệ sandbox-denied ~50%** của ①/② trong ca này — cùng họ với bài 085 đã xử cho ③;
  nếu tái hiện trên build lành mạnh thì đo riêng, đừng trộn vào đây.
- **Không đụng nhánh Retry/resume tổng quát** — S3 làm Retry ca này tự khỏi; cơ chế resume giữ nguyên.
