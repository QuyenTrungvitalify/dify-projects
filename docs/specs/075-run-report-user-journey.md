# Spec 075 — Báo cáo một run theo HÀNH TRÌNH NGƯỜI DÙNG (+ ④ đối chiếu tiêu chí nghiệm thu)

**Status**: S1+S2 ĐÃ IMPLEMENT (2026-07-21) — S1 report.json field + S2 journey command/skill; ranh giới còn lại là backend restart để field mới hoạt động trên run mới.
**Trước đó**: Draft (2026-07-21 — từ câu hỏi của user sau 6 đợt campaign: *"cơ chế report mỗi lần run
đã đủ thông tin chưa? output từng phase, giao tiếp qua lại, thời gian xử lí…"*)
**Effort**: S1 = S–M · S2 = M — tổng ≈ M

---

## 1. Vấn đề — dữ liệu giàu, báo cáo nghèo

Một run đã ghi lại **rất nhiều**, nhưng báo cáo (cả `report.json` lẫn report campaign) chỉ dùng
khoảng một phần ba, và kể theo góc **artifact** chứ không theo góc **người dùng**:

| Có sẵn trong `.runs/<id>/` | Chứa gì | Ai đọc hôm nay |
|---|---|---|
| `events.jsonl` | timeline từng phase (`phase_start` → `gate_reached` → `gate_action`, có `ts`) | **không ai** |
| `criteria.json` | **tiêu chí nghiệm thu do chính build viết** ở ② | **không ai** (xem §2) |
| `diff.json` | thay đổi gì so với bản trước — sống còn cho edit-existing | không ai |
| `transcripts/*.md` | prompt gửi đi + mọi tool call + kết quả từng phase | chỉ đếm `✗` |
| `preflight.json` · `workspace.json` | trạng thái sẵn-sàng, facts workspace | một phần |

Đo thật trên run `1784641794909`: ① 133s → ② 193s → ③ 334s → tổng **660s**. **Chưa report nào từng
nêu con số này**, dù thời gian chờ là phần user cảm nhận rõ nhất.

## 2. Lỗ cấu trúc: không ai kiểm tiêu chí nghiệm thu

`criteria.ts` **chỉ parse SPEC và ghi** `criteria.json`. `report.json` **không có field nào** đối
chiếu. Nghĩa là build tự viết ra thang đo cho chính nó — ví dụ thật:

> 「危険度が「高」の報告のときだけ通知の見出しに【至急】が付き、それ以外では付かない。」

…rồi **không ai chấm lại**. ④ chỉ chạy 4 linter + preflight. Đây chính là lý do 6 đợt campaign phải
nhờ judge đọc YAML thủ công: **hệ thống đã có thang đo mà không dùng**.

## 3. Nguyên tắc thiết kế (giữ khi implement)

1. **Không hứa kiểm được cái không kiểm được.** Tiêu chí là câu tiếng người; phần lớn chỉ xác nhận
   được khi CHẠY THẬT. Dùng đúng hợp đồng 3 rổ đã có của `e2e_check`: `auto_pass` / `auto_fail` /
   `manual` — và **`manual` là kết quả hợp lệ, không phải thất bại**.
2. **④ tĩnh là backend, KHÔNG tốn turn.** Mọi thứ S1 làm phải là predicate tất định. Không gọi LLM
   để chấm tiêu chí ở ④ (muốn chấm LLM thì đó là việc của `/report`, đường riêng, có chi phí).
3. **Báo cáo kể theo hành trình**, không theo cấu trúc file: user chờ bao lâu → **đọc thấy gì** →
   phải quyết gì → cuối cùng phải tự làm gì.
4. **Nguyên văn, không diễn giải**: phần "user đọc thấy gì" trích **đúng chữ** digest/SPEC/notes —
   diễn giải lại là mất chính cái đang đo.

## 4. Slices

### S1 — ④ đối chiếu tiêu chí + ghi timeline vào `report.json` (S–M)

**S1a — `criteria_check`**: ở `runTestAndFinish`, đọc `criteria.json`, với mỗi tiêu chí gán một rổ:
- `auto_pass`/`auto_fail` **chỉ khi** có predicate tất định đã tồn tại ánh xạ được (lint sạch ·
  `hasTriggerEntry` · `hasToolNode` · `deliveredFeature` · `sourceContractNote` có/không · số node ·
  file tồn tại). Ánh xạ bằng **từ khoá trong câu tiêu chí**, thận trọng — không khớp thì thôi.
- còn lại → `manual`, **kèm nguyên văn tiêu chí**.

Giá trị lớn nhất **không** phải phần auto (sẽ ít), mà là: tiêu chí **hiện ra thành checklist cho
user** thay vì chôn trong `criteria.json`. Thêm một dòng notes: *"Build tự đặt N tiêu chí đúng-sai;
X đã tự kiểm, Y cần bạn chạy thử để xác nhận: …"*.

**S1b — `timeline`**: gộp `events.jsonl` thành `{phase, started, gateReachedMs, outcome}` ghi vào
`report.json`. Rẻ, và mở khoá mọi so sánh tốc độ giữa các đợt (hiện phải chạy `e2e-run.sh time` tay).

**Bán kính**: `report.json` **chỉ thêm field** (`criteria_check`, `timeline`) — `web/src/types.ts`
đọc field cũ vẫn chạy; ArtifactPanel hiển thị thêm là tuỳ chọn. Không đổi field cũ ⇒ tương thích
ngược. `criteria.json` không đổi shape.

**AC-S1**: run có SPEC với 4 tiêu chí → `report.json.criteria_check` đủ 4 mục, mỗi mục có rổ + lý do;
tiêu chí không ánh xạ được **phải** là `manual` (không được đoán `auto_pass`); `timeline` có đủ 4
phase với ms; test cũ đọc `report.json` vẫn xanh.

### S2 — `/campaign report` kể theo hành trình người dùng (M)

Đổi cấu trúc report từng run thành **nhật ký hành trình**, mỗi phase một khối:

```
① Analyze — chờ 133s
   User ĐỌC (nguyên văn): "<digest>"
   Phải quyết ở gate: tiếp / sửa / huỷ  → auto mode: tự tiếp
   Đánh giá: hiểu đúng ý user không? có nêu điểm mơ hồ không?
② Spec — chờ 193s ... (kèm N tiêu chí build tự đặt — nguyên văn)
③ Implement — chờ 334s ... (diff.json: thêm/sửa/giữ bao nhiêu node)
④ Test — 4 linter · criteria_check · notes user đọc
Tổng: 660s · model từng phase · denied≈/errored≈
```

Rồi mới tới: verdict judge (context sạch) · bẫy đã gài dính/tránh · **MANUAL còn nợ**.

**AC-S2**: report một run có đủ 4 khối phase với thời gian thật + nguyên văn text user đọc + tiêu chí
nghiệm thu; `CAMPAIGN-GUIDE.md` mô tả cách đọc.

## 5. Non-goals

- Không dùng LLM chấm tiêu chí ở ④ (backend, không turn) — đó là việc của `/report`.
- Không đổi/bỏ field cũ của `report.json` (tương thích ngược tuyệt đối).
- Không tự động hoá phần MANUAL — mục tiêu là **nêu rõ**, không phải giả vờ kiểm được.
- Không đụng `criteria.json` (đầu vào, không phải nơi ghi kết quả).

## 6. Open questions

- OQ1 — Ánh xạ tiêu chí→predicate bằng từ khoá có rủi ro khớp nhầm. Đề xuất: **thà bỏ sót còn hơn
  khớp sai** (mặc định `manual`), và log những câu không khớp để mở rộng dần theo bằng chứng.
- OQ2 — `timeline` có nên gồm cả thời gian người **chờ ở gate** (each_step) không? Đề xuất: có, tách
  `waitingForHumanMs` khỏi `workingMs` — hai con số này ý nghĩa hoàn toàn khác nhau.
