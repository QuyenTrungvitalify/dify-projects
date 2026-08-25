# Spec 111 — Restore phải trả bạn về chỗ bạn đang đứng

> ✅ **ĐÃ SHIP 2026-08-25** — S1 (restore đọc `gate_reached`, không lùi mù) + S2 (event
> `cancelled`/`restored`) + phần retry-prompt. Code: `routes/tasks.ts` (restore/cancel),
> `run-events.ts`, `orchestrator.ts`. Test: `test/restore-target.test.ts` (6), `test/retry-prompt.test.ts` (3)
> — đã kiểm đỏ-khi-revert. **Còn lại**: S3 (nhãn nói trước hậu quả lùi phase) — chỉ cần khi nhánh
> dự phòng còn chạy thường xuyên, đo bằng chính event vừa thêm.
>
> **Status**: **mở một phần** (S1+S2 đã ship, xem trên). Lập 2026-08-25, từ quan sát của user: *"t nhấn cancel lúc đang
> fix gì đó, xong t lại restore lại, khi đó nó quay về phase spec"*. Đúng như user đoán — và nó là
> **nguyên nhân gốc** của hiện tượng "phase ② làm việc của ③" mà spec 108 §7.2 mô tả.
>
> Phạm vi — **ba lát**:
> **S1** `/restore` trả về **gate người dùng đang đứng**, không lùi cứng một biên ·
> **S2** `cancel` và `restore` phải để lại **dấu vết trên run timeline** ·
> **S3** nói ra hậu quả của cú lùi **trước** khi người dùng bấm.
>
> **Không chạm**: ngữ nghĩa `cancel` (vẫn giết lượt, vẫn giữ file) · `undo-fix` (spec 103) ·
> `specRevise`/Lane B · quy tắc "confirmAdvance chạy phase kế tiếp bằng lượt mới" (§5 N3).
>
> Liên quan: [108](108-everything-written-must-be-graded.md) §7.2 — **triệu chứng** của spec này ·
> [106](106-a-stopped-build-must-not-look-abandoned.md) — cùng họ: trạng thái còn sống mà UI nói khác.

---

## 0. Nguyên tắc

**Một nút "khôi phục" phải trả người dùng về chỗ họ vừa rời, không phải về chỗ hệ thống thấy tiện.**

Hôm nay `/restore` làm đúng **một** kịch bản — "lỡ bấm Continue, muốn lùi lại" — và áp nó cho **mọi**
cú cancel, kể cả những cú không hề vượt biên nào. Kết quả là một nút mang nhãn "khôi phục" nhưng
**tháo mất một phase đã hoàn thành**.

---

## 1. Sự cố

### 1.1 `[REPRO]` Chuỗi đã xảy ra — task `1787544155222`, 2026-08-24

| Giờ | Việc | Bằng chứng |
|---|---|---|
| 15:35 | ③ về gate `success` (lần 1) | `events.jsonl` · `implement gate_reached success` |
| 16:32 | ③ về gate `success` (lần 2, sau một vòng fix) | nt |
| 17:00:27 | User "Request changes" ở gate ③ → lượt ③ mới chạy | `implement phase_start reply` |
| ~17:03 | User bấm **Cancel** → tiến trình con bị giết | `transcripts/implement.md`: *"process exited code null before a result event"* |
| ~17:05 | User bấm **Restore** | **không có event nào** |
| 17:06:28 | Lượt kế tiếp đã mang nhãn **`spec`** | `spec phase_start reply` |
| 17:06 → 00:31 | **13 lượt ② liên tiếp trong ~7 giờ**, tất cả đều là việc của ③ | `events.jsonl`, và 108 §7.2 |

Giữa `17:00:27 implement` và `17:06:28 spec` **không có một dòng nào** giải thích vì sao phase lùi.

### 1.2 `[ĐO code]` Đây là hành vi được thiết kế — cho một kịch bản khác

`routes/tasks.ts:975-976`, ngay trên route:

> *"Undo the `/confirm` that advanced too far: rewind ONE boundary to the previous phase's gate"*

`restoreTargetPhaseFor` (`state/task.ts:618`) chỉ đọc **một** trường — `task.phase` — rồi lùi một bậc.
Nó không hỏi, và không có cách nào hỏi: *phase đó đã từng về gate thành công chưa?*

`[ĐO]` Với task `1787544155222` câu trả lời là **rồi, hai lần** (15:35 và 16:32). Task bị lùi khỏi một
phase đã hoàn thành và đã được người dùng nghiệm thu.

### 1.3 Hai kịch bản, một hàm

| Kịch bản | Có vượt biên không? | Lùi một bậc có đúng không? |
|---|---|---|
| Bấm Continue ở ② → ③ chạy → thấy sai → Cancel | **có** (② → ③) | ✅ đúng — trả về ② |
| Đang ở gate ③/④, gửi một vòng fix → Cancel | **không** — phase không hề đổi | ❌ sai — tháo mất ③ |

Kịch bản 2 chính là cái user gặp, và là cái **thường xuyên hơn**: `[ĐO]` task `1787544155222` có
**3** cú vượt biên (`gate_action`) so với **14** cú `/reply` (`request_changes`) + **3** `retry` —
tức ~85% số lần một lượt bắt đầu, nó bắt đầu **không** kèm một cú vượt biên nào để mà lùi.

### 1.4 Vì sao nó đắt: đường đi tiếp từ gate ② đốt phiên ③

`orchestrator.ts:9` — *"confirmAdvance … run the NEXT phase as a fresh turn (**no cross-phase resume**)"*.

Nghĩa là sau cú lùi, nút "この仕様で実装" **không** nối lại phiên ③ cũ: nó mở phiên mới, và toàn bộ
ngữ cảnh của các vòng fix trước đó (ở đây: 3 vòng, gồm cả những gì đã đo trên log thật) biến mất.

⇒ Người dùng bị đặt vào thế: **đi tiếp thì mất việc, đứng lại thì sai phase.** `[ĐO]` Họ chọn đứng
lại — 13 lượt, ~7 giờ, và mọi thay đổi `main.yml`/`appScript.js` trong quãng đó không qua linter nào
của backend (108 §7.2). Đó không phải người dùng dùng sai; đó là hệ thống chỉ chừa một lối.

---

## 2. Ba khiếm khuyết, tách bạch

| # | Khiếm khuyết | Ở đâu |
|---|---|---|
| **D1** | `/restore` lùi một biên **chưa từng được vượt** | `restoreTargetPhaseFor` — `state/task.ts:618`; route `tasks.ts:1012` |
| **D2** | `cancel` và `restore` **không có event** trên run timeline | `RunEventKind` — `lib/run-events.ts:20-45` (không có `cancel`, không có `restore`) |
| **D3** | Nút không nói nó sẽ lùi phase | thẻ cancel nói *"これまでの仕様・成果物は保持されます"* — **đúng về file**, và vì đúng nên càng khiến người đọc tin là không mất gì |

D2 không phải chuyện nhỏ: nó là lý do phải mất công truy ngược mới biết chuyện gì đã xảy ra. Một
timeline có `cancelled ③` → `restored ③→②` thì user tự đọc ra trong 2 giây.

---

## 3. Các lát

### S1 — Trả về gate người dùng đang đứng

**Làm gì.** Ghi lại chỗ đứng **trước** khi lượt chạy, rồi `/restore` đọc nó.

Cơ chế đã có sẵn trong repo, dùng đúng lại nó: `orchestrator.ts:350` —
`task.specReviseFrom = { phase, status, gate }`, kèm comment *"Capture where the human is standing
BEFORE the phase moves"*. Lane B đã giải đúng bài toán này cho một trường hợp; S1 chỉ tổng quát hoá.

1. Trong `runPhaseAndGate`, trước khi `task.phase`/`status` bị ghi đè, lưu
   `task.gateBefore = { phase, status, gate }` (chỉ khi trạng thái cũ **là một gate** —
   `awaiting_confirm`/`done`; một lượt nối tiếp lượt đang chạy không có gate để ghi).
2. `/restore`: có `gateBefore` **và** nó còn mạch lạc (artifact của phase đó còn trên đĩa) ⇒ trả về
   **đúng gate đó**. Không có ⇒ giữ nguyên đường lùi-một-biên hôm nay.

**Hai kịch bản §1.3 hợp nhất, không cần rẽ nhánh:**

| Kịch bản | `gateBefore` là gì | Restore trả về |
|---|---|---|
| Cancel ngay sau Continue từ ② | gate ② | ② — **y như hôm nay** |
| Cancel một vòng fix từ gate ③ | gate ③ | ③ — kèm artifact, 差分, Undo còn nguyên |
| Cancel một vòng fix từ gate ④ | gate ④ | ④ |

**Ranh giới:**
- `gateBefore` **không** đổi `artifactRel`, không đụng file, không chạy lượt nào — `/restore` vẫn là
  thao tác thuần trạng thái, vẫn không lấy turn lock (route giữ nguyên hình dạng).
- `analyze` không có gate trước ⇒ nhánh `error` "restored — Retry to re-run analyze" giữ nguyên.
- `specRevise` vẫn bị dọn khi cancel (`tasks.ts:1004`) — quy tắc đó độc lập, không đụng.

**Nghiệm thu:**
1. Cancel một vòng fix ở gate ③ → Restore ⇒ `phase === 'implement'`, `status === 'awaiting_confirm'`,
   gate ③, và `sessionIds.implement` **còn nguyên**.
2. Cancel ngay sau `/confirm` từ ② ⇒ trả về ② — **byte-identical với hôm nay** (test cũ không đổi).
3. `gateBefore` trỏ tới phase mà artifact đã biến mất ⇒ rơi về đường lùi-một-biên, không nổ.
4. Test đỏ-khi-revert: gỡ `gateBefore` thì ca (1) rơi về ② — đó chính là bug.

### S2 — Cancel và restore phải để lại dấu vết

**Làm gì.** Thêm hai `RunEventKind`: `cancelled` (detail: phase + có lượt đang chạy hay không) và
`restored` (detail: `③ → ②` hoặc `③ → ③`). Ghi ở đúng hai route.

**Vì sao đáng một lát riêng.** `[ĐO]` Chuỗi §1.1 phải dựng lại bằng cách đối chiếu mtime + transcript
+ suy luận; `events.jsonl` — thứ đi kèm mọi bundle export và là nguồn duy nhất tester gửi được — **im
lặng hoàn toàn** ở đúng khoảnh khắc quan trọng nhất. Cùng lý do spec 099 S0 thêm `stream_open/close`.

Kèm theo (rẻ, cùng chỗ): một lượt bị **giết** hiện ra là `process exited code null before a result
event` — không phân biệt được với sập thật. Detail của `cancelled` giải quyết luôn chuyện đó.

**Nghiệm thu:**
1. Cancel lúc có lượt chạy ⇒ 1 event `cancelled`, detail nêu phase + `turn_killed`.
2. Restore ⇒ 1 event `restored`, detail nêu `from → to`.
3. Bundle export chứa cả hai (đi theo `events.jsonl`, không cần đụng bundle).

### S3 — Nói trước hậu quả, đừng để người dùng phát hiện sau

**Làm gì.** Khi (và chỉ khi) restore thật sự **lùi** một biên — tức rơi vào nhánh dự phòng của S1 —
thẻ cancel phải nói rõ trước khi bấm:

> `Restore sẽ mở lại ở ② 仕様. Phase ③ phải chạy lại từ đầu bằng một phiên mới — file trên đĩa được
> giữ, nhưng lịch sử hội thoại của ③ thì không.`

Khi restore trả về **đúng gate cũ** (đường chính sau S1), nhãn giữ nguyên như hiện nay — không có
hậu quả nào để cảnh báo.

**Nghiệm thu:** hai nhãn khác nhau cho hai nhánh; nhánh chính không thêm chữ nào.

---

## 4. Repro

```bash
# Chuỗi cancel→restore trong task 1787544155222: phase nhảy ③ → ② không một event ở giữa
python3 - <<'PY'
import json, datetime
f=lambda ms: datetime.datetime.fromtimestamp(ms/1000).strftime('%m-%d %H:%M:%S')
for l in open('apps/builder/.runs/1787544155222/events.jsonl'):
    e=json.loads(l)
    if e['kind'] in ('stream_open','stream_close'): continue
    if e['kind'] in ('phase_start','gate_reached','gate_action'):
        print(f(e['ts']), e.get('phase'), e['kind'], e.get('detail'))
PY

# Lượt bị giết trông giống hệt một cú sập
grep -n "process exited code null" apps/builder/.runs/1787544155222/transcripts/implement.md

# Không có kind nào cho cancel/restore
grep -n "cancel\|restore" apps/builder/server/lib/run-events.ts
```

---

## 5. Non-goals

- **N1 — Không đụng ngữ nghĩa `cancel`.** Vẫn giết lượt đang chạy, vẫn giữ nguyên file trên đĩa.
- **N2 — Không tự động restore.** Cancel rồi restore vẫn là hai quyết định của người dùng.
- **N3 — Không đổi quy tắc "confirmAdvance chạy phase kế tiếp bằng lượt mới".** Cho ③ nối lại phiên
  cũ khi vượt biên là một thay đổi khác, rộng hơn (§6 Q1) — spec này chỉ làm cho người dùng **không
  bị đẩy** vào chỗ phải trả cái giá đó.
- **N4 — Không đụng `undo-fix`** (spec 103): nó lùi *nội dung file*, spec này lùi *trạng thái phase*.
  Hai thứ khác nhau và phải giữ khác nhau.

---

## 6. Open questions

1. **Continue từ ② có nên nối lại phiên ③ khi `sessionIds.implement` còn không?** Sẽ xoá hẳn cái giá
   ở §1.4, nhưng đụng bất biến "no cross-phase resume" (`orchestrator.ts:9`) — bất biến đó có lý do
   riêng chưa đo lại. **Chưa chốt, và S1 không phụ thuộc nó.**
2. **`gateBefore` sống bao lâu?** Đề xuất: ghi đè mỗi lượt, không có TTL. Cần kiểm một chuỗi
   cancel→restore→cancel→restore xem có tự trỏ vòng không.
3. **Cancel khi KHÔNG có lượt nào chạy** (bấm Cancel ở một gate đang đứng yên) — hôm nay vẫn cho, và
   restore sẽ lùi một biên. Sau S1 nó trả về đúng gate đó, tức Cancel + Restore thành no-op. Đúng
   hay nên chặn Cancel ở trạng thái đứng yên? **Chưa chốt.**
