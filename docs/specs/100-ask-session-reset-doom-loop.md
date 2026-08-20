# 100 — Reset phiên Ask tự nuôi chính nó: vòng lặp quên–đọc lại–quên

> Trạng thái: **S1 ĐÃ SHIP**; S2/S3 hoãn; **S0 ĐÓNG (không làm) 2026-08-20**, thay bằng **S0′**
> (chưa implement). Phát hiện 2026-08-19 từ run `1786505684286`.
>
> **Cập nhật 2026-08-20 — đọc §3 S0/S0′ trước khi động vào ngưỡng.** `askSessionTokens` cộng dồn qua
> **từng API request** trong một lượt, nên nó phóng đại ngữ cảnh khoảng `numTurns` lần: ngưỡng 300k
> đã từng bắn vào một phiên đang mang **~37k** token. Phép chia cho `numTurns` — số đã có sẵn trong
> `PhaseCost` — là lời giải, và nó **thay thế** spike hook S0.
> **Muốn IMPLEMENT thì đọc [`101-tester-release-plan.md`](101-tester-release-plan.md)** — plan gộp
> 099 + 100, cắt bớt dưới ràng buộc "không cần giữ data hiện có", và chốt thứ tự ship. File này giữ
> **bằng chứng và lập luận**.
>
> **S1 của spec này là việc số MỘT của cả hai spec** — đau nhất, thường xuyên nhất, rẻ nhất
> (một hằng số + một điều kiện). Nó **phải ship trước 099 S1** (ràng buộc cứng, [101 §6](101-tester-release-plan.md));
> đính chính ở §7. S2/S3 đã **hoãn sang Đợt 3** của plan; S0 **đã đóng**, S0′ là mảnh chữa gốc còn lại.
> Khác tầng với [099](099-build-ask-history-survives-the-browser.md): 099 lo **UI mất hiển thị**,
> spec này lo **model mất trí nhớ**. Hai lỗi độc lập, chỉ giống nhau ở kết luận cuối: *dữ liệu nằm
> trên đĩa nhưng không có đường đọc lại.*
> Không chạm làn consult, không đổi định dạng `chat.jsonl`, **không bỏ** cơ chế reset.

---

## 1. Sự cố

Người dùng hỏi trong Builder, model trả lời: *"Tôi không đọc được câu hỏi bạn đang trả lời — hội
thoại này đã bị restart để giới hạn chi phí."* Không phải một lần: **gần như mỗi lượt**.

Câu chữ đó là do code cố ý bơm vào (`FRESH_SESSION_NOTE`,
[ask.ts:134](../../apps/builder/server/lib/ask.ts:134)) để model nói thẳng thay vì bịa ra sự liên
tục — nên bề mặt thì đây là **hành vi đúng thiết kế**. Vấn đề nằm ở chỗ nó kích hoạt liên tục.

### Bằng chứng

| Nhãn | Sự việc |
|---|---|
| `[ĐO]` | Log server ghi **4 lần reset** cho task `1786505684286`: 18/08 18:51 · 18/08 22:23 · 19/08 15:41 · **19/08 15:51**. Hai lần cuối cách nhau **8 phút**. |
| `[ĐO]` | Quỹ đạo token (tổng `input + cacheRead + cacheCreation` mỗi lượt, đọc từ `cost` trong `chat.jsonl`): lượt 108 = **400.661** → lượt 110 **ĐÃ RESET nhưng vẫn 442.253** → lượt 112 reset, 118.884 → lượt 114 = 65.714 → lượt gần nhất = **475.096**. |
| `[ĐO]` | ⇒ **Một phiên vừa mới tinh đã mang 442k token**, cao hơn ngưỡng 300k — tự nó kích hoạt lần reset kế tiếp. |
| `[ĐO]` | Lượt 110 vẫn tốn **$1,02** *sau khi* đã reset. Reset không cứu được chi phí của chính lượt gây ra nó. |
| `[ĐO]` | Ngưỡng `ASK_RESET_TOKENS` mặc định **300.000** ([ask.ts:95](../../apps/builder/server/lib/ask.ts:95)); quyết định bởi `shouldResetAskSession`, đọc `cost` của **lượt trước** ([ask.ts:127](../../apps/builder/server/lib/ask.ts:127)). |
| `[ĐO]` | Chính hồ sơ của spec 098 (`docs/prompts/runs/CAMPAIGNS.md`, mục "Để ngỏ (098 — chi phí hỏi đáp)") ghi: *một câu hỏi một dòng từng mang prefix **899k token**, tốn **$8,86***. Tức là **ngưỡng 300k đã nằm DƯỚI tải quan sát được của một lượt nặng ngay từ ngày nó ra đời.** |
| `[ĐO code]` | Khi reset, seed của phiên mới gồm artifacts (SPEC.md / main.yml / report) + `FRESH_SESSION_NOTE` — **không** chèn lại một dòng nào của `chat.jsonl`, dù transcript nằm cùng thư mục ([ask.ts:723–733](../../apps/builder/server/lib/ask.ts:723)). |
| `[ĐO]` | Mỗi lần reset đẻ một phiên mới và **bỏ lại** phiên cũ. Cả 4 phiên bị bỏ vẫn còn nguyên trên đĩa: `89baa8c1…` 35 MB · `3d07ad14…` 614 KB · `6054125a…` 804 KB · `513ec771…` 317 KB. Không có đường nào trong sản phẩm để quay lại chúng — chỉ dòng `prevSessionId` trong log. |

### `[ĐO]` 2026-08-19 (lượt 3) — chi phí THẬT: kích thước phiên giải thích được rất ít

Đọc `cost.totalCostUsd` từng lượt trong `chat.jsonl` của chính task này. Ba dòng đủ để lật một giả định:

| lượt | tokens | USD | |
|---|---:|---:|---|
| 120 | **1.570.453** | **0,98** | phiên **to nhất** — rẻ |
| 122 | 793.982 | **7,90** | nửa kích thước — **đắt gấp 8** |
| 124–132 | ~800.000 mỗi lượt | **0,55** mỗi lượt | cùng cỡ lượt 122 — rẻ |

**Cùng khối lượng, chênh 14 lần.** Thứ quyết định hoá đơn là **prefix có phải viết lại vào cache
không** (miss → 1,25× giá input; hit → ~1/10), chứ không phải phiên to hay nhỏ. Chính comment của
`ASK_RESET_TOKENS` đã ghi điều đó cho ca $8,86 (*"the cache had expired, so all of it was re-written"*)
— nhưng ngưỡng lại được đặt theo kích thước.

⇒ **`askSessionTokens` là đại lượng thế thân cho chi phí, và là một thế thân tồi.** Nâng nó lên 1M
(S1) vẫn đúng — nó chữa vòng lặp quên–đọc lại–quên — nhưng **đừng đọc nó như một ngân sách tiền.**
Đây là Open Q1, giờ có số.

Ba hệ quả nữa từ cùng bảng đó:

1. **Reset không giữ được phiên nhỏ.** Lượt 110 là phiên **vừa reset xong**, vẫn 442k, vẫn $1,02.
   Reset ở đó mua được đúng con số không.
2. **Spec 098 và cơ chế reset đang đánh nhau.** 098 cố ý thu seed thành một **bản đồ node** kèm dòng
   *"read it for node bodies"* (`workflowSeedBody`, [ask.ts:614](../../apps/builder/server/lib/ask.ts:614)).
   Reset làm model quên thứ nó vừa đọc. Hai cái cộng lại **bảo đảm** một lần đọc lại `main.yml`
   (142 KB) sau **mỗi** lần reset — chính là 400k token của lượt kế tiếp. Càng reset càng phải đọc lại.
   Đây là cơ chế của vòng lặp, viết ra tường minh.
3. **Khối đắt nhất nằm NGOÀI tầm của ngưỡng.** Sáu lượt $6,4–7,1 (17/08 21:37 → 18/08 13:57, tổng
   ~$40) chạy ở 643–713k mà **không reset lần nào** — vì ngưỡng chỉ áp cho làn ④/terminal
   (`askTestWithin`); ask tại gate (`askWithin`) resume phiên **phase** và **không có cơ chế reset nào**.
   Bốn lần reset ghi nhận được (lượt 100, 102, 110, 112) khớp đúng 4 mốc log ở §1 và **không lần nào**
   rơi vào khối đắt.

Tổng hoá đơn task này: **$79,56 / 33 lượt có ghi cost**.

Lệnh dựng lại (chạy từ repo root):

```bash
python3 -c "import json,sys;ls=[json.loads(l) for l in open(sys.argv[1])];a=[x for x in ls if x['role']=='assistant' and x.get('cost')];print('lượt:',len(a),'| tổng USD:',round(sum(x['cost'].get('totalCostUsd') or 0 for x in a),2),'| reset:',sum(1 for x in a if x.get('sessionReset')))" apps/builder/.runs/1786505684286/chat.jsonl
```

### Chẩn đoán: reset gây ra chính cái nó đang trả tiền cho

`askSessionTokens` cộng `input + cacheRead + cacheCreation` của **toàn bộ vòng lặp agent nội bộ của
MỘT lượt** (`numTurns` có lượt lên tới 19). Với task này, trả lời một câu hỏi nghĩa là đọc
`main.yml` (142 KB) và các artifact khác nhiều lần — tự nó 400k+ token.

Vòng lặp khép kín:

```
phiên mới  →  model không nhớ nội dung file  →  buộc phải đọc lại main.yml
           →  lượt đó ngốn 400–475k token    →  vượt ngưỡng 300k
           →  RESET  →  phiên mới  →  (quay lại đầu)
```

**Reset chính là thứ buộc model phải đọc lại.** Một phiên được sống lâu sẽ giữ nội dung file trong
ngữ cảnh và các lượt sau rẻ dần — đúng cái mà reset không cho xảy ra. Lượt 110 là bằng chứng đóng
đinh: phiên mới tinh, vẫn 442k, vẫn $1,02, và vẫn kích hoạt reset tiếp theo.

`[GIẢ THUYẾT]` Ngưỡng 300k **chưa từng** phù hợp với task nặng artifact; nó chỉ không lộ ra ở các
task nhỏ. Chưa kiểm trên n≥2 task khác nhau — xem `[REPRO]` §5.

> **CẬP NHẬT 2026-08-20 — chẩn đoán trên đúng, nhưng còn thiếu một hệ số.** `askSessionTokens` không
> chỉ *bao gồm* công đọc file của một lượt; nó **cộng dồn qua từng API request** trong lượt đó, nên
> nó phóng đại ngữ cảnh khoảng `numTurns` lần. Lượt 110 (`numTurns=12`, tổng 442.253) thật ra mang
> **~37k**. Nghĩa là ngưỡng 300k đã bắn vào phiên **nhỏ nhất**, không phải phiên phình. Số đo + hệ quả
> ở **§3 S0′**; đó cũng là lời giải cho **Open Q1 (§6)**.

---

## 2. Nguyên tắc thiết kế

1. **Reset là biện pháp đúng, nhưng phải nhắm vào lịch sử phình, không nhắm vào một câu trả lời
   nặng.** Bỏ hẳn reset là sai: $8,86 cho một lượt là con số thật, đã đo.
2. **Ngưỡng phải nằm TRÊN tải quan sát được của một lượt nặng.** Ngưỡng dưới tải quan sát biến cơ
   chế thành máy phát amnesia. Code đã có sàn 50k cho một dạng của lỗi này
   ([ask.ts:100–108](../../apps/builder/server/lib/ask.ts:100)) — cùng tinh thần, thiếu vế trên.
3. **Đã buộc phải quên thì phải bồi thường.** Transcript nằm sẵn trên đĩa; để model mù trong khi bản
   ghi cách đó một lệnh đọc file là lãng phí thuần tuý.
4. **Không có gì bị vứt đi được phép biến mất không dấu vết.** Phiên cũ còn trên đĩa thì phải có
   đường trỏ lại — hôm nay phải sửa tay `task.json` mới quay về được.

---

## 3. Slices

### S0 — ĐÓNG 2026-08-20, KHÔNG LÀM. Câu hỏi thật đã có lời giải rẻ hơn nhiều

> **Nội dung cũ giữ ở git history.** Ý định cũ: thêm hook `PreCompact`/`PostCompact` vào
> `headless-settings.json`, ghi `context_window` trước/sau vào `events.jsonl`, rồi cho
> `shouldResetAskSession` ưu tiên số thật. Nguồn tham chiếu là claude-nexus (nó **quan sát** thay vì
> **can thiệp**: không có cơ chế reset nào, `/reply` luôn `--resume` và giao việc nén cho CLI).

**Hai sự kiện đóng nó lại.**

`[ĐO 2026-08-20]` **Payload của hook không mang con số S0 cần.** Tài liệu hook của Claude Code liệt
kê 31 event — `PreCompact` và `PostCompact` **đều có thật**, và hook **có** chạy ở chế độ headless
(*"Hooks run wherever Claude Code runs"*), nên phép kiểm chặn cửa `[CHƯA KIỂM]` cũ coi như đã trả
lời **CÓ**. Nhưng common fields chỉ gồm `session_id`, `transcript_path`, `cwd`, `permission_mode`,
`hook_event_name`; `PreCompact` thêm `trigger` (`manual`/`auto`) + `custom_instructions`, `PostCompact`
thêm `compact_summary`. **Không có `context_window`, không có token count.** Muốn con số vẫn phải tự
đọc `transcript_path` — tức là đúng khối plumbing mà S0 nói là để tránh.

`[ĐO 2026-08-20]` **Ước lượng tốt hơn đã nằm sẵn trong `PhaseCost`: `numTurns`.** Đây là **số đo mà
Open Q1 (§6) đòi trước khi thiết kế** — nay có. Đo 60 lượt assistant có `cost`, 7 run trong `.runs/`:

| | |
|---|---|
| Lượt có `numTurns > 1` | **17/60 (28 %)**, cao nhất **22** |
| Lượt vượt ngưỡng CŨ 300k ở tổng thô **nhưng** `tổng/numTurns < 300k` | **7** |
| Lượt vượt ngưỡng MỚI 1M ở tổng thô **nhưng** `tổng/numTurns < 1M` | **5** |

Lượt 110 — bằng chứng đóng đinh của §1 — đọc lại bằng phép chia:

| lượt | `numTurns` | tổng (= metric hiện tại) | tổng/`numTurns` | $ |
|---|---|---|---|---|
| 110 | **12** | 442.253 | **36.854** | 1,02 |
| kế | 5 | 475.096 | 95.019 | 0,89 |
| (phiên dài, 1 request) | 1 | ~800.000 | ~800.000 | 0,55 |
| (cache-miss) | 1 | 864.321 | 864.321 | **8,59** |

Đọc thẳng: **ngưỡng 300k đã bắn vào một phiên đang mang ~37k token**, còn lượt thật sự đắt ($8,59 —
cache-miss, một request) thì metric không thấy. Vòng lặp §1 do đó có một vế nữa, cụ thể hơn cả chẩn
đoán cũ: reset → đọc lại file → **nhiều request hơn** → tổng bị **nhân lên theo số request** → vượt
ngưỡng → reset. Metric không chỉ đo sai; nó **anti-tương quan** với thứ nó khai là đang đo, đúng
trong vùng quan trọng nhất.

Hệ quả cho S1 (đã ship): nâng 300k → 1M **có tác dụng, nhưng một phần là do may** — ngưỡng cao đến
mức phép nhân hiếm khi với tới. 5 lượt vẫn vượt 1M ở tổng thô (những lượt này ngữ cảnh thật cũng
550–880k nên reset không sai lắm). Sàn động `prevTurnWasFreshSession` đang **che triệu chứng** của
phép nhân này, không chữa nó.

### S0′ — Chia cho `numTurns` (thay thế S0) `[CHƯA IMPLEMENT]`

**Việc:** `shouldResetAskSession` so ngưỡng với `askSessionTokens(cost) / (cost.numTurns ?? 1)` thay
vì tổng thô. `numTurns` đã được ghi từ spec 059 ([task.ts:207](../../apps/builder/server/state/task.ts:207)),
đã có mặt trên **60/60** lượt đo được, và vắng nó thì `?? 1` cho lại đúng hành vi hôm nay.

**Không** hook, **không** endpoint, **không** thêm plumbing. Một biểu thức.

**Giới hạn phải nói ra — đây là ước lượng, không phải số thật:**

- `num_turns` được tài liệu mô tả là *tool-loop iterations*, **không đảm bảo** bằng đúng số API
  request. Bằng chứng gián tiếp rất khớp (lượt `nT=2, tổng=1,57M → 785k` nằm ngay cạnh các lượt
  `nT=1, tổng≈800k`), nhưng là suy luận.
- Trong một lượt, prompt **lớn dần** theo từng tool result, nên **trung bình thấp hơn đỉnh**. Tổng
  thô cao hơn ngữ cảnh khoảng `numTurns` lần; trung bình thấp hơn đỉnh. Sự thật nằm giữa, và **gần
  trung bình hơn**.
- Vì vậy S0′ **không** đòi giữ nguyên ngưỡng 1M. Ngưỡng phải được đọc lại trên thang mới —
  xem Open Q2, nay là câu hỏi có nghĩa hơn hẳn.

**`[ĐO 2026-08-20]` Bán kính vụ nổ — đã CHẠY THẬT, không suy.** Vá thử hai biểu thức, chạy toàn bộ
suite server, rồi revert: **1081 test, 1079 pass, 2 fail** — cả hai ở `test/ask-cost.test.ts`, cả hai
vì **cùng một nguyên nhân**: fixture `RESULT` của file đó mang `num_turns: 3`
([ask-cost.test.ts:33](../../apps/builder/test/ask-cost.test.ts:33)), nên `1.200.301 / 3 = 400.100`
tụt xuống dưới 1M và reset **không** xảy ra:

| test | vỡ ở đâu |
|---|---|
| *"a session that grew past the budget starts fresh…"* | `resumed` là `'sid-1'` thay vì `undefined` — phiên đắt **được resume** |
| *"the dynamic floor: a session that was ALREADY reset…"* | precondition `sessionReset === true` thành `undefined` — lượt 1 không còn reset nên sàn động không có gì để kiểm |

**Đây là hai test ĐÚNG đang kêu, không phải hai test hỏng.** Fixture đang mô tả *"1,2M trong 3
request"* — trên thang mới đó là 400k/request, và 400k thì **không đáng reset**. Người implement phải
**đặt lại fixture cho khớp ý định**, chọn một trong hai:
- `num_turns: 1` cho ca đó ⇒ "1,2M trong MỘT request" = một phiên thật sự phình; hoặc
- nhân token lên ~×3 (≈3,6M) và giữ `num_turns: 3`.

Cách một sát ý định gốc hơn (*"lịch sử phình"*, không phải *"một lượt nhiều request"*). **Đừng nới
ngưỡng để test xanh lại** — đó là đúng cái sai mà S1 vừa sửa.

**Một trap nữa, cùng nhịp:** `askResetSuppressed` gọi `askSessionTokens` **độc lập**
([ask.ts:171](../../apps/builder/server/lib/ask.ts:171)). Sửa mỗi `shouldResetAskSession` thì hai vị
từ dùng hai thang khác nhau → dòng `log.warn` *"BUILDER_ASK_RESET_TOKENS quá thấp"* sẽ bắn sai. **Sửa
cả hai, và dòng log phải in con số ĐÃ CHIA** (kèm `numTurns`), nếu không log tự mâu thuẫn với quyết
định nó đang giải thích.

**Lập luận ngược mà Open Q1 đã nêu, nay kiểm được:** *"tool result thật sự nằm lại trong lịch sử, nên
một lượt đọc nhiều file CÓ làm phiên phình thật."* **Đúng, nhưng nhỏ**: sau lượt `nT=13`, trung bình
mỗi request các lượt kế tiếp là 42k → 80k → 104k → 133k — tăng thật, ở mức **hàng chục nghìn**, không
phải 400k. Tổng thô đang phóng đại độ phình đó khoảng một bậc.

### S1 — Ngưỡng phải ở trên tải một lượt, và phải tự biết mình sai

Không đổi công thức đo (chưa có số đo nào biện minh cho một công thức khác — xem Open Q1). Đổi hai
thứ rẻ và chắc:

1. **Nâng mặc định** lên trên tải quan sát được. `[ĐO]` cho task này: 400–475k; hồ sơ 098 ghi 899k.
   Đề xuất **1.000.000**, tức trên cả ca 899k. Con số cuối cùng chốt bằng Open Q2.
2. **Sàn ĐỘNG thay cho hằng số 50k.** Nếu lượt **đầu tiên của một phiên mới** đã vượt ngưỡng thì
   ngưỡng sai chứ không phải phiên sai — trường hợp này **không được reset lần nữa**, và phải
   `log.warn` kèm con số. Đây chính là ca lượt 110 (fresh, 442k, vẫn reset). Không có mảnh này thì
   một ngưỡng đặt sai vẫn tạo vòng lặp, chỉ chậm hơn.

Chi phí: một điều kiện trong `shouldResetAskSession` + một hằng số. Không đụng prompt, không đụng
định dạng file.

### S2 — Reset thì phải bồi thường bằng transcript

Khi `sessionReset` bật, chèn vào seed của phiên mới **N cặp hỏi–đáp cuối** đọc từ `chat.jsonl`
(`readConsultChat` đã có sẵn, [ask.ts:1014](../../apps/builder/server/lib/ask.ts:1014)) — đặt ngay
trên `FRESH_SESSION_NOTE`, và sửa lại câu chữ của note cho khớp ("bạn thấy N trao đổi gần nhất, các
trao đổi cũ hơn thì không").

- **N mặc định 3** cặp, cắt theo ngân sách ký tự (đề xuất 12 KB) chứ không chỉ theo số cặp — một
  câu trả lời 8.000 ký tự không được ăn hết seed.
- Cắt thì phải **nói ra** trong chính khối chèn, đúng nguyên tắc "không bịa sự đầy đủ".
- Rẻ hơn nhiều so với hiện trạng: 12 KB ≈ 3–4k token, so với 400k mà model đang tiêu để đọc lại file.

> **`[ĐO 2026-08-20]` NGÂN SÁCH 12 KB LÀ SAI THANG — sửa trước khi implement.** Spec 098 đã ép **cả
> seed** xuống dưới **16.000 ký tự**, và con số đó đang được **ghim bằng test**
> ([ask-seed-size.test.ts:90](../../apps/builder/test/ask-seed-size.test.ts:90); hai ca khác ghim
> `< 8.000` và `< 6 KB`). Trong cùng ngân sách đó, `SPEC_INLINE_MAX` là **4 KB** và `OUTLINE_MAX` là
> **2 KB**. Chèn một khối transcript **12 KB** nghĩa là khối lịch sử **to gấp ba cả bản outline của
> SPEC.md** và chiếm ~¾ toàn bộ prompt — tức là trả lại đúng số byte mà 098 vừa cắt đi.
>
> **Đề xuất: 3–4 KB, và N=2–3 cặp**, cùng bậc với `SPEC_INLINE_MAX`. Con số đúng thì đo bằng Open Q3
> (đếm số lần model vẫn phải nói *"tôi không thấy"*), đừng chốt bằng trực giác.
>
> Test hiện có **không** vỡ vì `promptFor` dựng task chưa có phiên ⇒ `sessionReset` false ⇒ không chèn
> gì. Nghĩa là ngân sách sai sẽ **không bị suite bắt** — càng phải chốt bằng một test riêng cho nhánh
> `sessionReset = true`.

> **`[ĐO 2026-08-20]` `test/ask-transcript.test.ts` ĐÃ TỒN TẠI** — 405 dòng, 18 test (spec 099 S1 viết
> nó). Test của S2 phải **append** vào file đó. `Write` đè lên nó sẽ xoá mất 18 test mà suite vẫn
> **xanh** và tổng số test vẫn tăng — đúng cái bẫy "Luật làm việc #4" mô tả.

### S3 — Phiên bị bỏ phải có đường quay lại

Ghi lịch sử phiên vào `task.json`:

```
sessionHistory: [{ id, replacedAt, reason: 'reset', tokensAtReset }]
```

Chỉ ghi thêm, không đổi `sessionIds` hiện có → mọi task cũ đọc vẫn đúng. Hôm nay muốn quay lại một
phiên trước reset thì phải mò `prevSessionId` trong log server rồi **sửa tay `task.json`** — đã làm
đúng một lần hôm 19/08 và nó cần backup + hai lệnh + một lần restart.

Chưa cần UI. Chỉ cần dữ liệu tồn tại thì công cụ sau này mới dựng được.

> **S3 là mảnh THU BẰNG CHỨNG, không chỉ là tiện lợi.** `[ĐO code]` hôm nay `prevSessionId` chỉ tồn
> tại trong `log.info` → `.runs/dev-restart.log`, mà file đó **không nằm trong bundle export** (dùng
> chung mọi task, chưa qua `redactSecrets`). Trên máy tester nghĩa là: **phiên bị bỏ không lấy lại
> được, và cũng không ai biết là đã bỏ.** `sessionHistory` nằm trong `task.json` — **đã** nằm trong
> bundle (đã tước `sessionIds`, nhưng đây là field khác) — nên nó là chỗ duy nhất khiến sự kiện reset
> đi được từ máy tester về người sửa. Cùng nguyên tắc 6 của
> [spec 099 §2](099-build-ask-history-survives-the-browser.md).
>
> Ngược lại, `sessionReset` **đã** đi đúng đường sẵn: nó ghi vào `chat.jsonl`, mà `chat.jsonl` **có**
> trong bundle. Đó là tiền lệ, không phải việc mới.
>
> **Một quyết định phải chốt cùng lúc:** `buildBundle` cố ý **tước `sessionIds`** khỏi `task.json`
> ([bundle.ts:80–85](../../apps/builder/server/lib/bundle.ts:80)). `sessionHistory[].id` là cùng loại
> dữ liệu, nên phải chọn dứt khoát — và lựa chọn đúng là **tước `id`, GIỮ `replacedAt` /
> `tokensAtReset` / `reason`**. Lý do: `id` chỉ có nghĩa trên **máy đã sinh ra nó** (file phiên nằm ở
> filesystem cục bộ), nên gửi đi không giúp được ai; còn ba field kia mới là thứ trả lời *"reset mấy
> lần, lúc nào, ở mức token nào"* — đúng câu hỏi §1 phải dùng log server mới trả lời được. Người dùng
> tại chỗ vẫn có `id` đầy đủ trong `task.json` của họ để khôi phục.

---

## 4. Non-goals

- **Không bỏ reset.** $8,86/lượt là số thật.
- **Không** đổi công thức `askSessionTokens` khi chưa có số đo đòi (Open Q1).
- **Không** đụng làn consult — mọi số đo ở đây đến từ ask của build, đúng như ranh giới mà mục
  "Để ngỏ (098)" trong CAMPAIGNS.md đã đặt.
- **Không** đổi định dạng `chat.jsonl`, không thêm đường ghi mới.
- **Không** làm UI cho `sessionHistory` trong spec này.
- **Không** đụng seed của phase ①②③ — chỉ đường ask ở ④/terminal.

---

## 5. `[REPRO]` và nghiệm thu

### REPRO — vòng lặp có tái hiện trên task khác không (kiểm `[GIẢ THUYẾT]` §1)

```
1. Chọn một build có main.yml LỚN (≥100 KB) và một build có main.yml nhỏ (<20 KB).
2. Mỗi build: hỏi 4 câu liên tiếp, câu nào cũng buộc đọc file
   (ví dụ "node X cấu hình thế nào?").
3. Sau mỗi câu, đọc cost:
   python3 -c "import json;r=[json.loads(l) for l in open('apps/builder/.runs/<id>/chat.jsonl')];\
c=[x['cost'] for x in r if x['role']=='assistant' and x.get('cost')][-1];\
print(sum(c.get(k) or 0 for k in ('inputTokens','cacheReadTokens','cacheCreationTokens')))"
4. Đếm số dòng 'session reset' trong .runs/dev-restart.log cho task đó.
   • build lớn reset ≥2 lần / 4 câu, build nhỏ 0 lần  → GIẢ THUYẾT ĐÚNG (phụ thuộc cỡ artifact).
   • cả hai đều reset                                  → ngưỡng sai với MỌI task, S1.1 càng gấp.
   • không build nào reset                             → sự cố phụ thuộc thứ khác; điều tra lại.
```

### Nghiệm thu

Test phải **đỏ-khi-revert-fix**.

Mỗi slice phải có ít nhất một dòng; slice không có dòng nào là slice chưa xong.

| # | Slice | Test | Ở đâu |
|---|---|---|---|
| ~~0a–0c~~ | ~~S0~~ | **ĐÓNG 2026-08-20 — S0 không làm** (§3). Phép kiểm chặn cửa đã trả lời: hook **có** bắn ở headless, nhưng payload **không** mang `context_window`. | — |
| **0a′** | **S0′** | `shouldResetAskSession` so ngưỡng với `tổng / numTurns`, **không** với tổng thô | `test/ask-cost.test.ts` |
| **0b′** | **S0′** | `numTurns` vắng/0 → `?? 1` → **hành vi y hệt hôm nay** (regression) | như trên |
| **0c′** | **S0′** | Ca đo được: `tổng=442.253, numTurns=12` ở ngưỡng 300k → **không** reset (hôm nay: reset) | như trên |
| 1 | S1 | `shouldResetAskSession` trả `false` khi lượt trước là **lượt đầu của phiên mới** dù vượt ngưỡng (chống vòng lặp) | `test/ask-cost.test.ts` |
| 2 | S1 | Ca đó phát ra `log.warn` kèm con số thật | như trên |
| 3 | S1 | Ngưỡng mặc định mới; env dưới sàn vẫn bị nâng như hiện nay | như trên |
| 4 | S1 | **Regression**: lượt trước dưới ngưỡng → **không** reset, hành vi y hệt hôm nay | như trên |
| 5 | S2 | Seed của phiên reset **có chứa** N cặp cuối, đúng thứ tự, mới nhất sát câu hỏi | `test/ask-transcript.test.ts` |
| 6 | S2 | Cắt theo ngân sách ký tự **có nói ra** trong chính khối chèn | như trên |
| 7 | S2 | **Regression**: `sessionReset` false → seed **không đổi một byte** so với hôm nay | như trên |
| 8 | S2 | Task chưa có transcript (`chat.jsonl` vắng) → seed y hệt hôm nay, không lỗi | như trên |
| 9 | S3 | `sessionHistory` được ghi thêm mỗi lần reset, đủ `id`/`replacedAt`/`tokensAtReset` | `test/ask.test.ts` |
| 10 | S3 | **Regression**: `task.json` cũ không có field này đọc vẫn đúng, `sessionIds` không đổi | như trên |
| 11 | — | REPRO §5 chạy tay trên **hai** build thật (main.yml lớn / nhỏ), trước và sau fix | thủ công |

---

## 6. Open questions

1. ~~**Có nên tách "kích thước lịch sử" khỏi "công đọc file của một lượt" không?**~~
   **ĐÃ TRẢ LỜI `[ĐO 2026-08-20]` → thành S0′ (§3).** Câu hỏi này parked chờ *"số đo trước khi thiết
   kế"*; số đo nay có. **Có**, và không cần plumbing: `numTurns` đã nằm trong `PhaseCost`, phép chia
   là đủ. Lập luận ngược ("tool result *thật sự* làm phiên phình") **đúng nhưng nhỏ** — độ phình thật
   là hàng chục nghìn token/lượt, còn tổng thô phóng đại nó khoảng `numTurns` lần. Chi tiết + giới
   hạn của ước lượng: §3 S0′.
2. **Con số ngưỡng cuối cùng là bao nhiêu?** ⚠ **Câu hỏi này đổi thang nếu S0′ ship** — 1M được chọn
   trên tổng thô; trên `tổng/numTurns` nó là một ngưỡng khác hẳn và phải đọc lại từ đầu.
   1.000.000 là đề xuất từ hai điểm dữ liệu (475k quan sát
   được, 899k trong hồ sơ 098). Cần phân bố thật qua vài task nặng khác nhau — REPRO §5 cho đúng số
   đó. Đánh đổi phải nói rõ: ngưỡng cao hơn = lượt đắt hơn nhưng ít quên hơn; người dùng đang trả
   giá bằng cả hai.
3. **N = 3 cặp có đủ không?** Chọn từ trực giác, chưa đo. Đo bằng cách: sau mỗi reset, đếm số lần
   model vẫn phải nói "tôi không thấy" trong 3 lượt kế tiếp.
4. **Có nên tự động chèn digest của `main.yml` vào seed** để model khỏi phải đọc lại từ đầu?
   Đây mới là đòn nhắm thẳng vào 400k. **ĐÃ MẠNH LÊN NHIỀU sau số đo lượt 3** (xem §1): chính vì 098
   thu seed thành bản đồ + *"tự đọc file"* mà mỗi lần reset đều kéo theo một lần đọc lại 142 KB. Số đo
   mới mà câu hỏi này đòi thì **đã có**. Nhưng vẫn giữ ở open-question, vì hướng đúng chưa chắc là
   "chèn digest" — có thể là **đừng reset** (S1 đã làm), hoặc quản độ ấm của cache (mới là biến giải
   thích được 14 lần chênh lệch). Cần một REPRO tách được ba biến đó trước khi thiết kế.

---

## 7. Quan hệ với các spec khác

- **099** — cùng một hình dạng lỗi ở tầng khác: *đĩa có, đường đọc lại không có*. 099 lo `chat.jsonl`
  → UI; spec này lo `chat.jsonl` → seed của model.

  > **ĐÍNH CHÍNH 2026-08-19:** câu cũ viết *"Hai fix độc lập, làm song song được."* — **đúng về kỹ
  > thuật, sai về trải nghiệm.** **S1 của spec này phải ship TRƯỚC 099 S1.** Ngược lại, người dùng
  > thấy lịch sử hiện lại đầy đủ trên màn hình, hỏi tiếp, và model vẫn nói *"tôi không nhớ"* —
  > **trông tệ hơn hiện tại**, vì giờ có bằng chứng ngay trước mắt rằng nó đáng lẽ phải nhớ. Thứ tự
  > phát hành gộp cả hai spec: [099 §8.4](099-build-ask-history-survives-the-browser.md).

  Và hai spec chia chung một hệ quả thiết kế: **`chat.jsonl` là nguồn sự thật duy nhất còn lại khi
  mọi thứ khác mất.** 099 đọc nó ra UI, 100 đọc nó vào prompt. Mọi quyết định sau này chạm tới file
  đó phải cân cả hai người đọc.
- **098** (đã đóng) — nơi cơ chế reset ra đời. Hành vi đã ghi tại
  `docs/state/turn-and-sandbox.md:328`; lịch sử quyết định ở mục "Để ngỏ (098 — chi phí hỏi đáp)"
  trong `docs/prompts/runs/CAMPAIGNS.md`. Spec này **không** lật 098 — nó vá đúng chỗ 098 đặt ngưỡng
  bằng một điểm dữ liệu (899k) mà lại chọn con số nằm dưới điểm đó.
