# Hiện trạng — kệ mẫu & promotion

Cái kệ mẫu có những tầng nào, cái gì tìm ra chúng, và một thứ được **lên kệ** bằng đường nào.

Phạm vi: `templates/patterns/` · `templates/library/` · `templates/_base/` · `templates/probes/` ·
`promote.ts` · `promote_gate.py` · `provenance.py` · `check_provenance.py` · `build_index.py` ·
`sources.py` · `sources_admin.py` · `find.py` · `enrich.py` · `catalog.py` · `promote-hint.ts` ·
`shelf-stats.ts` · `web/src/lib/shelf.ts` · `corpus/sources.yml` · `INDEX.md` ·
`tools/dify_base/index.json` · `tools/dify_base/enrichment.json` ·
`tools/dify_base/collected.json` · `THIRD_PARTY.md`.

> **Tầng enrichment (spec 076 E1).** `enrich.py` quản lý `enrichment.json` — metadata tiếng Anh do LLM
> sinh offline (`summary_en`/`tags`/`when_to_use`/`gotchas`), keyed `source/file` + `orig_sha256`. Là
> **tri thức phái sinh, tracked, tách khỏi corpus read-only**; `build_index.py` merge vào `index.json`
> lúc build (degrade khi thiếu, cảnh báo khi `orig_sha256` lệch). `find.py --name` tra cả trường
> enriched, và tie-break sort theo precedence-rank (`patterns > library > project > corpus:* > skill-assets`).

> **Trí nhớ thu thập + nudge tự-gặt (spec 078 S1/S2).** `catalog.py` quản lý `collected.json` —
> fingerprint shape (multiset node-type + số edge **sau** khi bỏ helper-node, ví dụ
> `agent:1|end:1|start:1/e:2`, bất biến qua đổi tên/dịch prompt) + trí nhớ quyết định săn
> (`record`/`hunt-log`, skill `/scout` điều phối). Luật cứng: `dup` CHỈ theo sha256; trùng
> fingerprint là `near-dup` (shape <4 node = tín hiệu yếu — nhiều workflow hợp lệ cùng shape, khác
> prompt). `seed` dựng shelf-set từ đúng các scan-root của `build_index` (mirror cả gitignore-filter
> `projects/`); ghi `collected.json` chỉ qua `catalog.py` (turn bị deny bởi `Write(tools/**)`).
> Nudge ④: `promote-hint.ts` (report.ts gọi) chạy `catalog.py check --shelf` — parse **LIVE**
> `patterns`+`library`, KHÔNG đọc seed (self-quench sau promote) — và khi verdict `new` + build
> from-scratch (`workflow===null && seedPath===null`) + lint-sạch + ≥4 node thì ghi field
> **dev-only** `report.promote_hint`/`task.promoteHint` (DevPanel render dưới `devMode`) — không
> bao giờ vào `notes` (userview có regression lock trong `e2e_check.py`). Nudge chỉ *trỏ* nút
> Promote sẵn có, không thêm đường ghi kệ.
> Đã cân và LOẠI, đừng đề xuất lại: **hunter-bot UI** (nút dev + backend vet + bảng duyệt) — chỉ mở
> lại khi có **≥3 hunt-log thật** với median ứng-viên-mới-đáng-nạp **≥3/lần**; **bulk ingestion**
> hàng trăm file — nhiễu cho ranking và cho tầng reference của ③, chất lượng hơn số lượng;
> **cron hoá `/scout`** — săn là hành vi chủ động của người, còn nguồn đã vendor thì
> `sync-corpus.yml` đã canh.

> **Shelf dashboard (spec 080).** `catalog.py stats --json` = MỘT JSON toàn cảnh kệ (tier/feature/
> complexity/tags từ index.json · diversity/hunts từ collected.json — chỉ entry trên-kệ · enrichment
> qua `enrich.check_data()` · doctor curated live-parse + house-từ-collected · timeline promote đọc
> `x-provenance` trên **cả** `patterns/` lẫn `library/` — `finalizePromotion` stamp patterns ·
> sources + lock). Read-only tuyệt đối. Đường lên màn hình: `GET /api/dev/shelf`
> (`shelf-stats.ts` passthrough, mount sau `BUILDER_DEV=1`) → overlay `ShelfOverlay` (nút 📊 cạnh
> RebuildButton, `devMode`); derivation thuần cho render ở `web/src/lib/shelf.ts`. Số đo xem bằng
> cách MỞ màn hình/chạy CLI — không chép vào doc.
> Hai ràng buộc cứng của bề mặt này: **mọi con số compose ở python** (`catalog.py stats`) —
> `shelf-stats.ts` và FE **không được** tự đọc `index.json`/`collected.json`/`sources.yml` để tính
> cho tiện, nếu không registry có **parser thứ ba** và đúng cái bẫy flat-schema ở §6 tái diễn ở tầng
> khác; và **không chart lib, không SSE** cho màn dev — bar/tile bằng CSS thuần, một màn hình quản kệ
> không đáng một dependency.

Nằm cạnh nhưng **không** thuộc doc này — chỉ trỏ sang:

- `templates/tool-catalog.json` → [readiness-and-plugins.md](readiness-and-plugins.md) §4.
- `gate.ts` (`computePromoteGate`: bốn state, action id, nhãn nút) · `routes/tasks.ts` (rẽ nhánh
  `task.kind === 'promote'`) · `state/task.ts` (`Task.promote`, `PromoteVerdict`) →
  [build-lifecycle.md](build-lifecycle.md). Doc này mô tả phía `promote.ts` **gọi** chúng, không mô tả
  chúng.
- `scripts/lib/sources.sh` (parser thứ hai của registry) và `.claude/skills/dify-build/promote.md`
  (thân prompt distill) nằm ngoài bề mặt chịu luật sở hữu.

> - Chuỗi trong backtick là **nguyên văn** code phát ra hoặc đọc — không dịch.
> - Tài liệu này mô tả **bất biến**, không chứa số đo. Số liệu (số file index, số pattern, thời gian)
>   lấy bằng cách chạy, không đọc ở đây.

---

## 1. Bốn tầng trên kệ

| Thư mục | `source` trong index | Là gì | Ai ghi vào |
|---|---|---|---|
| `templates/patterns/` | `patterns` | Archetype workflow đã vetted — tầng cao nhất | `finalizePromotion()` (`promote.ts`, sau khi người Approve) hoặc người viết tay |
| `templates/library/` | `library` | Workflow chuẩn hoá từ **một** mẫu corpus, bắt buộc mang header `x-provenance` | Skill `template-promote`, tay, một file mỗi lần |
| `templates/_base/` | `starter` | Skeleton **project/workflow**, không phải workflow chạy được | Người; `init_project.py` copy từ đây ra `projects/<slug>/` |
| `templates/probes/` | — **không được index** | Workflow dò môi trường (`stdlib_check.yml`) | Người |

Hai bất thường ở bảng trên, cả hai đều là trạng thái thật:

- **`templates/probes/` không nằm trong `STATIC_SCAN`** (`build_index.py:38-46`). Nó không phải scan
  target, nên `find.py` **không bao giờ** trả về probe. Đường vào duy nhất là link tay trong
  `AGENTS.md`. Chạy `find.py --name stdlib` → `No matching templates.`
- **`starter` là scan target nhưng luôn rỗng.** Glob của static root là `*.yml`; file YAML duy nhất
  dưới `templates/_base/` là `.dify-workspace.yaml` — đuôi `.yaml`, không khớp. `INDEX.md` vẫn quảng
  cáo `starter` trong danh sách tầng curated ở phần mở đầu, còn bảng thì không có dòng nào.

`templates/patterns/*.yml` chịu hai convention được test cưỡng chế: mọi file phải có `# Use case:` và
ít nhất một `# TODO:` (`test_pattern_consistency.py`). `templates/library/` **không** chịu hai luật
này; nó chịu luật provenance ở §5.

Tầng `patterns` còn chịu hai luật nội dung (luật văn xuôi — không test nào thực thi):

- **Pattern sinh từ build đã chứng minh, không viết tay từ trí nhớ.** Shape node viết tay từ trí nhớ
  lặp lại lỗi của `node_types.md` (doc đó dạy `trigger-webhook` có field `variables:` không tồn tại):
  vì `NodeData_*` trong schema không đặt `additionalProperties: false`, một shape sai **import sạch
  rồi chết lúc runtime**. Nguồn hợp lệ: build 4-linter-sạch đã qua Dify thật (header pattern ghi xuất
  xứ), hoặc mẫu corpus đi đường promote §4.
- **Pattern và schema là hai tầng tri thức, không thay nhau.** `lint_node_bodies.py --dump-schema
  <node-type>` trả *hợp đồng field* — cái gì qua linter; pattern trả *ví dụ sống* — giá trị thật, nối
  dây, GOTCHA vận hành (`timezone: Asia/Tokyo`, `X-ChatWorkToken` + `no-auth`). Build cần cả hai: có
  schema không miễn được pattern, và ngược lại.

Cả ba tầng `patterns` / `library` / `probes` đi qua **4 linter + JSON Schema + guard version DSL** ở
`.pre-commit-config.yaml` (regex `^(templates/(patterns|probes|library)/.*\.ya?ml|…)$`). CI chạy
`pre-commit run --all-files`, nên đó là guard thật của tầng `library` và `probes` — pytest chỉ quét
`templates/patterns/`. `templates/_base/` **không** nằm trong regex đó; chỉ `yamllint` (regex rộng hơn — nhánh `templates/` của `files:` thật, xem `.pre-commit-config.yaml:50`;
`^templates/.*\.ya?ml$`) chạm tới `.dify-workspace.yaml`.

## 2. Index — sinh tự động, không sửa tay

`build_index.py` ghi **hai** file, mỗi lần chạy ghi đè cả hai:

```
.venv/bin/python tools/dify_base/build_index.py
```

| File | Trạng thái git | Ai đọc |
|---|---|---|
| `tools/dify_base/index.json` | **gitignored** (`.gitignore:2`) | `find.py` — reader duy nhất |
| `INDEX.md` | tracked | người |

Vì `index.json` gitignored, **clone tươi không có index**: `find.py` chết cho tới khi `build_index.py`
chạy. `scripts/setup.sh` chạy nó lúc bootstrap; `scripts/update_corpus.sh` chạy lại sau mỗi lần
refresh corpus. Index **không** rebuild theo mỗi build — nó chỉ dựng lại ở hai mốc đó, nên tốc độ
build không phụ thuộc kích thước index.

**Scan target** (`scan_targets()`): 7 static root cứng trong `STATIC_SCAN`, cộng một root cho **mỗi**
source `indexed: true` trong registry (§6), tag `corpus:<name>`. Static root quét `rglob("*.yml")`
(đệ quy); corpus root quét `glob(<dsl_glob>)` (neo, không đệ quy). Nhánh chọn giữa hai kiểu là
`"/" in pattern` — một `dsl_glob` không chứa `/` sẽ âm thầm rơi vào nhánh `rglob`.

**`analyze()` biết gì:** `name`/`description` là **passthrough thẳng** từ `app.name`/`app.description`
(`description` cắt còn 100 ký tự) — không có tầng ngữ nghĩa nào được sinh thêm. `node_types` bỏ các
node helper của container (`iteration-start`, `loop-start`, `custom-iteration-start`,
`custom-loop-start`). `has_trigger` là **key tính toán**, không phải entry của `INTERESTING_NODE_TYPES`
— nó bật khi có bất kỳ node nào `type` bắt đầu bằng `trigger-`; bên cạnh nó, mỗi biến thể **thực sự
xuất hiện** phát thêm key riêng (`has_trigger_webhook` / `has_trigger_schedule` /
`has_trigger_plugin`) — chỉ phát biến thể đã thấy, để `--list-features` không quảng cáo khoá rỗng. `has_file_input` đọc `variables` của
node `start`, bật khi có `type` ∈ `file` \| `file-list`. `plugins` cắt
`dependencies[].value.marketplace_plugin_unique_identifier` tại `:` đầu tiên.

`complexity` là heuristic thuần đếm: `Simple` khi ≤4 node **và** không có `iteration`/`loop`;
`Complex` khi ≥10 node **hoặc** (có iteration/loop **và** ≥7 node); còn lại `Medium`.

**Gitignore filter chỉ áp cho `projects/`** — và đây là chỗ dễ "sửa cho hợp lý" nhất trong file này.
`_filter_gitignored()` trông như nên áp cho mọi root ("index phải soi repo"), nhưng
`collect_entries()` chỉ gọi nó khi `source_tag == "project"` (`build_index.py:300-301`). Lý do:
`corpus/*/` và `skills/*/` **gitignored theo thiết kế** (`.gitignore:5-6`) — chúng là clone read-only
mà ta **muốn** index. Mở rộng filter ra mọi root sẽ xoá sạch hai tầng đó khỏi index. Regression này
**đã xảy ra một lần**: filter từng chạy toàn cục và âm thầm nuốt mọi file tên ASCII (file tên non-ASCII
sống sót chỉ vì `git check-ignore` bọc chúng trong quote octal, làm hỏng phép so sánh membership).
`test_gitignored_clones_are_indexed_including_ascii_names` gác chiều này.

**File parse lỗi biến mất im lặng:** `analyze()` trả `None` khi YAML hỏng hoặc không phải dict; file
rơi vào list `skipped` và `main()` chỉ in **số lượng**, không in tên.

`INDEX.md` sinh bởi `write_markdown()` — **đừng chép nội dung nó vào bất kỳ doc nào**; nội dung là hàm
của đĩa tại thời điểm chạy. Nó gồm: câu đầu ghi số file, note registry (§6, đánh dấu `intake-only` cho
source `indexed: false`), Main Table, "By Feature", "By Complexity". Link file đi qua
`_md_link_target()` — `quote()` giữ `/`, nên dấu ngoặc/khoảng trắng/CJK trong tên file không phá
Markdown link.

## 3. `find.py` — chọn thế nào

Đọc `index.json`, **chỉ nó**. Python thuần (`json`, `argparse`, `pathlib`) — không AI, không embedding,
không network. Không có index thì in `❌ Index not found at <path>` kèm lệnh rebuild, trả `1`.

`feature_key()` chuẩn hoá tên feature: `--has http-request` → khoá `has_http_request`. Mọi filter
AND với nhau; `--has` và `--no` cộng dồn được.

Worked-example didactic (vd `error-strategy.yml`, spec 085) **cố ý nằm NGOÀI kệ** — ở
`.claude/skills/dify-build/references/`, được phase-doc trỏ đích danh, KHÔNG vào
`templates/patterns/`: bộ chọn gap-reference greedy ưu tiên "phủ nhiều nhất → ít node nhất" nên
một file dạy-học 5–6 node sẽ chiếm slot của example thật giàu hơn cho cùng feature. Turn Read
được (deny-read chỉ áp `~/.claude`) nhưng không sửa được (deny Write `.claude/**`).

`--source` là **prefix-match theo namespace**: `--source corpus` khớp mọi `corpus:<name>`;
`--source corpus:<name>` khớp đúng một; tag trần (`patterns`, `library`, `project`…) khớp chính xác.
Điều kiện thật: `e['source'] == s or e['source'].startswith(s + ':')`.

**Thứ tự trả về — precedence là LUẬT TRONG CODE.** Khi kết quả không được rank theo `--name`, sort key
là `(COMPLEXITY_ORDER[complexity], source_rank(source), file)`. `source_rank` ánh xạ mỗi tầng thành
một hạng (`patterns` → `library` → `project` → `example`/`starter` → `corpus:*` → `skill-assets`,
tag lạ xếp cuối), **không** so chuỗi `source`. Đây là chỗ từng sai: tie-break cũ so alphabet nên
`corpus:*` nổi lên trên `patterns` (c < p) — đúng cái đảo ngược mà prose cảnh báo. Thứ tự ưu tiên
`patterns > library > project > corpus:* > skill-assets` vì thế sống nhất quán ở hai dạng: prose cho
người đọc (`write_markdown()` in đầu `INDEX.md`, và `AGENTS.md` §3) và `source_rank` thực thi nó.

**`--name` rank theo BM25**, không còn substring thuần: tokenize text enriched (`summary_en` + tags +
name + description), hyphen→space nên `data analysis` khớp tag `data-analysis`; IDF tính trên **toàn
index** để từ phổ biến (`llm`, `workflow`) không áp đảo. Có entry ăn điểm → **relevance dẫn**,
precedence chỉ phá hoà. Không entry nào ăn điểm → rơi về **substring fallback** đúng hành vi cũ, nên
`--name` không bao giờ trả ít hit hơn trước khi có ranking.

Phase ① tra kệ **hai lượt** và ghi cả hai lệnh vào `find_query`: lượt *feature* (`--has …`) và lượt
*intent* (`--name "<từ khoá tiếng Anh>" --full`). Hit của lượt intent được đóng khung là **reference
— adapt, don't clone**, không phải mẫu để chép.

**Richer ≠ safe.** Corpus là DSL 0.1.x thô: nó chỉ được dùng làm *tham khảo để adapt*, không bao giờ
là "mẫu vetted để chép". Mọi lần mở rộng pool reference sang một tầng mới phải mang theo phân biệt
đó — đừng ngầm coi tầng mới sạch như `patterns`.

**Đã cân và LOẠI, đừng đề xuất lại**: embeddings / dense retrieval / reranker cho tầng chọn mẫu này.
Ở quy mô vài chục entry, BM25 zero-dep đã đủ; chỉ xét lại khi index vượt **vài trăm** entry có mô tả
tiếng Anh sạch **và** query thực tế nghiêng hẳn về paraphrase.

**Tên feature không tồn tại trong index bị báo tường minh, phân biệt với kết quả rỗng thật.**
`--has tools` (thay vì `tool`) tạo khoá `has_tools` — không entry nào mang nó → in
`❌ unknown feature: …` kèm **danh sách khoá hợp lệ** (vẫn trả `0` để consumer script không gãy;
`tests/test_find_unknown_feature.py` pin hợp đồng này). Kết quả rỗng *thật* — mọi khoá đều hợp lệ
nhưng không entry nào khớp tổ hợp — mới in `No matching templates.`. Ranh giới cần biết: một feature
chỉ "hợp lệ" khi ≥1 workflow đã index dùng nó, nên khoá đúng chính tả mà chưa từng xuất hiện vẫn bị
báo unknown.

Không truyền filter nào → chế độ summary (đếm theo source + complexity + gợi ý lệnh), trả `0`.
`--limit` mặc định 20.

## 4. Promote — pipeline gate **thứ hai**

Promote là một `Task` với `kind: 'promote'`, và nó **không đi qua phase FSM ①②③④** — cơ chế rẽ nhánh
(`routes/tasks.ts` dispatch sang `lib/promote.ts` trước khi chạm `confirmAdvance`/`replyWithin`;
`computePromoteGate` tách khỏi `computeGate`) thuộc [build-lifecycle.md](build-lifecycle.md). Phần dưới
mô tả phía bên kia đường rẽ: `lib/promote.ts`.

Vì sao tách: hai pipeline trả lời hai câu khác nhau. FSM hỏi *"workflow này có đúng ý user không"* và
kết ở một file trong `projects/`. Promote hỏi *"thứ này có an toàn để **dạy lại** cho mọi build sau
không"* và kết ở một file trong `templates/`. Cái sau là chỗ một lỗi trở thành **lây lan** — pattern
hỏng nằm trên kệ sẽ dạy cái hỏng cho mọi build seed từ nó. Nên nó có gate riêng, verdict riêng, và
**`finalizePromotion` là đường ghi duy nhất** vào kệ — auto-approve (dưới) chỉ *gọi sớm hơn* đúng hàm
đó, không bao giờ mở một đường ghi thứ hai.

```
POST /api/promote
  → startPromote        B1: promote_gate.py check <source> --json
      ├─ eligible:false → gate `promote_blocked`  (KHÔNG spawn turn, KHÔNG ghi gì)
      └─ eligible:true  → runDistillTurn
            MỘT turn `claude`, đọc source như DATA, ghi vào STAGING:
              apps/builder/.runs/<taskId>/promote/<slug>.yml
          → B2′: promote_gate.py check <source> --distilled <staged> --json
              ├─ không sạch → gate `promote_distill_failed`
              └─ sạch       → ghi rule vào linter-candidate → KIỂM VA SLUG ngay cuối turn:
                    ├─ slug CHƯA tồn tại → finalizePromotion  (auto, KHÔNG park review)
                    └─ slug ĐÃ tồn tại   → gate `reviewCollision`
  → promoteConfirm      Approve  → finalizePromotion  ← ĐƯỜNG GHI DUY NHẤT vào templates/
  → promoteReply        "Request changes" ở review/distill_failed → chạy lại turn, có note lái
```

**`<source>` là `task.promote.sourceFile`, đến từ HAI cửa** (`promote.ts`): `resolvePromoteSource` cho
một workflow project local, `resolvePastedPromoteSource` cho một **YAML dán ngoài** (slug từ `app.name`,
sha256 của bytes). Với cửa ngoài, `sourceFile` là một file staged `apps/builder/.runs/<taskId>/source.yml`
mà `runGateCheck` (B1/B2′) + turn distill đọc y như một workflow bình thường; **route ghi + đặt tên
staging đó** (và vì sao ở run-dir root) → [build-lifecycle.md](build-lifecycle.md). `probe_source` skipped
ở **cả hai** cửa (creds strip), nên external qua B1 bằng lint-only y như local.

**Turn distill không thể ghi vào kệ, kể cả khi nó muốn.** Allowlist ghi của
`hooks/permission-gate.ts` (`pathIsProtectedWrite`) chỉ mở `projects/`, run dir của **chính** task, và
`.vscode/settings.json`; `templates/` rơi vào nhánh `return true` cuối = protected. `finalizePromotion`
chạy ở **backend, ngoài mọi turn**, sau khi người bấm Approve.

**Nút promote không bao giờ chạm Dify.** `runPython` xoá mọi biến `DIFY_*` khỏi env con
(`shell.ts:38`), nên `probe_source()` thấy thiếu cred và trả `skipped` ở **cả hai** lần gate.

### Verdict của `promote_gate.py check`

| khoá | nghĩa |
|---|---|
| `eligible` | `false` khi có **bất kỳ** lint reason, hoặc probe `failed` |
| `reasons` | lint fail (source, **và** distilled nếu có `--distilled`) + probe failure |
| `warnings` | LLM node có model rỗng — **advisory, không chặn** |
| `probe` | `ok` \| `failed` \| `skipped` |
| `known_good_dify` | nội dung `.dify-tag`, **chỉ khi** `probe == 'ok'`; ngược lại `null` |

`check_lint()` chạy 4 script: `validate_workflow.py`, `lint_refs.py`, `lint_plugin_hashes.py`,
`lint_node_bodies.py` — bằng `.venv/bin/python` cứng trong `PYTHON`. Đã kiểm: bẻ một
`value_selector` thành node id không tồn tại rồi chạy `check … --skip-probe` → `✗ BLOCKED`, exit `1`,
reason nguyên văn `lint_refs.py exit 1 on …: value_selector: ['999999999', 'text'] → node '999999999'
not found in workflow`. Chạy trên `templates/patterns/multi-step-llm.yml` → `✓ ELIGIBLE`, exit `0`,
kèm ba dòng `⚠ … has an empty model` — **eligible vẫn đúng khi có warning**.

**Model rỗng là warning chứ không phải blocker** — và đây là chỗ thứ hai dễ "sửa cho hợp lý". Trực giác
nói model rỗng = "LLM chưa từng được nối" = chưa proven. Nhưng theo convention của Builder, model được
**auto-fill lúc deploy/live-test**, nên model rỗng là trạng thái **bình thường** của một build hợp lệ ở
đây. Chặn theo nó sẽ false-negative **mọi** build LLM from-scratch. `check_model_wiring()` vẫn báo cáo,
`gate()` chỉ đưa vào `warnings`.

**Probe `pending` không phải rejection.** Dify park import vì lệch version DSL ↔ server → `skipped`,
vẫn eligible. Thiếu cred → `skipped`, vẫn eligible (không chặn promote ngoài hiện trường vì thiếu
cred).

**Sweep orphan khi probe fail:** Dify **commit hàng app TRƯỚC khi validate**, nên một push FAILED vẫn
để lại app. `probe_source()` gọi `sync.py list`, tìm dòng chứa token cuối của probe name
(`[promote-gate] <stem>`), rồi `delete --app-id`.

### Kênh linter-candidate

`recordCandidateRules()` đọc `promote/notes.json` của turn (best-effort — thiếu/hỏng thì không ghi gì)
và với mỗi `{rule, citation}` gọi `promote_gate.py candidate`, ghi một bullet vào
`docs/linter-candidates.md`. Dedup là `if rule in body` — **substring test trên toàn bộ file**, không
phải so khớp dòng.

### Va slug

Kiểm va slug chạy ở **cuối turn distill** — không còn ở `promoteConfirm('approve')` như trước — vì
slug deterministic theo tên folder workflow nên biết trước. Chưa tồn tại → auto-finalize thẳng. Đã
tồn tại → **không ghi gì**, park ở state `reviewCollision` để người chọn ghi đè hay đặt tên mới (danh
sách state gate + nhãn nút → [build-lifecycle.md](build-lifecycle.md)). **Không bao giờ clobber im
lặng**: auto CHỈ áp cho pattern MỚI, còn update một pattern đã vetted thì luôn phải qua mắt người.
`firstFreePatternSlug()` thử `<slug>-2`, `-3`, … tới 1000, rồi fallback `<slug>-<Date.now()>`.

**Lưới bắt buộc của auto-approve.** Bỏ gate `review` cho pattern mới là bỏ khâu soi *genericity*
trước khi ghi (B2′ chỉ đảm bảo lint/schema, **không** bắt được secret sót). Vì file lên kệ là live
ngay và sẽ dạy mọi build sau, auto-approve chỉ hợp lệ khi đi kèm **hai** thứ, cả hai là bất biến:
report nổi 1-click ngay trên tray, và **[Undo] 1-click**. Một trạng thái "✓ Done" trơn — không report,
không đường lùi — là **vi phạm**, không phải rút gọn.

**Undo** là nghịch đảo **trọn gói** của `finalizePromotion`: `unlink` file trên kệ **và** rebuild
INDEX/provenance bằng đúng `runPython` mà finalize dùng — chỉ xoá file thôi sẽ để catalog trỏ vào
pattern không còn. File đã mất (đã gỡ, hoặc bị promote khác đè) → **no-op, báo "đã gỡ"**, không lỗi.
Undo **không đụng git**: bản sạch chạy trên máy nhiều user không có git, nên nó luôn chỉ thao tác
working-tree. Nút biến mất sau khi đã Share — gỡ được bản local không có nghĩa rút được bản đã đẩy
lên team.

`finalizePromotion()` làm đúng chuỗi: stamp header → `writeFile` target → `unlink` staged
(best-effort) → `build_index.py` → `check_provenance.py`. `build_index.py` fail là **non-fatal**: chỉ
ghi `p.note` bảo chạy lại tay. Một `/cancel` chen giữa được tôn trọng thay vì đè `cancelled` về `done`.

## 5. Provenance — stamp gì, check gì

Header là **comment ở đầu file**, không phải key YAML:

```
# x-provenance: source=<name> repo=<url>
#   commit=<sha> file="<path>" orig_sha256=<hex> promoted=<YYYY-MM-DD> license=<spdx>
```

Comment là chủ ý: Dify **bỏ qua** comment khi import, nên header đi cùng file mà không đổi hành vi. Cái
giá: comment **không sống sót** qua `yaml.safe_load` + `yaml.safe_dump`. Hệ quả cưỡng chế hai chiều —
writer phải chạy **cuối cùng**, và tooling **không được** reserialize file curated.
`test_comment_header_does_not_survive_yaml_reserialization` ghim chính hazard này.

`parse_header()` chỉ đọc **run comment/blank ở đầu file**; dòng YAML thật đầu tiên kết thúc vùng
header. Token trước `x-provenance:` (ví dụ comment tiêu đề) bị bỏ qua. Token là `key=value`, value có
thể `"trong ngoặc kép có khoảng trắng"` hoặc một chuỗi không khoảng trắng.

**`FIELDS` không phải hợp đồng của parser.** `provenance.FIELDS` liệt kê 7 tên, nhưng `parse_header()`
trả về **mọi** `key=value` nó gặp — và pattern đã commit mang thêm `spec=` và `known_good_dify=`, hai
khoá **không có** trong `FIELDS`. `format_header()` chỉ in 7 khoá đó, nên nó sẽ **rụng** `spec` và
`known_good_dify`.

Ba code path sinh ra header, **không path nào dùng chung formatter**:

| writer | dựng header bằng | có caller production? |
|---|---|---|
| `provenanceHeader()` (`promote.ts`) | template string riêng, **hai nhánh theo `task.promote.origin`**: vắng/local → `source=original`, `license=MIT`, `spec=052`; `external` → `source=external`, `file="<originLabel>"`, `orig_sha256=<hash bytes>`, `license=<khai>`, `spec=070`. Cả hai kèm `known_good_dify=<verdict>` | có — `finalizePromotion()` |
| skill `template-promote` | người gõ tay theo mẫu trong `SKILL.md` | có — người |
| `format_header()` (`provenance.py`) | `FIELDS`, 7 khoá | **không** — chỉ `test_provenance.py` gọi |

Một parser (`parse_header()`) đọc cả ba.

### `classify()` — hai trục staleness

| thứ tự | điều kiện | kết quả |
|---|---|---|
| 1 | `dify_tag` **và** `known_good_dify` đều truthy **và** khác nhau | `stale` — `known_good_dify <kg> behind Dify pin <tag> — re-probe the source (spec 050 D5)` |
| 2 | `source == original` | `current` — `hand-authored (no upstream)` |
| 3 | `source` không có trong registry | `orphan` |
| 4 | `corpus/<source>/<file>` không tồn tại | `orphan` |
| 5 | không có `orig_sha256` | `stale` |
| 6 | `sha256_file(orig) == orig_sha256` | `current` / ngược lại `stale` |

Trục 1 (version) chạy **trước** và độc lập với trục nội dung. `dify_tag=None` (mặc định) tắt trục 1;
`main()` truyền pin thật từ `.dify-tag`.

Nhánh 2 chặn trước nhánh 4/5/6: với `source=original`, `file` và `orig_sha256` **không bao giờ được
đọc** — nên `file` của pattern original là văn bản tự do (pattern đã commit có cái ghi
`"<tên>.yml (field export, not committed)"`), và `orig_sha256=` rỗng là hợp lệ.

`license_problems()` bắt ba lỗi: thiếu license, license ngoài `PERMISSIVE_LICENSES`, và license lệch
registry của source đó.

**`source=external` (pattern promote từ YAML dán) rơi vào nhánh 3 `orphan`** — nó không có trong registry
`corpus/sources.yml` theo đúng bản chất (source ngoài, không đăng ký). `finalizePromotion` chạy
`check_provenance.py` **không `--strict`** (đã `.catch` bọc → non-fatal) nên nó chỉ cảnh báo, không chặn
việc lên kệ; `--strict` (opt-in, không nằm trên đường CI) trả `1`. Đã kiểm bằng chạy: header
`source=external ... license=CC-BY-4.0` → `✗ [orphan] ... source 'external' not in registry`, non-strict
exit `0`, `--strict` exit `1`.

`find_templates()` **keying trên sự hiện diện của header** (`rglob("*.yml")` + `parse_header()` truthy)
— pattern không header thì vô hình với check này. Root mặc định là **cả hai** `templates/library` và
`templates/patterns`; `--dir` thu hẹp về một.

`--strict` đổi exit code (1 khi có stale/orphan/license issue); không có nó thì warn-only, luôn `0`.
`--write-third-party` sinh lại `THIRD_PARTY.md`, gom attribution theo source, **bỏ qua**
`source=original`.

## 6. Registry nguồn

`corpus/sources.yml` **tracked**; clone `corpus/<name>/` **gitignored**. Thêm một source = thêm một
entry; không đường dẫn corpus nào hard-code ở chỗ khác.

`load_sources()` chuẩn hoá và điền default: `ref` → `main`, `dsl_glob` → `**/*.yml`, `sparse` → list
(string đơn được bọc thành list), `indexed` → `True`.

**Lockfile tái lập.** `corpus/sources.lock` (JSON, **tracked** cạnh `sources.yml`) khoá mỗi source vào
một commit cụ thể: `{name, resolved_sha, ref, updated}`. Ghi qua **đúng một cửa Python**
(`sources_admin.py lock-write`, gọi từ `update_corpus.sh` bằng `$PY` sau mỗi `reset --hard`) — không
hand-roll JSON trong bash, cùng kỉ luật với luật cấm `yaml.safe_dump` ở dưới. Đọc ở **bước riêng chạy
SAU venv** của `setup.sh` chứ không trong vòng clone: clone xảy ra trước khi venv tồn tại, chỗ đó
chưa có Python để parse JSON.

`ref` và lock **tách nhau có chủ đích**: `ref` ở lại là branch (để clone `--branch` và để
freshness-check đọc `refs/heads/`), còn lock mang SHA và được `fetch --depth=1 origin <sha>` riêng —
vì `git clone --branch <sha>` fail với SHA thuần, và một clone `--depth=1` không có sẵn commit cũ để
checkout. Vắng lock, lock hỏng, hoặc SHA không fetch được (upstream force-push/GC, hoặc offline) →
**warn rồi ở lại tip của `ref`**: advisory, không bao giờ chặn. `--latest` và `--skip-clones` bỏ qua
bước pin. `sources_admin.py add` **không** ghi lock — xem dưới.

**Cron sync.** `.github/workflows/sync-corpus.yml` chạy hằng tuần (mirror `refresh-schema.yml`) và khi
bấm tay: `update_corpus.sh --all` → re-pin lock → rebuild INDEX → **mở PR nếu có diff, không bao giờ
auto-merge**; lượt chạy tự bỏ qua khi đã có một PR sync đang mở. Lý do không auto-merge là ràng buộc
thật: đổi corpus thì đổi số file trong `INDEX.md`, mà headline `~N template` của README lại **chép
tay** và `test_docs_drift` ghim đúng số — phải có mắt người sửa cả hai trong cùng PR.

Hai mối nối advisory tại seam corpus-update (spec 079, zero cơ chế mới): `/corpus-update` sau một
update thật chạy `enrich.py --check` + `check_provenance.py` và **đề nghị sửa ngay trong session**
(human gật); cron `sync-corpus.yml` append 2 khối báo cáo vào body PR (`|| true` — không bao giờ
fail). Verdict đã cân và LOẠI, đừng đề xuất lại: **chuông distill-hint** (đếm build tham chiếu
corpus để nhắc chưng cất) — build thành công CHÍNH LÀ nguyên liệu chưng cất tốt hơn file gốc,
nudge promote sẵn có phủ trọn; **auto-enrich trong cron** — CI không có LLM, enrichment cần mắt
người; **bật `--strict` provenance ở CI** — đổi hợp đồng warn-only đang cố ý; **field per-source
`language`/`domain`/`priority` + `find.py --domain`** — lõi của nó đã có (BM25 đã tra `tags` và lọc
theo tag, precedence đã là sort-key thật chứ không còn là prose), phần còn lại không đáng một track
ở quy mô một nguồn; chỉ mở lại nếu nhiều nguồn đa ngữ làm `INDEX.md` nhiễu thật.

`indexed: false` **chỉ** tác động lên `scan_targets()` — source đó vẫn clone, vẫn refresh, vẫn promote
được, chỉ vắng mặt khỏi `INDEX.md`/`index.json`/`find.py`. Shim bash **bỏ qua** field này (nó luôn emit
đúng 6 field), nên clone/fetch là vô điều kiện.

**Schema phải giữ phẳng — mỗi value một scalar một dòng, `sparse` một list một dòng.** Đây là ràng buộc
thật, không phải khẩu vị: `scripts/lib/sources.sh` parse file này bằng `awk` line-oriented
(`sub(/^[^:]*:[[:space:]]*/, "", v)` — một key một dòng), vì `setup.sh` clone corpus **trước khi venv
tồn tại**, nên không có PyYAML và không có `yq`. Viết lại thành YAML lồng/multiline cho "sạch" sẽ làm
hỏng bootstrap. Một schema, hai parser (`sources.py` cho Python, `sources.sh` cho bash);
`test_bash_shim_matches_python_reader` gác việc hai bên đọc ra cùng một thứ.

`PERMISSIVE_LICENSES` = `MIT` · `Apache-2.0` · `BSD-2-Clause` · `BSD-3-Clause` · `ISC` · `Unlicense` ·
`CC0-1.0` · `CC-BY-4.0`. Lý do allowlist: template promoted là **tác phẩm phái sinh** (đã dịch + migrate
DSL), nên copyleft/non-commercial không redistribute được.

Allowlist đó chia nguồn ngoài làm hai hạng. Qua được = **tier A**: thu thập, vendor, promote nguyên
văn đều hợp lệ. Không qua — no-license hoặc copyleft — là **tier B: rewrite-only**. Đường duy nhất
để dùng tier B là chưng cất *ý tưởng* rồi re-author qua Builder; ý tưởng không có bản quyền, file
thì có. Commit bytes của tier B là **redistribute thật**, vì repo này được người khác clone về chạy —
không có ngoại lệ kiểu "để đó tham khảo nội bộ thôi".

**`validate()` giờ CÓ trên đường chạy.** `load_sources()` vẫn **không** gọi nó (parse
thuần), nhưng `build_index.py main()` — sau khi venv tồn tại — nay tách `validate` làm hai: license
non-permissive → **block** (exit ≠ 0, không ghi index); thiếu field bắt buộc → **warn**, build vẫn chạy.
`check_provenance.py` vẫn không gọi. Bootstrap của `setup.sh` (trước venv) **không đổi** — gate nằm ở
bước build_index sau venv, nên một license copyleft thêm vào registry giờ **đỏ `build_index.py`**, không
chỉ đỏ test. Hai generator `license_problems` / `missing_field_problems` là split đó; `validate()` compose
cả hai (giữ nguyên cho CLI `sources.py` + parity test).

**`sources_admin.py` = cửa "add/doctor" an toàn.** `add` validate **trước khi ghi** (license
+ field + an-toàn-flat-schema), từ chối nếu có vấn đề, rồi **append text phẳng thủ công** — KHÔNG
`yaml.safe_dump` (reflow sẽ phá awk shim, đúng hazard §schema-phẳng ở trên) — và chỉ **in** lệnh
clone+index, không tự `git clone` (permission). `add` ghi `ref: main` và **không** pin SHA: nó cố ý
clone-free/pure-local (không chạm mạng), còn việc khoá commit là của lockfile do lần clone/update
đầu tiên ghi — mà pin SHA thẳng vào `ref` thì lại vô hiệu freshness-check của `update_corpus.sh`
(nó chỉ resolve `refs/heads/`). `doctor` chỉ **đọc**: license lệch / thiếu
field = lỗi (exit 1); ref pinned-SHA + clone thiếu = cảnh báo (exit 0). `build_index.py` cũng nay **nêu
TÊN** mọi YAML parse-fail thay vì đếm ẩn danh (S4); YAML hợp lệ nhưng không-phải-workflow vẫn bỏ im lặng.

## 7. Guard ở đâu

| file | phủ |
|---|---|
| `tests/test_promote_gate.py` | verdict xanh/đỏ; sweep orphan theo probe name; `pending` → inconclusive; thiếu cred → lint-only; model rỗng là warning; **4 linter thật** chạy trên fixture + pattern; dedup candidate; trục staleness version |
| `tests/test_provenance.py` | parse header thật; round-trip `format_header`↔`parse_header`; hazard reserialization; `classify` current/stale/orphan; license hygiene; `--strict` |
| `tests/test_sources_registry.py` | shape registry; **parity shim bash ↔ reader Python**; default + parse `indexed`; `indexed:false` không thành scan target; clone gitignored **vẫn** được index (kể cả tên ASCII); **S3** license non-permissive → `build_index` đỏ, thiếu field chỉ warn + split `license_problems`/`missing_field_problems`; **S4** YAML hỏng được nêu tên (không-phải-workflow bỏ im); **S5** `sources_admin add` ghi phẳng → **awk shim đọc lại đúng 6 field** + parity, add license xấu/dup/hazard bị từ chối không ghi, `doctor` license đỏ / ref-pin + clone-thiếu chỉ warn |
| `tests/test_pattern_consistency.py` | mọi `templates/patterns/*.yml` có `# Use case:` + `# TODO:`. (Nửa `dependencies` của file test này thuộc [readiness-and-plugins.md](readiness-and-plugins.md) §10) |
| `tests/test_lint_refs.py` · `tests/test_validate_workflow.py` | quét `templates/patterns/*.yml` — **chỉ** tầng này |
| `tests/test_docs_drift.py` | số file ở `INDEX.md` nằm trong dải; headline `~N template` của `README.md` **bằng** số đó |
| `apps/builder/test/promote.test.ts` | toàn luồng với `runPython`/`runTurn` giả: blocked → không spawn turn; staging chỉ trong run dir; re-gate đỏ → `promote_distill_failed`; Approve là đường ghi duy nhất; stamp `spec=052` + rebuild INDEX; va slug → overwrite/rename, không clobber; reply ở gate blocked là no-op. **Cửa external**: source staged ở run-dir root (**không** dưới `promote/`); turn ghi-shorthand → `relocateRunArtifacts` chạy thật, không `ENOTEMPTY`; Approve external stamp `source=external`+`license` khai, **không** `source=original/MIT` |
| `apps/builder/test/promote-external-route.test.ts` | route `POST /api/promote` cửa paste: YAML fail linter → `400` inline **không** mint task; paste rỗng → `400` (không nhầm cửa local "project required"); payload không `yaml`/`origin` vẫn về cửa local |
| `.pre-commit-config.yaml` (CI: `pre-commit run --all-files`) | 4 linter + JSON Schema + guard version DSL trên `templates/(patterns\|probes\|library)/*.yml` — guard thật của `library` và `probes` |
| `tests/test_find_ranking.py` · `tests/test_find_unknown_feature.py` | `source_rank` khớp luật precedence; `patterns` trước `corpus` ở cùng độ phức tạp; `--name` chạm `summary_en`/`tags`; query nhiều từ khớp tag có gạch nối; relevance dẫn, hoà thì precedence phá; index chưa enrich vẫn tra `description` thô; feature lạ báo lỗi tường minh, khác kết quả rỗng thật |
| `tests/test_enrich.py` | schema enrichment; merge vào index; degrade khi thiếu; phát hiện `orig_sha256` lệch |
| `tests/test_sources_lock.py` | round-trip lock; idempotent theo `(sha, ref)`; serialize tất định; lock hỏng/sai shape → degrade rỗng (không ném); CLI `lock-write`/`lock-read`; `add` **không** ghi lock; lockfile thật trong repo đúng shape. **Ranh giới**: chỉ tầng Python — nhánh bash bước pin trong `setup.sh` không test nào gác |
| `tests/test_catalog.py` | fingerprint ổn định qua rename/dịch; `seed` idempotent; ba verdict của `check`; `record`/`hunt-log`; `doctor` bắt cặp trùng thật. Nhóm `stats`: promote stamp ở **`patterns/`** phải hiện trong `promotes`; `seed_coverage.stale` khi index có file chưa seed; entry `rejected` **không** vào diversity; thiếu `index.json` → `ok:false` (không tự build); dup tầng curated lộ ở doctor |
| `apps/builder/test/shelf-stats.test.ts` · `apps/builder/web/src/lib/shelf.test.ts` | passthrough `GET /api/dev/shelf` + nhánh `{ok:false, reason, tail}`; derivation render (ngưỡng feature "nghèo", tiến độ cổng hunt) |
| `apps/builder/test/promote-hint.test.ts` | gating nudge ④: from-scratch anchor (`workflow===null && seedPath===null`), seed-edit và edit-local đều **vắng**, shape <4 node vắng, verdict near-dup vắng, tối đa 1 nudge/task |
| `.github/workflows/ci.yml` | `setup.sh` rebuild index trước pytest; `check_provenance.py` **không** `--strict` |

## 8. Những gì KHÔNG check tự động nào chứng minh được

Đây là ranh giới của mọi kết luận "xanh" ở tầng này.

- **`find.py` chỉ được gác MỘT PHẦN.** `tests/test_find_ranking.py` +
  `tests/test_find_unknown_feature.py` phủ precedence (`source_rank` khớp luật văn xuôi; `patterns`
  đứng trước `corpus` ở cùng độ phức tạp), ranking `--name` (chạm `summary_en` và `tags`; query nhiều
  từ khớp tag có gạch nối; relevance dẫn; hoà thì precedence phá; index chưa enrich vẫn tra được
  `description` thô) và lỗi feature-không-tồn-tại (phân biệt với kết quả rỗng thật). **Chưa gác**:
  prefix-match `--source`, AND semantics khi cộng nhiều `--has`/`--no`, `rc=1` khi thiếu index, và
  hình dạng output `--json`/`--full`.
- **Chỉ **số file** của `INDEX.md` được gác, không phải nội dung.** `test_docs_drift.py` kiểm dải + so
  với headline README. Sửa `app.description` của một pattern → dòng trong `INDEX.md` đã commit thành
  cũ, số không đổi, **không test nào đỏ**. Và CI `setup.sh` rebuild index **trước** pytest, nên bản
  `INDEX.md` đã commit không bao giờ được đem so với đĩa.
- **Số đó vẫn có thể trôi dù đã có lock.** CI chạy `setup.sh --skip-venv` nên bước pin CÓ chạy và
  bình thường số file do lock quyết định. Nhưng lock không phải bảo đảm: SHA không fetch được thì
  bước pin degrade về tip của `ref` (đúng thiết kế), và một lượt cron sync ghi lock mới cũng đổi số.
  Cả hai trường hợp, headline `~N template` chép tay trong `README.md` phải sửa theo — không gì phát
  hiện trước ngoài chính `test_docs_drift` đỏ sau đó.
- **`promote_gate.py` giữ bản sao thứ hai của danh sách 4 linter.** `LINTERS` ở `promote_gate.py:41` là
  tuple tên script viết tay; `linters.ts` tự nhận là *"The ONLY place this list is written"*. Không test
  nào so hai bên. Thêm linter thứ 5 vào `linters.ts` → gate ③ có nó, promote gate **im lặng vẫn chạy
  4** — và promote là chỗ một lỗi lây lan.
- **Trục staleness version tắt vĩnh viễn với pattern promote bằng nút.** `runPython` xoá `DIFY_*` →
  probe luôn `skipped` → `known_good_dify: null` → `provenanceHeader()` stamp `known_good_dify=` rỗng →
  `classify()` thấy `kg` falsy và **bỏ qua trục 1**. Chỉ promote tay có cred mới stamp được version.
  Mọi pattern đã commit hiện mang version là do promote tay.
- **`format_header()` sẽ rụng `spec` và `known_good_dify`** (không có trong `FIELDS`). Hôm nay vô hại vì
  không writer production nào gọi nó — nhưng round-trip test chỉ round-trip 7 khoá, nên không gì phát
  hiện nếu một writer tương lai dùng nó và mất luôn trục version.
- **Pattern không header vô hình với `check_provenance.py`.** Đa số `templates/patterns/*.yml` không có
  `x-provenance`; "provenance check passed" **không nói gì** về chúng.
- **CI là warn-only.** `check_provenance.py` chạy không `--strict`, nên một template stale/orphan
  **không** làm đỏ CI. Chỉ `test_provenance.py::test_library_template_passes_strict` gọi `--strict` trên tier
  `templates/library` **thật** (`test_strict_mode_fails_on_non_permissive` cũng gọi `--strict`
  nhưng trên tmp dir tổng hợp), và
  nó `skip` khi clone upstream vắng mặt.
- **Không gì phát hiện upstream đổi mà hash không đổi được kiểm.** Trục nội dung so `orig_sha256` với
  file trong clone **local**. Clone cũ → so với bản cũ → `current`. Không có network, không có git
  history.
- **File YAML parse lỗi biến mất im lặng khỏi index.** `main()` chỉ in số lượng skipped; không test nào
  assert list đó rỗng, không gì in tên file.
- **Tên feature sai = kết quả rỗng, `rc=0`.** Không phân biệt được với "không mẫu nào có feature này".
- **Dedup candidate là substring trên toàn file.** `if rule in body` — một rule mới tình cờ là substring
  của một bullet đã ghi sẽ bị **âm thầm** coi là trùng và không được ghi.
- **Token của `promote.md` không được gác.** `renderPrompt()` chỉ thay đúng các khoá được truyền; token
  lạ đi thẳng vào prompt dưới dạng chữ `{{FOO}}`. `promote.test.ts` ghi đè `promote.md` bằng thân giả,
  nên **thân thật chưa bao giờ được kiểm** là mọi token của nó đều được thay.
- **Chất lượng của bản distill là hành vi model, không phải hằng số.** Gate chỉ chứng minh lint + schema.
  Việc pattern có thật sự generic (đã bóc instance) hay tự tài liệu hoá hay không được ghim bởi
  `test_pattern_is_domain_generic_and_self_documenting` — nhưng test đó kiểm **một** pattern đã commit
  bằng danh sách substring **chép tay** (`api.chatwork.com`, `# GOTCHA:`, …). Pattern promote tiếp theo
  không chịu ràng buộc nào.
- **Dify có thật sự nhận file distill hay không** khi promote đi qua nút: probe luôn `skipped`, nên
  đường đó **chưa bao giờ** hỏi Dify. Chỉ promote tay có cred mới chạm oracle thật.
- **Turn distill THẬT trên source `external` chưa chạy.** `promote.test.ts` fake `runTurn`; cửa external
  chỉ được chứng minh tới mức **luồng** (staging run-dir-root, relocate ghi-shorthand, finalize stamp
  `source=external`) — không phải một bản distill do model thật sinh từ một YAML dán. Cùng ranh giới với
  gạch đầu dòng "chất lượng bản distill là hành vi model" ở trên.

## 9. Nhận contribution pattern từ user bản-sạch (spec 081)

Máy contributor (Builder, sau promote) đẩy **một branch `contrib/<slug>-<yyyymmdd>`** lên origin
chứa đúng 2 path: `templates/patterns/<slug>.yml` + `INDEX.md`. Toàn bộ luồng phía Builder sống ở
`apps/builder/server/lib/share.ts` (Phạm vi: offer/preflight/push — commit dựng trong `git
worktree` vứt-đi nên checkout của user không bao giờ bị đụng; guard: `share.test.ts` gồm cả test
git thật). Hub tự mở PR
(`.github/workflows/contrib-pr.yml` — title/body lấy nguyên văn từ commit; body do Builder soạn:
verdict gate, kết quả share-scan, near-dup, checklist). CI chạy trên chính cú push
(`ci.yml` push-trigger `contrib/**` — PR mở bằng `GITHUB_TOKEN` không kích `pull_request`).
Phía gửi: **Share = Push**. Cú bấm [Share to team] **chính là** cái gật của người — không có gate xác
nhận thứ hai sau nó. Bấm xong chạy preflight (`promote_gate.py share-scan` + `catalog.py check
--shelf`) rồi rẽ hai đường: `findings` rỗng → **đẩy thẳng**; `findings` khác rỗng → **CHẶN CỨNG**,
không push, báo lộ secret. Đây là **cầu chì**, không phải gate ma sát — nên **không có nút
"push anyway"**: secret một khi lên Drive/PR là đã lộ, không rút lại được. Ngược lại, near-dup (`dup`)
**chỉ advisory** và **không bao giờ chặn** — admin lọc ở `/shelf-inbox`. Provenance `external` không
permissive-license bị chặn từ đầu (không có nút Share).

Đã cân và LOẠI, đừng đề xuất lại: **auto-approve khi CÓ collision**; **nút push-anyway khi preflight
bắt secret**; **chặn share vì near-dup**; **Undo dính git** (git-commit detection / `git revert` /
"cửa sổ pre-commit"); **dropdown Local-hay-Team ngay lúc nhấn nút** — nút share chỉ surface sau khi
đã finalize.

**Checklist review một PR `contrib/*`** (trùng với checklist in sẵn trong body PR):

- [ ] Header `x-provenance` hợp lệ — `source=original`, hoặc `external` + license permissive.
- [ ] Placeholder sạch: không URL nội bộ / token / hostname sót (share-scan là advisory,
      mắt người là gate thật).
- [ ] Không near-dup với pattern đã có trên kệ (verdict trong body PR; nghi ngờ thì
      `catalog.py check <file> --shelf` lại).
- [ ] Số pattern nhắc trong **README + AGENTS.md + docs/architecture.md** đã bump —
      `test_docs_drift` pin số chính xác, thiếu là CI đỏ (đúng khuôn checklist PR sync-corpus).
- [ ] `INDEX.md` conflict với contribution song song → regenerate (`build_index.py`) rồi commit,
      đừng merge tay.

Merge xong: mọi bản sạch nhận qua `git pull` thường (`templates/patterns/*.yml` + `INDEX.md` đều
tracked); branch `contrib/*` dọn bằng GitHub "Automatically delete head branches".

Verdict transport đã cân và LOẠI — đừng đề xuất lại (081/083): **repo community riêng làm corpus
source** (contributor bản-sạch đã có nguyên promote FSM sanitize+gate+provenance; sản phẩm xứng
tầng `patterns`, không phải tầng intake của repo phụ phải nuôi); **Drive API/OAuth trên máy user**
(đã kiểm chứng: mọi upload Drive API đều đòi OAuth — "anyone-link upload" không tồn tại);
**Google Form** (file-upload đòi sign-in; dạng text chết vì cap 50k ký tự/cell); **service-account
key phân phát trong repo** (secret sprawl); **folder-sync từng máy** (friction per-máy).

**Transport v2 (spec 083) — drop-URL là đường chính, branch+PR ở trên lùi làm fallback.**
Branch+PR đòi push-right + git identity + GitHub account — không phục vụ được user không-dev.
Đường chính mới: `.dify-share.json` (repo root, khuôn `.dify-tag`) chứa URL một Apps Script Web
App do admin deploy một lần (`tools/share_inbox/` — `Code.gs` + `DEPLOY.md`); Builder POST
`{yaml, meta}` lên đó (`share.ts` — `loadShareConfig`/`postContribution`; config có url → thắng,
không có → probe origin như cũ; hỏng → degrade về git, không bao giờ vỡ promote). Receiver ghi
vào Drive của admin theo `inbox/YYYY-MM/` (timezone Asia/Tokyo). Admin quét bằng skill
`/shelf-inbox` (env `SHELF_INBOX_DIR` = bản sync local, chỉ máy admin cần Drive for Desktop):
vet lại bằng đúng 3 gate (promote_gate check / share-scan / catalog check --shelf), approve →
land + bump 3 docs + commit; mọi quyết định ghi `catalog.py record`; xử lý xong move sang
`processed/YYYY-MM/`. Hai cổng người của 081 giữ nguyên — transport đổi, gate không đổi.
Checklist review ở trên áp dụng nguyên vẹn cho một item inbox (thay "body PR" bằng `.meta.json`).
