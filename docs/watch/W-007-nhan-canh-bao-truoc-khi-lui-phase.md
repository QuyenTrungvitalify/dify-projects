---
id: W-007
title: Nút Restore không nói trước rằng nó sẽ lùi phase
status: blocked
confidence: measured
opened: 2026-08-25
detector: "blocked — cần dữ liệu event `restored` (ship 2026-08-25) để đếm nhánh dự phòng"
threshold: "nhánh lùi-biên vẫn chạy thường xuyên sau spec 111 → sửa chữ"
related: [spec-111]
fixed_by: null
---

<!-- auto:scan — điền tay 2026-08-25 -->
| lần đầu | lần cuối | số lần nhánh lùi-biên chạy | ghi chú |
|---|---|---|---|
| — | — | ? | event `restored` mới có từ 2026-08-25 |
<!-- /auto -->

## Cách sinh ra

- **Kích hoạt**: user bấm *Restore* trên một build đã cancel.
- **Cơ chế**: thẻ cancel nói *"これまでの仕様・成果物は保持されます"* — **đúng về file**, nên nó càng gây
  hiểu nhầm: người đọc hiểu là "mọi thứ giữ nguyên", trong khi **phase** có thể tụt một bậc.
- **Dấu hiệu**: event `restored` có detail chứa `(no prior gate — rewound a boundary)`.

## Vì sao là `blocked`

Spec 111 đã làm nhánh chính đúng (mở lại gate đã tồn tại). Nhánh lùi-biên giờ chỉ còn dành cho ca
"phase chưa từng có gate" — đúng ngữ nghĩa, và khi đó câu "giữ nguyên thành quả" **vẫn đúng** vì
chưa có thành quả nào.

Nghĩa là W-007 chỉ đáng làm nếu đo được nhánh dự phòng vẫn chạy thường xuyên. Trước spec 111 không có
cách nào đếm — đó chính là lý do nó `blocked` chứ không phải `watching`.

## Cách đo lại

```bash
python3 - <<'EOF'
import json, glob, os
for d in sorted(glob.glob('apps/builder/.runs/*/')):
    try: E = [json.loads(l) for l in open(os.path.join(d, 'events.jsonl'))]
    except FileNotFoundError: continue
    for e in E:
        if e.get('kind') == 'restored':
            kind = 'LÙI BIÊN' if 'rewound' in (e.get('detail') or '') else 'mở lại gate cũ'
            print(os.path.basename(d.rstrip('/')), kind, e.get('detail'))
EOF
```

## Nhật ký

- **2026-08-25** — mở ở trạng thái `blocked`, ngay sau khi spec 111 thêm dụng cụ đo cho chính nó.
