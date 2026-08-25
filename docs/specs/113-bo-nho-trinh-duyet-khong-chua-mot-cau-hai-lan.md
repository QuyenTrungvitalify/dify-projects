# Spec 113 — Bộ nhớ trình duyệt không được chứa cùng một câu hai lần

> **Status**: **S1–S6 đã implement + test xanh 2026-08-25** (chưa commit; chưa đóng — còn 5 open question
> ở §7). Lập 2026-08-25 từ ca thật của user: banner
> 「このブラウザの保存領域が不足しているため、会話はこの端末に保存されていません」 hiện thường trực trên build
> `1787544155222`. Telemetry `persist_failed` của spec 099 S2′ đã ghi sẵn con số quyết định —
> **payload 3.991.111 ký tự cho MỘT build** — và trần thực của localStorage nằm **dưới 3,74 triệu** (mức
> mà lượt ghi đầu tiên đã fail), khớp với con số tài liệu 5MB/UTF-16 ≈ 2,6 triệu ký tự.
>
> **Bản 2 sau review** — review tìm ra một lỗi trong chính spec: **S1 bản 1 sai** (kê "allowlist 6 field"
> trong khi `GateCard` chuyển cả object cho `gateView`/`gate-foot`/`GateActions` = **~27 field**), S2
> thiếu bẫy tương thích ngược (⇒ đổi key sang `v2`), §1.3 chuyển từ ước lượng sang **tái dựng bằng thuật
> toán của server**, và hai con số sai đã sửa (run output **2,3%** chứ không phải 7%; gate **35** chứ
> không phải 33).
>
> **Đã ship gì (2026-08-25)** — web `vitest`: **501/501 xanh** (46 file, +1 file mới); `tsc --noEmit`
> sạch; `web/dist` đã build lại (máy user chạy dist, không chạy vite dev). Server **không chạm dòng nào**.
> Mọi lát code đã **bắn thử đỏ-khi-revert**, không phải tin lời:
>
> | Lát | Landed | Đỏ-khi-revert |
> |---|---|---|
> | S1 | [thread-persist.ts](../../apps/builder/web/src/lib/thread-persist.ts) `sseShapedSnapshot` | 2 test đỏ (tập khoá + trần 250k cho 35 gate); test "render y hệt qua round-trip" vẫn xanh — đúng vai của nó |
> | S2 | `slimItem` nhánh qa + `parseThread` dựng lại | 1 test đỏ ("writes the text once") |
> | S3 | `serializeThreadCapped` + `evictToBudget` | 5 test đỏ (cắt, trần `TRIM_MAX_PAIRS`, giữ cặp đang mở, không để bubble cụt, ngân sách tổng) |
> | S4 | `sweepOrphanThreadKeys` | 2 test đỏ |
> | S5 | `retryAfterEviction` | 2 test đỏ |
> | S6 | `storageReadout` + dòng `cache` trong DevPanel | doc-only (đọc, không ghi) |
>
> **Kết quả đo trên thread thật** (dựng lại build `1787544155222`, §4): **4,905M → 1,624M (−67%) sau
> S1+S2**, còn **1,398M** sau khi áp trần S3 (cắt 16 lượt cuối, đều nằm trong cửa sổ backfill 50 cặp).
> Hằng số `PER_BUILD_CAP` đã **đổi 1,0M → 1,4M sau khi quét đo** — 1,0M không lưu ít hơn mà chỉ vứt gấp
> ba lượng lịch sử (bảng ở §3/S3).
>
> **Một lỗi thật do phép thử đỏ-khi-revert tìm ra**: test cooldown của S5 **không đỏ** khi gỡ cooldown —
> vì bản đầu chỉ ghi index ở **đường thành công**, nên một retry thất bại để lại index khai những payload
> đã xoá; vòng sau "evict" lại chính các entry chết đó và giải phóng **0 byte**. Đã sửa: ghi index ngay
> sau khi evict, trước khi retry.
>
> **Câu hỏi user hỏi là "xoá bớt data cũ được không?" — và câu trả lời đo được là KHÔNG, đó là hướng sai.**
> **Hơn 3/4 payload là bản sao** của dữ liệu đang nằm ngay trong cùng payload hoặc trên đĩa server
> (§1.3, tái dựng bằng thuật toán của server). Vấn đề là **trùng lặp**, không phải tuổi.
>
> Phạm vi — **sáu lát, bốn nguyên tắc**:
> **S1** snapshot gate chỉ giữ **hình dạng SSE**, bỏ đúng phần `GET` gắn thêm (`runs`/`lastAsk`/`runCosts`) ·
> **S2** thôi lưu câu hỏi **hai lần** (`user.text` + `qa.question`) ·
> **S3** ngân sách ký tự **cưỡng chế trước khi ghi** (per-build + tổng), cắt theo tiền tố ·
> **S4** quét key mồ côi `builder.thread.*` ·
> **S5** evict-and-retry khi vỡ quota — **có chặn**, chỉ là lưới đỡ ·
> **S6** ô đọc dung lượng trong ⚙ dev panel để lần sau là một con số, không phải một cuộc điều tra.
>
> **Không chạm**: 033 D6 (backend **không** giữ transcript hiển thị — mọi lát ở đây là client-only, trừ đọc
> lại đường `/chat` đã có) · `RUN_OUTPUT_CAP` (đo ra chỉ ~7% payload — sửa nó là sửa nhầm chỗ) ·
> `CHAT_TAIL_PAIRS = 50` (S3 được thiết kế để **nằm gọn trong** cửa sổ này, không cần nới) · nén
> (lz-string) · IndexedDB · câu chữ của banner.
>
> **Liên quan**: **099** — S2′ chính là thứ khiến spec này không phải đoán ([tasks.ts:521](../../apps/builder/server/routes/tasks.ts:521));
> `27f0fc0` (2026-08-18, "a phase's reasoning outlives the browser too") — commit thêm `runs` vào `WireTask`
> và **vô tình** thổi phồng mọi snapshot gate được persist; **112** — cùng build `1787544155222`.

---

## 0. Nguyên tắc

1. **Quota vỡ vì trùng lặp, không vì tuổi.** Trước khi xoá bất cứ thứ gì của người dùng, phải trả lời được:
   payload này chứa mấy bản của cùng một chuỗi? Ở ca này là **hai** (câu hỏi) và **ba mươi ba** (run output).
2. **Đĩa dựng lại được ⇒ client chỉ là cache. Chỉ client có ⇒ không được vứt im lặng.** Đây là thứ quyết
   định *cắt đầu hay cắt đuôi* — và câu trả lời ngược với trực giác (§3.3).
3. **Chặn bằng cấu trúc, không bằng phản ứng.** Ngân sách cưỡng chế **trước** lệnh ghi mạnh hơn bắt
   `QuotaExceededError` rồi xoá: lúc bắt được lỗi thì đã không còn thông tin nào để quyết định xoá đúng.
4. **Payload persist phải là allowlist.** Lỗi này sinh ra vì **một field mới ở tầng server tự chui vào
   payload localStorage** mà không ai phải sửa một dòng client nào. Blacklist (`artifactContents: undefined`)
   sẽ thủng lại y hệt ở field nặng tiếp theo.

---

## 1. Sự cố — build `1787544155222`

### 1.1 Một câu

Mỗi thẻ gate lưu **nguyên một `WireTask`**; từ 2026-08-18 `WireTask` mang theo tối đa 48.000 ký tự run
output; build này đi qua **35 gate** ⇒ localStorage phải nuốt hàng triệu ký tự **lặp lại** cùng một log —
cộng với việc mỗi câu hỏi của user được lưu **hai lần** — nên payload đạt **3,99 triệu ký tự**, gấp ~1,5 lần
quota, và mọi lượt ghi từ 14:11 ngày 25/08 đều thất bại.

### 1.2 Bằng chứng

| Nhãn | Số đo |
|---|---|
| `[ĐO]` | `persist_failed` **n=24 sự cố**, từ **chính máy user** (`events.jsonl`). Payload **3.742.812 → 3.991.111** ký tự trong 5 giờ (14:11 → 19:14 ngày 25/08). Đây là số browser tự khai, không phải suy đoán. |
| `[TÀI LIỆU + suy ra]` | Quota localStorage ≈ 5MB, tính theo **byte UTF-16** ⇒ ngân sách ≈ **2,6 triệu ký tự**. Con số 5MB là tài liệu, **không** đo trên máy này; cái ĐO được là: ghi **3.742.812 ký tự thì fail** ⇒ trần thực nằm **dưới** mức đó. Mọi kết luận dưới đây chỉ cần cận trên này, không cần con số 5MB đúng. |
| `[ĐO]` | `chat.jsonl`: **102 lượt** — user **874.400** ký tự, assistant **295.011** ký tự. Câu hỏi dài nhất: **144.929** ký tự (user dán tài liệu — hành vi bình thường của app này). |
| `[ĐO]` | `events.jsonl` lúc **19:44 ngày 25/08**: `gate_reached` = **35** · `phase_start` = 40 · `turn_cost` = 32. Build **vẫn đang chạy** trong lúc viết spec (35 lúc 19:44 vs **33** lúc 19:17) — mọi số ở đây là **ảnh chụp**, không phải giá trị cuối. |
| `[ĐO]` | `runs.jsonl`: **39 attempt**. Item `run` trong thread (đã áp `RUN_OUTPUT_CAP`) = **93.677** ký tự ⇒ **2,3%** payload. Cap 32k/run **không phải** vấn đề. |
| `[ĐO code]` | **Snapshot gate mang `runs`.** Ở mỗi gate, snapshot SSE không có `artifactContents` ⇒ client tự fetch lại: `void api.getTask(t.taskId).then(applyTask)` ([store.ts:584](../../apps/builder/web/src/store.ts:584)). GET này là đường **duy nhất** gắn thêm `runs` (≤48.000 ký tự), `runCosts`, `lastAsk` ([tasks.ts:438-450](../../apps/builder/server/routes/tasks.ts:438)) — `toWireTask` của SSE **không** có chúng. `applyTask` gán `items[i] = { ...it, snapshot: t }` ([store.ts:561](../../apps/builder/web/src/store.ts:561)), còn `serializeThread` chỉ bóc **`artifactContents`** ([thread-persist.ts:46](../../apps/builder/web/src/lib/thread-persist.ts:46)). ⇒ mỗi gate persist kèm một bản run log. |
| `[ĐO code]` | **Câu hỏi lưu hai lần.** Mỗi lượt hỏi push `{kind:'user', text}` **và** `{kind:'qa', question: text}` ([store.ts:1722-1723](../../apps/builder/web/src/store.ts:1722), consult: [store.ts:1348-1350](../../apps/builder/web/src/store.ts:1348)). Cả hai đều được persist nguyên văn. |
| `[ĐO]` | `history_gap` mới nhất: **disk=102, browser=57** — từ 14:11 browser đứng hình ở 57 lượt trong khi đĩa vẫn ghi đủ. Triệu chứng khớp: localStorage chết, `chat.jsonl` sống. |

### 1.3 Payload cộng lại có khớp không

Phần snapshot gate **không còn là ước lượng**: nó được **tái dựng bằng chính thuật toán của server**
(`readRunAttempts`, cap 6.000/attempt + 48.000 tổng) trên `runs.jsonl` + `events.jsonl` + `chat.jsonl`
tại **đúng thời điểm từng gate** (script ở §4).

| Thành phần | Ký tự | Nhãn |
|---|---|---|
| Câu hỏi × **2** (`user.text` + `qa.question`) | **1.748.896** | `[ĐO]` |
| `runs` trong 35 snapshot gate | **1.412.089** | `[ĐO tái dựng]` |
| `lastAsk` trong 35 snapshot gate (**không có cap**, max **87.705**/snapshot) | **638.755** | `[ĐO tái dựng]` |
| Câu trả lời | **296.502** | `[ĐO]` |
| Các field `task.json` × 35 snapshot | **208.355** | `[ĐO tái dựng]` |
| `runCosts` × 35 snapshot | **156.456** | `[ĐO tái dựng]` |
| Item `run` (đã cap 32k) | **93.677** | `[ĐO]` |
| **Mô hình cộng lại** | **4.554.730** | vs **đo được 3.991.111** |

*(Ảnh chụp 19:17→19:44 ngày 25/08, khi build còn đang chạy — chạy lại script §4 lúc 19:45 ra **36 gate /
2.484.046**. Chính độ trôi này là lý do mọi số ở đây phải có mốc giờ.)*

**Mô hình cao hơn số đo 14%, và phải nói ra chứ không được làm tròn cho khớp.** Nguyên nhân khả dĩ nhất:
**không phải cả 35 gate đều sống trong thread** — `hydrateForReopen` bỏ gate chưa resolve ở **mỗi lần mở
lại** ([thread-persist.ts:79](../../apps/builder/web/src/lib/thread-persist.ts:79)), và user đã reload nhiều
lần trong 2 ngày. Hạ xuống ~30 gate là mô hình khớp trong 5%.

Kết luận **không phụ thuộc** sai số đó, vì thứ tự các số hạng vẫn nguyên:

> **~55% payload là `runs` + `lastAsk` + `runCosts` bị chép lại trong từng thẻ gate** (2,21 triệu ký tự),
> **~22% là bản sao thứ hai của câu hỏi** (874.448). Cộng lại: **hơn ba phần tư payload là bản sao.**

### 1.4 Chẩn đoán SAI đã loại

- **"Xoá bớt build cũ (LRU-20) là đủ."** **Bác bỏ bằng số**: `THREAD_MAX = 20` cap **số build**, không cap
  byte ([store.ts:873](../../apps/builder/web/src/store.ts:873)). Một build **đơn lẻ** đã 3,99M > quota 2,6M ⇒
  xoá sạch 19 build kia vẫn **không** cứu được lượt ghi. Đây là hướng đầu tiên tôi đề xuất và nó sai.
- **"Cap run output 32k còn rộng quá."** Bác bỏ: run output = 7% payload.
- **"User dùng lâu nên data tích tụ."** Bác bỏ: build này mới **2 ngày tuổi** (tạo 24/08, vỡ quota 25/08).

---

## 2. Vì sao `evict-and-retry` không được đi đầu

Nó là phản xạ đúng với *triệu chứng* và sai với *nguyên nhân*, và mang bốn rủi ro thật:

1. **Bão evict đổi lấy số 0.** Build đang mở tự nó 3,99M. Vòng "xoá cái cũ nhất rồi thử lại" xoá hết 19
   build khác **và vẫn fail**. Mất dữ liệu để đổi lấy không gì cả.
2. **Safari private mode quota = 0.** `isQuotaError` **cố ý** gộp quota với private-mode
   ([store.ts:905](../../apps/builder/web/src/store.ts:905)) — vô hại khi chỉ bật banner, thành phá hoại khi
   nó điều khiển lệnh xoá.
3. **Đa tab.** Tab A xoá key build tab B đang mở. Tự lành ở lượt ghi kế của B, trừ khi B nằm im rồi reload.
4. **Jank.** Mỗi retry là một `setItem` **đồng bộ** vài MB trên main thread, giữa lúc stream (debounce
   500ms / max-wait 3s — [store.ts:1029](../../apps/builder/web/src/store.ts:1029)).

⇒ Giữ nó, nhưng **là S5, có chặn**, sau khi S1–S3 làm nó gần như không bao giờ phải chạy.

---

## 3. Slices

### S1 — snapshot gate chỉ được giữ phần SSE, bỏ phần GET tự gắn thêm (lát lớn nhất)

> **Sửa lại 2026-08-25 sau review**: bản đầu của lát này viết "allowlist 6 field" và **sai**. `GateCard`
> không tự đọc `task` — nó **chuyển cả object** cho `gateView(task)` ([Chat.tsx:265-440](../../apps/builder/web/src/components/Chat.tsx:265),
> đọc **22 field**), `canUndoFix` + `terminalFootActions` ([gate-foot.ts:42,63](../../apps/builder/web/src/lib/gate-foot.ts:42),
> 6 field) và `GateActions` ([Chat.tsx:447](../../apps/builder/web/src/components/Chat.tsx:447), 4 field).
> Hợp lại **~27 field**. Một allowlist 27 tên là thứ sẽ hỏng âm thầm: thiếu `specStale` thì thẻ gate mở
> lại hiện sai badge, không ai thấy. Lát này vì vậy đổi trục.

**Bất biến (thay cho danh sách tên)**: **persist đúng hình dạng snapshot mà SSE gửi; không bao giờ persist
phần `GET /api/tasks/:id` gắn thêm.**

Phần "gắn thêm" là một tập **do server sở hữu và khai ở đúng một chỗ**
([tasks.ts:445-450](../../apps/builder/server/routes/tasks.ts:445)):
`artifactContents` (đang bỏ rồi) · `runs` · `runsDropped` · `runCosts` · `lastAsk` · `chat`.
`toWireTask` mà SSE dùng **không** có field nào trong số đó — nên "hình dạng SSE" là một định nghĩa có thật,
không phải quy ước ([tasks.ts:438](../../apps/builder/server/routes/tasks.ts:438)).

**Được** — số tái dựng bằng chính thuật toán `readRunAttempts`, không phải ước lượng (§1.3):

| Bỏ | Ký tự |
|---|---|
| `runs` | **1.412.089** |
| `lastAsk` | **638.755** |
| `runCosts` | **156.456** |
| **Tổng** | **~2,21 triệu** (~55% payload đo được) |

Phần **giữ lại** (các field của `task.json`) ≈ 5.100 ký tự/snapshot × 35 gate ≈ **180 nghìn**. Đắt hơn con
số "16 nghìn" của bản đầu, nhưng đổi lấy việc **không thể render sai** — và không đáng kể so với 2,21 triệu.

**Mất**: không gì. Snapshot sống luôn đến từ `applyTask` tươi; `hydrateForReopen` vốn đã bỏ mọi gate chưa
resolve ([thread-persist.ts:79](../../apps/builder/web/src/lib/thread-persist.ts:79)).

**Hai test, và cái thứ hai mới là cái giữ được lâu (đỏ-khi-revert cả hai)**:
1. **Theo tên**: gate item có `runs`/`lastAsk`/`runCosts`/`chat` ⇒ sau serialize, `snapshot` **không còn**
   key nào trong tập đó, và **vẫn còn** đủ 27 field render (assert bằng cách gọi thẳng `gateView` trên
   snapshot đã round-trip và so với `gateView` trên bản gốc — đo **kết quả render**, không đo tập khoá).
2. **Theo kích thước**: `serializeThread` trên một thread 35 gate ⇒ tổng phần `snapshot` **< 250.000** ký
   tự. Test này đỏ **kể cả khi field nặng mới có tên khác** và không ai nhớ cập nhật danh sách — đây là
   phần cơ học của nguyên tắc §0.4, danh sách tên chỉ là phần con người.

### S2 — thôi lưu câu hỏi hai lần

**Sửa**: `serializeThread` — khi item `qa` đứng **ngay sau** item `user` và `qa.question === user.text` thì
ghi `qa` **không kèm `question`**. `parseThread` dựng lại từ bubble `user` phía trước.

**Được**: **~874.000 ký tự** trên build này (~22% payload đo được).

**Mất**: không gì — round-trip phải bằng nhau tuyệt đối.

**Bẫy phải xử đúng**:
- `qa` mà `question` **không** bằng `user.text` liền trước ⇒ **giữ nguyên** `question`. Ca thật:
  `consultThreadFromChat` dựng `qa` với `question: ''` ([store.ts:1998](../../apps/builder/web/src/store.ts:1998)).
- Payload **cũ** (ghi trước lát này) vẫn có `question` ⇒ dựng lại chỉ khi **thiếu**, không đè.
- `backfillFromTranscript` khớp theo `qa.question` ([ask-backfill.ts:79](../../apps/builder/web/src/lib/ask-backfill.ts:79))
  — nên việc dựng lại phải nằm **trong `parseThread`**, trước mọi consumer.

**Bẫy thứ tư, phát hiện lúc review — và nó bắt buộc đổi tên key**:

Chỉ có **hai** nơi đọc `qa.question`, và **cả hai gọi `.trim()` thẳng**:
[ask-backfill.ts:73](../../apps/builder/web/src/lib/ask-backfill.ts:73) ·
[ask-recovery.ts:63](../../apps/builder/web/src/lib/ask-recovery.ts:63). Nghĩa là **payload MỚI + JS CŨ**
(một tab chưa reload sau khi build lại — 099 đã ghi nhận user chạy hai tab) ⇒ `undefined.trim()` ⇒ **ném
lỗi** ngay trong handler `init` của SSE.

⇒ **Đổi namespace key: `builder.thread.<id>` → `builder.thread.v2.<id>`.**
JS cũ không thấy key nào ⇒ rơi êm về đường dựng từ server; JS mới bỏ qua key cũ; S4 quét sạch key v1.
Phụ phẩm: **payload 3,99 triệu ký tự rác bị xoá ngay lần load đầu tiên** sau khi lên bản mới.

Giá phải trả, nói thẳng: **mọi thread đang cache trong localStorage mất một lần** ở lần nâng cấp. Mở lại
build cũ sẽ dựng từ server (`buildThreadFromRuns` + backfill Q&A) — **kém hơn** bản localStorage ở đúng một
điểm: prose của phase chỉ còn **6.000 ký tự/attempt** thay vì 32.000
([run-transcript.ts:293](../../apps/builder/server/lib/run-transcript.ts:293)).

**Test (đỏ-khi-revert)**: round-trip `serialize → parse` **đẳng thức sâu** với 3 hình dạng (qa có user liền
trước / không có / payload cũ đã có `question`), cộng một assert kích thước: payload chứa chuỗi câu hỏi
**đúng một lần**.

### S3 — ngân sách cưỡng chế trước khi ghi

**Hằng số** (đặt từ số đo, xem §3.3 để biết vì sao):

```
PER_BUILD_CAP  = 1_400_000  // ký tự UTF-16, một build
TOTAL_BUDGET   = 1_800_000  // ký tự, toàn bộ builder.thread.*
TRIM_MAX_PAIRS = 45         // trần số lượt được phép cắt (< CHAT_TAIL_PAIRS = 50)
```

> **Hằng số đặt bằng phép quét trên thread thật, không phải số tròn** (dựng lại thread của build
> `1787544155222` rồi chạy qua đúng serializer mới):
>
> | cap | lưu được | cắt mất |
> |---|---|---|
> | 1,0M | 1,260M (**không đạt cap**) | 45 lượt |
> | 1,2M | 1,260M (**không đạt cap**) | 45 lượt |
> | **1,4M** | **1,398M** | **16 lượt** |
> | 1,6M | 1,599M | 0 lượt |
>
> Cap chặt hơn 1,4M **không lưu ít hơn** — nó chạm sàn `TRIM_MAX_PAIRS` rồi vẫn lưu 1,26M, sau khi đã
> vứt gấp ba lượng lịch sử. Đó là lý do 1,0M (số ở bản spec đầu) bị loại **sau khi đo**.

**Thứ tự nhường chỗ, rẻ trước đắt sau**:

1. **Cắt tiền tố của build hiện tại** cho vừa `PER_BUILD_CAP`: giữ **tiền tố dài nhất** của thread mà
   serialize ra vẫn ≤ cap. Bỏ từ **đuôi**.
2. **Ngoại lệ bắt buộc**: luôn nối lại cặp `user` + `qa` **đang mở** (`done === false`) ở cuối, kể cả khi
   tiền tố đã đầy — lượt đang chạy **chưa nằm trên đĩa**: `appendChat` ghi **sau** khi lượt kết thúc
   ([ask.ts:1164](../../apps/builder/server/lib/ask.ts:1164), consult: [ask.ts:1451](../../apps/builder/server/lib/ask.ts:1451)).
   Không có ngoại lệ này thì reload giữa một lượt hỏi 8 phút = mất câu hỏi.
3. **Trần cắt**: nếu phải bỏ quá `TRIM_MAX_PAIRS` lượt thì **dừng cắt** và chuyển sang bước 4 — quá ngưỡng
   đó là đang vứt thứ đĩa **không** trả lại được (§3.3).
4. **Evict LRU các build khác** cho tới khi tổng ≤ `TOTAL_BUDGET` (chỉ số `builder.thread.index` đã có sẵn
   thứ tự). **Không bao giờ** evict build đang mở.

**Kèm theo**: `THREAD_MAX = 20` giữ nguyên như trần phụ.

**Test (đỏ-khi-revert)**: thread tổng hợp 2M ký tự ⇒ payload ghi ra ≤ cap · qa đang mở **luôn** có mặt ·
cắt dừng đúng ở `TRIM_MAX_PAIRS` · tổng mọi key ≤ `TOTAL_BUDGET` sau khi ghi build thứ ba.

### S3.3 — Vì sao cắt ĐUÔI, không cắt ĐẦU (quyết định dễ làm sai nhất)

`GET /api/tasks/:id/chat` trả về **50 cặp cuối cùng** (`tailChatPairs(all, CHAT_TAIL_PAIRS)`,
[tasks.ts:168](../../apps/builder/server/routes/tasks.ts:168)) — **không** phải "mọi thứ sau `have`";
`have` chỉ dùng để ghi một dòng `history_gap`.

Hệ quả, đúng theo nguyên tắc §0.2:

- **Đuôi (lượt mới nhất) là thứ đĩa trả lại được.** Cắt đuôi ⇒ `backfillFromTranscript` thấy khối thiếu
  **đúng là tail** ⇒ `isTail === true` ⇒ nối lại **đúng thứ tự, không cần marker**
  ([ask-backfill.ts:89](../../apps/builder/web/src/lib/ask-backfill.ts:89)).
- **Đầu (lượt cũ nhất) là thứ CHỈ browser có** khi build đã quá 50 lượt. Cắt đầu ⇒ mất vĩnh viễn, **và im
  lặng**: local đã phủ hết cửa sổ server phục vụ được nên backfill kết luận "không thiếu gì" và trả `null`.
- Vì vậy `TRIM_MAX_PAIRS = 45 < 50`: chừa **2 lượt** cho cặp chưa kịp ghi đĩa và **3 lượt** biên an toàn.

Giá phải trả, nói thẳng: sau reload, khối lượt được phục hồi nằm **cuối** thread (dưới thẻ gate cuối) thay
vì xen kẽ đúng chỗ. Với build này ảnh hưởng nhỏ — Ask gần như luôn diễn ra **tại** gate nên vốn đã nằm sau
thẻ gate. Cắt tiền tố cũng bỏ luôn thẻ gate sống ở cuối: **không mất gì**, `applyTask` cấp lại tươi.

### S4 — quét key mồ côi

`threadIndex()` trả `[]` khi JSON hỏng ([store.ts:878](../../apps/builder/web/src/store.ts:878)) ⇒ **toàn bộ**
`builder.thread.*` cũ thành rác **không ai xoá nữa**. Quét **một lần lúc load**: mọi key `builder.thread.*`
không có trong index → `removeItem`. Rẻ, không mất gì đang dùng.

### S5 — lưới đỡ evict-and-retry (có chặn)

Trong `catch` của `persistThreadNow` ([store.ts:992](../../apps/builder/web/src/store.ts:992)), khi
`isQuotaError`:

- chỉ chạy nếu `chars ≤ PER_BUILD_CAP` (payload không vừa thì xoá là vô nghĩa — §2.1);
- evict LRU **đúng số cần**, **không** đụng build đang mở;
- **tối đa 1 vòng**, và **không** thử lại trong ~60s sau một lần thất bại (chặn cả ca private-mode §2.2 lẫn
  jank §2.4);
- thất bại tiếp ⇒ giữ nguyên hành vi hôm nay: banner + `persist_failed` (099 S2′ vẫn là kênh duy nhất
  chạm được máy không ai đăng nhập vào được).

**Ràng buộc bắt buộc, đã có test canh sẵn**: rate-limit 60s chỉ áp cho **vòng evict-retry**, **không** áp
cho lượt ghi bình thường kế tiếp. Spec 101 §3.2 đã phải sửa đúng bug "một lần fail ⇒ tắt persist vĩnh viễn"
([store.ts:974-979](../../apps/builder/web/src/store.ts:974)), và test
`persistFlush.test.ts:112` ("setItem throws once → the NEXT flush still attempts the write") sẽ **đỏ** nếu
S5 làm sai chỗ này. Không được sửa test đó cho xanh — nó đang canh đúng thứ cần canh.

### S6 — ô đọc dung lượng trong ⚙ dev panel

Bảng: tổng ký tự, top-5 build theo ký tự, phần trăm `TOTAL_BUDGET`. Lý do tồn tại: lần này ta có số **chỉ
vì** 099 S2′ tình cờ ghi lại; lần sau phải là **một cái nhìn**, không phải một cuộc điều tra ba vòng.
`DevPanel.tsx` đã có sẵn khung bảng ([DevPanel.tsx:100](../../apps/builder/web/src/components/DevPanel.tsx:100)).

---

## 4. Đo lại (chạy được ngay, không cần server)

**Payload thật browser tự khai** — nguồn của mọi số ở §1:

```bash
grep persist_failed apps/builder/.runs/<taskId>/events.jsonl | tail -5
grep history_gap    apps/builder/.runs/<taskId>/events.jsonl | tail -3
grep -c gate_reached apps/builder/.runs/<taskId>/events.jsonl
```

**Phân rã Q&A theo vai** (chứng minh phần lặp của S2):

```bash
python3 - <<'EOF'
import json
u=a=nu=na=0
for line in open('chat.jsonl', encoding='utf8'):
    line = line.strip()
    if not line: continue
    o = json.loads(line)
    c = len(o.get('text', '').encode('utf-16-le')) // 2
    if o['role'] == 'user': u += c; nu += 1
    else:                   a += c; na += 1
print(f'user {nu} lines {u:,} chars | assistant {na} lines {a:,} chars')
print(f'thread cost hom nay (cau hoi luu 2 lan) = {u*2+a:,} | sau S2 = {u+a:,}')
EOF
```

**Tái dựng phần snapshot gate** (đây là phép đo dựng nên §1.3 — chạy trong thư mục `.runs/<taskId>/`):

```bash
python3 - <<'EOF'
import json
u16 = lambda s: len(s.encode('utf-16-le')) // 2
runs = [json.loads(l) for l in open('runs.jsonl', encoding='utf8') if l.strip()]
evs  = [json.loads(l) for l in open('events.jsonl', encoding='utf8') if l.strip()]
chat = [json.loads(l) for l in open('chat.jsonl', encoding='utf8') if l.strip()]
task = json.load(open('task.json'))
gates = [e['ts'] for e in evs if e.get('kind') == 'gate_reached']
costs = [e for e in evs if e.get('kind') == 'turn_cost']

def read_run_attempts(upto, max_total=48000, max_each=6000):   # bản sao readRunAttempts của server
    kept, used = [], 0
    for a in reversed([a for a in runs if a['ts'] <= upto]):
        out = a['output']
        if len(out) > max_each:
            out = f"[… {len(out)-max_each} chars truncated …]\n" + out[-max_each:]
        if used + len(out) > max_total and kept: break
        kept.insert(0, {**a, 'output': out}); used += len(out)
    return kept

R = C = L = 0
for g in gates:
    R += u16(json.dumps(read_run_attempts(g), ensure_ascii=False))
    C += u16(json.dumps([{'phase': e.get('phase',''), 'at': e['ts'], 'cost': e.get('cost')}
                         for e in costs if e['ts'] <= g], ensure_ascii=False))
    prev = [c for c in chat if c.get('at', 0) <= g]
    if len(prev) >= 2:
        L += u16(json.dumps({'q': prev[-2]['text'], 'a': prev[-1]['text'], 'ok': True}, ensure_ascii=False))
T = u16(json.dumps(task, ensure_ascii=False)) * len(gates)
print(f'gates={len(gates)} runs={R:,} lastAsk={L:,} runCosts={C:,} taskFields={T:,} => GATE TERM {R+L+C+T:,}')
EOF
```

**Trong browser** (nghiệm thu trước/sau — chạy ở tab Builder):

```js
Object.keys(localStorage).filter(k=>k.startsWith('builder.thread.')).map(k=>{const items=JSON.parse(localStorage[k]);const by={};for(const i of items){by[i.kind]=(by[i.kind]||0)+JSON.stringify(i).length}return{k,total:localStorage[k].length,n:items.length,by}}).sort((a,b)=>b.total-a.total)
```

**Nghiệm thu** — đã đo, không còn là dự đoán. Dựng lại thread mà browser SẼ giữ cho build
`1787544155222` (106 lượt hỏi · 37 gate · 294 item, từ `chat.jsonl`+`runs.jsonl`+`events.jsonl`) rồi chạy
qua serializer cũ và mới:

| Mốc | Payload | |
|---|---|---|
| serializer **cũ** | **4,905M** ký tự | vượt mọi trần ⇒ banner |
| sau **S1+S2** | **1,624M** | **−67%**, không cắt một lượt nào của user |
| sau **S1+S2+S3** | **1,398M** | cắt 16 lượt cuối — **nằm trong cửa sổ 50 cặp** nên backfill trả lại đủ, đúng thứ tự |

(4,905M ở đây cao hơn 3,991M mà browser tự khai vì bản dựng lại giữ **cả** 37 gate; §1.3 đã ghi sai lệch
mô hình ~14%. Tỉ lệ cắt giảm là thứ không đổi theo sai lệch đó.)

**Kiểm chứng trên máy thật** (sau khi load lại tab): chạy snippet trong browser ở trên — tổng phải rơi
về khoảng **1,3–1,4 triệu** ký tự cho build này, và dòng `cache` trong ⚙ dev panel nói cùng con số.

---

## 5. Ảnh hưởng nếu implement

### 5.1 Bán kính chạm

| Vùng | Chạm gì | Rủi ro |
|---|---|---|
| [thread-persist.ts](../../apps/builder/web/src/lib/thread-persist.ts) (83 dòng) | S1 + S2 + S3 nằm gần hết ở đây; **thuần hàm**, không signal, không I/O | thấp — đã có 19 test bao |
| [store.ts](../../apps/builder/web/src/store.ts) `persistThreadNow` + `threadIndex` | S3 (ngân sách), S4 (quét), S5 (lưới đỡ), đổi `THREAD_KEY` sang v2 | **trung bình** — đây là đường ghi nóng, xem 5.3 |
| `DevPanel.tsx` | S6, thêm một bảng đọc | thấp |
| `types.ts` | chỉ **comment**: đánh dấu tập enrichment "không được persist" | không |
| **Server** | **không chạm dòng nào** | — |

**Vận hành**: chỉ cần **rebuild `dist/` của web**; **không** phải restart server, **không** phải sửa
`.runs/`. Máy user chạy `dist/`, nên sửa source mà không build là fix không tồn tại.

### 5.2 Người dùng thấy gì đổi

| Đổi | Khi nào | Đánh giá |
|---|---|---|
| Banner 「保存領域が不足」 **biến mất** | ngay | mục tiêu |
| **Mất một lần** toàn bộ thread đang cache (đổi key v2) | lần load đầu sau khi lên bản | chấp nhận được: Q&A về từ `chat.jsonl`, phase prose về từ `runs.jsonl` — **kém hơn** ở chỗ prose chỉ còn 6k/attempt |
| Build **rất dài** bị cắt đuôi (S3) | build > ~1 triệu ký tự | các lượt cuối sau reload nằm **dưới** thẻ gate cuối thay vì xen kẽ |
| Marker 「N lượt cũ không hiển thị」 | build > 50 lượt | **honest**, đã có sẵn từ 099 |
| Thẻ gate cũ render sai | **không được phép xảy ra** | chính là thứ test 1 của S1 canh |

### 5.3 Sổ rủi ro

| # | Rủi ro | Khả năng | Hậu quả | Chặn bằng |
|---|---|---|---|---|
| R1 | S2 dựng lại `question` sai ⇒ backfill coi mọi lượt là "thiếu" ⇒ **nhân đôi toàn bộ hội thoại** | thấp | **cao** — tệ hơn bug đang sửa | test round-trip đẳng thức sâu; `question` chỉ dựng lại khi **thiếu** |
| R2 | S1 bỏ nhầm field ⇒ thẻ gate mở lại hiện sai badge/nút | thấp | trung bình | test 1: so **kết quả `gateView`** trước/sau round-trip, không so tập khoá |
| R3 | S5 rate-limit chặn nhầm lượt ghi bình thường ⇒ tái sinh bug 101 §3.2 | trung bình | cao | test `persistFlush.test.ts:112` đã canh sẵn — cấm sửa nó cho xanh |
| R4 | S4 quét trúng key một **tab khác** vừa ghi xong nhưng chưa kịp cập nhật index | thấp | thấp | quét **một lần lúc load**; tab kia ghi lại ở lượt kế; (ghi index **trước** payload sẽ đóng hẳn cửa sổ này) |
| R5 | Hằng số ngân sách đặt sai ⇒ cắt nhiều hơn cần | trung bình | thấp | S6 cho đọc số thật; §4 có mốc nghiệm thu |
| R6 | Tab cũ + payload mới | **đã đóng bằng key v2** (S2) | — | — |

### 5.4 Test hiện có bị ảnh hưởng

- [thread-persist.test.ts](../../apps/builder/web/src/lib/thread-persist.test.ts) — **19 test**. Hai
  assertion phải viết lại (`"keeps user/qa verbatim"` và `"drops gate artifactContents"`); các test
  round-trip/hydrate/attachment **phải vẫn xanh nguyên trạng** — nếu một trong số đó đỏ thì S1/S2 đang làm
  hỏng thứ khác, không phải test lỗi thời.
- [store.persistFlush.test.ts](../../apps/builder/web/src/store.persistFlush.test.ts) — **13 test**, đặc
  biệt 3 test của 099 S2′ (banner + report) phải xanh **nguyên trạng**: S5 không được làm mất kênh báo cáo.
- `ask-backfill.test.ts` (15) + `store.backfill.test.ts` (8) — **không** được sửa; chúng là lưới an toàn
  của R1.

### 5.5 Nếu chỉ làm được một nửa

**S1 + S2 độc lập với nhau và độc lập với S3–S6.** Làm riêng S1+S2 đã đưa payload từ 3,99 triệu về
**≈1,3 triệu** — dưới quota, không cắt gì của user, không đổi hành vi nào ngoài việc banner tắt.
S3 (ngân sách) là thứ khiến nó **không tái phát khi có build to hơn nữa**; S4–S6 là vệ sinh và lưới đỡ.
Thứ tự ship đúng: **S2+S1 → đo lại (§4) → S3 → S4/S5/S6.**

---

## 6. Non-goals

- **Không** đụng 033 D6: backend vẫn không giữ transcript hiển thị. Mọi lát là client-only; đường `/chat`
  đã tồn tại từ 099.
- **Không** nới `CHAT_TAIL_PAIRS`. S3 được thiết kế để nằm gọn trong cửa sổ 50 cặp; nới nó là bài toán khác
  (kích thước response mỗi lần mở build) và chỉ mở ra nếu §6-Q2 nói cần.
- **Không** nén (lz-string): sau S1+S2, 60% payload biến mất mà không tốn CPU mỗi lượt ghi và không làm
  payload thành đốm nhị phân không debug được.
- **Không** IndexedDB. Điều kiện kích hoạt được ghi ở §6-Q3.
- **Không** hạ `RUN_OUTPUT_CAP` — 7% payload, sửa là sửa nhầm chỗ.
- **Không** đổi câu chữ banner: sau S1–S3 nó gần như không còn xuất hiện, và khi xuất hiện thì nó vẫn đúng.

---

## 7. Open questions

1. **Q1 — `user.text` khổng lồ (144.929 ký tự) có nên cap không?** Nó **không** trùng lặp sau S2, nhưng một
   mình nó bằng 5% quota. Cap nghĩa là bubble hiển thị lại **cụt** sau reload, và `backfillFromTranscript`
   khớp theo **text** nên cụt = không khớp = nhân đôi bubble. ⇒ chưa làm; cần một cách khớp không phụ thuộc
   text (hash? `at`?) trước khi nghĩ tới cap.
2. **Q2 — cắt đuôi rồi mở lại có thật sự không mất gì?** Phải test bằng tay đúng một lần trên build ≥50
   lượt: cắt 30 lượt cuối → reload → đếm `qa` trước/sau. Nếu backfill trả về **ít hơn** số đã cắt thì
   `CHAT_TAIL_PAIRS` mới cần nới (và `TRIM_MAX_PAIRS` phải hạ theo).
3. **Q3 — khi nào chuyển IndexedDB?** Ngưỡng: sau S1–S3, nếu **một build đơn lẻ** còn vượt
   `PER_BUILD_CAP` **và** phần vượt là thứ đĩa không dựng lại được. Lúc đó cap không còn là lựa chọn đúng
   mà là mất dữ liệu, và quota vài trăm MB của IndexedDB mới là câu trả lời.
4. **Q4 — thứ tự sau reload có đủ tốt không?** Khối phục hồi nằm dưới thẻ gate cuối. Cần user xác nhận đọc
   được; nếu không, lối ra là gắn `at` cho item `qa` để merge đúng thứ tự (đắt hơn, chạm cả `ask-backfill`).

5. **Q5 — `lastAsk` không có cap, và nó không chỉ là chuyện quota.** Tái dựng cho thấy trung bình
   **18.250** ký tự, **max 87.705** mỗi snapshot (§1.3). Sau S1 nó không còn nằm trong localStorage — nhưng
   nó vẫn đi trên **mọi** `GET /api/tasks/:id`, tức **mỗi lần SSE reconnect**. Comment ở
   [tasks.ts:421-427](../../apps/builder/server/routes/tasks.ts:421) nói build chỉ mang "lượt ask cuối"
   **chính vì** ask có thể rất dài — nhưng không cap nó. Ngoài phạm vi spec này (không phải nguyên nhân
   vỡ quota); ghi lại để đừng phải đo lần nữa.

---

## 8. Khi đóng spec — tri thức về nhà nào

| Loại | Mảnh | Nhà |
|---|---|---|
| Hành vi đã ship | allowlist snapshot · dedup câu hỏi · ngân sách + cắt tiền tố · quét mồ côi · lưới đỡ evict | `docs/state/ui-surface.md §4.1` (đang mô tả `serializeThread`/`hydrateForReopen` — phải cập nhật) |
| Nguyên tắc | §0.1–§0.4, đặc biệt **allowlist thay vì blacklist** và **cắt đuôi vì đĩa trả lại được đuôi** | `docs/state/ui-surface.md §4.1` |
| Bài học từ thất bại | 2026-08-18: thêm field vào `WireTask` ⇒ thổi phồng payload localStorage ở tầng khác, không ai thấy → luật: payload persist là allowlist, có test khoá | `AGENTS.md §9` |
| Bằng chứng đo | §1.2, §1.3, các lệnh §4 | `docs/prompts/runs/CAMPAIGNS.md` |
| Chờ quan sát | Q2/Q4 nếu chưa kiểm được — **phải kèm detector** (`grep -c persist_failed` trên `.runs/`) | `docs/watch/` |
