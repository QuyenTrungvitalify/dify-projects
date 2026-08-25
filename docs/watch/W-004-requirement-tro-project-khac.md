---
id: W-004
title: Requirement trỏ tới project khác với mục tiêu của task
status: watching
confidence: measured
opened: 2026-08-25
detector: requirement_names_other_project
threshold: ">=2 ca MỚI (sau 2026-08-25) → làm note ở gate ①"
related: [spec-108]
fixed_by: null
---

<!-- auto:scan — điền tay 2026-08-25 -->
| lần đầu | lần cuối | số lần | số run | ghi chú |
|---|---|---|---|---|
| 08-21 09:43 | 08-21 10:21 | **3** | 3 | cả 3 trong 40 phút cùng một buổi |
<!-- /auto -->

## Cách sinh ra

- **Kích hoạt**: user dán đường dẫn tuyệt đối tới workflow muốn sửa **vào requirement**, trong khi ô
  chọn mục tiêu lúc tạo task lại trỏ chỗ khác.
- **Cơ chế**: không có chốt nào so "đường dẫn trong requirement" với "đường dẫn backend sẽ chấm".
  ①/② không chết vì artifact của chúng nằm ngoài thư mục build; chỉ ③ vỡ.
- **Dấu hiệu**: requirement khớp `projects/<p>/<slug>/` với `slug != task.workflowSlug`.

## Vì sao ROI đã tụt

Dưới mô hình "sổ sở hữu" (spec 108 S1), một path trỏ project khác **không còn là lệch** — nó là một cú
**mở sổ**, và gate sẽ liệt kê ra. Phần còn lại của W-004 chỉ còn hai ca hẹp:

1. path trỏ tới thư mục **không tồn tại** → sổ không mở được, user cần biết ngay ở ① thay vì đợi ③;
2. requirement **chỉ** nêu project khác mà không nói gì về đích → dấu hiệu chọn nhầm ô lúc tạo task.

Bản "hỏi ở composer" đã bỏ.

## Cách đo lại

```bash
python3 - <<'EOF'
import json, glob, os, re
PAT = re.compile(r'(?<![\w-])projects/([\w.-]+)/([\w.-]+)/')
for p in sorted(glob.glob('apps/builder/.runs/*/task.json')):
    t = json.load(open(p)); slug = t.get('workflowSlug')
    other = {f'{a}/{b}' for a, b in PAT.findall(t.get('requirement') or '') if b != slug}
    if other:
        print(os.path.basename(os.path.dirname(p)), '| slug=', slug, '| trỏ tới:', sorted(other))
EOF
```

⚠ **Hiệu chuẩn**: lookbehind `(?<![\w-])` là bắt buộc. Thiếu nó, regex khớp luôn phần
`dify-projects/projects/…` và trả về 4 ca với slug rác `_drafts` — sai cả số lẫn nội dung.

## Nhật ký

- **2026-08-25** — mở. 3 ca, tất cả ngày 21/08; chưa tái phát sau đó (run 24/08 trỏ đúng thư mục của nó).
