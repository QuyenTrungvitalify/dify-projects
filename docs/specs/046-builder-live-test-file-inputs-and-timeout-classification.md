# Spec 046 — Builder live-test: file inputs đúng contract + phân loại timeout/lỗi chính xác

**Status**: Draft — **root cause đã verify thật** trên Dify self-host `localhost:8090` (2026-07-08) bằng A/B/C/D matrix (xem §Verified). Fix là **additive**, không đổi gate FSM / permission-gate / validators. Tiền đề bắt buộc **S0** (plumbing khả-năng-file qua `cmd_inject_model` + `InputVar`) đã được nêu tường minh — không có blocker kiến trúc; còn **3 mục QA** (QA-1..3, xem §QA) cần xác nhận thật trong lúc implement.
**Effort**: S — ba điểm sửa nhỏ, có test rõ ràng: (0) **plumbing**: `cmd_inject_model` + `InputVar` mang thêm 3 field khả-năng-file (load-bearing cho S1 — xem S0), (1) `resolveInput` sinh **file-object** đúng contract (thay chuỗi URL trần), (2) `sync.py` phân loại **ReadTimeout-khi-streaming** đúng thay vì dán nhãn "connection failed". Tuỳ chọn (3) preflight degrade khi không dựng nổi input hợp lệ.

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
1. **Phase 1 (ship ngay, giá trị cao nhất/độc lập):** S3 + S5. Sửa chẩn đoán sai chí mạng cho *toàn bộ* workflow, kể cả chưa đụng tới file.
2. **Phase 2:** S0 + S1(registry) + S4-degrade. File `remote_url` chạy thật; file chỉ-`local_file` **degrade trung thực** (chưa cần S2).
3. **Phase 3 (khi cần chạy thật app local_file-only):** S2 (upload sample) — thay nhánh degrade của Phase 2 bằng chạy thật.

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
       # spec 046: khả năng file — quyết định transfer_method / type khi dựng sample
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

Backward-safe: cả hai đều default rỗng, một `sync.py` cũ (không phát field) khiến `resolveInput` rơi về nhánh `remote_url` mặc định — đúng hành vi hiện tại. **⚠ QA-1**: xác nhận tên field trong start-var YAML của Dify đúng là `allowed_file_types` / `allowed_file_upload_methods` / `allowed_file_extensions` (đọc thẳng DSL của app `Exel Pdf Url Excel` để chắc — §Verified nêu các giá trị này nhưng chưa dán key gốc từ YAML).

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
  const methods = v.allowed_file_upload_methods ?? ['remote_url'];
  if (methods.includes('remote_url')) {
    return { transfer_method: 'remote_url', url: SAMPLE_FILE_URL, type };   // nhanh, không upload (Verified D 0.4s)
  }
  if (ctx.uploadedFileId) {                                     // S2 đã upload sẵn
    return { transfer_method: 'local_file', upload_file_id: ctx.uploadedFileId, type };
  }
  return CANT_BUILD;                                            // chỉ-local_file mà chưa có S2 → degrade, KHÔNG gửi id rỗng
}
```

`resolveInput(vars, ctx)` duyệt required vars: builder trả giá trị → set; trả `CANT_BUILD` → đẩy var vào **`cannotBuild[]`**; không có builder cho type → `missing[]` (giữ nguyên `need_input`). Chữ ký trả về thêm `cannotBuild` để sub-orchestrator **degrade-static với reason nêu tên var + type** (S4) thay vì chạy-rồi-treo.

- `type` map từ `allowed_file_types[0]` (không hard-code `document`).
- Ưu tiên `remote_url` (không upload, nhanh). `local_file`-only → cần `ctx.uploadedFileId` (S2) hoặc → `CANT_BUILD` → degrade (S4). **Không còn đường nào gửi `upload_file_id: ''`.**

### S2 — Khi input chỉ nhận `local_file`: upload sample rồi truyền `upload_file_id`

Thêm một live-op `uploadSampleFile(projectsDir, appKey)` gọi `POST {base}/v1/files/upload` (multipart, `user:"builder-live-test"`) với một file mẫu **bundled trong repo** (không phụ thuộc mạng ngoài), trả `upload_file_id`. Verified B chứng minh đường `local_file + upload_file_id` chạy (2.8s).

**Chốt kiến trúc (không để "hoặc")**: **giữ `resolveInput` PURE/sync**. Sub-orchestrator ([`live-test.ts`](../../apps/builder/server/lib/live-test.ts)) quyết định *trước bước run*: nếu có ≥1 required var `file`/`file-list` mà **mọi** var đó không cho `remote_url` (chỉ `local_file`), gọi `uploadSampleFile` một lần, rồi truyền `uploadedFileId` **xuống** `resolveInput(vars, { uploadedFileId })` như tham số. `resolveInput` chỉ *dùng* id đã có, không tự upload → vẫn thuần, unit-test không cần mạng. Call-site hiện tại ([`live-test.ts:243-244`](../../apps/builder/server/lib/live-test.ts#L243-L244)) chỉ thêm một tham số optional, không đổi chữ ký thành async.

*Ghi chú*: `SAMPLE_FILE_URL` hiện là PDF; đủ để `workflow_finished` (Verified D) nhưng output có thể vô nghĩa với workflow chờ `.xlsx`. **Nâng cấp tuỳ chọn**: bundle vài sample theo `type`/đuôi phổ biến (`.xlsx`, `.png`, `.txt`) và chọn theo `allowed_file_extensions` để T3-judge có output thật hơn. KHÔNG bắt buộc cho fix chính (T1 chỉ cần chạy xong).

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
        return ("read timeout — server nhận kết nối nhưng KHÔNG stream phản hồi trong thời hạn "
                "(với `run`: workflow treo, kiểm input bắt buộc / node kẹt) — KHÔNG phải lỗi mạng")
    if isinstance(e, requests.ConnectionError):
        return f"connection failed (DNS / unreachable / refused) — {e.__class__.__name__}"
    ...
```

Đồng thời trong `live-test.ts`, một run **read-timeout** phải map sang một `LiveTestResult` reason **phân biệt** với connection-refused (vẫn là `infra`/degrade-static theo 032 D1c, nhưng reason text đúng bản chất). Xoá đoạn debug tạm đã chèn ở `_fmt_request_error`.

**⚠ QA-2 (không thể chốt từ code)**: unit-test AC3 phải dùng **đúng exception thật** mà `requests` ném khi read-timeout giữa `iter_lines`, KHÔNG phải một `ConnectionError(ReadTimeoutError(...))` tự dựng theo giả định. Rủi ro: nếu shape thật bọc sâu hơn (`MaxRetryError`/`ProtocolError`), một test dựng nông sẽ **pass** trong khi production vẫn phân loại nhầm. Cách bắt: chạy `run` vào một app treo (tái lập Case C), `except requests.RequestException as e:` rồi `repr(e)` + duyệt `e.args`/`e.__cause__` để chốt cấu trúc, dùng chính nó làm fixture. Debug dump ở §Verified đã có `root_cause = ReadTimeoutError(...)` nhưng **chưa xác nhận** nó nằm trực tiếp ở `e.args[0]` hay sâu hơn.

### S4 (preflight) — chặn sớm khi không dựng nổi input hợp lệ

> **Ràng buộc bắt buộc**: S1(registry) đã đảm bảo *không đường nào gửi input rỗng* — file chỉ-`local_file` không có `ctx.uploadedFileId` trả `CANT_BUILD`. S4 là nơi **tiêu thụ** `CANT_BUILD`/`cannotBuild[]`: degrade-static với reason nêu tên var. Do đó **Phase 2 (S1 chưa có S2) BẮT BUỘC có S4** để `CANT_BUILD` biến thành một degrade tử tế thay vì run rỗng. Khi Phase 3 bật S2, `ctx.uploadedFileId` có giá trị ⇒ builder trả object thật ⇒ S4 chỉ còn chặn các `type` lạ thật sự.

Cụ thể trong sub-orchestrator: sau `resolveInput(vars, ctx)`, nếu `cannotBuild.length > 0` → `degradeStatic("không dựng được sample cho input <name> kiểu <type>")` **trước** khi phát bất kỳ request run nào. Nguyên tắc chung (nhắc lại từ Lớp A): *live-test không bao giờ gửi input không chắc hợp lệ; không chắc → degrade với reason đúng, không để Dify treo.*

### S5 (khuyến nghị — Lớp A, lưới an toàn phổ quát) — first-event deadline: bắt treo NHANH & type-agnostic

Verified fact: input **hợp lệ** khiến Dify phát SSE gần như tức thì (`workflow_started`, rồi 0.4–2.8s xong); input **treo** phát **0 event** cho tới read-timeout (A/C: 15s im lặng). ⇒ dấu hiệu treo mạnh nhất, **không phụ thuộc type/độ nặng workflow**, là *"không có event ĐẦU TIÊN nào trong X giây"* — vì Dify phát `workflow_started` ngay khi nhận, TRƯỚC khi chạy node (nên một LLM chậm vẫn phát event đầu sớm).

Trong `_collect_stream`, đặt một **first-event deadline** riêng (vd 20s): nếu tới hạn mà chưa đọc được event SSE nào → raise một lỗi phân loại rõ (`RunHungNoStream`) → `_fmt_request_error` cho reason "server nhận nhưng không phát event nào — workflow treo". Sau event đầu, chuyển sang read-timeout inter-chunk như hiện tại (LLM stream dài không bị cắt oan).

- Giá trị: mọi input type **lọt lưới** Lớp B (type mới chưa có builder, builder sai contract) đều bị bắt trong ~20s với nhãn đúng — thay vì chờ 120s read-timeout rồi vẫn phải nhờ S3 phân loại. S5 làm live-test **nhanh và trung thực cho workflow lạ** ngay cả trước khi có builder cho type đó.
- Rẻ & độc lập: chỉ đo thời gian tới `iter_lines` yield đầu tiên; không đụng S0/S1/S2.
- **⚠ QA-4**: xác nhận build Dify đích **không** phát `ping`/keep-alive định kỳ khi treo (nếu có, first-event vẫn fine vì `ping` cũng là event — nhưng khi đó phải phân biệt `ping` với event thật; §Verified A/C cho thấy build này im hoàn toàn 15s ⇒ an toàn, nhưng chốt lại nếu đổi Dify version).

---

## Acceptance Criteria

0. **AC0 (plumbing)** — `cmd_inject_model` phát mỗi start-var kèm `allowed_file_types`/`allowed_file_upload_methods`/`allowed_file_extensions`, và `InputVar` mang ba field đó tới `resolveInput`. Một app chỉ-`local_file` khiến `resolveInput` **không** chọn `remote_url`. (unit test cả hai phía)
1. **AC1** — Workflow có `input_file` (file-list, required) live-test **chạy tới `workflow_finished`** và verdict là `passed`/`workflow_fail` (tuỳ output), **KHÔNG còn** `infra_fail`/ConnectionError. *(Repro: chính app `Exel Pdf Url Excel`.)*
2. **AC2** — `resolveInput` cho `file`/`file-list` trả **object** `{transfer_method, url|upload_file_id, type}` với `type` lấy từ `allowed_file_types` và `transfer_method` hợp lệ theo `allowed_file_upload_methods`. (unit test)
3. **AC3** — Một run bị **read-timeout** (server im lặng) cho ra reason chứa "timed out"/"treo", **KHÔNG** chứa "connection failed (DNS…)". Một run tới host **thật sự refused** vẫn cho "connection failed". (unit test cho `_fmt_request_error`/`_is_read_timeout` với `ConnectionError(ReadTimeoutError(...))` vs `ConnectionError` trần.)
4. **AC4** — Không có input `file`/`file-list` nào gửi tới Dify dưới dạng **chuỗi trần**. (guard/test)
5. **AC5 (S4)** — `resolveInput` trả `cannotBuild` chứa var chỉ-`local_file` (khi chưa có `uploadedFileId`) hoặc `type` lạ; sub-orchestrator `degradeStatic` với reason nêu tên var + kiểu, **không phát request run**. (unit + orchestrator test)
6. **AC6 (S5)** — Một run mà server **không phát event SSE nào** trong first-event deadline → phân loại "workflow treo / không stream", verdict `infra_fail` reason đúng, **trong ~deadline giây** (không chờ tới read-timeout 120s). Một run phát `workflow_started` rồi stream chậm **KHÔNG** bị cắt oan. (unit cho `_collect_stream` với stream giả: (a) im hoàn toàn, (b) event đầu trễ-nhưng-trong-hạn rồi chunk thưa.)

## Test plan

- **Unit (S0)**: `cmd_inject_model` trên một YAML có start-var file → assert `inputs[].allowed_file_types|allowed_file_upload_methods|allowed_file_extensions` xuất hiện; `DeployResult.inputs` mang chúng qua `InputVar`.
- **Unit**: `resolveInput` cho từng type (`file`, `file-list`, kèm biến thể `allowed_file_upload_methods`/`allowed_file_types`) → so object shape; đặc biệt ca **chỉ-`local_file`** phải KHÔNG sinh `remote_url` (mà dùng `uploadedFileId` truyền vào, hoặc → degrade nếu theo S4). `_is_read_timeout`/`_fmt_request_error` với các ca: `ConnectionError(ReadTimeoutError)` (một tầng), bọc **sâu** (`ConnectionError(...(ReadTimeoutError))`), `Timeout` trần, `ConnectionError` trần → assert message read-timeout KHÔNG chứa "connection failed".
- **Live (opt-in, creds-gated — theo 021/032)**: chạy `Exel Pdf Url Excel` end-to-end, assert `workflow_finished` + verdict ≠ infra. Mở rộng: một workflow input `file` (single, remote_url); một workflow chỉ-`local_file` → Phase 2 assert **degrade với reason nêu tên var** (không treo), Phase 3 assert **chạy thật** qua S2.
- **Regression**: workflow **không** file-input vẫn chạy như cũ (043 llm-less + input text/number).

## Rollout / cleanup

- **Phase 1 rẻ nhất**: S3 + S5 chỉ đụng `sync.py` (`_fmt_request_error`/`_is_read_timeout`/`_collect_stream`) → **không cần build**, restart-nhẹ. Ship trước, thu lợi phổ quát ngay.
- Phase 2: S0 (`sync.py cmd_inject_model` + TS `InputVar`/`resolveInput`/`live-test.ts`) → phần TS cần **`npm run build` + restart builder** (builder chạy `dist/server/index.js`); phần `sync.py` không.
- Phase 3: S2 (`dify-io.ts` live-op upload + `live-test.ts`) → build + restart.
- Dọn: gỡ đoạn debug tạm trong `_fmt_request_error`; `DIFY_API_URL`/`NO_PROXY` thêm vào `apps/builder/.env` là vô hại, giữ lại như cấu hình tường minh (không phải nguyên nhân bug).

## QA / Open items (phải xác nhận thật trước hoặc trong implement)

- **QA-1 — tên field khả-năng-file trong start-var YAML.** S0 giả định key gốc là `allowed_file_types` / `allowed_file_upload_methods` / `allowed_file_extensions`. §Verified có *giá trị* nhưng chưa dán *key thô từ DSL*. Đọc thẳng export YAML của `Exel Pdf Url Excel` (start node → `variables[]`) để chốt; nếu Dify dùng tên khác (vd lồng trong `config`), sửa S0 theo đúng key. **Rủi ro nếu sai**: S0 phát rỗng → S1 luôn default → app local_file-only treo lại.
- **QA-2 — shape exception read-timeout thật.** (chi tiết ở S3) Bắt exception thật từ một run treo, chốt cấu trúc bọc, dùng làm fixture AC3. Không dựng fixture theo giả định.
- **QA-3 — `POST /v1/files/upload` contract (chỉ Phase 3 / S2).** Xác nhận field trả về mang `upload_file_id` (một số build trả `id`), header/`user` cần gì, và file bundled đọc được. Verified B chứng minh *đường chạy* nhưng chưa chốt *shape response của endpoint upload* từ builder.
- **QA-4 — Dify có phát `ping`/keep-alive khi treo không (S5).** §Verified A/C cho thấy build hiện tại **im hoàn toàn** 15s ⇒ first-event deadline an toàn. Nếu đổi Dify version và nó phát `ping` định kỳ, phải loại `ping` khỏi "event đầu tiên hợp lệ". Chốt lại khi nâng cấp Dify.
- **Phạm vi đã khuyến nghị (phasing ở đầu Design):** Phase 1 = S3+S5 (ship ngay, lợi ích phổ quát); Phase 2 = S0+S1(registry)+S4-degrade (file remote_url chạy, local_file-only degrade trung thực); Phase 3 = S2 khi cần chạy thật app local_file-only. Chủ spec chỉ cần xác nhận có đồng ý cắt Phase hay muốn gộp.

## Non-goals

- Không đổi gate FSM / confirm-loop (032) / permission-gate / `claude-session.ts` strip `DIFY_*`.
- Không tự suy đoán **giá trị nghiệp vụ** của input (vẫn là sample placeholder); mục tiêu là input **hợp lệ về contract** để run chạy được và verdict phản ánh đúng.
