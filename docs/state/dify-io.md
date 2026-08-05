# Hiện trạng — Dify I/O

Cái gì **rời khỏi máy này** về phía một Dify thật, đường nào nó đi, và **nửa chừng hỏng thì sao**.

Phạm vi: `dify-io.ts` (**nửa transport/live** — xem §0) · `import.ts` · `base-import.ts` ·
`live-test.ts` · `sync.py`.

> - Chuỗi trong backtick là **nguyên văn** code phát ra hoặc đọc — không dịch.
> - Tài liệu này mô tả **bất biến**, không chứa số đo. Số liệu (thời gian, token, số app) lấy bằng cách
>   chạy, không đọc ở đây. Hằng số thời gian nêu bằng **tên** (`FIRST_EVENT_DEADLINE_S`), không bằng giá
>   trị — giá trị trôi, quan hệ giữa chúng thì không (§9).

---

## 0. Ranh giới sở hữu

### `recovery.ts` — **không** thuộc doc này

[`build-lifecycle.md` §9](build-lifecycle.md) sở hữu `recovery.ts`: định nghĩa marker
`push_intent.json`, tính atomic của nó, và **đường boot** `reconcilePushIntents` (ba kết cục nguyên
văn). Doc này **không mô tả lại** — §6 dưới đây chỉ nói `import.ts` (file của doc này) **dùng** marker
đó ra sao **trong một request**.

### `dify-io.ts` bị **cắt đôi** giữa hai doc

[`readiness-and-plugins.md` §5](readiness-and-plugins.md#5-workspace-facts) sở hữu **nửa
workspace-facts**: `WorkspaceFacts`, `HarvestSource`, `harvestWorkspaceFacts`, `loadWorkspaceFacts`,
`enabledModelCount`, `knowledgeBlock`, `parsePlugins`, `parseDatasets`. Đó là đường facts → prompt
Implement; doc này **không mô tả lại**.

Doc này sở hữu **nửa còn lại** — đường byte đi ra Dify và quay về:

| vùng | export |
|---|---|
| creds | `difyCreds` · `difyTargets` · `TargetCreds` · `DifyTargets` |
| chokepoint | `runSyncPy` · `RunSyncPyOpts` · `SyncResult` |
| redaction | `registerSecret` · `unregisterSecret` · `redactSecrets` |
| seed / pull / push | `listSeeds` · `parseListTable` · `SeedRow` · `SeedsReason` · `pullApp` · `pulledFileFromStdout` · `pushApp` · `appIdFromJsonOut` |
| reconcile | `reconcileAppIdByName` · `pickReconciledApp` · `ReconcileResult` · `slugifyName` |
| model | `parseModels` · `pickLlmModel` · `resolveDefaultLlmModel` · `resolveLlmModels` · `LlmModel` |
| live ops | `mintAppKey` · `appKeyFromStdout` · `publishWorkflow` · `deleteApp` · `runWorkflow` · `parseRunResult` · `RunResult` · `uploadSampleFile` · `chooseSample` · `deployWithModel` · `DeployResult` · `InputVar` · `importForTest` |
| URL | `appUrlFrom` · `lastJsonLine` |

`parseModels` thuộc doc này dù `harvestWorkspaceFacts` (§5) gọi nó: §5 sở hữu **việc harvest**, doc này
sở hữu **parser**.

Hai bảng cộng lại phủ **đúng** mọi export của `dify-io.ts`, trừ `WorkspacePlugin` và `WorkspaceDataset`
— kiểu trả về của `parsePlugins`/`parseDatasets`, nên chúng đi theo **nửa §5**; readiness §5 hiện chưa
gọi tên chúng. Ghi ở đây để chúng không rơi vào khoảng trống "file đã có chủ nên không ai rà lại".

## 1. Chokepoint

`dify-io.ts` là **nơi duy nhất** repo nói chuyện với Dify, và trong nó `runSyncPy` là **hàm duy nhất**
mở subprocess. Mọi thao tác Dify — không trừ cái nào — là một lần shell:

```
<projectsDir>/.venv/bin/python tools/dify_base/sync.py <subcommand> …    (cwd = projectsDir)
```

`runSyncPy` **không bao giờ throw**. Spawn hỏng, python chết, hay timeout đều quy về
`{ code, stdout, stderr }` với `code ≠ 0` — caller rẽ nhánh theo **code**, y như exit code của
`sync.py`. Không có đường nào để một lỗi Dify nổ thành exception giữa một request.

Khi `opts.timeoutMs` được đặt, `execFile` gửi `SIGTERM`; err lúc đó mang `killed`, `code` không phải số
→ hàm quy về `code: 1`. **Cùng một nhánh degrade với mọi lỗi khác** — caller không phân biệt được
"timeout" và "python chết", và không cần phân biệt.

`opts.env` gộp **lên trên** creds đã tiêm — đó là cách `DIFY_APP_KEY` tới `run`/`upload` mà **không**
đi qua argv (§3).

## 2. Token sống ở đâu, và vì sao nó không tới một turn

`difyCreds()` đọc **tươi** từ `process.env` mỗi lần gọi — `DIFY_CONSOLE_URL`, `DIFY_CONSOLE_TOKEN`,
`DIFY_WORKSPACE_ID`. Không cache, không module-level const. Operator export chúng (hoặc một `.env` lúc
boot nạp). Token **không** nằm trong repo, **không** nằm trong `projects/<project>/envs/dev.env` trên
đường này: `runSyncPy` cố ý **không** truyền `--project` cho `list`, nên `_load_project_env` của
`sync.py` không chạy và dotenv không nạp gì — env được tiêm **thẳng**.

Token tới đúng **một** nơi: `env` của child `sync.py` trong `runSyncPy`. Nó không tới một turn nhờ
**hai lớp độc lập**:

1. **Cấu trúc** — không phase nào chạy `sync.py`. Mọi I/O Dify là backend-owned; turn chỉ sinh YAML.
2. **Cưỡng chế** — `claude-session.ts` xoá **mọi** biến `DIFY_*` khỏi env của turn con trước khi spawn.
   Backend truyền `{...process.env}` vào đó, nên nếu operator đã export token thì **lớp này** mới là thứ
   chịu lực. Chi tiết: [`turn-and-sandbox.md` §1 "Env của turn con"](turn-and-sandbox.md).

Lớp 2 là lý do lớp 1 không cần được tin. Lớp 2 **được gác** bởi `claude-session.test.ts`
(spawn fake `claude` trên PATH, assert env con không còn `DIFY_*` — file thuộc
`turn-and-sandbox.md` §8).

`difyTargets()` là **probe năng lực**, không phải khai báo lúc start: `selfhost` chỉ có khi **cả**
`url` **và** `token` cùng có mặt; thiếu một cái → slot vắng (`undefined`). Slot `cloud` **luôn vắng** —
nó là seam dành sẵn trong interface, không code nào ở đây điền. `DIFY_WORKSPACE_ID` chỉ cần cho đường
ADMIN_API_KEY: `sync.py` gửi nó thành header `X-WORKSPACE-ID` để resolve chủ workspace; một session JWT
**bỏ qua** header đó, nên set thừa là vô hại.

## 3. `redactSecrets`

Chạy trên **mọi** `stdout`/`stderr` mà `runSyncPy` bắt được, **trước khi** chuỗi đó được log, trả về,
hay lên SSE. Đây là hàm bọc, không phải hàm kiểm tra — nó không báo lỗi khi thấy secret, nó thay bằng
`***`.

Cái gì bị xoá:

| nguồn | dạng bị scrub |
|---|---|
| `DIFY_CONSOLE_TOKEN` | nguyên văn + `encodeURIComponent` + base64 |
| mọi secret trong `runtimeSecrets` | như trên |
| `DIFY_CONSOLE_URL` | nguyên văn + bản bỏ `/` cuối + **origin trần** (`scheme://host`) |
| header | `Bearer <…>` → `Bearer ***` |

Ngưỡng **≥4 ký tự** cho mỗi dạng: dưới ngưỡng thì một chuỗi ngắn sẽ nuốt mất nửa transcript. Scrub
origin trần là để host của Service-API (`…/v1/…`, suy ra từ console base) cũng bị che trong một error
tail hiếm.

**Registry runtime.** App key (`app-…`) được **mint lúc chạy**, nên nó **không có trong env** →
`difyCreds()` không thấy → scrub theo env sẽ trượt. `mintAppKey` **đăng ký ngay khi mint**
(`registerSecret` bên trong chính nó, không phải việc caller phải nhớ); caller gỡ bằng
`unregisterSecret` khi xong. `registerSecret` bỏ qua chuỗi `< 4` ký tự.

**Cái KHÔNG được bọc, có chủ ý:** `app_url` mà user bấm. Nó được dựng riêng bởi `appUrlFrom(creds.url,
appId)` từ creds — **không** đi qua `redactSecrets`. Nếu nó đi qua, `DIFY_CONSOLE_URL` là tiền tố của
nó nên link sẽ thành `***/app/<id>/workflow`. Đây là chỗ hai yêu cầu cắt nhau: link phải bấm được, host
phải bị che trong log — giải bằng cách tách hai đường, không bằng một hàm.

## 4. Model auto-inject

**Xảy ra ở đâu:** `deployWithModel` → `sync.py inject-model`. **Local file I/O, không creds.**
**Khi nào:** trên đường live test (`live-test.ts` bước 2), **và** best-effort trên đường import
tĩnh selfhost (`resolveImportSource` trong `import.ts` — spec 087): pick được model **và** vá được
≥1 node thì push bản sao tạm `import-deploy.yml` (tên riêng, không đè `deploy.yml` của live-test)
qua `pushApp srcFileRel` → `sync.py --src-file`; **mọi** nhánh khác (0-model, inject hỏng, throw,
0-patch) rơi về push nguồn nguyên trạng — inject **không bao giờ** được phép chặn một import.
Chạy TRƯỚC `writePushIntent` (local-only) nên idempotency/reconcile §6 không đổi; nhánh
marker-exists không push nên không inject.

Nó **không bao giờ** ghi đè nguồn. `inject-model` viết một **bản sao tạm**
`apps/builder/.runs/<taskId>/deploy.yml`; `main.yml` trên đĩa ở lại **model-agnostic** (portable). Hai
guard trong `sync.py` cưỡng chế điều đó, và cả hai đã chạy thử:

```
--out trùng --src            → ❌ --out must differ from --src (refusing to overwrite the source YAML)
--out thoát khỏi repo        → ❌ --out must stay within the repo
```

Node được vá: node thuộc `MODEL_TYPES` = `llm` · `parameter-extractor` · `question-classifier`
(spec 087 — cả ba mang chung một `$defs/ModelConfig` trong schema 0.6.0) có model **rỗng** —
nghĩa là `provider` rỗng **HOẶC** `name` rỗng, đúng vị từ mà probe runnability dùng — **hoặc** có
tên **không nằm trong** `--valid-names` (tập model đang enable). Nghĩa là một model hard-code
nhưng đã bị gỡ khỏi workspace cũng bị thay — chứ không chết lúc runtime.

**Hai bất biến chống-lệch, cả hai đều có test cưỡng chế** (mọi triệu chứng "Model not exist" đều
rơi ra từ chỗ hai bản mô tả cùng một khái niệm lệch nhau):
- *Node nào cần model* — `MODEL_TYPES` viết tay ở **ba** nơi (`sync.py`, probe trong
  `runnability.ts`, `MODEL_NODE_TYPES` của skill `/report`) → `test_model_types_matches_runnability`
  so cả ba.
- *Thế nào là model rỗng* — inject quyết định vá, probe quyết định cảnh báo; hai bên phải cho
  **cùng một câu trả lời trên cùng một node** → `test_inject_patches_exactly_what_the_probe_calls_empty`
  chạy thật probe rồi so tập node được vá với tập node bị gọi là rỗng (không so chuỗi, so hành vi).
  Trước khi có nó, `{provider: '', name: <model đang enable>}` bị probe gọi là rỗng nhưng inject bỏ qua.

`inject-model` trả về trên một dòng JSON: `node_count` (số node **đã vá**), `llm_count` (**tổng**
node cần model — cả ba `MODEL_TYPES`, vá hay không; tên field giữ nguyên vì là wire-contract với
`deployWithModel`, chỉ ngữ nghĩa được mở rộng), `patched[]`, `out`, `inputs[]` (schema biến của
node `start`), `mode`, `entry_types[]`.

**Nhánh degrade 0-model** (`live-test.ts:269-270`):

```ts
if (dep.llmCount > 0 && !pick) {
  return degradeStatic('no enabled LLM model in the workspace (0-model)', { modelAutofilled: dep.nodeCount });
}
```

Gate là **có điều kiện**, và điều kiện là `llmCount`, **không** phải `nodeCount`. Workflow
model-agnostic (`llmCount === 0`) **chạy được không cần model nào** trong workspace → đi tiếp. Chỉ
workflow **có** node cần model (một trong ba `MODEL_TYPES`) mà workspace **không** có model enable
nào mới degrade về `static-only` tại gate `infra_degraded` — trước spec 087 count chỉ đếm `llm`
nên workflow chỉ-có-PE/QC lọt qua gate và được import với model rỗng thầm lặng.

Thứ tự cũng chịu lực: bước 1 resolve model **không bail** khi rỗng; bước 2 truyền placeholder
`{ provider: '', name: '' }` vào `inject-model`; bước 3 mới gate. Placeholder chỉ thật sự được ghi vào
node khi `llmCount > 0` — mà đúng trường hợp đó thì bước 3 chặn `deploy.yml` **trước khi** nó tới Dify.
Nên một bản sao mang model rỗng **không bao giờ** được import.

`pickLlmModel` là policy thuần, tất định: system-default **nếu nó thật sự đang enable** → rẻ nhất
(`*-nano` trước, rồi `*-mini`) → cái đầu tiên trong tập enable → `null`. Cả ba `MODEL_TYPES` dùng
**cùng một pick** (một nguồn, đơn giản — chỉ xét pick riêng cho PE/QC nếu có bằng chứng chi phí).
`parseModels` **loại** model có `status` khác `'active'` hoặc `deprecated: true`, nhưng **giữ**
model không có field `status` — một model được liệt kê nhưng đã chết sẽ thành `Model not exist`
lúc runtime, nên nó bị lọc ở đây.

**Bề mặt lỗi runtime KHÔNG đồng nhất giữa các node cần model**: node `llm` model-rỗng chết với
`"Model not exist"` đọc-hiểu-được, nhưng node `question-classifier` model-rỗng chết dưới dạng
stream đứt chung chung (`"Workflow stream ended without a terminal event"`, status `failed`,
0 token) — mờ hơn hẳn, user tự debug gần như không lần ra model. Import thì **nhận sạch cả hai**
(import không kiểm tra model). Đó là lý do inject phải phủ đủ ba type chứ không thể dựa vào
thông báo lỗi lúc chạy.

## 5. Cái gì thật sự được tạo trên Dify

**Import của Dify LUÔN tạo app MỚI.** Không có đường update-in-place qua `POST /console/api/apps/imports`
(`vendor/dify-src/api/services/app_dsl_service.py:409` — `_create_or_update_app` chỉ update khi được
truyền một `app` sẵn có, mà `sync.py` không bao giờ truyền). Hệ quả xuyên suốt mọi mục dưới:

- sửa một workflow đã có → import ra **bản sao**, bản cũ **không** đổi. `import.ts` phát
  `duplicateWarning` cho đúng chuyện đó khi `task.workflow` có giá trị.
- retry một push đã thành công một nửa → **app thứ hai**. Đó là toàn bộ lý do §6 tồn tại.

`pushApp` luôn truyền `--name <appName>` — **không** để Dify lấy tên từ `app.name` trong YAML (do model
chọn). Tên bị ghim thì reconcile theo tên (§6) mới khớp **cùng một chuỗi** Dify đã lưu.

### Import probe

Probe **đẩy YAML thật lên Dify thật rồi xoá ngay**. Hai probe, hai tên, cùng bộ ops của doc này
(`importForTest` → `deleteApp` → khi hỏng thì `reconcileAppIdByName`):

| probe | tên app tạo ra | ở đâu |
|---|---|---|
| ④ static | `[probe] <taskId>` | `orchestrator.ts:746` (`runImportProbe`) — [build-lifecycle.md](build-lifecycle.md) §7 sở hữu |
| base import | `[probe] base <project>/<slug>` | `probeImportedBase` (doc này) |

Tên **ổn định** theo task/base chứ không ngẫu nhiên. Đó **không** phải tiện tay — xem §9.

Dọn: import OK → `deleteApp` ngay. Dọn hỏng → verdict `ok` kèm biến thể **nêu đích danh app còn lại**
(user tự xoá). Import FAILED → **quét orphan** bằng `reconcileAppIdByName(probeName)` rồi xoá nếu tìm
thấy, sau đó trả lỗi Dify **nguyên văn** (đã redact, 3 dòng cuối). Import trả `status: 'pending'`
(HTTP 202, lệch version DSL) → app **chưa** được tạo → **không** quét, verdict `parked`.

Probe **chỉ advisory**: nó không đổi `lintClean`, gate, hay verdict — `base-import.ts` gọi nó **sau
khi** file đã ghi xong, và bọc `.catch(() => undefined)`. Nó vào qua seam `BaseProbe`
(`(projectsDir, project, slug) => Promise<string | undefined>`), mặc định là `probeImportedBase` thật —
test tiêm bản giả vào đúng đây. Chuỗi verdict lấy từ `probeVerdict` trong
`report.ts` — **nguồn duy nhất**, [`readiness-and-plugins.md` §7](readiness-and-plugins.md#probe-verdict)
sở hữu.

### App của live test

Live test tạo **một app mỗi lần chạy** và **chấp nhận** điều đó (khác probe). Chúng được theo dõi trong
`task.testApps[]`. Một lần re-test **tự xoá mọi app của các lần chạy TRƯỚC** của cùng build — chỉ app
hiện tại còn lại. Xoá hỏng → id đó **ở lại** trong danh sách (dọn sau bằng nút "Delete test apps"), chứ
không bị âm thầm quên.

`cleanupTestApps(keepCurrent)` xoá tất cả (`false`) hoặc mọi app **trừ** app hiện tại (`true`). Con trỏ
`task.appId`/`appUrl` chỉ bị null **nếu app đó thật sự đã biến mất** khỏi `remaining` — nếu không gate
sẽ hiện một link chết.

## 6. Nửa chừng hỏng: `import.ts` dùng marker ra sao

Vì push luôn tạo app mới (§5), một lần crash giữa push **không được phép** dẫn tới re-push. Guard là
marker `.runs/<taskId>/push_intent.json`, mà **`build-lifecycle.md` §9 sở hữu** (shape, tính atomic,
đường boot). Ở đây chỉ có một điều cần mang sang: `appId: null` **là** khoá idempotency — nó nghĩa
*"một push có thể đang bay, hoặc đã xong"*.

Phần dưới là thứ doc này sở hữu: **`runImportAndFinish` (`import.ts`) rẽ nhánh thế nào trong một
request**, và `reconcileAppIdByName` (`dify-io.ts`) trả lời ra sao.

`import.ts` ghi marker **TRƯỚC** khi gọi `pushApp` — guard khoá theo marker **tiền-push**, nên thứ tự
đó chịu lực, không phải tiện tay:

| tình huống | xử lý |
|---|---|
| marker đã có, **có** `appId` | dùng luôn id đó. **Không** push. |
| marker đã có, **không** `appId` | `reconcileAppIdByName` → **không bao giờ** push lại |
| không marker | ghi marker (`appId: null`) → `pushApp` → id từ `--json-out`, thiếu thì reconcile |
| push hỏng **và** không reconcile ra id | `error`; marker **ở lại** (`appId: null`) → `/reply` sau đó reconcile chứ không re-push |
| push hỏng **nhưng** reconcile ra id | **đi tiếp bình thường** — app đã có trên Dify, chỉ là `sync.py` chết trước khi báo |

Hàng cuối là cái "nửa chừng hỏng" đúng nghĩa: `if (!push.ok && !appId)` chỉ error khi **cả hai** đều
hỏng. Một push đã tạo app rồi mới chết vẫn về đích.

**Reconcile theo tên** (`pickReconciledApp`, thuần, unit-test được) chạy trên bảng `sync.py list` — mà
bảng đó chỉ phơi `id`/`mode`/`name`, **không có** `created_at` hay bất kỳ thứ gì phân biệt. Nên:

| số app khớp tên (đã slugify) | kết quả |
|---|---|
| 0 | `{ appId: null, ambiguous: false }` → *"push may have completed — check Dify"* |
| đúng 1 | `{ appId, ambiguous: false }` → gắn |
| ≥2 | `{ appId: null, ambiguous: true }` → **gắn NONE**, nói *"ambiguous — verify in Dify"* |

Nhánh ≥2 **cố ý không đoán**. "Lấy cái mới nhất" nghe hợp lý và **không** làm được: không có trường
thời gian nào để so. Đoán sai = gắn nhầm app của build khác vào build này.

`slugifyName` **soi gương** `_slugify` của `sync.py` (thường hoá, mọi thứ không phải alnum/`_`/`-` →
`_`, gộp `_` liền nhau, cắt `_` hai đầu, rỗng → `untitled`). Hai hàm lệch nhau thì match im lặng trượt.

Đường **boot** (`reconcilePushIntents`) dùng **cùng** `reconcileAppIdByName` này và cùng ba kết cục
trên: [`build-lifecycle.md` §9](build-lifecycle.md) sở hữu, nêu nguyên văn từng chuỗi.

`import.ts` xoá marker **chỉ khi** `appId` đã có. Một build kết thúc `done` mà id không reconcile được
sẽ **giữ marker lại** — hệ quả ở §10.

## 7. Live test

`runLiveTest` là sub-orchestrator của ④, **chỉ** chạy khi user chọn `test_live`. Đường tĩnh không đổi.
Mọi call Dify đi qua seam `liveOps` nên FSM test được mà không cần Dify thật.

Thứ tự — và mỗi bước có nhánh degrade riêng:

| # | bước | hỏng thì |
|---|---|---|
| 0 | `difyCreds()` | thiếu url/token → `degradeStatic` **ngay**, không chạm gì |
| 1 | `runReport` (lint baseline **trước**) | `!ok` → `error` (đây là nền mà mọi degrade sau rơi về) |
| 2 | `resolveLlmModels` | rỗng → **không bail** (§4) |
| 3 | `deployWithModel` | `!ok` → degrade |
| 4 | gate 0-model | `llmCount > 0 && !pick` → degrade |
| 5 | `resolveInput` | type lạ → `need_input` (park, **không** phải lỗi workflow); chỉ `remote_url` → degrade |
| 6 | `importForTest` | `!ok \|\| !appId` → degrade |
| 7 | `publishWorkflow` | `!ok` → degrade (import **không** tự publish) |
| 8 | `mintAppKey` | `null` → degrade |
| 9 | `uploadSampleFile` (chỉ khi cần) | `null` → degrade |
| 10 | `runWorkflow` | `status === null` → degrade; `'failed'`/rỗng → `workflow_fail` |

`isCancelled` được hỏi giữa **mọi** bước.

**Phân loại quan trọng nhất** ở bước 10: `status === null` nghĩa là transport/timeout → **hạ tầng hỏng**,
không phải workflow sai → `infra_degraded`. `status === 'failed'` hoặc output rỗng → `workflow_fail`,
park tại `test_result` để người xem. Một workflow hỏng **không bao giờ** bị giấu thành static-pass, và
một mạng hỏng **không bao giờ** bị đổ cho workflow.

Retry **chỉ** ở bước 10, **chỉ** khi `status === null` (`INFRA_RUN_RETRY` lần), và **không bao giờ**
re-import.

`resolveInput` thuần, bốn kết cục mỗi biến **required** (biến optional bị bỏ qua — Dify tự dùng default):
giá trị dựng từ registry `INPUT_BUILDERS` (`type → builder`, thêm type mới là thêm một entry) ·
`NEEDS_UPLOAD` (`file`/`file-list` cho `local_file` — dựng được sau khi upload) · `CANT_BUILD` (chỉ nhận
`remote_url` → **không bịa URL ngoài** → degrade thật thà) · `missing` (type không biết → `need_input`).

File input đi **hai pha**: pha 1 phát hiện `needsUpload`; sau khi mint key, `firstUploadableFileVar`
chọn biến `file`/`file-list` **required** đầu tiên cho phép `local_file`, `uploadSampleFile` đẩy một
asset **bundle sẵn trong repo** (`server/assets/live-test-samples/`; `chooseSample` chọn theo
`allowed_file_extensions`, rồi `allowed_file_types[0]`, cuối cùng `.txt`), rồi `resolveInput` chạy lại
với `ResolveCtx.uploadedFileId` để điền `upload_file_id` **thật**. `resolveInput` thuần được là nhờ id
đó được **luồn vào** qua `ResolveCtx` chứ không tự đi lấy. **Không bao giờ gửi id rỗng** — id rỗng làm
Dify treo.

**Judge (T3)** — `runJudge` là một turn **data-only**: rubric + input + output nằm sẵn trong prompt, không
cần tool, không cần creds (turn nào cũng bị strip `DIFY_*`, §2). Nó **advisory tuyệt đối**: không rubric,
đọc rubric hỏng, turn lỗi, hay parse trượt đều trả `null` và **không** lật `t1Pass` hay gate.
`extractJson` thử fenced ```json (từ **cuối** lên) rồi tới span `{` đầu → `}` cuối rộng nhất.

Live test **không bao giờ tự `done`**. Nó luôn kết ở một gate người (`test_result` hoặc
`infra_degraded`) hoặc `error`. `finishLiveAccepted` chỉ đóng build sau khi người bấm.

## 8. Base import

`importYamlAsBase` nhận một `.yml` rời (`ImportBaseInput`: `yaml`, `name?`, `project?`, `fileName?`) và
hạ nó thành base local — **không** đụng Dify để làm việc đó. Nó **thuần HTTP**: trả `ImportBaseResult`,
một union phân biệt (`{ ok: true, project, workflow, slugNote?, probeNote? }` hoặc
`{ ok: false, status, error }`) để route ánh xạ sang mã HTTP — hàm này không tự biết mình đang phục vụ
một request.

Thứ tự cưỡng chế (mọi nhánh **từ chối** 400 xảy ra **trước** khi bất cứ gì được ghi vào `projects/`;
lỗi scaffold 500 ở bước 4 có thể rơi *giữa* hai tier — tier project đã ghi):

1. shape + size (`MAX_ATTACHMENT_BYTES`) + đuôi `.yml`/`.yaml` (chỉ khi có `fileName`);
2. **từ chối** `name`/`project` mang `/`, `\`, hoặc `..` → 400. **Từ chối**, không sanitize im lặng — một
   input thù địch phải nổi lên thành lỗi chứ không thành slug méo;
3. chạy **đủ bộ linter** (`LINTERS`, `linters.ts` — **chưa có chủ**) trên một file **tạm** trong
   `mkdtemp`, fail → 400 kèm message nguyên văn, `finally` luôn `rm` thư mục tạm;
4. derive slug (`deriveSlugName` → `firstFreeSlug`; `slug.ts`) và scaffold tier (`project-create.ts`)
   — cả hai thuộc [scaffold-and-layout.md](scaffold-and-layout.md);
5. ghi bytes **nguyên văn** vào `projects/<project>/<slug>/workflows/main.yml`;
6. probe (§5) — **sau** khi file đã landed.

Tên tiếng Nhật **không mất**: nó sống trong `app.name` của chính YAML (verbatim); slug thư mục là chuyện
ASCII riêng (`app.name` thuần Nhật → `workflow`). Đây là lý do đường này **không** dùng
`checkProjectName` — cổng tên-project chỉ-tiếng-Anh sẽ 400 một `app.name` tiếng Nhật hợp lệ.

YAML là **data**: nó chỉ quay lại một turn dưới dạng `{{SEED_PATH}}`, thứ Analyze/Implement vốn đã coi
là untrusted.

## 9. Hằng số phản trực giác

Ba thứ dưới đây **trông như bug** và "sửa cho hợp lý" sẽ làm hỏng hệ thống.

### 9.1 Dify commit app row **trước khi** validate biến → probe phải quét orphan

Một import **FAILED** vẫn có thể **để lại app**. Trong
`vendor/dify-src/api/services/app_dsl_service.py`:

```
:466-467   self._session.add(app) ; self._session.commit()      ← app row đã nằm trong DB
:482       raise ValueError("Missing workflow data …")          ← sau đó mới validate
:486       build_environment_variable_from_mapping(obj)         ← và cái này raise được
```

Nên nhánh "import hỏng" **vẫn** phải `reconcileAppIdByName(probeName)` rồi `deleteApp`. Bỏ bước quét đó
vì "import hỏng thì làm gì có app mà xoá" là **sai**, và giá phải trả là orphan tích tụ trong workspace
của user.

Cùng lý do: `probeName` phải **ổn định** theo task (`[probe] <taskId>`), không được ngẫu nhiên. Tên ổn
định cho phép **lần retry này** quét được orphan mà lần retry trước làm rớt. Tên ngẫu nhiên = mỗi lần
retry để lại một rác không ai tìm được.

### 9.2 `--timeout` của `sync.py run` là **argv chết** — và phải để yên

`_run_timeout` **nhận tham số rồi bỏ qua nó** — nguyên văn thân hàm:

```python
@staticmethod
def _run_timeout(read: int | None):
    return (5, FIRST_EVENT_DEADLINE_S)      # `read` không xuất hiện trong thân hàm
```

Gọi thử với một giá trị bất kỳ và với `None` cho **cùng một** kết quả — tham số không tới được đâu cả.

`runWorkflow` (TS) vẫn truyền `--timeout <giây>` xuống, `cmd_run` vẫn thread nó vào
`run_workflow(timeout=…)`, và nó **chết ở đó**. Thứ thật sự bound một run:

- **read timeout = `FIRST_EVENT_DEADLINE_S`, tính theo mỗi lần recv** (reset mỗi chunk stream về). Vì
  vậy nó kiêm luôn **watchdog treo**: một run hợp lệ stream event gần như tức thì; một run treo vì input
  sai stream **không gì cả** → timeout nảy → `RunHungNoStream`, một lỗi tự mô tả, thay vì "network error".
- **`execFile` timeout ngoài** (`timeoutMs`) — bound tổng wall-clock, → `SIGTERM` → `code 1`.

Nối `--timeout` vào `_run_timeout` "cho đúng ý đồ" sẽ đẩy read timeout lên bằng `RUN_TIMEOUT_MS` →
**watchdog treo chết**: một run treo sẽ ngồi im tới khi `execFile` giết nó, và user nhận một lỗi vô
nghĩa thay vì "workflow hung — check required inputs". Deadline **phải** độc lập với timeout tổng.

> Comment tại `runWorkflow` nói *"the outer execFile timeout is a hair beyond Python's own HTTP timeout
> so a clean error tail wins the race"*. **Comment đó sai**: không có "Python's own HTTP timeout" nào
> phái sinh từ `--timeout`; hai deadline chênh nhau cả bậc, không phải "a hair". Hành vi thì đúng, mô tả
> thì không.

### 9.3 `t1Pass` đòi **cả hai**: `ok` **và** output không rỗng

`_collect_stream` **tự chế** status khi stream kết thúc mà không có event `workflow_finished`:

```python
return {"data": {"status": status or ("failed" if error else "succeeded"), …}}
```

Nghĩa là `status: "succeeded"` có thể là **bịa** — không phải Dify nói vậy. Nên
`t1Pass = run.ok && outputNonEmpty` **không** phải thừa: `outputNonEmpty` mới là thứ chặn một status bịa
thành PASS giả. Rút gọn `t1Pass` về `run.ok` sẽ biến mọi stream đứt-lặng-lẽ thành "live-verified".

Liên quan: event `ping` **không** tính là tiến triển (`etype and etype != "ping"`) — Dify gửi ping cả cho
run mà nó sắp treo, nên đếm ping là progress thì watchdog §9.2 mù.

## 10. Giới hạn đã biết trong code

Ghi lại, **không sửa** (doc này không đụng code).

- **Secret rò khỏi registry khi cancel đúng nhịp.** `live-test.ts:331` — `if (bail()) return;` **ngay
  sau** `mintAppKey` — không gọi `unregisterSecret(key)`. Hai nhánh bail kế tiếp gọi trong-bail
  (`:340`, `:353`); `:356` là unregister của đường thường (chạy TRƯỚC các bail muộn `:357`/`:372`/`:374`,
  nên chúng an toàn nhờ nó). Một `/cancel` rơi đúng khoảnh khắc đó để key ở lại `runtimeSecrets` suốt đời
  process. Hệ quả là **over-redaction** (một key đã chết vẫn bị scrub thành `***`), không phải hở
  security — nhưng nó phản lại chính comment trên registry: *"bounded lifetime, no unbounded growth"*.
- **Task `done` vẫn giữ marker, và boot sau sẽ chạm lại.** `import.ts` chỉ `clearPushIntent` khi
  `appId` có. Một build kết thúc `done` với `appId: null` (reconcile `ambiguous`, hoặc không khớp) giữ
  marker lại; `reconcilePushIntents` (`recovery.ts` — [`build-lifecycle.md` §9](build-lifecycle.md))
  không xét `task.status`, nên lần boot sau nó **ghi `task.error`** lên một task **đã done**. Nguyên
  nhân nằm ở file của doc này (`import.ts` không xoá marker trên nhánh đó); hậu quả rơi vào file của
  doc kia.

## 11. Guard ở đâu

| file | phủ |
|---|---|
| `apps/builder/test/dify-parsers.test.ts` | `appIdFromJsonOut` (thứ tự `app_id` > `id` > `app.id`) · `appUrlFrom` · `slugifyName` · `parseListTable` · `pickReconciledApp` (0/1/≥2 → ambiguous) · `pulledFileFromStdout` |
| `apps/builder/test/dify-live-helpers.test.ts` | `lastJsonLine` · `parseModels` (kể cả `status`/`deprecated` và default dạng object lồng) · `pickLlmModel` · `parseRunResult` (cả shape workflow lẫn chat) · `appKeyFromStdout` · vòng `registerSecret`/`unregisterSecret` |
| `apps/builder/test/redact.test.ts` | `redactSecrets`: token nguyên văn/ngắn/URL-encoded/base64 · `DIFY_CONSOLE_URL` + origin trần · `Bearer` · không creds → nguyên văn |
| `apps/builder/test/dify-targets.test.ts` | `difyTargets`: cần **cả** url+token · `workspaceId` đi kèm · `cloud` **luôn** vắng |
| `apps/builder/test/dify-inject-model.test.ts` | `deployWithModel` parse `entry_types`; vắng `entry_types` → `undefined` (degrade). Chạy qua shim `.venv/bin/python`, **không** Dify thật |
| `apps/builder/test/import-inject.test.ts` | `resolveImportSource` (5 nhánh best-effort: inject thành công / pick null / 0-patch / ok:false / dep throw) · `pushApp` plumbing `srcFileRel` → `--src-file` (shim ghi argv) |
| `apps/builder/test/live-test.test.ts` | FSM `runLiveTest`: passed / workflow_fail / 0-model (cả `llmCount>0` lẫn `=0`) / transport / need_input / upload / chat / judge / trigger-note · `resolveInput` · `extractJson` · `parseJudgeVerdict` · `cleanupTestApps` · auto-prune app cũ |
| `apps/builder/test/import-probe.test.ts` | probe ④ (`orchestrator.ts` — file khác, [build-lifecycle.md](build-lifecycle.md) sở hữu): tên duy nhất · quét orphan khi FAILED · 202 `pending` → không sweep · không creds → không probe · note vào `report.json` |
| `apps/builder/test/base-import.test.ts` | `importYamlAsBase`: ghi verbatim · slug JP · auto-suffix · linter fail → 400 và **không ghi gì** · traversal → 400 · probe advisory không chặn |
| `tests/test_sync.py` | header (kể cả `X-WORKSPACE-ID` đường admin-key) · `_client_from_env` · shape `list_apps`/`export_app`/`import_app` · `_slugify` · `cmd_pull` ghi file · `cmd_inject_model` (count/patch đủ 3 `MODEL_TYPES`, kể cả QC-only) · cross-check `MODEL_TYPES` sync.py ↔ runnability.ts |

## 12. Những gì KHÔNG check tự động nào chứng minh được

Đây là ranh giới của mọi kết luận "xanh" ở tầng này. Không mục nào dưới đây là suy đoán — mỗi mục là một
lần grep không ra test.

- ~~Không gì gác việc token không tới một turn~~ — **đã đóng 2026-07-18**: `claude-session.test.ts`
  spawn fake `claude` thật và assert env con không còn `DIFY_*`/`CLAUDE_CODE*`; xoá vòng strip giờ làm
  test đỏ. (File test thuộc `turn-and-sandbox.md` §8; khẳng định trung tâm của §2 nay có lưới.)
- **Không gì gác việc creds được tiêm đúng chỗ.** Không test nào assert `runSyncPy` đặt
  `DIFY_CONSOLE_URL`/`TOKEN`/`WORKSPACE_ID` lên env của **child** — hay quan trọng hơn, rằng
  `DIFY_APP_KEY` đi qua `opts.env` chứ **không** qua argv. Argv nhìn thấy được bằng `ps`; một refactor
  đẩy key sang argv sẽ **không** làm đỏ test nào.
- **`runImportAndFinish` — toàn bộ §6 trong-request — KHÔNG có test.** `recovery.test.ts` chỉ phủ người
  anh em **lúc boot** (`reconcilePushIntents`). Bảng năm nhánh ở §6 (marker có/không, push hỏng nhưng
  reconcile ra id, …) — cơ chế duy nhất đứng giữa một crash và một app trùng trên Dify của user —
  **không dòng test nào chạm vào**. Chỉ `finishWithoutImport` được lái, qua `skip_import` trong
  `advance-loop.test.ts`. `report-duplicate-warning.test.ts` chỉ **nhắc tên** `runImportAndFinish` trong
  comment.
- **`chooseSample` và các asset bundle không được gác.** `chooseSample` không được import trong bất kỳ
  test nào. `SAMPLES` trỏ vào `apps/builder/server/assets/live-test-samples/sample.{xlsx,csv,txt,pdf,png}`
  bằng **chuỗi chép tay**; không gì đối chiếu chúng với file thật trên đĩa. Đổi tên một asset → hàm vẫn
  trả path bình thường, và chỉ một live run thật mới hỏng.
- **Phần lớn `sync.py` không có test.** Có test: client methods + `_slugify` + `cmd_pull` +
  `cmd_inject_model`. **Không** có test: `cmd_push` (kể cả `--src-file`/`--json-out`), `cmd_run`,
  `cmd_diff`, `cmd_models`/`plugins`/`datasets`/`api-key`/`publish`/`delete`/`upload`, `_collect_stream`,
  `_is_read_timeout`, `RunHungNoStream`, `_run_timeout`, `_service_base`, `_fmt_request_error`.
  `_collect_stream` là thứ **quyết định pass/fail** của một live run (nó chuẩn hoá SSE và **chế** status,
  §9.3) — và nó có **zero** test.
- **Docstring của `tests/test_sync.py` nói dối.** Nó khai kiểm *"- Diff detection"*; **không có test
  `cmd_diff` nào**, ở đây hay bất kỳ đâu. `cmd_diff` là code sống, operator gọi được, **hoàn toàn không
  được gác**.
- **Hai guard của `inject-model` không có test.** `--out` trùng `--src`, và `--out` thoát khỏi repo —
  chúng giữ bất biến portability của §4 (`main.yml` không bao giờ bị ghi đè). Tôi xác minh **bằng tay**
  (§4); không test nào giữ chúng.
- **Không nhánh `bail()` nào của live test được test.** `live-test.test.ts` không nhắc `isCancelled` hay
  cancel. Cả 11 điểm bail — gồm cái rò secret ở `:331` (§10) — chưa bao giờ chạy trong test.
- **Không gì chứng minh chuỗi TS ↔ python vẫn khớp.** `slugifyName` (TS) và `_slugify` (python) được test
  **riêng rẽ, trên case chép tay riêng của mỗi bên** — không có test parity so hai implementation trên
  một fixture chung (như `runnability.test.ts` làm cho readiness). Hai bên lệch thì reconcile-theo-tên
  im lặng trượt → *"push may have completed — check Dify"* thay vì gắn đúng app.
- **Shape phản hồi Dify tự-host chưa được xác nhận.** `appIdFromJsonOut` đọc `app_id` trước — trường đó
  chỉ **verified trên Cloud**; comment trong code còn để nguyên `TODO: confirm … against a real
  SELF-HOSTED import response`. Đường `list`-reconcile là lưới an toàn cho chính chỗ không chắc này.
- **Không gì chạm Dify thật trong CI.** Mọi test trong bảng §11 chạy trên fake/shim/mock HTTP. Việc Dify
  thật *chấp nhận* một YAML, *thật sự* publish, *thật sự* mint key, hay import probe *thật sự* dọn sạch
  — **không suite nào chứng minh**. `workspace-facts.test.ts` có một test creds-gated, nhưng nó `t.skip()`
  khi vắng creds, tức mặc định nó không chạy.
