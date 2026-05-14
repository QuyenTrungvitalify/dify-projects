# Spec 006 — Master implementation plan

**Status**: Approved (with defaults for 26/30 Q)
**Effort**: (meta — sums other specs)
**Depends on**: 001, 002, 003, 004, 005

## Decisions resolved (2026-05-14)

User-confirmed:
| Decision | Value |
|---|---|
| Target Dify version | **Latest stable** (v1.14.x) — `.dify-tag` = current latest, weekly refresh CI |
| Canary workspace | **Yes** — user setup Dify Cloud free tier → unlocks QA Tier 3 |
| AGENTS.md language | **English primary** + 1 Vietnamese section ở đầu cho human team |
| Open-source plan | **Không / không chắc** → Phase Y.6 polish (CONTRIBUTING, examples, license) defer indefinitely |

Defaults applied (28/30 chi tiết Q còn lại — see individual specs). Two Q vẫn cần user input nếu muốn override:
- **Q1.1**: Giữ all schema versions trong git? Default = Yes
- **Q1.2**: `.dify-tag` commit hay gitignore? Default = Commit

## Context

External review từ 2026-05-14 surface ~15 findings (14 đúng + 1 sai framing về DSL version). Plus user yêu cầu QA flexible across Dify versions. Specs 001-005 phân tách từng vấn đề. Spec 006 này là **kế hoạch tổng** ordering chúng.

## Goals

1. Order specs theo dependency + ROI.
2. Identify blockers (external dep, user decision).
3. Estimate total effort + phase budget.
4. Define "done" cho mỗi phase.

## Phase ordering (proposed)

Order dựa trên 2 nguyên tắc:
- **Foundation first**: spec dependency phải hoàn thành trước
- **Highest ROI first** within mỗi tier

### Phase Y.1 — Foundation (~3-4h)

**Goal**: Set up infrastructure đa version trước khi build các check phụ thuộc.

| Step | Spec | Effort |
|---|---|---|
| Y1.1 | Spec 001: vendor/dify-src/ + setup.sh --dify-tag | M |
| Y1.2 | Spec 001: gen_schema.py auto-derive output filename | S |
| Y1.3 | Spec 001: per-project dsl_version in .dify-workspace.yaml | XS |
| Y1.4 | Spec 001: check_dsl_version.sh đọc per-project config | S |
| Y1.5 | Spec 001: .vscode/settings.json template (decision per Q1.3) | XS |

**Done when**: 2 projects với 2 DSL versions khác nhau cùng tồn tại, mỗi cái validate riêng.

### Phase Y.2 — AGENTS.md (~2h, includes self-test)

**Goal**: Cho AI agent context layer.

| Step | Spec | Effort |
|---|---|---|
| Y2.1 | Spec 002: Write AGENTS.md ~200 lines | S |
| Y2.2 | Spec 002: CLAUDE.md stub | XS |
| Y2.3 | Spec 002: Cross-link từ README + GUIDE | XS |
| Y2.4 | Spec 002: Run baseline self-test (manual, 1 task) | S |
| Y2.5 | Spec 002: Log self-test results trong docs/specs/002-agents-md-self-test-log.md | XS |

**Done when**: Self-test pass (agent build workflow chỉ với AGENTS.md context).

### Phase Y.3 — Variable ref linter (~3-4h)

**Goal**: Catch lỗi import #1.

| Step | Spec | Effort |
|---|---|---|
| Y3.1 | Spec 003: Implement lint_refs.py (~150 LOC) | M |
| Y3.2 | Spec 003: Write 7 test fixtures | S |
| Y3.3 | Spec 003: tests/test_lint_refs.py | S |
| Y3.4 | Spec 003: Pre-commit hook #10 | XS |
| Y3.5 | Spec 003: Baseline run on corpus, log false-positives | S |

**Done when**: All 4 patterns + corpus pass, all 7 fixtures pass.

### Phase Y.4 — Cleanup & sửa các phát hiện đơn lẻ (~2h)

| Step | Issue | Effort |
|---|---|---|
| Y4.1 | INDEX.md → relative paths (build_index.py fix) | XS |
| Y4.2 | Refresh Dify source clone (manual via setup.sh) | S |
| Y4.3 | Regen schema → diff old vs new | XS |
| Y4.4 | Fix agent node (separate Implementation stub) | S |

**Done when**: agent node included in schema (25/25); INDEX clean.

### Phase Y.5 — CI + automated tests (~3h)

| Step | Spec | Effort |
|---|---|---|
| Y5.1 | Spec 004: ci.yml | S |
| Y5.2 | Spec 004: refresh-schema.yml weekly cron | S |
| Y5.3 | Spec 005.3: test_docs_drift.py | S |
| Y5.4 | Spec 005: test_pattern_consistency.py (parametrized) | S |
| Y5.5 | Spec 005.1: lint_plugin_hashes.py | XS |
| Y5.6 | README CI badge | XS |

**Done when**: Push clean → green; push broken → fail correctly.

### Phase Y.6 — Optional QA depth (~3-5h)

User confirmed canary workspace coming (Dify Cloud free tier) → Y6.2 sync diff normalization unblocks once a real export sample is available.

| Step | Spec | Effort | Block? |
|---|---|---|---|
| Y6.1 | Spec 005.2: Code sandbox imports checker | M | Need whitelist source |
| Y6.2 | Spec 005.4: Sync diff normalization | M | Unblock when canary export sample available |
| Y6.3 | Spec 005.5: AGENTS.md periodic self-test script | M | — |
| Y6.4 | Migration tool design (006.M new spec) | M | Until DSL bumps |

OSS polish items (CONTRIBUTING.md, expanded examples, license polish): **deferred** — user confirmed no OSS plan in next 6 months.

**Done when**: Each optional has clear path forward (implemented or documented for future).

## Effort summary

| Phase | Items | Total effort |
|---|---|---|
| Y.1 | 5 | 3-4h |
| Y.2 | 5 | 2h |
| Y.3 | 5 | 3-4h |
| Y.4 | 4 | 2h |
| Y.5 | 6 | 3h |
| Y.6 | 4 | 3-5h (optional) |
| **Total** | **29** | **~13-15h core + 3-5h optional** |

## Decision tree — what to do next

```
Has user approved Spec 001?
├── No → blocked on Q1.1, Q1.2, Q1.3, Q1.5
└── Yes → start Y.1
         └── Y.1 done?
             ├── No → finish
             └── Yes → Has user approved Spec 002?
                      ├── No → blocked on Q2.2, Q2.3
                      └── Yes → start Y.2 (parallel-able với Y.3)
```

Mọi spec đều có open questions ở section "Open questions" — phải resolve trước khi `Status: Draft → Approved`.

## Blockers — external dep / user decision

### External

- **Canary Dify workspace** (Spec 005 Tier 3): cần user provide hoặc decide skip
- **Dify sandbox whitelist** (Sub-spec 005.2): cần research từ Dify docs/source
- **Real Dify export sample** (Sub-spec 005.4): cần 1 sample to design normalize

### User decision required (aggregate ở Section "Câu hỏi tổng hợp" trong chat)

Xem cụ thể trong từng spec's "Open questions" — 30+ questions total. Spec này chỉ tham chiếu.

## Acceptance criteria (master)

- [ ] All 5 sub-specs (001-005) reviewed + approved
- [ ] Phases Y.1 → Y.5 done (core scope)
- [ ] Phase Y.6 either done or explicitly deferred with reason
- [ ] AGENTS.md self-test ≥1 successful run
- [ ] CI green ≥3 consecutive days

## References

- External review at `~/Downloads/dify-projects-REVIEW.md` (2026-05-14)
- Specs 001-005 (peer documents)
