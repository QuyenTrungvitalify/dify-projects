# Spec 112 — Chốt an ninh không được nổ vì sổ sách của chính nó

> **Status**: **S1–S4 đã implement + test xanh 2026-08-25** (chưa commit; chưa đóng — còn 3 open
> question ở §6, xem "Đã ship gì" cuối header). Lập 2026-08-25, từ ca thật của user: build `1787544155222`,
> hai lượt hỏi cuối cùng trong ngày bị layer-2 của Ask báo "lượt-hỏi đã ghi file dù có guard" và
> **hoàn tác** `apps/builder/.runs/1787544155222/events.jsonl` — trong khi lượt hỏi **không hề ghi gì**.
> Kẻ ghi là **chính backend**.
>
> Phạm vi — **bốn lát, một nguyên tắc**:
> **S1** loại `events.jsonl` khỏi vùng so-sánh của layer 2 (lát duy nhất bắt buộc) ·
> **S2** test đỏ-khi-revert cho đúng ca này ·
> **S3** hộp thoại báo động phải là **cảnh báo một nút**, không phải câu hỏi hai nút giống hệt ·
> **S4** sửa comment đang nói quá phạm vi của layer 1.
>
> **Không chạm**: cơ chế hai lớp của Ask (spec 033, đã đóng) nói chung · layer 1 (`BUILDER_ASK_MODE`) · phạm vi
> snapshot (vẫn là **cả hai** writable root — không thu hẹp về một file) · `consultWithin` /
> `askTestWithin` (hai đường này **không có** layer 2, xem §2.4) · không tắt `stream_open`/`stream_close`
> để "cho yên chuyện" — dòng timeline đó là thứ đã chứng minh được sự cố này.
>
> Liên quan: **099** đẻ ra hai kẻ ghi `events.jsonl` ngoài khoá · **097** nâng `ASK_TIMEOUT_MS`
> 3→8 phút, tức nhân đôi rưỡi cửa sổ trúng · **033 FIX-M** đã đóng đúng lỗ này cho `uploads/`
> ([tasks.ts:770-778](../../apps/builder/server/routes/tasks.ts:770)) — spec này là mảnh còn sót của
> cùng một cuộc kiểm.
>
> **Đã ship gì (2026-08-25)** — server `node --test`: **1200/1200 xanh**; web `vitest`: **476/476 xanh**
> (44 file, +1 file mới). Cả hai lát code đã **bắn thử đỏ-khi-revert**, không phải tin lời:
>
> | Lát | Landed | Test |
> |---|---|---|
> | S1 | [ask.ts:376-382](../../apps/builder/server/lib/ask.ts:376) | [ask.test.ts](../../apps/builder/test/ask.test.ts) — revert S1 ⇒ **đỏ ở đúng assert mất-dữ-liệu**, 18 test còn lại vẫn xanh |
> | S2 | `describe('askWithin — the backend's own timeline write is NOT an anomaly')` | (chính nó) |
> | S3 | [Modal.tsx:285](../../apps/builder/web/src/components/Modal.tsx:285) + [store.ts:840](../../apps/builder/web/src/store.ts:840) | [confirm-modal.test.tsx](../../apps/builder/web/src/components/confirm-modal.test.tsx) — 4 test; bỏ guard ⇒ đỏ |
> | S4 | [ask.ts:9-14](../../apps/builder/server/lib/ask.ts:9) | doc-only |
>
> **Đã rebuild `dist/`** (server + web, 01:00) vì máy user chạy `dist/server/index.js`, **không** chạy
> `tsx` — sửa source mà không rebuild là fix không tồn tại. Server cần **restart** để ăn S1; UI chỉ cần
> reload tab.

---

## 0. Nguyên tắc

**Một chốt chỉ được nổ vì hành vi của đối tượng nó canh.** Layer 2 canh *lượt hỏi*. Sổ sách mà
*backend* tự ghi trong cùng cửa sổ thời gian không phải hành vi của lượt hỏi — và đã có tiền lệ ghi
thẳng trong code: `task.json` được miễn đúng vì lý do đó ([ask.ts:356-375](../../apps/builder/server/lib/ask.ts:356)).
Danh sách miễn đó **thiếu một cái tên**, không phải sai nguyên tắc.

Hệ quả kèm theo, cũng là luật: **một chốt nổ nhầm không được phá dữ liệu.** Layer 2 không merge —
nó ghi đè bằng bytes cũ. Một lần nổ nhầm = một dòng audit **mất vĩnh viễn**.

---

## 1. Sự cố — build `1787544155222`

### 1.1 Một câu

Trong lúc lượt hỏi đang chạy (tối đa 8 phút), tab của user reconnect SSE → `sse.ts` append một dòng
`stream_close` vào `events.jsonl` → layer 2 thấy file đổi bytes → kết luận "layer 1 bị bypass",
**ghi đè `events.jsonl` về trạng thái trước lượt hỏi**, và bật hộp thoại báo động.

### 1.2 `[ĐO]` Bằng chứng: đúng một cặp `stream_*` bị gãy, và nó nằm đúng cửa sổ lượt hỏi

Audit 30 dòng `stream_open`/`stream_close` trong `events.jsonl` của run — ghép cặp hoàn hảo suốt cả
ngày, **trừ đúng một chỗ, ở cuối**:

| Giờ (UTC) | ts | kind | detail |
|---|---|---|---|
| 11:39:50 | 1787571590286 | `stream_close` | `clients=0` |
| 11:40:00 | 1787571600466 | `stream_open` | `clients=1` |
| **—** | **—** | **`stream_close` — KHÔNG CÒN TRÊN ĐĨA** | — |
| 11:47:25 | 1787572045504 | `stream_open` | `clients=1` |

`clients=1` ở dòng cuối là con dấu: `clientsForTask` đếm **sau khi** client cũ đã rời, nên client cũ
*đã* ngắt và *đã* sinh một dòng `stream_close`. Dòng đó biến mất. Cửa sổ 11:40:00 → 11:47:25 chứa
đúng lượt hỏi kết thúc **11:46:02** (`chat.jsonl`, `at: 1787571962887`).

### 1.3 `[ĐO]` Hai lượt hỏi bị đánh `ok:false` dù trả lời đầy đủ

`chat.jsonl` của run này có 5 bản ghi `ok:false`. Ba cái đầu tự khai lý do (`API Error: 500`,
`process exited code null`). **Hai cái cuối thì không**:

| `at` | Câu trả lời | Lý do `ok:false` |
|---|---|---|
| 1787571962887 | "Tôi chưa có dữ liệu lượt đó — các ảnh đính kèm đều là ảnh cũ…" (đầy đủ, mạch lạc) | **không có trong text** |
| 1787572274708 | "Không — lượt này **khác đáng kể**…" (đầy đủ, có kết luận) | **không có trong text** |

Đó là nhánh anomaly ở [ask.ts:575-582](../../apps/builder/server/lib/ask.ts:575): nó ghi `ok:false`
**bất kể lượt hỏi thành công**, vì với nó chuyện "có anomaly" nặng hơn chuyện "có câu trả lời".
Đúng thiết kế — sai tiền đề.

### 1.4 Cái đã mất, và cái đã bị nói dối

| Mất gì | Vì sao đắt |
|---|---|
| Dòng `stream_close` 11:4x | `events.jsonl` là nguồn của dossier, `report-analysis.ts` (giờ làm việc từng phase), và bundle export. Restore **ghi đè**, không merge ⇒ mất hẳn. |
| Nhãn `ok:true` của 2 lượt hỏi tốt | Bản ghi trên đĩa nói hai lượt đó hỏng. Chúng không hỏng. |
| Niềm tin vào chính cái chốt | Hộp thoại nói "**dù đã có guard**, lượt hỏi vẫn thử ghi file" — tức báo với user rằng lớp canh chính đã bị chọc thủng. Không có chuyện đó. |

---

## 2. Chẩn đoán

### 2.1 Vùng so-sánh rộng hơn danh sách miễn

`snapshotRoots` ([ask.ts:350](../../apps/builder/server/lib/ask.ts:350)) chụp **toàn bộ** hai root:
`workflowDir(task)` và `apps/builder/.runs/<taskId>/` (+ shorthand `.runs/<taskId>/`). Rồi miễn đúng
ba thứ ([ask.ts:376-382](../../apps/builder/server/lib/ask.ts:376)):

```
task.json  ·  task.json.<pid>.<seq>.tmp  ·  .ask-anomaly-before.tmp
```

`events.jsonl` **nằm trong root, không nằm trong danh sách miễn** — dù nó thuộc đúng cái loại mà
comment ngay phía trên gọi tên: *"the backend's OWN bookkeeping"*.

### 2.2 `[ĐO]` Ai ghi vào `.runs/<taskId>/` mà **không** cầm khoá lượt — danh sách đã đóng

Kiểm toàn bộ 14 chỗ chạm `taskDir(` trong `apps/builder/server/`:

| Kẻ ghi | File | Cầm khoá lượt? | Layer 2 thấy? |
|---|---|---|---|
| `orchestrator.ts` × 12 `logEvent` | `events.jsonl` | ✅ (chạy trong lượt phase) | không thể xen kẽ |
| `tasks.ts:1118` `fix_undone` | `events.jsonl` | ✅ `acquireTurn` giữ suốt ([tasks.ts:1064](../../apps/builder/server/routes/tasks.ts:1064)) | không thể xen kẽ |
| **`sse.ts:222`** `stream_open`/`stream_close` | **`events.jsonl`** | ❌ **socket handler, không khoá** | **✗ NỔ** |
| **`tasks.ts:495`** `history_gap` | **`events.jsonl`** | ❌ **GET /chat, không khoá** | **✗ NỔ** |
| **`tasks.ts:520`** `persist_failed` | **`events.jsonl`** | ❌ **GET /chat, không khoá** | **✗ NỔ** |
| `saveTask` | `task.json` (+`.tmp`) | ❌ | ✅ đã miễn |
| `saveAttachments` | `uploads/*` | ❌ nhưng route **409 trước khi ghi** ([tasks.ts:778](../../apps/builder/server/routes/tasks.ts:778)) | ✅ đã đóng (033 FIX-M) |
| `recordAsk` (`chat.jsonl`), `source.yml`, artifacts | — | ✅ | không thể xen kẽ |

**Ba kẻ nổ, cả ba ghi đúng một file.** Đó là lý do S1 chỉ cần một dòng: loại `events.jsonl` là đóng
**toàn bộ** lớp lỗi này, không phải vá một trường hợp.

### 2.3 `[ĐO]` Vì sao đến hôm nay mới nổ

Hai thay đổi độc lập cộng lại:

| Thay đổi | Hiệu ứng |
|---|---|
| **099** thêm `stream_open`/`stream_close` + `history_gap` + `persist_failed` | Trước đó `events.jsonl` chỉ được ghi **trong lượt** ⇒ không bao giờ xen kẽ với Ask |
| **097** nâng `ASK_TIMEOUT_MS` 3 → 8 phút | Cửa sổ trúng rộng ra ~2,7 lần |

Và tần suất SSE churn là thật, không hiếm: cùng run này có **3 sự kiện stream trong 46 ms**
(`1787570940306` / `…352` / `…352`). Với 8 phút cửa sổ, đây là chuyện **sẽ** lặp lại.

### 2.4 Một mảnh làm hẹp phạm vi — chỉ `askWithin` dính

`consultWithin` (④/terminal) và `askTestWithin` cố ý **không có** layer 2
([ask.ts:834](../../apps/builder/server/lib/ask.ts:834), [ask.ts:976](../../apps/builder/server/lib/ask.ts:976)).
Nên toàn bộ spec này chỉ chạm **một hàm**: `askWithin` — hỏi tại gate ①/②/③.

### 2.5 Mảnh phụ — comment của layer 1 đang nói quá

Header [ask.ts:9-14](../../apps/builder/server/lib/ask.ts:9) viết layer 1 *"denies every
Write/Edit/MultiEdit/NotebookEdit outright"*. Đúng chữ, nhưng đọc lên thành "layer 1 chặn mọi đường
ghi". Thực tế trong `decide()`, nhánh `Bash` **return trước** nhánh `askMode`:

```
permission-gate.ts:517-519  if (toolName === 'Bash') { … return analyzeBashCommand(command); }  ← thoát ở đây
permission-gate.ts:525      if (askMode && WRITE_TOOLS.has(toolName)) return deny;              ← không bao giờ tới
```

⇒ `echo … >> file` trong Ask mode **không** bị layer 1 chặn; chỉ layer 2 bắt. Đây **đúng tinh thần
defense-in-depth** (đó là việc của layer 2), nên S4 chỉ sửa **chữ**, không sửa hành vi — xem
Open Q2 nếu muốn siết thật.

---

## 3. Các lát

### S1 — `events.jsonl` là sổ sách của backend, không phải hành vi của lượt

**Ở đâu**: [ask.ts:376-382](../../apps/builder/server/lib/ask.ts:376), trong `snapshotRoots`.

**Làm gì**: thêm `events.jsonl` của **chính task này** vào danh sách miễn, kèm lý do tự đủ nghĩa.

```ts
//   - events.jsonl — <comment đầy đủ ở ask.ts:359-371, tự đủ nghĩa, không tham chiếu spec>
const jsonPrefix = `apps/builder/.runs/${task.taskId}/task.json`;
const askTmp = `apps/builder/.runs/${task.taskId}/.ask-anomaly-before.tmp`;
const eventsFile = `apps/builder/.runs/${task.taskId}/${EVENTS_FILE}`;   // EVENTS_FILE từ run-events.js
for (const key of [...out.keys()]) {
  if (key === jsonPrefix || key.startsWith(jsonPrefix + '.') || key === askTmp || key === eventsFile)
    out.delete(key);
}
```

**Vì sao đủ, không cần hơn**: `snapshotRoots` được dùng cho **cả hai** đầu (before ở
[ask.ts:521](../../apps/builder/server/lib/ask.ts:521), after ở
[ask.ts:402](../../apps/builder/server/lib/ask.ts:402)) ⇒ loại trừ **đối xứng**: file biến mất khỏi
cả hai map, không có `created`/`deleted` giả. Không dòng nào khác đổi.

**Chỉ đường dẫn canonical**: `logEvent` luôn nhận `taskDir()` = `apps/builder/.runs/<id>/`
([task.ts:661,677](../../apps/builder/server/state/task.ts:661)). Nhánh shorthand `.runs/<id>/` mà
`walkDir` vẫn quét ([ask.ts:355](../../apps/builder/server/lib/ask.ts:355)) không có kẻ ghi nào —
để nguyên, đúng như `jsonPrefix` hôm nay cũng chỉ phủ canonical.

**Đánh đổi, ghi rõ để không ai phải đoán lại**: sau S1, một lượt hỏi *thật sự* ghi vào `events.jsonl`
sẽ không bị bắt. Chấp nhận, vì (a) `task.json` — thứ nặng hơn nhiều — đã được miễn nguyên khối từ
đầu; (b) tác hại tối đa là một dòng rác trong timeline; (c) phương án chặt hơn đã cân và loại,
xem §5.

### S2 — Test đỏ-khi-revert, đi qua đúng `askWithin`

**Ở đâu**: [ask.test.ts](../../apps/builder/test/ask.test.ts) — thêm một `describe` cạnh AC#1c
(dòng 103), dùng nguyên harness sẵn có (`ctxWith` + fake `runTurn`).

**Nội dung**: fake `runTurn` **không đóng vai lượt hỏi ghi bậy** — nó đóng vai **backend ghi sổ**:
append một dòng `stream_close` vào `events.jsonl` giữa lượt.

**Nghiệm thu — ba assert, phải đỏ cả ba khi revert S1**:

1. `ask:done` có `ok === true` (không anomaly)
2. `data.anomaly` là `undefined`
3. **dòng vừa append VẪN CÒN** trong `events.jsonl` — đây là assert quan trọng nhất: nó bắt đúng
   cái tác hại (mất dữ liệu), không chỉ bắt cái triệu chứng (hộp thoại)

Kèm một assert âm ở test AC#1b/#1c hiện có: chúng vẫn đỏ khi có ghi bậy thật ⇒ S1 không làm mù layer 2.

### S3 — Một báo động không phải là một câu hỏi

**Ở đâu**: [store.ts:836-842](../../apps/builder/web/src/store.ts:836) + `ConfirmModal`
([Modal.tsx:285](../../apps/builder/web/src/components/Modal.tsx:285)).

**Hôm nay**: `okLabel` và `cancelLabel` **cùng** là `tr('askAnomalyOk')` ⇒ hai nút chữ y hệt nhau
(ảnh chụp của user). Comment tại chỗ đã tự nhận là cố ý (*"Both buttons dismiss identically (D1):
there is no 'keep this change' affordance"*) — nhưng cách thể hiện cái ý đó không phải là **nhân đôi
nút OK**, mà là **bỏ nút thứ hai**.

**Làm gì**: `ConfirmModal` nhận `cancelLabel?: string | null`; `null` ⇒ không render nút ghost.
Ở `store.ts` truyền `cancelLabel: null`. `Esc` vẫn đóng (đã có ở `onKey`), overlay-click vẫn đóng.

**Không chạm**: 15 chỗ gọi `askConfirm` khác — mặc định `tr('cancel')` giữ nguyên, thêm prop tuỳ chọn
là thay đổi cộng thêm.

**Ưu tiên thấp có điều kiện**: sau S1 hộp thoại này gần như không còn xuất hiện. Nhưng khi nó xuất
hiện thì đó là **báo động thật** (layer 1 bị chọc thủng thật) — và lúc đó nó càng phải đọc ra như
một thông báo, không như một lựa chọn.

### S4 — Comment không được nói quá phạm vi của lớp mình

**Ở đâu**: [ask.ts:9-14](../../apps/builder/server/lib/ask.ts:9).

**Làm gì**: một mệnh đề, ghi đúng biên: layer 1 phủ **tool ghi file** (`Write`/`Edit`/`MultiEdit`/
`NotebookEdit`); `Bash` đi nhánh riêng và **thoát trước** nhánh `askMode`
([permission-gate.ts:517](../../apps/builder/server/hooks/permission-gate.ts:517)), nên một redirect
shell chỉ có layer 2 bắt — **đó chính là lý do layer 2 tồn tại**, không phải lỗ hổng.

**Không đổi một dòng hành vi nào.**

---

## 4. Repro / bằng chứng đo

```bash
# 1. [ĐO] Cặp stream_* gãy — nổ ra đúng một chỗ, ở cuối file (§1.2)
python3 - <<'PY'
import json, datetime
rows=[json.loads(l) for l in open('apps/builder/.runs/1787544155222/events.jsonl') if l.strip()]
st=[r for r in rows if r['kind'].startswith('stream_')]
prev=None
for r in st:
    t=datetime.datetime.utcfromtimestamp(r['ts']/1000).strftime('%H:%M:%S')
    flag='  <== GÃY CẶP' if prev and prev['kind']==r['kind'] else ''
    print(t, r['ts'], r['kind'], r['detail'], flag); prev=r
PY

# 2. [ĐO] Hai lượt hỏi ok:false mà text KHÔNG khai lý do (§1.3)
python3 - <<'PY'
import json
rows=[json.loads(l) for l in open('apps/builder/.runs/1787544155222/chat.jsonl') if l.strip()]
for r in rows:
    if r.get('ok') is False:
        print(r.get('at'), '|', str(r.get('text'))[:90].replace('\n',' '))
PY

# 3. [ĐO] Danh sách kẻ ghi events.jsonl (§2.2) — 3 chỗ ngoài khoá
grep -rn "logEvent(" apps/builder/server --include="*.ts" | grep -v "run-events.ts"

# 4. [ĐO] Danh sách miễn hôm nay — không có events.jsonl (§2.1)
sed -n '356,382p' apps/builder/server/lib/ask.ts

# 5. [ĐO] Bash thoát TRƯỚC nhánh askMode (§2.5)
sed -n '515,528p' apps/builder/server/hooks/permission-gate.ts

# 6. Test sau khi implement S1+S2
node --test --import tsx apps/builder/test/ask.test.ts
```

**Repro sống** (nếu muốn thấy tận mắt trước khi sửa): mở một build đang đậu ở gate ②, gõ một câu hỏi
đủ nặng để lượt chạy > 30 s, rồi **reload tab** giữa lúc đang trả lời. Reload sinh
`stream_close` + `stream_open` ⇒ hộp thoại nổ khi lượt kết thúc.

---

## 5. Non-goals — ghi kèm điều kiện đảo ngược

| Không làm | Vì sao | Đảo ngược khi |
|---|---|---|
| So **append-only** thay vì miễn nguyên file (chỉ chấp nhận phần thêm ở cuối và parse được thành `RunEvent`) | ~30 dòng + test, để chặn một mối đe doạ có tác hại tối đa là **một dòng rác trong timeline**. Không cân xứng. `task.json` — nặng hơn nhiều — đã miễn nguyên khối. | Có ca thật một lượt hỏi ghi vào `events.jsonl` |
| Tắt / dời `stream_open`/`stream_close` | Chính hai dòng đó là thứ chứng minh được sự cố này (§1.2). Bịt nó là đổi một bug lấy một vùng mù. | không |
| Cho layer 2 **merge** thay vì ghi đè | Merge một file mà ta vừa tuyên bố là "bị ghi bởi kẻ lạ" là tự mâu thuẫn. Đúng cách là đừng canh nhầm file. | không |
| Siết `askMode` phủ luôn `Bash` | Đổi hành vi của gate cho **mọi** lượt hỏi; `analyzeBashCommand` chưa có vị từ "lệnh này ghi file" sạch, đoán sai là chặn nhầm lệnh đọc. Layer 2 vốn sinh ra để đỡ đúng ca này. | xem Open Q2 |
| Thu hẹp snapshot về đúng gate artifact | Đó chính là cái FIX-M đã mở rộng ra có chủ ý; thu lại là undo một bản vá đúng | không |

---

## 6. Open questions

1. **`ok:false` có nên kéo theo cả câu trả lời tốt không?** Sau S1 chuyện này gần như không xảy ra
   nữa, nhưng nhánh anomaly ([ask.ts:576-581](../../apps/builder/server/lib/ask.ts:576)) vẫn ghi
   `ok:false` cho một lượt **có câu trả lời đầy đủ**. Có nên tách hai chiều — `answerOk` và
   `writeGuardOk` — để bản ghi trên đĩa không nói dối về chất lượng câu trả lời? Chưa chốt; cần biết
   `ok:false` còn khoá thêm gì ở phía client (prefill/graduate) trước khi động.
2. **Có nên cho `askMode` phủ `Bash` không?** Cần trước hết một câu trả lời đo được: trong toàn bộ
   `.runs/`, đã có lượt Ask nào gọi `Bash` ghi file chưa? Nếu số đó là 0 thì siết là rẻ; nếu > 0 thì
   phải biết chúng ghi gì trước khi chặn.
3. **`history_gap` / `persist_failed` có nên vẫn ghi khi một lượt đang chạy không?** Sau S1 chúng vô
   hại, nên đây thuần là câu hỏi về nhiễu timeline, không phải an toàn.
