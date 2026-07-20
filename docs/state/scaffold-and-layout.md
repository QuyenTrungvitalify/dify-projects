# Hiện trạng — scaffold & layout

Cây thư mục 2 tầng `projects/<project>/<workflow>/` của một build được sinh ra thế nào, ở đâu, và khi
nào; slug từ đâu ra và va chạm được xử lí ra sao.

Phạm vi: `scaffold.ts` (`ensureScaffold` · `scaffoldAtSpecGate` · `relocateRunArtifacts`) ·
`project-create.ts` · `slug.ts` · `routes/ui.ts` (**chỉ** handler `POST /api/projects`) ·
`tools/dify_base/init_project.py`.

> - Chuỗi trong backtick là **nguyên văn** code phát ra hoặc đọc — không dịch.
> - Tài liệu này mô tả **bất biến**, không chứa số đo. Số liệu (số project, số file, thời gian) lấy bằng
>   cách chạy, không đọc ở đây.

**Hai ranh giới cắt qua Phạm vi trên** (khai hai chiều để luật sở hữu có nghĩa):

- **Nửa seed của hai prelude** `difySeedScaffoldAndPull` / `localEditSeed` trong `scaffold.ts` — phần
  lập `task.seedPath` (`scaffold.ts:118` pull từ Dify, `:165` snapshot local) — hiện **VÔ CHỦ**
  ([README](README.md) §Bề mặt chưa có doc sở hữu; `knowledge-system.md` đã hạ cấp thành bản đồ sở
  hữu 0 file, chỉ trỏ). Doc này chỉ sở hữu phần hai prelude đó **scaffold + resolve slug** (chúng
  gọi lại đúng `ensureScaffold` + `slug.ts` mô tả ở đây); cơ chế pull/snapshot không nằm ở đây.
- **`routes/ui.ts`**: doc này lấy **đúng một handler** `POST /api/projects` (§3). Phần còn lại của file
  (`/api/tree`, `/api/seeds`, `/api/tasks/:id/spec`) vẫn **chưa có doc sở hữu**; handler `POST /api/bases`
  gọi `base-import.ts` — **`dify-io.md`** sở hữu.

*Ghi chú tên file:* dòng "Trả lời" của campaign này trỏ `routes/projects.ts` — **file đó không tồn tại**.
Route tạo project sống ở `routes/ui.ts` cùng các endpoint UI khác; doc này chỉ carve ra handler
`POST /api/projects`, cố ý **không** nhận cả `routes/ui.ts`.

---

## 1. Hai tầng trên đĩa

Layout **có thật là 2 tầng**, không phải quy ước đặt tên: một Project là `projects/<project>/`, một
Workflow là `projects/<project>/<workflow>/`. `init_project.py` scaffold từng tầng bằng cách **copy một
template `_base/`** — không sinh nội dung động.

| tầng | lệnh | copy từ | sinh ra |
|---|---|---|---|
| **project** | `init_project.py --kind project` | `templates/_base/project/` | `.dify-workspace.yaml` · `README.md` · `.gitignore` · `envs/README.md` · `envs/dev.env.example` |
| **workflow** | `init_project.py --kind workflow --project <p>` | `templates/_base/workflow/` | `workflows/.gitkeep` · `prompts/.gitkeep` · `inputs/.gitkeep` · `tests/fixtures/.gitkeep` |

**Tầng workflow chỉ sinh các thư mục RỖNG** (bốn `.gitkeep`). **Không có `main.yml`, không có `SPEC.md`.**
Comment ở `project-create.ts:53-54` ("with a placeholder `workflows/main.yml`") **nói sai** về scaffold:
`templates/_base/workflow/` không chứa `main.yml`. File YAML xuất hiện **sau**, do ③ Implement
ghi vào `workflows/<workflowFile>` (mặc định `main.yml`, `state/task.ts:464`), hoặc do upload
`POST /api/bases` ghi verbatim (đường của `dify-io.md`) — **không phải** do scaffold.

`.dify-workspace.yaml` (manifest, chỉ tầng project) mang `project.{name, slug, app_type, dsl_version,
dify_tag}` + bảng `environments.dev` ánh xạ tên biến (`DIFY_BASE_URL`, `DIFY_CONSOLE_URL`, …). `dsl_version`
dò từ `.dify-dsl-version` hoặc `schemas/dify-dsl-*.json` mới nhất (mặc định `0.6.0`); `dify_tag` từ
`.dify-tag` (mặc định `main`). Xem `schemas/` → **`templates-and-promotion.md`** / nguồn schema.

`SPEC.md` của một workflow **không** đến từ template — nó do ② Spec ghi vào `.runs/<taskId>/SPEC.md` rồi
được **move** vào `projects/<project>/<workflow>/SPEC.md` (§5).

## 2. `init_project.py` — bộ scaffold

Stdlib thuần (argparse/pathlib/shutil), không phụ thuộc ngoài. `copy_template` walk template rồi ghi sang
target với **thay `{{var}}`** trong **cả nội dung lẫn từng phần đường dẫn** (`init_project.py:163`); tám
biến: `project_name` `project_slug` `description` `app_type` `dsl_version` `dify_tag` `primary_lang` `date`.
Đuôi nhị phân (`.png` `.zip` …) copy nguyên, không thay. Template workflow không có `{{var}}` nào ⇒ `--name`
tầng workflow **vô hại trên đĩa**; chỉ `--slug` quyết định tên folder.

**`slugify` (`init_project.py:56-65`) GIỮ leading underscore có chủ ý** — `raw.startswith("_")` thì
prepend lại `_`. Đây là **hằng số phản trực giác không được "dọn"**: project reserved `_drafts` (spec 030
D5) phải round-trip **giống hệt** qua `slugify` (py) và `sanitizeSlug` (ts, `state/task.ts:403`), vì tầng
confinement so `task.project` **đã lưu** với **folder trên đĩa** — strip mọi `_` sẽ biến `_drafts` thành
`drafts` và phá so khớp đó.

**Idempotency KHÔNG do `init_project.py` lo.** `copy_template` gọi không `--force` mà target đã tồn tại →
**`FileExistsError`, exit `1`** ("`already exists. Use --force to overwrite.`"), không ghi đè. Cả
`scaffoldProjectTier` lẫn `scaffoldWorkflowTier` gọi **không** truyền `--force` (`project-create.ts:46-49`,
`:66-70`). Vậy nên phần "chạy lại không hỏng" nằm ở **caller** (skip-if-exists, §3), không ở tool.

Hai tác dụng phụ: (1) `main()` **chạy lại `slugify` trên `--slug`** đã truyền — idempotent với charset
`[a-z0-9_]` nên caller TS gửi slug đã sanitize là an toàn; (2) sau khi tạo, spawn
`scripts/regen_vscode_settings.py` để cập nhật `.vscode/settings.json` (yaml.schemas) — **non-fatal** nếu
lỗi.

## 3. Ai gọi scaffold, ở đâu

`ensureScaffold` (`scaffold.ts:27`) là **entry duy nhất** dựng cả hai tầng: gọi `scaffoldProjectTier`
(bỏ qua khi `.dify-workspace.yaml` đã có) rồi `scaffoldWorkflowTier` (bỏ qua khi folder workflow đã có).
Skip-if-exists này là **nguồn idempotency thật** — một partial run trước, một edit-existing, hay workflow
thứ hai cùng project đều re-enter sạch. `project-create.ts` là **một nguồn argv duy nhất** cho hai lệnh
`init_project.py` để modal và Spec-gate không trôi lệch cờ.

Bốn đường vào chạm scaffold:

| đường | gọi gì | slug lấy từ |
|---|---|---|
| ②→③ `/confirm` (build thường) | `scaffoldAtSpecGate` → `ensureScaffold` (`orchestrator.ts:143`) | derive/override/collision (§4) |
| Prelude Dify-seed | `difySeedScaffoldAndPull` → `ensureScaffold` | `deriveSlugName` (**không** suffix va chạm) — nửa seed **vô chủ** (README) |
| Prelude edit-existing local | `localEditSeed` (target folder có sẵn) | `sanitizeSlug(task.workflow)` — nửa seed **vô chủ** (README) |
| `POST /api/projects` (modal, **chỉ tầng project**) | `checkProjectName` → `scaffoldProjectTier` (`routes/ui.ts:63-78`) | `checkProjectName` (§4) |

`POST /api/projects` (handler doc này sở hữu): validate tên → `slug`; **không** phải build turn (không
gate/turn). Từ chối trước khi spawn: tên rỗng → `400 name_required`; tên không English/folder-safe →
`400 name_charset` (**reject, không coerce**); folder đã có → `409 { existing }`; scaffold exit≠0 →
`500`. Origin của POST này do global `onRequest` hook (`index.ts`) chặn.

`POST /api/bases` (nằm cùng file, **`dify-io.md` sở hữu** qua `base-import.ts`) là đường thứ năm: nó cũng
`scaffoldWorkflowTier` rồi ghi YAML upload vào `workflows/main.yml` — dùng chung `firstFreeSlug` +
`deriveSlugName` (§4) nhưng **không** phải territory của doc này.

## 4. Slug: derive → sanitize → va chạm

**Derive** (`deriveSlugName`, `slug.ts:12`): lowercase → strip về `[a-z0-9]` → bỏ stopword → nối ≤4 từ
nội dung → cắt 40 ký tự, bỏ `_` đuôi. Chuỗi rỗng/toàn ký hiệu, hoặc requirement thuần tiếng Nhật (bị
`[^a-z0-9]` xoá sạch) → `GENERIC_SLUG` = `workflow`. Khi **mọi** từ đều là stopword thì fallback về danh
sách từ thô (không bỏ stopword) rồi mới ≤4 — nên `deriveSlugName` không bao giờ trả rỗng.

**Sanitize** (`sanitizeSlug`, `state/task.ts:395`, **`build-lifecycle.md` sở hữu** — trỏ sang): normalize
về `[a-z0-9_]`, giữ leading `_`, cap 40, fallback `workflow`. Dùng cho slug **user cấp** (override /
edit-existing).

**Va chạm** (`firstFreeSlug`, `slug.ts:53`): trả slug đầu tiên trong `slug, slug_2, slug_3, …` mà
`projects/<project>/<slug>/` **chưa tồn tại**, **quét PER-PROJECT** (một `summarizer` có thể sống song song
ở hai project khác nhau). **Chừa chỗ cho hậu tố TRƯỚC khi cap 40** (`slug.ts:59-60`) là **hằng số phản
trực giác**: nếu cap trước rồi mới ghép `_N`, một slug gần-40 sẽ **cắt mất hậu tố** và collapse lại đúng
slug đang va chạm → không bao giờ tìm ra ứng viên trống. Fallback bệnh lý (không kỳ vọng) ghép
`Date.now()` (`slug.ts:63`).

`scaffoldAtSpecGate` (`scaffold.ts:178`) ráp ba mảnh trên tại gate ②→③:

1. **Override** (`scaffold.ts:191-196`): payload `/confirm` có `slug` → dùng **AS-IS** qua `sanitizeSlug`,
   **KHÔNG** chạy `firstFreeSlug`. Nghĩa là một slug user cấp trùng workflow đang có sẽ **ghi đè** `main.yml`
   của nó (ensureScaffold skip init → Implement overwrite). Đây là **chủ ý** — slug tường minh coi như
   retarget cố ý; F4 anti-clobber **chỉ** bảo vệ nhánh derived dưới đây.
2. **Genuine-new** (`scaffold.ts:200-215`): không override, không seed → `deriveSlugName` lấy base →
   `firstFreeSlug` auto-suffix nếu trùng → ghi `task.slugNote` (`'<base>' already exists in this project —
   using '<free>' to avoid overwriting it.`). Đây là **đường DUY NHẤT** F4 chạy.

**Tên project** (`checkProjectName`, `project-create.ts:24`): trim → khớp `PROJECT_NAME_RE`
(`^[A-Za-z0-9][A-Za-z0-9 _-]*$`) → `sanitizeSlug`. **Reject, không coerce** (`name_required` /
`name_charset` / `reserved`) để modal hiện lỗi đỏ dạy người, thay vì bịa `project_N`. Leading `_` bị regex
loại **trước** khi tới guard `reserved` — nên `_drafts` trả `name_charset` (guard `reserved` là backstop
phòng regex nới sau này). Regex này được **mirror phía client** ở `web/src/lib/slug.ts`
([ui-surface.md](ui-surface.md) sở hữu — chỉ trỏ).

Khi `ensureScaffold` chạy từ Spec-gate, nó chỉ có `task.project` (slug), nên `--name` tầng project được
**dựng lại** bằng `titleCaseSlug(project)` (`scaffold.ts:41`); qua modal thì `--name` là tên user gõ thật
(`routes/ui.ts:73`). Hai đường cùng argv, khác **giá trị `--name`**.

## 5. Move SPEC.md + relocate artifact

`scaffoldAtSpecGate` sau khi scaffold: **move** `apps/builder/.runs/<taskId>/SPEC.md` (canonical —
`relocateRunArtifacts` đã dời SPEC.md khỏi shorthand từ cuối turn ②; `scaffold.ts:220`) →
`projects/<project>/<workflow>/SPEC.md` (`scaffold.ts:236-237`). Short-circuit idempotent khi SPEC.md
đích đã có. Trạng thái transient `scaffolding` bọc quanh move không nguyên tử (QĐ #9) để crash giữa
chừng khôi phục được. **Move bị bỏ lặng lẽ** nếu file nguồn vắng — nhưng `task.artifacts.spec` vẫn
được trỏ vào path đích (`scaffold.ts:239`).

`relocateRunArtifacts` (`scaffold.ts:248`): move mọi thứ turn ghi ở `.runs/<taskId>/` (repo-root, = cwd
của turn) sang `apps/builder/.runs/<taskId>/`, rồi `rmdir` `.runs/` gốc (bỏ qua nếu còn dir task khác).
Idempotent. Lưu ý cho entry là **thư mục** (vd `promote/` của build promote): `rename` lên một dest
non-empty là `ENOTEMPTY` — vì thế `createPromoteTask` (spec 070, `state/task.ts`) stage source ngoài ở
**run-dir root**, không dưới `promote/` ([build-lifecycle.md](build-lifecycle.md) §3).

## 6. Guard ở đâu

| file | phủ |
|---|---|
| `apps/builder/test/slug.test.ts` | `deriveSlugName` (strip stopword, ≤4 từ, cap-40 không `_` đuôi, fallback `workflow`); `firstFreeSlug` (free giữ nguyên, per-project `_2`/`_3`, near-40 chừa chỗ suffix) |
| `apps/builder/test/create-project.test.ts` | `POST /api/projects`: argv `--kind project`, `checkProjectName` (`name_required`/`name_charset` — nhánh `reserved` **không** có test: regex chặn `_` trước nên nó unreachable, §4), 409 dup `{existing}`, 500 exit≠0. **`runPython` bị FAKE** — không spawn `init_project.py` thật |
| `apps/builder/test/helpers/scaffold-fake.ts` | **không phải test** — FAKE mô phỏng hiệu ứng đĩa của `init_project.py`; mọi test build (golden-build, auto-advance, …) chạy `ensureScaffold`/`scaffoldAtSpecGate` **qua fake này**, không qua tool thật |
| `apps/builder/test/base-import.test.ts` | đường `/api/bases` (**`dify-io.md` sở hữu**): `firstFreeSlug` suffix + `slugNote`, ghi verbatim `main.yml`. Chỉ trỏ — không phải doc này gác |
| `tests/test_sync.py::test_slugify` | gác `sync._slugify` — **KHÔNG** phải `slugify` của `init_project.py` |

## 7. Những gì KHÔNG check tự động nào chứng minh được

Ranh giới của mọi kết luận "xanh" ở tầng này.

- **`init_project.py` thật không được test nào spawn.** Mọi test build fake nó (`scaffold-fake.ts`);
  `create-project.test.ts` fake `runPython`. Nếu template `templates/_base/` đổi hình dạng (thêm/bớt file,
  đổi tên), fake vẫn xanh còn scaffold thật lệch — **không test nào đỏ**. `slugify` của `init_project.py`
  **không có unit test** riêng.
- **Ba bộ chuẩn hoá slug không được đối chiếu.** `slugify` (py, `init_project.py`), `sanitizeSlug` (ts,
  `state/task.ts`), `sync._slugify` (py, `sync.py`) là **ba implementation** với fallback khác nhau
  (`project` / `workflow` / `untitled`) và xử lí `-` khác nhau. Confinement dựa vào việc `slugify` và
  `sanitizeSlug` **cùng** giữ leading `_` (`init_project.py:63-64`, `task.ts:394`) để `_drafts` round-trip,
  nhưng **không test nào** đưa `_drafts` qua `init_project.py` thật rồi so với slug đã lưu.
- **`main.yml` KHÔNG do scaffold sinh** — nhưng không test nào chứng minh `workflows/` **rỗng** sau một
  scaffold thật. Fake tạo đúng `workflows/` dir rỗng nên **tình cờ khớp** với thực tế; nếu tool thật đổi để
  seed một `main.yml`, chỉ đường Implement/base-import mới lộ, không phải test scaffold.
- **Va chạm slug ở BUILD path không được gác.** `firstFreeSlug` là unit có test (`slug.test.ts`), nhưng
  việc `scaffoldAtSpecGate` **gọi đúng nhánh** (genuine-new chạy suffix + set `slugNote`; override **bỏ**
  suffix) chỉ được assert cho đường `/api/bases` (`base-import.test.ts`), **không** cho đường
  `scaffoldAtSpecGate`. Một hồi quy khiến override cũng suffix, hoặc genuine-new **quên** suffix (→ ghi đè
  workflow người khác), sẽ **không** làm test nào đỏ.
- **Override slug ghi đè có chủ ý nhưng không có phanh.** Một slug user cấp trùng workflow đang tồn tại sẽ
  overwrite `main.yml` của nó (`scaffold.ts:191-196`); F4 chỉ chặn nhánh derived. Không gì cảnh báo người
  rằng họ vừa retarget lên một workflow đã có.
- **regen `.vscode/settings.json` là side-effect ngoài repo-doc.** `init_project.py` spawn
  `regen_vscode_settings.py` mỗi lần tạo; non-fatal, nhưng không test nào gác nội dung nó ghi.
