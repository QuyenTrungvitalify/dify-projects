---
id: W-001
title: Model tự ghi vào project không ai nhắc tới
status: watching
confidence: hypothesis
opened: 2026-08-25
detector: stray_write_not_named_by_user
threshold: ">=1 ca thật → làm phần hook deny của spec 108 S1(c)"
related: [spec-108]
fixed_by: null
---

<!-- auto:scan — điền tay 2026-08-25 -->
| lần đầu | lần cuối | số lần | số run | ghi chú |
|---|---|---|---|---|
| — | — | **0** | 0 | chưa từng quan sát được |
<!-- /auto -->

## Vì sao mục này tồn tại

Spec 108 bản đầu định cho hook chặn mọi cú ghi ra ngoài thư mục build. Bản đó **đã chết** khi user
chốt "1 task chưa chắc là 1 workflow" — sổ `writeRoots` mở bằng lời user thay cho bức tường.

Phần deny còn lại chỉ canh đúng **một** lớp: model tự ý ghi vào project **không có trong chữ của
user**. `[ĐO]` Lớp đó có **0 ca**. Cả hai sự cố ghi lạc (21/08 và 24/08) đều là đường dẫn user tự gõ.

Đây là lát **rủi ro cao nhất** trong cả spec 108 — nó chạm `permission-gate.ts`, tức mọi tool call của
mọi lượt; một deny sai ở đó hỏng tất cả build chứ không hỏng một build. Làm nó để canh một lớp chưa
từng xảy ra là đổi rủi ro thật lấy an toàn tưởng tượng.

## Cách sinh ra (nếu nó xảy ra)

- **Kích hoạt**: một lượt ③ đọc file của project khác làm tham chiếu, rồi "tiện tay" sửa luôn.
- **Cơ chế**: `permission-gate.ts:339` cho ghi cả `projects/`, uỷ nhiệm cho chốt sau lượt.
- **Dấu hiệu**: `task.strayNote` nêu một đường dẫn **không** xuất hiện trong `requirement` cũng như
  trong bất kỳ `request_changes`/`retry` nào của run đó.

## Ngưỡng

≥1 ca thật ⇒ chuyển `ready-to-fix`. Lúc đó đã có mẫu thật để viết test, thay vì test theo tưởng tượng.

## Cách đo lại

Cần dữ liệu `strayNote` tích luỹ (mới ship 2026-08-25, chưa có run nào dùng).

```bash
python3 - <<'EOF'
import json, glob, os, re
for p in sorted(glob.glob('apps/builder/.runs/*/task.json')):
    t = json.load(open(p)); note = t.get('strayNote')
    if not note: continue
    rid = os.path.basename(os.path.dirname(p))
    said = (t.get('requirement') or '')
    try:
        said += ' '.join(json.loads(l).get('detail') or '' for l in open(f'apps/builder/.runs/{rid}/events.jsonl'))
    except FileNotFoundError:
        pass
    for path in re.findall(r'projects/[\w./-]+', note):
        if os.path.basename(os.path.dirname(path)) not in said:
            print(rid, '| model tự đi:', path)
EOF
```

## Nhật ký

- **2026-08-25** — mở. Bằng chứng ngược: 2/2 ca ghi lạc là do user yêu cầu, nên phần deny bị hoãn.
