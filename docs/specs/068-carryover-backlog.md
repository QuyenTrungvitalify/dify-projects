# Spec 068 — Carryover backlog: nợ tồn đọng từ các spec đã xóa

**Status**: Open (2026-07-17)
**Effort**: —(meta)

Khi reset workspace, 71 spec đã hoàn thành bị xóa khỏi cây. Phần lớn chúng xong hẳn, nhưng một số
để lại việc chưa làm. File này gom những việc đó lại để chúng không biến mất cùng spec gốc.

Đọc lại spec gốc bất cứ lúc nào:

```bash
git show ca5e39e:docs/specs/040-builder-uat-fixes.md
git log --oneline -- docs/specs/           # lịch sử đầy đủ
```

Mỗi mục dưới đây là một việc độc lập. Không có thứ tự bắt buộc.

---

## Chất lượng output của builder

**Adj-3 · Phase doc bị nhồi vào prompt mà không kèm đường dẫn** — `orchestrator.ts` gọi
`readFile(join(projectsDir, phase.promptFile!(task)))` rồi nhét **nội dung** file vào prompt. Mọi link
tương đối bên trong — kể cả `[SKILL.md](SKILL.md)` mà mỗi phase được lệnh phải đọc đầu tiên — đều
không resolve được. Hậu quả: **không phase nào đọc được ground rules**, mỗi phase tự dò lại luật
shell-sandbox bằng trial-and-error (một lần Analyze đốt 8 lệnh `find` liên tiếp bị hook chặn). Tốn
khoảng **12 turn phí mỗi run**. Spec gốc gọi đây là *"the cheapest fix in the whole investigation"*.
Đã verify vẫn còn sống trong code hiện tại (2026-07-17).
→ `git show ca5e39e:docs/specs/066-post-import-readiness.md` (mục Adjacent)

**Adj-1 · HTTP node không có `error_strategy` trên field nullable** — builder emit một HTTP GET ăn
thẳng field có thể `null` (ca thật: `url: null` của một Ask HN post) → run abort. Artifact cụ thể đã
bị xóa cùng `projects/`, nhưng **lỗ hổng sinh code vẫn còn**: builder không phòng nullable ở HTTP node.
→ `git show ca5e39e:docs/specs/066-post-import-readiness.md`

**Adj-2 · Yêu cầu bị diễn giải lệch mà không báo** — "top article" được hiện thực thành
`search?tags=front_page` + `hits[0]`, tức bài **điểm cao nhất**, không phải slot #1 của
news.ycombinator.com. `SPEC.md` vẫn khẳng định đó là top. Builder tự diễn giải lại yêu cầu mà không
nói ra.
→ `git show ca5e39e:docs/specs/066-post-import-readiness.md`

**O4 · Graph smoke check cho custom path** — kiểm start→end connectivity, không orphan node / dangling
handle. Nhắm đúng lớp lỗi "qua được 3 linter cấu trúc nhưng rẽ nhánh sai" mà LLM hay mắc nhất khi
build from-scratch. Theo lối warn-only → đo → promote như O1 (đã thành spec 020). **M**
→ `git show ca5e39e:docs/specs/019-builder-output-quality-and-lean-roadmap.md`

**O3 · Model tier theo từng phase** — Implement dùng model mạnh hơn; Analyze/Test rẻ và nhanh hơn.
Opt-in, mặc định giữ như hiện tại. Hiếm ở chỗ vừa tăng chất lượng vừa giảm cost/latency. **S–M**
→ `git show ca5e39e:docs/specs/019-builder-output-quality-and-lean-roadmap.md`

## Tooling

**024 S1 · `gen_schema.py` nuốt lỗi dump** — `http_request` schema-dump đang fail
(`_error: SchemaSerializer` trên default `dify_config.HTTP_REQUEST_MAX_*`) nhưng vẫn ship kèm marker
`_error` thay vì dừng. Việc: làm cho dump-fail thành **fatal** trong `gen_schema.py`, rồi sửa stub.
25/25 node module import được và 29 schema generate được — chỉ mỗi cái này lỗi.
→ `git show ca5e39e:docs/specs/024-reality-reconciliation-and-cross-cutting-gaps.md`

## UX còn treo

**E1 · Ask mode nuốt thay đổi trong im lặng** — gõ một thay đổi khi composer đang ở Ask thì nó trả
lời nhưng **không apply**, mà đọc như đã xong. Guardrail đúng theo thiết kế, nhưng affordance tệ.
→ `git show ca5e39e:docs/specs/040-builder-uat-fixes.md`

**E2 · Tên nút gây nhầm** — `Edit spec` thật ra là "nhờ AI sửa"; `open SPEC.md` mới là "sửa tay".
Đổi `Edit spec` → "Ask AI to revise".
→ `git show ca5e39e:docs/specs/040-builder-uat-fixes.md`

**E3 · Phase dài chỉ hiện `Working…`** — không nói "thường mất vài phút". Thêm một dòng trấn an.
→ `git show ca5e39e:docs/specs/040-builder-uat-fixes.md`

**E4 · Gửi rỗng bị chặn im lặng** — nút send tự disable nhưng không nói vì sao. Thêm helper text.
→ `git show ca5e39e:docs/specs/040-builder-uat-fixes.md`

## Tính năng chưa làm

**056 S4 · ③ preflight advisory "pre-digested input"** (optional).
→ `git show ca5e39e:docs/specs/056-start-node-as-trigger-raw-inputs.md`

**057 S5 · Bật trigger qua API + surface webhook URL** — v1 ship theo lối bật tay. OQ1 còn mở:
Console-API để enable/disable trigger.
→ `git show ca5e39e:docs/specs/057-trigger-entry-support.md`

**032 S6 · Recovery + cleanup** — marker + boot reconcile.
**032 S7 · Docs** — AGENTS.md (④ mode live), test.md (doc CLI), cross-ref spec 021.
→ `git show ca5e39e:docs/specs/032-builder-live-workflow-test.md`

## Verify chưa chạy

Bốn spec dưới đây code đã xong và unit test xanh, nhưng **chưa ai chạy tay qua browser**. Chúng chưa
được chứng minh trên UI thật:

| Spec | Còn thiếu |
|---|---|
| `051` upload YAML as base | Browser QA chưa chạy (real-subprocess E2E thì đã xanh) |
| `052` promote to pattern | Mới unit-verified |
| `053` one-click retry | 3 cổng manual: AC7 (QA-1), AC8 (QA-2), AC9 |
| `054` promote gate vs blank model | Mới unit-verified |

Suite browser-QA nằm ở [`prompts/009/qa/`](prompts/009/qa/) (spec [021](021-builder-e2e-live-run-verification.md) sở hữu).
→ `git show ca5e39e:docs/specs/051-upload-yaml-as-base.md` (tương tự cho 052/053/054)

---

## Hai thứ KHÔNG có trong danh sách này

Bảng index cũ liệt kê hai mục như còn nợ. Đọc lại spec gốc thì cả hai **đã xong** — index stale,
không phải spec:

- **059 S3 (baseline cost)** — index ghi "chờ 1 lần chạy suite live". Spec ghi: *"S3 baseline is
  **FILLED** from the first live run — ③ named TOOL-LOOP-bound; **AC7 met**"*.
- **061 (tool-node checklist)** — index treo cảnh báo cần re-gate sau spec 067. Spec 067 ghi
  *"S5b done and urgent"* và ship đủ S1–S6: nó **đã sửa** 061 rồi.

Ghi lại đây để lần sau không ai đào lại hai con ma này.
