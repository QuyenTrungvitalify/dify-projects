# Spec 076 — Findings chất lượng build chờ VERIFY (từ 6 đợt campaign, không tính tiếng Việt)

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

## 1. S1 — Ghi dồn vào Google Sheets: catalog KHÔNG có "append", builds tự chế (nghi mất dữ liệu, CHƯA verify)

> **RÀ SOÁT LẠI 2026-07-21 — bản cũ của slice này SAI một phần, đã sửa:**
> - Sai: nói "phải truyền range/append flag tường minh". `batch_update` **không có tham số range**
>   (catalog: chỉ `spreadsheet_id`, `data`, `value_input_option`…). Range nằm TRONG `data` theo định
>   dạng Google `[{range, values}]`.
> - Sai: gộp thành "n=3 cùng một bug". Đọc value thật → **3 build hành xử 3 kiểu khác nhau**.

**Sự thật sau khi đọc value thật của node** (không đoán):
| Build | `data` truyền gì | Hệ quả |
|---|---|---|
| `google_1_80_chatwork` | `[{"range":"記録!A:D", values:[[…]]}]` | range `A:D` = ghi **từ A1** → **ĐÈ** dữ liệu cũ |
| `chatwork` | `[[…]]` mảng trần, **không range** | tuỳ plugin — không xác định |
| `5_chatwork_5_52` | code dựng data, **0 batch_get** (không đọc dòng hiện có) | không có cơ sở để append đúng |

**Gốc thật**: catalog chỉ có `batch_get` + `batch_update`, **KHÔNG có primitive `append`**. Google
Sheets API phân biệt `values.append` (nối sau bảng) với `batchUpdate` (ghi vào range = đè). Plugin chỉ
đưa cái ghi-đè. Nên muốn tích luỹ dòng, build **bắt buộc** đọc số dòng hiện có (`batch_get`) rồi ghi
vào `A{n+1}` — mà phần lớn build không làm.

**MỨC CHẮC CHẮN**: đây là **nghi vấn mạnh về lý thuyết** (range A:D đọc ra tận mắt + không có append
primitive), **NHƯNG chưa verify trên plugin `omluc/google_sheets` thật** — plugin có thể tự append
bên trong. Chưa build nào chạy live qua 6 đợt.

**Bước đúng = VERIFY, không phải "fix"**:
- Chạy 1 build live ghi 2 lần vào cùng sheet → xem dòng thứ 2 **nối tiếp hay đè** dòng đầu. Rẻ, và
  **chốt dứt điểm** finding này là thật hay không. Nếu plugin tự append → **finding biến mất**, không
  cần fix gì.
- CHỈ KHI verify ra "đè" → fix = **guidance** (implement.md: build ghi-dồn phải `batch_get` đếm dòng
  rồi ghi `A{n+1}`; ④ notes cảnh báo). Bán kính guidance ≈ 0 (file skill).

**Không có fix code nào ở đây** — trước verify thì chưa biết có bug; sau verify (nếu có) thì chỉ là
hướng dẫn skill.

## 2. S2 — Lọc cửa sổ thời gian: mỗi build xử lý ca-biên KHÁC nhau, đều LATENT (chưa verify)

> **RÀ SOÁT LẠI: bản cũ nói "n=3 cùng bug đếm lại dòng thiếu ngày" — SAI.** Đọc code thật, 3 build
> làm **3 kiểu khác nhau**, thậm chí ngược hướng nhau:

| Build | Logic thật (đọc từ code) | Ca biên "dòng thiếu/sai ngày" |
|---|---|---|
| `google_1_80_chatwork` | **không có filter thời gian** | tính cả lịch sử (từ kỳ 2 sai) |
| `google_9_chatwork_b` | `elif week_start <= d <= week_end` | dòng None bị **DROP im lặng** (under-count) |
| `chatwork` | `if dt is not None and dt < cutoff: continue` | dòng None bị **ĐẾM vào** (over-count) |

Điểm chung THẬT (không phóng đại): **xử lý ca-biên ngày (thiếu/không parse được) không nhất quán và
thường sai** — nhưng đây là **một LỚP edge-case**, không phải một bug giống hệt.

**MỨC CHẮC CHẮN**: tất cả đều **latent** — chỉ lộ khi dữ liệu thật có dòng thiếu/sai ngày, hoặc chạy
qua ≥2 kỳ. **Chưa build nào chạy live** để xác nhận thật sự ra số sai. `occurred_at` thường là field
optional → có thể trong thực tế nguồn luôn gửi ngày → bug **không bao giờ kích hoạt**.

**Bước đúng = quan sát, chưa fix**: đợt test mới (dùng criteria_check 075) với đề có ràng buộc
"tuần này/tháng này" → xem build xử lý dòng biên ra sao; nếu tái hiện sai thật thì fix = **guidance**
(`implement.md`: lọc theo cửa sổ thời gian phải quyết TƯỜNG MINH dòng-không-có-ngày, và nêu open
point). Bán kính guidance ≈ 0.

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
