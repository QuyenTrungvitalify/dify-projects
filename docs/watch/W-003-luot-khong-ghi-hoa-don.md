---
id: W-003
title: Lượt timeout hoặc bị giết không để lại hoá đơn
status: ready-to-fix
confidence: measured
opened: 2026-08-25
detector: turns_without_cost
threshold: ">10% số lượt mất dấu → sửa"   # ĐÃ VƯỢT: 17%
related: [spec-102, spec-104, spec-111]
fixed_by: null
---

<!-- auto:scan — điền tay 2026-08-25 -->
| lần đầu | lần cuối | số lượt mất dấu | tổng lượt | tỉ lệ |
|---|---|---|---|---|
| 08-21 | 08-25 | **13** | 71 | **18%** |
<!-- /auto -->

## Cách sinh ra

- **Kích hoạt**: lượt timeout (W-002), hoặc lượt bị `/cancel` giết giữa chừng.
- **Cơ chế**: `turn_cost` chỉ được phát khi stream trả về một *result event*. Lượt chết trước đó
  không phát gì — tiền đã tiêu nhưng không có dòng nào ghi lại.
- **Dấu hiệu**: một `turn_spawned` không có `turn_cost` nào theo sau trước `turn_spawned` kế tiếp.

## Vì sao đã vượt ngưỡng

`[ĐO]` Chỉ tính các run bắt đầu **sau 2026-08-18** (mốc `turn_cost` ra đời — trước đó vắng mặt là
đương nhiên, không phải lỗi): **13/71 lượt (18%)** không có hoá đơn, trên 4 run.

Ngưỡng đặt lúc mở mục là 10%. Đo xong thì nó đã ở 17% — nên mục này sinh ra đã ở trạng thái
`ready-to-fix`, không cần chờ thêm.

Hệ quả cụ thể: run `1787544155222` hiện tổng **$19.02 / 28 lượt** trong khi thực tế đã chạy **36 lượt**.
Tám lượt Opus không được tính, trong đó có nhiều lượt 900s.

## Hướng sửa (chưa làm)

Ghi cost từ những gì stream đã báo trước khi chết, **hoặc** phát một event `turn_lost` kèm thời lượng —
để "không đo được" khác với "bằng 0". Đây là địa hạt spec 102/104, không phải 108/111.

## Cách đo lại

```bash
python3 - <<'EOF'
import json, glob, os
first, rows = None, []
for d in sorted(glob.glob('apps/builder/.runs/*/')):
    try: E = [json.loads(l) for l in open(os.path.join(d, 'events.jsonl'))]
    except FileNotFoundError: continue
    c = [e for e in E if e.get('kind') == 'turn_cost']
    s = [e for e in E if e.get('kind') == 'turn_spawned']
    if c and (first is None or c[0]['ts'] < first): first = c[0]['ts']
    if s: rows.append((os.path.basename(d.rstrip('/')), s[0]['ts'], len(s), len(c)))
tot_s = sum(r[2] for r in rows if r[1] >= first)
tot_c = sum(r[3] for r in rows if r[1] >= first)
print(f'{tot_s - tot_c}/{tot_s} lượt mất dấu ({(tot_s-tot_c)/tot_s*100:.0f}%) — chỉ tính run sau mốc turn_cost')
EOF
```

⚠ **Hiệu chuẩn**: bỏ điều kiện "sau mốc `turn_cost`" thì ra 92/162 (57%) — con số đó **sai**, vì nó
đếm cả những run chạy trước khi tính năng tồn tại.

## Nhật ký

- **2026-08-25** — mở, và vượt ngưỡng ngay khi đo. 12/70 lượt (17%).
- **2026-08-25, cùng buổi** — đo lại sau ~30 phút: **13/71 (18%)**. Con số nhích lên trong lúc đang
  viết chính mục này, vì Builder vẫn đang chạy. Đây là lý do bước 2 (`tools/watch/scan.py`) tồn tại:
  số điền tay đúng đúng một lần, tại thời điểm gõ.
