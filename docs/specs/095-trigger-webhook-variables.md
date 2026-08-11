# Spec 095 — Node `trigger-webhook` thiếu `variables`: workflow import xong KHÔNG publish được

**Status**: **S0 xác nhận · S1 + S2 + S5 ĐÃ SHIP (2026-08-12)** · còn S3, S4. Xem §11 (kết quả S0) và
§12 (nhật ký thi công). Phiên bản Dify: **1.15 — user xác nhận 2026-08-12**.
Nguồn: điều tra tách ra từ spec 094 S3 (repro checklist sau import) — S3 rơi vào ca 2 của bảng quyết
định (§3.3 của 094: *"A1 là lỗi thật → huỷ phần note, mở spec sửa cách khai trigger-webhook trong
template"*), nên nó đẻ ra spec này và **không** sinh note nào.

**Kết quả S0 một dòng**: thêm `variables` → mục **"Biến không hợp lệ" biến mất**. A0 còn lại đúng như
dự đoán. Và lộ ra một lớp thứ ba chưa ai biết: **tool node cần xác thực cũng chặn publish** (§11.2).

**Ba mức bằng chứng, đừng trộn** — spec này cố tình đánh dấu từng khẳng định:

- **[ĐO]** — user quan sát trực tiếp trên Dify của họ (có ảnh).
- **[ĐỌC]** — đọc từ `vendor/dify-src` @ `1.13.0-42` (commit `41e2812349`, 2026-02-20) hoặc từ file
  trong repo. Đúng với bản vendor, **chưa chắc đúng với bản user chạy** (§5).
- **[CHƯA]** — chưa ai xác minh. Đây là những thứ S0 phải trả lời.

---

## 1. Triệu chứng

**[ĐO]** Import một workflow có `trigger-webhook` vào Dify Studio, mở workflow lên thì hộp
**"Danh sách kiểm tra(2) — Giải quyết các vấn đề sau trước khi xuất bản"** báo hai mục:

| mục | node | thông báo |
|---|---|---|
| A0 | `A0: Webhook (Chatwork relay)` (`trigger-webhook`) | **Cần có URL Webhook** |
| A1 | `A1: Normalize payload` (`code`) | **Biến không hợp lệ** |

**[ĐO]** Bấm **Cập nhật xuất bản** thì bị **chặn cứng**, toast đỏ:
*"Đảm bảo rằng tất cả các vấn đề đã được giải quyết trước khi xuất bản"*.

**[ĐO]** Tái hiện được bằng **control**: import lại đúng file mà run `1786089321835` đã đẩy lên Dify
(`apps/builder/.runs/1786089321835/import-deploy.yml`) → ra **đúng hai mục đó**. Tức không phải hỏng
riêng một bản fix nào.

**Hệ quả**: mọi build `trigger-webhook` do Builder sinh ra đều **không publish được** nếu người dùng
không sửa tay. Đây là lớp lỗi "silent import success" mà `SKILL.md §4.2` đã đặt tên — import xanh, 4
linter xanh, chết ở editor.

**Lịch sử**: đây chính là thứ đã gây 5 vòng request-changes trong ~2 giờ ở run nguồn của spec 094, và
kết thúc **không có kết luận** — vì cả người lẫn máy đều đi tìm lỗi trong YAML thay vì trong khoảng
trống giữa YAML và editor.

## 2. Chẩn đoán — hai mục, hai nguyên nhân KHÁC NHAU

Điểm quan trọng nhất của spec này: A0 và A1 **không cùng gốc**. Gộp chúng lại là cách spec 094 §3.3
suýt viết ra một note sai.

### 2.1 A0 "Cần có URL Webhook" — KHÔNG phải lỗi của ta, và tự khỏi

**[ĐỌC]** `trigger-webhook/default.ts:29-34` chặn khi `webhook_url` rỗng:

```ts
checkValid(payload, t) {
  if (!payload.webhook_url || payload.webhook_url.trim() === '')
    return { isValid: false, errorMessage: t('nodes.triggerWebhook.validation.webhookUrlRequired') }
```

**[ĐỌC]** Nhưng `panel.tsx:64-71` **tự sinh URL ngay khi panel node mở ra** — không có nút nào phải tìm:

```ts
// Ensure we only attempt to generate URL once for a newly created node without url
useEffect(() => {
  if (!readOnly && !inputs.webhook_url && !hasRequestedUrlRef.current) {
    hasRequestedUrlRef.current = true
    void generateWebhookUrl()
  }
}, [readOnly, inputs.webhook_url, generateWebhookUrl])
```

**[ĐỌC]** `use-config.ts:210-226` — `generateWebhookUrl` gọi `fetchWebhookUrl({ appId, nodeId })` rồi
ghi `webhook_url` + `webhook_debug_url` vào node. Giá trị này gắn với **(app, node) của đúng instance
đó**; backend entity ghi rõ `webhook_id … Set when webhook trigger is created` với chú thích *"not from
client data"*.

⇒ **A0 đỏ sau import là trạng thái bình thường**, và hết chỉ bằng một cú click vào node A0.
⇒ DSL **không được** mang sẵn `webhook_url` (§7).

**Đính chính một hiểu sai đã lưu hành trong repo**: `report.ts:79` và `:98` đang dạy user *"turn the
trigger ON in Dify Studio → Quick Settings"*. **[ĐO]** Panel Quick Settings hiện *"Chưa thêm trình kích
hoạt — (Có thể đã tồn tại trong bản nháp, **có hiệu lực sau khi xuất bản**)"*, tức mục trigger chỉ xuất
hiện **sau khi publish**. Grep toàn repo (`docs/`, `.claude/`, `apps/builder/server`): **0 dòng** nào
nói điều đó. Note hiện tại chỉ user đi bấm một cái toggle chưa tồn tại — đúng cái đã xảy ra.

### 2.2 A1 "Biến không hợp lệ" — LỖI THẬT trong YAML ta sinh ra

**[ĐỌC]** Chuỗi đầy đủ, đã truy hết, không còn mắt xích suy đoán:

1. `use-checklist.ts:179-191` — với mỗi biến node dùng, tìm trong `availableVars`:
   ```ts
   const usedNode = availableVars.find(v => v.nodeId === variable?.[0])
   if (usedNode) {
     const usedVar = usedNode.vars.find(v => v.variable === variable?.[1])
     if (!usedVar) errorMessage = t('errorMsg.invalidVariable')   // = "Biến không hợp lệ"
   } else { errorMessage = t('errorMsg.invalidVariable') }
   ```
2. `availableVars` ← `toNodeOutputVars` (`variable/utils.ts:790`) → `formatItem` (`:328`);
3. `formatItem`, `variable/utils.ts:382-386` — nhánh của node webhook:
   ```ts
   case BlockEnum.TriggerWebhook: {
     const { variables = [] } = data as WebhookTriggerNodeType
     res.vars = variables.map(...)
   ```

Nó **chỉ đọc `data.variables`**, **không đọc `body`**. YAML của ta không có `variables` ⇒ node A0 phơi
ra **0 biến** ⇒ mọi `value_selector: [<A0 id>, room_id|message_id|file_ids]` của A1 đều trỏ vào biến
không tồn tại ⇒ *"Biến không hợp lệ"*.

**[ĐỌC]** Đã loại trừ đường thoát: `trigger-webhook/use-config.ts` có **0 `useEffect`** — không có
migration lúc load. `variables` chỉ được ghi bởi `syncVariablesInDraft`, mà hàm này chỉ chạy từ handler
khi người dùng **sửa tay** body/param/header trong panel (`handleParamsChange`, `handleBodyChange`, …).

⇒ Đây cũng là lý do lỗi tồn tại lâu mà không ai thấy: **người dựng bằng tay trên UI luôn đi qua panel**
nên `variables` được sinh ra; **file import thì không bao giờ**.

⇒ A1 **sẽ không hết** dù có tạo URL hay publish. Không được viết bất kỳ note "bình thường thôi" nào cho
mục này.

## 3. Gốc rễ — vì sao mọi cửa của repo đều lọt

**[ĐỌC]** Schema mà toàn bộ toolchain tin dùng, `schemas/dify-dsl-0.6.0.json` →
`$defs.NodeData_WebhookData`, có đúng các property:

```
body, content_type, default_value, desc, error_strategy, headers, method,
params, response_body, retry_config, status_code, timeout, title, version, webhook_id
```

**Không có `variables`. Không có `webhook_url`. Không có `async_mode`.**

Vì schema đó **sinh từ pydantic của backend** (`api/core/workflow/nodes/trigger_webhook/entities.py`),
mà ba field kia là **state của editor (frontend)** — backend không mô hình hoá chúng. Hệ quả dây chuyền:

| cửa | vì sao lọt |
|---|---|
| `lint_node_bodies.py` | validate node body **đúng bằng def đó** → mù theo thiết kế, không phải do bug |
| `validate_workflow.py` / `lint_refs.py` / `lint_plugin_hashes.py` | đều hình dạng backend |
| Dify import | không đặt `additionalProperties: false` → nhận file thiếu field, trả về "thành công" |
| chỉ editor bắt được | nhưng lúc đó file đã nằm trên Dify của user rồi |

**Đây là một LỚP lỗi, không phải một field.** Và nó lật ngược một luật đang có trong `SKILL.md`:
*"for anything trigger-shaped, the generated schema wins"* — với lớp editor-only state thì generated
schema **không thể** thắng, vì nó không biết field đó tồn tại.

## 4. Phạm vi đo được

**[ĐỌC]** Quét toàn repo (`templates/patterns/`, `templates/library/`, `projects/*/*/workflows/`,
`corpus/`): **11 node trigger, trong đó 6 node `trigger-webhook` — TẤT CẢ đều thiếu `variables`**:

| file | vai trò |
|---|---|
| `templates/patterns/webhook-per-row-notify.yml` | **pattern curated** — nguồn mọi build sau |
| `projects/_drafts/build_requirement_news_automation/workflows/main.yml` | build của user (run nguồn 094) |
| `projects/_drafts/app2_build_requirement_news/workflows/main.yml` | build của user (APP 2) |
| `projects/_drafts/ng_quy_tr_nh_2/workflows/main.yml` | build cũ |
| `projects/_drafts/ng_quy_tr_nh_3/workflows/main.yml` | build cũ |
| `projects/_drafts/ng_quy_tr_nh_4/workflows/main.yml` | build cũ |

Pattern curated mang đúng lỗ hổng, và spec 071 mô tả nó là *"field-proven — trigger-webhook, 4 linters
clean, Dify accepted the DSL"*. Cả ba vế đều đúng **và đều không phát hiện được lỗi này** — "Dify
accepted the DSL" đúng nghĩa đen (import nhận), nhưng không đồng nghĩa publish được. Câu provenance đó
phải sửa (S1).

**`trigger-schedule` KHÔNG dính** — đã kiểm, không phải suy đoán:
**[ĐỌC]** `trigger-schedule/default.ts` không có `variables` trong `defaultValue`; `variable/utils.ts`
**không có** `case BlockEnum.TriggerSchedule`; `checkValid` chỉ đòi `mode` + định dạng time/timezone —
những thứ YAML ta đã khai đủ. Đừng mở rộng spec sang nó.

## 5. CHƯA xác minh — S0 phải trả lời trước

1. **[CHƯA] Lệch phiên bản — rủi ro lớn nhất của spec này.** `vendor/dify-src` là **1.13.0-42**
   (commit `41e2812349`, 2026-02-20). Dấu vết duy nhất về bản user chạy là ghi chép campaign
   **tháng 7**: `docs/prompts/runs/2026-07-20-R3-G03-1784547574709.md:35` và
   `2026-07-22-R7-SUMMARY.md:42` đều nói *"Dify 1.15"*. Tức bản vendor **cũ hơn** bản user chạy, và
   con số 1.15 đó đã **3 tuần tuổi** — phiên bản hiện tại chưa ai đo. Toàn bộ §2/§3 đọc từ 1.13.
   ⇒ S0 phải ghi lại **số phiên bản thật** đang chạy (Studio → Cài đặt/About, hoặc `GET /console/api/version`)
   trước mọi kết luận khác.
2. **[CHƯA]** Thêm `variables` theo shape §6 có thật sự làm mục A1 biến mất không.
3. **[CHƯA]** Một workflow **export ra từ Dify** (sau khi cấu hình xong trên UI) có mang `variables`
   không, và mang chính xác shape gì. Đây mới là nguồn chuẩn nhất — nếu lấy được thì nó **thắng** mọi
   suy luận từ mã nguồn ở §6.
4. **[CHƯA]** `async_mode` có bắt buộc không. Frontend type khai `async_mode: boolean` (không optional)
   nhưng backend có default; chưa biết thiếu nó có hậu quả gì.

## 6. Shape đề xuất (nếu S0 xác nhận)

**[ĐỌC]** Chép **nguyên văn** từ `use-config.ts:143-155` (`syncVariablesInDraft`) — đây là hình dạng
chính Dify tự sinh khi người dùng khai một body param trên UI:

```ts
const newVar: Variable = {
  value_type: inputVarType,   // = type của param ('string', 'array[string]', 'file', …)
  label: sourceType,          // 'body' | 'param' | 'header'  ← KHÔNG phải tên người đọc
  variable: sanitizedName,    // = tên param (header thì '-' → '_')
  value_selector: [],
  required: item.required,
}
```

Cộng biến dựng sẵn từ `createWebhookRawVariable()`:
`{ variable: '_webhook_raw', label: 'raw', value_type: 'object', value_selector: [], required: true }`.

Áp cho node A0 của run nguồn thì ra:

```yaml
variables:
  - {variable: _webhook_raw, label: raw,  value_type: object, value_selector: [], required: true}
  - {variable: room_id,      label: body, value_type: string, value_selector: [], required: true}
  - {variable: message_id,   label: body, value_type: string, value_selector: [], required: true}
  - {variable: file_ids,     label: body, value_type: string, value_selector: [], required: true}
```

**Hai cái bẫy trong shape này**, ghi lại vì đã suýt sai:

- `label` là **nhãn NGUỒN**, không phải tên hiển thị. Code lọc trên nó (`v.label === 'body'` khi đổi
  content-type, `v.label !== sourceType` khi sync). Đặt `label` = tên biến sẽ làm logic dọn dẹp của
  Dify hỏng âm thầm.
- `sanitizedName`: với `header` thì `-` bị đổi thành `_`. Với `body`/`param` giữ nguyên. Và có guard
  `hasReservedConflict` — một param tên `_webhook_raw` bị từ chối.

## 7. Slices

### S0 — XÁC NHẬN trên Dify thật (CHẶN mọi slice khác)

**Bước 0 của S0: ghi lại số phiên bản Dify thật đang chạy** (§5.1) — mọi kết luận dưới đây chỉ có giá
trị kèm con số đó.

File thử đã tạo sẵn: `~/Desktop/dify-repro-094/2-thu-nghiem-them-variables.yml` — bản sao file của run
nguồn, chỉ thêm `variables` theo §6 (+ `async_mode: true`). Import nó và ghi lại:

| quan sát | kết luận | đi tiếp |
|---|---|---|
| checklist chỉ còn **A0**, và click vào node A0 thì A0 cũng hết | chẩn đoán đúng | chạy S1→S4 |
| vẫn **2 mục** | shape sai, hoặc 1.15 khác 1.13 | dừng, lấy **export từ Dify** (§5.3) làm chuẩn, viết lại §6 |
| hết **cả 2** ngay | tốt hơn dự đoán | vẫn chạy S1→S4, bỏ phần note A0 của S2 |

Dán ảnh + kết luận vào chính spec này trước khi code.

### S1 — sửa pattern curated (S)

- `templates/patterns/webhook-per-row-notify.yml`: thêm `variables` cho node `trigger-webhook`.
- Sửa câu provenance ở đầu file: *"field-proven … Dify accepted the DSL"* → nói rõ **import nhận ≠
  publish được**, và pattern này từng thiếu `variables` từ ngày đầu.
- **Không** sửa 5 file trong `projects/_drafts/` như một phần của spec (§8) — nhưng kèm một script
  vá một lần để user tự chữa build đang có.

### S2 — dạy chỗ SINH ra YAML (S)

`implement.md` (+ `references/` nếu đúng nhà): khi sinh node `trigger-webhook`, **bắt buộc** kèm
`variables` khớp 1-1 với `body`/`params`/`headers`, kèm một câu giải thích ngắn *vì sao* (biến đầu ra
của node đọc từ `variables`, không đọc `body`) — luật không có lý do là luật bị bỏ.

Nếu S0 ra ca 1, thêm một câu cho note A0 ở `report.ts`: mở node webhook một lần là URL tự sinh. Đồng
thời **sửa `TRIGGER_ENTRY_NOTE` / `TRIGGER_ENABLE_NOTE`** theo §2.1 (mục trigger ở Quick Settings chỉ
hiện sau khi publish) + entry `NOTE_JA` tương ứng.

### S3 — cửa chặn offline: overlay "editor-only state" (M)

Không thể nhét luật này vào schema sinh tự động (`schemas/gen_schema.py` regenerate hàng tuần sẽ xoá),
và cũng không nên nhét allowlist tay vào `lint_node_bodies.py` — chính docstring của nó tuyên bố *"zero
hand-synced allowlists"* (D4). Nên:

- một file overlay **nhỏ, viết tay, có dấu vết nguồn**: mỗi luật kèm comment trỏ đúng
  `web/app/.../<file>:<dòng>` đã chứng minh nó, để lần regenerate/nâng cấp Dify sau còn kiểm lại được;
- hôm nay overlay có **đúng một luật**: `trigger-webhook` phải có `variables`, và tập tên trong
  `variables` phải phủ hết `body` + `params` + `headers`;
- chạy như một pass thứ hai của `lint_node_bodies.py` (hoặc một linter riêng — chốt khi code), và
  **phải đỏ khi revert**: lấy chính `webhook-per-row-notify.yml` bản chưa sửa làm fixture.

### S4 — probe: còn field editor-only nào khác bị bỏ sót? (S, chỉ báo cáo)

Lỗi này là một **lớp**, không phải một field. Đối chiếu `defaultValue` + `checkValid` của các node type
ta hay sinh (`code`, `llm`, `if-else`, `iteration`, `tool`, `http-request`, `template-transform`,
`document-extractor`, `answer`, `end`) với `$defs.NodeData_*` tương ứng, liệt kê mọi field **có ở
frontend mà không có ở schema**. Chỉ **báo cáo** — mỗi field tìm được là ứng viên spec riêng, không sửa
bừa trong spec này. Đây có khả năng là slice giá trị nhất, vì nó biến một sự cố thành một tấm lưới.

## 8. Non-goals

- **Không** ghi `webhook_url` (hay `webhook_debug_url`) vào DSL. Nó gắn với (app, node) của một
  instance cụ thể và do backend cấp — §2.1. Ghi vào file là bịa một giá trị của máy khác.
- **Không** sửa 5 file dưới `projects/_drafts/` như một deliverable: `.gitignore:62` ignore trọn gói,
  chúng là bản dùng-rồi-bỏ. Cách đúng là **build lại** sau khi S1/S2 xong; script vá chỉ để user chữa
  gấp build đang dùng.
- **Không** đụng `trigger-schedule` — đã đo là không dính (§4).
- **Không** sửa tay `schemas/*.json`: nó là output sinh tự động, sửa tay sẽ bị regenerate xoá.
- **Không** viết bất kỳ câu "cảnh báo này là bình thường" nào cho mục **A1** — nó là lỗi thật. (Với
  **A0** thì được, sau khi S0 xác nhận.)
- **Không** kết luận gì thêm từ `vendor/dify-src` mà không ghi rõ đó là bản 1.13 (§5.1).

## 9. Open questions

1. S3: overlay là pass thứ hai của `lint_node_bodies.py` hay một linter thứ 5 đứng riêng? Nghiêng về
   pass thứ hai (ít bề mặt hơn), nhưng phải giữ được tuyên bố "zero hand-synced allowlists" của nó —
   có thể bằng cách để overlay là **file dữ liệu riêng**, code thì vẫn generic.
2. Có nên nâng `vendor/dify-src` lên đúng bản user chạy (1.15) trước khi làm S4 không? S4 mà đối chiếu
   trên 1.13 thì kết quả có thể lệch. Nghiêng về **có**, và làm trước S4.
3. `templates/library/` và `corpus/` hiện không có file trigger-webhook nào — nhưng nếu `/scout` mang
   về một file mới thì overlay S3 có tự bắt được không, hay còn cửa nào chưa nối?

## 10. Bảng nhà tri thức (cho `/spec-close` sau này)

| Mảnh | Nhà |
|---|---|
| Node `trigger-webhook` phải khai `variables`; shape + hai bẫy `label`/`sanitizedName` | comment tại `templates/patterns/webhook-per-row-notify.yml` + `docs/state/readiness-and-plugins.md` |
| **Lớp** "editor-only state không có trong schema sinh từ backend" + vì sao 4 linter mù | `docs/state/readiness-and-plugins.md` (mục schema) + `AGENTS.md §9` |
| A0 "Cần có URL Webhook" tự hết khi mở panel node; DSL không mang `webhook_url` | `docs/state/readiness-and-plugins.md` |
| Mục trigger ở Quick Settings chỉ hiện **sau khi publish** (đính chính 2 note hiện có) | `docs/state/readiness-and-plugins.md` + wording tại `report.ts` |
| "field-proven" của spec 071 nghĩa là import nhận, KHÔNG phải publish được | `AGENTS.md §9` (bài học) + provenance của chính pattern |
| Kết quả probe S4 (danh sách field editor-only còn thiếu) | `docs/state/readiness-and-plugins.md`; mỗi field → spec riêng |
| **Lớp thứ 6 của preflight: tool node cần xác thực chặn publish** (§11.2) | `docs/state/readiness-and-plugins.md` + `runnability.ts` |
| Repro + ảnh checklist | spec này; sau close tóm vào `docs/prompts/runs/CAMPAIGNS.md` |

## 11. Kết quả S0 — 2026-08-11

**Phiên bản**: **1.15 — user xác nhận 2026-08-12** (§5.1 đóng lại). `vendor/dify-src` vẫn là
1.13.0-42, nên §2/§3 đọc từ 1.13 **đã được thực nghiệm 1.15 xác nhận** ở phần webhook (dưới), nhưng
không tự động đúng cho phần khác — S4 vẫn phải nâng vendor trước (OQ2).

### 11.1 Chẩn đoán §2.2 ĐÚNG — `variables` là fix

Import `2-thu-nghiem-them-variables.yml` (file của run nguồn + `variables` theo §6):

| | trước (control) | sau khi thêm `variables` |
|---|---|---|
| A0 `trigger-webhook` — *Cần có URL Webhook* | có | **vẫn có** (đúng dự đoán §2.1) |
| A1 `code` — *Biến không hợp lệ* | có | **BIẾN MẤT** ✅ |

⇒ Chuỗi `use-checklist → toNodeOutputVars → formatItem → data.variables` (§2.2) được xác nhận **trên
Dify thật**, không chỉ trên mã nguồn 1.13. Shape ở §6 (`label` = nhãn nguồn) là shape Dify chấp nhận.
⇒ **S1 → S4 mở khoá.** Rơi đúng vào ca 1 của bảng S0.

### 11.2 Phát hiện mới, KHÔNG do bản vá gây ra — lớp thứ ba

Checklist sau bản vá là **(3) mục**: A0 + hai mục mới:

| node | thông báo |
|---|---|
| `A9a: Tavily search (30d)` (`tool`) | **Yêu cầu xác thực** |
| `B6a: Tavily search (7d)` (`tool`) | **Yêu cầu xác thực** |

**[ĐỌC]** `errorMsg.authRequired`, phát ra từ `nodes/tool/default.ts:26-30`:

```ts
checkValid(payload, t, moreDataForCheckValid) {
  const { toolInputsSchema, toolSettingSchema, language, notAuthed } = moreDataForCheckValid
  if (notAuthed) errorMessages = t(`${i18nPrefix}.authRequired`)
```

`notAuthed` là **trạng thái workspace lúc chạy** (plugin đã cấu hình credential chưa), **không phải
field trong DSL**. Bản vá chỉ chạm node A0 nên không thể gây ra nó. Vì sao hai mục này không có trong
lần import control — **[CHƯA]** biết; giả thuyết khả dĩ nhất là trạng thái auth của plugin nạp
**bất đồng bộ**, nên ảnh chụp ngay sau import chưa kịp thấy. Không quan trọng cho kết luận.

**Vì sao đây là phát hiện đáng giá**: nó cũng **chặn publish**, và preflight của ta **không hề biết**.
`runnability.ts` hiện có đúng **5 lớp** blocker — `model_empty`, `sandbox_trap`, `plugin_todo`,
`dataset_empty`, `env_secret_empty` — **không lớp nào** là "tool node cần xác thực". `plugin_todo` nói
về hash TODO chưa resolve, chuyện khác hẳn. Nên user nhận một build "4 linter xanh, preflight bảo chỉ
cần dán mấy env var", rồi vẫn không publish được.

⇒ **S5** (mới): thêm lớp thứ 6 vào `runnability.ts` — mọi node `type: tool` có `provider_type: builtin`
đều cần credential trong Dify trước khi publish; nêu **tên tool người dùng nhìn thấy** (`tool_label`,
ví dụ "Tavily Search"), không nêu `provider_id`. Kèm `NOTE_JA`. Giữ trong 095 vì cùng triệu chứng
(*import xong không publish được*) và cùng một lần đo; nếu phình ra thì tách spec riêng.

**[CHƯA]** Sau khi xác thực Tavily xong, checklist có sạch hẳn không — hay lộ tiếp lỗi khác trên chính
hai node đó. Lưu ý cơ chế: `checkValid` trả **một** thông báo mỗi node (điều kiện đầu tiên sai thắng),
nên sửa xong một lỗi có thể lộ ra lỗi kế trên cùng node. Đó là việc của S5 khi chạy.

## 12. Nhật ký thi công S1 + S2 + S5 — 2026-08-12

### S1 — pattern curated

`templates/patterns/webhook-per-row-notify.yml`: thêm `variables` (4 entry: `_webhook_raw` + 3 body
param) kèm comment giải thích *vì sao* ngay tại node; thêm GOTCHA #6 (`variables` bắt buộc) và #7
(A0 đỏ là expected, tự hết khi mở panel); mở rộng GOTCHA #3 (mục trigger ở Quick Settings chỉ hiện
sau khi publish). **Sửa provenance**: khối "PROVENANCE CORRECTION" nói thẳng *"field-proven" nghĩa là
import và chạy được, KHÔNG phải publish được* — kèm giá phải trả (5 vòng, ~2 giờ).

Cả 4 linter vẫn exit 0 sau khi sửa — **đó chính là bằng chứng cho §3**: `lint_node_bodies.py` xanh cả
trước lẫn sau, nên nó không thể là cửa chặn cho lớp lỗi này (đó là việc của S3).

### S2 — chỗ sinh YAML

`implement.md`, bullet mới ngay trước "Code nodes", có: luật, lý do (editor đọc `variables` chứ không
đọc `body`), hậu quả (Dify **từ chối publish**), cảnh báo *"không cửa nào phía sau bắt được"*, block
YAML mẫu, hai bẫy (`label` = nhãn nguồn; header `-`→`_`), và một câu chặn lan: `trigger-schedule`
KHÔNG có field này, đừng thêm.

### S5 — lớp blocker thứ 6 `tool_auth`

- `RUNNABILITY_PROBE` thu thêm `tool_nodes` — chỉ node `type: tool` có `provider_id` **chứa dấu `/`**
  (= plugin marketplace phải kết nối). Tool native của Dify (`time`, …) không có `/` ⇒ không bắt.
  Nếu bỏ điều kiện này, lớp mới thoái hoá thành "mọi tool node đều là blocker" — một cảnh báo giả trên
  mọi build dùng tool native, và đó là cách một note bị người dùng bỏ qua vĩnh viễn.
- `classifyRunnability` phát **một dòng mỗi PROVIDER**, không phải mỗi node (2 node Tavily = 1 việc
  phải làm), nêu `tool_label` người dùng nhìn thấy trên canvas, giấu `provider_id`.
- **Câu chữ cố ý có điều kiện**: `notAuthed` là trạng thái workspace, không phải field DSL, nên YAML
  chỉ biết *tool nào cần kết nối*, không biết workspace đã kết nối chưa. Note mô tả *việc phải làm và
  điều Dify sẽ nói*, không khẳng định "cái này đang thiếu" — khẳng định sai trên workspace đã kết nối
  chính là kiểu hứa hão mà spec 066 đã phải đi sửa.
- **Mirror sang `report_structure.py`**: bắt buộc, vì test parity AC-2 so `runnable_blocker_classes`
  giữa hai bản cài đặt và **hard-fail** khi lệch. Sửa một phía là suite đỏ ngay.
- i18n: entry `NOTE_JA` mới (giữ nguyên `tool_label` không dịch — nó là chuỗi user phải tìm trên màn
  hình của họ, dịch đi là trỏ vào thứ không tồn tại) + một dòng trong bảng `ADDED` của
  `notes-i18n.test.ts`.

**Test**: fixture parity mới `tool_auth.yml` (2 node Tavily cùng provider + 1 tool native để ghim đúng
điều kiện `/`), một assert trong test "fixture coverage", và một test riêng cho dedup-theo-provider +
"human text không được chứa machine identifier". Fixture tự động vào vòng lặp parity (test đọc cả thư
mục), nên TS↔Python được so trên chính lớp mới — không phải xanh giả.

**Kiểm trên build thật** (`projects/_drafts/build_requirement_news_automation/workflows/main.yml`):

```
classes: env_secret_empty, model_empty, tool_auth
NOTE: … ; a connection for Tavily Search — open that step in Dify and connect it
      (most tools need an API key or a sign-in). Dify will not let you publish while
      it says authorization is required. (The build itself is finished — …)
```

Đúng bước đang âm thầm chặn publish, và gộp 1 dòng cho 2 node Tavily.

**Suite**: server **937/937**, web **301/301**, typecheck cả hai nửa sạch, `web/dist` đã rebuild.

### Chưa làm — và vì sao

- **S3 (cửa chặn offline)**: chưa. Đây là slice giữ cho lỗi không quay lại; S1/S2 chỉ sửa hiện tại và
  dạy tương lai, không có gì **chặn** một file thiếu `variables` lọt qua lần nữa.
- **S4 (probe lớp editor-only)**: chưa, và **không nên làm trước khi nâng `vendor/dify-src` lên 1.15**
  (OQ2) — đối chiếu trên 1.13 sẽ cho danh sách lệch.
- **5 build đang hỏng trong `projects/_drafts/`**: giữ nguyên Non-goal §8 — không sửa như một
  deliverable. Có script vá một lần (`--check` / `--write`, idempotent, đã dry-run đúng trên cả 5
  file); quyết định là của user. Lưu ý script ghi qua PyYAML nên **mất comment** — chỉ dùng cho
  `projects/*/workflows/main.yml` sinh tự động, tuyệt đối không trỏ vào template curated.
