# Spec 078 — Làm giàu kệ mẫu: Self-harvest + fingerprint catalog + skill `/scout`

**Status**: Draft **v2.2** (2026-07-27) — **PIVOT từ v1 "hunter bot UI"** sau đánh giá khách quan (lý do
bằng chứng ở §1b; thiết kế hunter-UI cũ tra được trong git history của file này). v2.1 = pre-implement
review vá 2 lỗi hoạt động: (1) nudge PHẢI parse-live kệ (`check --shelf`), cấm đọc seed collected.json
— nếu không self-quench gãy sau promote; (2) fingerprint là tín-hiệu-yếu với shape <4 node → `dup-of`
chỉ theo sha256, doctor 0-trùng chỉ kỳ vọng trên tầng curated. + 2 guard bổ sung từ QA: nudge
dev-surface-only (spec 063), seed phủ mọi tier kể cả skill-assets. **v2.2 = vá theo review độc lập thứ 2
(đã verify từng claim)**: (1) kênh nudge đổi từ notes/NOTE_JA → **field riêng report.json + render
devMode** — notes là user-facing theo cấu trúc (build_userview đưa nguyên văn notes vào userview, nudge
đi notes sẽ tự đỏ case comprehension); (2) anchor from-scratch sửa thành **`workflow===null &&
seedPath===null`** — seedPath-vắng đơn lẻ phân loại nhầm edit-local thành from-scratch; + neo permission
đúng rule `Write(tools/**)`, edge-count sau lọc helper, fixture synthesize, sửa lệch số dòng. v2 đảo nguồn giá trị:
**gặt build proven của chính Builder** (self-harvest, dùng hằng ngày) làm trục chính; săn nguồn ngoài hạ
cấp thành **skill `/scout`** (concierge-MVP, zero backend) với **điều kiện nâng cấp đo được** lên UI.
**Effort**: S1 ≈ S–M · S2 ≈ S–M · S3 ≈ S — **tổng v2 ≈ M** (v1 cũ ≈ L–XL). S4 deferred, có cổng đo.
**Đóng spec**: qua `/spec-close 078`.

---

## 1. Bối cảnh

### 1a. Bài toán
Muốn "làm giàu lượng data tham khảo" một cách **có giá trị dùng thật** — không phải feature tạo ra rồi
để đó. Cần: (i) nguồn mẫu mới chất lượng chảy đều vào kệ, (ii) trí nhớ chống trùng ("shape này đã có
chưa? nguồn này đã xem/từ chối chưa?"), (iii) một động tác "đi thu thập" nhấn-một-lần khi muốn.

### 1b. Vì sao PIVOT khỏi hunter-bot UI (bằng chứng, không cảm tính)
- **Giếng ngoài cạn**: khảo sát GitHub 2026-07-27 — chỉ `svcvit/Awesome-Dify-Workflow` (MIT, 46 DSL)
  qua cổng permissive, **đã vendor** (`awesome-dify-workflow-zh`, intake-only). Còn lại no-license
  (yzmw123 51★, aircrushin 35★ — aircrushin còn chứa file **trùng nguyên văn** corpus) hoặc rỗng
  (shamspias). Bot săn định kỳ sẽ chủ yếu trả 0 ứng viên → nhanh chóng thành đồ bỏ.
- **Builder không đói example ngoài**: 6 build E2E (2026-07-27) đạt trọn tiêu chí với `{{REFERENCES}}`
  rỗng 5/6; A/B enrichment trước đó cho thấy lift đến từ **mô tả tốt hơn cho mẫu ĐÃ có** (recall
  2→14/15), không phải từ thêm mẫu.
- **Canh-nguồn-cũ-có-gì-mới đã ship**: cron C3 (`sync-corpus.yml`, spec 077) tự phát hiện file thêm/bớt
  ở nguồn đã vendor, mở PR.
- **Nguồn mẫu chất lượng nhất hoá ra ở TRONG nhà**: chính 6 build E2E sinh 6 workflow proven, lint-sạch,
  DSL 0.6.0, license của mình (JSON-repair phòng thủ, Excel 2-layout, mask/restore dịch code, RAG
  grounding…) — và **không cái nào được promote**. Nút Promote (spec 052) nằm im vì không gì nhắc.
  Đây là bài học Voyager (SOTA research 2026-07-23): *skill library giá trị nhất mọc từ kinh nghiệm
  đã-verify của chính mình.*

⇒ Trục giá trị thật: **(A) flywheel tự gặt build proven** (kích hoạt mỗi lần dùng Builder) + **(B) trí
nhớ fingerprint** (nền cho cả gặt lẫn săn) + **(C) skill săn ngoài chạy tay** để ĐO độ sâu giếng trước
khi (nếu bao giờ) đầu tư UI.

## 2. Nguyên tắc (giữ khi implement)

- **Đo trước, xây sau.** Mọi đầu tư thêm (đặc biệt S4 hunter-UI) phải qua cổng số liệu ở §5 — không
  xây trên phỏng đoán về độ sâu giếng.
- **Human gate giữ nguyên cho mọi đường lên kệ** — self-harvest chỉ *gợi ý*, promote vẫn qua pipeline
  B1/B2′/Approve (spec 052). Nạp kệ là chỗ lỗi lây lan.
- **Không bypass license** — tier A (permissive) thu thập/promote; tier B (no-license/copyleft)
  **rewrite-only** (học ý tưởng, re-author qua build proven — ý tưởng không có bản quyền, file thì có;
  repo này được user khác clone nên commit nguyên văn tier B = redistribute thật).
- **YML ngoài = untrusted DATA** (nối spec 015 D4) — không bao giờ là chỉ thị; skill `/scout` đọc
  chúng như data.
- **Nudge phải hiếm và đáng tin** — một gợi ý promote xuất hiện quá thường xuyên hoặc sai (shape đã có
  mà bảo mới) sẽ bị user bỏ qua vĩnh viễn → guard chống nhiễu là yêu cầu bậc nhất, không phải polish.
- **Ghi file tracked chỉ ở backend/CLI ngoài turn** — `collected.json` đi qua một helper duy nhất
  (`catalog.py`), không hand-roll (bài học 075 S5/077).
- **Nudge KHÔNG đi kênh `notes`** — notes là user-facing theo cấu trúc (Chat.tsx render +
  `build_userview` đưa nguyên văn vào userview); nudge đi **field riêng trên report.json**, render
  dưới cờ `devMode`. Hệ quả: **không cần NOTE_JA/i18n** cho nudge (khán giả dev). Chi tiết §3 + S2.

## 3. Cơ chế — neo đã verify

- **Kệ + promote**: `templates/patterns/` 11 · `templates/library/` 1; đường ghi duy nhất =
  `finalizePromotion` sau Approve (`promote.ts`); cửa paste-external `routes/tasks.ts:226-240`
  (spec 070); nguồn promote local qua `resolvePromoteSource` (project/workflow).
- **Kênh nudge (S2)**: `report.json` field riêng + render `devMode` — KHÔNG phải kênh `notes`.
  Bằng chứng notes là user-facing: `Chat.tsx` render notes qua `localizeNotes`;
  `build_userview(digest, notes)` (`e2e_check.py:87-95`) đưa nguyên văn notes vào userview. Cờ dev:
  `web/src/lib/dev.ts:25` (`BUILDER_DEV=1`), precedent `DevPanel` `App.tsx:426`. (Khuôn NOTE_JA
  `report.ts:75-95` chỉ liên quan nếu một ngày nudge chuyển sang notes — hiện KHÔNG.)
- **Anchor from-scratch**: `task.workflow === null && task.seedPath === null` — `task.ts:188`
  (`workflow: null` = build mới) + `:469` (`seedPath` chỉ set bởi Dify-seed); edit-local dùng
  snapshot `diff.ts:46` và cũng `seedPath:null` — nên một mình seedPath KHÔNG đủ.
- **Fingerprint nguyên liệu**: `index.json` entry có `node_types` (set, đã bỏ helper-node) +
  `node_count` — **không có multiset** ⇒ fingerprint thật (đếm số node mỗi type) cần parse YAML;
  parse offline 44 file < 1s, seed một lần vào catalog. Logic bỏ helper-node tái dùng từ
  `build_index.analyze()` (`build_index.py:77`, danh sách helper `:98-100`). **Edge count đếm trên
  đồ thị SAU lọc helper** (helper node có edge trong `graph.edges` — đếm thô sẽ làm hai file giống
  nhau ± helper lệch fingerprint). **`seed` tự derive đường dẫn từ repo root** — không tin field
  `path` trong index.json (tuyệt đối theo máy).
- **Registry/sources**: `sources_admin.py add` (validate + flat-append) · lockfile C1 · cron C3.
- **Skill precedent**: `.claude/skills/corpus-update/`, `template-promote/` — khuôn skill thao tác
  corpus, human-gated, dùng CLI sẵn có.
- **Ràng buộc UI đã biết**: composer chip row cấm wrap — mọi bề mặt UI mới tránh composer row.

## 4. Slices

### S1 — `catalog.py`: fingerprint + trí nhớ thu thập (S–M) — NỀN của cả spec
`tools/dify_base/catalog.py` (stdlib + PyYAML sẵn có) + **`tools/dify_base/collected.json`** (tracked,
khuôn `enrichment.json`):

- **Fingerprint** = multiset node-type sort + số edge, dạng chuỗi ổn định
  (`agent:1|end:1|start:1/e:2`), bỏ helper-node như `analyze()`. Bất biến qua đổi tên/dịch prompt —
  bắt được near-dup mà sha256 trượt (ca aircrushin↔corpus là ví dụ minh hoạ NGOÀI đời; test dùng
  fixture **synthesize** — copy 1 file corpus rồi rename/dịch — KHÔNG commit file aircrushin
  no-license vào repo, vi phạm chính §8).
- **CLI**: `fingerprint <file>` · `seed` (dựng shelf-set từ **toàn bộ index — mọi tier kể cả
  `skill-assets`** — để dedupe phủ cả cái đã có trong clone read-only; ghi vào collected.json,
  idempotent. Lưu ý: shelf-set cho *nudge S2* chỉ so với `patterns`+`library` — kệ curated; còn
  *dedupe scout S3* so với toàn bộ) · `check <file> [--shelf]` (verdict: `new` / `dup-of <key>` /
  `near-dup <key>`; `--shelf` = so live với parse `patterns`+`library` tại chỗ, dành cho nudge S2.
  **Giới hạn fingerprint phải code đúng**: shape <4 node (vd `start|llm|end`) là **tín hiệu yếu** —
  cả chục workflow dịch/chat hợp lệ trùng shape này vì khác nhau ở prompt, thứ fingerprint cố tình bỏ
  qua ⇒ trùng-fingerprint ở shape <4 node chỉ trả `near-dup` kèm caveat, KHÔNG BAO GIỜ `dup-of`;
  `dup-of` tuyệt đối chỉ theo **sha256**) ·
  `record` (ghi quyết định: vendored/promoted/rewritten/rejected/study + reason + date) ·
  `hunt-log` (append nhật ký một lần săn: ngày, query, đếm mới/trùng/reject) · `doctor` (quét trùng
  nội bộ kệ).
- Entry: `{key: sha12, url?, name, sha256, fingerprint, license?, tier?, decision, reason, date}`;
  mục `hunts: []` riêng cho nhật ký săn.
- Test (`tests/test_catalog.py`): fingerprint ổn định qua rename/translate; seed idempotent; check
  ba verdict; record/reject rồi check lại ra reject-lý-do-cũ; doctor bắt cặp trùng thật.

### S2 — Self-harvest nudge (S–M) — TRỤC GIÁ TRỊ CHÍNH, dùng mỗi build
Sau ④ done + `lintClean`, với build **from-scratch — anchor ĐÚNG: `task.workflow === null &&
task.seedPath === null`** (`task.ts:188` `workflow: null` = build mới; `seedPath` CHỈ được set bởi
Dify-seed scaffold-then-pull `task.ts:469`. ⚠️ KHÔNG dùng mỗi `seedPath` vắng làm anchor: build
**edit-local** cũng `seedPath:null` — nó dùng snapshot riêng `diff.ts:7-8,46` — nếu anchor sai sẽ
nudge trên workflow user vừa chỉnh, tệ nhất là trên base import từ YAML ngoài license mờ): backend
gọi `catalog.py check --shelf <main.yml>` — **`--shelf` = parse LIVE `templates/patterns/ + library/`
tại thời điểm check** (12 file, <1s), **KHÔNG đọc seed trong collected.json**. Lý do là luật cứng:
`finalizePromotion` chạy `build_index` chứ không refresh collected.json, và index chỉ có node_types
*set* (không multiset — §3) nên không dựng lại fingerprint từ đó; nudge mà đọc seed thì sau một lần
promote, build sau cùng shape **vẫn nudge** (false positive, phá self-quench). Parse-live thì tự đúng:
file vừa lên kệ → lần check sau tự thấy. Nếu verdict **`new`** và qua guard chống nhiễu → ghi nudge:

> *"Build này chứng minh một shape chưa có trên kệ mẫu (`<fingerprint tóm tắt>`). Promote nó thành
> pattern để các build sau tham khảo? (nút Promote)"*

- **Kênh mang nudge: FIELD RIÊNG trên `report.json` (vd `promote_hint`), TUYỆT ĐỐI KHÔNG vào chuỗi
  `notes`.** Lý do là mâu thuẫn cấu trúc: kênh notes là user-facing — `Chat.tsx` render notes cho
  user (qua `localizeNotes`), và `build_userview(digest, notes)` (`e2e_check.py:87-95`) đưa **nguyên
  văn notes** vào userview ("notes (as the user reads them)") — không tồn tại cơ chế tách note
  dev/user trong kênh đó. Nudge đi bằng notes sẽ tự đỏ chính case comprehension bên dưới. Field riêng
  thì **vắng mặt khỏi userview theo cấu trúc** (build_userview chỉ lấy digest+notes — cùng lớp với
  `features`/`planned_nodes`/`lint` vốn bị loại). ⇒ **BỎ yêu cầu NOTE_JA/i18n** cho nudge (khán giả
  là dev; NOTE_JA chỉ quét chuỗi notes nên không chạm field mới).
- **Render: chỉ dưới cờ `devMode`** (`web/src/lib/dev.ts:25`, bật qua `BUILDER_DEV=1`; precedent
  `DevPanel` tại `App.tsx:426`) — hiển thị trong DevPanel hoặc khối dev cạnh report.
- **Guard chống nhiễu (bắt buộc, §2):** (a) chỉ from-scratch (anchor trên) + lint-sạch; (b)
  `node_count ≥ 4` (bỏ shape tầm thường start→llm→end); (c) fingerprint `new` tuyệt đối — near-dup
  KHÔNG nudge (thà sót còn hơn nhàm); (d) mỗi task tối đa 1 nudge.
- Nudge chỉ *trỏ* vào nút Promote sẵn có — **không** thêm đường ghi mới, không auto-promote, không
  nút thứ hai. Quan hệ với promote 052: nudge là *chuông*, promote là *máy* — một hành động duy nhất
  như cũ, nudge chỉ nói "lần này đáng bấm" kèm lý do.
- **Dev-surface là bảo đảm CẤU TRÚC** (guard thứ 5): "promote/pattern/kệ" là jargon với user cuối
  (spec 063); field riêng + devMode-render đã bảo đảm nudge vắng mặt userview theo thiết kế. Case
  comprehension "nudge xuất hiện trong userview = AUTO-FAIL" vẫn thêm — như **regression lock** cho
  bảo đảm đó, không phải cơ chế chính.
- **Verify khi implement**: promote từ `projects/_drafts/` hoạt động (regex path của
  `resolvePromoteSource` nhiều khả năng cho phép `_drafts` — review độc lập đã soi) — nếu không,
  hint hướng dẫn copy vào project thật trước.
- Test: shape mới → `promote_hint` xuất hiện trong report.json; shape đã có trên kệ → vắng; 3-node
  trivial → vắng; **seed-edit → vắng**; **edit-local (`workflow !== null`) → vắng** ← case mới, chính
  là lỗi anchor suýt gây ra; userview/comprehension không chứa nudge.
- **Flywheel khép kín**: promote xong → file nằm trên `templates/` → lần `check --shelf` sau parse
  live tự thấy → build sau trùng shape KHÔNG nudge nữa (tự hết nhiễu, **nhờ parse-live chứ không nhờ
  build_index** — index không tham gia đường nudge) → còn `build_index` trong finalize (sẵn có) lo
  phần E2b/`find.py` thấy mẫu mới.

### S3 — Skill `/scout` (S) — "đi thu thập" nhấn-một-lần, zero backend
`.claude/skills/scout/SKILL.md`, khuôn `corpus-update`. Một lần chạy:

1. **Preconditions**: `gh` đã auth; đọc `collected.json` (hunts gần nhất → watermark ngày).
2. **Săn đa mũi**: (a) repo search topic/keyword (`dify-workflow`, `dify dsl`); (b) **code search
   marker DSL** (`"mode: workflow"` + `app:` trong `*.yml`) — mũi bắt workflow lẻ trong repo không
   tên "dify"; (c) lọc `pushed:>{ngày săn trước}` — chỉ delta; (d) re-check repo đã-thấy-chưa-vendor
   qua tree-sha watermark.
3. **Vet từng ứng viên**: license (gh api) → tier A/B; fetch raw → parse DSL thật không;
   `catalog.py check` → new/dup/rejected-trước.
4. **Báo cáo digest** (bảng: tên · license/tier · verdict · đề xuất) + **đợi người quyết** từng dòng:
   - tier A file lẻ → hướng dẫn cửa paste-promote 070 (hoặc dán hộ nếu user duyệt)
   - tier A repo → `sources_admin add` (+ nhắc `setup.sh` clone)
   - tier B đáng học → đề xuất **rewrite**: chưng cất Ý TƯỞNG thành requirement, build qua Builder
   - bỏ qua → `catalog.py record rejected + reason`
5. **Chốt**: `catalog.py hunt-log` — lần sau tự biết đã quét gì, đã từ chối gì, watermark mới.
- Skill **không ghi kệ, không clone trong turn** — chỉ điều phối CLI sẵn có + human gate.
- Test được ở tầng CLI (S1); thân skill là văn bản quy trình (như corpus-update).

### S4 — Hunter-bot UI (DEFERRED — có cổng đo, KHÔNG làm bây giờ)
Chỉ mở lại khi **§5-b** đạt: sau **≥3 lần** chạy `/scout` thật, **median ứng-viên-mới-đáng-nạp
≥ 3/lần**. Khi đó thiết kế v1 (nút dev + B-VET backend + bảng duyệt + 3 door — xem git history file
này) trở thành hợp lý vì giếng chứng minh đủ sâu. Dưới ngưỡng → `/scout` tay là đủ, đầu tư UI là
lãng phí đã-được-báo-trước.

## 5. Validation — số liệu chứng minh "giá trị dùng thật"

- **(a) Self-harvest**: sau 2 tuần dùng Builder bình thường — đếm (i) số nudge xuất hiện, (ii) số
  promote khởi từ nudge, (iii) tăng trưởng `templates/` (11+1 → ?). Nudge rate quá cao mà accept
  rate ~0 ⇒ guard sai, siết lại (c)/(b). Kệ tăng + E2b bắt đầu trả mẫu mới trong `find_query`
  của build sau ⇒ flywheel chạy — bằng chứng cuối.
- **(b) Scout**: mỗi lần chạy ghi hunt-log; sau 3 lần có median ứng-viên-mới → quyết định S4 bằng
  số, không bằng cảm giác.
- **(c) Catalog**: `doctor` baseline — kỳ vọng **0 trùng CHỈ trên tầng curated** (`patterns` +
  `library`); toàn nhà thì KHÔNG kỳ vọng 0 — corpus chứa nhiều workflow 3-node hợp lệ cùng shape
  `start|llm|end` (Chinese2English/English2Chinese/Python Coding Prompt… khác nhau ở prompt), doctor
  phải báo chúng là shape-collision tín-hiệu-yếu chứ không phải dup. Thêm svcvit-zh clone xong chạy
  lại — các file EN-fork trùng **sha256** với ZH-gốc phải bị bắt là `dup-of` thật (bằng chứng
  fingerprint + sha hoạt động trên data thật).

## 6. Guard / test phải xanh
- `test_catalog.py` mới (S1) — như mô tả slice.
- Report/i18n tests hiện có — S2 KHÔNG chạm kênh notes/NOTE_JA (`promote_hint` là field riêng,
  v2.2); thêm case nudge-gating (anchor from-scratch, lint, node_count, verdict, advisory-failure)
  + case comprehension "nudge trong userview = AUTO-FAIL" (regression lock).
- `test_sources_registry.py` parity — S3 dùng `sources_admin` sẵn có, không thêm field registry.
- Permission — turn không ghi được `collected.json`: **đã được deny sẵn** bởi rule
  `Write(tools/**)`/`Edit(tools/**)` trong `headless-settings.json:19-20` (file nằm ở
  `tools/dify_base/`) — KHÔNG cần rule mới, chỉ thêm test case ghim vào rule đó. (Neo cũ "khuôn
  templates/ protected" là sai — deny list tĩnh không có `templates/**`.)
- `promote.test.ts` — không đổi hợp đồng (nudge chỉ trỏ nút, không thêm đường ghi).

## 7. Open questions
1. **Ngưỡng guard nudge**: `node_count ≥ 4` đủ chưa, hay cần thêm "chứa ≥1 feature ngoài llm"?
   Đề xuất khởi điểm: ≥4 node — chỉnh theo §5-a.
2. **Nudge cho seed-edit build**: v1 tắt (biến thể user-specific). Bật lại nếu §5-a cho thấy sót
   nhiều shape đáng giá.
3. **Promote từ `_drafts`**: hoạt động thẳng hay cần copy sang project thật? (verify khi implement
   S2 — quyết wording của note.)
4. **`/scout` cadence**: thuần tay (đề xuất — "lâu lâu nhấn") hay thêm reminder tháng? Không cron
   hoá phần săn (C3 đã cron phần nguồn-đã-vendor).

## 8. Non-goals (đã cân, KHÔNG làm)
- **Hunter-bot UI ngay bây giờ** — deferred sau cổng đo §5-b; lý do bằng chứng §1b. Đừng đề xuất lại
  khi chưa có 3 hunt-log.
- **Bypass license / commit nguyên văn nguồn no-license** — rewrite door là đường thay thế; repo được
  redistribute (spec 074) nên đây là ranh cứng.
- **Auto-promote không người duyệt** — nạp kệ luôn qua Approve.
- **Bulk ingestion / quét hàng trăm file** — nhiễu BM25/E2b; chất lượng > số lượng (bằng chứng §1b).
- **Cron hoá `/scout`** — giếng cạn + C3 đã phủ nguồn vendor; săn là hành vi chủ động của người.
