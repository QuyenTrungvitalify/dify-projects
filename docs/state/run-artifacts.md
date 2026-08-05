# Hiện trạng — artifact của một run

Một run để lại gì trên đĩa, bản export chứa gì, và vì sao không cái nào được phép làm hỏng một build.

Phạm vi: `run-events.ts` · `run-transcript.ts` · `dossier.ts` · `bundle.ts` · `zip.ts` · `unzip.ts` · `cost.ts` ·
`cost-cause.ts` · `build-info.ts` · `criteria.ts` · `diff.ts` · `reveal.ts` ·
`server/lib/attachments.ts` · `server/lib/office-text.ts` · **một phần** `artifacts.ts` — chỉ nửa đọc-artifact
(`readArtifactContents` · `specPathFor` · `workflowPathFor`).

> **Nửa còn lại của `artifacts.ts` chưa có chủ**: `buildTree` · `listActiveTasks` · `readNestedScalar`
> cùng các helper riêng của chúng (`projectDisplayName`, `workflowDisplayName`, `relTime`, `taskTitle`,
> `isReservedProjectEntry`). Đó là cây sidebar — chủ đề của nó là điều hướng trên `projects/`, không
> phải thứ một run để lại. Doc này **trỏ** vào `relTime` làm bằng chứng ở §2 nhưng **không sở hữu** nó.
> `web/src/lib/attachments.ts` cũng không thuộc doc này — **`ui-surface.md` §7 sở hữu** nó (bản sao thứ
> hai viết tay của cap ở `server/lib/attachments.ts`; không test nào so hai bên — `ui-surface.md` §9).

> - Chuỗi trong backtick là **nguyên văn** code phát ra hoặc đọc — không dịch.
> - Tài liệu này mô tả **bất biến**, không chứa số đo. Số liệu (test count, thời gian, cost) lấy bằng
>   cách chạy, không đọc ở đây.

---

## 1. `apps/builder/.runs/<taskId>/` chứa gì

Mỗi file sinh ở đúng một chỗ. Không file nào bị ghi đè giữa các phase trừ khi ghi rõ dưới đây.

| file | sinh ở | ghi chú |
|---|---|---|
| `task.json` | `createTask`, trước ① | state machine đọc/ghi liên tục; không phải artifact một lần |
| `uploads/<i>_<name>` | POST create / reply, **trước** khi turn chạy | bytes user gửi; index **cộng dồn**, không ghi đè |
| `events.jsonl` | từ `phase_start` của ① trở đi | append-only, một dòng một transition |
| `transcripts/<phase>.md` | mỗi **attempt** của ①②③ | append, không ghi đè — error→retry giữ **cả hai** block |
| `SPEC.md` | ② **chỉ khi chưa scaffold** | có slug rồi thì SPEC.md nằm ở `projects/<project>/<slug>/`, không ở đây |
| `analyze.json` | ① | |
| `criteria.json` | **verify** của ② | luôn ghi, kể cả `{"criteria":[]}` |
| `diff-base.yml` | trước ③, **chỉ** build edit-existing | idempotent — chụp đúng một lần, `/reply` không chụp lại |
| `workspace.json` | trước **mỗi** spawn ③ | nội dung: `readiness-and-plugins.md` §5 sở hữu |
| `preflight.json` | verify của ③ | phân loại: `readiness-and-plugins.md` §6 sở hữu |
| `diff.json` | sau verify ③ **thành công** | `{path, diff}`; luôn tính lại, không cache |
| `report.json` | ④ | nội dung + `notes`: `readiness-and-plugins.md` §7 sở hữu |
| `promote/<slug>.yml` | build `kind: 'promote'` | |
| `promote/notes.json` | build promote (`promote.ts`) | sidecar rules của distill turn — `templates-and-promotion.md` sở hữu |
| `seed.yml` | prelude edit-existing (`localEditSeed`, `scaffold.ts:161`) | snapshot local seed → `task.seedPath`; nửa seed **vô chủ** (README) |
| `deploy.yml` | đường live, `deployWithModel` (`dify-io.ts`) | bản sao tạm inject-model — `dify-io.md` §4 sở hữu |
| `.ask-anomaly-before.tmp` | Ask lớp 2 (`ask.ts:99`) | temp staging cho diff anomaly — `turn-and-sandbox.md` §5 sở hữu |

Bốn file cuối do module **ngoài Phạm vi** doc này ghi (trỏ sang chủ của chúng), và **không** nằm trong
`RUN_ARTIFACTS` — tức bundle lặng lẽ loại chúng, đúng cái cảnh báo danh-sách-chép-tay ở §8.

`workflowDir(task)` null ⇒ chưa scaffold. `specPathFor` là **nguồn duy nhất** quyết định SPEC.md nằm ở
đâu, và cả `GET` lẫn `PUT /api/tasks/:id/spec` đều đi qua nó — nên một lần sửa tại gate round-trip về
đúng chỗ Implement đọc lại.

## 2. `taskId` **LÀ** thời điểm fire — hằng số phản trực giác

`taskId` là chuỗi 13 chữ số = `Date.now()` lúc `createTask` (`mintTaskId`, `state/task.ts`). **Không có field
`createdAt` nào trên `Task`** — id *chính là* dấu thời gian, và ba chỗ đọc ngược nó ra:

- `relTime()` (`artifacts.ts:184-197`) — `Number(taskId)` → tuổi hiển thị ở sidebar;
- sắp xếp newest-first — `Number(b.id) - Number(a.id)`, cả `buildTree` lẫn `listActiveTasks`;
- `isTaskId` (`routes/ui.ts:50`) — `/^\d{13,}$/`, cổng chặn id bịa trước **mọi** truy cập filesystem.

**Đổi sang uuid/nanoid cho "sạch" sẽ phá cả ba cùng lúc**: `relTime` trả `''` (mất tuổi),
sort thành `NaN - NaN` (mất thứ tự), `isTaskId` trả 400 cho **mọi** task (mất luôn bundle + reveal + spec).
`task-id-mint.test.ts` ghim shape `^\d{13}$` trên output `createTask` (nên đổi format sẽ đỏ **một** test),
nhưng không test nào ràng buộc mint với **ba consumer** trên (§11).

Một chi tiết nữa của mint: hai POST trong cùng một millisecond **không** được trùng id (lock khoá theo
taskId), nên `mintTaskId` đẩy `ms = lastTaskMs + 1`. Hệ quả: dưới burst, id có thể **chạy trước** đồng hồ
thật vài ms. Nó là id trước, dấu thời gian sau — đủ chính xác cho tuổi hiển thị, **không** phải nguồn đo
thời lượng. Thời lượng đo bằng `cost` (§6).

## 3. Bất biến chung: **không artifact nào được fail một build**

Đây là hợp đồng của cả nhóm. Nhưng nó **không** được giữ ở một tầng — nó được giữ ở **hai** tầng khác
nhau, và chỉ đọc comment thì không thấy ranh giới đó.

Kiểm bằng cách gọi thẳng từng writer với đích hỏng (thư mục không tồn tại / shape rác):

**Tự nuốt lỗi bên trong** — an toàn với mọi caller:

`logEvent` · `readEvents` · `AttemptRecorder.flush` · `costFromResult` · `collectBuildInfo` ·
`buildDossier` · `buildDossierData` · `buildBundle` · `produceDiff`.

`produceDiff` sống sót là nhờ **`runPython` không ném** — nó trả `{code, stdout, stderr}` (`shell.ts`,
`turn-and-sandbox.md` sở hữu), nên probe python hỏng chỉ ra diff rỗng. Đây là tài sản đi mượn, không
phải guard của `diff.ts`.

**KHÔNG tự guard — chỉ non-fatal nhờ `try/catch` của caller:**

| hàm | guard duy nhất nằm ở |
|---|---|
| `persistCriteria` | `orchestrator.ts:716-720` |
| `writeDiffArtifact` | `orchestrator.ts:579-583` |
| ghi `preflight.json` | `orchestrator.ts:651-665` |

Cả ba đều `writeFile` thẳng vào run dir. Gỡ `try/catch` ở orchestrator, hoặc gọi chúng từ một call site
mới mà quên bọc, thì **artifact quan sát sẽ fail chính cái build nó đang quan sát**. Docstring của
`persistCriteria` có nói ra điều này (*"Caller wraps this so a failure is non-fatal"*); `writeDiffArtifact`
thì **không** nói.

`saveAttachments` (hai call site trong `routes/tasks.ts` — `POST /api/tasks` và `/reply`) là ngoại lệ theo kiểu khác: nó **cũng** ném, và
cũng chỉ được caller bọc — nhưng nó chạy **trước** `acquireTurn`, nên lỗi của nó là `500` khi **chưa có
build nào tồn tại** để mà hỏng.

Nhánh export (`bundle.ts` · `zip.ts` · `reveal.ts` · `dossier.ts`) nằm ngoài đường build hoàn toàn — chúng
treo dưới route đọc, lỗi thành `500`, không turn nào đang chạy.

## 4. Timeline — `events.jsonl`

Append-only JSONL, một dòng một transition: `{ts, phase?, kind, detail?}`. Đọc live giữa lúc build chạy
chỉ thấy một prefix — đó là chủ ý, không phải lỗi. `detail` bị `oneLine()` ép về một dòng (`\n` → ` ⏎ `)
rồi cắt còn `2000` ký tự, nên một paste khổng lồ ở "Request changes" không làm vỡ format một-dòng-một-event.
`readEvents` **bỏ qua dòng cuối rách** (crash giữa lúc append) và giữ nguyên các event trước đó.

`RunEventKind` khai **7** loại. **6** loại thật sự được phát ra, tất cả từ `orchestrator.ts`:

| kind | phát ở | detail |
|---|---|---|
| `phase_start` | `:400` | `'fresh'` \| `'resume'` \| `'reply'` |
| `gate_reached` | `:304`, `:848` | cờ gate, hoặc `'done'` |
| `gate_action` | `:133` | action id |
| `request_changes` | `:231` | **văn bản user gõ** |
| `retry` | `:231` | văn bản user gõ (nhánh `status === 'error'`) |
| `error` | `:298`, `:812` | `task.error` |

**`live_test` là nhánh chết.** Nó được khai (`run-events.ts:22`) và được `dossier.ts:157` render thành
`- ④ live-test…`, nhưng **không call site nào trong toàn repo phát ra nó** — grep `live_test` trên
`server/` + `web/src/` + `test/` chỉ trúng đúng hai dòng định nghĩa/render đó. Mục `## Flow` của dossier
**không bao giờ** hiện verdict live-test.

`phase_start` phân biệt `'reply'` với `'resume'` theo `opts.replyText` chứ không theo `opts.resumeId`, nên
một `/reply` có resume vẫn ghi `'reply'`.

## 5. Transcript — `transcripts/<phase>.md`

Một block markdown cho **mỗi attempt**, append. Header nguyên văn:
`## <num> <Label> — attempt <n> · resume=yes|no · <ISO ts> · outcome: completed|ERROR`.
Bốn section: `### Prompt (sent to claude)` · `### Assistant output` · `### Tool calls` · `### Result`.

Hai cap **cắt ngược chiều nhau**, và đó là chủ ý:

- `PROMPT_CAP` giữ **đầu** — phần framing của phase / mở đầu change-request nằm ở đó;
- `OUTPUT_CAP` giữ **đuôi** — lỗi lộ ra ở cuối stream.

`AttemptRecorder.onText` chỉ giữ cửa sổ đuôi trong bộ nhớ, nhưng đếm riêng `receivedLen`, nên marker
`[… N chars truncated …]` báo số **thật**, không phải số của cửa sổ đã cắt.

`parseToolStats` đọc **ngược** chính format mà `render` phát ra, và chỉ quét bên trong section
`### Tool calls` — nên một dòng `- ` nằm trong fence của prompt/output không bị đếm nhầm. Parser và
renderer cố tình đặt cùng file để không trôi khỏi nhau.

Hai callback nóng đều không thể làm hỏng turn: `onText` được orchestrator bọc `try/catch`
(`orchestrator.ts:501-505`), `onEvent` được **turn-runner** bọc (`turn-runner.ts:137-143`) — hai chỗ khác
nhau, mỗi chỗ một lý do.

## 6. Cost — đo từ đâu

`costFromResult` đọc **event `result` cuối cùng** của stream-json mà `claude` trả về, không tự bấm giờ.
Mọi field đi qua một guard số hữu hạn:

| `PhaseCost` | nguồn |
|---|---|
| `durationMs` · `apiDurationMs` · `numTurns` · `totalCostUsd` | `duration_ms` · `duration_api_ms` · `num_turns` · `total_cost_usd` |
| `inputTokens` · `outputTokens` · `cacheReadTokens` · `cacheCreationTokens` | `usage.{input,output,cache_read_input,cache_creation_input}_tokens` |
| `model` | key đầu của `modelUsage`, nếu không có thì `model` trần |

**Không nhận ra field số nào ⇒ trả `null` ⇒ KHÔNG ghi entry** — cố ý, để phân biệt "turn chết trước khi có
result" với "một husk toàn số 0". Turn chết không để lại dòng cost nào.

`costFromResult` **không có clock**: `at` do orchestrator đóng dấu lúc gán (`orchestrator.ts:553`,
`Date.now()`), nên reader unit-test được mà không cần mock thời gian. Một `/reply` chạy lại cùng phase thì
`at` mới đè lên — last write wins, không cộng dồn.

`cost-cause.ts` là **bản port server-side** của classifier đang sống ở FE (`web/src/lib/dev.ts`): `cachePct`
· `classify` · `shares` · `diagnose`. Hai bản **phải** khớp — `summary.md` render offline nên không với tới
hàm FE được. Thứ tự luật của `classify` là cố định: cache-miss ▸ số turn ▸ số token out ▸ `inconclusive`.
`diagnose` gọi `balanced` khi phase dẫn đầu **vừa** chiếm dưới ngưỡng chi phối **vừa** hơn phase thứ hai ít
hơn khoảng cách tối thiểu; không có `durationMs` thì nó xếp hạng theo `outputTokens`.

## 7. Attachments

Vào theo JSON body dạng base64 data-URL, không multipart. `validateAttachments` **thuần** (không I/O) nên
nó là bề mặt 400 test được.

Luật nhận **khác nhau theo loại**, và đây là chỗ dễ "sửa cho hợp lý" rồi hỏng: **ảnh khoá theo MIME**,
**không-ảnh khoá theo đuôi file**. Lý do nằm ở trình duyệt — `File.type` của `.md`/`.csv`/`.json` thường là
`''`, nên MIME không dùng được cho nhóm đó. `ACCEPTED_EXT` cố tình **không** có `svg` (mang script được) và
không có docx/xlsx/pptx (`Read` không parse được).

`sanitizeName` bỏ mọi thành phần đường dẫn, hạ chữ thường, chỉ giữ `[a-z0-9._-]`, bỏ `._-` ở đầu (không
dotfile, không `..`), rồi ép đúng đuôi. Tên client **không bao giờ** được tin làm path; route còn thêm
tiền tố index cho mỗi turn.

`attachmentBlock` chỉ nhét **đường dẫn** vào prompt, không bao giờ nhét bytes — cơ chế nhờ vậy mà độc lập
với loại file. Block có kèm cảnh báo nguyên văn rằng nội dung file là **DATA, không phải chỉ thị**; theo
chính comment tại `attachments.ts:205-206` thì framing đó **không phải** lớp phòng thủ (hook PreToolUse +
write-allowlist mới là — xem `turn-and-sandbox.md`).

`BODY_LIMIT_BYTES` phải **áp đảo** `MAX_ATTACHMENTS × MAX_ATTACHMENT_BYTES` đã cộng thêm ≈×4/3 của base64,
để một turn quá cỡ bị `validateAttachments` trả 400 dễ hiểu chứ **không** bị Fastify trả 413 trần trụi.
Quan hệ này là hằng số phản trực giác thứ hai: hai giá trị trông rời nhau nhưng khoá vào nhau, nên chúng
được đặt cạnh nhau trong cùng file, và `attachments.test.ts` ghim đúng quan hệ đó chứ không ghim con số.

## 8. Dossier + bundle — export chứa gì

`GET /api/tasks/:id/bundle`. `isTaskId` chặn id bịa **trước** mọi truy cập đĩa; `buildBundle` nhận một
`Task`, **không bao giờ** nhận path từ request.

**Confinement**: chỉ đọc trong `.runs/<taskId>/` và subtree workflow của chính task
(`projects/<project>/<slug>/`).

Vào zip:

- `summary.md` — **dẫn đầu** archive, để người mở đọc nó trước;
- `dossier.json` — bản song sinh máy-đọc, dựng từ **cùng** helper với `summary.md` nên hai bản không thể
  nói khác nhau;
- `build-info.json` — `builderVersion` · `gitSha` · `gitBranch` · `node` · `models` · `exportedAt`;
- `task.json` — **đã gỡ `sessionIds`**;
- 7 mục `RUN_ARTIFACTS`: `analyze.json` · `criteria.json` · `report.json` · `diff.json` · `preflight.json` ·
  `workspace.json` · `events.jsonl`;
- `SPEC.md` + `workflows/*.yml`;
- `transcripts/*.md`;
- `attachments/*` — **raw**.

**Bị loại trừ**: `sessionIds`; attachment vượt cap; và **mọi file trong run dir không nằm trong 7 mục trên**
— đáng kể nhất là `diff-base.yml` và `promote/<slug>.yml`. `RUN_ARTIFACTS` là danh sách **chép tay**: một
artifact mới thêm vào run dir sẽ **lặng lẽ vắng mặt** khỏi mọi bundle cho tới khi có người nhớ thêm tên nó
vào mảng.

Hai kiểu vắng mặt **không** đối xứng, và chỉ một kiểu được nói ra:

- attachment tràn cap → `omittedNote` → in vào `summary.md` (`- omitted: …`) — **không bao giờ im lặng**;
- file ngoài `RUN_ARTIFACTS` → **không có note nào**. Mục `## Files in this bundle` liệt kê đúng những gì
  đã đóng gói, nên thứ thiếu là vô hình.

### Redaction áp ở đâu

Mọi entry **text** đi qua `redactSecrets` ngay tại helper `text()` của `bundle.ts` — một seam duy nhất, nên
không entry text nào lọt. `attachments/*` **cố ý** không qua đó (redact bytes sẽ làm hỏng file nhị phân).
`summary.md` được redact riêng một lần nữa lúc đưa vào `zipStore`. Transcript đã redact lúc ghi rồi, redact
lại là idempotent.

Hàm `redactSecrets` thuộc [`dify-io.md` §3](dify-io.md) — doc này **không mô tả lại** nó. Nhưng doc đó mô
tả nó ở vai **bọc `stdout`/`stderr` của `runSyncPy`**; bundle là **consumer thứ hai**, với threat model
khác hẳn, và hệ quả cho bản export là của doc này:

**Redaction khoá theo CREDENTIAL, không theo pattern.** Nó scrub những gì đang được set làm creds — chứ
không phải "thứ trông giống secret". Với `runSyncPy` thì đủ (mọi thứ trong stdout đều bắt nguồn từ chính
creds đó). Với bundle thì **không**: transcript mang prompt **user gõ**, mà user không gõ token của Dify —
họ dán token của bên thứ ba. Xem §11.

### `summary.md` gồm những gì

`buildDossier` **thuần** — chỉ đọc thứ được đưa vào, mọi field đều optional-guard, nên một run dở dang vẫn
ra dossier mạch lạc và **tự gọi tên phần thiếu**: `status !== 'done'` thì chèn banner
`> ⚠ PARTIAL RUN (status=…)`. Thứ tự section: intent → result → `## Flow` → `## Acceptance criteria` →
`## Cost & cause (spec 059)` → `## Gaps to improve` → `## Process — attempts & steering` → `## Graph (DSL)`
→ `## Files in this bundle`.

> Heading cost render **nguyên văn** `## Cost & cause (spec 059)` — số spec đã chết nhưng vẫn nằm trong
> chuỗi code phát ra, nên nó được chép đúng ở đây, không phải một tham chiếu sống.

`runnable` trong `summary.md` và trong `dossier.json` **không cùng miền giá trị**: bản markdown là nhị phân
(`task.preflightNote` có/không), bản JSON có ba trạng thái (`false` / `true` khi `status === 'done'` /
`null` khi đang chạy). Cùng một chữ, hai ngữ nghĩa.

`matchedAcceptance` khớp criterion với verdict của judge bằng **so khớp chuỗi đã trim**. `criteria.json`
nhận **cả hai** shape: mảng string trần (shape thật, đã đối chiếu một bản export sống) và mảng `{criterion}`.
`stripLabel` gỡ nhãn `preflight:`/`probe:`/`import-probe:` mà note tự mang, vì hàng Gaps đã tự thêm nhãn rồi.

## 9. zip tự viết, không dependency

`zipStore` phát **store-only, không nén**: local file header + CRC32 + central directory + EOCD. Payload là
text nhỏ + vài attachment; deflate lợi ít mà thêm rủi ro, nên không có `archiver`.

**Thuần + tất định — không clock**: `DOS_DATE = 0x0021` / `DOS_TIME = 0x0000` (1980-01-01 00:00) đóng cứng.
Hằng số này **phản trực giác** theo hai nghĩa, và cả hai đều là lý do không được "sửa cho đúng giờ thật":

1. tất định là **tính năng** — cùng entry luôn ra cùng bytes, nên test round-trip không phải mock thời gian;
2. `1980` là **epoch của DOS**, giá trị hợp lệ **nhỏ nhất** — field year đếm từ 1980, nên không encode được
   ngày sớm hơn kể cả khi muốn.

Thời điểm export **không** mất: nó nằm ở `build-info.json.exportedAt`, do caller đóng dấu.

`FLAG_UTF8 = 0x0800` (bit 11) để path không-ASCII round-trip. Kiểm bằng cách chạy `zipStore` rồi đưa buffer
qua `unzip -t` của hệ thống: archive hợp lệ, extract lại đúng từng byte cho cả text lẫn nhị phân, và
archive rỗng ra đúng một EOCD 22 byte mà `unzip` nhận là archive rỗng chứ không phải rác.

## 10. Guard ở đâu

| file | phủ |
|---|---|
| `apps/builder/test/zip.test.ts` | `unzip -t` chấp nhận; extract lại đúng từng byte (text **và** nhị phân); **sửa một byte data → `unzip -t` FAIL** (CRC thật sự được kiểm); archive rỗng là EOCD hợp lệ |
| `apps/builder/test/bundle.test.ts` | `sessionIds` bị gỡ; `Bearer` bị redact trong `report.json`; wiring route (200/`application/zip`/tên file tải về); id bịa → 400, task không có → 404; **cap tràn thì `summary.md` PHẢI nói ra**; `build-info.json` + `dossier.json` |
| `apps/builder/test/dossier.test.ts` | đủ section trên run `done`; verdict judge → ✓/✗; run lỗi vẫn ra dossier mạch lạc; **không ném với input rỗng/dị dạng** |
| `apps/builder/test/run-events.test.ts` | append→đọc lại đúng thứ tự; detail nhiều dòng ép về một dòng; **ghi vào dir không tồn tại KHÔNG ném**; file thiếu → `[]`; dòng cuối rách bị bỏ, event trước sống |
| `apps/builder/test/run-transcript.test.ts` | render block; prompt được redact; output cắt **đuôi**; **hai attempt APPEND vào cùng file**; `parseToolStats` round-trip + bỏ qua `- ` ngoài section; **flush vào path không ghi được KHÔNG ném** |
| `apps/builder/test/run-capture.test.ts` | wiring thật: một turn ① ghi `transcripts/analyze.md` + `events.jsonl`, **và** SSE broadcast vẫn nguyên |
| `apps/builder/test/cost.test.ts` | result đầy đủ → `PhaseCost` đầy đủ (không có `at`); `null` → `null`; thiếu `usage` → chỉ duration/turns; `model` từ `modelUsage`; **event shape trôi → không ném** |
| `apps/builder/test/cost-cause.test.ts` | parity với `web/src/lib/dev.test.ts` — **cùng bộ vector số** ở cả hai file; thứ tự luật `classify`; `shares`/`diagnose`/`balanced` |
| `apps/builder/test/criteria.test.ts` | `parseAcceptanceCriteria`: dừng ở heading kế; marker số + checkbox; **fence ``` bị bỏ qua** (không sinh criteria ma) |
| `apps/builder/test/attachments.test.ts` | `validateAttachments` (nhận theo MIME cho ảnh / theo đuôi cho phần còn lại); các bề mặt 400; `sanitizeName`; quan hệ `BODY_LIMIT_BYTES` |
| `apps/builder/test/reveal.test.ts` | `revealCommand` theo từng platform; **path có ký tự shell vẫn là một argv element** (không có bề mặt injection) |
| `apps/builder/test/redact.test.ts` | `redactSecrets` với token/URL/origin/`Bearer` **đã set**; và no-creds → text đi qua nguyên vẹn |

## 11. Những gì KHÔNG check tự động nào chứng minh được

Đây là ranh giới của mọi kết luận "xanh" ở tầng này.

- **`diff.ts` KHÔNG có một dòng test nào.** Không test nào tham chiếu `writeDiffArtifact`, `produceDiff`,
  `snapshotDiffBase`, hay `unifiedDiffOfFiles`; không file test nào nhắc `diff.json` hay `diff-base.yml`.
  Mà `writeDiffArtifact` chạy trên **mọi** Implement thành công, và `unifiedDiffOfFiles` là thứ
  `ask.ts:148` dùng để dựng báo cáo anomaly. Toàn bộ nhánh này chỉ được biết là còn sống nhờ chạy tay.
- **Không gì chứng minh bundle sạch secret của bên thứ ba — và hai comment đang nói ngược lại.** Chạy
  `redactSecrets` (hàm: [`dify-io.md` §3](dify-io.md)) trên mẫu nhiều loại: `sk-proj-…`, `xoxb-…`,
  `ghp_…`, `AKIA…` **đều đi qua nguyên vẹn**, có hay không có creds Dify đều thế — chỉ giá trị sau
  `Bearer ` bị scrub. Nghĩa là: user dán Slack bot token vào composer để dựng workflow Slack — kịch bản
  hoàn toàn bình thường — thì token đó nằm nguyên văn trong `transcripts/implement.md` (khối prompt) và
  **đi thẳng vào bundle**, tức vào file người ta gửi cho người khác. Comment ở `bundle.ts:8-9`
  (*"defense in depth — a DSL/report/prompt could echo a pasted token"*) và ở `run-transcript.ts:10-11`
  (*"Redacts the prompt + tool args (they carry {{KNOWLEDGE}} / pasted tokens)"*) đúng **chỉ với token
  của Dify**; đọc theo nghĩa đen thì cả hai hứa nhiều hơn thứ code làm. `redact.test.ts` chỉ kiểm các
  secret **đã được set làm creds**, nên nó không thể phát hiện khoảng trống này. (Ghi nhận, chưa sửa.)
- **Hợp đồng nội dung bundle chỉ được gác bởi danh sách chép tay ⇒ KHÔNG được gác.** `RUN_ARTIFACTS` khai
  7 mục; fixture của `bundle.test.ts` chỉ ghi `criteria.json` · `report.json` · `events.jsonl`. Xoá
  `analyze.json`, `diff.json`, `preflight.json`, hoặc `workspace.json` khỏi `RUN_ARTIFACTS` thì **không
  test nào đỏ** — `bundle.test.ts` không hề nhắc tên bốn file đó. Muốn gác thật thì phải đối chiếu từ phía
  **run dir thật** (liệt kê file thực rồi assert mỗi file hoặc được đóng gói hoặc được nêu là loại trừ có
  chủ ý), không phải từ một mảng chép tay.
- **`live_test` là nhánh chết mà không gì báo.** Kind được khai + được render nhưng không đâu phát ra
  (§4). Không test nào assert tập kind **phát ra** khớp tập kind **khai báo**, nên một kind chết trông y
  hệt một kind chưa gặp trong fixture.
- **Không gì ràng buộc `taskId` với ba consumer của nó.** `task-id-mint.test.ts` ghim shape 13-chữ-số
  trên `createTask` (đổi format không còn hoàn toàn im lặng), nhưng ba consumer (`relTime`, sort
  newest-first, `isTaskId`) đều tự parse lại chuỗi và không test nào nối `mintTaskId` với chúng — hỏng
  linkage vẫn là: sidebar mất tuổi + mất thứ tự, mọi endpoint theo id trả 400.
- **`ATTACHMENT_CAP_BYTES` < `MAX_ATTACHMENTS × MAX_ATTACHMENT_BYTES`.** Cap bundle là 25 MB; một turn hợp
  lệ tối đa là 3 × 10 MB = 30 MB. Nghĩa là một turn **đúng luật** vẫn có thể mất attachment khỏi bundle
  **của chính nó**. `bundle.test.ts` chỉ kiểm cơ chế cap bằng cách ép cap xuống 1 byte, **không** kiểm quan
  hệ giữa hai hằng số — nên khoảng hở này không có test nào chạm tới. (Ghi nhận, chưa sửa.)
- **Nửa sidebar của `artifacts.ts` không có test nào**: không test nào tham chiếu `buildTree`,
  `listActiveTasks`, `readNestedScalar`, `specPathFor`, hay `workflowPathFor`. `readArtifactContents` chỉ
  được `promote.test.ts` chạm, và **chỉ nhánh `kind === 'promote'`** — nhánh build thường (spec/yaml/report/
  diff) không có test nào.
- **`build-info.json` không được đối chiếu với repo thật**: `bundle.test.ts` chạy trong temp dir không có
  `.git` / `package.json`, nên `gitSha` + `builderVersion` chỉ được assert là **có mặt** (được phép `null`).
  Không gì chứng minh chúng mang giá trị đúng khi chạy trong repo thật.
- **Parity `cost-cause.ts` ↔ `web/src/lib/dev.ts` là quy ước, không phải cơ chế.** Hai file test dùng cùng
  bộ vector, nhưng **do người chép sang**. Thêm một luật vào `dev.ts` và một vector mới **chỉ** ở
  `dev.test.ts` thì bản server lệch mà không test nào đỏ. Không có import chung, không có fixture chung.
- **Không gì chứng minh bundle mở được trên Windows.** `zip.test.ts` chạy `unzip` của hệ thống và
  **tự skip khi không có** — nên trên máy thiếu `unzip`, toàn bộ đảm bảo "archive hợp lệ" **im lặng biến
  mất** thay vì đỏ. Bản thân comment của `zip.ts` khẳng định cả Finder lẫn Windows Explorer đều mở được;
  vế Explorer chưa từng được kiểm bằng máy.
- **Không gì chứng minh `summary.md` đọc lên có ích cho người.** Test chỉ khớp regex trên vài dòng. Dossier
  có thật sự giải thích được một build hỏng hay không là phán đoán của người đọc, không phải hằng số.
