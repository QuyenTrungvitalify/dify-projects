# Spec 019 — Implementation plan (từng bước, review-oriented)

**Companion to** [019](019-builder-output-quality-and-lean-roadmap.md). Status: Draft.
**Mục tiêu của file này:** biến §Sequencing của 019 thành các **PR bounded, review được từng commit**.
Mỗi *Bước* = 1 PR = 1 đơn vị review; mỗi *Step* trong PR = 1 commit nguyên tử, tự review được.

> **Quy ước.** Mỗi step ghi rõ: **File** · **Change** · **Test** · **Review-focus** (điều reviewer phải xác minh).
> Cuối mỗi PR có **Exit gate** (định nghĩa "xong") map thẳng về số AC của 019. Không có thay đổi hành vi nào
> được merge mà thiếu test pin hành vi (§3.3 của 019). Refactor gate trên *suite xanh hai phía* (§3.4).

## Lệnh chuẩn (chạy trước/sau mỗi step)

| Việc | Lệnh | Thư mục |
|---|---|---|
| Typecheck server | `npm run typecheck` (`tsc --noEmit -p tsconfig.test.json`) | `apps/builder` |
| **Server suite** | `npm test` (`node --import tsx --test "test/**/*.test.ts"`) | `apps/builder` |
| **Web suite** | `npm test` (`vitest run`) | `apps/builder/web` |
| Linter warn-only (O1/O4) | `python3 tools/dify_base/lint_refs.py --check-reachability <file>` | repo root |
| Pre-commit (gate cuối O1/O4) | `pre-commit run --all-files` | repo root |
| CI mirror | `.github/workflows/ci.yml` (server `node --test` + web `vitest`) | — |

**Đo "surface" cho mọi linter mới (§3.1):** corpus **46** · `templates/{patterns,probes}` **7** · `projects/*/workflows` **20** = **73 file**.

## Review map — nhìn 1 bảng biết PR nào đụng gì

| PR | Items | Files chính | Test thêm/sửa | AC 019 | Observable? |
|---|---|---|---|---|---|
| **1 · dọn nhà** 🟢 | L1, L3, L5a, L6, C2, C3 | index.ts, types.ts, diff-parser.ts, Icon, 009.md, store.ts | `store.test.ts` (C2) | AC1 | Chỉ nếu kèm L5c |
| **1b · L5c (tuỳ chọn)** 🟢→🟡 | L5c | Modal.tsx, App.tsx, types.ts(FolderEntry) | — | AC1 | **Có** (nút "New Project" biến mất) |
| **2 · correctness** 🟡 | C1, C4, L4, L5b | store.ts, sse.ts, index.ts, diff.ts | store.test.ts, sse-replay (mới), boot-hook (mới), xoá diff-shortcircuit.test.ts | AC2 | Không |
| **3 · refactor** 🟠 | L2 | orchestrator.ts → scaffold.ts + import.ts | (không thêm; suite hiện có là lưới) | AC3 | Không |
| **4 · output quality** 🟠 | O2 → O1 → O4 | analyze prompt, lint_refs.py, linters.ts, schema | golden-build, linters.test.ts, + đo FP report | AC4–6 | Tại Implement (mới có cảnh báo) |
| **5 · opt-in** 🟠 | O3 | phases/claude-session/orchestrator + config | golden-build (default bất biến) | AC7 | Không (default = hôm nay) |

---

## Bước 1 — PR "dọn nhà" 🟢 (zero-disruption)

**Deliver:** L1 + L3 + L5a + L6 + C2 + C3. **Lưới an toàn:** `tsc` + cả hai suite. **Không thay đổi hành vi người dùng thấy được** (L5c tách riêng ở 1b).

**Pre-flight:** branch từ `main`; chạy server+web suite cho xanh để có baseline.

| # | id | File | Change | Test | Review-focus |
|---|---|---|---|---|---|
| 1.1 | **L1** | [index.ts:143](../../apps/builder/server/index.ts#L143) | **Hard-gate** `/api/dev/run-implement` bằng `if (turnBusy()) return reply.code(409)...` (giữ smoke-path, đóng lỗ 1-writer). KHÔNG xoá endpoint. | — (đường dev, không có code caller) | Gate đặt **trước** mọi spawn; tái dùng `turnBusyError()` shape như [tasks.ts:142](../../apps/builder/server/routes/tasks.ts#L142). Không đụng 4 doc-ref (giữ smoke path ⇒ doc còn đúng). |
| 1.2 | **L3** | [types.ts](../../apps/builder/web/src/types.ts) | Xoá **dead presentational types** trong dải ~L115–234. **GIỮ:** `FileChange`(L99) `PhaseKey`(L109) `PhaseState`(L110) `PhaseStates`(L111) `ArtifactTab`(L113) **`Settings`(L126)**. Bỏ: `GateKey, Scenario, Crumb, TreeTask/Workflow/Project, Phase, RunDetail, GateAction, GateStrip, Gate, Linter, DiffCell, DiffRow, ReportRow, YamlSeg, YamlLine, ThreadItem, ThreadInput, GateItem`. | `tsc` là test | **Xoá phẫu thuật, không cắt nguyên dải** — `Settings`(L126) nằm GIỮA block. `Gate`/`Phase` "consumer" chỉ là comment/string ⇒ thật sự dead (đã verify). **`FolderEntry`(L236) giữ lại** đến khi 1b xoá `CreateProjectModal` (type-trước-consumer vỡ `tsc`). |
| 1.3 | **L5a** | [diff-parser.ts:116](../../apps/builder/web/src/lib/diff-parser.ts#L116) + Icon glyphs | Xoá `export function buildUnifiedRows` (0 caller) + các glyph `Icon` không dùng. | `tsc` + web suite | Confirm 0 caller (`grep buildUnifiedRows`). Glyph: chỉ bỏ cái grep ra 0 ref. Không đụng `diff-parser.test.ts` còn lại. |
| 1.4 | **L6** | [009-browser-workflow-builder.md](009-browser-workflow-builder.md) | Xoá thân §E đã bị thay (model `--allowedTools` + allowlist cũ còn liệt kê `sync.py`). | — (docs) | Chỉ xoá phần banner-marked superseded; không đụng phần §E còn sống. |
| 1.5 | **C2** | [store.ts:488](../../apps/builder/web/src/store.ts#L488) `resetToNew` | Thêm `_appliedTaskId = null; _appliedRev = -1;` vào `resetToNew`. | **+1 test** `store.test.ts`: reset → mở lại task → thread KHÔNG blank. | 1 dòng. Test phải tái hiện bug "blank thread khi re-open sau reset". |
| 1.6 | **C3** | [store.ts:466](../../apps/builder/web/src/store.ts#L466) `saveSpec` | Bọc body trong `try/catch`, `catch (e) { surfaceError(e); }` (giống `openTask` L482). | — (additive, không đổi happy-path) | Hiện `saveSpec` **không** có error feedback (đã verify) ⇒ PUT fail chết im. Chỉ thêm catch, không đổi return type. |

**Exit gate (→ AC1):** server+web suite xanh; `tsc` xanh; diff không có thay đổi hành vi người dùng thấy; `Settings` còn nguyên; 009 §E đã dọn; `resetToNew` reset 2 biến; `saveSpec` surface lỗi.

**Reviewer checklist:**
- [ ] `grep -rn "buildUnifiedRows\|: Gate\b\|: Phase\b" apps/builder/web/src` ⇒ 0 (ngoài comment).
- [ ] `Settings`, `FileChange`, `Phase*`, `ArtifactTab`, `FolderEntry` vẫn export.
- [ ] L1: thử 2 lần `curl POST /api/dev/run-implement` liên tiếp ⇒ lần 2 trả 409.
- [ ] C2 test đỏ trước fix, xanh sau fix.

---

## Bước 1b — L5c (TUỲ CHỌN, observable) 🟢→🟡

> Tách riêng vì đây là **thay đổi người dùng thấy được duy nhất** của Tier 0 (nút "New Project" no-op biến mất).
> Lấy nếu muốn dọn sạch; **defer** nếu muốn PR1 giữ "zero observable diff".

| # | id | File | Change | Review-focus |
|---|---|---|---|---|
| 1b.1 | **L5c** | [Modal.tsx](../../apps/builder/web/src/components/Modal.tsx) | Xoá `CreateProjectModal` + `FOLDER_POOL` mock. | Modal **đang được render** ([App.tsx:325](../../apps/builder/web/src/components/App.tsx#L325)) — không phải dead. |
| 1b.2 | — | [App.tsx:13,325](../../apps/builder/web/src/components/App.tsx#L13) | Xoá import + JSX render + trigger nút. | Đảm bảo không còn ref đến `CreateProjectModal`/`onCreate`. |
| 1b.3 | — | [types.ts:236](../../apps/builder/web/src/types.ts#L236) | Xoá `FolderEntry` (giờ mới dead, sau khi consumer đi). | **Thứ tự bắt buộc:** modal trước → `FolderEntry` sau. |

**Exit gate:** web suite + `tsc` xanh; nút "New Project" biến mất là diff duy nhất. Wiring modal = feature mới = **out of scope**.

---

## Bước 2 — Correctness 🟡 (+1 test mỗi item)

**Deliver:** C1 + C4 + L4 + L5b. Mỗi item chạm 1 live path ⇒ bắt buộc 1 test pin hành vi.

| # | id | File | Change | Test (bắt buộc) | Review-focus |
|---|---|---|---|---|---|
| 2.1 | **C1** | [store.ts:240](../../apps/builder/web/src/store.ts#L240) `flushPendingOutput` | Buffer-key theo phase; **không** `clear()` một phase không có live target (chống straggler sau transition). | **+1** `store.test.ts`: text đến *sau* run→gate ⇒ không mất, không double-append. | Đây là path **mất dữ liệu im lặng** duy nhất. Làm sai → double-append. Test phải cover cả 2 hướng. |
| 2.2 | **C4** | [sse.ts:227](../../apps/builder/server/plugins/sse.ts#L227) | `init` dùng id **mới tăng**, không tái dùng `sse.eventCounter` cũ. | **+1** test reconnect-replay (mới): id của `init` > id event cuối được replay. | Off-by-one ngay AC #22 của 009 dựa vào. Confirm `broadcast` tăng counter, `init` hiện đọc getter (không tăng). |
| 2.3 | **L4** | [index.ts](../../apps/builder/server/index.ts) `start()` | Boot-time spawn-smoke hook permission (mirror đúng cách Claude Code gọi); **warn loud** nếu không load được (v1 chấp nhận warn-not-fail). | **+1** boot-assertion test (mới): hook unloadable ⇒ warn/refuse. | Item security DUY NHẤT — sandbox **fail OPEN** nếu host Node < 22.6 không chạy được `.ts` hook. Mirror invocation thật để tránh false-refuse. |
| 2.4 | **L5b** | [diff.ts:103-132](../../apps/builder/server/lib/diff.ts#L103) | Xoá short-circuit hash + sidecar `diff.hash`. | **Xoá** [diff-shortcircuit.test.ts](../../apps/builder/test/diff-shortcircuit.test.ts) (test cho hành vi vừa bỏ). | Hành vi sau = 1 spawn `difflib` thừa (chậm hơn, **không bao giờ sai**). Đảm bảo `diff.json` `{path,diff}` wire-shape không đổi. |

**Exit gate (→ AC2):** không mất streamed-output ở run→gate; `init` replay id đúng; boot warn/refuse khi hook unloadable; sidecar hash đã bỏ. 4 test mới/sửa xanh; cả suite xanh.

**Reviewer checklist:**
- [ ] Mỗi test 2.1–2.3 **đỏ trước, xanh sau** (revert change ⇒ test fail).
- [ ] 2.4: `grep -rn "diff.hash" apps/builder/server` ⇒ 0.
- [ ] L4 không false-refuse trên Node ≥ 22.6 (chạy boot thật 1 lần).

---

## Bước 3 — Refactor L2 🟠 (load-bearing, gate trên suite xanh 2 phía)

**Deliver:** tách scaffold/import/slug IO khỏi [orchestrator.ts](../../apps/builder/server/lib/orchestrator.ts) (930 LOC) → `lib/scaffold.ts` + `lib/import.ts`. Mục tiêu orchestrator **< ~400 LOC** (kỳ vọng ~350).

> **⚠️ Điều chỉnh so với 019:** AC gốc nói *"byte-identical bodies"*. Thực tế các hàm cần tách **đã nhận `(task, ctx)`**
> (không đóng kín state module) — extraction khả thi — **nhưng** chúng gọi 3 helper private `emit` / `errMsg` / `httpError`
> (33 call-site). Tách ra buộc các helper này phải export/inject ⇒ **không thể byte-identical tuyệt đối**.
> **Tiêu chí review đổi thành: *behavior-preserving + cả suite xanh trước VÀ sau*** (đề xuất đưa vào AC3 khi approve).

**Thứ tự (mỗi step giữ suite xanh):**

| # | Change | Chi tiết | Review-focus |
|---|---|---|---|
| 3.1 | Tạo `lib/orchestrator-shared.ts` | Move/export `emit`([:83](../../apps/builder/server/lib/orchestrator.ts#L83)), `errMsg`([:108](../../apps/builder/server/lib/orchestrator.ts#L108)), `httpError`([:926](../../apps/builder/server/lib/orchestrator.ts#L926)) + các type `OrchestratorCtx/Runners`. | Đây là bước **rủi ro nhất**: 33 call-site phải re-import. Chạy suite ngay sau 3.1, **trước** khi move logic. |
| 3.2 | Tạo `lib/slug.ts` (hoặc gộp scaffold) | Move `deriveSlugName`([:884](../../apps/builder/server/lib/orchestrator.ts#L884)) + `firstFreeSlug`([:912](../../apps/builder/server/lib/orchestrator.ts#L912)). Đã có [slug.test.ts](../../apps/builder/test/slug.test.ts) cover. | Pure functions, ít phụ thuộc nhất ⇒ move trước. `slug.test.ts` phải xanh không sửa. |
| 3.3 | Tạo `lib/scaffold.ts` | Move `difySeedScaffoldAndPull`([:152](../../apps/builder/server/lib/orchestrator.ts#L152)), `localEditSeed`([:230](../../apps/builder/server/lib/orchestrator.ts#L230)), `scaffoldAtSpecGate`([:777](../../apps/builder/server/lib/orchestrator.ts#L777)), `relocateRunArtifacts`([:862](../../apps/builder/server/lib/orchestrator.ts#L862)). | Body **không sửa logic**, chỉ đổi import. Suite: golden-build, edit-existing, restore, recovery phải xanh. |
| 3.4 | Tạo `lib/import.ts` | Move `runImportAndFinish`([:668](../../apps/builder/server/lib/orchestrator.ts#L668)), `finishWithoutImport`([:755](../../apps/builder/server/lib/orchestrator.ts#L755)). | orchestrator giờ chỉ giữ FSM gate (`startTask`/`confirmAdvance`/`runPhase`/`gateAfterPhase`/`maybeAutoAdvance`). |
| 3.5 | Đếm LOC + chạy full suite | `wc -l orchestrator.ts` < ~400. | **Diff phải đọc được như "cut/paste + đổi import"** — reviewer reject nếu thấy logic đổi. |

**Exit gate (→ AC3):** orchestrator < ~400 LOC; **full suite xanh trước+sau** (golden-build, advance-loop, auto-advance, gate, confinement, restore, recovery, lock); zero behavior diff.

**Reviewer checklist:**
- [ ] `git log -p` từng commit: 3.2–3.4 mỗi cái = "move 1 nhóm hàm + sửa import", không có dòng logic mới.
- [ ] So sánh output golden-build trước/sau (byte-identical artifact).
- [ ] Không thêm `try/catch`, không đổi thứ tự `await` trong các body đã move.

---

## Bước 4 — Output quality 🟠 (warn-only → đo → promote)

**Thứ tự bắt buộc:** O2 (rẻ nhất, mở khoá diff pattern) → O1 (lever cao nhất) → O4. **Không item nào gate build cho tới khi báo cáo FP sạch (§3.1).**

### 4A — O2: persist + verify pattern (advisory)

> **Scope thật (đã verify):** [analyze prompt](../../.claude/skills/dify-build/analyze.md) hiện **KHÔNG** ghi feature-set; [implement.md:24](../../.claude/skills/dify-build/implement.md) chỉ bảo "pick the pattern" không ràng buộc/lưu. ⇒ O2 **bao gồm** việc dạy Analyze ghi feature-set. Đề xuất sửa effort S→S-M.

| # | Change | File | Review-focus |
|---|---|---|---|
| 4A.1 | Analyze ghi `features: []` + `pattern` + `find_query` vào `analyze.json` (optional field, §3.2) | analyze prompt + schema | Tái dùng đúng vocabulary `find.py --has`: `iteration, loop, code, llm, http-request, tool, if-else, document-extractor, knowledge-retrieval, agent, file-input, template-transform, parameter-extractor`. Old `.runs/` thiếu field vẫn load (back-compat). |
| 4A.2 | Persist pattern đã chọn lên task; hiện ở gate | orchestrator + task schema | Field optional; reconcile run cũ không có. |
| 4A.3 | Assert `features(pattern) ⊇ features(analyze.json)` → **surfaced advisory**, KHÔNG hard-fail | orchestrator/linters | v1: chỉ cảnh báo. Build không fail vì sai pattern. |

**Exit gate (→ AC5):** pattern persisted + visible tại gate; pattern thiếu feature ⇒ advisory (không hard-fail). +1 test golden-build cho field optional.

### 4B — O1: graph-reachability trong `lint_refs.py` (3 phase §3.1)

> **⚠️ Điều chỉnh: đề xuất effort M→L** và (theo Q3) **tách thành spec con** vì blast-radius 73 file. BFS reachability trên graph Dify nhiều ngoại lệ.

**Pre-work (làm TRƯỚC khi code BFS) — danh sách loại trừ để không ngập FP:**
- Selector **không phải node-output**: `sys.*`, `env.*`, `conversation.*` ⇒ skip khỏi reachability.
- Node trong container: child của `iteration`/`loop` (id `<iter>start`), `iteration-start`/`loop-start`.
- Nhánh: `if-else` case handle, parallel branches, `variable-aggregator`/`answer` ref chéo nhánh.
- Node-type chưa model output: đối chiếu `IMPLICIT_OUTPUTS` (llm, http-request, tool, document-extractor, knowledge-retrieval, question-classifier, agent, template-transform, list-operator) + `KNOWN_NODE_TYPES`.

| # | Phase | Change | Review-focus |
|---|---|---|---|
| 4B.1 | (1) warn-only | Thêm flag `--check-reachability`: BFS xác minh mọi `{{#id.field#}}` / `value_selector` source **upstream-reachable**; **print nhưng exit 0**. | Không đụng [linters.ts](../../apps/builder/server/lib/linters.ts) `lintClean` ở phase này. Không đụng pre-commit. |
| 4B.2 | (2) đo | Chạy trên **73 file** (corpus 46 + patterns/probes 7 + projects 20); xuất **báo cáo FP**. Fix/whitelist: unmodeled output ⇒ mở rộng `IMPLICIT_OUTPUTS` (Q1: extend incrementally, whitelist chỉ cái corpus thật trip). | Báo cáo FP phải **đính kèm PR** và **= 0** trước khi sang 4B.3. Đây là artifact review chính. |
| 4B.3 | (3) promote | Fold vào `lintClean` + [pre-commit](../../.pre-commit-config.yaml) **chỉ sau khi** báo cáo sạch. | Gate trên `templates/(patterns\|probes)` + `projects/*/workflows` — promote sớm là vỡ pattern đã vet + project đã commit. |

**Exit gate (→ AC4):** check tồn tại, chạy **warn-only**; báo cáo FP trên 73 file = sạch; promote vào `lintClean`+pre-commit *sau đó*; workflow có downstream-only ref **bị bắt tại Implement**, không phải tại Dify import.

### 4C — O4: custom-path graph smoke (cùng quy trình O1)

| # | Phase | Change | Review-focus |
|---|---|---|---|
| 4C.1 | warn-only | Check start→end connectivity, no orphan node / dangling handle (extend `validate_workflow.py` hoặc linter mới). | Nhắm class "qua 3 linter cấu trúc nhưng branch sai" ([implement.md:34-40](../../.claude/skills/dify-build/implement.md)). |
| 4C.2 | đo → promote | Báo cáo FP trên cùng 73-file surface; promote chỉ khi sạch. | Cùng dis:cipline §3.1 như O1. |

**Exit gate (→ AC6):** smoke check warn-only trước; báo cáo FP sạch; from-scratch graph có orphan **bắt tại Implement**.

---

## Bước 5 — O3 model-tier opt-in 🟠 (có thể defer, không chặn 019)

| # | Change | File | Review-focus |
|---|---|---|---|
| 5.1 | Per-phase model override, **default = hành vi hôm nay** (§3.5) | phases/claude-session/orchestrator + config | Override là **config, không phải default ép**. **Tra [claude-api skill] cho model id/pricing — KHÔNG đoán** (Q2). Ship Implement-only override trước. |
| 5.2 | Đo trên vài build thật trước khi flip default | — | Soft-gate; chấp nhận cho tool solo. |

**Exit gate (→ AC7):** per-phase tier opt-in, default = hôm nay; golden-build xanh không đổi (default bất biến). Defer được mà không chặn 019.

---

## Tổng kết tracking (Q3 của 019)

Mỗi **Bước = 1 changelog entry** dưới spec 019, **không tách spec con** — TRỪ **O1 (4B)** nên có spec follow-up riêng do blast-radius 73 file. AC8 (no-regression) được bảo đảm bởi discipline §3, kiểm bằng cả suite xanh ở mọi Bước.

| Bước | Disruption | Test-gate | Có thể merge độc lập? |
|---|---|---|---|
| 1 (+1b tuỳ chọn) | 🟢 | tsc + 2 suite | Có |
| 2 | 🟡 | +4 test | Có (sau 1) |
| 3 (L2) | 🟠 | suite xanh 2 phía | Có (sau 2, độc lập 4) |
| 4 (O2→O1→O4) | 🟠 | FP report sạch | O2 độc lập; O1/O4 cần warn-only window |
| 5 (O3) | 🟠 | golden-build default bất biến | Defer được |
