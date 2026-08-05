# Spec 089 — Đính kèm file Office (docx/xlsx/pptx): extract-at-upload thành sidecar text

**Status**: **ĐÃ IMPLEMENT** (2026-08-05, uncommitted) — S1–S6 xong; server **821 pass/0 fail** +
typecheck sạch, web 252 pass/0 fail + `tsc` sạch. S6 phát sinh sau khi người dùng thử thật (chat chỉ
đính kèm được ở tin đầu). Còn lại duy nhất: e2e §6 (chưa chạy). §11 ghi 4 điểm thực tế lệch spec. v2 = tự-review: pptx phải theo `sldIdLst` chứ không theo số tên file (bất nhất với xlsx) ·
extract-ra-rỗng phải 400 chứ không ghi sidecar rỗng (vi phạm chính §3) · sidecar header thành yêu cầu S3
thay vì mẹo ở §8 · `MAX_INFLATED` 64→32 MB (trần bộ nhớ 3 file). v1 = bản đầu.
**Effort**: S1 ≈ M (zip reader) · S2 ≈ L (3 extractor, xlsx nặng nhất) · S3 ≈ S (nối vào validate+save)
· S4 ≈ XS (allowlist + UI + i18n) · S5 ≈ M (test + fixture).
**Đóng spec**: qua `/spec-close 089`.

---

## 1. Bối cảnh — hình dạng input thật của stakeholder

Người dùng mang tới một `.docx` do stakeholder Nhật soạn (đề xuất flow Dify: thu thập tin tức bằng
Tavily → khử trùng lặp bằng vector DB → xuất Spreadsheet → thông báo Chatwork) và **không attach vào
Builder được**: file picker của composer làm xám file ra, không select nổi.

Đây không phải ca hiếm. Input mà stakeholder giao thường là **docx (đề xuất/仕様書)** và **xlsx
(keyword sheet, danh sách cột, mapping)** — đúng hai thứ Builder đang từ chối. Đường vòng hiện tại là
người dùng tự copy-paste nội dung vào ô chat, mất bảng biểu và mất luôn cấu trúc.

### 1.1 Ba tầng chặn, đo bằng code

| Tầng | Neo | Hành vi hiện tại |
|---|---|---|
| ① File picker | `ACCEPT_ATTR`, [Chat.tsx:613](../../apps/builder/web/src/components/Chat.tsx) → `<input accept>` [:764](../../apps/builder/web/src/components/Chat.tsx) | dựng từ `ACCEPTED_EXT`; không có `docx` → OS **xám file**, đây đúng là triệu chứng người dùng gặp |
| ② Validator | `ACCEPTED_EXT` [server:44](../../apps/builder/server/lib/attachments.ts) + [web:17](../../apps/builder/web/src/lib/attachments.ts) | ext lạ → 400 `unsupported file` |
| ③ **Đọc nội dung** | `attachmentBlock` [:198](../../apps/builder/server/lib/attachments.ts) chỉ bơm **đường dẫn**; turn dùng tool `Read` | **`Read` không parse được zip+XML** |

Tầng ③ là lý do spec 025 **cố ý** loại office. Comment còn nguyên tại
[attachments.ts:42](../../apps/builder/server/lib/attachments.ts):

> office binaries (docx/xlsx/pptx) are a Non-goal (`Read` can't parse them)

Quyết định đó **đúng ở thời điểm 025** — khi ấy không có đường nào biến docx thành token.

## 2. Chẩn đoán gốc — MỘT nguyên lý

Bất biến của 025 là **path-injection**: bytes không bao giờ vào prompt, chỉ đường dẫn vào, rồi turn tự
`Read`. Bất biến đó gắn năng lực của Builder vào **năng lực parse của tool `Read`**.

089 tháo đúng chỗ ghép đó: chuyển câu hỏi từ *"`Read` parse được gì"* sang *"server **chuẩn bị** được
gì trước khi turn chạy"*. Server extract office → text ngay lúc upload, ghi ra một **sidecar** cạnh bản
gốc, và bơm đường dẫn **sidecar**. Bất biến path-injection **không đổi một chữ**; orchestrator,
`attachmentBlock`, hook sandbox, write-allowlist — không đụng cái nào.

> **Hệ quả bắt buộc:** nới ①+② mà không làm ③ là **tệ hơn hiện trạng**. Người dùng attach được, turn
> `Read` phải một đống zip nhị phân, rồi model **bịa** ra nội dung. Hỏng-âm-thầm đắt hơn từ-chối-rõ-ràng.
> Vì vậy thứ tự slice là ③ trước, ① sau (§5).

## 3. Nguyên tắc (giữ khi implement)

- **Giữ nguyên bất biến 025.** Chỉ PATH vào prompt. Không base64 nội dung vào prompt, không đổi
  `attachmentBlock`, không đổi hợp đồng `task.attachments`.
- **Một path cho mỗi file input — KHÔNG bao giờ hai.** `task.attachments.length` là chỉ số nối cho
  reply-turn ([tasks.ts:538](../../apps/builder/server/routes/tasks.ts) `start`); trả về cả bản gốc lẫn
  sidecar sẽ làm `start` lệch và file lượt sau **ghi đè** file lượt trước. Sidecar **thay thế** bản gốc
  trong mảng trả về, bản gốc vẫn nằm trên đĩa.
- **Extract thuộc về `validateAttachments`, không phải `saveAttachments`.** `validateAttachments` là
  PURE và đã là **cửa 400 duy nhất** ([:102](../../apps/builder/server/lib/attachments.ts)); extract
  cũng thuần (Buffer→string). File office hỏng là **lỗi của người dùng → 400 có chữ**, không phải lỗi
  đĩa → 500. Đặt sai chỗ là mất luôn thông điệp lỗi tử tế.
- **Không im lặng.** Extract fail → nguyên turn 400. **Không bao giờ** fallback sang inject bản gốc.
  Sidecar bị cắt vì quá dài → ghi rõ trong chính sidecar (luật "no silent caps" của repo).
- **Zero dependency mới.** Đối xứng với [zip.ts](../../apps/builder/server/lib/zip.ts) — writer
  store-only tự viết, comment nêu rõ *"No `archiver` dependency (repo lean ethos)"*. Builder hiện có
  **đúng một** runtime dep (`fastify`). Cả 3 định dạng đều là ZIP+XML; `node:zlib` đủ dùng.
- **Không bao giờ ghi entry của zip ra đĩa.** Chỉ đọc một allowlist tên entry cố định vào memory. Đây
  là hàng rào path-traversal: không có đường nào từ tên entry ra tới filesystem.

## 4. Cơ chế — neo file:line

- **Validate (cửa 400)**: `validateAttachments` [attachments.ts:102](../../apps/builder/server/lib/attachments.ts);
  allowlist `ACCEPTED_EXT` [:44](../../apps/builder/server/lib/attachments.ts), gương ở web
  [:17](../../apps/builder/web/src/lib/attachments.ts); `ParsedAttachment` [:29](../../apps/builder/server/lib/attachments.ts).
- **Save (I/O)**: `saveAttachments` [:175](../../apps/builder/server/lib/attachments.ts) → ghi
  `.runs/<taskId>/uploads/<idx>_<safeName>`, trả rel path [:188](../../apps/builder/server/lib/attachments.ts);
  `sanitizeName` [:158](../../apps/builder/server/lib/attachments.ts).
- **Inject**: `attachmentBlock` [:198](../../apps/builder/server/lib/attachments.ts) ←
  [orchestrator.ts:446](../../apps/builder/server/lib/orchestrator.ts) (build) và
  [ask.ts:270](../../apps/builder/server/lib/ask.ts) / [:579](../../apps/builder/server/lib/ask.ts) (ask/consult).
- **3 call site của `saveAttachments`** — sidecar làm trong hàm nên **cả ba hưởng miễn phí**:
  [tasks.ts:201](../../apps/builder/server/routes/tasks.ts) (build mới) ·
  [:311](../../apps/builder/server/routes/tasks.ts) (consult, spec 082) ·
  [:539](../../apps/builder/server/routes/tasks.ts) (reply, có `startIndex`).
- **`task.attachments` là ĐƯỜNG DẪN THẬT, không chỉ chuỗi prompt**: `yamlCards`
  [ask.ts:482](../../apps/builder/server/lib/ask.ts) lọc `isYamlRel`
  [:474](../../apps/builder/server/lib/ask.ts) rồi **đọc lại file** để lint. Office sidecar là `.md` nên
  không lọt bộ lọc này (an toàn), nhưng đây là bằng chứng mảng đó có consumer đọc đĩa — đừng coi nó là
  chuỗi hiển thị.
- **`.yml` trong allowlist là load-bearing** cho luồng base-import/consult
  ([tasks.ts:293](../../apps/builder/server/routes/tasks.ts)) — chỉ THÊM vào `ACCEPTED_EXT`, không bao
  giờ sắp xếp lại hay bớt.
- **Zip writer đối xứng**: [zip.ts](../../apps/builder/server/lib/zip.ts) — crc32, central directory,
  EOCD, dependency-free. Reader ở S1 dùng chung từ vựng và phong cách comment.
- **Body cap**: `BODY_LIMIT_BYTES` [:70](../../apps/builder/server/lib/attachments.ts) = 64 MiB, đã
  thừa cho 3×10 MB base64 — **không cần đụng**.

## 5. Slices (làm đúng thứ tự S1→S2→S5(phần 1,2)→S3→S4)

Converter phải xanh test **trước khi** UI cho phép select — không có thời điểm nào build ở trạng thái
"attach được nhưng đọc ra rác" (§2).

### S1 — `server/lib/unzip.ts`: zip reader dependency-free (M)

Một export duy nhất:

```ts
export function readEntries(buf: Buffer, want: (name: string) => boolean): Map<string, Buffer>
```

- Quét ngược tìm EOCD `0x06054b50` (chịu được comment đuôi) → đọc central directory → với entry
  `want(name) === true` mới nhảy tới local header lấy dữ liệu.
- `method 0` copy thẳng; `method 8` → `zlib.inflateRawSync`. Method khác → ném lỗi có tên entry.
- **Cap tổng byte sau inflate** (`MAX_INFLATED`, đề xuất **32 MB**) → chặn zip bomb. Vượt → ném. Cap này
  áp **cho mỗi file**, mà một turn có tối đa 3 file → trần bộ nhớ tức thời ≈ 96 MB Buffer nằm **chồng
  lên** body 64 MiB đã nhận. 64 MB/file sẽ đẩy con số đó lên ~256 MB cho một app chạy local — chọn 32
  MB, vẫn thừa cho mọi file office trong hạn 10 MB nén.
- `inflateRawSync` **chặn event loop** (~vài trăm ms cho xlsx 10 MB). Chấp nhận được: Builder là app
  localhost một người dùng, và giữ đồng bộ là thứ cho phép `validateAttachments` **không** phải chuyển
  sang `async` — nếu đổi chữ ký hàm thì cả 3 route và toàn bộ `attachments.test.ts` phải sửa theo.
- Không có API ghi đĩa trong module này. `want` là hàng rào: caller chỉ xin đúng entry nó cần.
- Không hỗ trợ Zip64 (file office trong hạn 10 MB không bao giờ chạm) — gặp thì ném lỗi rõ chữ.

### S2 — `server/lib/office-text.ts`: 3 extractor + dispatch (L)

Thuần, không I/O. `extractOfficeText(ext, bytes): string`, ném `Error` có chữ khi không đọc được.

- **docx** — entry `word/document.xml`. `</w:p>`→newline · `<w:tab/>`→tab · `<w:br/>`→newline ·
  `<w:tr>`/`<w:tc>` → hàng markdown `| a | b |` · strip tag · unescape entity XML.
- **pptx** — thứ tự slide lấy từ `ppt/presentation.xml` (`<p:sldIdLst>`) + `ppt/_rels/presentation.xml.rels`,
  **KHÔNG** sort theo số tên file: PowerPoint giữ nguyên tên file khi người dùng kéo đổi thứ tự, nên
  `slide3.xml` hoàn toàn có thể là slide đầu tiên. (Cùng cơ chế rels như xlsx dùng — v1 của spec này từng
  viết "sort theo số" cho pptx trong khi lại dùng rels cho xlsx; đó là bất nhất, không phải tối giản.)
  Mỗi slide → `## Slide N` + các `<a:t>` nối lại.
- **xlsx** — nặng nhất, ~½ công của slice:
  - `xl/workbook.xml` → tên sheet + thứ tự; `xl/_rels/workbook.xml.rels` → ánh xạ `r:id` → file sheet.
  - `xl/sharedStrings.xml` → mảng chuỗi theo chỉ số.
  - `xl/worksheets/sheet*.xml` → mỗi `<c>`: `t="s"` tra shared strings · `t="inlineStr"` lấy `<is><t>` ·
    còn lại lấy `<v>` thô.
  - **Phải parse `r="B3"` ra (cột, hàng)**: ô rỗng bị **bỏ hẳn** khỏi XML, nối tuần tự sẽ **lệch cột** —
    đây là cái bẫy số một của định dạng này.
  - Output: mỗi sheet một khối `## <tên sheet>` + CSV (quote đúng khi có `,`/`"`/newline).

### S3 — Nối vào validate + save (S)

- **`ParsedAttachment` thêm `text?: string`** ([:29](../../apps/builder/server/lib/attachments.ts)).
- **`validateAttachments`**: sau khi decode base64, nếu `ext` ∈ `OFFICE_EXT` → gọi `extractOfficeText`
  trong `try/catch`; ném → `{ ok:false, error: "không đọc được '<tên>' — file hỏng hoặc không phải
  <ext> hợp lệ" }` (400).
- **Kết quả rỗng cũng là 400.** Extract trả chuỗi trắng (docx chỉ có ảnh, sheet trống, slide chỉ hình) →
  `{ ok:false, error: "'<tên>' không có nội dung văn bản nào đọc được" }`. Ghi ra sidecar rỗng rồi để
  turn đọc thấy không-gì là **đúng loại hỏng-âm-thầm mà §3 cấm** — người dùng tưởng đã đưa tài liệu vào,
  model thì không thấy gì và tự bịa phần thiếu.
- **Sidecar bắt buộc có header provenance** (dựng trong `validateAttachments`, đi kèm `text`), 3 dòng:
  tên file gốc + định dạng · phạm vi đã trích (docx: *chỉ thân tài liệu* · xlsx: *giá trị thô, ngày ở
  dạng serial* · pptx: *chỉ text trên slide*) · dòng cắt-bớt nếu có. Đây **không** phải mỹ phẩm: `.md`
  không nói được nó vốn là gì, mà mọi caveat ở §8 chỉ có tác dụng nếu **model đọc được chúng** — chỗ duy
  nhất chắc chắn nó đọc là chính sidecar.
- **Cap ký tự sidecar** (`MAX_SIDECAR_CHARS`, đề xuất 200 000 ≈ 50k token): vượt thì cắt và ghi rõ đã
  cắt bao nhiêu vào **header** (không phải chỉ cuối file — đuôi là chỗ dễ bị chính việc cắt nuốt mất).
- **`saveAttachments`**: ghi bản gốc như cũ; nếu có `text` thì ghi thêm `<idx>_<safeName>.<ext>.md` và
  **push path sidecar** vào `rels` (bản gốc **không** vào — §3, bất biến `start`).
- `attachmentBlock` **không đổi**. Cảnh báo untrusted-data ở
  [:211](../../apps/builder/server/lib/attachments.ts) đã bao được ca này (§8).

### S4 — Nới allowlist + UI + i18n (XS)

- Thêm `docx`/`xlsx`/`pptx` vào `ACCEPTED_EXT` ở **cả hai** file (server [:44](../../apps/builder/server/lib/attachments.ts)
  + web [:17](../../apps/builder/web/src/lib/attachments.ts)). `ACCEPT_ATTR` tự cập nhật — nó derive từ
  set này đúng như comment [Chat.tsx:612](../../apps/builder/web/src/components/Chat.tsx) chủ ý.
- **Nhánh reject riêng cho `doc`/`xls`/`ppt` legacy**: chúng là OLE binary, **không phải zip**, và sẽ
  không bao giờ được hỗ trợ (§10). Message riêng: *"định dạng Office cũ — hãy Save As `.docx`/`.xlsx`/
  `.pptx`"*. Không có nhánh này thì người dùng nhận lỗi chung chung và không hiểu vì sao `.docx` được mà
  `.doc` không.
- i18n `en` + `ja` cho các chuỗi mới ([i18n.ts:388](../../apps/builder/web/src/lib/i18n.ts) và
  [:818](../../apps/builder/web/src/lib/i18n.ts)).

### S5 — Test (M)

1. **Round-trip zip**: `zipStore()` (đã có) sinh archive → `readEntries()` đọc lại đúng bytes. Hai module
   tự kiểm nhau → **không cần fixture nhị phân** cho tầng zip.
2. **Extractor**: fixture office **tự sinh trong test** bằng `zipStore()` với XML viết tay tối thiểu (bảng
   docx, 2 sheet xlsx có ô trống ngắt quãng + shared string + inline string, 3 slide pptx có `slide10`)
   → assert text ra. **Không commit file thật của bất kỳ ai.**
3. **Cửa 400**: zip hỏng / entry thiếu / ext legacy / **extract ra rỗng** → `validateAttachments` trả
   `ok:false` với chữ đúng (ca rỗng: docx chỉ chứa một ảnh, không `<w:t>` nào).
   Thêm: pptx có `sldIdLst` **nghịch** thứ tự tên file → assert slide đầu ra đúng là slide người dùng
   thấy đầu, không phải `slide1.xml`.
4. **Sidecar**: `saveAttachments` với 1 docx → `rels.length === 1`, phần tử là `.md`, **và** bản gốc
   `.docx` tồn tại trên đĩa.
5. **Bất biến `start`**: 2 lượt × 2 file office → 4 phần tử, không path nào trùng.
6. **Guard song sinh** (`ACCEPTED_EXT` server ↔ web bằng nhau). Xem §7.

### S6 — `/ask` mang được file (S) — PHÁT SINH từ phản hồi người dùng, 2026-08-05

Nửa còn thiếu, lộ ra ngay khi S1–S5 chạy được: chat **chỉ đính kèm được ở tin nhắn ĐẦU**
(`POST /api/consult`), mọi tin sau đi qua `POST /:id/ask` vốn **không nhận file ở tầng server**. Composer
ẩn 📎 ([App.tsx](../../apps/builder/web/src/components/App.tsx)) là hành vi trung thực — ẩn còn hơn nuốt
im lặng — nhưng hệ quả là một tài liệu nảy ra giữa cuộc trò chuyện **không có đường vào**.

- **Server**: `/ask` nhận `files`, theo **đúng thứ tự nghi thức của `/reply`**: từ chối hết → mới ghi →
  mới lấy khoá. Kèm pre-check `taskTurnRunning(id)` — đây là luật FIX-M nói lại: một Ask đang sống trên
  CÙNG task đang snapshot + byte-compare `.runs/<id>/uploads/`, nên một lần ghi rơi vào giữa turn sẽ bị
  đọc thành `created` rồi **bị xoá** (mất file của user + báo động giả).
- Gộp luôn hai nhánh `acquireTurn(id,'ask')` trùng nhau (consult và build-ask) thành một, vì giờ cả hai
  cùng phải đi qua khối lưu file.
- **Client**: `api.ask(id,text,files?)` → `store.ask(text,files?)` → composer terminal/consult nhận
  `files`/`onAddFiles`/`onRemoveFile`. `send()` vốn đã dựng `atts` và khôi phục khi 409 — không phải sửa.
- **Cổng build (gate) GIỮ NGUYÊN ẩn 📎 ở chế độ Ask.** Lý do cũ ("/ask nuốt file") nay sai và đã sửa
  comment; lý do đúng còn hiệu lực là **định tuyến**: ở một gate, đưa tài liệu mới vào **chính là một
  yêu cầu thay đổi**, mà Request-changes (`/reply`) đã mang được file và chạy lại phase với chúng. Đính
  kèm ở chế độ Ask trông y hệt nhưng để artifact nguyên si — một cái bẫy im lặng.
- **Wart kế thừa (không sửa ở đây)**: lưu-trước-khoá nghĩa là 409-vì-khoá-bận vẫn để lại file trên đĩa;
  user gửi lại → file bị lưu lần hai. `/reply` có y hệt tính chất này từ trước. Giữ cho nhất quán.

## 6. Validation

- Full suite `npm test` (apps/builder) + `npm run typecheck` xanh.
- **E2E bằng chính file đã kích hoạt spec này**: chạy `/e2e` với prompt "dựng flow theo file đính kèm"
  + `dify_flow_proposal.docx` → kiểm ① Analyze có trích được đúng 7 bước (Tavily → normalize → dedup →
  Sheets → Chatwork) từ sidecar không. Đây là phép thử end-to-end tự nhiên nhất: nếu ① đọc ra đúng
  nghiệp vụ, chuỗi extract→sidecar→inject đã thông.
- Kiểm tay: dossier/export-zip của run đó chứa **cả** bản gốc lẫn sidecar (bản gốc để đối chiếu khi
  nghi extract sai).

## 7. Guard / test phải xanh

- `attachments.test.ts` — mọi case cũ **phải giữ nguyên xanh** (không hồi quy 025).
- **Guard song sinh `ACCEPTED_EXT`** (mới, bắt buộc): một test đọc allowlist ở **cả hai** phía và assert
  bằng nhau. Đây đúng bài học **2026-08-05** trong `AGENTS.md §9` — một hằng số ngữ nghĩa nhân bản qua
  nhiều nơi **bắt buộc** có cross-check đọc MỌI bản sao; lần trước drift kiểu này đẻ ra nguyên chuỗi bug
  "Model not exist". Và theo đúng hai tinh chỉnh của bài học đó: **`grep` literal trước** để chắc chỉ có
  2 bản sao (đừng giả định), và ưu tiên guard **hành vi** — chạy `isAcceptedFile` (web) và
  `validateAttachments` (server) trên cùng bộ tên file rồi so kết luận, thay vì chỉ so hai cái Set.
- `ask-route.test.ts` / `base-import.test.ts` / `consult.test.ts` — không hồi quy đường `.yml`.
- `confinement.test.ts` — sidecar ghi vào **cùng** thư mục `uploads/` nên nằm trong root cũ; test này
  phải vẫn xanh không cần sửa. **Nếu nó đỏ nghĩa là đã ghi sai chỗ.**

## 8. Rủi ro đã biết

- **xlsx trả số thô.** Ngày trong Excel là serial (`45000`) + format string; extractor lấy `<v>` nên ra
  số. Chấp nhận ở v1 → §9 Q3. Sidecar phải ghi header cảnh báo để model không đọc nhầm serial thành số
  lượng.
- **docx phức tạp mất chữ**: text box, header/footer, comment, tracked changes nằm ngoài
  `word/document.xml`. v1 chỉ lấy body — chấp nhận, và sidecar header (S3) nói rõ điều đó.
- **docx mất đánh số danh sách**: bullet/số thứ tự sống ở `numbering.xml`, không ở `document.xml` — một
  quy trình 7 bước đánh số sẽ ra 7 dòng trần, không số. Với chính ca dùng đã sinh ra spec này (đề xuất
  flow đánh số ①–⑦) thì **thứ tự vẫn đúng**, chỉ mất ký hiệu — chấp nhận. Nếu §6 cho thấy ① đọc lẫn thứ
  tự bước thì mới xét đọc `numbering.xml`.
- **Đốt token.** Một xlsx 10 MB có thể ra CSV khổng lồ và ăn sạch ngân sách turn ③ — đúng nút thắt spec
  085 vừa gỡ. `MAX_SIDECAR_CHARS` (S3) là hàng rào; số cụ thể còn ngỏ (§9 Q1).
- **Bề mặt prompt-injection rộng hơn.** Docx của bên thứ ba giờ thành token đọc được — chính xác là ca
  mà cảnh báo untrusted-data [:211](../../apps/builder/server/lib/attachments.ts) tồn tại để đối phó.
  Phòng thủ thật vẫn là PreToolUse hook + write-allowlist 018, không phải câu chữ đó. **Không nới gì thêm.**
- **Zip reader tự viết là mã nhị phân thủ công** — sai một offset là đọc rác. Giảm rủi ro bằng
  round-trip test với `zipStore()` (S5.1) và bằng việc chỉ đọc allowlist entry.

## 9. Open questions

1. **`MAX_SIDECAR_CHARS` = bao nhiêu?** 200k ký tự là ước lượng, chưa đo. Nên đo bằng một xlsx thật cỡ
   vừa rồi chốt.
2. **xlsx nhiều sheet → một sidecar hay nhiều?** v1 đề xuất MỘT (giữ bất biến 1 path/file, §3). Nếu thực
   tế cho thấy model lẫn giữa các sheet thì xét lại — nhưng phải giải bài `start` index trước.
3. **Có convert date serial → ISO không?** Cần đọc `numFmt` của `styles.xml` — công đáng kể. Mặc định
   **KHÔNG** ở v1; bật nếu ① thật sự đọc sai ngày trong e2e.
4. **Sidecar có nên vào dossier/export-zip như một entry riêng?** Mặc định có (nó nằm trong `uploads/`);
   xác nhận lại khi chạy §6.

## 10. Non-goals (KHÔNG làm trong spec này)

- **`.doc` / `.xls` / `.ppt` legacy** — OLE compound binary, hoàn toàn khác zip, cần nguyên một parser
  thứ hai. Reject có chữ (S4) là câu trả lời cuối cùng.
- **Thêm npm dependency** (`mammoth`, SheetJS…) — phá ethos lean mà `zip.ts` đã tuyên bố; SheetJS còn có
  tiền sử bảo mật + rắc rối registry. Zero-dep là **quyết định**, không phải mặc định.
- **Shell-out sang Python** — `openpyxl` không có trong `requirements.in`, chạy được trên máy này chỉ là
  ngẫu nhiên; ship kiểu đó là vỡ trên máy khác.
- **Giữ format/style/ảnh** — sidecar là **text để suy luận**, không phải bản dựng lại tài liệu.
- **OCR ảnh nhúng trong docx/pptx** — ngoài phạm vi hoàn toàn.
- **Công thức xlsx** — lấy giá trị cached (`<v>`), không đánh giá lại công thức.
- **`.odt` / `.pages` / Google Docs export** — chưa có nhu cầu thật nào.
- **Đụng `MAX_ATTACHMENTS` (3), cap 10 MB, hay `BODY_LIMIT_BYTES`** — đều còn thừa chỗ (§4).

## 11. Thực tế lúc implement — 4 điểm lệch spec (2026-08-05)

1. **i18n là NO-OP, không phải việc bỏ sót.** S4 dự trù thêm chuỗi en/ja, nhưng grep toàn `web/src` cho
   thấy **không có chuỗi nào liệt kê định dạng**: nhãn là `attachFile: 'Attach file'` / `dropFiles`, và
   non-image dùng chung một icon doc. Thông báo lỗi từ server là tiếng Anh và hiển thị nguyên văn, đúng
   như `unsupported file` sẵn có. Không sinh chuỗi mới cho một UI vốn không nói về định dạng.

2. **Guard parity phải nạp module web bằng DYNAMIC import.** Import tĩnh **vỡ theo CẢ HAI chiều**: kéo
   `web/src/lib/attachments.ts` vào tsconfig server (node16, không DOM lib) thì hỏng ở `FileReader` +
   đường dẫn không đuôi; kéo `server/lib/attachments.ts` vào tsconfig web (Bundler, `types:["vite/client"]`)
   thì hỏng ở `node:*`. Đây chính là lý do `gate-i18n-labels.test.ts` chọn đọc source dạng text — nhưng
   textual guard là thứ bài học 2026-08-05 nói rõ là YẾU. Lối ra: specifier tính-lúc-chạy (`new URL(...)`)
   — `tsc` không thấy, `tsx` vẫn resolve → giữ được kiểm-tra-hành-vi thật. **Đã chứng minh guard biết
   fail**: bỏ `pptx` khỏi bản web → 2 test đỏ, và test hành vi gọi đích danh `deck.pptx`.

3. **File Office cũ được CHO QUA guard phía client** (`isAcceptedFile`) dù server chắc chắn từ chối.
   Guard client **không có bề mặt báo lỗi** — nó chỉ lặng lẽ vứt file; còn 400 của server thì lên tới
   banner lỗi chung và nói rõ cách sửa. `<input accept>` vẫn ẩn chúng nên ca này chỉ xảy ra khi kéo-thả
   hoặc dán. Đây là sự lệch **có chủ ý** giữa hai phía, được chính guard parity ghi nhận như một ngoại lệ
   được đặt tên, không phải drift.

4. **§9 Q1 (`MAX_SIDECAR_CHARS`) và Q4 (export zip) đã tự trả lời.** Q1: chốt 200 000 — file docx thật của
   stakeholder trích ra **1 322 ký tự**, dư biên 150×. Q4: `bundle.ts` **quét thư mục `uploads/`** chứ
   không đọc `task.attachments`, nên bản gốc **và** sidecar vào export tự động, không cần code gì thêm.
