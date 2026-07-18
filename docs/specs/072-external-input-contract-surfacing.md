# Spec 072 — Nêu rõ HỢP ĐỒNG dữ liệu vào từ nguồn ngoài Dify (external-input contract)

**Status**: Draft (2026-07-18 — từ đánh giá build manual `google_slack` run 1784367964063)
**Effort**: S1 = S · S2 = S · S3 = S–M (fuzzier) — tổng ≈ S–M
**Depends on**: `runnability.ts`/`report.ts` (kênh preflight/notes, đã ship) · spec 064/066 (plain-language
notes) · spec 057 (`TRIGGER_ENABLE_NOTE` — tiền lệ advisory cho một "việc client phải làm")

---

## 1. Vấn đề — lớp "silent success" ở tầng NGUỒN

Build `google_slack` (webhook → phân loại → Slack) đúng hoàn toàn: 4 linter sạch, Dify nhận file,
dùng đúng pattern. Report ④ hướng dẫn **5/6** việc setup rất rõ: thêm model · 3 secret · import DSL ·
cài tool Slack · **bật trigger**. Nhưng thiếu **mắt xích thứ 6**: workflow khởi động bằng webhook, mà
**Google Form không tự gọi webhook** — client phải tự nối nguồn. Report **0 lần** nhắc điều đó
(`grep form|apps script|webhook url|payload` = 0).

Hậu quả với client không rành: làm hết 5 bước, bật trigger ON → **workflow không bao giờ chạy**, và
không có gì chỉ ra vì sao. Đây là **"silent import success + runtime failure"** (AGENTS.md §4.2) leo
lên một tầng: không phải node body sai, mà là **hợp đồng với nguồn ngoài bị bỏ trống trong lời hướng dẫn**.

Cùng lúc, ① Analyze **tự chọn** shape của hợp đồng (webhook body = `inquiry_body`/`company_name`/
`contact_name`) mà **không nêu thành câu hỏi mở** (`analyze.open_questions = none`) — client không có
cơ hội xác nhận "Form của tôi gửi field khác".

## 2. Nguyên tắc — TỔNG QUÁT, không cố định "Google Form → webhook"

Đây KHÔNG phải fix riêng cho webhook/Form. Nó là lớp **"external-input contract"**: mọi điểm mà
workflow **nhận dữ liệu/năng lực từ thế giới ngoài Dify**, và client phải cấu hình nguồn để thỏa hợp
đồng đó. Các điểm này **khai báo tường minh trong YAML** (đã verify trên build mẫu) — trích được
declaratively, không cần suy diễn code:

| Seam (điểm hợp đồng) | Đọc từ đâu trong YAML | Client phải làm gì |
|---|---|---|
| `trigger-webhook` body | node `body[]` (name/type/required) | nguồn POST tới webhook URL với ĐÚNG các field này |
| `trigger-schedule` | node config | không cần nguồn — nhưng nếu có `http-request` fetch thì URL đó phải sống |
| `start` file/text input | `start.variables[]` (type file/file-list/...) | chuẩn bị đúng loại input |
| `http-request` (fetch nguồn ngoài) | node `url` + code parse giả định shape | endpoint phải trả đúng shape build giả định |
| `tool` node | `provider_name` + config | cài plugin + điền key/config |
| env secret | `environment_variables[]` value rỗng | dán giá trị vào Dify |

**Chìa khóa flexible**: một hàm DUY NHẤT liệt kê các seam từ YAML (bảng trên = data, không phải
if/else rải rác). Mọi bề mặt (① question, ④ advisory) **tiêu thụ cùng danh sách đó**. Thêm loại seam
mới = thêm **một dòng** vào bảng enumerate, không phải sửa 2 code path.

## 3. Slices

### S1 — `externalInputContract(yamlText)` — liệt kê seam declaratively (S)

Một hàm thuần (lối `hasTriggerEntry`/`hasToolNode` trong report.ts — text/parse, không đổi hành vi),
trả về danh sách có cấu trúc:

```
[{ kind: 'webhook_body', fields: [{name, type, required}], entryUrl: '<sau khi enable>' },
 { kind: 'start_input',  variables: [{name, type}] },
 { kind: 'fetch_url',    node: '<title>', url: '<url or TODO>' },
 { kind: 'tool',         provider: 'langgenius/slack/slack', count: 3 },
 { kind: 'env_secret',   names: [...] }]
```

- Chỉ đọc cái KHAI BÁO TƯỜNG MINH (webhook body, start vars, tool provider, env vars, http url) — KHÔNG
  suy diễn giả định bên trong code node (đó là S3, fuzzier). Mỗi seam vắng → không xuất hiện; danh
  sách rỗng → không advisory (build không có nguồn ngoài).
- Pure, degrade an toàn: YAML hỏng → `[]` (report vẫn chạy, đúng lối các predicate hiện có).

AC-S1: unit test — build webhook (3 field) → 1 `webhook_body` seam với đúng field; build schedule →
không có `webhook_body`; build không-nguồn-ngoài → `[]`.

### S2 — ④ Report advisory: "nguồn của bạn phải cung cấp gì" (S)

Với mỗi seam, render một dòng **plain-language** (lối `TRIGGER_ENABLE_NOTE`/spec 064 — không jargon),
chèn vào `report.notes` cạnh advisory bật-trigger:

- webhook_body → *"Workflow này khởi động khi có POST tới webhook URL (hiện ra ở Dify sau khi bật
  trigger). Nguồn của bạn — Google Form + Apps Script, hoặc dịch vụ khác — phải gửi các trường:
  inquiry_body, company_name, contact_name (đều bắt buộc)."* (KHÔNG hardcode "Google Form" — nêu như
  ví dụ, vì nguồn là bất kỳ thứ gì POST được.)
- fetch_url → *"Workflow lấy dữ liệu từ <url>. URL đó phải truy cập được từ máy chủ Dify và trả đúng
  dữ liệu mong đợi."*
- start_input → *"Cần cung cấp: <loại input> khi chạy."*

Chỉ mô tả **hợp đồng** (field gì, dạng gì) — KHÔNG viết Apps Script hộ (ngoài phạm vi Dify builder;
nêu nó là việc client, kèm gợi ý "vd Apps Script onFormSubmit").

AC-S2: build `google_slack` → notes MỚI nêu 3 webhook field + "nguồn phải POST"; `grep webhook|POST|
field` > 0 (hiện tại = 0). Comprehension gate (spec 063) vẫn PASS (không jargon).

### S3 (fuzzier, tách riêng) — ① Analyze nêu open question khi shape là TỰ CHỌN (S–M)

Khi ① tự quyết shape của một seam mà requirement KHÔNG nói rõ (webhook body fields, response shape
giả định), nêu thành open question để client xác nhận: *"Nguồn webhook sẽ gửi những trường nào? Tôi
giả định inquiry_body/company_name/contact_name — đúng không?"*. P04 (form routing) đã tự làm điều
này; run google_slack thì không (`open_questions = none`) — nên đây là hướng dẫn skill, không phải
ràng buộc cơ học. Khó ở chỗ phân biệt "client đã nói rõ" vs "builder tự chọn". Để riêng, làm sau S1/S2.

AC-S3: prompt webhook mơ hồ về payload → ① `open_questions` chứa câu hỏi về shape nguồn.

## 4. Tái hiện

```bash
# repro: một build trigger-webhook bất kỳ (nguồn ngoài) — dùng entry có sẵn
apps/builder/scripts/e2e-run.sh fire --entry webhook-per-row-chatwork
# đọc report.notes: hiện KHÔNG nêu "nguồn phải POST gì"
jq -r '.notes' apps/builder/.runs/<id>/report.json | grep -ciE 'webhook url|POST|フォーム|payload'   # = 0 trước S2
```
Bằng chứng gốc: bundle `google_slack` (run 1784367964063) — notes có 5/6 bước, thiếu mắt xích nguồn.

## 5. Non-goals

- KHÔNG viết Apps Script / mã nguồn ngoài hộ client — chỉ NÊU hợp đồng (builder dựng workflow Dify,
  không dựng tích hợp ngoài).
- KHÔNG suy diễn giả định bên trong code node ở S1/S2 (chỉ seam khai báo tường minh) — để S3+.
- KHÔNG cố định webhook/Form — bảng §2 là điểm mở rộng; webhook chỉ là seam ĐẦU TIÊN có bằng chứng.

## 6. Open questions

- OQ1 — S1 nên là hàm TS (như report.ts predicate) hay probe Python (như runnability)? Đề xuất: TS
  thuần text/parse, cùng lối `hasTriggerEntry` — vì chỉ đọc field khai báo, không cần yaml lib nặng.
- OQ2 — advisory ngôn ngữ theo requirement (JA/VI) hay EN rồi localize sau? Theo tiền lệ 063: EN
  trước, NOTE_JA/VI port sau (cùng nợ localization đã biết).
- OQ3 — có nên gate bằng e2e predicate (`notes_include` cho webhook entry) để chống hồi quy S2? Đề
  xuất: có, thêm `report.notes_include: ["POST"]` vào entry webhook sau S2.
