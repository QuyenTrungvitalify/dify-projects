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
