# 104 — Chạm hạn mức không được làm mất một lượt chạy

> Trạng thái: **S1 + S3 ĐÃ SHIP** (2026-08-20) · **chỉ còn S2 CHẶN** ở phép kiểm thủ công §3.
> S3 gỡ được khoá bằng cách **đọc thẳng binary `claude` 2.1.222 trên đĩa** thay vì chờ ai đó chạm hạn
> mức — và nó ship **bất kể** câu ① trả lời thế nào, vì giờ cả hai đường chết đều được phân loại. Lập 2026-08-20 · **soát lại với code
> cùng ngày** — bản đầu bỏ sót rằng cơ chế nhắc-bật-chuông đã ship trong spec 088; S1 đã được viết lại
> thành delta trên nó (§3).
>
> **S1 landed:** `maybeNudgeAuto()` + khoá `notifyNudgeAutoDismissed` + `notifyNudgeKind`
> (`web/src/lib/notify.ts`), banner chọn chữ theo kind (`App.tsx`), `isUnattendedMode` nối vào `start()`
> và `patchConfirmMode` (`store.ts`), `notifyNudgeAutoText` EN+JA (`i18n.ts`). 7 test ở
> `notify.test.ts` + 3 ở `store.test.ts`; hai test lõi đã **kiểm đỏ-khi-revert** (bỏ khoá thứ hai → test
> "THE HOLE" đỏ; bỏ dismiss bất đối xứng → test "back to back" đỏ).
> Sinh ra từ câu hỏi: *"làm sao để các user khác nhau với các plan khác nhau vẫn dùng ổn định nhất
> có thể?"* — và câu trả lời hoá ra **không nằm ở cấu hình theo gói** (§4.1), mà ở **chất lượng của
> đường hỏng**: người dùng gói nhỏ không gặp lỗi *khác*, họ gặp **cùng lỗi đó thường xuyên hơn**.
> Phạm vi: **ba lỗ trên đường "chạm hạn mức".** S1 báo cho người đang không nhìn màn hình ·
> S2 nói khi nào thử lại được · S3 note hạn mức phải hiện trên **cả hai** đường chết.
> Không đụng ngưỡng reset (spec 100), không đụng đo mức tiêu thụ (spec 102) — xem §5.

---

## 1. Cái ĐÃ đúng — đừng dựng lại

Rà soát trước khi viết spec này, và phần khó nhất **đã có sẵn**. Ghi ra để không ai phí công:

| Đã có | Ở đâu |
|---|---|
| Phân loại lỗi hạn mức thành note đọc được: *"Claude CLI usage limit reached — builds cannot run until the limit resets"*, kèm dòng stderr gốc — **nhưng chỉ dòng KHỚP ĐẦU TIÊN, và chỉ trên đường chết không có result event** (xem S2, S3) | `classifyTurnFailure` — `turn-runner.ts:36-51` (spec 045 D2) |
| Note đó hiện ở gate, không phải "exit 1 / artifact missing" | `turn-runner.ts` · ask dùng lại cùng note (`ask.ts`) |
| Retry sau lỗi **giữ nguyên phase** — không làm lại từ đầu | `restoreTargetPhaseFor` — `server/state/task.ts` |
| **Auto mode HARD-STOP khi `error`** — không có bão retry đốt thêm hạn mức | `maybeAutoAdvance`: `if (task.status !== 'awaiting_confirm') return` |
| Chi phí từng lượt ghi trên đĩa, đi theo bundle export | `chat.jsonl` · `events.jsonl` `turn_cost` |
| **Banner "bật thông báo?" — ĐÃ CÓ ĐỦ BỘ (spec 088)**: signal + hàm hiện/tắt, khoá nhớ một-lần-mỗi-máy `localStorage['notifyNudgeDismissed']`, banner đã render, EN+JA đã có, **6 test đã xanh**. Bật chuông thành công tự tắt banner vĩnh viễn | `notify.ts:79-103` · `App.tsx:457-471` · `i18n.ts:83,585` · `notify.test.ts:162-202` |

`[ĐO code]` Cả sáu mục trên đều đọc-là-thấy. Dòng cuối là dòng bản đầu của spec này bỏ sót — và nó đổi
hẳn khối lượng của S1: từ "một tính năng" xuống "một quyết định + một khoá localStorage thứ hai".

---

## 2. Ba lỗ

### `[ĐO code]` S1 — một câu "không hiện lại" nói cho ngữ cảnh KHÁC bị mang sang auto mode

`notifyOn` khởi tạo `false`: nó chỉ bật khi `localStorage['notify'] === '1'` **và** trình duyệt còn
cấp quyền (`notify.ts:44-53`). Mặc định của một máy mới là **im lặng**.

Nhưng **"máy mới, auto mode, không ai báo" KHÔNG phải lỗ** — spec 088 đã vá: `maybeNudge()` được gọi
mỗi khi một build chuyển sang chạy (`store.ts:490`), banner hiện ra ngay build đầu tiên. Bản đầu của
spec này đã nhầm chỗ đó; §1 giờ ghi rõ.

Lỗ thật hẹp hơn, và nằm ở **khoá nhớ**:

- Banner nhắc **một lần cho mỗi máy**, nhớ bằng `localStorage['notifyNudgeDismissed']` (`notify.ts:79`).
- Trigger là *"một build đang chạy"* — thời điểm chuông **có ích**.
- Nhưng thời điểm chuông **cần thiết** là lúc bật auto mode: `confirmMode: 'auto'` chạy suốt ①→④ không
  dừng ở gate nào (`boundaryAutoAdvances`), người dùng đi làm việc khác.

Ghép lại:

```
build đầu (each step, đang ngồi xem)  →  banner hiện  →  bấm "không hiện lại"   ← hợp lý!
        …vài ngày sau…
bật auto mode  →  đi làm việc khác   →  chạm hạn mức  →  build chết
               →  KHÔNG có gì báo    →  quay lại sau 2 tiếng thấy một build hỏng
                                        không biết chết lúc nào, không biết limit reset chưa
```

Người dùng đã từ chối một lời mời **cho một ngữ cảnh khác** — và câu từ chối đó bị mang nguyên sang
ngữ cảnh mà họ chưa từng được hỏi. `notifyTransition` **có** bắn trên `status: 'error'`, nhưng chuông
vẫn tắt. Cơ chế đúng, **phạm vi của một khoá** sai cho đúng ca cần nó nhất.

**Vì sao đây là vấn đề của GÓI:** với gói lớn, chạm hạn mức là chuyện hiếm. Với gói nhỏ, đây là ca
**thường ngày**. Cùng một app, cùng một mặc định, hai trải nghiệm khác hẳn.

### `[GIẢ THUYẾT]` S2 — không biết khi nào thử lại được, nên thử mù

Note hiện tại gắn **một** dòng stderr nguyên văn. Nếu CLI có in thời điểm reset **trên đúng dòng đó**
thì nó nằm trong note — nhưng chôn giữa một dòng kỹ thuật, không thành hành động.

Hệ quả: người dùng bấm Retry, hỏng, đợi mơ hồ, bấm lại, hỏng. Không ai nói cho họ biết phải đợi bao lâu.

Thêm một chi tiết `[ĐO code]`: note chỉ gắn **dòng khớp đầu tiên** (`clean(m)`, `turn-runner.ts:46-51`),
không phải cả tail. Nếu CLI in thời điểm reset ở dòng KẾ, nó đã bị vứt trước khi UI kịp thấy — nên phép
kiểm §3 phải lưu `stderrTail()` **thô** (24 dòng / 2KB), không phải note đã qua `clean()`.

**Chưa kiểm** — chưa ai chạm hạn mức trên máy này, nên **không biết stderr thật in ra cái gì**. Đó là
phép kiểm chặn cửa của S2 (§3).

### `[ĐO code]` S3 — note hạn mức chỉ xuất hiện trên MỘT trong hai đường chết

`classifyTurnFailure` được gọi từ đúng hai chỗ (`turn-runner.ts:178`, `:192`), và cả hai đều là đường
"tiến trình chết". Đường result event thì thoát ngay ở dòng đầu:

```
session.onExit = (code) => { if (resultEvent) return; … }   // turn-runner.ts:176-178
```

Nếu CLI báo hạn mức bằng một terminal `result` event `is_error` **thay vì chết**, `turn.note` để
`undefined`, `failureCls` không được đặt, và note thân thiện *không bao giờ xuất hiện* — gate hiện thứ
`verifyPhase` nói. Cùng một sự kiện, hai chất lượng thông báo khác hẳn, tuỳ đường.

**`[ĐO binary]` 2026-08-20 — đọc `claude` 2.1.222:** result event cuối có **ba biến thể**, và biến thể
`success` mang `is_error` **cùng** `api_error_status`, còn `error_during_execution` mang `errors[]`:

```
subtype:"error_max_turns"        is_error:true
subtype:"error_during_execution" is_error:true   errors:[…]
subtype:"success"                is_error:_t     api_error_status: dt   ← lỗi API đi đường này
```

Builder **không đọc `api_error_status` ở đâu cả**. Nên đường này có thật, và nó câm.

Vẫn chưa kiểm được *một hạn mức thật* đi đường nào — nhưng **S3 không còn phụ thuộc câu hỏi đó**:
phân loại cả hai đường thì đường nào cũng nói được.

### `[ĐO binary]` S3b — bảng regex của spec 045 bỏ sót 5/6 tên cửa sổ hạn mức

Phát hiện khi viết test cho S3. CLI đặt tên cửa sổ từ một bảng cố định (`kNt`) rồi in
`You've used N% of your <window> · resets <time>`:

| `rateLimitType` | chữ in ra | regex 045 khớp? |
|---|---|---|
| `five_hour` | session limit | ✅ |
| `seven_day` | **weekly limit** | ❌ |
| `seven_day_opus` | Opus limit | ❌ |
| `seven_day_sonnet` | Sonnet limit | ❌ |
| `seven_day_overage_included` | Fable 5 limit | ❌ |
| `overage` | usage credit limit | ❌ |

Cạn hạn mức **tuần** — ca thường ngày của gói nhỏ — rơi vào ô ❌, tức **không có note trên CẢ HAI
đường**. Đây là lỗ độc lập với S1/S2/S3 và đã vá cùng S3.

---

## 3. Slices

### S1 — Nhắc LẠI đúng một lần nữa, ở lúc người dùng bật auto mode

**Đây là delta trên spec 088, không phải tính năng mới.** Dùng lại nguyên xi: banner
(`App.tsx:457-471`), `dismissNudge`, đường bật chuông trong `toggleNotify`, và **toàn bộ guard** của
`maybeNudge`. Chỉ thêm một khoá dismiss thứ hai và một câu chữ thứ hai.

`maybeNudgeAuto()` — gọi khi người dùng CHỌN `auto` (hoặc `spec_only`), từ hai chỗ: lúc tạo task
(`store.ts:1258`) và lúc đổi chip giữa chừng (`patchConfirmMode`, `store.ts:1804`).

- **Guard giống hệt `maybeNudge`**: chuông đang tắt (`!notifyOn`), trình duyệt hỗ trợ, và
  `Notification.permission === 'default'`. Hai ca `granted`-nhưng-toggle-off và `denied` vẫn **im
  lặng** — spec 088 đã cân nhắc và đóng chúng (denied có tooltip ở chuông giải thích), spec này
  **không mở lại**. Ghi ra để không ai tưởng là bỏ sót.
- **Khoá riêng**: `localStorage['notifyNudgeAutoDismissed']`. Một lần cho mỗi máy, độc lập với khoá cũ.
- **Câu chữ riêng**, nói đúng ngữ cảnh: *"Chế độ tự động chạy cả bốn bước mà không dừng lại. Bật thông
  báo để biết khi nó xong hoặc dừng giữa chừng?"* — EN + JA, đặt cạnh `notifyNudgeText` (`i18n.ts:83`,
  `:585`). Giọng phải là **"tài khoản này"**, không phải "build này" (§7 Q4).
- **Bật chuông thành công → tắt CẢ HAI khoá.** `toggleNotify` đang gọi `dismissNudge()`
  (`notify.ts:71`); mở rộng nó, nếu không banner auto sẽ mọc lại cho một người đã bật chuông rồi.

**Vì sao KHÔNG chỉ gọi lại `maybeNudge()` từ chỗ chọn auto:** khoá `notifyNudgeDismissed` đã bị đặt từ
build đầu tiên nên nó return ngay — đúng ca duy nhất cần vá thì không vá được. Giá phải trả cho khoá
thứ hai là hai khoá thay vì một; đổi lại, mỗi lời mời chỉ hỏi về **một** ngữ cảnh và bị từ chối riêng
cho ngữ cảnh đó.

- **Nhắc, không ép.** Bỏ qua vẫn chạy auto bình thường; auto mode không bị chặn.
- **Không đổi mặc định của chuông.** Quyền Notification phải do người dùng cấp trong một cử chỉ click —
  trình duyệt cũng không cho làm khác.

Vì sao chỗ nối là **lúc chọn auto** chứ không phải lúc build chết: lúc chết thì đã muộn, và đúng lúc
đó thì thứ họ cần là câu trả lời chứ không phải một lời mời bật chuông.

### S2 — Nói khi nào thử lại được  `[CHƯA KIỂM — chạy phép kiểm trước]`

**Phép kiểm chặn cửa, làm TRƯỚC khi thiết kế S2 *và* S3.** Lần tới có ai chạm hạn mức (hoặc ép chạm
bằng một tài khoản đã cạn), lưu lại **`session.stderrTail()` thô** (24 dòng / 2KB) *và* toàn bộ `result`
event cuối — **không phải** note đã qua `clean()`, vì `clean()` đã vứt mọi dòng trừ dòng khớp đầu tiên.

Ba câu hỏi, không phải một:

1. **Hạn mức đến qua đường nào?** Tiến trình chết không có result event, hay một `result{is_error}`?
   → quyết định **S3**.
2. **Có nằm trên stderr không?** Nếu chữ hạn mức chỉ nằm trong assistant text / result event thì
   `stderrTail` rỗng và không có gì để bóc — S2 phải đổi nguồn đọc, không chỉ đổi regex.
3. **Có in thời điểm/khoảng thời gian reset không?** → quyết định **S2**.

Ghi kết quả vào chính file này, kể cả (nhất là) khi nó giết một slice.

- **(3) Có** → bóc ra khỏi note và hiện thành *"thử lại sau HH:MM"* — **giờ địa phương**; nếu CLI in
  epoch/UTC thì phải quy đổi, đừng in thẳng (đã trả giá ở trigger schedule: mặc định UTC chứ không phải
  Asia/Tokyo).
- **(3) Không** → S2 **chết**, ghi kết quả vào đây và đóng lại. Đừng bịa một khoảng chờ: đoán sai theo
  chiều ngắn thì vô dụng, theo chiều dài thì chặn người ta khỏi thứ họ đã có quyền dùng.

**Nút Retry: cảnh báo, KHÔNG `disabled` cứng.** Hạn mức là của *tài khoản* (§7 Q4) nhưng thời điểm reset
lại bị chôn trong note của *một task*. Reset sớm, đổi tài khoản, hay chuyển sang API-key auth → một nút
xám chặn đúng một hành động hợp lệ. Hiện dòng "thử lại sau HH:MM" cạnh nút và **để nút bấm được**
(`Chat.tsx:445`). Retry mù biến mất vì người ta biết phải đợi, không vì bị khoá tay.

**Đổi câu note ⇒ sửa frame JA CÙNG LÚC.** `turn-runner.ts:32-34` ghi rõ: các mẫu note EN là
WORDING-STABLE vì `NOTE_JA` (`i18n.ts:1086`) khớp theo tiền tố. Sửa EN mà quên JA = mất bản dịch trong
im lặng, đúng loại hỏng không test nào hiện có bắt được.

**Không** parse để đổi hành vi tự động (không auto-retry theo giờ). Chỉ hiển thị. Một vòng tự thử lại
là đúng thứ đang đốt hạn mức của người ta.

### S3 — Note hạn mức phải hiện trên CẢ HAI đường chết  `[ĐÃ SHIP]`

Không chờ phép kiểm nữa: làm **cả hai đường**, nên câu ① trả lời thế nào cũng đúng.

- `classifyResultFailure(result, stderrTail)` — cùng bảng signature với `classifyTurnFailure`, để một
  nguyên nhân đọc lên **giống hệt nhau** dù CLI chết kiểu gì. Bảng được tách ra dùng chung, câu chữ
  note không đổi một byte (frame JA an toàn).
- Chỉ đọc **carrier do máy sinh** — `subtype`, `api_error_status`, `errors[]` — cộng stderr ring.
  **Không** đọc text trả lời của model: trong repo mà build *viết về* hạn mức, làm thế sẽ khiến một
  build đang bàn về spec 104 tự khai là đã chạm hạn mức.
- **Trả `null` khi không khớp gì cụ thể** — không có fallback. Fallback của `classifyTurnFailure` nói
  "process exited…", ở đây là nói dối; và trên đường này một cái note **không miễn phí**:

**⚠ Ràng buộc chịu lực — giải thích KHÔNG được biến thành phán quyết.** `resolveImplementOutcome` biến
*mọi* note không-phải-timeout thành hard error → vứt artifact → rebuild toàn phần. Trước S3 đường này
không có note nên một hạn mức rơi trúng artifact sạch **vẫn ship**. Gắn note một cách ngây thơ sẽ bắt
đúng người vừa cạn quota trả giá một lượt rebuild — **đúng cái spec 104 sinh ra để chặn**.

Nên `TurnResult.noteAdvisory` đánh dấu note đến từ result event, và `resolveImplementOutcome` bỏ qua nó
khi định tuyến. Giữ nguyên hợp đồng của spec 045: *phân loại là mỹ phẩm, không bao giờ đổi routing.*
S3 đổi **thứ người dùng được kể**, không đổi **thứ build làm**.

---

## 4. Non-goals

- **Không** đụng `ASK_RESET_TOKENS` hay logic reset — spec 100 (và U1 đang làm).
- **Không** đo/hiển thị mức tiêu thụ tích luỹ — spec 102 S1.
- **Không** auto-retry, không hàng đợi, không tự lên lịch chạy lại khi limit reset.
- **Không** đổi mặc định chuông thành bật.
- **Không** chặn auto mode.
- **Không** mở lại hai ca `permission` mà spec 088 đã cố ý đóng (`granted`-nhưng-toggle-off và
  `denied`) — S1 dùng đúng bộ guard cũ, chỉ thêm khoá dismiss thứ hai.
- **Không** dựng banner/chỗ hiển thị mới — dùng lại banner 088 (§7 Q1 đã đóng).

### §4.1 ĐÃ LOẠI: cấu hình theo gói (`subscriptionType`)

Đề xuất tự nhiên là *"Max thì để thoáng, Pro thì để chặt"*. **Loại**, và ghi lại ba lý do vì nó sẽ
được đề xuất lại:

**① App KHÔNG đọc được hạn mức còn lại.** `[ĐO]` `claude --help` không có lệnh nào về
`usage`/`limit`/`quota`; `claude auth status --json` chỉ trả `loggedIn`, `authMethod`, `apiProvider`,
`subscriptionType` (+ email/org). Biết gói **không** đồng nghĩa biết còn bao nhiêu.

**② Con số sẽ là bịa và sẽ mục trong im lặng.** Hạn mức Pro/Max diễn đạt theo **cửa sổ thời gian**,
không theo token, và thay đổi theo thời gian. Một bảng `pro = X token` không ai kiểm chứng được và
không có gì báo khi nó sai — đúng loại hằng số mà spec 100 vừa phải sửa.

**③ Chiều thì ngược.** Hạ ngưỡng reset cho gói nhỏ → reset nhiều hơn → model đọc lại `main.yml`
(~400k token mỗi lần, `[ĐO]` spec 100) → **cạn nhanh hơn**. Vật lý không đổi theo gói.

⇒ `subscriptionType` chỉ nên dùng để **gắn nhãn cho trung thực** (spec 102 S3), không để **đặt chính
sách**. Và cái làm được thay cho việc đoán ngân sách: **đo chính người đó** — spec 102 S1.

---

## 5. Quan hệ với các spec khác

Ba spec cùng chạm "người dùng gói nhỏ", **không chồng nhau** — mỗi cái một tầng:

| | Trả lời câu hỏi nào |
|---|---|
| **[100](100-ask-session-reset-doom-loop.md)** (+U1) | *Tiêu ít đi được không?* — mỗi reset tránh được là ~400k token không bị đốt để đọc lại. **Đòn mạnh nhất cho gói nhỏ**, và đang được implement |
| **[102](102-usage-visible-before-it-surprises.md)** | *Thấy trước khi nó cắn được không?* — mức tiêu thụ tích luỹ, đơn vị đúng theo `authMethod` |
| **104** (đây) | *Khi đã cắn rồi thì có mất việc không?* — biết ngay, và biết khi nào thử lại |

Nếu chỉ làm được **một**: **100/U1**. Nó giảm tần suất chạm hạn mức, tức làm ba tầng còn lại ít
quan trọng đi. 104 là tầng cuối — nó không ngăn được va chạm, chỉ làm va chạm rẻ đi.

---

## 6. Nghiệm thu

Test phải **đỏ-khi-revert-fix**.

> ⚠️ **Cả BỐN file test dưới đây ĐÃ TỒN TẠI — `append`, đừng `Write` đè.** Kiểm 2026-08-20:
> `web/src/lib/notify.test.ts`, `web/src/store.test.ts`, frame JA nằm ở
> **`web/src/lib/notes-i18n.test.ts`** (không phải `i18n.test.ts`), và file phân loại lỗi tên là
> **`test/turn-failure-triage.test.ts`** (không phải `turn-failure.test.ts`). Bài học đã trả giá: một
> file test 49 dòng từng bị ghi đè vì tin chữ "(mới)" trong plan, và **suite vẫn xanh** — 7 test biến
> mất mà tổng số vẫn tăng. `ls` trước khi tạo.
>
> ⚠️ **Riêng `notify.test.ts` đã có sẵn `describe('maybeNudge — the enable-notifications banner')` với
> 6 test** (`:162-202`). Test của S1 là một `describe` MỚI đặt cạnh, không phải sửa vào đó. Và test
> "lời nhắc không tự bật chuông" của bản đầu **đã xanh sẵn** trong block cũ (`toggleNotify` mới là chỗ
> xin quyền) — đã bỏ khỏi bảng, đừng viết lại.

| # | Slice | Test | Ở đâu |
|---|---|---|---|
| 1 | S1 | **Đây là test của chính lỗ S1:** `notifyNudgeDismissed === '1'` (đã bấm "không hiện lại" cho banner cũ) → chọn `auto` **vẫn** nhắc. Hai khoá độc lập | `web/src/lib/notify.test.ts` |
| 2 | S1 | Chọn `auto` khi chuông tắt + `permission === 'default'` → nhắc **đúng một lần**; chọn `auto` lần nữa → **không** nhắc lại | như trên |
| 3 | S1 | `notifyOn === true` → không nhắc. `permission !== 'default'` (`granted`-nhưng-off, `denied`) → **không** nhắc — giữ nguyên quyết định 088 | như trên |
| 4 | S1 | Bật chuông từ banner auto → tắt **cả hai** khoá; chọn `auto` lại → im lặng | như trên |
| 5 | S1 | **Regression**: bỏ qua lời nhắc → auto mode vẫn chạy bình thường, không bị chặn | `web/src/store.test.ts` |
| 6 | S2+S3 | `[CHẶN CỬA]` ba câu hỏi §3: đường nào? có trên stderr không? có thời điểm reset không? — lưu `stderrTail()` thô **và** result event | thủ công, một lần |
| 7 | S2 | Nếu (3) có: bóc đúng thời điểm **và quy đổi đúng giờ địa phương**; stderr **không** có → note giữ nguyên như hôm nay, không bịa | `test/turn-failure-triage.test.ts` |
| 8 | S2 | Nếu đổi câu note EN: frame `NOTE_JA` khớp lại được (note vẫn ra tiếng Nhật, không rơi về EN) | `web/src/lib/notes-i18n.test.ts` |
| 9 | S3 | ✅ `result{is_error}` mang chữ hạn mức → **đúng** note `usage_limit`, giống hệt đường exit; result **thành công** không bao giờ đeo note; không khớp gì → note `undefined` như trước S3; prose của model không bao giờ bị phân loại | `test/turn-failure-triage.test.ts` |
| 10 | S3 | ✅ **Chịu lực**: note advisory + artifact sạch → `success` (y như trước S3); **cùng** note đó từ đường exit vẫn hard error; advisory không tẩy trắng artifact hỏng / vi phạm confinement | như trên |
| 11 | S3b | ✅ **cả sáu** tên cửa sổ đo từ `kNt` đều phân loại `usage_limit`, trên **cả hai** đường | như trên |

**Nghiệm thu tay `[CHƯA CHẠY]`:** trên một máy đã bấm "không hiện lại" cho banner cũ và chuông đang tắt
→ bật auto mode → thấy nhắc; bỏ qua → build vẫn chạy; chọn auto lần hai → im lặng.
Cần một profile trình duyệt có `Notification.permission === 'default'` — profile dùng để soát 2026-08-20
đang ở `denied`, nên đường thật chưa được bắn lần nào; test 1–5 là thứ duy nhất đang chống lưng S1.

---

## 7. Open questions

1. ~~**Lời nhắc S1 nên xuất hiện ở đâu?**~~ **ĐÃ ĐÓNG** — banner trượt xuống dưới header đã tồn tại
   (`App.tsx:457-471`, spec 088) và không đụng hàng chip `nowrap` của composer. Dùng lại nó, đừng dựng
   chỗ mới.
2. ~~**`spec_only` có tính là "không người trông" không?**~~ **ĐÃ ĐÓNG — có.** Bản implement chốt theo
   hướng đã nghiêng: `isUnattendedMode` (`store.ts`) nhận `auto`, `spec only`, và alias `at spec only`
   mà `confirmModeWire` cũng nhận. Lý do giữ nguyên: ①→② vẫn có thể chết giữa chừng. Cùng một câu chữ
   cho cả hai — mức khẩn thấp hơn không đáng một biến thể chữ thứ ba.
3. **Còn ca "chạm hạn mức giữa một lượt ASK"?** Note đã đúng, và ask ngắn hơn phase nên mất mát nhỏ
   hơn. Chưa thấy lý do làm gì thêm; ghi lại để không tưởng là bỏ sót.
4. **Hạn mức là của TÀI KHOẢN, không của task** — chạm khi build cũng chặn ask và ngược lại. Không có
   gì để sửa, nhưng lời nhắc/thông báo nên nói theo giọng đó ("tài khoản này"), không phải giọng
   "build này".
