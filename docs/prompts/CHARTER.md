# CHARTER — tiêu chí một prompt test "user thật" (spec 073)

Áp cho **mọi** prompt trong kho này: viết tay (`P##-*.md`) lẫn máy sinh (`gen/<campaign>/G##-*.md`).
Phần máy kiểm được nằm ở [§Blocklist](#blocklist-máy-kiểm--campaignpy-lint) và
[§Giải phẫu](#giải-phẫu-file--5-mục-bắt-buộc); phần còn lại là tiêu chí cho người viết/duyệt.

## Tiêu chí hiện thực (không phải hợp đồng văn phong)

Dự án phục vụ **mọi loại bài toán Dify** — không khóa persona, domain, hay ngôn ngữ. Một đề đạt khi:

1. **Là bài toán cụ thể có thật** — một người thật, ở một vai thật (kế toán, CS, HR, kho vận, admin,
   marketing…), đang tốn thời gian cho việc này và muốn tự động hóa. Không phải "test cho có" hay
   đề bịa để khoe kỹ thuật. Nguồn tốt: việc lặp hàng tuần, task thật từ stakeholder, ảnh chụp yêu cầu.
2. **Kể VIỆC, không kể GIẢI PHÁP** — user tả họ làm gì bằng tay và muốn gì xảy ra; user KHÔNG biết
   Dify nên không gõ từ-nghề (blocklist dưới). 「フォームが送信されたタイミングで動いてほしい」
   chứ không phải "khi webhook nhận payload".
3. **Có ≥1 ràng buộc nghiệp vụ thật** — thứ một người làm việc đó thật sự dặn:
   「下書きだけ、送信はしない」·「判断に迷うものはその他に」·「金額は絶対に書き換えないで」.
4. **Có chỗ mơ hồ tự nhiên** — user thật không đặc tả đủ: thiếu tên cột, "làm hay hay vào", quên nói
   format. Sự mơ hồ là bề mặt test (digest/câu hỏi ngược), đừng dọn sạch nó.
5. **Ngôn ngữ theo persona** (JA/VI/EN…) — nguyên văn, không chú thích dịch trong khối đề.
6. Trong một đợt: **đa dạng persona + domain** theo yêu cầu đợt test; không được cả bộ cùng một khuôn.

## Giải phẫu file — 5 mục bắt buộc

Khối đề fenced đứng đầu file (đây là phần DUY NHẤT đưa cho Builder — các mục sau là tài liệu chấm,
đưa vào prompt là lộ đề):

````markdown
# G01 — <tên ca>

```
<đề nguyên văn, giọng user>
```

## Bối cảnh giả định
## Trục năng lực được thử
## Hình dạng build tốt
## Bẫy đã biết
## MANUAL dự kiến
````

`campaign.py lint` kiểm: có đúng một khối fenced đứng trước mọi heading `##`, và đủ 5 heading theo
**prefix** (`## Bối cảnh` · `## Trục` · `## Hình dạng` · `## Bẫy` · `## MANUAL`).

## Blocklist (máy kiểm — `campaign.py lint`)

Chỉ soi **khối đề fenced** (các mục chấm được phép dùng từ-nghề thoải mái).

**HARD — dính là loại** (user không biết Dify không bao giờ gõ):

```
webhook, workflow, node, trigger, DSL, dataset, knowledge base, LLM, plugin,
endpoint, payload, cron, iteration, if-else, http-request,
ワークフロー, ノード, トリガー, プラグイン, データセット, ペイロード,
```

**WARN — cảnh báo, người duyệt quyết** (đôi khi user bán-kỹ-thuật vẫn nói):

```
API, JSON, CSV*, prompt, AI, bot, スプレッドシート連携
```

\* `CSV`/`Excel`/`PDF` là tên định dạng văn phòng — user thật CÓ gõ; chỉ warn khi đi kèm mô tả cấu
trúc kỹ thuật ("parse CSV", "escape"). Tên dịch vụ (Chatwork, Slack, Google Form/Sheets/Docs) **hợp
lệ** — user thật gọi tên công cụ họ dùng.

So khớp: từ latin theo word-boundary, không phân hoa-thường; chuỗi JP theo substring.

## Tự kiểm trước khi trình gate (người sinh đề — máy hay người đều thế)

- [ ] Đọc to khối đề: có giống một người bận việc gõ vội không? Có câu nào "thơm mùi kỹ sư" không?
- [ ] Ràng buộc nghiệp vụ có thật không, hay là ràng buộc bịa cho có bẫy?
- [ ] Mục *Bẫy đã biết* trỏ được vào lớp lỗi cụ thể (CHANGELOG/CAMPAIGNS/bài học §9) chứ không chung chung?
- [ ] *MANUAL dự kiến* liệt kê đủ phần máy không chấm được — thiếu mục này là report sau sẽ nói dối.
- [ ] Đề có giải được KHÔNG-hoàn-hảo không? Đề mà build nào cũng full-đạt là đề vô dụng.

Mẫu chuẩn để đối chiếu giọng: [P04](P04-inquiry-form-routing.md) (JA, ràng buộc その他),
[P09](P09-vague-sales-email.md) (siêu mơ hồ), [P10](P10-vn-lease-contract-review.md) (VI),
[P11](P11-phone-call-summary.md) (vượt khả năng — test từ chối trung thực).
