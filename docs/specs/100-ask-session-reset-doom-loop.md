# 100 — Reset phiên Ask tự nuôi chính nó: vòng lặp quên–đọc lại–quên

> Trạng thái: **mở**, chưa implement. Phát hiện 2026-08-19 từ run `1786505684286`.
> **Muốn IMPLEMENT thì đọc [`101-tester-release-plan.md`](101-tester-release-plan.md)** — plan gộp
> 099 + 100, cắt bớt dưới ràng buộc "không cần giữ data hiện có", và chốt thứ tự ship. File này giữ
> **bằng chứng và lập luận**.
>
> **S1 của spec này là việc số MỘT của cả hai spec** — đau nhất, thường xuyên nhất, rẻ nhất
> (một hằng số + một điều kiện). Nó **phải ship trước 099 S1** (ràng buộc cứng, [101 §6](101-tester-release-plan.md));
> đính chính ở §7. S2/S3 đã **hoãn sang Đợt 3** của plan; S0 là **spike ngoài đường găng**
> (`[CHƯA KIỂM]`).
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

### S0 — Đo `context_window` THẬT thay vì suy từ `cost` của lượt trước `[CHƯA KIỂM]`

> **Nguồn: đối chiếu claude-nexus 2026-08-19.** Nexus **không có** cơ chế reset nào — grep
> `sessionReset|resetSession|dropHistory|freshSession` trên toàn `src/server` cho **rỗng**; `/reply`
> luôn `--resume` phiên gần nhất trong chuỗi và giao việc nén cho CLI. Thay vì **can thiệp**, nexus
> **quan sát**: hook `PreCompact`/`PostCompact` POST về `/internal/tasks/compaction-event`, ghi
> `context_window` + tính `freed_tokens` (delta pre→post) vào bảng `compaction_events`, hiện thành
> badge trên UI.

Đây là mảnh còn thiếu của chính chẩn đoán ở §1. `shouldResetAskSession` đọc `cost` của lượt trước —
tổng `input + cacheRead + cacheCreation` của **toàn bộ vòng lặp agent nội bộ MỘT lượt** (`numTurns`
có lượt tới 19). Đó là **đại lượng thế thân**: một lượt nặng bị nhầm thành một phiên phình. Lượt 110
là bằng chứng đóng đinh — phiên **mới tinh**, vẫn 442k, vẫn kích hoạt reset.

Nói theo đúng "Luật rút ra" của spec 099: **đang đo bản thế thân thay vì đo chính hiện vật.** CLI
biết kích thước ngữ cảnh thật; code đang đoán nó từ hoá đơn của một lượt.

**Việc:**

1. Thêm `PreCompact` + `PostCompact` vào `apps/builder/headless-settings.json` (file này **đã** có
   `hooks.PreToolUse`, và mọi turn đã chạy với `--settings` trỏ vào nó — đường ống có sẵn).
2. Hook ghi thẳng một dòng `events.jsonl` của task (`kind: 'context_compacted'`, `detail` mang
   `context_window` trước/sau). **Không** endpoint mới — khác nexus, vì Builder không có DB và
   `events.jsonl` đã nằm trong bundle export (nguyên tắc 6 của spec 099).
3. Khi có số thật, `shouldResetAskSession` ưu tiên nó; `cost` của lượt trước tụt xuống làm **fallback**
   cho môi trường không bắn hook.

**`[CHƯA KIỂM]` — kiểm trước khi lên lịch, đừng xây trên giả định:** chưa xác nhận CLI có bắn
`PreCompact`/`PostCompact` ở chế độ headless (`-p` / `--output-format stream-json`) mà Builder dùng
hay không. Phép kiểm rẻ: thêm hai hook ghi ra một file tạm, chạy một ask dài tới lúc compact, xem
file có dòng nào không. **Nếu KHÔNG bắn thì S0 chết** và S1 (nâng ngưỡng) là đường duy nhất — nên
**S1 không được phụ thuộc S0**, và nó không phụ thuộc thật: hai slice độc lập.

**Vì sao S0 đáng làm dù S1 đã đủ dập triệu chứng.** S1 chỉ dịch một con số đoán được từ 300k lên
1M — vẫn là đoán, chỉ đoán an toàn hơn. S0 đổi câu hỏi từ *"đặt ngưỡng bao nhiêu?"* thành *"CLI nói
phiên đang bao nhiêu?"*. Và nó **không** vi phạm non-goal "không bỏ reset": reset vẫn còn, chỉ là
quyết định bằng số thật.

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
| **0a** | **S0** | `[CHƯA KIỂM]` **Phép kiểm chặn cửa, chạy TRƯỚC khi lên lịch S0**: hook `PreCompact`/`PostCompact` có bắn ở chế độ headless Builder dùng không? Không bắn → **S0 chết**, ghi lại kết quả vào spec | thủ công |
| **0b** | **S0** | Hook bắn → một dòng `events.jsonl` `context_compacted` kèm `context_window` trước/sau, **đúng task** | `test/ask.test.ts` |
| **0c** | **S0** | Có số thật → `shouldResetAskSession` dùng nó; **không** có (môi trường không bắn hook) → rơi về `cost` lượt trước, hành vi y hệt hôm nay | `test/ask-cost.test.ts` |
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

1. **Có nên tách "kích thước lịch sử" khỏi "công đọc file của một lượt" không?** Nghe hợp lý, nhưng
   `PhaseCost` chỉ có tổng của cả lượt (`inputTokens`/`cacheRead`/`cacheCreation`/`numTurns`) —
   **không có** phân rã theo từng call, nên chưa rõ đo tách bằng cách nào mà không thêm plumbing.
   Và có một lập luận ngược đáng cân nhắc: tool result *thật sự* nằm lại trong lịch sử phiên, nên
   một lượt đọc nhiều file **có** làm phiên phình lên thật. Cần số đo trước khi thiết kế. **Không
   slice nào ở trên xây trên câu hỏi này.**
2. **Con số ngưỡng cuối cùng là bao nhiêu?** 1.000.000 là đề xuất từ hai điểm dữ liệu (475k quan sát
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
