# Spec 065 — Seed-provenance cost dimension: đo distillation thực sự tiết kiệm bao nhiêu ở ③

**Status**: **Draft** (authored 2026-07-16 — awaiting review/go-ahead). Claude authors; implement on confirm.
**Effort**: S (S1 derive = XS, S2 cohort table = S, S3 paired suite entries = S, S4 findings = XS)
**Depends on**: spec 059 (`task.json.cost` — per-phase token/duration), spec 060 (`check`/baseline/drift
machinery + the "không đụng app" stance), spec 058 (suite + 3-bucket harness)
**Gates**: P0 (auto-nominate promote candidates) và P1 (gap-fill retrieval) — cả hai chờ số của spec này.

## Context

Distillation (`templates/patterns/` + `templates/library/`) là **đòn bẩy trực tiếp lên ③ Implement** —
phase chiếm **55–70%** cost/time của một build (đo bởi 058/059). Logic: càng nhiều asset đã chưng cất và
càng khớp, Implement càng *copy nhiều, sinh ít* → nhanh hơn + chất lượng ổn định hơn.

Nhưng bánh đà đang đứng yên, và **không ai biết đòn bẩy này mạnh bao nhiêu**:

- **Kho không lớn**: 9 pattern + **1** curated-library item ([templates/library/](../../templates/library/)
  `seo-slug-generator.yml`, đứng im từ 2026-06-23). Intake thủ công — spec 050 nói thẳng *"No
  auto-promotion. Human-gated, one-file-per-run"*; kênh candidate chỉ tự sinh **rule linter**, không
  nominate cả pattern.
- **Retrieval thô**: Analyze chọn **1** pattern; ③ `cp templates/patterns/X.yml` rồi sửa `# TODO:`
  ([implement.md:56-59](../../.claude/skills/dify-build/implement.md)). Coverage-gap **đã được tính**
  (`patternFeatureGap`, [analysis.ts:52](../../apps/builder/server/lib/analysis.ts)) nhưng **chỉ để
  cảnh báo** — không hành động gì.

Hai khoản đầu tư ứng viên — **P0** (auto-nominate build passed → kho tự lớn) và **P1** (bơm node
exemplar lấp gap vào ③) — đều tốn effort thật. **Hôm nay không con số nào biện minh cho chúng**: 059/060
bắt cost mỗi phase nhưng **không có chiều seed-provenance**, nên không ai biết build khởi từ pattern có
thật sự rẻ hơn build từ đầu hay không, rẻ bao nhiêu.

Kỷ luật của repo là **measure-then-promote** (020: warn → đo → mới promote thành hard gate; 038: đo 0-FP
→ mới thành linter thứ 4). Spec này cấp **đúng phép đo đó** để chốt P0/P1 bằng bằng chứng, không bằng
niềm tin.

## Goals

- **G1 — con số chính**: build khởi từ **pattern** có rẻ hơn **from-scratch** ở ③ không, và **bao nhiêu %**?
  Có kiểm soát, lặp lại được.
- **G2 — kiểm định giả thuyết P1**: build mà pattern **có gap** (`patternAdvisory` xuất hiện) có đắt hơn ở ③
  so với build pattern **phủ đủ** không? Đây chính là luận điểm của P1, đo được trực tiếp.
- **G3 — không đụng app**: thuần test-side, theo đúng tiền lệ spec 060 (*"app lo hiển thị, harness lo gác"*).
  Không capture mới, không field mới, không UI.
- **G4 — lặp lại được**: cùng một lệnh tái lập con số sau bất kỳ thay đổi nào (đo lại sau khi P0/P1 land).

## Non-goals

- **Không auto-promotion (P0)** và **không gap-fill (P1)** — cả hai là *kết quả* của spec này, không phải
  phạm vi của nó. Spec này chỉ cấp số để quyết định.
- **Không đổi app**: không thêm field vào `task.json`, không sửa orchestrator/FSM, không hiện seed-kind
  trên UI (xem OQ3).
- **Không script python mới**: mở rộng `e2e_check.py` sẵn có (đúng như 060 mở rộng chứ không đẻ script).
- **Không phải CI**: on-demand, tốn turn thật — hệt 058/060. Spec 021 vẫn là nhánh pytest.
- **Không đo chất lượng output** ở đây — `/report` + 3-bucket của 058 đã lo; spec này đo **chi phí/thời gian**.

## Design

### D1 — seed-kind là **suy ra được**, không cần capture (nền của G3)

`task.json` **đã mang đủ** mọi tín hiệu. Không cần backend ghi thêm gì — harness derive **offline**:

| seedKind | Điều kiện (field đã có trên Task) |
|---|---|
| *(loại trừ)* | `kind === 'promote'` — không phải build ([task.ts:170](../../apps/builder/server/state/task.ts)) |
| `dify-seed` | `seedAppId` / `seedPath` có giá trị ([task.ts:181](../../apps/builder/server/state/task.ts)) |
| `existing` | start chọn `workflow`/`workflowSlug` sẵn có |
| `pattern` | from-scratch + `analysisPattern` có và `!== 'custom'` ([task.ts:227](../../apps/builder/server/state/task.ts)) |
| `scratch` | from-scratch + `analysisPattern` vắng hoặc `'custom'` |

Hai cờ trực giao, đọc kèm:
- **`covered`** = `!patternAdvisory` ([task.ts:231](../../apps/builder/server/state/task.ts)) — chỉ có nghĩa
  khi `seedKind === 'pattern'`. **Đây là biến của G2.**
- **`fast`** = `fastMode` — build ⚡ gộp ①+② nên profile cost khác hẳn → **tách cohort riêng, không trộn**.

> **Sự thật cần nói thẳng**: một base YAML upload (spec 051) sau khi scaffold trở thành workflow thật trên
> đĩa rồi được chọn như `workflow` → **không phân biệt được** với edit-existing ở mức `task.json`. Gộp cả
> hai vào `existing` và ghi rõ giới hạn này, thay vì bịa ra một bucket không có tín hiệu đỡ.

**Phương án bị loại**: bắt backend persist `task.seedKind`. Thừa (suy ra được), và phá G3 — 060 đã lập tiền
lệ "không đụng app". Nếu sau này DevPanel muốn hiện → OQ3.

### D2 — **Cấu phần then chốt: ghép cặp (pairing), nếu không con số là rác**

Đây là chỗ phép đo dễ sai nhất. Mỗi prompt có **chi phí ③ nội tại khác nhau** (một workflow 3 node vs 9
node). Gom đại `.runs/` rồi so trung vị `pattern` vs `scratch` là **so nhầm prompt, không so seed-kind** —
confounded, và con số sẽ dẫn P0/P1 đi sai hướng.

→ **So sánh phải có đối chứng**: cùng **một requirement**, chạy hai lần — một lần ép from-scratch, một lần
để pattern seed. Δ③ giữa hai lần *chỉ còn* khác biệt seed-kind. Đó mới là con số biện minh được P0/P1.

Cohort gom-đại vẫn hữu ích như **tín hiệu nền** (n lớn, nhiễu cao) nhưng **không được** dùng làm căn cứ
quyết định. S2 in cả hai và **dán nhãn rõ cái nào là bằng chứng, cái nào là tham khảo**.

### D3 — metric chính = **③ `outputTokens`**

Chọn có căn cứ từ code, không theo cảm tính:

- ❌ **`totalCostUsd`** — [task.ts:160](../../apps/builder/server/state/task.ts) ghi rõ *"may be absent on a
  subscription login"*. Vắng mặt trên chính setup của user → không dùng làm trục chính được.
- ❌ **`durationMs`** — nhiễu mạng/máy/tải; đo lại hôm khác ra số khác.
- ✅ **`outputTokens`** — đo **thẳng** thứ ta muốn giảm: *token model phải SINH ra*. "Copy nhiều, sinh ít"
  chính là output token giảm. Ít nhiễu nhất, tái lập tốt nhất.
- Phụ (in kèm, không quyết định): `numTurns`, `durationMs`, `cacheReadTokens`.

### D4 — bề mặt lệnh

`e2e-run.sh time <taskId>` (đã render bảng cost 059 qua `--task-json`,
[e2e_check.py:454](../../apps/builder/scripts/e2e_check.py)) → thêm **một dòng header** `seed:` cho run đó:
`seed: pattern(per-row-notify) covered=yes fast=no`.

Lệnh mới `e2e-run.sh cohort`:
- Quét `.runs/*/task.json`, derive D1, nhóm theo `seedKind` (× `fast`), in **median/n** của ③ outputTokens
  (+ phụ), và **bảng cặp** của D2 khi các entry ghép cặp có mặt.
- **Sàn kết luận**: cohort `n < 3` vẫn in nhưng **gắn cờ `insufficient`** — không được đọc như bằng chứng.
  (Chống chính cái bẫy "3 run rồi kết luận".)

### Slices

- **S1** — derive seed-kind (pure, offline) trong `e2e_check.py` + unit test cho từng nhánh D1 (kể cả
  `promote` bị loại, `existing` gộp, `analysisPattern: 'custom'` → `scratch`).
- **S2** — `cohort` command + dòng `seed:` trên bảng `time`; sàn `n<3 → insufficient`; bảng cặp D2.
- **S3** — **2 cặp entry đối chứng** trong `e2e-suite.yml`: cùng prompt, `<id>-scratch` (ép `pattern: custom`
  / chọn requirement không khớp pattern nào) vs `<id>-pattern` (khớp một pattern có sẵn). **Không sửa entry
  cũ** — chỉ thêm, để hồi quy 058/060 không lay chuyển.
- **S4** — chạy live một lượt → điền số đo vào chính spec này (mục *Findings*) → **chốt go/no-go cho P0 và
  P1 bằng số**. Tiện thể lấp nốt **baseline S3 còn treo của spec 059** (*"S3 baseline chờ 1 lần chạy suite
  live"*) trong cùng lượt chạy — cùng dữ liệu, không tốn thêm turn.

## Open questions

- **OQ1 — sàn n**: `n ≥ 3`/cohort có đủ để gắn cờ không? (đề xuất: `n<3` = `insufficient`; **cặp đối chứng
  D2 có sức nặng hơn cohort n lớn** — 2 cặp sạch > 20 run tạp.)
- **OQ2 — ép from-scratch kiểu gì cho sạch?** Không có cờ "cấm dùng pattern". Hai đường: (a) chọn
  requirement cố tình lệch mọi pattern (Analyze tự ra `custom`) — tự nhiên nhưng *đổi luôn prompt*, phá
  pairing; (b) thêm cờ test-only chặn pattern — sạch cho pairing nhưng **đụng app**, phá G3.
  → đề xuất **(a)** + chấp nhận ghi rõ giới hạn; nếu (a) không tách bạch được thì escalate lại OQ này thay
  vì lặng lẽ phá G3.
- **OQ3 — DevPanel có cần hiện seedKind không?** (đề xuất: **không**, ngoài phạm vi; mở spec riêng nếu muốn.)
- **OQ4 — ngưỡng go/no-go**: Δ③ bao nhiêu % thì đáng làm P0/P1? (đề xuất chốt **trước** khi nhìn số, tránh
  post-hoc rationalize: **≥20%** → làm; **<10%** → bỏ, đầu tư chỗ khác; **10–20%** → chỉ làm P1, hoãn P0.)

## Acceptance criteria

1. *(S1)* `seedKindOf` trả đúng nhãn cho cả 5 nhánh D1 + loại `kind:'promote'`; `analysisPattern: 'custom'`
   → `scratch`; `patternAdvisory` có → `covered=false`. Unit test xanh, thuần pure (không I/O, không clock).
2. *(S1)* Một `task.json` **pre-059** (không có `.cost`) → không crash, xếp `unknown`/bỏ qua, **không** husk
   0-token (đúng thái độ `costFromResult → null` của 059).
3. *(S2)* `e2e-run.sh time <taskId>` in dòng `seed:` đúng cho: 1 run pattern-covered, 1 run pattern-gap,
   1 run scratch.
4. *(S2)* `e2e-run.sh cohort` in median ③ outputTokens theo seedKind, **n mỗi cohort**, `fast` tách riêng,
   và cohort `n<3` mang cờ `insufficient`.
5. *(S3)* Suite có ≥2 cặp `<id>-scratch`/`<id>-pattern`; `e2e-run.sh check` trên các entry **cũ** cho verdict
   **y hệt trước** (không hồi quy 058/060).
6. *(S4)* Mục **Findings** trong spec này mang số thật: Δ③ outputTokens `pattern` vs `scratch` (theo cặp), và
   `covered` vs `gap`; kèm **go/no-go cho P0 và P1** chiếu theo ngưỡng OQ4.
7. *(G3)* Diff **không chạm** `apps/builder/server/**` và `apps/builder/web/**`. Kiểm được bằng
   `git diff --name-only` trong review.

## Findings

> Điền ở S4 sau lượt chạy live. **Không** kết luận P0/P1 trước khi mục này có số.

| So sánh | ③ outputTokens | Δ | n | Kết luận |
|---|---|---|---|---|
| `pattern` vs `scratch` (theo cặp, D2) | — | — | — | — |
| `covered` vs `gap` (giả thuyết P1) | — | — | — | — |
| cohort gom-đại (tham khảo) | — | — | — | — |

## References

- [059](059-phase-cost-instrumentation.md) — `task.json.cost`, `costFromResult`; **S3 baseline còn treo** (S4 lấp cùng lượt)
- [060](060-e2e-cost-regression-gating.md) — `cost:` predicate, baseline/drift, tiền lệ *không đụng app*
- [058](058-e2e-simulation-harness.md) — suite + 3-bucket; số ③ = 55–70%
- [050](050-proven-build-to-reusable-pattern-promotion.md) — *"No auto-promotion"* (nguồn gốc bánh đà đứng: P0)
- [019](019-builder-output-quality-and-lean-roadmap.md) O2 / [analysis.ts](../../apps/builder/server/lib/analysis.ts) — `patternFeatureGap` advisory-only (nguồn gốc P1)
- [020](020-builder-graph-reachability-linter.md), [038](038-node-body-schema-linter.md) — tiền lệ **measure-then-promote**
