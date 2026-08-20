# Spec 106 — Một build còn đi tiếp được phải TRÔNG như còn đi tiếp được

> **Status**: **mở**, chưa implement. Lập 2026-08-21, từ một ca thật của user: build
> `1787220388060` chạm hạn mức ở ② và **biến mất khỏi 進行中** trong khi FSM vẫn nhận nó chạy tiếp.
>
> Phạm vi — **ba lát, một nguyên tắc**:
> **S1** `error` là trạng thái **CÒN SỐNG** trong mọi danh sách ·
> **S2** phân loại **lỗi môi trường** vs **lỗi build**, lưu lên task, nói đúng câu ·
> **S3** một lỗi **không được nuốt mất** cái gate đang mở.
>
> **Không chạm**: tự động chạy lại khi hạn mức reset (§6 N1) · ngưỡng reset session (spec 100) ·
> đo tiêu thụ (spec 102) · cap-5 · `computeGate` **giữ thuần**.
>
> Liên quan: [104](104-hitting-a-limit-must-not-cost-a-run.md) — **S2 của nó được spec này giải khoá**
> (§2.5) · [105](105-fixing-an-existing-workflow-is-not-a-rebuild.md) — cùng chạm sidebar + FSM;
> **đọc cảnh báo commit ở 105 §0.2 trước khi bắt đầu**.

---

## 0. Nguyên tắc — do user chốt 2026-08-21

> *"Những lỗi kiểu vậy thì user khả năng sẽ tiếp tục, nên mọi thứ cứ để nguyên hiện trạng,
> để sửa cho họ tiếp tục."*

Nguyên tắc này **đã là luật ở một nửa code** — nửa nằm dưới đĩa. Đọc-là-thấy:

| `[ĐO code]` Cái ĐÃ giữ nguyên khi build chết | Ở đâu |
|---|---|
| `sessionIds[phase]` — phiên của phase chết vẫn còn, retry `--resume` đúng phiên đó | `orchestrator.ts:351` |
| Retry **giữ nguyên phase**, không quay về ① | `replyWithin` — `orchestrator.ts:351-352` |
| Retry **KHÔNG re-arm** diff-base / spec-base — vì lượt chết có thể đã ghi dở, re-arm sẽ "đóng dấu cái xác" làm nền cho nút Undo | `retryFromError` — `orchestrator.ts:498, 669, 675` |
| Artifact trên đĩa không bị dọn (chỉ confinement breach mới revert) | `verifyPhase` |
| Đề xuất spec đang mở (`specRevise` + `SPEC.next.md`) vẫn còn nguyên; retry chạy lại đúng `spec-revise.md` | `task.json` · `phases.ts:123-125` |
| `auto` **HARD-STOP** trên `error` — không có bão retry đốt thêm hạn mức | `maybeAutoAdvance` — `orchestrator.ts:427` |

Nửa còn **thiếu** là nửa người dùng nhìn thấy: đĩa giữ đủ mọi thứ, còn UI thì **khai tử** build.
Spec này chỉ làm cho tầng nhìn thấy nói đúng cái tầng đĩa đã làm.

### 0.1 Một biên — và chỉ một

**Giữ nguyên hiện trạng ≠ chạy lại mù.**

`[ĐO]` Lượt chết vì hạn mức của build `1787220388060` **không miễn phí**: `turn_cost` ghi
`durationMs: 82149`, `numTurns: 6`, **`totalCostUsd: 0.4365`** — tiền đã tiêu, rồi mới chết. Một cú
Retry bấm khi hạn mức **chưa** reset tiêu thêm chừng đó nữa và chết y hệt.

⇒ Giữ nguyên **trạng thái**, nhưng **đừng** giữ nguyên giả định "Retry là rẻ". Đó là lý do S2 tồn tại
bên cạnh S1: chỉ hiện lại thôi mà không nói *khi nào* bấm được thì chỉ đổi một cái chết im lặng thành
một cái chết ồn ào hơn.

---

## 1. Vấn đề

### 1.1 Một câu

Builder có **hai định nghĩa khác nhau** về "build đã chết", và chúng mâu thuẫn: FSM nói `error` còn
chạy tiếp được, danh sách nói `error` đã xong đời.

### 1.2 `[ĐO code]` Hai định nghĩa, đọc-là-thấy

| Tầng | Nói gì về `error` | Ở đâu |
|---|---|---|
| **Danh sách** 進行中 | **chết** — cùng rổ với `done`/`cancelled` | `isNonTerminal` — `artifacts.ts:231`, dùng ở `:255` |
| **FSM** | **sống** — `/reply` nhận `error`, giữ phase, resume phiên | `routes/tasks.ts:723-726` |

Một trong hai sai. FSM là cái đúng: nó chạy được thật.

### 1.3 `[ĐO]` Trên máy tác giả, số build vô hình **nhiều gấp đôi** số hiện ra

Quét 56 `task.json` trong `apps/builder/.runs/` (repro §1.4):

| Trạng thái | Số | Có trong 進行中? | Còn `/reply` được? |
|---|---|---|---|
| `awaiting_confirm` (build) | **2** | ✅ | ✅ |
| **`error` (build)** | **4** | ❌ | ✅ |
| `done` / `cancelled` | 50 | ❌ | (terminal) |

Danh sách "đang làm dở" hiện **2**, trong khi **6** build ở trạng thái còn đi tiếp được. Bốn cái vắng
mặt gồm: 2 timeout ③, 1 build trúng bug `(unsaved)` (spec 090), và 1 chạm hạn mức — **đúng ca user
báo**. Bốn cái đó rơi xuống cây ビルド, nơi hàng của chúng **không hiện trạng thái gì cả**
(`TaskRow` render đúng tên + tuổi — `Sidebar.tsx:75-93`), nên trông y hệt một build đã xong.

> Chú ý phạm vi: *"còn đi tiếp được"* là mệnh đề về **FSM**, không phải lời hứa retry sẽ xanh — build
> trúng bug `(unsaved)` sẽ chết lại. Nhưng quyết định đó là của người dùng, và họ không thể quyết
> một thứ không hiện ra.

### 1.4 `[REPRO]`

```bash
cd apps/builder
for f in .runs/*/task.json; do node -e '
const t=require(process.argv[1]);
if(t.status)console.log([t.status,t.kind||"build",t.phase,(t.error||"").slice(0,60)].join("\t"));
' "$(pwd)/$f"; done | sort | uniq -c | sort -rn
```

Ca hạn mức tái hiện **không cần tài khoản cạn** — dùng nguyên cỗ stub 429 của spec 104 §3
(`ANTHROPIC_BASE_URL` trỏ stub, `CLAUDE_CONFIG_DIR` rỗng, key giả), bắn một `/reply` vào một build
đang park, rồi mở sidebar.

---

## 2. Bốn lỗ

### 2.1 `[ĐO code]` Danh sách coi `error` là chết

`artifacts.ts:231`:

```ts
const isNonTerminal = (s) => s === 'running' || s === 'scaffolding' || s === 'awaiting_confirm';
```

Comment ngay trên `listActiveTasks` tự nêu mục đích của mình: *"a parked build is never stranded"*.
Một build `error` **chính là** định nghĩa của stranded — và nó là thứ duy nhất bị loại mà vẫn
`/reply` được.

### 2.2 `[ĐO code]` Rơi xuống một hàng không nói gì

`TaskRow` (`Sidebar.tsx:75-93`) render `name` + `time`. Không icon trạng thái, không hint. Build
hỏng và build xong **cùng một hàng**.

### 2.3 `[ĐO code]` Phân loại lỗi có sẵn — nhưng chết ngay tại chỗ sinh ra nó

`failureCls: 'usage_limit' | 'auth' | 'network' | 'spawn' | 'unknown'` được tính ở
`turn-runner.ts:23`, đặt ở `:267`, `:283`, `:297` (spec 045 D2 + 104 S3) — rồi **không ai lưu nó**.
`gateAfterPhase` chỉ giữ lại phần **chữ**: `task.error = verify.reasons.join(' | ')`
(`orchestrator.ts:393-396`).

Hệ quả đo được: tầng FE muốn biết "đây có phải hạn mức không" thì phải **regex lại tiếng Anh**:

```ts
// web/src/lib/i18n.ts:1325
[/Claude CLI usage limit reached — builds cannot run until the limit resets\./g,
 'Claude CLIの利用上限に達しました — 上限がリセットされるまでビルドを実行できません。'],
```

Đây đúng cái mẫu AGENTS.md §9 (2026-08-05) đã dựng thành luật sau sự cố "Model not exist": **một hằng
ngữ nghĩa bị chép sang ngôn ngữ khác thì nó sẽ trôi**. Ở đây bản chép là một `RegExp` khớp văn xuôi
tiếng Anh, và bản gốc là một union type ở backend. Sửa một câu chữ EN là câm cả tầng phân loại của FE
— **không test nào đỏ**.

### 2.4 `[ĐO code]` Lỗi **nuốt mất** cái gate đang mở — lỗ nặng nhất

`computeGate` trả `ERROR_GATE` ở **dòng đầu tiên**, trước mọi nhánh phase:

```ts
// gate.ts:193
if (verify.outcome === 'error') return { actions: [...ERROR_GATE.actions] };
// gate.ts:97
const ERROR_GATE: Gate = { actions: [REPLY('retry', 'Retry phase')] };
```

Đọc trên đúng task của user (`1787220388060`, `[ĐO]` từ `task.json`):

```json
{ "status": "error", "phase": "spec", "specRevise": true,
  "specReviseFrom": { "phase": "implement", "status": "awaiting_confirm",
                      "gate": { "actions": ["continue","test_live","changes","discard"] } },
  "fixUndoable": true,
  "error": "Claude CLI usage limit reached … (You've hit your session limit · resets 1am (Asia/Tokyo))" }
```

Đây là một **đề xuất spec đang mở** (Làn B, spec 103). Gate đúng của nó có ba nút:
`Go with this` / `Change the plan` / **`Never mind`** (`gate.ts:206-217`). Sau khi chết vì hạn mức,
người dùng còn **đúng một** nút: Retry.

Và `Never mind` không chỉ mất khỏi màn hình — nó **bị chặn ở route**: `drop_spec` đi qua `/confirm`,
mà `/confirm` yêu cầu `status === 'awaiting_confirm'` (`routes/tasks.ts:542`). Nên:

> Người dùng bị **khoá vào Retry**. Đường quay về cái gate ③ mà họ đang đứng — thứ `specReviseFrom`
> đã cất sẵn để phục vụ đúng việc này — không bấm được nữa. Và Retry là cái nút tiêu thêm ~$0.44
> vào một hạn mức chưa reset.

Đây là chỗ nguyên tắc §0 bị vi phạm rõ nhất: hiện trạng **được cất** đầy đủ, rồi bị một cái gate
một-nút đè lên.

### 2.5 `[ĐO]` Tiện thể: chuỗi thật của API đã đo được — 104 S2 hết bị chặn

104 §3 khoá S2 lại vì *"cần hình dạng chuỗi thật của API, thứ chỉ một lần chạm hạn mức thật mới cho
biết"*. Ca này là lần đó. Nguyên văn từ `events.jsonl`:

```
Claude CLI usage limit reached — builds cannot run until the limit resets.
(You've hit your session limit · resets 1am (Asia/Tokyo))
```

⇒ **Giờ reset CÓ trong message, và đã tới được UI.** `[CẬN DƯỚI]` — **n = 1**. Biết đúng một hình dạng
(`resets <giờ> (<tz>)`), không biết 5 cửa sổ còn lại của bảng `kNt` in ra sao. S2 dưới đây được thiết
kế **quanh n=1**: bóc được thì hiện, không bóc được thì trích nguyên câu — không bao giờ tự tính
đồng hồ đếm ngược (§6 N2).

---

## 3. Slices

### S1 — `error` là trạng thái CÒN SỐNG trong mọi danh sách

1. `artifacts.ts:231` — `isNonTerminal` nhận thêm `'error'`. Comment tại chỗ phải nói **vì sao**:
   *danh sách này liệt kê build còn `/reply` được; `error` là một trong số đó, và nó là cái duy nhất
   không có ai khác nhắc.*
2. `ActiveSection` (`Sidebar.tsx:224-270`) — hàng `error` không quay spinner (nó không chạy) và không
   dùng đồng hồ `gate` (nó không park). Icon riêng (⚠), hint riêng (§3.4).
3. Nút × của hàng: `error` **không** hỏi xác nhận (không có lượt nào để giết) — cùng nhánh với
   `awaiting_confirm`, tức sửa điều kiện `const running = t.status !== 'awaiting_confirm'` thành
   "đang có lượt chạy thật". `/cancel` trên task `error` đã chạy đúng sẵn (`routes/tasks.ts:930`
   chuyển sang `cancelled`), nên nút × dọn được danh sách ngay ngày đầu.

**Biên cần nói ra:**

- *Rác tích lại?* Đúng, danh sách sẽ dài hơn. Thuốc đã có sẵn: × mỗi hàng + `CollapsibleList` phân
  trang (`sidebarPageSize`). **Không** thêm bộ lọc theo tuổi ở lát này — xem §6 Q1.
- *Ca `failSafe`*: `routes/tasks.ts:100-113` đặt `status='error'` mà **không** đặt gate, và `runPhase`
  đã xoá gate trước đó (`orchestrator.ts:501`) ⇒ có build `error` **không có nút Retry** nào. S1 làm
  chúng hiện ra; để chúng hiện ra mà bấm không được thì tệ hơn. ⇒ `failSafe` đặt luôn `ERROR_GATE`.
  Một dòng, cùng lát.

### S2 — Lưu phân loại, và nói đúng câu cho từng loại

1. **`task.failureCls`** (`state/task.ts`, optional): kiểu **dùng lại nguyên** union của
   `TurnResult['failureCls']` — import, **không** khai lại (đúng luật AGENTS.md §9 2026-08-05: một
   hằng ngữ nghĩa, một bản). Vắng mặt ⇒ hành vi y như trước 106 (back-compat cho mọi `task.json` cũ).
2. **Ghi**: `gateAfterPhase` là chỗ duy nhất có `verify` của một lượt → nhận thêm `failureCls` từ
   `runPhase` và gán vào task. **Năm** chỗ `status='error'` còn lại (`orchestrator.ts:83, 96, 171,
   205, 1239`) là lỗi backend/scaffold/report — **không** phải môi trường ⇒ để `undefined`, đúng nghĩa.
3. **Xoá**: `runPhase` đang xoá `task.error = undefined` (`orchestrator.ts:501`) — **xoá
   `failureCls` ở đúng dòng đó**. Bỏ sót là để lại một nhãn "hạn mức" trên một build đã chạy lại bình
   thường. `reparkAfterProposal` (`orchestrator.ts:915-928`, dòng 921) xoá `task.error` — xoá cả nhãn.
4. **Một predicate thuần, một bản**: `isEnvironmentFailure(cls)` = `usage_limit | auth | network |
   spawn`. `unknown` **không** phải môi trường (mặc định an toàn: coi như lỗi build). Đặt cạnh
   `classifyTurnFailure` trong `turn-runner.ts` và export — FE **không** được tự dựng bản thứ hai.
5. **Wire**: `TreeTaskNode` (`artifacts.ts:118`) + `WireTreeTask` (`web/src/types.ts:269`) mang thêm
   `failureCls?`. `listActiveTasks` dựng node bằng tay nên phải thêm tường minh (`GET /api/tasks` đã
   spread cả Task, không cần sửa).
6. **Bóc giờ reset — thuần, phòng thủ, n=1**: một hàm thuần
   `resetHintFrom(error: string): string | null`, khớp `/\bresets?\s+([^)\n·|]{1,40}\)?)/i`, trả
   nguyên đoạn khớp (`"1am (Asia/Tokyo)"`), `null` khi không khớp.
   **KHÔNG** parse ra `Date`, **KHÔNG** đổi múi giờ, **KHÔNG** đếm ngược (§6 N2).
   Khung `… · resets <giờ>` là **của CLI**, không của tên cửa sổ, nên nó phải bóc được cho **cả 6**
   tên trong bảng `kNt` (spec 104 §2 S3b) — chỉ có **một** trong sáu là đã đo thật, năm cái còn lại
   là `[GIẢ THUYẾT]` dựng từ khung đó. Và phải trả `null` **yên lặng** cho mọi note **không có** chữ
   `resets` (auth · network · timeout · lint) — im lặng ở đó rẻ hơn một câu sai giờ.
7. **Nút Retry vẫn bấm được**, kể cả khi biết giờ reset. Lý do: giờ đó là chữ của một message ta chỉ
   thấy một lần, người dùng có thể đã đổi tài khoản/gói, và một cái nút bị khoá vì một chuỗi ta đoán
   sai thì không có đường thoát. Nói, đừng chặn.

### S3 — Một lỗi không được nuốt mất cái gate đang mở

Phạm vi **hẹp có chủ ý**: chỉ cứu đường thoát của **đề xuất spec đang mở**, vì đó là ca đo được
(§2.4) và là ca duy nhất mà state-để-quay-về (`specReviseFrom`) **đã** được cất sẵn.

1. `computeGate` **giữ nguyên, vẫn thuần** (non-goal của 105). Thêm một hàm thuần khác trong
   `gate.ts`:
   ```ts
   export function withProposalEscape(gate: Gate, specRevise: boolean): Gate
   ```
   — thêm `CONFIRM('drop_spec', 'Never mind')` vào một error-gate khi và chỉ khi `specRevise`.
   Áp đúng ở `gateAfterPhase` (`orchestrator.ts:392`).
2. `/confirm` (`routes/tasks.ts:542`) nới **đúng một khe**: nhận `actionId === 'drop_spec'` khi
   `status === 'error' && task.specRevise`. Mọi action khác vẫn 409 như cũ. Guard viết theo lối
   "tự suy lại từ state", không tin FE — cùng lối `wantsPropose` đang dùng (`routes/tasks.ts:784-793`).
3. `dropSpecProposal` + `reparkAfterProposal` **chạy nguyên si**: nó đã set `task.error = undefined`
   và khôi phục `phase/status/gate` từ `specReviseFrom` (`orchestrator.ts:915-931`). Thêm: xoá
   `failureCls` (S2.3).

**Đã cân nhắc và LOẠI — tổng quát hoá "giữ mọi action của gate trước lỗi"**: `runPhase` xoá
`task.gate` trước khi spawn (`orchestrator.ts:501`), nên phải cất thêm một bản gate-trước-lỗi cho
**mọi** phase, rồi phải trả lời "action nào còn hợp lệ sau khi phase đã chạy dở?" cho từng cái một
(`continue` sau một ③ chết dở là **sai** — nó đẩy build đi tiếp trên một artifact có thể đã hỏng).
Đắt, rủi ro, và ca đo được không cần tới nó. Ghi lại để đừng ai "tiện tay" mở rộng.

### S4 (i18n, đi kèm S1+S2) — chữ

`web/src/lib/i18n.ts`, EN + JA (UI chỉ có hai ngôn ngữ này — `DICT` ở `:1086`):

| key | EN | JA |
|---|---|---|
| `hintRetry` | `stopped — can resume` | `停止 — 再開できます` |
| `hintLimit` | `limit — resumes after reset` | `上限 — リセット後に再開` |
| `hintLimitAt` | `limit — retry after {when}` | `上限 — {when} 以降に再試行` |

Chọn chữ theo `failureCls`: `usage_limit` + bóc được giờ → `hintLimitAt` · `usage_limit` không bóc
được → `hintLimit` · còn lại (kể cả `undefined`) → `hintRetry`. Giọng: **"build này còn đi tiếp
được"**, không phải "build này hỏng" — tin chính là *có đường đi tiếp*.

---

## 4. Test — và kỷ luật đỏ-khi-revert

Mọi test dưới đây phải chứng minh **đỏ khi gỡ fix** (tạm revert → chạy → khôi phục), theo
`docs/specs/README.md`.

| # | Lát | Khẳng định | Ở đâu |
|---|---|---|---|
| 1 | S1 | `listActiveTasks` **có** task `error`; **không** có `done`/`cancelled` | `test/` (server, node:test) |
| 2 | S1 | `failSafe` để lại một gate có action `retry` | server |
| 3 | S2 | Lượt chết **đường exit** và **đường result-event** đều để lại `failureCls` **giống nhau** trên task (một nguyên nhân, một nhãn) | server, dùng lại fixture `turn-failure-triage.test.ts` |
| 4 | S2 | Lượt chạy lại thành công **xoá sạch** `failureCls` (chống nhãn ma) | server |
| 5 | S2 | 5 chỗ `status='error'` không-phải-lượt **để `failureCls` undefined** | server |
| 6 | S2 | `resetHintFrom` bóc đúng **chuỗi đã đo thật**; bóc được cả 6 khung `kNt`; trả `null` cho note auth/network/timeout/lint | web (vitest, thuần) |
| 7 | S3 | error-gate của một build có `specRevise` **có** `drop_spec`; build không có thì **không** | server, thuần (`gate.ts`) |
| 8 | S3 | `POST /confirm {drop_spec}` trên task `error+specRevise` → **200 và về đúng gate ③ trong `specReviseFrom`**; mọi action khác trên `error` → **409** | server, qua **route thật** (không gọi hàm con — luật 091) |
| 9 | S4 | Ba nhánh chữ chọn đúng theo `failureCls`; key có đủ ở **cả** EN và JA | web |

---

## 5. Nguyên tắc rút ra (mang về `docs/state` khi đóng spec)

1. **Một trạng thái "còn hành động được" phải xuất hiện ở nơi người dùng tìm việc dở.** Danh sách
   "đang làm dở" định nghĩa bằng *"còn `/reply` được"*, không bằng một danh sách trạng thái chép tay.
2. **Lỗi môi trường và lỗi sản phẩm là hai loại khác nhau.** Build hỏng cần người đọc; máy không chạy
   được chỉ cần thời gian. Gộp chúng vào một `status` là bắt người dùng tự đoán.
3. **Phân loại đã tính thì phải lưu.** Một nhãn chỉ sống trong văn xuôi tiếng Anh sẽ được regex lại ở
   tầng khác, và sẽ trôi.
4. **Một lỗi không được thu hẹp lựa chọn của người dùng xuống dưới mức trước khi lỗi xảy ra** — nhất
   là khi đường thoát đã được cất sẵn trên đĩa.

---

## 6. Non-goals

- **N1 — Tự chạy lại khi hạn mức reset.** Không, ở spec này. Cần một cái đồng hồ đáng tin (ta đang có
  n=1 mẫu chuỗi), cần chính sách "một lần hay nhiều lần", và sai thì đốt đúng cái vừa hồi. Bậc 3 của
  bảng đề xuất — mở spec riêng khi có ≥3 mẫu chuỗi reset thật.
- **N2 — Đồng hồ đếm ngược / đổi múi giờ.** Trích nguyên chữ của API. Một cái đồng hồ sai còn tệ hơn
  không có đồng hồ.
- **N3 — Đổi cách retry spawn (fresh vs `--resume`).** Xem §7 Q2 — thật, nhưng là chuyện khác.
- **N4 — Đụng `computeGate`.** Giữ thuần (non-goal kế thừa từ 105).
- **N5 — Trạng thái thứ sáu trong FSM** (kiểu `stalled`). Đã cân nhắc: `Status` là union được đọc ở
  hàng chục chỗ; thêm một giá trị bắt mọi `switch` phải học nó. `failureCls` là **thuộc tính** của
  `error`, không phải một trạng thái mới — rẻ hơn và back-compat.

## 7. Open questions

- **Q1 — Bao nhiêu build `error` thì 進行中 thành rác?** Hiện đo được 4/56. Chưa đủ để thiết kế bộ lọc
  tuổi. Mở lại khi có máy nào chạm **≥10** hàng `error` cùng lúc; trước đó dùng × + phân trang.
- **Q2 — `[ĐO code]` Retry đang là hình dạng ĐẮT NHẤT có thể.** Retry-không-chữ đi vào
  `replyWithin(task, '')` → `replyText` rỗng là **falsy**, nên `runPhase` dùng **prompt phase đầy đủ**
  (`orchestrator.ts:640-653`) **cộng** `--resume` phiên cũ. Tức: gửi lại toàn bộ thân prompt vào một
  session đã dài. Với ca hạn mức thì đó đúng là lượt dễ chạm lại hạn mức nhất. Spec 100 đã có sẵn cỗ
  máy quyết định fresh-vs-resume theo cỡ context (`shouldResetAskSession`) nhưng chỉ dùng cho Ask.
  **Chưa đo** cho đường build ⇒ không slice nào ở spec này xây trên nó.
- **Q3 — `auth` và `network` có nên hiện giống `usage_limit` không?** Cả hai đều là "môi trường", nhưng
  cách sửa khác hẳn (`auth`: chạy `claude` login; `network`: kiểm proxy). S2 gộp chúng vào
  `hintRetry` cho lát này. Nếu người dùng gặp thật thì tách chữ — rẻ, thêm hai key.
