# Spec 011 — Builder Test Coverage + Review Remediation

> Status: **Approved** · Owner: builder · Depends on: Spec 009 (Lát 0–6, merged), Spec 010 · Date: 2026-06-15 (rev. 2026-06-15 — remediation review, see §9)
>
> Source: a full-project review (2026-06-15) over `apps/builder` (server + web) and the base workspace.
> The review confirmed the architecture and safety model are sound, but surfaced one **systemic gap**
> (zero automated tests for the builder; CI does not even compile `apps/`) plus a set of correctness,
> UX, and hygiene findings. This spec enumerates **(A) the items that need automated tests** and
> **(B) the findings to fix**, each with a complexity estimate, so the work can be sequenced.

---

## 0. Context

`apps/builder` is ~6.4k LOC of TypeScript (Fastify backend + Preact SPA) implementing the gated 4-phase
build (Analyze → Spec → Implement → Test). Its load-bearing safety logic — the gate state machine, the
turn-level run-lock, the Origin/CSRF check, the confinement-revert, slug derivation, and the auto-advance
predicate — is mostly **pure or near-pure** and trivially unit-testable, yet has **no automated test at
all**. CI runs only `pytest tests/` + `pre-commit`, and pre-commit explicitly excludes `^(apps/|…)`
([.pre-commit-config.yaml:21](../../.pre-commit-config.yaml)). So CI never builds, type-checks, lints, or
tests the builder; the only safety net today is the **manual** browser-QA suite
([docs/specs/prompts/009/qa/](prompts/009/qa/)) — a certification checklist, not a regression net.

This spec does **not** rewrite anything. It adds a minimal test harness, wires CI to compile `apps/`, and
remediates the concrete findings, prioritized by severity × cost.

> **Verification pass (2026-06-15):** every finding below was adversarially re-checked against the actual
> code before inclusion. Outcome: **R1, R2, R3, R5–R13 confirmed real**; **R4 downgraded** High→Medium (the
> absent-`Origin` allowance is *documented, deliberate* defense-in-depth on a 127.0.0.1-only single-user app —
> real but low risk); **R15 softened** (the max-mtime seed pick is an *intentional, commented* mitigation,
> not a bug — only an edge-case robustness nit remains); **R16 retracted as a defect** (the
> `confirmAdvance`↔`maybeAutoAdvance` recursion is bounded by the 4 phases and the guards at
> `orchestrator.ts:271-273` are correct + fail-safe — kept only as an optional readability refactor); **R14
> now confirmed** (kill paths in `claude-session.ts` leave the readline + stderr listeners attached;
> re-verified this pass). R3 was, if anything, confirmed
> *stronger* than first stated — see its row.

## 1. Goals

- A runnable `npm test` for the builder backend **and** the web SPA, covering the enumerated pure-logic
  units (§3). Green on a fresh checkout.
- CI **compiles + type-checks** `apps/builder` (server `tsc --noEmit` + web `vite build`) and runs the new
  tests, on every PR.
- Remediate the High-severity findings (§4) and clean the repo hygiene issue (§5), each covered by a test
  where the logic is unit-testable.

## 2. Non-goals

- Full end-to-end browser automation — the manual QA suite already owns that; we are not replacing it.
- A live-model integration test in CI (real `claude` turns cost money and need creds). AC #15/#25 stay
  **manual live-run** verification (§4 R10).
- Architectural changes. Findings are fixed in place.

## 3. Test items (what to test) — `(A)`

Test runner (proposed, see Open Q1): **server** → `node --test` run through `tsx` (already a devDep — no new
heavy dependency); **web** → `vitest` + `jsdom` (integrates with the existing Vite toolchain). A small
precursor tax applies: a few helpers currently live inside modules with import-time side effects and must be
**exported / extracted** to be importable in isolation (noted per item as ⟳).

| # | Unit | File | Cases to cover | Test effort | Precursor |
|---|---|---|---|---|---|
| **T1** | `computeGate` (gate state machine) | [server/lib/gate.ts](../../apps/builder/server/lib/gate.ts) | every `phase × outcome × deploy` → action set; F1 `Discard` present on every gate; `awaiting_import` (selfhost) vs copyable-YAML (cloud); `still_failing` branch | **S** | — |
| **T2** | run-lock: `acquireTurn`/`releaseTurn`/`markCancelled`/`reconcileOnBoot` | [server/lib/lock.ts](../../apps/builder/server/lib/lock.ts) | single-`turnHolder` invariant; release-iff-matches; cancel flag outlives lock; boot reconcile skips unparseable `task.json` | **M** (fs temp dir) | — |
| **T3** | `isOriginAllowed` (CSRF boundary) | [server/plugins/sse-origin-check.ts](../../apps/builder/server/plugins/sse-origin-check.ts) | exact allowlist match; cross-origin 403; the `Origin`-absent rule (see R4) | **XS** | — |
| **T4** | `boundaryAutoAdvances` + auto-advance decision | [server/lib/orchestrator.ts:272,282](../../apps/builder/server/lib/orchestrator.ts) | confirm-mode `each/spec/auto` × each boundary; "unknown value → never auto" fail-safe; the AC #25 hard-stop on `still_failing` | **S** | ⟳ export |
| **T5** | `parsePorcelainPath` + whitelist + `confinementCheck` | [server/lib/post-turn.ts](../../apps/builder/server/lib/post-turn.ts) | porcelain rename/quote/space parsing (pure → **S**); full baseline-delta + revert on breach (temp git → **M**) | **S/M** | ⟳ export |
| **T6** | `deriveSlugName` + `firstFreeSlug` | [server/lib/orchestrator.ts:734,762](../../apps/builder/server/lib/orchestrator.ts) | stopword strip; 4-word join; 40-char truncation; `_2/_3` collision suffix (F4 anti-clobber) | **S** | ⟳ export |
| **T7** | word-diff parser | [web/src/lib/diff-parser.ts](../../apps/builder/web/src/lib/diff-parser.ts) | hunk parsing; add/del/empty rows; 200-token perf guard fallback | **S** | — |
| **T8** | markdown renderer (XSS-safety) | [web/src/lib/markdown.ts](../../apps/builder/web/src/lib/markdown.ts) | HTML escaped before render; code-span NUL-sentinel; `snake_case`/`a*b` not italicized | **S** | — |
| **T9** | wire mappers / reducers | [web/src/api.ts](../../apps/builder/web/src/api.ts), [web/src/store.ts](../../apps/builder/web/src/store.ts) | `confirmModeWire` (api.ts) / `confirmModeLabel` (store.ts) round-trip; `applyTask` never lands `undefined` artifacts over defined (the R3 + R8 guard) | **S** | — |
| **T10** | `phaseIndex` / `PHASE_LABELS` bounds | [web/src/components/Chat.tsx:84,123](../../apps/builder/web/src/components/Chat.tsx) | known phases map correctly; unknown phase degrades, does not throw (see R7) | **XS** | — |

**Harness setup cost:** server runner wiring **S**, web `vitest`+`jsdom` wiring **S**, CI job **S** → **M total**.

## 4. Findings to fix (with fix complexity) — `(B)`

Severity from the review. **"Vì sao cần fix"** = hậu quả nếu để nguyên (giải thích đơn giản); "Fix" =
code-change effort; "Test" = the unit that proves it (cross-ref §3).

> **Scope of THIS spec (AC-gated):** **R1, R2, R3, R7, R9, R10** + the T1–T10 harness — these are the
> committed deliverables (see §7). The rest (**R4, R5, R6, R8, R11–R16**) are **enumerated backlog**:
> verified and estimated here, but not gated by an acceptance criterion. Pick them up opportunistically or
> in a follow-up. **R8 needs a repro before any fix** (see its row).

### High

| ID | Finding | Vì sao cần fix | File:line | Fix | Test |
|---|---|---|---|---|---|
| **R1** | No automated tests; CI doesn't compile `apps/` | Một thay đổi nhỏ làm hỏng logic an toàn (gate/lock/CSRF) sẽ **lọt qua mà không ai biết** — không có lưới chặn regression. | [.github/workflows/ci.yml](../../.github/workflows/ci.yml), [package.json](../../apps/builder/package.json) | add `npm test` (server+web) + CI job that `tsc`/`vite build`s `apps/` and runs tests | **M** | this spec |
| **R2** | Builder scratch projects pollute the repo; tracked `INDEX.md` now references junk `workflow_topic_string_3` (3×) | Commit kế tiếp sẽ **kéo theo file rác + INDEX.md sai** → repo bẩn, index tra cứu lệch. | [INDEX.md](../../INDEX.md), [.gitignore](../../.gitignore) | gitignore builder scratch (`projects/workflow_*/`, `projects/start_1_llm_node/`, `projects/test/` — keep the `projects/` prefix so the patterns can't match elsewhere) **or** redirect builder QA output out of `projects/`; regenerate `INDEX.md` | **S** | extend `test_docs_drift` |
| **R3** | SPEC edits wiped mid-edit: a bare `task:update` (no `artifactContents`) flips `art.spec`→`null` (`applyTask` sets `task.value=t` unconditionally, [store.ts:135](../../apps/builder/web/src/store.ts)), so `content`→`''` and the re-seed effect resets the textarea + `saved=true` — silent data loss | Người dùng đang gõ spec, một cập nhật nền ập tới là **mất sạch chữ chưa lưu** — không báo, không hiểu vì sao. | [store.ts:135](../../apps/builder/web/src/store.ts) (root) · [ArtifactPanel.tsx:30](../../apps/builder/web/src/components/ArtifactPanel.tsx) (symptom) | **Root = store:** in `applyTask`, merge — never overwrite a defined `art.*` with `undefined` from an `artifactContents`-less snapshot, so `content` never flips to `''` and the re-seed effect can't wipe the textarea | **S** | T9 |
| **R7** | Unexpected phase crashes the whole thread (`PHASE_LABELS[-1].label`); `phaseIndex` unknown→0 ([Chat.tsx:46](../../apps/builder/web/src/components/Chat.tsx)), and `gateView` casts `t.phase as PhaseKey` so a backend drift reaches it | Chỉ một phase lạ từ backend là **toàn bộ khung chat trắng xóa**, mất hết hội thoại — đáng ra chỉ hỏng 1 thẻ. | [web/components/Chat.tsx:84,123](../../apps/builder/web/src/components/Chat.tsx) | bounds-guard / fallback label; degrade one card, not the view | **XS** | T10 |

### Medium

| ID | Finding | Vì sao cần fix | File:line | Fix | Test |
|---|---|---|---|---|---|
| **R4** | ~~Origin check passes when `Origin` is absent (`if(!origin) return true`) — CSRF softer than spec §J intends.~~ **SUPERSEDED by [015](015-builder-security-turn-sandbox.md) D6** (2026-06-20): `isOriginAllowedForMutation` now rejects an absent Origin on every mutating POST/PUT/PATCH/DELETE; SSE GET stays lenient. A curl mutation must send `-H "Origin: http://127.0.0.1:<port>"`. | Là lớp chặn CSRF cuối; bịt nốt khe một **trang web khác lừa trình duyệt gửi request không kèm Origin**. | [server/plugins/sse-origin-check.ts](../../apps/builder/server/plugins/sse-origin-check.ts) | ✅ done in 015 D6 (`origin.test.ts` covers it) | **XS** | T3 |
| **R5** | Click-away scrim blocks all chat interaction while panel open *(introduced this session)* | Người dùng **tưởng còn gõ/bấm chat được nhưng thực ra "chết"** — click đầu tiên chỉ đóng panel, gây bối rối. | [web/components/App.tsx:237](../../apps/builder/web/src/components/App.tsx), [styles/surface-blocks.css](../../apps/builder/web/src/styles/surface-blocks.css) | decide: narrow scrim to chat-minus-panel, or drop scrim for a global click-outside listener so chat stays live | **S** | manual/QA |
| **R6** | Artifact overlay lacks Esc / focus-trap / ARIA (ConfirmModal does it right) | Người dùng **bàn phím / screen-reader không đóng được panel** (không có Esc), bị kẹt — trong khi modal khác đã làm đúng. | [web/components/App.tsx:234](../../apps/builder/web/src/components/App.tsx), [ArtifactPanel.tsx](../../apps/builder/web/src/components/ArtifactPanel.tsx) | add Esc-to-close, focus management, `role`/`aria-label`, `role="tab"` on tab strip | **S** | manual/QA |
| **R8** | ✅ **SUPERSEDED by [spec 014 D5](014-builder-terminal-correctness-and-state-integrity.md)** (reproduced + fixed). SSE reconnect: the post-init GET re-fetch can resolve **after** a newer live `task:update` and clobber it. *(The buffered-event path is already guarded by `waitingForInit` — the real race is the in-flight GET resolving late, not stale replay.)* **Fix:** a monotonic `task.rev` (server `emit`); `applyTask` drops a strictly-older snapshot (`isFreshSnapshot`). | Mất mạng chớp nhoáng rồi nối lại có thể **hiện sai trạng thái gate (cũ đè mới)** — đúng thứ AC#22 muốn tránh. | [web/src/sse-client.ts:65](../../apps/builder/web/src/sse-client.ts), [store.ts:212](../../apps/builder/web/src/store.ts) | guard the post-init GET so a late response can't overwrite a snapshot applied after it was issued | **M** | T9 |
| **R9** | Doc drift: specs README lists 009/010 "Draft" (shipped); AGENTS.md omits the builder; stale "Lát 5" copy ships in UI | Tài liệu/UI nói sai → **agent & người mới hiểu nhầm, mất niềm tin** vào doc (CLAUDE.md bắt buộc theo AGENTS.md). | [docs/specs/README.md:24-26](README.md), [AGENTS.md](../../AGENTS.md), [ArtifactPanel.tsx:114](../../apps/builder/web/src/components/ArtifactPanel.tsx), [App.tsx:322](../../apps/builder/web/src/components/App.tsx) | correct statuses; add an AGENTS.md builder section; update/remove "Lát 5" strings | **S** | extend `test_docs_drift` |
| **R10** | AC #15 (auto hands-free ①→④) + AC #25 (auto hard-stop on still-failing) never verified by a live run | Hai hành vi **nguy hiểm nhất (chạy tự động, dừng khi lint fail) chưa từng chạy thật** → chưa chắc thực sự an toàn. | [orchestrator.ts:272](../../apps/builder/server/lib/orchestrator.ts) | execute a live build in `auto` mode + a forced-lint-failure build; record results in spec 009/010 | **M** (live) | manual live |
| **R16** | *No confirmed defect (retracted).* `confirmAdvance`↔`maybeAutoAdvance` mutual recursion — bounded by the 4 phases, and the guards at [orchestrator.ts:271-273](../../apps/builder/server/lib/orchestrator.ts) are correct + fail-safe. Optional readability refactor only. | **Không bắt buộc** — chỉ để code dễ đọc / khó vỡ về sau (hiện không có lỗi). | [orchestrator.ts:216,271-276](../../apps/builder/server/lib/orchestrator.ts) | *(optional)* restructure to an iterative advance loop | **M** | T1/T4 |

### Low / cleanup

| ID | Finding | Vì sao cần fix | File:line | Fix | Test |
|---|---|---|---|---|---|
| **R11** | Dead code: stale presentational types in the design-shell block (unused by lat4-ui) | Type chết **gây rối người đọc** → dễ tham chiếu nhầm khi sửa. | [web/src/types.ts:103-235](../../apps/builder/web/src/types.ts) | prune the unused presentational types | **S** | `tsc` |
| **R12** | Create-project flow is a no-op: the modal collects name + folders, but App's `onCreate` discards the payload and just calls `newTask()` — so the form changes nothing. *(Root = the wiring, not the modal.)* | Nút "Create project" **bấm vào không tạo gì** → người dùng tưởng app hỏng. | [web/components/Modal.tsx:12-35](../../apps/builder/web/src/components/Modal.tsx) + App's `onCreate` handler [App.tsx](../../apps/builder/web/src/components/App.tsx) | decide (Q2): wire `onCreate` to real creation **(M)** or hide the affordance until specced **(S)** — *default: hide* | **S/M** | — |
| **R13** | SSE heartbeat bypasses backpressure; socket never `end()`ed on teardown | Client chậm dễ **nghẽn**; socket không đóng hẳn → **rò tài nguyên dần** trên server chạy lâu. | [server/plugins/sse.ts:187-206](../../apps/builder/server/plugins/sse.ts) | route heartbeat through the queue; `raw.end()` in `cleanup()` | **S** | integration |
| **R14** | ✅ **SUPERSEDED by [spec 014 D7](014-builder-terminal-correctness-and-state-integrity.md)** (fixed + tested). Killed `claude` child's readline/stderr listeners not torn down (per-turn leak). **Fix:** `kill`/`forceKill` call `detachListeners` (close `rl` + remove stderr/exit/error) — [claude-session.test.ts](../../apps/builder/test/claude-session.test.ts). | Mỗi turn bị kill để lại listener thừa → **tích tụ rò bộ nhớ** trên server chạy lâu. | [server/lib/claude-session.ts](../../apps/builder/server/lib/claude-session.ts) | close `rl` + remove stream listeners on kill | **S** | integration |
| **R15** | ✅ **SUPERSEDED by [spec 014 D7](014-builder-terminal-correctness-and-state-integrity.md)** (fixed). *Edge-case only.* Dify-seed file picked by max-mtime — clock-skew / stale-template edge cases remain. **Fix:** `pullApp` reports the exact written file (`pulledFileFromStdout`); the mtime scan is now only a fallback. | Hầu như ổn; chỉ **ca hiếm (lệch giờ FS) mới chọn sai file** seed/diff. | [orchestrator.ts:137-149](../../apps/builder/server/lib/orchestrator.ts) | *(optional)* track the exact file `pullApp` wrote instead of mtime scan | **S** | — |

> Effort legend (repo scale): **XS** ≈ <30 min · **S** ≈ ½ day · **M** ≈ 1–2 days · **L** ≈ >2 days.

## 5. Repo hygiene (R2) detail

`git ls-files projects/` returns **1** tracked file (`.gitkeep`); there are **14 untracked** `projects/*`
dirs, each matching 1:1 a builder run in `apps/builder/.runs/<taskId>/task.json` (slug = `deriveSlugName`
of the NL requirement). Two are *real* hand-made projects to **keep**: `news_automation/`,
`eiken_stem_proofread/`. The rest are builder QA throwaways. Because `build_index.py` globs `projects/`
recursively, the junk leaks into the tracked `INDEX.md`. Fix order: classify & remove/ignore junk →
regenerate `INDEX.md` (do **not** hand-edit it, per AGENTS.md §5).

## 6. Open questions

- **Q1** — Test runners: `node --test`+`tsx` (server) and `vitest`+`jsdom` (web), or standardize on `vitest`
  for both? (Default: split, to avoid a new server dep.) **→ Resolved: split** — `node --test`+`tsx` (server), `vitest`+`jsdom` (web).
- **Q2** — R12 CreateProjectModal: implement real creation, or hide it until specced? (Default: hide.) **→ Resolved: hide** the affordance; real creation is a follow-up.
- **Q3** — R2: gitignore the builder scratch slugs, or change the builder to write QA runs outside
  `projects/`? (Default: gitignore now; redirect later.) **→ Resolved: gitignore now**, redirect later.

## 7. Acceptance criteria

1. `cd apps/builder && npm test` and `cd apps/builder/web && npm test` both run and pass on a fresh
   checkout; no live `claude`/Dify creds required.
2. CI has a job that runs `tsc --noEmit` (server) + `vite build` (web) + both test suites on every PR.
3. Units **T1–T10** exist with the enumerated cases. The two confirmed High UX bugs **R3** and **R7** are
   fixed, each covered by a test (**T9** at the store layer; **T10**). R4 (Medium, optional) — if adopted,
   its change is covered by **T3**.
4. Repo: builder scratch is gitignored (or redirected); `INDEX.md` regenerated with no junk-project refs.
5. R9 doc statuses corrected; AGENTS.md has a builder section; no "Lát 5" placeholder strings in shipped UI.
6. R10: AC #15 + AC #25 verified by a recorded live run (logged in spec 009/010).

## 8. References

- Full-project review — session 2026-06-15 (server/web/specs/base-workspace fan-out).
- [Spec 009 implementation plan](009-implementation-plan.md), [Spec 010](010-builder-ux-hardening.md).
- [QA suite](prompts/009/qa/) (manual browser-QA; T11 terminal-only; cancel = `POST /cancel`).
- [AGENTS.md](../../AGENTS.md) §4–§5 (conventions), §7 (test commands).

## 9. Revision notes (2026-06-15 remediation review)

Doc-only corrections from an adversarial re-verification of every claim against the code; **no scope added**:

- **AC #3** no longer labels R4 as "High" (it was downgraded to Medium in the verification pass). The AC now
  gates only the confirmed High UX bugs **R3** + **R7**; R4 is optional.
- **R3** fix relocated to the store (`applyTask` merge-guard, the root cause) so fix and test (**T9**) live at
  the same layer; the `ArtifactPanel` re-seed is the symptom.
- **R8** finding clarified: the buffered-event path is already guarded by `waitingForInit`; the real race is
  the post-init GET resolving *after* a newer `task:update`. **Needs a repro before any fix → backlog,
  not AC-gated.**
- **R11** corrected: there is no duplicate `Gate` type (only `Gate` + `WireGate`), `Sidebar.onToggle` **is**
  used, and `data.ts` is correctly labelled — scope narrowed to pruning the unused presentational types only.
- **R12** corrected: the modal form works; the no-op is App's `onCreate` discarding the payload — fix targets
  the wiring.
- **R14** upgraded from "not re-verified" → **confirmed** (kill paths leave `rl`/stderr listeners attached).
- **R2** gitignore patterns scoped under `projects/` so they can't match elsewhere.
- Added an explicit AC-gated-scope-vs-backlog note in §4; resolved Q1–Q3 to their defaults; status
  Draft → Approved.
