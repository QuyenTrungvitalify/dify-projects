# Spec 094 — Vòng fix đọc được: nhãn "không đổi file", cảnh báo expected sau import, và luật viết cho người dùng

**Status**: rev 2 (2026-08-11) — **S1 + S4 + S5 + S2(a) ĐÃ SHIP**; S3 / S2(b) chưa làm. Nguồn: rà quá
trình sử dụng thật của run `1786089321835` (dossier export 2026-08-10) + yêu cầu của user về cách hành
văn của output/spec.

**Đã ship (2026-08-11)**
- **S4/S5/S2a** (commit `16ac83f`) — `analyze.md` / `spec.md` / `draft.md` (S4), `spec.md` / `draft.md` /
  `implement.md` / `promote.md` / `judge.md` (S5), `SKILL.md` (S2a), + 8 assert trong
  `content-language.test.ts`. **Hai chỗ lệch khỏi §3.5, có chủ ý** — xem §10.
- **S1** — hash nội dung theo §3.1(b), cờ đi qua `PostTurnDetail` → `Task` → wire → hai gate; event
  `artifact_unchanged`; mốc `importedHash`/`importedAt`. 9 test cơ chế
  (`test/artifact-changed.test.ts`) + 7 test render (`web/src/gate-no-change.test.ts`). Xem §11.

Suite: server **935/935**, web **301/301**, typecheck cả hai nửa sạch. Cơ chế đã được **hiệu chuẩn**:
chạy cùng fixture qua cả hash lẫn git-delta, git-delta sai 3/5 ca (§11).

**rev 2 đổi gì so với rev 1** (sau một lượt review đối chiếu code, xem §9):
S1 **đổi cơ chế** — `turnTouched` (git) mù với chính file cần theo dõi, thay bằng hash nội dung;
thứ tự thi công **đảo** thành `(S4+S5) → S1 → S3 → S2`; thêm phần i18n bắt buộc cho S1/S3; thêm
bước control vào repro S3; hạ S2 xuống "sửa mâu thuẫn tài liệu" + probe tuỳ chọn; §1.1 ghi lại
bằng số đo được ở cấp attempt.

Thứ tự thi công **theo độ chắc chắn giảm dần**: **S4+S5 → S1 → S3 → S2**.
S4/S5 là prompt-only, không có ẩn số, trả lời trực tiếp yêu cầu 08-11 → làm trước.
S1 chắc về *mục tiêu* nhưng cơ chế phải viết lại (§3.1). S3 phải repro trước mới được viết chữ.
S2 gần như chắc là "không làm gì" — chỉ còn một sửa nhỏ xác định.

---

## 1. Bối cảnh — bằng chứng đo được

### 1.1 Sự cố nguồn (run 1786089321835)

Sau khi ③ Implement xong và ④ import thành công, user mở workflow trên Dify Studio và thấy
checklist trước-publish báo đỏ. Từ đó là **5 vòng request-changes trong ~2 giờ** mà kết thúc **không
có kết luận được xác nhận**:

| Vòng | User nói | Máy làm | Kết quả |
|---|---|---|---|
| R1 | "gặp những lỗi sau khi mở workflow" | sửa 2 lỗi thật (trùng tên biến ở 2 node End, kiểu `file_ids`) | 3 → 1 |
| R2 | "thử xem fix dc chưa" | **đoán** từ ảnh: trùng tên in/out → đổi `in_*` | trật |
| R3 | "vậy fix A1 đi" | **không sửa một byte nào**, chỉ giải thích | user tưởng có bản mới |
| R4 | "bản fix mới nhât vẫn lỗi, bạn có chắc đang sửa đúng ko?" | mới đối chiếu `templates/patterns/` — tự nhận "nãy giờ tôi đoán từ screenshot" | đổi hướng |
| R5 | "sao fix mãi ko dc vậy" | nêu giả thuyết A0-chưa-có-URL kéo theo A1, xin ảnh panel A0 | **user không quay lại xác nhận** |

**Đo lại ở cấp attempt** (transcript append theo attempt: `## ③ Implement — attempt 1 · resume=… ·
<ISO>`, đếm dòng `- Write` / `- Edit`):

| attempt | thời điểm | Write | Edit | ứng với |
|---|---|---|---|---|
| 1 | 08-09 03:32 | 1 | 7 | build đầu |
| 2 | 08-09 23:34 | 0 | 11 | R1 — sửa thật |
| 3 | 08-10 00:57 | 0 | 2 | R2 — sửa nhưng trật |
| **4** | 08-10 01:09 | **0** | **0** | **R3 — vòng rỗng** |
| 5 | 08-10 01:15 | 0 | 1 | R4 |
| **6** | 08-10 01:23 | **0** | **0** | **R5 — vòng rỗng thứ hai** |

Tức **2/5 vòng request-changes không ghi một byte nào** mà vẫn được trình bày y hệt vòng có sửa —
payoff của S1 gấp đôi con số rev 1 giả định. Hai attempt này là **fixture thật** cho test S1
(§4 S1), không cần dựng turn giả.

**Về con số tiền**: bản rev 1 ghi "$13.70 = 3.35+2.82+2.63+1.89+3.01". Chỉ số cuối tái dựng được
từ đĩa — `task.json.cost` **ghi đè theo phase**, chỉ giữ chi phí lượt CUỐI mỗi phase
(`implement.totalCostUsd = 3.0129`), và `events.jsonl` **không có field cost**. Bốn số còn lại đọc
từ UI lúc chạy, không có nguồn lưu trữ. Ghi rõ để lần sau không ai đi tìm. Chính khoảng trống này
là một add-on rẻ của S1 (§3.1 (e)).

### 1.2 Yêu cầu thứ hai của user (2026-08-11)

Output/spec "dùng nhiều từ ngữ, ký tự chuyên trong workflow như C0, C1... khiến người đọc khó hiểu,
nhất là user không hiểu gì lắm về builder, họ chỉ sử dụng". Ví dụ nguyên văn user chụp lại:

> `C0` webhook nhận `secret` / `row_keys` / `message_id` — cả 3 đều khai `string` (bài học #1).
> `C1` đối chiếu `secret` với `gas_shared_secret`; sai → trả list rỗng, run đi thẳng vào nhánh trống.

### 1.3 Đính chính — ba đánh giá đầu của tôi SAI, ghi lại để không ai làm theo

Rà lần hai bằng số liệu, ba kết luận trong bản review miệng ngày 08-10 không đứng vững:

1. **"Đính lại toàn bộ ảnh mỗi vòng nên mỗi round tốn $2–3"** — SAI.
   `attachments.ts:275` (`attachmentBlock`) chỉ chèn **danh sách đường dẫn** (~1 dòng/file), model
   tự quyết định `Read` cái nào (R4/R5 chỉ đọc 1 file). Tiền đến từ context của session resume,
   không từ danh sách ảnh. → thành Non-goal §5.
2. **"46% lệnh bị chặn là do `| head`, nới ra là hết"** — SAI về độ lợi.
   Đếm lại chính xác trên 3 transcript: **39 dấu `✗`**, trong đó **20** là lệnh search-shaped
   (`grep`/`rg`/`find`/`fd`/`locate`) và **8** mang lý do metacharacter — nhưng bóc từng lệnh ra thì
   phần lớn số 8 đó **tự nó đã bị cấm**. Chỉ còn **~4/39 (≈10%)** là "lệnh hợp lệ + đuôi cắt output
   vô hại". Nới cổng metacharacter là mở rộng bề mặt parser để đổi lấy 4 lượt gọi → không đáng.
   → S2 đổi hẳn bản chất.
   **Đính chính của đính chính**: `✗` **không đồng nghĩa denial**. Ví dụ
   `lint_refs.py … ✗ ↳ Exit code 1` là một lint fail hợp lệ, không phải bị chặn. Denominator 39 lẫn
   hai loại. (`e2e_check.py`'s `denied_calls_max` — mô tả ở `docs/state/readiness-and-plugins.md`
   — đếm đúng dấu `✗` này, nên nó **thừa đếm** theo cùng cách. Không sửa trong spec này; ghi lại để
   ai đọc metric đó biết sai số.)
3. **"Thiếu công cụ search nội dung nên model phải grep"** — SAI.
   `find.py --plugin tavily` chạy được, và khi 0 kết quả nó in rõ `No matching templates. Total
   indexed: 47`. `--has trigger-webhook` trả đúng danh sách path. Substitute có thật và hoạt động.
   Transcript còn cho thấy substitute **có tác dụng**: sau denial `grep` ở `implement.md:635`, lượt
   kế model `Read tools/dify_base/lint_refs.py` (dòng 639) — hồi phục trong 1 nhịp.

Cái còn lại sau khi trừ ba điểm trên vẫn là một con số thật: **~20/39 lần model cố search bằng
shell**. Đó là lãng phí thật — nhưng cả nguyên nhân lẫn độ nghiêm trọng đều khác rev 1 tưởng
(xem S2).

## 2. Nguyên tắc

1. **Không viết chữ dựa trên giả thuyết chưa repro.** Nguyên nhân "A0 chưa phát hành URL kéo theo
   A1 báo biến không hợp lệ" mới là lời giải thích của một lượt turn, chưa ai xác nhận trên Dify
   thật. Dạy người dùng "cảnh báo này bình thường, bỏ qua đi" trong khi chưa chắc là đang dạy họ
   phớt lờ một lỗi thật. S3 vì thế bắt đầu bằng repro, không bắt đầu bằng câu chữ.
2. **Ưu tiên tầng xác định hơn tầng xác suất.** Cùng một triệu chứng, sửa ở server (report/gate —
   chạy là ra đúng) luôn được chọn trước sửa ở prompt (nhờ model nhớ). Đây là lý do "buộc model đối
   chiếu pattern trước khi đoán" bị hạ xuống một câu phụ trong S3 thay vì thành slice riêng: nếu
   report đã nói cảnh báo đó là expected thì không còn gì để đoán.
   **Hệ quả mới (rev 2)**: nguyên tắc này cũng áp cho *chỗ đặt chữ*. Một luật nằm trong file được
   inline vào prompt chắc hơn cùng luật nằm trong file phải `Read` mới thấy — và §9.4 đo được rằng
   ngay cả khi đã `Read`, luật ở xa chỗ dùng vẫn bị phớt. Vì thế OQ3 chốt: inline vào 4 file phase.
3. **Nhãn node là toạ độ, không phải rác.** Title trên canvas đúng dạng `A5d: OCR Vision`, nên
   `C1` là chỗ người dùng chỉ tay được. S5 sửa **thứ tự** (nghĩa trước, nhãn sau) chứ không cấm nhãn.
4. **Tên máy được phép xuất hiện khi người dùng phải đọc/gõ nó trên màn hình** — nguyên tắc nhà đã
   có, `docs/state/readiness-and-plugins.md:238`: *"tên user phải đọc trên màn hình là affordance,
   không phải jargon"*. S5 chỉ mở rộng nguyên tắc này từ note server sang prose của model.
5. **Không nới cổng bảo mật để đổi lấy tiện lợi.** `apps/builder/server/hooks/permission-gate.ts`
   là default-deny có chủ ý; §1.3 điểm 2 đã đo được cái giá thật của việc nới.
6. **Đo cái mình định đo.** Một cờ chỉ đúng khi nguồn dữ liệu của nó thực sự nhìn thấy đối tượng.
   §3.1 tồn tại vì rev 1 vi phạm chính điều này.

## 3. Thiết kế

### 3.1 S1 — vòng không đổi file phải được gọi đúng tên

#### (a) Vì sao KHÔNG dùng `turnTouched` (sửa lỗi của rev 1)

Rev 1 định lấy `post-turn.ts:310` — `turnTouched = after \ baseline`, với `after =
gitDirtyPaths()` = tập PATH từ `git status --porcelain -uall`. **Cơ chế này mù với chính file cần
theo dõi**, vì hai lý do độc lập:

1. **`projects/_drafts/` bị gitignore trọn gói** (`.gitignore:62`), và `projects/*/workflow_*/` cũng
   vậy (`.gitignore:64`). Build from-scratch mặc định rơi vào `_drafts`
   (`task.ts:506 DRAFTS_PROJECT`, `scaffold.ts:152`). Đo trực tiếp: `git status --porcelain -uall
   projects/` trả **rỗng**. Run nguồn build vào `projects/_drafts/build_requirement…`
   (`transcripts/implement.md:629`) ⇒ cờ sẽ **hard-false cả 6 attempt**, kể cả attempt 1 (W=1, E=7).
2. **Ở lượt `/reply`, file YAML đã dirty từ lượt trước** nên nó nằm trong `baseline` → bị loại khỏi
   `turnTouched`. Builder **không commit** artifact giữa các lượt (chỉ `share.ts:409` commit, và
   trong worktree riêng). Nên ngay cả với project được track, R1 (sửa thật) cũng đọc ra `false`.

Chính header `post-turn.ts:19-26` đã ghi: *"remains blind to `.gitignore`'d in-dir writes"*.
`ConfinementResult.touched` (`post-turn.ts:287`) cùng nguồn bệnh — **cũng không dùng**.

**KHÔNG dùng `diff.json`** (lý do của rev 1, vẫn đúng): `snapshotDiffBase` cố ý no-op trên `/reply`
(`orchestrator.ts:485`), nên base là bản trước-khi-sửa của lượt đầu — diff vẫn khác rỗng dù lượt
này không đổi gì. `ArtifactPanel.tsx:304` có nhánh diff rỗng nhưng chỉ hiện `noDiffYet` trong tab
phụ, và câu chữ mang nghĩa "chưa có", không phải "vòng này không đổi".

#### (b) Cơ chế đúng: hash nội dung, hai lần

- Đường dẫn artifact đã được backend resolve sẵn: `phases.ts:135` →
  `${workflowDir(t)}/workflows/${t.workflowFile}`. Không tự suy lại.
- Chụp `sha256` (hoặc `size+mtime` nếu muốn rẻ hơn — nhưng sha256 một file ~100KB là không đáng kể
  so với một turn) **ngay trước spawn** và **ngay sau turn**, ở cùng chỗ orchestrator đã chụp
  `baseline` (`orchestrator.ts:488`).
- `artifactChanged = (hashBefore !== hashAfter)`. File chưa tồn tại trước → `hashBefore = null` →
  ghi mới là `changed`.
- Độc lập gitignore, độc lập baseline, và bắt đúng cả ca "ghi lại y hệt nội dung" (theo nghĩa người
  dùng thì đó **là** không đổi).
- Cờ đi tiếp: `PostTurnDetail` (`post-turn.ts:56`) mang thêm `artifactChanged: boolean`.
  **Không** thêm vào `ConfinementResult` (rev 1 đề xuất sai chỗ — confinement là chuyện security,
  không phải chuyện đổi file).

#### (c) Chỗ hiện ra — theo đúng shape gate hiện tại

- **Không thêm giá trị mới vào `Gate.flag`** (`task.ts:99-112`). `flag` là một union các *trạng thái
  gate loại trừ nhau* (`still_failing` / `awaiting_import` / …); "vòng này không đổi file" là một
  *thuộc tính cộng thêm* của gate, có thể đi kèm bất kỳ flag nào. Dùng một field riêng
  (`gate.artifactUnchanged?: true`).
- Gate của ③ khi `artifactChanged === false`: badge riêng + một câu bằng ngôn ngữ chat, đại ý
  *"Vòng này không thay đổi file — việc cần làm nằm ở phía bạn"*, kèm chính lời giải thích của turn.
- Nút Import ở ④ trong trạng thái đó: **không chặn** (user có quyền import lại), nhưng phải hỏi lại
  một câu "file y hệt bản đã import lúc HH:MM, vẫn import chứ?" — đủ để phá vỡ ảo giác "đã có bản
  fix mới" đã đo được ở R3→R4.
  **Gate này có thật trong ca của run nguồn**: `task.json` ghi `deploy='selfhost'`,
  `testMode='static'`, `confirmMode='each_step'` ⇒ ④ dựng gate `awaiting_import` với nút
  `'Import to Dify'`, và user đã đi qua nó nhiều lần (`rev=48`).
  **Không lấy `import-deploy.yml` làm mốc "bản đã import"**: file đó chỉ được ghi khi model-inject
  thực sự patch ≥1 node (`import.ts:46` — `dep.ok && dep.outFile && dep.nodeCount > 0`), nên nó có
  thể không tồn tại. Mốc đúng là **hai field sinh đôi cạnh cặp field import đã có** trên `Task`
  (`task.ts:264` `importAppId`, `:274` `importAppMode`): thêm `importedHash` + `importedAt`, ghi
  bởi đúng một chỗ (`runImportAndFinish`, cùng chỗ ghi `importAppId` — `import.ts:233`). Không dựng
  event riêng cho việc này.

#### (c′) Va chạm với việc đang làm dở trong working tree — phải đọc trước khi code

Working tree hiện có **thay đổi chưa commit** cho ④-import **overwrite**: `import.ts` +149/−17,
`recovery.ts` +15, và một test mới chưa track `apps/builder/test/import-overwrite.test.ts`. Nội
dung: một lần re-import giờ **ghi đè đúng app cũ** qua `push --app-id` (`import.ts:121`
`overwriteTarget`), thay vì tạo app mới mỗi vòng fix. Ba hệ quả cho S1:

1. **Thứ tự**: S1 chạm đúng vùng đó (`import.ts` / `recovery.ts` / `task.ts`). Land việc overwrite
   trước, hoặc làm S1 **sau** nó — đừng sửa song song.
2. **Mốc import**: `importAppId` / `importAppMode` đã là tiền lệ cho "ghi lại điều gì về lần import
   cuối"; `importedHash` / `importedAt` bám đúng khuôn đó.
3. **Hạ mức nghiêm trọng của re-import trùng**: trước overwrite, mỗi vòng fix để lại một app Dify mới
   (user không biết app nào là bản hiện tại) — re-import vô ích là **có hại**. Sau overwrite, cùng
   `app_id` vào, cùng app ra, URL không đổi ⇒ re-import trùng gần như **vô hại**. Nên câu hỏi của S1
   là **thông tin, không phải rào chắn** → OQ1 nghiêng dứt khoát về "một dòng chữ + đổi nhãn nút",
   không dialog.

#### (d) i18n — bắt buộc, rev 1 thiếu hẳn

- `i18n.ts:987` chỉ có `DICT = { en: EN, ja: JA }` — **không có dict VI**. Nhãn/badge của UI vì thế
  chỉ có EN + JA.
- Nhãn gate do **server sinh bằng tiếng Anh** (`gate.ts:64 CONFIRM(id, label)`) rồi client dịch qua
  `ACTION_JA`, key là **đúng chuỗi Anh** (`i18n.ts:993`, ví dụ `'Import to Dify'`). Nên: đổi nhãn
  nút ⇒ **phải** thêm entry `ACTION_JA` tương ứng, không thì user JP thấy tiếng Anh trần.
- Hệ quả cho §3.1(c): **nhãn badge = chuỗi UI (EN + JA)**; **câu giải thích = prose của turn** (nó
  mới theo được ngôn ngữ chat, kể cả tiếng Việt). Không cố nhồi câu tiếng Việt vào `i18n.ts`.

#### (e) Event + add-on chi phí

- `RunEventKind` (`run-events.ts:15-26`) là **union đóng** → thêm `'artifact_unchanged'` vào union,
  và kiểm `dossier.ts:58` (`## Flow`) render nhãn cho kind mới. `report-analysis.ts:112` chỉ fold
  theo `phase_start`/`gate_reached` nên không ảnh hưởng.
- **Add-on rẻ, cùng chỗ móc**: ghi `costUsd` của lượt vào event. §1.1 cho thấy `task.json.cost` ghi
  đè theo phase nên chi phí từng vòng bị mất — thêm một field vào event đang ghi sẵn là gần như
  miễn phí và cứu được forensics lần sau.
- Web đổi ⇒ **rebuild `apps/builder/web/src/dist/`**; bundle nằm trong `src/` nên một server cũ sẽ
  serve UI cũ (bài học stale-server đã có).

### 3.2 S2 — search bằng shell: một sửa xác định + một probe TUỲ CHỌN

Hai cách sửa hiển nhiên **đều đã nằm sẵn trong repo và đều đã thất bại** ở run này — và rev 2 xác
nhận được điều đó bằng transcript, chứ không suy đoán:

- `SKILL.md:63-67` đã dạy nguyên văn: *"When you DO search, use the Grep / Glob / Read TOOLS — not
  the shell (the #1 time-waster in the app)"*. **Và SKILL.md thực sự được đọc**: `Read` thành công
  ở cả 3 phase (`analyze.md:902`, `spec.md:877`, `implement.md:608`). Ở ①, SKILL.md đọc tại dòng
  902 còn các denial `grep`/`rg` nằm ở 913-936 — tức luật **đã ở trong context** rồi vẫn bị phớt.
- `permission-gate.ts` SUBSTITUTE map đã trỏ sang `find.py`, và comment ở dòng 96-108 ghi rõ vì sao
  **cố ý không** trỏ sang Grep: Grep bị *deferred* trong child session (chỉ gọi được sau
  `ToolSearch`), nên hint trỏ vào cửa chưa mở từng làm run 1784267358546 thrash 25 lần.

Vậy thêm chữ vào prompt là lặp lại việc đã làm và đã hỏng.

#### (a) Sửa xác định — mâu thuẫn tài liệu (LÀM)

`SKILL.md:63-67` khẳng định *"the **Grep and Glob TOOLS themselves ARE available** (the headless
settings allow them)"*, trong khi `permission-gate.ts:96-101` ghi lại bằng chứng ngược: Grep
**deferred**, gọi là lỗi, và niềm tin "allowed by headless-settings ⇒ callable right now" chính là
cái đã gây thrash 25 lần. Repo đang tự nói hai điều trái nhau, và cái sai nằm ở chỗ model đọc.

Sửa: chỉnh câu trong `SKILL.md` cho khớp sự thật — hoặc bỏ khẳng định "ARE available", hoặc dạy
thẳng *"gọi `ToolSearch("select:Grep,Glob")` trước khi dùng Grep/Glob"*. Đây là thay đổi trong
repo, xác định, không cược vào hành vi CLI. **Đi cùng S5** (cùng bộ file prompt).

#### (b) Probe mở cửa Grep/Glob (TUỲ CHỌN — mặc định KHÔNG làm)

Dữ kiện: `headless-settings.json` đã `allow` cả hai (`["Bash","Read","Write","Edit","Glob","Grep"]`),
nhưng `claude-session.ts:100-117` **không** truyền `--allowed-tools` (grep toàn `apps/builder`: 0
hit).

Ba lý do hạ ưu tiên xuống dưới cùng, và mặc định là **không làm**:

1. **Giá thật của một denial ≈ 1 nhịp, không phải thrash.** §1.3 điểm 3: sau denial, substitute dẫn
   model sang `Read` ngay lượt kế. 20 denial rải trên 3 phase, không có chuỗi 25 lần như run
   1784267358546.
2. **Tiêu chí dừng của rev 1 không falsifiable.** So "<5 lần" của một build mới với "18 của run
   nguồn" là so **hai requirement khác nhau**; số denial biến động mạnh theo phase ngay trong cùng
   run này (analyze 16 / spec 16 / implement 7). Muốn probe có nghĩa thì phải A/B **cùng một
   requirement**, hoặc chuẩn hoá theo phase.
3. **Footgun rev 1 không nêu**: `--allowed-tools` là allowlist **thu hẹp**. Truyền `Grep,Glob` mà
   quên `Bash,Read,Write,Edit` là giết build. Probe phải khai đủ bộ, và prior nên ghi là **thấp** —
   deferral là cơ chế surfacing của CLI, không phải cơ chế permission.

Nếu vẫn chạy probe: A/B cùng requirement, và kết quả (dù âm tính) ghi vào `AGENTS.md §9`.
Không đụng tới cổng metacharacter (§5).

### 3.3 S3 — repro trước, rồi mới viết cảnh báo expected

Hiện trạng: `report.ts:79,98` (`TRIGGER_ENTRY_NOTE` / `TRIGGER_ENABLE_NOTE`) + `runnability.ts:263`
đã có câu "bật trigger ở Studio → Quick Settings", nhưng **không câu nào** nối nó với việc checklist
trước-publish sẽ báo đỏ ngay sau import. Grep toàn bộ `docs/state/` + `.claude/skills/`: **không một
dòng nào** ghi hiện tượng này — tức repo chưa hề sở hữu tri thức đó.

Repro (làm trên Dify thật, chính là môi trường user dùng):

0. **Control (rev 2 thêm)**: import trước **chính file của run nguồn** —
   `apps/builder/.runs/1786089321835/import-deploy.yml` (103KB, đang có trên đĩa) — và chụp
   checklist. Không có bước này thì bước 1 chỉ chứng minh điều gì đó về *pattern*, rồi bị suy
   diễn sang một shape khác: nếu pattern sạch mà YAML của run không sạch, ta sẽ dán nhãn "expected"
   cho triệu chứng của một file khác. (`import-deploy.yml` chỉ tồn tại khi model-inject có patch —
   `import.ts:47` — nên đây là control *cơ hội*, có thì dùng; run này có.)
1. Import một workflow có `trigger-webhook` đã biết là hợp lệ
   (`templates/patterns/yml-tsv-webhook-url.yml` hoặc `webhook-per-row-notify.yml`) — không sửa gì.
2. Mở checklist trước-publish, **chụp lại**: có mấy mục, mục nào, node nào.
3. Bật trigger / phát hành URL theo đường Studio.
4. Mở lại checklist, **chụp lại**.

Bốn kết quả, bốn đường đi — spec này chỉ cho phép viết chữ sau khi biết rơi vào ca nào:

| Quan sát được | Kết luận | Việc phải làm |
|---|---|---|
| Cả mục A0 lẫn mục "biến không hợp lệ" của node kế đều biến mất sau bước 3 | giả thuyết của R5 đúng | viết note expected (dưới) + một câu cho `implement.md` |
| Chỉ mục A0 biến mất, mục "biến không hợp lệ" còn | A1 là lỗi thật | **hủy phần note**, mở spec sửa cách khai `body` của trigger-webhook trong template |
| Mục cũ biến mất nhưng **xuất hiện mục mới** | cơ chế khác hẳn giả thuyết | dừng, mở spec riêng cho cái quan sát được |
| Không mục nào biến mất | hiểu sai cả cơ chế bật trigger | dừng, viết lại từ đầu bằng cái quan sát được |

Nếu rơi vào ca 1, note thêm vào `report.ts` (cùng họ với `TRIGGER_ENTRY_NOTE`, chỉ phát khi YAML có
trigger entry), viết theo giọng plain-language của spec 061/064 — không "webhook_id", không "biến
không hợp lệ" kiểu YAML — đại ý: *"Mở workflow lần đầu, Dify sẽ báo N mục cần xử lý ở node nhận
(và các node đọc dữ liệu từ nó). Đó là trạng thái bình thường vì URL nhận dữ liệu do Dify cấp khi
bạn bật trigger, không nằm trong file. Bật trigger xong mở lại checklist là hết. Nếu vẫn còn thì
mới là lỗi thật — chụp màn hình gửi lại."*

Câu cuối là bắt buộc: nó chừa đường cho ca 2 mà không cần đoán trước.

**i18n bắt buộc (rev 2 thêm)**: note của `report.ts` là frame tiếng Anh, được dịch client-side bằng
bảng regex `NOTE_JA` (`i18n.ts:1046`) — hai note hiện có đều mang marker
`// wording-stable (NOTE_JA keys off this)` (`report.ts:76,95`). Note mới **phải** kèm một entry
`NOTE_JA` + marker cùng dạng, không thì user JP đọc tiếng Anh trần.

Kèm theo, **một câu duy nhất** cho `implement.md` (ý "buộc đối chiếu pattern" đã bị hạ cấp theo
§2.2): khi user báo lỗi trên Studio ở một node trigger, **đọc pattern đã kiểm chứng trong
`templates/patterns/` trước khi đề xuất sửa file**, và nếu triệu chứng khớp mục expected ở trên thì
nói thẳng là expected thay vì sửa YAML. Chỉ được thêm câu này SAU khi repro cho ra ca 1.

### 3.4 S4 — câu hỏi ở gate: đánh số + đề xuất sẵn, cho MỌI ca

Spec 093 đã ship đúng dạng này nhưng **chỉ trong phụ lục song ngữ**, tức chỉ khi ngôn ngữ chat ≠
ngôn ngữ artifact. Đo chính xác (rev 2):

- `draft.md:39-41` và `spec.md:36` **có** luật "NUMBERED list … → Suggested: <default>" — nhưng cả
  hai nằm **bên trong** block *"When the two languages differ, end `SPEC.md` with a review appendix
  in the CHAT language"*.
- `analyze.md`: **0 hit** — không có luật nào, kể cả bản có điều kiện. Mà ① chính là chỗ friction
  xảy ra.

User chat tiếng Nhật + build tiếng Nhật vẫn nhận đoạn văn dày như cũ. Chỉ dẫn chung hiện tại
(`spec.md:131-141`) chỉ yêu cầu "chọn default và ghi vào Open questions" — không đòi đánh số,
không đòi nêu phương án đề xuất.

Bằng chứng đây là vấn đề thật, không phải khẩu vị: ở run nguồn user phải nhắn **hai lần** "các câu
hỏi khác thì t ko rõ lắm giải thích lại đi", rồi chốt bằng "mấy cái khác thì theo recommend đi".

Nâng thành luật chung ở `analyze.md` + `spec.md` + `draft.md`: câu hỏi đặt cho người duyệt ở gate
**luôn** là danh sách đánh số, mỗi câu kết bằng `→ Đề xuất: <phương án mặc định>` để người đọc trả
lời bằng một con số hoặc "theo đề xuất". Phụ lục của 093 giữ nguyên; nó trở thành *một chỗ áp dụng*
của luật chung thay vì là nơi duy nhất có luật.

### 3.5 S5 — luật viết cho người đọc, áp cho ②③④

**Chẩn đoán cấu trúc** (đếm lại, rev 2 xác nhận nguyên số của rev 1): luật này đã tồn tại và được
mài kỹ ở ① (`analyze.md:64`: *"Keep the chat overview PLAIN and user-facing — do NOT narrate the
tool mechanics. The user reads this to check intent, not to see how you worked."*) — nhưng ở các
phase sau: `spec.md` **0**, `draft.md` **0**, `implement.md` **1** (hit duy nhất là về ngôn ngữ),
`judge.md` **0**, `promote.md` **0**. Đúng những phase kể chuyện theo đồ thị node. Cộng thêm việc
SPEC bắt buộc có bảng **Nodes (`id-placeholder | type | purpose`)** (`spec.md:142`), prose trong chat
có xu hướng soi gương bảng đó và kể theo trục node thay vì trục việc.

Một khối dùng chung ~10-12 dòng, chèn vào 4 file (không viết mới cho từng file), gồm 3 luật:

**(a) Nghĩa trước, toạ độ sau.** Nhãn node chỉ xuất hiện SAU khi đã nói nghĩa, đặt trong ngoặc.

**(b) Tên máy theo luật affordance** (§2.4): chỉ nêu khi người dùng phải gõ hoặc nhìn thấy nó trên
màn hình — tên biến môi trường họ sẽ tạo trong Dify, tên plugin, tên cột sheet, nhãn nút của Studio.
Còn `string` / `array[string]` / `flatten_output` / `error_strategy` / `END_EMPTY_IMMEDIATE` /
`value_selector` thì diễn đạt bằng lời. Tham chiếu nội bộ kiểu "(bài học #1)" chỉ có nghĩa khi người
đọc đang mở cùng tài liệu — viết thẳng ra hoặc bỏ.

**(c) Luồng kể bằng chuỗi mũi tên lời thường trước, chi tiết sau.** Bảng node để trong `SPEC.md` /
artifact panel, không bê vào chat.

Kèm **một cặp ví dụ XẤU/TỐT** lấy đúng câu user đã chụp (few-shot đổi hành vi chắc hơn danh sách cấm):

> **XẤU** — `C0` webhook nhận `secret` / `row_keys` / `message_id` — cả 3 đều khai `string` (bài học #1).
> `C1` đối chiếu `secret` với `gas_shared_secret`; sai → trả list rỗng, run đi thẳng vào nhánh trống.
>
> **TỐT** — Nhánh chạy ngay khi APP 1 gọi sang: nhận yêu cầu → kiểm mật khẩu chung → đọc các dòng đã
> được tick duyệt trong Sheets → không có dòng nào thì dừng sớm. Mật khẩu sai thì workflow kết thúc
> yên lặng, không ghi gì vào Sheets (node `C1`). Danh sách dòng gửi sang chấp nhận cả một mã, nhiều
> mã cách nhau bằng dấu phẩy, hay một danh sách — nên APP 1 không phải sửa gì.

(Câu cuối của **TỐT** đã siết lại: bản rev 1 viết "nhận được cả ba kiểu viết" — người dùng không
biết "ba kiểu viết" là gì, mà few-shot thì bị copy gần như nguyên văn.)

Ranh giới phải giữ: (a)(b)(c) áp cho **chat prose**; nội dung ghi vào YAML/SPEC vẫn theo ngôn ngữ
requirement đúng như 093 §2.1 — S5 nói về *cách viết*, 093 nói về *ngôn ngữ*, không được trộn.

## 4. Slices

Thứ tự: **S4+S5 (một lượt) → S1 → S3 → S2(a)**. S2(b) tuỳ chọn, mặc định bỏ.

### S4+S5 — luật gate + luật viết, một lượt (S)

Cùng bộ file nên làm chung, tránh ba lần sửa cùng chỗ (093 vừa chạm xong):

- S4: sửa `analyze.md` / `spec.md` / `draft.md` — luật đánh số + `→ Đề xuất:` thành **vô điều kiện**
  (bỏ khỏi phạm vi "khi hai ngôn ngữ khác nhau").
- S5: khối dùng chung + cặp ví dụ XẤU/TỐT, chèn vào `spec.md` / `implement.md` / `judge.md` /
  `promote.md` (① đã có, chỉ chỉnh cho khớp giọng).
- S2(a): sửa câu khẳng định sai về Grep/Glob trong `SKILL.md:63-67`.

Test: `content-language.test.ts` đã có tiền lệ ghim chuỗi trong prompt file (`assert.match` dòng
71-76, banner hai tầng của 093) — thêm assert rằng luật đánh số còn nguyên. **Ghim mảnh ổn định**
(dấu `→` + từ khoá `Đề xuất`/`Suggested`, theo từng file), đừng ghim cả câu — assert-on-prompt vốn
giòn theo thiết kế.

### S1 — nhãn "vòng này không đổi file" (M)

`artifactChanged` = so **hash nội dung** artifact trước/sau spawn (§3.1(b)) → `PostTurnDetail` →
`gate.artifactUnchanged` → badge (EN+JA, kèm `ACTION_JA` nếu đổi nhãn nút) + câu giải thích từ prose
của turn + dòng chữ trước re-import (so hash hiện tại với `importedHash`/`importedAt` mới trên
`Task`, §3.1(c)) + event `artifact_unchanged` (nhớ mở union `RunEventKind` + nhãn ở `dossier.ts`)
+ rebuild `web/src/dist`. **Làm sau khi việc ④-overwrite trong working tree đã land** (§3.1(c′)).

**Test đỏ-khi-revert** — phải bắt được đúng failure mode của rev 1:

1. Fixture đặt dưới **`projects/_drafts/<slug>/`** (ca mặc định, gitignored). Lượt không ghi file ⇒
   `artifactChanged:false`; lượt ghi file ⇒ `true`.
   → Test này **đỏ** nếu ai nối cờ vào `turnTouched` **hoặc** `ConfinementResult.touched` (cả hai
   trả rỗng ở path gitignored), và đỏ nếu nối vào `diff.json`.
2. Một lượt `/reply` trên file **đã dirty từ trước** ⇒ lượt có ghi vẫn phải ra `true` (chặn lỗi
   baseline ăn file).
3. Ghi lại **đúng nội dung cũ** ⇒ `false` (đúng nghĩa người dùng).

Fixture nội dung có thể lấy từ attempt 4 / attempt 6 của run nguồn (§1.1) — hai lượt zero-write
thật.

### S3 — repro webhook checklist → note (M, cần Dify thật)

Chạy 5 bước §3.3 (0→4), dán ảnh + kết luận vào chính spec này, rồi mới code theo đúng ca quan sát
được. Kèm entry `NOTE_JA`. Nếu ra ca 2/3/4 thì slice này **không sinh note nào** mà đẻ ra một spec
khác — đó là kết quả hợp lệ, không phải thất bại.

### S2(b) — probe mở cửa Grep/Glob (S, mặc định KHÔNG LÀM)

Nếu chạy: truyền đủ allowlist ở `claude-session.ts`, A/B **cùng một requirement**, đếm denial theo
phase. `< 5` → giữ, ghi `docs/state/`; không đổi → hoàn nguyên, ghi một dòng "đã thử, không ăn thua"
vào `AGENTS.md §9`.

## 5. Non-goals

- **Không** đổi cách truyền attachment (đính lại ảnh cũ mỗi vòng). Đã đo: `attachments.ts:275` chỉ
  liệt kê đường dẫn, chi phí nằm ở context session — §1.3 điểm 1. Đừng đề xuất lại.
- **Không** nới cổng metacharacter của `permission-gate.ts` để cho `| head` / `2>&1`. Đã đo: chỉ
  ~4/39 denial được lợi, đổi lại là mở rộng bề mặt parser của lớp default-deny — §1.3 điểm 2.
- **Không** thêm công cụ search nội dung cho `find.py`. Substitute hiện tại trả lời được, báo rõ
  khi 0 kết quả, và đo được là **có tác dụng sau 1 nhịp** — §1.3 điểm 3.
- **Không** dùng git (`turnTouched` / `ConfinementResult.touched` / `diff.json`) để suy ra
  "vòng này có đổi file" — §3.1(a). Đây là ngõ cụt đã đo, đừng đề xuất lại.
- **Không** thêm giá trị mới vào `Gate.flag` cho S1 — §3.1(c).
- **Không** cấm nhãn node trong prose (§2.3) — chỉ đổi thứ tự.
- **Không** tự động chặn nút Import khi file không đổi (S1 chỉ hỏi lại; quyền vẫn của user).
- **Không** viết bất kỳ câu "cảnh báo này là bình thường" nào trước khi S3 repro xong (§2.1).
- **Không** sửa `denied_calls_max` của `e2e_check.py` trong spec này (§1.3 điểm 2 chỉ ghi lại sai
  số của metric đó).

## 6. Open questions

1. ~~S1: câu xác nhận trước re-import nên là dialog hay chỉ là dòng chữ?~~ **CHỐT: dòng chữ + đổi
   nhãn nút**, không dialog — vì việc overwrite đang làm dở (§3.1(c′)) khiến re-import trùng gần như
   vô hại, nên đây là thông tin chứ không phải rào chắn. Nhớ kèm entry `ACTION_JA` cho nhãn mới
   (§3.1(d)).
2. ~~S3: repro trên self-host của user hay trên Dify Cloud?~~ **CHỐT**: trên đúng instance user
   dùng (ảnh trong run nguồn là Studio tiếng Việt của user) — vì mục đích là câu chữ khớp cái user
   nhìn thấy. Đây là một quyết định, không phải ẩn số; để mở chỉ làm S3 đứng.
3. ~~S5: có nên đưa cặp ví dụ XẤU/TỐT vào `SKILL.md` thay vì lặp ở 4 file?~~ **CHỐT: không** —
   inline vào 4 file phase. Lý do đo được: SKILL.md *có* được đọc (3/3 phase), nhưng luật đanh nhất
   của chính nó (*"the #1 time-waster"*) đã ở trong context mà vẫn bị phớt (§3.2). Biến quyết định
   là **khoảng cách tới chỗ dùng**, không phải sự hiện diện — đúng §2.2.
4. (mới) S1: badge chỉ hiện ở gate ③, hay cả ④ khi user quay lại? Nghiêng về cả hai, vì R3→R4 là
   một cú nhảy ③→④.

## 7. Bảng nhà tri thức (cho `/spec-close` sau này)

| Mảnh | Nhà |
|---|---|
| Cờ `artifactChanged` = hash nội dung, **và vì sao KHÔNG dùng git porcelain** (`projects/_drafts/` gitignored + baseline ăn file ở `/reply`) **lẫn `diff.json`** | comment tại `post-turn.ts` + `docs/state/build-lifecycle.md` |
| Nhãn gate do server sinh EN → `ACTION_JA`; report note EN → `NOTE_JA`; không có dict VI | `docs/state/ui-surface.md` |
| Hiện tượng checklist sau import của trigger-webhook (nếu S3 xác nhận) | `docs/state/readiness-and-plugins.md` (cùng nhà với bảng note) |
| `SKILL.md` từng khẳng định sai "Grep/Glob ARE available" (thực tế deferred) | `AGENTS.md §9` — sai lệch tài liệu đã sửa |
| Kết quả probe Grep/Glob (nếu chạy, dù âm tính) | `AGENTS.md §9` — ngõ cụt đã thử |
| Luật câu hỏi đánh số + luật viết cho người đọc | `.claude/skills/dify-build/*.md` (tự nó là nhà) + CHANGELOG |
| Ba đính chính §1.3 + sai số của `denied_calls_max` | spec này; sau close tóm 1 dòng vào `docs/state/build-lifecycle.md` |
| `task.json.cost` ghi đè theo phase ⇒ mất chi phí từng vòng | `docs/state/build-lifecycle.md` |
| Bằng chứng field run 1786089321835 (bảng attempt §1.1) | spec này |

## 8. Ảnh hưởng nếu implement — đánh giá hai chiều

### 8.1 Tích cực

| Slice | Lợi ích cụ thể, đo được |
|---|---|
| S4+S5 | Trả lời trực tiếp yêu cầu 08-11. Prompt-only, không có đường chết: sai thì revert một file. Xoá đúng cái friction đã đo (user hỏi lại 2 lần ở ①). |
| S1 | Cắt đúng 2/5 vòng vô nghĩa của run nguồn (§1.1). Hai vòng đó ~$3–5 và ~30 phút của user. Event mới còn khiến run sau **tự chẩn đoán được** — hiện tại phải đếm `- Write` trong transcript mới biết. |
| S1 add-on cost | Khôi phục forensics chi phí từng vòng, thứ rev 1 phải đọc từ UI vì đĩa không lưu. |
| S3 (ca 1) | Chặn nguyên một lớp sự cố tại nguồn: user không mở vòng request-changes nào cả. Đây là ROI cao nhất trong spec — nếu repro xác nhận. |
| S2(a) | Xoá một mâu thuẫn tài liệu đang chỉ model vào cửa đóng. Chi phí gần bằng 0. |

### 8.2 Tiêu cực / rủi ro

| Rủi ro | Mức | Ghi chú |
|---|---|---|
| **S3 dạy user phớt lờ một lỗi thật** | **Cao nếu bỏ repro** | Đây là rủi ro nghiêm trọng nhất của cả spec. §2.1 + câu chốt "nếu vẫn còn thì mới là lỗi thật" là hai lớp chắn; bước 0 (control) là lớp thứ ba. Bỏ bất kỳ lớp nào thì slice này gây hại nhiều hơn lợi. |
| **S1 báo sai → mất niềm tin** | Trung bình | Một badge "vòng này không đổi file" mà sai còn tệ hơn không có badge: user sẽ ngừng đọc gate. Chính vì thế cơ chế phải là hash (§3.1(b)) và test phải chạy trên path gitignored (§4 S1 case 1). |
| **S5 làm prose loãng / mất thông tin kỹ thuật user CẦN** | Trung bình | Luật (b) có thể bị model đọc quá tay thành "không nêu tên gì cả", trong khi tên biến env / tên cột sheet là thứ user phải gõ. Ràng chặt bằng luật affordance + few-shot có nêu `C1`; nhưng phải theo dõi ở 2–3 build đầu. |
| **Phình prompt** | Trung bình | `implement.md` đã 16.9KB, `spec.md` 12KB. S4+S5 thêm ~15-20 dòng mỗi file, ngay sau khi 093 vừa thêm block Output-language. Rủi ro thật là **luật mới bị chôn** giữa các luật cũ, không phải tiền token. Đặt khối ở chỗ dễ thấy, đừng nhồi cuối file. |
| **Test ghim chuỗi prompt giòn** | Thấp–TB | Mỗi lần đổi câu chữ là một test đỏ. Repo đã chấp nhận trade-off này (093) và có marker; giảm đau bằng cách ghim mảnh ngắn nhất. |
| **S1 chạm 5–6 file server + web + dist** | Trung bình | `post-turn.ts` / `orchestrator.ts` / `task.ts` / `gate.ts` / `run-events.ts` / `i18n.ts` + rebuild dist. Quên rebuild `web/src/dist` ⇒ "sửa rồi mà UI không đổi" (bài học stale-server). |
| **S1 xung đột với việc ④-overwrite đang làm dở** | Trung bình | `import.ts` +149/−17 và `recovery.ts` +15 chưa commit, cộng một test chưa track (§3.1(c′)). Sửa song song là tự tạo conflict ở đúng hàm `runImportAndFinish`. Land cái kia trước. |
| **S1 thêm 2 lần hash mỗi turn** | Không đáng kể | sha256 một file ~100KB ≪ một turn. |
| **S2(b) nếu chạy: giết build vì allowlist thu hẹp** | Cao (nên mặc định bỏ) | §3.2(b) footgun. Lợi kỳ vọng thấp, rủi ro cao, prior thấp → không làm. |
| **Chi phí thi công tổng** | — | S4+S5+S2(a): một lượt, prompt-only. S1: một lượt server+web có test. S3: phụ thuộc thao tác tay trên Dify, có thể ra "không sinh code". Không slice nào cần đại tu kiến trúc. |

### 8.3 Kết luận cân bằng

Đáng làm — nhưng **không phải như rev 1 xếp thứ tự**. Giá trị chắc chắn nhất nằm ở S4+S5 (rẻ, đúng
yêu cầu, rủi ro thấp) và ở S3 *nếu* repro xác nhận ca 1 (ROI cao nhất, rủi ro cao nhất). S1 giá trị
thật nhưng chỉ khi đổi cơ chế; giữ nguyên rev 1 thì nó **ship một cờ luôn sai**. S2 nên co lại
thành một sửa tài liệu một dòng.

## 9. Phụ lục — review rev 1 đối chiếu code (2026-08-11)

Ghi lại để không ai phải kiểm lại, và để thấy rev 1 sai ở đâu.

**9.1 Đúng và đã kiểm** (14 claim): `post-turn.ts:310`; `attachments.ts:275`;
`snapshotDiffBase` no-op trên `/reply`; `ArtifactPanel.tsx:304` → `noDiffYet`;
`permission-gate.ts:96-108` cố ý không trỏ Grep; `headless-settings.json` allow Grep+Glob;
`claude-session.ts` không truyền `--allowed-tools` (0 hit toàn `apps/builder`);
`report.ts:79,98` + `runnability.ts:263` có câu bật trigger nhưng không nối với checklist;
`docs/state/` + `.claude/skills/` không có dòng nào ghi hiện tượng checklist;
`readiness-and-plugins.md:238` luật affordance; đếm luật PLAIN/user-facing (analyze 4, spec 0,
draft 0, implement 1, judge 0, promote 0); 093 chỉ có luật đánh số trong phụ lục song ngữ;
`content-language.test.ts` có tiền lệ ghim chuỗi prompt; `templates/patterns/` có cả hai file
repro.

**9.2 Sai — S1 móc vào cơ chế mù**: §3.1(a). Bằng chứng: `.gitignore:62/64`,
`task.ts:506`, `scaffold.ts:152`, `git status --porcelain -uall projects/` = rỗng,
`transcripts/implement.md:629` (`projects/_drafts/build_requirement…`), và việc builder không
commit giữa các lượt.

**9.3 Thiếu**: i18n cho S1 (`ACTION_JA`) và S3 (`NOTE_JA`); `RunEventKind` là union đóng;
`Gate.flag` là union trạng thái loại trừ nhau nên không phải chỗ của cờ này;
`import-deploy.yml` không phải mốc "bản đã import" đáng tin (`import.ts:46`); rebuild
`web/src/dist`; control cho repro S3; và **việc ④-import overwrite đang làm dở trong working
tree** (§3.1(c′)) — rev 1 viết như thể ④ còn nguyên trạng cũ.

**9.3b Kiểm ở tầng sử dụng app** (không chỉ code): run nguồn `deploy='selfhost'` /
`testMode='static'` / `confirmMode='each_step'` / `rev=48` / `status='done'`, `appUrl` trỏ
`localhost:8090` ⇒ gate ④ `awaiting_import` và nút `'Import to Dify'` đúng là thứ user đã bấm; gate
cuối `{"actions": []}` (build đã kết thúc, không phải đang treo). Tức mọi giả định của S1 về ④ khớp
với ca thật, không phải ca giả định.

**9.4 Mạnh hơn rev 1 tưởng**: premise của S2 được xác nhận bằng transcript — SKILL.md **được đọc**
ở cả 3 phase (`analyze.md:902`, `spec.md:877`, `implement.md:608`) và ở ① nó được đọc *trước* chuỗi
denial `grep`/`rg` (913-936). Luật ở trong context mà vẫn bị phớt. Đó vừa là bằng chứng cho S2
("thêm chữ không cứu được"), vừa là câu trả lời cho OQ3 (proximity > presence).

**9.5 Yếu hơn rev 1 tưởng**: giá của một denial ≈ 1 nhịp (`implement.md:635` → `:639`), không phải
thrash; và `✗` lẫn cả exit-code failure nên denominator 39 thừa đếm. → S2 xuống cuối.

## 10. Nhật ký thi công S4+S5+S2(a) — 2026-08-11

**Đã đụng**: `analyze.md` (S4 + bản rút gọn của S5), `spec.md` / `draft.md` (S4 + khối S5 đầy đủ),
`implement.md` / `promote.md` (khối S5 đầy đủ), `judge.md` (S5 rút gọn), `SKILL.md` (S2a),
`apps/builder/test/content-language.test.ts` (+8 assert), `apps/builder/CHANGELOG.md`.

**Hai chỗ lệch khỏi §3.5, có chủ ý:**

1. **`judge.md` KHÔNG nhận khối đầy đủ.** §3.5 liệt nó vào danh sách "4 file" dựa trên phép **đếm**
   (nó có 0 hit luật PLAIN), nhưng đọc file thì `judge.md` là phase **data-only**: không có tool, không
   có chat prose, output là **đúng một JSON object**. Nhét luật "chat prose" + few-shot đoạn văn vào đó
   là dạy sai bề mặt. Nó nhận bản 2 luật, phạm vi ghi rõ **chỉ cho `evidence` / `summary`** — hai field
   free-text mà người duyệt thực sự đọc ở gate. Có assert `doesNotMatch(/\*\*BAD\*\*/)` để một lần
   "cho 5 file giống hệt nhau" sau này không paste ngược luật chat vào phase JSON.
2. **`draft.md` ĐƯỢC thêm vào S5.** §3.5 phần chẩn đoán tự đếm `draft.md` **0** nhưng danh sách chèn
   lại bỏ sót nó. `draft.md` là bản sinh đôi fast-mode của `spec.md` ở ② và cũng trình spec ở gate —
   cùng bề mặt, cùng lỗ hổng. Đây là sửa sót của chính spec, không phải mở rộng phạm vi.

**Một bẫy phải né khi sửa `spec.md`**: test 030 bắt buộc section `## Output language` của `draft.md`
và `spec.md` **byte-identical**. Câu trỏ tới luật chung mà S4 thêm vào phụ lục song ngữ nằm **bên
trong** section đó ⇒ phải chép y hệt sang `draft.md`, nếu không suite đỏ. (Đã làm; guard drift vẫn
xanh.)

**Hiệu chuẩn phép đo (bài học lặp lại)**: lần bắn thử đỏ-khi-revert đầu tiên báo `analyze.md`
"PASS cả khi revert" — hoá ra **phép revert sai**, không phải assert sai: ở `analyze.md` luật được
nhúng thành đoạn văn chứ không phải section riêng, nên regex xoá section không khớp gì cả. Nhắm lại
đúng đoạn thì assert đỏ như mong đợi. Một phép thử "xanh" từ một mutation no-op là **vô nghĩa** —
luôn assert rằng mutation đã thực sự áp.

**Chi phí prompt sau khi chèn**: `SKILL.md` 10.8KB · `analyze.md` 13.4 · `spec.md` 14.8 ·
`draft.md` 11.9 · `implement.md` 18.8 · `judge.md` 3.6 · `promote.md` 8.6. Khối S5 đặt ngay sau
*Output language* (đầu file, trước `## Do`) chứ không nhét cuối — đúng lo ngại "luật mới bị chôn" ở
§8.2.

**Còn lại sau lượt này**: S1, S3, S2(b).

## 11. Nhật ký thi công S1 — 2026-08-11

**Đã đụng** (10 file): `post-turn.ts` (hàm `artifactHash` + `PostTurnParams.artifactHashBefore` +
`PostTurnDetail.artifactChanged`), `orchestrator.ts` (chụp hash cạnh `baseline` :488, thread qua
`verifyPhase`, set cờ + event), `task.ts` (4 field mới), `run-events.ts` (mở union),
`dossier.ts` (nhãn `= no file change`), `import.ts` (ghi `importedHash`/`importedAt`),
`web/types.ts` + `web/i18n.ts` (EN+JA) + `web/Chat.tsx` (2 nhánh render, export `gateView`),
+ 2 file test mới. **KHÔNG** đụng `Gate.flag`, `computeGate`, `resolveImplementOutcome`.

**Hiệu chuẩn cơ chế (bắt buộc, không phải tuỳ chọn).** Chạy cùng 5 fixture qua cả hai cơ chế:

| kịch bản | đúng phải là | hash (đã ship) | git-delta (đề xuất rev 1) |
|---|---|---|---|
| `_drafts`: turn GHI LẠI file | true | true ✓ | **false ✗** |
| `_drafts`: turn không ghi gì (R3/R5) | false | false ✓ | false ✓ |
| ghi lại y hệt byte | false | false ✓ | false ✓ |
| implement đầu tiên (chưa có file) | true | true ✓ | **false ✗** |
| `/reply` trên file đã dirty | true | true ✓ | **false ✗** |

git-delta trả **false cho cả 5** — tức nếu ship theo rev 1, badge "không đổi file" sẽ hiện ở **mọi
vòng**, kể cả vòng sửa thật. Ba ca sai là ba test đỏ trong `artifact-changed.test.ts`.

**Quyết định lệch khỏi §3.1(c), có chủ ý**: cờ **không** đi qua `Gate`/`computeGate` mà nằm trên
`Task`. Lý do đọc từ code: `computeGate` có ~20 call site và ④ `awaiting_import` được dựng ở
`orchestrator.ts:898` — xa chỗ verify, không có `PhaseVerify` trong tay. Một field trên `Task` (đúng
tiền lệ `preflightNote`/`probeNote`) tới được cả hai gate, sống qua hop ③→④, và tự động lên wire vì
`toWireTask` là spread. Blast radius nhỏ hơn hẳn.

**Ba lớp kiểm, không chỉ unit test**:
1. cơ chế — 9 test trên **git repo thật có `projects/_drafts/` bị ignore** (không phải temp dir trần),
   trong đó một test `calibration` assert thẳng rằng git KHÔNG thấy file — để lý do "không dùng git"
   là một sự thật được kiểm, không phải một comment;
2. render — 7 test trên `gateView` (phải export nó, cùng kiểu `GateActions`/`richText` đã export);
3. **entry-point thật** — dựng một task tạm trong `.runs/`, gọi `GET /api/tasks/:id` qua chính app
   đang chạy: 4 field lên wire đủ; mở UI thấy badge ⚠ *No file change* + câu dẫn đầu, nút
   *Continue to Test* nguyên vẹn; task tạm đã xoá, `/api/tree` xác nhận sạch. Đồng thời kiểm bundle
   `web/dist` (đường server thật serve — `server/index.ts:171`) có chứa chuỗi mới, tránh bẫy stale-dist.
   Lưu ý: `apps/builder/web/src/dist/` là bundle **cũ, không được serve** — đừng nhầm.

**Back-compat**: `artifactChanged` là optional. `undefined` = chưa đo ⇒ UI render thẻ thường, không bao
giờ khẳng định "không đổi". Kiểm trên chính run `1786089321835` qua API: field vắng mặt, đúng như thiết
kế. Mọi `task.json` cũ vẫn chạy.

**Còn lại**: S3 (cần thao tác tay trên Dify, §3.3), S2(b) (mặc định không làm).
