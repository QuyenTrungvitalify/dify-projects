---
id: W-006
title: Continue từ gate ② luôn khởi động ③ bằng phiên mới — đốt hội thoại cũ
status: blocked
confidence: measured
opened: 2026-08-25
detector: "blocked — cần dữ liệu `restored` tích luỹ (event mới ship 2026-08-25)"
threshold: "còn ca nào phải bấm 'Implement this spec' trên build đã có main.yml tốt → cân nhắc cho ③ resume"
related: [spec-111]
fixed_by: null
---

<!-- auto:scan — điền tay 2026-08-25 -->
| lần đầu | lần cuối | số lần | ghi chú |
|---|---|---|---|
| 08-24 17:06 | 08-24 17:06 | 1 (suy ra) | chưa đo trực tiếp được — xem dưới |
<!-- /auto -->

## Cách sinh ra

- **Kích hoạt**: build đang ở gate ② (dù đã có `main.yml` tốt từ trước), user bấm *Implement this spec*.
- **Cơ chế**: `confirmAdvance` chạy phase kế tiếp bằng **lượt mới**, không resume — có ghi rõ trong
  đầu `orchestrator.ts`: *"run the NEXT phase as a fresh turn (no cross-phase resume)"*. Đây là
  **thiết kế có chủ ý**, không phải bug.
- **Dấu hiệu**: `phase_start: fresh` cho `implement` trên một run mà `sessionIds.implement` đã tồn tại.

## Vì sao là `blocked`, không phải `watching`

Nó chỉ đau khi bị đẩy về ② một cách oan uổng — mà spec 111 vừa chặn đúng nguyên nhân đó ngày 25/08.
Nên câu hỏi thật là: **sau khi restore đã đúng, còn ai rơi vào tình huống này nữa không?**

Chưa trả lời được: dữ liệu `restored` bắt đầu từ hôm nay. Cần vài tuần vận hành.

`[ĐO]` Bằng chứng gián tiếp cho biết nó thật: run `1787544155222` bị lùi về ② lúc 17:06 và **không hề
bấm Continue** trong 7 giờ sau đó — 13 lượt đều gõ thẳng vào gate ②. Đường đi tiếp có giá là "mất
phiên ③", nên user chọn đi vòng.

## Cách đo lại (khi đã có dữ liệu)

```bash
python3 - <<'EOF'
import json, glob, os
for d in sorted(glob.glob('apps/builder/.runs/*/')):
    try: E = [json.loads(l) for l in open(os.path.join(d, 'events.jsonl'))]
    except FileNotFoundError: continue
    seen_impl = False
    for e in E:
        if e.get('phase') == 'implement' and e.get('kind') == 'gate_reached': seen_impl = True
        if seen_impl and e.get('phase') == 'implement' and e.get('kind') == 'phase_start' and e.get('detail') == 'fresh':
            print(os.path.basename(d.rstrip('/')), '| ③ chạy lại từ đầu dù đã từng có gate')
EOF
```

## Nhật ký

- **2026-08-25** — mở ở trạng thái `blocked`. Chờ dữ liệu `restored` sau khi spec 111 ship.
