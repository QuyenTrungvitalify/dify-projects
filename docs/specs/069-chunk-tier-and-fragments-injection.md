# Spec 065 — Chunk tier (`nodes: N`) + `{{FRAGMENTS}}` bơm vào ③

**Status**: **Draft** (authored 2026-07-17 — awaiting review/go-ahead). Claude authors; implement on confirm.
**Effort**: M (S1 type = S · S2 mồi/đãi = M · S3 inject = S · S4 gác = XS · S5 đo = XS · S6 docs = XS)
**Depends on**: [037](037-builder-runnability-preflight-and-workspace-facts.md) (máy bơm `{{KNOWLEDGE}}` — S3
tái dùng nguyên) · [038](038-node-body-schema-linter.md) (`lint_node_bodies.py` + 29 `NodeData_*` — cổng
gác của S4) · [022](022-multi-source-template-library.md) (`x-provenance` + `check_provenance.py`) ·
[062](062-run-dossier-export.md) (transcript = **dụng cụ đo**, đã lắp) · [042](042-foreign-residue-preflight.md)
(ràng buộc redaction)
**Thay thế**: bản 065 cũ (*seed-provenance cost dimension*) — **bị chính bằng chứng giết**, xem §Context.

## Context

### Điều ai cũng tưởng

③ Implement chiếm **55–70%** cost/time của một build (058/059). Suy luận tự nhiên: *"sinh YAML là đắt → cần
template tốt hơn / truy xuất tốt hơn"*. Toàn bộ hướng đi trước (bản 065 cũ, ý dán nhãn index, `--name`
semantic) đều dựa trên giả định đó.

### Điều transcript nói

Spec 062 ship 2026-07-16 và bắt được transcript ③ thật. Run `1784185934247` (16.653 output token, 32 tool
call, pattern `scheduled-fetch-notify`):

| Nhóm | Call | Việc |
|---|---|---|
| Đọc contract | 2 | `SPEC.md` + `.dify-workspace.yaml` — **cần thiết** |
| **Mò xem đồ ở đâu** | **18** | `ls`/`find` lần mò `templates/patterns/`; **8 thất bại**; nhầm `skills/mango-svip/` với `.claude/skills/dify-build/`; phải `ls` cả repo root |
| Mint node ID | 1 | `generate_id.py 6` |
| **Săn thân node Slack** | **10** | grep corpus/templates **7 lần trượt** → **đọc source `lint_node_bodies.py`** để suy ngược shape hợp lệ → bới được từ `projects/_drafts/slack_message_l…` |
| **Ghi YAML** | **1** | ← **việc thật** |

**15/32 call (47%) THẤT BẠI. ~87% call là điều hướng + lần mò. Đúng 1 call làm việc.**

Và pattern **không phải vấn đề** — model tự ghi: 「パターンは `SPEC.md` と**1対1で一致します**」. Nó khớp
hoàn hảo, cho đúng topology, rồi model ghi file trong **1 call**. Thứ thiếu là **ruột của MỘT node**.

→ **③ đắt vì ĐI TÌM, không phải vì SINH.** Và thứ nó tìm là **thân một node đã được chứng thực**.

### Nguyên nhân cấu trúc

- `schemas/dify-dsl-0.6.0.json` có **29 `NodeData_*` $defs**. Người tiêu thụ: **đúng một** —
  `tools/dify_base/lint_node_bodies.py`. → Repo có **cỗ máy hoàn chỉnh nói "KHÔNG, thân node này sai"** và
  **không có gì nói "ĐÂY, thân node đúng"**. Đó chính xác là vì sao model đi đọc source linter.
- `templates/` = `_base` (project) · `library` (1 workflow) · `patterns` (9 workflow) · `probes` →
  **zero tầng node**.
- **6/8 pitfall trong AGENTS §9 là tri thức tầng node** (if-else cần cả `conditions`+`cases`; md_exporter
  nuốt whitespace; node ID chuỗi làm hỏng ref; ChatWork auth header + `today`/timezone; start node 6 input
  thay vì 1 file thô; schedule mặc định UTC) — nhưng không có nhà hình-node để đặt, nên nằm dạng văn xuôi.

**Tầng mà ③ thật sự làm việc trên đó thì không tồn tại.**

### Vì sao 2 nghi lễ chưng cất đều chết

022 → **1 item** (chết từ 2026-06-23) · 050/052 → **~3 pattern** · 85% build → `pattern: custom`
(71/84; trong đó 37/63 là trivial `['llm']` — fast build, *bỏ qua template theo thiết kế*).

Cả hai chưng cất ở **hạt workflow**: ~500 dòng · human-gated · one-file-per-run · chỉ tái dùng khi **cả
hình dạng** khớp (15%). **Không phải thủ công là sai — SAI HẠT.**

### Những gì bằng chứng đã giết (ghi lại để không đề xuất lại)

- **065 cũ** (*đo Δ③ pattern-vs-scratch*): đo nhầm thứ. Tệ hơn — cohort gom đại trên dữ liệu hôm nay cho
  **pattern median 12.204 vs custom 5.876 out-token**, đọc thô ra *"pattern đắt gấp đôi"*. **Sai**: cả 3 run
  pattern đều là `scheduled-fetch-notify` (workflow trigger to) so với mấy build custom nhỏ — **confounded,
  và chỉ sai hướng**. Suýt khai tử distillation vì một nhiễu.
- **Dán nhãn / semantic index**: tối ưu cú chọn pattern ở ① = **1 tool call**, trong khi ③ đốt **28**. Hơn
  nữa **③ không hề gọi `find.py`** (046 D3 cấm chọn lại) — nó **grep**. Mọi công sức index không chạm tới ③.
- **`--name` retrieval**: 17/26 entry corpus có nhãn tiếng Trung, 16/45 không description, requirement là
  JA/VI → substring match **không bao giờ nổ**.

## Goals

- **G1 — ③ thôi đi tìm**: thân node đã chứng thực được **BƠM VÀO**, không phải đi kiếm. Đích: 10 call săn
  shape → **0**; 18 call mò đường → **~2**.
- **G2 — một loại data, độ lớn là TRƯỜNG** (`nodes: N`): fragment ↔ pattern nằm trên **một phổ**, dùng chung
  index/provenance/staleness — **không cần migration về sau**.
- **G3 — khâu nạp KHÔNG THỂ TẮC**: cổng gác **cơ học** (`lint_node_bodies.py`), **batch-first, không
  human-review từng item**. Đây là bài học đắt của 022/050 và là **ràng buộc thiết kế số 1**.
- **G4 — ỔN ĐỊNH TRƯỚC HẾT**: FSM, cổng 4-linter, và mọi luồng hiện có **không đổi**. ③ nhận **NHIỀU
  context hơn**, không bao giờ nhận **luật khác**. Không di dời file đang có.
- **G5 — đo bằng dụng cụ đã lắp** (transcript 062): đếm tool call trước/sau trên **cùng một requirement**.

## Non-goals

- ❌ Đo Δ③ pattern-vs-scratch (065 cũ — đã chết).
- ❌ Dán nhãn / semantic index / `--name` (tối ưu 1 call ở ①).
- ❌ **Không bỏ tầng pattern.** Nó hạ từ *tầng riêng* xuống *một điểm trên phổ* (`nodes: full`); **9 file
  giữ nguyên tại chỗ**.
- ❌ **Không index `_drafts` làm kệ tham khảo** — draft là **MỎ**, không phải kệ (xem D5).
- ❌ Không đụng FSM / gate / hợp đồng 4-linter. **Không script linter mới** (kỷ luật 013/049).
- ❌ Không auto-promotion cho `nodes: full` — 050 giữ nguyên human gate (**đúng ở hạt đó**).
- ❌ Fast build (`DEPTH=trivial`) vẫn bỏ qua toàn bộ — không đổi.

## Design

### D1 — Một type `chunk`, độ lớn là trường

```
kind: chunk            ← một envelope · một index · một provenance
├── nodes: 1           "fragment"   ★ SHIP CÁI NÀY TRƯỚC ★   gác: lint_node_bodies.py
├── nodes: 2–3         "composite"  iteration+<id>start · if-else cases+conditions
└── nodes: full        "pattern"    9 cái đang có             gác: cả 4 linter
```

Granularity là **field**, không phải **tier**. Sau này nếu ghép chunk nhỏ rẻ hơn pattern nguyên khối →
**pattern tự chết bằng dữ liệu**, không ai phải xoá bằng suy đoán.

### D2 — Đồng bộ Ở INDEX, không đồng bộ trên đĩa (G4)

**File đang có KHÔNG di dời.** `templates/patterns/` ở nguyên chỗ — dời nó là phá `find.py`, `index.json`,
AGENTS §3/§8, implement.md ⇒ mất ổn định, đổi lấy con số 0.

```
templates/patterns/<name>.yml            ← nguyên trạng   → index: kind=chunk, nodes=full
templates/chunks/<node_type>/<slug>.yml  ← MỚI            → index: kind=chunk, nodes=1
```

`build_index.py` thêm 2 trường: `kind` (`chunk`) + `nodes` (int) + `node_type` (chỉ khi `nodes==1`). Shape
entry hiện tại (`source·file·path·name·description·complexity·node_count·node_types·plugins·has_*`)
**vừa sẵn** — `node_count: 1`, `node_types: [http-request]`. **Mở rộng, không thiết kế lại.**

> Ràng buộc đã xác minh: `corpus/` là clone read-only, `setup.sh` chạy lại **xoá sạch** (AGENTS.md:26,
> `.gitignore:6`). Nên đồng bộ **buộc phải** ở tầng index — không thể bằng header trong file. Câu hỏi
> "có nên gộp thành 1 loại data" **đã bị ràng buộc trả lời hộ**, và `index.json` (45 entry, 6 nguồn, một
> shape) **chính là tầng đó, đã tồn tại**.

### D3 — `{{FRAGMENTS}}`: backend lắp, ③ không tìm

Tái dùng **nguyên** máy móc 037 ([orchestrator.ts:394-402](../../apps/builder/server/lib/orchestrator.js)):

```
{{KNOWLEDGE}}  = fact sống từ Dify (hash plugin, dataset id)      ← ĐÃ CÓ
{{FRAGMENTS}}  = thân node đã chứng thực cho ĐÚNG node type cần   ← MỚI, cùng cơ chế
```

**Truy vấn là bảng node trong `SPEC.md`** — đã được **người duyệt ở gate ②**. Không suy đoán, không tìm
kiếm: backend đọc node type từ `SPEC.md`/`analyze.json.features` → lấy chunk `nodes:1` khớp → render khối
DATA-framed (y hệt `knowledgeBlock`) → bơm vào lượt ③.

**Rollout an toàn (G4)**: `FRAGMENTS: ''` là mặc định trong bảng token của `phases.ts` (đúng hợp đồng
*"every known token is always substituted"*). Kệ rỗng → khối rỗng → **③ hành xử y hệt hôm nay**. Máy móc
ship trước, **trơ** cho tới khi có chunk. Zero rủi ro ngày 1.

### D4 — `PATTERN_PATH`: xoá 18 call mò đường

Backend **đã biết** pattern nào được chọn — `task.analysisPattern` nằm trên task từ gate ①
([task.ts:227](../../apps/builder/server/state/task.js)). `injectVars` của implement đã bơm `SEED_PATH` rồi
([phases.ts:100](../../apps/builder/server/lib/phases.js)) → thêm `PATTERN_PATH` là **cùng một cơ chế, ~3 dòng**.

Kèm: thay link markdown tương đối trong implement.md/SKILL.md (`[SKILL.md](SKILL.md)`,
`[AGENTS.md](../../../AGENTS.md)`) bằng **path repo-relative tường minh**, và **gỡ nhập nhằng hai thư mục
`skills/`** (`skills/mango-svip/` = clone read-only chứa `generate_id.py`; `.claude/skills/dify-build/` =
prompt) — chính chỗ model lạc 5 call liên tiếp.

### D5 — Đãi quặng: draft là MỎ, không phải kệ

```
29 NodeData_* schema  ──► CẤU TRÚC      (đã có — đang bị nhốt trong linter)
Build đã pass / draft ──► GIÁ TRỊ THẬT  (đã có — đúng cái Slack body model đi bới)
AGENTS §9 (6/8)       ──► GOTCHA        (đã có — sẵn tầng node)
```

Nghịch lý *"drafts vô giá trị"* tan biến: **một draft rác vẫn chứa một node đã chứng thực**. Không index cả
draft — **đãi lấy node**. Đúng điều model đã tự làm ở call 31.

**Ba ràng buộc bắt buộc:**
1. **Redaction — không thương lượng.** Chunk đãi từ build thật mang dataset id / URL / token workspace.
   Đây **đúng là lớp lỗi spec 042** (*"demo/seed values … surviving into a build"*). Bắt buộc `redactSecrets`
   ([dify-io.ts:120](../../apps/builder/server/lib/dify-io.js)) + blank hoá mọi giá trị workspace-specific.
   Một chunk rò token là **tệ hơn không có chunk**.
2. **Batch-first, linter-gated (G3).** Chunk sai → `lint_node_bodies.py` **đánh rớt tức thì**. Không human
   review từng cái. **Cỗ máy từ chối trở thành cổng chất lượng cho cỗ máy sinh** — đây là điểm thiết kế
   khiến nó batch được và **không thể tắc như 022/050**.
3. **Dedup theo `(node_type, shape-hash)`** — 61 draft sẽ đẻ ra rất nhiều node trùng.

### D6 — Staleness

Tái dùng trục `known_good_dify` + `check_provenance.py` (050 D5 / 022 D5). **Không đẻ cơ chế mới.** Dify bump
version → chunk sau pin bị gắn cờ.

### Slices

- **S1** — type `chunk`: schema + `templates/chunks/<node_type>/<slug>.yml` + `x-provenance` header
  (`known_good_dify`, source, sha256) + `build_index.py` phát ra `kind`/`nodes`/`node_type`. **Thuần cộng —
  entry cũ không đổi shape.**
- **S2** — đãi quặng: mồi cấu trúc từ 29 `NodeData_*`; đãi giá trị thật từ build `liveTest=passed` + draft;
  **redact bắt buộc**; gắn 6 gotcha §9 vào node tương ứng; dedup. Batch, offline, không đụng runtime.
- **S3** — `{{FRAGMENTS}}` (D3) + `PATTERN_PATH` (D4). `FRAGMENTS: ''` mặc định → trơ khi kệ rỗng.
- **S4** — gác bằng `lint_node_bodies.py` (đã có, **0 script mới**): mọi chunk `nodes:1` phải pass mới vào kệ.
- **S5** — **đo**: chạy lại cùng requirement của run `1784185934247` → đọc transcript 062 → đếm tool call +
  tỉ lệ fail trước/sau. Đây là AC #1.
- **S6** — docs: AGENTS §8 bảng "where to find what" + §3 thứ tự ưu tiên phản ánh tầng chunk; ghi rõ
  `_drafts` = **mỏ, không phải kệ**.

## Open questions

- **OQ1 — `{{FRAGMENTS}}` bơm bao nhiêu là đủ?** SPEC khai 6 node → bơm 6 chunk? Có nguy cơ **phình prompt**
  (đổi 10 call săn lấy N nghìn token context — có thể **lỗ**). Đề xuất: bơm **tối đa 1 chunk/node_type**,
  chỉ cho node type **không tầm thường** (bỏ `start`/`end`/`llm` thuần), và **đo bằng S5** — nếu ③ out-token
  không giảm thì thu hẹp. **Đây là rủi ro thật của cả spec, không phải chi tiết.**
- **OQ2 — chunk `nodes:1` có cần cả envelope YAML hợp lệ không?** `lint_node_bodies.py` gác *thân node* —
  cần xác nhận nó chạy được trên một file chỉ chứa 1 node, hay phải bọc trong workflow tối thiểu. Ảnh hưởng
  thẳng tới S4 (nếu phải bọc → chunk to hơn, gác phức tạp hơn).
- **OQ3 — ngưỡng go/no-go, chốt TRƯỚC khi nhìn số** (tránh hợp lý hoá hậu nghiệm): S5 cho **tool call ③ giảm
  ≥50%** → giữ + mở rộng; **<20%** → revert S3, giữ S1/S2 làm tài liệu; **20–50%** → giữ nhưng thu hẹp OQ1.
- **OQ4 — nguồn đãi**: chỉ `liveTest=passed` (11 build, **11/11 là scaffold QA**) hay cả draft `done`? Đề
  xuất: **cả hai** — vì ta đãi **node**, không đãi build; một scaffold QA vẫn có thể chứa node hợp lệ, và
  linter là cổng gác chứ không phải danh tiếng của build. Nhưng cần chấp nhận kệ đầu tiên sẽ **mỏng và tầm
  thường**.

## Acceptance criteria

1. *(S5, G1 — AC chính)* Chạy lại **cùng requirement** của run `1784185934247`: tool call của ③ giảm **≥50%**
   (32 → ≤16) và **0 call** đọc source linter / grep tìm shape node. Bằng chứng = transcript 062, dán vào §Findings.
2. *(G4)* Với kệ chunk **rỗng**, `{{FRAGMENTS}}` render `''` và một build chạy **y hệt** hôm nay — server test
   xanh, 0 hồi quy. (Rollout trơ.)
3. *(S1/G2)* `index.json` mang `kind`/`nodes`/`node_type`; **9 pattern cũ ở nguyên đường dẫn cũ**, entry cũ
   không mất trường nào; `find.py` cũ chạy y hệt.
4. *(S4/G3)* Một chunk `nodes:1` có thân sai → `lint_node_bodies.py` **rớt**, không vào kệ. **Không có bước
   human-review nào trong đường nạp.**
5. *(D5.1)* Đỏ: một chunk đãi từ build thật còn dataset id / URL workspace / token → bị chặn. Xanh: bản đã
   redact + blank hoá → qua.
6. *(D6)* Chunk mang `known_good_dify`; `check_provenance.py` gắn cờ nó khi `.dify-tag` vượt lên.
7. *(Non-goal)* Diff **không** đụng FSM/gate; **không** thêm script linter; **không** dời file trong
   `templates/patterns/`. Kiểm bằng `git diff --name-only`.

## Findings

> Điền ở S5. **Không** kết luận trước khi mục này có số.

| Chỉ số (run 1784185934247) | Trước | Sau | Δ |
|---|---|---|---|
| Tổng tool call ③ | 32 | — | — |
| Call thất bại | 15 (47%) | — | — |
| Call mò đường | 18 | — | — |
| Call săn shape | 10 | — | — |
| ③ outputTokens | 16.653 | — | — |

## References

- **Bằng chứng gốc**: `apps/builder/.runs/1784185934247/transcripts/implement.md` (32 call — 062 capture)
- [037](037-builder-runnability-preflight-and-workspace-facts.md) — máy bơm `{{KNOWLEDGE}}` (S3 sao chép)
- [038](038-node-body-schema-linter.md) — 29 `NodeData_*` + `lint_node_bodies.py` (cổng gác S4)
- [062](062-run-dossier-export.md) — transcript capture = **dụng cụ đo** (đã lắp 2026-07-16)
- [042](042-foreign-residue-preflight.md) — foreign residue (ràng buộc redaction D5.1)
- [022](022-multi-source-template-library.md) — `x-provenance`/`check_provenance.py`; **và bài học 1-item**
- [050](050-proven-build-to-reusable-pattern-promotion.md) — *"No auto-promotion"* (đúng ở hạt workflow); **bài học ~3-pattern**
- [046](046-phase-latency-and-drift.md) D3 — ③ bị cấm chọn lại pattern (~40% tool call của phase)
- [020](020-builder-graph-reachability-linter.md) — `lint_refs` reachability = **thứ khiến "không pattern" sống được**
