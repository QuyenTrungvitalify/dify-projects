# docs/prompts — Kho prompt "user thật" để stress-test Builder

Mỗi file `P##-*.md` là **một yêu cầu như người dùng thật gõ vào** — nhân viên văn phòng Nhật (một
file tiếng Việt) có việc cần tự động hóa, **không biết gì về Dify**: không nói "node", không nói
"workflow shape", đôi khi mơ hồ, đôi khi đòi thứ Dify không làm được. Sự "bẩn" đó là chủ đích —
nó chính là bề mặt cần test.

Tiêu chí một prompt đạt chuẩn (viết tay lẫn máy sinh): **[CHARTER.md](CHARTER.md)**.
Đợt test tự động sinh đề theo yêu cầu → skill **`/campaign`** (spec 073) — hướng dẫn vận hành đầy
đủ: **[CAMPAIGN-GUIDE.md](CAMPAIGN-GUIDE.md)**; đề của mỗi đợt đóng băng trong `gen/<campaign-id>/`
cùng manifest `campaign.yml`. Đối chiếu các đợt: [runs/CAMPAIGNS.md](runs/CAMPAIGNS.md).

## Luật dùng

1. **Dán prompt NGUYÊN VĂN** (khối fenced trong từng file). Không "dọn" prompt cho rõ hơn —
   dọn là phá test.
2. Bắn qua harness hoặc UI đều được:
   ```bash
   apps/builder/scripts/e2e-run.sh fire "<dán prompt>" --mode auto   # rồi wait/time
   ```
3. Chấm: `/report <taskId>` (nội dung) · `e2e-run.sh userview` + `comprehension <taskId>`
   (trải nghiệm user ngây thơ) · các mục **Bẫy đã biết** trong từng file là checklist chấm tay.
4. Chi phí: mỗi build 2–4 turn thật (~8–13 phút). Chạy >3 prompt liên tiếp thì cân nhắc trước.
   Build đáp vào `projects/_drafts/` (gitignored) — không cần dọn.

## Phần nào trong file KHÔNG đưa cho Builder

Chỉ khối prompt là của "user". Các mục `Bối cảnh giả định` / `Trục năng lực` / `Hình dạng tốt` /
`Bẫy đã biết` / `MANUAL dự kiến` là tài liệu cho **người chấm** — đưa chúng vào prompt là làm lộ đề.

## Bản đồ phủ

| # | Ca | Trục chính |
|---|---|---|
| P01 | Pipeline tin tức AI/DX → WordPress (ca gốc từ ảnh task) | scope lớn, OCR-bằng-vision, schedule, tool Sheets, honesty về phạm vi |
| P02 | OCR ảnh Chatwork → CSV | ảnh input, vision-không-phải-OCR-plugin, iteration |
| P03 | Bản tin sáng RSS → Slack, trừ cuối tuần | schedule + timezone + **weekday-only** (bẫy visual_config) |
| P04 | Google Form → phân loại → chuyển phòng ban | **webhook** (lớp lỗi spec 071), phân loại, route |
| P05 | Đối chiếu 2 Excel → nháp email đòi tiền | 2 file input, so khớp chính xác, iteration, chỉ-nháp-không-gửi |
| P06 | Chatbot nội quy công ty từ 10 PDF | advanced-chat + knowledge-retrieval (**dataset id workspace-local**), biết-thì-nói-không-biết-thì-nhường |
| P07 | Biên bản họp → action items → Google Docs | param extraction, tool node + **plugin hash §4.3** |
| P08 | Dịch manual có glossary, 2 bước tự soát | multi-step-llm, tự review |
| P09 | "Tự động trả lời mail sales, làm hay hay vào" | **siêu mơ hồ** — test digest/câu hỏi ngược |
| P10 | Tóm tắt hợp đồng thuê nhà (tiếng Việt) | lang-sync VI, file input, trích rủi ro |
| P11 | Ghi âm cuộc gọi đến → tóm tắt Chatwork | **vượt khả năng** — test từ chối trung thực + đề xuất phần làm được |
| P12 | Thêm tính năng vào flow dịch có sẵn | edit-existing (**cần base** — đọc ghi chú trong file) |

Tiền lệ: chiến dịch 12-prompt cũ (2026-06/07, đã archive — `git show 4bbf294:.claude/skills/report/reports/INDEX.md`)
chấm theo Workflow-Store ground truth; kho này **chấm theo yêu cầu**, không có ground truth — đúng
luật `/report`: "grade vs requirement, ground truth chỉ là tham chiếu phụ".
