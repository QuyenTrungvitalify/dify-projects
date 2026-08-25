---
id: W-002
title: 900s không đủ cho build lớn — và đã lan sang phase ②
status: watching
confidence: measured
opened: 2026-08-25
detector: phase_timeouts
threshold: ">=10 điểm dữ liệu cho thấy tương quan kích thước artifact ↔ thời lượng lượt"
related: [spec-085, spec-102, spec-104]
fixed_by: null
---

<!-- auto:scan — điền tay 2026-08-25 -->
| lần đầu | lần cuối | số lần | số run | phân bố |
|---|---|---|---|---|
| 08-04 00:51 (600s) | 08-25 02:47 (900s) | **8** | 4 | ③×3 · ②×5 |
<!-- /auto -->

## Cách sinh ra

- **Kích hoạt**: workflow lớn (`main.yml` của `build_requirement_news_automation_2` ~210 KB) + một
  lượt phải đọc cả file rồi sửa nhiều chỗ.
- **Cơ chế**: timeout cứng trong code (600s → 900s theo spec 085). Lượt bị cắt giữa chừng; theo spec
  104 nếu artifact vẫn tốt thì gate vẫn `success` — nên **người dùng không biết lượt đã bị cắt**.
- **Dấu hiệu**: `events.jsonl` có `kind:error` + `detail` khớp `/timed out after \d+s/`.

## Điều làm mục này KHÁC với giả định ban đầu

`[ĐO]` Ban đầu tôi ghi "2/3 lượt ③ của build 210 KB timeout" và đoán đây là chuyện của phase ③.
Đo đủ 58 run thì khác: **5/8 lần timeout là phase ②**, tất cả trong ngày 24–25/08 trên cùng một run
(`1787544155222`). Tức nguyên nhân không phải "③ nặng" mà là **"lượt nào đụng file lớn cũng nặng"** —
và từ khi phase ② cũng sửa workflow (spec 108 §7.2), ② thừa hưởng đúng chi phí đó.

⇒ Nếu nới timeout theo phase thì sẽ nới sai chỗ. Phải nới theo **kích thước artifact**.

## Ngưỡng

Cần ~10 điểm `(kích thước main.yml, thời lượng lượt)` để thấy tương quan. Hiện có 8 lần timeout nhưng
chỉ trên 4 run và tập trung ở 1 file — chưa đủ để chỉnh con số mà không đoán.

⚠ Phụ thuộc [W-003](W-003-luot-khong-ghi-hoa-don.md): lượt timeout **không ghi `turn_cost`**, nên
"ngân sách thật của một phase" hiện đang bị đánh giá thấp. Sửa W-003 trước thì dữ liệu của W-002 mới đúng.

## Cách đo lại

```bash
python3 - <<'EOF'
import json, glob, os, datetime
f = lambda ms: datetime.datetime.fromtimestamp(ms/1000).strftime('%m-%d %H:%M')
for d in sorted(glob.glob('apps/builder/.runs/*/')):
    try: E = [json.loads(l) for l in open(os.path.join(d, 'events.jsonl'))]
    except FileNotFoundError: continue
    for e in E:
        if e.get('kind') == 'error' and 'timed out' in (e.get('detail') or ''):
            print(os.path.basename(d.rstrip('/')), e.get('phase'), f(e['ts']), e['detail'][:40])
EOF
```

## Nhật ký

- **2026-08-25** — mở. 8 lần / 4 run. Phát hiện phân bố nghiêng về ② chứ không phải ③ như đã đoán.
