# Spec 087 — Đóng 3 khe hở "Model not exist" (inject bỏ sót node-type, gate 0-model đếm thiếu, advisory nói sai)

**Status**: v6 (2026-08-05) — **SHIP XONG: S1–S4 implemented + VALIDATED LIVE (§6.1 A/B trên Dify
thật: inject→succeeded vs model-rỗng→failed). Server đã rebuild dist + restart. Sẵn sàng
`/spec-close 087` sau khi commit.** v5 = Open Q2 verified (đường import tĩnh là đường MẶC ĐỊNH) +
**S4 ĐÃ LÀM** (inject best-effort trước push; server 782/0). v4 = **S3 ĐÃ LÀM, phạm vi thu hẹp có chủ
đích** (bỏ nhánh deploy-aware — quyết định 066 "không key theo deploy" vẫn đúng; chỉ sửa nhánh
`undefined` thành lời hứa có điều kiện; web 235/0). v3 = **S2 ĐÃ LÀM** (gate tự ăn count mới;
doc-comment + 2 test khóa). v2 = **Open Q1 ĐÃ VERIFY** (shape ModelConfig giống hệt cho cả
3 type — §9) + **S1 ĐÃ LÀM** (pytest 397 pass/2 skip). Tất cả UNCOMMITTED. v1 = audit code
2026-08-05 (luồng model-empty → inject → degrade → advisory, neo file:line ở §4). Validation live
(§6.1-2) chưa chạy — cần Dify selfhost thật.
**Effort**: S1 ≈ S (sync.py + pytest) · S2 ≈ XS (theo sau S1, TS + test) · S3 ≈ S (advisory + i18n
+ test) · S4 ≈ M (ĐIỀU KIỆN — đường import tĩnh).
**Đóng spec**: qua `/spec-close 087`.

---

## 1. Bối cảnh — chẩn đoán lại cho đúng

Triệu chứng quen thuộc: build import sạch, chạy thì Dify trả **"Model not exist"**
([docs/state/dify-io.md:170](../state/dify-io.md), test fixture
[live-test.test.ts:210-216](../../apps/builder/test/live-test.test.ts)).

**Chẩn đoán SAI cần loại ngay**: "patterns có 17 chỗ `provider:''`/`name:''` — điền vào là xong."
Model-rỗng trong `main.yml` là **thiết kế có chủ ý (B5, spec 043 — đã close, tri thức ở
[docs/state/dify-io.md:126-171](../state/dify-io.md))**: workflow phải model-agnostic để share
được giữa các workspace; `implement.md:141-142` dặn để RỖNG, `promote.md:42` bắt buộc **blank
lại** khi promote, và promote-gate coi model rỗng là trạng thái bình thường
([templates-and-promotion.md:232](../state/templates-and-promotion.md)). Cơ chế bù là
**auto-inject lúc live-test** vào bản sao tạm ([sync.py:688-770](../../tools/dify_base/sync.py)
qua [dify-io.ts:835-858](../../apps/builder/server/lib/dify-io.ts) `deployWithModel`).

Lỗi thật là **ba khe hở ở seam**, mỗi cái độc lập tái hiện được:

- **(a) Inject bỏ sót 2 loại node cần model.** `cmd_inject_model` chỉ patch
  `data.type == 'llm'` ([sync.py:719-726](../../tools/dify_base/sync.py)), trong khi chính
  runnability định nghĩa MODEL_TYPES = `llm` + `parameter-extractor` + `question-classifier`
  ([runnability.ts:106](../../apps/builder/server/lib/runnability.ts)). Workflow có
  question-classifier ⇒ live-test import bản đã inject **vẫn còn model rỗng ở node đó** ⇒
  "Model not exist" dù mọi thứ "đã tự động".
- **(b) Gate 0-model đếm thiếu ⇒ degrade thầm.** `llm_count` đếm cùng bộ lọc hẹp đó
  ([sync.py:716](../../tools/dify_base/sync.py)); gate
  [live-test.ts:269-271](../../apps/builder/server/lib/live-test.ts) chỉ chặn khi
  `dep.llmCount > 0 && !pick` ⇒ workflow chỉ-có-PE/QC có `llmCount === 0`, **lọt qua gate**,
  import với model rỗng, không một lời cảnh báo.
- **(c) Advisory nói sai khi KHÔNG BIẾT.** `workspaceModelCount === undefined` (arm models fail —
  spec 067 S6, [dify-io.ts:614-617](../../apps/builder/server/lib/dify-io.ts)) rơi vào nhánh
  "filled in automatically when you test — **nothing to set up**"
  ([runnability.ts:186-188](../../apps/builder/server/lib/runnability.ts)) — đúng vết nói-dối
  cũ mà 066 S3 mới fix một nửa (nửa `=== 0`). Thêm nữa: câu "filled in automatically **when you
  test**" chỉ đúng trên đường live-test; build `deploy=none`/`cloud` (user tự import vào Studio)
  không có bước inject nào — user phải tự chọn model, advisory không nói.

## 2. Review phương án — vì sao chọn hướng này

| Phương án | Phán quyết | Lý do |
|---|---|---|
| **A. Điền model cứng vào patterns/③** | **LOẠI** | Phá B5 (model-agnostic để share); `promote.md` sẽ blank lại; model đúng ở máy này sai ở máy khác — đổi lỗi này lấy lỗi tệ hơn. |
| **B. Linter chặn model rỗng** | **LOẠI** | Model rỗng là design, không phải defect ([linter-candidates.md:35](../linter-candidates.md) từng liệt kê rồi để đó — đúng); linter sẽ fail 12/13 pattern hợp lệ. |
| **C. Chỉ sửa advisory (nói thật hơn)** | Không đủ | (c) cần nó, nhưng (a)(b) là lỗi hành vi thật — advisory trung thực về một cái lỗi vẫn là lỗi. |
| **D. Mở rộng inject + gate cho đủ 3 MODEL_TYPES, advisory nói thật, cùng MỘT nguồn định nghĩa** | **CHỌN** | Sửa đúng seam lệch (inject ≠ runnability về "node nào cần model"); giữ nguyên B5; diện chạm nhỏ, mỗi khe một slice test được độc lập. |

Nguyên lý một câu: **"node nào cần model" phải có MỘT định nghĩa** — hiện `runnability.ts:106`
nói 3 loại còn `sync.py:716,719` nói 1 loại, và mọi triệu chứng đều rơi ra từ khe đó.

## 3. Nguyên tắc (giữ khi implement)

- **Không phá B5**: `main.yml`/patterns giữ model-agnostic; inject chỉ ghi bản sao tạm (2 guard
  `--out` [sync.py:702-705](../../tools/dify_base/sync.py) giữ nguyên).
- **Không biết ≠ không sao**: advisory chỉ được nói "nothing to set up" khi ĐÃ xác nhận có model
  enabled; `undefined` phải nói "chưa kiểm tra được". (Vết 064→066 lặp lại lần nữa thì thành
  pattern lỗi — AGENTS.md §9 material khi close.)
- **Advisory phải deploy-aware**: "tự động khi test" chỉ nói trên đường có live-test.
- **Mọi số đếm/patch đọc từ một danh sách MODEL_TYPES chia sẻ** (mỗi bên một hằng số nhưng test
  đối chiếu — xem S1 test cross-check).

## 4. Cơ chế — neo file:line

- Inject: [sync.py:688-770](../../tools/dify_base/sync.py) (`cmd_inject_model`; điều kiện patch
  :719-726; `llm_count` :716; argparse :893-901); wrapper `deployWithModel`
  [dify-io.ts:835-858](../../apps/builder/server/lib/dify-io.ts).
- Gọi khi nào: CHỈ live-test ([live-test.ts:263](../../apps/builder/server/lib/live-test.ts)
  bước 2, placeholder khi `pick===null`; degrade :265; gate 0-model :269-271). Import tĩnh
  ([import.ts:60-98](../../apps/builder/server/lib/import.ts)) đẩy nguyên trạng
  ([dify-io.ts.md §4](../state/dify-io.md)).
- Chọn model: `cmd_models` [sync.py:621-630](../../tools/dify_base/sync.py) → `parseModels`
  [dify-io.ts:398-424](../../apps/builder/server/lib/dify-io.ts) (lọc inactive/deprecated) →
  `pickLlmModel` :428-445 (default → `*-nano` → `*-mini` → first).
- Advisory: MODEL_TYPES [runnability.ts:106](../../apps/builder/server/lib/runnability.ts);
  blocker `model_empty` :178-191 (câu sai ở :186-188); câu bao :270; count từ
  `enabledModelCount` [dify-io.ts:614-617](../../apps/builder/server/lib/dify-io.ts), gọi từ
  [report.ts:313](../../apps/builder/server/lib/report.ts) + orchestrator :679.
- i18n JA hai biến thể: [i18n.ts:988](../../apps/builder/web/src/lib/i18n.ts) ("nothing to set
  up") và :1037 (0-model); `gateLiveModel` :363/781.
- Lỗi runtime: `parseRunResult` → `'Model not exist'`
  ([dify-live-helpers.test.ts:131-134](../../apps/builder/test/dify-live-helpers.test.ts)).
- Test hiện có: [tests/test_sync.py:187-230](../../tests/test_sync.py) (2 case inject);
  `runnability.test.ts:109-120,179,248-254`; `readiness-checklist.test.ts:101` (assert câu
  "nothing to set up" PHẢI VẮNG trong ngữ cảnh 0-model — S3 đụng, sửa có chủ đích).

## 5. Slices

### S1 — Mở rộng inject + count cho đủ 3 MODEL_TYPES (S, Python — ĐÃ LÀM 2026-08-05)

`cmd_inject_model`: bộ lọc node `{'llm', 'parameter-extractor', 'question-classifier'}` cho CẢ
patch (:719-726) lẫn `llm_count` (:716 — cân nhắc đổi tên field thành `model_node_count`, giữ
alias `llm_count` cho consumer cũ nếu JSON contract đã đóng — kiểm khi implement; **CHỐT khi
implement: GIỮ tên `llm_count`** — `deployWithModel` fallback theo đúng tên field
([dify-io.ts:849](../../apps/builder/server/lib/dify-io.ts)), đổi tên là vỡ wire; ngữ nghĩa mở
rộng ghi ở docstring + comment). Điều kiện
patch giữ nguyên ngữ nghĩa: `name` rỗng HOẶC ngoài `--valid-names`.
**Việc phải verify khi implement (Open Q1)**: shape block `model` của parameter-extractor /
question-classifier trong DSL 0.6.0 — đối chiếu `schemas/dify-dsl-0.6.0.json` + một workflow thật;
nếu shape khác `llm` thì patch theo shape từng loại, KHÔNG đoán.
Test: pytest thêm case PE-only / QC-only / hỗn hợp (đếm đúng, patch đúng node, không đụng node
khác); **cross-check test**: bộ ba type trong sync.py == MODEL_TYPES trong runnability.ts (một
test TS đọc hằng số hai bên hoặc một fixture chung — chống lệch lần nữa).

### S2 — Gate 0-model dùng count mới (XS, TS — ĐÃ LÀM 2026-08-05)

[live-test.ts:269-271](../../apps/builder/server/lib/live-test.ts): điều kiện degrade dùng
count 3-loại từ S1 ⇒ workflow PE/QC-only + workspace 0-model giờ **degrade static có lời giải
thích** thay vì import-với-model-rỗng thầm lặng. Test: case mới trong `live-test.test.ts`
(PE-only + 0 model → degradeStatic; PE-only + có model → inject chạy, placeholder không dùng).
**Ghi chú implement**: gate TS "tự ăn" S1 (count mint ở sync.py, `deployWithModel` chỉ parse) —
code gate KHÔNG đổi; việc làm là cập nhật doc-comment (live-test.ts bước 1/2/3 + `DeployResult.llmCount`
ở dify-io.ts) và **2 test khóa hành vi** trong `live-test.test.ts` (QC-only + 0-model → static-only;
QC-only + có model → inject `qc1`, live test chạy). Suite server 775 pass / 0 fail.

### S3 — Advisory nói thật (S, TS + i18n — ĐÃ LÀM 2026-08-05, PHẠM VI THU HẸP có chủ đích)

**Phần "deploy-aware" của draft v1 bị LOẠI khi implement** — docstring `RunnabilityContext`
([runnability.ts](../../apps/builder/server/lib/runnability.ts)) ghi một quyết định 066 vẫn đúng:
build `deploy: 'none'` **vẫn live-test được từ UI** (live-test.ts không đọc deploy mode), nên key
advisory theo deploy sẽ nói dối theo chiều ngược lại ("none ⇒ không bao giờ auto-fill" là sai);
`runnability.test.ts` còn có assertion pin đúng quyết định đó. Câu "tự động khi test" vì thế đúng
cho MỌI deploy mode — chỉ nhánh `undefined` là có lời hứa sai.

Đã làm — tách 3 nhánh theo `workspaceModelCount` tại `classifyRunnability`:
- `=== 0` → giữ nguyên ("add one in Dify first…").
- `> 0` (đã xác nhận) → giữ nguyên ("filled in automatically when you test — nothing to set up").
- **`undefined`** (arm models fail / không được truyền — 067 S6) → câu mới, lời hứa thành CÓ ĐIỀU
  KIỆN, **giữ nguyên prefix** `the AI model (filled in automatically when you test` để mọi
  consumer prefix-match (`report-plugin-todo.test.ts:166`, `runnability.test.ts:80,97`) không vỡ:
  "…, if your Dify has a model enabled — this could not be checked right now".
Kèm theo: docstring `RunnabilityContext` + comment [report.ts](../../apps/builder/server/lib/report.ts)
(hết "undefined giữ pre-066 wording"); i18n JA mapping mới cạnh cặp cũ
([i18n.ts](../../apps/builder/web/src/lib/i18n.ts)) + hàng mới trong bảng `ADDED` của
`notes-i18n.test.ts` (lệ 066: mọi string thêm phải ship frame dịch); test S3 trong
`runnability.test.ts` sửa CÓ CHỦ ĐÍCH (no-ctx hết "byte-identical pre-066" — giờ assert
"nothing to set up" VẮNG + "could not be checked" CÓ MẶT). `readiness-checklist.test.ts:101`
không cần đổi (case 0-model, không đụng). Suite server 775/0 + web vitest 235/0.

### S4 — Inject trên đường import tĩnh selfhost (M — ĐÃ LÀM 2026-08-05, Open Q2 xác nhận CẦN)

**Open Q2 verified**: đường này user-facing và là đường MẶC ĐỊNH — gate ③ selfhost đặt `continue`
(static) làm action đầu tiên, `test_live` chỉ tùy chọn ([gate.ts:186-190](../../apps/builder/server/lib/gate.ts));
④ static park ở `awaiting_import` với nút 'Import to Dify' → `runImportAndFinish` → `pushApp`
main.yml nguyên trạng. User bấm Import không qua live-test ⇒ app chết "Model not exist".

Đã làm — mirror inject của live-test, best-effort:
- `pushApp` thêm param optional `srcFileRel` → sync.py `--src-file` (plumbing này sync.py **có
  sẵn từ 032**, help text còn lấy ví dụ đúng đường `.runs/<id>/deploy.yml` — chỉ thiếu wiring TS).
- Helper mới `resolveImportSource` ([import.ts](../../apps/builder/server/lib/import.ts), DI-seam
  2 hàm dify-io): pick model → `deployWithModel` ra bản sao tạm **`import-deploy.yml`** (tên
  riêng, không đè `deploy.yml` của live-test) → chỉ dùng bản sao khi ≥1 node được patch; mọi
  nhánh khác (0-model / inject fail / throw / 0-patch) → push nguồn nguyên trạng = hành vi
  pre-087, S3 advisory che. **Không bao giờ chặn import; không đụng main.yml (B5)**.
- Gọi TRƯỚC `writePushIntent` (local-only, side-effect-free) — idempotency/reconcile giữ nguyên
  (nhánh marker-exists không push nên không inject).
- Test: `import-inject.test.ts` mới — 5 case helper (fake deps) + 2 case plumbing `pushApp`
  (python shim ghi argv: có/không `--src-file`). Suite server 782 pass / 0 fail.

## 6. Validation (bắt buộc)

1. **Repro trước-sau cho (a)**: workflow có question-classifier (pattern `rag-qa.yml` hoặc dựng
   tối thiểu), workspace có model → live-test. Trước: node QC model rỗng trong app import, run
   fail "Model not exist". Sau S1: node QC được inject, run qua được bước model.
2. **Repro (b)**: workflow PE-only + workspace 0-model → trước: import thầm; sau S2:
   degradeStatic + note 0-model.
3. **Repro (c)**: giả lập arm models fail (fixture 067 S6) → report notes KHÔNG còn "nothing to
   set up", có câu hướng dẫn chọn model trong Studio.
4. Full suite server + web + pytest xanh.

### 6.1 Kết quả đo — live A/B 2026-08-05 (Dify local 8090, provider OpenAI, default gpt-5.6) ✅

Rebuild dist + restart server (pid mới, dist build sạch) rồi drive bằng CLI, probe QC tối thiểu
4-node lint-clean cả 4 linter (start → question-classifier model-RỖNG → 2 end), artifact tại
`apps/builder/.runs/087-validate/`:

| Bước | Bản INJECT (S1) | Bản ĐỐI CHỨNG (model rỗng, pre-087) |
|---|---|---|
| `inject-model` | `{node_count:1, llm_count:1, patched:['1785900000002']}` — **node QC được patch** (pre-087: 0/[]) | — (push nguyên trạng) |
| push `--src-file` (plumbing S4) | import `completed` | import `completed` (⚠ import KHÔNG chặn model rỗng — đúng chẩn đoán §1) |
| publish + api-key + run (input JA thật) | **`succeeded`**, outputs `result: "greeting or small talk"`, 767 tokens — LLM chạy thật qua QC | **`failed`**, 0 tokens, stream chết ở node QC (bề mặt lỗi: "Workflow stream ended without a terminal event" — cùng lớp chết-lúc-run với "Model not exist" của node llm) |
| cleanup | app deleted | app deleted |

⇒ **Khe hở (a) đóng, xác nhận bằng A/B trên Dify thật**: cùng workflow, khác duy nhất inject.
Repro (b)/(c) đã khóa bằng unit test (S2/S3 — 0-model workspace không giả lập được trên
workspace live có model). Ghi chú thêm: bề mặt lỗi runtime của QC-model-rỗng là stream-chết
chung chung, MỜ HƠN cả "Model not exist" của llm — user tự debug còn khó hơn, càng củng cố
giá trị của inject + advisory.

## 7. Guard / test phải xanh

- pytest `tests/test_sync.py` (case cũ giữ nguyên ngữ nghĩa + case mới PE/QC).
- Suite server: `live-test.test.ts`, `runnability.test.ts`, `preflight-gate.test.ts`,
  `readiness-checklist.test.ts` (sửa có chủ đích, ghi lý do trong commit), `pattern-advisory-delivered.test.ts` không đổi.
- Cross-check MODEL_TYPES hai phía (test mới S1) — guard chống tái lệch.
- KHÔNG đụng: linter set, patterns YAML, promote gate, orchestrator phase-flow.

## 8. Rủi ro đã biết

- **Shape model-block PE/QC khác llm** → patch sai còn tệ hơn không patch. Đối sách: Open Q1 chặn
  đường — verify schema + workflow thật TRƯỚC khi viết patch; pytest fixture lấy từ shape thật.
- **Đổi tên `llm_count`** có thể vỡ consumer JSON (dify-io.ts parse) — nếu contract đã đóng thì
  giữ tên, chỉ đổi ngữ nghĩa + ghi chú docstring (ưu tiên không vỡ wire format).
- **`readiness-checklist.test.ts:101`** đang khóa câu chữ cũ — S3 phải sửa test này có chủ đích,
  không được "sửa cho xanh" mà mất ý nghĩa gốc (câu nói-dối phải vắng ở MỌI nhánh không-xác-nhận).
- **S4 đụng đường import đang chạy tốt** — vì thế mới ĐIỀU KIỆN; không gộp bừa vào cho "trọn bộ".
- Câu advisory mới là user-facing JA/EN — theo quy trình localize hiện có (`localizeNotes`),
  đừng thêm chuỗi ngoài i18n.

## 9. Open questions

1. ~~Shape `model` block của PE/QC~~ — **VERIFIED 2026-08-05, GIỐNG HỆT**: schema 0.6.0 cho cả
   `NodeData_ParameterExtractorNodeData` lẫn `NodeData_QuestionClassifierNodeData` đều `$ref` về
   cùng `$defs/ModelConfig` (`provider`/`name`/`mode` required + `completion_params`) như llm;
   export thật `corpus/awesome-dify-workflow-en/Workflow-Store/Document_chat_template.yml` (node
   question-classifier) xác nhận đúng bộ key. ⇒ S1 dùng chung patch logic, đã implement.
2. ~~Đường import tĩnh selfhost còn user-facing không?~~ — **VERIFIED 2026-08-05: CÓ, và là đường
   mặc định** (gate ③ đưa static `continue` lên đầu; ④ `awaiting_import` có nút Import không cần
   live-test). ⇒ S4 đã làm.
3. `pickLlmModel` ưu tiên `*-nano`/`*-mini` — có nên cho PE/QC dùng cùng pick với llm không, hay
   PE/QC cần model rẻ nhất luôn? Mặc định đề xuất: **cùng một pick** (đơn giản, một nguồn), chỉ
   xét lại nếu có bằng chứng chi phí.

## 10. Non-goals (KHÔNG làm trong spec này)

- **Điền model vào patterns/③/promote** — B5 bất khả xâm phạm (§2 phương án A).
- **Linter chặn model rỗng** (§2 phương án B).
- **Auto-enable model trong workspace user** — trạng thái workspace là của user, Builder không
  đụng credential/provider của họ.
- **Resolve Rate harness** — spec 086 §10 đã hoãn; spec này chỉ dọn dependency cho nó.
- **Đổi thuật toán `pickLlmModel`** — ngoài phạm vi, trừ Open Q3 chốt ngược lại.
