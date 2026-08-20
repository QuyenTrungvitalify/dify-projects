# 102 — Mức tiêu thụ phải nhìn thấy được TRƯỚC khi nó làm ai đó bất ngờ

> Trạng thái: **mở**, chưa implement. Lập 2026-08-20.
> Sinh ra từ một câu hỏi lúc review spec 100: *"có cách nào an toàn hơn không — mỗi lần reset hay build
> lại check được gói của người dùng, hoặc tạo một tab setting riêng để user tự chỉnh?"*
> Phạm vi: **làm cho chi phí/hạn mức nhìn thấy được và dừng được.** Ba slice — S1 hiện mức tích luỹ ·
> S2 ngưỡng **CẢNH BÁO** (không phải ngưỡng reset) · S3 gắn nhãn cho đúng bằng `authMethod`.
> **Không chạm ngưỡng reset của [spec 100](100-ask-session-reset-doom-loop.md)** — §4 giải thích vì sao,
> và §4.1 ghi lại thiết kế đã **bị loại** để không ai đề xuất lại.
>
> ⚠️ Các liên kết tới spec 099/100/101 chỉ phân giải trên nhánh
> `fix/builder-ask-history-and-session-reset`; trên `main` chúng chưa tồn tại.

---

## 1. Vấn đề

Không có sự cố nào ở đây. Có một **khoảng trống**: người dùng không biết một hội thoại đã tiêu bao
nhiêu **cho tới khi đã tiêu xong**, và ứng dụng không có chỗ nào để họ nói *"đến mức này thì nhắc tôi"*.

Trên máy tác giả điều đó chịu được — có `?dev=1`, có `.runs/`, có terminal. Trên một máy khác thì
không: người dùng chỉ thấy câu trả lời, không thấy giá của nó.

### Bằng chứng

| Nhãn | Sự việc |
|---|---|
| `[ĐO]` | Chi phí từng lượt **đã** được ghi sẵn trên đĩa (`cost` trên dòng assistant của `chat.jsonl`): `totalCostUsd`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`, `model`, `durationMs`. **Không cần thu thập gì mới.** |
| `[ĐO]` | Nhưng nó chỉ hiện trong **dev tip** (`?dev=1`), theo **từng lượt**, và **không có tổng tích luỹ**. Người dùng thường không thấy gì cả. |
| `[ĐO]` | Trên một run thật: **$79,56 / 33 lượt** có ghi cost. Năm lượt chiếm ~$34 trong đó. Không có màn hình nào nói điều này trong lúc nó đang xảy ra. |
| `[ĐO]` | **Kích thước hội thoại giải thích rất ít về chi phí.** Cùng build: **1,57M token → $0,98**; **794k → $7,90**; và ~800k → **$0,55/lượt** cho sáu lượt liên tiếp. Cùng khối lượng, chênh **14 lần**. Thứ quyết định là prefix có phải **viết lại vào cache** hay không. |
| `[ĐO]` | `claude auth status` trả JSON có `subscriptionType` (`max`), `authMethod` (`claude.ai`), `apiProvider` (`firstParty`), `loggedIn`. Một lần gọi **~0,59 s**. |
| `[ĐO]` | Cùng JSON đó **cũng trả `email`, `orgId`, `orgName`** — dữ liệu cá nhân. Xem nguyên tắc 4. |
| `[ĐO code]` | Trên subscription, `totalCostUsd` **vẫn được ghi**, nhưng đó là con số CLI **tự tính theo giá niêm yết**, không phải tiền bị trừ. Dev tip đang hiện "$0,55" như thể là hoá đơn — **sai về bản chất**, không chỉ về đơn vị. |
| `[ĐO code]` | Đã có sẵn một **registry setting** mở rộng được: `server/lib/settings.ts` — `FIELDS` khai báo `key/label/help/type/section`, có sẵn `type: 'number'` và `envFallback`; override nằm ở `.dify-settings.local.json` (**gitignored, per-máy**), **đọc lúc dùng nên không cần restart**. Header của chính nó ghi: *"Adding a setting = one entry in FIELDS + one consumer that reads it."* |
| `[ĐO code]` | Nhưng modal đó **chỉ mở dưới `BUILDER_DEV=1`** — người dùng thường không với tới. |

---

## 2. Nguyên tắc thiết kế

1. **Bất ngờ đến từ việc KHÔNG BIẾT cho tới khi xong.** Nên đòn đầu tiên là **hiển thị**, không phải
   một chính sách tự động. Một con số nhìn thấy được cho phép người ta tự dừng; một cơ chế tự động
   quyết định thay họ thì không.
2. **Chỉ hỏi người dùng những câu họ trả lời được.** *"Nhắc tôi khi một hội thoại vượt X"* là câu trả
   lời được. *"Reset phiên ở bao nhiêu token"* thì **không** — chính tác giả còn chưa xác định được giá
   trị đúng, và trực giác (*"để thấp cho an toàn"*) thì **ngược** (§4.1).
3. **Đo cái mình muốn kiểm soát.** `askSessionTokens` là **đại lượng thế thân**: 1,57M tốn $0,98 còn
   794k tốn $7,90. Mọi thứ spec này thêm vào phải hiển thị **con số đã ghi thật**, không phải một ước
   lượng dẫn xuất.
4. **Không lấy dữ liệu cá nhân, và không để nó rời khỏi máy.** `claude auth status` có `email`/`orgId`/
   `orgName`. Chỉ được đọc `authMethod`/`apiProvider`; **không log, không đưa vào `task.json`, không
   đưa vào bundle export** — bundle là thứ rời khỏi máy người dùng.
5. **Không đụng ngưỡng reset.** Đó là cơ chế của spec 100 và nó đang được chỉnh bằng số đo. Trộn một
   tín hiệu mới vào đó là làm hỏng cả hai (§4).

---

## 3. Slices

### S1 — Hiện mức tiêu thụ tích luỹ của một hội thoại **(cốt lõi; không cần S2/S3)**

**Dữ liệu đã có sẵn** — đây là slice rẻ nhất và giá trị cao nhất.

Cộng dồn `cost` của các dòng assistant trong `chat.jsonl` của task, hiện ở chỗ người dùng **thường**
nhìn thấy (không phải sau `?dev=1`). Tối thiểu: **tổng token** của hội thoại và **số lượt**.

- Đọc phía server, cùng đường đã có: `readConsultChat` → cộng dồn. Không file mới, không đường ghi mới.
- Trả kèm route đã có của spec 099 (`GET /api/tasks/:id/chat`) hoặc một field trên snapshot — **quyết
  định lúc implement**, nhưng **không** nhồi vào `GET /api/tasks/:id` nếu nó làm nặng đường nóng
  (nguyên tắc 5 của spec 099).
- Các lượt **không có** `cost` (mọi lượt trước khi tính năng ghi cost ra đời) phải được **nói ra**, chứ
  không lặng lẽ tính là 0 — trên run thật là **35/68 lượt**. Một tổng thiếu 35 lượt mà trông như đầy đủ
  còn tệ hơn không hiện gì.

### S2 — Ngưỡng **CẢNH BÁO**, và đây mới là ô setting đáng có

Một ngưỡng người dùng đặt được: *"nhắc tôi khi một hội thoại vượt X"*. Chạm ngưỡng → **một** thông báo,
**một lần**, và hội thoại **vẫn tiếp tục**.

- **Không dừng, không reset, không chặn.** Nó chỉ nói. Mọi thứ mạnh hơn đều là quyết định thay người
  dùng bằng một con số mà ứng dụng không biết có đúng không.
- Cắm vào registry sẵn có: **một entry trong `FIELDS`** (`type: 'number'`, `envFallback`) + **một
  consumer**. Không cần đổi UI.
- **Điều kiện bắt buộc:** modal Settings hiện chỉ mở dưới `BUILDER_DEV=1`. Slice này **vô nghĩa nếu
  không mở nó cho người dùng thường** — đó là phần việc thật của S2, không phải bản thân ô setting.
- Mặc định: **tắt**. Một cảnh báo không ai đặt là một cảnh báo không ai hiểu.

### S3 — Gắn nhãn cho đúng: hạn mức hay tiền

Đọc `authMethod`/`apiProvider` **một lần lúc boot**, cache lại, hỏng thì **im lặng bỏ qua** (coi như
không biết → hiện đơn vị trung tính).

- `apiProvider: firstParty` + `authMethod: claude.ai` ⇒ subscription ⇒ con số là **hạn mức đã dùng**,
  không phải tiền. Hiện "usage", **không** hiện "$".
- API key ⇒ tiền thật ⇒ hiện "$".
- **Không đọc, không lưu, không log** `email`/`orgId`/`orgName` (nguyên tắc 4).

**Đây là slice sửa một sự thiếu trung thực đang tồn tại**, không phải thêm tính năng: hôm nay app hiện
một con số đô-la cho một tài khoản không bị trừ đồng nào.

---

## 4. Non-goals

- **Không đụng `ASK_RESET_TOKENS` hay logic reset** — đó là spec 100.
- **Không tự động dừng, tự động reset, hay chặn câu hỏi** khi chạm ngưỡng. S2 chỉ nói.
- **Không thu thập gì mới** — mọi con số đã nằm trên đĩa từ trước.
- **Không đưa danh tính tài khoản vào bất kỳ artifact nào** (`task.json`, `events.jsonl`, bundle).
- **Không hiển thị chi phí trong `chat.jsonl`** dưới dạng mới — định dạng file không đổi.

### §4.1 Thiết kế ĐÃ BỊ LOẠI: dùng gói tài khoản để đặt ngưỡng reset

Đề xuất ban đầu là *"dev mode thì 1M, còn lại thì thấp hơn"*, rồi *"phát hiện gói rồi đặt ngưỡng theo
gói"*. **Cả hai đều bị loại, và lý do đáng ghi lại vì cả hai nghe rất hợp lý.**

**Dev mode là trục sai.** `BUILDER_DEV=1` mở các endpoint dev (`/api/dev/rebuild`, `/shelf`,
`/settings`). Nó nói *"máy này có công cụ dev"*, **không** nói gì về tài khoản. Một người dùng gói nhỏ
bật dev mode sẽ nhận giá trị hào phóng; người gói lớn không bật lại nhận giá trị dè dặt. Trùng hợp,
không phải chính sách.

**Phát hiện gói thì LÀM ĐƯỢC — nhưng nó trả lời sai câu hỏi.** `claude auth status` cho `subscriptionType`
thật. Nhưng gói cho biết **"còn bao nhiêu hạn mức"**, trong khi vấn đề của ngưỡng là **"reset giúp hay
hại"** — và cái đó phụ thuộc **kích thước artifact**, không phụ thuộc gói.

**Và hạ ngưỡng cho gói nhỏ nhiều khả năng phản tác dụng.** Hội thoại **chính là** thứ giúp model nhớ
file nó đã đọc. Reset làm nó đọc lại — trên `main.yml` lớn, một lần đọc lại là **400k+ token**, đủ vượt
ngưỡng lần nữa. `[ĐO]` lượt 110 là phiên **vừa reset xong**, vẫn **442k**, vẫn **$1,02**: reset ở đó
mua được **con số không**. Vật lý đó **không đổi theo gói**.

⇒ Biết chính xác gói chỉ giúp chọn **tự tin hơn cho sai biến**. Cách dùng đúng của tín hiệu đó là **gắn
nhãn cho trung thực** (S3), không phải **đặt chính sách**.

> **Nếu sau này vẫn muốn phân nhánh theo tài khoản:** phân theo `authMethod` (**hạn mức vs tiền thật** —
> khác biệt về chất), **không** theo `subscriptionType` (khác biệt về lượng). Và đặt **trần chi tiêu cho
> một hội thoại** ở nhánh API key, **không** hạ ngưỡng reset. *"Tiền thật thì có trần"* là chính sách
> phòng thủ được; *"gói nhỏ thì reset sớm hơn"* thì không.

---

## 5. Nghiệm thu

Test mới phải **đỏ-khi-revert-fix**. Slice không có dòng nào ở đây là slice chưa xong.

| # | Slice | Test | Ở đâu |
|---|---|---|---|
| 1 | S1 | Cộng dồn đúng qua nhiều lượt; lượt **thiếu `cost`** không bị tính là 0 mà được **đếm riêng và nói ra** | `test/ask-cost.test.ts` |
| 2 | S1 | Transcript rỗng / task chưa hỏi gì → **0 lượt**, không lỗi, không hiện gì gây hiểu nhầm | như trên |
| 3 | S1 | **Regression**: `GET /api/tasks/:id` không nặng thêm (assert payload không mọc field mới) | `test/ask-transcript.test.ts` |
| 4 | S2 | Dưới ngưỡng → **không** cảnh báo; vượt → **đúng một** lần, **không lặp** ở các lượt sau | `test/ask-cost.test.ts` |
| 5 | S2 | Ngưỡng **không đặt** (mặc định tắt) → hành vi **y hệt hôm nay**, không cảnh báo nào | như trên |
| 6 | S2 | **Regression**: chạm ngưỡng **không** dừng, **không** reset, **không** đổi `sessionIds` | như trên |
| 7 | S3 | `apiProvider: firstParty` → nhãn **"usage"**; API key → nhãn **"$"**; `auth status` hỏng/timeout → nhãn **trung tính**, không ném | `test/*` (mới) |
| 8 | S3 | 🔒 **`email`/`orgId`/`orgName` KHÔNG xuất hiện** trong `task.json`, `events.jsonl`, log, hay bundle export | `test/bundle.test.ts` |
| 9 | — | Đọc `auth status` **một lần**, có cache — không gọi lại mỗi lượt (nó tốn ~0,59 s) | `test/*` |

**Nghiệm thu bằng tay:** mở một build đã có nhiều lượt hỏi, thấy tổng mức tiêu thụ **mà không cần
`?dev=1`**; đặt ngưỡng cảnh báo thấp, hỏi một câu, thấy nhắc **đúng một lần**; hỏi thêm câu nữa, **không**
bị nhắc lại.

---

## 6. Open questions

1. **Đơn vị nào có nghĩa với người dùng?** Token là đơn vị app có. Nhưng "1,2M token" không nói lên
   điều gì với người không theo dõi giá. `$` thì sai trên subscription (S3). **Chưa chốt** — có thể là
   "N lượt · M token", để người dùng tự đối chiếu với dashboard của Anthropic.
2. **Hiện ở đâu?** Dev tip là chỗ sai (dev-only). Đầu thread? Cạnh composer? Cần một quyết định UI,
   và nó **không** nên chiếm chỗ trong cột đọc — bài học `DevPanel` vừa rồi.
3. **S2 có nên chặn ở mức "cứng" thứ hai không?** Ví dụ cảnh báo ở X, hỏi xác nhận ở 3X. Nghiêng về
   **không** cho bản đầu: mỗi lớp tự động là một lớp quyết định thay người dùng. Xem lại nếu có ai
   thật sự chạm trần hạn mức.
4. **`auth status` có ổn định không?** Nó là bề mặt CLI, có thể đổi hình dạng. S3 phải **degrade an
   toàn** (không biết ⇒ nhãn trung tính), và **không** slice nào được xây trên việc nó luôn có mặt.
5. **Trần chi tiêu cho nhánh API key** (§4.1 ghi chú cuối) — chỉ đáng thiết kế khi thật sự có ai dùng
   API key. Hiện tại: subscription.
