# Hiện trạng — turn & sandbox

Builder chạy một phase như thế nào: spawn `claude` con ra sao, nó được phép làm gì, ai chặn, và
kiểm lại gì sau khi nó xong.

Phạm vi: `claude-session.ts` · `turn-runner.ts` · `shell.ts` · `hooks/permission-gate.ts` ·
`hook-check.ts` · `post-turn.ts` · `ask.ts` · `headless-settings.json`.

> - Chuỗi trong backtick là **nguyên văn** code phát ra hoặc đọc — không dịch.
> - Tài liệu này mô tả **bất biến**, không chứa số đo.
> - Gate/flow (`gate.ts`) và nội dung prompt từng phase: doc khác. Đây chỉ là **cơ chế thực thi một turn**.
> - `lock.ts`: [build-lifecycle.md](build-lifecycle.md) §5 sở hữu.

---

## 1. Một turn là gì

Một phase ①②③ = **một process `claude` con**, spawn mới mỗi lần, cwd = **repo root**.
④ Test không phải turn — nó là code backend.

Flag spawn (`claude-session.ts:101-117`):

```
--output-format stream-json --verbose
--permission-mode acceptEdits
--settings <abs>/apps/builder/headless-settings.json
--setting-sources local
[--resume <sessionId>]
```

Prompt đi qua **stdin**, không qua argv — một prompt mở đầu bằng `---` mà nằm trên argv sẽ bị đọc
thành CLI flag.

`--setting-sources local` loại **cả hai** layer settings khác:

| Bị loại | Hệ quả |
|---|---|
| `~/.claude` của host | Settings cá nhân trên máy không lọt vào turn |
| **Layer `.claude/` của chính repo** — kể cả hook PreToolUse nằm trong đó | `.claude/settings.json` của repo **KHÔNG** bảo vệ turn build. Cổng gác **duy nhất** là hook khai trong `headless-settings.json` (§3.2) |

### Env của turn con

`claude-session.ts:120-139` **xoá** khỏi env con:

| Xoá | Vì sao |
|---|---|
| `DIFY_*` (`DIFY_CONSOLE_TOKEN`, `DIFY_CONSOLE_URL`, `DIFY_API_KEY`…) | **Token Dify không bao giờ vào một turn.** Mọi I/O Dify là backend-owned |
| `CLAUDE_CODE*`, `CLAUDECODE` | Không kế thừa ngữ cảnh Claude Code của process cha |

Và **thêm**:

| Thêm | Ai đọc |
|---|---|
| `BUILDER_TASK_ID = <taskId>` | Hook, để biết `.runs/<id>/` nào là "của mình" (§3.4) |
| `BUILDER_ASK_MODE = 1` — **chỉ** turn Ask | Hook, để cấm mọi ghi (§5) |

Turn phase/reply/judge bình thường **không bao giờ** set `BUILDER_ASK_MODE`.

## 2. Kết thúc một turn

`turn-runner.ts` đọc stream và chốt theo **một** event `result` duy nhất. Ba đường kết thúc:

| Đường | Kết quả |
|---|---|
| Có event `result` | `isError = result.is_error` |
| Process chết **không** có `result` | `isError: true` + note phân loại từ stderr (§2.1) |
| Spawn fail | `isError: true` + note lớp `spawn` |
| Quá `timeoutMs` | `isError: true`, note `phase timed out after <n>s — retry or simplify`, rồi mới `forceKill()` |

Thứ tự ở nhánh timeout là **cố ý**: resolve trước, kill sau — vì `forceKill()` bắn `onExit(null)`,
kill trước sẽ đè note timeout bằng note exit tổng hợp.

> **`result.is_error` KHÔNG phải "phase thành công".** `turn-runner.ts:9-11` nói thẳng: một
> `tool_result.is_error=True` lẻ **không** làm hỏng turn, và `is_error:false` **không** đồng nghĩa
> workflow đúng. **`post-turn.ts` mới là nguồn phán quyết** (§4).

### 2.1 Phân loại turn chết

`classifyTurnFailure()` đọc **tail stderr** (đã `redactSecrets`) → lớp + note. First-match-wins, cụ
thể trước:

| lớp | bắt bởi |
|---|---|
| `usage_limit` | `usage limit` · `session limit` · `rate limit` · `credit balance` · `quota` · `429` · `overloaded` |
| `auth` | `logged in` · `authentication` · `unauthorized` · `401` · `invalid api key` · `oauth` |
| `network` | `ENOTFOUND` · `ECONNREFUSED` · `ETIMEDOUT` · `EAI_AGAIN` · `fetch failed` |
| `spawn` | `ENOENT` · `command not found` · `no such file` |
| `unknown` | còn lại — note kèm 2 dòng stderr cuối |

Dòng khớp được nhúng **nguyên văn**, nên phân loại sai chỉ là lỗi thẩm mỹ: sự thật luôn hiện ra.
Note EN **cố định wording** — `web/src/lib/i18n.ts` (`NOTE_JA`) khớp theo tiền tố; đổi chữ phải đổi
kèm frame JA + test.

## 3. Sandbox: ai chặn cái gì

**Hai lớp, không phải một.**

### 3.1 Lớp tĩnh — `headless-settings.json`

`permissions.allow`: `Bash` · `Read` · `Write` · `Edit` · `Glob` · `Grep`.
`permissions.deny`: glob theo **đường dẫn** (`Read(~/.ssh/**)`, `Write(.venv/**)`,
`Read(apps/builder/.env)`, `Write(tools/**)`, …).

**Lớp này một mình là không đủ, và đó là lý do lớp 2 tồn tại.** Một deny theo glob khớp **path** —
nó **không nhìn được vào trong một lệnh Bash**. Các phase buộc phải chạy `.venv/bin/python <script>`,
mà `python` đọc/ghi *file bất kỳ*, nên `python -c "open('apps/builder/.env')"` vượt qua **mọi** glob
deny. Chuỗi hậu quả đầy đủ (`permission-gate.ts:5-11`): exfil token Dify → ghi đè `.venv/bin/python`
→ backend sau đó chạy `sync.py` **bằng chính interpreter đã bị đầu độc**, mang theo token → RCE. Và
confinement sau turn (§4) **mù với file gitignored** nên không revert lại được.

### 3.2 Lớp thật — PreToolUse hook

`hooks/permission-gate.ts`, matcher `.*`, chạy **in-process trước mỗi tool call**, trả allow/deny.
Nó **nhìn được vào trong** lệnh Bash.

Một file tự chứa, **không import tương đối**, để chạy bằng `node` trần ở cả dev lẫn prod
(Node ≥ 22.6 chạy `.ts` native).

**Triết lý: allowlist-first / default-deny.** Builder chạy một tập lệnh cố định và nhỏ, nên mặc định
an toàn là **từ chối hết trừ những gì đã liệt kê** — ngược với deny-list.

Thứ tự quyết định trong `decide()`:

| # | Bước | Kết quả |
|---|---|---|
| 0 | payload không phải object | `deny` — **fail closed** |
| 0 | `checkForbiddenPath()` | `deny` — chạy **trước hết**, không thể bị các bước sau ghi đè |
| 1 | `Bash` | `analyzeBashCommand()` — **luôn** allow/deny, **không bao giờ** abstain |
| 2 | Ask mode + tool ghi | `deny` — `Ask mode — this turn may not write files` |
| 3 | tool ghi (`Write`/`Edit`/`MultiEdit`/`NotebookEdit`) | `allow` — `in-project write` |
| 4 | tool đọc (`Read`/`Glob`/`Grep`/`TodoWrite`/`WebSearch`) | `allow` |
| 5 | tool lạ | `abstain` (`{}`) — nhường settings; hook **không bao giờ nới rộng** |

Bash **không bao giờ abstain**: `permissions.allow:["Bash"]` sẽ cho qua bất cứ thứ gì hook bỏ phiếu
trắng.

**Fail closed ở mọi nhánh**: payload hỏng → deny; `decide()` throw → deny
(`permission hook error — fail closed`). Lý do: throw sẽ **không phát ra decision nào**, và Claude
Code coi "không decision" = **fail OPEN** — tắt nguyên cổng cho call đó.

Ngoại lệ: **không đọc được stdin** → `abstain` (để người dùng Claude Code bình thường trên repo này
không bị chặn).

### 3.3 `analyzeBashCommand()` — 6 cửa

| # | Cửa | Luật |
|---|---|---|
| 1 | **Ký tự** | `SIMPLE_COMMAND = /^[A-Za-z0-9 _./:=@,+-]+$/`. Bất kỳ metachar nào (`\| & ; < > $ \` ( ) { } * ? ~ ! # \`, newline) ⇒ deny. Chặn nguyên lớp chaining/redirect/subshell/expansion/glob/background **không cần AST shell**. **Nháy `'` `"` bị loại khỏi tập cho phép** — vì `cat apps/builder/.e''nv` không mang chuỗi con `.env` qua được bước kiểm secret, mà shell vẫn gộp nháy lại và đọc token |
| 2 | **Python** | Chỉ `.venv/bin/python` (relative, hoặc absolute kết thúc bằng nó). `python`/`python3` trần ⇒ deny. Có `-c`/`-e`/`-m` hoặc không có script ⇒ deny. Script phải thuộc `ALLOWED_PYTHON_SCRIPTS` |
| 3 | **Verb nguy hiểm** | `rm` `sudo` `chmod` `curl` `wget` `cp` `mv` `find` `sed` `awk` `nc` `xargs` `eval` … ⇒ deny. Shell (`bash` `sh` `zsh`…) ⇒ deny. Interpreter trần (`node` `perl` `ruby`…) ⇒ deny |
| 4 | **git** | Chỉ `status` / `diff`, **và** mọi flag phải thuộc `SAFE_GIT_FLAGS`. `git diff` **không** read-only tự thân: `--output=<f>` **ghi** file bất kỳ, `--no-index <a> <b>` **đọc** file bất kỳ |
| 5 | **Inspector** | `ls` `cat` `head` `tail` `pwd` `wc` `echo` `true` — không thêm quyền nào so với tool Read/Glob/Grep, và không ghi được (redirect đã chết ở cửa 1) |
| 6 | **Đuôi** | default-deny: `command not in the Builder allow-set: <base>` |

`ALLOWED_PYTHON_SCRIPTS` = **đúng** 6 script: `find.py` · `generate_id.py` · `validate_workflow.py` ·
`lint_refs.py` · `lint_plugin_hashes.py` · `lint_node_bodies.py`.

`sync.py` và `init_project.py` **cố ý VẮNG MẶT** — chúng backend-owned; token không vào turn.

> **Hệ quả vận hành cho prompt phase:** shell `grep`/`find`/`sed`/`awk` và mọi pipe/redirect **bị
> hook từ chối**, nhưng **tool Grep/Glob/Read thì được** (`permissions.allow`). Một turn tìm bằng
> shell sẽ đốt một call cho mỗi lần thử. `SKILL.md` dạy đúng điều này.

### 3.4 `checkForbiddenPath()` — đường dẫn cấm

Chạy **trước** mọi logic allow, không thể bị ghi đè.

**Đọc — `pathIsSensitiveRead()`.** Chuẩn hoá path trước (gộp `.`/`..`, bỏ slash thừa) nên
`apps/builder/.env/` hay `.runs/<own>/../<sibling>/x` không lách được.

- basename bắt đầu **hoặc** kết thúc bằng `.env` (bắt `.env`, `.env.local`, `dev.env`). File
  `config.env.yml` **không** dính — basename kết thúc `.yml`.
- `.netrc` `.npmrc` `.git-credentials` `.gitconfig` `.pgpass` `credentials` `id_rsa` `id_ed25519` …
- đuôi `.pem` `.key` `.p12` `.pfx`
- thư mục `.ssh/` `.aws/` `.gnupg/` `.docker/` `.kube/` `.config/`

**Ghi — `pathIsProtectedWrite()`, ALLOWLIST.** Deny-list không bao giờ liệt kê hết được mục tiêu đầu
độc; allowlist hai gốc hợp lệ thì **đầy đủ**. Resolve theo `cwd` (= repo root) nên relative/absolute
về cùng một dạng và `..` bị gộp ⇒ không trèo ra ngoài được.

Ghi được **chỉ**:
- `projects/**` (chéo project/workflow để §4 lo)
- `.runs/<own taskId>/**` và `apps/builder/.runs/<own taskId>/**`
- `.vscode/settings.json`

**Mọi thứ khác bị bảo vệ** — kể cả code của chính app, `tools/`, `skills/`, `.venv/`, `.git/`,
`.claude/`, và `.runs/<taskId khác>/`.

**Bash cũng bị soi:** `commandReferencesSecret()` tách token lệnh (cửa 1 đã bảo đảm không có
nháy/metachar ⇒ token chính là thứ shell thấy) và chạy `pathIsSensitiveRead()` trên từng token, kể
cả phần sau `--flag=<path>`.

### 3.5 Boot từ chối chạy nếu hook hỏng

`hook-check.ts` smoke-test hook thật lúc boot (spawn đúng command, đẩy một payload PreToolUse mẫu
qua stdin). `gateBootOnHook()`: hook **không load được** ⇒ **backend từ chối khởi động**.

Lý do: turn chạy `--permission-mode acceptEdits`; mất hook thì sandbox **fail OPEN** — chạy tiếp là
chạy không cổng gác. Nguyên nhân thường gặp: host Node < 22.6 không chạy được hook `.ts`.

Thoát hiểm: `BUILDER_ALLOW_UNGUARDED=1` — khởi động **không có cổng gác**, tự chịu.

## 4. Sau turn: `post-turn.ts`

Chạy **cả hai** kiểm, **không bao giờ** tin `result.is_error`:

**(a) Correctness** — `yaml.safe_load` (bắt file cụt) → **mọi linter exit 0** → mọi node id khớp
`^\d{13}(start)?$` → artifact tồn tại và khác rỗng.

> Số lượng linter: `linters.ts` → `LINTERS` là **định nghĩa duy nhất**, và `lintClean()` là predicate
> duy nhất mà **cả** gate ③ **lẫn** tiền-điều-kiện Import ④ dùng. Đừng đếm từ chỗ khác. Chi tiết từng
> linter: doc linters.

**(b) Confinement** — chạy **trước** (a), để danh sách file cần lint không bao giờ chứa path sắp bị
revert; **một** snapshot `git status` phục vụ cả hai.

### Confinement là baseline-delta

Repo mang sẵn thay đổi chưa commit. Nên chỉ so **path mà TURN mới làm bẩn** = `after \ baseline`;
path đã bẩn từ trước **không bao giờ** bị đụng.

Whitelist (`post-turn.ts:312-320`):
- `projects/<project>/<workflowSlug>/**` (chỉ khi cả hai non-null — ①/② chưa scaffold thì **mọi** ghi
  vào `projects/` là breach)
- `apps/builder/.runs/<taskId>/**`
- `.runs/<taskId>/**` — skill bảo turn ghi vào dạng rút gọn này; backend **relocate** sang canonical
  ngay sau turn
- `.vscode/settings.json`

**Chỉ revert path nằm trong `projects/`.** Vì hook có đúng một chỗ nới rộng cố ý: nó **blanket-allow
cả `projects/`** và đẩy việc trị chéo-project xuống đây. Suy ra: một path bẩn **ngoài** `projects/`
**không thể** do turn này gây ra (hook đã chặn) ⇒ đó là **sửa đổi bên ngoài đồng thời**. Revert nó sẽ
phá việc không liên quan **và** đánh trượt một build vô tội ⇒ chỉ **log**, không revert.

Breach ⇒ luôn **hard error**.

> Confinement là **backstop, không phải phòng tuyến chính**. Nó **mù với ghi vào file gitignored**
> (ghi `.venv/bin/*` chỉ hiện ra dưới dạng `!! .venv/` gộp, kể cả `--ignored`) — đó **chính xác** là
> vì sao hook, chứ không phải nó, là thứ chịu lực.

## 5. Ask — hai lớp độc lập

Turn Ask trả lời, **không bao giờ** được ghi `SPEC.md`/`main.yml`. Bảo đảm bằng **hai lớp không phụ
thuộc nhau**, không phải bằng cách tin model:

| Lớp | Cơ chế |
|---|---|
| 1 — chính, cấu trúc | `ClaudeSession({askMode:true})` ⇒ `BUILDER_ASK_MODE=1` ⇒ hook **deny mọi tool ghi** (§3.2 bước 2) |
| 2 — backstop | **byte-snapshot/restore** trên cả hai gốc ghi được của build; lệch byte ⇒ khôi phục + ghi nhận `AskFileAnomaly` |

Restore lớp 2 **cô lập theo từng file**: một file hỏng (EACCES/ENOSPC) **không** làm hỏng phần còn
lại; file không khôi phục được thì gắn cờ `restoreFailed`.

Snapshot fail vì lý do **khác** "không tồn tại" (EACCES/EIO…) thì **rethrow** — không được im lặng coi
như rỗng, vì thế là làm mù luôn phép so byte.

## 6. Run lock

Bất biến **một turn tại một thời điểm** (`lock.ts`, `turnHolder`) là thứ khiến confinement
baseline-delta ở §4 đúng được: nhiều nhất một build ghi cây file tại một thời điểm, nên delta so
với baseline `git status` không bao giờ lẫn dấu vết turn của build khác.

Cơ chế đầy đủ (ai giữ, khi nào nhả, 409 nghĩa là gì): [build-lifecycle.md](build-lifecycle.md) §5.

## 7. Backend chạy tool thế nào (không phải turn)

`shell.ts` — **luôn** `execFile` với **mảng argv**, **không bao giờ** chuỗi shell ⇒ slug/path độc
không chèn được metachar.

`runPython()` chạy `<projectsDir>/.venv/bin/python`, cwd = `projectsDir`, và **xoá `DIFY_*` khỏi env
con**: linter và `init_project.py` không cần token. Token vào **đúng một** subprocess: `sync.py`, do
`dify-io.runSyncPy` tự tiêm.

## 8. Guard ở đâu

| file | phủ |
|---|---|
| `apps/builder/test/permission-gate.test.ts` | quyết định của hook — allowlist Bash, forbidden-path, ask-mode, fail-closed |
| `apps/builder/test/hook-check.test.ts` | smoke hook + `gateBootOnHook` (SEC1 từ chối boot) |
| `apps/builder/test/confinement.test.ts` | baseline-delta, whitelist, chỉ-revert-trong-`projects/` |
| `apps/builder/test/post-turn-ids.test.ts` · `post-turn-multi-lint.test.ts` | regex node id; nhiều file lint |
| `apps/builder/test/ask.test.ts` · `ask-route.test.ts` | hai lớp Ask, anomaly, restore theo từng file |
| `apps/builder/test/claude-session.test.ts` | flag spawn, lọc env |
| `apps/builder/test/turn-failure-triage.test.ts` | `classifyTurnFailure` |

## 9. Những gì KHÔNG check tự động nào chứng minh được

Đây là ranh giới của mọi kết luận "xanh" ở tầng này.

- **Hook có thật sự được Claude Code gọi cho MỌI tool call hay không** — test đo hàm `decide()`
  thuần và smoke-test một payload. Hợp đồng "matcher `.*` ⇒ mọi call" là **hành vi của Claude Code**,
  không phải của repo này; một thay đổi phía CLI có thể làm im cổng gác mà không test nào đỏ.
- **`abstain` dẫn tới đâu** — hook nhường cho settings ở tool lạ. Kết quả cuối phụ thuộc mô hình
  permission của Claude Code, không phải code ở đây.
- **`SIMPLE_COMMAND` có phủ hết lớp bypass hay không** — nó là một allowlist ký tự, lập luận là
  "phase command không chứa metachar nào". Đúng với tập lệnh **hiện tại**; thêm một lệnh phase cần
  metachar sẽ phải nới cửa 1, và không gì cảnh báo điều đó.
- **Confinement mù với file gitignored** — nêu trong §4; đây là hạn chế **đã biết và cố ý**, không
  phải bug.
- **Timeout không có nghĩa turn đã dừng làm việc** — `forceKill()` giết process; hiệu ứng phụ nó đã
  gây (file đã ghi) vẫn còn và chỉ được §4 dọn nếu rơi ra ngoài whitelist.
- **`BUILDER_ALLOW_UNGUARDED=1`** tắt §3.5. Không gì đo được là nó có đang bật ở một máy thật hay
  không.
