# Spec 047 — Builder live-test: file inputs đúng contract + phân loại timeout/lỗi chính xác

**Status**: ✅ **Implemented (2026-07-08)** — S0–S5 code + unit tests xanh (builder suite 418/418; `_is_read_timeout`/`_collect_stream` verify bằng exception thật + fake stream). Xem §Implementation notes cuối file. — Gốc: **root cause + hướng fix đã verify thật** trên Dify self-host `localhost:8090` (2026-07-08) bằng matrix **A–F** (xem §Verified); riêng **E/F chạy qua chính `sync.py run`** — đường builder thật — và **Case F PASS** với input đã sửa. Fix là **additive**, không đổi gate FSM / permission-gate / validators. Tiền đề bắt buộc **S0** (plumbing khả-năng-file). **Đã POC-điều-chỉnh thiết kế + chốt 2 quyết định**: `SAMPLE_FILE_URL` cũ đã chết ⇒ **QA-5=(b): bỏ hẳn remote_url**, đường PASS duy nhất là **local_file + file bundled (S2)**; **QA-2 hạ xuống nice-to-have** (an toàn-by-construction qua S5 `RunHungNoStream` + string-arm + park-at-gate). Còn lại chủ yếu QA-1/QA-3 (đã xác nhận phần lớn qua POC) + QA-4 (chốt khi nâng Dify).
**Effort**: S–M — các điểm sửa: (0) **plumbing** `cmd_inject_model` + `InputVar` mang 3 field khả-năng-file (tiền đề S1), (1) `resolveInput` → **registry** sinh **file-object** đúng contract (thay chuỗi trần), (2) `sync.py` phân loại **ReadTimeout-khi-streaming** đúng + (S5) first-event deadline, (3) **S2 upload file bundled** — **lõi để file-workflow chạy PASS** (không còn "optional"), (4) S4 preflight degrade khi không dựng nổi input.

**Builds on**:
- [032](032-builder-live-workflow-test.md) — Phase ④ live-run sub-orchestrator (import→publish→mint→run→verify). Spec này **sửa một khiếm khuyết trong bước run** của 032, không đổi kiến trúc.
- [036](036-builder-capability-aware-test-targets.md) — capability-aware test targets (self-host).
- [037](037-builder-runnability-preflight-and-workspace-facts.md) — runnability preflight; §S3 của spec này mở rộng tinh thần "chặn sớm khi không chạy được" sang file-input.
- [043](043-builder-live-test-model-optional-for-llm-less-workflows.md) — kỷ luật: live-test phải phản ánh **đúng** trạng thái workflow, không báo nhầm.

**Depends on**: không thêm gì. Dùng lại `POST {base}/v1/files/upload` + `POST {base}/v1/workflows/run` (app key) đã có trong 032. Console admin creds đã có trong `apps/builder/.env`.

---

## Verified (đã thử thật trên Dify self-host `localhost:8090`, 2026-07-08)

App test: `Exel Pdf Url Excel` (workflow), start var `input_file` = **file-list, required**, `allowed_file_types: ["document"]`, `allowed_file_upload_methods: ["local_file","remote_url"]`, `allowed_file_extensions: [".xlsx",".xls"]`. App key mint thật qua Console API. `/v1/workflows/run` streaming, `timeout=(connect 5s, read 15s)`.

A/B/C/D chạy qua `requests` trực tiếp (khảo sát contract); **E/F chạy qua chính `sync.py run`** — đúng lệnh builder invoke (`runSyncPy` → `.venv/bin/python tools/dify_base/sync.py run`).

| Case | Đường | `inputs.input_file` gửi đi | Kết quả thật |
|---|---|---|---|
| **A** | requests | *(thiếu)* `{}` | ❌ **Read timed out 15s** → treo |
| **C** | requests | `["https://…/table-word.pdf"]` — **chuỗi URL trần (BUILDER HIỆN TẠI)** | ❌ **Read timed out 15s** → treo |
| **B** | requests | `[{transfer_method:"local_file", upload_file_id:<id xlsx thật>, type:"document"}]` | ✅ **2.8s**, `workflow_finished` **succeeded**, output đúng |
| **D** | requests | `[{transfer_method:"remote_url", url:"…pdf", type:"document"}]` | ⚠️ **0.4s** `workflow_finished` nhưng **status=failed** (stream xong nhanh — KHÔNG treo — nhưng workflow lỗi tải file) |
| **E** | **sync.py run** | S1 remote_url + `SAMPLE_FILE_URL` (W3C PDF) | ⚠️ **5.8s**, `status=failed`: *"Error downloading file: Redirect response '300 Multiple Choices'"* — **URL mẫu đã CHẾT** |
| **F** | **sync.py run** | S1+S2 local_file + **xlsx thật upload** | ✅ **2.5s**, `status=succeeded`, `{count:2, csv:…, summary:…}` — **PASS qua đúng đường builder** |

Fact khoá — thiết kế đứng trên chúng:
1. Dify `/v1/workflows/run` với một **file input sai contract** (chuỗi trần, hoặc thiếu) **KHÔNG trả 400 — nó TREO** (không phát bất kỳ SSE event nào) cho tới khi client read-timeout.
2. Định dạng **file-object đúng** (`{transfer_method, url|upload_file_id, type}`) làm run **chạy tới terminal ngay** (hết treo) — **đây là lõi của S1**. Việc run **PASS hay FAIL** thì phụ thuộc file mẫu tải được + đúng loại.
3. `requests` ở chế độ `stream=True`: read-timeout trong lúc `iter_lines` nổi lên dưới dạng **`requests.exceptions.ConnectionError`** bọc `urllib3.ReadTimeoutError` — KHÔNG phải `requests.Timeout`. Đây là lý do `sync.py` phân loại nhầm.
4. **`SAMPLE_FILE_URL` hiện tại (W3C PDF) đã CHẾT** — trả `300 Multiple Choices`, Dify tải không được (Case E). ⇒ **remote_url tới URL ngoài là mong manh**; đường tin cậy để run PASS là **S2: bundle file mẫu trong repo + upload qua `local_file`** (Case F đã chứng minh PASS thật qua sync.py). remote_url chỉ nên là fallback, và phải trỏ tới asset ổn định (không phải W3C).

Debug bắt tại chỗ fail (`_fmt_request_error`, tạm thời):
```
ConnectionError
  DIFY_API_URL     = http://localhost:8090/v1        (đúng)
  DIFY_CONSOLE_URL = http://localhost:8090/console/api (đúng)
  proxy = None ; NO_PROXY = localhost,127.0.0.1
  root_cause  = ReadTimeoutError("HTTPConnectionPool(host='localhost', port=8090): Read timed out.")
```

---

## Problem — hai bug độc lập, cộng hưởng thành một chẩn đoán sai chí mạng

**Bug #1 (nguồn) — `resolveInput` sinh file input SAI CONTRACT.**
[`live-test.ts:150-155`](../../apps/builder/server/lib/live-test.ts#L150-L155) hiện gán:
```ts
} else if (t === 'file')      { inputs[v.variable] = SAMPLE_FILE_URL; }        // chuỗi trần
} else if (t === 'file-list') { inputs[v.variable] = [SAMPLE_FILE_URL]; }      // [chuỗi trần]
```
Dify yêu cầu **file-object**, không phải chuỗi. Input sai → run **treo** (Verified A/C). Mọi workflow có input `file`/`file-list` **required** đều không live-test được.

**Bug #2 (che giấu) — `sync.py` phân loại ReadTimeout thành "connection failed".**
[`sync.py` `_fmt_request_error`](../../tools/dify_base/sync.py) kiểm `isinstance(e, requests.ConnectionError)` **trước** → vì read-timeout-khi-streaming là một `ConnectionError` (Verified fact 3), nó trả `connection failed (DNS / unreachable / refused)`. Nhãn này khiến người vận hành truy đuổi lỗi **mạng/DNS/port** (hoàn toàn sai hướng) trong khi thực chất là **run treo do input**.

**Hệ quả kết hợp**: workflow-có-file-input → builder gửi input sai → Dify treo → read-timeout → báo "connection failed (インフラ)". Người dùng thấy "lỗi hạ tầng" và không thể biết bug thật nằm ở input.

---

## Design

### Nguyên tắc cơ động + thứ tự thi công (đọc trước)

Mục tiêu thật không phải "chạy được app có file" mà **live-test cơ động cho MỌI workflow builder sinh ra** — hôm nay là file, mai là input type khác. Đạt bằng **hai lớp độc lập**, ưu tiên lớp phổ quát trước:

- **Lớp A — lưới an toàn phổ quát (làm TRƯỚC, rẻ, độc lập hoàn toàn với file):** `S3` (phân loại read-timeout đúng) **+** `S5` (first-event deadline). Bất kỳ input type nào builder chưa dựng chuẩn → Dify treo → **được gắn nhãn đúng và nhanh** ("run treo, kiểm input" chứ không phải "infra/DNS"). Lớp này type-agnostic ⇒ *tự nó* đã làm live-test cơ động: một workflow lạ không bao giờ làm hỏng chẩn đoán, tệ nhất là degrade-static trung thực. **Không cần build TS, không phụ thuộc file.**
- **Lớp B — dựng input theo type, có thể mở rộng:** `S0`+`S1` reorg `resolveInput` thành **registry `type → builder`** (xem S1). Thêm một type tương lai = thêm một entry, không sửa if-else dài. Mỗi builder hoặc trả giá trị **hợp lệ-contract**, hoặc báo **"không dựng được"** → degrade với reason nêu tên var (S4) — **không bao giờ đoán bừa rồi để treo**.

**Bất biến chống-treo (áp cho mọi type, hiện tại và tương lai):** *live-test chỉ gửi input mà nó CHẮC hợp lệ với contract Dify; không chắc → degrade với reason đúng.* Lớp A bắt phần "lọt lưới", Lớp B thu hẹp phần "lọt lưới" theo thời gian.

**Thứ tự đề xuất (phasing):**
1. **Phase 1 (ship ngay, giá trị cao nhất/độc lập):** S3 + S5. Sửa chẩn đoán sai chí mạng cho *toàn bộ* workflow, kể cả chưa đụng tới file. **Hết treo + hết nhãn "connection failed" sai** cho mọi workflow.
2. **Phase 2 (trung thực hoá — không treo):** S0 + S1(registry) + S4-degrade, **chưa có S2**. Với QA-5=(b), mọi file input (đều cho `local_file`) chưa có `uploadedFileId` → `CANT_BUILD` → **degrade trung thực** (reason nêu tên var), **không treo, không nhãn sai**. *Ở phase này chưa có file-workflow nào PASS — chỉ đảm bảo trung thực.* (Có thể **gộp thẳng S2 vào Phase 2** nếu muốn PASS ngay; tách ra chỉ để ship phần trung-thực-hoá sớm hơn.)
3. **Phase 3 = S2 (để file-workflow chạy PASS thật — LÕI, không optional):** bundle file mẫu + upload `local_file` + truyền `uploadedFileId`. Đường duy nhất đã chứng minh PASS (Case F). Vì QA-5=(b) bỏ remote_url, **mọi** file-workflow xanh đều đi qua S2 ⇒ muốn app repro (`Exel Pdf Url Excel`) PASS thì **bắt buộc** Phase 3.

### S0 — Plumbing: đưa khả-năng-file của start-var tới `resolveInput` (BẮT BUỘC, tiền đề của S1)

S1 đọc `v.allowed_file_types` / `v.allowed_file_upload_methods`, nhưng luồng dữ liệu hiện **không mang** các field này — nếu không sửa, S1 luôn rơi vào default và một app chỉ-`local_file` sẽ lại gửi `remote_url` sai → treo. Phải mở rộng ở **hai** chỗ:

1. **`sync.py cmd_inject_model`** — nơi duy nhất sinh `inputs_schema` ([`sync.py:640-647`](../../tools/dify_base/sync.py#L640-L647)). Thêm vào mỗi start-var:
   ```python
   inputs_schema.append({
       "variable": v.get("variable"),
       "type": v.get("type"),
       "required": bool(v.get("required")),
       "label": v.get("label"),
       "options": v.get("options") or [],
       # spec 047: khả năng file — quyết định transfer_method / type khi dựng sample
       "allowed_file_types": v.get("allowed_file_types") or [],
       "allowed_file_upload_methods": v.get("allowed_file_upload_methods") or [],
       "allowed_file_extensions": v.get("allowed_file_extensions") or [],
   })
   ```
2. **`InputVar`** ([`dify-io.ts:683-689`](../../apps/builder/server/lib/dify-io.ts#L683-L689)) — thêm 3 field optional:
   ```ts
   allowed_file_types?: string[];           // ['document'|'image'|'audio'|'video'|'custom']
   allowed_file_upload_methods?: string[];  // ['local_file'|'remote_url']
   allowed_file_extensions?: string[];      // ['.xlsx', …]
   ```

Backward-safe: cả ba default rỗng. Một `sync.py` cũ (không phát field) → `allowed_file_upload_methods` undefined → `fileValue` default `['local_file']` → cần `uploadedFileId` (S2), không có thì `CANT_BUILD` → degrade trung thực (không treo). Đúng tinh thần QA-5=(b). **QA-1** (đã xác nhận qua POC + template, xem §QA): key phẳng `allowed_file_types`/`allowed_file_upload_methods`/`allowed_file_extensions` ngay trong start-var.

### S1 — `resolveInput` thành registry `type → builder` (cơ động + load-bearing)

Thay chuỗi if-else trong `resolveInput` bằng một **bảng builder** để thêm type tương lai chỉ là một entry, và mỗi builder có ba kết cục rõ ràng: **giá trị hợp lệ** | **`CANT_BUILD`** (→ degrade, S4) | (không match → `missing`, giữ nguyên hành vi `need_input`). Đây là điểm khiến live-test cơ động thay vì chắp vá.

```ts
const CANT_BUILD = Symbol('cant-build');           // builder biết type nhưng KHÔNG dựng nổi input hợp lệ
type Built = unknown | typeof CANT_BUILD;
type BuildCtx = { uploadedFileId?: string };        // S2 chuẩn bị trước, truyền xuống (resolveInput vẫn PURE)

const INPUT_BUILDERS: Record<string, (v: InputVar, ctx: BuildCtx) => Built> = {
  'text-input': (v) => `Sample input for "${v.label || v.variable}" (builder live-test).`,
  'paragraph':  (v) => `Sample input for "${v.label || v.variable}" (builder live-test).`,
  'text':       (v) => `Sample input for "${v.label || v.variable}" (builder live-test).`,
  'number':     () => 1,
  'boolean':    () => true,
  'select':     (v) => (Array.isArray(v.options) && v.options.length ? v.options[0] : 'option_a'),
  'file':       (v, c) => fileValue(v, c),
  'file-list':  (v, c) => { const f = fileValue(v, c); return f === CANT_BUILD ? CANT_BUILD : [f]; },
};

function fileValue(v: InputVar, ctx: BuildCtx): Built {
  const type = v.allowed_file_types?.[0] ?? 'document';        // document|image|audio|video|custom
  const methods = v.allowed_file_upload_methods ?? ['local_file'];
  // QA-5 = (b) ĐÃ CHỐT: CHỈ đi đường local_file + file BUNDLED (đường duy nhất PASS thật — Case F 2.5s).
  // remote_url bị BỎ HẲN: (1) một test LOCAL không nên phụ thuộc internet, (2) SAMPLE_FILE_URL cũ đã chết (Case E: 300).
  if (methods.includes('local_file')) {
    return ctx.uploadedFileId
      ? { transfer_method: 'local_file', upload_file_id: ctx.uploadedFileId, type }
      : CANT_BUILD;                    // cần S2 upload trước; KHÔNG gửi id rỗng
  }
  return CANT_BUILD;                   // input CHỈ cho remote_url → degrade trung thực (S4), không đoán URL ngoài
}
```
> **Không còn hằng `STABLE_SAMPLE_URL`/`SAMPLE_FILE_URL`** — QA-5=(b) xóa hoàn toàn nhánh remote_url. Một input file **chỉ** cho `remote_url` (hiếm) → `CANT_BUILD` → degrade với reason "input `<name>` chỉ nhận remote_url — live-test không tự dựng URL ngoài".

`resolveInput(vars, ctx)` duyệt required vars: builder trả giá trị → set; trả `CANT_BUILD` → đẩy var vào **`cannotBuild[]`**; không có builder cho type → `missing[]` (giữ nguyên `need_input`). Chữ ký trả về thêm `cannotBuild` để sub-orchestrator **degrade-static với reason nêu tên var + type** (S4) thay vì chạy-rồi-treo.

- `type` map từ `allowed_file_types[0]` (không hard-code `document`).
- **Chỉ đi `local_file` + file mẫu bundled** (đường duy nhất đã chứng minh PASS — Case F). `remote_url` đã **bỏ hẳn** (QA-5=(b)). Input chỉ-remote_url hoặc dựng không nổi → `CANT_BUILD` → degrade (S4). **Không còn đường nào gửi `upload_file_id: ''`, chuỗi trần, hay URL ngoài.**
- **Hệ quả phasing (quan trọng):** vì đường PASS duy nhất đòi `ctx.uploadedFileId`, **S2 là phần LÕI để một file-workflow chạy PASS**, không phải "nice-to-have Phase 3". ⇒ **Phase 2 phải gồm cả S2** (xem lại phasing ở cuối).

### S2 — Khi input chỉ nhận `local_file`: upload sample rồi truyền `upload_file_id`

Thêm một live-op `uploadSampleFile(projectsDir, appKey)` gọi `POST {base}/v1/files/upload` (multipart, `user:"builder-live-test"`) với một file mẫu **bundled trong repo** (không phụ thuộc mạng ngoài), trả `upload_file_id`. Verified B chứng minh đường `local_file + upload_file_id` chạy (2.8s).

**Chốt kiến trúc (không để "hoặc")**: **giữ `resolveInput` PURE/sync**. Sub-orchestrator ([`live-test.ts`](../../apps/builder/server/lib/live-test.ts)) quyết định *trước bước run*: nếu có ≥1 required var `file`/`file-list` **cho `local_file`** (QA-5=(b): đó là mọi file input trừ loại hiếm chỉ-remote_url), gọi `uploadSampleFile` **một lần** (chọn asset bundled theo `allowed_file_extensions`/`type` của var đầu — xem ghi chú), rồi truyền `uploadedFileId` **xuống** `resolveInput(vars, { uploadedFileId })` như tham số. `resolveInput` chỉ *dùng* id đã có, không tự upload → vẫn thuần, unit-test không cần mạng. Call-site hiện tại ([`live-test.ts:243-244`](../../apps/builder/server/lib/live-test.ts#L243-L244)) chỉ thêm một tham số optional, không đổi chữ ký thành async.

*Ghi chú (đã chỉnh theo POC)*: `SAMPLE_FILE_URL` cũ (W3C PDF) **ĐÃ CHẾT** — trả `300` (Case E), KHÔNG dùng được nữa. Đường tin cậy là **file mẫu bundled trong repo + upload `local_file`** (Case F: PASS thật 2.5s). Nên bundle **vài sample theo đuôi phổ biến** (`.xlsx`, `.png`, `.txt`, PDF hợp lệ) và chọn theo `allowed_file_extensions` để: (a) tránh sai loại làm node fail, (b) T3-judge chấm output có nghĩa. Với app repro (`.xlsx`), một sample `.xlsx` bundled là **bắt buộc để verdict = passed** (một PDF vẫn `workflow_finished` nhưng output rác → dễ workflow_fail).

### S3 — `sync.py` phân loại ReadTimeout đúng (bỏ nhãn "connection failed" sai)

Trong `_fmt_request_error`, **kiểm ReadTimeout TRƯỚC** `ConnectionError`, kể cả khi bị bọc **nhiều tầng**. Không soi một tầng `e.args` (dễ trượt nếu bọc sâu `ConnectionError(ProtocolError(ReadTimeoutError))` hay qua `MaxRetryError`) — walk đệ quy **và** có string-fallback:

```python
from urllib3.exceptions import ReadTimeoutError

def _is_read_timeout(e):
    if isinstance(e, requests.Timeout):
        return True
    # stream=True: ReadTimeoutError bị bọc (có thể NHIỀU tầng) trong requests.ConnectionError.
    seen = set()
    def walk(x, depth=0):
        if x is None or id(x) in seen or depth > 6:
            return False
        seen.add(id(x))
        if isinstance(x, ReadTimeoutError):
            return True
        for a in getattr(x, 'args', ()) or ():
            if isinstance(a, BaseException) and walk(a, depth + 1):
                return True
        return False
    if walk(e):
        return True
    # fallback cuối: một số build chỉ để lại chuỗi "Read timed out." trong message.
    return 'read timed out' in str(e).lower()

def _fmt_request_error(e):
    if _is_read_timeout(e):
        # message TRUNG TÍNH: _fmt_request_error dùng chung cho list/pull/push/diff, KHÔNG chỉ `run`.
        # Đừng khẳng định "workflow treo" cho một lệnh không chạy workflow.
        # TỰ-BÁO-CÁO: nhúng tên class exception thật → nếu phân loại có sai, người/logs vẫn thấy nguyên nhân gốc.
        return ("read timeout — server nhận kết nối nhưng KHÔNG stream phản hồi trong thời hạn "
                f"(với `run`: workflow treo, kiểm input bắt buộc / node kẹt) — KHÔNG phải lỗi mạng [{e.__class__.__name__}]")
    if isinstance(e, requests.ConnectionError):
        return f"connection failed (DNS / unreachable / refused) — {e.__class__.__name__}"
    ...
```

Đồng thời trong `live-test.ts`, một run **read-timeout** phải map sang một `LiveTestResult` reason **phân biệt** với connection-refused (vẫn là `infra`/degrade-static theo 032 D1c, nhưng reason text đúng bản chất). Xoá đoạn debug tạm đã chèn ở `_fmt_request_error`.

**QA-2 — xử lý bằng "an toàn-by-construction", KHÔNG cần đoán đúng shape (đã chốt cách làm).**

Bản chất lo ngại cũ: phải soi đúng cấu trúc bọc của exception `requests` ném. Thay vì cược vào việc đoán đúng, **thiết kế để dù đoán sai vẫn KHÔNG hại** — 4 lớp:

1. **Không phụ thuộc introspection cho ca chính (treo).** S5 first-event deadline là **timer của CHÍNH TA**: đặt deadline (vd 20s) **ngắn hơn** socket read-timeout (120s) ⇒ khi workflow treo, timer ta bắn **trước**, ta tự raise `RunHungNoStream` (exception mình định nghĩa, message rõ) — **không đụng tới exception mờ của `requests`**. Ca đúng-là-bug được bắt tất định.
2. **Arm shape-độc-lập là chính, không phải phụ.** `'read timed out' in str(e).lower()` đúng **bất kể** bọc mấy tầng (mọi `ReadTimeoutError` đều render chuỗi "Read timed out." trong message của exception ngoài). Coi string-match là arm **chính**; isinstance-walk chỉ là bonus cho reason đẹp.
3. **Tự-báo-cáo (chính là ý "đẩy lỗi quay lại confirm" của bạn, làm sẵn).** Message nhúng `[{e.__class__.__name__}]`. Nếu một exception lạ bị phân loại sai, **người/logs vẫn thấy class gốc** ngay trong reason → chẩn đoán được, không mù.
4. **Đã sẵn park-at-gate — không bao giờ false-green.** Mọi read-timeout → `infra_fail` → degrade-static → **dừng ở human confirm gate** (032 D1c). Phân loại sai chỉ làm **reason chữ sai**, KHÔNG đổi verdict, KHÔNG tự động pass. Đây đúng là "đẩy lại confirm" — có sẵn trong FSM.

⇒ **Hệ quả**: được phép dùng ngay, không chờ POC. Worst case của "đoán sai shape" = reason hiển thị hơi lệch (nhưng có class gốc kèm) + vẫn park cho người xem — **không phải một verdict sai**. Vì vậy QA-2 **hạ từ blocker xuống nice-to-have**.

*Nice-to-have (không chặn):* khi nào tiện, chạy `run` vào một app treo (Case C), `except ... as e:` in `repr(e)`/`e.__cause__`, **dùng exception thật đó làm fixture** cho AC3 và thêm một isinstance-arm chính xác. Chỉ để reason đẹp hơn, không đổi tính đúng.

### S4 (preflight) — chặn sớm khi không dựng nổi input hợp lệ

> **Ràng buộc bắt buộc**: S1(registry) đã đảm bảo *không đường nào gửi input rỗng* — file chỉ-`local_file` không có `ctx.uploadedFileId` trả `CANT_BUILD`. S4 là nơi **tiêu thụ** `CANT_BUILD`/`cannotBuild[]`: degrade-static với reason nêu tên var. Do đó **Phase 2 (S1 chưa có S2) BẮT BUỘC có S4** để `CANT_BUILD` biến thành một degrade tử tế thay vì run rỗng. Khi Phase 3 bật S2, `ctx.uploadedFileId` có giá trị ⇒ builder trả object thật ⇒ S4 chỉ còn chặn các `type` lạ thật sự.

Cụ thể trong sub-orchestrator: sau `resolveInput(vars, ctx)`, nếu `cannotBuild.length > 0` → `degradeStatic("không dựng được sample cho input <name> kiểu <type>")` **trước** khi phát bất kỳ request run nào. Nguyên tắc chung (nhắc lại từ Lớp A): *live-test không bao giờ gửi input không chắc hợp lệ; không chắc → degrade với reason đúng, không để Dify treo.*

### S5 (khuyến nghị — Lớp A, lưới an toàn phổ quát) — first-event deadline: bắt treo NHANH & type-agnostic

Verified fact: input **hợp lệ** khiến Dify phát SSE gần như tức thì (`workflow_started`, rồi 0.4–2.8s xong); input **treo** phát **0 event** cho tới read-timeout (A/C: 15s im lặng). ⇒ dấu hiệu treo mạnh nhất, **không phụ thuộc type/độ nặng workflow**, là *"không có event ĐẦU TIÊN nào trong X giây"* — vì Dify phát `workflow_started` ngay khi nhận, TRƯỚC khi chạy node (nên một LLM chậm vẫn phát event đầu sớm).

Trong `_collect_stream`, đặt một **first-event deadline** riêng (vd 20s): nếu tới hạn mà chưa đọc được event SSE nào → raise một lỗi phân loại rõ (`RunHungNoStream`) → `_fmt_request_error` cho reason "server nhận nhưng không phát event nào — workflow treo". Sau event đầu, chuyển sang read-timeout inter-chunk như hiện tại (LLM stream dài không bị cắt oan).

> **Ràng buộc then chốt (nền tảng của QA-2 lớp 1): `first_event_deadline` (20s) < socket read-timeout (120s).** Nhờ đó, ở ca treo, **timer của TA bắn trước** và ta raise `RunHungNoStream` tất định — không bao giờ phải trông chờ vào `ConnectionError(ReadTimeoutError)` mờ của `requests`. **Elegant**: cho `class RunHungNoStream(requests.Timeout)` — kế thừa `requests.Timeout` ⇒ (a) `cmd_run`'s `except requests.RequestException` **bắt được** nó, (b) dòng `isinstance(e, requests.Timeout)` **sẵn có** ở đầu `_is_read_timeout` **tự động** trả True → **không thêm một dòng phân loại nào**. Chỉ cần `_fmt_request_error` nhận diện `RunHungNoStream` cho reason "không phát event nào" (rõ hơn "read timeout"). Read-timeout gốc của `requests` chỉ còn là đường dự phòng hiếm (khi deadline bị tắt) — string-match arm ở S3 lo.

- Giá trị: mọi input type **lọt lưới** Lớp B (type mới chưa có builder, builder sai contract) đều bị bắt trong ~20s với nhãn đúng — thay vì chờ 120s read-timeout rồi vẫn phải nhờ S3 phân loại. S5 làm live-test **nhanh và trung thực cho workflow lạ** ngay cả trước khi có builder cho type đó.
- Rẻ & độc lập: chỉ đo thời gian tới `iter_lines` yield đầu tiên; không đụng S0/S1/S2.
- **⚠ QA-4**: xác nhận build Dify đích **không** phát `ping`/keep-alive định kỳ khi treo (nếu có, first-event vẫn fine vì `ping` cũng là event — nhưng khi đó phải phân biệt `ping` với event thật; §Verified A/C cho thấy build này im hoàn toàn 15s ⇒ an toàn, nhưng chốt lại nếu đổi Dify version).

---

## Acceptance Criteria

0. **AC0 (plumbing)** — `cmd_inject_model` phát mỗi start-var kèm `allowed_file_types`/`allowed_file_upload_methods`/`allowed_file_extensions`, và `InputVar` mang ba field đó tới `resolveInput`. `type` của file-value lấy từ `allowed_file_types[0]` (không hard-code `document`). (unit test cả hai phía)
1. **AC1** — Workflow có `input_file` (file-list, required) live-test **chạy tới `workflow_finished`** và verdict là `passed`/`workflow_fail` (tuỳ output), **KHÔNG còn** `infra_fail`/ConnectionError. *(Repro: chính app `Exel Pdf Url Excel`.)*
2. **AC2** — `resolveInput` cho `file`/`file-list` (khi có `ctx.uploadedFileId`) trả **object** `{transfer_method:'local_file', upload_file_id, type}` với `type` từ `allowed_file_types[0]`; **không** có `ctx.uploadedFileId` → `CANT_BUILD` (vào `cannotBuild[]`); input chỉ-remote_url → `CANT_BUILD`. Không đường nào trả chuỗi trần / URL ngoài. (unit test)
3. **AC3** — Một run bị **read-timeout / treo** cho ra reason chứa "timed out"/"treo" + kèm `[<class>]`, **KHÔNG** chứa "connection failed (DNS…)". Một run tới host **thật sự refused** vẫn cho "connection failed". (unit test cho `_is_read_timeout` với các ca: `RunHungNoStream` (đường S5, `isinstance requests.Timeout` → True), `ConnectionError` chỉ-chuỗi `"Read timed out."` (string-arm), `ConnectionError(ReadTimeoutError)` (walk-arm), và `ConnectionError` trần → False.)
4. **AC4** — Không có input `file`/`file-list` nào gửi tới Dify dưới dạng **chuỗi trần**. (guard/test)
5. **AC5 (S4)** — `resolveInput` trả `cannotBuild` chứa var chỉ-`local_file` (khi chưa có `uploadedFileId`) hoặc `type` lạ; sub-orchestrator `degradeStatic` với reason nêu tên var + kiểu, **không phát request run**. (unit + orchestrator test)
6. **AC6 (S5)** — Một run mà server **không phát event SSE nào** trong first-event deadline → phân loại "workflow treo / không stream", verdict `infra_fail` reason đúng, **trong ~deadline giây** (không chờ tới read-timeout 120s). Một run phát `workflow_started` rồi stream chậm **KHÔNG** bị cắt oan. (unit cho `_collect_stream` với stream giả: (a) im hoàn toàn, (b) event đầu trễ-nhưng-trong-hạn rồi chunk thưa.)

## Test plan

- **Unit (S0)**: `cmd_inject_model` trên một YAML có start-var file → assert `inputs[].allowed_file_types|allowed_file_upload_methods|allowed_file_extensions` xuất hiện; `DeployResult.inputs` mang chúng qua `InputVar`.
- **Unit**: `resolveInput(vars, ctx)` cho `file`/`file-list`: (a) có `ctx.uploadedFileId` → object `local_file`; (b) không có → `CANT_BUILD`/`cannotBuild[]`; (c) input chỉ-remote_url → `CANT_BUILD`; `type` từ `allowed_file_types[0]`. `_is_read_timeout` với các ca: `RunHungNoStream`, `ConnectionError` chỉ-chuỗi "Read timed out.", `ConnectionError(ReadTimeoutError)` (một tầng) + bọc **sâu**, `Timeout` trần → True; `ConnectionError` trần → False. `_fmt_request_error` assert read-timeout KHÔNG chứa "connection failed" và có `[<class>]`.
- **Live (opt-in, creds-gated — theo 021/032)**: chạy `Exel Pdf Url Excel` end-to-end. **Phase 2** (chưa S2): assert **degrade với reason nêu tên var** (không treo, không nhãn infra sai). **Phase 3** (có S2): assert `workflow_finished` + verdict `passed` (cần sample `.xlsx` bundled). Mở rộng: một workflow input `file` single, một workflow chỉ-remote_url → assert degrade trung thực.
- **Regression**: workflow **không** file-input vẫn chạy như cũ (043 llm-less + input text/number).

## Rollout / cleanup

- **Phase 1 rẻ nhất**: S3 + S5 chỉ đụng `sync.py` (`_fmt_request_error`/`_is_read_timeout`/`_collect_stream`) → **không cần build**, restart-nhẹ. Ship trước, thu lợi phổ quát ngay.
- Phase 2: S0 (`sync.py cmd_inject_model` + TS `InputVar`/`resolveInput`/`live-test.ts`) → phần TS cần **`npm run build` + restart builder** (builder chạy `dist/server/index.js`); phần `sync.py` không.
- Phase 3: S2 (`dify-io.ts` live-op upload + `live-test.ts`) → build + restart.
- Dọn: gỡ đoạn debug tạm trong `_fmt_request_error`; `DIFY_API_URL`/`NO_PROXY` thêm vào `apps/builder/.env` là vô hại, giữ lại như cấu hình tường minh (không phải nguyên nhân bug).

## QA / Open items (phải xác nhận thật trước hoặc trong implement)

- **QA-1 — tên field khả-năng-file trong start-var YAML.** ✅ **Phần lớn đã xác nhận qua POC**: `GET /console/api/apps/<id>/workflows/draft` của `Exel Pdf Url Excel` trả start-var với đúng 3 key `allowed_file_types` / `allowed_file_upload_methods` / `allowed_file_extensions` (giá trị `["document"]` / `["local_file","remote_url"]` / `[".xlsx",".xls"]`). **Còn phải chốt**: bản **DSL export** mà `cmd_inject_model` đọc có dùng **cùng key phẳng** như draft-API không (có thể khác/lồng trong `config`). Đọc thẳng YAML export để xác nhận trước khi code S0. — *Corroboration từ repo*: [`templates/patterns/file-to-llm.yml:99-112`](../../templates/patterns/file-to-llm.yml#L99-L112) (đây là DSL export-shape) mang đúng 3 key **phẳng** ngay trong `graph.nodes[].data.variables[]`, cùng cấp `variable`/`type`/`required` — mạnh mẽ ủng hộ giả định S0; chỉ còn xác nhận một export runtime thật cho chắc.
- **QA-2 — shape exception read-timeout thật. ✅ ĐÃ HẠ TỪ BLOCKER XUỐNG NICE-TO-HAVE** (xử lý an toàn-by-construction, chi tiết ở S3). Không cần đoán đúng shape để đúng: (1) S5 raise `RunHungNoStream(requests.Timeout)` tất định cho ca treo — không introspection; (2) arm string-match `'read timed out'` shape-độc-lập lo đường dự phòng; (3) message tự-nhúng `[{class}]`; (4) mọi read-timeout vẫn **park ở confirm gate** (032 D1c) ⇒ sai chỉ làm reason lệch, KHÔNG false-green. *Nice-to-have*: khi tiện, bắt exception thật từ run treo làm fixture AC3 để thêm isinstance-arm chính xác (chỉ đẹp reason).
- **QA-3 — `POST /v1/files/upload` contract (Phase 3 / S2).** ✅ **Đã xác nhận qua POC**: endpoint trả JSON có field **`id`** (Case B/F dùng `resp.json()["id"]` làm `upload_file_id` → run PASS), multipart field name = `file`, cần form field `user`. Header chỉ cần `Authorization: Bearer <app-key>`. **Còn phải làm khi code S2**: bundle asset đọc được từ repo + map extension↔type. *(Lưu ý: field trả là `id`, KHÔNG phải `upload_file_id` — khi truyền vào `inputs` mới đặt tên `upload_file_id`.)*
- **QA-4 — Dify có phát `ping`/keep-alive khi treo không (S5).** §Verified A/C cho thấy build hiện tại **im hoàn toàn** 15s ⇒ first-event deadline an toàn. Nếu đổi Dify version và nó phát `ping` định kỳ, phải loại `ping` khỏi "event đầu tiên hợp lệ". Chốt lại khi nâng cấp Dify.
- **QA-5 — ✅ ĐÃ CHỐT = (b): bỏ hẳn remote_url.** `fileValue` chỉ đi `local_file` + file bundled; input **chỉ** cho remote_url → `CANT_BUILD` → degrade (S4). Không còn `SAMPLE_FILE_URL`/`STABLE_SAMPLE_URL` (xóa khỏi code). Lý do: self-contained, không phụ thuộc internet cho một test *local*, khớp POC (Case F PASS / Case E URL chết). *Đánh đổi chấp nhận*: một workflow chỉ-remote_url không chạy PASS mà degrade — hiếm, và trung thực.
- **Phạm vi đã chốt (phasing ở đầu Design):** Phase 1 = S3+S5 (ship ngay, lợi ích phổ quát, chỉ `sync.py`); Phase 2 = S0+S1(registry)+S4-degrade (mọi file input degrade trung thực, không treo); **Phase 3 = S2 (LÕI, bắt buộc để file-workflow PASS thật — không optional với QA-5=(b)).** Có thể gộp Phase 2+3 nếu muốn PASS ngay.

## Non-goals

- Không đổi gate FSM / confirm-loop (032) / permission-gate / `claude-session.ts` strip `DIFY_*`.
- Không tự suy đoán **giá trị nghiệp vụ** của input (vẫn là sample placeholder); mục tiêu là input **hợp lệ về contract** để run chạy được và verdict phản ánh đúng.

## Implementation notes (2026-07-08)

Đã code cả 3 phase một lượt (mục tiêu: file-workflow test PASS thật). Điểm khác/thêm so với spec:

- **Thêm sentinel `NEEDS_UPLOAD` bên cạnh `CANT_BUILD`** (`live-test.ts`). Spec chỉ có `CANT_BUILD`, nhưng upload cần app-key (mint ở step 6) — sau `resolveInput` (step 3). Nên `resolveInput` phân biệt: file var cho `local_file` mà chưa có `uploadedFileId` → `NEEDS_UPLOAD` (fixable, sẽ upload rồi resolve lại), khác với chỉ-remote_url → `CANT_BUILD` (degrade). `resolveInput` trả `{ inputs, missing, cannotBuild, needsUpload }`. Vẫn PURE (ctx truyền vào), gọi 2 lần: pre-mint (bắt need_input + cannotBuild sớm) và post-upload (điền file-object).
- **Luồng orchestrator**: chèn **step 6.5** sau mint-key: `if (first.needsUpload) → uploadSampleFile(key) → resolveInput(…, {uploadedFileId})`. Upload fail → `degradeStatic` (infra, không phát run). `base.input`/`runInput` dời xuống sau upload.
- **S5 — sửa cách hiện thực sau khi test thật.** Bản đầu dùng **daemon-thread watchdog + `r.close()`** ⇒ **KHÔNG chạy** (verify trên Dify thật: hang treo tới 90s, `r.close()` từ thread khác **không interrupt được `iter_lines` đang block ở socket recv**). Đổi sang: **socket read-timeout per-recv = `FIRST_EVENT_DEADLINE_S`** (env `DIFY_FIRST_EVENT_DEADLINE_S`, mặc định 20) — đây là cơ chế deadline **duy nhất** thực sự interrupt. Trong `_collect_stream` phân biệt: chưa thấy **event có nghĩa** nào (bỏ qua `ping`/blank Dify gửi lúc đầu) → `RunHungNoStream` (message crisp); đã thấy event → re-raise (stall giữa chừng, S3 vẫn gắn nhãn read-timeout). Overall wall-clock vẫn do outer execFile timeout (`runWorkflow` truyền `timeoutMs+5000`) chặn. **Verify thật (Dify 8090)**: hang zero-SSE → `RunHungNoStream` ở **~11s** (thay vì 90s); xlsx hợp lệ → `succeeded` ở **2s**, KHÔNG bị deadline 10s cắt oan.
  - Đánh đổi: read-timeout per-recv giờ = deadline (thay 120s), nên một node **im lặng > deadline** (không phát SSE) sẽ bị coi là stall. Với live-test input mẫu (workflow nhanh, Dify phát node-events đều) rủi ro thấp; env override nếu cần.
- **Sample assets** bundled tại [`apps/builder/server/assets/live-test-samples/`](../../apps/builder/server/assets/live-test-samples/) (`.xlsx/.csv/.txt/.pdf/.png`), chọn theo `allowed_file_extensions` rồi `allowed_file_types[0]` (`chooseSample` trong `dify-io.ts`). Repo-root-relative nên `sync.py` đọc được bất kể server chạy từ `dist/`.
- **QA-2 đóng thực nghiệm**: `_is_read_timeout` pass cả ca bọc sâu thật `ConnectionError(ProtocolError(ReadTimeoutError))` + ca chỉ-chuỗi — không cần fixture đoán.
- **AC1 verify thật (Dify 8090, app `Exel Pdf Url Excel`)**: mint key → `sync.py upload` (bundled xlsx → field `id`) → run với file-object `local_file` → **`status: succeeded`**, output thật (`csv_table`/`markdown_table`/`count`). Đúng path builder step 6→6.5→7.
- **Còn lại (tùy chọn)**: một lượt bấm qua **UI builder** (4123) end-to-end cho một build có file-input — backend đã verify đầy đủ; UI chỉ là lớp hiển thị (không đổi trong spec này).
