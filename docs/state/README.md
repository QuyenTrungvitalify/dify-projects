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
dối**, và không ai biết bản nào đúng. Kiểm bằng mắt: gom mọi dòng `Phạm vi:` phải phủ hết bề mặt,
không trùng.

**Guard ở đâu** (`tests/test_state_docs_ownership.py`): *ai* sở hữu file nào thì **không** test nào
gác — sở hữu khai bằng văn xuôi, thường là **một nửa**, chia tay giữa các doc; parser adjudicate việc
đó sẽ false-fail mỗi lần reformat. Cái được gác là phần không cần phán đoán: mọi file trong bề mặt
phải **được nhắc tới** ở đâu đó trong `docs/state/` (file mới mà không doc nào biết → bảng §Bề mặt
chưa có doc sở hữu ngầm hết thẩm quyền), và bảng đó không được chứa file **đã biến mất**.

## Bộ doc

| Doc | Trả lời | Sở hữu |
|---|---|---|
| [build-lifecycle.md](build-lifecycle.md) | Ai phát turn kế tiếp; build dừng/tiến/lỗi/huỷ/khôi phục ra sao; sống sót qua restart thế nào | `orchestrator.ts` · `orchestrator-shared.ts` · `gate.ts` · `phases.ts` · `state/task.ts` · `lock.ts` · `routes/tasks.ts` · `recovery.ts` |
| [turn-and-sandbox.md](turn-and-sandbox.md) | Một phase chạy ra sao; nó được phép làm gì; ai chặn; kiểm lại gì sau đó | `claude-session.ts` · `turn-runner.ts` · `shell.ts` · `hooks/permission-gate.ts` · `hook-check.ts` · `post-turn.ts` · `ask.ts` · `headless-settings.json` |
| [readiness-and-plugins.md](readiness-and-plugins.md) | Builder làm gì **sau khi** YAML đã có: user còn phải làm gì, nói ra sao, luật plugin nào khiến điều đó đúng | `runnability.ts` · `report.ts` · `dify-io.ts` *(**nửa** workspace-facts — xem dify-io.md §0)* · `lint_plugin_hashes.py` · `marketplace.py` · `templates/tool-catalog.json` · `e2e_check.py` |
| [dify-io.md](dify-io.md) | Cái gì rời khỏi máy này về phía Dify thật; đường nào; **nửa chừng hỏng thì sao** | `dify-io.ts` *(**nửa** transport/live — xem §0)* · `import.ts` · `base-import.ts` · `live-test.ts` · `sync.py` |
| [templates-and-promotion.md](templates-and-promotion.md) | Kệ mẫu có tầng nào, cái gì tìm ra chúng, một thứ **lên kệ** bằng đường nào | `templates/{patterns,library,_base,probes}/` · `promote.ts` · `promote_gate.py` · `provenance.py` · `check_provenance.py` · `build_index.py` · `sources.py` · `find.py` · `corpus/sources.yml` · `INDEX.md` · `tools/dify_base/index.json` · `THIRD_PARTY.md` |
| [run-artifacts.md](run-artifacts.md) | Một run để lại gì trên đĩa, export chứa gì, và vì sao không cái nào được phép làm hỏng một build | `run-events.ts` · `run-transcript.ts` · `dossier.ts` · `bundle.ts` · `zip.ts` · `cost.ts` · `cost-cause.ts` · `build-info.ts` · `criteria.ts` · `diff.ts` · `reveal.ts` · `server/lib/attachments.ts` · `artifacts.ts` *(**nửa** đọc-artifact — xem §Phạm vi)* |
| [scaffold-and-layout.md](scaffold-and-layout.md) | Cây `projects/<project>/<workflow>/` 2 tầng sinh ra thế nào, ở đâu, khi nào; slug derive/sanitize/va chạm ra sao | `scaffold.ts` *(`ensureScaffold` · `scaffoldAtSpecGate` · `relocateRunArtifacts`; **nửa** scaffold+slug của hai prelude)* · `project-create.ts` · `slug.ts` · `init_project.py` · `routes/ui.ts` *(**chỉ** `POST /api/projects`)* |
| [ui-surface.md](ui-surface.md) | User thấy gì, làm được gì ở mỗi trạng thái; SSE truyền gì, store giữ gì, cái gì chỉ sống ở client | `web/src/store.ts` · `web/src/sse-client.ts` · **toàn bộ** `web/src/lib/`: `i18n.ts` · `gate-foot.ts` · `thread-persist.ts` · `crumb.ts` · `phase.ts` · `markdown.ts` · `diff-parser.ts` · `slug.ts` · `attachments.ts` · `dev.ts` |
| [knowledge-system.md](knowledge-system.md) | **BẢN ĐỒ, không phải doc trạng thái** — tri thức nào vào một build, và **doc nào sở hữu cơ chế**. Câu hỏi cắt ngang mọi giai đoạn nên không stage-doc nào trả lời trọn | **KHÔNG file nào** — nó chỉ trỏ, không mô tả cơ chế (quy ước 5/6 không áp, y như README) |

## Trạng thái tuân thủ

Sự thật về bộ doc này, cần để luật sở hữu ở trên có nghĩa.

| Doc | Quy ước 5/6 | Sở hữu |
|---|---|---|
| `build-lifecycle.md` | ✅ đủ | ⚠️ sở hữu **một phần** `phases.ts` + `routes/tasks.ts` (xem dưới) |
| `turn-and-sandbox.md` | ✅ đủ | ✅ không chồng |
| `readiness-and-plugins.md` | ✅ đủ | ✅ không chồng — chia đôi `dify-io.ts` **có khai báo hai chiều** (§0) |
| `dify-io.md` | ✅ đủ | ✅ không chồng — chia đôi `dify-io.ts` **có khai báo hai chiều** (§0) |
| `templates-and-promotion.md` | ✅ đủ | ✅ không chồng — khai rõ phần promote của `gate.ts`/`routes/tasks.ts`/`state/task.ts` **thuộc `build-lifecycle.md`**, chỉ trỏ sang |
| `run-artifacts.md` | ✅ đủ | ✅ không chồng — nhận **nửa** `artifacts.ts` (đọc-artifact) và khai **hai chiều**: nửa cây sidebar vẫn nằm ở §Bề mặt chưa có chủ |
| `ui-surface.md` | ✅ đủ | ✅ không chồng — nhận trọn `web/src/lib/`, và khai rõ `api.ts` · `types.ts` · `components/**` · `main.tsx` · `data.ts` **vẫn chưa có chủ** |
| `scaffold-and-layout.md` | ✅ đủ | ⚠️ nhận `scaffold.ts` trừ **nửa seed** — nửa đó **nay vô chủ** (xem dưới); nhận **chỉ** `POST /api/projects` của `routes/ui.ts`, khai rõ phần còn lại chưa có chủ |
| `knowledge-system.md` | — **là bản đồ, không phải doc trạng thái** (quy ước 5/6 không áp) | ✅ sở hữu **0 file** → không thể chồng |

**`dify-io.ts` do HAI doc chia nhau**, cắt theo chức năng chứ không theo dòng:

- `readiness-and-plugins.md` §5 — nửa **workspace-facts** (`harvestWorkspaceFacts`, `loadWorkspaceFacts`,
  `enabledModelCount`, `knowledgeBlock`, `parsePlugins`, `parseDatasets`, `WorkspaceFacts`, `HarvestSource`);
- `dify-io.md` §0 — nửa **transport/live** (creds, `runSyncPy`, redaction, push/pull/reconcile, model,
  live ops, URL).

Chia đôi là hợp lệ vì **cả hai phía đều khai ra**, và `dify-io.md` §0 liệt kê từng export về đâu — gộp
hai bảng đó phải phủ đúng file, không trùng. Cả hai dòng `Phạm vi:` nay đều kèm chữ **"nửa"** + trỏ
sang nửa kia, nên đọc riêng một file cũng không tưởng nó sở hữu cả `dify-io.ts`.

**`i18n.ts` giờ có chủ (`ui-surface.md` §6 — Phạm vi của nó khai đích danh), và hai doc phụ thuộc vào
nó ở hai form khác nhau.** Ngoài chủ, không doc phụ thuộc nào khai `i18n.ts` trong `Phạm vi:`, nên
không có chồng sở hữu. Nhưng:

- `turn-and-sandbox.md` §2.1 **trỏ sang một dòng** — đúng form luật sở hữu yêu cầu.
- `readiness-and-plugins.md` §7 (Localization) **mô tả lại** cơ chế `localizeNotes` mà `ui-surface.md`
  §6.3 sở hữu. Hai bản hiện **không lệch nhau**; theo luật, bản của doc sở hữu là bản đúng khi chúng lệch.

Câu *"Hiện mọi chuỗi tầng này phát ra đều có frame"* ở `readiness-and-plugins.md` §7 **vẫn đúng theo
đúng nghĩa đen của nó**: mọi chuỗi `report.ts`/`runnability.ts` phát ra đều có frame (kiểm bằng cách chạy
từng chuỗi qua `localizeNotes`). Chuỗi **không** có frame đến từ `import.ts` — tầng khác, `dify-io.md` sở
hữu — và không doc nào từng khẳng định điều gì về chúng. Chi tiết + danh sách bốn chuỗi: `ui-surface.md` §6.3.

**`knowledge-system.md` đã hạ cấp thành BẢN ĐỒ** — sở hữu 0 file, không mô tả cơ chế nào, chỉ trỏ
sang doc sở hữu. Trước đó nó chồng 9 file và thiếu cả 3 quy ước; nó cắt theo **chủ đề**, mà chủ đề
xuyên qua mọi giai đoạn, nên nó va vào **mọi** stage-doc sinh ra sau (4 → 6 → 9 file chồng khi bộ doc
lớn dần). Các doc còn lại cắt theo **giai đoạn xử lí + tập file**, nên chúng tile được. Sở hữu 0 file
thì không có mô tả độc lập nào để trôi — vùng chồng biến mất theo cấu trúc, không phải nhờ kỉ luật.

**Hai hệ quả phải ghi, vì hạ cấp = nhả sở hữu:**

1. **Nguyên tầng validation nay VÔ CHỦ** — `linters.ts` · `validate_workflow.py` · `lint_refs.py` ·
   `lint_node_bodies.py` · `analysis.ts` · `schemas/dify-dsl-0.6.0.json` · `gen_schema.py`. Bản đồ
   trước đây tả **một nửa** cụm này. Nửa-tả tệ hơn bỏ trống (bảng ghi "đã có chủ" nên không ai đưa nó
   vào danh sách chưa-có-chủ), nên nay nó khai vô chủ đúng thực tế → §Bề mặt chưa có doc sở hữu.
   **Đây là vùng đáng viết tiếp nhất**: `lintClean` là điều kiện đóng gate ③ **và** tiền-điều-kiện
   Import ④, nhiều doc trỏ vào `linters.ts` như "nguồn duy nhất" cho số linter, nhưng không doc nào
   tả **từng linter gác gì**.
2. **Nửa seed của `scaffold.ts` nay vô chủ** — `scaffold-and-layout.md` khai `ensureScaffold` ·
   `scaffoldAtSpecGate` · `relocateRunArtifacts` + nửa scaffold-slug của hai prelude; nửa **seed**
   (pull từ Dify / snapshot local) trước do bản đồ giữ, nay không ai giữ.

**Ranh giới `build-lifecycle.md` khai không trọn** — hai file nó nhận chỉ được tả một nửa:

- `phases.ts`: sở hữu **cấu trúc** — `PHASES` (4 def, `kind` turn/backend, `promptFile`,
  `artifactRel`), `renderPrompt`, `patternPath`, `languagePin`, hợp đồng "mọi token luôn được thay".
  **Chưa có chủ**: `{{KNOWLEDGE}}` lấy nội dung từ đâu (`readiness-and-plugins.md` §5 mô tả cơ chế
  harvest nhưng không khai sở hữu `phases.ts`) và **ý nghĩa từng token** với skill body đọc nó.
- `routes/tasks.ts`: sở hữu **vòng đời build** — `/api/tasks`, `/confirm`, `/reply`, `/cancel`,
  `/restore`, `/live-test`, `PATCH /:id`, `dispatch`/`failSafe`, và rẽ nhánh `task.kind === 'promote'`.
  **Chưa có chủ**: `/ask` (thân nó ở `ask.ts`, thuộc `turn-and-sandbox.md`, nhưng route thì không doc
  nào khai). Thân luồng promote phía sau nhánh đó (`lib/promote.ts`) →
  `templates-and-promotion.md` §4.

**Khi hai doc lệch nhau, doc sở hữu file là doc đúng.** Luật này vẫn còn việc để làm: `readiness-and-plugins.md`
§7 mô tả lại `localizeNotes` mà `ui-surface.md` §6.3 sở hữu (hai bản hiện không lệch — xem trên).

## Bề mặt chưa có doc sở hữu

**Không doc nào mô tả** — chỉ đọc được từ code:

| Nhóm | File |
|---|---|
| Điều phối & gate | `routes/ui.ts` *(trừ `POST /api/projects` — `scaffold-and-layout.md` sở hữu; `POST /api/bases` thân ở `base-import.ts`/`dify-io.md`)* · `routes/tasks.ts` *(chỉ `/ask`)* · `phases.ts` *(chỉ nguồn `{{KNOWLEDGE}}` + ý nghĩa từng token)* |
| Artifact & xuất | `artifacts.ts` *(chỉ **nửa cây sidebar** — `buildTree` · `listActiveTasks` · `readNestedScalar` + helper riêng của chúng; nửa đọc-artifact thuộc `run-artifacts.md`)* |
| Dev | `dev-rebuild.ts` · `routes/dev.ts` |
| **Tầng validation** *(vùng vô chủ lớn nhất — chịu lực)* | `linters.ts` — `LINTERS`/`lintClean`, tự nhận là **nguồn duy nhất** cho số linter, ba doc đã trỏ vào nhưng không doc nào sở hữu; `promote_gate.py:41` giữ **bản sao thứ hai** viết tay của cùng danh sách, không test nào so hai bên (`templates-and-promotion.md` §8) · **ba script linter** `validate_workflow.py` · `lint_refs.py` · `lint_node_bodies.py` — **không doc nào tả từng cái gác gì**, dù `lintClean` là điều kiện đóng gate ③ **và** tiền-điều-kiện Import ④ *(`lint_plugin_hashes.py` là linter DUY NHẤT có chủ → `readiness-and-plugins.md` §3)* · `analysis.ts` (fold `analyze.json` → task: `analysisPattern`/`analysisFeatures`) · `schemas/dify-dsl-0.6.0.json` (`$defs.NodeData_*`, reader duy nhất là `lint_node_bodies.py`) · `schemas/gen_schema.py` |
| Scaffold — nửa seed | `scaffold.ts` *(**chỉ** nửa seed: pull từ Dify · snapshot local → `{{SEED_PATH}}`; phần còn lại `scaffold-and-layout.md` sở hữu)* |
| Web (ngoài `lib/`) | `web/src/api.ts` (shape HTTP + `ApiError`) · `web/src/types.ts` (`Wire*` — hợp đồng wire, không gì so nó với cái server thật phát ra) · `web/src/components/**` (gồm `App.tsx`/`Chat.tsx` — nơi mọi thứ thật sự render, và **không có test nào**) · `main.tsx` · `data.ts` |
| SSE transport | `server/plugins/sse.ts` · `sse-origin-check.ts` — `RingBuffer` + replay theo `Last-Event-ID`, heartbeat, backpressure. Ngoài bề mặt chịu luật, nhưng `ui-surface.md` §2 phụ thuộc trực tiếp vào nó: client **không bao giờ gửi** `Last-Event-ID`, nên nhánh replay của file này không chạy. |

## Không thuộc thư mục này

| Doc | Vì sao |
|---|---|
| [`../architecture.md`](../architecture.md) | **Lý do** kiến trúc (*"vì sao"*), không phải trạng thái |
| [`../GUIDE.md`](../GUIDE.md) | Hướng dẫn vận hành cho người |
| [`../runtime-supplement.md`](../runtime-supplement.md) · [`../plugin-capabilities.md`](../plugin-capabilities.md) | **Dữ liệu tham chiếu** về hành vi Dify/plugin — doc state trỏ sang, không nuốt vào |
| [`../../AGENTS.md`](../../AGENTS.md) | Luật cho agent (chỉ thị), không phải mô tả |
