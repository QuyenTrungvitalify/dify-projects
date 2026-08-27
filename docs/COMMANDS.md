# Commands & workflows — cách dùng, để khỏi mò lại

Một trang: **có lệnh gì, khi nào dùng, how-to ở đâu.** Mỗi skill tự-tài-liệu khi gọi (`/<tên>`); trang
này là bản đồ để biết cái gì tồn tại.

## Skills (gõ `/<tên>` trong Claude Code)

| Lệnh | Làm gì | Khi nào | How-to đầy đủ |
|---|---|---|---|
| `/dify-build` | Author/sửa một workflow Dify qua 4 phase (Analyze→Spec→Implement→Test) | dựng 1 workflow mới, sửa flow có sẵn, seed từ Dify app | skill body + [AGENTS §3](../AGENTS.md) |

> Kho này còn một bộ skill **chỉ dành cho maintainer** (đợt test tự động, chấm run, đóng spec, săn
> nguồn mẫu). Chúng được track ở một repo riêng và không có trong bản phát hành, nên `/` sẽ không
> gợi ý chúng — đó là chủ ý, không phải thiếu sót.

## Scripts (đường tay / debug)

| Script | Làm gì |
|---|---|
| `.venv/bin/python tools/dify_base/find.py --has <feature>` | Tìm pattern/workflow theo feature |
| `.venv/bin/python tools/dify_base/lint_node_bodies.py --dump-schema <node-type>` | Hợp đồng field của một node (1 lệnh) |
| `.venv/bin/python tools/dify_base/validate_workflow.py <file.yml>` | Kiểm cấu trúc một workflow YAML |
| `.venv/bin/python tools/dify_base/sync.py <lệnh>` | GitOps với workspace Dify: `pull` · `push` · `diff` |

## Nguyên tắc đã chốt (đọc trước khi dùng lâu dài)

- **Không overclaim**: một quan sát `n=1` chỉ đủ để ghi "cần thêm mẫu"; chỉ so **cùng model**; và
  phải nêu rõ cái **chưa verify runtime** (deploy=none thì không hề chạm Dify).
- **Máy test, người fix**: công cụ trong kho chỉ báo cáo — sửa vẫn là việc người, rồi chạy lại.
