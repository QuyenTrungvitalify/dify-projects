# Spec 086 — Pass Rate chuẩn hóa: một con số cơ học per-campaign trong CAMPAIGNS

**Status**: Draft v1 (2026-08-05). Nguồn: đánh giá landscape 2026-08-05 (benchmark Chat2Workflow
arXiv 2604.19667 đo Dify/Coze bằng 2 metric lũy tiến Pass/Resolve; SOTA resolve ~60%) + review nội
bộ: phần **Resolve Rate (live-run) HOÃN có chủ ý** — xem §10.
**Effort**: S1 ≈ XS (1 field additive + producer) · S2 ≈ S (1 subcommand Python thuần đọc manifest)
· S3 ≈ XS (doc + SKILL.md wiring).
**Đóng spec**: qua `/spec-close 086`.

---

## 1. Bối cảnh — cái gì đã có, cái gì thiếu

Mọi nguyên liệu của một "Pass Rate" cơ học **đã tồn tại và đã persist**, nhưng chưa ai gom nó
thành MỘT con số so sánh được giữa các campaign:

- **Per-run**: ④ re-chạy 4 linter (hợp đồng chung [linters.ts:29-34](../../apps/builder/server/lib/linters.ts))
  và ghi **exit code từng linter** vào `report.json.lint`
  ([report.ts:436-441](../../apps/builder/server/lib/report.ts)); verdict `lintClean` có định nghĩa
  duy nhất ([linters.ts:41-42](../../apps/builder/server/lib/linters.ts)).
- **Per-campaign (durable)**: `campaign.py record` đã harvest `report.lint` + `task_status` +
  denied-calls vào manifest `campaign.yml`
  ([campaign.py:299-314](../../apps/builder/scripts/campaign.py)) — nghĩa là số liệu Pass Rate
  **sống sót sau khi `.runs/` bị dọn**, không cần giữ run dir.
- **Cột "Đạt chất lượng"** trong [CAMPAIGNS.md](../prompts/runs/CAMPAIGNS.md) hiện là chấm
  **LLM/tay** (PASS/PARTIAL từ `/report`) — giá trị riêng của nó giữ nguyên, nhưng nó KHÔNG phải
  con số cơ học: hai campaign không so sánh máy-với-máy được, và mọi cải tiến Builder sắp tới
  (076 E3 mở pool reference, siết schema node-body, đổi prompt body) đều ship **không có
  before/after bằng số**.

**Lỗ hổng cụ thể duy nhất về dữ liệu**: verdict **import-probe** chỉ tồn tại dưới dạng **văn xuôi
trong `notes`** (`task.probeNote` push vào noteParts —
[report.ts:353](../../apps/builder/server/lib/report.ts); câu chữ mint ở `probeVerdict`
[report.ts:115-124](../../apps/builder/server/lib/report.ts)). Muốn đếm cơ học phải grep prose —
đúng anti-pattern mà spec 066 S5 đã trả giá (retire `notes_include: "all linters passed"` vì đổi
câu chữ làm mọi run xanh AUTO-FAIL). ⇒ cần S1.

## 2. Chẩn đoán — một nguyên lý

> Con số đo phải là **hàm thuần của dữ liệu có cấu trúc đã persist** — không LLM, không grep
> prose, không phụ thuộc `.runs/` còn sống. Khi đó Pass Rate của campaign 2026-07 và 2026-09
> so sánh được tuyệt đối, và mọi chênh lệch là tín hiệu (hoặc nhiễu mẫu-nhỏ — §8), không phải
> artifact đo.

Đây là phần **Pass Rate** trong cặp metric của Chat2Workflow. Phần **Resolve Rate** (chạy thật
workflow với test case input→expected) **hoãn có chủ ý** — phụ thuộc fix model-inject (spec 087)
và chỉ phủ được ~50% corpus (6/12 prompt P01–P12 tự chứa; 6 dính Chatwork/WordPress/Slack/Google;
trigger không có API enable). Quyết định phạm vi này chốt trong review 2026-08-05, ghi ở §10.

## 3. Nguyên tắc (giữ khi implement)

- **Không grep prose.** Mọi input của aggregator là field có cấu trúc (`lint.*`, `probe`,
  `task_status`). Bài học spec 066 S5.
- **Pass Rate đo TẦNG CẤU TRÚC, không đo chất lượng nội dung.** Workflow import sạch nhưng prompt
  LLM node dở vẫn Pass — cột "Đạt chất lượng" (LLM-graded) tồn tại song song, KHÔNG bị thay thế.
  Dòng CAMPAIGNS phải ghi rõ hai cột là hai thứ khác nhau.
- **Advisory không feed verdict.** `unresolved_plugin_todo`, preflight, pattern-gap là advisory
  (spec 017/037) — không được lẫn vào Pass. Chỉ 4 linter + probe + task_status.
- **Tôn trọng bảng "loại tri thức → nhà"**: con số per-campaign ở CAMPAIGNS.md; định nghĩa verdict
  ở code (docstring aggregator); spec này chết sau khi ship.
- **Denied-calls vẫn là oracle thrash** (bài học METERING-RELIABILITY) — Pass Rate KHÔNG thay nó,
  hai trục đo khác nhau (chất lượng đầu ra vs chi phí quá trình).

## 4. Cơ chế — neo file:line

- 4 linter + `lintClean`: [linters.ts:29-42](../../apps/builder/server/lib/linters.ts) — nguồn
  duy nhất, ③ gate / ④ report / verifyPhase cùng dùng.
- `report.json` shape: [report.ts:434-457](../../apps/builder/server/lib/report.ts) — có
  `lint` (codes), `accepted_lint_failure`, `deploy`; **chưa có** field probe cấu trúc.
- Probe verdict producer: `probeVerdict` [report.ts:115-124](../../apps/builder/server/lib/report.ts);
  caller đặt `task.probeNote` (orchestrator per-build + base-import per-base — chú ý bài học 049/066:
  HAI producer, sửa phải sửa cả hai đầu mint).
- Manifest harvest: [campaign.py:299-314](../../apps/builder/scripts/campaign.py) (`cmd_record` đọc
  `report.json` → `result["lint"]`), idempotent per task_id (:331-339).
- Ba-bucket e2e: [e2e_check.py:31-38](../../apps/builder/scripts/e2e_check.py) — vocabulary
  cố ý tối giản; spec này KHÔNG đụng nó (per-entry predicate ≠ per-campaign aggregate).
- CAMPAIGNS bảng đối chiếu: [CAMPAIGNS.md](../prompts/runs/CAMPAIGNS.md) mục "Bảng đối chiếu".

## 5. Slices

### S1 — Field `probe` cấu trúc trên report.json (XS, additive)

Thêm `probe: 'ok' | 'failed' | 'unknown_version' | 'skipped' | null` vào object report
([report.ts:434](../../apps/builder/server/lib/report.ts)). Nguồn: nơi hiện set `task.probeNote`
lưu thêm **kind** (cùng chỗ mint câu chữ — `probeVerdict` là single-source nên kind lấy tại đó,
match/mint không lệch, đúng thủ pháp `isTimeoutNote` của 085 S4). `null` = build không có probe
(deploy path không chạy). **Additive** — consumer cũ không đổi. `cmd_record` harvest thêm
`result["probe"]` (1 dòng, cạnh `result["lint"]`).
Test: case mới trong suite report (probe ok/failed/absent → field đúng); `cmd_record` test thêm
assert probe vào manifest (tests/test_campaign.py).

### S2 — `campaign.py summary <dir>`: aggregator tất định (S)

Subcommand mới, **thuần đọc `campaign.yml`** (không đọc `.runs/`, không network, không LLM):

- **Per-run verdict** (attempt cuối cùng của mỗi prompt):
  `PASS` ⇔ `task_status == 'done'` AND `lintClean(lint)` AND `accepted_lint_failure != true`
  AND `probe != 'failed'`.
  (`probe` ∈ {ok, skipped, unknown_version, null} không chặn — probe là oracle bổ sung, vắng mặt
  ≠ fail; `unknown_version` là mismatch môi trường, đếm riêng chứ không tính fail của Builder.)
- **Phân loại fail** — map cơ học từ linter key, theo taxonomy Chat2Workflow để đối chiếu được
  với số công bố:
  | Nguồn fail | Category |
  |---|---|
  | `task_status != done` (build chết/timeout) | `build-error` |
  | `validate != 0` (schema envelope) | `format` |
  | `lint_refs != 0` (dangling ref/edge/var) | `graph` |
  | `lint_node_bodies != 0` hoặc `lint_plugin_hashes != 0` | `semantic` |
  | `probe == 'failed'` (Dify từ chối import) | `import` |
  (Một run có thể mang nhiều category — đếm hết, PASS/FAIL vẫn nhị phân. `consistency` của paper
  KHÔNG map được cơ học — nó là việc của `/report`, ghi rõ trong docstring.)
- **Output**: (a) bảng người đọc; (b) **một dòng markdown paste-thẳng vào CAMPAIGNS**, ví dụ:
  `Pass 11/12 · fail: G07(graph) · probe 9 ok/2 skip/1 n-a · accepted-override 0`;
  (c) `--json` cho máy.
- Kế thừa constraint của `record`: **không bao giờ crash trên run thiếu dữ liệu** — thiếu `lint`
  (error run) ⇒ `build-error`, thiếu `probe` (manifest cũ, trước S1) ⇒ bucket `n/a` chứ không đoán.
  ⇒ **chạy được hồi tố trên 9 campaign đã có** trong `docs/prompts/gen/` (validation §6).
Test: `tests/test_campaign.py` thêm case — manifest fixture đủ 4 kiểu (pass sạch / lint fail từng
category / error run / manifest thiếu probe) + golden dòng markdown.

### S3 — Wiring vào /campaign + CAMPAIGNS.md (XS, doc)

- [CAMPAIGN-GUIDE.md](../prompts/CAMPAIGN-GUIDE.md) + `.claude/skills/campaign/SKILL.md`: bước
  report thêm "chạy `campaign.py summary`, paste dòng Pass vào cột mới của bảng đối chiếu".
- [CAMPAIGNS.md](../prompts/runs/CAMPAIGNS.md): thêm cột **Pass (cơ học)** vào bảng đối chiếu,
  một câu định nghĩa ngay dưới bảng: *"Pass = 4 linter sạch + không accept-override + probe không
  fail — tầng cấu trúc, KHÔNG phải chất lượng nội dung (cột Đạt chất lượng)."* Backfill các dòng
  cũ bằng chính `summary` chạy hồi tố (§6); dòng nào manifest không đủ dữ liệu thì ghi `—`.

## 6. Validation (bắt buộc)

1. Chạy `campaign.py summary` hồi tố trên **cả 9 campaign dir** trong `docs/prompts/gen/` — không
   crash, và đối chiếu tay với SUMMARY.md tương ứng: mọi run mà SUMMARY ghi "4 linter sạch" phải
   ra PASS; mọi run error phải ra `build-error`. Lệch nào cũng phải giải thích được (thường là:
   SUMMARY chấm nội dung, summary chấm cấu trúc — đó là ranh giới ĐÚNG).
2. Campaign kế tiếp (bất kỳ) chạy đường mới end-to-end: record → summary → paste — dòng Pass xuất
   hiện trong CAMPAIGNS với đúng format.
3. S1: một build selfhost thật có probe → `report.json.probe == 'ok'` và manifest harvest được.

## 7. Guard / test phải xanh

- Suite server `node --test` (report.test.* thêm case probe field; không case cũ nào đổi — additive).
- `tests/test_campaign.py` (fixture 4 kiểu + golden row + hồi tố không-crash).
- Không đụng `e2e_check.py`, `e2e-suite.yml`, orchestrator, phases — **zero rủi ro pipeline build**.

## 8. Rủi ro đã biết

- **Mẫu nhỏ (9–12 prompt/campaign)**: nhảy 11/12→12/12 có thể là nhiễu. Đối sách: dòng CAMPAIGNS
  luôn ghi phân số (không %), và kết luận "fix X ăn" vẫn cần đối chiếu finding cụ thể như quy trình
  hiện tại — Pass Rate là **màn hình radar**, không phải quan tòa.
- **Map category là xấp xỉ** (linter ≠ taxonomy paper 1:1) — chấp nhận, vì mục tiêu là so
  **với chính mình qua thời gian**, đối chiếu ngoài chỉ là phụ. Docstring ghi rõ mapping.
- **Hai producer probeNote** (orchestrator + base-import) — S1 phải set kind ở CẢ hai, test cả hai
  (đúng vết 049 D2: một lần đã lệch vì sửa một đầu).
- **Manifest cũ thiếu probe** — bucket `n/a`, không fail giả; backfill CAMPAIGNS ghi `—` khi thiếu.

## 9. Open questions

1. Attempt nào tính khi một prompt chạy nhiều lần (retry sau quota/mạng)? Đề xuất mặc định:
   **attempt cuối** (khớp cách SUMMARY hiện chấm); `--all-attempts` để soi propensity. Chốt khi
   implement.
2. `accepted_lint_failure` (human override) — đếm là FAIL hay bucket riêng? Đề xuất: **FAIL +
   đếm riêng `accepted-override N`** trong dòng (nó là tín hiệu chất lượng thật, nhưng cần thấy
   tần suất override).

## 10. Non-goals (KHÔNG làm trong spec này)

- **Resolve Rate / live-run test-case** — hoãn có chủ ý (review 2026-08-05): cần model-inject ổn
  (spec 087) trước, chỉ phủ ~50% corpus (external services + trigger không enable được qua API),
  và rủi ro false-FAIL do non-determinism cần assertion vocabulary riêng. Mở spec mới khi đủ đau.
- **Multi-turn degradation probe** (đo Pass qua các vòng Ask/Consult) — chi phí turn thật cao,
  giá trị chưa chứng minh.
- **Mock server cho 6 prompt external** (Chatwork/WordPress/Slack/Google) — ngoài phạm vi đo.
- **Đổi cách `/report` chấm nội dung** — cột "Đạt chất lượng" giữ nguyên vai trò.
- **Thêm predicate mới vào `e2e_check.py`** — vocabulary ba-bucket giữ tối giản (YAGNI của 058).
