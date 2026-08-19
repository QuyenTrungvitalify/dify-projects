# 101 — Kế hoạch triển khai: đưa Builder tới trạng thái giao được cho tester

> Trạng thái: **mở**, chưa implement. Lập 2026-08-19.
> Gộp và **cắt bớt** hai spec: [099](099-build-ask-history-survives-the-browser.md) (UI mất lịch sử)
> và [100](100-ask-session-reset-doom-loop.md) (model mất trí nhớ).
> **Ràng buộc chi phối:** *không cần giữ dữ liệu hiện có* — máy tester cài mới, `.runs/` rỗng,
> localStorage rỗng. Ràng buộc này **xoá bớt việc**, và §1 ghi rõ xoá cái gì, vì sao.
> Mục tiêu duy nhất: **tester dùng vài tuần đầu không gặp lỗi chặn đường, và mọi lỗi họ gặp đều
> tự kể được câu chuyện của nó trong một file zip.**

---

## 0. Đọc cái gì trước

| Muốn biết | Đọc |
|---|---|
| Làm gì, theo thứ tự nào | §2 → §3 → §4 của file này |
| Vì sao **không** làm những phần khác | §1 và §5 |
| Hệ thống sẽ chạy ra sao sau khi xong | §8 |
| Bằng chứng đứng sau từng quyết định | [099 §1](099-build-ask-history-survives-the-browser.md) và [100 §1](100-ask-session-reset-doom-loop.md) |

**Không** đọc bảng thứ tự ở [099 §8.2](099-build-ask-history-survives-the-browser.md) — nó xếp theo
logic nội bộ của 099, giả định chỉ có máy tác giả. File này thay thế nó.

---

## 1. Hai quyết định cắt phạm vi — đã kiểm bằng code, không phải suy luận

### ① DROP toàn bộ S5 của 099 (trừ "việc 0")

**S5 xây trên hai `[ĐO]` mà ràng buộc "data sạch" xoá sổ:**

- *"`runs.jsonl` mới ship 2026-08-18, nên mọi build tạo trước đó không có một dòng nào trên đĩa"* —
  trên máy tester **không tồn tại build nào như vậy**.
- *"build có file này: **1/20** trong LRU index"* — `[ĐO code]` `AttemptRecorder` được tạo trong
  `spawnOnce` của `runPhase` ([orchestrator.ts:517](../../apps/builder/server/lib/orchestrator.ts:517)),
  đường **duy nhất** mọi phase đi qua (`phaseId` là tham số). Nên trên máy sạch, **mọi attempt của
  mọi phase của mọi build** đều ghi `runs.jsonl` → tỉ lệ là **20/20**.

**Hệ quả từng mục:**

| Mục S5 | Số phận | Vì sao |
|---|---|---|
| 1. Đá theo "có thể phục hồi" | ⚫ **DROP** | Mọi build đều phục hồi được ⇒ **không có tín hiệu nào để xếp hạng**. Thuật toán ưu tiên trên một tập đồng nhất = LRU thời gian, đúng thứ đang chạy |
| 2. Đá thì phải cảnh báo | ⚫ **DROP** | Điều kiện phát cảnh báo (*"nạn nhân không có bản sao"*) **không bao giờ đúng** ⇒ code chết |
| 3. Dòng tự khai cho build đời cũ | ⚫ **DROP** | Ca đó **không thể tồn tại** trên máy tester |
| 0. `runs.jsonl` vào bundle | 🔴 **GIỮ, nâng lên Đợt 1** | Chẳng liên quan gì tới LRU — đây là lỗ của **kênh thu bằng chứng**, xem [2.4](#24--runsjsonl-vào-bundle-export) |

**Dư chấn phải chấp nhận và nói thẳng:** `THREAD_MAX = 20`
([store.ts:818](../../apps/builder/web/src/store.ts:818)) vẫn đá thread khi tester chạy quá 20 build.
Sau khi bị đá, mở lại build đó thì hội thoại **tự lành** (Đợt 2), còn timeline phase **xuống cấp**:
đĩa cho ~8 attempt × 6.000 ký tự thay vì browser giữ 41 × 32.000, và gate card không dựng lại.
**S5 không sửa được điều đó** — nó chỉ đổi *thread nào bị đá*, không đổi *phục hồi được bao nhiêu*.
Đây là xuống cấp, không phải mất dữ liệu. Chấp nhận cho giai đoạn tester.

### ② Lớp 1 của S1b là ĐỦ để chặn mất dữ liệu — lớp 2 hoãn được

Đây là quyết định rủi ro hơn, nên kiểm kỹ hơn. Câu hỏi: sau khi `applyAskDone` ngừng ghi, **có
đường nào khác** khiến tab thụ động vẫn ghi đè không?

`[ĐO code]` **Có một đường nguy hiểm — nhưng nó không được kích hoạt.** `applyTask` làm mới snapshot
của gate card đang mở (`items[i] = { ...it, snapshot: t }`,
[store.ts:517](../../apps/builder/web/src/store.ts:517)) rồi gán `thread.value = items` **vô điều
kiện** ([store.ts:553](../../apps/builder/web/src/store.ts:553)); `isFreshSnapshot` dùng `>=` nên
**cả snapshot cùng `rev` cũng được áp** ([store.ts:399–402](../../apps/builder/web/src/store.ts:399)).
Nếu tab thụ động nhận `task:update` trong lượt ask thì clobber quay lại y nguyên.

**Nhưng đường ask của BUILD không phát `task:update`.** Liệt kê toàn bộ broadcast:

- `askTestWithin` ([ask.ts:739–806](../../apps/builder/server/lib/ask.ts:739)) — chỉ `ask:answer`, `ask:done`.
- `askWithin` ([ask.ts:389–485](../../apps/builder/server/lib/ask.ts:389)) — chỉ `ask:answer`, `ask:done`.
- Route `POST /api/tasks/:id/ask` ([tasks.ts:688–772](../../apps/builder/server/routes/tasks.ts:688)) — **không broadcast gì**.
- Bốn chỗ phát `task:update` trong `tasks.ts` là `failSafe` (throw bất ngờ), `/confirm`, `/cancel`,
  `/reply` — **không cái nào nằm trên đường ask bình thường**.

Và hai event còn lại đều **không ghi** ở tab thụ động sau lớp 1:

- `ask:answer` → `applyAskAnswer` chỉ đệm vào biến module + hẹn rAF
  ([store.ts:725–732](../../apps/builder/web/src/store.ts:725)); `flushPendingAsk` gặp `idx === -1`
  thì xoá đệm và `return` **không gán `thread.value`** ([store.ts:703–707](../../apps/builder/web/src/store.ts:703)).
- `ask:done` → sau lớp 1 không gán nữa.

⇒ **Tab thụ động không phát ra một lượt ghi nào.** Lớp 2 chỉ còn giá trị **hiển thị** (tab A thấy
được lượt hỏi của tab B ngay), không còn giá trị bảo toàn dữ liệu. Hoãn được.

> ⚠️ **Sự đủ của lớp 1 phụ thuộc một tính chất ẩn: đường ask của build KHÔNG phát `task:update`.**
> Ai đó thêm một cái sau này — ví dụ để relay trạng thái "đang hỏi" — là clobber quay lại **âm thầm**.
> Vì vậy [test 12c](#7-nghiệm-thu-tổng) là một **test canh cửa**, không phải test trang trí.

---

## 2. ĐỢT 1 — chặn cửa (bắt buộc xong TRƯỚC khi giao tester)

> ## ✅ HOÀN TẤT 2026-08-20 — cả 5 việc đã ship, có test, đã chứng minh đỏ-khi-revert
> Server `node --test` **1070/1070 pass** (251 suite) · web `vitest` **358/358** · typecheck sạch.
> **Đã qua một vòng review lại sau khi ship** — bắt được một lỗ path-traversal do chính 2.5 tạo ra
> (§2.5), một test trang trí, và một lỗi hoa-thường ở 2.3. Xem "Review sau ship" cuối §2.
> Hai điều còn nợ, ghi rõ thay vì để lặng: (a) phép thử **đảo chiều cho sàn động** của 2.1 chưa chạy
> được (lệnh sửa tạm `ask.ts` bị từ chối quyền — lập luận đúng-theo-kiến-tạo vẫn vững, xem 2.1);
> (b) **R3 và R4 ở §10 nên trả lời TRƯỚC khi phát hành** — R4 (trải nghiệm cài đặt) có khả năng chặn
> tester cao hơn bất kỳ bug nào ở đây. Việc tiếp theo: **Đợt 2** (§3).

Năm việc. Ước lượng "dưới một ngày công" ở bản plan đầu là **lạc quan** (xem §10 R5); thực tế gần một
ngày cho cả năm, phần lớn nằm ở test chứ không ở code. Không route mới, không đổi định dạng file.
Một file nguồn mới (`canonical-host.ts`) và hai file test mới.

### 2.1 · Nâng ngưỡng reset phiên ask `[100 S1]` ✅ **ĐÃ SHIP 2026-08-19**

> **Đã implement + nghiệm thu.** Ba thay đổi, đúng như plan:
> 1. `ASK_RESET_TOKENS` mặc định **300k → 1M** (sàn tĩnh 50k và luật "env dưới sàn thì nâng" giữ nguyên).
> 2. `shouldResetAskSession` thêm tham số thứ ba `prevTurnWasFreshSession` (**sàn động**) — mặc định
>    `false` nên mọi lời gọi cũ giữ nguyên hành vi. Cộng `askResetSuppressed` tách riêng, để lượt bị
>    từ chối có thể **nói ra** kèm số thật thay vì im lặng.
> 3. **`readLastAskMeta` — hàm đọc MỚI, không nới `readLastAsk`.** Đây là chỗ suýt vi phạm non-goal của
>    099 (*"không đổi `lastAsk` phía server"*): nới `readLastAsk` sẽ đẩy một input quyết định
>    server-internal lên wire ở **mọi** lần reconnect, cho không ai đọc. Cùng một lần đọc `chat.jsonl`.
>
> **Đỏ-khi-revert — nửa ngưỡng: đã chứng minh bằng thực nghiệm, KHÔNG cần sửa source.** Chạy
> `BUILDER_ASK_RESET_TOKENS=300000 node --import tsx --test test/ask-cost.test.ts` → test *"spec 100:
> one heavy turn is no longer mistaken for a bloated session"* **đỏ**. Mặc định → xanh.
>
> **Đỏ-khi-revert — nửa sàn động: đúng-theo-kiến-tạo, chưa chạy thực nghiệm.** Cặp assert dùng **cùng
> cost, cùng limit, chỉ khác cờ** và kỳ vọng ngược nhau (`true` → `false`, `false` → `true`); không
> implementation nào bỏ `&& !prevTurnWasFreshSession` mà thoả được cả hai. Test tích hợp cũng đỏ theo
> (`resumed` sẽ thành `undefined`). Phép thử đảo chiều bằng cách sửa tạm `ask.ts` **bị từ chối quyền**,
> nên chưa chạy — ghi ra thay vì coi như xong.
>
> **Hai test cũ đã ĐỔI KỲ VỌNG, có chủ đích** — không phải chỉnh số cho xanh:
> `shouldResetAskSession({cacheReadTokens: 899_300})` từ `true` → **`false`**. 899k là **một câu hỏi
> đắt** (câu trả lời 622 token, prefix phải viết lại vì cache hết hạn), **không phải** một phiên đã
> phình. Phân biệt đúng hai thứ đó chính là toàn bộ mục đích của ngưỡng mới. Fixture của test tích hợp
> cũng nâng 899k → 1,19M vì lý do y hệt.
>
> **Suite:** server `node --test` **1046/1046 pass** (246 suite, +7) · web **358/358** · typecheck sạch.

**Vì sao trước tiên:** đây là lỗi **thường xuyên nhất** — `[ĐO]` 4 lần reset trong một ngày, hai lần
cuối cách nhau **8 phút**. Mỗi lần, model nói *"hội thoại này đã bị restart, tôi không đọc được câu
bạn đang trả lời"*. Tester nào cũng gặp trong ngày đầu, và nó khiến sản phẩm **có vẻ hỏng**.

**Sửa:**

1. [ask.ts:95–97](../../apps/builder/server/lib/ask.ts:95) — mặc định `300_000` → `1_000_000`.
   Giữ nguyên sàn `50_000` và luật "env dưới sàn thì nâng chứ không nghe theo".
2. [ask.ts:127](../../apps/builder/server/lib/ask.ts:127) `shouldResetAskSession` — thêm **sàn động**:
   nếu lượt trước **là lượt đầu của một phiên vừa reset** mà vẫn vượt ngưỡng thì **không reset nữa**,
   và `log.warn` kèm con số thật. Không có mảnh này, một ngưỡng đặt sai vẫn tạo vòng lặp — chỉ chậm hơn.
3. Cần dữ liệu cho điều kiện đó. Plan ban đầu ghi *"mở rộng `readLastAsk`"* — **đã đổi khi implement**:
   shape của `readLastAsk` đi theo `GET /api/tasks/:id` dưới dạng `lastAsk`, mà 099 có non-goal
   *"không đổi `lastAsk` phía server"*. Nới nó sẽ đẩy một input quyết định server-internal lên wire ở
   mọi lần reconnect cho không ai đọc. Thay bằng **`readLastAskMeta`** — hàm đọc riêng, cùng một lần
   đọc `chat.jsonl`, trả `{cost, sessionReset}`. Cờ này **đã** nằm sẵn trên dòng assistant, không phải
   bookkeeping mới.

**Rủi ro:** ngưỡng cao hơn ⇒ một lượt có thể đắt hơn trước khi reset. Đánh đổi có chủ ý: người dùng
đang trả giá bằng **cả hai** (vừa đắt vừa quên) vì reset buộc model đọc lại file từ đầu.

**Không đụng:** công thức `askSessionTokens` ([ask.ts:119](../../apps/builder/server/lib/ask.ts:119)) —
chưa có số đo nào đòi đổi nó (100 Open Q1).

**Test** `test/ask-cost.test.ts` · **Nghiệm thu:** REPRO [100 §5](100-ask-session-reset-doom-loop.md)
trên một build `main.yml` ≥ 100 KB — hỏi 4 câu liên tiếp, đếm dòng `session reset` trong log: phải là **0**.

### 2.2 · Tab thụ động ngừng ghi đè `[099 S1b lớp 1]` ✅ **ĐÃ SHIP 2026-08-19**

> **Đã implement + nghiệm thu.** Diff: **2 dòng code** (phép gán chuyển vào trong `if (idx !== -1)`)
> + khối comment giải thích tại chỗ. Test: 4 case mới trong `web/src/store.test.ts`
> (`describe('applyAskDone — a PASSIVE tab must not republish an unchanged thread')`).
>
> **Đỏ-khi-revert đã CHỨNG MINH bằng cách chạy thật:** đưa phép gán ra ngoài `if` → **2 test đỏ**
> (`expected [] to be []`, *"Compared values have no visual difference"* — nội dung giống hệt, chỉ
> **identity** đổi; đó chính là bản chất bug). Khôi phục fix → xanh lại.
>
> **Test canh cửa (§7 #8) đã làm cùng lượt:** `test/ask.test.ts` →
> `describe('build ask paths never broadcast task:update')`, 4 case = {`askWithin`, `askTestWithin`}
> × {lượt sạch, lượt lỗi}. Mỗi case assert **hai** điều: không có `task:update`, **và** `ask:done`
> **có** mặt — vế thứ hai là thứ chứng minh mảng sự kiện thật sự được điền, nên một mảng rỗng không
> thể giả vờ pass.
>
> **Suite đầy đủ sau khi sửa:** web `vitest` **358/358 pass** (30 file) · server `node --test`
> **1043/1043 pass** (246 suite) · typecheck server + web **sạch**.
>
> **Còn nợ một phép kiểm:** chưa chạy được "chèn `task:update` vào `askTestWithin` → guard phải đỏ"
> (lệnh sửa tạm `server/lib/ask.ts` bị từ chối quyền). Guard vẫn có giá trị nhờ vế assert `ask:done`
> ở trên, nhưng phép thử đảo chiều thì **chưa** chạy — ghi ra đây thay vì lặng lẽ coi như xong.

**Sửa:** [store.ts:798](../../apps/builder/web/src/store.ts:798)

```
- thread.value = items;
+ if (idx !== -1) thread.value = items;
```

**Vì sao an toàn:** `flushPendingAsk()` chạy ở [store.ts:772](../../apps/builder/web/src/store.ts:772)
**trước** khi `items` được `slice()` ở [store.ts:775](../../apps/builder/web/src/store.ts:775), nên
`items` đã phản ánh mọi thứ hàm đó làm. Khi `idx === -1`, thân hàm **không mutate `items`** (chỉ nhánh
`idx !== -1` mới gán `items[idx]`), nên bỏ phép gán không đánh rơi gì.

**Điều kiện phải là `idx !== -1`, KHÔNG phải so sánh mảng trước/sau** — vì `flushPendingAsk` có thể
đã đổi `thread.value` một cách hợp lệ, và so sánh sẽ nuốt mất thay đổi đó.

**Test** `web/src/store.test.ts` — **không** phải `store.reply.test.ts` như bản plan đầu ghi: file đó
chỉ nói về carve-out của `reply()` (spec 053), còn `store.test.ts` **đã** import sẵn `applyAskDone`,
`applyAskAnswer`, `flushPendingAsk`, `thread` và đã có `describe('applyAskDone …')` để nối vào.
Cộng **test canh cửa** đường broadcast (§7 #8) — **đã làm**, xem ghi chú ở đầu 2.2.

### 2.3 · Một origin duy nhất `[099 S4]` ✅ **ĐÃ SHIP 2026-08-20**

> Module thuần mới `server/plugins/canonical-host.ts` (`canonicalHostRedirect` + hằng
> `CANONICAL_REDIRECT_STATUS`), nối vào hook `onRequest` **đã có** ở `index.ts` — đặt **sau** phép kiểm
> CSRF, nên một mutation bị từ chối vẫn bị từ chối chứ không bị redirect. **11 test** ở
> **`test/canonical-host.test.ts`**.
>
> **Lỗ hổng phát hiện KHI IMPLEMENT, plan không có: open redirect.** `Location` dựng từ `req.url` mà
> đường dẫn bắt đầu bằng `//` là **protocol-relative** — `//evil.example` đưa người dùng ra khỏi máy.
> Header `Host` cũng do client gửi nên chỉ được **so sánh**, không bao giờ nội suy. Đã có test riêng.
>
> **Một điểm yếu trong TEST của tôi, đã sửa:** bản đầu pin số 308 trên một **bản sao** của wiring, nên
> đổi `index.ts` sang 301 test vẫn xanh. Sửa bằng cách đưa mã về một nguồn duy nhất
> (`CANONICAL_REDIRECT_STATUS`) mà cả `index.ts` lẫn test cùng dùng. `tsc` suy kiểu hằng đó là literal
> `308` nên **chính compiler** chặn drift ở mọi call site — mạnh hơn assert runtime.
>
> ⚠️ **Một sai sót của tôi, đã khắc phục — ghi lại vì nó là loại lỗi tệ nhất.** Plan ghi
> *"`test/origin.test.ts` (mới)"*; tôi tin và `Write` đè lên — **file đó ĐÃ TỒN TẠI**, 49 dòng phủ
> `isOriginAllowed` / `isOriginAllowedForMutation` / `buildAllowedOrigins` (ranh giới CSRF, T3 + 015 D6).
> Suite vẫn **xanh** nên không có gì báo động: 7 test biến mất mà tổng số vẫn tăng. Phát hiện qua
> `git status` (` M` chứ không phải `??`). Đã khôi phục nguyên văn từ HEAD (`git diff` rỗng) và đổi tên
> test mới thành `canonical-host.test.ts` — đặt theo **module nó kiểm**, không theo chủ đề.
> **Luật rút ra: trước khi tạo file test, `git status`/`ls` đã — đừng tin chữ "(mới)" trong plan.**

**Sửa:** hook `onRequest` **đã tồn tại** ở [index.ts:120](../../apps/builder/server/index.ts:120) —
thêm vào đó, đừng tạo hook mới.

- Điều kiện: `req.headers.host` bắt đầu bằng `localhost:` **và** request là **điều hướng tài liệu**
  (`Sec-Fetch-Mode: navigate`, hoặc `Accept` chứa `text/html`).
- Hành động: **308** tới `http://127.0.0.1:<PORT><originalUrl>` — giữ nguyên path + query.
- **`/api/*` KHÔNG redirect.**

**Phải là 308, không phải 301.** Trình duyệt được phép đổi POST thành GET khi theo `301`/`302`; mọi
mutation tới host `localhost` (`/ask`, `/confirm`, `/cancel`) khi ấy **hỏng câm** — server nhận một
GET không body, trả 404, UI không hiện lỗi gì có nghĩa.

**Không cần đụng allowlist:** `http://localhost:<port>` đã nằm trong `buildAllowedOrigins`
([sse-origin-check.ts:25](../../apps/builder/server/plugins/sse-origin-check.ts:25)), nên một tab cũ
còn gửi `Origin: http://localhost:4123` vẫn qua cửa.

**Test** `test/origin.test.ts` (mới) — **bắt buộc** có assert mã **≠ 301/302**, và một assert
`POST /api/tasks/:id/ask` tới host `localhost` **không** bị đổi method.

### 2.4 · `runs.jsonl` vào bundle export ✅ **ĐÃ SHIP 2026-08-20**

> Một dòng trong `RUN_ARTIFACTS`. **Đỏ-khi-revert đã chạy:** bỏ ra → **2 test đỏ**, kèm thông báo nói
> hậu quả (*"a tester report would arrive without the phase timeline"*). Test mới cố ý **không** gộp vào
> test liệt kê sẵn có: test đó `t.skip` khi thiếu binary `unzip`, mà một guard có thể im lặng skip thì
> không phải guard. Bundle là `zipStore` (STORED, không nén) nên tên entry nằm nguyên trong local file
> header — tìm chuỗi byte là đủ, và chạy ở mọi môi trường.

**Sửa:** thêm `'runs.jsonl'` vào `RUN_ARTIFACTS`
([bundle.ts:29](../../apps/builder/server/lib/bundle.ts:29)).

**Vì sao:** `[ĐO code]` mảng đó liệt kê `analyze.json`, `criteria.json`, `report.json`, `diff.json`,
`preflight.json`, `workspace.json`, `events.jsonl` — **thiếu `runs.jsonl`**, vì file đó ship 18/08
(`27f0fc0`) **sau** khi spec 062 dựng bundle. Hồ sơ tester gửi về đang thiếu đúng nguồn bằng chứng
mới nhất. Một dòng.

**Test** `test/bundle.test.ts` (đỏ-khi-revert: bỏ khỏi mảng → test đỏ).

### 2.5 · Log lúc SSE đóng, ghi vào nơi thu được `[099 S0]` ✅ **ĐÃ SHIP 2026-08-20**

> Hai `RunEventKind` mới (`stream_open` / `stream_close`) + `clientsForTask(sse, taskId)` + `projectsDir`
> **optional** trên `SSEPluginOptions` (bỏ trống ⇒ không ghi gì, nên mọi test cũ dựng plugin không có nó
> chạy y nguyên). Ghi vào `events.jsonl` của **đúng task**, best-effort `void logEvent(...)`.
>
> **Đếm theo TASK, không theo server.** Mở thì `clients=N` **gồm cả** stream vừa mở (`clients=2` chính là
> khoảnh khắc hai tab); đóng thì N là **số còn lại**. Đó đúng là câu hỏi 099 bị chặn, và giờ đọc được từ
> bundle mà không cần chạm console của tester.
>
> **5 test** ở `test/sse.test.ts` (mới) — dùng **server lắng nghe thật**, vì `reply.hijack()` không đi
> qua `app.inject()`: một reply đã hijack không bao giờ hoàn tất một injected request, nên test kiểu
> inject sẽ treo hoặc assert lên một thứ không có thật. Socket thật cũng là cách duy nhất tạo ra một
> disconnect thật. **Đỏ-khi-revert đã chạy:** bỏ `note(taskId, 'stream_close')` → **3/5 đỏ**, exit=1 sạch.
>
> **Một defect trong TEST của tôi, tự tìm ra và đã sửa.** Lần chạy revert đầu **treo 120 s rồi bị kill,
> không ra một dòng output nào**. Nguyên nhân: assert hỏng ném trước khi test kịp `destroy()` stream của
> nó, mà `reply.hijack()` giao socket cho ta nên `app.close()` chờ vô hạn. Trong CI đó là timeout **không
> có tín hiệu** — tệ hơn hẳn một test đỏ. Sửa: `afterEach` theo dõi mọi stream đã mở và cưỡng chế
> `destroy()` **trước** `app.close()`. Áp cho **mọi** test đụng tới hijacked reply.

**Sửa:** [sse.ts:218](../../apps/builder/server/plugins/sse.ts:218) `cleanup()` — choke point **duy
nhất và idempotent** của cả hai hook `request.raw.on('close'|'error')`
([sse.ts:262–263](../../apps/builder/server/plugins/sse.ts:262)).

1. `app.log.info({ taskId, clients: sse.clients.size }, ...)`.
2. **Và** một dòng `events.jsonl` của đúng task — thêm hai kind vào `RunEventKind`
   ([run-events.ts:16](../../apps/builder/server/lib/run-events.ts:16)): `stream_open` / `stream_close`,
   `detail: 'clients=N'`. Ghi `stream_open` sau `sse.clients.add(client)`
   ([sse.ts:228](../../apps/builder/server/plugins/sse.ts:228)).
3. `SSEPluginOptions` cần thêm `projectsDir` để tính run dir.

**Vì sao phải cả hai.** `dev-restart.log` nằm ở `.runs/dev-restart.log`, **3,4 MB**, dùng chung mọi
task, chưa qua `redactSecrets` ⇒ **không nằm và không thể nằm** trong bundle. Trên máy bạn thì
`log.info` là đủ; trên máy tester nó là dòng log **không ai lấy về được**. Slice này sinh ra để trả
lời *"có mấy tab cùng mở"* — câu trả lời không tới được người sửa thì coi như chưa làm.

**Rủi ro dung lượng — đo, đừng đoán.** Một build dài reconnect nhiều lần sẽ đẻ nhiều dòng. Bắt đầu
bằng ghi cả hai; **đo sau một tuần**. Nếu ồn thì lọc còn *chỉ ghi khi số client của task này vượt/cắt
mốc 2* — đúng biến cố ta quan tâm, phần còn lại là nhiễu.

**Test** `test/sse.test.ts` (mới) — assert đọc được **từ file `events.jsonl`**, không chỉ từ `app.log`.

### Review sau ship (2026-08-20) — ba thứ tìm được khi đọc lại chính diff của mình

**① 🔴 Path traversal do 2.5 TẠO RA, đã vá.** Route SSE cố ý **chưa bao giờ** validate `:id`, và điều
đó **vô hại** khi id chỉ là khoá `Set` + bộ lọc broadcast — rác vào, rác nằm im. Việc ghi timeline biến
id thành **đối số đường dẫn** cho `taskDir` → `join`, mà `join` chuẩn hoá `../` ra thẳng khỏi `.runs/`.

**Đo được, không phải suy đoán:** bỏ guard ra, `GET /api/tasks/..%2F..%2F..%2FESCAPED/stream` thực sự
ghi vào `<projectsDir>/ESCAPED/events.jsonl` — Fastify **có** decode `%2F` thành dấu phân cách trong
param. Và SSE GET cố ý dung thứ Origin vắng mặt (EventSource cùng origin có thể bỏ), nên một thẻ
`<img src=…>` trên trang bất kỳ chạm tới được. Tác động thấp — kẻ tấn công chọn được *đường dẫn*, không
chọn được *nội dung* (một dòng JSON) — nhưng đây là **primitive ghi cross-origin không hề tồn tại**
trước khi tôi thêm việc ghi timeline.

Vá: `isTaskId` (`/^\d{13,}$/`) chuyển lên `state/task.ts` **ngay cạnh `taskDir`** — nơi nó thuộc về,
vì nó bảo vệ đúng input của hàm đó — và gọi trong `note()`. Guard thuộc về **phép GHI**, không thuộc
transport: id lạ vẫn được stream bình thường, chỉ là không để lại dấu trên đĩa. (`routes/ui.ts` giữ một
bản sao cục bộ của cùng regex; nên hội tụ, nhưng bản sao đó đang đúng nên đây là ghi chú, không phải bug.)

**② 🟠 Một test của tôi là TRANG TRÍ, đã sửa.** Năm test traversal ban đầu **pass ngay cả khi không có
guard** — vì `logEvent` dùng `appendFile`, mà thư mục đích không tồn tại nên write hỏng dù thế nào.
Chúng đang đo `ENOENT`, không đo guard. Sửa: **tạo sẵn thư mục đích thoát ra** (`<dir>/ESCAPED`) để thứ
duy nhất chặn được write là guard. Sau khi sửa, bỏ guard → **đỏ đúng 1/5** (đúng vector khai thác được;
bốn cái kia không phải traversal thật — `%252F` chỉ decode một lần). Đó mới là test chịu tải.

> **Luật rút ra, áp cho mọi test confinement:** một test "không ghi ra ngoài" chỉ có nghĩa khi **đường
> ghi đó lẽ ra phải thành công**. Nếu đích không tồn tại thì bạn đang test hệ thống file, không phải code.

**③ 🟡 `Host` phân biệt hoa thường (2.3), đã sửa.** Hostname là case-insensitive (RFC 3986 §3.2.2), nên
`Host: LOCALHOST:4123` không khớp và **không** được canonicalise. Fail-safe (không redirect nhầm) nhưng
để hở bẫy split-history cho đúng caller nào viết hoa. Thêm `.toLowerCase()` + 1 test.

**Đã kiểm và KHÔNG có vấn đề** (ghi lại để khỏi lo lại): `runs.jsonl` được `redactSecrets` ở **cả hai**
đường — lúc ghi (`run-transcript.ts:138`) và lúc vào zip (`text()` trong `bundle.ts`) · hook redirect đặt
**sau** phép kiểm CSRF nên mutation bị từ chối vẫn bị từ chối · `/api/tasks/:id/stream` nằm dưới `/api/`
nên không bao giờ bị redirect · `readLastAskMeta` đọc dòng assistant cuối bất kể làn nào tạo ra nó —
giống hệt `readLastAsk` trước đây, nên không phải hồi quy.

---

## 3. ĐỢT 2 — lưới an toàn (ngay sau Đợt 1, hoặc song song nếu có người)

> ## ✅ HOÀN TẤT 2026-08-20
> Server **1077/1077 pass** (252 suite) · web **380/380** (32 file) · typecheck sạch.
> **22 test mới.** Cả hai guard chống race **đã chứng minh đỏ khi bị phá**.
> Việc còn lại: **Đợt 3** (§4) — nhưng nó cố ý chờ dữ liệu thật từ tester, không lên lịch trước.

### 3.1 · Build tự lành lịch sử ask từ đĩa `[099 S1]` ✅ **ĐÃ SHIP 2026-08-20**

> **Server:** `GET /api/tasks/:id/chat?have=<n>` trong `routes/tasks.ts` · `tailChatPairs` +
> `countChatPairs` (thuần, trong `ask.ts`) · kind `history_gap`. **Client:** `api.getTaskChat` ·
> module thuần mới `web/src/lib/ask-backfill.ts` · `backfillAskHistory` gọi từ `openTask`, **không
> await**. **20 test mới** (7 route, 13 hàm thuần, 7 wiring).
>
> **Cắt đuôi theo CẶP, không theo dòng.** Cắt giữa cặp sẽ khiến mảng bắt đầu bằng dòng assistant, mà
> client ghép cặp liền kề — mọi câu trả lời sau đó bị gán sang câu hỏi khác. Âm thầm, và trông rất hợp lý.
>
> **`?have=` chỉ log khi LỆCH.** Ca thường ngày im lặng tuyệt đối, nếu không timeline thành nhiễu và
> không ai đọc nữa. Con số `disk=53 browser=87` là thứ ba lần chẩn đoán sai mới có được, và trên máy
> tester thì **không thể xin** — giờ nó tự ghi.
>
> **Lý do backfill-không-rebuild đã ĐỔI, quyết định thì không.** Lập luận cũ (browser 87 > đĩa 53) chỉ
> đúng với data cũ; máy cài mới thì đĩa là tập cha. Nhưng `chat.jsonl` **không biết gì về `run`/`gate`**,
> nên rebuild sẽ xoá sạch timeline phase để khôi phục hội thoại. Đã ghi vào header module để không ai
> "tối ưu" nó thành rebuild.
>
> **Dấu mốc chỉ hiện khi thật sự mơ hồ** — lỗ ở giữa (thứ tự hiển thị không còn là thứ tự thật) hoặc
> server đã cắt bớt. Khôi phục đúng phần đuôi thì im lặng: không có gì để nói, và một banner mỗi lần mở
> là nhiễu.
>
> **Cố ý KHÔNG làm:** stamp `at` lên item `qa` (099 Q5). Đĩa có sẵn timestamp và nó sẽ cho phép xen
> đúng vị trí sau này, nhưng nó thêm một field vào `LiveThreadItem` mà bản sửa này không cần. Hoãn có
> chủ ý, không phải bỏ sót.

#### Ba thứ tìm ra khi implement 3.1

**① 💥 OOM vì fixture, không phải vì code.** Test wiring đầu tiên **giết worker, không ra một dòng
output nào**. Nguyên nhân: ở gate mà snapshot thiếu `artifactContents`, `applyTask` **re-fetch rồi gọi
lại chính nó** ([store.ts:541–542](../../apps/builder/web/src/store.ts:541)); mock luôn trả cùng snapshot
⇒ đệ quy vô hạn. Thực tế không lặp vì GET thật có contents. Đã ghi luật vào chính fixture.

**② 🟠 Test GUARD 1 đầu tiên là TRANG TRÍ.** Nó assert gate card do `applyTask` đẩy vào vẫn còn — nhưng
card đó đã nằm sẵn **trước** khi fetch bắt đầu, nên test **pass ngay cả khi cố ý phá guard**. Viết lại
để thread đổi **trong lúc request đang bay** (một phase bắt đầu chạy). Giờ phá guard → đỏ.

> **Cùng một luật với vụ confinement ở §2.5:** một test "X sống sót" chỉ có nghĩa khi X **được tạo ra
> bên trong đúng cửa sổ** mà guard bảo vệ. Nếu nó có mặt từ trước thì bạn đang test hằng số.

**③ 🟡 `mockRejectedValue` giết worker.** Nó dựng promise bị reject **ngay lúc set-up**; nếu lời gọi bị
hoãn, runtime thấy unhandled rejection và giết worker trước khi chạy assert nào. Đổi sang
`mockImplementation(() => Promise.reject(...))` — dựng lúc GỌI, và được await trong try/catch.

### 3.1 (chi tiết gốc)

**Vì sao vẫn cần dù data sạch:** `THREAD_MAX = 20`. Tester chạy tới build thứ 21 là thread của build
đầu bị `removeItem` **im lặng**; mở lại thì sạch bóng mọi câu đã hỏi.

**Lưu ý lý do đã ĐỔI:** lập luận cũ của 099 (*"87 `qa` trong browser > 53 cặp trên đĩa nên phải hợp
chứ không thay"*) **không còn đúng** với data sạch — đĩa giờ là **tập cha** của hội thoại. Nhưng
quyết định **backfill chứ không rebuild** vẫn đứng, vì một lý do khác và mạnh hơn: `chat.jsonl`
**không biết gì về `run`/`gate`**, nên rebuild sẽ **xoá sạch timeline phase**. Ghi lại để lần sau
không ai "tối ưu" nó thành rebuild.

**Server** — route mới trong `server/routes/tasks.ts`:

```
GET /api/tasks/:id/chat?have=<n>  →  { chat: ConsultChatLine[], dropped?: number }
```

- Dùng lại `readConsultChat` ([ask.ts:1014](../../apps/builder/server/lib/ask.ts:1014)). Không hàm
  đọc mới, không định dạng mới. Không đụng nhánh `kind === 'consult'`.
- Cap **50 cặp cuối**, phần cắt báo qua `dropped`.
- `?have=<n>` = số item `qa` client đang có. **Lệch** số cặp trên đĩa → ghi **một** dòng
  `events.jsonl` `history_gap`, `detail: 'disk=N browser=M backfilled=K'`. **Khớp → không ghi gì.**
- **Không** đổi một byte nào của `GET /api/tasks/:id`.

**Client:**

- `web/src/api.ts` thêm `getTaskChat` (cạnh `getTask`, [api.ts:94](../../apps/builder/web/src/api.ts:94)).
- Hàm **thuần** mới `web/src/lib/ask-backfill.ts`: ghép cặp `(user, assistant)` liền kề → dựng
  **multiset** text câu hỏi đã `trim` từ các item `kind==='qa'` → append phần thiếu vào **cuối**,
  mỗi cặp thành hai item (`{kind:'user'}` + `{kind:'qa', done:true}`), kèm `cost`/`sessionReset` nếu có.
- Gọi trong `openTask` ([store.ts:1818](../../apps/builder/web/src/store.ts:1818)), **chỉ nhánh build**.

**Hai guard BẮT BUỘC** (lời gọi này resolve **sau** `applyTask` và `openStream`):

1. Merge lên **`thread.value` hiện tại**, không phải biến `restored` — nếu không sẽ nuốt mất gate card
   mà `applyTask` vừa đẩy vào.
2. Kiểm **`task.value?.taskId === taskId`** ngay trước khi gán — nếu không, người dùng bấm sang task
   khác giữa lúc chờ mạng sẽ bị **dán lịch sử task A vào task B**. Đây là mất dữ liệu **tệ hơn** bug
   đang sửa.

Hỏng/timeout → **bỏ qua im lặng**, thread giữ nguyên. Đây là đường *thêm vào*, không bao giờ được làm
hỏng đường mở task.

**Dấu mốc trên UI: chỉ khi `dropped > 0` hoặc thứ tự đáng ngờ.** Khôi phục đủ và đúng chỗ thì **im
lặng với người dùng, nhưng vẫn ghi `history_gap`**. Hai khán giả, hai kênh.

**Không mang field `ok` sang** — `LiveThreadItem` kind `'qa'` không có ô chứa nó
([store.ts:87](../../apps/builder/web/src/store.ts:87)), và không cần: `recordAsk` ghi *"`text` là thứ
NGƯỜI ĐỌC ĐÃ THẤY, notice included"* ([ask.ts:977](../../apps/builder/server/lib/ask.ts:977)), nên
dòng ⚠ đã nằm sẵn trong `text`.

### 3.2 · Một dòng của `[099 S2]` ✅ **ĐÃ SHIP 2026-08-20**

> `_lastPersisted = json` chuyển xuống **sau** `setItem`. **Đỏ-khi-revert đã chạy.** Hai test ở
> `store.persistFlush.test.ts`: một chứng minh lần ghi sau vẫn **thử lại** sau khi ném, một là regression
> khoá dedupe không bị hỏng theo.
>
> **Một defect trong test của tôi, đã sửa:** `spy.mockRestore()` viết inline **không chạy** khi assert
> phía trên ném, nên mock rò sang test sau và biến một lỗi thật thành một chuỗi lỗi giả. Chuyển sang
> `vi.restoreAllMocks()` trong `afterEach`. Cùng loại lỗi với vụ teardown treo ở §2.5 — cleanup phải
> **vô điều kiện**.

### 3.2 (chi tiết gốc)

[store.ts:839](../../apps/builder/web/src/store.ts:839) — chuyển `_lastPersisted = json` xuống **sau**
`setItem` thành công. Hiện nó gán **trước** ([:839](../../apps/builder/web/src/store.ts:839) →
[:840](../../apps/builder/web/src/store.ts:840)), nên **một lần ghi hỏng là bộ dedupe tin rằng đã
xong** và không bao giờ thử lại.

**Bỏ toàn bộ phần còn lại của S2** (retry, đá LRU giảm tải, `persistDegraded`, banner): quota đã bị
bác bỏ (2,07/5 MB, dư 2,88 MB) và trên máy sạch nó còn xa hơn nữa. Một dòng này đúng vô điều kiện;
phần còn lại là máy móc cho một ca chưa xảy ra.

---

## 4. ĐỢT 3 — sau khi tester chạy 1–2 tuần, quyết định dựa trên bundle THẬT

Không lên lịch trước. Xếp lại theo những gì hồ sơ tester thực sự cho thấy.

| Việc | Kích hoạt khi |
|---|---|
| `[100 S2]` chèn N cặp cuối vào seed phiên reset | bundle cho thấy `sessionReset` vẫn xảy ra sau 2.1 |
| `[100 S3]` `sessionHistory` trong `task.json` | cần khôi phục một phiên bị bỏ |
| `[099 S1b lớp 2]` tab thụ động **hiển thị** lượt vừa lỡ | tester báo "tab kia không thấy câu tôi vừa hỏi" |
| `[099 S3]` bóc gọn `gate.snapshot` | localStorage một máy tester chạm ~4 MB |

**Spike riêng, ngoài đường găng: `[100 S0]` đo `context_window` qua `PreCompact`/`PostCompact`.**
`[CHƯA KIỂM]` — chưa xác nhận CLI có bắn hook đó ở chế độ headless Builder dùng hay không. Phép kiểm
rẻ: thêm hai hook vào `apps/builder/headless-settings.json` (file này **đã** có `hooks.PreToolUse`)
ghi ra một file tạm, chạy một ask dài tới lúc compact, xem có dòng nào không. **Không đưa lên lịch
tới khi câu hỏi đó có câu trả lời**, và 2.1 cố ý **không** phụ thuộc nó.

---

## 5. Đã DROP — đừng thêm lại mà không đọc §1

| Bỏ | Lý do một dòng |
|---|---|
| **099 S5** mục 1, 2, 3 | Máy sạch ⇒ **20/20** build có `runs.jsonl` ⇒ không còn tín hiệu để xếp hạng, cảnh báo không bao giờ đúng, ca "build đời cũ" không thể tồn tại |
| **099 S2** phần retry/giảm-tải/`persistDegraded` | Quota đã bị bác bỏ; máy sạch còn xa hơn |
| **099 §6 Q6** cứu ~34 ask tiền-transcript | Data cũ không còn liên quan |
| Đồng bộ đa tab (BroadcastChannel) | Đã là non-goal của 099 — và khi nào Builder chuyển sang server-authoritative thì bài toán **tự biến mất** |

---

## 6. Thứ tự và một ràng buộc KHÔNG được vi phạm

```
2.1 → 2.2 → 2.3 → 2.4 → 2.5   ‖   rồi   3.1 → 3.2
```

Trong Đợt 1, năm việc **độc lập** với nhau — làm thứ tự nào cũng được, gộp một PR cũng được.

**Ràng buộc cứng: `2.1` phải ship TRƯỚC `3.1`.** Nếu ship 3.1 trước, người dùng sẽ thấy lịch sử hiện
lại **đầy đủ** trên màn hình, hỏi tiếp, và model vẫn nói *"tôi không nhớ"* — **trông tệ hơn hiện
tại**, vì giờ có bằng chứng ngay trước mắt rằng nó đáng lẽ phải nhớ. Đây là ca hiếm mà một bản sửa
đúng, ship sai thứ tự, làm trải nghiệm **xấu đi**.

> Lý do sâu hơn: hai spec sửa **hai kênh khác nhau**. 099 sửa *hiển thị* (localStorage ← `chat.jsonl`);
> 100 sửa *ngữ cảnh của model* (`claude --resume` ← `chat.jsonl`). Xem
> [099 §4.1](099-build-ask-history-survives-the-browser.md).

---

## 7. Nghiệm thu tổng

Test mới **phải đỏ-khi-revert-fix**. Slice không có dòng nào ở đây là slice chưa xong.

| # | Việc | Test | Ở đâu |
|---|---|---|---|
| 1 | 2.1 | ✅ Ngưỡng mặc định mới; env dưới sàn `50_000` vẫn bị nâng — *đỏ khi chạy với env 300k* | `test/ask-cost.test.ts` |
| 2 | 2.1 | ✅ Lượt trước là **lượt đầu của phiên vừa reset** và vượt ngưỡng → **không** reset, `log.warn` mang `tokens` + `limit` thật | như trên |
| 2b | 2.1 | ✅ **Không phải ân xá trọn gói**: cùng cost/limit, cờ `false` → **vẫn** reset; dưới ngưỡng → no-op dù cờ bật | như trên |
| 3 | 2.1 | ✅ **Regression**: lượt trước dưới ngưỡng → không reset, hành vi y hệt hôm nay | như trên |
| 4 | 2.1 | ✅ `readLastAskMeta` đọc cost + cờ; **không** transcript → `{sessionReset:false}`. Kèm **regression: `readLastAsk` không mọc thêm field nào** (non-goal 099) | như trên |
| **8** | **2.2** | ✅ 🔒 **CANH CỬA**: `askWithin` + `askTestWithin` × {sạch, lỗi} → **không** phát `task:update`; đồng thời assert `ask:done` **có** mặt | `test/ask.test.ts` |
| 5 | 2.2 | ✅ `applyAskDone` với `idx === -1` → **không** gán `thread.value` (identity mảng không đổi) — *đỏ khi revert* | `web/src/store.test.ts` |
| 5b | 2.2 | ✅ Thread **rỗng** → cũng giữ nguyên reference — *đỏ khi revert* | như trên |
| 6 | 2.2 | ✅ **Regression**: `idx !== -1` vẫn publish + fold `cost`/`seededFrom`/`sessionReset`, `asking` về false | như trên |
| 7 | 2.2 | ✅ **Regression**: chunk đệm + `idx === -1` → vẫn bị **vứt** (guard không sinh thêm nuốt chunk) | như trên |
| 9 | 2.3 | ✅ `GET` tài liệu tới host `localhost` → **308**, giữ path + query; tới `127.0.0.1` → không đổi | **`test/canonical-host.test.ts`** (mới) |
| 10 | 2.3 | ✅ `POST /api/tasks/:id/ask` tới `localhost` phục vụ bình thường, **không** redirect; mã pin qua hằng dùng chung với `index.ts` | như trên |
| 10b | 2.3 | ✅ **OPEN REDIRECT**: `//evil`, `///evil`, `http://evil` → không redirect | như trên |
| 10c | 2.3 | ✅ Không `Host` · `Host` cổng khác · fetch/XHR · `/apiary` (khớp segment `/api`, không khớp prefix) | như trên |
| **10d** | **—** | ✅ **`test/origin.test.ts` (CSRF allowlist, T3/015 D6) còn nguyên vẹn** — 7 test bị ghi đè nhầm, đã khôi phục; `git diff` rỗng | `test/origin.test.ts` |
| 11 | 2.4 | ✅ `runs.jsonl` có mặt **và có nội dung** trong zip — *đỏ khi revert (2 test)*; không phụ thuộc `unzip` nên không bao giờ skip | `test/bundle.test.ts` |
| 12 | 2.5 | ✅ SSE đóng do **client ngắt** → `stream_close` đúng task, `clients=0` (số còn lại) — *đỏ khi revert* | `test/sse.test.ts` (mới) |
| 12b | 2.5 | ✅ **HAI tab** trên một build → `clients=1` rồi `clients=2`; đóng một → `clients=1` | như trên |
| 13 | 2.5 | ✅ `cleanup()` **idempotent**: socket destroy bắn cả `close` lẫn `error` → **đúng một** dòng | như trên |
| 13b | 2.5 | ✅ **Regression**: không `projectsDir` → không ghi gì, không ném | như trên |
| 13c | 2.5 | ✅ `clientsForTask` đếm **theo task**, không theo server | như trên |
| 14 | 3.1 | Route trả đủ cặp cho build có ask; mảng rỗng cho build chưa ask; cap 50 + `dropped` đúng | `test/ask-transcript.test.ts` |
| 15 | 3.1 | Route **không** đổi payload `GET /api/tasks/:id` — assert `chat === undefined` với build | như trên |
| 16 | 3.1 | `?have=N` lệch → **một** dòng `history_gap` đủ ba số; **khớp → không dòng nào**; thiếu `have` → cũng không | như trên |
| 17 | 3.1 | Backfill: thiếu 3 cặp → append 6 item, đúng thứ tự | `web/src/lib/ask-backfill.test.ts` (mới) |
| 18 | 3.1 | Backfill **no-op** khi multiset khớp hết | như trên |
| 19 | 3.1 | Câu hỏi **trùng text 2 lần**, thread giữ 1 → append đúng **1** (bẫy Set-vs-multiset) | như trên |
| 20 | 3.1 | Backfill **không đụng** item `run`/`gate` | như trên |
| 21 | 3.1 | Cặp khôi phục từ dòng `ok:false` giữ nguyên `text` (đã chứa ⚠) và **không** mang field `ok` | như trên |
| 22 | 3.1 | 🔒 **Guard race**: `/chat` resolve **sau khi** đã `openTask` sang task khác → task mới **không** bị chèn lịch sử task cũ | `web/src/store.test.ts` |
| 23 | 3.1 | 🔒 **Guard race**: `/chat` resolve sau khi `applyTask` đẩy gate card → gate card **còn nguyên** | như trên |
| 24 | 3.1 | **Regression**: consult và promote **không** đi qua đường backfill | như trên |
| 25 | 3.1 | Thread rỗng (vừa bị LRU đá) → append đủ, **không nhân đôi** với thứ `buildThreadFromRuns` dựng ra | như trên |
| 26 | 3.2 | `setItem` ném → `_lastPersisted` **không** bị gán → lần ghi sau thử lại | `web/src/store.persistFlush.test.ts` |

**Chạy:** `apps/builder` — server `node --test` + `tsx`, web `vitest`.

### Nghiệm thu bằng tay — điều kiện GIAO cho tester

| | Kịch bản | Đạt khi |
|---|---|---|
| M1 | Build `main.yml` ≥ 100 KB, hỏi 4 câu liên tiếp | **0** dòng `session reset`; không lượt nào model nói "tôi không nhớ" |
| M2 | Mở HAI tab cùng một build, tab B hỏi một câu | `JSON.parse(localStorage['builder.thread.<id>']).filter(x=>x.kind==='qa').length` **có tăng**; hard reload tab B thấy đủ |
| M3 | Mở `http://localhost:4123` | Địa chỉ nhảy về `127.0.0.1:4123`; đặt câu hỏi vẫn chạy (POST không hỏng) |
| M4 | `localStorage.removeItem('builder.thread.<id>')` rồi mở lại build *(sau Đợt 2)* | Các cặp ask hiện lại từ transcript |
| M5 | 🔑 **Thu bằng chứng** — dựng lại M2, export bundle, và **chỉ từ zip đó** trả lời được: có mấy tab · browser lệch đĩa bao nhiêu · khôi phục mấy cặp | Không đạt = nguyên tắc 6 của 099 chưa xong |

---

## 8. Hệ thống chạy ra sao sau khi implement

### 8.1 Ba kênh, và ai đọc kênh nào

| Kênh | Chứa gì | Ai đọc | Sống sót cái gì |
|---|---|---|---|
| **localStorage** `builder.thread.<id>` | thread hiển thị: `user` · `qa` · `run` · `gate` | trình duyệt | reload; **không** sống sót xoá cache / LRU / máy khác |
| **`chat.jsonl`** | mọi cặp hỏi–đáp, kèm `cost`/`sessionReset`/`ok` | *(sau 3.1)* UI · *(sau 100 S2)* seed của model · bundle | mọi thứ trừ xoá `.runs/` |
| **phiên CLI** `sessionIds.askTest` → `claude --resume` | trí nhớ thật của model | model | restart máy; **không** sống sót reset hoặc đổi máy |

Điểm dễ nhầm nhất, nói rõ: **khôi phục hiển thị KHÔNG khôi phục trí nhớ model, và không cần.** Sau
restart máy, câu hỏi kế tiếp `--resume` đúng phiên cũ nên model vẫn nhớ — kể cả khi localStorage sạch
trơn. Đó chính là sự cố 099: **UI mất 3 cặp, model không mất gì.**

### 8.2 Các case sử dụng

**UC-1 · Hỏi 5 câu liên tiếp trên build có `main.yml` lớn**
*Hôm nay:* câu 2 tốn ~400k token → vượt 300k → câu 3 chạy phiên mới, model nói *"tôi không đọc được
câu bạn đang trả lời"*. Câu 3 lại 442k → câu 4 reset tiếp. Gần như **mỗi lượt một lần quên**, mỗi
lượt ~$1.
*Sau 2.1:* ngưỡng nằm **trên** tải một lượt nặng → 5 câu **cùng một phiên**, model nhớ hết. Chi phí
giảm theo cấp số vì phiên sống lâu giữ nội dung file trong cache thay vì đọc lại. Nếu thật sự chạm
1M, reset vẫn xảy ra — nhưng sàn động bảo đảm **không reset hai lần liên tiếp**.

**UC-2 · Mở build ở tab thứ hai rồi hỏi ở tab đó**
*Hôm nay:* tab A vứt trắng mọi chunk, đến `ask:done` vẫn gán `thread.value` → persist → **ghi thread
thiếu đè lên bản đủ của B**. Reload tab B: cặp hỏi–đáp biến mất. Không cảnh báo gì.
*Sau 2.2:* tab A **không phát ra lượt ghi nào** (§1② chứng minh không còn đường nào khác). Bản của B
nguyên vẹn. Tab A vẫn chưa *hiển thị* cặp đó — việc của lớp 2, hoãn — nhưng reload là thấy đủ.

**UC-3 · Chạy tới build thứ 21, rồi mở lại build đầu**
*Hôm nay:* LRU đã âm thầm `removeItem`. Mở lại → chỉ còn requirement + vài attempt phase, **sạch bóng
mọi câu đã hỏi**.
*Sau 3.1:* timeline phase dựng từ `runs.jsonl` (xuống cấp: ~8 attempt × 6.000 ký tự, không gate card),
**nhưng** `GET /chat` mang toàn bộ hội thoại về và append lại. Server ghi
`history_gap: disk=12 browser=0 backfilled=12`. Tester thấy đủ; bạn thấy dấu vết trong bundle.

**UC-4 · Restart máy giữa build**
Trí nhớ model không phụ thuộc trình duyệt → hỏi tiếp vẫn nhớ. Cái mất là **hiển thị**, và 3.1 lấy lại.

**UC-5 · Bookmark `localhost:4123`**
*Hôm nay:* origin khác ⇒ **localStorage riêng** ⇒ cùng một build hiện lịch sử hoàn toàn khác, không
báo gì. Tester sẽ báo *"lịch sử lúc có lúc không"* và bạn đuổi theo một con ma.
*Sau 2.3:* 308 về `127.0.0.1` ⇒ **một lịch sử duy nhất**. `/api/*` không bị đụng nên không POST nào hỏng.

**UC-6 · Tester gặp lỗi và bấm Export**
*Hôm nay bạn nhận được:* zip có `chat.jsonl`, `task.json`, `transcripts/`, `events.jsonl`, 6 artifact
JSON — **thiếu `runs.jsonl`**, không dấu vết SSE, và **không gì về trạng thái trình duyệt**. Với bug
loại 099 thì zip đó không xác nhận cũng không bác bỏ được điều gì.
*Sau Đợt 1+2:* cùng cái zip trả lời được ba câu trước đây phải nhờ tester dán console:

- *Có mấy tab cùng mở?* → `stream_open` / `stream_close` kèm số client
- *Trình duyệt lệch đĩa bao nhiêu?* → `history_gap: disk=N browser=M`
- *Khôi phục mấy cặp, có bị cắt không?* → `backfilled=K`, `dropped`

Đó là toàn bộ mục đích: **bạn mất quyền vào máy tester, nên mỗi hỏng hóc phải tự kể câu chuyện của
nó trong một file zip.**

### 8.3 Cái vẫn KHÔNG được sửa, nói thẳng

| Còn lại | Vì sao chấp nhận ở giai đoạn tester |
|---|---|
| Tab thụ động không **hiển thị** lượt vừa hỏi (chỉ reload mới thấy) | Không mất dữ liệu nữa. Lớp 2 ở Đợt 3 |
| Build thứ 21 làm mất **gate card** của build đầu | Xuống cấp, không mất hội thoại. S5 cũng không sửa được (§1①) |
| `persistDegraded` (hỏng ghi phía client) **không** tới được đĩa | Server không biết `setItem` của browser ném. Bịt cần endpoint telemetry — quyết định sản phẩm, không phải bản vá |
| Mỗi lần chỉ **một** build turn + **một** ask turn cho toàn server | N máy tester = N tiến trình riêng ⇒ không cắn. Chỉ thành vấn đề khi nhiều người dùng chung một server |


---

## 10. Rủi ro đã biết — đọc trước khi bắt đầu

Ghi ở đây vì một plan không nêu rủi ro là một plan chưa xong. Xếp theo mức đe doạ.

### R1 · 🔴 `askSessionTokens` đo bằng đơn vị KHÔNG bám theo chi phí

`askSessionTokens` cộng `inputTokens + cacheReadTokens + cacheCreationTokens`
([ask.ts:119](../../apps/builder/server/lib/ask.ts:119)). Nhưng **cache-read rẻ hơn input tươi khoảng
một bậc**. Nên một phiên sống lâu (đúng thứ 2.1 tạo ra) sẽ cho **con số TO mà hoá đơn NHỎ** — còn một
phiên vừa reset cho con số nhỏ mà hoá đơn to, vì mọi thứ phải đọc lại thành `cacheCreation`.

⇒ Ngưỡng đang **đo sai thứ**. Nâng 300k → 1M vẫn **đúng hướng** (nó nới cho phiên sống lâu, tức
hướng rẻ hơn), nhưng đừng tưởng con số đó là "ngân sách tiền". Đây chính là [100 Open Q1](100-ask-session-reset-doom-loop.md),
và là lý do `[100 S0]` (đo `context_window` thật) đáng làm dù S1 đã dập được triệu chứng.

**Không hành động ở Đợt 1** — chỉ đừng suy diễn từ con số đó.

### R2 · 🔴 2.1 GIẢM tần suất reset, không chắc XOÁ được nó

`[ĐO]` quỹ đạo thật: 400.661 → 442.253 → 118.884 → 65.714 → 475.096. Con số bị chi phối bởi **việc
đọc lại file TRONG một lượt** (`numTurns` có lượt tới 19), không phải lịch sử tích luỹ — nên nó
**không tăng đều**, mà nhảy theo việc câu hỏi có bắt đọc `main.yml` hay không.

Với ngưỡng 1M, một lượt nặng 475k không kích hoạt reset. Nhưng vài lượt nặng liên tiếp, cộng prefix
đi theo dưới dạng `cacheRead`, **có thể** vượt 1M. Hồ sơ 098 đã ghi một lượt **899k**.

⇒ **M1 ("4 câu, 0 reset") có thể TRƯỢT trên một build cực nặng.** Đó không phải lỗi của plan — đó là
phép đo. **Nếu M1 trượt thì làm gì:**

1. **Đừng nâng ngưỡng mù lần nữa.** Ghi lại quỹ đạo token thật của 4 lượt đó (lệnh ở [100 §5](100-ask-session-reset-doom-loop.md)).
2. Nếu reset xảy ra **≤1 lần / 4 câu** và **không hai lần liên tiếp** → **coi như ĐẠT cho tester**, và
   kéo `[100 S2]` (chèn transcript vào seed) từ Đợt 3 lên Đợt 2 — nó biến một lần quên thành một lần
   "nhớ 3 lượt gần nhất".
3. Nếu reset vẫn ≥2 lần / 4 câu → chạy spike `[100 S0]`. Ngưỡng đang đo sai thứ (R1), và nâng tiếp
   chỉ đổi tần suất chứ không đổi bản chất.

### R3 · 🟠 Tester xác thực `claude` bằng cách nào? — plan KHÔNG hỏi, và cần hỏi

`PhaseCost.totalCostUsd` mang chú thích *"may be absent on a **subscription** login"*
([task.ts](../../apps/builder/server/state/task.ts)). Nghĩa là hồ sơ rủi ro **khác hẳn** tuỳ cách
tester đăng nhập:

| Tester dùng | Nâng ngưỡng lên 1M nghĩa là | Cần làm |
|---|---|---|
| **Subscription** (login cá nhân) | không có hoá đơn — rủi ro là **chạm rate limit**, và `totalCostUsd` vắng nên mọi số tiền trong hồ sơ đều rỗng | chấp nhận; nhưng biết trước rằng dev-tip và ask-ledger sẽ trống |
| **API key** (nhất là key dùng chung) | trần chi phí **một lượt** được nới lên. Hồ sơ 098 ghi **$8,86** cho một lượt 899k | **phải chốt trước khi phát hành**: ai trả, có trần chưa |

**Đây là câu hỏi phải trả lời trước Đợt 1**, không phải sau. Nó không đổi code, nhưng đổi việc con số
1.000.000 là an toàn hay liều.

### R4 · 🟠 Trải nghiệm CÀI ĐẶT lần đầu — lỗ lớn nhất, và plan này KHÔNG chạm tới

Cả 099, 100 lẫn plan này đều giả định **Builder đã chạy được**. Nhưng với tester, thứ chặn đường đầu
tiên gần như chắc chắn **không phải** bug nào ở đây, mà là: `claude` CLI đã cài và đăng nhập chưa ·
Node đủ phiên bản chưa (`engines: >=22.6`) · `DIFY_PROJECTS_DIR` trỏ đúng chưa · quyền chạy
`scripts/update-and-run.command` · họ cập nhật bằng cách nào khi bạn sửa xong.

**Không có việc nào trong plan này giúp được một tester không mở nổi app.** Nếu chỉ có thời gian cho
một việc trước khi phát hành, một buổi cài thử **trên máy sạch, không phải máy bạn**, có giá trị cao
hơn bất kỳ dòng nào ở §2. Ghi ở đây thay vì im lặng, dù nó nằm ngoài phạm vi hai spec.

### R5 · 🟡 Ước lượng "dưới một ngày công" của §2 là LẠC QUAN

Đúng cho 2.2 (2 dòng) và 2.4 (1 dòng). Nhưng 2.1 cần mở rộng `readLastAsk` + điều kiện mới + test;
2.5 cần luồn `projectsDir` vào `SSEPluginOptions`, thêm 2 `RunEventKind`, và một file test mới. Ước
lượng thật thà hơn: **1–2 ngày cho Đợt 1**, cộng 1–2 ngày cho Đợt 2.

### R6 · 🟡 2.3 làm lịch sử cũ trên origin `localhost` thành vô hình

Tester nào đã dùng `localhost:4123` một thời gian rồi mới nhận bản vá sẽ thấy lịch sử "biến mất" —
thực ra nó vẫn nằm trong localStorage của origin cũ, chỉ không tới được nữa. Sau Đợt 2 thì hội thoại
tự lành từ đĩa, nên **chỉ mất phần timeline phase**. Với máy cài mới thì không có ca này. Chấp nhận.

### R7 · 🟢 Đã KIỂM và loại — ghi lại để không ai lo lại

| Lo ngại | Kết quả kiểm |
|---|---|
| `stream_open`/`stream_close` làm bẩn mục `## Flow` mà người đọc thấy trong hồ sơ | **Không.** `flowLines` dùng `switch` **không có `default`** ([dossier.ts](../../apps/builder/server/lib/dossier.ts)) — kind lạ bị bỏ qua. `turn_cost` đã là tiền lệ cho loại "chỉ máy đọc" |
| Lớp 1 của S1b có thể không đủ vì `applyTask` cũng ghi | **Đủ** — đường ask của build không phát `task:update`. Chứng minh đầy đủ ở §1② |

---

## 9. Đóng file này khi nào

Khi Đợt 1 + Đợt 2 đã ship và M1–M5 đã đạt: chạy `/spec-close 101`. Đợt 3 chưa làm thì chuyển sang
mục "để ngỏ" của `docs/prompts/runs/CAMPAIGNS.md` theo bảng "loại tri thức → nhà" ở
[README](README.md) — **đừng** xoá tay.
