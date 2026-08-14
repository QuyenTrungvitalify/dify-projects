# Spec 098 — Hỏi đáp: cắt phần lặp lại, giữ nguyên chất lượng câu trả lời

**Status**: **S1+S2+S3+S4 ĐÃ IMPLEMENT + review/vá vòng 2 + ĐÃ NGHIỆM THU ĐỦ §6.1–§6.4 (2026-08-14)**.
Câu hỏi chi tiết trên session sạch trả lời **đúng 100%**, file đính kèm cũ vẫn với tới được (R2), token
thật **≈ −80% mỗi lượt** và đường cong **đi xuống** thay vì phình — xem §6.3/§6.4. Sẵn sàng `/spec-close`
sau khi bảng §9 được chuyển về nhà.

Vòng review thứ hai (hiệu chuẩn lại trên **153** workflow thật, không phải 25) tìm ra 5 lỗ và đã vá:

| # | Lỗ | Vá |
|---|---|---|
| 1 | S2 **vô hiệu** khi lượt hỏi không kèm file — mà đó là đa số lượt: route truyền `undefined`, `attachmentBlock` hiểu thành "không có ý kiến" ⇒ mọi file cũ lại được mời đọc | route truyền `uploads ?? []`; `[]` = "lượt này không có gì mới" ≠ `undefined` = "caller không có ý kiến" |
| 2 | Scalar nhiều dòng có dòng nối ở **cột 0** cắt cụt mảng node; guard đếm-so-đếm không thấy vì **cả hai số đều dừng sớm** (file thật: 6 node → map 5, mất node `end`, `ok:true`) | kiểm tra dòng làm dừng mảng: không giống cấu trúc YAML ⇒ `ok:false` |
| 3 | YAML flow-style ⇒ mọi type `?` và **0 cạnh** mà vẫn `ok:true` — map nói "workflow không có kết nối nào" | guard cạnh (có item mà không rút được cặp ⇒ `ok:false`) + guard "không đọc được type của bất kỳ node nào" |
| 4 | Ngưỡng đo bằng **ký tự** trong khi spec nói **KB** — SPEC.md 16.398 byte tiếng Nhật lọt qua cap "16KB" và bị inline nguyên | mọi ngưỡng đổi sang `Buffer.byteLength`; thêm cap cho outline, cho số cạnh và cho độ dài title |
| 5 | Ghi chú iteration **sai sự thật**: DSL Dify để node con ngay trong `nodes:` gốc (`parentId`) nên chúng ĐÃ có trong map | đánh dấu `[inside <container>]` + nói rõ nhánh đó chạy **mỗi item**, bỏ câu "not expanded" |

Hiệu chuẩn sau khi vá: **141 khớp chính xác / 12 fallback trung thực / 0 sai-mà-tự-tin** (trước khi vá:
141 / 1 / **11**). Script hiệu chuẩn + golden nay **đã nằm trong repo** và chạy trong suite, không cần
python lúc test — xem §5 R-calib. Suite: server **1007 pass**, web **341 pass**, typecheck sạch.

Kết quả đo sau khi sửa, trên **artifact thật** của user:

| build | seed trước | seed sau | cắt |
|---|---|---|---|
| build_requirement_news_automation | 143.483 | **11.411** | −92% |
| build_requirement_news_automation_2 | 137.487 | **24.724** | −82% |
| yml_tsv_webhook_url | 104.664 | **14.946** | −86% |
| fixture probe (2 lượt liên tiếp) | 145.070 | **9.294** | −94% |

*(`_2` còn 24.7KB vì **requirement của chính user dài 11.029 ký tự** — đó là văn bản của họ và là chủ đề
câu hỏi, inline nguyên là đúng; cộng report.json 6KB + map 3.5KB.)*

Bộ quét YAML được **hiệu chuẩn với parser thật** (python yaml) trên **153 workflow có thật trong repo**
(vòng đầu chỉ 25): khớp chính xác cả node id lẫn từng cặp cạnh. Bốn lỗi bị bắt trong lúc hiệu chuẩn —
item `- ` nằm **cùng** thụt lề với khoá (hỏng 24/25), **dòng comment cùng thụt lề** làm dừng sớm,
**scalar nhiều dòng có dòng nối ở cột 0** làm mất node cuối, và **flow-style** cho ra map "không có
cạnh nào" — cả bốn đều thuộc loại *sai mà tự tin*; xem §5 R-calib.
**Nguồn**: user hỏi *"cấu trúc hiện tại việc trả lời, fix request… đang diễn ra thế nào? t cảm thấy nó
đang ngốn token khá nhiều. ví dụ t mới yêu cầu phân tích file doc này mà đã dính limit ngay"*.

Câu trả lời: **có**, và nó không nằm ở chỗ ai cũng đoán. Đường `/reply` (fix request) rẻ; đường **hỏi
đáp trên build đã xong** đắt gấp nhiều lần chính việc dựng ra workflow.

---

## 1. Đo được gì

Nguồn số: log usage của chính CLI (`~/.claude/projects/<cwd>/<sessionId>.jsonl`), khớp với
`sessionIds` trong `task.json`. Đây là **token thật đã bị tính tiền**, không phải ước lượng.
Quy đổi: `eff = cache_creation×1.25 + cache_read×0.10` (giá tương đối so với input gốc).

**[ĐO] Hỏi đáp tốn gấp 3.4 lần dựng build** — toàn bộ task có session Ask:

| task | model | phases (eff) | askTest (eff) | số lượt hỏi |
|---|---|---|---|---|
| 1786089321835 | — | 8.2M | 12.5M | 11 |
| 1786327501724 | — | 2.1M | 1.3M | 5 |
| 1786505684286 | fable | 6.3M | **32.1M** | 46 |
| 1786508834585 | opus | 1.4M | **13.6M** | 19 |
| **tổng** | | **18.0M** | **60.5M** | |

Task 1786505684286: dựng workflow 110KB / 52 node tốn **5.4M**; hỏi về nó tốn **32.1M** — **gấp 6**.
Trung bình **~0.7M token input quy đổi cho MỖI câu hỏi**.

**[ĐO] Một lượt hỏi được cấu thành từ gì** (session 1786505684286, 12.77M ký tự hội thoại):

| thành phần | ký tự | tỉ trọng | ≈token |
|---|---|---|---|
| seed gửi lại (requirement + SPEC.md + **main.yml** + report.json + liveTest) | 7.84M | **61.4%** | 2.24M |
| đọc file — lần đầu | 2.98M | 23.3% | 851k |
| **đọc lại file đã đọc** | 1.47M | **11.5%** | 421k |
| thinking | 230k | 1.8% | 66k |
| **câu trả lời thật** | 217k | **1.7%** | 62k |

Thứ user cần chiếm **1.7%**. 96% còn lại là bối cảnh, phần lớn là bản sao của chính nó.

**[ĐO] Seed lặp**: 46 lượt hỏi chỉ có **5 phiên bản seed khác nhau**; **89% lượng byte gửi lại giống
hệt lượt ngay trước**. Mỗi seed 124.095–140.866 ký tự (≈35–40k token).

**[ĐO] Đọc lại**: **7/15 file bị đọc ≥2 lần**; mỗi ảnh 52k–274k token. Task này có **13 file đính kèm**
và `attachmentBlock(task.attachments)` liệt kê **toàn bộ 13 file ở MỌI lượt hỏi**, kèm câu
*"Read the file(s) above if you need their contents"* — tức mời model đọc lại ảnh cũ, mãi mãi.

**[ĐO] Đường cong phình**: ask #1 đã tốn 74.6k token; ask #16 lịch sử đạt **840k**. Mỗi lượt phình
~55k (seed ~38k + trả lời + tool output). Mỗi API call đọc lại toàn bộ prefix → 74.5M `cache_read`;
cache hết hạn thì tạo lại toàn bộ ở giá 1.25× → 19.45M `cache_creation`.

**[ĐO] Cỡ thật của từng mục seed** (`build_requirement_news_automation`, worst case 143KB):
`main.yml` 99.8KB · `SPEC.md` 37.7KB · `report.json` ~6KB · requirement ~2KB.
`main.yml` chiếm **~85%** seed. Mục lục node+cạnh của chính file đó (**50 node, 46 cạnh** — đếm lại bằng
parser thật; con số 52/49 ở bản nháp là đếm tay) = **4.072 ký tự = 4,1%** (4.323 sau khi thêm nhãn
`[inside …]` cho node trong iteration). Outline heading của SPEC.md 37.7KB = **748 ký tự = 2%**.

## 2. Ràng buộc đã suýt làm hỏng bản sửa đầu tiên

**[ĐO] Session Ask BỊ COMPACTION.** Marker `isCompactSummary: true` xuất hiện **2 lần** trong session
1786505684286 (07:50 và 12:36 ngày 2026-08-13), thấy được qua việc prefix tụt 840k → 420k → 220k.

Hệ quả: **mọi phương án "chỉ seed ở lượt đầu" đều SAI.** Sau compaction, YAML đã inline ở các lượt cũ
bị tóm tắt mất; không gửi lại thì model trả lời về một workflow nó không còn nhìn thấy — sai âm thầm,
loại lỗi tệ nhất. Việc gửi lại tốn kém hiện nay, một cách tình cờ, chính là thứ giữ cho câu trả lời
đúng qua compaction.

→ Nguyên tắc bắt buộc: **không giảm TẦN SUẤT gửi, chỉ giảm KÍCH THƯỚC thứ được gửi.**

## 3. Nguyên tắc phải giữ khi sửa

1. **Compaction-safe**: mọi thứ model cần để trả lời phải có mặt ở *mỗi* lượt, hoặc đọc lại được theo
   đường dẫn. Không có cơ chế "nhớ từ lượt trước".
2. **Không phá bài học spec 089**: một file thả vào giữa cuộc trò chuyện từng bị lưu rồi **không hề
   nói cho model biết** (nó trả lời "tôi chỉ nhận được text"). File **mới của lượt này** phải luôn được
   nêu đầy đủ kèm đường dẫn và lời mời đọc.
3. **Degrade phải nói ra**: YAML không parse được thì nói rõ trong seed, không im lặng bỏ qua
   (DNA 081 preflight).
4. **Không đụng thứ đã đo là lành**: `/reply`, Ask tại gate ①②③, prompt phase, consult.
5. **`seededFrom` phải trung thực**: caption `参照:` là thứ user dùng để biết câu trả lời dựa trên gì.

## 4. Slices

### S1 — `main.yml` inline → mục lục node + đường dẫn (lợi lớn nhất)

`gatherTerminalSeed` (`server/lib/ask.ts`) thay thân `main.yml` bằng:
- danh sách `id | type | title` cho mọi node,
- danh sách cạnh `source->target`,
- **đường dẫn repo-relative của file** + một dòng chỉ dẫn đọc khi cần chi tiết.

**Degrade (bắt buộc)**: YAML parse lỗi **hoặc** 0 node → inline nguyên file nếu < 8KB; lớn hơn thì
inline phần đầu + ghi rõ *"node index unavailable"*. Nhánh này cũng là thứ giữ test hiện có xanh:
fixture của `ask.test.ts` dùng `main.yml` = `workflow: {}` (0 node).

**Cap mục lục**: workflow rất lớn thì mục lục cũng lớn. > 200 node → liệt kê 200 dòng đầu + một dòng
`… và N node nữa, xem <path>`. Không có cap thì ta chỉ đổi một thứ vô hạn lấy một thứ vô hạn khác.

**AC**: prompt **không** chứa thân YAML thô; prompt chứa **đủ mọi node id** (dưới ngưỡng cap);
`seededFrom` vẫn có tag `main.yml`; phần main.yml của seed cho build 52 node ≤ **6KB**
(hôm nay: 110KB).
*(Không đặt AC cho TỔNG seed ở slice này — `SPEC.md` vẫn inline nguyên, và với build 37.7KB spec thì
tổng vẫn ~49KB. Chỉ tiêu tổng ≤12KB thuộc về S1+S3, ghi ở §6.)*

### S2 — Danh sách đính kèm: chỉ file của LƯỢT NÀY

Hôm nay `attachmentBlock(task.attachments)` gửi **toàn bộ lịch sử đính kèm** mỗi lượt + lời mời đọc.

- File **mới của tin nhắn này**: giữ nguyên hành vi hôm nay (đường dẫn đầy đủ + lời mời đọc + cảnh báo
  untrusted-data).
- File **cũ**: vẫn kê **đường dẫn đầy đủ** (model tự `Read` được khi thật sự cần), nhưng **bỏ lời mời
  "Read the file(s) above if you need their contents"**. Chính lời mời đó — chứ không phải sự tồn tại
  của đường dẫn — là thứ khiến 7/15 file bị đọc lại. *(Bản nháp đầu của spec này định chỉ kê **tên**;
  review loại bỏ: model sẽ phải đoán đường dẫn, và một câu hỏi kiểu "xem lại ảnh lúc nãy" sẽ hỏng.)*
- **Lượt không kèm file nào** ⇒ **mọi** file đều là cũ ⇒ **không ai** được mời đọc. Đây mới là ca chiếm
  đa số (46 lượt hỏi / 13 đính kèm), nên nó quyết định S2 có giá trị hay không.

Route `/ask` đã tính sẵn `uploads` (chỉ số các file lưu bởi *chính request này*) và đang truyền cho
`consultWithin`; cần truyền thêm cho `askWithin`/`askTestWithin`.

**Bẫy `undefined` vs `[]`** (vòng 1 đã sập vào): "tham số optional, mặc định = hành vi hôm nay" chỉ đúng
cho **caller cũ không truyền gì** (phase/reply). Nếu gộp luôn `[]` vào nhánh mặc định thì lượt hỏi
không kèm file — đúng ca đông nhất — quay về hành vi cũ và S2 không cắt được gì. Route phải truyền
`uploads ?? []`.

**Bán kính**: `attachmentBlock` còn được `orchestrator.ts:456` dùng cho phase + `/reply` — **giữ chữ
ký cũ hoạt động y hệt**, chỉ thêm tham số optional. Consult **không** đổi ở slice này (§7).

**AC**: file mới có đường dẫn + lời mời "Read"; file cũ có đường dẫn nhưng **không** có lời mời; lượt
không kèm file ⇒ prompt **không chứa** chuỗi "Read the file(s) above" mà **vẫn đủ mọi đường dẫn**;
`attachmentBlock(paths)` gọi theo chữ ký cũ trả ra **byte y hệt hôm nay** (test hiện có
`attachments.test.ts` không được sửa).

### S3 — SPEC.md theo ngưỡng (lợi vừa, rủi ro thấp)

`SPEC.md` ≤ ngưỡng (đề xuất 16KB): inline như hôm nay. Vượt: outline heading + đường dẫn
(37.7KB → 748 ký tự).

**Ngưỡng đo bằng BYTE, không phải `String.length`.** Vòng 1 đo bằng ký tự nên một SPEC.md tiếng Nhật
**16.398 byte** (chỉ ~5.500 ký tự) lọt qua cap "16KB" và bị inline nguyên — seed thật của
`build_requirement_news_automation_2` là **18.645 ký tự, vượt cả hàng rào S4**, mà test vẫn xanh vì
fixture toàn ASCII. Sau khi đổi sang `Buffer.byteLength`: **5.319**. Outline cũng phải có cap riêng
(một spec 400 heading thì chính outline lại thành bức tường chữ).

**`report.json` bị LOẠI khỏi spec sau khi đo.** Bản nháp định rút gọn nó; đo thật thì cả file chỉ
~6KB và hai mục lớn nhất lại là thứ đáng giá nhất khi trả lời (`notes` 2.6KB, `criteria_check` 2.7KB).
Cắt được ~3KB nhưng đánh đổi bằng bối cảnh thật — không đáng. `liveTest` cũng nhỏ (task đo được:
không có). Giữ nguyên cả hai.

### S4 — Hàng rào chống tái phát

Test khẳng định seed của một fixture build lớn **dưới ngưỡng byte**. Đây là thứ đáng lẽ phải có từ
đầu: không có nó, lần sau ai đó thêm một `add('...')` vào seed là quay lại điểm xuất phát mà không ai
biết cho tới khi hết hạn mức.

**Hàng rào phải có một fixture CJK.** Bản vòng 1 chỉ đo ASCII nên nó xanh trong đúng ca nó phải bắt
(§S3). Và cái gì có thể phình thì phải có cap: số node (200), **số cạnh (300)**, **độ dài title (60)** —
không có cap title thì một node có tiêu đề dài bằng đoạn văn cũng đủ thổi seed.

## 5. Rủi ro + chốt chặn

| # | Rủi ro | Chốt chặn |
|---|---|---|
| R1 | Câu hỏi cần chi tiết YAML (giá trị header, prompt của node) giờ phải `Read` → token **chuyển chỗ** chứ không mất | Mục lục có id/type/title + cạnh → phần lớn câu hỏi "cái gì / luồng ra sao" trả lời được ngay. Nghiệm thu bằng token thật sau khi user hỏi vài câu (§6), nếu không giảm thì revert S1. |
| R2 | Model cần một ảnh cũ nhưng không còn được mời đọc | Tên file + thư mục vẫn nằm trong prompt; model tự `Read` được khi thấy cần. |
| R3 | Vỡ bài học 089 (file mới bị bỏ quên) | File mới luôn đầy đủ; test ghim riêng. |
| R4 | Ai đó "tối ưu" tiếp thành seed-một-lần | §2 ghi rõ lý do + test S4 không bắt được lỗi này ⇒ ghi thêm cảnh báo ngay tại `gatherTerminalSeed`. |
| R5 | Đổi `attachmentBlock` làm hỏng phase/reply | Chữ ký cũ giữ nguyên hành vi; test cũ không được sửa. |
| R6 | Sau compaction, mục lục vẫn còn nhưng chi tiết đã mất | Đúng — và đây là **cải thiện** so với hôm nay: mục lục nhỏ nên luôn được gửi lại, còn file thì đọc lại được. |
| R7 | Mục lục nói dối về **vòng lặp**: DSL Dify để node con của iteration ngay trong `nodes:` gốc (`parentId`) và cạnh của chúng trong `edges:` gốc — nên câu "inner graph — not expanded" vừa sai, vừa che mất chuyện `a -> b` có thể chạy **mỗi item** | Đánh dấu `[inside <container>]` trên từng node con + một dòng giải thích. Container **không** có con nào phân giải được thì mới nói ra là không đọc được thân nó. |
| **R-calib** | **Bộ quét YAML tự viết cho ra map SAI mà vẫn `ok:true`** — nguy hiểm nhất trong cả spec, vì model sẽ trả lời về node không tồn tại | Server chỉ có 1 dependency (`fastify`) nên không có parser YAML; bù bằng **hiệu chuẩn bắt buộc** với `python yaml` trên **mọi workflow thật trong repo (153 file)**. Lịch sử: vòng 1 hỏng 24/25 → sửa → còn 2 file sai (comment) → sửa → tuyên bố "25/25"; mở rộng ra 153 file lộ thêm **11 file sai-mà-tự-tin** (cột-0 và flow-style). Hiện: **141 khớp / 12 fallback / 0 sai**. Ba guard trong code: (1) số node = số item, (2) dòng làm dừng mảng phải giống cấu trúc YAML, (3) `edges:` có item mà không rút được cặp ⇒ `ok:false`. **Hiệu chuẩn nay là test**: `test/workflow-index-calibration.test.ts` so với golden do `test/helpers/workflow-index-golden.py` sinh — chạy trong mọi lần `npm test`, không cần python. Sửa `workflow-index.ts` ⇒ chạy lại script và **đọc diff**. |
| **R-empty** | **`[]` bị gộp vào nhánh "caller không có ý kiến"** ⇒ S2 thành no-op ở ca đông nhất | §4 S2 "Bẫy `undefined` vs `[]`"; test ghim cả hai chiều (`undefined` = byte y hệt hành vi cũ, `[]` = không ai được mời đọc). |

## 6. Nghiệm thu

1. **Trước/sau bằng seam có sẵn**: đo seed của một lượt hỏi trên artifact thật (script mẫu ở
   scratchpad). Mốc: **≤16.000 byte** — cùng con số hàng rào S4 dùng, để chỉ có **một** ngưỡng phải
   nhớ. Đo lại sau khi vá, trên chính ba build của user (requirement + report.json để rỗng, nên đây là
   phần seed do code quyết định):
   `build_requirement_news_automation` **5.738** · `_2` **5.319** (trước khi sửa đơn vị: 18.645) ·
   `yml_tsv_webhook_url` **9.094** ký tự.
2. Full suite: web + server. Test cũ **không được sửa** — nếu một test cũ đỏ thì đó là tín hiệu đổi
   hành vi ngoài ý muốn, không phải test sai. *(Vòng 2: 4 test đỏ, **cả 4 đều là test của chính 098**
   ghim đúng những hành vi vừa bị phát hiện là sai — đã cập nhật; không test cũ nào đỏ. Kết quả:
   server 1007 pass, web 341 pass.)*
3. **Kiểm chất lượng câu trả lời — THỦ CÔNG, không tự động hoá được**: hỏi 3 câu trên một build lớn
   thật, gồm một câu "cái gì/luồng ra sao" (mục lục phải đủ) và một câu chi tiết
   ("node N5 gọi URL nào?" — model phải tự `Read` và trả lời đúng). Nếu câu chi tiết sai hoặc model
   không tìm được file ⇒ S1 hỏng ⇒ revert. Phải ghi lại nguyên văn 3 câu hỏi + phán quyết.

   **ĐÃ CHẠY 2026-08-14 — ĐẠT.** Chọn task `1786080751867` (`yml_tsv_webhook_url`, main.yml **87KB /
   16 node**) vì `sessionIds.askTest` **rỗng** — session sạch, model chưa từng thấy YAML này inline;
   task đo ở §1 thì đã có 60 lượt hỏi cũ nên lịch sử của nó làm nhiễu phép thử.

   | # | câu hỏi (nguyên văn) | phán quyết |
   |---|---|---|
   | 1 | *"Workflow này có những node nào và chạy theo luồng ra sao? Node nào nằm trong vòng lặp?"* | **ĐẠT** — model tự tìm file theo đường dẫn trong map, `Read` 5 lượt + grep, dựng đúng 16 node, đúng container `17769966313390`, đúng nhánh `success-branch`/`fail-branch` |
   | 2 | *"Ba node LLM trong workflow dùng model nào (provider + tên model + temperature)? Trả lời chính xác từng node một."* | **ĐẠT** — khớp 100% ground truth (`langgenius/gemini/google` · `gemini-3.1-pro-preview` · `mode: chat` · `temperature 0.7` cho cả ba), còn bắt thêm `context.enabled: true` chỉ có ở `LLM 5_poss` |
   | 3 | *"File yml tôi đính kèm lúc tạo build có bao nhiêu node, và so với main.yml hiện tại thì thêm/bớt những node nào?"* | **ĐẠT (chốt R2)** — file cũ đã **mất lời mời đọc** mà model vẫn với tới được: 14 node/13 cạnh so với 16/16, liệt kê đúng 2 node thêm + 3 cạnh mới |

   Câu 1 cho thấy R1 là **thật nhưng có đáy**: model vẫn đọc file khi muốn chi tiết, nhưng chỉ **một
   lần cho cả session** — số tool call giảm dần 18 → 4 → 9, và chi phí giảm theo (dưới).
4. **Token thật**: sau khi user hỏi vài câu trên một build lớn, đọc lại
   `~/.claude/projects/.../<askTest sessionId>.jsonl` và so `eff` mỗi lượt với mốc **~0.7M** hiện nay.
   Đây là phép đo đã tạo ra mọi con số ở §1 nên so sánh trực tiếp được.

   **ĐÃ ĐO 2026-08-14 — ĐẠT.** (`eff = input + cache_creation×1.25 + cache_read×0.10`, đúng công thức §1)

   | phiên | lượt | eff |
   |---|---|---|
   | `d21cf02d` — session **sạch**, 87KB/16 node | #1 (đọc cả file) · #2 · #3 | **147k · 127k · 102k** (trung bình **0.13M**) |
   | `89baa8c1` — session **cũ resume**, 110KB/50 node | 60 lượt trước 098 | trung bình **0.66M** |
   | | lượt đầu sau 098 | **134k** |

   **≈ −80% mỗi lượt.** Quan trọng hơn con số: đường cong **đi xuống** (147→127→102k) thay vì phình
   (§1 đo được ask #1 74.6k → ask #16 **840k**) — vì thứ được gửi lại mỗi lượt nay là mục lục 1.5–4KB,
   còn file thì đọc một lần rồi nằm trong prefix.

   *Cảnh báo khi đọc bảng này*: hai phiên khác workflow và khác lịch sử, nên đây **không** phải A/B
   nghiêm ngặt trên cùng một câu hỏi. Thứ đo chính xác được là **kích thước seed** (§6.1) và **hướng của
   đường cong**; con số −80% là chỉ dấu, không phải hằng số.

## 7. Non-goals

- **Không** đụng `/reply`, Ask tại gate, prompt phase — đã đo là lành.
- **Không** đổi consult ở spec này (nó cũng liệt kê đính kèm mọi lượt, nhưng mọi số đo ở §1 đến từ
  build ask; mở rộng sang consult là việc riêng, sau khi S2 chứng minh an toàn).
- **Không** làm "seed một lần" / cache seed theo vân tay — §2 giải thích vì sao.
- **Không** gộp việc reset session Ask và tách model chat khỏi model build vào đây (xem §8).

## 8. Chốt lúc implement (không chặn)

1. **SPEC.md**: làm S3, ngưỡng **16KB**. Dưới ngưỡng inline như cũ (đa số build), vượt thì outline +
   đường dẫn — nên câu hỏi chi tiết về spec vẫn đọc lại được.
2. **Nhãn `参照:` giữ nguyên `main.yml`.** Câu trả lời *thật sự* dựng từ main.yml (qua mục lục của nó,
   và model đọc lại được file gốc), nên caption không sai; đổi chữ sẽ đổi thứ user nhìn thấy và làm đỏ
   một assertion đang ghim mà không đem lại gì.
3. **Reset session Ask + tách model cho chat: KHÔNG làm ở spec này** (§7) — độc lập, và đo lại sau S1/S2
   mới biết còn cần tới mức nào.

## 8b. Open questions (còn để ngỏ)

1. `SPEC.md`: luôn inline (đơn giản) hay cắt theo ngưỡng + outline (cắt sâu hơn nhưng câu hỏi chi tiết
   tốn một lượt đọc)?
2. Nhãn `参照:` giữ `main.yml` hay ghi `main.yml (index)`? Ghi rõ thì trung thực hơn nhưng đổi chữ user
   thấy và làm đỏ một assertion đang ghim.
3. Có làm luôn (a) reset session Ask theo ngưỡng và (b) tách model cho chat không? Cả hai đều chặn
   đường cong phình nhưng độc lập với S1/S2.

## 9. Bảng nhà tri thức (cho `/spec-close`)

| mảnh | nhà |
|---|---|
| Hành vi seed mới + quy tắc đính kèm | `docs/state/turn-and-sandbox.md` (hoặc doc chủ của ask) |
| Bài học "**hiệu chuẩn hẹp = chưa hiệu chuẩn**": 25 file nói 0 lỗi, 153 file nói 11 lỗi | `AGENTS.md §9` — cùng chỗ với kỷ luật kiểm chứng |
| Bài học "`undefined` ≠ `[]` khi tham số optional mang **ý nghĩa**" | comment inline tại `attachmentBlock` |
| Bài học "cap tính bằng byte, không bằng `String.length`" (CJK = 3×) | comment inline tại `ask.ts` + fixture CJK trong `ask-seed-size.test.ts` |
| Nguyên tắc "compaction-safe: giảm kích thước, không giảm tần suất" | cùng doc trên — đây là mảnh đắt nhất |
| Bài học "seed-một-lần là sai vì compaction" | `AGENTS.md §9` (`2026-08-14`) |
| Số đo §1 (bảng token thật + cách lấy) | `docs/prompts/runs/CAMPAIGNS.md` — runbook đo token thật từ log CLI |
| Quyết định lúc implement | comment inline tại `gatherTerminalSeed` / `attachmentBlock` |
