# Campaigns — đối chiếu các đợt test qua từng version

Mỗi lần chạy một **loạt prompt** (`docs/prompts/P*.md`) là một **campaign**, gắn với **một version
Builder**. Bảng dưới để trả lời câu hỏi quan trọng nhất sau vài đợt: *"so với lần trước, cái gì tốt
lên, cái gì tệ đi, và fix nào đã ăn?"*

**Vì sao đối chiếu được**: mỗi run tự đóng dấu `builderVersion` + `gitSha` vào
`.runs/<id>/build-info.json` (và vào dossier khi export). Một báo cáo cũ luôn truy ngược được về đúng
code đã sinh ra nó — xem [`apps/builder/CHANGELOG.md`](../../../apps/builder/CHANGELOG.md).

---

## Bảng đối chiếu

| Campaign | Version | Prompts | Pass (cơ học) | Đạt chất lượng | Không hoàn thành | Findings → Fixes |
|---|---|---|---|---|---|---|
| [2026-07-18](2026-07-18-SUMMARY.md) | **v0.1.0** | 12/12 | — | **11** | 2 (1 propensity ②, 1 đứt mạng) | 5 fix → **v0.2.0** · 5 để ngỏ |
| [2026-07-20](2026-07-20-SUMMARY.md) quiz-gen · **đợt máy-sinh đầu tiên** (/campaign, 3 đề) | **v0.2.0** | 3/3 | 3/3 | 1 PASS · 2 PARTIAL | 0 | 4 finding mới (nặng nhất: **④ giả định 1-file/workflow** — file thứ 2 không lint, notes im lặng) · slug-rác n=3 thêm mẫu VI → đủ fix · advisory webhook mẫu sống 1/≥2 |
| [2026-07-20](2026-07-20-R3-SUMMARY.md) ops-mix (đợt 3, 3 đề) | **v0.2.0** | 3/3 | 3/3 | 1 PASS · 2 PARTIAL | 0 | advisory **2/2 → gate notes_include ĐÃ khoá** · webhook thrash mẫu 2 sạch (denied≈1) · timezone-propensity GIỮ · mới: fail-open duyệt tiền (E) · node-soạn nuốt vi phạm (F) · mục 7 tái lần 3 · slug n=6 · notes-EN n=6 |
| [2026-07-20 R4](2026-07-20-R4-SUMMARY.md) lifecycle (3 đề) | **v0.2.0** | 3/3 | 3/3 | 2 PASS · 1 PARTIAL | 0 | **edit-existing sạch** (7/7 node giữ, base thật); không bịa dataset; vision honesty; finding H/I/J; notes-EN **n=8**, slug **n=8** |
| [2026-07-21 R5](2026-07-21-R5-SUMMARY.md) capabilities (3 đề, trục MỚI) | **v0.2.0** | 3/3 | 3/3 | 2 PASS · 1 PARTIAL | 0 | chatflow đúng-bài (query-rewrite); honesty voice/IVR (example.invalid); **H→propensity, I→không tất định** (n=2 cứu khỏi fix nhầm); **2 bug harness bắt+fix khi chạy thật** (409-abort, record trùng) |
| [2026-07-21 R6](2026-07-21-R6-SUMMARY.md) tiebreak (3 đề) | **v0.2.0** | 3/3 | 3/3 | 2 PASS · 1 PARTIAL | 0 | **chốt I: mất dấu VI 2/4, locus = khâu sinh YAML** (SPEC có dấu, YAML không) → fix guidance · **A không tái hiện → hoãn** · đính chính: **nhiều trigger/1 workflow LÀ hợp lệ** (kiểm nguồn Dify) |
| [2026-07-22 R7](2026-07-22-R7-SUMMARY.md) data-integrity (2 đề) · **lần đầu report 075** | **v0.2.0** | 2/2 | 2/2 | 2 PASS (tĩnh) | 0 | **verify S1+S2 → cả hai LẬT thành propensity, KHÔNG phải bug**: đề nhấn rõ → build append đúng (`A{n+1}`) + lọc dòng-thiếu-ngày tường minh · report mới (criteria_check+journey) chạy thật · nửa runtime plugin còn nợ live |
| [2026-07-22 R8](2026-07-22-R8-SUMMARY.md) corpus-mix (4 đề · **đề tài từ workflow Dify thật**) | **v0.2.0** | 4/4 | 4/4 | 3 PASS · 1 PARTIAL | 0 | 4 trục MỚI đều đạt: render qua tool THẬT md_to_png (không giả ảnh) · đối chiếu 3-ngôn-ngữ không tự-sửa · fetch-URL+chống-đạo-văn honesty · **finding K→n=2** (max_tokens thiếu nhưng hại-thấp khi output ngắn) · report 075 chạy đủ toàn đợt |
| [2026-07-22 R9](2026-07-22-R9-SUMMARY.md) corpus-wide (6 đề, đợt RỘNG nhất) | **v0.2.0** | 5/6 done | 5/6 (G05 build-error) | 2 PASS · 3 PARTIAL · 1 lỗi ② | 1 (G05 ② non-write) | **F1 (mạnh nhất): iteration ≤30 KHÔNG xử lý cho input dài → vỡ ÂM THẦM** (G04, đúng kịch bản user nhấn) · F2 json LLM-first không kiểm fidelity · F3 ② non-write tái hiện v0.2.0 (nudge không triệt) · G01 research honesty PASS · quota chạm build 5 (resume sau reset) · report 075 chạy đủ |
| _(đợt sau)_ | | | | | | |

**Pass (cơ học)** = attempt cuối của mỗi prompt đạt: build `done` + 4 linter sạch + không
accept-override + probe không fail — sinh bằng `campaign.py summary <dir>` (spec 086), thuần đọc
manifest, **tầng CẤU TRÚC**. Nó KHÔNG thay cột "Đạt chất lượng" (chấm nội dung bằng `/report`) —
hai cột đo hai thứ khác nhau, và chênh giữa chúng chính là tín hiệu ("cấu trúc sạch nhưng nội dung
PARTIAL" = việc của guidance, không phải linter). Kèm phân loại fail cơ học: `format` (schema) ·
`graph` (ref/edge) · `semantic` (node body/plugin) · `import` (probe) · `build-error`. Cột của
campaign trước 086 backfill bằng chính `summary` chạy hồi tố; `—` = campaign tay, không có manifest.

## Đợt 2026-07-18 · v0.1.0 — chi tiết

**Phủ**: 12 prompt "user thật" (JA + VI), 12 trục khác nhau — mơ hồ · từ chối trung thực · honesty
phạm vi · schedule 3-bẫy · webhook routing · chatflow RAG · lang-sync VI · vision/ảnh · 2-file đối
chiếu · glossary 2-bước · tool hash · edit-existing.

**Kết quả**: 11 build đạt chất lượng (4 linter sạch, comprehension 0 jargon, digest đúng ngôn ngữ).
Không tìm thấy **lỗi chất lượng** nào — mọi hành vi đúng đắn then chốt đều giữ (không bịa plugin,
không bịa dataset id, không thêm side-effect user chưa xin, giữ ràng buộc "cấm auto-send", "cấm đổi
flow cũ").

### 5 finding → fix trong v0.2.0

| # | Finding | Bằng chứng | Fix |
|---|---|---|---|
| **1** | Webhook build thrash ③ (~500s) vì repo không có pattern `trigger-webhook`; và không có đường được-phép để trích schema một node | P04/P11 (7–17 denied) vs P01/P03/P06/P10 (0–2), cùng model | `webhook-per-row-notify` pattern · `--dump-schema` · feature key · `find.py` diagnostic (spec 071) |
| **2** | ④ không nói client phải **nối nguồn** webhook — build đúng, import sạch, mà không bao giờ chạy | build manual `google_slack`: `grep webhook\|POST` trong notes = **0** | `sourceContractNote` ở ④ + open point ở ① (spec 072) |
| **3** | ② đôi khi **hỏi thay vì viết SPEC.md** ở auto mode (không ai trả lời → build chết) | P05 lần 1 error; **retry pass** → propensity 1/2, không tất định | `spec.md`: auto-confirm guidance đối xứng `analyze.md` |
| **4** | Harness không fire được **edit-existing** → trục này chưa từng test | P12 build mới trong khi digest nói "extend existing" (`task.workflow = null`) | `fire --workflow <slug>` |
| **5** | `--dump-schema` trên type **có thật nhưng schema không có chi tiết** trả lời đúng rồi `exit 2` → model đọc thành "bị từ chối, tìm đường khác" (đúng vòng lặp flag này sinh ra để chấm dứt), đồng thời thổi phồng chính oracle 071 S2 | [P07](2026-07-18-P07-1784388534562.md) `--dump-schema http-request` | type có thật → `exit 0` + stdout; chỉ type **sai chính tả** giữ `exit 2` + danh sách hợp lệ |

### 5 vấn đề CHƯA fix (cố ý — cần quyết phạm vi)

| # | Vấn đề | Vì sao chưa |
|---|---|---|
| **5** | `tool-catalog.json` chỉ có **6 plugin** (có Sheets, thiếu Docs) → ② phải đi đường online rồi bị chặn | Fix đúng là **mở rộng catalog offline**. ~~Cho `marketplace.py` vào allow-set~~ đã **bác bỏ**: nó gọi network, mở kênh exfil qua query param — gate cấm curl/wget chính vì thế. Cần quyết phạm vi catalog. |
| **6** | ① digest ra **tiếng Anh** cho prompt JA (P12 lần không-base) | n=1. Cùng đợt P02 đúng JA; chính P12 khi **có base** cũng đúng JA. Nghi lệch khi thiếu ngữ cảnh — chưa đủ mẫu. |
| **7** | **Không có đường tra-cứu-tri-thức nào cho câu hỏi "có tool làm việc X không"**. Hai mặt cùng gốc: (a) tìm-chữ — `Grep` (tool) lỗi, `grep` (bash) bị gate chặn → "repo có Google Docs không?" phải `Read` cả file mới trả lời được ([P07](2026-07-18-P07-1784388534562.md): 6 lần thử trượt); (b) tra theo **năng lực** — P11 grep 10 lần tìm STT (`whisper\|speech2text\|transcribe`), P01 tìm Sheets/Search: `find.py` chỉ tra *workflow theo feature*, không trả lời câu hỏi plugin/tool | Hướng đã phác: mở rộng `find.py --tool <kw>` (hoặc lệnh capability riêng) đọc `templates/tool-catalog.json` **offline** — KHÔNG mở network, KHÔNG thêm `grep` vào allow-set (quyết định bảo mật, chốt riêng). Đợi quyết phạm vi catalog (finding 5) trước, vì tra trên catalog 6-plugin thì "không có" gần như luôn là câu trả lời. |
| **8** | Slug từ prompt JA ra rác: P07 → **`1_google_1`** ("1 Google 1"). Guard `GENERIC_SLUG` chỉ bắn khi requirement **sạch bóng ASCII**; mảnh lạc 「1万字」「Google」 lọt qua | Cosmetic (YAML vẫn mang tên JA đúng, human sửa được ở gate ②). Sửa `deriveSlugName` đụng đường đặt tên thư mục đang có + `slug.test.ts` → tách quyết định riêng. |
| **9** | Advisory "nguồn phải POST gì" (dòng 14 bảng notes, `sourceContractNote`) chưa có gate hồi quy: entry webhook trong `e2e-suite.yml` chưa `notes_include` câu đó | Việc một dòng — nhưng thêm sau khi advisory chạy qua ≥2 campaign, để khỏi khoá cứng câu chữ còn đang chỉnh. |

### Bài học về BỘ ĐO (quan trọng cho đợt sau)

Xem [METERING-RELIABILITY.md](METERING-RELIABILITY.md). Hai sai lệch đã đo được:

1. **Turn là sai trục** cho thrash: cùng-Haiku, webhook 16 turn vs schedule 22 turn (**ngược**), trong
   khi denied-call 7 vs 2 (đúng). → oracle đúng = **denied-call count**, đã thành predicate
   `denied_calls_max`.
2. **Model không pin**: thrash mạnh → CLI nhảy `opus-4-8[1m]`. Chỉ so **cùng model**.

---

## Cách chạy một campaign mới

> **Đường chính từ spec 073: skill `/campaign`** — plan → gate → run nền → report → recheck, xem
> [CAMPAIGN-GUIDE.md](../CAMPAIGN-GUIDE.md). Khối lệnh dưới là đường TAY (fallback/debug, và là
> tài liệu oracle — `/campaign` cũng đọc đúng các oracle này):

```bash
# 0. ghi version đang test (mỗi run tự đóng dấu, nhưng ghi lại cho báo cáo)
jq -r '.version' apps/builder/package.json

# 1. chạy từng prompt (tuần tự — turn lock nối đuôi; canh quota, mỗi build 2–4 turn thật)
apps/builder/scripts/e2e-run.sh fire "<dán nguyên văn từ docs/prompts/P##-*.md>" --mode auto
apps/builder/scripts/e2e-run.sh wait <taskId>

# 2. đọc oracle (KHÔNG dùng turn làm oracle thrash)
T=apps/builder/.runs/<id>/transcripts/implement.md
sed -n '/^### Tool calls/,/^### Result/p' $T | grep -c '✗'                      # denied/errored calls
apps/builder/scripts/e2e-run.sh comprehension <id>                               # jargon gate
jq -c '.lint' apps/builder/.runs/<id>/report.json                                # 4 linters
jq -r '.cost | to_entries[] | "\(.key): \(.value.model) \(.value.numTurns)t"' apps/builder/.runs/<id>/task.json

# 3. mỗi run một báo cáo: docs/prompts/runs/<ngày>-P##-<taskId>.md
# 4. Pass cơ học cho cột "Pass (cơ học)" — một dòng paste-thẳng (spec 086)
.venv/bin/python apps/builder/scripts/campaign.py summary docs/prompts/gen/<id>
# 5. một SUMMARY cho cả đợt + thêm MỘT DÒNG vào bảng đối chiếu ở trên
```

**Luật giữ cho đối chiếu có nghĩa**: dán prompt **nguyên văn** (dọn prompt = phá test) · ghi **model
từng phase** · chỉ so **cùng model** · finding nào chưa đủ mẫu thì ghi rõ `n=1`, đừng fix vội.

## Bằng chứng đo ngoài-campaign

### 2026-07-26/27 · spec 076 — A/B retrieval của track E (offline, 15 query data-analysis)

Cùng `find.py`, ba arm, đo recall@5: **baseline** (không enrichment, `--name` substring) **2/15** →
**+enrichment** vẫn substring **4/15** → **+BM25 token-ranking 14/15**. Phát hiện then chốt: text
enrichment đã đúng từ arm 2, nhưng substring không tiêu hoá được nó (`data analysis` ≠ tag
`data-analysis`, `chain of thought` ≠ `chain-of-thought`, `repair json` ≠ "Repairs … JSON") — BM25
tokenized đóng đúng gap đó. Đây là lý do BM25 được ưu tiên ngay, trước E3/E4.

A/B end-to-end ngay sau đó lại lộ chuyện khác: **4/4 build thật dùng `--has`, 0 dùng `--name`** — vì
không phase-doc nào nhắc tới cờ đó (bài học đã vào AGENTS §9). Sau khi `analyze.md` dạy lượt intent
(E2b), đo lại **2026-08-05** xác nhận đường đó sống: `--name repair` trả đúng top-1 và build vượt
được ví dụ corpus. Đó cũng là căn cứ giữ E3/E4 ở trạng thái park.

### 2026-08-13/14 · spec 098 — runbook: đo TOKEN THẬT của một lượt (không phải ước lượng)

`task.json.cost.*` chỉ ghi phase; **Ask không có ở đó**. Nguồn duy nhất cho chi phí hỏi-đáp là log
usage của chính CLI:

1. Lấy session id: `task.json` → `sessionIds.askTest` (hoặc `.analyze/.spec/.implement` cho phase).
2. Mở `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl` — mỗi dòng một event; `message.usage` nằm ở
   dòng assistant.
3. Quy đổi **input-equivalent**: `eff = input + cache_creation×1.25 + cache_read×0.10`. Cộng dồn mọi
   `usage` **giữa hai dòng user** ⇒ chi phí của MỘT lượt hỏi (một lượt có nhiều API call vì mỗi
   tool-call là một call, mỗi call đọc lại toàn bộ prefix).
4. Muốn tách "trước/sau" trong cùng một file: nhớ số dòng trước khi chạy, rồi so hai nhóm.

Cạm bẫy đã dính: (a) **session được resume** — một task đã hỏi 46 lượt thì lịch sử cũ vẫn nằm trong
prefix, nên đo "sau khi sửa" trên chính nó sẽ lẫn; muốn sạch thì chọn task có `sessionIds.askTest`
**rỗng**. (b) Đừng dùng cửa sổ wall-clock của phase làm bằng chứng chi phí — xem pitfall 2026-08-04.

Số đã đo được bằng runbook này (spec 098): trước khi sửa **0.66M eff/lượt** trung bình trên 60 lượt
thật; sau khi sửa **147k · 127k · 102k** trên một session sạch (build 87KB) — và quan trọng hơn con số,
đường cong **đi xuống** thay vì phình (trước đó: lượt #1 74.6k → lượt #16 **840k**).

### 2026-07-27 · spec 078 — khảo sát độ sâu "giếng" nguồn ngoài

Bốn repo Dify-workflow khảo trên GitHub: **một** qua cổng license permissive
(`svcvit/Awesome-Dify-Workflow`, MIT, 46 DSL — và đã vendor sẵn từ trước); **hai** no-license (một
trong đó chứa file trùng **nguyên văn** với corpus đang có); **một** rỗng. Cùng đợt, 6 build E2E đạt
trọn tiêu chí với `{{REFERENCES}}` **rỗng 5/6** — Builder không đói example ngoài. Hai số đó là căn
cứ pivot khỏi hunter-bot UI sang self-harvest, và là baseline để so mọi lần `/scout` về sau.

Hunt #1 (2026-07-28, ghi trong `collected.json` mục `hunts`): 2 ứng viên tier-A mới, 2 rejected.
Ghi chú vận hành đắt: `gh search code` trả **rỗng cho mọi query** trong env này, nên mũi săn
code-marker coi như không dùng được — thực tế chỉ còn repo-search + re-check nguồn đã thấy.

### 2026-08-05 · spec 087 — A/B live "Model not exist" (Dify local, provider OpenAI)

Probe QC 4-node lint-clean (start → question-classifier model-RỖNG → 2 end), hai nhánh chỉ khác
bước inject: **bản inject** → run `succeeded` (output đúng class, 767 token); **bản model-rỗng**
→ import vẫn `completed` (import không kiểm model) nhưng run `failed` 0 token, lỗi hiện dạng
stream-đứt chung chung chứ KHÔNG phải "Model not exist" (bề mặt lỗi của QC mờ hơn llm). Trước
087, inject bỏ qua node QC nên nhánh "inject" cũng chết như nhánh đối chứng. Runbook tái hiện:

```bash
set -a && source apps/builder/.env && set +a
.venv/bin/python tools/dify_base/sync.py models   # xác nhận workspace có model enabled
.venv/bin/python tools/dify_base/sync.py inject-model --src <qc.yml> --out <out.yml> \
  --provider "<provider>" --name "<model>"        # kỳ vọng: patched chứa id node QC
.venv/bin/python tools/dify_base/sync.py push --project _drafts --src-file <out.yml> \
  --name probe --yes --json-out                   # rồi publish → api-key → run → delete
```

Để ngỏ (087 Open Q3): PE/QC đang dùng **cùng pick** model với llm — chỉ xét pick riêng (rẻ hơn)
nếu có bằng chứng chi phí từ campaign.

### 2026-08-05/06 · spec 090+091 — build-ma & sandbox-denial (A/B cùng prompt, cùng model haiku)

**090 repro một lệnh** (giờ là smoke trước/sau — sau fix phải 400):
`e2e-run.sh fire "<đề>" --project _drafts --workflow "(unsaved)" --mode auto` — trước fix: chết ②
`artifact missing` + Retry-lặp; 2/2 model (sonnet-5, haiku) cùng chết → tất định theo input.
**091 trước/sau** (bundle `1785928989748` → `1785936519385`): ② 49 call/12✗ → **6 call/0✗** (hết
săn error_strategy); `find.py --name "..."` (E2b) lần đầu ✓; 9/9 ✗ còn lại đều mang dòng `↳ lý do`;
①③ denied/errored phân loại bằng lý do thật thay vì đoán. Con số cũ "≥47% denial do nháy" là CẬN
DƯỚI (68% dòng transcript cũ bị cắt cụt) — từ 0.4.0 đo thẳng bằng phân bố `↳`.

Để ngỏ (085): ngưỡng node-count định tuyến S3 tách-turn (chỉ khi SIZE tái xuất sau 900s);
`{{SCHEMA_REFS}}` backend-inject (mặc định KHÔNG); nguồn gap wall-clock ngoài-turn nếu tái hiện
mà không phải host-sleep → mở điều tra riêng.

Để ngỏ (090): fallback warn của `localEditSeed` giữ nguyên — nâng thành error chỉ khi campaign còn
thấy build ma lọt qua guard cửa; cửa chính danh "sửa file yml đính kèm" (auto-import-base) → spec
riêng nếu share-inbox/campaign cho thấy tần suất đáng.

Để ngỏ (098 — chi phí hỏi đáp): ba mảnh **cố ý chưa làm**, cả ba đều độc lập với phần đã ship và chỉ
đáng mở lại khi số liệu đòi. (a) **Consult** vẫn kê mọi đính kèm kèm lời mời "Read" mỗi lượt — mọi số
đo của 098 đến từ ask của build, nên mở rộng sang consult là việc riêng, sau khi S2 chạy thật một thời
gian. (b) **Reset session Ask theo ngưỡng** + **tách model cho làn chat** (trùng S2b của 082): cả hai
chặn đường cong phình từ hướng khác, nhưng sau 098 đường cong đã đi xuống (147k→127k→102k), nên gate
mở lại = thấy một session Ask thật vượt ~300k eff/lượt. (c) **Bộ quét không parser** còn một lỗ tồn dư
đã ghi tại `workflow-index.ts`: dòng nối của scalar ở cột 0 mà *trông giống khoá* (`Note: x`) vẫn cắt
cụt im lặng — đóng hẳn cần một dependency YAML, chỉ đổi khi thấy ca thật.

Để ngỏ (082 — hai làn + consult): S2b model pin làn chat (`BUILDER_CHAT_MODEL`) chưa làm;
race hiếm ask:answer chunk-đầu-rớt nếu CLI trả lời trước khi EventSource mở (cold-start vài giây
nên chưa quan sát thấy — chỉ xử nếu xuất hiện thật).

Để ngỏ (084 — distill tray): secret-scan nhẹ **trước** auto-finalize chưa làm (câu hỏi "có grep
token/api-key trong B2′ rồi rớt về `review` khi nghi ngờ không" chưa chốt) — đây là mảnh đóng đúng
rủi ro tệ nhất của auto-approve, vì B2′ lint **không** bắt secret-leak. Panel B (overlay gắn build
nguồn) park, chỉ mở lại nếu dùng tray thật vẫn thấy vướng. Chưa có test render nào cho `BgTray` —
`components/**` vốn không có test nào. Và **chưa đo** con số biện minh cho cả spec: số click từ
trigger → lên kệ, kỳ vọng giảm từ ~5 xuống 1–2; cần đếm qua vài lần promote thật.

Để ngỏ (076 — track E): **E3** (mở pool `gapReferences` của ③ sang tầng `library`, emit path theo
source thay vì hardcode `templates/patterns/`, thêm MMR để đa dạng, xét lại `max` reference hiện là
2) và **E4** (`/template-promote` chart_demo/json-repair vào `library/`) đang **park có điều kiện**.
E4 là prerequisite cứng của E3 — library hiện gần như rỗng nên E3 không có vật liệu để bơm. Cân nhắc
**BỎ matplotlib** khỏi E4: E2E cho thấy model cố ý tránh nó vì bẫy sandbox và chọn echarts, promote
nó lên làm "seed sạch" có thể phản tác dụng. Chỉ mở lại khi campaign cho thấy lớp build data-analysis
hụt **có hệ thống** (n≥2) mà nguyên nhân truy về thiếu reference ở ③ — lần đo 2026-08-05 KHÔNG kích
hoạt điều kiện đó. Ba câu còn ngỏ: cơ chế tái sinh enrichment khi corpus đổi; `max` bao nhiêu sau khi
mở pool; corpus thô có được vào pool không.

Để ngỏ (077 — corpus sync): updater tag/SHA-aware **hoãn có chủ ý** — lockfile đã đủ cho
"tái-lập-mà-vẫn-auto-update" vì `ref` ở lại là branch; chỉ làm khi thêm một nguồn phát hành theo tag,
tới lúc đó `update_corpus.sh` còn warn+skip với ref không-phải-branch. Nhánh bash bước pin trong
`setup.sh` **chưa có guard nào** (5 ca spec liệt kê — pin đúng sha, fetch fail → warn+tip, xoá lock →
tip, `--skip-clones` bỏ pin, clone vẫn `--depth=1` — đều chưa test; `test_sources_lock.py` dừng ở
tầng Python). Nghiệm thu cron chưa chạy: gộp vào lượt `workflow_dispatch` của để-ngỏ 079 bên dưới —
lượt đó phải xác nhận thêm PR sinh khi upstream đổi và no-op khi không.

Để ngỏ (080 — shelf dashboard): v1 cố ý dừng ở số tổng — drill-down (click feature/tier → list file)
để v2; đếm conversion nudge→promote cần một event-log promote-khởi-từ-nudge mà **chưa có chỗ ghi**,
nên hiện chỉ nhìn timeline promotes động/đứng; auto-refresh sau promote/corpus-update chưa làm (v1
nút ↻ tay); `tags.top` đã có sẵn trong JSON nhưng UI mới hiện `unique`; `complexity_per_tier` đã tính
mà UI chỉ render tổng, còn `enrichment.per_tier` thì **chưa tính**. Phép quan sát flywheel: mở màn
hình sau ~2 tuần — timeline promotes vẫn đứng ⇒ nudge 078 chưa chuyển hoá (nối để-ngỏ 078).

Để ngỏ (078 — self-harvest & scout): sau ~2 tuần dùng thật, đếm nudge-rate vs accept-rate — rate cao
mà accept ~0 ⇒ guard sai, siết ngưỡng `node_count ≥ 4` và/hoặc luật "near-dup không nudge"; hai open
question (ngưỡng ≥4 node có đủ không, có bật lại nudge cho build seed-edit không) **chỉ** được chỉnh
theo số này chứ không theo cảm giác. `/scout` mới chạy **1/3** hunt-log — cần đủ 3 lần mới có median
ứng-viên-mới để quyết hunter-UI bằng số. `catalog.py doctor` chưa có baseline trên data thật; chạy
lại sau khi clone svcvit-zh để xác nhận file EN-fork bị bắt `dup-of` bằng sha256.

Để ngỏ (075 — nguồn data quick-win): TTL cache cho harvest **hoãn có chủ ý** — harvest-mỗi-Implement
là freshness cố ý (thêm model xong `/reply` ngay thì phải thấy nó), lợi ích chồng lấn với trần
timeout mỗi nhánh, và N giây là đoán mò; chỉ mở lại nếu đo thật thấy vòng `/reply` tốn mạng đáng kể,
khi đó N = 10–15s chứ **không** 120s. `sources_admin.py doctor` chưa vào CI — `.pre-commit-config.yaml`
lẫn `.github/workflows/` đều chưa gọi nó, hiện chỉ là lệnh tay.

Để ngỏ (079 — corpus-update seam): 1 lần `workflow_dispatch` sync-corpus xác nhận 2 khối advisory
render đúng trong body PR + 1 lần `/corpus-update` thật đi qua bước 4–5; khi nguồn `indexed:false`
lật sang true → enrich theo đợt ≤15 file/lần; orphan upstream-xoá → default giữ template + đổi
provenance `source=original`, chỉ retire khi user muốn.

Để ngỏ (081+083 — share pattern): nghiệm thu end-to-end cần Google + máy thứ hai thật (admin
deploy Apps Script theo DEPLOY.md + 2 curl smoke → điền url/secret vào `.dify-share.json` → một
máy user share thật → `/shelf-inbox` vet + land; nhánh git/PR fallback cũng chưa chạy end-to-end).
Secret xoay khi nghi lộ (không đặt lịch); `processed/` Drive để nguyên tới khi thấy số thật;
reminder nhịp tuần cho admin chỉ thêm nếu quên thật 2 tuần liên tiếp.

Để ngỏ (089 — office attachments): e2e §6 của spec chưa chạy (upload docx/xlsx/pptx thật qua UI →
① đọc sidecar; tiện thể xác nhận sidecar vào export-zip); xlsx nhiều sheet → một hay nhiều sidecar
(v1: MỘT — xét lại nếu model lẫn sheet); date-serial → ISO (v1: KHÔNG — bật nếu ① đọc sai ngày).

Để ngỏ (091): ghi lý do ✗ vào `events.jsonl` (máy đọc không qua parse transcript — đụng
`RunEventKind` union + dossier switch, làm khi có nhu cầu thật); nguồn gốc `_ALLOWED_PY` của
classify legacy (đường này teo dần theo hồ sơ cũ — có thể không đáng đầu tư).

Để ngỏ (086, hoãn có chủ ý — mở spec mới khi đủ đau): **Resolve Rate** (chạy workflow thật với
test-case input→expected, tầng trên của Pass cơ học) — cần model-inject ổn (087 đã ship ✓) nhưng
chỉ phủ được ~50% corpus (6/12 prompt P01–P12 tự chứa; nửa còn lại dính Chatwork/WordPress/Slack/
Google; trigger không có API enable) và cần vocabulary assertion mềm chống false-FAIL do
non-determinism. **Multi-turn degradation probe** (đo Pass qua các vòng Ask/Consult — finding
Chat2Workflow: mọi model tệ dần qua vòng refine) — chi phí turn thật cao, chưa chứng minh giá trị.
