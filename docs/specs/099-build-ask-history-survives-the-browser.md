# 099 — Lịch sử ask của một BUILD phải sống sót qua trình duyệt

> Trạng thái: **mở**, chưa implement. Phát hiện 2026-08-19 từ run `1786505684286`.
> Phạm vi: **cache hiển thị của một build và đường đọc lại nó từ đĩa.** Bảy slice —
> S0 log lúc SSE đóng (mở khoá điều tra) · S1 dựng lại lịch sử ask từ `chat.jsonl` ·
> S1b tab thụ động không nuốt câu trả lời · S2 thất bại lưu trữ hết im lặng ·
> S3 vệ sinh dung lượng (`gate` chiếm 65 %) · S4 gộp hai origin · S5 LRU không đá mất
> thứ chưa có bản sao.
> **Thứ tự ship: S0 → S1 → S1b → S3 → S2 → S5 → S4** (§8.2 giải thích vì sao).
> Không chạm consult, không chạm đường ghi `chat.jsonl`, không đổi định dạng file,
> **không đổi `recoverOpenAsk` và không đổi `lastAsk`**.
>
> Chẩn đoán đã đổi **hai lần** sau khi đo (quota → số item `run` → clobber đa tab + `gate` snapshot).
> Đọc "Bài học đo lường" §1 trước khi tin bất kỳ con số nào trong đây.
>
> **Nguyên nhân gốc vẫn CHƯA chốt** (nhưng đã hẹp lại — xem §1.3). Quy trình kiểm tự đủ nghĩa cho
> một phiên mới nằm ở [`099-repro-handoff.md`](099-repro-handoff.md).
>
> **Đã qua kiểm chứng lại toàn bộ viện dẫn code 2026-08-19 (lượt 2).** Mọi mốc `file:line` trỏ đúng
> dòng và nội dung khớp; **đúng một phát biểu sai** — nó làm sập cơ chế của S1b như bản cũ viết, nên
> S1b đã được **thiết kế lại**.
> Bốn lỗ hổng triển khai (race trong `openTask`, mã redirect của S4, mặc định cờ của S5, địa chỉ test
> #21) đã được bịt trong bản này. Xem §1.3.
>
> **Muốn IMPLEMENT thì đọc [`101-tester-release-plan.md`](101-tester-release-plan.md), không phải file
> này.** Plan 101 gộp 099 + 100, **cắt bớt** dưới ràng buộc "không cần giữ data hiện có", và chốt thứ
> tự ship. File này giữ **bằng chứng và lập luận**; 101 giữ **việc phải làm**.
> Riêng §8 vẫn hữu ích nếu muốn hiểu vấn đề trước khi đọc plan.

---

## 1. Sự cố

Người dùng hỏi 3 câu trong build `1786505684286` tối 18/08 → sáng 19/08. Restart máy, mở lại
Builder bằng `scripts/update-and-run.command` → **cả 3 cặp hỏi–đáp biến mất khỏi UI**, trong khi
chúng nằm nguyên vẹn trên đĩa.

### Bằng chứng

| Nhãn | Sự việc |
|---|---|
| `[ĐO]` | `apps/builder/.runs/1786505684286/chat.jsonl`: 106 dòng = **53 cặp**, JSON hợp lệ 100%, kết thúc bằng newline, dòng cuối `at=1787067849989` (19/08 00:44 JST). Không truncate, không hỏng. |
| `[ĐO]` | `localStorage['builder.thread.1786505684286']`: **1.245.545 ký tự**, **274 item**. Ba câu hỏi `qa` cuối cùng nó còn giữ = lượt **95 / 97 / 99** (lượt 99 lúc 18/08 18:55 JST). Nguồn: console trình duyệt của user, **n=1 máy**. |
| `[ĐO]` | ⇒ Ba cặp **101/102, 103/104, 105/106** có trên đĩa, **không có** trong localStorage. Đĩa vẫn ghi đủ sau thời điểm localStorage đứng hình. |
| `[ĐO]` | `builder.thread.index` có **đúng 20** phần tử = `THREAD_MAX` ([store.ts:818](../../apps/builder/web/src/store.ts:818)). LRU đã chạm trần. |
| `[ĐO code]` | `persistThreadNow` **nuốt trọn mọi lỗi** `setItem` bằng `catch {}` rỗng ([store.ts:848](../../apps/builder/web/src/store.ts:848)). Ghi hỏng → không log, không banner, không dấu vết. |
| `[ĐO code]` | `_lastPersisted = json` được gán **trước** `setItem` ([store.ts:839](../../apps/builder/web/src/store.ts:839) → [:840](../../apps/builder/web/src/store.ts:840)): sau một lần ghi hỏng, bộ dedupe trong RAM tin rằng đã ghi xong. |
| `[ĐO code]` | Server chỉ gửi transcript khi `kind === 'consult'` ([tasks.ts:412](../../apps/builder/server/routes/tasks.ts:412)); build chỉ nhận `lastAsk` = **đúng 1 cặp cuối** ([tasks.ts:418](../../apps/builder/server/routes/tasks.ts:418)). |
| `[ĐO code]` | `recoverOpenAsk` **chỉ điền vào bong bóng đã có**, `return null` khi text câu hỏi không khớp ([ask-recovery.ts:63](../../apps/builder/web/src/lib/ask-recovery.ts:63)). Cả **2** chỗ gọi ([store.ts:976](../../apps/builder/web/src/store.ts:976), [:990](../../apps/builder/web/src/store.ts:990)) đều chỉ thay item tại chỗ — **không đường nào tạo item mới**. Và cả hai nằm trong **`onInit` của `connectSSE`** ([store.ts:951](../../apps/builder/web/src/store.ts:951)) — tức chỉ chạy lúc stream **(re)connect**, *không phải* lúc `ask:done`. Xem §1.3 lỗi ①. |
| `[ĐO code]` | `openTask` restore build theo chuỗi `loadPersistedThread ?? promoteThreadFromLog ?? buildThreadFromRuns` ([store.ts:1834–1839](../../apps/builder/web/src/store.ts:1834)) — **không mắt xích nào đọc `chat.jsonl`**. |
| `[ĐO]` | **Quota KHÔNG phải thủ phạm.** Tổng localStorage đang dùng **2,07 MB**; probe nhị phân còn ghi thêm được **~2,88 MB**; ghi thử đúng cỡ payload thật (1.245.545 ký tự) **thành công**. Giả thuyết quota — nêu ở bản đầu của spec này — **bị bác bỏ**. |
| `[ĐO]` | Bóc tách 276 item của thread: `gate` **41 item / 793 KB (65 %)**, `qa` 87 item / 313 KB, `run` 41 item / 58 KB, `user` 107 item / 58 KB. Item `run` theo phase: analyze 1, spec 1, implement 21, test 18. |
| `[ĐO]` | Thread có **87 item `qa`** nhưng `chat.jsonl` chỉ có **53 cặp** → **~34 ask chưa từng chạm đĩa**. Task tạo 12/08 12:34 JST, dòng đầu transcript 13/08 23:32 JST; `appendChat` cho đường ask vào repo ở `c3c7809` (13/08) và `3397eb7` (14/08). Tức là **ask trước 13/08 tối không được ghi** — đĩa cũng không đầy đủ. |
| `[ĐO code]` | `flushPendingAsk` **vứt bỏ im lặng** mọi chunk `ask:answer` khi thread không có item `qa` đang mở ([store.ts:704](../../apps/builder/web/src/store.ts:704)). Một tab đang mở cùng task nhưng **không phải** tab gõ câu hỏi rơi đúng vào ca này. |
| `[ĐO]` | **Origin split KHÔNG phải thủ phạm.** App phục vụ trên hai origin — `127.0.0.1:4123` (launcher mở) và `localhost:4123` — mỗi origin một localStorage riêng. Log server: `localhost:4123` chỉ xuất hiện 05/08, 12/08 và 17/08 20:30; **không** có mặt trong cửa sổ 18/08 tối. Vẫn là bẫy đang chờ — xem §6. |
| `[ĐO]` | Server restart trong cửa sổ: pid 14737 chết 18/08 19:29:37 → pid 59252 chết 22:15:57 → pid 64318 sống tới 19/08 08:21:42. |
| ❌ | **Log server KHÔNG chốt được giả thuyết đa tab.** `dev-restart.log` ghi mọi request kể cả `/stream`, nhưng **không bao giờ ghi lúc client ngắt** — mọi stream chỉ "kết thúc" đúng lúc process chết. Thời điểm **mở** là thật, thời điểm **đóng** là giả ⇒ mọi phép đếm "bao nhiêu stream cùng sống" đều vô nghĩa. Hai lần mở cách nhau 1–2 s ngay sau restart (22:15:59, 22:16:00) không phân biệt được *hai tab cùng reconnect* với *một tab reconnect hụt rồi thử lại*. Muốn dùng log phải **thêm log lúc SSE đóng** trước. |
| `[ĐO code]` | **Tab thụ động CHẮC CHẮN phát ra một lượt ghi.** `applyAskDone` gán `thread.value = items` **vô điều kiện** ([store.ts:798](../../apps/builder/web/src/store.ts:798)) — kể cả khi `idx === -1` (không có bong bóng nào để đóng) và **không có gì thay đổi**. Mảng mới ⇒ signal đổi identity ⇒ effect persist ([store.ts:886–887](../../apps/builder/web/src/store.ts:886)) thức dậy ⇒ tab thụ động ghi **thread cũ của chính nó** xuống localStorage ngay trong lượt đó. Mắt xích cuối của GT-1 vì vậy **đọc code là thấy**, không cần repro. Cùng đường đó `notifyAskDone` cũng bắn ở tab thụ động ([store.ts:774](../../apps/builder/web/src/store.ts:774)). |
| `[GIẢ THUYẾT]` | **Thủ phạm là hai tab cùng mở một task, tab thụ động ghi đè tab chủ động.** Cơ chế: tab B gõ câu hỏi → tab A cũng nhận `ask:answer` qua stream riêng của nó nhưng không có `qa` mở nên vứt hết chunk → `ask:done` tới cả hai tab → tab A ghi thread cũ của nó (hàng trên) đè lên bản tốt của B. Khớp mốc: snapshot dừng đúng ở lượt 99/100 (18/08 18:55) — thời điểm tab thứ hai được mở. **Phần CƠ CHẾ đã là `[ĐO code]`** (hàng trên); phần **chưa kiểm** chỉ còn đúng một mệnh đề: *tối 18/08 có thật sự hai tab cùng mở hay không*. Xem `[REPRO] A` §1 và câu hỏi §6. |

### Bài học đo lường (2026-08-19) — ghi lại vì nó suýt lái spec này đi sai hai lần

Bản đầu của spec đổ cho quota; bản hai đổ cho *số lượng item `run`*. **Cả hai đều sai**, và cả hai
đều sai vì cùng một lý do: **suy ra từ đĩa thay vì đo chính hiện vật.** Đĩa chỉ giải thích được
16 % trọng lượng thật của thread (204.952 / 1.245.545 ký tự) — dùng nó làm cơ sở suy luận là dùng
một dụng cụ chưa hiệu chuẩn. Ba dòng `console.table` trên hiện vật thật trả lời trong một lần dán,
và trả lời khác hẳn: hog là `gate` (65 %), không phải `run` (5 %) cũng không phải `qa.answer` (26 %).

> **Luật rút ra:** trước khi đổ lỗi cho một thành phần, **đo chính artifact đó**, không đo bản thế
> thân trên đĩa. Nếu chỉ có bản thế thân, con số mang nhãn `[CẬN DƯỚI]` và **không được** dùng để
> bác bỏ hay xác nhận giả thuyết nào.

### §1.3 Kiểm chứng lượt 2 (2026-08-19) — một mốc sai, bốn lỗ hổng triển khai

Toàn bộ viện dẫn của spec được đọc lại trên cây làm việc. **Mọi mốc `file:line` đều trỏ đúng dòng
còn tồn tại** (kiểm bằng máy, xem lệnh cuối §1.3), và nội dung từng mốc được đọc lại bằng mắt:
`flushPendingAsk` :703-706 · `_lastPersisted` trước `setItem` :839→:840 · `catch {}` :848 ·
`THREAD_MAX = 20` :818 · effect subscribe cả hai signal :886-887 · `chat` consult-only tasks.ts:412 ·
`lastAsk` tasks.ts:418 · `readConsultChat` ask.ts:1014 · `recoverOpenAsk` :63 · chuỗi restore của
`openTask` :1834-1839 · `serializeThread` chỉ bóc `artifactContents` thread-persist.ts:44 · ngân sách
48.000/6.000 run-transcript.ts:297-298 — **tất cả đúng**.

**Đúng một PHÁT BIỂU sai**, và nó không nằm ở bảng bằng chứng §1 mà ở phần mô tả cơ chế của S1b.

Số đo trên đĩa cũng dựng lại được: đọc lại `chat.jsonl` cho **đúng 4 lượt `ok:false` ở 12/14/42/62**
và `sessionReset` ở **100/102** như §7 ghi, và file **alternating user↔assistant 100 %** — tức luật
ghép cặp liền kề của S1 an toàn trên dữ liệu thật, không chỉ trên lý thuyết. (File đã dài thêm từ lúc
viết spec: nay **132 dòng = 66 cặp**, `sessionReset` thêm ở 110/112, tổng text 264.056 ký tự.)

#### ① Mốc SAI — nó làm sập cơ chế của S1b bản cũ

Bản cũ của S1b viết: *"Đường `ask:done` đã gọi sẵn `recoverOpenAsk` hai lần (store.ts:976, :990)"*.
**Sai.** Cả hai chỗ đó nằm trong **`onInit` của `connectSSE`** ([store.ts:951](../../apps/builder/web/src/store.ts:951))
— chỉ chạy lúc stream **(re)connect**. Đường `ask:done` thật là
[`onAskDone: (d) => applyAskDone(d)`](../../apps/builder/web/src/store.ts:1009), và `applyAskDone`
**không gọi** `recoverOpenAsk`, **không** fetch gì.

Nặng hơn: **`lastAsk` chỉ được sinh ra ở đúng một chỗ** — handler `GET /api/tasks/:id`
([tasks.ts:418](../../apps/builder/server/routes/tasks.ts:418) → [:438](../../apps/builder/server/routes/tasks.ts:438)).
Nó **không** nằm trong `toWireTask`, nên broadcast `task:update` — kể cả cái do chính đường ask phát
([ask.ts:1128](../../apps/builder/server/lib/ask.ts:1128)) — **không mang `lastAsk`**. Câu *"và
`applyTask` đã mang `lastAsk` về"* chỉ đúng cho snapshot GET, **không** đúng cho tab thụ động đang
nghe stream.

⇒ Nới `recoverOpenAsk` cho phép append, **một mình nó không thay đổi gì** trong kịch bản GT-1: tab
thụ động không hề gọi nó trong lượt đó. Nó chỉ chạy ở lần connect **sau** — lúc ấy clobber đã ghi
xong từ lâu (debounce 500 ms / max-wait 3 s). **S1b đã được viết lại** để gắn đúng chỗ.

#### ② → ⑤ Bốn lỗ hổng triển khai đã bịt trong bản này

| # | Lỗ | Đã sửa ở |
|---|---|---|
| ② | S1 gọi HTTP async trong `openTask` → resolve **sau** `applyTask`/`openStream`; merge lên biến `restored` đã stale, và đổi task giữa chừng thì **dán lịch sử task A vào task B** | S1 bước 0 + 7 |
| ③ | S4 dùng **301** → trình duyệt đổi POST thành GET ⇒ mọi mutation tới host `localhost` (`/ask`, `/confirm`, `/cancel`) **hỏng câm**; test #18 cũ chỉ assert path+query nên **pass trên đúng cái bug đó** | S4 + test #18/#18b |
| ④ | S5 "nhớ cờ *build này có bản sao*" không định nghĩa giá trị cho build **chưa từng mở sau khi feature ship** — 19/20 thread trong LRU index hôm nay rơi vào ca này | S5 mục 1 |
| ⑤ | Test #21 nhắm `buildThreadFromRuns` với `runs` rỗng, nhưng `openTask` **chỉ gọi hàm đó khi `t.runs.length`** ([store.ts:1839](../../apps/builder/web/src/store.ts:1839)) ⇒ nhánh không bao giờ tới, đúng loại "test trang trí" §5 cấm | S5 mục 3 + test #21 |

#### Lệnh kiểm mốc `file:line` của chính spec này

Chạy **từ repo root**, trước mỗi lần sửa spec — line number trôi theo mọi commit chạm `store.ts`, và
một mốc trôi là một lần chẩn đoán sai nữa. Lần chạy 2026-08-19: **72 mốc, 0 hỏng.**

```bash
python3 - <<'EOF'
import io,re,os
p='docs/specs/099-build-ask-history-survives-the-browser.md'; s=io.open(p,encoding='utf-8').read(); b=os.path.dirname(p)
for m in re.finditer(r'\]\((\.\./\.\./[^)\s]+?):(\d+)\)', s):
    f=os.path.normpath(os.path.join(b,m.group(1))); n=int(m.group(2))
    ls=io.open(f,encoding='utf-8').read().split('\n')
    print(('OK ' if n<=len(ls) else 'BAD'), f'{os.path.basename(f)}:{n}', ls[n-1].strip()[:70] if n<=len(ls) else '')
EOF
```

### Vì sao spec vẫn đứng dù thủ phạm đã đổi hai lần

**Không slice nào xây trên giả thuyết về nguyên nhân.** S1 làm UI tự lành từ đĩa với *mọi* lý do
khiến localStorage sai/mất — quota, clobber đa tab, xoá cache, đổi máy. Đó là lý do S1 vẫn nguyên
văn qua cả hai lần lật. S2/S3 thì có đổi: xem ghi chú trong từng slice.

### `[REPRO]` A — clobber đa tab (kiểm giả thuyết thủ phạm)

```
1. Mở Builder ở HAI tab, cả hai cùng mở đúng một build task.
2. Ở tab B: hỏi một câu, đợi trả lời xong.
3. Ở tab A: KHÔNG chạm gì cả. Quan sát — câu hỏi/đáp KHÔNG hiện ra ở đây
   (flushPendingAsk vứt chunk vì không có qa mở → store.ts:704).
4. Kiểm tra đĩa:  tail -2 apps/builder/.runs/<taskId>/chat.jsonl   → CÓ cặp vừa hỏi.
5. Console tab bất kỳ:
   JSON.parse(localStorage['builder.thread.<taskId>']).filter(x=>x.kind==='qa').length
   → KỲ VỌNG (nếu giả thuyết ĐÚNG): số này KHÔNG tăng — bản của A đã đè bản của B.
6. Hard reload tab B → cặp hỏi–đáp biến mất.
```

Bước 5 là phép quyết định. Nếu số **có** tăng thì giả thuyết clobber sai và phải điều tra tiếp
(ứng viên còn lại: một tab thứ ba đã đóng, hai profile trình duyệt, `task.value` null lúc ghi).

### `[REPRO]` B — nghiệm thu S1, không phụ thuộc thủ phạm là gì

```
1. Mở một build có ≥1 ask, đóng tab.
2. Console:  localStorage.removeItem('builder.thread.<taskId>')
   (mô phỏng MỌI kiểu mất cache: quota, clobber, xoá cache, máy khác)
3. Mở lại build đó.
   → KỲ VỌNG HIỆN TẠI (bug): thread chỉ còn requirement + các phase, sạch bóng ask.
   → KỲ VỌNG SAU S1: các cặp ask hiện lại từ transcript, kèm dấu mốc "khôi phục".
```

Kiểm tra phía server (cổng mặc định 4123 — `BUILDER_PORT`):

```bash
curl -s localhost:4123/api/tasks/1786505684286 | python3 -c "import json,sys;d=json.load(sys.stdin);print('chat:',type(d.get('chat')),'| lastAsk:',bool(d.get('lastAsk')))"
```

Hiện in `chat: <class 'NoneType'> | lastAsk: True` — đó chính là cái hố.

---

## 2. Nguyên tắc thiết kế (còn chi phối sau khi spec này đóng)

1. **Đĩa là nguồn sự thật *bền* của nội dung hội thoại; localStorage là cache hiển thị.**
   Một cache mất phải tự lành từ đĩa, không được biến thành mất dữ liệu.
   **Nhưng không phải nguồn ĐẦY ĐỦ** — `[ĐO]` 87 `qa` trong trình duyệt so với 53 cặp trên đĩa: các
   ask trước khi đường ghi transcript tồn tại chỉ sống trong localStorage. Nên phép hợp nhất luôn
   là **hợp**, không bao giờ là **thay thế**. (Xem hệ quả thiết kế cuối §6.)
2. **Thất bại lưu trữ không bao giờ được im lặng.** `catch {}` rỗng trên đường ghi dữ liệu người
   dùng là bug, không phải "best-effort".
3. **Không bịa để lấp chỗ trống.** Giữ nguyên nguyên tắc đã có của `buildThreadFromRuns`: gate card
   quá khứ *không* dựng lại vì snapshot của chúng chưa từng được lưu. "Trung thực và thiếu" hơn
   "đầy đủ và bịa". Cặp hỏi–đáp khôi phục phải **tự khai** là đã khôi phục.
4. **Không mở rộng bề mặt ghi.** `chat.jsonl` cho build **đã tồn tại**: `recordAsk`
   ([ask.ts:980](../../apps/builder/server/lib/ask.ts:980)) ghi hai dòng liền nhau qua `appendChat`
   ([:988–989](../../apps/builder/server/lib/ask.ts:988)) với `at` và `at+1` — đó chính là lý do phép
   ghép cặp liền kề của S1 đúng, và đo lại trên file thật cho alternating 100 %. Spec này chỉ **đọc lại** thứ đã ghi —
   không thêm một byte nào vào đường ghi, nên bất biến 033 D6 ("build không có transcript backend")
   không bị dịch chuyển thêm so với hiện trạng.
5. **Đường GET nóng phải giữ nguyên trọng lượng.** `GET /api/tasks/:id` chạy lại ở **mọi** lần
   reconnect SSE; nhồi 267 KB transcript vào đó là đánh đổi một bug lấy một bug khác.
6. **Tự khai phải để lại dấu vết MÁY ĐỌC ĐƯỢC, trên kênh đã có.** *(thêm 2026-08-19 — xem §4.2)*
   Một dòng chữ trên UI chỉ tới được người đang ngồi trước màn hình. Khi Builder chạy trên máy
   **tester**, người sửa lỗi **không** ngồi ở đó: cuộc điều tra 099 này chỉ chốt được vì đọc được
   console trình duyệt của chính người dùng — và điều đó **không lặp lại được** với N máy. Nên mỗi
   lần hệ thống tự khai điều gì, nó phải đồng thời ghi một dòng vào **`events.jsonl`** — kênh
   append-only, best-effort, **đã nằm sẵn trong bundle export** (`RUN_ARTIFACTS`).

   Điều này **không** mâu thuẫn nguyên tắc 4. Nguyên tắc 4 cấm mở rộng bề mặt ghi của **`chat.jsonl`**
   (nội dung hội thoại); `events.jsonl` là kênh **timeline** riêng, đã tồn tại từ spec 062 S1b, và
   tiền lệ đã được chính tác giả viết ra ở `turn_cost` ([run-events.ts:41–45](../../apps/builder/server/lib/run-events.ts:41)):

   > *"On the SERVER because the browser's copy is not a record: the thread lives in localStorage, so
   > the numbers survive a reload on the same machine and vanish on any other — and a run nobody
   > watched live never had them at all. This file already outlives all of that and already ships in
   > the export."*

   Cùng một lập luận, áp cho cùng một lớp dữ liệu. Không file mới, không định dạng mới, không route mới.

---

## 3. Slices

> **Các slice dưới đây KHÔNG xếp theo thứ tự làm** (chúng giữ nguyên vị trí lịch sử để diff dễ đọc).
> Thứ tự ship chốt ở **[§8.2](#82-cách-fix)**: **S0 → S1 → S1b → S3 → S2 → S5 → S4**.

### S1 — Build tự lành lịch sử ask từ đĩa **(cốt lõi)**

**Server.** Thêm route chỉ-đọc, tách khỏi snapshot nóng (nguyên tắc 5):

```
GET /api/tasks/:id/chat  →  { chat: ConsultChatLine[], dropped?: number }
```

- Dùng lại `readConsultChat` ([ask.ts:1014](../../apps/builder/server/lib/ask.ts:1014)) — không hàm
  đọc mới, không định dạng mới.
- **Cap**: chỉ trả **50 cặp cuối**; phần bị cắt báo qua `dropped` (số cặp) để client nói thật là có
  phần không hiện. Với run hiện tại (53 cặp) là gần trọn, nhưng cap chặn được run 500 cặp sau này.
- Chỉ nhả `text/role/at/files/cost/sessionReset` — đúng các field `ConsultChatLine` đã có. Không
  thêm field mới ở tầng server.
- Route **không** đổi gì trong nhánh `kind === 'consult'`: consult tiếp tục lấy `chat` qua snapshot
  như cũ và **không bao giờ gọi** route này.
- **Nhận `?have=<n>` — số item `qa` client đang có** (nguyên tắc 6). Khi `n` khác số cặp trên đĩa,
  route ghi **một** dòng `events.jsonl`:
  `{kind:'history_gap', detail:'disk=53 browser=87 backfilled=3'}`.
  Khớp nhau → **không ghi gì** (ca thường ngày phải im lặng tuyệt đối, nếu không file sẽ đầy nhiễu).

  **Vì sao gắn vào chính GET này thay vì một endpoint mới.** Client **đã bắt buộc** phải gọi route
  này để backfill, nên tham số là **zero route mới, zero file mới, zero bề mặt ghi mới** — đúng
  nguyên tắc 4 và 6 cùng lúc. Đánh đổi phải nói thẳng: một `GET` mang tác dụng phụ ghi log. Chấp
  nhận được vì tác dụng phụ đó **idempotent, best-effort, và cùng loại với access log**; nó không
  đổi trạng thái nghiệp vụ nào.

  **Đây là con số đã tốn ba lần chẩn đoán sai để có được.** `[ĐO]` gốc "browser 87 `qa` / đĩa 53 cặp"
  phải lấy bằng cách nhờ người dùng dán console. Sau slice này nó nằm sẵn trong bundle của **mọi**
  máy tester, mọi lần, không cần hỏi ai.

**Client.** Trong `openTask`, **chỉ nhánh build** (`t.kind` không phải `'consult'`/`'promote'`),
sau khi tính `restored` ([store.ts:1834–1839](../../apps/builder/web/src/store.ts:1834)):

0. **Guard chống race — bắt buộc, đọc trước khi viết code.** Lời gọi này là async và sẽ resolve
   **sau** `applyTask(t)` và `openStream(taskId)` ([store.ts:1842–1843](../../apps/builder/web/src/store.ts:1842)).
   Hai hệ quả, mỗi cái là một bug nếu bỏ qua:
   - **Merge lên `thread.value` HIỆN TẠI, không phải biến `restored`.** Lúc backfill chạy, `applyTask`
     đã có thể đẩy thêm gate card sống vào thread; ghi đè bằng `restored` sẽ nuốt mất nó.
   - **Kiểm `task.value?.taskId === taskId` ngay trước khi gán.** Người dùng bấm sang task khác trong
     lúc chờ mạng ⇒ không có guard này thì **lịch sử ask của task A bị dán vào task B**. Đây là mất
     dữ liệu tệ hơn bug đang sửa, nên guard này là điều kiện đủ để merge, không phải "nice to have".
1. Gọi `GET /api/tasks/:id/chat`. Hỏng/timeout → **bỏ qua im lặng**, thread giữ nguyên (hành vi
   hôm nay). Đây là đường *thêm vào*, không bao giờ được làm hỏng đường mở task.
2. Ghép cặp `(user, assistant)` liền kề trong transcript — đúng cách `recordAsk` ghi chúng.
3. Dựng **multiset** text câu hỏi (đã `trim`) từ các item `kind==='qa'` trong `restored`. Multiset
   chứ không phải Set: hỏi trùng text hai lần là chuyện thường, và Set sẽ nuốt mất một cặp.
4. Với mỗi cặp trong transcript, tiêu thụ một phần tử khớp trong multiset. Cặp nào không tiêu thụ
   được = **thiếu**.
5. Nếu có cặp thiếu: **append vào CUỐI thread**, theo đúng thứ tự transcript, mỗi cặp thành **hai**
   item — `{kind:'user', text:q}` + `{kind:'qa', question:q, answer:a, done:true}` — giống hệt hình
   dạng `ask()` tạo ra ([store.ts:1526–1528](../../apps/builder/web/src/store.ts:1526)), cộng
   `cost`/`sessionReset` nếu transcript có.
6. Trước nhóm append, chèn **một** dấu mốc nhìn thấy được (item `run` phase hiện tại, hoặc một kind
   mới nếu thấy sạch hơn) với nội dung đại ý *"N trao đổi dưới đây khôi phục từ transcript trên đĩa —
   thứ tự so với các bước build có thể không đúng chỗ"*.

   > **Đã NỚI LỎNG ở §8.4** — đọc trước khi code. "Bắt buộc trong mọi ca" là quá tay về UX: khôi phục
   > **đủ** và thứ tự **không** đáng ngờ thì im lặng trên UI, chỉ ghi `events.jsonl`. Hiện mốc **chỉ
   > khi** `dropped > 0` hoặc thứ tự có thể sai. Nguyên tắc 3 vẫn đứng — nó cấm **bịa sự đầy đủ**,
   > không đòi thông báo khi chẳng thiếu gì.
   `parseThread` chỉ đòi `id` + `kind` là string ([thread-persist.ts:60–62](../../apps/builder/web/src/lib/thread-persist.ts:60)),
   nên **kind mới sống sót qua persist**; thứ phải sửa nếu tách kind là *renderer*, không phải store.
   Tiền lệ cho hướng tái dụng `run` đã có sẵn: dòng tự khai `runsDropped` chính là một item `run`
   ([store.ts:1793–1797](../../apps/builder/web/src/store.ts:1793)).
7. **Ghi ngay sau khi merge.** Backfill xong phải chạm được đường persist (gán `thread.value`) để bản
   vừa lành được lưu — nếu không, mỗi lần mở task lại tốn một vòng HTTP. Không cần code thêm: effect
   persist subscribe `thread.value`, nên phép gán ở bước 5 đã đủ. Ghi lại đây vì nó là lý do backfill
   **tự ổn định** — lần mở sau, multiset khớp hết, route vẫn gọi nhưng không append gì.

**Vì sao KHÔNG mang field `ok` sang.** `ConsultChatLine.ok` chỉ ghi `false` và chỉ trên dòng
assistant, nhưng `LiveThreadItem` kind `'qa'` **không có ô nào chứa nó**
([store.ts:87](../../apps/builder/web/src/store.ts:87) — biến thể `qa` của `LiveThreadItem`) — và không cần: `recordAsk` ghi
*"`text` là thứ NGƯỜI ĐỌC ĐÃ THẤY, notice included"* ([ask.ts:977](../../apps/builder/server/lib/ask.ts:977)),
nên dòng ⚠ của một câu trả lời hỏng đã nằm sẵn **bên trong** `text`. Bỏ `ok` là **đúng**, không phải
thiếu sót — và một cặp khôi phục vì thế không bao giờ trông "lành" hơn bản live đã trông.

**Vì sao append cuối chứ không xen theo thời gian.** Item trong localStorage **không có timestamp**,
nên không có cách xen đúng chỗ. Bịa vị trí là vi phạm nguyên tắc 3. Trong thực tế các cặp thiếu
luôn là các cặp mới nhất (quota chỉ tăng, không tự lùi), nên append cuối gần như luôn đúng chỗ —
và dấu mốc ở bước 6 lo phần "gần như".

**Ảnh hưởng phải bằng 0 ở những chỗ này** (checklist khi review):

- `GET /api/tasks/:id` — payload **không đổi một byte**. `lastAsk` giữ nguyên, `recoverOpenAsk` giữ
  nguyên: chúng lo ca "câu trả lời đang chạy dở", khác hẳn ca "lịch sử đã mất". Không gộp hai thứ.
- Build **không** có ask nào → route trả mảng rỗng → không có gì append → thread y hệt hôm nay.
- localStorage **còn đủ** → multiset khớp hết → không có gì append → thread y hệt hôm nay.
- Item `run`/`gate` trong `restored` **không bị đụng tới**. Đây là lý do S1 là *backfill* chứ không
  phải *rebuild*: `consultThreadFromChat` mà đem áp cho build sẽ **xoá sạch** timeline phase, vì
  `chat.jsonl` không biết gì về run/gate.
- Consult: không đi qua nhánh mới. Promote: `promoteThreadFromLog` đứng trước trong chuỗi, không đổi.

### S0 — Log lúc SSE ĐÓNG **(làm trước, vì nó mở khoá cho chính cuộc điều tra)**

`[ĐO]` `dev-restart.log` ghi mọi request kể cả `/stream`, nhưng **không bao giờ ghi lúc client
ngắt** — mọi stream chỉ "kết thúc" đúng lúc process chết. Hệ quả: câu hỏi "có mấy tab cùng mở?" —
đúng câu đang chặn spec này — **không trả lời được từ dữ liệu lịch sử**, và sẽ vẫn không trả lời
được ở lần sau.

Một dòng `log.info` trong **`cleanup()`** ([sse.ts:218](../../apps/builder/server/plugins/sse.ts:218)),
kèm `taskId` và `sse.clients.size` còn lại — **và một dòng `events.jsonl` song song** (nguyên tắc 6).

> **Vì sao không chỉ `log.info`.** `dev-restart.log` nằm ở `.runs/dev-restart.log`, **3,4 MB**, dùng
> chung mọi task, và **KHÔNG** nằm trong bundle export (`RUN_ARTIFACTS` không có nó, và nó cũng không
> thể vào — chứa dữ liệu của task khác, chưa qua `redactSecrets`). Trên máy bạn thì `log.info` là đủ;
> trên máy tester nó là dòng log **không ai lấy về được**. Slice này sinh ra để trả lời "có mấy tab
> cùng mở" — nếu câu trả lời không tới được người sửa thì slice coi như chưa làm.
>
> Sự kiện: `stream_open` / `stream_close`, `detail: 'clients=N'`. **Rủi ro dung lượng phải đo, không
> đoán:** một build dài reconnect nhiều lần sẽ đẻ nhiều dòng. Nếu đo thấy ồn, lọc lại còn **chỉ ghi
> khi số client của task này vượt qua mốc 2** (mở lên ≥2, hoặc đóng về <2) — đó chính xác là biến cố
> spec quan tâm, phần còn lại là nhiễu. Ghi nhận đánh đổi ở đây để lần sau không phải suy lại. Đó là choke point **duy nhất và idempotent** của cả hai
hook đóng (`request.raw.on('close')` và `on('error')`,
[sse.ts:262–263](../../apps/builder/server/plugins/sse.ts:262)), và cả `taskId` lẫn `sse` đều đã có
sẵn trong scope. Không đổi hành vi, không đổi payload; chỉ là làm cho một loại sự cố trở nên chẩn
đoán được. Sau S0, `[REPRO] A` kiểm được **từ log** thay vì phải dựng tay hai tab.

> **Đính chính nghiệm thu (lượt 2).** Bản cũ đòi một test *"đóng do process chết không giả làm client
> ngắt"*. Test đó rỗng nghĩa: process chết thì `cleanup()` **không chạy** (không có hook nào gọi nó),
> nên **mọi dòng log tự nó đã là client-ngắt** — hai nguyên nhân phân biệt được *by construction*.
> Thứ đáng test là **tính idempotent**: `close` rồi `error` cùng bắn phải cho **đúng một** dòng. Đã
> đổi thành test #2.

### S4 — Hai origin, hai localStorage

`[ĐO]` App phục vụ trên cả `127.0.0.1:4123` (launcher mở) và `localhost:4123` (log cho thấy đã dùng
thật: 05/08, 12/08, 17/08 20:30). Trình duyệt coi đây là **hai origin khác nhau** → hai kho
localStorage tách biệt → **hai lịch sử chat khác nhau cho cùng một build**, không có bất kỳ dấu hiệu
nào trên UI.

Không phải nguyên nhân sự cố lần này (đã loại bằng log), nhưng là đúng cái bẫy đó đang chờ, và nó
thuộc phạm vi spec này: định danh của cache thread.

Sửa rẻ nhất: server redirect từ host `localhost` sang `127.0.0.1` (cùng port), để chỉ tồn tại một
origin. Đừng làm ngược lại — launcher đã dùng `127.0.0.1` và mọi thread hiện có nằm ở đó.

**Phải là `308`, KHÔNG phải `301`** (lỗ hổng ③, §1.3). Trình duyệt được phép đổi POST thành GET khi
theo `301`/`302`; mọi mutation tới host `localhost` — `POST /api/tasks/:id/ask`, `/confirm`,
`/cancel` — khi ấy **hỏng câm**: server nhận một GET không có body, trả 404, UI không hiện lỗi gì có
nghĩa. `308` giữ nguyên method và body. An toàn hơn nữa (và là lựa chọn được khuyến nghị): **chỉ
redirect request điều hướng tài liệu** (`Accept` chứa `text/html`, hoặc `Sec-Fetch-Mode: navigate`)
và **để `/api/*` yên** — đổi origin giữa chừng của một phiên đang chạy không cứu được gì mà chỉ tạo
một lớp lạ để debug.

Không cần đụng allowlist: `http://localhost:<port>` đang nằm sẵn trong `buildAllowedOrigins`
([sse-origin-check.ts:25](../../apps/builder/server/plugins/sse-origin-check.ts:25)), nên một tab cũ
còn gửi `Origin: http://localhost:4123` vẫn qua cửa — redirect chỉ đổi nơi *tài liệu* được nạp.

### S1b — Tab thụ động không được nuốt câu trả lời **(gộp vào S1; chỗ chặn clobber tại gốc)**

> **Đã THIẾT KẾ LẠI 2026-08-19 (lượt 2).** Bản cũ nói *"đường `ask:done` đã gọi sẵn `recoverOpenAsk`
> hai lần"* — **sai**, và sửa theo đúng chữ đó sẽ không chặn được gì. Xem §1.3 lỗi ①. Ý tưởng
> *append thay vì `return null`* thì **đúng**; chỗ **gắn** nó thì sai.

#### Ca hỏng, đọc từ code (không còn là giả thuyết)

Tab A mở task X nhưng không gõ gì. Tab B gõ câu hỏi trong cùng task X. Ở **tab A**:

1. `ask:answer` về qua stream riêng của A → `flushPendingAsk` thấy không có `qa` mở →
   **vứt trắng mọi chunk** ([store.ts:703–706](../../apps/builder/web/src/store.ts:703)).
2. `ask:done` về → `onAskDone` ([store.ts:1009](../../apps/builder/web/src/store.ts:1009)) →
   `applyAskDone`: `idx === -1` nên không có gì để đóng, **nhưng vẫn gán**
   `thread.value = items` ([store.ts:798](../../apps/builder/web/src/store.ts:798)).
3. Mảng mới ⇒ effect persist ([store.ts:886–887](../../apps/builder/web/src/store.ts:886)) thức dậy ⇒
   **tab A ghi thread thiếu của mình đè lên bản đủ của tab B.**

Không đường nào trong ba bước đó chạm `recoverOpenAsk` — nó chỉ sống trong `onInit` của `connectSSE`
([store.ts:951](../../apps/builder/web/src/store.ts:951)), tức lần **connect sau**. Mà lúc đó ghi đè
đã xong (debounce 500 ms, max-wait 3 s).

#### Sửa: hai lớp, lớp nào một mình cũng chưa đủ

**Lớp 1 — ngừng ghi đè (rẻ nhất, hai dòng).** Trong `applyAskDone`, chỉ gán `thread.value` khi thực
sự có thay đổi: `if (idx !== -1) thread.value = items;`. Tab thụ động khi ấy không phát ra lượt ghi
nào, nên không đè được lên ai. Đây là **chặn mất dữ liệu**, và nó độc lập hoàn toàn với S1.

> **Đã CHỨNG MINH lớp 1 là ĐỦ (2026-08-19) — nên lớp 2 hoãn được.** Câu hỏi: còn đường nào khác khiến
> tab thụ động vẫn ghi? Có **một đường nguy hiểm**: `applyTask` làm mới snapshot gate
> ([store.ts:517](../../apps/builder/web/src/store.ts:517)) rồi gán `thread.value` vô điều kiện
> ([:553](../../apps/builder/web/src/store.ts:553)), và `isFreshSnapshot` dùng `>=` nên **cả snapshot
> cùng `rev` cũng được áp** ([store.ts:399–402](../../apps/builder/web/src/store.ts:399)).
>
> **Nhưng đường ask của BUILD không phát `task:update`** — kiểm hết: `askTestWithin`
> ([ask.ts:739–806](../../apps/builder/server/lib/ask.ts:739)) và `askWithin`
> ([ask.ts:389–485](../../apps/builder/server/lib/ask.ts:389)) chỉ phát `ask:answer`/`ask:done`;
> route `POST /ask` ([tasks.ts:688–772](../../apps/builder/server/routes/tasks.ts:688)) không phát gì;
> bốn chỗ phát `task:update` trong `tasks.ts` là `failSafe`/`/confirm`/`/cancel`/`/reply`, không cái
> nào trên đường ask. Và `ask:answer` ở tab thụ động cũng không ghi: `applyAskAnswer` chỉ đệm
> ([store.ts:725](../../apps/builder/web/src/store.ts:725)), `flushPendingAsk` gặp `idx === -1` thì
> xoá đệm và `return` **không gán** ([store.ts:703–707](../../apps/builder/web/src/store.ts:703)).
>
> ⚠️ **Sự đủ đó phụ thuộc một tính chất ẩn.** Ai thêm một `task:update` vào đường ask sau này là
> clobber quay lại **âm thầm**. Vì vậy phải có **test canh cửa** (101 §7 #8): *đường ask của build
> không phát `task:update`*.

> Cẩn thận đúng một chỗ: `flushPendingAsk()` chạy ở đầu `applyAskDone`
> ([store.ts:772](../../apps/builder/web/src/store.ts:772)) và **có thể tự nó đã đổi `thread.value`**.
> Vì vậy điều kiện phải là "`idx !== -1`", không phải "so sánh mảng trước/sau" — và `items` phải được
> `slice()` **sau** `flushPendingAsk` như code hiện tại đang làm ([store.ts:775](../../apps/builder/web/src/store.ts:775)).

**Lớp 2 — hiển thị lượt vừa lỡ (dùng lại nguyên bộ máy S1).** Lớp 1 chặn mất mát nhưng tab A vẫn
**không thấy** cặp hỏi–đáp. Vá bằng đúng hàm thuần của S1, gắn ở **`onAskDone` khi `idx === -1`**:

```
onAskDone: (d) => {
  const passive = findOpenAskIdx(thread.value) === -1 && !asking.value;
  applyAskDone(d);
  if (passive && task.value && task.value.kind !== 'consult') backfillFromTranscript(task.value.taskId);
}
```

`backfillFromTranscript` = **cùng một hàm** S1 gọi trong `openTask`: `GET /api/tasks/:id/chat` →
ghép cặp → multiset → append phần thiếu. Cùng guard `taskId` của S1 bước 0. Không thêm hàm thuần mới,
không thêm route mới, không đụng `lastAsk`.

**Vì sao KHÔNG nới `recoverOpenAsk` nữa.** Nó nhận `lastAsk`, mà `lastAsk` **chỉ sinh ra ở handler
`GET /api/tasks/:id`** ([tasks.ts:418](../../apps/builder/server/routes/tasks.ts:418)) — không nằm
trong `toWireTask`, nên broadcast `task:update` (kể cả cái đường ask tự phát,
[ask.ts:1128](../../apps/builder/server/lib/ask.ts:1128)) không mang nó. Tab thụ động **không có
`lastAsk` trong tay** ở thời điểm cần. Route `/chat` của S1 thì có sẵn và đầy đủ hơn (cả transcript,
không chỉ cặp cuối), nên dùng nó là ít bề mặt mới nhất. `recoverOpenAsk` **giữ nguyên** — cả hai luật
của nó (khớp-theo-câu-hỏi, không-bao-giờ-rút-ngắn) còn nguyên, và non-goal "không đổi `lastAsk`" vẫn
đứng.

Ràng buộc để không sinh bug mới:

- Backfill **chỉ chạy khi tab thật sự thụ động**: không có `qa` mở **và** `asking.value === false`.
  Tab chủ động vừa đóng bong bóng của chính nó không được gọi — nếu không sẽ nhân đôi lượt.
- Phép multiset của S1 là lưới an toàn thứ hai: kể cả gọi nhầm, cặp đã có trong thread không append lại.
- Không chạy cho `kind === 'consult'` (consult đã rebuild từ transcript, đường riêng).

Sau S1b, clobber còn lại chỉ ảnh hưởng item `run`/`gate` — mất chúng khó chịu nhưng không mất hội
thoại. Đồng bộ đa tab thật sự (BroadcastChannel / khoá ghi) là việc lớn hơn, **không** thuộc spec này.

### S5 — LRU đá thread thì không được đá mất thứ chưa có bản sao ⚫ **ĐÃ DROP (trừ "việc 0")**

> **DROP 2026-08-19, đã kiểm bằng code.** Slice này xây trên `[ĐO]` *"1/20 build có `runs.jsonl`"* và
> *"mọi build trước 18/08 không có dòng nào trên đĩa"*. Cả hai **chỉ đúng với data cũ**. `[ĐO code]`
> `AttemptRecorder` được tạo trong `spawnOnce` của `runPhase`
> ([orchestrator.ts:517](../../apps/builder/server/lib/orchestrator.ts:517)) — đường **duy nhất** mọi
> phase đi qua — nên trên máy cài mới, tỉ lệ là **20/20**. Hệ quả: mục 1 không còn tín hiệu để xếp
> hạng nạn nhân, mục 2 có điều kiện **không bao giờ đúng** (code chết), mục 3 nhắm một ca **không thể
> tồn tại**. **"Việc 0" (`runs.jsonl` vào bundle) được GIỮ và nâng lên Đợt 1** — nó vốn chẳng liên
> quan gì tới LRU. Lý luận đầy đủ: [101 §1①](101-tester-release-plan.md).
>
> Dư chấn ghi rõ để không ai tưởng đã hết: `THREAD_MAX = 20` vẫn đá thread; sau khi bị đá, hội thoại
> tự lành nhờ S1 nhưng timeline phase **xuống cấp** (đĩa: ~8 attempt × 6.000 ký tự; browser: 41 ×
> 32.000; gate card không dựng lại). **S5 cũng không sửa được điều đó** — nó chỉ đổi *thread nào bị
> đá*, không đổi *phục hồi được bao nhiêu*. Nội dung dưới đây giữ lại làm hồ sơ.

`[ĐO]` `THREAD_MAX = 20` ([store.ts:818](../../apps/builder/web/src/store.ts:818)); khi vượt, thread
cũ nhất bị `removeItem` **im lặng** ([store.ts:845](../../apps/builder/web/src/store.ts:845)). Sau đó
mở lại build ấy thì rơi xuống `buildThreadFromRuns(t)` — đọc `runs.jsonl` qua API.

Vấn đề: **bản trên đĩa mỏng hơn bản trong trình duyệt rất nhiều, và phần lớn build không có nó.**

| | trình duyệt (localStorage) | đĩa (`runs.jsonl` → API) |
|---|---|---|
| số attempt | **không giới hạn** (task này: 41) | ~8 (ngân sách 48.000 ký tự) |
| mỗi attempt | 32.000 ký tự (`RUN_OUTPUT_CAP`) | **6.000** ký tự (`maxPerAttempt`) |
| gate card | có, đầy đủ | **không bao giờ** dựng lại (cố ý) |
| build có file này | — | **1 / 20** trong LRU index |

`[ĐO]` `runs.jsonl` mới ship **2026-08-18** (`27f0fc0`). Nên **mọi build tạo trước 18/08 không có
một dòng nào trên đĩa**: LRU đá thread của chúng là mất sạch lịch sử phase khỏi UI, mở lại chỉ còn
đúng bong bóng requirement. Ngay cả task đang điều tra — build duy nhất *có* file — cũng chỉ có
**3 attempt trên đĩa so với 41 trong trình duyệt**.

**Việc 0 — `runs.jsonl` phải vào bundle export.** `[ĐO code]` `RUN_ARTIFACTS`
([bundle.ts:29–37](../../apps/builder/server/lib/bundle.ts:29)) liệt kê `analyze.json`,
`criteria.json`, `report.json`, `diff.json`, `preflight.json`, `workspace.json`, `events.jsonl` —
**thiếu `runs.jsonl`**, vì file đó ship 18/08 (`27f0fc0`) **sau** khi spec 062 dựng bundle. Hệ quả:
hồ sơ tester gửi về đang thiếu đúng nguồn bằng chứng mới nhất, và toàn bộ lập luận "đĩa là bản sao
phục hồi được" của S5 **không kiểm chứng được từ xa**. Sửa: thêm một chuỗi vào mảng. Một dòng, và nó
là điều kiện tiên quyết của cả slice này.

Ba việc còn lại, không việc nào cần đường ghi mới:

1. **Đá theo "có thể phục hồi", không theo thời gian thuần.** Trước khi chọn nạn nhân, ưu tiên
   thread của build **đã có bản trên đĩa**. Client biết điều này rẻ: `GET /api/tasks/:id` đã trả
   `runs`/`runsDropped` ([tasks.ts:429–431](../../apps/builder/server/routes/tasks.ts:429)), chỉ cần
   nhớ lại cờ "build này có bản sao" lúc mở. Không có build nào phục hồi được thì mới quay về LRU
   thời gian như hiện nay.

   **Mặc định cho build chưa có cờ = `unknown` = coi như KHÔNG có bản sao** (lỗ hổng ④, §1.3). Cờ chỉ
   ghi được lúc *mở* task, nên tại thời điểm feature ship, **19/20 thread trong LRU index chưa từng có
   cờ** — bỏ trống thì slice này gần như không chạy, mà đoán "có" thì nó đá đúng thứ nó sinh ra để
   bảo vệ. `unknown → không có bản sao` là chiều an toàn: sai thì chỉ giữ lại một thread lẽ ra bỏ được;
   chiều kia sai thì mất lịch sử. Hệ quả phải chấp nhận và ghi rõ: **cho tới khi 20 thread đều được mở
   lại một lượt, S5 hành xử y hệt LRU thời gian hôm nay** — đó là hành vi đúng, không phải bug.
   Cờ lưu cùng `builder.thread.index` (đổi phần tử từ `string` sang `string | {id, hasDisk}`, đọc
   dung thứ cả hai dạng — index cũ trên máy người dùng phải parse được, không được reset).
2. **Đá thì phải nói.** Khi nạn nhân là build **không** có bản sao, ghi một dòng cảnh báo (cùng cơ
   chế với `persistDegraded` của S2). Đây đúng là nguyên tắc 2 của spec này.
3. **Khôi phục thiếu thì phải tự khai.** Ca cần vá là **không có `runs.jsonl` nào**: hiện một dòng
   nói rõ "build này chạy trước khi tính năng ghi phase ra đời, phần suy luận của các phase không được
   ghi lại ở đâu cả", thay vì im lặng hiện mỗi requirement như thể build chưa từng chạy gì.

   **Sửa ở `openTask`, KHÔNG ở `buildThreadFromRuns`** (lỗ hổng ⑤, §1.3). `openTask` chỉ gọi
   `buildThreadFromRuns` khi `t.runs && t.runs.length`
   ([store.ts:1839](../../apps/builder/web/src/store.ts:1839)) — với `runs` rỗng hàm đó **không bao
   giờ được gọi**, nên đặt dòng tự khai vào trong nó là code chết và test cho nó là test trang trí.
   Chỗ đúng là **nhánh fallback cuối** ([store.ts:1840](../../apps/builder/web/src/store.ts:1840)):
   `thread.value = restored ?? [requirement bubble]` → thêm dòng tự khai vào đúng nhánh `?? `. Khuôn
   chữ thì tái dụng `runsDropped` đã có ([store.ts:1793–1797](../../apps/builder/web/src/store.ts:1793)) —
   cùng kiểu item `run`, cùng giọng "nói thật khi thiếu".

   Thứ tự với S1: dòng này chỉ hiện khi **cả** transcript **lẫn** `runs.jsonl` đều trống. Build có
   ask nhưng không có `runs.jsonl` thì S1 đã lấp phần hội thoại rồi — đừng để hai dấu mốc chồng nhau
   nói cùng một chuyện.

**Không** đẩy ngược thread trình duyệt lên đĩa — đó là đường ghi mới, vi phạm nguyên tắc 4, và nó
đưa dữ liệu client chưa được kiểm chứng vào vùng artifact. **Không** tự tiện nâng ngân sách 48 KB:
nó đang bảo vệ đường `GET /api/tasks/:id` vốn chạy lại ở mọi lần reconnect (nguyên tắc 5).

### S2 — Thất bại lưu trữ phải nhìn thấy được, và phải thử lại được

> **Hạ ưu tiên sau phép đo 19/08.** Quota đã bị bác bỏ nên `setItem` **không hề ném** trong sự cố
> này — S2 sẽ *không* cứu được ca đã xảy ra. Vẫn giữ vì đây là bug tiềm ẩn thật (2,07/5 MB, và
> `gate` tăng đều theo mỗi lần chạy lại phase), và vì nếu nó đã có sẵn thì cuộc điều tra này đã
> ngắn hơn nhiều. **Làm sau S1/S1b và sau S3** (§8.2) — S3 hạ áp lực dung lượng, S2 xử lý phần dư.

Trong `persistThreadNow` ([store.ts:833](../../apps/builder/web/src/store.ts:833)):

1. **Chuyển `_lastPersisted = json` xuống SAU `setItem` thành công.** Ghi hỏng thì lần sau còn thử
   lại được. (Bug hiện tại: [:839](../../apps/builder/web/src/store.ts:839) trước
   [:840](../../apps/builder/web/src/store.ts:840).)
2. Bắt lỗi ghi → **giảm tải rồi thử lại**: đá phần tử **cũ nhất** trong LRU index (không bao giờ đá
   task đang mở), thử lại; lặp tối đa 3 lần hoặc đến khi index chỉ còn task hiện tại.
3. Vẫn hỏng → bật signal `persistDegraded`, UI hiện cảnh báo **một lần** đại ý *"không lưu được lịch
   sử hội thoại vào trình duyệt (hết dung lượng) — nội dung vẫn an toàn trên máy chủ"*. Câu chữ này
   chỉ đúng **sau khi S1 ship**; làm S2 trước S1 thì phải đổi câu, nên **ship S1 trước**.
4. Ghi thành công trở lại → tắt signal.

`catch` vẫn không được ném ra ngoài: lưu trữ hỏng vẫn không bao giờ chặn UI. Chỉ khác là nó không
còn vô hình.

#### S2′ — HỒI SINH 2026-08-20 phần bị drop, **thu hẹp lại thành BỘ ĐO** `[CHƯA IMPLEMENT]`

> **Vì sao mở lại một mục đã drop.** [101 §5](101-tester-release-plan.md) bỏ phần
> retry/giảm-tải/`persistDegraded` với lý do *"quota đã bị bác bỏ; máy sạch còn xa hơn"* — **đúng về
> xác suất, nhưng trả lời nhầm câu hỏi.** Lý do giữ lại không phải *"quota có khả năng xảy ra"*, mà là
> **S3 không có điều kiện kích hoạt nào quan sát được nếu thiếu nó**: mọi `localStorage.setItem` trong
> `store.ts` nuốt lỗi trong `try/catch` (dòng 159, 181, 201, 243, và `persistThreadNow`), localStorage
> **không** nằm trong bundle export, không có telemetry. Điều kiện của S3 (*"chạm ~4 MB"*) do đó là một
> điều kiện **không máy nào ở xa báo về được**: hoặc S3 không bao giờ chạy, hoặc nó chạy **sau khi**
> người dùng đã mất thread — đúng con lỗi spec này sinh ra để dập.
>
> **Thu hẹp:** S2′ chỉ **đo và kể**. Phần *giảm tải rồi thử lại* (S2 mục 2) **vẫn drop** — đó là bản
> vá, không phải phép đo, và trộn hai thứ vào một slice làm cả hai khó kiểm. S2 mục 1 (`_lastPersisted`
> sau `setItem`) **đã ship** ([101 §3.2](101-tester-release-plan.md)).

**Bốn mảnh, theo thứ tự phụ thuộc:**

1. **Phân loại lỗi trong `catch` của `persistThreadNow`**
   ([store.ts](../../apps/builder/web/src/store.ts)). Quota nhận diện bằng
   `e instanceof DOMException && (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
   || code === 22 || code === 1014)` — Safari private-mode cũng ném đúng nhóm này, và với người dùng
   thì hai ca **cùng một hậu quả**, nên gộp là đúng. Lỗi khác → `reason: 'other'`.
   `catch` **vẫn không được ném ra ngoài**: lưu trữ hỏng vẫn không bao giờ chặn UI.

2. **Signal `persistDegraded` → một cảnh báo NHÌN THẤY ĐƯỢC** (S2 mục 3, câu chữ nay đã đúng vì S1 đã
   ship): *"không lưu được lịch sử hội thoại vào trình duyệt — nội dung vẫn an toàn trên máy chủ và sẽ
   được khôi phục khi mở lại."* Ghi thành công trở lại → tắt signal.

   > **⚠ BẪY, phải viết ra vì nó tự đá vào chân mình:** cảnh báo này **KHÔNG được là một item trong
   > `thread`**. Mọi item thêm vào thread đều đánh thức chính `persistThreadNow` vừa hỏng → hỏng tiếp →
   > thêm item → vòng lặp. Nó phải là một **banner riêng** đọc từ signal, ngoài `thread`. (Khác với
   > marker của backfill và `runsDropped` — hai cái đó là item thread, và đúng như vậy.)

3. **Một khoá cờ nhỏ để sự việc sống qua reload.** `builder.persistFailed` =
   `{ at, bytes, taskId, reason }` (~80 byte). Ghi trong `catch`, **trong try/catch riêng của nó**: nếu
   ngay cả 80 byte cũng không ghi được thì bỏ qua — signal trong bộ nhớ vẫn lo phiên này. (Thực tế
   thường ghi được: cái vừa hỏng là bản ghi lớn.)

4. **Kênh bundle — dùng lại route đã có, KHÔNG mở route mới.**
   `GET /api/tasks/:id/chat` nhận thêm `&persistFailed=<bytes>`; thấy nó thì ghi **một** dòng
   `logEvent({ kind: 'persist_failed', detail: 'bytes=… task=… reason=…' })`.

   Vì sao chỗ này chứ không phải endpoint mới: route đó **đã** validate `:id` bằng `isTaskId` trước khi
   chạm filesystem (có test CONFINEMENT), **đã** `loadTask` (404 nếu không có), và **đã** gọi `logEvent`
   cho `history_gap`. ⇒ Không thêm bề mặt ghi nào mới — đúng **Luật làm việc #5**. Client đã gọi route
   này ở mọi `openTask` build (qua `backfillAskHistory`), nên không cần thêm request.

   - **Task báo cáo ≠ task bị hỏng.** Cờ được gửi ở lần mở build **kế tiếp**, nên `taskId` của lần
     hỏng phải nằm trong `detail`; nếu không, dòng log trỏ nhầm build.
   - **Xoá cờ sau khi báo thành công** ⇒ **một dòng cho một sự việc**, không phải một dòng mỗi lần mở.
     Thiếu điều này là tái sinh đúng con "log không bao giờ im" của commit `362ba81`.
   - Giá trị rác → bỏ qua, không tin (soi theo đúng cách `?have=` đang làm).

**Giới hạn đã biết, chấp nhận:** báo cáo **trễ** tới lần mở build kế tiếp; người dùng không mở build
nào nữa thì không có dòng nào. Chấp nhận được — đây là phép đo, không phải chuông báo; kênh tức thời
là cảnh báo ở mảnh 2.

**Nghiệm thu (đỏ-khi-revert):**

| # | Test | Ở đâu |
|---|---|---|
| a | `setItem` ném `QuotaExceededError` → `persistDegraded` bật **và** khoá cờ được ghi | `web/src/store.persistFlush.test.ts` (file đã có, đã mock `setItem` ném — **append**) |
| b | Ghi lại thành công → `persistDegraded` tắt | như trên |
| c | Cảnh báo **không** tạo item nào trong `thread` (chống vòng lặp mảnh 2) | như trên |
| d | `?persistFailed=` → **đúng một** dòng `persist_failed`, `detail` mang `taskId` của lần hỏng | `test/ask-transcript.test.ts` (**append**) |
| e | Không có cờ → **không** dòng nào; giá trị rác → bỏ qua, không crash | như trên |
| f | Báo xong → cờ bị xoá ⇒ lần mở sau **im lặng** | `web/src/store.persistFlush.test.ts` |

> **Ghi chú cho tương lai, không thuộc slice này:** S2 mục 2 (đá LRU rồi thử lại) bị drop khi **S1 chưa
> ship**, lúc đó đá một thread đi là **mất thật**. Sau S1, một build bị đá **lấy lại được từ đĩa** — nên
> lập luận drop đã đổi. Nếu bao giờ mở lại, mở bằng lý do mới đó, đừng chép lại lý do cũ.

### S3 — Kỷ luật dung lượng **(chỉ sau khi S1 ship)**

> **Điều kiện cũ "giả thuyết quota được xác nhận" ĐÃ BỎ** (lượt 2): quota bị bác bỏ, nên điều kiện đó
> khiến S3 không bao giờ chạy — trong khi thứ nó chữa vẫn đang lớn dần thật. `gate` chiếm **65 %** và
> **cộng dồn mỗi lần chạy lại một phase** (41 snapshot cho một build), nên 2,07/5 MB hôm nay không nói
> gì về tuần sau.
>
> Vì vậy S3 **đứng trước S2** trong thứ tự ship (§8.2): S3 chữa cái đang thực sự tăng, S2 là lưới an
> toàn cho một ca chưa xảy ra. Ràng buộc duy nhất còn giữ: **sau S1** — cap `qa.answer` trước S1 là
> mất thật. Mục tiêu đã đo xong, ghi lại để lần sau không phải đoán.

Đã đoán sai hai lần: bản đầu nhắm `qa.answer` (vì nó không bị cap trong khi `run.output` cap 32 KB —
[thread-persist.ts:30](../../apps/builder/web/src/lib/thread-persist.ts:30)); bản hai nhắm *số lượng
item `run`*. Số đo thật trên chính thread đó:

| kind | items | KB | tỉ trọng |
|---|---:|---:|---:|
| **`gate`** | 41 | **793** | **65 %** |
| `qa` | 87 | 313 | 26 % |
| `run` | 41 | 58 | 5 % |
| `user` | 107 | 58 | 5 % |

**Hog là `gate`: 41 snapshot × ~19 KB.** `serializeThread` chỉ bóc `snapshot.artifactContents`
([thread-persist.ts](../../apps/builder/web/src/lib/thread-persist.ts)) — toàn bộ phần còn lại của
`WireTask` (requirement, runs, diff, report, gate.actions…) đi theo, nhân 41 gate card tích luỹ.
`run` thì vô can: 41 item mà chỉ 58 KB, cap 32 KB chưa từng chạm tới.

Hướng đúng, theo thứ tự:

1. **Bóc gọn `gate.snapshot` khi persist** — một gate card đã `resolved` chỉ cần đủ để render lại
   thẻ đã đóng, không cần cả `WireTask`. Xác định tập field tối thiểu từ chính renderer của gate card.
2. Cap `qa.answer` — chỉ an toàn **sau S1** (trước S1 thì cap = mất thật), và chỉ đáng 26 %. Nếu cap:
   **giữ phần đầu** (câu trả lời mở bài bằng kết luận), ngược với `run.output` giữ đuôi (kết quả
   stream ra sau). Hai kiểu dữ liệu khác nhau — đừng bê nguyên hằng số.
3. `run`: **không đụng**. Số đo nói nó vô tội.

---

## 4. Non-goals

- **Không** dựng lại gate card quá khứ. Snapshot của chúng chưa từng được lưu (đã là nguyên tắc của
  `buildThreadFromRuns`). S5 **không** lật điều này — nó chỉ nói thật khi thiếu.
- **Không** xen cặp khôi phục vào giữa timeline theo thời gian — không có timestamp phía client.
- **Không** đổi `lastAsk` phía server, và (sau thiết kế lại lượt 2) **không đổi `recoverOpenAsk`
  một dòng nào** — hai luật của nó, khớp-theo-câu-hỏi và không-bao-giờ-rút-ngắn, còn nguyên. S1b bản
  cũ định nới hàm này; xem §1.3 lỗi ① vì sao hướng đó không chạy.
- **Không** nhồi transcript vào `GET /api/tasks/:id` — S1 dùng route riêng đúng vì lý do này.
- **Không** đụng consult: đường của nó đã đúng và chính nó là mẫu để build noi theo.
- **Không khôi phục TRÍ NHỚ của model.** S1 lành *hiển thị*, không lành *ngữ cảnh*. Xem §4.1.
- **Không dựng kênh telemetry client→server.** Nguyên tắc 6 chỉ dùng những gì client **đã** gọi
  (`?have=` trên route S1) và những gì server **đã** biết (hook đóng SSE của S0). Một endpoint
  "báo cáo lỗi từ trình duyệt" là một quyết định sản phẩm (thu thập dữ liệu người dùng), **không**
  phải một bản vá bug — và nó không thuộc spec này. Hệ quả là một **điểm mù có chủ ý**, ghi rõ ở §4.2.
- **Không** thêm ghi mới vào `chat.jsonl`, không đổi định dạng dòng. **Không** đẩy ngược thread
  trình duyệt lên đĩa (S5).
- **Không** xoá localStorage ngoài phạm vi LRU đã có. S5 đổi **thứ tự chọn nạn nhân**, không đổi
  việc có xoá hay không, và không đổi `THREAD_MAX`.
- **Không** nâng ngân sách 48 KB của `readRunAttempts` — nó đang bảo vệ đường GET nóng.

---

### §4.1 Ranh giới với spec 100: hiển thị ≠ trí nhớ

Câu hỏi sẽ nảy ra ở lần review đầu tiên: *"khôi phục xong thì lượt hỏi kế tiếp có hiểu phần vừa khôi
phục không?"* — **Không, và không cần.** Đây là **hai kênh độc lập**:

| | Cái gì mang nó | Sống sót restart nhờ |
|---|---|---|
| **Hiển thị** (bong bóng trong UI) | `thread.value` → localStorage. **S1 sửa đúng cái này.** | `chat.jsonl` (sau S1) |
| **Trí nhớ của model** | `task.sessionIds.askTest` trong `task.json` → `claude --resume <id>` ([ask.ts:749](../../apps/builder/server/lib/ask.ts:749) · [claude-session.ts:73](../../apps/builder/server/lib/claude-session.ts:73)) | session store của chính CLI |

`[ĐO code]` S1 chỉ ghi `LiveThreadItem` vào signal của client — **không byte nào đi tới prompt**.
Ngược lại, model **không cần S1 để nhớ**: `sessionIds.askTest` nằm trên đĩa, nên câu hỏi kế tiếp sau
restart `--resume` đúng phiên cũ và đọc được toàn bộ hội thoại — kể cả khi localStorage sạch trơn.
**Chính sự cố 099 là ca đó: UI mất 3 cặp, model không mất gì.** Thêm một bảo chứng: `gatherTerminalSeed`
chạy **mọi lượt** (không chỉ lượt đầu), nên bối cảnh *build* luôn được gửi lại; thứ phụ thuộc resume
chỉ là *hội thoại*.

**Ca thật sự hỏng nằm ở spec 100, không phải ở đây:** khi `sessionReset` bắn, phiên mới nhận artifacts
+ `FRESH_SESSION_NOTE` và **không một dòng nào của `chat.jsonl`** ([ask.ts:723–733](../../apps/builder/server/lib/ask.ts:723))
⇒ UI hiện hội thoại đầy đủ mà model không nhìn thấy. Run này dính đúng 4 lần (lượt 100/102/110/112).

⇒ **Nếu tiêu chí nghiệm thu là "hỏi tiếp thì model hiểu phần đã khôi phục", thì 099 một mình KHÔNG
đủ** — phải ship kèm [spec 100](100-ask-session-reset-doom-loop.md) **S1** (nâng ngưỡng + sàn động)
và **S2** (chèn N cặp cuối vào seed phiên mới). Hai spec đọc **cùng một file** bằng **cùng một hàm**
`readConsultChat`; khác nhau ở đầu ra: 100 đẩy vào *prompt*, 099 đẩy vào *UI*.

Thứ tự gộp đề xuất khi làm cả hai: **099 S0 → 100 S1 → 099 S1 → 100 S2 → 099 S1b → 099 S3 → …**
100 S1 chen lên sớm vì nó rẻ nhất trong cả hai spec (một hằng số + một điều kiện) và đang chảy máu
tiền thật — và vì không lượng transcript chèn lại nào chữa nổi một vòng lặp reset mỗi 8 phút.

---

### §4.2 Ràng buộc phát hành: Builder chạy trên máy TESTER, không chỉ máy tác giả

*(thêm 2026-08-19 — đây là ràng buộc hệ thống, không phải một slice; nó đổi tiêu chí "xong" của
nhiều slice ở trên)*

**Điều thay đổi.** Khi Builder được cài lên N máy tester, người sửa lỗi **mất quyền tiếp cận bằng
chứng**. Cuộc điều tra 099 chỉ chốt được vì đọc được console trình duyệt của chính người dùng
(`localStorage` dump, 1.245.545 ký tự, bóc tách theo `kind`). Với 5 tester thì việc đó **không lặp
lại được**: họ không dán console, không tái hiện được, và không ai ngồi cạnh máy họ.

**Kênh thu bằng chứng ĐÃ CÓ và đã xây tốt** — không cần dựng mới:

| Có sẵn | Nội dung |
|---|---|
| `GET /api/tasks/:id/bundle` ([ui.ts](../../apps/builder/server/routes/ui.ts)) | zip hồ sơ run: `chat.jsonl` · `task.json` (đã tước `sessionIds`) · `transcripts/` · `events.jsonl` · 6 artifact JSON · attachments (trần 25 MB) · `summary.md` + ask-ledger + build-info. **Mọi text qua `redactSecrets`**, chỉ đọc trong run dir + workflow subtree ([bundle.ts:1–11](../../apps/builder/server/lib/bundle.ts:1)) |
| `POST /api/tasks/:id/export-drive` | đẩy đúng zip đó lên Drive nhóm; không cấu hình Drive → 409 → FE rơi về tải xuống. Zero setup cho tester (`.dify-share.json` commit sẵn) |
| `contributorIdentity()` ([share.ts](../../apps/builder/server/lib/share.ts)) | `BUILDER_CONTRIBUTOR` / setting cục bộ / username OS + `hostname()` — **danh tính người gửi đã tồn tại**, không cần phát minh lại |

**Ba lỗ của kênh đó, và slice nào bịt:**

| Lỗ | Hệ quả ở quy mô tester | Bịt ở |
|---|---|---|
| `runs.jsonl` không trong `RUN_ARTIFACTS` | hồ sơ thiếu nguồn bằng chứng mới nhất | **S5 việc 0** |
| `dev-restart.log` không thu được (3,4 MB, dùng chung task, chưa redact) | dấu vết server **không tới được người sửa** | **S0** (ghi song song vào `events.jsonl`) |
| **Thứ hỏng trong 099 nằm ở localStorage — bundle không nhìn thấy được** | **mọi báo cáo lỗi loại này đều không kiểm chứng được**, không xác nhận cũng không bác bỏ | **S1** (đĩa thành sự thật) + `history_gap` |

**Lỗ thứ ba là lập luận mạnh nhất cho S1 ở giai đoạn này** — mạnh hơn cả "người dùng lấy lại lịch sử".
Nếu sự thật nằm ở đĩa thì hồ sơ **đầy đủ**; nếu sự thật nằm ở localStorage thì cả một **lớp** bug
("UI hiện khác thứ trên đĩa") là **không chẩn đoán được về mặt cấu trúc** — không phải khó, mà là
không thể, vì dữ liệu không tồn tại ở nơi thu được.

**Điểm mù có chủ ý.** Hỏng ghi phía client (`persistDegraded`, S2) **không** tới được `events.jsonl`:
server không biết `setItem` của trình duyệt ném. Bịt nó cần một endpoint telemetry — một quyết định
sản phẩm, không thuộc spec này (§4). Chấp nhận được vì **sau S1 nó bớt quan trọng**: cache mất thì
tự lành, và `history_gap` chính là dấu vết trên đĩa nói rằng trình duyệt đã mất thứ gì đó. Ghi lại
đây để lần sau không ai tưởng là bỏ sót.

**Đánh đổi "kéo" vs "đẩy" — chưa giải quyết, cố ý.** Export hiện là hành động chủ động của người
dùng. Ngay lúc sự cố thì tester đang bối rối, không có động lực nộp bằng chứng; và vài lỗi trong
spec này **im lặng** — họ còn không biết là có gì để nộp. Cách rẻ nhất khép vòng: **mọi dòng tự khai
kèm luôn một nút "Gửi báo cáo"** gọi `export-drive` — đúng task, đúng lúc, bằng chứng còn tươi. Đây
là **việc UI**, nằm ngoài phạm vi spec này; ghi lại vì nó biến nguyên tắc 6 từ một luật kỹ thuật
thành một kênh thu dữ liệu thật, và nó chỉ tốn một nút.

---

## 5. Nghiệm thu

Test mới **phải chứng minh đỏ-khi-revert-fix** (revert tạm, chạy, khôi phục) — nếu không thì là test
trang trí. Mỗi slice phải có ít nhất một dòng ở đây; slice không có dòng nào là slice chưa xong.

| # | Slice | Test | Ở đâu |
|---|---|---|---|
| 1 | S0 | SSE đóng do CLIENT ngắt → có dòng log kèm `taskId` + số client còn lại | `test/sse.test.ts` (mới) |
| 2 | S0 | `cleanup()` **idempotent**: `close` rồi `error` cùng bắn → **đúng một** dòng log, `sse.clients` giảm đúng 1 | như trên |
| 3 | S1 | `GET /api/tasks/:id/chat` trả đủ cặp cho build có ask; mảng rỗng cho build chưa ask; cap 50 cặp + `dropped` đúng | `test/ask-transcript.test.ts` |
| 4 | S1 | Route **không** đổi payload của `GET /api/tasks/:id` — assert `chat === undefined` với build | như trên |
| 5 | S1 | Backfill (hàm thuần, module mới cạnh `ask-recovery.ts`): thiếu 3 cặp → append 6 item + 1 dấu mốc, đúng thứ tự | `web/src/lib/*.test.ts` (mới) |
| 6 | S1 | Backfill **no-op** khi multiset khớp hết | như trên |
| 7 | S1 | Câu hỏi trùng text 2 lần, localStorage giữ 1 → append đúng **1** (bẫy Set-vs-multiset) | như trên |
| 8 | S1 | Backfill **không đụng** item `run`/`gate` trong thread đầu vào | như trên |
| 9 | S1 | **Regression**: consult và promote **không** đi qua đường backfill (nhánh `kind` giữ nguyên) | `web/src/store.test.ts` |
| 10 | S1 | Thread rỗng (vừa bị LRU đá) → append đủ, **không nhân đôi** với thứ `buildThreadFromRuns` dựng ra | như trên |
| **10b** | **S1** | **Guard race (lỗ ②)**: `/chat` resolve **sau khi** đã `openTask` sang task khác → thread của task mới **không** bị chèn cặp của task cũ | như trên |
| **10c** | **S1** | **Guard race (lỗ ②)**: `/chat` resolve sau khi `applyTask` đã đẩy gate card sống vào thread → gate card **còn nguyên** sau backfill (merge lên `thread.value`, không lên `restored`) | như trên |
| **10d** | **S1** | Cặp khôi phục từ dòng `ok:false` giữ nguyên `text` (đã chứa dòng ⚠) và **không** mang field `ok` | `web/src/lib/*.test.ts` |
| 11 | **S1b lớp 1** | `applyAskDone` với `idx === -1` (tab thụ động) → **không** gán `thread.value` (identity mảng không đổi ⇒ effect persist không thức) | `web/src/store.reply.test.ts` |
| 12 | **S1b lớp 1** | **Regression**: `idx !== -1` (tab chủ động) vẫn đóng bong bóng + fold `cost`/`seededFrom`/`sessionReset` như cũ | như trên |
| **12b** | **S1b lớp 1** | **Regression**: `flushPendingAsk` có chunk chờ + `idx === -1` → chunk vẫn được xử lý đúng như hôm nay (không nuốt thêm gì mới) | như trên |
| 13 | **S1b lớp 2** | `onAskDone` ở tab thụ động (`idx === -1` **và** `asking === false`) → gọi backfill; ở tab chủ động → **không** gọi (không nhân đôi lượt) | `web/src/store.test.ts` |
| **13b** | **S1b lớp 2** | **Regression**: `recoverOpenAsk` **không đổi** — hai luật khớp-theo-câu-hỏi và không-bao-giờ-rút-ngắn còn nguyên | `web/src/lib/ask-recovery.test.ts` |
| 14 | S2 | `setItem` ném → `_lastPersisted` **không** bị gán → lần ghi sau thử lại | `web/src/store.persistFlush.test.ts` |
| 15 | S2 | Ném liên tục → đá LRU tối đa 3 lần, **không bao giờ** đá task đang mở, rồi bật `persistDegraded` | như trên |
| 16 | S2 | Ghi lại được → `persistDegraded` tắt | như trên |
| 17 | S3 | `gate.snapshot` bóc gọn: payload persist nhỏ đi, và gate card đã `resolved` vẫn render đúng sau reload | `web/src/lib/thread-persist.test.ts` |
| 18 | S4 | `GET` tài liệu tới host `localhost` → **308** sang `127.0.0.1`, **giữ nguyên path + query**; tới `127.0.0.1` thì không đổi | `test/origin.test.ts` (mới) |
| **18b** | **S4** | **`POST /api/tasks/:id/ask` tới host `localhost` KHÔNG bị đổi thành GET** — hoặc không redirect (khuyến nghị), hoặc redirect 308 giữ method + body. Assert mã **≠ 301/302** (lỗ ③) | như trên |
| 19 | S5 | Chọn nạn nhân LRU: ưu tiên build **có** bản sao trên đĩa; không có build nào phục hồi được → quay về LRU thời gian | `web/src/store.persistFlush.test.ts` |
| **19b** | **S5** | Index cũ (phần tử là `string` thuần, chưa có cờ) → parse được, mọi phần tử coi như **không** có bản sao, **không** reset index (lỗ ④) | như trên |
| 20 | S5 | Nạn nhân **không** có bản sao → phát cảnh báo | như trên |
| 21 | S5 | **Ở `openTask`** (không phải `buildThreadFromRuns`): `runs` rỗng **và** transcript rỗng → nhánh fallback hiện dòng tự khai, **không** im lặng trả về mỗi requirement (lỗ ⑤) | `web/src/store.test.ts` |
| **21b** | S5 | `runs` rỗng nhưng transcript **có** ask → S1 lấp hội thoại, **không** hiện thêm dòng tự khai của S5 (hai dấu mốc không chồng nhau) | như trên |
| **3b** | **S1** | `?have=N` lệch số cặp trên đĩa → **một** dòng `events.jsonl` `history_gap` kèm cả ba con số (disk/browser/backfilled) | `test/ask-transcript.test.ts` |
| **3c** | **S1** | `?have=N` **khớp** → **không ghi dòng nào** (ca thường ngày im lặng tuyệt đối); thiếu `have` → cũng không ghi, route vẫn trả đúng | như trên |
| **1b** | **S0** | `stream_open`/`stream_close` vào **`events.jsonl` của đúng task**, `detail` mang số client — assert đọc được từ file, không chỉ từ `app.log` | `test/sse.test.ts` (mới) |
| **19c** | **S5** | `runs.jsonl` **có mặt** trong zip của `buildBundle` (đỏ-khi-revert: bỏ khỏi `RUN_ARTIFACTS` → test đỏ) | `test/bundle.test.ts` |
| **22b** | — | **Nghiệm thu thu-bằng-chứng**: dựng lại sự cố 099 trên một máy sạch, export bundle, và **chỉ từ zip đó** trả lời được: có mấy tab · browser lệch đĩa bao nhiêu · đã backfill mấy cặp. Không đạt = nguyên tắc 6 chưa xong | thủ công |
| 22 | — | Đi hết **`[REPRO]` A và B** ở §1 bằng tay trên Builder thật, trước và sau fix | thủ công |

Chạy: `apps/builder` — server `node --test` + `tsx`, web `vitest`.

---

## 6. Open questions

1. ~~Quota có phải thủ phạm không?~~ **ĐÃ TRẢ LỜI 19/08: không.** 2,07/5 MB, dư 2,88 MB, ghi thử
   1,19 MB thành công. Xem §1.
2. ~~168 item còn lại gồm những gì?~~ **ĐÃ TRẢ LỜI 19/08:** `gate` 65 %, `qa` 26 %, `run` 5 %.
   Xem S3.
3. **Có đúng là hai tab không?** *(đã hẹp lại ở lượt 2)* **Cơ chế** ghi đè không còn là câu hỏi —
   `applyAskDone` gán `thread.value` vô điều kiện ([store.ts:798](../../apps/builder/web/src/store.ts:798))
   là `[ĐO code]`, xem §1. Còn lại đúng một mệnh đề chưa kiểm: *tối 18/08 (từ ~18:55) có thật sự hơn
   một tab cùng mở task `1786505684286` không.* Kiểm bằng `[REPRO] A` — đừng hỏi trí nhớ người dùng.
   **Không chặn S1/S1b** — cả hai đúng dù thủ phạm là gì.
4. **Dấu mốc "khôi phục từ transcript" nên là kind mới hay tái dụng `run`?** Kind mới sạch hơn về
   ngữ nghĩa nhưng đụng `parseThread`/`serializeThread`/renderer; tái dụng `run` là zero-touch nhưng
   hơi lệch nghĩa. Nghiêng về **tái dụng `run`** cho slice đầu, tách ra sau nếu thấy vướng.
5. **Có nên stamp `at` lên item `qa` từ nay trở đi** để lần sau ghép được theo timestamp thay vì
   theo text? Field additive, backward-compatible. **Rẻ hơn tưởng** *(đo lại lượt 2)*: **đĩa ĐÃ có
   `at`** trên mọi dòng — `recordAsk` ghi `at` cho dòng user và `at+1` cho dòng assistant
   ([ask.ts:988–989](../../apps/builder/server/lib/ask.ts:988)) — nên **cặp do S1 backfill có thể
   mang `at` thật ngay từ ngày đầu**, không phải chờ hội thoại tương lai. Chỉ ~34 ask tiền-transcript
   là vĩnh viễn không có. Đề xuất: **làm, ngay trong S1** (backfill stamp `at` từ transcript; đường
   `ask()` live stamp `Date.now()`), và **vẫn giữ** khớp-theo-text làm fallback vĩnh viễn cho item
   cũ không có `at`. Đây cũng là thứ mở đường cho "xen đúng chỗ theo thời gian" sau này — nhưng
   **không** làm trong spec này (xem non-goals).
6. **~34 ask chỉ tồn tại trong localStorage — có cần cứu không?** `[ĐO]` thread có 87 `qa`, đĩa có
   53 cặp; chênh lệch là các ask trước 13/08 tối, ghi trước khi đường ghi transcript tồn tại. Chúng
   **không** có bản trên đĩa và S1 không dựng lại được. Hai lựa chọn: kệ (chúng vẫn hiển thị bình
   thường chừng nào localStorage còn), hoặc một lệnh xuất-một-lần đẩy ngược thread trình duyệt lên
   đĩa. Nghiêng về **kệ** — đẩy ngược là đường ghi mới, vi phạm nguyên tắc 4.

### Một hệ quả thiết kế mà con số này vừa xác nhận

87 `qa` trong trình duyệt > 53 cặp trên đĩa nghĩa là **đĩa KHÔNG phải bản đầy đủ hơn** — mỗi bên giữ
một phần bên kia không có. Nếu S1 làm theo kiểu *rebuild* (bê `consultThreadFromChat` áp cho build)
thì nó sẽ **xoá sạch 34 ask** chỉ còn sống trong trình duyệt, cộng toàn bộ timeline phase. Đây là
bằng chứng bằng số cho lựa chọn **backfill, không rebuild** — thứ trước đó mới chỉ là lập luận.

---

## 7. Dữ liệu sự cố (giữ để đối chiếu khi implement)

- Run: `apps/builder/.runs/1786505684286/` — build (`kind` vắng), `status: awaiting_confirm`,
  `phase: test`.
- Transcript đầy đủ 53 cặp đã trích ra được từ `chat.jsonl` (2 chỗ `sessionReset` ở lượt 100 và 102;
  4 lượt `ok:false` ở 12, 14, 42, 62).
- Ranh giới mất mát: localStorage dừng ở lượt **99/100** (18/08 18:55 JST), đĩa chạy tiếp tới lượt
  **106** (19/08 00:44 JST).

**Đo lại 2026-08-19 (lượt 2) — dùng để hiệu chuẩn, không phải để thay số trên.** File đã dài thêm kể
từ lúc viết spec: nay **132 dòng = 66 cặp**, tổng text **264.056 ký tự**, `sessionReset` ở **100, 102,
110, 112** (hai mốc mới), `ok:false` vẫn **đúng 4 lượt: 12, 14, 42, 62**. Quan trọng nhất: file
**alternating user↔assistant 100 %** trên cả 132 dòng — kể cả đoạn có `ok:false` và `sessionReset`.
Đó là phép kiểm cho luật ghép cặp liền kề của S1 **trên dữ liệu thật**, và nó xác nhận `[ĐO]` gốc
(4 lượt `ok:false`, `sessionReset` 100/102) dựng lại được nguyên vẹn — dụng cụ đo lần này có hiệu chuẩn.

Lệnh dựng lại:

```bash
python3 -c "
import json;ls=[json.loads(l) for l in open('apps/builder/.runs/1786505684286/chat.jsonl') if l.strip()]
print('lines',len(ls),'| okfalse',[i+1 for i,x in enumerate(ls) if x.get('ok') is False])
print('sessionReset',[i+1 for i,x in enumerate(ls) if x.get('sessionReset')])
print('alternating',all(ls[i]['role']==('user' if i%2==0 else 'assistant') for i in range(len(ls))))"
```

---

## 8. Chốt lại: vấn đề gì · fix thế nào · sau khi fix chạy ra sao

> ⚠️ **§8.2 và §8.4 ĐÃ BỊ THAY THẾ bởi [`101-tester-release-plan.md`](101-tester-release-plan.md)**
> cho phần *làm gì / theo thứ tự nào*. Chúng được viết **trước** ràng buộc "không cần giữ data hiện
> có", nên vẫn liệt kê **S5** (đã DROP — xem ghi chú ở đầu S5) và **toàn bộ S2** (chỉ còn giữ một
> dòng `_lastPersisted`). **Đừng ship theo hai bảng đó.** Giữ lại vì §8.1 (vấn đề) và §8.3 (hành vi
> sau khi fix) vẫn đúng nguyên, và vì lập luận thứ tự trong §8.4 là thứ plan 101 kế thừa.
>
> Viết cuối cùng, sau khi mọi mốc code đã được kiểm chứng lượt 2; các §trên là bằng chứng đứng sau
> từng câu ở đây.

### 8.1 Vấn đề cần fix

**Một câu:** với một task **build**, lịch sử hỏi–đáp chỉ sống trong `localStorage` của **đúng một
origin, đúng một trình duyệt**, và **không có đường nào đọc lại nó từ đĩa** — nên bất kỳ lý do nào
làm hỏng cache đó đều biến thành **mất dữ liệu trước mắt người dùng**, dù nội dung vẫn nằm nguyên
trên máy.

Bốn khiếm khuyết độc lập cùng dẫn tới một triệu chứng:

| | Khiếm khuyết | Bằng chứng |
|---|---|---|
| **A. Không có đường đọc lại** | `openTask` dựng build từ `loadPersistedThread ?? promoteThreadFromLog ?? buildThreadFromRuns` — **không mắt xích nào đọc `chat.jsonl`**, dù server đã ghi transcript cho build từ 13–14/08. Server cũng chỉ nhả `chat` cho consult; build chỉ được **1 cặp cuối** (`lastAsk`). | [store.ts:1834–1839](../../apps/builder/web/src/store.ts:1834) · [tasks.ts:412](../../apps/builder/server/routes/tasks.ts:412), [:418](../../apps/builder/server/routes/tasks.ts:418) |
| **B. Tab thụ động ghi đè** | Tab không-gõ-câu-hỏi vứt trắng mọi chunk `ask:answer`, rồi ở `ask:done` vẫn gán `thread.value` **vô điều kiện** ⇒ effect persist thức dậy ⇒ **ghi thread thiếu của nó đè lên bản đủ**. | [store.ts:703–706](../../apps/builder/web/src/store.ts:703) · [:798](../../apps/builder/web/src/store.ts:798) · [:886–887](../../apps/builder/web/src/store.ts:886) |
| **C. Hỏng thì im lặng** | `persistThreadNow` nuốt mọi lỗi `setItem` bằng `catch` rỗng, **và** gán `_lastPersisted` **trước** khi ghi — một lần ghi hỏng là bộ dedupe tin rằng đã xong, không bao giờ thử lại. LRU cũng `removeItem` không nói gì. | [store.ts:839–848](../../apps/builder/web/src/store.ts:839) · [:845](../../apps/builder/web/src/store.ts:845) |
| **D. Cache phình sai chỗ** | `serializeThread` chỉ bóc `snapshot.artifactContents`; **toàn bộ phần còn lại của `WireTask` đi theo mỗi gate card** ⇒ `gate` chiếm **65 %** (793 KB / 41 item) trong khi `run` chỉ 5 %. | [thread-persist.ts:44](../../apps/builder/web/src/lib/thread-persist.ts:44) · `[ĐO]` §1 |

Cộng hai cái bẫy đang chờ: **hai origin** (`127.0.0.1` vs `localhost`) = hai lịch sử khác nhau không
báo gì; và **LRU đá theo thời gian thuần**, trong khi phần lớn build **không có bản sao nào trên đĩa**
(`runs.jsonl` mới ship 18/08).

**Không phải nguyên nhân** (đã bác bỏ bằng đo, đừng điều tra lại): quota (2,07/5 MB, dư 2,88 MB, ghi
thử 1,19 MB thành công) · số lượng item `run` (5 %) · origin split trong cửa sổ sự cố (log loại).

### 8.2 Cách fix

Bảy slice, xếp theo thứ tự ship. Mỗi slice khép kín — dừng ở bất kỳ đâu vẫn để lại hệ thống tốt hơn.

| Thứ tự | Slice | Sửa cái gì | Sửa ở đâu |
|---|---|---|---|
| 1 | **S0** | Một dòng `log.info` trong `cleanup()` — kèm `taskId` + số client còn lại. Mở khoá câu hỏi "mấy tab cùng mở" cho **mọi** cuộc điều tra sau. | [sse.ts:218](../../apps/builder/server/plugins/sse.ts:218) |
| 2 | **S1** | **Server:** route chỉ-đọc `GET /api/tasks/:id/chat` (dùng lại `readConsultChat`, cap 50 cặp + `dropped`), **tách khỏi** GET nóng. **Client:** trong `openTask` nhánh build, ghép cặp transcript → **multiset** theo text câu hỏi → **append phần thiếu vào cuối** + **một dấu mốc tự khai**. Kèm hai guard: merge lên `thread.value` hiện tại, và kiểm `taskId` trước khi gán. | route mới cạnh [tasks.ts](../../apps/builder/server/routes/tasks.ts) · hàm thuần mới cạnh [ask-recovery.ts](../../apps/builder/web/src/lib/ask-recovery.ts) · [store.ts:1834](../../apps/builder/web/src/store.ts:1834) |
| 3 | **S1b** | **Lớp 1** — `applyAskDone` chỉ gán `thread.value` khi `idx !== -1` ⇒ tab thụ động **ngừng phát ra lượt ghi**. **Lớp 2** — ở `onAskDone`, tab thụ động gọi **chính hàm backfill của S1** để hiện lượt vừa lỡ. `recoverOpenAsk` **không đụng**. | [store.ts:798](../../apps/builder/web/src/store.ts:798) · [:1009](../../apps/builder/web/src/store.ts:1009) |
| 4 | **S3** | Bóc gọn `gate.snapshot` khi persist (tập field tối thiểu lấy từ chính `GateCard`, [Chat.tsx:513](../../apps/builder/web/src/components/Chat.tsx:513) — nó chỉ đọc ~9 field). Cap `qa.answer` **giữ phần ĐẦU** (chỉ an toàn sau S1). `run`: không đụng. | [thread-persist.ts](../../apps/builder/web/src/lib/thread-persist.ts) |
| 5 | **S2** | `_lastPersisted = json` xuống **sau** `setItem` thành công · ghi hỏng → giảm tải rồi thử lại (≤3 lần, không bao giờ đá task đang mở) · vẫn hỏng → `persistDegraded` + cảnh báo **một lần** · ghi lại được → tắt. Vẫn không bao giờ ném ra ngoài. | [store.ts:833–850](../../apps/builder/web/src/store.ts:833) |
| 6 | **S5** | LRU chọn nạn nhân theo **"có bản sao trên đĩa"** trước, thời gian sau (`unknown` = không có bản sao) · đá build không có bản sao thì **cảnh báo** · `runs` **và** transcript đều trống → dòng tự khai ở **nhánh fallback của `openTask`**. | [store.ts:841–846](../../apps/builder/web/src/store.ts:841) · [:1840](../../apps/builder/web/src/store.ts:1840) |
| 7 | **S4** | Redirect **308** (không phải 301) từ host `localhost` sang `127.0.0.1`; khuyến nghị **chỉ** redirect điều hướng tài liệu, để `/api/*` yên. | tầng hook của server |

**Vì sao thứ tự này.** S0 trước vì nó rẻ nhất và mở khoá điều tra. S1 là cốt lõi và là **điều kiện
tiên quyết ngữ nghĩa** cho S2 ("nội dung vẫn an toàn trên máy chủ" chỉ đúng sau S1) và cho S3 (cap
`qa.answer` trước S1 = mất thật). S3 lên trước S2 vì nó chữa cái đang **thực sự tăng** (gate cộng dồn
mỗi lần chạy lại phase), còn S2 là lưới an toàn cho một ca chưa xảy ra. S4 cuối vì nó là bẫy tương
lai, không phải sự cố hiện tại.

> ⚠️ **Đây là thứ tự NỘI BỘ của 099, giả định chỉ có máy tác giả.** Thứ tự phát hành thật — gộp cả
> spec 100 và tính tới giai đoạn máy tester — nằm ở **§8.4**, và nó **khác**. Nếu chỉ đọc bảng trên
> mà ship thì trải nghiệm người dùng sẽ **xấu đi** ở bước 2 (xem §8.4).

**Ba thứ cố ý KHÔNG làm:** không rebuild thread từ transcript (sẽ xoá 34 ask chỉ sống trong trình
duyệt + toàn bộ timeline phase) · không đẩy ngược thread lên đĩa (đường ghi mới) · không nhồi
transcript vào `GET /api/tasks/:id` (chạy lại ở mọi lần reconnect).

### 8.3 Sau khi fix, hệ thống hoạt động thế nào

**Mở lại một build có ask, sau khi cache mất vì bất kỳ lý do gì** (quota, clobber, xoá cache, LRU đá,
máy khác):

1. `openTask` restore như hôm nay — có gì dùng nấy (thread cũ / `runs.jsonl` / bong bóng requirement).
2. Song song, `GET /api/tasks/:id/chat` mang transcript về. Hỏng/timeout → **bỏ qua im lặng**, mọi
   thứ y hệt hôm nay.
3. Ghép cặp, đối chiếu multiset với các `qa` đang có. **Khớp hết → không làm gì** (ca thường ngày).
4. Thiếu → append phần thiếu **vào cuối**, đúng thứ tự transcript, kèm **một dấu mốc** nói rõ *"N
   trao đổi dưới đây khôi phục từ transcript trên đĩa — thứ tự so với các bước build có thể không
   đúng chỗ"*. Item `run`/`gate` **không bị đụng**; timeline phase còn nguyên.
5. Thread vừa lành được persist ngay ⇒ lần mở sau không tốn vòng HTTP nào.

**Hai tab cùng mở một task, tab B hỏi:**

- Tab A **không còn ghi đè** — `ask:done` với `idx === -1` không phát ra lượt ghi nào nữa (lớp 1).
- Tab A **hiện đúng cặp hỏi–đáp đó ngay trong lượt**, kéo từ transcript qua chính đường backfill của
  S1 (lớp 2) — thay vì im lặng mất trắng như hôm nay.
- Tab B: không đổi gì. Bong bóng của nó đóng như cũ, không nhân đôi.

**Khi localStorage đầy thật:** ghi hỏng → tự giảm tải rồi thử lại ≤3 lần → vẫn hỏng thì **hiện cảnh
báo một lần**: *"không lưu được lịch sử hội thoại vào trình duyệt — nội dung vẫn an toàn trên máy
chủ"*. Câu đó **đúng theo nghĩa đen** vì S1 đã ship trước. Ghi được trở lại → cảnh báo tắt. Và nhờ
`_lastPersisted` chuyển xuống sau `setItem`, một lần hỏng không còn khoá vĩnh viễn mọi lần ghi sau.

**Dung lượng:** gate card đã `resolved` chỉ còn giữ đủ field để render lại thẻ đóng, thay vì kéo theo
cả `WireTask`. Cùng một lịch sử, cache nhỏ đi rõ rệt (mục tiêu: phần `gate` từ 65 % xuống mức tương
đương `run`), nên LRU 20 build và trần ~5 MB có thêm rất nhiều chỗ thở.

**Khi LRU vẫn phải đá:** nó đá build **đã có bản sao trên đĩa** trước. Đá build không có bản sao thì
**nói ra**. Và mở lại một build đời cũ (không `runs.jsonl`, không transcript) sẽ đọc là *"build này
chạy trước khi tính năng ghi phase ra đời — phần suy luận của các phase không được ghi lại ở đâu
cả"*, thay vì im lặng hiện mỗi requirement như thể build chưa từng chạy gì.

**Một origin duy nhất:** mở `localhost:4123` sẽ được đưa về `127.0.0.1:4123` — cùng một lịch sử, dù
vào bằng bookmark nào.

**Cái vẫn KHÔNG cứu được, nói thẳng:** ~34 ask trước 13/08 tối chưa từng chạm đĩa. Chúng còn hiển thị
chừng nào localStorage còn giữ, và biến mất vĩnh viễn nếu mất. Không slice nào trong spec này dựng
lại được — và đó là lựa chọn có chủ ý (nguyên tắc 3 và 4), không phải sót.

### 8.4 Thứ tự phát hành THẬT (gộp 099 + 100, cho giai đoạn máy tester)

Bảng §8.2 xếp theo logic nội bộ của 099. Thứ tự dưới đây xếp theo **mức đau của người dùng × khả
năng thu bằng chứng**, và nó là thứ tự nên ship.

**Đợt 1 — chặn trước khi phát hành (không route mới, không UI mới, không format mới).**
Bốn thay đổi nhỏ, gộp một lần:

| | Việc | Vì sao phải trước khi lên máy tester |
|---|---|---|
| 1 | **[100 S1](100-ask-session-reset-doom-loop.md)** — nâng `ASK_RESET_TOKENS` | Đau nhất và **thường xuyên nhất**: 4 lần reset/1 ngày, có 2 lần cách nhau 8 phút. Tester nào cũng gặp ngày đầu, và nó khiến sản phẩm **có vẻ hỏng**. Chi phí: một hằng số |
| 2 | **099 S1b lớp 1** — `applyAskDone` chỉ gán khi `idx !== -1` | Bẫy **âm thầm** phá dữ liệu. Không sửa từ xa được. Chi phí: hai dòng |
| 3 | **099 S4** — redirect 308 | Bẫy âm thầm thứ hai. Tester bookmark gì bạn không kiểm soát được |
| 4 | **099 S5 việc 0** — `runs.jsonl` vào `RUN_ARTIFACTS` | Không có nó thì hồ sơ nhận về đã thiếu ngay từ ngày đầu. Chi phí: một dòng |

**Đợt 2 — mở mắt (làm ngay sau khi phát hành, hoặc cùng lúc).**
5. **099 S0** — log đóng SSE **vào `events.jsonl`**. Là cách duy nhất trả lời "có mấy tab" khi bạn
   không ngồi trước máy đó.

**Đợt 3 — lưới an toàn thật.**
6. **099 S1** (+ `history_gap`) → 7. **[100 S2](100-ask-session-reset-doom-loop.md)**.

**Đợt 4 — vệ sinh.** 099 S1b lớp 2 → S3 → S2 → S5 (phần còn lại).

#### Ràng buộc thứ tự KHÔNG được vi phạm

**100 S1 phải đi TRƯỚC 099 S1.** Nếu ship 099 S1 trước, người dùng sẽ thấy lịch sử hiện lại đầy đủ
trên màn hình, hỏi tiếp, và model vẫn nói *"tôi không nhớ"* — **trông tệ hơn hiện tại**, vì giờ có
bằng chứng ngay trước mắt rằng nó đáng lẽ phải nhớ. Đây là ca hiếm mà một bản sửa đúng, ship sai thứ
tự, làm trải nghiệm xấu đi.

> Spec 100 §7 hiện viết *"Hai fix độc lập, làm song song được"* — **đúng về mặt kỹ thuật, sai về mặt
> trải nghiệm.** Đã đính chính ở đó.

#### Luật UX chi phối mọi dòng tự khai

Cả hai spec lấy nguyên tắc *"không bao giờ im lặng"*. Áp thẳng sẽ cho ra một UI đầy nhãn cảnh báo —
cũng là UX tệ. Luật đúng:

> **Tự chữa xong và chữa ĐỦ → im lặng trên UI, nhưng VẪN ghi `events.jsonl`.**
> **Chỉ nói với người dùng khi thật sự còn thiếu, hoặc khi họ cần làm gì đó.**

Hai vế đó độc lập, và đây là chỗ nguyên tắc 6 gỡ được mâu thuẫn: **người dùng cần yên tĩnh, người sửa
lỗi cần dấu vết** — trước nguyên tắc 6 thì hai nhu cầu đó tranh nhau một kênh (dòng chữ trên UI), sau
nguyên tắc 6 thì mỗi bên có kênh riêng. Áp cụ thể:

- S1 khôi phục **đủ** và thứ tự **không** đáng ngờ → **không hiện dấu mốc**, chỉ ghi `history_gap`.
  Hiện mốc **chỉ khi** `dropped > 0` hoặc thứ tự có thể sai. *(Đây là nới lỏng có chủ ý so với S1
  bước 6, vốn bắt buộc dấu mốc trong mọi ca.)*
- LRU đá build **có** bản sao trên đĩa → im lặng. Chỉ nói khi đá cái **không** có.
- `persistDegraded` → một dòng, một lần, **tự tắt** khi ghi lại được. Không banner dính.

Và câu chữ phải là tiếng người: không phải *"localStorage quota exceeded"* mà *"Máy đã hết chỗ lưu
lịch sử trò chuyện trong trình duyệt. Nội dung vẫn an toàn — mở lại task sẽ thấy đủ."*
