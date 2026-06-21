# Tự động lập danh sách & tiếp cận ứng viên diễn giả hội thảo

**Slug / name đề xuất**
- **slug:** `conference_speaker_outreach`
- **name:** `カンファレンス登壇候補者 自動リストアップ＆アプローチ` (Tự động lập danh sách & tiếp cận ứng viên diễn giả hội thảo)
- (slug đang trống nên đề xuất mới. Backend sẽ scaffold `projects/conference_speaker_outreach/` khi confirm ở gate. Không tự chạy `init_project.py` ở bước này.)

> File này là sản phẩm của Phase ② (Spec). **Chưa triển khai (implement).** Đối chiếu seed
> `磯貝_カンファレンス登壇候補者の自動リストアップ (2).yml` với danh sách yêu cầu nghiệp vụ
> [13]–[19] để chốt **hình thái mục tiêu (target spec) và phương án sửa**. ID sẽ được cấp ở
> Phase Implement bằng `generate_id.py` (ở đây chỉ là placeholder).

---

## Mục tiêu (Goal)

Mở rộng & sửa pipeline tuyến tính hiện tại của seed ("Google SERP → LLM trích xuất → ghi
Spreadsheet → vòng lặp tìm liên hệ") để đáp ứng các yêu cầu [13]–[19]. Bốn trọng tâm:

1. **Độ bao phủ thu thập [13]:** thêm lọc `site:` cho connpass / Doorkeeper / trang chính thức của
   từng hội thảo vào SERP tổng quát, nhắm đúng URL trang sự kiện / trang diễn giả.
2. **Chất lượng trích xuất [14]:** thôi phụ thuộc vào snippet SERP; lấy HTML trang ứng viên để
   trích xuất có cấu trúc name/company/topic. Thêm cột `press_url` · `source_memo`.
3. **Hiện thực hóa liên hệ [15][16]:** không chỉ "URL trang liên hệ" mà trích xuất cả **email**
   bằng regex, và **sửa HTTP update đang no-op vì `rows:[]`** để ghi ngược dữ liệu xuống Spreadsheet.
4. **Soạn văn tiếp cận [18][19]:** **thêm mới** LLM sinh template 2 tông giọng (trang trọng / thân
   mật) và một vòng lặp LLM sinh nội dung động cho từng diễn giả.

---

## Bảng mức độ đáp ứng (Yêu cầu → Hiện trạng → Mục tiêu)

| Yêu cầu | Trạng thái (hiện tại) | Node phụ trách hiện tại | Xử lý ở mục tiêu |
|---|---|---|---|
| [13] Thu thập trang sự kiện | Một phần | `1780885381582`(query LLM) / `1780884944980`(GoogleSearch) | **modify**: thêm điều kiện đặc thù sự kiện `site:connpass.com` v.v. vào query LLM |
| [14] Trích xuất thông tin diễn giả | Một phần | `1780908589328`(LLM trích xuất) / `1780908987315`(code chuẩn hóa) | **add**: vòng lặp fetch HTML (http-request+code). **modify**: thêm `press_url`·`source_memo` vào schema/cột |
| [15] Thu thập liên hệ (email) | Một phần | `1781080242221`(iter) / `1781081089438`(LLM④) | **add**: lấy HTML trang liên hệ + trích email bằng regex. Đổi output iteration `array[string]`→`array[object]{contact_url,email}` |
| [16] Sinh & quản lý danh sách | Một phần | `1781082351511`(code update) / `1781063614318`,`1781082713040`(HTTP) | **modify(nghiêm trọng)**: hiện thực hóa `rows:[]` bằng khớp khóa name/url. Thống nhất cột insert/update theo format quy định |
| [18] Văn tiếp cận (template 2 tông) | **Chưa có** | — | **add**: LLM sinh template 2 tông formal/casual |
| [19] Văn tiếp cận (sinh động) | **Chưa có** | — | **add**: lặp speaker_rows, LLM sinh nội dung động từng ứng viên → ghi sheet |

---

## Pattern được chọn (+ lý do)

Chọn **`projects/news_automation/workflows/main.yml`** (27 node, plugin `google`+`openai`,
gồm http-request / iteration / llm / code / start / end).

- **Thứ tự ưu tiên:** `templates/patterns/` không có mẫu kiểu "Google search → vòng lặp → ghi HTTP"
  (`file-iteration.yml` gần nhất nhưng thuộc nhánh document-extractor, khác bản chất). Ở lớp ưu tiên
  thứ 2 `projects/*` có sẵn ví dụ đã kiểm chứng **cùng domain, cùng idiom** với seed (AGENTS.md §3).
- **Đã chứng minh đủ idiom cần dùng:** `B2: Iter Google Search` (lặp Google search),
  `A3.1: File API`/`A3.3: Download Image` (**dùng http-request bên trong iteration để lấy trang
  ngoài** — đúng nhu cầu fetch HTML [14]/[15]), `B2.2: Parse Search Results` (code parse),
  `D1: Score LLM` (LLM theo từng item — đúng nhu cầu sinh động [19]).
- Giữ nguyên bộ khung của seed (query→search→extract→sheet→iter-contact) và **ghép thêm** hai idiom
  "http-request trong iteration" và "LLM theo item" từ ví dụ trên — đây là cách diff nhỏ nhất.
- **Thiết kế một file phân nhánh** (AGENTS.md §9): không tách ① (lập danh sách) và ② (văn tiếp cận)
  thành 2 YAML; gộp thành 1 workflow, thêm nhánh ② sau node insert HTTP.

---

## Các node (id là placeholder; cấp ID bằng generate_id.py ở Implement)

### A. Hiện có (giữ / sửa)

| placeholder (ID hiện tại) | type | Vai trò / thay đổi ở mục tiêu |
|---|---|---|
| `START` (1780884905312) | start | keep. Input `keyword` (chủ đề / điều kiện) |
| `Q-LLM` (1780885381582) | llm | **modify**: [13] sinh query có điều kiện đặc thù sự kiện `site:connpass.com OR site:doorkeeper.jp OR (trang chính thức)` v.v. |
| `SEARCH1` (1780884944980) | tool(google_search) | keep (giữ gl=jp/hl=ja/location=Japan) |
| `NORM1` (1780884953778) | code | keep. Chuẩn hóa SERP, khử trùng URL |
| `EXTRACT-LLM` (1780908589328) | llm | **modify**: thêm `press_url`·`source_memo` vào JSON trích xuất; nối thêm phần text HTML bên dưới vào input |
| `ROWS` (1780908987315) | code | **modify**: thêm cột `press_url`·`source_memo`·`email` (placeholder) vào speaker_rows / insert json_body |
| `HTTP-INSERT` (1781063614318) | http-request | **modify**: cột insert theo format quy định. **Thêm kiểm tra status response** (hiện no-auth, không kiểm) |
| `ITER-CONTACT` (1781080242221) | iteration | **modify**: `output_selector` đổi `array[string]`→`array[object]{contact_url,email,name}`. **Sửa bug ba ngoặc nhọn** (xem dưới) |
| `ITER-CONTACT`+`start` | iteration-start | keep (`<iter_id>start` đúng quy ước) |
| `CQ-LLM` (1781080479467) | llm | **modify**: sửa tham chiếu item về dạng `{{#ITER-CONTACT.item.name#}}` (hiện `{{{#...item#}}.name}}` không phân giải được) |
| `SEARCH2` (1781080606601) | tool(google_search) | keep |
| `S2-TEXT` (1781084555931) | code | keep |
| `URL-LLM` (1781081089438) | llm | **modify**: trích URL trang liên hệ. Nới lỏng việc loại bỏ SNS một cách cứng nhắc cho khớp [15] (cho phép cả profile SNS) |
| `UPD` (1781082351511) | code | **modify(nghiêm trọng)**: bỏ `rows:[]`. Khớp iteration_output với speaker_rows bằng **khóa name (hoặc url)** để hiện thực hóa update rows |
| `HTTP-UPDATE` (1781082713040) | http-request | **modify**: update sau khi rows đã được hiện thực hóa. Thêm kiểm tra status |

### B. Thêm mới

| placeholder | type | Mục đích | Vị trí |
|---|---|---|---|
| `FETCH-ITER` | iteration | [14] lặp các URL ứng viên top để lấy HTML | `NORM1`→đây→`EXTRACT-LLM` (tăng chất lượng trích xuất). *Tùy chi phí có thể hạ ưu tiên (xem Open Q)* |
| `FETCH-HTTP` | http-request | [14] GET HTML trang ứng viên (trong FETCH-ITER) | con của FETCH-ITER |
| `FETCH-CLEAN` | code | [14] HTML→text (chỉ stdlib, dùng `html.parser`/regex bỏ tag) | con của FETCH-ITER |
| `MAIL-HTTP` | http-request | [15] GET HTML trang liên hệ (trong ITER-CONTACT, sau `URL-LLM`) | con của ITER-CONTACT |
| `MAIL-CODE` | code | [15] trích email bằng regex từ HTML (`[\w.+-]+@[\w-]+\.[\w.-]+`, ưu tiên mailto:) | con của ITER-CONTACT |
| `TMPL-LLM` | llm | [18] sinh template tiếp cận 2 tông formal/casual | điểm bắt đầu nhánh ② sau `HTTP-INSERT` |
| `MSG-ITER` | iteration | [19] lặp speaker_rows để sinh nội dung động | `TMPL-LLM`→đây |
| `MSG-LLM` | llm | [19] sinh nội dung từ item(name/company/topic)＋template | con của MSG-ITER |
| `MSG-CODE` | code | [19] đưa nội dung sinh ra vào cột update json_body (`approach_formal`/`approach_casual` v.v.) | sau MSG-ITER |
| `HTTP-MSG` | http-request | [19] ghi nội dung xuống Spreadsheet (action:update) | sau MSG-CODE |
| `END` | end | gom output tổng thể (tùy chọn) | cuối |

---

## Luồng biến (mục tiêu)

```
{{#START.keyword#}}            → Q-LLM
{{#Q-LLM.text#}}              → SEARCH1.query
SEARCH1.json                 → NORM1.search_result
{{#NORM1.results#}}           → FETCH-ITER.iterator_selector          # [14] mới
  {{#FETCH-ITER.item.url#}}   → FETCH-HTTP.url → FETCH-CLEAN → page_text
{{#NORM1.results_text#}} + FETCH-ITER.output(page_text)  → EXTRACT-LLM   # snippet + HTML
{{#EXTRACT-LLM.text#}}        → ROWS.llm_result   (name/company/topic/url/press_url/source_memo)
{{#ROWS.json_body#}}          → HTTP-INSERT.body   (action:insert, cột theo format quy định)
ROWS.speaker_rows            → ITER-CONTACT.iterator_selector
  {{#ITER-CONTACT.item.name#}} {{#ITER-CONTACT.item.company#}} {{#ITER-CONTACT.item.url#}}  → CQ-LLM   # sửa bug ba ngoặc
  {{#CQ-LLM.text#}}          → SEARCH2.query → S2-TEXT.search_text → URL-LLM
  {{#URL-LLM.text#}}         → MAIL-HTTP.url → MAIL-CODE → {contact_url,email}   # [15] mới
  → ITER-CONTACT.output_selector = array[object]{name,contact_url,email}
{{#ITER-CONTACT.output#}} + ROWS.speaker_rows → UPD   # khớp khóa name/url để hiện thực rows ([16] sửa nghiêm trọng)
{{#UPD.json_body#}}          → HTTP-UPDATE.body   (action:update, ghi thật liên hệ/URL tham khảo)

# Nhánh ② ([18][19])
{{#START.keyword#}} + ROWS.speaker_rows → TMPL-LLM   (template formal/casual)
ROWS.speaker_rows            → MSG-ITER.iterator_selector
  {{#MSG-ITER.item.*#}} + {{#TMPL-LLM.text#}} → MSG-LLM   (sinh nội dung động)
  → MSG-ITER.output → MSG-CODE.json_body → HTTP-MSG.body (action:update, cột approach)
```

---

## Plugins

Hoàn tất chỉ với đúng các plugin hiện có (**không thêm plugin mới**):

- `langgenius/google` (google_search, v0.0.9) — đã có hash trong seed. Node SEARCH mới dùng chung.
- `langgenius/gemini` (model: `gemini-3.1-pro-preview`, v0.7.21) — đã có hash trong seed. LLM mới dùng chung.

```yaml
# dependencies: kế thừa 2 mục có sẵn của seed (google, gemini). Không có plugin mới.
# TODO: add plugin hash from target workspace
#   - Do tái dùng node có sẵn nên hash từ seed có thể dùng lại, nhưng ở Implement cần
#     xác nhận lại bằng export DSL của workspace mục tiêu (hash là đặc thù workspace, đổi khi nâng cấp).
#   - Cần xác nhận: tên model gemini-3.1-pro-preview có thật trên workspace mục tiêu không (xem analyze risks).
```

---

## Danh sách hành động sửa theo độ ưu tiên

| Ưu tiên | Yêu cầu | Hành động | Loại |
|---|---|---|---|
| **P0** | [16][15] | Bỏ `rows:[]` ở `UPD`(1781082351511) → khớp khóa name/url giữa iteration_output × speaker_rows để hiện thực update rows (giải quyết lỗi nghiêm trọng: liên hệ không lưu vào sheet) | modify |
| **P0** | [15] | Sửa ba ngoặc nhọn `{{{#...item#}}.name}}` ở `CQ-LLM`/`URL-LLM` thành `{{#ITER-CONTACT.item.name#}}` (bug không phân giải field của item) | modify |
| **P1** | [15] | Thêm `MAIL-HTTP`+`MAIL-CODE` để **trích email** từ trang liên hệ, đổi output iteration thành object | add |
| **P1** | [16] | Thống nhất payload insert/update và cột phía Apps Script theo format quy định (tên/đơn vị/bài nói/liên hệ/URL ghi chú). Kiểm tra tính nhất quán khóa dedup phía sheet | modify |
| **P2** | [13] | Thêm lọc `site:` cho connpass/Doorkeeper/trang chính thức vào `Q-LLM` | modify |
| **P2** | [14] | Thêm `press_url`·`source_memo` vào schema `EXTRACT-LLM` (trước mắt lấy từ snippet) | modify |
| **P2** | [18] | Thêm `TMPL-LLM` (template 2 tông formal/casual) | add |
| **P3** | [19] | Thêm `MSG-ITER`+`MSG-LLM`+`MSG-CODE`+`HTTP-MSG` (sinh nội dung động → ghi sheet) | add |
| **P3** | [14] | Thêm `FETCH-ITER`+`FETCH-HTTP`+`FETCH-CLEAN` (lấy HTML trang ứng viên để tăng chất lượng trích xuất) | add |
| **P3** | xuyên suốt | Thêm kiểm tra status & xử lý lỗi cho node HTTP (insert/update) (hiện no-auth, không phản ánh thành/bại) | modify |

---

## Câu hỏi mở (quyết định ở gate)

1. **Có làm fetch HTML [14] không:** `FETCH-ITER` cải thiện độ chính xác nhiều nhưng chi phí/thời
   gian tăng theo số ứng viên × http-request. Dify iteration có giới hạn ≤30 phần tử (constraints).
   Có thể **làm trước press_url/source_memo từ snippet**, để fetch HTML là P3 làm sau. — **Làm tới đâu?**
2. **Chính sách SNS [15]:** yêu cầu [15] cho phép trích cả từ profile SNS. Hiện `URL-LLM` loại SNS cứng.
   Nới ra thì tăng tỉ lệ tìm được email nhưng phạm vi tản mát. — **Có đưa SNS vào đối tượng trích không?**
3. **Độ tin cậy của email:** nếu nhiều trang chỉ có form liên hệ (không mailto), email trích sẽ rỗng.
   Cần phương án fallback (chỉ ghi contact_url / đưa URL form vào ghi chú).
4. **Hợp đồng cột Spreadsheet:** thứ tự/tên cột mà insert/update ghi phụ thuộc cài đặt `/exec` phía
   Apps Script. Cần xem hiện vật định nghĩa cột của sheet mục tiêu (schema kỳ vọng của action:insert/update hiện tại).
5. **`gemini-3.1-pro-preview`** có tồn tại trên workspace mục tiêu không (nếu không, thay bằng model có thật).
6. **Cách nối nhánh ②:** đặt [18][19] nối tiếp sau khi ① xong, hay song song sau insert (song song nhanh
   hơn nhưng cần speaker_rows đã xác định → nối tiếp sau insert là an toàn).

---

> **STOP — Phase ② (Spec) dừng tại đây.** Không scaffold / cấp ID / sinh YAML.
> Người dùng có thể chỉnh SPEC.md này tại gate. Phase ③ (Implement) sẽ đọc lại file này từ đầu.
