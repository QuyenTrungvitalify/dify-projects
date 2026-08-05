# Hiện trạng — bề mặt UI

User thấy gì, làm được gì ở mỗi trạng thái, và cái gì **chỉ** tồn tại trong browser.

Phạm vi: `web/src/store.ts` · `web/src/sse-client.ts` · và **toàn bộ** `web/src/lib/`: `i18n.ts` ·
`gate-foot.ts` · `thread-persist.ts` · `crumb.ts` · `phase.ts` · `markdown.ts` · `diff-parser.ts` ·
`slug.ts` · `attachments.ts` · `dev.ts` · `promote-visibility.ts` · `notify.ts`.

**Không** thuộc doc này, và vẫn **chưa có chủ**: `web/src/api.ts` (shape HTTP + `ApiError`),
`web/src/types.ts` (`Wire*`), `web/src/components/**`, `main.tsx`, `data.ts`. Doc này trỏ vào chúng
như một seam, không mô tả chúng.

> - Chuỗi trong backtick là **nguyên văn** code phát ra hoặc đọc — không dịch.
> - Tài liệu này mô tả **bất biến**, không chứa số đo. Số liệu (test count, thời gian, cost) lấy bằng
>   cách chạy, không đọc ở đây. Hằng số có tên được gọi bằng **tên**, không bằng giá trị.

---

## 1. SSE truyền gì

`connectSSE(taskId, handlers)` mở `GET /api/tasks/:id/stream` — **một task một stream** — và trả về một
closure teardown. Năm event:

| event | payload | store làm gì |
|---|---|---|
| `init` | `{reconnected: boolean}` | **bỏ payload**, fetch `GET /api/tasks/:id` |
| `task:update` | `WireTask` đầy đủ | `applyTask` |
| `phase:output` | `{phase, text}` | `applyOutput` (gộp theo rAF) |
| `ask:answer` | `{text}` | `applyAskAnswer` (gộp theo rAF) |
| `ask:card` | YAML report card (spec 082 S3 — kiểm tra máy trên file YAML user đưa vào chat: lint + preflight fold vào seed, không LLM) | render card trong thread |
| `ask:done` | `{ok, anomaly?, seededFrom?}` | `applyAskDone` |

Header comment của `sse-client.ts` ghi *"three events: init · task:update · phase:output"*. Code nghe
**năm** — hai event Ask thêm sau, comment không theo.

Reconnect nằm hoàn toàn ở client: `onerror` → `onDisconnect` → `close()` → hẹn giờ
`reconnectDelay * (0.7 + Math.random() * 0.6)`, rồi trong callback `reconnectDelay = Math.min(reconnectDelay * 2, 30000)`
trước khi `connect()` lại. `onopen` reset delay về đáy. **Không có trần số lần thử** — server chết là
thử lại vô hạn, `connected` ở `false`.

## 2. `Last-Event-ID` không bao giờ rời khỏi client

Đây là thứ chịu lực của toàn bộ hành vi reconnect, và nó **không** hoạt động như phía server tưởng.

`plugins/sse.ts` giữ một `RingBuffer` và replay các event đã lỡ theo header `Last-Event-ID`. Nó **loại**
`phase:output` và `ask:answer` khỏi buffer (high-volume), và **cố ý giữ** `task:update` cùng `ask:done`
để replay được — comment tại `plugins/sse.ts:90-93` nói đúng ý định đó.

Ý định ấy không tới đích. `connect()` dựng **một object `EventSource` mới** mỗi lần thử lại
(`onerror` → `close()` → `eventSource = new EventSource(...)`). Theo spec HTML, *last event ID string*
thuộc **từng object** `EventSource`; một object mới bắt đầu rỗng, nên **không gửi header**. Server đọc
`lastEventId = 0` → `reconnected = false` → **nhánh replay không bao giờ chạy**.

Đo được, không phải suy luận: dựng một SSE server phát `id: 42` rồi ngắt kết nối. Một `EventSource` để
**tự** reconnect gửi `Last-Event-ID: 42` từ lần thứ hai trở đi. Đúng hình dạng của `sse-client.ts` —
`close()` rồi `new EventSource` — thì **mọi** kết nối, kể cả kết nối lại, đều **không có** header.

Hệ quả, theo từng event:

| lỡ trong lúc mất kết nối | có lấy lại được không |
|---|---|
| `task:update` | **Có.** `onInit` fetch `GET /api/tasks/:id`; `task.json` là thẩm quyền, snapshot lỡ là dư. |
| `phase:output` | **Không.** Không nằm trong buffer, và backend không giữ chat log — đoạn stream đó khuyết vĩnh viễn khỏi run item. |
| `ask:done` | **Không**, dù server **có** buffer nó. |

Nhánh `ask:done` là nhánh đắt nhất. `onInit` bù bằng `applyAskDone({ ok: true })` cho bất kỳ qa item nào
còn mở — để `asking` không kẹt `true` và khoá composer vĩnh viễn. Nhưng nó bù bằng `ok: true`
**vô điều kiện**: một Ask thật sự settle bằng `ok:false` + `anomaly` (backend đã phát hiện và revert file)
sẽ hiện ra thành *"xong, không sao"*, và hộp thoại liệt kê file đã bị revert **không bao giờ hiện**.

`waitingForInit` bỏ mọi event đến **trước** `init`. Vì replay không chạy, và `plugins/sse.ts` đăng ký
client rồi ghi `init` trong **cùng một lượt đồng bộ** (không `await` ở giữa), nên trên đường đi hiện tại
`init` luôn là frame đầu — guard này không còn gì để chặn.

## 3. Store giữ gì

`store.ts` mirror **một** snapshot có thẩm quyền và dựng phần còn lại tại chỗ.

Consult (spec 082) phía FE: sidebar có section **Chat** riêng (GET /api/consults — consult không
vào /api/tree lẫn /api/active); chip **Mode** trên composer nhớ lựa chọn qua localStorage
(`builder.composerMode`, default consult); hai bẫy store đã sửa có comment tại chỗ trong
`store.ts` (`applyTask` early-return cho consult — task born-done đi nhánh gate sẽ đẻ card ma;
guard finalize trong `onInit` gate trên `reconnected` — không thì câu trả lời stream đầu bị vứt).

Cây sidebar (GET /api/tree — server dựng, nửa `artifacts.ts` này chưa có doc chủ, ghi tạm ở đây vì
UI là consumer duy nhất): hàng workflow mang `synthetic: true` là **hàng gom hiển thị, không phải
workflow** — cả bucket `(unsaved)` lẫn hàng orphan-task-trong-project-có-thật (CẢ HAI nguồn, spec
090: nguồn thứ hai nguy hiểm hơn vì mang tên thân thiện + đủ nút edit). Sidebar đối xử: click chỉ
expand (không arm làm base — trước đây một cú click-để-xem đầu độc chip composer thành target ma),
ẩn nút edit/delete của hàng lẫn nút edit trên task con; task con vẫn mở xem được. Field optional —
server cũ không gửi thì mọi hàng hành xử như trước.

| signal | nguồn | sống qua reload? |
|---|---|---|
| `task` | `WireTask` từ SSE / GET | không (fetch lại) |
| `thread` | **chỉ client** — dựng từ transition SSE | có, qua localStorage (§4) |
| `tree` · `seeds` · `active` | GET, best-effort (lỗi → im lặng) | không |
| `settings` | **chỉ client, chỉ RAM** | **không** |
| `connected` · `startError` · `busyHolder` · `asking` · `confirmState` | phù du | không |

computed: `phaseStates` (4 phase từ `task.phase` + `task.status`), `currentPhase`, `busy`.

`busy` chỉ là `status` ∈ `running` \| `scaffolding`. Một Ask **không** đặt status, nên nó **không** lật
`busy` — đó là lý do `asking` phải là signal riêng.

`settings` (`RunSettings`: workflow · confirm · seed · fast · targetProject) **không** được persist.
Comment trong `resetToNew` ghi *"Confirm-mode is a general preference and intentionally persists"* — nó
persist qua **"New task"**, **không** qua reload. Reload là về mặc định.

### 3.1 `rev` guard — `>=` là cố ý, không phải off-by-one

`isFreshSnapshot(t, lastTaskId, lastRev)` trả `false` **chỉ khi** cùng `taskId` **và** `rev` nhỏ hơn
**hẳn**. Phép so sánh là `>=`, không phải `>`.

Đây là chỗ dễ "sửa cho hợp lý" nhất trong file — `>=` đọc như một off-by-one để lọt snapshot bằng tuổi.
Nó không phải. GET làm-giàu-artifact bắn ở gate **mang đúng `rev`** của live update đã kích hoạt nó; siết
thành `>` sẽ drop chính GET đó, và panel spec/yaml **trống suốt cả phase đang chạy** (một phase đang chạy
không bao giờ re-fetch). `store.test.ts` ghim riêng case rev-bằng-nhau.

### 3.2 artifactContents chỉ đi thêm, không đi lùi

Chỉ `GET /api/tasks/:id` mang `artifactContents`; `task:update` và snapshot lạc quan của `/confirm`,
`/reply` thì không. Hai cơ chế giữ panel khỏi trắng:

- `setTaskValue` **mang `artifactContents` cũ theo** khi snapshot mới thiếu (cùng task).
- `graftStaleArtifacts` cứu một GET **cũ-rev** mà guard sắp drop: ghép **chỉ** những field nội dung mà
  state sống đang thiếu, và **không bao giờ** chạm `phase`/`status`/`gate`/`rev`.

Ràng buộc thứ hai là cái giữ cho §3.1 còn nghĩa: nếu graft áp cả snapshot, một gate đã cancel/đã bị thay
sẽ sống lại. "Đơn giản hoá" nó thành `task.value = t` là hỏng đúng bất biến mà guard tồn tại để bảo vệ.

## 4. `thread` — thứ duy nhất không có bản backend

Backend **không giữ transcript nào**. `thread` là `LiveThreadItem[]` dựng hoàn toàn client-side, bốn kind:
`user` · `run` · `gate` · `qa`.

`applyTask` rẽ hai nhánh theo `coarse(status)`:

- **run** (`running`/`scaffolding`): tái dùng run item cuối cùng của phase đó, hoặc mở mới — và quét
  ngược đánh dấu gate chưa resolve phía trên là đã resolve.
- **gate** (mọi status còn lại): đóng run đang chạy (`stopped` khi `cancelled`), rồi **quét ngược** tìm
  gate **cùng phase, chưa resolve** để refresh **tại chỗ**. Quét ngược — không phải nhìn item cuối — vì
  một Ask đẩy `user`+`qa` xuống **dưới** gate card; nhìn item cuối sẽ đẩy ra một gate card thứ hai.

Sau cả hai nhánh, mọi run item **không phải cuối** mà còn `running` bị đóng lại (`running:false`, **không**
`stopped`): builder khoá theo lượt nên chỉ run item cuối được phép sống.

Streaming gộp theo `requestAnimationFrame`. Bất biến bắt buộc: **mọi `applyTask` gọi `flushPendingOutput()`
TRƯỚC** — nếu không, text đã buffer sẽ mất ở ranh giới run→gate. `flushPendingOutput` tìm run item **theo
phase** (không phải "item cuối nếu đang chạy") và xoá key **chỉ khi** đã land; một phase chưa có run item
thì **giữ buffer**, không drop.

### 4.1 Persist

localStorage, best-effort, mọi truy cập bọc `try/catch` — quota đầy / private mode → không persist, không
vỡ UI. Ba key thuộc doc này: `builder.thread.<taskId>` · `builder.thread.index` (LRU, trần `THREAD_MAX`) ·
`builder.lastTask`.

- `serializeThread` — **giữ** `run.output` nhưng cắt theo `RUN_OUTPUT_CAP`, **giữ phần đuôi** (kết quả
  cuối stream ra sau cùng); **bỏ** `gate.snapshot.artifactContents` (fetch lại được).
- `hydrateForReopen` — **bỏ** mọi gate **chưa resolve** và finalize mọi run còn `running`. Gate sống DUY
  NHẤT đến từ `applyTask` tươi; giữ lại gate cũ sẽ render nút bấm ma cho phase build đã đi qua.
- Ghi debounce, cộng một **max-wait** `PERSIST_MAX_WAIT_MS`: stream liên tục reset debounce mãi mãi
  (starvation), nên quá hạn thì ghi thẳng.
- `pagehide` + `beforeunload` → `persistThreadImmediately`: huỷ debounce, **flush buffer rAF trước**, rồi
  `localStorage.setItem` đồng bộ.

## 5. Race

**Reload giữa stream.** `pagehide` flush + ghi đồng bộ. Lúc load, `restoreLastTask` đọc `builder.lastTask`,
**pre-check bằng `getTask`** rồi mới `openTask` — id chết degrade **im lặng** về màn hình rỗng (gọi thẳng
`openTask` sẽ chạy `catch → surfaceError`, nháy banner lỗi mỗi lần load). `openTask` phục hồi thread đã
persist, `applyTask` cấp gate sống tươi, `openStream` nối lại. Đoạn `phase:output` rơi vào cửa sổ reload
thì mất (§2).

**Tab đóng giữa build.** Backend chạy tiếp — dispatch là fire-and-forget, `auto` mode không cần client.
Mở lại: thread từ localStorage + gate tươi từ GET. Không có run item nào kẹt spin (`hydrateForReopen`).

**Task chết / server chết.** SSE `onerror` → `connected=false` → backoff vô hạn. `onInit` sau đó fetch
lại; nếu task biến mất, `.catch(() => {})` nuốt lỗi và view **giữ nguyên state cuối** — không banner,
không đổi gì. Một turn chết giữa phase thì backend đặt `status:'error'` và gửi `task:update` → gate card
lỗi với nút retry.

**Đổi task giữa một Ask.** `openTask` và `resetToNew` đều đặt `asking = false`; Ask sống thuộc stream cũ,
không được để khoá composer của view mới. `resetToNew` còn reset `_appliedTaskId`/`_appliedRev` — thiếu
bước đó, mở lại một build có `rev` cũ hơn sẽ bị `isFreshSnapshot` drop và thread trắng.

**Va lượt.** Mọi action bọc `surfaceError`: `ApiError` 409 kèm `holder` thì bơm `busyHolder` để UI mời
"mở nó"; lỗi khác chỉ là message. `start`/`reply`/`ask` trả `false` (không throw) để composer giữ nháp.

## 6. i18n — ba tầng, ba cơ chế, ba mức an toàn

`lang` là signal + localStorage key `lang`, mặc định `en`. Đọc `lang.value` trong `t`/`tf`/`tAction`/
`localizeNotes` khiến component gọi nó **tự subscribe** → toggle là re-render, không reload.

### 6.1 `t(key)` / `tf(key, params)` — dịch theo key

`t` = `DICT[l][key] ?? EN[key] ?? key`. Thiếu key JA → **rơi im lặng về tiếng Anh**. EN và JA hiện có
**cùng tập key**, nhưng không gì gác điều đó (§9).

`tf` thay `{placeholder}`; replacement là **function** nên giá trị chứa `$` (tên task, path) được chèn
nguyên văn, không bị hiểu là pattern `$&`/`$1` của `String.replace`.

### 6.2 `tAction(label)` — dịch nhãn tiếng Anh do server phát

Gate action label do `gate.ts` sinh **bằng tiếng Anh** và tới renderer như display string. `ACTION_JA`
map **theo chính text tiếng Anh** đó (`id` không đủ: `continue`/`changes` khác nghĩa theo phase). Không
khớp → **đi thẳng qua**.

Mọi label `CONFIRM`/`REPLY`/`CANCEL` của `gate.ts` hiện **đều** có entry. Nhãn `resolved` do **chính
store** sinh thì không đồng đều:

| nhãn | sinh ở | có trong `ACTION_JA`? |
|---|---|---|
| `Continued` · `Cancelled` · `Requested changes` | `resolveLabel` / `reply` | có |
| `Restored` | `restore()` | **không** → user Nhật đọc `Restored` |
| `Done` · `Errored` | nhánh trong `resolveLabel` | **không** — nhưng **không tới được** (xem dưới) |

`resolveLabel` mở đầu bằng ba nhánh `done`/`error`/`cancelled`, nhưng call site **duy nhất** của nó
(`store.ts:245`) nằm trong `if (coarse(t.status) === 'run')` — tức `status` chỉ có thể là `running` hoặc
`scaffolding`. **Ba nhánh đó không tới được**; hàm thực tế luôn trả về nhãn confirm chính hoặc `Continued`.
Ghi ra đây vì đọc `ACTION_JA` sẽ thấy `Done`/`Errored` "thiếu" và muốn thêm vào: thêm là thêm bản dịch cho
code chết. `Restored` mới là thiếu thật.

`liveTest()` là ngoại lệ duy nhất phá khuôn: nó lưu `resolved` bằng `tr('runTestWithWorkflow')` — **đã
dịch sẵn**. Khi `lang` là `ja` nó lưu chuỗi tiếng Nhật, `tAction` không khớp key nên cho đi thẳng, và kết
quả **đúng một cách tình cờ**. Nhưng nhãn đó là chuỗi đông cứng: toggle về `en` thì card vẫn đọc tiếng
Nhật, và `serializeThread` ghi nó vào localStorage nên nó sống qua cả reload. Mọi đường khác lưu **tiếng
Anh** và dịch lúc render.

### 6.3 `localizeNotes(notes)` — dịch theo frame, và đây là hợp đồng chịu lực

`report.json.notes` là **một chuỗi** ráp backend-side từ một tập câu tiếng Anh cố định (`report.ts` +
`slugNote`/`patternAdvisory`/`preflightNote`/`probeVerdict`/`toolInstallNote`/duplicate warning), rồi tới
renderer nguyên khối. Câu nào xuất hiện, và slug/URL/path nội suy trong đó, thay đổi theo từng build —
nên không map được bằng một label cố định như `ACTION_JA`.

`localizeNotes` vì thế là một danh sách `[RegExp, string]` (`NOTE_JA`) chạy `String.replace` lần lượt:

- `lang !== 'ja'` → trả nguyên chuỗi.
- Mỗi frame khớp thì thay; **capture group giữ nguyên văn** định danh nội suy (slug, path, tên env var,
  tên module, đuôi lỗi Dify nguyên văn).
- **Text không khớp frame nào ĐI THẲNG QUA bằng tiếng Anh.** Không throw, không log, không đánh dấu.

Đó chính là hợp đồng mà `readiness-and-plugins.md` §7 và `turn-and-sandbox.md` §2.1 đều **phụ thuộc** khi
nói các chuỗi của chúng "wording-stable": chúng đúng **chỉ khi** mọi chuỗi tới đây đều có frame. Cơ chế
pass-through nghĩa là vi phạm hợp đồng **không có triệu chứng nào ở phía dev** — chỉ có user Nhật đọc một
mẩu tiếng Anh giữa câu tiếng Nhật.

**Hợp đồng đó hiện đã vỡ.** Chạy từng chuỗi mà producer thật phát ra qua `localizeNotes` dưới `ja`, các
chuỗi dưới đây đi thẳng qua bằng tiếng Anh — tất cả từ `import.ts`, tức **đường `deploy: 'selfhost'`**:

| chuỗi | sinh ở |
|---|---|
| `created a NEW Dify app (a DUPLICATE): …` | `import.ts` — duplicate warning sau push |
| `ambiguous import — multiple Dify apps are named like "…"; none was attached. …` | `import.ts` |
| `app id not captured — push may have completed; check Dify for the new app` | `import.ts` |
| `import skipped by user (built + linted locally; not pushed to Dify).` | `import.ts` — `finishWithoutImport` |

Cặp duplicate-warning là ví dụ sạch nhất: **cùng một channel**, hai producer. Bản `cloud`/`none`
(`editExistingDuplicateWarning` trong `report.ts`) **có** frame; bản `selfhost` (`import.ts`) **không**.
Không test nào thấy được, vì `notes-i18n.test.ts` chỉ duyệt danh sách chép tay trong chính nó, và danh
sách đó chưa từng có chuỗi nào của `import.ts`.

## 7. Các lib thuần

Tách khỏi component để test được, không giữ state:

| file | nội dung | hằng số phản trực giác |
|---|---|---|
| `gate-foot.ts` | `terminalFootActions` (restore/editAgain/runTest) · `replyButtonKind` | **Restore cố ý KHÔNG đòi `project`/`workflowSlug`** — build from-scratch cancel **trước** scaffold có cả hai là null; AND chúng vào là mất nút Restore. Edit-again thì **có** đòi (cần target thật). **runTest cố ý KHÔNG khoá theo `liveTargets.selfhost`** — hiện luôn để user biết tính năng tồn tại; creds kiểm lúc **click** (`store.liveTest` → message localized) và server re-guard 409. |
| `phase.ts` | `PHASE_LABELS` · `phaseIndex` · `phaseLabelAt` | `phaseIndex` trả `0` cho key lạ; `phaseLabelAt` **clamp** vào `1..N` nên `PHASE_LABELS[-1]` không xảy ra — phase lạ degrade về label đầu, **không throw** (throw ở đây làm trắng cả thread). |
| `promote-visibility.ts` | `canPromoteFromConversation(view, task)` — nút "Promote to pattern" hiện khi (spec 052/85ecfa8) | Hiện ở **`done` HOẶC `awaiting_confirm`+phase `test`** (④ gate), KHÔNG chỉ `done` — main.yml đã final+lint-sạch ở ④, và user lấy yml rồi đi thì không bao giờ tới `done`. **Loại** promote-task (không promote một promote) và build chưa scaffold (`project`/`workflowSlug` null). |
| `markdown.ts` | `renderMarkdownHtml` — escape-by-default, không sanitizer, không `innerHTML` của raw input | Emphasis **chỉ** khớp khi marker kề ký tự **không phải word** — `my_var_name` / `a*b` mà Claude stream liên tục sẽ bị in nghiêng nếu "đơn giản hoá" regex. Code span và anchor được rút ra **sentinel `\x00`** trước, cài lại sau, để pass emphasis/link không phá nội dung bên trong. |
| `diff-parser.ts` | `parsePatch` · `buildSplitRows` · `computeWordDiff` (Myers trên token) | — |
| `crumb.ts` | `wfDisplayName` · `projectDisplayName` · `workflowOptions` · `newTaskCrumb` · `runContextCrumb` | `workflowOptions` sort theo **recency** (`tasks[0].id` là timestamp ms 13 chữ số), không alphabet; `_drafts` bị loại. |
| `dev.ts` | `devMode` · `ls` · `cachePct` · `fmt` · `classify` · `shares` · `diagnose` | `devMode` là flag **runtime** (`?dev=1` + localStorage `builder:dev`), **không** phải `import.meta.env.DEV` — build prod ở `web/dist` có cờ đó `false`, tức cách app thật sự chạy. Đọc **một lần** lúc load module. |
| `slug.ts` | `PROJECT_NAME_RE` · `projectSlug` · `isValidProjectName` | bản sao **thứ hai** viết tay của `sanitizeSlug` (server `state/task.ts`) — xem §9. |
| `attachments.ts` | `ACCEPTED_IMAGE_MIME` · `ACCEPTED_EXT` · `MAX_ATTACHMENTS` · `MAX_ATTACHMENT_BYTES` · `isImageMime` · `isAcceptedFile` · `fileToDataUrl` · `toWire` | bản sao **thứ hai** viết tay của `server/lib/attachments.ts` — xem §9. Ảnh validate theo **MIME**, phi-ảnh theo **đuôi file** (`File.type` không tin được với họ text). |

`ls` (`dev.ts`) là helper localStorage bọc try/catch; **caller của nó nằm ở `components/`** (`DevPanel`,
`RebuildButton`) — ngoài phạm vi doc này, và các key đó không thuộc §4.1.

## 8. Guard ở đâu

| file | phủ |
|---|---|
| `web/src/store.test.ts` | `isFreshSnapshot` (kể cả case rev-bằng-nhau) · guard rev trong `applyTask` · `applyOutput` coalescing + straggler sau run→gate · `artifactContents` giữ/graft · đóng run không-phải-cuối · `resetToNew` reset guard · Ask accumulate/done/double-open · reconnect không nhân đôi gate khi có qa phía dưới · echo terminal không nhân đôi card |
| `web/src/store.persistFlush.test.ts` | `persistThreadImmediately` thắng debounce starvation; wiring `pagehide` |
| `web/src/store.uat040.test.ts` | `start`/`reply`/`ask` trả `false` khi 409 · `restoreLastTask` degrade im lặng · `loadActive` chỉ chạy khi status đổi thật |
| `web/src/store.reply.test.ts` | carve-out text-rỗng chỉ hợp lệ khi `status === 'error'` |
| `web/src/store.createProject.test.ts` · `store.importBase.test.ts` · `store.promote.test.ts` | ba action + shape lỗi inline của chúng |
| `web/src/mappers.test.ts` | `confirmModeWire` ⇄ `confirmModeLabel` round-trip |
| `web/src/lib/thread-persist.test.ts` | `capRunOutput` giữ đuôi · `serializeThread` slim · `parseThread` corrupt→null · `hydrateForReopen` bỏ gate chưa resolve |
| `web/src/lib/gate-foot.test.ts` | `terminalFootActions` cả ba nhánh (gồm: Restore **không** đòi on-disk; runTest **không** khoá theo creds) · `replyButtonKind` chỉ carve-out `id==='retry' && error` |
| `web/src/lib/crumb.test.ts` | `wfDisplayName` · `newTaskCrumb` (EN **và** JA) · `runContextCrumb` · `workflowOptions` sort recency |
| `web/src/lib/phase.test.ts` | `phaseIndex` · `phaseLabelAt` clamp |
| `web/src/lib/markdown.test.ts` | XSS · autolink URL trần · guard emphasis/code · bảng GFM |
| `web/src/richtext.test.ts` | `richText` (helper thuần export từ `components/Chat.tsx`) — autolink URL trần trong bubble chat |
| `web/src/lib/diff-parser.test.ts` | `parsePatch` · `buildSplitRows` · `computeWordDiff` |
| `web/src/lib/dev.test.ts` | `cachePct` · `fmt` · `classify` · `diagnose` |
| `web/src/lib/slug.test.ts` | `projectSlug` khớp **fixture chép tay** từ server (**không** import server — §9) |
| `web/src/lib/notes-i18n.test.ts` | các chuỗi **được liệt kê trong chính test** có frame JA — **không** duyệt chuỗi code thật phát ra |

## 9. Những gì KHÔNG check tự động nào chứng minh được

Đây là ranh giới của mọi kết luận "xanh" ở tầng này.

- **Không gì gác hợp đồng "mọi chuỗi note đều có frame JA"** — hợp đồng mà `readiness-and-plugins.md` §7
  và `turn-and-sandbox.md` §2.1 cùng dựa vào. `notes-i18n.test.ts` duyệt một danh sách chuỗi **chép tay
  trong chính nó**; nó không import gì từ `report.ts`/`runnability.ts`/`import.ts`. Thêm một chuỗi mới mà
  quên frame thì **không test nào đỏ** — `localizeNotes` cho nó đi thẳng qua, và chỉ user Nhật thấy. Một
  hợp đồng chỉ được gác bởi danh sách chép tay = **không được gác**, và §6.3 cho thấy nó **đã** vỡ ở bốn
  chuỗi của `import.ts`. Muốn gác thật phải duyệt từ phía **producer** (export tập chuỗi wording-stable
  rồi assert mỗi cái khớp một frame `NOTE_JA`), không phải từ danh sách chép tay.
- **`tAction` không có test nào.** `ACTION_JA` là danh sách chép tay thứ hai, đối chiếu thủ công với
  `gate.ts`. Nó hiện phủ đủ nhãn của `gate.ts`, nhưng thiếu `Restored` — và không gì phát hiện được cả
  hai điều đó. Thêm một action mới vào `gate.ts` là nút đó hiện tiếng Anh, im lặng.
- **Không gì gác parity EN↔JA của `DICT`.** `t()` fallback `?? EN[key]`, nên một key JA thiếu **không**
  báo lỗi — nó hiện tiếng Anh. Hai dict hiện cùng tập key; điều đó do người giữ, không do test.
- **`sse-client.ts` không có test nào.** Backoff, jitter, `waitingForInit`, teardown closure, và việc
  `close()` + `new EventSource` làm chết đường replay (§2) — không dòng nào được gác. Sửa transport ở đây
  là sửa mù.
- **Không cái nào ở §2 được gác** — cả việc `ask:done{ok:false, anomaly}` mất trong một reconnect rồi
  settle thành `ok:true`. Kết luận đó đến từ đọc code cộng một probe `EventSource`, **không** từ test nào
  trong repo.
- **Probe `Last-Event-ID` chạy trên `EventSource` của node/undici, không phải browser thật.** Cùng spec
  HTML, và hành vi quan sát được khớp spec ở cả hai nhánh (tự-reconnect gửi header; object mới thì không).
  Nhưng render thật là browser — chưa ai xác nhận bằng một lần mất mạng thật trên `Chat.tsx`.
- **Không test nào chạy trong browser thật.** Suite chạy jsdom: `requestAnimationFrame`, `pagehide`,
  `EventSource`, và quota `localStorage` đều là giả hoặc vắng. Đường persist "best-effort" khi quota đầy
  **chưa từng được chạy** — chỉ có `try/catch` bao quanh nó.
- **Render tiếng Nhật trong UI chưa ai chứng minh.** `localizeNotes` chạy phía browser;
  `notes-i18n.test.ts` chấm **chuỗi trả về**, không phải pixel — cùng ranh giới mà
  `readiness-and-plugins.md` §11 đã nêu.
- **`attachments.ts` (web) là bản sao thứ hai viết tay** của `server/lib/attachments.ts`
  (`ACCEPTED_IMAGE_MIME`, `ACCEPTED_EXT`, `MAX_ATTACHMENTS`, `MAX_ATTACHMENT_BYTES`), và **không test nào
  so hai bên** — bản web thậm chí không có test nào cả. Hai bên hiện khớp. Nới cap ở server mà quên web
  thì composer từ chối file server sẵn sàng nhận; siết ở server mà quên web thì user chọn được file rồi
  ăn 400. Đúng tiền lệ `linters.ts` ↔ `promote_gate.py:41` (`templates-and-promotion.md` §8).
- **`slug.ts` cũng vậy, và test của nó gác nhầm chiều.** Comment trong `slug.ts` nói *"A shared fixture
  test (slug.test.ts) pins the agreement"* — **fixture không shared**: `slug.test.ts` **hard-code** output
  của server thay vì import `sanitizeSlug`. Nó ghim client↔fixture, **không phải** client↔server. Đổi
  `sanitizeSlug` ở server thì test vẫn xanh, và preview folder trong modal bắt đầu nói dối.
- **`store.ts` chỉ được gác ở phần thuần.** Mọi action (`start`/`confirm`/`reply`/`cancel`/`restore`/
  `liveTest`/`openTask`/…) chạy với `api` giả; **không** có test nào chạy store với server thật, nên
  không gì bắt được lệch shape giữa `types.ts` (`Wire*`) và cái server thật phát ra.
- **Không test file nào nằm trong `components/`** — ngoại lệ duy nhất là helper thuần `richText`
  (export từ `Chat.tsx`, được `web/src/richtext.test.ts` phủ autolink); phần còn lại của tầng
  component — và `App.tsx`/`Chat.tsx`, nơi mọi thứ trên đây thật sự hiện ra, gồm `tAction(resolved)`
  ở `Chat.tsx:476` (seam khiến §6.2 quan trọng) — **không có test**. Chúng cũng **chưa có doc sở
  hữu**.
- **`markdown.ts` an toàn XSS bằng escape-by-default, không phải sanitizer.** `markdown.test.ts` phủ các
  vector đã biết; không gì chứng minh nó phủ vector chưa biết. Thêm một pass regex đọc raw input là bỏ
  qua bất biến này mà test hiện có không nhất thiết bắt được.
