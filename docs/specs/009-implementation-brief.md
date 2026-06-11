# IMPLEMENTATION BRIEF & PLANNING PROMPT — Spec 009: Dify Workflow Builder (v2)

> **v2 changelog (2026-06-10)** — đã fix so với v1: (1) permission-model giờ là
> **provisional**, do Lát 0 spike chốt rồi **update spec** (không silently override);
> (2) deny-list bịt thêm in-repo critical paths; (3) thêm **post-turn confinement check**
> (git status) vì broad-Bash khiến deny chỉ best-effort; (4) **cred Dify chỉ ở backend**,
> không bao giờ vào env claude turn; (5) Phase ④ = backend-orchestrated (làm rõ "mỗi phase
> = turn"); (6) thêm slice **author 4 skill-prompt** sớm; (7) `workflowFile`/edit-existing;
> (8) guardrail **update spec khi correction được confirm**.

## Vai trò
Bạn sắp implement app "Dify Workflow Builder" (spec 009) trong repo `dify-projects`.
TRƯỚC khi viết code, hãy xuất ra một PLAN cụ thể theo lát-cắt-dọc. Brief này cho bạn
context đã verify, các quyết định đã chốt, và các chỗ spec viết SAI mà bạn phải đè lên
(và sau đó update lại spec). Chính xác quan trọng hơn nhanh: mọi giả định phải neo vào
file thật; tuyệt đối KHÔNG tin prose của spec về hành vi CLI/tool mà chưa kiểm bằng chính
file/lệnh.

## App là gì (mental model)
Một web app local mỏng, bọc quanh `claude` CLI CỦA CHÍNH USER, chạy lại quy trình build
sẵn có của repo (Analyze→Spec→Implement→Test) — **phase SINH NỘI DUNG (①–③) là MỘT TURN
CLAUDE; Phase ④ Test&Report do BACKEND chạy (không turn)** — dừng cho người duyệt giữa các phase.
- Frontend (Preact+Vite+TS): chat UI — sidebar (Project▸Workflow▸Task), khung chat có
  run-settings + nút ✔ gate inline + thanh phase, panel artifact/diff. Nó "ngu": chỉ hiển
  thị thứ backend stream + gửi confirm/reply.
- Backend (Node+Fastify): nhạc trưởng — spawn 1 turn/phase sinh, parse stream-json, ENFORCE
  gate (chỉ phát turn kế khi /confirm), stream qua SSE, **sở hữu toàn bộ I/O chạm Dify**, và
  chạy **post-turn verify** (correctness + confinement).
- App KHÔNG chứa build-logic. Sinh/validate/import nằm ở tool repo + quy trình 4-phase trong
  `.claude/skills/dify-build/`. Repo phải dùng được mà KHÔNG cần app.
- Auth: spawn `claude` local (subscription user, không API key), chạy local, Dify của user.

## ĐỌC TRƯỚC (ground truth — đừng bỏ qua)
1. `docs/specs/009-browser-workflow-builder.md` — spec (xem "SPEC CORRECTIONS": vài chỗ SAI;
   khi spike confirm, **update lại spec** cho khớp — repo cấm silent drift).
2. `AGENTS.md` — §3 build sequence, §4 conventions, §4.1 node ID, §9 pitfalls. Bất di bất dịch.
3. Tool repo sẽ shell: `tools/dify_base/{sync.py,init_project.py,find.py,lint_refs.py,
   lint_plugin_hashes.py}`, `skills/mango-svip/scripts/{generate_id.py,validate_workflow.py}`.
   Đọc argparse + exit code của TỪNG cái.
4. `templates/patterns/*.yml` — 5 pattern đã vetted.
5. Prior-art để COPY (không phải dependency) ở `/Users/quyenbt/Desktop/MyProjects/claude-nexus`
   — xem "NEXUS COPY-TARGETS".

## VERIFIED CONTRACTS (đã kiểm bằng file thật; nghi thì kiểm lại nhanh)
Tool repo:
- `sync.py push`: LUÔN tạo app MỚI (không update tại chỗ); hỏi y/N trên stdin → BẮT BUỘC `--yes`;
  KHÔNG ghi file — chỉ `print(f"\n✓ Import result: {json.dumps(result, indent=2)}")` (sync.py:317).
  ⚠ Vì `indent=2`, output là **JSON NHIỀU DÒNG** (dòng prefix kết thúc bằng `{`). Backend **KHÔNG**
  được strip-prefix 1 dòng (mất `app_id`); phải `json.loads` toàn bộ phần SAU `✓ Import result: ` đến
  hết stream — **hoặc bắt buộc thêm cờ `--json-out`** cho sync.py (sạch hơn; ưu tiên nếu parse stdout).
- `sync.py pull --project <slug>`: đòi `projects/<slug>/` TỒN TẠI sẵn; ghi
  `workflows/<app-name-slug>.yml` (KHÔNG phải `main.yml`).
- `sync.py list`: `sys.exit(msg)` (exit 1) cho CẢ "thiếu cred" LẪN RequestException (401/network)
  → KHÔNG phân biệt được bằng exit code (phải đọc stderr/message).
- `sync.py` đọc `DIFY_CONSOLE_URL/TOKEN` từ `os.environ`; chỉ load `projects/<slug>/envs/dev.env`
  khi có `--project`.
- `init_project.py`: cờ `--non-interactive/--name/--slug/--description/--app-type/--dsl-version/
  --primary-lang/--force`; KHÔNG có `--group`; scaffold flat `projects/<slug>/` với `workflows/`
  RỖNG; **CÒN ghi `.vscode/settings.json` ở repo-root** qua `subprocess.run(regen_vscode_settings.py)`
  (init_project.py:224-233); `--force` = `shutil.rmtree(target)` (init_project.py:143).
  → side-effect repo-root là **hành vi đã biết** — confinement check phải whitelist nó.
- 3 linter exit code KHÁC NHAU: `validate_workflow.py` chỉ 0/1 (KHÔNG có exit 2);
  `lint_refs.py` exit 2 = parse error; `lint_plugin_hashes.py` exit 2 = "no files" (nhưng PARSE
  error của nó lại exit **1**, không phải 2). → quy tắc "exit 2 = parse error" CHỈ đúng với
  `lint_refs.py`. Để bắt YAML truncated đáng tin: backend `yaml.safe_load` trước, đừng dựa exit code.
- `generate_id.py` mint ID timestamp-ms 13 chữ số; ID làm tay render thành text, linter KHÔNG bắt (§9).
- `find.py --json` có thật.
- `check_dsl_version.sh` + `regen_vscode_settings.py` đọc `(data.get("project") or {}).get("dsl_version")`
  → `group` PHẢI là sub-key trong mapping `project:`, KHÔNG phải scalar top-level (sẽ vỡ pre-commit).

Hành vi `claude` CLI — **PROVISIONAL, verify lại trong spike Lát 0** (quan sát trên 2.1.156; CLI behavior
version-dependent + docs sơ sài → ĐỪNG coi là chân lý đến khi spike confirm; spike kết quả ra sao thì
**update spec §E/§J + brief này** theo đó):
- stream-json: event `system/init` mang `session_id`; event `result` mang `is_error`. Turn-end = event `result`.
- Prompt feed qua stdin (không cần `-p` text) chạy được; `--resume <session_id>` nối context được.
- Headless `-p`: nghi vấn **AUTO-ALLOW tool vắng mặt trong allowlist (KHÔNG treo, KHÔNG fail)** → nếu đúng,
  allowlist KHÔNG dùng làm gate được; nếu sai (fail/treo), phải xử khác. **Spike phải chốt.**
- Tool bị DENY (deny rule): nghi vấn Claude **ÂM THẦM đi vòng** (đổi cách làm) và turn vẫn `is_error:false,
  exit 0`. → nếu đúng: **permission ≠ correctness** (xem QĐ #3) và **deny chỉ chặn hành động cụ thể, không
  báo lỗi**. Spike phải xác định: deny có thực sự NGĂN được write không, hay chỉ chặn 1 đường (Bash vẫn vòng).
- settings.json `permissions`: `deny` đè `allow`. Rule path-scoped `Edit()/Write()/Read()`: **nghi** chỉ
  honored trong settings.json, KHÔNG ở cờ `--allowedTools` trần → vì vậy ta dùng **file settings** (`--settings`),
  không nhồi path-rule vào cờ. (Mâu thuẫn với §E hiện tại của spec — spike chốt, rồi sửa spec.)
- `cwd` KHÔNG rào cứng write (broad Write/Bash ghi ra ngoài repo được). Host `~/.claude/settings.json`
  LEAK vào turn trừ khi cô lập bằng `--settings <file>` + `--setting-sources` (xác nhận tổ hợp cờ loại
  `user`-global trong spike).

## QUYẾT ĐỊNH ĐÃ CHỐT
> Lưu ý: QĐ #1 (permission) là **provisional — Lát 0 spike chốt hành vi thật, rồi update spec §E/§J/#10/#23**.
> Các QĐ còn lại không phụ thuộc spike.

1. **PERMISSION (provisional)** = broad-allow settings.json + deny carve-out (KHÔNG allowlist per-script,
   KHÔNG `--dangerously-skip-permissions`). cwd = repo. Cô lập host bằng `--settings <file>` +
   `--setting-sources` (xác nhận tổ hợp loại `user`-global trong spike). **Permission là lớp SECURITY mềm,
   KHÔNG phải lớp correctness** (xem #3) và confinement thật do **post-turn confinement check** lo (xem #3b).
   File mẫu `apps/builder/headless-settings.json` (deny bổ sung in-repo critical paths; dialect
   **đã sửa theo Lát 0 spike E0**: repo-relative = **KHÔNG có leading slash** (gitignore-style);
   leading `/` KHÔNG anchor về repo-root → là **no-op** [`Write(/tools/**)` không match `tools/`];
   `//x`=absolute, `~/x`=home [hai dạng này spike CHƯA test — xem `009-spike-findings.md` §5]):
   ```json
   { "defaultMode": "acceptEdits",
     "permissions": {
       "allow": ["Bash","Read","Write","Edit","Glob","Grep"],
       "deny": [
         "Read(~/.ssh/**)","Read(~/.aws/**)","Read(~/.claude/**)",
         "Write(//etc/**)","Write(//usr/**)","Write(//bin/**)","Write(//System/**)",
         "Edit(//etc/**)","Edit(//usr/**)","Edit(//bin/**)","Edit(//System/**)",
         "Write(.git/**)","Edit(.git/**)",
         "Write(tools/**)","Edit(tools/**)","Write(skills/**)","Edit(skills/**)",
         "Write(.venv/**)","Edit(.venv/**)","Write(.claude/**)","Edit(.claude/**)",
         "Read(projects/*/envs/*.env)",
         "Bash(sudo:*)","Bash(rm -rf /)","Bash(rm -rf ~)" ] } }
   ```
   ⚠ **Hạn chế đã biết (đã verify ở Lát 0 — đừng tự lừa):** deny `Write()` chặn được cả Write/Edit tool
   LẪN naive shell redirect `Bash(echo > tools/x)` (Claude Code parse redirect tĩnh — E2b, **không** vòng
   được như lo ban đầu). Nhưng **opaque** write `Bash(python3 -c "open('tools/x','w').write(...)")` thì
   **escape** (E2d); và KHÔNG thể deny "project khác" bằng pattern tĩnh (sẽ dính cả slug đang làm).
   → Rào cứng thật = **#3b post-turn confinement check (reject + REVERT bằng `git checkout`/`clean`)**,
   không phải deny-list. Muốn cứng tuyệt đối: sandbox/container (ngoài scope v1).
2. **PHASE = TURN (①–③), Phase ④ = BACKEND.** Mỗi phase sinh (①Analyze ②Spec ③Implement) = MỘT TURN MỚI,
   được trao tay PATH artifact của phase trước (KHÔNG resume xuyên phase). **Phase ④ Test&Report KHÔNG có
   claude turn** — backend tự: validate + synthesize `report.json` (deploy=none), hoặc chạy `sync.py push`
   (selfhost), hoặc emit YAML (cloud). File trên đĩa là NGUỒN SỰ THẬT, không phải chat — đây là cái làm
   restart/recover được.
3. **POST-TURN CORRECTNESS CHECK** sau MỖI turn (permission ≠ correctness):
   - Phase ③: backend TỰ re-run cả 3 linter (exit 0) + regex check ID đúng 13-digit timestamp-ms (linter
     KHÔNG bắt ID tay) + check artifact tồn tại & non-empty. Để phân biệt "YAML truncated → regenerate" vs
     "lint fail → fixable": **`yaml.safe_load` trước** (hoặc key trên `lint_refs.py` exit 2), KHÔNG dựa
     `validate_workflow.py` (chỉ 0/1).
   - Mọi phase SINH (①–③): tuyệt đối KHÔNG coi `is_error:false` = phase OK; phải kiểm artifact + nội dung
     tối thiểu. (Phase ④ không có turn → không có `is_error`; backend tự validate + synthesize report.)
3b. **POST-TURN CONFINEMENT CHECK** sau MỖI turn (rào cứng filesystem thật):
   - Chạy `git status --porcelain` (+ scan mtime với file untracked). **Reject turn** (→ `status: error`)
     nếu có file bị tạo/sửa NGOÀI whitelist: `projects/<slug>/`, `apps/builder/.runs/<taskId>/`, và các
     side-effect đã biết của `init_project.py` (`.vscode/settings.json` repo-root, `projects/<slug>/.dify-workspace.yaml`).
   - Đây là lớp bù cho việc deny-list mềm (QĐ #1) — đảm bảo một turn không ghi lén ra `tools/`/project khác.
4. **GATE enforce bằng BACKEND**: phát turn kế CHỈ khi POST /confirm. `confirm_mode` mặc định "each step".
   Implement có **2 biến thể gate**: clean (lint 0 → [✔ Test][💬]) vs still-failing (cap 5, lint≠0 →
   [Accept anyway][Keep trying][Abandon]); ở `auto` thì **hard-stop** ở still-failing, không import lint≠0.
5. **DIFF producer** = backend tự tính (`difflib.unified_diff` hoặc `git diff --no-index`), KHÔNG dùng
   `sync.py diff` (đó là remote-vs-local). Base theo case: edit-existing (file `<workflowFile>` cũ) /
   Dify-seed (file pull) / no-seed (pattern template). Payload `{path, diff}` cho SplitDiffView.
6. **DEPLOY + Dify I/O do BACKEND sở hữu (cred KHÔNG vào turn).** Mặc định `none` (chỉ ghi+validate, không
   chạm Dify). `selfhost`: backend chạy `sync.py push --yes` (gated bởi nút Import), bắt `app_id` từ stdout/
   `--json-out`, dựng `app_url` (strip `/console/api` → `/app/<id>/workflow`). `cloud`: emit YAML + hướng
   dẫn Studio. **TẤT CẢ lệnh chạm Dify (`list`/`pull`/`push`) chạy ở BACKEND subprocess** với
   `DIFY_CONSOLE_URL/TOKEN` trong env của **riêng subprocess đó** — **claude turn KHÔNG BAO GIỜ nhận token**.
   Phase ① seed từ Dify-app: vì `pull` đòi `projects/<slug>/` TỒN TẠI (QĐ #9; slug fix up-front), backend
   **scaffold folder RỒI `pull`** TRƯỚC turn Analyze; turn Analyze chỉ READ file local (không cần cred).
   (Whitelist confinement #3b đã gồm `projects/<slug>/` nên scaffold sớm này hợp lệ.)
7. **WORKFLOW model + workflowFile.** Sidebar: Project(=`project.group`)▸Workflow(=folder `projects/<slug>/`)▸
   Task. Một folder có thể chứa nhiều `*.yml` = **biến thể của CÙNG workflow**; edit-existing chọn 1 file →
   lưu `workflowFile` trong task state. New workflow → `workflowFile = main.yml`. Backend ghi `project.group`
   (sub-key, giữ comment bằng ruamel) HOẶC thêm cờ `--group` cho `init_project.py` (sạch hơn).
8. **SKILL→PROMPT contract (ENGINE — author SỚM, Lát 0.5).** 4 file trong `.claude/skills/dify-build/`
   (analyze/spec/implement/test) + biến inject `{{TASK_ID}} {{SLUG}} {{WORKFLOW_FILE}} {{SEED_PATH}}
   {{REQUIREMENT}} {{PRIOR_ARTIFACT}} {{DEPLOY}}`. Đây LÀ engine — "prompt tốt tới đâu, sản phẩm tốt tới đó".
   Phải có (ít nhất `implement`) TRƯỚC Lát 1. **Lưu ý:** trong APP chỉ `analyze/spec/implement` được backend
   spawn thành turn (①–③); `test.md` là phần quy trình cho người/CLI dùng skill NGOÀI app — Phase ④ trong
   app do backend chạy (QĐ #2), không spawn turn từ `test.md`. `{{DEPLOY}}` chủ yếu drive logic backend ④.
9. **Scaffold/move ở Spec-gate không nguyên tử** → đặt status `scaffolding` để recovery bắt được + idempotent.
   Cancel/lock: thêm `POST /api/tasks/:id/cancel` (nhả run-lock). Lock: `running`+`awaiting_confirm` GIỮ;
   `done`/`error`/`cancelled` NHẢ; boot → mọi `running`→`error` + clear lock.

## SPEC CORRECTIONS (spec SAI ở đây — làm theo cái này; khi spike confirm thì UPDATE LẠI SPEC)
- **#10/§E "tool ngoài allowlist fail nhanh"** → nghi SAI (tool có thể bị bỏ qua/auto-allow âm thầm). Thay
  bằng post-turn positive check (QĐ #3). Bỏ allowlist byte-identical per-script (QĐ #1). **Spike chốt.**
- **#23/§J "reject write ngoài projects/<slug>/ bằng path-scoped rule + dontAsk"** → nghi KHÔNG enforce
  được kiểu đó (deny mềm + Bash vòng). Dùng deny carve-out (soft) + **post-turn confinement check** (QĐ #3b)
  làm rào cứng. Viết lại tiêu chí #23 cho khớp. **Spike chốt cách deny thực sự hành xử.**
- **§E hiện tại nói "path-scoped qua `--allowedTools` + `dontAsk`"** → nghi sai (path-rule chỉ trong
  settings.json; "deny=fail fast" sai). Brief này dùng **settings.json file + broad-allow + deny + post-turn
  check** thay thế. → Sau spike, **update §E/§J/#10/#23** cho khớp model thắng.
- **§I "exit 2 = parse error"** → chỉ đúng `lint_refs.py`. Backend nên `yaml.safe_load` trước, hoặc key trên
  `lint_refs.py`. (Spec §I bản mới đã bỏ exit-code branching — giữ vậy.)
- **§A "report.json từ push app_id, không transcribe Claude" NHƯNG push chạy trong turn** → mâu thuẫn.
  Giải bằng QĐ #6 (Phase ④ = backend chạy push, không turn).
- **Cred injection không được spec** → QĐ #6: backend sở hữu Dify I/O, cred CHỈ ở backend subprocess, KHÔNG
  vào turn. `/api/seeds` chạy `sync.py list` (backend, cần env, không project).
- **§E allowlist + §C cột Tooling vẫn cho TURN chạy `sync.py`** → BỎ `sync.py` (list/pull/push) khỏi
  per-turn allowlist (chỉ backend chạy — QĐ #6). Turn allowlist chỉ giữ `find.py`/`init_project.py`/3 linter/
  `generate_id.py`. Sửa §C cột Tooling của ①/④: Dify I/O → "backend".
- **§A/§C model Phase ④ như 1 TURN** (gate-check = `result` event; "headless turn would hang" khi push) →
  SAI theo QĐ #2 (④ KHÔNG có turn). Update §A: ④ gate = `report.json` tồn-tại + non-empty (bỏ `result`
  event); §C: chuyển `sync.py push` của ④ sang cột backend.
- **`init_project.py` không có `--group`** → backend tự ghi `project.group` (ruamel giữ comment) HOẶC thêm
  cờ `--group` (sạch hơn). Confinement check phải whitelist side-effect repo-root `.vscode/settings.json`.
- **Idempotency ④**: pre-push `push_intent` marker (spec §I bản mới đã đúng) — backend chạy push nên dễ:
  ghi marker trước, bắt `app_id` sau, reconcile bằng `sync.py list` nếu crash giữa chừng.

## NEXUS COPY-TARGETS (đã verify LOC, chính xác ~3%)
- Backend: `claude-session.ts` (282 dòng — copy lõi spawn+NDJSON line-buffer, BỎ env SWARM_*/NEXUS_*/MCP/
  multimodal, TỰ re-implement turn-end + session_id capture — phần load-bearing KHÔNG có sẵn ở đây).
  `sse.ts` (adapt, gỡ coupling Container/auth/RingBuffer). `gate-token-validator.ts` KHÔNG dùng (009 gate
  out-of-band qua /confirm). `task-spawning.ts` chỉ tham khảo (lấy ~20 dòng capture session_id/result).
- Frontend: ChatMessage(389), sse-client(200), ChatInputBar(142), useChatReply(145),
  InlinePermissionPrompt(245→rewire sang gate /confirm), PipelineTimeline(143→4 phase, **SSE-driven** không
  poll), SplitDiffView(120)+diff-parser(327) copy gần nguyên, TaskList(642→viết lại grouping theo
  project.group). `markdown.ts` (888, coupling nặng — ĐỪNG bring, SWAP bằng renderer ~80-150 dòng).
  `vite.config/tsconfig/package.json` lift+prune. (Run-settings dưới input + sidebar tree là **net-new**,
  không phải copy — re-budget Week 3.)
- BÀI HỌC CORRECTNESS từ nexus: nexus KHÔNG có verify cấu trúc sau turn (chỉ `is_error`), gate per-phase là
  STUB (#079) → KHÔNG có gì copy cho phần correctness; 009 PHẢI tự xây (QĐ #3/#3b). Đây là lợi thế domain-specific.

## NHIỆM VỤ CỦA BẠN: xuất ra PLAN
Tạo plan implement theo LÁT CẮT DỌC — mỗi lát CHẠY end-to-end & demo được, mỏng dần từ lõi ra vỏ.
Bắt đầu bằng spike. Xếp theo RỦI RO: spike CLI + gate + post-turn verify (net-new) TRƯỚC UI (đa số là copy).
Với MỖI lát, ghi rõ: (a) mục tiêu, (b) trong/ngoài scope, (c) file tạo/sửa, (d) lệnh substrate chính xác,
(e) acceptance check (chứng minh nó chạy thế nào), (f) corrections/gotchas nào áp dụng, (g) **spec cần update
gì** (nếu lát đó confirm một correction).

Khởi điểm (tinh chỉnh nếu spike đổi giả định):
- **Lát 0 — SPIKE (½–1 ngày):** spawn `claude` headless với `headless-settings.json`; chốt 5 câu hỏi
  PERMISSION (xác định trước khi viết bất cứ gì khác):
  (1) chạy 1 tool repo (vd `find.py`) không treo? (2) tool/path bị **deny** xử sự ra sao — có thực sự NGĂN
  write không, hay chỉ chặn 1 đường còn Bash vẫn vòng? `is_error`? (3) broad Write có ghi ra ngoài repo
  không? (4) tổ hợp `--settings/--setting-sources` cô lập host `~/.claude` được không? (5) shape event
  `init`/`result` + session_id capture. → **chốt §E thật + cách verify, rồi update spec §E/§J/#10/#23.**
- **Lát 0.5 — SKILL PROMPTS (½ ngày):** author `.claude/skills/dify-build/{analyze,spec,implement,test}.md`
  (ít nhất `implement` cho Lát 1) theo QĐ #8 + AGENTS.md §3/§4. Đây là engine.
- **Lát 1 — SKELETON:** backend spawn 1 phase (③ Implement) trên requirement hardcode + seed có sẵn → parse
  result → ghi `<workflowFile>` → **POST-TURN CHECK** (linter+ID+confinement). 1 lệnh curl. Chứng minh:
  spawn+stream-json+verify.
- **Lát 2 — CHUỖI 4 PHASE:** nối ①→②→③ (turn) →④ (backend) tự chạy (chưa gate), backend verify sau mỗi
  turn, deploy=none.
- **Lát 3 — GATE:** dừng `awaiting_confirm` mỗi phase; `/confirm` mới đi tiếp; `/reply` trong phase; run-lock
  + cancel + lock-release table. Vẫn curl. ← phần net-new "crux".
- **Lát 4 — UI:** SSE + 3 vùng, copy component nexus, nút gate inline.
- **Lát 5 — VỎ:** selfhost push/app_url (backend, cred chỉ ở backend), seed picker, diff panel,
  restart-recovery/idempotency (`scaffolding`/`push_intent`), security carve-out + redaction, Cloud
  fallback, docs.

## GUARDRAILS
- Mọi claim neo vào file:line thật. Nếu thực tế LỆCH brief/spec → DỪNG và báo, đừng che.
- **Khi spike/implement confirm một SPEC CORRECTION → update `docs/specs/009-browser-workflow-builder.md`
  ngay** (repo cấm silent drift). Brief này và spec phải hội tụ, không phân kỳ.
- App KHÔNG chứa build-logic (sinh/validate/import ở tool repo + skill).
- Verify SAU MỖI turn: correctness (#3) + confinement (#3b). KHÔNG tin `is_error` đơn độc. Permission ≠ correctness.
- deploy=none luôn an toàn; KHÔNG auto-import nếu không có nút confirm rõ ràng. Cred Dify KHÔNG vào turn.
- Localhost only (bind `127.0.0.1` hardcoded); 1 build tại 1 thời điểm; không log token vào SSE/.runs.
- Nhịp 1 (chốt prompt 4-phase, Lát 0.5) là việc thật nhất — prompt tốt tới đâu, sản phẩm tốt tới đó.
