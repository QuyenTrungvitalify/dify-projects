# Commands & workflows — cách dùng, để khỏi mò lại

Một trang: **có lệnh gì, khi nào dùng, how-to ở đâu.** Mỗi skill tự-tài-liệu khi gọi (`/<tên>`); trang
này là bản đồ để biết cái gì tồn tại. Chi tiết từng cái ở cột "How-to".

## Skills (gõ `/<tên>` trong Claude Code)

| Lệnh | Làm gì | Khi nào | How-to đầy đủ |
|---|---|---|---|
| `/dify-build` | Author/sửa một workflow Dify qua 4 phase (Analyze→Spec→Implement→Test) | dựng 1 workflow mới, sửa flow có sẵn, seed từ Dify app | skill body + [AGENTS §3](../AGENTS.md) |
| `/campaign` | **Đợt test tự động**: sinh prompt → gate → chạy nền → chấm → sổ sách | test Builder trên nhiều đề "user thật", có version | **[CAMPAIGN-GUIDE.md](prompts/CAMPAIGN-GUIDE.md)** |
| `/e2e` | Chạy MỘT prompt qua Builder như user thật, chấm cơ học PASS/FAIL | thử nhanh một cải tiến / một đề | skill body (`/e2e "<prompt>"`) |
| `/report` | Chấm một run đã có theo requirement (judge nội dung) | đánh giá sâu một build | skill body (`/report <taskId>`) |
| `/spec-close` | **Đóng (xoá) một spec đã ship** mà không mất tri thức | khi một spec trong `docs/specs/` đã làm xong | **[docs/specs/README.md](specs/README.md)** (`/spec-close <số>`) |
| `/template-promote` | Đưa một mẫu corpus thành template chuẩn có provenance | thêm một pattern nhà-làm | skill body |
| `/corpus-update` | Cập nhật corpus clone (workflow Dify thật) + rebuild INDEX | làm mới kho đề tài / mẫu | skill body |
| `/scout` | **Săn nguồn workflow ngoài** một-lần-nhấn: delta search GitHub → vet license + fingerprint → bảng digest, người quyết từng dòng | lâu lâu muốn "đi thu thập" mẫu mới (spec 078 S3) | skill body |

## Vòng đời test một đợt (`/campaign` — hay dùng nhất)

```
/campaign plan "<yêu cầu đợt test>"    # sinh N đề vào docs/prompts/gen/<id>/, DỪNG ở gate
  → bạn duyệt/sửa đề trực tiếp trong gen/<id>/, rồi:  "chốt đi"
/campaign run <id>                     # chạy nền (cần backend: cd apps/builder && npm start)
/campaign report <id>                  # journey (tốc độ) + criteria_check + judge + sổ CAMPAIGNS
  → bạn fix finding (máy KHÔNG tự fix), rồi:
/campaign recheck <id>                 # chạy lại nguyên văn đề dính finding → bảng trước/sau
```
Chi tiết + khắc phục sự cố (quota, đề lỗi dai, đọc journey): **[CAMPAIGN-GUIDE.md](prompts/CAMPAIGN-GUIDE.md)**.
Tiêu chí một đề đạt chuẩn: **[CHARTER.md](prompts/CHARTER.md)**. Đối chiếu các đợt: **[runs/CAMPAIGNS.md](prompts/runs/CAMPAIGNS.md)**.

## Scripts (đường tay / debug — `/campaign` gọi chúng bên trong)

| Script | Làm gì |
|---|---|
| `apps/builder/scripts/campaign.py <lệnh> <dir>` | `init·lint·approve·verify·next·record·status·journey` — công cụ manifest của một đợt |
| `apps/builder/scripts/campaign-run.sh <dir>` | Runner nền tuần tự (fire→wait→record, retry 1 lần, dừng lỗi kép, resume = chạy lại) |
| `apps/builder/scripts/e2e-run.sh <lệnh>` | `fire·wait·comprehension·time·userview` — bắn/đo một run lẻ |
| `.venv/bin/python tools/dify_base/find.py --has <feature>` | Tìm pattern/workflow theo feature |
| `.venv/bin/python tools/dify_base/lint_node_bodies.py --dump-schema <node-type>` | Hợp đồng field của một node (1 lệnh) |

## Nguyên tắc đã chốt (đọc trước khi dùng lâu dài)

- **Spec là tạm**: dựng để implement, **đóng bằng `/spec-close` khi xong** (không `rm` tay) — tri thức
  chuyển về `docs/state`/CAMPAIGNS/comment trước khi xoá. Quy trình: [docs/specs/README.md](specs/README.md).
- **Người fix, máy test**: `/campaign` chỉ test + báo cáo; fix finding là việc người, rồi `recheck`.
- **Không overclaim**: finding `n=1` chỉ ghi "cần thêm mẫu"; chỉ so **cùng model**; báo cáo nêu rõ cái
  **chưa verify runtime** (deploy=none không chạm Dify).
