# Spec 107 — Một hội thoại dựng lại từ đĩa phải giữ LỜI CỦA NGƯỜI DÙNG

> **Status**: **mở**, chưa implement. Lập 2026-08-21, từ ca thật của user trên build
> `1787244501931`: ba câu "Request changes" biến mất khỏi UI trong khi cả ba **nằm nguyên trên đĩa**.
>
> Phạm vi — **đường ĐỌC LẠI hội thoại của một build**. Bốn lát:
> **S1** xen kẽ tin nhắn người dùng vào bản dựng lại ·
> **S2** bản dựng lại phải nói vòng nào bị bỏ ·
> **S3** tab thụ động ngừng ghi đè trên đường **KHÔNG-ask** ·
> **S4** một dòng timeline khi UI phải dựng lại từ đĩa.
> **Thứ tự ship: S1 → S4 → S2 → S3** (§5 giải thích vì sao S3 xếp cuối dù nó rẻ nhất).
>
> **Không chạm**: đường GHI — `chat.jsonl` / `events.jsonl` / `runs.jsonl` giữ nguyên định dạng,
> **không thêm một writer nào** · `recoverOpenAsk` · `lastAsk` · backfill ask của 099 ·
> quyền sở hữu hội thoại (bất biến D6 của spec 033) · lưu trữ sang DB — xem §7.
>
> Liên quan: [099](099-build-ask-history-survives-the-browser.md) bịt **đúng lỗ này nhưng chỉ cho ASK** ·
> [101 §1②](101-tester-release-plan.md) — kết luận của nó **phải thu hẹp**, xem §3.3 ·
> [103](103-spec-stays-true-through-the-fix-loop.md) sinh ra các sự kiện kết cục mà S2 dùng.

---

## 0. Nguyên tắc

Kế thừa nguyên trạng 6 nguyên tắc của [099 §2](099-build-ask-history-survives-the-browser.md). Ca này
sinh thêm đúng một cái, và nó là cái đắt nhất trong file:

> **7. Bản dựng lại THIẾU thì chấp nhận được; bản dựng lại GÂY HIỂU NHẦM thì không.**
>
> 099 §2.3 đã nói "trung thực và thiếu hơn đầy đủ và bịa". Nguyên tắc 7 là vế còn lại của nó: một bản
> dựng lại vẽ ba lượt ②仕様 **giống hệt nhau** trong khi hai trong ba đã bị vứt bỏ thì không phải
> "thiếu" — nó đang kể sai một câu chuyện có thật. Thiếu thì người đọc biết mình thiếu; hiểu nhầm thì không.

---

## 1. Sự cố

### 1.1 Một câu

Đĩa giữ đủ hội thoại; đường đọc lại chỉ đọc **một phần ba** số bản ghi, nên mỗi lần cache trình duyệt
hụt, người dùng mất đúng phần **họ tự gõ**.

### 1.2 `[ĐO]` Bằng chứng

Nguồn: `apps/builder/.runs/1787244501931/` trên máy tác giả, đọc 2026-08-21.

| Nhãn | Sự việc |
|---|---|
| `[ĐO]` | Run dir **không có `chat.jsonl`** — build này chưa từng dùng nút Ask. Thứ mất là **fix request gõ ở gate ④**, ghi trong `events.jsonl` dưới kind `request_changes`: `01:53:38` 「エラー時のメッセージを日本語にして」 · `02:10:39`「thêm 1 node chuyển output từ llm sang markdown dc ko」 · `07:57:36`「fix thêm check input xem có kí tự chũ hoa ko giùm với」 |
| `[ĐO code]` | `appendChat` — **writer duy nhất** của `chat.jsonl` — chỉ được gọi từ `ask.ts` ([:1145](../../apps/builder/server/lib/ask.ts:1145) và đường consult). Fix request **không bao giờ** chạm file đó ⇒ backfill của 099 về mặt kiến tạo không thể cứu ca này |
| `[ĐO code]` | `buildThreadFromRuns` map **thuần `t.runs`** ([store.ts:1968](../../apps/builder/web/src/store.ts:1968)) — không có chỗ nào cho lời người dùng. Đây là mắt xích cuối của chuỗi khôi phục ([store.ts:2018](../../apps/builder/web/src/store.ts:2018)) |
| `[ĐO code]` | Không một đường nào **xoá** item `user` khỏi thread: `hydrateForReopen` chỉ lọc gate chưa resolve ([thread-persist.ts:81](../../apps/builder/web/src/lib/thread-persist.ts:81)); `parseThread` chỉ đòi `id`+`kind`; renderer luôn vẽ item `user` ([App.tsx:672](../../apps/builder/web/src/components/App.tsx:672)). ⇒ bong bóng biến mất **chỉ có thể** do thread bị thay nguyên khối |
| `[ĐO]` | 4 run item trong ảnh khớp **chính xác** 4 dòng đầu `runs.jsonl`: 6/17/10/8 turns · $0.407 / $0.898 / $0.586 / $0.448 |
| `[ĐO code]` | `runs[].ts` và `replies` (sự kiện) **đều mang mốc thời gian** ⇒ phép xen kẽ là **chính xác**, không phải phỏng đoán. Đây là khác biệt cốt lõi với ask-backfill của 099, vốn phải nối đuôi kèm marker vì thread item không mang `ts` |
| `[ĐO]` | Timeline có `clients=2` **hai lần** (02:00:04 và 02:16:53) ⇒ đa tab là có thật trong phiên này |
| `[ĐO code]` | `emit` broadcast `task:update` ở **MỌI** transition ([orchestrator-shared.ts:143](../../apps/builder/server/lib/orchestrator-shared.ts:143)), còn `applyTask` vẫn kết bằng `thread.value = items` **vô điều kiện** ([store.ts:578](../../apps/builder/web/src/store.ts:578)), và effect persist subscribe cả hai signal ([store.ts:1011](../../apps/builder/web/src/store.ts:1011)) |
| `[ĐO code]` | **Không tồn tại bất kỳ phối hợp đa tab nào** trong `web/src`: không `BroadcastChannel`, không listener `storage`, không leader election. Mọi tab ghi cùng một key, last-write-wins |
| `[ĐO code]` | Cảm biến `history_gap` chỉ bắn khi `have !== servable` ([tasks.ts:494](../../apps/builder/server/routes/tasks.ts:494)). Build không có ask ⇒ `0 !== 0` sai ⇒ **im lặng tuyệt đối**. Không một byte nào trên đĩa nói "trình duyệt vừa mất cache" |
| `[ĐO code]` | `logEvent` collapse xuống một dòng (`⏎`) và **cắt ở 2.000 ký tự** ([run-events.ts:111](../../apps/builder/server/lib/run-events.ts:111)) ⇒ bản khôi phục là bản **hao hụt**, phải tự khai |

### 1.3 `[ĐO]` Cách ghim thời điểm ảnh chụp — và vì sao nó đóng lại mọi giả thuyết khác

Card cuối trong ảnh mang footer `✓ 修正を依頼済み`. Nhãn đó **chỉ** do `optimisticAdvance` đặt, gọi từ
`reply()` với mặc định `'Requested changes'` ([store.ts:1642](../../apps/builder/web/src/store.ts:1642));
`resolveLabel` ([store.ts:399](../../apps/builder/web/src/store.ts:399)) không bao giờ sinh ra chuỗi
đó, server cũng không. Footer render ở [Chat.tsx:661](../../apps/builder/web/src/components/Chat.tsx:661).

Cộng với **đúng 4 run item** (§1.2) ⇒ ảnh chụp ngay sau cú gửi fix request **#3 lúc 07:57:36**; bong
bóng vừa gõ nằm dưới mép ảnh.

Điều đó loại nốt giả thuyết "đây là tab thụ động": một tab thụ động nhận `task:update` sẽ có **gate
card xen giữa các run** (nhánh gate của `applyTask` đẩy card ở mỗi lần park). Bốn run item **liền
nhau, không một card nào ở giữa** là chữ ký **duy nhất** của `buildThreadFromRuns`.

> **Đính chính có chủ đích:** bản phân tích đầu tiên (cùng ngày) đoán ảnh chụp lúc ~02:20 và không
> giải thích được footer `修正を依頼済み`. Chính chi tiết không khớp đó mới ghim được thời điểm. Ghi
> lại vì nó là ví dụ đúng của luật 099: **thứ không khớp là dữ liệu, không phải nhiễu**.

### 1.4 Cái **CHƯA** chốt — và ràng buộc nó đặt lên spec này

**Vì sao localStorage rỗng lúc 07:56 thì không suy ra được từ đĩa.** Đã loại được ba nghi can bằng
`[ĐO code]`: port cố định 4123 không có fallback ([index.ts:82](../../apps/builder/server/index.ts:82))
nên restart không đổi origin; canonical-host redirect đã ship 2026-08-20; không có `persist_failed`
nào được báo. Còn lại: clobber đa tab, quota, hoặc profile/cửa sổ khác — `[GIẢ THUYẾT]`, cả ba.

> ⚠️ **Ràng buộc: KHÔNG lát nào trong spec này được xây trên giả thuyết đó.** S1/S2/S4 đúng với *mọi*
> lý do khiến cache hụt (đó chính là lập luận đã giữ 099 S1 đứng vững qua hai lần lật chẩn đoán).
> S3 được biện minh **độc lập** bằng `[ĐO code]` của chính nó (§4.4) — **không** bằng "nó gây ra ca này".

Phép đo còn nợ, chạy trong DevTools của tab đang mở build đó:

```
Object.keys(localStorage).filter(k=>k.startsWith('builder.thread')).map(k=>[k,localStorage[k].length])
```

---

## 2. `[REPRO]` Tất định, đi qua entry-point thật

Không phụ thuộc nguyên nhân mất cache là gì — đúng yêu cầu "phép thử đi qua entry-point thật"
(`openTask`), không qua hàm con.

```
1. Mở một build đã có ≥1 lượt "Request changes" (ví dụ 1787244501931).
2. DevTools Console:  localStorage.removeItem('builder.thread.<taskId>')
3. Mở lại build đó (chọn ở sidebar, hoặc F5).
   → HIỆN TẠI (bug): thread = requirement + các run item, KHÔNG một tin nhắn nào của bạn,
     và ba lượt ②仕様 trông giống hệt nhau dù hai trong ba đã bị vứt.
   → SAU S1: tin nhắn hiện lại, đúng vị trí trước lượt nó gây ra.
   → SAU S2: hai lượt bị vứt tự nói ra là đã bị vứt.
```

Đối chiếu đĩa (đây là bản gốc mà UI phải khớp):

```bash
jq -r 'select(.kind=="request_changes" or .kind=="retry") | "\(.ts)  \(.detail)"' apps/builder/.runs/<taskId>/events.jsonl
```

---

## 3. Chẩn đoán

### 3.1 Cái smell thật: ba bản ghi chồng lấn, không bộ đọc nào gộp

Một cuộc hội thoại của build bị chẻ làm ba, cộng một bản đã dựng trong trình duyệt:

| Bản ghi | Giữ gì | Ai đọc lại |
|---|---|---|
| `chat.jsonl` | Q&A của Ask | `backfillAskHistory` (099) |
| `events.jsonl` | **fix request + retry + kết cục từng vòng** | **không ai** (chỉ dossier render ra `summary.md`) |
| `runs.jsonl` | output từng lượt phase | `buildThreadFromRuns` |
| localStorage | bản đã dựng, đủ cả ba | `loadPersistedThread` |

**Mỗi đường khôi phục đọc một tập con khác nhau, và không đường nào gộp.** Đó là thứ đẻ ra bug hôm
nay *và* bug 099 — cùng một hình dạng, hai lần.

Đáng chú ý: **server đã biết gộp rồi.** [dossier.ts:56](../../apps/builder/server/lib/dossier.ts:56)
render `## Flow — what happened, in order` từ đúng timeline đó. S1 không phải đường ống mới; nó là
chĩa một năng lực đã có sang đúng hướng.

### 3.2 Vì sao 099 không cứu được — và vì sao đó **không** phải lỗi của 099

099 chọn `chat.jsonl` vì nó điều tra một ca **mất lịch sử ASK**, và nó cố ý **không mở rộng bề mặt
ghi** (nguyên tắc 4). Cả hai quyết định đều đúng. Cái sót là một câu chưa ai nói ra:

> Hội thoại của một build **không chỉ có ask**. Nó còn có mọi câu người dùng gõ ở gate.

### 3.3 Kết luận của [101 §1②](101-tester-release-plan.md) phải **thu hẹp** — mảnh đắt nhất của §3

101 hỏi: *"sau khi `applyAskDone` ngừng ghi, có đường nào khác khiến tab thụ động vẫn ghi đè không?"*
rồi liệt kê broadcast và kết luận: **"Tab thụ động không phát ra một lượt ghi nào."**

`[ĐO code]` Kết luận đó **đúng trong làn ask** và **sai ngoài nó**, vì hai lý do đọc-là-thấy:

1. Phép liệt kê chỉ quét **`tasks.ts`**. Nguồn `task:update` chính của hệ — `emit` ở
   [orchestrator-shared.ts:143](../../apps/builder/server/lib/orchestrator-shared.ts:143), bắn ở
   **mọi** transition của **mọi** phase — **không có trong danh sách**.
2. 101 *có* thấy `/reply` broadcast, nhưng gạt đi bằng lý do đúng cho câu hỏi của nó
   (*"không nằm trên đường ask bình thường"*). Vấn đề là **kết luận được viết ở dạng phổ quát**, còn
   lập luận thì có điều kiện.

⇒ Test canh cửa mà 101 dựng (`test/ask.test.ts` → `describe('build ask paths never broadcast task:update')`)
**vẫn xanh** trong khi lỗ này mở, vì nó canh đúng cái cửa nó tuyên bố canh. **Nó không hỏng; nó chỉ
không phủ.** S3 cần test riêng, ở phía web.

---

## 4. Thiết kế

### 4.1 `[ĐO]` Một quyết định **đổi** so với đề xuất ban đầu — và số đo là lý do

Đề xuất miệng lượt trước là route mới `GET /api/tasks/:id/thread` trả về thread đã lắp sẵn. **Bỏ.**
Hai lý do, lý do thứ hai mới là lý do thật:

1. Nó buộc **server phải biết model UI** (`LiveThreadItem`) — một khớp nối kiến trúc trả trước cho
   một quyết định (lật D6) **chưa hề được chốt**.
2. `buildThreadFromRuns` chạy **đồng bộ** trong `openTask`. Lấy dữ liệu qua route thứ hai buộc phép
   sửa thành **bất đồng bộ**, tức phải viết lại đúng hai guard mà 099 S1 đã phải viết (thread đã
   trôi / task đã đổi), **cộng** một lần dựng lại thread ngay trước mắt người đang nhìn.

Thay bằng: **một trường `replies` bounded trên chính `GET /api/tasks/:id`**, xen kẽ đồng bộ ở client.

Nhưng route đó là **route nóng** — re-fetch ở mọi lần reconnect SSE — và
[099 nguyên tắc 5](099-build-ask-history-survives-the-browser.md) cấm nhồi thêm trọng lượng vào nó.
Nên phải **đo**, không được ước lượng. Đo toàn bộ 57 run trên máy tác giả:

| Số đo | Giá trị |
|---|---|
| Task có tin nhắn người dùng | **7 / 57** |
| Payload `replies` **xấu nhất** | **4.688 ký tự** (task `1786505684286`, 25 tin nhắn, 1 tin chạm trần 2.000) |
| Payload `replies` trung vị | **383 ký tự** |
| Ngân sách `runs` **đã** nằm sẵn trên cùng route đó | **48.000 ký tự** ([run-transcript.ts:297](../../apps/builder/server/lib/run-transcript.ts:297)) |

⇒ Ca xấu nhất quan sát được là **~10 %** của thứ route này đã chở. Nguyên tắc 5 sinh ra để chặn 267 KB
transcript, không phải 4,7 KB. **Nhưng lập luận này chỉ đứng nếu có trần** — nên `replies` có ngân
sách riêng và **cùng thuật toán cắt** với `readRunAttempts` (§4.2).

> Non-goal đi kèm, ghi ra để lần sau không phải cãi lại: **`chat` vẫn KHÔNG được lên route này.** Nó
> là thứ 099 đã đo và đã từ chối, và không có số đo mới nào.

### 4.2 S1 — xen kẽ tin nhắn người dùng vào bản dựng lại

**Server** — `run-events.ts` (nó sở hữu `events.jsonl`):

```ts
export async function readUserMessages(
  runDir: string, opts?: { maxTotalChars?: number }
): Promise<{ replies: { ts: number; phase?: string; text: string }[]; dropped: number }>
```

- Nhận `request_changes` và `retry`, **chỉ khi có `detail`** — một Retry không kèm chữ là một cú bấm
  nút, không phải một câu nói; dựng nó thành bong bóng là bịa.
- Ngân sách mặc định **8.000 ký tự**, giữ **mới nhất**, đúng thuật toán `readRunAttempts`
  ([run-transcript.ts:293](../../apps/builder/server/lib/run-transcript.ts:293)) — hai bên cắt cùng
  kiểu thì `dropped` hai bên đọc được cùng cách.
- File thiếu / dòng rách ⇒ `[]`, theo hợp đồng sẵn có của `readEvents`.

**Route** — [tasks.ts:441](../../apps/builder/server/routes/tasks.ts:441):

> ⚠️ **Điều kiện của toàn bộ lập luận "không thêm IO": dùng CHUNG một lần đọc `readEvents`** với
> `runCosts`. Gọi hai lần là tự tay biến một fix rẻ thành một fix đắt, **và không ai nhìn thấy** —
> nên §6 có một test đếm lời gọi, không phải một lời hứa.

`...(replies.length ? { replies, ...(repliesDropped ? { repliesDropped } : {}) } : {})`, và **bỏ qua
với `kind === 'consult'`** y hệt `runs` đang làm.

**Client** — module **THUẦN**, mới: `web/src/lib/run-thread.ts` (`[ĐO]` đã `ls`: chưa tồn tại).

```ts
export function threadFromRuns(t: WireTask, opts: { uid: () => string; tr: (k: string) => string }): LiveThreadItem[]
```

- Trộn `t.runs` và `t.replies`, **sort tăng dần theo `ts`**.
- `[ĐO code]` **Luật ghép đúng nhân quả, không cần luật riêng**: `runs[].ts` là mốc **hoàn thành**
  lượt (`AttemptRecorder.flush` sau turn — kiểm trên run thật: `runs[0].ts = 1787244572882` vs
  `turn_cost.ts = 1787244572883`), còn `replies[].ts` là mốc **gửi**. Một câu gửi lúc T sinh ra lượt
  kết thúc lúc T′ > T ⇒ sort tăng dần **tự đặt câu nói trước lượt nó gây ra**.
- **Tin nhắn cũ hơn lượt cũ nhất còn giữ thì GIỮ**, đặt phía trên notice `runsDropped`. Lý do: lời
  người dùng không bị cắt bởi ngân sách của `runs`; cắt nó ở đây là mất dữ liệu **lần thứ hai**.
  `[ĐO]` Ca này có thật: task `1786505684286` có **25 tin nhắn / 8 lượt** còn giữ.
- **Không đụng `loadPersistedThread`.** Cache còn thì cache thắng, y như hôm nay. Đây là đường **dự
  phòng**, không phải đường chính.
- Marker tự khai đi qua `tr` — `store.ts` đã import sẵn (`import { t as tr }`,
  [store.ts:16](../../apps/builder/web/src/store.ts:16)) — **inject vào module thuần**, đúng thủ pháp
  `uid` mà `BackfillOpts` của ask-backfill đã dùng, để module vẫn assert được.

**Marker phải tự khai đúng hai hao hụt** (nguyên tắc 3 + 099 §2.6 "dấu vết máy đọc được"):

1. văn bản đã bị collapse một dòng + cắt 2.000 ký tự ([run-events.ts:111](../../apps/builder/server/lib/run-events.ts:111));
2. **file đính kèm của tin nhắn không có trên timeline** ⇒ bản dựng lại không có chúng.

### 4.3 S2 — bản dựng lại phải nói vòng nào bị bỏ

`[ĐO]` Trên `1787244501931`: **3 lượt ②仕様, 2 bị `drop_spec`** (02:00:07 và 02:17:04), chỉ lượt thứ ba
được `apply_spec`. Bản dựng lại vẽ cả ba giống hệt nhau ⇒ vi phạm nguyên tắc 7.

Tập sự kiện kết cục: `spec_proposal_dropped` · `spec_proposal_applied` · `artifact_unchanged` ·
`spec_stale` · `fix_undone` — tất cả đã tồn tại, tất cả đã ride bundle export.

**Luật ghép — đơn điệu, không có số học cửa sổ:**

> Duyệt sự kiện theo thứ tự; mỗi sự kiện kết cục gắn vào **lượt gần nhất TRƯỚC nó** (cùng `phase` khi
> sự kiện có mang `phase`; `fix_undone` gắn vào lượt gần nhất bất kể phase — nó hoàn tác cả vòng).

`[ĐO]` **Luật "cửa sổ tới `phase_start` kế tiếp" đã bị loại sau khi đo, không phải theo cảm tính:**
trên run thật, `spec_proposal_applied` xảy ra ở `1787267559376` còn `phase_start` kế tiếp ở
`1787267559379` — **cách nhau 3 ms**. Một luật đúng nhờ 3 ms là một luật đang chờ hỏng. Luật đơn điệu
ở trên cho cùng kết quả trên cả ba ca của run này mà không cần biên nào.

**Không hijack `runs[].note`**: `[ĐO code]` nó **đã có chủ** — mang note của turn (timeout / spawn
failure), cap 500 ký tự ([run-transcript.ts:127](../../apps/builder/server/lib/run-transcript.ts:127)),
ghi từ [orchestrator.ts:823](../../apps/builder/server/lib/orchestrator.ts:823). Kết cục cần trường riêng.

> **Việc rơi ra cùng chỗ sửa** (`[ĐO code]`): `runs[].note` **đang ride wire và bị client vứt** —
> `buildThreadFromRuns` không map nó. Một lượt chết vì timeout dựng lại **không nói gì cả**. Cùng một
> phép map, sửa luôn.

### 4.4 S3 — tab thụ động ngừng ghi đè trên đường KHÔNG-ask

**Biện minh độc lập với §1.4** (đọc-là-thấy, không cần biết ca này do gì): `applyTask` gán
`thread.value` vô điều kiện ([store.ts:578](../../apps/builder/web/src/store.ts:578)) kể cả khi
**không nhánh nào mutate `items`**; mảng mới ⇒ signal đổi identity ⇒ effect persist thức dậy
([store.ts:1011](../../apps/builder/web/src/store.ts:1011)) ⇒ tab thụ động ghi thread **của chính nó**
đè lên bản của tab đang gõ. Không có phối hợp đa tab nào để cản (§1.2).

**Sửa** — cùng thủ pháp 099 S1b (`if (idx !== -1)`), và **đã có tiền lệ trong chính file này**:
[store.ts:650](../../apps/builder/web/src/store.ts:650) đã viết `if (changed) thread.value = items;`.
Đặt cờ `changed` tại mỗi chỗ mutate `items` trong `applyTask`, cuối hàm gán có điều kiện.

⚠️ **Chỉ chặn phép GÁN thread.** `applyTask` còn làm việc khác trên cùng lượt (`setTaskValue`,
`loadActive`, `notifyTransition`) — những cái đó **phải chạy nguyên**. Điều kiện phải là "có mutate
thật", **không** phải so sánh mảng trước/sau (so sánh sẽ nuốt mất thay đổi hợp lệ — đúng cái bẫy
101 §2.2 đã ghi).

### 4.5 S4 — một dòng khi UI phải dựng lại từ đĩa

**Vì sao đáng làm dù nó không sửa gì cho người dùng:** không có nó, lần mất tiếp theo lại mù **y hệt**
lần này — và trên "một máy bạn không với tới được" ([101 §0](101-tester-release-plan.md)) thì không
thể nhờ dán console. Đây đúng là lỗ mà 099 S0/S1 dựng cảm biến để bịt; cảm biến chỉ đang đặt sai chỗ.

Đi nhờ request **đã có**: `backfillAskHistory` gọi `GET /api/tasks/:id/chat` ở mọi lần `openTask`
**của một build** (nó return sớm với `consult`/`promote` — cùng đúng phạm vi lát này)
([store.ts:2058](../../apps/builder/web/src/store.ts:2058) trở đi). Thêm một cờ query, **validate về
hình dạng cố định trước khi chạm file** — đúng khuôn `persistFailed` đã dựng ở
[tasks.ts:515](../../apps/builder/server/routes/tasks.ts:515). Kind mới: `thread_rebuilt`, detail ghi
**số item dựng được** và **có/không có `replies`**.

Không thêm route, không thêm writer, không thêm định dạng.

---

## 5. Thứ tự ship — và vì sao lát rẻ nhất xếp cuối

| # | Lát | Vì sao ở vị trí này |
|---|---|---|
| 1 | **S1** | Đây là thứ người dùng thật sự mất. Mọi thứ khác là chất lượng của bản dựng lại đó |
| 2 | **S4** | Rẻ, và là **instrument**. Kỷ luật của repo: đo trước khi sửa tiếp. Ship sau S1 thì mọi lần hụt cache **sau đó** đều để lại dấu |
| 3 | **S2** | Sửa "gây hiểu nhầm" — nguyên tắc 7. Gắn thẳng vào phép map S1 vừa viết |
| 4 | **S3** | Rẻ nhất (một cờ + một điều kiện) **nhưng xếp cuối có chủ ý**: nó là lỗ đọc-là-thấy, **không** có bằng chứng nó gây ra ca này (§1.4). Ship nó sớm sẽ khiến người sau tưởng sự cố đã được giải thích |

---

## 6. Test — địa chỉ đã kiểm bằng `ls`, không tin chữ "(mới)"

> Luật này có giá: [101 §2.3](101-tester-release-plan.md) ghi lại một lần `Write` đè lên
> `test/origin.test.ts` vì plan nói "(mới)" mà file đã tồn tại — **7 test biến mất, suite vẫn xanh**.

| Lát | File | Trạng thái | Nội dung tối thiểu |
|---|---|---|---|
| S1 | `test/run-events.test.ts` | **ĐÃ TỒN TẠI** | `readUserMessages`: cắt đúng ngân sách + `dropped` đúng · **bỏ `retry` không `detail`** · file thiếu ⇒ `[]` |
| S1 | `test/task-snapshot-route.test.ts` | **MỚI** (đã `ls`: chưa có) | `GET /api/tasks/:id` có `replies` · **consult KHÔNG có** · **`readEvents` được gọi đúng MỘT lần** (đếm lời gọi — đây là điều kiện của §4.1, không được để nó thành lời hứa) |
| S1 | `web/src/lib/run-thread.test.ts` | **MỚI** (đã `ls`: chưa có) | Xen kẽ đúng thứ tự trên **fixture trích từ run thật `1787244501931`** · tin nhắn cũ hơn lượt cũ nhất nằm trên notice `runsDropped` · marker chỉ hiện khi có hao hụt |
| S1 | `web/src/store.backfill.test.ts` | **ĐÃ TỒN TẠI** | `openTask` rơi xuống nhánh dựng-từ-runs ⇒ thread **có** item `user` |
| S2 | `web/src/lib/run-thread.test.ts` | (cùng file) | Hai lượt `drop_spec` + một `apply_spec` của run thật ⇒ đúng ba nhãn khác nhau · `runs[].note` không còn bị vứt |
| S3 | `web/src/store.test.ts` | **ĐÃ TỒN TẠI** (đã có `describe('applyAskDone …')` để nối vào) | `applyTask` với snapshot **không đổi gì** ⇒ **`thread.value` giữ nguyên identity** |
| S4 | `test/run-events.test.ts` | (cùng file) | `thread_rebuilt` ghi đúng detail · query hỏng ⇒ **không** ghi gì |

**Bắt buộc cho mọi lát: chứng minh ĐỎ-KHI-REVERT bằng cách chạy thật** (tạm gỡ fix → chạy → khôi
phục), và **ghi kết quả vào spec**. Test không chứng minh được điều đó là test trang trí
([docs/specs/README.md](README.md)).

Riêng S3, phép đảo chiều phải là: đưa phép gán ra ngoài `if (changed)` → test đỏ với thông báo dạng
*"no visual difference"* (nội dung giống hệt, chỉ **identity** đổi — đó chính là bản chất bug).

### Nghiệm thu
`[REPRO]` §2 chạy trọn vẹn · server `node --test` và web `vitest` xanh toàn bộ · typecheck sạch cả hai phía.

---

## 7. Non-goals — ghi kèm điều kiện đảo ngược

| Không làm | Vì sao | Đảo ngược khi nào |
|---|---|---|
| Ghi fix request vào `chat.jsonl` | 099 nguyên tắc 4 (không mở bề mặt ghi); dữ liệu **đã** ở `events.jsonl`; sẽ làm hỏng nghĩa của ask-ledger | Không bao giờ, trừ khi `events.jsonl` bị bỏ |
| Dựng lại gate card quá khứ | 099 nguyên tắc 3 — snapshot của chúng chưa từng được lưu | Khi snapshot gate được lưu (chưa có ai đòi) |
| **Đổi sang DB** | §7.1 | §7.1 |
| Lật D6 (server sở hữu hội thoại) | Quyết định lớn, chưa chốt. S1–S4 **không** cản nó: khi lật, bộ lắp server-side sẽ đọc **đúng ba file này** | Khi có nhu cầu rõ, và khi S1/S4 đã cho đủ số liệu về tần suất hụt cache |

### 7.1 `[ĐO]` Vì sao **không** chuyển sang DB — và điều kiện đảo ngược

Câu hỏi được đặt ra đúng lúc (trước khi fix). Trả lời: **sự cố này không mất một byte nào trên đĩa** —
cả ba câu đều nằm nguyên trong `events.jsonl`. Hỏng nằm ở cache hiển thị + đường đọc lại **thiếu**.
Đổi engine lưu trữ không chạm được cái nào trong hai cái đó: vẫn phải viết phép chiếu (S1), và N tab
vẫn đua nhau trong localStorage (S3).

Hai trục đang bị gộp làm một, và chỉ trục thứ hai đẻ ra bug:

| Trục | Hiện tại | Là nguồn của bug? |
|---|---|---|
| Engine lưu trữ (JSONL ↔ DB) | JSONL append-only | **Không.** 099 đo `chat.jsonl` 106 dòng: JSON hợp lệ 100 %, không truncate. Đĩa **chưa bao giờ** là bên đánh mất dữ liệu |
| Quyền sở hữu hội thoại (browser ↔ server) | Browser sở hữu (D6) | **Đúng cái này.** 099, 101 §1②, và ca này — cả ba |

`[ĐO]` Quy mô hiện tại: **57 run · 21 MB · 20 `chat.jsonl` · 31 `events.jsonl` · một writer**. Ở quy mô
đó DB không mua được gì, mà phải trả: viết lại mọi reader (`readEvents`, `readRunAttempts`,
`readConsultChat`, dossier, bundle, ask-ledger) · **mất khả năng đọc bằng mắt và bằng `jq`** — chính
thứ đã chốt được chẩn đoán này trong vài phút · bundle export phải có đường riêng cho file DB, làm yếu
đúng chỗ ràng buộc "một máy bạn không với tới được" cần mạnh nhất.

**Đảo ngược khi:** cần truy vấn xuyên build mà file không phục vụ nổi (tìm theo pattern, thống kê
nhiều build), **hoặc** có nhiều writer đồng thời thật. Cả hai đều chưa xảy ra.

---

## 8. Open questions

| # | Câu hỏi | Vì sao chưa chốt |
|---|---|---|
| Q1 | Hai marker tiếng Anh **đã tồn tại** (marker của ask-backfill và notice `runsDropped`) không đi qua `tr`, trong khi `store.ts` **có** `tr`. Sửa luôn hay để? | Sửa thì mở rộng phạm vi ngoài sự cố; để thì một thread dựng lại có chỗ Nhật chỗ Anh. Nghiêng về **sửa cùng lượt S1** vì cùng một phép map — nhưng cần user chốt |
| Q2 | Vì sao localStorage rỗng (§1.4) | Cần phép đo còn nợ. **Không lát nào chờ câu trả lời này** |
| Q3 | `retry` **không** có `detail` — có nên hiện "đã bấm Retry" như một dòng timeline không? | S1 đang cố ý bỏ (§4.2). Nó là hành động, không phải lời nói; nhưng nó **có** giải thích một lượt chạy lại |

---

## 9. Lệnh kiểm mốc `file:line` của chính spec này

Chạy **từ repo root**, trước mỗi lần sửa spec — line number trôi theo mọi commit chạm `store.ts`, và
một mốc trôi là một lần chẩn đoán sai nữa.

```bash
python3 - <<'EOF'
import io,re,os
p='docs/specs/107-a-rebuilt-thread-must-keep-the-users-words.md'
s=io.open(p,encoding='utf-8').read(); b=os.path.dirname(p)
bad=0
for m in re.finditer(r'\]\((\.\./\.\./[^)\s]+?):(\d+)\)', s):
    f=os.path.normpath(os.path.join(b,m.group(1))); n=int(m.group(2))
    ls=io.open(f,encoding='utf-8').read().split('\n')
    ok = n<=len(ls) and ls[n-1].strip()!=''
    bad += 0 if ok else 1
    print(('OK ' if ok else 'BAD'), f'{os.path.basename(f)}:{n}', ls[n-1].strip()[:70] if n<=len(ls) else '')
print('---', 'BAD =', bad)
EOF
```
