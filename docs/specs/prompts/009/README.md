# Spec 009 — Step Prompts (Dify Workflow Builder app)

Copy-paste-ready prompts cho fresh AI agent session để implement từng **lát cắt dọc**
(vertical slice) của Spec 009. Mỗi lát chạy end-to-end & demo được, mỏng dần từ lõi ra vỏ.

- Spec: [009-browser-workflow-builder.md](../../009-browser-workflow-builder.md)
- Brief (v2): [009-implementation-brief.md](../../009-implementation-brief.md)
- **Plan (đọc trước khi chạy bất kỳ prompt nào)**: [009-implementation-plan.md](../../009-implementation-plan.md)

## Order

| File | Lát | What | Status | Depends on |
|---|---|---|---|---|
| [lat0-spike.md](lat0-spike.md) | 0 | Spike `claude` headless → chốt permission model (A/B/C) + stream contract | ✅ **done → model C** ([findings](../../009-spike-findings.md)) | — |
| [lat0.5-skill-engine.md](lat0.5-skill-engine.md) | 0.5 | `.claude/skills/dify-build/` engine ([SKILL.md](../../../../.claude/skills/dify-build/SKILL.md) + analyze/spec/implement/test) — prompt audits/regenerates it | ✅ **done** (engine authored directly) | Lát 0 (model) |
| [lat1-skeleton.md](lat1-skeleton.md) | 1 | Backend spawn 1 phase (③) + parse stream-json + **post-turn verify** | ✅ **authored** | Lát 0, 0.5 |
| [lat2-chain.md](lat2-chain.md) | 2 | Chain ①→②→③ (turn) →④ (backend), verify mỗi turn, deploy=none | ✅ **authored** | Lát 1 |
| [lat3-gate.md](lat3-gate.md) | 3 | Gate `awaiting_confirm` + `/confirm` + `/reply` + run-lock/cancel (**crux**) | ✅ **authored** | Lát 2 |
| [lat4-design.md](lat4-design.md) | 4 · design | **Visual layer** from [docs/design/](../../../design/) — vendor `surface-blocks.css` + port the 7 prototype components → Preact shell (sidebar, gate cards, phase track, artifact panel) | ✅ **authored** | Lát 0 |
| [lat4-ui.md](lat4-ui.md) | 4 · wire | SSE + 3 regions **wired** to the backend; nexus = **logic only** (the look comes from lat4-design) | ✅ **authored** | Lát 3, 4·design |
| [lat5-shell.md](lat5-shell.md) | 5 | selfhost push/app_url, seed picker, diff, recovery, security, cloud, docs | ✅ **authored** | Lát 4 |

> **All step prompts are authored (Lát 0–5).** Each is written to **read the current
> `009-implementation-plan.md` slice + spec + prior-slice artifacts at runtime**, so it stays
> correct as earlier slices land. If a slice changes a downstream assumption (esp. the
> permission model or an API shape), update the affected prompt per the plan's Spec-update ledger.

## Sequence

```
Lát 0 (spike) ── Lát 0.5 (skill prompts) ── Lát 1 ── Lát 2 ── Lát 3 ── Lát 4 ── Lát 5
   │                                           (curl-driven)         (UI)     (vỏ)
   └─ chốt permission model + cách verify; KHỞI ĐỘNG bằng cái này, mọi thứ khác chờ nó.
```

Xếp theo **rủi ro**: net-new (spike CLI, gate, post-turn verify) TRƯỚC UI (đa số là copy).
Lát 0 + 0.5 gate mọi thứ (model + engine). Lát 0.5 còn = spec **Nhịp 1** (validate quy
trình 4-phase trên runtime sẵn có trước khi xây app shell).

## How to use

1. Chọn lát muốn implement (theo thứ tự).
2. Mở **fresh Claude Code session** (hoặc Codex/Cursor).
3. Copy toàn bộ nội dung file prompt làm user message đầu tiên.
4. Agent đọc prompt → đọc spec/plan được tham chiếu → thực thi.
5. Agent commit local (theo prompt — **không push** cho tới khi lát xong & human review).
6. Verify acceptance của lát đó (map về Acceptance criteria trong spec).
7. **Update spec theo Spec-update ledger** (plan §cuối) nếu lát đó confirm một correction — repo cấm silent drift.
8. Author prompt cho lát kế (cập nhật bảng Status ở trên), rồi lặp lại.

## Why fresh sessions

Mỗi lát self-contained. Fresh session: không leak giả định sai từ hội thoại trước, full
context window cho việc thật, recovery sạch nếu hỏng.

## Maintenance

Khi spec tiến hoá (Q resolved, spike chốt model, decision đổi) → **update prompt file liên
quan** cho khớp. Prompt và spec/plan phải hội tụ, không phân kỳ. Đặc biệt: kết quả Lát 0
(model A/B/C thắng) sẽ quyết định nội dung `headless-settings.json` mà Lát 1 dùng và phần
permission trong các prompt sau — sửa chúng ngay sau khi spike đóng.
