# Hiện trạng — kệ mẫu & promotion

Cái kệ mẫu có những tầng nào, cái gì tìm ra chúng, và một thứ được **lên kệ** bằng đường nào.

Phạm vi: `templates/patterns/` · `templates/library/` · `templates/_base/` · `templates/probes/` ·
`promote.ts` · `promote_gate.py` · `provenance.py` · `check_provenance.py` · `build_index.py` ·
`sources.py` · `find.py` · `corpus/sources.yml` · `INDEX.md` · `tools/dify_base/index.json` ·
`THIRD_PARTY.md`.

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

Cả ba tầng `patterns` / `library` / `probes` đi qua **4 linter + JSON Schema + guard version DSL** ở
`.pre-commit-config.yaml` (regex `^(templates/(patterns|probes|library)/.*\.ya?ml|…)$`). CI chạy
`pre-commit run --all-files`, nên đó là guard thật của tầng `library` và `probes` — pytest chỉ quét
`templates/patterns/`. `templates/_base/` **không** nằm trong regex đó; chỉ `yamllint` (regex rộng hơn
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
refresh corpus.

**Scan target** (`scan_targets()`): 7 static root cứng trong `STATIC_SCAN`, cộng một root cho **mỗi**
source `indexed: true` trong registry (§6), tag `corpus:<name>`. Static root quét `rglob("*.yml")`
(đệ quy); corpus root quét `glob(<dsl_glob>)` (neo, không đệ quy). Nhánh chọn giữa hai kiểu là
`"/" in pattern` — một `dsl_glob` không chứa `/` sẽ âm thầm rơi vào nhánh `rglob`.

**`analyze()` biết gì:** `name`/`description` là **passthrough thẳng** từ `app.name`/`app.description`
(`description` cắt còn 100 ký tự) — không có tầng ngữ nghĩa nào được sinh thêm. `node_types` bỏ các
node helper của container (`iteration-start`, `loop-start`, `custom-iteration-start`,
`custom-loop-start`). `has_trigger` là **key tính toán**, không phải entry của `INTERESTING_NODE_TYPES`
— nó bật khi có bất kỳ node nào `type` bắt đầu bằng `trigger-`. `has_file_input` đọc `variables` của
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

`--source` là **prefix-match theo namespace**: `--source corpus` khớp mọi `corpus:<name>`;
`--source corpus:<name>` khớp đúng một; tag trần (`patterns`, `library`, `project`…) khớp chính xác.
Điều kiện thật: `e['source'] == s or e['source'].startswith(s + ':')`.

**Thứ tự trả về không phải thứ tự ưu tiên.** Sort key là
`(COMPLEXITY_ORDER[complexity], source, file)` — `source` so sánh **theo alphabet**, không theo tầng.
Alphabet đặt `corpus:*` < `example` < `library` < `patterns` < `project` < `skill-assets` < `starter`,
nên với cùng độ phức tạp, **corpus luôn hiện trước `patterns`**. Chạy `find.py --has llm` cho thấy
đúng vậy: nguyên khối `corpus:awesome-dify-workflow-en` đứng trên `library` và `patterns`.

Thứ tự ưu tiên `patterns > library > project > corpus:* > skill-assets` là **luật văn xuôi cho người
đọc**, sống ở hai chỗ: prose do `write_markdown()` in ra đầu `INDEX.md`, và `AGENTS.md` §3. **Không
dòng code nào thực thi nó.** Ai đọc kết quả `find.py` từ trên xuống mà không biết luật này sẽ lấy mẫu
corpus trước mẫu curated.

**Tên feature sai không phân biệt được với kết quả rỗng thật.** `--has tools` (thay vì `tool`) tạo khoá
`has_tools` — không entry nào có → in `No matching templates.` và trả `0`. Không có validation nào cho
tên feature; `--list-features` là cách duy nhất thấy tập khoá thật.

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
hỏng nằm trên kệ sẽ dạy cái hỏng cho mọi build seed từ nó. Nên nó có gate riêng, verdict riêng, và một
lần Approve của người là **đường ghi duy nhất** vào kệ.

```
POST /api/promote
  → startPromote        B1: promote_gate.py check <source> --json
      ├─ eligible:false → gate `promote_blocked`  (KHÔNG spawn turn, KHÔNG ghi gì)
      └─ eligible:true  → runDistillTurn
            MỘT turn `claude`, đọc source như DATA, ghi vào STAGING:
              apps/builder/.runs/<taskId>/promote/<slug>.yml
          → B2′: promote_gate.py check <source> --distilled <staged> --json
              ├─ không sạch → gate `promote_distill_failed`
              └─ sạch       → ghi rule vào linter-candidate → gate `promote_review`
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

`promoteConfirm('approve')` kiểm `templates/patterns/<slug>.yml` đã tồn tại chưa. Có → **không ghi
gì**, re-park ở state `reviewCollision` để người chọn ghi đè hay đặt tên mới (bốn state gate + nhãn nút
→ [build-lifecycle.md](build-lifecycle.md)). **Không bao giờ clobber im lặng.**
`firstFreePatternSlug()` thử `<slug>-2`, `-3`, … tới 1000, rồi fallback `<slug>-<Date.now()>`.

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
| 1 | `dify_tag` **và** `known_good_dify` đều truthy **và** khác nhau | `stale` — `known_good_dify <kg> behind Dify pin <tag> — re-probe the source` |
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

**`validate()` không nằm trên đường chạy.** `load_sources()` **không** gọi nó; `build_index.py` và
`check_provenance.py` cũng không. Nó chỉ chạy trong `sources.py` khi gọi CLI không kèm `--list`, và
trong `test_registry_is_clean_and_permissive`. Một license non-permissive thêm vào registry vẫn được
clone và index bình thường — test là thứ duy nhất chặn.

## 7. Guard ở đâu

| file | phủ |
|---|---|
| `tests/test_promote_gate.py` | verdict xanh/đỏ; sweep orphan theo probe name; `pending` → inconclusive; thiếu cred → lint-only; model rỗng là warning; **4 linter thật** chạy trên fixture + pattern; dedup candidate; trục staleness version |
| `tests/test_provenance.py` | parse header thật; round-trip `format_header`↔`parse_header`; hazard reserialization; `classify` current/stale/orphan; license hygiene; `--strict` |
| `tests/test_sources_registry.py` | shape registry; **parity shim bash ↔ reader Python**; default + parse `indexed`; `indexed:false` không thành scan target; clone gitignored **vẫn** được index (kể cả tên ASCII) |
| `tests/test_pattern_consistency.py` | mọi `templates/patterns/*.yml` có `# Use case:` + `# TODO:`. (Nửa `dependencies` của file test này thuộc [readiness-and-plugins.md](readiness-and-plugins.md) §10) |
| `tests/test_lint_refs.py` · `tests/test_validate_workflow.py` | quét `templates/patterns/*.yml` — **chỉ** tầng này |
| `tests/test_docs_drift.py` | số file ở `INDEX.md` nằm trong dải; headline `~N template` của `README.md` **bằng** số đó |
| `apps/builder/test/promote.test.ts` | toàn luồng với `runPython`/`runTurn` giả: blocked → không spawn turn; staging chỉ trong run dir; re-gate đỏ → `promote_distill_failed`; Approve là đường ghi duy nhất; stamp `spec=052` + rebuild INDEX; va slug → overwrite/rename, không clobber; reply ở gate blocked là no-op. **Cửa external**: source staged ở run-dir root (**không** dưới `promote/`); turn ghi-shorthand → `relocateRunArtifacts` chạy thật, không `ENOTEMPTY`; Approve external stamp `source=external`+`license` khai, **không** `source=original/MIT` |
| `apps/builder/test/promote-external-route.test.ts` | route `POST /api/promote` cửa paste: YAML fail linter → `400` inline **không** mint task; paste rỗng → `400` (không nhầm cửa local "project required"); payload không `yaml`/`origin` vẫn về cửa local |
| `.pre-commit-config.yaml` (CI: `pre-commit run --all-files`) | 4 linter + JSON Schema + guard version DSL trên `templates/(patterns\|probes\|library)/*.yml` — guard thật của `library` và `probes` |
| `.github/workflows/ci.yml` | `setup.sh` rebuild index trước pytest; `check_provenance.py` **không** `--strict` |

## 8. Những gì KHÔNG check tự động nào chứng minh được

Đây là ranh giới của mọi kết luận "xanh" ở tầng này.

- **`find.py` không có một test nào.** Không file test nào import nó; mọi tham chiếu trong
  `apps/builder/test/*.ts` chỉ là chuỗi trong prompt/allowlist. Sort order, prefix-match `--source`,
  AND semantics, `rc=1` khi thiếu index — hôm nay tôi xác minh bằng tay; **không gì giữ chúng đúng**.
- **Không gì gác việc thứ tự ưu tiên khớp với hành vi.** `patterns > library > project > corpus:*` là
  prose ở `INDEX.md` + `AGENTS.md`; `find.py` sort corpus lên trước. Không test nào so hai thứ — vì
  không có code nào thực thi luật để mà so.
- **Chỉ **số file** của `INDEX.md` được gác, không phải nội dung.** `test_docs_drift.py` kiểm dải + so
  với headline README. Sửa `app.description` của một pattern → dòng trong `INDEX.md` đã commit thành
  cũ, số không đổi, **không test nào đỏ**. Và CI `setup.sh` rebuild index **trước** pytest, nên bản
  `INDEX.md` đã commit không bao giờ được đem so với đĩa.
- **Số đó là hàm của một upstream không pin.** Registry để `ref: main`; CI clone corpus. Một commit
  upstream thêm/bớt workflow sẽ đổi con số CI tính ra, và headline chép tay trong `README.md` phải sửa
  theo. Không gì phát hiện trước.
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
  **không** làm đỏ CI. Chỉ `test_provenance.py::test_library_template_passes_strict` gọi `--strict`, và
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
