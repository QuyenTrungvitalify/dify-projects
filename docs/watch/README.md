# `docs/watch/` — những vấn đề đang THEO DÕI

Chỗ này giữ đúng một loại tri thức: **vấn đề đã thấy nhưng chưa đủ bằng chứng để sửa.**

Nó không thay `docs/specs/` (việc đang làm), `docs/state/` (hành vi đã ship), hay `AGENTS.md §9`
(bài học từ thất bại). Nó thay **mục "để ngỏ" của `CAMPAIGNS.md`** cho riêng loại chờ-quan-sát —
vì mục đó không giữ nổi ba thứ một watchlist cần: **đã lặp mấy lần, lần cuối khi nào, sinh ra thế nào**.

> ⚠ Đừng thêm nhà thứ sáu cho tri thức. Nếu một mục ở đây đã đủ bằng chứng, nó **rời khỏi đây** —
> thành spec, thành commit, hoặc thành một dòng trong `AGENTS.md §9`. Danh sách này phải ngắn.

## Luật một dòng

**Không có `detector` thì không phải mục theo dõi — đó là điều ước.**

Mỗi mục phải trả lời được: *dấu hiệu nào trong `apps/builder/.runs/` cho biết nó vừa xảy ra lần nữa?*
Không trả lời được thì hoặc là chưa hiểu vấn đề, hoặc nó chưa để lại dấu vết — và khi đó việc cần làm
**không phải** theo dõi, mà là **thêm dụng cụ đo trước** (ghi rõ `detector: blocked — cần event X`).

Bài học sống: cú lùi phase ③→② ngày 24/08 không thể dò được cho tới khi spec 111 thêm event
`cancelled`/`restored`. Trước đó, "im lặng" và "không xảy ra" trông y hệt nhau.

## Trạng thái

| `status` | Nghĩa |
|---|---|
| `watching` | đang đếm, chưa đủ ngưỡng |
| `ready-to-fix` | **đã vượt ngưỡng** — chờ tới lượt làm |
| `blocked` | chưa đo được vì thiếu dụng cụ đo (nói rõ thiếu gì) |
| `fixed` | đã sửa — `fixed_by` trỏ commit |
| `refuted` | đo lại thấy không phải vấn đề — nói rõ đo ra gì |
| `expired` | im quá lâu, đóng lại |

Đóng một mục phải có lý do và có nhà, y như `/spec-close`. Đóng im lặng = mất tri thức.

## Bảng theo dõi

Cập nhật tay ngày **2026-08-25** (chưa có `tools/watch/scan.py` — xem *Còn thiếu* dưới).

| ID | Vấn đề | Trạng thái | Số lần | Lần cuối |
|---|---|---|---|---|
| [W-001](W-001-ghi-cheo-project-do-model-tu-di.md) | Model tự ghi vào project không ai nhắc | `watching` | **0** | — |
| [W-002](W-002-timeout-900s.md) | 900s không đủ cho build lớn | `watching` | 8 | 08-25 02:47 |
| [W-003](W-003-luot-khong-ghi-hoa-don.md) | Lượt timeout/bị giết không ghi `turn_cost` | **`ready-to-fix`** | 13 (18%) | 08-25 |
| [W-004](W-004-requirement-tro-project-khac.md) | Requirement trỏ project khác mục tiêu | `watching` | 3 | 08-21 |
| [W-005](W-005-false-positive-bo-do-fs.md) | Bộ dò fs báo nhầm khi 2 task chạy chồng | `watching` | 0 | — |
| [W-006](W-006-continue-tu-2-dot-phien-3.md) | Continue từ ② đốt phiên ③ | `blocked` | ? | — |
| [W-007](W-007-nhan-canh-bao-truoc-khi-lui-phase.md) | Nút Restore không nói trước hậu quả | `blocked` | ? | — |
| [W-008](W-008-hai-task-cung-mo-mot-thu-muc.md) | Hai task cùng mở trên một thư mục | **`ready-to-fix`** | 5 cặp | 08-25 |

## Còn thiếu (cố ý)

`tools/watch/scan.py` chưa tồn tại — mọi số ở đây điền tay, mỗi mục kèm **lệnh đo lại** để kiểm chứng.
Đó là chủ ý: viết máy đếm trước khi biết cần đếm gì thì máy sẽ đếm sai. Khi có ≥5 mục với detector đã
dùng thật, mới viết script và biến khối `<!-- auto -->` thành phần do máy ghi.

Hiệu chuẩn công cụ đo là việc bắt buộc, không phải tuỳ chọn — trong chính đợt lập danh sách này, một
regex `projects/(\w+)/(\w+)/` viết vội đã cho **4** kết quả trong khi sự thật là **3** (nó khớp cả
`dify-projects/projects/…`). Mỗi lệnh trong mục *Cách đo lại* đều đã chạy thật và đối chiếu bằng tay.
