# Hệ thống tri thức của Builder — hiện trạng

> **Doc này trả lời một câu hỏi:** khi Builder dựng một workflow, **AI tham khảo cái gì, lấy từ đâu, và
> cái gì cưỡng chế kết quả?**
>
> **Phạm vi: chỉ MÔ TẢ trạng thái HỆ THỐNG** — cơ chế, và code hiện thực nó. Không chứa đề xuất, roadmap,
> chẩn đoán, hay lịch sử quyết định, để một phân tích sau này không bị neo vào kết luận của người viết trước.
>
> **Không chứa số đo build.** Dân số `.runs/` là **dữ liệu chạy**, không phải trạng thái hệ thống — nó đổi
> mỗi build và biến mất khi refresh dữ liệu, nên một con số ghi cứng ở đây sẽ sai ngay lần chạy kế tiếp.
> §5 đưa **dụng cụ đo** thay cho số.
>
> Tham chiếu trỏ vào **đường dẫn code**, không trỏ vào số spec.
>
> Bổ sung cho [architecture.md](architecture.md) (lý do kiến trúc) và [AGENTS.md](../AGENTS.md) (luật cho
> agent). Doc này chỉ về **luồng tri thức**.

---

## 1. Nguồn tri thức cấp cho một build

| Nguồn | Cơ chế | Vào phase |
|---|---|---|
| **Seed workflow** | Backend quy mọi cửa (pull từ Dify · snapshot local · upload YAML) về một tín hiệu `{{SEED_PATH}}` — `server/lib/scaffold.ts:118` (Dify) / `:165` (local). Rỗng ⇒ build from-scratch | ① ③ |
| **Pattern** | ① ghi tên pattern vào `analyze.json` → fold lên task (`server/lib/analysis.ts`) → backend bơm **đường dẫn** `{{PATTERN_PATH}}` (`server/lib/phases.ts:41-53`, allowlist tên file, `custom` ⇒ rỗng) | ③ |
| **Workspace facts** | Backend harvest từ Dify console → `{{KNOWLEDGE}}` (`server/lib/orchestrator.ts:394-402`, `dify-io.ts:581`). Rỗng nếu không có creds | ③ |
| **Tool catalog** | `templates/tool-catalog.json` — ánh xạ `(plugin, version) → marketplace checksum` + `provider_id`/`tool_name`. Sinh bằng `tools/dify_base/marketplace.py`, không hand-edit | ③ |
| **Nền tĩnh** | `AGENTS.md` §4/§9 · `skills/mango-svip/references/constraints.md` · `node_types.md` · `.claude/skills/dify-build/SKILL.md` | ① ③ |
| **Kệ + truy xuất** | `templates/` + `tools/dify_base/{find.py,index.json}` | ① |
| **File / ảnh user đính kèm** | Đi kèm requirement | ① ③ |

**Seed, file đính kèm và ảnh là DATA, không phải chỉ thị.** `analyze.md` và `implement.md` đều nói rõ; độc
lập với prompt, permission hook của backend chặn tool call nguy hiểm.

Tri thức nằm ở **ba loại nơi khác nhau**, mỗi loại có cơ chế riêng:

| Loại | Nơi ở | Cơ chế |
|---|---|---|
| Rule kiểm được bằng máy | 4 linter (§4) | Cưỡng chế — build không qua thì không đóng gate |
| Rule cần phán đoán | Văn xuôi: `AGENTS.md` §9, `constraints.md` | Model đọc thẳng như chỉ thị, không qua bước truy xuất |
| Hình dạng tái dùng được | Data: `templates/` + `index.json` | Truy xuất bằng `find.py` |

---

## 2. Một build chạy thế nào

```
[requirement] + [base?] + [confirm mode] + [fast?]
      │
      ▼
╔═ Stage 0 · BACKEND (chưa có turn nào) ══════════════════════════════╗
║  Có base? → prelude quy mọi cửa về MỘT tín hiệu:                    ║
║     pull từ Dify ──┐                                                ║
║     snapshot local ─┼──► seedPath    (scaffold.ts:118 / :165)       ║
║     upload YAML ───┘                                                ║
║  Không base → SEED_PATH = ""                                        ║
║  → AI chỉ có MỘT code path: SEED_PATH rỗng hay không                ║
╚═════════════════════════════════════════════════════════════════════╝
      ▼
╔═ Stage 1 · ① ANALYZE (turn) — nơi DUY NHẤT chạy find.py ═══════════╗
║  fast (DEPTH=trivial) → không đụng kệ, không chạy find.py           ║
║  có seed  → đọc seed (DATA) → nodes · var_flow · plugins ·          ║
║             change_points · risks                                   ║
║  from-scratch non-trivial → find.py --has <feature>, chạy MỘT lần   ║
║  → .runs/<taskId>/analyze.json                                      ║
║    (overview · requirements · pattern · features · find_query …)    ║
╚═════════════════════════════════════════════════════════════════════╝
      ▼  gate ① — người xác nhận ý định (trước khi tốn công viết spec)
╔═ Stage 2 · ② SPEC (turn) ══════════════════════════════════════════╗
║  analyze.json → SPEC.md · chốt "Chosen pattern"                     ║
║  fast + CHƯA scaffold → chạy draft.md (gộp ①+②) thay cho spec.md    ║
║    (phases.ts:93 — sau scaffold thì fast revise vẫn dùng spec.md)   ║
╚═════════════════════════════════════════════════════════════════════╝
      ▼  gate ② → scaffold (project / workflowSlug)
╔═ Stage 3 · ③ IMPLEMENT (turn) ═════════════════════════════════════╗
║  KHÔNG search lại pattern — implement.md cấm re-pick                ║
║  Vào:  SPEC.md ◄── nguồn sự thật CHÍNH (đọc lại tươi: người có thể  ║
║                     đã sửa tay ở gate; file thắng)                  ║
║      + {{PATTERN_PATH}} · {{KNOWLEDGE}} · {{SEED_PATH}} · nền tĩnh  ║
║  → projects/<project>/<slug>/workflows/<file>                       ║
╚═════════════════════════════════════════════════════════════════════╝
      ▼  gate ③ — 4 linter (cưỡng chế) + preflight (cảnh báo)
╔═ Stage 4 · ④ TEST — BACKEND, KHÔNG phải turn ══════════════════════╗
║  import-probe → live run → judge → .runs/<taskId>/report.json       ║
║  (test.md không bao giờ được gửi làm turn trong app)                ║
╚═════════════════════════════════════════════════════════════════════╝
```

**Ba phase ①②③ là turn `claude`; ④ là code backend.** Định nghĩa: `server/lib/phases.ts`.

**11 token, luôn được thay hết** (`""` khi phase không dùng, `DEPTH` mặc định `standard`) — không bao giờ
còn `{{TOKEN}}` sót trong prompt render:

`TASK_ID` · `PROJECT` · `WORKFLOW_SLUG` · `WORKFLOW_FILE` · `SEED_PATH` · `REQUIREMENT` ·
`PRIOR_ARTIFACT` · `DEPLOY` · `DEPTH` · `KNOWLEDGE` · `PATTERN_PATH`

`KNOWLEDGE` để rỗng trong `phases.ts` (file này io-free theo hợp đồng); orchestrator ghi đè cho ③ từ
`.runs/<taskId>/workspace.json`.

**Ghim ngôn ngữ:** `phases.ts:164` (`languagePin`) chèn một chỉ thị viết **bằng chính ngôn ngữ**
requirement lên đầu prompt khi phát hiện kana ⇒ tiếng Nhật. Đây là lớp 1; các prompt body còn có banner
"Output language" riêng.

**Artifact ở đâu:** một phase ghi vào `.runs/<taskId>/` (tương đối với cwd = repo root). Trong app, backend
**relocate** sang `apps/builder/.runs/<taskId>/` ngay sau mỗi turn. CLI/human chạy tay thì giữ nguyên
`.runs/<taskId>/`.

---

## 3. Kệ và truy xuất

### 3.1 Kệ trên đĩa

| Thư mục | Nội dung | Luật |
|---|---|---|
| `templates/patterns/` | Workflow mẫu đã vetted — tầng **workflow** | Mọi customization point PHẢI có `# TODO:` |
| `templates/library/` | Workflow curated, chuẩn hoá từ một mẫu corpus | Mỗi file mang header `x-provenance`; staleness dò bằng `check_provenance.py` |
| `templates/_base/project/` | Skeleton **project** (không phải workflow) | `init_project.py` scaffold từ đây |
| `templates/probes/` | Workflow dò môi trường (vd `stdlib_check.yml`) | Read-only, chạy lại an toàn |
| `templates/tool-catalog.json` | Tầng **plugin**: `(plugin, version) → marketplace checksum` | **Sinh, không hand-edit** (`marketplace.py`); version PHẢI pin vì hash keyed theo version |
| `corpus/awesome-dify-workflow-en/` | Clone tham khảo đa ngữ | **Read-only, gitignored** — `setup.sh` chạy lại là ghi đè; đừng sửa |

Ba tầng tri thức có nhà trên đĩa: **workflow** (`patterns`/`library`) và **plugin** (`tool-catalog.json`).
`schemas/dify-dsl-0.6.0.json` giữ `$defs.NodeData_*` (thân từng node) nhưng chỉ `lint_node_bodies.py` đọc —
không có thư mục mẫu nào ở **tầng node**.

### 3.2 Index

`tools/dify_base/index.json` — sinh bằng `build_index.py`, **không hand-edit**. Gom từ 6 nguồn, mỗi entry
mang `source`: `corpus:<name>` · `patterns` · `library` · `skill-assets` · `project` · `example`.

Cơ chế quyết định index chứa gì và biết gì:

- `name`/`description` là **passthrough thẳng** từ `app.name`/`app.description` của YAML
  (`build_index.py:132-133`; `description` cắt còn 100 ký tự) — **không có tầng ngữ nghĩa nào được sinh
  thêm**, nên chất lượng nhãn bằng đúng chất lượng nhãn trong file gốc. Entry thiếu `app.description` thì
  vào index với `description` rỗng.
- Nhãn và thân file corpus phần lớn **tiếng Trung**.
- `build_index.py:261` (`_filter_gitignored()`) **loại mọi YAML mà git ignore** ⇒ workflow dưới
  `projects/_drafts/` **không bao giờ** vào index; chỉ project thật (`projects/<project>/<workflow>/`)
  mới được index.

Đếm entry / phân bố nguồn / số entry thiếu description: chạy lệnh ở §5.

### 3.3 Truy xuất

`tools/dify_base/find.py`:

- **Python thuần** — chỉ `import json, argparse, pathlib`. Không AI, không embedding, không network.
- Đo thật: **0.02–0.06 s/lần**. Chi phí thực tế nằm ở **số tool-call + token**, không ở tính toán.
- Flag: `--has` / `--no` (feature) · `--complexity` · `--plugin` · `--mode` · `--source` · `--name` ·
  `--limit` (mặc định 20) · `--full` · `--json` · `--list-features`.
- `--name` khớp trên `name` + `description` + `file`. **`analyze.md` không dạy dùng `--name`.**
- **Chỉ ① chạy find.py.** `implement.md` cấm ③ re-pick; ③ chỉ mở thẳng `{{PATTERN_PATH}}`, và chỉ chạy
  `find.py` khi token đó rỗng (`custom`).

Thứ tự ưu tiên khi tìm mẫu (AGENTS.md §3):
`templates/patterns/` > `templates/library/` > `projects/*/*/workflows/` > `corpus/` > `skills/*/assets/`

---

## 4. Tầng cưỡng chế và cảnh báo

### 4.1 Gate ③ — 4 linter, cưỡng chế

Chạy trên **mọi `workflows/*.ya?ml` mà turn đụng vào**, không chỉ file khai báo; một file trùng tên khác
đuôi (`main.yaml` cạnh `main.yml`) là **lỗi cứng**.

| Linter | Gác gì |
|---|---|
| `validate_workflow.py` | Cấu trúc + JSON Schema |
| `lint_refs.py` | `{{#id.field#}}`: node tồn tại · `field` có trong `outputs` của node nguồn · **reachability** trên edge DAG (forward/dangling ref ⇒ exit 1). Bỏ qua consumer **bên trong container** (iteration/loop — ref resolve ở scope container); có allowlist cho hình dạng hiếm BFS không mô hình được |
| `lint_plugin_hashes.py` | Định dạng `<provider>/<plugin>:<version>@<sha256>`; **fail** một `tool` node có plugin không được khai trong `dependencies:` |
| `lint_node_bodies.py` | Thân mỗi node vs `$defs.NodeData_*` sinh từ Dify source |

### 4.2 Coverage của `lint_node_bodies.py`

Không phải node type nào cũng bị gác thân. Một type bị **warn-skip** (stderr warning, **không bao giờ fail**)
khi rơi vào một trong hai trường hợp:

- `schemas/gen_schema.py` chưa dump được `NodeData_*` def nào cho nó; hoặc
- def có dump nhưng là **`_error` dump-stub** (dump hỏng).

Ngược lại thì thân node bị validate thật vs def.

**Coverage derive lúc chạy — không có allowlist hand-sync, và không doc nào được chép danh sách ra văn
xuôi** (chép là tạo đúng thứ thiết kế này tránh: một bản sao sẽ stale ngay khi `gen_schema.py` dump được
def thật và coverage **tự bật** cho type đó). Xem bằng lệnh:

```
.venv/bin/python tools/dify_base/lint_node_bodies.py --list-coverage
```

Ý nghĩa vận hành: **`warn-skip` không phải giấy phép** — nó nghĩa là gate này *không bắt được* thân sai của
type đó, nên hình dạng phải đến từ nguồn đã vetted (`docs/runtime-supplement.md`,
`templates/tool-catalog.json`, `templates/patterns/*`).

**Escape hatch:** một dòng comment **ở cột 0** `# lint-bodies: allow <node_id>` tắt mọi finding của node đó
(stderr ghi nhận). Cột 0 là cố ý — nội dung block-scalar của YAML luôn thụt vào sâu hơn key, nên một comment
cột 0 không thể nằm trong prompt string (chống giả mạo).

`schemas/dify-dsl-0.6.0.json` → `$defs.NodeData_*` hiện chỉ có **`lint_node_bodies.py`** đọc; root
`Node.data` cố ý để trần (`{type}` envelope) và có test ghim.

### 4.3 Không cưỡng chế — chỉ cảnh báo

- **preflight** — gate ③ hiện note khi build không runnable out-of-the-box.
- **import-probe / report** — ④ backend; `unresolved_plugin_todo` là một note của report.
- **Ask / Request-changes** — người. Ask là turn answer-only, **không bao giờ** ghi được `SPEC.md`/`main.yml`
  (2 lớp độc lập: permission-gate deny + byte-snapshot/restore, `server/lib/ask.ts`). Chỉ **Request changes**
  mới chạy lại phase và sửa artifact — không bao giờ suy ra từ nội dung tin nhắn.

---

## 5. Cách đo trạng thái

> **Doc này cố ý KHÔNG chứa số đo build.** Dân số `.runs/` là dữ liệu chạy, không phải trạng thái hệ
> thống: nó đổi mỗi build và biến mất khi ta refresh dữ liệu. Số ghi cứng vào đây sẽ sai ngay lần chạy
> kế tiếp. Phần dưới là **dụng cụ đo** — chạy để lấy số của thời điểm bạn cần.

### 5.1 Dữ liệu đo được nằm ở đâu

| Nguồn | Chứa gì |
|---|---|
| `apps/builder/.runs/<taskId>/task.json` | `status` · `phase` · `analysisPattern` · `analysisFeatures` · `fastMode` · `cost` (per-phase) · `liveTest` |
| `apps/builder/.runs/<taskId>/analyze.json` | `pattern` · `features` · `find_query` · `planned_nodes` |
| `apps/builder/.runs/<taskId>/report.json` | Kết quả ④ |
| `apps/builder/.runs/<taskId>/transcripts/implement.md` | Prompt đã render + output + **danh sách tool call ✓/✗** + `cost/turns/duration` của ③ |

Ba bẫy khi đọc dữ liệu này:

- `liveTest` dùng key **`verdict`** (`passed` / `infra_fail` / `need_input`), **không phải `status`** —
  query nhầm sẽ trả rỗng và trông như "không có dữ liệu".
- `task.json` **không đồng nhất schema** giữa các run: có run mang đủ
  `requirement`/`workflowSlug`/`taskId`/`liveTest`…, có run chỉ mang `artifacts`/`cost`/`fastMode`/`status`.
  Luôn `.get()`, đừng index thẳng, và đừng giả định một field tồn tại.
- Loại `kind: promote` khỏi mọi dân số build.

### 5.2 Lệnh

```bash
# Build + pattern + fastMode + cost + liveTest(verdict)
python3 - <<'EOF'
import json, glob, collections
st=collections.Counter(); pat=collections.Counter(); v=collections.Counter(); n=cost=fast=0
for f in glob.glob('apps/builder/.runs/*/task.json'):
    try: t=json.load(open(f))
    except: continue
    if t.get('kind')=='promote': continue
    n+=1; st[t.get('status')]+=1
    ap=(t.get('analysisPattern') or '').strip()
    pat['custom/none' if (not ap or ap=='custom') else ap]+=1
    if t.get('fastMode'): fast+=1
    if t.get('cost'): cost+=1
    lt=t.get('liveTest')
    if isinstance(lt,dict): v[str(lt.get('verdict'))]+=1
print(n, dict(st), 'fast=',fast, 'cost=',cost); print(dict(pat)); print(dict(v))
EOF

# Index
python3 -c "import json,collections; e=json.load(open('tools/dify_base/index.json')); \
print(len(e), dict(collections.Counter(x.get('source') for x in e)), \
'no-desc:', sum(1 for x in e if not x.get('description')))"

# Coverage của linter thân node
.venv/bin/python tools/dify_base/lint_node_bodies.py --list-coverage

# Transcript ③
ls apps/builder/.runs/*/transcripts/implement.md
```

---

## 6. Tra nhanh

| Cần | Ở đâu |
|---|---|
| Prompt các phase | `.claude/skills/dify-build/{analyze,spec,implement,draft,test}.md` + `SKILL.md` |
| Định nghĩa 4 phase + bảng 11 token | `apps/builder/server/lib/phases.ts` |
| Bơm `{{KNOWLEDGE}}` | `server/lib/orchestrator.ts:394-402` · `dify-io.ts:581` |
| Đường dẫn `{{PATTERN_PATH}}` | `server/lib/phases.ts:41-53` |
| Fold `analysisPattern` từ analyze.json | `server/lib/analysis.ts` (`applyAnalysisToTask`) |
| Prelude seed | `server/lib/scaffold.ts:118` (Dify) · `:165` (snapshot local) |
| Ghim ngôn ngữ trả lời | `server/lib/phases.ts:164` (`languagePin`) |
| Bảo vệ Ask (không ghi được artifact) | `server/lib/ask.ts` |
| Kệ + truy xuất | `templates/` · `tools/dify_base/{find.py,index.json,build_index.py}` |
| Schema node (29 def) | `schemas/dify-dsl-0.6.0.json` → chỉ `lint_node_bodies.py` đọc |
| Type nào bị gác thân / warn-skip | `lint_node_bodies.py --list-coverage` |
| Plugin identifier thật | `templates/tool-catalog.json` · sinh bằng `tools/dify_base/marketplace.py` |
| Transcript ③ | `apps/builder/.runs/<taskId>/transcripts/implement.md` |
| Cost mỗi phase | `task.json.cost` · `apps/builder/scripts/e2e-run.sh time <taskId>` |
| Gotcha runtime đã ghi | `AGENTS.md` §9 · `docs/runtime-supplement.md` · `docs/plugin-capabilities.md` |
