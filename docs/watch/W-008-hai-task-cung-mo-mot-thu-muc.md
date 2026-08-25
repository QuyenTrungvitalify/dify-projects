---
id: W-008
title: Hai task cùng mở trên một thư mục, không cái nào biết cái nào
status: ready-to-fix
confidence: measured
opened: 2026-08-25
detector: concurrent_tasks_same_folder
threshold: ">=2 cặp → mở spec riêng"   # ĐÃ VƯỢT: 5 cặp
related: [spec-108]
fixed_by: null
---

<!-- auto:scan — điền tay 2026-08-25 -->
| lần đầu | lần cuối | số cặp cùng mở | số thư mục | nặng nhất |
|---|---|---|---|---|
| 08-20 16:48 | 08-25 18:09 | **5** | 2 | `build_requirement_news_automation_2` — 5 task, 4 cặp |
<!-- /auto -->

## Cách sinh ra

- **Kích hoạt**: một build cũ chưa đóng (`error` / `cancelled` / `awaiting_confirm` vẫn `/reply` được
  — đúng theo spec 106), user mở task mới cho **cùng** workflow đó.
- **Cơ chế**: không có gì trong Builder biết một thư mục đang có mấy task sống. Mỗi task tự tin mình
  là chủ. Không phải chạy chồng *lượt* (xem [W-005](W-005-false-positive-bo-do-fs.md): 0 ca) mà là
  chồng **vòng đời** — hai luồng thay nhau sửa một thư mục qua nhiều giờ.
- **Dấu hiệu**: hai run có cùng `project/workflowSlug` và khoảng `[event đầu, event cuối]` giao nhau.

## Vì sao đã vượt ngưỡng

`[ĐO]` **5 cặp** trên 2 thư mục. Riêng `_drafts/build_requirement_news_automation_2` có **5 task**,
trong đó 4 cặp cùng mở — kéo dài từ 12/08 tới 25/08.

Đây là thứ gây rối nhiều nhất trong sự cố 24/08, và cho tới giờ **không spec nào nhận nó**: 108 nói về
"ghi ở đâu", 111 nói về "restore về đâu". Chuyện "ai sở hữu thư mục này" chưa có nhà.

Chưa rõ nên chặn, cảnh báo, hay chỉ hiện — đó là việc của spec sẽ mở, không phải của mục theo dõi này.

## Cách đo lại

```bash
python3 - <<'EOF'
import json, glob, os, collections, datetime
f = lambda ms: datetime.datetime.fromtimestamp(ms/1000).strftime('%m-%d %H:%M')
life = {}
for p in sorted(glob.glob('apps/builder/.runs/*/task.json')):
    t = json.load(open(p)); d = os.path.dirname(p)
    if not (t.get('project') and t.get('workflowSlug')): continue
    try: E = [json.loads(l) for l in open(os.path.join(d, 'events.jsonl'))]
    except FileNotFoundError: continue
    if E: life[os.path.basename(d)] = (E[0]['ts'], E[-1]['ts'], f"{t['project']}/{t['workflowSlug']}")
byf = collections.defaultdict(list)
for rid, (a, b, folder) in life.items(): byf[folder].append((a, b, rid))
for folder, rows in byf.items():
    rows.sort()
    for i in range(len(rows)):
        for j in range(i+1, len(rows)):
            a, b = rows[i], rows[j]
            if a[0] < b[1] and b[0] < a[1]:
                print(f'{folder}: {a[2]} ({f(a[0])}→{f(a[1])}) ⧉ {b[2]} ({f(b[0])}→{f(b[1])})')
EOF
```

⚠ **Hiệu chuẩn**: đếm theo "cùng `project/workflowSlug`" thôi thì ra **6 thư mục** — nhưng phần lớn là
các build **nối tiếp** nhau trên một workflow, hoàn toàn bình thường. Chỉ khoảng-thời-gian **giao nhau**
mới là tín hiệu thật. Hai con số này khác nhau về bản chất, đừng lẫn.

## Nhật ký

- **2026-08-25** — mở, và vượt ngưỡng ngay khi đo. 5 cặp / 2 thư mục.
