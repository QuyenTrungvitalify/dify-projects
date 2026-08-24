# Spec 109 — Một câu CHƯA GỬI ĐƯỢC chỉ được sống ở ĐÚNG MỘT chỗ

> **Status**: **đã implement 2026-08-25** (S1+S2+S3, một lượt) — **chờ nghiệm thu trên app thật**,
> sau đó đóng bằng `/spec-close 109`. Lập 2026-08-24, từ ca thật của user: gửi một câu lúc server
> đang giữ khoá turn → banner `a turn is already running`, thử lại hai lần nữa → **ba bong bóng
> giống hệt nhau** trong hội thoại, trong khi **không turn nào** từng tới server.
>
> Đụng: `web/src/store.ts` (`dropThreadItems` + 3 catch + `surfaceError` + `surfaceTurnBusy`) ·
> `web/src/lib/turn-busy.ts` (mới) · `web/src/lib/i18n.ts` (`turnBusy` EN+JA) ·
> test `web/src/store.undelivered.test.ts` + `web/src/lib/turn-busy.test.ts`. **Không một dòng server.**
>
> Phạm vi — **đường DISPATCH THẤT BẠI của composer** (`start` / `reply` / `ask`). Ba lát:
> **S1** gỡ item lạc quan khi dispatch fail ·
> **S2** một Ask bị nuốt lúc đang bận phải nói ra ·
> **S3** banner 409 nói được tiếng người và trỏ vào lối thoát.
> **Thứ tự ship: S1 → S3 → S2** (§5).
>
> **Không chạm**: khoá turn phía server (`server/routes/tasks.ts`) · giao kèo spec 040 D2
> (dispatch fail ⇒ resolve `false`, không bao giờ reject) · guard `disabled={busy || asking}` ·
> định dạng persist (`serializeThread`) · đường ĐỌC LẠI của 107 · quyền sở hữu hội thoại (033 D6).
>
> Liên quan: [107](107-a-rebuilt-thread-must-keep-the-users-words.md) — **cùng một nguyên tắc, dấu
> ngược lại**: 107 lo bản dựng lại *thiếu chữ*, spec này lo bản dựng lại *thừa chữ chưa từng gửi*.
> S1 **dựa lưng** vào đường đọc lại của 107 (§4.2) nên không được ship trước khi hiểu §4.2.

---

## 0. Nguyên tắc

Kế thừa 6 nguyên tắc của [099 §2] và nguyên tắc 7 của [107 §0] (*"thiếu thì chấp nhận được, gây
hiểu nhầm thì không"*). Ca này sinh thêm một cái, và nó là cái quyết định mọi lát dưới:

> **8. Một câu người dùng chưa gửi được chỉ được sống ở ĐÚNG MỘT chỗ.**
>
> Hoặc nó nằm trong **composer** — nghĩa là *chưa gửi, bạn cầm nó, bấm lại đi*. Hoặc nó nằm trong
> **thread** — nghĩa là *đã gửi, server đã nhận*. **Không bao giờ cả hai.** Hôm nay nó nằm cả hai,
> và đó là toàn bộ cơ chế sinh lỗi: người dùng thấy chữ quay lại ô nhập nên bấm gửi tiếp, mỗi lần
> bấm đẻ thêm một bong bóng ma.

Hệ quả trực tiếp — **thread vẽ những gì server đã nhận, không vẽ ý định của người dùng.** Cái gì đĩa
không có, thread không được vẽ như thể đã có.

---

## 1. Sự cố

### 1.1 Một câu

`reply()` đẩy bong bóng người dùng vào thread **trước** khi POST; khi POST 409 nó chỉ gọi
`surfaceError` rồi `return false` — **không gỡ bong bóng**; còn `App.send` nhận `false` thì **trả
chữ về composer**. Một câu, hai chỗ. Thử lại = ghost thứ hai.

### 1.2 Bằng chứng

**[REPRO]** — tất định, chạy trong `apps/builder/web`:

```bash
cat > src/store.ghostrepro.tmp.test.ts <<'EOF'
import { describe, it, expect, vi } from 'vitest';
import { api, ApiError } from './api';
import { reply, task, thread } from './store';
import type { WireTask } from './types';
describe('repro 109', () => {
  it('every 409 leaves a ghost user bubble', async () => {
    task.value = { taskId: 't1', project: null, workflow: null, workflowFile: 'main.yml',
      requirement: 'r', seedPath: null, deploy: 'none', confirmMode: 'each_step', phase: 'spec',
      status: 'awaiting_confirm', workflowSlug: null, name: null, sessionIds: {}, artifacts: {},
      rev: 1 } as WireTask;
    thread.value = [];
    vi.spyOn(api, 'reply').mockRejectedValue(new ApiError(409, 'a turn is already running'));
    for (let i = 0; i < 3; i++) await reply('review lai workflow', 'Requested changes');
    expect(thread.value.filter((i) => i.kind === 'user').length).toBe(3); // 3 ghost, 0 turn
  });
});
EOF
npx vitest run src/store.ghostrepro.tmp.test.ts && rm src/store.ghostrepro.tmp.test.ts
```

Chạy 2026-08-24: **xanh** — ba bong bóng `user` trùng nội dung, `api.reply` reject cả ba lần.

**[ĐO]** Ba đường xử lý cùng một tình huống "bận" theo **ba kiểu khác nhau** (đo bằng chính repro trên,
mở rộng cho `ask`):

| Đường | Thread sau khi fail | Banner | Chữ về composer |
|---|---|---|---|
| `reply()` 409 | **+1 bong bóng trần, không dấu hiệu gì** | có | có |
| `ask()` 409 | +1 bong bóng + qa gắn lỗi (đọc còn trung thực) | có | có |
| `ask()` lúc `asking===true` | **không gì cả** | **không** | có |

Ba kiểu cho một tình huống là chính nó đã là lỗi: người dùng không học được quy tắc nào từ giao diện.

**[ĐO]** Ghost **sống sót qua reload**: `hydrateForReopen` (`lib/thread-persist.ts`) chỉ lọc gate chưa
resolve và đóng run đang chạy — nó **cố ý giữ `user`/`qa`**. Nên ba câu ma được `serializeThread` ghi
xuống localStorage và dựng lại nguyên vẹn ở lần mở sau. Bản dựng lại đang kể một chuyện có thật **sai**.

**[GIẢ THUYẾT]** — *không lát nào xây trên cái này*: guard `disabled={busy || asking}` chặn được gửi
khi tab NÀY biết có turn, nên ca thật xảy ra khi FE tưởng rảnh mà server đang giữ khoá (tab khác /
SSE trễ / ask ở chat-lane của 082). Chưa có repro cho *vì sao* FE lệch; **nhưng không cần** — khoá là
của server, FE không bao giờ đoán đúng 100%, nên đường-fail phải sạch bất kể nguyên nhân lệch.

### 1.3 Vì sao "chỉ hơi xấu" là chẩn đoán sai

1. Thread là **thứ người dùng đọc lại để nhớ mình đã yêu cầu gì**. Ba dòng ma nói "tôi đã đòi ba lần
   mà nó phớt lờ" — trong khi server chưa nhận câu nào.
2. Nó **durable**, không transient (§1.2), nên sai sót không tự dọn.
3. Nó **rơi thẳng vào vùng 107 đang sửa**: hai spec cùng chạm bản dựng lại, ngược dấu nhau. Sửa 107
   xong mà để nguyên cái này thì bản dựng lại vẫn không đáng tin.

---

## 2. S1 — dispatch fail thì gỡ đúng cái mình vừa đẩy

**Luật**: mọi hàm đẩy item vào `thread` *trước* khi biết POST thành công phải **gỡ đúng những id đó**
trong `catch`. Sau S1, composer là **nhà duy nhất** của một câu chưa gửi được.

**Đụng**: `store.ts` — `reply()`, `ask()`, `start()`.

- Thêm một helper cục bộ, ví dụ `dropItems(ids: string[])`, gỡ **theo id** chứ **không theo
  index/độ dài**: giữa lúc `await` một sự kiện SSE có thể đã chèn item, cắt theo `slice(0, n)` sẽ
  ăn nhầm nội dung thật. Đây là chỗ dễ sai nhất của lát này.
- `ask()`: gỡ **cả** `user` lẫn `qa` — và **xoá luôn** khối "finalize qa với lỗi" hiện có. Sau S1 lỗi
  chỉ kể một lần, ở banner. (Lát này làm `ask()` *ngắn đi*, không dài ra.)
- `start()`: `thread.value = [user]` rồi fail → để lại một bong bóng ở màn hình trống. Không ai thấy
  hôm nay, nhưng nó vi phạm cùng bất biến — dọn cho bất biến phát biểu được **không có ngoại lệ**.
- **Không** đổi `App.send`: giao kèo 040 D2 (`false` ⇒ giữ draft + files) là **vế còn lại** của
  nguyên tắc 8 và đã đúng sẵn.

**AC**

- AC1 `reply()` 409 ×3 ⇒ `thread` **không thêm item nào**; draft vẫn về composer.
- AC2 `ask()` 409 ⇒ không còn item `user` lẫn `qa` nào của lần gọi đó.
- AC3 Một item do SSE chèn trong lúc `await` **vẫn còn nguyên** sau rollback (test này là lý do luật
  "gỡ theo id" tồn tại — nó phải **đỏ khi gỡ fix**).
- AC4 Reload sau ba lần fail ⇒ hội thoại dựng lại **không có** bong bóng nào của ba lần đó.
- AC5 Đường **thành công** không đổi một byte: bong bóng vẫn hiện ngay lúc gửi (lạc quan), `stampUploads`
  vẫn đóng dấu đúng item.

---

## 3. S3 — một "bận" phải nói được tiếng người, và trỏ vào lối ra

Hôm nay banner in **nguyên văn chuỗi server**: `a turn is already running — try again in a moment`
(`server/routes/tasks.ts`) — tiếng Anh thô giữa UI tiếng Nhật, và nó khuyên đúng thao tác đẻ ra ghost.

**Đụng**: `store.ts` `surfaceError` + `lib/i18n.ts` (EN/JA) + `App.StartErrorBanner`.

- 409-va-chạm-turn ⇒ FE **tự chọn câu chữ**, không hiển thị text server. Text server còn nguyên trên
  wire cho log/dev.
- **Nhận diện bằng chuỗi wording-stable** (`lib/turn-busy.ts`), *không* bằng `holder`. `docs/state`
  ghi "409 có holder = va lock, không holder = trượt validation" — đó là tín hiệu các test **route**
  dùng; phía client `ApiError` chỉ giữ `holder` khi body gửi nó dạng string, nên một va-lock không
  kèm id sẽ tụt lại thành tiếng Anh thô. Câu chữ mới là thứ client luôn nhận được. Lý do này nằm
  trong comment của module — đừng cân lại từ đầu.
- Câu mới nói **ba** điều: đang có một lượt chạy · lời của bạn **vẫn nằm trong ô nhập** · muốn chen
  ngang thì bấm **Dừng**. Bỏ hẳn "try again in a moment".
- `busyHolder` đã có nút **開く** nhảy tới build đang giữ khoá — giữ nguyên.

> ⚠️ **Sửa bản nháp đầu (phát hiện lúc review, 2026-08-25).** Bản nháp định cho banner **mọc thêm một
> nút 停止**. Sai: spec 097 đã gỡ đúng một nút Stop thừa với lý do *"hai nút Stop cho một hành động
> đọc thành hai hành động khác nhau"*, và Stop **đã có mặt sẵn** trong đúng hai tình huống banner này
> nổ — pill Stop trên top-bar khi build chạy (`busy`), nút Stop trong qa bubble khi đang trả lời.
> Nút thứ ba là tái phạm chính lỗi 097 vừa sửa. **S3 là copy + i18n, KHÔNG control mới**: câu chữ trỏ
> vào nút đang có trên màn hình. Chữ dùng chung cho cả hai tình huống nên không hứa một nút Stop không
> tồn tại khi kẻ giữ khoá là **build khác** (ca đó đã có 開く).

**AC**

- AC6 Một 409-va-chạm-turn ⇒ banner **không** chứa chuỗi tiếng Anh của server, ở cả `lang=ja` lẫn `en`.
- AC7 Các 409 **khác** (trùng slug project…) **không** bị nuốt vào câu chữ này — chúng đi đường
  `mapCreateError`, phải còn nguyên hành vi.

---

## 4. Rủi ro đã cân, không phải bỏ sót

### 4.1 Người dùng mất chữ vì rollback?

Không: `App.send` trả draft + files về composer trên **cùng** một `false`. Test phải khoá **cả cặp**
(thread sạch **và** draft quay lại) trong một assertion, nếu tách hai test thì một nửa hồi quy đi lọt.

### 4.2 POST fail nhưng server *đã* dispatch (5xx, mất response)

Cửa sổ này có thật (409 thì chắc chắn không dispatch; 5xx thì không chắc). Rollback khi đó xoá một
dòng mà server **có** nhận. Chấp nhận, vì:

1. Lượt đó nằm trên **đĩa**, và đường đọc lại phát lại nó — đó đúng là thứ [107](107-a-rebuilt-thread-must-keep-the-users-words.md) đang làm cho đủ.
2. Cân đối rủi ro không đối xứng: **thiếu tạm** (một reload là về) đổi lấy việc diệt **bịa durable**.
   Nguyên tắc 7 của 107 đã xử vụ này rồi.

⚠️ Ràng buộc thứ tự: nếu 107 S1 trượt, S1 ở đây vẫn ship được (409 chiếm gần hết ca thật), nhưng
**phải** ghi lại rằng chỗ dựa của §4.2 chưa đứng.

### 4.3 Bong bóng "biến mất" có làm người dùng hoảng?

Đây là lý do S3 đi ngay sau S1 chứ không xếp cuối: chữ *trông như* biến mất khỏi hội thoại, nên banner
bắt buộc phải nói *"lời của bạn vẫn nằm trong ô nhập"*. S1 mà không có S3 là nửa vời.

---

## 5. S2 — im lặng còn khó hiểu hơn báo lỗi (xếp cuối, có lý do)

`ask()` mở đầu bằng `if (asking.value) return false` (defense-in-depth cho bất biến một-qa-mở của
`findOpenAskIdx`). Giữ nguyên **hành vi chặn**; chỉ bỏ **sự im lặng**: phát cùng một banner như S3.

Xếp cuối vì nó rẻ nhất **và** vì nó tiêu thụ câu chữ do S3 sinh ra — làm trước thì phải viết chuỗi hai lần.

**AC8** `ask()` lúc `asking===true` ⇒ vẫn không POST, vẫn `false`, **nhưng** banner bật lên và draft ở lại.

---

## 5b. Kết quả implement (2026-08-25)

- **Toàn bộ AC1–AC8 có test khoá** (13 test), và 6/10 test của vòng đầu **đỏ khi revert `store.ts`** (đã bắn thử: revert →
  6 đỏ / 4 xanh; 4 xanh là test canh đường-thành-công + 409-khác + `holder`, chúng là *guard*, không
  phải *bằng chứng fix*). Suite đầy đủ: web **469 xanh / 43 file**, server **1199 xanh**, `tsc` sạch.
- **Q3 đã trả lời**: `start()` fail được dọn luôn — bất biến phát biểu **không ngoại lệ**, và AC không
  cần test UI vì màn hình trống không render `thread`.
- **Q1 đã trả lời**: **không** thêm dòng timeline cho một ask hỏng. Banner đã kể; thêm item lại chạm
  đúng persist mà lát này vừa dọn.
- **Q2 trả lời được một nửa** (phát hiện ở vòng review thứ hai, không có trong bản nháp): trước đây
  `clearErrors()` chỉ chạy ở `start`/`startConsult`/`openTask`/`resetToNew` — **không** ở `reply`,
  `ask`, `confirm`. Nên sau khi hết bận và gửi lại thành công, banner *"đang có một lượt chạy — lời
  của bạn vẫn ở ô nhập"* **vẫn đứng nguyên**, mô tả một trạng thái vừa kết thúc, ngay cả khi ô nhập
  đã trống. Cùng một loại lỗi với ghost, ở một bề mặt khác. Đã sửa: một lần thử mới xoá banner của
  lần trước, ở cả ba đường (`confirm` có mặt vì ca thật bấm đúng vào nút gate).
  **Còn lại của Q2**: banner chưa tự tắt khi turn của **build khác** kết thúc mà người dùng không gửi
  gì thêm — cần tín hiệu SSE. Ai đóng spec nhớ **mang phần này sang mục để-ngỏ của CAMPAIGNS.md**.
- Lát này làm `ask()` **ngắn đi** (khối finalize-qa-với-lỗi bị xoá) — đúng như §2 dự đoán.

## 6. Non-goals

- **Không** làm hàng đợi gửi lại tự động. "Thử lại" là quyết định của người dùng; auto-retry lên một
  khoá turn toàn cục là cách đẻ ra chính vòng lặp mà spec này đang diệt.
- **Không** thêm trạng thái "未送信/chưa gửi" cho item thread (phương án B đã cân, xem §7).
- **Không** siết thêm guard phía FE để "đừng bao giờ 409". Khoá là của server; FE đoán chỉ đẻ thêm
  đường lệch. Đường-fail sạch mới là lời giải.
- **Không** đụng khoá turn hai làn (chat lane / build lane) của 082.

---

## 7. Phương án đã cân và LOẠI

**B — giữ bong bóng, gắn nhãn "chưa gửi" + nút Gửi lại, và KHÔNG trả draft về composer.**
Cũng thoả nguyên tắc 8 (một chỗ duy nhất: thread). Loại vì: (i) đẻ trạng thái item mới → chạm
`serializeThread`, chạm đường dựng lại của 107, chạm cả `hydrateForReopen` (một "chưa gửi" persist
xuống rồi restore lên thì nó là gì?); (ii) phá giao kèo 040 D2 vốn đang đúng; (iii) đắt hơn hẳn cho
cùng một kết quả. Ghi lại ở đây để lần sau không cân lại từ đầu.

---

## 8. Open questions

1. **Q1** — Sau S1, `ask()` fail có nên để lại **một dòng timeline** (không phải bong bóng) kiểu
   *"một câu hỏi không gửi được lúc HH:MM"*? Nghiêng **không**: banner đã kể, và thêm item lại chạm
   đúng persist. Chốt lúc implement S1.
2. **Q2** — Banner 409 nên tự tắt khi turn đang giữ khoá kết thúc (SSE báo) hay để người dùng tự bỏ
   qua? Nghiêng **tự tắt**, vì lúc đó lời khuyên trong banner đã hết đúng.
3. **Q3** — `start()` fail để lại bong bóng ở màn hình trống: có ca nào màn hình đó **thật sự render**
   `thread` không? Nếu không, S1 vẫn dọn (bất biến không ngoại lệ) nhưng AC khỏi cần test UI.
