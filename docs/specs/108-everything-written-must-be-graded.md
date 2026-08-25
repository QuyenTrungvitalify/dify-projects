# Spec 108 — Cái gì được ghi thì phải được chấm

> **Status**: **mở**, chưa implement. Lập 2026-08-21, từ ca thật của user: build `1787273481220`
> chạy hết ③ ($3.42), **ghi file bàn giao sang một project khác**, rồi chết `artifact missing` và
> **lặp lại y hệt 2 lần Retry nữa** ($2.94) mà không lượt nào đụng tới một file.
>
> Phạm vi — **năm lát, một nguyên tắc**:
> **S1** task có **sổ sở hữu thư mục** (mở bằng lời user, không phải tường cấm) và **chấm mọi thứ nó ghi** ·
> **S2** chốt sau lượt **không được phụ thuộc `git`** ·
> **S3** vòng retry phải **mang theo phán quyết của vòng trước** ·
> **S4** bắt lệch mục tiêu **ở cửa**, trước khi tiêu $4 cho ①+② ·
> **S5** resume prompt mang **phạm vi của phase** (§7 — hình dạng còn chờ user chốt).
>
> ✅ **ĐÃ SHIP phần lớn 2026-08-25.** Đợt 1: bộ dò fs (S2) + báo cáo ghi-ngoài-phạm-vi ở MỌI gate +
> nhãn phase resume ①/② (S5a) + retry mang phán quyết (S3, kèm spec 111). Đợt 2 (cùng ngày): **CHẤM**
> — mọi `workflows/*.y?ml` mà bộ dò bắt được (stray Ở project khác, VÀ file của chính build khi ①/②
> sửa nó) đi qua đúng 4 linter của ③ (`checkExtraWorkflowFile`, spec 039 — giờ export + nhận runPython
> bơm từ resolveRunners), kết quả ghi inline trong `strayNote` ("4 linter xanh" / "lint đỏ: …"),
> và một cú sửa-own-workflow từ ①/② refresh luôn `diff.json`. Code: `post-turn.ts`
> (`strayWrites`, `changedWorkflowYmls`, `checkExtraWorkflowFile`), `orchestrator.ts`. Test:
> `test/stray-writes.test.ts` (10). **Ship ở chế độ ADVISORY** đúng §S2: báo + chấm, không revert,
> không fail phase — lint đỏ của file ngoài vòng kiểm là thông tin ở gate, chưa phải án.
>
> **Còn lại**: S1(a-c) sổ `writeRoots` mở bằng lời user + hook deny (đang ở watch-list B1 — chờ ≥1 ca
> model tự đi lạc) · S5(b) phần Undo cho lượt ①/② (diff đã có, snapshot pre-turn chưa arm cho ②) ·
> S4 (note gate ①, ROI thấp) · nâng advisory → fatal sau vài ngày quan sát.
>
> ⚠ **Sửa hướng 2026-08-25 (user chốt).** Bản đầu của S1 dựng trên luật *"một task = một workflow"*.
> User bác: *"1 task theo dòng phát triển chưa chắc là 1 workflow"*. S1 viết lại từ **cấm ghi** thành
> **sở hữu + tính sổ**; §0 và luận đề của spec đổi theo. Phần §1–§2 (bằng chứng, chẩn đoán) không đổi
> — chúng đo cái đã xảy ra, không phụ thuộc luật nào.
>
> **Không chạm**: cap-5 · `auto` HARD-STOP · nội dung 4 linter · cơ chế seed/diff · không tự ý đổi
> mục tiêu build thay user · không tự copy file sang chỗ đúng rồi báo "done".
>
> Liên quan: [105](105-fixing-an-existing-workflow-is-not-a-rebuild.md) — cùng lớp "mục tiêu sửa là
> cái nào" · [106](106-a-stopped-build-must-not-look-abandoned.md) — `error` là trạng thái còn sống,
> spec này nói **retry đó phải biết nó trượt vì gì**.

---

## 0. Nguyên tắc

**Cái gì được ghi thì phải được chấm, và phải được nói ra.** Hôm nay Builder chấm **một** đường dẫn
tính trước, còn lượt ghi được vào **cả** `projects/`. Khoảng giữa hai cái đó là vùng tối: mọi file
rơi vào đấy không qua linter nào, không vào diff nào, không hiện ở gate nào — và build vẫn báo
`success` hoặc chết `artifact missing`, cả hai đều không mô tả việc vừa xảy ra.

Cách đóng vùng tối **không phải** là cấm ghi. `[user chốt 2026-08-25]` Một task theo dòng phát triển
có thể chạm nhiều workflow (APP 1 ↔ APP 2 ↔ `appScript.js` là một hệ, không phải ba việc rời). Cấm
ghi là bắt dòng công việc thật uốn theo mô hình dữ liệu — sai chiều. Đóng vùng tối bằng cách **mở rộng
cái được chấm cho khớp cái được ghi**:

1. **Phạm vi ghi do NGƯỜI mở, không do model tự lấy** — một thư mục vào sổ khi user nêu tên nó, không
   khi model thấy nó hay ho.
2. **Mọi file trong sổ mà lượt chạm tới đều bị chấm** — cùng bộ linter, cùng diff, cùng dòng ở gate.
3. **Gate nói đúng sự thật** — "đã sửa B, đích A không đổi" thay cho `artifact missing`.

Hệ quả kèm theo, cũng là luật: **một lượt bị chấm trượt phải biết mình trượt vì gì.** Retry mà không
mang phán quyết là mua lại đúng cái thất bại cũ với giá đầy đủ.

---

## 1. Sự cố — `[REPRO]` build `1787273481220`

### 1.1 Một câu

③ ghi bản bàn giao vào `projects/_drafts/app2_build_requirement_news_2/workflows/main.yml` — đúng
đường dẫn user dán trong requirement — trong khi backend chỉ chấm
`projects/_drafts/nh_gi_spec_spec/workflows/main.yml`. Không có file ở chỗ bị chấm ⇒ `artifact missing`.

### 1.2 `[ĐO]` File tốt, nằm sai chỗ

| Đo | Kết quả |
|---|---|
| `nh_gi_spec_spec/workflows/` | chỉ có `04d96f92-….yml` (seed) + `.gitkeep` — **không có `main.yml`** |
| `app2_build_requirement_news_2/workflows/main.yml` | 60.689 B, mtime 10:28 (khớp lượt ③) |
| 4 linter chạy lại trên file đó (2026-08-21) | **exit 0 cả 4** (chỉ warning "skip" cho `trigger-webhook` / `http-request`) |
| Mọi `Write`/`Edit` trong transcript ③ | trỏ `app2_build_requirement_news_2/…` |

Nói cách khác: **không phải lỗi chất lượng YAML**. Sản phẩm dùng được, chỉ là backend không nhìn tới chỗ đó.

### 1.3 `[ĐO]` Giá của một lần đi lạc

| Phase | Tiền | Ghi chú |
|---|---|---|
| ① analyze | $1.71 | đã chốt mục tiêu SAI ngay tại đây (§2.1) |
| ② spec | $2.31 | `SPEC.md:8` ghi thẳng mục tiêu sai, human duyệt ở gate |
| ③ lượt 1 | $3.42 | 30 turn, dựng xong file — **ở project khác** |
| ③ Retry ×2 | $1.42 + $1.52 | **0 tool call cả hai lượt**, chết y hệt |
| **Tổng** | **$10.38** | sản phẩm có thật, task vẫn `error` |

### 1.4 `[ĐO]` Không phải ca cá biệt — 3/3 task trong 8 phút cùng lỗi một kiểu

Quét 57 `task.json` trong `apps/builder/.runs/`: **3 task** có đường dẫn `projects/<p>/<slug>/` trong
requirement, và **cả 3** đều trỏ tới slug KHÁC slug mục tiêu:

| task | mục tiêu được chọn | requirement trỏ tới | kết cục |
|---|---|---|---|
| `1787273023539` | `build_requirement_news_automation_2` (edit-existing) | `app2_build_requirement_news_2` | error (backend restart) |
| `1787273422910` | `build_requirement_news_automation_2` (edit-existing) | `app2_build_requirement_news_2` | cancelled ở ① |
| `1787273481220` | `nh_gi_spec_spec` (Dify-seed = **APP 1**) | `app2_build_requirement_news_2` | **error ③ artifact missing** |

Thói quen của user rất nhất quán: **gõ mục tiêu thật vào requirement dưới dạng đường dẫn**, còn ô
chọn thì trỏ chỗ khác. Đây là một *class*, không phải một tai nạn.

---

## 2. Chẩn đoán — 5 mắt xích, mắt nào cũng lẽ ra chặn được

### 2.1 Mắt 1 — requirement và ô chọn nói hai mục tiêu khác nhau, không ai đối chiếu

Requirement là 3 đường dẫn tuyệt đối tới project khác. Prompt ③ nhắc lại **nguyên văn 4 lần** (banner
ngôn ngữ, *Output language* ×2, *Inputs*), lấn át dòng
`Instantiate projects/_drafts/nh_gi_spec_spec/workflows/main.yml`.

`[ĐO]` ① đã **hiểu đúng ý user và đi sai đường** một cách có ý thức — `analyze.json`:
*"Seed đi kèm là YAML của APP 1 … dùng làm DỮ LIỆU tham chiếu"*, còn đối tượng sửa là `main.yml` của
APP 2. Không có chốt nào so "mục tiêu ① mô tả" với "đường dẫn backend sẽ chấm".

### 2.2 Mắt 2 — ② hợp thức hoá mục tiêu sai, và human duyệt nó

`SPEC.md:8` (do ② viết, human bấm Continue):

> *"đối tượng sửa là `projects/_drafts/app2_build_requirement_news_2/workflows/main.yml`"*

`[ĐO]` ① và ② **không chết** vì artifact của chúng (`analyze.json` trong `.runs/`, `SPEC.md`) vẫn
nằm đúng chỗ bất kể mục tiêu là gì. Chỉ ③ có artifact nằm **trong** thư mục build ⇒ chỉ ③ vỡ. Lệch
sinh ở ①, hoá đơn trả ở ③.

### 2.3 Mắt 3 — hook cố ý cho ghi cả `projects/`

`permission-gate.ts:339`:

```ts
if (p.startsWith('projects/')) return false; // the build's workflow output (cross-project caught post-turn)
```

Allowlist đúng ở tầng "ngoài repo", nhưng **rộng một bậc** ở tầng project: nó nhường việc phân biệt
cross-project cho chốt sau lượt. Đó là một sự uỷ nhiệm — chỉ đúng nếu chốt kia thật sự làm việc.

### 2.4 Mắt 4 — chốt sau lượt **mù** đúng ở nơi mọi build đều chạy

`confinementCheck` (`post-turn.ts:432`) đọc `git status --porcelain`. Nhưng `.gitignore:62`:

```
projects/_drafts/
```

⇒ mọi ghi trong `_drafts` **vô hình với git**: không breach, không revert, không một dòng log.

`[ĐO]` Phân bố `project` trên 57 run: `_drafts` **33**, `(external)` 2, `null` (chưa scaffold) 22.
Tức là **33/35 task đã có project đều chạy trong vùng chốt confinement không nhìn thấy gì**. Chốt
này trên thực tế đang tắt cho gần như toàn bộ build.

Chính code đã biết điều này — `post-turn.ts:325` (comment của `specChanged`):

> *"`projects/_drafts/` is gitignored wholesale, so a git-derived flag reads 'unchanged' for a file
> the turn really did rewrite"*

Một nửa hệ đã chuyển sang content-hash vì lý do đó; nửa confinement thì chưa.

### 2.5 Mắt 5 — Retry mù: prompt resume **không mang phán quyết của backend**

`[ĐO code]` `resumePrompt` (`orchestrator.ts:708`) =
`langPin + CHANGE_REQUEST + replyText + attachments + knowledge + reconcile + approvedTail + undoneTail`.
**Không có** lý do trượt của vòng trước. `task.error` (đặt ở `:435`, chứa đúng chuỗi
`artifact missing: …`) bị **xoá ở `:570`** trước khi prompt được dựng.

Hệ quả đọc-là-thấy trong transcript, lượt Retry #1:

> *"Không có lỗi nào còn tồn đọng — bản dựng đã xong và cả 4 linter đều thoát 0."*

Model **không sai theo hiểu biết của nó**: nó đã dựng xong file, 4 linter xanh — ở project kia. Nó
chưa từng được cho biết backend chấm ở đâu và đã chấm trượt. Kết quả: 2 lượt, **0 tool call**, $2.94,
cùng một dòng lỗi.

`[ĐO]` Ngay lượt đó backend đã ghi `artifact_unchanged: main.yml` vào `events.jsonl` — tín hiệu "lượt
này không đổi gì" **có sẵn**, chỉ là không ai nói lại cho model hay cho user.

---

## 3. Các lát

### S1 — Sổ sở hữu thư mục, và chấm mọi thứ đã ghi

> Thay cho bản đầu ("hook cấm ghi ngoài thư mục build"), đã chết theo phán quyết của user ở đầu file.
> Giữ nguyên từ bản đầu: cơ chế `BUILDER_*` env → hook, và nhận xét **deny có nêu đường đi đúng thì
> model dùng được ngay** — `[ĐO]` lượt ③ của `1787273481220` bị hook từ chối 6 lần thuộc 2 lớp
> (4 metachar, 2 `grep`) và tự sửa hướng đúng cả 2 lớp trong cùng lượt.

**(a) Task mang một SỔ, không phải một đường dẫn.** `task.writeRoots: string[]`, khởi tạo
`['projects/<project>/<workflowSlug>/']` — danh sách thư mục task được phép ghi **và** bị chấm. Hai vế
luôn đi cùng nhau; đó là toàn bộ ý nghĩa của sổ.

**(b) Sổ chỉ mở bằng LỜI CỦA USER.** Khi `requirement` hoặc một `/reply` chứa đường dẫn (repo-rel hoặc
tuyệt đối dưới repo) trỏ tới `projects/<p>/<slug'>/` **đang tồn tại trên đĩa**, backend thêm thư mục đó
vào sổ ngay tại lượt ấy và **nói ở gate**:

> `Task này đang sở hữu 2 thư mục: nh_gi_spec_spec (đích) · app2_build_requirement_news_2 (bạn nêu
> trong yêu cầu lúc 11:56). Thay đổi ở cả hai đều được kiểm và ghi vào 差分.`

Ranh giới **load-bearing**: đường dẫn do **model** nghĩ ra không mở được sổ — chỉ chữ của người mở sổ.
Đó là thứ giữ cho sổ không phình lại thành "cả `projects/`", tức không quay về đúng lỗ hôm nay.

**(c) Hook chặn phần NGOÀI sổ, câu deny chỉ đường xin phép.** `claude-session.ts` xuất
`BUILDER_WRITE_ROOTS` (ngăn bằng `:`) cạnh `BUILDER_TASK_ID` (`:168`); `pathIsProtectedWrite`
(`permission-gate.ts:331`) thay nhánh `:339` bằng "trong `projects/` mà không nằm dưới root nào trong
sổ ⇒ protected".

> `forbidden: projects/_drafts/<X>/ chưa nằm trong phạm vi task này. Đừng ghi lén — hãy NÓI trong câu
> trả lời rằng bạn cần sửa thư mục đó; người dùng nêu tên nó là nó vào phạm vi ngay.`

**(d) Chấm mọi file trong sổ mà lượt đã chạm — đây mới là phần đóng vùng tối.** Post-turn hiện chỉ
`stat` + lint `phase.artifactRel(task)`. Đổi thành: mọi `workflows/*.y?ml` **đã đổi** trong bất kỳ root
nào của sổ đều đi qua đúng bộ 4 linter đó, mỗi file một dòng ở gate. Bộ dò "đã đổi" dùng chung với S2 —
một cái, không viết hai.

**(e) Thông báo nói sự thật, không nói `artifact missing`.** Khi đích không đổi mà root khác đổi:

> `Đã sửa app2_build_requirement_news_2/workflows/main.yml — 4 linter xanh.
>  Đích của task (nh_gi_spec_spec/workflows/main.yml) chưa có file. Coi đây là kết quả của task này,
>  hay build tiếp vào đích?`

`[ĐO]` Cả hai ca đã xảy ra đều được câu này mô tả đúng: 21/08 (đích trống, sản phẩm ở root khác) và
24/08 (đích không đổi, `artifact_unchanged`, gate vẫn `success`).

**Ranh giới:**
- **Chỉ chặn GHI.** Đọc project khác luôn cho — nhờ đọc `build_requirement_news_automation_2/main.yml`
  mà ③ chốt được hợp đồng webhook. Hành vi tốt, đừng giết.
- `workflowSlug` còn `null` (①/② trước scaffold) ⇒ sổ rỗng ⇒ **không** set env, hành vi giữ nguyên
  byte-for-byte (vùng null là chuyện của S2).
- Sổ **không** đổi `artifactRel`. Thêm root = thêm cái được chấm, không phải chuyển đích — §N1 vẫn
  đứng: Builder không tự đoán "chắc user muốn đích kia".
- Không đụng `.runs/`, `.vscode/settings.json`, các nhánh allowlist khác.

**Nghiệm thu:**
1. `writeRoots` khởi tạo đúng một phần tử; `/reply` nêu path tới project **đang tồn tại** ⇒ sổ +1 **và**
   gate có dòng liệt kê; path tới thư mục **không tồn tại** ⇒ sổ không đổi (đừng đoán).
2. Path chỉ xuất hiện trong lời **model** ⇒ vẫn `deny`, sổ không đổi.
3. `decide()` với `BUILDER_WRITE_ROOTS`: trong sổ ⇒ allow · ngoài sổ ⇒ deny kèm câu xin phép · `Read`
   bất kỳ đâu ⇒ allow. Không set env ⇒ mọi quyết định **y hệt hôm nay**.
4. Lượt sửa yml ở root thứ hai ⇒ 4 linter chạy trên file đó, gate có dòng riêng cho nó.
5. Đích không đổi + root khác đổi ⇒ thông báo (e), **không** phải `artifact missing`. Test đỏ-khi-revert:
   bỏ nhánh này thì câu cũ quay lại — đó chính là bug.

### S2 — Chốt sau lượt không được phụ thuộc `git`

**Làm gì.** `confinementCheck` giữ nguyên đường git cho vùng tracked, **thêm** một nguồn sự thật
không phụ thuộc git cho vùng ignored: quét **toàn bộ cây `projects/`** (trừ thư mục của chính build)
tìm file có `mtime > thời điểm spawn` — mốc spawn đã có sẵn cạnh `baseline` (`orchestrator.ts:752`).

> ⚠ Phạm vi quét phải là **cả cây**, không phải `workflows/*.y?ml`: `[ĐO]` đợt 2026-08-24 các cú ghi
> lạc là `SPEC-FIX.md` + `SPEC-APP1-NG.md` (nằm ở **gốc** project) và `appScript.js` (**không phải**
> `.yml`) — một glob hẹp bỏ lọt toàn bộ. Cây `projects/` cỡ vài trăm file, một lượt `stat` là rẻ.

> ⚠ **False-positive khi hai task chạy chồng lượt** `[GIẢ THUYẾT — chưa quan sát]`: hai luồng 08-24
> không chồng nhau (cũ kết thúc 12:56, mới sinh 13:02) nhưng không gì cấm điều đó. Lượt của task A sẽ
> thấy file task B vừa ghi. ⇒ loại khỏi báo cáo mọi đường dẫn thuộc phạm vi một task **đang chạy**
> khác, và lời báo là "có thay đổi ngoài phạm vi" (quan sát), không phải "lượt này đã ghi" (quy tội).

**Revert hay không revert — đây là chỗ dễ làm hỏng.** File trong `projects/_drafts/` **không có bản
sao trong git**: `git checkout` không phục hồi được, "revert" một file ignored = **xoá vĩnh viễn**.
Với build `1787273481220`, xoá đúng nghĩa là đốt sản phẩm $3.42 duy nhất còn dùng được.

⇒ **Vùng ignored: PHÁT HIỆN + BÁO, không revert.** S1 đã chặn ở đầu vào; S2 là lưới an toàn để chẩn
đoán, không phải máy chém.

**Cái người dùng nhìn thấy đổi từ:**

```
artifact missing: projects/_drafts/nh_gi_spec_spec/workflows/main.yml
```

**thành:**

```
③ đã ghi ra projects/_drafts/app2_build_requirement_news_2/workflows/main.yml —
ngoài phạm vi build này (đích: projects/_drafts/nh_gi_spec_spec/workflows/main.yml).
File đó vẫn còn nguyên trên đĩa.
```

**Nghiệm thu:**
1. Test: tạo file trong project khác sau mốc spawn ⇒ reason nêu đúng đường dẫn thật; file **vẫn còn**.
2. Test đỏ-khi-revert: bỏ nhánh fs, test phải đỏ (chốt git không thấy gì trong `_drafts` — đó chính
   là bug).
3. Vùng tracked: hành vi revert hiện tại **không đổi**.

### S3 — Vòng retry mang theo phán quyết của vòng trước

**Làm gì.** `retryFromError` đã có sẵn (`orchestrator.ts:566`), nhưng chỉ dùng cho snapshot. Bắt nó
gánh thêm việc: đọc `task.error` **trước** khi bị xoá ở `:570`, rồi nối vào `resumePrompt` (`:708`)
một khối ngắn:

```
## Vòng trước bị backend đánh trượt
Lý do (verbatim): artifact missing: projects/_drafts/nh_gi_spec_spec/workflows/main.yml
Backend chỉ chấm đúng đường dẫn đó. Trước khi trả lời, hãy kiểm tra file đó có trên đĩa không.
Nếu bạn tin mình đã làm xong, nghĩa là bạn đã ghi ra một chỗ khác — hãy nói ra chỗ đó.
```

Cùng seam với `knowledgeTail` / `reconcileTail`, gate `retryFromError` (không phải mọi `/reply`:
một revision sau vòng sạch **không có** phán quyết nào để mang). **Mọi phase, không riêng ③** —
`[ĐO]` 08-24 có cả retry-sau-timeout ở ② ("có lỗi gì vậy thử lại dc ko?"); lượt đó tự phục hồi được
nhờ context còn nguyên, nhưng cùng cơ chế, cùng giá một dòng, không có lý do gate hẹp hơn.

**Thêm một dòng cho user, khi lượt retry không đụng gì.** Backend đã biết
(`artifact_unchanged` + `numTurns: 1` + 0 tool call): nếu một lượt retry kết thúc mà artifact vẫn
missing **và** không có tool call nào, thông báo lỗi phải nói thêm
*"lượt vừa rồi không sửa file nào"* — thay vì lặp lại y nguyên dòng cũ, khiến user tưởng mình bấm chưa ăn.

**Nghiệm thu:**
1. Test: `task.status === 'error'` + `/reply` ⇒ prompt chứa chuỗi lỗi verbatim; `status !== 'error'` ⇒
   prompt **không đổi** so với hôm nay.
2. Test: lượt retry 0 tool call + artifact vẫn missing ⇒ `task.error` có thêm mệnh đề "không sửa file nào".
3. `[bắn thử]` Lượt retry trên chính ca này phải đi tìm file (có tool call), không được trả lời
   "không còn lỗi nào".

### S4 — Bắt lệch mục tiêu ở CỬA, trước khi tiêu $4

> ⚠ **Co lại sau khi S1 đổi hình (2026-08-25).** Dưới mô hình "sổ sở hữu", một đường dẫn trỏ project
> khác trong requirement **không còn là lệch** — nó là một cú **mở sổ**, và S1(b) đã xử đúng chỗ đó
> kèm dòng liệt kê ở gate. Phần còn lại của S4 chỉ còn hai ca hẹp, và chỉ đáng làm ở mức **note**:
> (i) path trỏ tới thư mục **không tồn tại** — sổ không mở được, user cần biết ngay ở ① thay vì
> đợi ③; (ii) requirement **chỉ** nêu project khác mà không nói gì về đích của task — dấu hiệu user
> chọn nhầm ô lúc tạo task. Bản "hỏi ở composer" bỏ.

**Làm gì.** Lúc `createTask`: soi requirement tìm đường dẫn dạng `projects/<p>/<slug>/…` (cả dạng
tuyệt đối dưới repo root). Nếu có `<slug>` ≠ slug mục tiêu và thư mục đó **tồn tại**:

- **Ưu tiên 1 (đúng gốc):** hỏi ngay tại composer trước khi sinh task —
  *"Requirement trỏ tới `app2_build_requirement_news_2`, nhưng build này sẽ ghi ra `nh_gi_spec_spec`."*
  → `[Đổi mục tiêu sang app2_…]` · `[Giữ nguyên — chỉ dùng làm tham chiếu]`.
  Một cú bấm là cả class biến mất, và **$4.02 của ①+② chưa tiêu**.
- **Ưu tiên 2 (rẻ hơn nhiều, làm trước cũng được):** một note **bắt buộc hiện ở gate ①**, cùng seam
  `preflightNote` (`Chat.tsx:394`), nội dung như trên. Không chặn, nhưng đặt đúng lúc human còn
  đang đọc và mới tiêu $1.71.

**Kèm một kiểm ở ②** (rất rẻ): `SPEC.md` mới viết có nêu đường dẫn `projects/…` **ngoài** thư mục
build ⇒ thêm một dòng advisory ở gate ②. Ca này `SPEC.md:8` đã nói thẳng, không ai so.

**Nghiệm thu:**
1. Test parser: 3 requirement thật ở §1.4 đều bị bắt; requirement không có path ⇒ im lặng tuyệt đối
   (không note, không hỏi).
2. Test: đường dẫn trỏ **đúng** slug mục tiêu ⇒ không cảnh báo (đây là ca hợp lệ và phổ biến).
3. Thư mục trong path không tồn tại ⇒ không cảnh báo (đừng đoán).

---

## 4. Repro / bằng chứng đo

```bash
# 1. Sản phẩm nằm sai chỗ (build 1787273481220)
ls projects/_drafts/nh_gi_spec_spec/workflows/
ls -l projects/_drafts/app2_build_requirement_news_2/workflows/main.yml

# 2. File đó tốt — 4 linter xanh
.venv/bin/python tools/dify_base/validate_workflow.py projects/_drafts/app2_build_requirement_news_2/workflows/main.yml
.venv/bin/python tools/dify_base/lint_refs.py projects/_drafts/app2_build_requirement_news_2/workflows/main.yml
.venv/bin/python tools/dify_base/lint_plugin_hashes.py projects/_drafts/app2_build_requirement_news_2/workflows/main.yml
.venv/bin/python tools/dify_base/lint_node_bodies.py projects/_drafts/app2_build_requirement_news_2/workflows/main.yml

# 3. Chốt confinement mù trong _drafts
git check-ignore -v projects/_drafts/app2_build_requirement_news_2/workflows/main.yml
git status --porcelain -uall projects/_drafts/   # → rỗng, dù file vừa bị ghi lại

# 4. Ba task cùng class + phân bố project (đếm lại §1.4 / §2.4)
python3 - <<'PY'
import json,glob,re,os,collections
c=collections.Counter()
for p in glob.glob('apps/builder/.runs/*/task.json'):
    t=json.load(open(p)); c[t.get('project')]+=1
    req=t.get('requirement') or ''; slug=t.get('workflowSlug')
    other=[f"{a}/{b}" for a,b in set(re.findall(r'projects/([\w-]+)/([\w-]+)/',req)) if b!=slug]
    if other: print(os.path.basename(os.path.dirname(p)), slug, t.get('status'), other)
print(c)
PY

# 5. Retry mù: 2 lượt, 0 tool call, cùng một lỗi
grep -c '"kind": "retry"' apps/builder/.runs/1787273481220/events.jsonl
grep '"kind": "error"' apps/builder/.runs/1787273481220/events.jsonl
```

---

## 5. Non-goals

- **N1 — Không tự đổi mục tiêu build thay user.** S4 chỉ hỏi. Builder đoán "chắc user muốn sửa cái
  kia" là cách nhanh nhất để ghi đè một file người ta không định đụng.
- **N2 — Không tự copy/di chuyển file về chỗ đúng rồi báo `done`.** Nội dung được dựng theo mục tiêu
  SAI (spec của APP 2 vào thư mục seed APP 1); dời file chỉ làm sai lệch thành vô hình. Cùng lý do
  spec 090 S3 chỉ "adopt" đúng một ca hẹp: file của **chính** task, trong run dir của **chính** nó.
- **N3 — Không revert file trong vùng gitignored.** §S2: không có bản sao để phục hồi ⇒ revert = xoá.
- **N4 — Không đụng cap-5, `auto` HARD-STOP, 4 linter, cơ chế seed/diff.**
- **N5 — Không bỏ quyền ĐỌC project khác.** Đọc chéo là hành vi đúng và đã tạo ra giá trị thật ở
  chính run này.

---

## 6. Open questions

1. **`workflowSlug === null` (①/② trước scaffold) thì hook nên làm gì?** Hôm nay `projects/` mở toàn
   bộ và post-turn nói "mọi ghi `projects/` đều là breach" — nhưng mù trong `_drafts`. Đóng chặt
   (deny mọi `projects/` khi chưa có slug) là đúng lý thuyết; cần kiểm có phase nào ghi hợp lệ ở đó
   không trước khi siết. Chưa đo ⇒ **S1 để nguyên vùng này**.
2. **Seed ≠ mục tiêu.** Task này seed từ Dify app **APP 1** trong khi requirement nói APP 2 — ① nhận
   ra và vẫn đi tiếp. Có nên đối chiếu `app.name` của seed với tên trong requirement ở gate ①? Rẻ,
   nhưng dễ false-positive (tên app tiếng Nhật + emoji). **Chưa chốt.**
3. **S4 ưu tiên 1 hay 2 trước?** Ưu tiên 2 (note ở gate ①) rẻ, không đụng FE composer, chặn được sau
   $1.71. Ưu tiên 1 chặn trước $0 nhưng đụng luồng gửi. Nếu chỉ làm một, làm **2 trước**.
4. **`(external)` project (2 run)** có nằm trong vùng git-mù không? Chưa đo.

---

## 7. Đợt quan sát thứ hai — 2026-08-24, cùng một gốc, hai biểu hiện mới

> Thêm sau khi soi hai run thật cùng ngày: `1787273481220` (luồng APP 2, vẫn mở) và
> `1787544155222` (luồng APP 1, tạo lúc 13:02). **Không có phát hiện nào ở đây phủ định §1–§3** —
> tất cả đều là cùng một lỗ, nhìn từ góc khác.

### 7.1 `[ĐO]` Lỗ §2.3–2.4 lặp lại — và lần này nó báo **THÀNH CÔNG**

Bốn lượt cuối của task `1787273481220` (11:56 → 12:56) chạy **hoàn toàn trong thư mục của APP 1**:

| Lượt | Tiền | Việc nó làm |
|---|---|---|
| 12:04 | $4.56 | 3 Edit vào `build_requirement_news_automation_2/…` (+6 Edit trong build của chính nó) |
| 12:27 | $4.67 | 6 Edit + 4 lệnh linter, **tất cả trỏ `build_requirement_news_automation_2/`** |
| 12:19 | $2.56 | 4 Edit + 1 Write — chỉ APP 1 |
| 12:56 | $7.46 | 19 Edit + 1 Write — chỉ APP 1; thử `rm` và `mv` (hook chặn ✗) |

⇒ **$19.25 chi cho một project mà task này không hề có quyền ghi.** Sản phẩm: hai file mới
`SPEC-FIX.md` (50 KB) + `SPEC-APP1-NG.md` nằm trong thư mục APP 1, cùng các sửa đổi trong
`workflows/`. Không một dòng breach nào được ghi — `_drafts` gitignore (§2.4).

**Mặt thứ hai của lỗ, chưa nêu ở §2.** Khi artifact bị chấm **đã tồn tại** từ trước, ghi lạc chỗ
không còn chết ồn ào nữa: hai lượt cuối ghi `artifact_unchanged: main.yml` và gate vẫn
`gate_reached: success`. Tức là:

| Tình huống | Biểu hiện |
|---|---|
| Build **chưa** có artifact | chết `artifact missing` — khó hiểu, nhưng **có** chết (§1) |
| Build **đã** có artifact | **báo thành công**, dù lượt đó không đụng file bị chấm |

Cái thứ hai nguy hiểm hơn. S1 (chặn tại cú ghi) xử cả hai; S2 (dò bằng fs) là cái nói ra cái thứ hai.

### 7.2 `[ĐO]` Biểu hiện mới — **phase ② đang làm việc của ③**

Task `1787544155222`, từ 17:06 trở đi mọi lượt đều mang nhãn `spec`, nhưng nội dung là dựng workflow:

- Transcript ② attempt 5 (19:04→19:19): **16 Edit** + tự chạy `validate_workflow.py`,
  `lint_node_bodies.py`; lời kể của chính nó: *"Bước gộp đã nhóm được tin trùng… Thêm mã nhóm trước.
  Giờ đến Apps Script — cột log mới"*.
- `[ĐO bất biến]` `duplicate_topic` — thứ lượt 19:15 mới thêm — **có mặt trong `main.yml`**
  (`grep -c duplicate_topic` = 7), và `採点理由`/`同記事数` có trong `appScript.js`. Bằng chứng này
  không phụ thuộc mtime.

**Vì sao.** Prompt resume = `CHANGE_REQUEST + lời user` (§2.5) — **không có thân skill**. Luật
"đừng đụng `workflows/`" tồn tại thật, ở `spec-revise.md:62-64`, nhưng nó chỉ tới được lượt **fresh**.
Một phiên ② đã resume 5 lần thì chưa từng đọc lại luật đó.

**Hậu quả không ai thấy:**

| Cái lẽ ra phải xảy ra | Thực tế trong phase ② |
|---|---|
| 4 linter chạy trên `main.yml` sau lượt | **không** — ①/② chỉ `stat` artifact của nó |
| Thay đổi vào `diff.json` / nút Undo | **không** — diff-base chỉ được arm ở ③ |
| Gate nói đúng việc vừa làm | gate ghi *"Implement this spec"* trong khi spec đã được implement rồi |

### 7.3 `[ĐO]` Lượt timeout / bị giết **không để lại hoá đơn**

Ba lượt ③ của `1787544155222` — 15:20 (900s), 16:17 (900s), 17:00 (bị giết,
*"process exited code null before a result event"*) — **không lượt nào có `turn_cost`**:
`turn_cost` chỉ phát khi có result event.

| Nguồn | Con số |
|---|---|
| Tổng hiện trên hoá đơn (`turn_cost` events) | **$19.02** / 7 lượt |
| Số lượt thật đã chạy | **10** |
| Ba lượt không tính tiền | 2 × 900s + 1 × ~180s Opus (các lượt ③ cùng cỡ tốn $3.4–4.7) |

Cộng thêm: **2/3 lượt ③ của build này timeout ở 900s** — file `main.yml` đã 210 KB. Timeout ở đây
không còn là ngoại lệ mà là thường lệ, và theo spec 104 nó vẫn `gate_reached: success` (đúng), nên
người dùng chỉ thấy "thành công" mà không biết lượt đó bị cắt giữa chừng.

### S5 — ①/② được phép chạm workflow, nhưng phải BỊ CHẤM như ③

> `[user chốt 2026-08-25]` Hai hình dạng được cân: **cấm** (② từ chối sửa file, chỉ user bấm sang ③)
> và **cho phép + tính sổ**. User chọn **cho phép + tính sổ**, cùng lý do đã giết bản S1 đầu: ràng
> buộc bắt dòng công việc uốn theo mô hình phase là sai chiều. Bản "cấm" bỏ.
>
> ⚠ **Đọc kèm spec 111.** Lý do user ĐỨNG ở ② suốt 13 lượt / 7 giờ không phải vì họ thích — mà vì
> một cú `cancel` + `Restore` đã lùi task từ ③ về ② **không một dòng thông báo**, và đường đi tiếp
> từ đó lại đốt phiên ③. S5 làm cho việc đứng ở ② **an toàn**; 111 làm cho việc **bị đẩy về ② một
> cách vô hình** thôi xảy ra. Thiếu 111, S5 chỉ hợp thức hoá một trạng thái sai.

**(a) Nhãn, không phải tường.** Cùng seam với S3 (`orchestrator.ts:708`), lượt resume của ①/② nhận:

```
## Lượt này thuộc phase ②
Sản phẩm chính của phase này là projects/<p>/<slug>/SPEC.md.
Nếu yêu cầu của người dùng buộc bạn sửa file dưới workflows/, cứ sửa — nhưng NÓI RÕ trong câu trả
lời bạn đã sửa file nào, và cập nhật SPEC.md cho khớp trong cùng lượt.
```

Đây là **thông tin**, không phải lệnh cấm: nó chỉ đảm bảo model biết mình đang đứng đâu và không quên
kéo spec theo — đúng cái đã hỏng ngày 24/08 (workflow đi trước, spec chạy sau bằng một lượt riêng).

**(b) Chấm — đây mới là phần thịt.** Post-turn của ①/② dùng **đúng nhánh S1(d)**: mọi
`workflows/*.y?ml` đã đổi trong sổ đi qua 4 linter, vào `diff.json`, và arm được nút Undo. Không viết
nhánh mới — ③ đã có sẵn toàn bộ, việc duy nhất là gỡ điều kiện "chỉ chạy ở ③".

> Nếu chỉ làm (a) mà không làm (b), S5 **không phải một lát** — nó là một lời nhắc vô hại, còn vùng
> tối (§0) vẫn nguyên vẹn. (b) là thứ đóng vùng tối; (a) chỉ làm cho báo cáo của model khớp với nó.

**(c) Gate nói ra.** Gate ② liệt kê thêm dòng: *"lượt này còn sửa `workflows/main.yml` — 4 linter
xanh"*, cạnh dòng về SPEC.md. Cùng chỗ, cùng định dạng với các dòng của ③.

**Nghiệm thu:**
1. Lượt resume ①/② có nhãn (a); lượt ③ **không** có (prompt ③ không đổi một byte).
2. Lượt ② sửa `main.yml` ⇒ 4 linter chạy trên file đó · `diff.json` có mục · Undo dùng được · gate có
   dòng (c). Test đỏ-khi-revert: gỡ (b) thì cả bốn thứ biến mất — đó là bug đang có.
3. Lượt ② sửa `main.yml` **hỏng lint** ⇒ gate ② báo lint đỏ như ③ vẫn báo, không nuốt.
4. Lượt ② KHÔNG chạm workflow ⇒ hành vi gate **y hệt hôm nay** (không thêm dòng thừa).

### 7.4 Câu hỏi mở thêm

5. **900s có còn đúng cho build ~200 KB?** 2/3 lượt ③ timeout, và lượt timeout không ghi cost nên
   ngân sách thật của một phase đang bị đánh giá thấp. Liên quan spec 085 (đã hạ timeout) + spec 102.
6. **Lượt bị giết giữa chừng** (`process exited code null`, 17:00) — ai giết? Không có event
   `cancel`. Cần một event cho "turn killed" để phân biệt với timeout, nếu không mọi khoản chi mất
   dấu đều trông giống nhau.
