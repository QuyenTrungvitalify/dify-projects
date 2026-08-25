---
id: W-005
title: Bộ dò fs báo nhầm khi hai task chạy chồng lượt
status: watching
confidence: hypothesis
opened: 2026-08-25
detector: overlapping_turn_windows
threshold: ">=1 ca → loại trừ theo phạm vi task đang chạy TRƯỚC khi nâng advisory thành fatal"
related: [spec-108, spec-111]
fixed_by: null
---

<!-- auto:scan — điền tay 2026-08-25 -->
| lần đầu | lần cuối | số cặp chồng lượt | ghi chú |
|---|---|---|---|
| — | — | **0** | chưa từng xảy ra trên 58 run |
<!-- /auto -->

## Cách sinh ra (nếu nó xảy ra)

- **Kích hoạt**: hai task cùng chạy một lượt trong cùng khoảng thời gian.
- **Cơ chế**: `strayWrites` so `mtime > thời điểm spawn`. Nó không biết file kia do task khác ghi, nên
  lượt của task A sẽ **quy tội cho mình** những file task B vừa viết.
- **Dấu hiệu**: hai cửa sổ `turn_spawned → turn_cost` của hai task khác nhau giao nhau.

## Vì sao vẫn là giả thuyết

`[ĐO]` **0 cặp** trên 58 run. Turn lock của Builder (`acquireTurn`) là toàn cục cho build, nên hai
build gần như không thể chạy lượt cùng lúc — giả thuyết này có thể **về mặt cấu trúc là không thể**,
và nếu đúng vậy thì mục này sẽ đóng dạng `refuted` chứ không phải `expired`.

Chưa đóng ngay vì chưa đọc kỹ đủ đường đi của lock (Ask turn dùng lane riêng), và vì cái giá của việc
sai ở đây là một phase bị fail oan.

## Vì sao mục này chặn một việc khác

Đây là **điều kiện để nâng `strayNote` từ advisory lên fatal**. Chừng nào chưa chắc bộ dò không báo
nhầm, một lint đỏ của file "ngoài phạm vi" không được phép giết phase.

Cũng nằm trong lớp này (đã ghi trong spec 108 §S2): file user **tự sửa tay trong editor** giữa lượt
cũng lọt vào báo cáo. Lời văn hiện tại đã chọn "có thay đổi ngoài phạm vi" (quan sát) thay vì "lượt này
đã ghi" (quy tội) đúng vì lý do đó.

## Cách đo lại

```bash
python3 - <<'EOF'
import json, glob, os
wins = []
for d in sorted(glob.glob('apps/builder/.runs/*/')):
    rid = os.path.basename(d.rstrip('/')); cur = None
    try: E = [json.loads(l) for l in open(os.path.join(d, 'events.jsonl'))]
    except FileNotFoundError: continue
    for e in E:
        if e.get('kind') == 'turn_spawned': cur = e['ts']
        elif e.get('kind') in ('turn_cost', 'error') and cur: wins.append((cur, e['ts'], rid)); cur = None
n = sum(1 for i in range(len(wins)) for j in range(i+1, len(wins))
        if wins[i][2] != wins[j][2] and wins[i][0] < wins[j][1] and wins[j][0] < wins[i][1])
print(f'{n} cặp lượt chồng nhau giữa 2 task khác nhau')
EOF
```

## Nhật ký

- **2026-08-25** — mở. 0 ca. Nghi ngờ turn lock làm nó bất khả thi — cần đọc `lock.ts` để chốt `refuted`.
