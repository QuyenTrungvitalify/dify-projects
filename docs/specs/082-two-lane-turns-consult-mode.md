# Spec 082 — Hai làn turn song song (build ∥ chat) + Consult mode (trao đổi tự do, chưa cần build)

**Status**: Implemented (2026-07-29) — S1 (lock 2 làn + audit 20+ call-site + lock-lanes.test.ts)
· S2 (consult kind + consultWithin + POST /api/consult + GET /api/consults + chip Mode + sidebar
CHATS + graduate) · S3 (YAML card: ask:card SSE + lint/preflight fold vào seed). Test: server
736✓ (consult.test.ts 9✓ mới) · web 209✓ · typecheck sạch · build ✓ · **e2e thật trên browser**:
consult tạo → trả lời stream tiếng Việt → reload giữ transcript → follow-up resume đúng ngữ cảnh
→ graduate distill đúng trạng-thái-cuối cuộc chat + prefill Build mode.
**Quyết định lúc implement** (ngoài các mục đã đánh dấu trong thân spec):
(1) API lock thêm `chatHolderId()` (đối xứng buildHolderId — turnBusyError theo làn + test cleanup);
(2) e2e r2 bắt 2 bug FE spec không lường: `applyTask` phải early-return cho consult (task born-done
đi nhánh gate → đẩy gate card ma "Test passed" vào chat), và guard FIX-H trong `onInit` phải gate
trên `reconnected` (startConsult arm qa TRƯỚC init đầu tiên → guard cũ finalize rỗng + vứt cả câu
trả lời stream). Cả hai sửa trong store.ts, có comment tại chỗ;
(3) card hiển thị tên file GỐC của user (strip prefix `<idx>_` máy thêm của saveAttachments);
(4) chip Mode nhớ lựa chọn qua localStorage (`builder.composerMode`), default consult như đã chốt.
**Còn để ngỏ (không chặn)**: S2b model pin (`BUILDER_CHAT_MODEL`) chưa làm; ask:answer chunk đầu
có thể rớt nếu CLI trả lời trước khi EventSource kịp mở (thực tế cold-start vài giây nên chưa thấy);
2 item lỗi-thời-bug còn nằm trong localStorage thread của chat dev đầu tiên (chat mới không bị).
**Effort**: S1 ≈ M (lock 2 làn + audit call-site + test cancel) · S2 ≈ M (consult kind + FE) ·
S2b ≈ XS (model pin, optional) · S3 ≈ S (YAML card) — tổng ≈ **M–L**, tuần tự S1 → S2 → S3.
**Phụ thuộc**: không có spec nào phải ship trước. Chạm invariant của 009 (§I turn-lock), 033 (Ask
containment), 034 (terminal Ask), 052 (kind delegation) — tất cả được giữ nguyên hoặc mở rộng
có chủ đích, nêu rõ từng chỗ bên dưới.
**Đóng spec**: qua `/spec-close 082`.

---

## 1. Bối cảnh & mục tiêu

Hai vấn đề người dùng thật, một mối nối kiến trúc:

1. **Entry duy nhất hiện nay là "build ngay"** (`POST /api/tasks` → lao vào Analyze). Người muốn
   trao đổi lên ý tưởng, hoặc kéo một YAML vào hỏi "cái này làm gì / ổn không", không có cửa nào —
   phải bịa một requirement để mở build rồi Ask ké ở gate.
2. **Một slot turn toàn cục** ([lock.ts](../../apps/builder/server/lib/lock.ts) `turnHolder`):
   trong lúc build chạy (Implement có thể 10 phút) thì không hỏi gì được ở bất kỳ đâu — 409.
   Ngược lại một câu Ask 3 phút cũng chặn build.

Trải nghiệm đích (đã thống nhất với user):

- **Chat ∥ Build**: tối đa 1 turn chat + 1 turn build chạy đồng thời (2 process `claude`).
- **Build ∥ Build**: vẫn KHÔNG — 1 build một lúc là giới hạn cố ý (quota, tài nguyên, một người
  chỉ review được một gate).
- **Trong cùng một task mọi thứ vẫn tuần tự** — một task tại một thời điểm giữ tối đa 1 turn,
  bất kể loại.
- Consult mode: chat tự do không mint build; kéo YAML vào bàn được; "graduate" thành build khi
  chín — build chạy làn build, cuộc chat vẫn sống làn chat.

## 2. Nguyên tắc

- **Song song chỉ giữa các task, không bao giờ trong một task.** Quy tắc per-task exclusivity là
  cái giữ cho MỌI lập luận an toàn sẵn có (confinement baseline per-turn, FIX-M snapshot của Ask,
  PATCH/PUT-spec clobber guard) đứng nguyên.
- **Làn chat cấm ghi theo cấu trúc, không theo lời hứa.** Mọi turn làn chat đều là `askMode:true`
  → `BUILDER_ASK_MODE=1` → permission-gate deny mọi Write/Edit (033 D3 layer 1). askWithin giữ
  thêm layer-2 snapshot/restore như cũ. Consult theo mẫu askTest: layer-1-only (034 D4 — không có
  artifact đang dở để bảo vệ).
- **Không đụng FSM ①②③④.** Consult là `kind` mới theo tiền lệ 052 (`kind:'promote'` — routes
  delegate trước khi chạm confirmAdvance); orchestrator.ts không đổi hành vi, chỉ đổi tên 1 API
  lock nó gọi.
- **Đổi tên API lock để compiler bắt audit.** `turnBusy()`/`turnHolderId()` bị XOÁ, thay bằng tên
  mới theo làn — mọi call-site buộc phải chọn làn một cách tường minh, không có chỗ nào "quên"
  compile qua được. Bảng phân làn đầy đủ ở §3.3 (đã grep toàn bộ call-site trên code hiện tại).
- **Duplicate-not-share DNA** (ask.ts D8): `consultWithin` là bản chép có sửa của `askTestWithin`,
  không refactor-to-share — đường askTest hiện hành giữ byte-behavior.

## 3. S1 — Lock hai làn (`lock.ts` rework + audit call-site)

### 3.1 Thiết kế

Thay `let turnHolder: TurnHolder | null` bằng hai slot; `kind` hiện có ánh xạ thẳng sang làn —
không cần khái niệm mới:

```ts
// kind 'phase' → làn build (turn ghi file / mutate status: phase, promote, live-test, import)
// kind 'ask'   → làn chat  (turn cấm ghi: askWithin, askTestWithin, consultWithin)
const holders: { phase: TurnHolder | null; ask: TurnHolder | null } = { phase: null, ask: null };
```

`TurnHolder` giữ nguyên shape (taskId, session, kind, cancelRequested).

**API mới** (những cái đổi tên là cố ý — xem §2):

| Hàm | Semantics |
|---|---|
| `acquireTurn(taskId, kind='phase')` | fail nếu `holders[kind]` đang bận **HOẶC** task này đang giữ làn kia (per-task exclusivity). Vẫn `cancelledTasks.delete(taskId)` on acquire như cũ. |
| `releaseTurn(taskId)` | clear đúng làn mà task này giữ (tra cả 2 slot theo taskId; "clear iff matches" giữ nguyên). |
| `buildTurnBusy()` | `holders.phase !== null` — thay cho `turnBusy()` ở các fast-path tạo build/promote. |
| `chatTurnBusy()` | `holders.ask !== null` — mới, cho fast-path /ask nếu cần (acquire vẫn là nguồn chân lý). |
| `buildHolderId()` | taskId của làn build, hoặc null — thay `turnHolderId()` ở guard spawn + evict. |
| `taskTurnRunning(taskId)` | task giữ BẤT KỲ làn nào — thay mọi guard `turnHolderId() === id`. |
| `liveSession / liveKind / setSession / clearSession / requestAskCancel / isAskCancelRequested` | signature giữ nguyên; nội bộ tra 2 slot theo taskId — **không nhập nhằng** nhờ per-task exclusivity (một task không bao giờ giữ 2 làn). |
| `markCancelled / isCancelled / unmarkCancelled / evictCancelled / cancelledCount` | không đổi (cancelledTasks là Set riêng). |
| `reconcileOnBoot` | hành vi giữ nguyên; nội bộ đổi 1 dòng — reset CẢ HAI slot về null (hiện là `turnHolder = null`, lock.ts:164). |

`turnBusyError()` (routes/tasks.ts:75) nhận làn: 409 của route build carry `holder` = build holder;
409 của /ask carry chat holder — FE "open the running build" trỏ đúng thủ phạm.

### 3.2 Vì sao per-task exclusivity là đủ (soát lại từng lớp an toàn)

- **Confinement (#3b)**: comment đầu lock.ts nói invariant single-writer giữ cho `git status`
  baseline-delta sạch. Làn chat **không ghi** (layer 1 deny) → vẫn đúng "at most one build writes
  the tree at a time". Trường hợp layer 1 bị bypass trong một askWithin chạy song song với build
  turn task khác: snapshot roots của Ask (workflowDir(X) + `.runs/X/`) rời khỏi confinement scope
  của build Y (workflowDir(Y) + `.runs/Y/`) → không giẫm nhau. Nếu build Y *breach* confinement
  vào roots của X giữa chừng: restore của Ask revert hộ + báo anomaly (gán nguồn sai nhưng revert
  là đúng hành vi; confinement check của Y vẫn tự bắt breach của nó — double-revert idempotent vì
  cùng ghi lại bytes gốc). Chấp nhận, ghi nhận ở đây để reviewer khỏi phát hiện lại.
- **FIX-M uploads race** (tasks.ts:429-437): guard `/reply` với live Ask cùng task → giữ nguyên
  bằng `taskTurnRunning(id)`. Cross-task: reply Y ghi `.runs/Y/uploads/` — ngoài snapshot roots
  của Ask X.
- **PATCH confirm_mode (tasks.ts:377) + PUT /spec (ui.ts:156)**: phải chặn theo **any-lane**
  (`taskTurnRunning`) chứ không chỉ build — vì `askTurn`/`askTestWithin` cũng `saveTask` (persist
  sessionIds) từ snapshot in-memory, clobber risk 033 đã phân tích áp dụng cho cả ask turn.
- **cancelledTasks**: chỉ orchestrator/promote (làn build) đọc `isCancelled`; ask không bao giờ
  `markCancelled` (033 D9). Evict ở /cancel do đó đổi thành `buildHolderId() !== id`.

### 3.3 Bảng phân làn TOÀN BỘ call-site (grep 2026-07-28, không còn site nào khác ngoài test)

| Call-site | Hiện tại | Sau S1 |
|---|---|---|
| tasks.ts:169 `POST /api/tasks` fast-path | `turnBusy()` | `buildTurnBusy()` — **chat không còn chặn tạo build (điểm ăn tiền)** |
| tasks.ts:210 create acquire | `acquireTurn(task.taskId)` | giữ (default 'phase') |
| tasks.ts:247, 272 `POST /api/promote` fast-path ×2 | `turnBusy()` | `buildTurnBusy()` |
| tasks.ts:257, 274 promote acquire ×2 | `acquireTurn(task.taskId)` | giữ |
| tasks.ts:334 `/confirm` acquire | `acquireTurn(id)` | giữ |
| tasks.ts:377 PATCH guard | `turnHolderId() === id` | `taskTurnRunning(id)` (§3.2) |
| tasks.ts:437 `/reply` FIX-M guard | `turnHolderId() === id` | `taskTurnRunning(id)` |
| tasks.ts:458 `/reply` acquire | `acquireTurn(id)` | giữ |
| tasks.ts:505 `/ask` acquire | `acquireTurn(id, 'ask')` | giữ — giờ vào làn chat |
| tasks.ts:527-541 `/cancel` nhánh ask | `liveKind/liveSession/requestAskCancel` | giữ nguyên signature (tra theo taskId) |
| tasks.ts:550 `/cancel` kill build | `liveSession(id)` | giữ |
| tasks.ts:572 `/cancel` evict | `turnHolderId() !== id` | `buildHolderId() !== id` (§3.2) |
| tasks.ts:598 `/restore` guard | `turnHolderId() === id` | `taskTurnRunning(id)` |
| tasks.ts:650-651 `/live-test` guard + acquire | `turnHolderId() === id` + `acquireTurn(id)` | `taskTurnRunning(id)` + giữ |
| tasks.ts:75 `turnBusyError()` holder | `turnHolderId()` | holder theo làn đang 409 |
| tasks.ts:122 dispatch `finally` | `releaseTurn(taskId)` | giữ (clear làn task giữ) |
| ui.ts:156 PUT `/spec` guard | `turnHolderId() === id` | `taskTurnRunning(id)` (§3.2) |
| dev.ts:22 `/api/dev/rebuild` | `turnBusy()` | `buildTurnBusy() \|\| chatTurnBusy()` — restart giết mọi child, cả hai làn phải rảnh |
| orchestrator.ts:527 spawn backstop | `turnHolderId() !== task.taskId` | `buildHolderId() !== task.taskId` |
| promote.ts:164 spawn backstop | `turnHolderId() !== task.taskId` | `buildHolderId() !== task.taskId` |
| orchestrator.ts:483/510 · promote.ts:173/178 · ask.ts:199/209/252/390/404/422/437 | set/clearSession, isAskCancelRequested | giữ nguyên |

### 3.4 Test S1 (vùng sẹo — cancel/lock có lịch sử bug tinh vi, bắt buộc lát test riêng)

File mới `apps/builder/test/lock-lanes.test.ts` (node --test + tsx, theo harness sẵn):

1. acquire('X','phase') + acquire('Y','ask') → cả hai true (song song khác task).
2. acquire('X','phase') ×2 → false; acquire('X','ask') sau khi X giữ phase → **false** (per-task).
3. releaseTurn('X') chỉ clear làn X giữ; làn kia còn nguyên holder.
4. Hai session sống đồng thời: `liveSession('X')`/`liveSession('Y')` trả đúng con của từng task;
   liveKind phân biệt đúng.
5. Cancel scoping (mở rộng dispatch-lifecycle.test.ts): cancel X (ask) force-kill chỉ child X,
   không markCancelled, build Y chạy tiếp; cancel Y (build) markCancelled + kill Y, chat X sống.
6. Evict: cancel task đang parked (không giữ làn build) → evict ngay như cũ.
7. `turnBusyError` carry đúng holder theo làn.

## 4. S2 — Consult mode (`kind:'consult'`)

### 4.1 Thiết kế cốt lõi: consult = task "sinh ra đã terminal-askable"

Chìa khoá giữ diff nhỏ: `/ask` route (tasks.ts:472-511) đã cho phép Ask trên task
`status: done|cancelled` (isTerminalAsk, 034). Vậy consult task được mint **thẳng vào trạng thái
đó**: `kind:'consult'`, `status:'done'`, `phase:'test'`, không gate, không artifact — toàn bộ
surface chat sẵn có (route /ask, SSE `ask:answer`/`ask:done`, Chat.tsx `asking`) chạy được ngay,
không thêm status/phase mới nào vào FSM.

- `state/task.ts`: mở rộng `kind?: 'build' | 'promote' | 'consult'`; thêm
  `createConsultTask(projectsDir, {text, files?})` theo mẫu `createPromoteTask` (task.ts:524) —
  `requirement` = message đầu tiên (kiêm seed + nguồn `languagePin`), `name` = message đầu cắt
  ngắn, project/workflowSlug null, sessionIds rỗng.
- Chat continuity: **tái dùng slot `sessionIds.askTest`** — semantics của slot vốn là "chat
  continuity ngoài phase" (034 D2), consult không bao giờ có phase session nên không đụng ai.
  Không đổi type. (Đã cân nhắc slot `consult` riêng — bỏ: thêm field cho zero lợi ích.)
- Trên đĩa: chỉ `.runs/<taskId>/` (task.json + uploads/) — không workflow dir, không đụng
  `projects/`.
- Bonus miễn phí của terminal-born: restart server GIỮA một turn consult là vô hại —
  `reconcileOnBoot` chỉ flip `running/scaffolding` → error; consult luôn 'done' nên không bị đụng,
  mở lại app là chat tiếp (resume qua sessionIds đã persist).

### 4.2 `consultWithin` (ask.ts — bản chép có sửa của `askTestWithin`, D8 DNA)

Khác biệt so với askTestWithin, mỗi cái một lý do:

1. **Seed chỉ khi spawn fresh** (sessionIds.askTest chưa có): seed = `requirement` +
   `attachmentBlock(task.attachments)`. Turn resume KHÔNG re-fold seed — askTestWithin re-seed vô
   điều kiện là đúng cho gate ④ (artifact đổi giữa các câu hỏi), nhưng consult không có gì đổi
   trên đĩa → re-seed chỉ đốt token + latency (đúng nỗi đau "chat chậm" user đã nêu).
2. Không `gatherTerminalSeed` (không có SPEC.md/main.yml/report.json để gom).
3. Prepend `languagePin(task.requirement)` (phases.ts — seam sẵn) vào MỌI prompt consult (fresh +
   resume) — askTestWithin hiện không pin, nhưng consult là surface chat thuần cho user JP/VN nên
   prose phải theo ngôn ngữ user từ token một (cùng lý do layer-1 reply-language guard của phase).
4. Giữ nguyên: `askMode:true` (layer-1 deny), `ASK_TIMEOUT_MS`, setSession/clearSession, persist
   session id ngay khi init, never-throw guard → `ask:done{ok:false}`, canned message khi error
   không text.

`/ask` route branch (tasks.ts:487-500): thêm `task.kind === 'consult'` → `consultWithin`, và
branch này theo **KIND, không theo status** — consult hỏi được ở MỌI status (đặt trước các check
isPhaseAsk/isTerminalAsk; promote vẫn 409 như cũ). Lý do (review r1, lỗ hổng thật): một consult
lỡ mang `status:'error'` (loser path §4.3, hoặc failSafe trên throw bất ngờ) sẽ KHÔNG lọt
isTerminalAsk (`done|cancelled`) → chat chết vĩnh viễn; route theo kind thì message kế tiếp
tự chữa lành. Đối xứng bắt buộc: **`/reply` thêm carve-out `kind==='consult'` → 409** — không có
guard này, một POST /reply forge trên consult error sẽ pass check `status==='error'`, chui vào
`replyWithin` → nhánh `phase==='test'` → `runTestAndFinish` → chạy report trên task không có
project/workflowSlug (consult không bao giờ được vào FSM ①②③④, cùng DNA carve-out promote
tasks.ts:425-427).

### 4.2b Transcript consult persist ở BACKEND (đảo 2 lần — chốt 2026-07-30)

Bản draft đầu: chat.jsonl backend. Lúc implement (2026-07-29) đổi sang **localStorage-only**
(dùng `thread-persist.ts` sẵn có) để tôn trọng **033 D6 "backend không giữ transcript"**.
**Dùng thật lộ ra localStorage-only quá mỏng** (user 2026-07-30): chat cũ tạo trước fix hiện
trống; và đổi browser/xoá cache là mất sạch — mà với consult thì transcript CHÍNH LÀ deliverable
(khác Ask-tại-gate của build vốn phù du). Nên **quay lại chat.jsonl backend**:

- `consultWithin` tích luỹ answer + `appendChat()` ghi `.runs/<taskId>/chat.jsonl` (mỗi lượt 1 dòng
  `{role:'user'|'assistant',text,at}`). Best-effort — ghi lỗi không hỏng turn. Dòng error-no-text
  cũng ghi (canned message) để transcript khớp đúng cái đã stream.
- `readConsultChat()` đọc lại; `GET /api/tasks/:id` fold `chat` cho `kind:'consult'`.
- FE `openTask`: consult có `t.chat` → `consultThreadFromChat()` dựng thread (user bubble +
  qa done). **Authoritative** — thắng localStorage; fallback localStorage → requirement bubble.
- **D6 không bị phá**: D6 là invariant của PIPELINE BUILD (Ask-tại-gate phù du); consult là kind
  khác, transcript ghi vào run-dir của CHÍNH nó, không đụng đường build. Ghi rõ để khỏi tưởng vi phạm.
- Chưa persist: S3 YAML card (advisory — bỏ khi reopen, không tái tạo). Ghi nhận, chưa cần.
- Giới hạn còn lại: chat tạo TRƯỚC fix này (không có chat.jsonl) vẫn trống — chỉ chat mới robust.
- Verify live (2026-07-30): consult tạo qua raw API (KHÔNG localStorage) → reload → mở lại hiện đủ
  2 lượt hội thoại từ backend. server 745✓ (consult.test.ts +1 transcript test) · web 209✓.

### 4.3 Route mới: `POST /api/consult`

Shape theo POST /api/tasks (tasks.ts:150-220), tối giản:

```
body: { text: string, files?: Attachment[] }   // files: validateAttachments sẵn có (yml đã trong allowlist 025)
400 nếu text rỗng / files fail; saveAttachments TRƯỚC acquire (disk fail → 500 không cầm lock);
acquireTurn(id, 'ask') fail → đánh dấu task mồ côi error 'rejected — another chat is running'
  + 409 (mirror đúng nghi thức loser của POST /api/tasks, tasks.ts:210-215);
dispatch(id, consultWithin(task, text, ctx)); trả task.
```

Message thứ 2+ : FE gọi `api.ask(id, text)` như mọi Ask — không endpoint mới.
`/cancel` trên consult ĐANG chạy turn: rơi vào nhánh `liveKind==='ask'` sẵn có → scoped kill,
status giữ nguyên. `/cancel` trên consult ĐANG NGHỈ (không turn): rơi xuống nhánh build —
vô hại: converge bị guard `status !== 'done'` chặn (consult luôn 'done'), flag cancelled evict
ngay vì không giữ làn build; ghi nhận ở đây để khỏi phải suy lại khi review. ✓
`GET /api/active`: consult status 'done' → không lọt danh sách in-progress. ✓
Sidebar: thêm `GET /api/consults` (quét runsRoot lọc kind, newest-first, shape như /api/active) —
consult không thuộc project nào nên không đi qua /api/tree.

### 4.4 Graduate — "Bắt đầu build từ cuộc trao đổi" (FE-only, zero backend)

Nút trong view consult → FE gửi qua `api.ask(id, CANNED_DISTILL_PROMPT)` — canned prompt yêu cầu
tóm cuộc trao đổi thành một requirement hoàn chỉnh **bằng ngôn ngữ user đang dùng** → answer
stream về → FE đổ vào composer New Task (prefill, user sửa được) → Run = `POST /api/tasks` bình
thường, làn build. Cuộc chat consult vẫn mở — đây chính là kịch bản 2-làn chạy thật đầu tiên.
FE chỉ prefill khi `ask:done{ok:true}` — một distill lỗi (`ok:false`) hiện đúng canned message
trong chat, không đổ rác vào composer (review r1).
Attachments của consult KHÔNG tự mang sang build ở S2 (user kéo lại file nếu cần) — carry-over để
V2 cân nhắc.

### 4.5 FE (web/src) — REV 2026-07-30: entry chuyển từ chip Mode sang sidebar 4 khối

Bản đầu dùng **chip Mode** trong composer (Trao đổi/Build). Ship xong, user chốt đổi sang IA
tốt hơn: **sidebar chia 4 khối**, mỗi khối (trừ 進行中) là một **header dạng button có nhãn + "+"**
(kiểu nút `チャット` user vẽ). Entry giờ nằm ở sidebar, KHÔNG còn chip Mode.

- **4 khối** (thứ tự): **① 進行中** (nhãn thường, KHÔNG "+" — danh sách trạng-thái-động, ẩn khi
  rỗng) · **② Chat** (button+"+" → `newChat()` mở empty surface mode consult; list từ
  `/api/consults`) · **③ Build** (button+"+" → `newTask()` mode build; nội dung = project `_drafts`
  **phẳng** — các build rời, header thay cho folder "Drafts" cũ) · **④ Project** (button+"+" →
  modal tạo project; các project có tên).
- **Phân vùng tree** (Sidebar.tsx): `_drafts` → khối Build, còn lại → khối Project. `_drafts` luôn
  dẫn đầu buildTree nên tách sạch. Component mới `SectionHeader` (`.sb-section-btn`) + `ConsultRow`.
- **Gỡ** (theo user): chip Mode trong composer (`onMode` bỏ khỏi EmptyState→Composer; Composer giữ
  prop `mode` để chọn placeholder + ẩn/hiện chip build) · nút "New task" to ở đầu · icon
  new-project ở header (đã có "+" ở khối Project). Header còn: title `Builder` + external-YAML
  intake + dev buttons.
- `newTask()` giờ ép `settings.mode='build'` (mọi lối vào của nó — Build "+", sửa workflow,
  preselect project — đều là build); `newChat()` ép `'consult'`.
- Placeholder theo mode: consult = "hỏi gì cũng được / kéo yml"; build = requirement.
- i18n: `sectionChat/sectionBuild/sectionProjects` + `newChat/newBuild` + `appName` (cặp EN/JA).
- Verify live (2026-07-30): 3 khối button render đúng (チャット/ビルド/プロジェクト); 進行中 ẩn khi
  rỗng; Chat "+"→consult surface, Build "+"→build surface (không Mode chip), Project "+"→modal.
  web 209✓ · typecheck sạch · build ✓.
- **Busy split**: state `busy` toàn cục hiện coi "có turn đang chạy" là một; tách
  `busyBuild`/`busyChat` — composer build disable theo busyBuild, input chat theo busyChat +
  `asking` per-task. 409 handler đọc holder như cũ.
- Chat.tsx: dùng nguyên (ask:answer/ask:done đã stream per-task).
- i18n: mọi label mới có cặp EN+JA (cơ chế exact-frame 030a/043 — thêm frame, không sửa frame cũ).

### 4.6 S2b (optional, tách PR được): model pin cho làn chat

`SessionOptions.model?` → `args.push('--model', model)` trong claude-session.ts spawn; đọc từ env
`BUILDER_CHAT_MODEL` (đọc 1 lần lúc module load, idiom 048 D1); chỉ consultWithin/askWithin/
askTestWithin set. Không set → hành vi hôm nay. Đây là đòn latency trực tiếp cho nỗi đau "chat
chậm" (đã chẩn đoán: cold-start + resume-history là phần nặng; model nhỏ giảm nốt phần suy nghĩ).

## 5. S3 — YAML report card (kiểm tra máy, không LLM)

Khi một message consult (create hoặc /ask) đính kèm `.yml`/`.yaml`:

1. Backend chạy trên file đã save dưới `.runs/<id>/uploads/`:
   `lintStandaloneYaml` (tái dùng — cửa paste của /api/promote, tasks.ts:241) +
   `checkRunnability` (runnability.ts, nhận rel path + runPython). Túi kết quả gọn:
   `{ lint: string[], preflight?: string, contract?: string }`.
2. Emit SSE event mới `ask:card` (trước khi spawn turn) — FE render card trong chat.
3. Fold một tóm tắt text của card vào prompt turn — model bàn trên dữ liệu thật, không đoán.
4. Tool fail → card ghi "không chạy được <tool>" (không bao giờ im lặng coi như sạch — DNA 081
   preflight), turn vẫn chạy.

Pattern-match (fingerprint/catalog) để ngỏ — chỉ thêm nếu S3 chạy thấy thiếu.

## 6. Cố tình KHÔNG làm (đã cân nhắc, đừng đề xuất lại)

- **Build ∥ Build** — giới hạn cố ý (quota/tài nguyên/review bandwidth). Làn build vẫn 1 slot.
- **Hàng đợi thay 409** — FE nhận 409 + holder là đủ cho single-user; queue là máy móc mới không
  ai cần.
- **Chat ∥ Chat** — một người một bàn phím; slot chat 1 là đủ.
- **Refactor askTestWithin/askWithin để share code với consultWithin** — D8 DNA: duplicate giữ
  byte-behavior các đường đã ship.
- **Consult "nâng cấp tại chỗ" thành build** (đổi kind in-place) — graduate qua composer prefill
  giữ mọi invariant tạo build (slug/scaffold/attachments validation) đi đúng một cửa.
- **Status/phase mới cho consult** — terminal-born (§4.1) rẻ hơn hẳn và không lan vào FE store.

## 7. Acceptance criteria

**S1**
1. Ask (gate hoặc terminal) chạy đồng thời với build turn của task khác — cả hai stream SSE sống.
2. POST /api/tasks thành công trong khi một Ask đang chạy (trước đây 409).
3. Build thứ 2 khi build 1 đang chạy → 409 carry holder build; Ask thứ 2 khi Ask đang chạy → 409
   carry holder chat.
4. Mọi thao tác cùng-task khi task đang giữ turn bất kỳ làn → 409 (reply/confirm/restore/PATCH/
   PUT-spec/live-test).
5. Cancel đúng phạm vi khi 2 child sống (test §3.4·5). Cancel build không giết chat và ngược lại.
6. `npm test` server + web xanh; dispatch-lifecycle giữ nguyên hành vi release-exactly-once.

**S2**
7. Tạo consult không đụng `projects/`; chat nhiều lượt continuity qua `--resume`; đóng app mở
   lại thấy LẠI đủ bong bóng cũ (chat.jsonl hydrate, §4.2b) VÀ hỏi tiếp model vẫn nhớ (sessionIds).
7b. Consult ở `status:'error'` (giả lập) vẫn chat được và tự hồi phục sau một message; POST /reply
   forge vào consult → 409 (carve-out §4.2).
8. Turn consult không ghi được file (hook deny — thử bảo nó ghi, nhận từ chối, đĩa sạch).
9. Kéo `.yml` vào consult → model đọc và trả lời về nội dung file.
10. Graduate: prefill requirement đúng ngôn ngữ user; Run mở build chạy làn build trong khi chat
    còn hỏi tiếp được (kịch bản 2-làn end-to-end).
11. Consult hiển thị đúng section sidebar; không lọt /api/active; JA/EN đủ label.

**S3**
12. Kéo yml lint-lỗi → card nêu lỗi ~1s, trước khi model nói; yml sạch → card sạch + preflight
    note nếu có; tool chết → card nói rõ tool nào không chạy.

## 8. Rủi ro & cách nghiệm

- **Vùng sẹo cancel/lock** (các fix "cancel lock-leak", 011 R14, 014 D7 còn comment trong code):
  S1 phải đi kèm lát test §3.4 và chạy lại toàn bộ suite dispatch/cancel hiện có; review S1 tách
  riêng khỏi S2 để reviewer chỉ nhìn concurrency.
- **FE busy assumption**: chỗ nào FE đang suy "busy toàn cục = disable hết" sẽ lộ ra khi 2 việc
  chạy — quét `busy` usage trong web/src khi làm S2 (liệt kê trong PR).
- **Quota**: đỉnh 2 process claude. Chấp nhận; S2b giảm phần chat.
- **Nghiệm thu tay tối thiểu sau S2**: một phiên theo đúng kịch bản §1 (chat → kéo yml → graduate
  → build chạy ∥ chat tiếp → cancel từng bên) trên máy thật.
