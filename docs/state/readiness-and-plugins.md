# Hiện trạng — readiness & plugin

Builder làm gì **sau khi** YAML đã có: xác định user còn phải làm gì, nói ra, và thực thi các luật
plugin khiến điều đó đúng.

Phạm vi: `runnability.ts` · `report.ts` · `report-analysis.ts` (spec 075 — hàm thuần tính
`criteria_check` + `timeline` cho `report.ts`; §8 dưới) · `dify-io.ts` (**nửa workspace-facts** — xem
`dify-io.md` §0) · `lint_plugin_hashes.py` · `marketplace.py` · `tool-catalog.json` · `e2e_check.py`.

> - Chuỗi trong backtick là **nguyên văn** code phát ra hoặc đọc — không dịch.
> - Tài liệu này mô tả **bất biến**, không chứa số đo. Số liệu (test count, thời gian, cost) lấy bằng
>   cách chạy, không đọc ở đây.

---

## 1. Định danh plugin

Tool node cần 5 field định danh. Các shape này **không đoán được** — sai một cái là node không resolve
được mà linter vẫn xanh:

| field | giá trị | ghi chú |
|---|---|---|
| `provider_type` | `builtin` | **không phải** `plugin`. Dify điều phối `BUILT_IN` sang plugin controller (`vendor/dify-src/api/core/tools/tool_manager.py:985-987`). Mọi tool node trong `corpus/` đều `builtin`. |
| `provider_id` | `<org>/<plugin>/<provider>` | 3 segment. Tên trần 1 segment nở thành `langgenius/<v>/<v>`; **2 segment raise `ValueError`** (`vendor/dify-src/api/models/provider_ids.py:24-29`). |
| `provider_name` | y hệt `provider_id` | giống hệt, 3 segment. |
| `tool_name`, `tool_label` | từ khai báo của plugin | |
| `tool_parameters` | `{<name>: {type, value}}` | cả hai key bắt buộc. `type` ∈ `mixed` \| `variable` \| `constant`; `mixed` nội suy `{{#…#}}` trong `value`. **Không có `value_selector` ở đây.** |

`plugin_unique_identifier` trên node là tuỳ chọn; tầng này không dùng.

Shape đã kiểm chứng: `docs/runtime-supplement.md`.

## 2. Plugin hash

`dependencies[].value.marketplace_plugin_unique_identifier` = `<org>/<plugin>:<version>@<sha256>`.

Hash là **checksum gói công khai của marketplace**, khoá theo `(plugin, version)` — **giống nhau ở mọi
workspace**, lấy được không cần login, không cần cài.

```
.venv/bin/python tools/dify_base/marketplace.py resolve <org>/<name>[/<version>]
.venv/bin/python tools/dify_base/marketplace.py tools   <org>/<name>[/<version>]   # + field cho node
.venv/bin/python tools/dify_base/marketplace.py catalog <ref> [<ref>…]             # sinh lại catalog
```

Nguồn: `GET https://marketplace.dify.ai/api/v1/plugins/<org>/<name>[/<version>]`, không auth.
**Hai endpoint khác shape**: `/<org>/<name>` → `data.plugin` (có `latest_version`, `tool.tools[]`);
`/<org>/<name>/<version>` → `data.version` (có `unique_identifier`).

**Phải pin version** — hash khoá theo version nên `latest_package_identifier` sẽ trôi.

**`resolve` trả identifier cho MỌI plugin** — kể cả plugin model/agent. Đó là chủ ý: một model-provider
plugin cũng cần entry `dependencies:` của nó. `resolve` chỉ fail khi: không có `latest_version`;
identifier không khớp `IDENTIFIER_RE`; hoặc endpoint version không trả `unique_identifier`
(`no unique_identifier in the response`) — cả ba đều là marketplace đổi shape.

**`tools` / `catalog`** thì thêm điều kiện `category == tool` và ≥1 tool được khai báo — chỉ loại đó mới
đứng sau được một `type: tool` node. Ví dụ `langgenius/jina` là `category: model`: `resolve` **thành
công**, `tools` **từ chối**.

## 3. `dependencies:` là thứ chịu lực

Dify chỉ hiện popup "install this plugin" **khi và chỉ khi** DSL import có mảng `dependencies:` cấp cao
**không rỗng**. Nhánh suy từ graph khoá ở DSL ≤ 0.1.5
(`vendor/dify-src/api/services/app_dsl_service.py:272-285`); repo pin `0.6.0`.

Hệ quả:
- `dependencies: []` + có tool node → import **thành công**, **không popup**, node chết lúc **runtime**.
- Đường import **không bao giờ** hỏi plugin đã cài chưa — plugin chưa ai cài vẫn import được.

`lint_plugin_hashes.py` thực thi:
1. **format** — identifier khớp `^[a-z0-9_]+/[a-z0-9_]+:\d+\.\d+\.\d+@[a-f0-9]{64}$`;
2. **coverage** — mọi marketplace tool node (`provider_type` ∈ `builtin` \| `plugin` \| vắng) phải có
   entry `dependencies` khớp tiền tố `<org>/<plugin>`. `workflow` / `api` / `app` /
   `dataset-retrieval` / `mcp` được miễn.

`plugin_id_of()` là **nguồn duy nhất** suy `<org>/<plugin>` từ provider id; `test_pattern_consistency.py`
import lại thay vì tự suy.

## 4. Catalog

`templates/tool-catalog.json` — entry **sinh tự động** (lệnh `catalog` ở §2 phát fragment
`{"tools":[…]}`), nhưng file commit bọc fragment đó dưới key **`plugins`** kèm metadata viết tay
(`_README`, `generated_from`, `resolved_on`) — envelope không phải output nguyên văn của lệnh.

Mỗi entry: `provider_id`, `provider_type`, `provider_name`, `plugin_id`, `category`,
`dependency_identifier`, `version`, và theo từng tool `{tool_name, tool_label, parameters[{name, type,
required}]}`.

**Không mang**: field `form` của parameter — thứ quyết định tham số thuộc `tool_configurations` hay
`tool_parameters`.

`templates/patterns/scheduled-tool-append.yml` là pattern **duy nhất** có cả trigger lẫn tool node.
`test_lint_plugin_hashes.py` đối chiếu `tool_parameters` của nó với catalog: không tham số thừa, không
thiếu tham số bắt buộc.

## 5. Workspace facts

Trước **mỗi** lần spawn Implement, backend harvest vào `apps/builder/.runs/<taskId>/workspace.json`:

```jsonc
{ "harvestedAt": …, "target": "selfhost",
  "models": [], "plugins": [], "datasets": [],
  "sources": { "models":   {"ok": bool, "count": n, "error"?: string},
               "plugins":  {…}, "datasets": {…} } }
```

Ba call độc lập; chỉ bỏ ghi file khi **cả ba** fail. `sources.<arm>.ok` ghi kết quả từng nhánh: khi
`ok:false`, mảng `[]` bên cạnh **không mang thông tin gì**.

Mỗi nhánh spawn kèm **trần thời gian** (mặc định nằm trong `dify-io.ts`, chỉnh bằng env
`DIFY_HARVEST_TIMEOUT_MS`; giá trị không parse được thì về mặc định). Ba nhánh chạy song song nên
wall-clock của cả lần harvest xấp xỉ **một** trần, không phải tổng ba. Nhánh bị kill vì quá hạn
degrade **y hệt mọi lỗi khác** — `[]` kèm `sources.<arm>.ok:false` — nên luật "chỉ bỏ ghi file khi cả
ba fail" không đổi, và "thiếu cred/Dify → rỗng, không chặn" vẫn là bất biến chứ không thành lỗi cứng.

Trần đó là đánh đổi **tốc độ ↔ đầy đủ**, không phải tinh chỉnh vô hại: hạ quá thấp thì
`{{KNOWLEDGE}}` mất model/tool đang thật sự có trong workspace mà **không ai được báo** — build vẫn
chạy bình thường, chỉ "không thấy" tài nguyên.

`enabledModelCount(facts)` là **reader duy nhất** của số model: trả `undefined` (không biết) khi `facts`
null hoặc `sources.models.ok === false`; trả số thật nếu ngược lại.

`knowledgeBlock(facts)` render facts vào `{{KNOWLEDGE}}` của prompt Implement: nêu tên nhánh đã fail, và
nói rõ plugin không có trong danh sách **vẫn build được** (resolve nó), còn dataset id không có thì
**không có nguồn công khai** (để dạng TODO). `{{KNOWLEDGE}}` **chỉ tiêm ở Implement** — Analyze và Spec
nhận `''`.

## 6. Phân loại readiness

`RUNNABILITY_PROBE` (python nhúng trong `runnability.ts`) đọc `workflow.graph.nodes` **và**
`workflow.environment_variables`. `classifyRunnability(facts, yamlText, ctx)` ánh xạ facts → blocker.

| class | điều kiện | field trên object |
|---|---|---|
| `model_empty` | node `llm` / `parameter-extractor` / `question-classifier` có `model.provider` hoặc `model.name` rỗng | `nodeId`, `nodeType` |
| `sandbox_trap` | node `code` import module ngoài stdlib | `nodeId`, `nodeType` (`code`) |
| `plugin_todo` | `dependencies: []` + marker `# TODO … plugin … hash` | — |
| `dataset_empty` | node `knowledge-retrieval` không có `dataset_ids` | `nodeId`, `nodeType` (`knowledge-retrieval`) |
| `env_secret_empty` | env var `value` rỗng **và** được graph tham chiếu | `varName` |

"Được tham chiếu" = `{{#env.NAME#}}` trong bất kỳ chuỗi nào dưới `workflow.graph`, **hoặc**
`value_selector: ['env', 'NAME']` bất kỳ đâu dưới đó. Env var rỗng **không ai dùng** → **không** phải
blocker.

`ctx.workspaceModelCount` chia `model_empty` thành **ba nhánh** (spec 087 S3): `=== 0` → yêu cầu
("add one in Dify first…"); `> 0` (đã xác nhận) → trấn an trọn ("filled in automatically when you
test — nothing to set up"); **`undefined`** (arm models fail / không được truyền) → lời hứa **có
điều kiện** — giữ nguyên prefix `the AI model (filled in automatically when you test` (consumer
prefix-match không vỡ) nhưng nói rõ "if your Dify has a model enabled — this could not be checked
right now". Nguyên tắc chịu lực: **advisory chỉ được hứa điều đã xác nhận trong chính run đó** —
"nothing to set up" khi chưa kiểm tra được là đúng vết nói-dối 064 mà 066 mới fix một nửa.
**Không** khoá theo `task.deploy`: build `deploy: 'none'` vẫn live-test được
từ UI — `computeGate` **bỏ qua** tham số `deploy` (`gate.ts:110` nhận nó là `_deploy`), nút live khoá
theo `targets.selfhost` (`gate.ts:149`) — và khi đó model **có** auto-fill; khoá theo deploy là nói
dối theo chiều ngược lại (quyết định 066, tái khẳng định khi 087 định key theo deploy rồi bỏ).
Nhánh degrade 0-model: `live-test.ts:269-270`.

`.claude/skills/report/report_structure.py` **mirror** phân loại này (`runnable_blocker_classes`).
`runnability.test.ts` so hai implementation trên fixture chung và **hard-fail khi lệch**.

Blocker là **advisory**: không đổi `lintClean`, gate, hay verdict.

**Node id nằm trên object có cấu trúc, không nằm trong text người đọc** — với cả 5 class. `detail` nêu
thứ user hành động được (tên module với `sandbox_trap`, tên env var với `env_secret_empty`), không nêu
id. `runnability.test.ts` assert bất biến này cho **cả 5 class** cùng lúc, nên class mới không thể thêm
vào mà không đạt cùng chuẩn.

## 7. User đọc gì

`report.json.notes` là **một chuỗi**, ráp bởi `joinNotes(noteParts)`. Mỗi phần được trim, bỏ nếu rỗng,
**thêm `.`** nếu chưa kết thúc bằng `. ! ? 。 )`, nối bằng **newline** — UI split `'\n'` render bullet
list (`ArtifactPanel`).

| # | phần | điều kiện |
|---|---|---|
| 1 | `⚠ <duplicate warning>` | unshift khi có |
| 2 | `ACCEPTED with failing linters …` | unshift khi người override lint gate |
| 3 | `The workflow file passed every automated check.` / `lint failures recorded: …` | luôn |
| 4 | slug note | slug trùng, đã tự thêm hậu tố |
| 5 | `Heads up: the template this build started from doesn't cover everything you asked for (…)` | pattern thiếu feature cần |
| 6 | `Before this workflow can run, you need to: <blockers>. (The build itself is finished — these are setup steps in Dify.)` | ≥1 blocker |
| 7 | probe verdict | ④ import probe đã chạy |
| 8 | `Cloud deploy: … "Import DSL" …` | `deploy === 'cloud'` |
| 9 | `Your workflow file is <path> … Create app → "Import DSL" …` | `deploy === 'none'` |
| 10 | `imported to Dify: <url>` / import note | `deploy === 'selfhost'` |
| 11 | `this workflow uses these Dify tools: <labels>. Before you can run it: (1) install each …, (2) add an API key …, (3) run the workflow to test it.` | YAML có ≥1 tool node |
| 12 | `this workflow relies on a Dify plugin — …` | có plugin TODO chưa giải **và** không có tool node |
| 13 | `This workflow starts on a schedule (or a webhook) … Until you do, it never fires.` (`none`) / `trigger-entry workflow: an API run is a manual fire — …` (còn lại) | YAML có trigger entry node |
| 14 | `This workflow starts from a webhook, so something outside Dify has to send it data: your source (for example a Google Form + Apps Script, or any service that can POST) must call the webhook URL … sending these fields: <name (required), …>` | probe trả `webhook_inputs` → `Preflight.sourceInputs` khác rỗng; render bởi `sourceContractNote()` (`runnability.ts`) |

Dòng 14 là **hợp đồng dữ liệu vào từ nguồn ngoài**: một build webhook đúng hoàn toàn vẫn không bao
giờ chạy nếu không ai nối nguồn — lớp "silent import success + runtime failure" leo lên tầng nguồn.
Field lấy từ `body[]` của node trigger-webhook (khai báo tường minh trong YAML), không suy diễn từ
code node.

Tool checklist (11) khoá theo **sự hiện diện của tool node**, không theo marker TODO — hash đã resolve
**không** làm nó im.

`toolLabels()` đọc `tool_label` (không có thì `provider_name`) của **từng node** bằng cách tách theo
list item → **thứ tự key trong node không ảnh hưởng**.

### Probe verdict

`probeVerdict` trong `report.ts` là **nguồn duy nhất**; cả `orchestrator.ts` lẫn `base-import.ts` gọi nó.

| | text |
|---|---|
| ok | `Checked automatically: Dify accepts this workflow file.` (+ `(A temporary copy named "<name>" was left in Dify — you can delete it.)` khi cleanup fail) |
| rejected | `Dify rejected this workflow file — <lỗi Dify nguyên văn>` |
| parked | `Could not check the import automatically: Dify held it for confirmation, …` |
| skipped | `Could not check the import automatically (<lý do>)` |

### Localization

`localizeNotes()` (`web/src/lib/i18n.ts`) dịch `notes` sang JA **phía client**, regex theo từng frame;
text không khớp **đi thẳng qua bằng tiếng Anh** — nên một chuỗi thiếu frame không báo lỗi, nó chỉ lặng
lẽ hiện tiếng Anh giữa câu tiếng Nhật. Hiện mọi chuỗi tầng này phát ra đều có frame, **nhưng không có
gì gác điều đó**: `notes-i18n.test.ts` chỉ duyệt danh sách chuỗi được liệt kê thủ công trong chính nó,
không duyệt các chuỗi mà code thật sự phát ra (xem §11).

Định danh nội suy (slug, path, tên env var, tên module, đuôi lỗi Dify) giữ nguyên văn.

## 8. Cổng comprehension

`e2e_check.py` chấm text user đọc (digest + notes) theo blocklist token cố định. Trúng 1 token =
`AUTO-FAIL`; không có text = `MANUAL`; còn lại `AUTO-PASS`. Tất định, **không LLM**.

Bị chặn: `plugin hash` · `dependencies` · `provider_id` · `provider_name` · `provider_type` ·
`tool_name` · `tool_configurations` · `# TODO` · `deploy=none` · `unresolved_plugin_todo` ·
`value_selector` · `node id` · `linter` · `linters` · `preflight` · `import-probe` · `probe app` ·
`advisory` · `プラグインハッシュ` · `リンター` · `プリフライト` · `アドバイザリ`.
Regex: ref `{{#…#}}` thô, node id 13 chữ số trần.

Khớp **word-boundary** với token là từ thường, **substring** với token ký hiệu/không-ASCII.

`dsl` **không** bị chặn: `cloudStudioNote` nêu đúng nhãn nút `"Import DSL"` của Dify Studio — tên user
phải đọc trên màn hình là **affordance**, không phải jargon.

Mỗi token ứng với một chuỗi tầng này **không còn phát ra**.

`e2e_check.py` còn một predicate đọc **transcript** thay vì report: `denied_calls_max` — đếm
tool-call bị `✗` trong `transcripts/<phase>.md`. Nó tồn tại vì **turn count là trục sai** cho
search-thrash: các call bị chặn nén được vào ít turn, nên một run thrash nặng vẫn lọt cap turn; đếm
call bị từ chối mới đo đúng. Predicate này đánh giá **trước** guard have-cost (run thiếu cost vẫn
đếm được `✗`).

## 9. Luật các phase nhận được

- `AGENTS.md` §4.3 — hash công khai, khoá theo version; **resolve, không bịa**; workflow dùng marketplace
  plugin **bắt buộc** liệt kê trong `dependencies:`.
- `AGENTS.md` §5 — **không** bỏ tool node vì plugin chưa cài; **không** ship tool node với `dependencies: []`.
- `AGENTS.md` (nguồn được phép) — hai nguồn: workspace facts (thẩm quyền cho dataset id + version đang
  cài) và catalog/resolver marketplace (cho plugin hash). `{{KNOWLEDGE}}` rỗng **không phải** bằng chứng
  plugin không tồn tại.
- `.claude/skills/dify-build/spec.md` — xem catalog trước khi tự model integration; cần plugin **không
  phải** lý do để né node.
- `.claude/skills/dify-build/analyze.md` — payload webhook do builder **tự giả định** (requirement
  không nêu field) phải thành open point ở ①, để client sửa tên field trước khi build; entry
  không-webhook không có hợp đồng đó nên không nêu.
- `.claude/skills/dify-build/implement.md` — thứ tự resolve: catalog → `marketplace.py`. Dataset không có
  fact thì giữ dạng TODO.
- `docs/runtime-supplement.md` — shape `builtin` đã kiểm chứng.
- `docs/plugin-capabilities.md` — hành vi quan sát được theo plugin.

`tests/test_no_plugin_hash_myth.py` assert **không mặt-tiếp-xúc sống nào** (`AGENTS.md`, `docs/GUIDE.md`,
`docs/runtime-supplement.md`, `docs/plugin-capabilities.md`, `.claude/skills/dify-build/*.md`,
`templates/patterns/*.yml`) nói hash là workspace-specific, bảo export YAML để lấy hash, hay bảo để
`dependencies: []`.

## 10. Guard ở đâu

| file | phủ |
|---|---|
| `apps/builder/test/readiness-checklist.test.ts` | note `deploy=none` nêu **đủ** việc cần làm; fixture đóng băng `test/fixtures/readiness/naive-slack-digest.yml` |
| `apps/builder/test/runnability.test.ts` | phân loại; parity python↔TS trên `test/fixtures/runnability/*.yml` |
| `apps/builder/test/report-tool-note.test.ts` | `toolLabels` kể cả khi export sort key; `joinNotes` |
| `apps/builder/test/report-plugin-todo.test.ts` | advisory TODO; tool checklist sống sót khi hash đã resolve |
| `apps/builder/test/workspace-facts.test.ts` | harvest, provenance từng nhánh, `enabledModelCount`, `knowledgeBlock`; trần thời gian mỗi nhánh — mặc định, override qua env, và env rác rơi về mặc định |
| `apps/builder/web/src/lib/notes-i18n.test.ts` | các chuỗi **được liệt kê trong chính test** có frame JA — **không** duyệt mọi chuỗi code phát ra |
| `tests/test_e2e_check.py` | cơ chế của `evaluate_comprehension` (bucket, word-boundary, regex leak) — **không** phủ việc chuỗi thật có trúng token hay không |
| `tests/test_lint_plugin_hashes.py` | gate format + coverage; shape catalog; tham số của pattern |
| `tests/test_no_plugin_hash_myth.py` | các luật doc ở §9 |
| `tests/test_pattern_consistency.py` | `dependencies` của pattern **phủ** tool node của nó. "Và chỉ nó" chỉ được gác khi pattern **không có** tool node — pattern có tool node vẫn khai thừa dependency mà pass |

## 11. Những gì KHÔNG check tự động nào chứng minh được

Đây là ranh giới của mọi kết luận "xanh" ở tầng này.

- **Dify có thật sự hiện popup cài** cho plugin chưa cài được liệt kê trong `dependencies:` hay không.
  §3 — nền của toàn bộ chuỗi tool — **đọc từ source Dify, chưa ai xác nhận bằng một lần import thật**.
  Cần một người import vào workspace không có plugin đó.
- **Tool node dựng ra có chạy được không** — cần credential và một lần chạy thật.
- **Render tiếng Nhật trong UI** — `localizeNotes` chạy phía browser; `e2e-run.sh userview` tái dựng bản
  tiếng Anh, **không phải** render thật của `Chat.tsx`.
- **`marketplace.py` không có unit test**; nó gọi HTTP thật. Identifier trong catalog chỉ được kiểm
  **format**, **không** đối chiếu marketplace sống.
- **Độ tươi của catalog** — không gì phát hiện một version đã pin bị thay thế.
- **②Spec có chọn tool hay không** là hành vi của model, không phải hằng số: chỉ đo được bằng build
  thật, và một lần chạy **không** phải bằng chứng ổn định.
- **Không gì gác việc "mọi chuỗi phát ra đều có frame JA".** `notes-i18n.test.ts` duyệt một danh sách
  chuỗi **chép tay** trong chính nó. Thêm một chuỗi mới vào `report.ts`/`runnability.ts` mà quên frame
  thì **không test nào đỏ** — nó chỉ lặng lẽ hiện tiếng Anh cho user Nhật. Muốn gác thật thì phải
  duyệt từ phía **producer** (export các chuỗi wording-stable rồi assert mỗi cái khớp một regex
  `NOTE_JA`), không phải từ danh sách chép tay.
- **Không gì gác việc catalog khai thừa dependency.** `test_pattern_consistency.py` chỉ kiểm chiều
  thiếu (`providers - declared`), không kiểm chiều thừa (`declared - providers`) khi pattern có tool
  node. Một dependency thừa khiến Dify đòi cài plugin mà workflow không hề gọi.
