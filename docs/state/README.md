# `docs/state/` — hiện trạng hệ thống

Bộ tài liệu mô tả **hệ thống hiện đang xử lí ra sao**, đủ để hiểu luồng thật mà không phải đọc code
và không phải đọc spec.

> **Bộ này CHƯA phủ hết bề mặt.** Phần đã có chủ nằm ở [§Bộ doc](#bộ-doc); phần chưa có nằm ở
> [§Bề mặt chưa có doc sở hữu](#bề-mặt-chưa-có-doc-sở-hữu). **Đọc bảng đó trước khi kết luận rằng một
> cơ chế đã được mô tả ở đâu đó** — hiện còn nhiều mảng chỉ đọc được từ code.

**Đây là nơi DUY NHẤT của loại tài liệu này.** Doc mô tả trạng thái không nằm ở `docs/` gốc.

---

## Quy ước

Mọi doc trong thư mục này tuân theo:

1. **Mô tả bất biến, không chứa số đo.** Số (test count, thời gian, cost, số build) lấy bằng **cách
   chạy**, không đọc trong doc. Số ghi cứng sẽ sai ngay lần chạy kế tiếp và neo sai phân tích sau này.
2. **Chuỗi trong backtick là nguyên văn** code phát ra hoặc đọc — không dịch.
3. **Không đề xuất, không roadmap, không lịch sử quyết định.** Doc trả lời *"đang thế nào"*, không trả
   lời *"nên thế nào"* hay *"vì sao từng thế kia"*.
4. **Tham chiếu trỏ vào đường dẫn code**, không trỏ số spec.
5. Mỗi doc mở đầu bằng **dòng `Phạm vi:`** liệt kê đúng những file nó sở hữu.
6. Mỗi doc kết thúc bằng **"Guard ở đâu"** (bất biến ↔ test thực thi nó) và **"Những gì KHÔNG check tự
   động nào chứng minh được"** (ranh giới nhận thức).

*(README này là index, không phải doc trạng thái — quy ước 5/6 không áp cho nó.)*

## Luật sở hữu

**Mỗi file trong bề mặt dưới đây thuộc đúng MỘT doc.** Doc khác cần nhắc thì **trỏ sang một dòng**,
không mô tả lại.

Bề mặt chịu luật:

```
apps/builder/server/lib/  ·  server/hooks/  ·  server/routes/  ·  server/state/
apps/builder/web/src/lib/  ·  apps/builder/headless-settings.json
tools/dify_base/  ·  schemas/  ·  templates/
```

Lý do: hai doc mô tả cùng một cơ chế ở hai độ chính xác thì bản kém chính xác hơn sẽ **âm thầm nói
dối**, và không ai biết bản nào đúng. Kiểm được bằng mắt: gom mọi dòng `Phạm vi:` phải phủ hết bề mặt,
không trùng.

## Bộ doc

| Doc | Trả lời | Sở hữu |
|---|---|---|
| [turn-and-sandbox.md](turn-and-sandbox.md) | Một phase chạy ra sao; nó được phép làm gì; ai chặn; kiểm lại gì sau đó | `claude-session.ts` · `turn-runner.ts` · `shell.ts` · `hooks/permission-gate.ts` · `hook-check.ts` · `post-turn.ts` · `lock.ts` · `ask.ts` · `headless-settings.json` |
| [readiness-and-plugins.md](readiness-and-plugins.md) | Builder làm gì **sau khi** YAML đã có: user còn phải làm gì, nói ra sao, luật plugin nào khiến điều đó đúng | `runnability.ts` · `report.ts` · `dify-io.ts` · `lint_plugin_hashes.py` · `marketplace.py` · `templates/tool-catalog.json` · `e2e_check.py` |
| [knowledge-system.md](knowledge-system.md) | AI tham khảo cái gì, lấy từ đâu, cái gì cưỡng chế kết quả | **Chưa khai `Phạm vi:`** — thực tế mô tả `phases.ts` · `analysis.ts` · `find.py` · `build_index.py` · `validate_workflow.py` · `lint_refs.py` · `lint_node_bodies.py` · `schemas/dify-dsl-0.6.0.json` · `templates/{patterns,library,probes,_base}`, **một phần** `orchestrator.ts` (chỉ chỗ tiêm `{{KNOWLEDGE}}`) và `scaffold.ts` (chỉ prelude seed), **cộng 4 file doc khác sở hữu** → §Trạng thái tuân thủ |

## Trạng thái tuân thủ

Sự thật về bộ doc này, cần để luật sở hữu ở trên có nghĩa.

| Doc | Quy ước 5/6 | Sở hữu |
|---|---|---|
| `turn-and-sandbox.md` | ✅ đủ | ✅ không chồng |
| `readiness-and-plugins.md` | ✅ đủ | ✅ không chồng |
| `knowledge-system.md` | ❌ thiếu cả `Phạm vi:`, "Guard ở đâu", và mục giới hạn | ❌ **chồng 4 file** |

`knowledge-system.md` mô tả 13 file. Trong đó:

- `dify-io.ts` · `marketplace.py` · `lint_plugin_hashes.py` — **`readiness-and-plugins.md` sở hữu**;
- `ask.ts` — **`turn-and-sandbox.md` sở hữu**;
- `orchestrator.ts` · `scaffold.ts` — **không doc nào sở hữu** (cũng liệt kê ở §Bề mặt chưa có chủ).

Hệ quả đang xảy ra: dòng `{{KNOWLEDGE}}` trong `knowledge-system.md` tóm tắt *"rỗng nếu không có
creds"*, còn `readiness-and-plugins.md` §5 — doc **sở hữu** cơ chế đó — mô tả chính xác (ba nhánh độc
lập; chỉ null khi **cả ba** fail). **Khi hai doc lệch nhau, doc sở hữu file là doc đúng.**

Nguyên nhân là cấu trúc, không phải sơ suất: `knowledge-system.md` cắt theo **chủ đề** ("tri thức"),
mà chủ đề đó xuyên qua mọi giai đoạn — nên nó buộc phải với sang file của doc khác. Hai doc còn lại
cắt theo **giai đoạn xử lí + tập file**, nên chúng tile được.

## Bề mặt chưa có doc sở hữu

**Không doc nào mô tả** — chỉ đọc được từ code:

| Nhóm | File |
|---|---|
| Điều phối & gate | `orchestrator.ts` *(trừ chỗ tiêm `{{KNOWLEDGE}}`)* · `orchestrator-shared.ts` · `gate.ts` · `state/task.ts` · `routes/tasks.ts` · `routes/ui.ts` |
| Scaffold & layout | `scaffold.ts` *(trừ prelude seed)* · `project-create.ts` · `slug.ts` · `init_project.py` |
| Dify I/O & import | `import.ts` · `base-import.ts` · `live-test.ts` · `recovery.ts` · `sync.py` |
| Artifact & xuất | `artifacts.ts` · `attachments.ts` · `diff.ts` · `bundle.ts` · `zip.ts` · `reveal.ts` · `dossier.ts` |
| Đo & sự kiện | `cost.ts` · `cost-cause.ts` · `run-events.ts` · `run-transcript.ts` · `build-info.ts` · `criteria.ts` |
| Promote & provenance | `promote.ts` · `promote_gate.py` · `provenance.py` · `check_provenance.py` · `sources.py` |
| Dev | `dev-rebuild.ts` · `routes/dev.ts` |
| Định nghĩa dùng chung | `linters.ts` — `LINTERS`/`lintClean`, **nguồn duy nhất** cho số linter, hai doc đã trỏ vào nhưng không doc nào sở hữu · `schemas/gen_schema.py` |
| Web | `web/src/lib/i18n.ts` · `crumb.ts` · `dev.ts` · `diff-parser.ts` · `gate-foot.ts` · `markdown.ts` · `phase.ts` · `slug.ts` · `thread-persist.ts` · `attachments.ts` |

> `web/src/lib/i18n.ts` **chịu lực nhưng chưa có chủ**: cả `readiness-and-plugins.md` (§7
> Localization) lẫn `turn-and-sandbox.md` (§2.1, note wording-stable) đều **phụ thuộc** vào hợp đồng
> "mọi chuỗi tầng này phát ra đều có frame JA" — nhưng không doc nào sở hữu file định nghĩa hợp đồng đó.

## Không thuộc thư mục này

| Doc | Vì sao |
|---|---|
| [`../architecture.md`](../architecture.md) | **Lý do** kiến trúc (*"vì sao"*), không phải trạng thái |
| [`../GUIDE.md`](../GUIDE.md) | Hướng dẫn vận hành cho người |
| [`../runtime-supplement.md`](../runtime-supplement.md) · [`../plugin-capabilities.md`](../plugin-capabilities.md) | **Dữ liệu tham chiếu** về hành vi Dify/plugin — doc state trỏ sang, không nuốt vào |
| [`../../AGENTS.md`](../../AGENTS.md) | Luật cho agent (chỉ thị), không phải mô tả |
