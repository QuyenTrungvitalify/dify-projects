# 099 — Bàn giao điều tra: 3 lượt hỏi–đáp biến mất khỏi UI Builder

> **Dán nguyên file này vào một chat mới.** Nó tự đủ nghĩa — không cần đọc lại hội thoại cũ.
> Spec đi kèm: [`099-build-ask-history-survives-the-browser.md`](099-build-ask-history-survives-the-browser.md).
> Ngày điều tra: 2026-08-19. Người dùng **không nhớ** được thao tác hôm 18/08, nên **đừng hỏi lại
> trí nhớ** — chỉ dùng repro và số đo.

---

## 0. Nhiệm vụ của phiên mới

Chốt **nguyên nhân gốc** của sự cố dưới đây bằng repro tất định, rồi cập nhật nhãn bằng chứng trong
spec 099. Việc implement fix là của người dùng, **không** tự sửa code trừ khi được bảo.

> **Cập nhật 19/08 (lượt 2) — nhiệm vụ đã HẸP LẠI.** Cơ chế của GT-1 đã chốt bằng đọc code
> (`store.ts:798`, xem §2). Còn lại **đúng một** mệnh đề chưa kiểm: *tối 18/08 có thật sự hơn một tab
> cùng mở task `1786505684286` không* — và GT-2 (một tab cũng mất) chưa loại. Chạy **REPRO C trước
> REPRO A**: nếu C cho thấy một tab cũng mất thì đó là bug nặng hơn mọi thứ trong spec, và A trở nên
> thứ yếu.

---

## 1. Sự cố (một đoạn)

Run Builder `1786505684286` (kind = **build**, không phải consult). Người dùng hỏi 3 câu tối 18/08 →
sáng 19/08. Sau khi restart máy và mở lại app bằng `scripts/update-and-run.command`, **3 cặp hỏi–đáp
cuối biến mất khỏi UI** — nhưng vẫn nằm nguyên trên đĩa.

- Trên đĩa (`apps/builder/.runs/1786505684286/chat.jsonl`): đủ tới lượt **106**, mốc cuối 19/08 00:44 JST.
- Trong localStorage (`builder.thread.1786505684286`): dừng ở lượt **99/100**, mốc 18/08 18:55 JST.
- UI dựng thread cho build **chỉ** từ localStorage → 3 cặp ở giữa hai mốc đó vô hình.

---

## 2. ĐÃ CHỐT `[ĐO]` — đừng đo lại

| Sự việc | Nguồn |
|---|---|
| `chat.jsonl`: 106 dòng = 53 cặp, JSON hợp lệ, không truncate | đọc file |
| localStorage thread: 1.245.545 ký tự, 276 item, ba câu hỏi cuối = lượt 95/97/99 | console người dùng |
| **Quota KHÔNG phải thủ phạm**: tổng 2,07 MB / dư 2,88 MB / ghi thử 1,19 MB **thành công** | console người dùng |
| Bóc tách thread: `gate` 41 item / **793 KB (65 %)**, `qa` 87 / 313 KB, `run` 41 / 58 KB, `user` 107 / 58 KB | console người dùng |
| Thread có **87** `qa` nhưng đĩa chỉ có **53** cặp → ~34 ask **chưa từng** lên đĩa (đường ghi transcript mới có từ 13–14/08; task tạo 12/08) | đối chiếu |
| **Origin split KHÔNG phải thủ phạm**: `localhost:4123` (origin khác `127.0.0.1:4123`) chỉ được dùng 05/08, 12/08, 17/08 20:30 — không có mặt trong cửa sổ 18/08 tối | log server |
| Server restart trong cửa sổ: pid 14737 chết 18/08 19:29:37 → pid 59252 chết 22:15:57 → pid 64318 sống tới 19/08 08:21:42 | log server |

### Sự thật từ code (đọc là thấy, không cần đo)

- `GET /api/tasks/:id` **chỉ** trả `chat` khi `kind === 'consult'`; build chỉ nhận `lastAsk` = 1 cặp cuối — `apps/builder/server/routes/tasks.ts:412` và `:418`.
- `recoverOpenAsk` **chỉ điền** bong bóng đã có, `return null` khi không khớp — `apps/builder/web/src/lib/ask-recovery.ts:63`. Hai chỗ gọi (`store.ts:976`, `:990`) đều không tạo item mới.
- `openTask` dựng build từ `loadPersistedThread ?? promoteThreadFromLog ?? buildThreadFromRuns` — `store.ts:1835–1839`. Không mắt xích nào đọc `chat.jsonl`.
- `flushPendingAsk` **vứt im lặng** mọi chunk `ask:answer` khi không có `qa` đang mở — `store.ts:704`.
- **`applyAskDone` gán `thread.value = items` VÔ ĐIỀU KIỆN — `store.ts:798`** — kể cả khi `idx === -1`
  (không có bong bóng nào để đóng) và không có gì thay đổi. Mảng mới ⇒ effect persist (`store.ts:886–887`)
  thức dậy ⇒ **tab thụ động chắc chắn ghi thread thiếu của nó xuống localStorage.** Đây là mắt xích
  cuối của GT-1 và nó **đọc code là thấy** — xem §3.
- **`lastAsk` chỉ sinh ra ở handler `GET /api/tasks/:id`** (`tasks.ts:418` → `:438`), **không** nằm
  trong `toWireTask` ⇒ broadcast `task:update` (kể cả cái đường ask tự phát, `ask.ts:1128`) **không
  mang `lastAsk`**. Tab thụ động không có nó trong tay lúc `ask:done`.
- Hai chỗ gọi `recoverOpenAsk` (`store.ts:976`, `:990`) nằm trong **`onInit` của `connectSSE`**
  (`store.ts:951`) — chỉ chạy lúc stream **(re)connect**, **KHÔNG** phải lúc `ask:done`. Đường
  `ask:done` thật là `onAskDone: (d) => applyAskDone(d)` (`store.ts:1009`), và nó không gọi
  `recoverOpenAsk`, không fetch gì.
- `persistThreadNow` nuốt mọi lỗi `setItem` bằng `catch {}` rỗng — `store.ts:848`; và gán `_lastPersisted = json` **trước** `setItem` (`:839` → `:840`).
- Một tab mở **đúng một** EventSource cho một task: `connect()` đóng cái cũ (`sse-client.ts:71`), `openStream` gọi `teardown?.()` trước (`store.ts:948`).

---

## 3. CHƯA CHỐT — đây là việc cần làm

**Nguyên nhân gốc vẫn chưa xác định.** Ứng viên còn sống, xếp theo độ mạnh:

### GT-1 — Clobber đa tab (mạnh nhất) — **CƠ CHẾ ĐÃ CHỐT 19/08 lượt 2**
Tab B gõ câu hỏi → tab A (cùng task, không gõ) nhận `ask:answer` nhưng không có `qa` mở nên vứt hết
chunk (`store.ts:704`) → `ask:done` tới A → `applyAskDone` gán `thread.value` **vô điều kiện**
(`store.ts:798`) dù `idx === -1` → effect persist (`store.ts:886–887`) thức dậy → **A ghi thread thiếu
đè bản đủ của B.**

**Phần cơ chế không còn là giả thuyết** — đọc `store.ts:798` là thấy. **REPRO A vì vậy KHÔNG còn để
kiểm cơ chế**; nó chỉ còn để trả lời đúng một mệnh đề: *tối 18/08 có thật sự hai tab cùng mở task
`1786505684286` không.* Nếu bước 5 của REPRO A cho thấy số `qa` **có** tăng thì nghĩa là môi trường
test khác giả định (ví dụ tab A đã bị trình duyệt throttle), **không** phải cơ chế sai — kiểm lại
`store.ts:798` trước khi kết luận.

### GT-2 — Một tab, ghi bị bỏ lỡ vì lý do khác
`task.value` null lúc effect chạy, race trong `openTask` (`_lastPersisted = ''` rồi gán lại thread),
hoặc debounce bị đói. Kiểm bằng **REPRO C** §4.

### GT-3 — Tab đã đóng từ trước 22:24
Nếu tab duy nhất đang mở là tab "cũ" (thread tới lượt 99) và người dùng hỏi từ một tab khác vừa mở
rồi đóng ngay, thứ tự ghi có thể cho tab cũ thắng. Là biến thể của GT-1.

### ❌ Vì sao log server KHÔNG chốt được GT-1

Đã thử và **thất bại — đừng lặp lại**: `apps/builder/.runs/dev-restart.log` ghi mọi request kể cả
`GET /api/tasks/:id/stream`, nhưng **không bao giờ ghi nhận client ngắt kết nối** — mọi stream đều
chỉ "kết thúc" đúng lúc process chết. Vì vậy:

- Thời điểm **mở** stream là thật.
- Thời điểm **đóng** là giả → **mọi phép đếm "bao nhiêu stream cùng sống" đều vô nghĩa.**
- Hai lần mở cách nhau 1–2 giây ngay sau restart server (22:15:59 và 22:16:00) **không** phân biệt
  được "hai tab cùng reconnect" với "một tab reconnect hụt rồi thử lại".

Muốn dùng log để chốt thì phải **thêm log lúc SSE đóng** trước đã — đó là spec 099 **S0**, và chỗ
gắn đã chốt: một dòng `log.info` trong **`cleanup()`** (`apps/builder/server/plugins/sse.ts:218`),
choke point duy nhất và idempotent của cả hai hook `request.raw.on('close'|'error')` (`sse.ts:262–263`),
kèm `taskId` + `sse.clients.size`. Là thay đổi code — cần hỏi người dùng trước.

---

## 4. Các repro cần chạy

Mọi repro chạy trên app thật: `bash scripts/update-and-run.command`, mở `http://127.0.0.1:4123`
(**đúng origin này**, không dùng `localhost:4123` — khác localStorage).
Dùng một build **thí nghiệm** riêng, đừng dùng `1786505684286`.

### REPRO A — kiểm GT-1 (clobber đa tab)

```
1. Mở HAI tab, cả hai cùng mở đúng một build task thí nghiệm.
2. Tab B: hỏi một câu, đợi trả lời xong.
3. Tab A: không chạm gì. Quan sát — cặp hỏi/đáp KHÔNG hiện ra ở đây.
4. Đĩa:  tail -2 apps/builder/.runs/<taskId>/chat.jsonl   → phải CÓ cặp vừa hỏi.
5. Console (tab nào cũng được) — PHÉP QUYẾT ĐỊNH:
   JSON.parse(localStorage['builder.thread.<taskId>']).filter(x=>x.kind==='qa').length
   • số KHÔNG tăng  → clobber tái hiện được, khớp cơ chế đã đọc từ code.
   • số CÓ tăng     → KHÔNG kết luận "cơ chế sai" (store.ts:798 vẫn đứng đó). Nghĩa là ca này
                      không kích hoạt được — thường vì tab A bị trình duyệt throttle/ngủ, hoặc
                      thứ tự ghi ngẫu nhiên cho B thắng. Ghi lại rồi sang REPRO C.
6. Hard reload tab B và xác nhận điều bước 5 dự đoán.
```

### REPRO B — nghiệm thu fix S1 (không phụ thuộc thủ phạm)

```
1. Mở một build có ≥1 ask, đóng tab.
2. Console:  localStorage.removeItem('builder.thread.<taskId>')
3. Mở lại build đó.
   • HIỆN TẠI (bug): thread chỉ còn requirement + các phase, sạch bóng ask.
   • SAU S1: các cặp ask hiện lại từ transcript, kèm dấu mốc "khôi phục".
```

### REPRO C — kiểm GT-2 (một tab vẫn mất)

```
1. CHỈ MỘT tab. Mở build thí nghiệm.
2. Ghi lại số qa:  JSON.parse(localStorage['builder.thread.<id>']).filter(x=>x.kind==='qa').length
3. Hỏi một câu, đợi xong, đợi thêm 5 giây (debounce max-wait là 3s).
4. Đo lại số qa ở bước 2.
   • tăng đúng 1 → đường ghi một-tab LÀNH MẠNH, GT-2 loại, thủ phạm nằm ở đa tab.
   • không tăng  → có bug ghi ngay cả với một tab; đó mới là hướng chính.
5. Lặp lại bước 3–4 sau khi CHUYỂN sang task khác rồi quay lại (đường openTask).
```

---

## 5. Luật đo lường bắt buộc cho phiên mới

Ba lần chẩn đoán đầu đều sai. Nguyên nhân chung: **suy từ bản thế thân thay vì đo chính hiện vật.**

1. **Đo chính artifact.** Đĩa chỉ giải thích được 16 % trọng lượng thread thật — mọi suy luận dựa
   vào đĩa về nội dung localStorage đều là `[CẬN DƯỚI]`, không được dùng để bác bỏ/xác nhận gì.
2. **Hiệu chuẩn dụng cụ trước khi tin nó.** Bản phân tích log đầu tiên ghép `reqId` mà quên `reqId`
   lặp lại sau mỗi lần restart → báo "16 stream cùng lúc" hoàn toàn giả. Phép kiểm rẻ mà bắt được:
   *có span nào thời lượng âm không?* Luôn chạy một phép kiểm kiểu vậy trước khi đọc kết quả.
3. **Biết dụng cụ mù chỗ nào.** Log không ghi lúc SSE đóng → dụng cụ mù với đúng câu hỏi đang hỏi.
   Nhận ra giới hạn quan trọng hơn ép số ra kết luận.
4. **Nhãn bằng chứng**: `[ĐO]` (nêu nguồn + cỡ mẫu) · `[CẬN DƯỚI]` (chỉ dùng làm "ít nhất") ·
   `[REPRO]` (lệnh tái hiện tất định) · `[GIẢ THUYẾT]` (chưa kiểm — **không** slice nào được xây trên nó).

---

## 6. Sau khi có kết quả

1. Cập nhật §1 của [spec 099](099-build-ask-history-survives-the-browser.md): đổi nhãn của GT tương
   ứng từ `[GIẢ THUYẾT]` sang `[ĐO]`/`[REPRO]`, và ghi rõ GT nào bị loại.
2. S1 và S1b của spec **đúng dù thủ phạm là gì** — kết quả repro chỉ quyết định S1b là "chặn tận
   gốc" hay chỉ "vá thêm một lỗ". Đừng chờ repro mới bắt đầu S1.
   **Lưu ý: S1b đã được THIẾT KẾ LẠI 19/08 lượt 2** (spec 099 §1.3 lỗi ①). Bản cũ định nới
   `recoverOpenAsk`; hướng đó **không chạy** vì tab thụ động không có `lastAsk` và không đi qua hàm đó
   trong lượt. Bản mới: lớp 1 = `applyAskDone` chỉ gán `thread.value` khi `idx !== -1`; lớp 2 =
   `onAskDone` ở tab thụ động gọi backfill của S1. Đừng implement theo bản cũ.
3. Nếu REPRO C cho thấy một-tab cũng mất → đó là bug nặng hơn nhiều so với mọi thứ trong spec hiện
   tại; quay lại báo người dùng trước khi đi tiếp.

---

## 7. Một hiểm hoạ phụ, đã đo, chưa có chỗ trong spec

App phục vụ trên **hai origin**: `127.0.0.1:4123` (launcher mở) và `localhost:4123` (người dùng đã
từng vào — 05/08, 12/08, 17/08). Hai origin = **hai localStorage tách biệt**. Một bookmark trỏ vào
`localhost` sẽ hiện một lịch sử khác hẳn mà không báo gì. Không phải nguyên nhân sự cố lần này
(đã loại bằng log), nhưng là bẫy y hệt đang chờ. Đáng cân nhắc: redirect `localhost` → `127.0.0.1`
ở tầng server, hoặc cảnh báo trên UI.
