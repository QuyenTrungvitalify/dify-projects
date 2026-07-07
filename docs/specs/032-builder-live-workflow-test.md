# Spec 032 — Builder Phase ④ live workflow test (import → auto-fix → run → verify, interactive)

**Status**: Draft — **Q1–Q7 đã chốt (2026-07-03)**; hạ tầng đã **verify thật** trên Dify self-host; **review vận hành xong** → cơ chế + hardening chốt ở **§S0.5** (A1–A5 kiến trúc, B1–B5 + C vận hành). Sẵn sàng implement theo S1→S7.
**Effort**: M–L (giảm sau khi chốt D5 đơn giản hoá) — không có blocker kỹ thuật (mọi API đã thử thật), chi phí nằm ở: (1) mở rộng Phase ④ backend thành một sub-orchestrator có vòng lặp confirm, (2) thêm 1 skill judge + 1 skill diagnosis (data-only), (3) cho Spec ② sinh **Acceptance Criteria**. *(Bỏ được draft-patch + `hash`-lock + reuse-marker nhờ D5: chấp nhận app-mới-mỗi-lần-có-confirm + inject model vào bản deploy tạm.)*

**Builds on**:
- [009](009-browser-workflow-builder.md) — gate FSM, `④` là **backend** (không turn), AC #16 (selfhost Import gate).
- [015](015-builder-security-turn-sandbox.md) — **ràng buộc load-bearing**: `claude-session.ts` strip mọi `DIFY_*` khỏi env turn ⇒ *không thứ gì chạm creds Dify được phép là một turn/skill*.
- [021](021-builder-e2e-live-run-verification.md) — cơ chế live-run (import/run). **021 là lưới QA/CI opt-in; 032 là feature trong-sản-phẩm.** 032 hiện thực hoá đúng **021 Q1(b)** (mint app key qua Console API) — xem §Verified.
- [019](019-builder-output-quality-and-lean-roadmap.md) §3 — kỷ luật additive/no-disruption.
- [005](005-qa-strategy.md) Tier 3 — chiến lược verification (import canary + live run).

**Depends on**: không thêm gì mới. Console admin creds đã có trong `apps/builder/.env` (`DIFY_CONSOLE_URL` + `DIFY_CONSOLE_TOKEN` admin-key + `DIFY_WORKSPACE_ID`). Không đổi gate FSM, không đổi permission-gate hook, không đổi validators.

---

## Verified (đã thử thật trên Dify self-host `localhost:8090`, 2026-07-03)

Đây là các fact khoá — thiết kế đứng trên chúng, không phải giả định:

| Bước | Endpoint | Kết quả thật |
|---|---|---|
| List apps | `sync.py list` (Console) | ✅ trả app id/mode/name |
| Pull nested (spec 030) | `sync.py pull --project X --workflow Y` | ✅ file về đúng `projects/X/Y/workflows/` |
| **Mint app key** (021 Q1b) | `POST /console/api/apps/{id}/api-keys` | ✅ **201** `{token: "app-…"}` |
| Đọc model đang bật | `GET /console/api/workspaces/current/models/model-types/llm` | ✅ list provider+models |
| Đọc system default | `GET /console/api/workspaces/current/default-model?model_type=llm` | ✅ (self-host này đang trả `gpt-4` — **không tồn tại** trong provider) |
| Sửa draft (model) | `GET`→patch→`POST /console/api/apps/{id}/workflows/draft` (kèm `hash`) | ✅ **200** (thiếu `hash` → **409**) — *verified nhưng D5 KHÔNG dùng; thay bằng inject-vào-YAML-tạm* |
| Publish | `POST /console/api/apps/{id}/workflows/publish` | ✅ 200 (import không auto-publish → cần call này) |
| **Run** | `POST {base}/v1/workflows/run` (app key) | ✅ **200** `status: succeeded`, ra output thật (196 tokens, 1.72s) |

**Hai lỗi thật đã quan sát** (chính là lý do cần auto-fix):
1. LLM node builder sinh ra để **model rỗng** (`{name:"", provider:""}`) → run fail `"Model not exist"`. Node model **không** kế thừa system-default lúc runtime.
2. System-default LLM = `gpt-4` nhưng provider chỉ có `gpt-5.x` → default cũng vô hiệu.

---

## Context — vì sao Phase ④ hiện tại chưa đủ

Phase ④ (Test) hôm nay là **backend thuần, static-only**: [report.ts](../../apps/builder/server/lib/report.ts) chạy 3 linter; [import.ts](../../apps/builder/server/lib/import.ts) push selfhost (AC #16). `test.md` chỉ là doc cho CLI, **không** gửi vào turn nào ([phases.ts](../../apps/builder/server/lib/phases.ts): `id:'test', kind:'backend'`).

Hệ quả: builder chứng minh **cấu trúc** (schema/linter/reachability) nhưng **không** chứng minh workflow **chạy được + ra kết quả đúng**. Sau khi import selfhost, user phải vào Dify chọn model tay rồi mới chạy được — đúng ma sát người dùng đang gặp.

**Feature này (mode `live`):** biến ④ (khi user chọn) thành **import → tự sửa vài thứ cơ học (model) → run với input mẫu → verify theo tiêu chí → báo pass/fail; nếu cần người thì park gate trao đổi**. Tất cả phần chạm creds ở backend; LLM chỉ tham gia ở khâu *chấm/chẩn đoán* (data-only).

---

## Design decisions (mặc định đã đề xuất — chốt trước khi implement)

- **D1 · Hai test mode + HAI cách kích hoạt.** `static` (hiện tại, mặc định, luôn an toàn, không chạm Dify) và `live` (chạy workflow thật). `live` **chỉ khả dụng khi `deploy = selfhost`** + có console creds (cloud chặn auto-import CSRF; `none` không có app).
  - **(a) Nút ở Implement gate (③) — cho `each_step`/`spec_only`:** cạnh **"Continue to Test"** (static như hôm nay) thêm **"Test với workflow"** (`test_live`). User bấm cái nào là chọn mode cho lần đó. *(chính là nút bạn yêu cầu trong screenshot ③ gate.)*
  - **(b) Chip `testMode` ở composer — cho `auto`:** vì `auto` không có gate để bấm, chip start-bound (`static|live`) quyết trước. Với `each_step`/`spec_only` chip chỉ set **nút mặc định** (primary), vẫn bấm nút kia được.
- **D1b · `auto` + `live` = FULL hands-free (locked, A).** Chọn `auto` + `selfhost` + `live` là **opt-in 3 lớp = đồng ý auto-import** ⇒ ④ tự import→run→verify tới `done` **không dừng**, KHÔNG park Import gate (đây là ngoại lệ có-chủ-đích của [014](014-builder-terminal-correctness-and-state-integrity.md) D1 "deploy luôn confirm" — chỉ cho nhánh live). Report ghi rõ *"đã tạo app X (auto)"*. Operator có thể tắt về "confirm-import-1-lần" bằng env `BUILDER_LIVE_AUTOIMPORT=0`. *`auto` KHÔNG bao giờ báo `done` trên một fail thật (§4b).*
- **D1c · Live-test là BONUS, không phải điểm-vỡ (degrade-to-static).** Nếu live-test **không chạy được vì hạ tầng** (Dify sập / thiếu creds / workspace 0 model / mint|publish|run API lỗi) — KHÔNG phải lỗi workflow — thì **không** fail cả build: report giữ kết quả **static (lint) PASS** + note *"live không chạy được: <lý do>"* và park một confirm **[Thử lại live] [Chấp nhận static] [Bỏ]**. Phân biệt rõ với **workflow-fail thật** (chạy nhưng sai/crash/lệch criteria) → hiện đúng fail ở Test-result gate, KHÔNG che thành static-pass. Report luôn gắn nhãn workflow là **`live-verified`** hay **`static-only`**.
- **D2 · Orchestration live-test = BACKEND, không phải skill (locked, security).** Import, mint key, patch draft, publish, run — mọi thứ chạm `DIFY_*` — chạy trong backend (như report.ts/import.ts). **Không** gói ④ vào một skill. *Lý do:* spec 015 strip `DIFY_*` khỏi turn; một skill giữ creds là lỗ hổng.
- **D3 · LLM chỉ vào ④ ở 2 điểm data-only (locked).** (a) **Judge** — chấm output vs Acceptance Criteria; (b) **Diagnosis** — đọc lỗi run + YAML đề xuất fix. Cả hai chỉ nhận `{requirement, SPEC/criteria, input, output/error}` = DATA (không creds) ⇒ hợp lệ là skill. *Auto-fix cơ học (model) KHÔNG cần LLM* — backend làm thẳng.
- **D4 · Model auto-resolve — deterministic, node-level.** Backend query model đang bật → chọn theo policy → patch **mọi LLM node có model rỗng/không hợp lệ** → publish. Policy mặc định: **dùng system-default nếu hợp lệ, else model "nhẹ" đầu tiên đang bật** (ưu tiên `*-mini`/`*-nano`). *(Open Q: có expose thành setting "Model" ở composer không — Q1.)*
- **D5 · Chấp nhận app-trùng, nhưng re-import phải CONFIRM (locked).** `push` LUÔN tạo app MỚI (hành vi cố hữu của Dify, không update-tại-chỗ). Thay vì reuse-qua-draft-patch (fiddly), ta **chấp nhận mỗi lần test = một import mới**, nhưng **mỗi lần re-test đều park một confirm** ("sẽ tạo app MỚI để test bản fix — OK?") — tái dùng đúng Import gate (AC #16). **Modal confirm có thêm checkbox "🗑 xoá app test cũ"** (Q3): tick ⇒ sau khi tạo app mới, `DELETE` app trước đó (mặc định KHÔNG tick — an toàn). Gate luôn hiển thị `app_url` HIỆN TẠI để human test đúng app mới nhất. *Lý do:* bỏ được draft-patch + `hash`(409) + marker-reuse; giữ Dify sạch tuỳ ý user.
- **D6 · Ground truth = Acceptance Criteria do Spec ② sinh + fixtures.** Spec phase phát ra một **checklist tiêu chí chấp nhận** (vd "≤3 bullet", "đầu ra tiếng Nhật", "phải nhắc X") — hiển thị ở Spec gate cho user duyệt/sửa, và là **rubric** cho judge. Nếu user có `tests/fixtures/` (input→expected) thì **assert cơ học** (đáng tin hơn judge).
- **D7 · Verify 3 tầng, người chốt cuối.** T1 cơ học (backend) → T2 fixture-assert (backend) → T3 judge-vs-criteria (skill, **advisory**) → **gate "Test result"** cho user confirm/reject. Judge **không** là phán quyết; chạy prompt **phản biện** (tìm lỗi), không "xác nhận". **Q2 (locked): T3 chạy MẶC ĐỊNH khi user chọn mode `live`** — bản thân việc chọn "test với workflow" CHÍNH LÀ opt-in; không có toggle judge riêng (v1). `static` không có T3.
- **D8 · Input mẫu để run.** Ưu tiên: (a) `tests/fixtures/`; (b) backend sinh từ start-node schema (text mẫu theo type); (c) hỏi user 1 lần ở gate. Mặc định (a)→(b), fallback (c) khi required-input không suy ra được.
- **D9 · Vòng lặp qua gate FSM sẵn có, không cơ chế mới.** "trao đổi → test → báo kết quả" = tái dùng `awaiting_confirm` + `/reply`. Không thêm state machine.

---

## Goals

1. **Phase ④ `live`**: khi user chọn (selfhost), backend **import → auto-fix model → run với input mẫu → verify → report** một cách tự động; app chạy được ngay mà **YAML on-disk vẫn workspace-agnostic**.
2. **Ground-truth thật**: Spec ② sinh Acceptance Criteria; ④ verify theo checklist + fixtures, không "đoán mò".
3. **Người là người chốt**: mọi verdict (kể cả judge) hiển thị ở gate; user confirm/reject/điều chỉnh; không auto-pass thầm.
4. **An toàn**: không thứ nào chạm creds Dify rời khỏi backend (spec 015 giữ nguyên).
5. **Sạch**: test lặp không đẻ app trùng; dọn state khi xong.

## Non-goals (ranh giới lean)

- **Không** đưa live-test vào CI mặc định — đó là địa hạt 021 (opt-in runner). 032 là feature runtime của app.
- **Không** auto-fix lỗi *ngữ nghĩa* (prompt/logic sai) — cái đó diagnosis-turn *đề xuất*, người duyệt, không tự sửa thầm.
- **Không** hỗ trợ `cloud` live-test (CSRF) — cloud vẫn emit YAML + hướng dẫn thủ công như AC #9.
- **Không** đổi mode `static` mặc định — build cũ/không-creds vẫn chạy y như cũ.
- **Không** tự tạo `tests/fixtures/` — chỉ *dùng* nếu có.

---

## Design

### §1 · Test mode + wire
- Task thêm `testMode: 'static' | 'live'` (mặc định `static`; back-compat: absent ⇒ static). Force `static` khi `deploy !== 'selfhost'` hoặc thiếu creds.
- Composer: 1 chip setting **"Test"** (`static | live`), disabled khi deploy≠selfhost. Start-bound (như deploy).
- `live` **không** thay AC #16: vẫn park Import gate; khác ở chỗ sau import chạy thêm auto-fix + run + verify.

### §2 · Model auto-resolve (backend, deterministic) — inject vào bản deploy tạm
Helper mới trong [dify-io.ts](../../apps/builder/server/lib/dify-io.ts) (giữ creds ở backend). **Không** dùng draft-patch (D5 đã bỏ) — sửa model bằng cách inject vào **1 bản YAML tạm** trước khi push:
```
resolveDefaultLlmModel(): {provider, name} | null
   ← GET /workspaces/current/models/model-types/llm       (model đang bật)
   ← GET /workspaces/current/default-model?model_type=llm  (system default)
   pick = default nếu default ∈ enabled, else first enabled (ưu tiên *-mini/*-nano)

deployWithModel(project, workflow, model):
   đọc projects/<p>/<w>/workflows/main.yml → parse
   → set model cho mọi llm node có {name:''} hoặc name∉enabled
   → ghi .runs/<taskId>/deploy.yml   (main.yml on-disk KHÔNG đổi — giữ portable)
   → importForTest(.runs/<taskId>/deploy.yml) → app_id        (A2: push fresh, --json-out, KHÔNG push_intent; append test_apps.json)
   → POST /apps/{app_id}/workflows/publish                    (1 call, không cần hash)
```
Ghi vào report: `model_autofilled: {node_count, model}` để user biết đã tự điền gì (advisory, giống `slugNote`/`importNote`). Không LLM node rỗng ⇒ bỏ qua bước inject, push `main.yml` như thường.

### §3 · Acceptance Criteria (Spec ② sinh) — spec.md + report
- [spec.md](../../.claude/skills/dify-build/spec.md): thêm mục **"Acceptance Criteria"** trong SPEC.md — 3–7 tiêu chí *kiểm được*, mỗi cái 1 dòng, ưu tiên có thể verify khách quan (format/độ dài/ngôn ngữ/phải-nhắc-gì/output-shape). Ngôn ngữ theo requirement (spec 030-content-lang).
- Hiển thị ở **Spec gate** → user duyệt/sửa (đây là hợp đồng "đúng nghĩa là gì").
- Là **rubric** cho judge (§4 T3). Không có mục này ⇒ judge chỉ chấm chủ quan (yếu) ⇒ T3 hạ xuống advisory-thấp.

### §4 · Verify 3 tầng
```
import/publish/run ─▶ gọi được Dify?
   │ KHÔNG (down/creds/0-model/API lỗi) → verdict=infra_fail → degrade-to-static (§5, D1c)
   │ CÓ
run xong ─▶ T1 backend: status=succeeded & không error & output var tồn tại+non-empty
                 │ fail (status=failed / node crash / rỗng) → verdict=workflow_fail (§5, không che)
           T2 backend: có tests/fixtures/? assert expected (exact|contains|regex|json-shape)
                 │ fail → verdict=assertion_fail (diff expected/actual)
           T3 skill (nếu có criteria): judge output vs Acceptance Criteria
                 → verdict per-criterion {pass/fail + bằng chứng}  (ADVISORY)
                 (panel N=1 v1, có thể nâng majority; prompt adversarial "tìm lỗi")
           ─▶ gate "Test result": {output, model_autofilled, T1/T2/T3 verdict, nhãn live-verified} → user
```
- Judge skill = data-only turn (SPEC/criteria + input + output). **Không** creds. Trả `verdict.json` có cấu trúc.
- **Judge độc lập**: nên khác góc nhìn (prompt phản biện), tránh "builder tự chấm builder dễ dãi".

### §5 · Vòng lặp tương tác (gate FSM sẵn có)
Phân loại verdict (quyết cách xử lý — D1c):
- **`infra_fail`** (Dify sập / 0 creds / 0 model / mint|publish|run API lỗi) → **KHÔNG lỗi workflow**: tự retry cơ học (cap N, mặc định 2, cùng lần import); vẫn hỏng → **degrade-to-static**: giữ report `static PASS` + note lý do → park confirm **[Thử lại live] [Chấp nhận static] [Bỏ]**. Workflow gắn nhãn `static-only`.
- **`workflow_fail`** (chạy được nhưng node crash / output rỗng-sai) hoặc **`assertion_fail` / `criteria_fail` / cần input** → lỗi/kết quả THẬT → park **gate "Test result"** (`awaiting_confirm`, flag `test_result`), KHÔNG che thành static-pass:
  - (tuỳ chọn) **diagnosis turn**: đọc `{error|diff, YAML, SPEC}` → đề xuất edit cụ thể (patch prompt/mapping/input). *Đề xuất* — không tự áp.
  - user `/reply` (chỉnh SPEC / input / chấp nhận / bỏ).
  - **Nếu bản fix cần deploy lại để test** → park **confirm "tạo app MỚI để test bản fix?"** kèm checkbox **"🗑 xoá app test cũ"** (D5/Q3, mặc định off). User OK ⇒ import app mới → (nếu tick) `DELETE` app cũ → run → verify. Gate cập nhật `app_url` sang app mới.
- `confirmMode` × live (D1b):
  - `auto`: **lần chạy đầu** import→run→verify hands-free; auto-confirm → `done` **CHỈ khi cơ học pass** (T1 + T2-nếu-fixtures, **không** dựa T3 judge một mình — **B4 siết, §S0.5**); `workflow_fail`/`assertion_fail`/criteria hard-fail ⇒ **hard-stop** ở Test-result gate (không done giả, AC #25); criteria chủ quan-không-fixtures hoặc `need_input` ⇒ **park** (không đoán, C); `infra_fail` ⇒ degrade-to-static + park.
  - **Re-import sau một /reply-fix** LUÔN cần confirm rõ ràng (kèm checkbox xoá-app-cũ) — kể cả `auto`; một fix là hành động của người, không phải auto.
  - `each_step`/`spec_only`: Import gate + Test-result gate đều park cho người bấm (như hôm nay).

### §6 · Vòng đời "Test app" + dọn dẹp
- Mỗi import (mỗi lần re-test được confirm) = 1 app mới; marker `.runs/<taskId>/test_apps.json` **liệt kê** các appId đã tạo (để dọn về sau) + app HIỆN TẠI. **Crash-guard của nhánh live = `test_apps.json`, KHÔNG phải `push_intent`** (A2): `importForTest` append appId ngay sau push; crash trước khi capture appId ⇒ chấp nhận app-mồ-côi (note để cleanup dọn), KHÔNG reconcile-theo-tên (ambiguous khi ≥2 app cùng tên). `push_intent` vẫn thuộc **riêng** path static [runImportAndFinish](../../apps/builder/server/lib/import.ts#L22) (chống re-push mù trong cùng lần) — 2 cơ chế không giao nhau.
- **Dọn**: mặc định **giữ** các test app (user xem/chỉnh trong Dify). Thêm helper/nút **"xoá các app test của build này"** (`DELETE /console/api/apps/{id}` cho các appId trong marker) — Open Q3. App key minted theo mỗi app: revoke khi xoá app (Open Q4).

### §7 · Security recap (spec 015 — bất biến)
- Backend: `resolveDefaultLlmModel`, `deployWithModel`, mint-key, `pushApp`, publish, run — **tất cả** qua `sync.py` subcommand (`runSyncPy`, C6) với `DIFY_*` chỉ trên env con; redact stdout (`redactSecrets` mở rộng để che app-key).
- Skills (judge/diagnosis): nhận **DATA thuần** qua `injectVars`; **không** `DIFY_*`; permission-gate hook vẫn chặn mọi tool chạm creds/mạng ngoài whitelist.
- App key minted **không** bao giờ vào turn/SSE/`.runs` JSON (redact + không inject).

### §8 · Chi phí / recovery
- Mỗi live-test = 1 Dify run (token phía Dify) + (tuỳ) N judge turn (token `claude`). Log `total_tokens` (Dify) + đếm judge-turn.
- Crash giữa chừng (nhánh live): marker `test_apps.json` reconcile ở boot (mở rộng recovery.ts) — appId đã capture ⇒ tái dùng; chưa capture ⇒ app-mồ-côi để cleanup dọn (KHÔNG reconcile-theo-tên, A2). `push_intent` boot-reconcile vẫn chỉ cho path static.

### §9 · Tích hợp gate FSM (bám đúng gate.ts + orchestrator hiện tại)
- **③ Implement gate** — [gate.ts](../../apps/builder/server/lib/gate.ts) `computeGate('implement', success)` thêm action `CONFIRM('test_live', 'Test với workflow')` **khi live khả dụng**. `computeGate` là PURE ⇒ truyền cờ `liveAvailable` (deploy=selfhost && creds) vào signature, không cho nó tự dò I/O.
- **confirmAdvance (cur='implement')** — [orchestrator.ts:131](../../apps/builder/server/lib/orchestrator.ts#L131): rẽ nhánh `actionId==='test_live'` → path live (§4/§5); `continue`/`accept` → `runTestAndFinish` tĩnh **y như hôm nay**.
- **Path live** = tái dùng import của [import.ts](../../apps/builder/server/lib/import.ts) `runImportAndFinish` **tách làm 2 phần**: (1) import→app_id (đã có), (2) *mới*: resolve-model→publish→run→verify→gate. `runImportAndFinish` hiện kết ở `done`; live chèn bước (2) giữa import-ok và done.
- **`test` outcomes mới** — `computeGate('test', …)` thêm nhánh: `test_result` (actions: `accept`→done · `changes`→reply · `test_live`→re-import · `discard`) và `infra_degraded` (actions: `retry_live` · `accept_static`→done · `discard`). Song song `awaiting_import`/`still_failing` cũ.
- **maybeAutoAdvance** — [orchestrator.ts:218-219](../../apps/builder/server/lib/orchestrator.ts#L218): thêm hard-stop cho flag `test_result`; `infra_degraded` cũng park (không auto-done). `auto`+live bỏ qua Import gate (D1b) ⇒ nới điều kiện dòng `awaiting_import` **chỉ cho nhánh live** (env `BUILDER_LIVE_AUTOIMPORT`).

---

## Đối chiếu code hiện tại (implementability — có mâu thuẫn không?)

**Kết luận: KHÔNG có mâu thuẫn kiến trúc. Mọi mảnh khớp pattern sẵn có; feature additive, path `static` không đổi.** Nhưng có ~10 điểm chạm cụ thể (vài cái không nhỏ):

| # | Điểm chạm | Bám vào | Mức |
|---|---|---|---|
| C1 | Nút `test_live` ở ③ gate | `computeGate` (pure) — cần thêm tham số `liveAvailable`; caller (`gateAfterPhase`) tính deploy=selfhost && creds | nhỏ |
| C2 | `testMode` field trên Task + wire + chip | mirror `deploy`/`fastMode` (đã có pattern field start-bound) | nhỏ |
| C3 | Tách import khỏi "finish" cho path live | refactor `runImportAndFinish` → `importApp()` + `runAndVerify()`; static giữ nguyên | **vừa** |
| C4 | Outcomes mới `test_result`/`infra_degraded` | `GateOutcome` enum + `computeGate` (additive) | nhỏ |
| C5 | Hard-stop flag mới ở `maybeAutoAdvance` | thêm 2 dòng guard như `still_failing`/`awaiting_import` | nhỏ |
| C6 | **Dify I/O mới: mint-key / publish / run / delete-app / list-models** | **giữ invariant "chỉ nói với Dify qua sync.py subprocess"** ([dify-io.ts](../../apps/builder/server/lib/dify-io.ts) header) ⇒ thêm **subcommand vào sync.py** (`run`/`api-key`/`publish`/`delete`/`models`), gọi qua `runSyncPy`. Redact như `redactSecrets`. | **LỚN nhất** |
| C7 | Model auto-resolve = inject vào `deploy.yml` tạm | đọc/parse main.yml (đã có `yaml` trong python) — backend, không đụng on-disk | vừa |
| C8 | Gate render + report shape mới (`model_autofilled`, output, verdict, nhãn live-verified) | [ArtifactPanel](../../apps/builder/web/src/components/ArtifactPanel.tsx) report renderer (additive) | nhỏ |
| C9 | Modal confirm re-import **có checkbox "xoá app cũ"** | `askConfirm` hiện trả boolean → cần biến thể modal có checkbox (hoặc mã hoá qua payload gate) | vừa |
| C10 | Judge/diagnosis skill (data-only) | thêm `judge.md` + slot phase; inject `{SPEC, input, output}` qua `injectVars`; **không** `DIFY_*` (spec 015 sẵn strip) | vừa |

**Điểm KHỚP sẵn (không phải làm mới):** ④ là backend (D2 ✓ đúng `kind:'backend'`); `computeGate` pure + gate-action FSM (✓); selfhost Import gate `awaiting_import` (✓ live build lên nó); `push` (✓ `runImportAndFinish`); auto hard-stop qua `flag` (✓); dify-io.ts là chokepoint duy nhất + `redactSecrets` (✓); creds chỉ trên env con, strip khỏi turn (spec 015 ✓).

**Rủi ro thật khi implement:** (1) **C6 là khối Python lớn nhất** — 4-5 subcommand mới cho sync.py (mint/publish/run/delete/models), phải verify từng endpoint (mình đã thử tay thành công, nhưng đưa vào sync.py + test cần công). (2) **C3/C9 chạm luồng đang chạy** (import + confirm modal) → phải giữ path static/`awaiting_import` cũ **byte-nguyên** (golden-build.test.ts + advance-loop.test.ts pin nó — đừng làm đỏ).

---

## S0.5 — Implementation notes (chốt trước implement; review vận hành 2026-07-03)

Không thay quyết định nào ở trên — **cụ thể-hoá cơ chế** cho các điểm dễ trượt khi vào code, và **hardening vận hành** đã review. Mọi thứ ở đây bám nguyên tắc gốc: **live-test là NHÁNH SONG SONG additive — KHÔNG sửa path `static`** ([gate.ts](../../apps/builder/server/lib/gate.ts)/`push_intent`/`awaiting_import` giữ byte-nguyên).

### A · 5 quyết định kiến trúc (chốt)
- **A1 · Judge/diagnosis = helper `runDataTurn`, KHÔNG phải phase thứ 5.** Rút primitive spawn của `runPhase` (`ClaudeSession`+`runTurn`+`setSession`/`clearSession`+guard cancel/timeout) thành helper trả `{text}`; **không** qua `gateAfterPhase`/`PHASES`/`sessionIds`. Judge = `runDataTurn('judge.md', {criteria,input,output})` → parse `verdict.json`. Không nhiễm `PHASE_ORDER`/`restoreTargetPhase`/gate-FSM. An toàn tự thân: [claude-session.ts](../../apps/builder/server/lib/claude-session.ts) strip `DIFY_*` mọi turn.
- **A2 · Re-import = `importForTest()` riêng, KHÔNG đụng `push_intent`/reconcile-theo-tên.** Luôn push fresh; tin `--json-out` appId là PRIMARY; thiếu appId ⇒ `infra_fail`+retry (KHÔNG `reconcileAppIdByName` — nó trả `ambiguous` ngay khi ≥2 app cùng tên [dify-io.ts:254](../../apps/builder/server/lib/dify-io.ts#L254), mà đó là trạng thái *bình thường* của live lặp); append appId vào `test_apps.json`. [runImportAndFinish](../../apps/builder/server/lib/import.ts#L22) giữ nguyên cho path AC#16. *(Hệ quả: gap "push_intent chặn import-mới có-chủ-đích" tan; đồng thời an toàn cho build đồng-thời cùng-tên vì tra theo appId, không theo tên.)*
- **A3 · Acceptance Criteria: SPEC.md `## Acceptance Criteria` → parse ra `.runs/<id>/criteria.json` tại spec-verify** (mirror [orchestrator.ts:456](../../apps/builder/server/lib/orchestrator.ts#L456), chạy mỗi lần verify ② kể cả /reply). Một nguồn tác giả (human sửa trong SPEC.md ở Spec gate), một dạng máy-đọc (`criteria.json` = list 1-dòng). Judge inject `criteria.json`; gate "Test result" render `criteria.json × verdict.json`. Parse rỗng ⇒ judge = smoke-test (advisory-thấp). *(Chốt: parse ở spec-verify, KHÔNG ở judge-time — bắt được edit gate của human, nhưng edit SPEC.md lúc implement không âm thầm đổi rubric giữa test.)*
- **A4 · Nới union `flag`.** [task.ts:52](../../apps/builder/server/state/task.ts#L52) `flag?: 'still_failing' | 'awaiting_import' | 'test_result' | 'infra_degraded'` + 2 guard hard-stop trong `maybeAutoAdvance` cạnh [orchestrator.ts:218-219](../../apps/builder/server/lib/orchestrator.ts#L218).
- **A5 · D1b: KHÔNG nới guard `awaiting_import` cũ.** [orchestrator.ts:219](../../apps/builder/server/lib/orchestrator.ts#L219) (`awaiting_import` LUÔN hard-stop) giữ **nguyên** — path static bất biến 014 D1 tuyệt đối, golden-build/advance-loop xanh do cấu trúc. Live **không** park ở `awaiting_import`; nó sinh `test_result`/`infra_degraded` với luật auto riêng. `BUILDER_LIVE_AUTOIMPORT=0` = chèn *một confirm TRƯỚC* `importForTest`, không đụng dòng static.

### B · 5 điểm hardening vận hành (review thấy — cần cho production)
- **B1 · Lint static CHẠY TRƯỚC live.** `runLiveTest` = chạy 3 linter (baseline **`static PASS`**) → RỒI model-resolve→deploy→publish→run→verify. Không có baseline này thì nhánh `infra_fail` (D1c) không có "lint PASS" để giữ khi degrade-to-static. (S3)
- **B2 · Cancel + timeout cho backend dài.** `runLiveTest` giữ turn-lock qua nhiều `sync.py` + 1 Dify run + judge-turn. Thêm: (a) `isCancelled` check SAU MỖI bước (mirror [runPhase](../../apps/builder/server/lib/orchestrator.ts#L331) — không ghi state sau cờ cancel); (b) timeout `runWorkflow` (env `BUILDER_LIVE_RUN_TIMEOUT_MS`, mặc định 120s) → quá giờ = `infra_fail`; (c) **giới hạn đã biết:** child `sync.py`/run KHÔNG force-kill được như claude-turn ⇒ cancel là *best-effort abandon* (bỏ kết quả, không clobber state) — ghi rõ trong test.md. (S1 timeout / S3 cancel-checks)
- **B3 · Redact app-key minted (không nằm trong env).** [redactSecrets](../../apps/builder/server/lib/dify-io.ts#L58) hiện đọc `difyCreds()` từ **env**; app-key `app-…` mint lúc runtime KHÔNG ở env ⇒ mặc định **không bị che**. Thêm **per-run secret registry** (Set tạm) mà `runSyncPy`/log-filter tra qua, đăng ký key ngay sau `mintKey`, xoá khi xong. App-key không bao giờ vào SSE/`.runs` JSON/report. (S1)
- **B4 · Luật auto-done CHẶT (T3 advisory kể cả trong auto).** `auto`+live → `done` **CHỈ khi** T1 pass **AND** (T2 pass nếu có fixtures) **AND** không criteria hard-fail. Không fixtures + criteria chủ quan ⇒ **PARK** (không auto-done, không auto-guess) — mirror hard-stop fast-mode [orchestrator.ts:226](../../apps/builder/server/lib/orchestrator.ts#L226). Judge **không bao giờ một mình** xác nhận auto-done; judge-fail trong auto ⇒ park, không done giả. (S3)
- **B5 · `verified ≠ shipped` — nhãn minh bạch.** Live verify chạy `deploy.yml` (model đã inject); `main.yml` on-disk giữ model-rỗng (portable). Report ghi RÕ: *"live-verified với model auto `<X>`; `main.yml` giữ model-rỗng — workspace khác sẽ tự resolve khi test/deploy"*. Live-test **không** chứng nhận `main.yml` chạy out-of-the-box (đó là defect builder emit model-rỗng — ngoài scope 032, ghi Open Q). (S2 report / S7 docs)

### C · Input không suy ra được ⇒ `auto` KHÔNG hands-free (rõ ràng hoá D8)
`resolveInput` chỉ auto cho `text/number/paragraph`. Với `select/file/required-phức-tạp` không suy ra được ⇒ verdict **`need_input`** ⇒ **PARK** hỏi user — kể cả `auto`. "Full hands-free" (AC #10) đúng **chỉ khi input suy ra được**; else auto-degrade-to-park (không đoán input rác gây `workflow_fail` giả).

---

## Sequencing (mỗi bước compile + test xanh; feature opt-in nên không phá đường cũ)

- **S0 · Đã chốt Q1–Q7 + auto/degrade + nút gate.** (xong 2026-07-03).
- **S1 · sync.py subcommands + dify-io.ts helpers (C6, §2,§7; A2, B2c-timeout, B3)** — thêm `sync.py {models, api-key, publish, run, delete}` (verify từng cái) + wrapper trong dify-io.ts (`resolveDefaultLlmModel`/`mintKey`/`runWorkflow`/`importForTest`/…); **`runWorkflow` có timeout (B2)**; **per-run secret registry redact app-key (B3)**; unit test với Dify giả (inject) + integration opt-in creds-gated (như 021) chạy thật 1 app. *(khối lớn nhất — làm trước.)*
- **S2 · Spec sinh Acceptance Criteria (§3; A3, B5-report)** — sửa spec.md; verify ② parse `## Acceptance Criteria` → `criteria.json`; hiển thị Spec gate; report note nhãn `verified≠shipped`. *Đứng độc lập, giá trị ngay cả khi chưa có ④ live — có thể ship lát mỏng này trước.*
- **S3 · Phase ④ live orchestrator (§4,§5,§9, C3; A2/A5, B1, B2a, B4, C)** — `runLiveTest`: **lint static TRƯỚC (B1)** → model-inject → `importForTest` (A2, không push_intent) → publish → run (input D8; `need_input`→park, C) → T1/T2 → gate; **`isCancelled` sau mỗi bước (B2a)**; **auto-done chặt (B4)**. Không turn. **Giữ path static + `awaiting_import` byte-nguyên (A5)** (golden-build/advance-loop pin).
- **S4 · Judge skill (§4 T3, C10; A1)** — helper `runDataTurn` (data-only, KHÔNG phase thứ 5) + skill `judge.md` + verdict.json; nối vào ④ như advisory (B4: không tự quyết auto-done). Diagnosis skill (§5) là follow-up.
- **S5 · Gate + Wire + FE (§1,§9, C1/C2/C8/C9)** — `computeGate('implement', …, liveAvailable)` thêm nút **`test_live`**; `testMode` field/wire + composer chip; gate "Test result"/`infra_degraded` render output+verdict; modal re-import có checkbox "xoá app cũ".
- **S6 · Recovery + cleanup (§6,§8)** — marker + boot reconcile; dọn tuỳ Open Q3/Q4.
- **S7 · Docs** — AGENTS.md (④ mode live), test.md (doc CLI), 021 cross-ref (Q1b resolved).

---

## Acceptance criteria

1. Build `static` (mặc định) hành xử **y hệt hôm nay** — không chạm Dify, không regression.
2. Build `live` + selfhost + creds: sau Implement, ④ **tự** import → patch model (mọi llm node rỗng) → publish → run input mẫu → verify → report; **không cần user vào Dify chọn model tay**.
3. Model auto-resolve: chọn model **đang bật** (không phải `gpt-4` không tồn tại); report ghi `model_autofilled`.
4. Re-test/deploy-lại **luôn qua một confirm rõ ràng** ("tạo app mới"); không import thầm; các appId được ghi marker để dọn. Gate luôn trỏ `app_url` app hiện tại.
5. Spec ② sinh **Acceptance Criteria** hiển thị ở Spec gate; ④ T3 judge verify theo đúng checklist đó (per-criterion + bằng chứng), **advisory**, user chốt ở gate.
6. Có `tests/fixtures/` ⇒ T2 assert cơ học (không LLM); fail ⇒ diff expected/actual.
7. **Security**: không `DIFY_*`/app-key nào rời backend; judge/diagnosis turn chỉ nhận data; permission-gate hook + spec 015 pass nguyên vẹn.
8. **Auto-done CHẶT (B4):** `auto`+live → `done` CHỈ khi **T1 pass AND (T2 pass nếu có fixtures) AND không criteria hard-fail**. Không fixtures + criteria chủ quan ⇒ **PARK** (không auto-done); T3 judge advisory, **không bao giờ một mình** quyết auto-done; test fail không bao giờ auto-pass.
9. Cloud/none: `live` bị force `static` (hoặc ẩn), không có đường auto-import cloud.
10. **`auto`+`selfhost`+`live` hands-free** tới `done` khi pass (tự import lần đầu, D1b); `BUILDER_LIVE_AUTOIMPORT=0` đưa về "confirm-import-1-lần"; re-import sau /reply-fix vẫn confirm. **Hands-free chỉ khi input suy ra được (C)** — `select/file/required-phức-tạp` ⇒ verdict `need_input` ⇒ PARK hỏi user (không đoán input rác).
11. **`infra_fail` (Dify sập/0 model/API lỗi) KHÔNG làm hỏng build**: report giữ `static PASS` (lint chạy TRƯỚC, B1) + note + confirm **[Thử lại live][Chấp nhận static][Bỏ]**; workflow gắn nhãn `static-only`. `workflow_fail` thật thì hiện đúng fail (không che), nhãn `live-verified`(fail).
12. **Ở `each_step`/`spec_only`, Implement gate (③) có nút "Test với workflow"** cạnh "Continue to Test" (chỉ khi selfhost+creds); bấm nó chạy path live. `static` path + `awaiting_import`/`still_failing` gate cũ **byte-nguyên** (golden-build/advance-loop xanh).
13. **Security + cancel + timeout (B2/B3):** app-key minted KHÔNG rời backend — `redactSecrets` mở rộng qua per-run registry che `app-…`; `/cancel` giữa live-test dừng sạch (`isCancelled` check sau mỗi bước, không clobber state); `runWorkflow` có timeout (`BUILDER_LIVE_RUN_TIMEOUT_MS`) → quá giờ = `infra_fail`, không treo turn-lock.
14. **`verified ≠ shipped` minh bạch (B5):** report ghi rõ live-verified chạy `deploy.yml` với model auto `<X>`, `main.yml` on-disk giữ model-rỗng (portable) — không chứng nhận main.yml chạy out-of-the-box.

---

## Biggest risks (kèm mitigations)

1. **Judge dễ dãi / thiếu context** (chính bạn nêu). → **ground-truth trước hết**: fixtures (cơ học) + Acceptance Criteria (checklist) làm rubric; judge phản biện + panel; **luôn advisory + human gate**. Không criteria ⇒ nói rõ "chỉ smoke-test".
2. **App trùng / rác Dify** (import luôn tạo mới). → **chấp nhận (D5)** nhưng mỗi re-import đều **confirm rõ ràng** (không đẻ app thầm) + marker liệt kê để **dọn** (Q3). *Đây là đánh đổi có chủ đích lấy sự đơn giản (bỏ draft-patch).*
3. **Rò creds** (thêm nhiều call Dify). → D2/§7: mọi call backend + redact; app key không inject vào turn; hook chặn.
4. **Model: KHÔNG ghi vào YAML on-disk** (giữ portable). → inject model vào bản deploy **tạm** (`.runs/<id>/deploy.yml`) rồi push (§2); `main.yml` giữ model rỗng + note. *(YAML hiện tại là RỖNG model, không phải model sai.)*
5. **Chi phí token** (run + N judge mỗi lần). → judge opt-in tuỳ Q2; panel nhỏ; log token; static vẫn là mặc định.
6. **Endpoint Dify đổi giữa version** (publish/api-keys/models). → đã verify trên self-host hiện tại; bọc trong dify-io.ts một chỗ; fail → degrade "báo user chỉnh tay" thay vì vỡ.

---

## Decisions (Q1–Q7 chốt 2026-07-03)

- **Q1 (model policy — D4) → A.** `resolveDefaultLlmModel` = **system-default nếu ∈ enabled, else model rẻ nhất đang bật** (`*-nano`/`*-mini`). Không expose setting composer ở v1.
- **Q2 (judge — D7) → mặc định BẬT trong mode `live`.** Chọn "test với workflow" (live) chính là opt-in; T1+T2+T3 chạy hết. Không toggle judge riêng. `static` = như hôm nay (chỉ linter).
- **Q3 (dọn app — D5) → giữ + checkbox trong confirm.** Modal re-import có checkbox **"🗑 xoá app test cũ"** (mặc định off); tick ⇒ `DELETE /console/api/apps/{oldId}` sau khi tạo app mới. Không auto-xoá.
- **Q4 (app key minted) → A.** Giữ trong marker `.runs/<id>/test_apps.json` (không rời backend, redact); revoke khi app tương ứng bị xoá.
- **Q5 (input mẫu — D8) → A.** Ưu tiên `tests/fixtures/` → sinh từ start-node schema cho type đơn giản (text/number/paragraph) → hỏi user ở gate cho select/file/required-phức-tạp.
- **Q6 (workspace test riêng) → B (dùng chung) + ghi chú best-practice.** Live-test trên workspace hiện tại; khuyến nghị (không bắt buộc) tách 1 test-workspace nếu sợ đụng app prod (`DIFY_WORKSPACE_ID` đã tham số hoá).
- **Q7 (quan hệ 021) → A.** Dùng chung helpers `dify-io.ts` (`resolveDefaultLlmModel`/mint/run); 021 Slice A gọi lại — một nguồn sự thật.

## Open questions (còn lại, quyết khi implement)

- **OQ1 · Số judge trong panel (§4 T3).** N=1 (rẻ) vs N=3 majority (chắc). *Đề xuất:* N=1 ở v1, nâng lên khi thấy judge thiếu ổn định.
- **OQ2 · Cap retry cơ học (§5).** Mặc định 2 — đủ chưa cho ca publish chậm/model-resolve? Chốt khi thấy số thật.
- **OQ3 · Builder emit model-rỗng (gốc của B5).** 032 auto-fill lúc TEST (deploy.yml), không sửa gốc — implement.md vẫn sinh llm node `{name:''}`. Có nên để implement.md emit một model hợp-lệ-theo-workspace (bớt ma sát nhưng mất portability), hay giữ rỗng + dựa live-test/hướng-dẫn? *Đề xuất:* ngoài scope 032 (feature test, không phải authoring); mở spec riêng nếu muốn sửa gốc. → **Root-fix spec = [037](037-builder-runnability-preflight-and-workspace-facts.md) (D7, implemented 2026-07-07): model giữ RỖNG (B5 bảo toàn — inject lúc test/deploy), còn plugin hash + dataset_ids được điền từ workspace facts harvest; gate ③ hiện preflight note.**
