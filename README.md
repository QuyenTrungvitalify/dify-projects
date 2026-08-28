# Dify Projects

![CI](https://github.com/QuyenTrungvitalify/dify-projects/actions/workflows/ci.yml/badge.svg)

Nơi làm việc để dựng workflow cho Dify. Bạn mô tả bằng lời, **Builder** dựng ra file,
bạn duyệt từng bước.

## Bắt đầu ở đây

| | Tiếng Việt | 日本語 |
|---|---|---|
| Cài đặt lần đầu | [SETUP_VI.md](SETUP_VI.md) | [SETUP_JA.md](SETUP_JA.md) |
| Cách dùng Builder | [BUILDER-USAGE_VI.md](BUILDER-USAGE_VI.md) | [BUILDER-USAGE_JA.md](BUILDER-USAGE_JA.md) |

Chỉ cần dùng app thì hai tài liệu trên là đủ. Phần còn lại của trang này dành cho ai muốn đi sâu hơn.

---

## Trong này có gì

- **Builder** ([apps/builder/](apps/builder/)) — web UI chạy trên máy bạn. Dựng workflow qua 4 bước,
  mỗi bước dừng lại chờ bạn duyệt.
- **~47 template** tra được theo tính năng, cùng 14 khuôn mẫu dựng sẵn trong
  [templates/patterns/](templates/patterns/).
- **Bộ kiểm tự động** chạy trước khi commit — bắt lỗi trước khi bạn import vào Dify.
- **Đồng bộ hai chiều** với Dify workspace (kéo về / đẩy lên / so sánh).
- Skill + corpus tham chiếu, dành cho AI agent làm việc trong repo.

## Muốn đi sâu

| Bạn muốn | Đọc |
|---|---|
| Quy trình dựng YAML, xử lý sự cố | [docs/GUIDE.md](docs/GUIDE.md) |
| Kiến trúc và các quyết định thiết kế | [docs/architecture.md](docs/architecture.md) |
| Tra template có sẵn | [INDEX.md](INDEX.md) |
| Dựng workflow bằng tay, từng bước | [AGENTS.md](AGENTS.md) §3 |
| Làm việc bằng AI agent (Claude Code, Codex, Cursor…) | [AGENTS.md](AGENTS.md) |

## Cấu trúc

```
apps/builder/       Builder app (web UI) — toolchain Node riêng
templates/          Khuôn mẫu dựng sẵn + thư viện template đã chuẩn hoá
projects/           Workflow của bạn: projects/<project>/<workflow>/
tools/dify_base/    CLI: tra template, tạo project, đồng bộ Dify, các bộ kiểm
docs/               Hướng dẫn vận hành, kiến trúc, trạng thái hệ thống
skills/  corpus/    Tài liệu tham chiếu (clone riêng, không nằm trong git)
schemas/            JSON Schema cho Dify DSL, sinh tự động
tests/              pytest — bỏ qua sạch khi chưa có thông tin kết nối
```

## Vài câu lệnh hay dùng

```bash
# Cài đặt lần đầu (bản đầy đủ xem SETUP_VI.md)
./scripts/bootstrap.sh

# Có trục trặc — chạy cái này trước khi hỏi ai
./scripts/doctor.sh

# Tra template theo tính năng
python3 tools/dify_base/find.py --has iteration --has file-input
python3 tools/dify_base/find.py --list-features

# Kiểm một file trước khi import vào Dify
.venv/bin/pre-commit run --files projects/<project>/<workflow>/workflows/main.yml
```

Danh sách đầy đủ (đồng bộ Dify, tạo project, promote template…) nằm trong
[docs/GUIDE.md](docs/GUIDE.md).

## Giới hạn cần biết

- **Phiên bản DSL**: schema sinh cho DSL **v0.6.0**, dựng ngược từ Dify **1.13.0**
  (ghim ở `.dify-tag` / `.dify-dsl-version`). Nếu workspace của bạn dùng bản mới hơn,
  kiểm lại tên field và sinh lại schema.
- **Bộ kiểm chỉ xét cấu trúc** — ID trùng, tham chiếu hỏng, thiếu field bắt buộc.
  Nó **không** bảo đảm import vào Dify sẽ thành công.
- **Hash của plugin đổi theo thời gian.** Import lỗi vì plugin thì kiểm lại phiên bản
  trong workspace đích.
- **Đã biết**: schema của `http_request` sinh ra kèm dấu `_error` thay vì dump sạch
  (`SchemaSerializer` trên giá trị mặc định `HTTP_REQUEST_MAX_*`). 29 schema còn lại bình thường.

## Nguồn

- [langgenius/dify](https://github.com/langgenius/dify) — mã nguồn Dify
- [mango-svip/dify-workflow-skills](https://github.com/mango-svip/dify-workflow-skills) — skill nền
- [Tomatio13/DifyWorkFlowGenerator](https://github.com/Tomatio13/DifyWorkFlowGenerator) — sinh DSL, ngữ cảnh tiếng Nhật
- [lazeyliu/dify-dsl-generator-skills](https://github.com/lazeyliu/dify-dsl-generator-skills) — skill nhiều tầng
- [Formyselfonly/Awesome-Dify-Workflow-EN](https://github.com/Formyselfonly/Awesome-Dify-Workflow-EN) — corpus tham chiếu (MIT)
- [Dify Official Docs](https://docs.dify.ai/)
