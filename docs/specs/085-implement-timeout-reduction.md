# Spec 085 — Giảm timeout phase ③ Implement (reference-discipline + budget an toàn + tách turn có điều kiện)

**Status**: Draft v4 (2026-08-04). v4 = **S2 (code default 15 min) + S4 (salvage-on-timeout) ĐÃ LÀM**
(full suite 773 pass/0 fail, UNCOMMITTED theo yêu cầu); S1 đã validate qua 2 re-fire (thrash HẾT, build
đứng ngay mép 600s → §6.1); còn lại chỉ re-fire chốt `done` với 900s. v3 = re-fire xác nhận SIZE + S4.
v2 = review đối-chiếu code+run. v1 = run gốc `ng_quy_tr_nh` timeout ③.
v2 = sửa theo review đối-chiếu code+run: §1 tách "23 min" thành MỘT turn 600s + gap ngoài-turn (bỏ "nhiều
lượt 600s" — mâu thuẫn với chính §4); lỗi plugin được chẩn lại là **mâu thuẫn guidance↔sandbox** (S1b);
Open Q2 cũ (worked example) được **promote** thành S1c vì load-bearing; thêm S0 observability.
**Effort**: S0 ≈ XS (1 event + 1 case dossier) · S1 = S1a guidance (S) + S1b hook (XS) + S1c content (S)
· S2 ≈ XS (config, ĐIỀU KIỆN) · S3 ≈ L (đổi phase-flow, ĐIỀU KIỆN).
**Đóng spec**: qua `/spec-close 085`.

---

## 1. Bối cảnh — đo được, không phỏng đoán

Build `ng_quy_tr_nh` (pipeline Chatwork→WordPress tự động: webhook + vision LLM + web search + chống trùng
+ sinh HTML JP + ghi Google Sheets + **fail-soft mọi node**) **timeout ở ③ Implement**. Số đo từ run
(`.runs/1785770419076`):

| Phase | Wall-clock | Ghi chú |
|---|---|---|
| ① Analyze | ~4.0 min (237.8s) | ổn |
| ② Spec | ~4.1 min (247.8s) | SPEC ~8.7k ký tự, ~28 node-mention (build ~20 node) |
| ③ **Implement** | **~23 min phase-window** = **MỘT turn ≤600s active** + **~13 min ngoài mô hình (§1.1)** | **`wrote_yaml=False`**, validate chạy 0 lần, **8 lỗi** |

`exit 1` + `artifact missing: …/main.yml` = turn Implement vượt hạn cứng **600s** rồi bị force-kill **trước
khi kịp ghi `main.yml`**. **KHÔNG phải lỗi kết nối** — turn chạy nền server-side; ngắt browser không hủy build.

### 1.1 Vì sao 23 phút ≠ "nhiều lượt 600s" (sửa ở v2)

- `events.jsonl` có đúng **MỘT** `phase_start implement` (00:28:29) → **MỘT** `error` (00:51:27);
  transcript có đúng **MỘT** "attempt 1". Resume-fallback loại trừ timeout
  ([orchestrator.ts:539-544](../../apps/builder/server/lib/orchestrator.ts)) nên một dispatch không thể tự
  sinh lượt thứ hai — "nhiều lượt 600s" của v1 mâu thuẫn với chính §4.
- Timeout là **setTimeout force-kill sau 600s** ([turn-runner.ts:119-131](../../apps/builder/server/lib/turn-runner.ts))
  ⇒ turn tiêu tối đa ~10 phút *active*. Mọi bước pre-turn đều cỡ giây (harvest đã chặn 15s/arm từ commit
  `c9dadb9` 07-28; `gitDirtyPaths`/snapshot/render là git + fs cục bộ).
- ⇒ **~13 phút wall-clock dư ra nằm NGOÀI mô hình 3-nút-thắt.** Giả thuyết hàng đầu: **host ngủ giữa turn**
  (timer monotonic của Node đứng khi máy ngủ → 600s active giãn thành ~23 min wall-clock; user đóng máy sau
  khi bắn build lúc 00:28 là kịch bản thật). Ít khả năng hơn: spawn/event-loop trễ.
- **Hệ quả cho spec:** KHÔNG dùng "23 phút" làm bằng chứng SIZE cho nút (b). Bằng chứng thật của run này
  chỉ là *một cửa sổ 600s bị thrash ăn hết trước khi ghi YAML*. S0 đo để chốt ở run sau.

### 1.2 8 lỗi Implement, phân loại (v2 — thêm NGUỒN GỐC từng lớp)

- **5/8 = hunt `fail-branch`**: 3× bash `grep` (hook deny metacharacter / not-in-allow-set), 1× **Grep-tool**
  trên `templates/` (lỗi vì Grep bị **DEFERRED** trong child session — chính hook ghi nhận điều này từ run
  1784267358546, [permission-gate.ts:99-104](../../apps/builder/server/hooks/permission-gate.ts)), 1×
  `find.py --has fail_branch` (unknown feature — **feature vocabulary không có khái niệm error-handling**;
  đã chạy thử, lệnh liệt kê feature hợp lệ và không có `fail_branch`). SPEC ghi "Bật **nhánh lỗi**" trên
  nhiều http-request → agent đi xác minh cú pháp → mọi cửa nó thử đều đóng.
- **2/8 = resolve plugin**: `marketplace.py resolve omluc/google_sheets/0.0.2` bị deny **vì
  `marketplace.py` KHÔNG có trong `ALLOWED_PYTHON_SCRIPTS`**
  ([permission-gate.ts:54-63](../../apps/builder/server/hooks/permission-gate.ts), python default-deny) —
  trong khi [implement.md:110-114](../../.claude/skills/dify-build/implement.md) **CHỈ DẪN chạy đúng lệnh
  này** ở bước 2 ⇒ **mâu thuẫn guidance↔sandbox**, không phải (chỉ) hành vi agent. Cộng 1× **Grep-tool**
  trên `tool-catalog.json` (deferred, như trên) — agent **ĐÃ cố tra catalog**, chỉ sai cửa (cửa đúng:
  **Read**; `google_sheets` ĐÃ có trong catalog).
- **1/8 = pipe trên lệnh allowed**: `lint_node_bodies.py --dump-schema http-request **| head**` (denied vì
  `| head` là metacharacter, không phải vì lệnh).

## 2. Chẩn đoán gốc — MỘT nguyên lý

Kiến trúc ③ hiện tại dồn **đọc + tra/resolve + dựng + vòng cap-5 lint** vào **MỘT** ngân sách 600s. Mọi thứ
agent phải **đi tìm** (schema fail-branch, plugin id) mà sandbox chặn đều **đốt ngân sách chung**; và
timeout thì **mất trắng** (verify không thấy main.yml → HARD error → Retry lại 600s từ đầu).

> **Ba nút thắt ĐỘC LẬP:**
> (a) **Đi-lạc** — agent tìm thứ nó không được trao (fail-branch schema, plugin) → thrash. *Chiếm 8/8 lỗi
>     run này và là lý do CHƯA KỊP ghi YAML.* Trong đó có một phần là **cửa bị đóng nhầm** (S1b) chứ không
>     thuần hành vi.
> (b) **Ngân sách** — 1×600s cho tất cả; build lớn (~20 node) *có thể* vỡ dù không thrash — nhưng run này
>     **KHÔNG cho bằng chứng size** (chỉ một cửa sổ 600s; "23 phút" là artifact đo — §1.1).
> (c) **Mất-trắng** — timeout ở ③ = xóa hết, retry từ đầu.

**Điểm mấu chốt chưa biết:** vì (a) ăn hết budget *trước khi* dựng, ta **không có dữ liệu** build thật có
vừa 600s không sau khi hết thrash. ⇒ phải giải (a) trước rồi **đo** mới biết có cần đụng (b)(c).

## 3. Nguyên tắc (giữ khi implement)

- **Ưu tiên guidance trước code.** Lớp thrash hành-vi sửa bằng **1 bản sửa `implement.md` (S1a)** — zero
  backend. Nhưng v2 thừa nhận: 2 mảnh KHÔNG sửa được bằng guidance — cửa sandbox đóng nhầm (S1b) và
  nguồn ví dụ không tồn tại (S1c).
- **"Hand it, don't search"** — mở rộng insight spec 046/076 (pattern-search = 40% tool-call) sang
  **schema-doc + plugin + worked-example**: thứ ③ cần mà phải đi tìm → trao thẳng / trỏ đúng chỗ.
- **Sandbox phải khớp guidance nó phục vụ.** Allow-set của hook tự tuyên bố "enumerated from the 4 phase
  .md" — một lệnh mà phase-doc *chỉ dẫn* nhưng hook deny là **bug enumeration** (marketplace.py), sửa ở
  S1b. Đây KHÔNG phải cái cớ nới sandbox rộng hơn (pipe/grep vẫn giữ nguyên — §10).
- **Không phá quality-gate ③→④.** `verifyPhase` (chạy lại linter độc lập, [orchestrator.ts:565](../../apps/builder/server/lib/orchestrator.ts)) là **lưới an toàn trust-nothing**, KHÔNG phải nút thắt (nó nằm NGOÀI 600s,
  ~<1s). **Không** chuyển nó sang ④, không bỏ nó.
- **Không quăng cả doc lỗi-thời.** `edge_types.md` thuộc clone bên thứ 3 `skills/mango-svip/references/`
  (SKILL.md:55 ghi nhận `node_types.md` cùng thư mục sai shape trigger). Chỉ trỏ **section
  `Error Handling Nodes`** (khớp linter — đã verify với `lint_refs.py:67-75`), không cả 354 dòng.
- **Đo thrash-vs-size trước khi leo thang.** S2/S3 chỉ làm khi re-fire cho thấy build ghi được YAML mà vẫn hụt.

## 4. Cơ chế — neo file:line

- **Turn dispatch**: [orchestrator.ts:488-497](../../apps/builder/server/lib/orchestrator.ts) — 1 turn, `timeoutMs = TURN_TIMEOUT_MS`.
  `TURN_TIMEOUT_MS = BUILDER_TURN_TIMEOUT_MS || 10*60*1000` ([:55](../../apps/builder/server/lib/orchestrator.ts)).
- **Timeout = force-kill wall-clock-active**: [turn-runner.ts:119-131](../../apps/builder/server/lib/turn-runner.ts)
  — setTimeout; máy ngủ thì timer monotonic đứng (nền của §1.1).
- **Cap-5 lint→fix loop nằm TRONG turn** (agent-driven, không phải orchestrator loop):
  [orchestrator.ts:379](../../apps/builder/server/lib/orchestrator.ts) + [implement.md:135](../../.claude/skills/dify-build/implement.md).
- **Post-turn verify** (ngoài 600s): `verifyPhase` → `resolveImplementOutcome`
  ([orchestrator.ts:565,604](../../apps/builder/server/lib/orchestrator.ts)) → success / still_failing / error.
- **Resume-fallback CHỈ khi session hỏng, KHÔNG khi timeout** ([:539-544](../../apps/builder/server/lib/orchestrator.ts)) — timeout = mất trắng.
- **Reference bơm vào ③**: `gapReferences` (pattern-example theo `has_*` feature)
  [orchestrator.ts:431](../../apps/builder/server/lib/orchestrator.ts) + [analysis.ts:120-155](../../apps/builder/server/lib/analysis.ts). **Không** trao schema-doc/plugin,
  và **không thể** trao ví dụ error_strategy (0/13 pattern có nó — nền của S1c).
- **Sandbox turn**: PreToolUse hook [permission-gate.ts](../../apps/builder/server/hooks/permission-gate.ts) —
  python default-deny ngoài `ALLOWED_PYTHON_SCRIPTS` (:54), Grep-tool deferred trong child session (:99-104).
- **Plugin resolve (trong turn)**: `tool-catalog.json` TRƯỚC → `marketplace.py resolve` sau
  ([implement.md:110-114](../../.claude/skills/dify-build/implement.md)). `google_sheets` đã có trong catalog.
  `marketplace.py` có 3 subcommand (`resolve`/`tools`/`catalog`) — **tất cả read-only**, public API, không token.
- **Timeline**: `logEvent` → `.runs/<id>/events.jsonl`; `RunEventKind` là **union đóng**
  ([run-events.ts](../../apps/builder/server/lib/run-events.ts)) và dossier render qua switch
  ([dossier.ts:144](../../apps/builder/server/lib/dossier.ts)) — S0 phải thêm cả hai đầu.

## 5. Slices

### S0 — Observability: event `turn_spawned` (XS, làm cùng S1)
`logEvent({kind:'turn_spawned', phase, detail:'attempt N'})` ngay trước `runTurn` trong `spawnOnce` →
run sau **tách được turn-active vs phase-window bằng số**, chốt giả thuyết host-sleep §1.1.
Việc: thêm literal vào union `RunEventKind` + 1 case trong `flowLines` (dossier) + gọi trong orchestrator.
Sự kiện là append-only, best-effort — không đổi hành vi FSM.

### S1 — Reference-discipline (đòn bẩy #1, làm TRƯỚC): ba lát đi cùng nhau

**S1a — guidance `implement.md`** (chạm cả 3 lớp thrash đã quan sát):
- **(a) fail-branch/error_strategy** — whitelist đọc **section `Error Handling Nodes` của
  `skills/mango-svip/references/edge_types.md`** + **worked example S1c** khi cần shape nhánh lỗi
  (KHÔNG grep, KHÔNG đọc cả file). Khoét lỗ câu "skills/mango-svip … never search it"
  ([implement.md:18-20](../../.claude/skills/dify-build/implement.md)) cho rõ: references/ là nguồn schema
  **ĐƯỢC ĐỌC có địa chỉ**. Đường dẫn viết dạng code-path từ repo root, KHÔNG markdown-link (giữ guard
  `phase-doc-links` xanh).
- **(b) plugin** — "**Read `templates/tool-catalog.json`** TRƯỚC (nguyên văn: dùng tool **Read** — Grep-tool
  bị deferred trong build turn, shell grep bị hook chặn); đúng identifier; chỉ khi plugin KHÔNG có trong
  catalog mới `marketplace.py resolve` (được allow từ S1b)".
- **(c) pipe** — "KHÔNG thêm `| head`/redirect/`;` vào lệnh tool (sandbox chặn) — output trả đủ,
  `--dump-schema` chạy trần".
- Test: không có test tự động (guidance) → verify bằng **re-fire** (§6).

**S1b — hook: allow `tools/dify_base/marketplace.py`, subcommand `resolve` (XS, code+test)**
Thêm vào allow-set của [permission-gate.ts](../../apps/builder/server/hooks/permission-gate.ts), **chặn
subcommand ≠ `resolve`** (tools/catalog cũng read-only nhưng guidance chỉ cần resolve — hẹp nhất đủ dùng).
Lý do: sửa **bug enumeration** (§3) — implement.md chỉ dẫn lệnh này từ trước; deny nó là sandbox lệch
guidance, và với plugin NGOÀI catalog thì fallback được tài-liệu-hóa đang **chết hẳn** (đúng kịch bản
implement.md tự cảnh báo "empty facts … never a reason to drop a tool node"; `lint_plugin_hashes.py` sẽ
FAIL node thiếu dependency). Test: `permission-gate.test.ts` thêm case allow `resolve` / deny subcommand khác.

**S1c — worked example `error_strategy` (S, content) — PROMOTED từ Open Q2 v1**
Load-bearing chứ không tùy chọn: **0/13 pattern có `error_strategy`** + feature vocabulary của
`find.py`/index không có khái niệm error-handling ⇒ `gapReferences` **không bao giờ** trao được ví dụ
fail-branch; S1a một mình chỉ trao ngữ pháp (đúng rủi ro §8 v1 tự nêu).
- **Nội dung**: workflow tối thiểu, **lint-clean cả 4 linter**: `http-request` + `code` node đều
  `error_strategy: fail-branch`, edge `success-branch`/`fail-branch` đúng shape, downstream đọc
  `error_message`/`error_type` (fail-soft đúng kiểu run gốc cần).
- **Vị trí**: `.claude/skills/dify-build/references/error-strategy.yml` — **KHÔNG** đặt
  `templates/patterns/` (quyết định v2): `gapReferences` chọn greedy "phủ nhiều nhất → ít node nhất" nên
  một file didactic 5-6 node sẽ **chiếm slot** gap `http-request`/`code` của example thật giàu hơn.
  Turn Read được (deny-read chỉ áp `~/.claude`), nhưng không sửa được (deny Write/Edit `.claude/**`) — an toàn.
- implement.md (S1a) nêu **đích danh** đường dẫn.

### S2 — Budget an toàn: nâng timeout (XS, ĐÃ LÀM 2026-08-04 — CODE DEFAULT, không phải env)
Đổi **default trong CODE** `TURN_TIMEOUT_MS` 10→**15 phút** ([orchestrator.ts:55](../../apps/builder/server/lib/orchestrator.ts))
— **cố ý ship qua code, KHÔNG qua `.env` local**: `apps/builder/.env` gitignored nên không đi theo `git pull`;
để ở code thì `update-and-run.command` (pull → `tsc` build → `npm start`) **mang 900s tới mọi máy**. Env
`BUILDER_TURN_TIMEOUT_MS` vẫn override được (đọc 1 lần/load, cần restart). Đồng bộ: `.env.example` (comment
default 15 min) + `timeout-knobs.test.ts` (assert 15min + `.env.example` doc 900000). `promote.ts` (turn
distill) **giữ 600s** — distill nhỏ, không phải nút thắt build. Full suite 773/0.
- **Vì sao XÁC ĐÁNG chứ không phải "phao mù"**: 2 re-fire cho thấy build đứng NGAY MÉP — #1 = 582s (done),
  #2 = 600.7s (miss). Biên 900s cho headroom thoải mái; S4 salvage cứu nốt ca hi-hữu vẫn chạm cap.

### S3 — Tách ③ theo kích thước (L, ĐIỀU KIỆN — chỉ khi đo thấy SIZE là nút thắt)
Chẻ Implement build LỚN thành 2 turn, mỗi turn 600s riêng:
- **Turn A — dựng khung**: nodes + edges + id + wiring → ghi `main.yml` thô → **CHECKPOINT**.
- **Turn B — điền + lint**: đọc khung, điền body, chạy cap-5 lint→fix → final. Timeout ở B ⇒ **resume B**,
  không mất khung A (giải luôn nút (c) mất-trắng).
- Định tuyến theo node-count/feature từ SPEC; build nhỏ vẫn **1 turn** như cũ (không bắt số đông trả giá).
- Đụng orchestrator + toàn bộ test phase-flow → **rủi ro cao nhất**. **Chỉ làm nếu S1(+S2) chưa đủ.**

### S4 — Salvage-on-timeout (nút c, S, ĐÃ LÀM 2026-08-04)
`resolveImplementOutcome` ([orchestrator.ts:613](../../apps/builder/server/lib/orchestrator.ts)): một
**timeout** để lại artifact **present + parseable + in-confinement + lint-clean + ids-ok** không còn
auto-HARD-error mà **salvage → `success`** (timeout + file bẩn/thiếu vẫn HARD error; note khác timeout —
spawn/exit fail — không bao giờ salvage). Predicate `isTimeoutNote` **co-locate với mint** ở
[turn-runner.ts](../../apps/builder/server/lib/turn-runner.ts) (`timeoutNote`) để match/mint không lệch.
- **Hiệu quả trên run gốc**: chính `ng_quy_tr_nh_3` (file 0/0/0) sẽ THÀNH CÔNG thay vì error + mất-trắng.
- **Không nới quality-gate**: chỉ salvage khi `verifyPhase` độc lập xác nhận lint-clean (cùng bar
  `lintClean` của success thường); `reasons` rỗng trên success
  ([:682](../../apps/builder/server/lib/orchestrator.ts)) nên không rò note "timed out".
- Test: `post-turn-multi-lint.test.ts` **+3 case** (clean→success · dirty→error · non-timeout-note→error);
  `advance-loop.test.ts` D4 fixture đổi sang **dirty** (giữ đúng ý D4: resume-timeout không chạy turn thứ 2,
  vẫn park error). Full suite **773 pass, 0 fail**.
- **Làm nhẹ nhu cầu S3**: checkpoint của S3 chủ yếu để không mất-trắng — S4 đã cứu ca "gần xong bị cap" rẻ
  hơn nhiều. S3 chỉ còn cần khi build KHÔNG kịp ghi cả YAML-sạch trong 1 turn.

## 6. Validation (bắt buộc — mục tiêu là ĐO thrash-vs-size)
**Re-fire chính prompt Chatwork qua `/e2e`** sau S0+S1, đọc transcript + events ③:
0. `turn_spawned` → turn-active bao nhiêu? Gap wall-clock có tái hiện không? (nếu tái hiện mà không phải
   sleep → mở điều tra riêng, KHÔNG trộn vào spec này.)
1. `find_query`/bash ③ **không còn** grep fail-branch / marketplace-denied / pipe? (S1 có tác dụng?)
2. **③ ghi được `main.yml` chưa?** — nếu CÓ mà vẫn timeout (theo turn-active) → **SIZE là nút thắt** →
   leo S2 rồi S3. Nếu ghi xong trong budget → **S1 là đủ**, đóng spec.
Đây là bước quyết định có cần S2/S3 hay không — **không đoán, đo bằng số**.

### 6.1 Kết quả đo — run `ng_quy_tr_nh_3` (`.runs/1785818045468`, 2026-08-04)
Re-fire sau S0 + S1a/b/c. **S1 THÀNH CÔNG — thrash HẾT, nút thắt CHUYỂN sang SIZE:**
- ③ transcript: **không còn** grep fail-branch / marketplace-denied / pipe. Nó Read `edge_types.md` +
  `tool-catalog.json` (×3), `--dump-schema` chạy trần, và **dựng được `main.yml` 29 node / 37 edge CÓ
  `error_strategy`+fail-branch**.
- 3 linter trên file giao ra: `validate/lint_refs/lint_plugin_hashes = 0/0/0` (**SẠCH**).
- Timing: ① 145s · ② 179s · ③ **đúng 600.7s** (cap sạch, không host-sleep lần này) → timeout thuần do
  build 29-node + vòng lint-fix nhỉnh quá 600s. ⇒ **nút (b) SIZE XÁC NHẬN; nút (a) đã đóng.**
- Đồng thời phơi bày nút (c): file **đã sạch** bị `turnNote` timeout ném vào HARD error → Retry lại từ đầu.

**Quyết định:** bật **S2 (900s)** — build đã sạch ở 600s nên biên 900s gần chắc đủ; **S4 (salvage) ĐÃ LÀM**
để không vứt file gần-xong; **S3 HOÃN** (build vừa ~600s công thật, chưa cần A/B).

### 6.2 Re-fire #3 — run `ng_quy_tr_nh_4` (task 1785821908935, 2026-08-04) — ĐÓNG VÒNG ✅
Sau khi bật **S2 (900s code default)**: build **`done`, gate flag None** (clean, không still_failing).
③ Implement = **622s** (vượt cap cũ 600s → 900s cứu). Workflow 23 node/24 edge, **4× fail-branch +
error_strategy**, lint **0/0/0**, report "passed every automated check". Không cần S4 lần này (không
timeout) nhưng S4 vẫn là lưới cho build lớn hơn. ⇒ **chuỗi S1→S2(→S4) giải xong bài timeout ③** cho ca
Chatwork; S3 không cần.

## 7. Guard / test phải xanh
- S0: `RunEventKind` union + case `flowLines` — suite server (`node --test`) xanh, đặc biệt `dossier.test.ts`.
- S1a: chỉ prompt → không phá test nào. `phase-doc-links` vẫn xanh (đường dẫn mới viết dạng code-path,
  không markdown relative-link).
- S1b: `permission-gate.test.ts` thêm case (allow `marketplace.py resolve …`, deny `marketplace.py tools`/
  `catalog`, deny khi có pipe) + toàn suite xanh.
- S1c: file mới phải pass `validate_workflow.py` + `lint_refs.py` + `lint_node_bodies.py` +
  `lint_plugin_hashes.py`; KHÔNG đụng `templates/patterns/index.json` (nằm ngoài patterns/).
- S2: chỉ env → không test.
- S3 (nếu làm): test phase-flow (`post-turn-multi-lint.test.ts`, gate/advance) phải cập nhật có chủ đích —
  đổi hợp đồng "1 turn" thành "A→B".

## 8. Rủi ro đã biết (cập nhật v2)
- **T2 "backend pre-resolve plugin" đã LOẠI**: plugin đã có trong catalog + `analyze.json` không mang field
  plugins → pre-resolve từ analyze bất khả thi; phần hành-vi gộp vào S1a(b), phần sandbox tách thành S1b.
- ~~S1 trao NGỮ PHÁP, không trao MẪU chạy được~~ → **S1c giải**. Rủi ro còn lại: ví dụ didactic lệch schema
  tương lai → buộc lint-clean cả 4 linter ngay khi tạo (và mỗi lần đổi schema, linter fail sẽ lộ).
- **S1b mở network call trong turn** (marketplace API chậm thì đốt budget): chấp nhận — chỉ là fallback khi
  catalog thiếu, read-only, client python có timeout riêng; theo dõi qua transcript nếu thấy chậm.
- **S1 không đảm bảo hết timeout** nếu build vốn quá lớn (nút (b)) — chỉ re-fire mới lộ; sẵn sàng S2/S3.
- **edge_types.md một phần lỗi thời** → S1a phải trỏ đúng section, không cả file.
- **Total-loss-on-timeout** chỉ S3 giải; S1/S2 không đụng.
- **Observability**: S0 giải phần turn-active; "denied-call giảm" vẫn phải đọc transcript tay
  (hoặc dùng `denied_calls_max` của e2e-suite cho entry này).

## 9. Open questions
1. **Ngưỡng "build lớn"** cho định tuyến S3 — node-count bao nhiêu? (lấy từ SPEC hay đếm sau khi dựng khung?)
2. ~~Pattern mẫu `error_strategy`~~ → **PROMOTED thành S1c** (v2).
3. **Backend `{{SCHEMA_REFS}}` (deterministic inject edge_types.md)** — chỉ cân nhắc nếu S1 guidance tỏ ra
   không ổn định qua nhiều run; chấp nhận over-injection (code 59% build) + cần test. Mặc định KHÔNG làm.
4. **(MỚI v2) Nguồn gap ~13 phút** — S0 đo; nếu tái hiện mà không giải thích được bằng host-sleep → spec
   riêng (không kéo dài spec này).

## 10. Non-goals (KHÔNG làm trong spec này)
- **Chuyển `verifyPhase`/lint sang ④** — nó là lưới an toàn ngoài-budget, không phải nút thắt; chuyển đi
  vừa vô ích cho timeout vừa mất tầng bảo vệ.
- **Bỏ vòng cap-5 lint→fix** — fix-work load-bearing cho chất lượng; bỏ = ship YAML hỏng.
- **Nới sandbox cho pipe/grep/`| head`** — spec này chọn dạy agent tránh, rẻ hơn và an toàn hơn. (S1b
  KHÔNG phải nới sandbox: nó sửa một bug enumeration cho đúng lệnh mà phase-doc đã chỉ dẫn từ trước —
  allow-set tự định nghĩa là "enumerated from the 4 phase .md".)
- **Thêm feature `error_strategy` vào index/find.py** — S1c trao ví dụ bằng con đường deterministic
  (đích danh trong implement.md), không cần đụng indexer; chỉ xét lại nếu §6 cho thấy agent vẫn đi tìm.
