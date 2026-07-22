# Spec 074 — Gói fix chất lượng build (hợp nhất từ 6 đợt campaign, KHÔNG tính tiếng Việt)

**Status**: Draft (2026-07-21 — tổng hợp 6 đợt máy-sinh; đã bỏ các finding tiếng Việt theo yêu cầu)
**Nguồn**: [CAMPAIGNS.md](../prompts/runs/CAMPAIGNS.md) — mỗi finding có link bằng chứng + số mẫu.
**Nguyên tắc**: chỉ fix cái **cơ học, đủ mẫu, biết rõ bán kính**. Propensity KHÔNG fix bằng code. Mỗi
slice kèm *"cái gì có thể vỡ"*. Thứ tự = theo **mức hại**, nặng nhất trước.

---

## 0. Cái KHÔNG fix (và vì sao)

| Finding | Mẫu | Vì sao không |
|---|---|---|
| **H** "chatbot" → `mode: workflow` | n=2 | Propensity theo độ mạnh tín hiệu (tín hiệu mạnh → chatflow đúng). Không có ngưỡng cơ học. |
| Tiếng Việt (mất dấu · NOTE_VI) | — | **User bỏ — không care tiếng Việt.** |
| **7** không có đường tra per-tool behavior | n=4 | Thật, nhưng fix = quyết định phạm vi catalog/sandbox — cần user chốt riêng. |

---

## 1. S1 — `batch_update` append hay GHI ĐÈ: chưa verify → **rủi ro MẤT DỮ LIỆU** (n=3)

**Nặng nhất.** 3 build (R2-G03, R4-G01, R6-G03) dùng tool `google_sheets` `batch_update` để "追記/ghi
thêm 1 dòng", nhưng **không truyền sheet name/range/append flag** — chỉ `spreadsheet_id` + `data`.
Chính comment trong build R6-G03 tự thú: *"A:D をそのまま渡すと A1 起点で上書きになる環境がある"* (có
môi trường sẽ **ghi đè từ A1** thay vì append).

Hậu quả nếu là ghi đè: user cần "cuối tháng xem lại" nhưng mỗi lần chạy **xoá dòng cũ** → mất sạch
lịch sử, âm thầm.

**Fix — hai phần**:
- **Verify runtime** (bắt buộc trước khi chốt cách append): chạy thật `batch_update` với `data=[[…]]`
  không range → quan sát append hay overwrite trên Dify 1.15 thật. Đây là câu hỏi *chưa ai trả lời*
  qua 6 đợt.
- **Guidance** (`implement.md` + pattern `scheduled-tool-append.yml`): khi build một node ghi-thêm
  vào Sheets, PHẢI truyền range/append tường minh theo kết quả verify, KHÔNG để `batch_update`
  đoán; và ④ notes phải cảnh báo "kiểm chế độ ghi trước khi tin dữ liệu tích luỹ".

**Bán kính**: guidance-only (file skill/pattern, đọc lúc chạy). Verify là việc chạy thật, không đụng code.
**AC**: pattern append có range tường minh + ghi chú verify; build mới không ship `batch_update`
trần data.

## 2. S2 — Lọc cửa sổ thời gian sai → **báo cáo ra SỐ SAI** (n=3)

3 build (R2-G03 không lọc tháng · R3-G03 nuốt dòng sai ngày · R6-G03 đếm lại dòng thiếu ngày mãi
mãi). Mẫu chung: code aggregate lọc `if dt is not None and dt < cutoff: continue` — dòng **thiếu
ngày / parse lỗi** (`dt is None`) **lọt vào** thống kê, nên số liệu sai từ kỳ thứ 2.

**Fix — guidance** (`implement.md`): khi lọc bản ghi theo cửa sổ thời gian, dòng **không xác định
được ngày** phải bị **loại tường minh** (`if dt is None or dt < cutoff: continue`), KHÔNG mặc định
tính vào; và nếu có ngày optional thì nêu open point "bản ghi thiếu ngày xử lý sao".

**Bán kính**: guidance-only. **AC**: build có aggregate-theo-tuần loại đúng dòng thiếu ngày (recheck
đo bằng criteria_check của 075).

## 3. S3 — Slug rác từ requirement phi-ASCII (n=8, ngôn-ngữ-bất-biến)

`1万字…Google…` → `1_google_1`; token thuần số + mảnh ≤2 ký tự lọt qua guard `GENERIC_SLUG` (chỉ bắn
khi sạch bóng ASCII). Chỉ trên đường **new-workflow** (edit-existing dùng slug base → sạch).

**Fix**: KHÔNG đổi ngữ nghĩa tổng quát — chỉ **lọc mảnh vô nghĩa** trong `deriveSlugName`: bỏ token
thuần số + token ≤2 ký tự; sau lọc rỗng → `GENERIC_SLUG`.

### ⚠️ Bán kính — bẫy đã khoanh
`deriveSlugName` có **4 caller**, 2 nơi KHÔNG phải new-workflow: `base-import.ts` **DỰA VÀO** hành vi
hiện tại (`リスト入力催促ChatWork通知フロー` → `chatwork` được assert như **tính năng** trong 2 test) ·
`promote.ts` (JP thuần → `GENERIC_SLUG`). Thiết kế lọc đã kiểm: `chatwork` (8 ký tự) **không bị đụng**,
cả 4 test `slug.test.ts` dùng từ ≥3 ký tự.
**AC + tiêu chí dừng**: unit test 3 ca thật; **`slug.test.ts` + `base-import.test.ts` phải xanh không
sửa một dòng**. Phải sửa test cũ ⇒ thiết kế sai, DỪNG.

## 4. S4 — Làm rõ guidance "1 trigger/workflow" (câu chữ)

Judge R6-G03 kiểm nguồn `vendor/dify-src`: webhook + schedule **cùng workflow là HỢP LỆ**
(`webhook_service.py:755` / `workflow_schedule_tasks.py:59` mỗi cái set `root_node_id` riêng).
`spec.md:74` viết *"at most ONE **schedule** trigger"* — R2-G03 đọc thành "một trigger tổng cộng" rồi
tách 2 file (ca đẻ ra finding ④-đa-file). Làm rõ: nhiều trigger **khác loại** OK; ràng buộc chỉ áp
cho nhiều **schedule**. Gộp A′: notes phải nói số nhiều khi YAML có ≥2 trigger.
**Bán kính**: file skill. Rủi ro 0.

## 5. Theo dõi — chưa đủ mẫu, KHÔNG fix trong gói này

| Finding | Mẫu | Ghi chú |
|---|---|---|
| ④ giả định 1-file/workflow (A) | n=1 | Đợt 6 không tái hiện. Harness đã vá (record gặt `extra_workflow_files_unlinted`); Builder-side chờ mẫu 2. |
| Fail-open flow duyệt tiền (E) | n=1 | parse tiền hỏng → route xuống nhánh thấp, né cổng duyệt. Guidance nếu tái hiện. |
| Thiếu `max_tokens` khi N lớn (K) | n=1 | single-prompt 50 review có thể cắt output. Guidance nếu tái hiện. |
| Code node `type:number` + `return None` (R6-G02) | n=1 | đường dự phòng giết run. |

## 6. Thứ tự + nghiệm thu

1. **S1** (mất dữ liệu — verify runtime trước, rồi guidance)
2. **S2** (số sai — guidance)
3. **S3** (slug — code, theo thiết kế lọc + tiêu chí dừng)
4. **S4** (câu chữ)

Sau fix: bump **v0.3.0** → **restart backend** (để report mới 075 hoạt động) → `/campaign` một đợt
mới **nhắm chính các finding này**, đọc verdict qua **criteria_check + journey** (075) thay vì judge
đọc tay. Đợt đó vừa nghiệm thu fix, vừa là lần đầu dùng cơ chế report mới → đánh giá chuẩn hơn.

## 7. Non-goals
- Không đổi ngữ nghĩa `deriveSlugName` cho `app.name` (base-import/promote giữ nguyên).
- Không fix propensity (H) bằng code.
- Không nới sandbox / mở rộng catalog (finding 7 — user quyết riêng).
- Không đụng gì thuộc tiếng Việt.
