# Spec 091 — Gate quyết định trên chuỗi chuẩn hoá + transcript ghi lý do từ chối + bộ đếm hết đoán

**Status**: S1–S4 IMPLEMENTED (2026-08-05, đã audit code-first trước khi làm — mọi claim §1 khớp
nguồn). Còn lại trước khi close: §6.2 re-fire prompt bundle bằng instrument mới (cần một build thật).
Nguồn: chuỗi kiểm chứng phiên 2026-08-06 (bundle user thật
`1785928989748` + 140 dòng ✗ gộp từ mọi transcript local + thí nghiệm 20 ca qua `decide()` thật).
**Effort**: S1 ≈ S (transcript, instrument-first) · S2 ≈ S (gate + bộ test 20 ca có sẵn) ·
S3 ≈ S (classifier) · S4 ≈ XS (1 dòng guidance).
**Đóng spec**: qua `/spec-close 091`.

---

## 0. KỶ LUẬT BẰNG CHỨNG (mới — điều kiện đọc/duyệt/implement spec này)

Spec trước từng đi lạc vì khẳng định không kèm cách kiểm. Spec này tự ràng buộc:

- Mọi claim trong §1 mang một nhãn: **[REPRO]** = có lệnh tái hiện tất định, chạy lại được ngay;
  **[ĐO]** = số đếm trên dữ liệu nêu rõ nguồn + cỡ mẫu; **[CẬN DƯỚI]** = số đo bị nghẽn bởi chính
  instrument (chỉ được dùng làm "ít nhất", cấm dùng làm số chính xác); **[GIẢ THUYẾT]** = chưa
  kiểm — KHÔNG được làm căn cứ cho slice nào.
- Mọi instrument dùng trong §6 Validation phải qua **hiệu chuẩn**: tái hiện được ca-đã-biết-đáp-án
  trước khi kết quả của nó được tin. Ca hiệu chuẩn của spec này:
  - **K1 (phải DENY hôm nay)**: `.venv/bin/python tools/dify_base/find.py --name "kw kw" --full`
  - **K2 (phải DENY hôm nay và mãi mãi)**: `cat apps/builder/.e''nv`
  Bộ test S2 nhúng cả hai; một thay đổi làm K2 flip là lập tức đỏ.
- Bài học đã trả giá trong chính phiên đo (ghi để người sau khỏi lặp): thí nghiệm v1 chỉ gọi
  `analyzeBashCommand` — nửa đường ống — và báo "thủng an toàn 6 ca" SAI; đường thật là `decide()`
  (chạy `checkForbiddenPath` TRƯỚC). Mọi phép thử gate trong spec này bắt buộc đi qua `decide()`.

## 1. Sự thật đã kiểm — mỗi dòng một nhãn + cách tái hiện

- **F1 [REPRO]** Lệnh mà `analyze.md:88` (spec 076 E2b) chỉ dẫn nguyên văn bị gate từ chối:
  `SIMPLE_COMMAND` loại dấu nháy ([permission-gate.ts:155](../../apps/builder/server/hooks/permission-gate.ts)),
  còn `find.py --name` cần nháy để mang cụm nhiều từ (bỏ nháy → argparse vỡ, đã chạy thử cả hai
  chiều). Tái hiện: chạy K1 qua `decide()` → deny. Hệ quả sản phẩm: **intent-pass E2b chưa từng
  chạy được trong một build thật nào**.
- **F2 [CẬN DƯỚI]** Trên 140 dòng ✗ gộp từ transcript local: ≥66 dòng (≥47%) chỉ-vướng-nháy,
  ≥54 là `find.py --name` đúng-chỉ-dẫn. CẬN DƯỚI vì 68% dòng bị cắt cụt ~70 ký tự — không dùng
  các số này làm căn cứ định lượng chính; căn cứ chính là F1 (tất định) + F6.
- **F3 [REPRO]** Transcript vứt lý do từ chối: [run-transcript.ts:84](../../apps/builder/server/lib/run-transcript.ts)
  đọc `tool_result.is_error` (boolean) và **bỏ `block.content`** — nơi chứa nguyên văn lý do gate
  mint. Vì vậy mọi chẩn đoán trước nay phải đoán nguyên nhân từ chuỗi lệnh cắt cụt.
- **F4 [REPRO]** `✗` nghĩa là "lỗi", KHÔNG phải "bị chặn" — docstring
  [campaign.py:245](../../apps/builder/scripts/campaign.py) tự nhận là *estimate*; CHANGELOG 0.3.0
  cũng đã ghi vụ "4 vòng lint tự-sửa bị đọc nhầm thành thrash".
- **F5 [REPRO]** Bộ phân loại chính chủ đếm sai đúng lớp lỗi ưu thế: `_METACHAR`
  ([campaign.py:241](../../apps/builder/scripts/campaign.py)) không coi nháy là metachar và
  `_ALLOWED_PY` khớp mọi lệnh `find.py` → lệnh `--name "..."` (gate DENY) bị xếp "ran-and-failed".
  Trên bundle `1785928989748` phase ①: classifier báo `denied=2`, đối chiếu tay nguyên văn 5 dòng ✗
  ra **denied=4** (2 nháy + 2 grep), errored=1 (`ls` chạy fail thường).
- **F6 [ĐO, n=1 bundle]** Phase ② của bundle: 11/12 ✗ là MỘT cuộc săn `error_strategy`/`fail-branch`
  (grep/git grep/rg/python đủ kiểu, chốt bằng spawn 1 Agent). Nguyên nhân cơ học [REPRO]:
  `grep -c error-strategy` → `implement.md: 4`, `spec.md: 0` — worked-example 085 S1c chỉ được trao
  cho ③, chưa trao cho ②. (n=1 nhưng cơ chế tất định: doc không có con trỏ thì turn nào cần cũng
  phải đi săn.)
- **F7 [REPRO]** Thí nghiệm phương án S2 — 20 ca qua `decide()` thật, mô phỏng patch bằng cách
  strip nháy ở input (tương đương đặt normalize ở đầu nhánh Bash):
  **AN TOÀN 16/16 vẫn deny** (4 biến thể tách chuỗi `.e''nv`/`.e""nv`/`'.env'`/`.en'v'`, secret
  qua tham số find.py, `python -c`, `bash -c`, `curl`, redirect/pipe/chaining/subshell GIẤU TRONG
  nháy, `.ssh` kể cả dạng tách, đọc ngoài repo, script ngoài allow-set) ·
  **HỢP LỆ 4/4 mở được** (2 ca E2b đang chết + 2 ca đang sống giữ nguyên).
- **F8 [REPRO]** Ràng buộc format transcript: cả hai bộ đếm đều anchor ✗ Ở CUỐI DÒNG —
  `_denied_calls` dùng `endswith("✗")` ([e2e_check.py:274](../../apps/builder/scripts/e2e_check.py)),
  `_CALL_LINE` dùng `[✓✗]\s*$` ([campaign.py:242](../../apps/builder/scripts/campaign.py)) ⇒ lý do
  KHÔNG được nối sau dấu ✗; phải nằm dòng nối tiếp.

## 2. Chẩn đoán gốc — MỘT nguyên lý, hai biểu hiện

> **Quyết định và phép đo đều đang chạy trên dữ liệu sai tầng.** (a) Gate quyết định trên *chuỗi
> thô* trong khi tầng an toàn phía sau tự tuyên bố giả định "không còn nháy" — tokenizer
> secret/out-of-repo ghi rõ *"SIMPLE_COMMAND has already guaranteed no quotes… a token IS what the
> shell sees"* ([permission-gate.ts:380-381](../../apps/builder/server/hooks/permission-gate.ts));
> lệnh cấm nháy là cách cưỡng chế giả định đó bằng cách CẤM cả người vô tội. (b) Bộ đo *đoán lại*
> quyết định của gate bằng heuristic thứ hai thay vì đọc lý do gate đã mint — hai bản mô tả một
> khái niệm, lệch nhau đúng chỗ quan trọng (F5) — cùng họ với bài học MODEL_TYPES của 087.

Chữa đúng tầng: gate **chuẩn hoá rồi mới quyết** (giả định của tokenizer thành hiện thực theo cấu
trúc, hết cần cấm nháy); transcript **ghi lý do thật**; bộ đo **đọc lý do thật thay vì đoán**.

## 3. Nguyên tắc (giữ khi implement)

- **Instrument trước, thay đổi sau**: S1 (ghi lý do) ship TRƯỚC S2 để §6 có before/after đo bằng
  chính instrument mới — không bao giờ lặp lại cảnh "fix xong không biết có ăn không".
- **Thi hành raw, quyết định trên normalized**: lệnh THẬT được thực thi giữ nguyên nháy (argparse
  cần nó); chỉ CHUỖI ĐƯA VÀO các phép kiểm là bản strip. Message từ chối trích chuỗi RAW.
- **Không nới charset**: ngoài việc nháy hết bị cấm, KHÔNG thêm ký tự nào vào `SIMPLE_COMMAND`.
  Non-ASCII (từ khoá tiếng Nhật trong `--name`) vẫn bị chặn — guidance đã bắt dịch sang English
  keywords, giữ nguyên.
- **Một nguồn quyết định**: classifier ưu tiên ĐỌC lý do đã ghi (S1); heuristic chỉ còn là fallback
  cho transcript cũ, và được sửa cho đúng với gate CŨ (nháy = deny) vì toàn bộ hồ sơ cũ sinh ra
  dưới gate cũ.
- **Mọi phép thử gate đi qua `decide()`** (bài học §0), không bao giờ qua một hàm con.

## 4. Cơ chế — neo file:line (đã đọc tận nơi 2026-08-06)

- Charset + cấm nháy: `SIMPLE_COMMAND` [permission-gate.ts:155](../../apps/builder/server/hooks/permission-gate.ts);
  lý do cấm gốc (bypass `.e''nv`, spec 015 C2) ghi ở comment :150-154.
- Đường quyết định đầy đủ: `decide()` :481 — thứ tự `checkForbiddenPath` (:495, gồm
  `commandReferencesSecret` :407 tokenize whitespace + `commandReachesOutsideRepo` :380) RỒI MỚI
  `analyzeBashCommand` (:499-501).
- Transcript: `onEvent` bắt `tool_result` [run-transcript.ts:81-84](../../apps/builder/server/lib/run-transcript.ts)
  (chỉ giữ `!is_error`); render dòng call :134; parser nội bộ :176.
- Hai bộ đếm ngoài: [e2e_check.py:253-276](../../apps/builder/scripts/e2e_check.py) (`_denied_calls`);
  [campaign.py:241-273](../../apps/builder/scripts/campaign.py) (`_CALL_LINE`/`_METACHAR`/
  `_ALLOWED_PY`/`classify_failed_calls`).
- Guidance liên quan: `analyze.md:86-92` (intent pass E2b — lệnh có nháy);
  `implement.md` đã trỏ `references/error-strategy.yml` (085 S1c), `spec.md` chưa (F6).

## 5. Slices

### S1 — Transcript ghi lý do lỗi của tool-call (S, instrument — LÀM TRƯỚC)

`run-transcript.ts`: khi `tool_result.is_error`, trích dòng đầu của `block.content` (shape string
HOẶC mảng `{type:'text',text}` — xử lý cả hai), qua `redactSecrets`, cắt ≤160 ký tự, lưu vào
`call.err`. Render thành **dòng nối tiếp thụt lề** dưới dòng call:

```
- Bash  .venv/bin/python tools/dify_base/find.py --name "kw kw" --full  ✗
    ↳ command contains a shell metacharacter (chaining/redirect/subshell/pipe/expansion…)
```

**KHÔNG** đổi format dòng call (F8: hai parser ngoài anchor ✗ cuối dòng; dòng `↳` bắt đầu bằng
khoảng trắng nên `startswith("- ")` của cả hai bỏ qua nó — không double-count).
Test: (a) unit render với `content` dạng string và dạng mảng; (b) **parser-compat**: fixture
transcript format MỚI đi qua `e2e_check._denied_calls` và `campaign.classify_failed_calls` phải ra
đúng số như format cũ (khoá F8 vĩnh viễn); (c) reason có secret → bị redact.

### S2 — Gate: chuẩn hoá nháy rồi mới quyết (S — bộ test là F7, không viết lại từ trí nhớ)

Trong `decide()` nhánh Bash: `const decisionView = command.replace(/['"]/g, '')`; đưa
`decisionView` vào cả phần Bash của `checkForbiddenPath` lẫn `analyzeBashCommand`; message lỗi
tiếp tục trích `command` RAW. Comment tại `SIMPLE_COMMAND` cập nhật: lệnh cấm nháy được thay bằng
bất biến mạnh hơn — *mọi phép kiểm chạy trên chuỗi đã không còn nháy* (giả định :380-381 giờ đúng
theo cấu trúc); `.e''nv` → `.env` → secret-check bắt SỚM HƠN hôm nay.
Test `permission-gate.test.ts`: **nhúng nguyên văn 20 ca F7** (16 an toàn `deny` + 4 hợp lệ
`allow`) + K1 (giờ thành `allow`) + K2 (`deny` vĩnh viễn) — tất cả qua `decide()`. Các case cũ của
file test này giữ nguyên trừ case nào khoá trực tiếp "quote⇒deny" (sửa CÓ CHỦ ĐÍCH, dẫn spec này).

### S3 — Bộ đếm hết đoán (S — phụ thuộc S1)

`classify_failed_calls`: nếu dưới dòng ✗ có dòng `↳` → phân loại bằng **lý do thật** (bắt đầu
`command contains`/`python script not in`/`forbidden:`/`grep|rg|find is denied`… ⇒ `denied`; còn
lại ⇒ `errored`) — hết heuristic cho mọi run từ S1 trở đi. Transcript CŨ (không có `↳`): giữ
heuristic nhưng sửa cho khớp gate ĐÃ SINH RA chúng — thêm `'"` vào `_METACHAR` (toàn bộ hồ sơ cũ
nằm dưới gate cấm nháy nên nháy ⇒ denied là đúng hồi tố; comment ghi rõ ranh giới hai đường).
Test: fixture chép nguyên 5 dòng ✗ phase ① của bundle `1785928989748` (format cũ) → phải ra
`denied=4, errored=1` (đáp án đối chiếu tay F5); fixture format mới có `↳` → đếm theo lý do.

### S4 — `spec.md` trỏ worked-example error-strategy (XS, guidance — giết F6)

Một mục ngắn trong `spec.md` (mirror câu chữ `implement.md` đã có từ 085 S1c): cần quyết
fail-branch/error_strategy ở tầng SPEC → **Read đích danh
`.claude/skills/dify-build/references/error-strategy.yml`**, không grep, không săn. Oracle đo bằng
chính S1: re-fire prompt bundle → phase ② phải hết chuỗi `↳ …grep…`/săn error_strategy (11 → 0).

## 6. Validation (bắt buộc — dùng instrument S1, không dùng cảm nhận)

1. **Hiệu chuẩn trước khi đo** (§0): K1 deny trước S2 / allow sau S2; K2 deny cả trước lẫn sau.
   Nằm sẵn trong bộ test S2 — CI tự gác.
2. **Re-fire đúng prompt bundle** (`このワークフローに、実行結果TSVを…REPRO-TEST-090…`, from-scratch
   + không cần creds ngoài) sau S1+S2+S4, so với bundle gốc bằng transcript mới:
   - ①: `find.py --name "..."` **chạy được và có kết quả** (0 dòng `↳ …metacharacter…` cho nó);
   - ②: cuộc săn error_strategy biến mất (11 → 0 dòng ✗ thuộc lớp đó);
   - mọi ✗ còn lại **đều có dòng `↳` lý do** — từ nay không còn ✗ câm.
3. `classify_failed_calls` chạy trên run mới: phân loại theo lý do; chạy trên bundle cũ: ra đáp án
   đối chiếu tay (`denied=4/errored=1` cho ①).
4. Full suites server + web + pytest xanh; các entry e2e có `denied_calls_max` không được TĂNG
   (giảm là kỳ vọng — cap là max, giảm không phá baseline).

## 7. Guard / test phải xanh

- `permission-gate.test.ts` (20 ca F7 + K1/K2 + case cũ), test render + parser-compat S1,
  fixture-bundle S3, `tests/test_campaign.py` (classify hai đường).
- KHÔNG đụng: allow-set membership (không thêm/bớt script nào), READ/WRITE tool rules, orchestrator,
  phase-flow, linter set.
- Khi đóng spec: grep nghiệm thu `_METACHAR` có `'"`; `run-transcript` có `↳`; `spec.md` có
  `error-strategy.yml`.

## 8. Rủi ro đã biết

- **Strip đổi ngữ nghĩa token cho PHÉP KIỂM** (`a''b` → `ab`, `--name "a b"` → 2 token thay vì 1):
  chấp nhận — phép kiểm chỉ trả lời allow/deny trên charset/secret/path, mọi token sau strip đều
  lộ RA NHIỀU HƠN cho checker (không giấu được gì bằng nháy nữa); thi hành vẫn là chuỗi raw. Ca
  đối kháng đã nằm trong 16 ca an toàn (F7).
- **F7 là 20 ca, không phải chứng minh đầy đủ** — vì vậy K2 + 16 ca an toàn thành test vĩnh viễn,
  và §0 mời thêm ca đối kháng bất kỳ lúc nào; một ca mới lọt là thêm vào bộ test trước khi vá.
- **S3 hai đường phân loại** (reason-based vs legacy) là hai code-path — ranh giới bằng sự hiện
  diện của dòng `↳`, không bằng version/ngày, nên không cần metadata mới; comment nêu rõ để không
  ai "dọn dẹp" nhầm đường legacy khi hồ sơ cũ vẫn còn được đọc.
- **Reason có thể chứa đường dẫn nhạy cảm** → bắt buộc qua `redactSecrets` (test riêng).
- Số F2 là cận dưới — spec này KHÔNG hứa "giảm 47% denial"; lời hứa đo được duy nhất là §6.2
  (ca cụ thể của bundle) + từ nay có số thật để theo dõi.

## 9. Open questions

1. Ghi lý do vào `events.jsonl` (máy đọc trực tiếp, không qua parse transcript)? Mặc định đề xuất:
   CHƯA — transcript đủ cho mọi consumer hiện có; thêm event là đụng `RunEventKind` union + dossier
   switch (bài học 085 S0 ghi hai đầu), để khi có nhu cầu máy-đọc thật.
2. `_ALLOWED_PY`/`_ALLOWED_SIMPLE` của campaign.py về lâu dài nên sinh từ đâu để khỏi thành bản
   sao thứ ba của allow-set? (Sau S3, đường legacy sẽ teo dần theo hồ sơ cũ — có thể không đáng
   đầu tư. Ghi để người đóng spec quyết có mang sang CAMPAIGNS để-ngỏ không.)

## 10. Non-goals (KHÔNG làm trong spec này)

- **Không nới charset** ngoài nháy (non-ASCII/`*`/`$`/pipe… vẫn cấm nguyên trạng).
- **Không thêm cửa tìm-chữ mới** (shell `grep` vẫn cấm) — sau S2, cửa thay thế được tài-liệu-hoá
  (`find.py --name`) mới thật sự hoạt động; đo lại đã rồi mới bàn tiếp.
- **Không sửa hồi tố** số liệu/summary cũ trong CAMPAIGNS (denial-count cũ là cận dưới, đã ghi chú
  tại chỗ bằng spec này khi close).
- **Không đụng phần cắt cụt PROMPT/OUTPUT** của transcript (chỉ thêm dòng lý do cho tool-call ✗;
  cap arg hiện tại giữ nguyên — đổi nó là đụng format mà 2 parser ngoài đang match, rủi ro không
  tương xứng lợi ích khi lý do đã nói thay).
