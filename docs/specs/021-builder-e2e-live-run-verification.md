# Spec 021 — Builder E2E live-run verification (automated, creds-gated)

**Status**: Draft
**Effort**: L (2 slice độc lập: **A** = M, **B** = M — A đứng một mình được)
**Depends on**: [005](005-qa-strategy.md) (Tier 3 — chiến lược cha; Q5.1 đã unblock canary) · [009](009-browser-workflow-builder.md) (app + AC #15/#16/#25) · [011](011-builder-test-coverage-and-remediation.md) (**R10** — spec này *discharge* nó) · [013](013-builder-linter-contract-and-test-seams.md) (`advance-loop.test.ts` — bản stubbed của Slice B) · [014](014-builder-terminal-correctness-and-state-integrity.md) (chỉnh câu chữ AC #15/#16/#25)

> **Thesis.** Lưới an toàn tự động hiện tại chứng minh **cấu trúc** (schema + skill validator + reachability gate spec 020) nhưng **không một test nào chứng minh một workflow build ra thực sự chạy được trong Dify**. Hai khoảng hở "live" đều đang là **thủ công**:
> 1. *Orchestration* — AC #15/#25 mới chỉ được chứng minh bằng **stubbed runners** ([advance-loop.test.ts](../../apps/builder/test/advance-loop.test.ts), spec 013); chưa từng chạy với `claude` turn thật. CI live-test bị 011 cố tình để **non-goal**.
> 2. *Output* — "YAML import + chạy + output đúng trong Dify" mới chỉ là skeleton skip-by-default ([test_workflow_smoke.py](../../tests/test_workflow_smoke.py), spec 005 Tier 3).
>
> Spec này biến **cả hai** thành **executable, creds-gated, skip-clean** — *không* nhét live-test vào CI mặc định (giữ nguyên non-goal của 011), mà cung cấp một **runner opt-in** + một **lane CI tuỳ chọn** đúng thứ 005 Tier 3 cần.

## Context

- **Static net mạnh nhưng mù runtime.** pytest (`60 passed, 2 skipped`) + builder suites (server 181, web 55) đều xanh, nhưng tất cả là static/stubbed. `advance-loop.test.ts` chứng minh AC #15 (auto ①→④ hands-free) và AC #25 (still-failing hard-stop, không auto-import lint≠0) **với runner giả** — không có lần nào chạy `claude` + Dify thật.
- **011 R10 vẫn treo, dạng checklist.** [011 §4 R10](011-builder-test-coverage-and-remediation.md) + AC #6 yêu cầu "a recorded live run" của AC #15/#25, nhưng [011 §2](011-builder-test-coverage-and-remediation.md#L49-L51) khai báo *"A live-model integration test in CI ... AC #15/#25 stay manual live-run."* Tức: có nơi track, nhưng là **quy trình tay**, không phải script.
- **005 Tier 3 đã unblock nhưng chưa làm.** [005 Q5.1](005-qa-strategy.md) resolved: user có Dify Cloud free tier ⇒ "Import canary / Live workflow run" đủ điều kiện, nhưng vẫn ⏸/skeleton.
- **Hạ tầng đã có sẵn để dựng E2E** (không phải xây từ đầu):
  - Public app API client: [conftest.py `DifyWorkflowClient.run()`](../../tests/conftest.py) + pattern skip-clean `_have_creds()`.
  - Console API client: [sync.py `import_app()`](../../tools/dify_base/sync.py) (→ `app_id`), `export_app`, `list`.
  - Headless driver: [demo-gates.sh](../../apps/builder/scripts/demo-gates.sh) lái backend thật qua HTTP (`/api/tasks`, `/confirm`), có mode `validate` rẻ (no turns).
- **Khoảng hở "cầu nối" (quyết định độ phức tạp).** `import_app()` trả `app_id` nhưng Dify **không** tự sinh app-level API key (`app-…`) — mà `DifyWorkflowClient.run()` cần đúng key đó. Hiện **không có** code mint key. ⇒ phải chọn cách bắc cầu (Open Q1).

## Goals

1. **Slice A — output canary**: một lệnh, có creds ⇒ chứng minh một workflow **golden** *import → run → output khớp snapshot* (discharge 005 Tier 3 "Import canary" + "Live workflow run").
2. **Slice B — builder live**: một lệnh, có creds + `claude` ⇒ lái một build ①→④ **thật** và assert **AC #15** (auto hands-free → `done`) và **AC #25** (still-failing hard-stop, không auto-import lint≠0) — bản *live* của `advance-loop.test.ts`; discharge **011 R10/AC #6** thành script thay vì checklist.
3. **Skip-clean**: thiếu creds ⇒ skip sạch; **CI mặc định không đổi** (vẫn xanh, không gọi live).
4. **Tự ghi kết quả** của live run (đáp 011 AC #6 / [010 §AC](010-builder-ux-hardening.md#L129)).

## Non-goals

- **Không** đưa live-test vào CI per-PR mặc định (tốn tiền + non-deterministic). Chỉ một lane **opt-in** (`workflow_dispatch`/scheduled) — giữ nguyên non-goal 011.
- **Không** thay manual browser-QA suite ([prompts/009/qa/](prompts/009/qa/)) — vẫn sở hữu full UI E2E (T11 terminal-only, v.v.).
- **Không** đụng `deploy=update`/in-place import ([009 Non-goal #8](009-browser-workflow-builder.md#L124)) — spec riêng.
- Không load/perf testing.

## Design

### Discipline (additive, no-disruption — theo khung 019 §3)

- Test mới nằm sau **marker + cổng creds/claude**; thiếu ⇒ `pytest.skip` (mirror `_have_creds()`). Không file test mới nào chạy trong `pytest tests/` mặc định trừ khi env bật.
- **Slice A không cần đổi product code.** Slice B dùng seam headless đã có (demo-gates / dev endpoint đã hard-gate ở 019 L1) — không thêm spawn-path mới.
- Mọi field/secret mới là optional; absent ⇒ behavior cũ.

### Slice A — Output canary: import → run → assert (no `claude`, deterministic) · M

**Đầu vào:** một workflow **golden tối thiểu** — đề xuất một fixture chuyên dụng [tests/fixtures/e2e/](../../tests/fixtures/) (start → 1 LLM *hoặc* template-transform → end; **ít plugin nhất** để giảm bề mặt plugin-hash), thay vì tái dùng `md_en2ja` (5 node + md_exporter ⇒ nhiều plugin hơn). Golden là *deterministic anchor*, không phải "đẹp".

**Luồng (pytest, reuse client sẵn có):**

| # | Bước | Công cụ |
|---|---|---|
| A1 | Lấy/đảm bảo có app chạy được trong canary workspace | Console API (Open Q1) |
| A2 | Lấy app-level API key cho app đó | Open Q1 (pre-provision **hoặc** mint-via-console) |
| A3 | `DifyWorkflowClient.run(inputs)` → assert `data.status == "succeeded"` và `data.outputs == snapshot` (syrupy) | [conftest.py](../../tests/conftest.py) |
| A4 | Cleanup (nếu A1 import mới): xoá app qua console; nếu dùng canary cố định: no-op | Open Q4 |

- **Cổng:** skip trừ khi đủ creds (`DIFY_BASE_URL`+`DIFY_API_KEY` cho run; `DIFY_CONSOLE_URL`+`DIFY_CONSOLE_TOKEN` nếu nhánh import).
- **Tiền đề plugin-hash (nêu rõ):** plugin hash trong golden phải **hợp lệ với canary workspace** (hash là workspace-specific — [AGENTS.md §4.3](../../AGENTS.md)). Giữ golden tối giản để hạn chế đúng 1 plugin (LLM provider của canary).
- **Vì sao làm trước:** rẻ nhất, deterministic nhất, độ tin cao nhất; không phụ thuộc `claude`.

### Slice B — Builder-driven full chain: ①→④ live + AC #15/#25 (real `claude`, opt-in) · M

**Driver:** một script (mở rộng [demo-gates.sh](../../apps/builder/scripts/demo-gates.sh) hoặc 1 pytest nói HTTP với backend đang chạy):

1. Boot backend (`npm start`) trên cổng tạm, `deploy=none`.
2. **AC #15:** `POST /api/tasks {confirm_mode:"auto", deploy:"none", requirement:<golden NL>}` → poll tới `phase=done` **không** gửi `/confirm` nào; assert: chạm `done`, `report.json` tồn tại + non-empty, lint summary sạch.
3. **AC #25:** start build với **fixture buộc lint-fail** (Open Q2) → assert **hard-stop tại gate**, `status=still_failing`, **không** auto-import (đúng tinh thần 014: auto cũng không auto-import build selfhost sạch).
4. *(tuỳ chọn)* chạy Slice A trên `main.yml` build ra → khép vòng build→run.

- **Ghi kết quả** vào log (011 AC #6).
- **Chi phí:** `claude` turn thật (phút/turn, subscription). **Opt-in cứng:** chỉ chạy khi `DIFY_E2E_LIVE_BUILD=1` **và** `claude` có trên PATH.

### Nơi chạy

- **Local:** một lệnh (`scripts/e2e.sh` hoặc `pytest -m e2e`).
- **CI:** **không** trong job mặc định. Một workflow tách rời `.github/workflows/e2e.yml` (`workflow_dispatch` + tuỳ chọn `schedule` nightly) gác bằng repo secrets; thiếu secret ⇒ skip. Đây là lane 005 Tier 3 muốn, mà không vi phạm non-goal 011 (per-PR CI vẫn sạch).

### Files (dự kiến)

| File | Vai trò |
|---|---|
| [tests/e2e/test_output_canary.py](../../tests/) | Slice A |
| [tests/fixtures/e2e/](../../tests/fixtures/)`<golden>.yml` + `inputs.json` + `__snapshots__/` | golden anchor |
| `tests/e2e/test_builder_live_build.py` *hoặc* `apps/builder/scripts/e2e-build.sh` | Slice B |
| [tools/dify_base/sync.py](../../tools/dify_base/sync.py) | (+) `delete_app`; (Open Q1) `create_api_key` |
| [tests/conftest.py](../../tests/conftest.py) | (+) `_have_console_creds()` + canary fixtures |
| `.github/workflows/e2e.yml` | lane opt-in/scheduled (tuỳ chọn) |

## Open questions

- **Q1 (cầu nối API-key) — quyết định chính.** (a) **Pre-provision** một canary app + lưu `DIFY_API_KEY` của nó (không code mới; chứng minh "một workflow *biết trước* chạy được", **không** test đúng artifact vừa import) — vs (b) **mint** app API key qua Console API sau import (`POST /console/api/apps/<id>/api-keys` — *cần verify endpoint*) để Slice A test đúng artifact vừa build/import end-to-end. *Đề xuất:* ship (a) trước (unblock ngay, đáp 005 Tier 3 "import canary" theo nghĩa run-một-workflow-thật), thêm (b) ở follow-up nếu muốn verify đúng artifact mới sinh.
- **Q2 (fixture lint-fail của Slice B).** Làm sao buộc một Implement *still-failing* sau cap-5 một cách deterministic? *Đề xuất:* một **bad fixture commit sẵn** (vd ref downstream để reachability-gate spec 020 đánh trượt) tiêm qua seam dev có sẵn — **không** prompt-engineer cho `claude` cố tình sai (non-deterministic).
- **Q3 (lane CI).** Nightly `schedule` vs chỉ `workflow_dispatch`? *Đề xuất:* `workflow_dispatch` thủ công trước; thêm nightly chỉ khi flake budget cho phép (Slice B tốn `claude`).
- **Q4 (cleanup, gắn với Q1).** Xoá app mỗi lần vs tái dùng một canary cố định? *Đề xuất:* lane deterministic dùng **canary cố định + run** (không import mỗi lần — vì import luôn tạo app mới [009 Non-goal #8], sẽ rác dần). Nhánh import-mới chỉ bật khi chọn Q1(b), kèm `delete_app` cleanup.

## Acceptance criteria

1. `tests/e2e/` tồn tại; **thiếu creds ⇒ `pytest tests/` không đổi hành vi** (test mới skip; suite vẫn `60 passed, 2 skipped` + N skipped). Builder npm suites không đổi.
2. **Slice A:** có DIFY creds ⇒ golden workflow *import-or-reuse → run → outputs khớp snapshot*; một lệnh; ghi pass/fail.
3. **Slice B:** có creds + `claude` ⇒ **AC #15** (auto ①→④→`done` hands-free) và **AC #25** (still-failing hard-stop, không auto-import lint≠0) được **một lần chạy executable** assert; kết quả được log ⇒ **discharge 011 R10 / AC #6**.
4. **CI mặc định xanh & không đổi** — không có lời gọi live nào trong job per-PR.
5. *(nếu lấy)* lane CI opt-in chạy Slice A trên `workflow_dispatch` khi có secrets; skip khi không.
6. **Doc reconcile:** 005 Tier 3 hàng "Import canary" + "Live workflow run" chuyển ⏸/skeleton → ✅ (automated, creds-gated); 011 R10 + AC #6 đánh dấu *dischargeable bằng script* (không còn manual-only).

## References

- [005 §Tier 3](005-qa-strategy.md) — chiến lược cha (Q5.1 đã unblock canary).
- [011 §4 R10 + §7 AC #6](011-builder-test-coverage-and-remediation.md) — item thủ công spec này tự-động-hoá.
- [013 advance-loop.test.ts](013-builder-linter-contract-and-test-seams.md#L188) — bản stubbed của Slice B (complement, không thay thế — đúng lời 013 §Q1).
- [014 §D1](014-builder-terminal-correctness-and-state-integrity.md#L159) — auto không còn auto-import build selfhost sạch (câu chữ AC #15/#16/#25).
- [conftest.py](../../tests/conftest.py) `DifyWorkflowClient` + pattern `_have_creds()` skip-clean.
- [sync.py](../../tools/dify_base/sync.py) `import_app`/`export_app`/`list` (console seam); [demo-gates.sh](../../apps/builder/scripts/demo-gates.sh) (headless driver).
- [009 §Non-goals #8](009-browser-workflow-builder.md#L124) — `deploy=update` ngoài phạm vi (spec riêng).
