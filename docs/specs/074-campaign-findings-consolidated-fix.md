# Spec 074 — Gói fix hợp nhất từ 6 đợt campaign (v0.2.0 → v0.3.0)

**Status**: Draft (2026-07-21 — tổng hợp 5 đợt máy-sinh đã đóng + đợt 6 tiebreak)
**Nguồn**: [CAMPAIGNS.md](../prompts/runs/CAMPAIGNS.md) — mỗi finding có link bằng chứng + số mẫu.
**Nguyên tắc**: chỉ fix cái **cơ học, đủ mẫu, biết rõ bán kính ảnh hưởng**. Propensity KHÔNG fix bằng
code. Mỗi slice kèm *"cái gì có thể vỡ"* — đây là phần đắt nhất của spec này.

---

## 0. Cái KHÔNG fix (và vì sao) — đọc trước

| Finding | Mẫu | Vì sao không fix |
|---|---|---|
| **H** "chatbot" → `mode: workflow` | n=2 | **Propensity theo độ mạnh tín hiệu**: R4 tín hiệu yếu→workflow, R5 tín hiệu mạnh→chatflow đúng-bài (memory 2 node + query-rewrite). Không có ngưỡng cơ học nào để code. Nếu muốn cải thiện: guidance ① nhận diện ý định hội thoại — nhưng đó là sửa propensity bằng prompt, đo được thì mới làm. |
| **I** mất dấu VI trong YAML sinh ra | n=2 (1 lỗi/1 sạch) | **Không tất định**. Đợt 6 đang phá hòa; chỉ fix nếu tái hiện ≥2/3 mẫu VI. |
| **E** fail-open flow duyệt tiền · **K** thiếu `max_tokens` khi N lớn | n=1 mỗi | Guidance `implement.md`, không phải code. Gom vào một lần sửa skill sau khi có thêm mẫu. |
| **7** không có đường tra per-tool behavior | n=4 | Thật, nhưng fix = **quyết định phạm vi catalog/sandbox** (mở rộng `tool-catalog.json` hay thêm lệnh tra) — cần user chốt, không nằm trong gói này. |

---

## 1. Slice S1 — Slug rác từ requirement phi-ASCII (finding 8, n=8)

**Triệu chứng**: `1万字…Google…` → `1_google_1` · `Tôi phụ trách…` → `t_i_ph_tr` · `b_c_c` ·
`5_chatwork_5_52`. Xuất hiện ở **cả JA và VI**, chỉ trên đường **new-workflow** (đường edit-existing
dùng slug của base → sạch, xác nhận R4-G01).

**Nguyên nhân**: `deriveSlugName` (`server/lib/slug.ts`) strip `[^a-z0-9]` rồi lấy ≤4 từ đầu. Với
requirement phi-ASCII, cái còn lại là **mảnh vụn 1–2 ký tự** (VI mất dấu: `t`, `i`, `ph`, `tr`) và
**token thuần số** (`1` từ 「1万字」). Guard `GENERIC_SLUG` chỉ bắn khi **sạch bóng** ASCII, nên rác
lọt qua.

### ⚠️ Bán kính ảnh hưởng — CHỖ DỄ VỠ NHẤT của cả gói

`deriveSlugName` có **4 nơi gọi**, và 2 nơi **KHÔNG phải** đường sinh-workflow-mới:

| Caller | Input | Hành vi hiện tại | Rủi ro nếu sửa ẩu |
|---|---|---|---|
| `scaffold.ts:75,201` | **requirement** (văn xuôi dài) | sinh rác ← chỗ cần sửa | — |
| `base-import.ts:175` | `app.name` (tiêu đề ngắn) | `リスト入力催促ChatWork通知フロー` → `chatwork` — **được coi là TÍNH NĂNG**, assert trong 2 test | **Sửa sai là vỡ ngay** |
| `promote.ts:395` | `app.name` | JP thuần → `GENERIC_SLUG` (có comment khai) | vỡ tên file pattern |
| `orchestrator.ts:50` | re-export | — | — |

**Kết luận thiết kế**: KHÔNG đổi ngữ nghĩa tổng quát. Chỉ **lọc mảnh vô nghĩa**:

- bỏ token **thuần số**;
- bỏ token **độ dài ≤2**;
- nếu sau lọc rỗng → `GENERIC_SLUG` (đường đã có sẵn, spec 029 lấy tên từ project).

**Vì sao an toàn** (đã kiểm chứng trên code + test hiện có):
- `chatwork` (8 ký tự) → **không bị lọc** ⇒ base-import giữ nguyên 2 assert.
- `顧客対応催促フロー` → words rỗng ⇒ `GENERIC_SLUG` như cũ.
- 4 test trong `slug.test.ts` đều dùng từ ≥3 ký tự (`input`, `string`, `alpha`, `abcdefghij`…) ⇒ pass.
- Ca rác: `1_google_1` → `google` (có nghĩa hơn) · `t_i_ph_tr` → `GENERIC_SLUG` → `workflow_N`.

**AC-S1**: unit test mới cho 3 ca thật từ campaign (JA-số-lạc, VI-mất-dấu, hỗn hợp) + **toàn bộ
`slug.test.ts` và `base-import.test.ts` hiện có phải xanh không sửa một dòng nào**. Nếu phải sửa
test cũ ⇒ thiết kế sai, dừng lại.

---

## 2. Slice S2 — User Việt không được localize notes (finding B, sửa lại bản chất)

**Chẩn đoán ban đầu SAI, đã sửa**: "notes tiếng Anh" **không phải bug** — `report.json.notes` lưu EN
**có chủ đích** (spec 063 EN-first), UI dịch ở client bằng `localizeNotes()` + bảng `NOTE_JA`
(`web/src/lib/i18n.ts`). Judge đọc thẳng `report.json` nên thấy bản lưu; **user JA trên UI vẫn thấy
tiếng Nhật**. Advisory spec-072 cũng đã có frame JA.

**Lỗ THẬT**: **`NOTE_VI` không tồn tại** (grep = 0). Mọi build VI (R2-G02, R3-G02, R4-G02, R5-G02,
và 2 đề VI đợt 6) → user Việt đọc notes tiếng Anh trên UI, kể cả câu sống-còn "cần thêm model".

**Bán kính**: **thuần cộng thêm** ở client (`i18n.ts`), không đụng `report.ts`, không đổi shape
`report.json`, không đụng đường JA/EN. Rủi ro ≈ 0.

**Thêm (chống trôi)**: hiện chỉ có test ghim *EN wording-stable* (`report-tool-note.test.ts`,
`report-trigger-note.test.ts`) — **không có test nào bảo đảm mọi frame phát ra ĐỀU có bản dịch**.
Nên mỗi chuỗi notes mới lặng lẽ rơi về EN. Thêm một test đối chiếu danh sách frame ↔ bảng dịch.

**AC-S2**: bảng `NOTE_VI` phủ đúng tập frame `NOTE_JA` đang phủ; test coverage-frame đỏ khi thêm
chuỗi notes mới mà quên dịch; UI toggle VI hiển thị notes tiếng Việt.

---

## 3. Slice S3 — ④ giả định MỘT file/workflow (finding A)

**Triệu chứng** (R2-G03): build sinh 2 file (`main.yml` + `monthly_summary.yml`); `report.json` chỉ
khai `workflow_file: main.yml` ⇒ file thứ 2 **không qua 4 linter**, notes **không nhắc** ⇒ user
triển khai nửa hệ thống mà không biết.

**Trạng thái**: **harness đã vá** (`campaign.py record` gặt `workflow_files` + cờ
`extra_workflow_files_unlinted`). Còn **Builder-side chưa**.

**Mẫu**: n=1 tại thời điểm viết — **đợt 6 G03 đang phá hòa** (đề 2-nhịp dễ sinh multi-file). Nếu tái
hiện ⇒ đủ mẫu, làm S3; nếu không ⇒ hạ xuống theo dõi.

**Bán kính** (khi làm): `linters.ts` (`lintClean` đang nhận 1 path) · `report.ts` (`workflow_file`
đơn) · shape `report.json` — **đây là đổi hợp đồng wire**, `web/src/types.ts` + ArtifactPanel đọc
`workflow_file`. ⇒ Cách an toàn: **giữ `workflow_file` cũ**, thêm trường `workflow_files[]` phụ
(tương thích ngược), lint tất cả, notes nhắc file phụ.

**AC-S3**: build 2 file → cả 2 qua 4 linter, notes nêu đủ; test cũ đọc `workflow_file` vẫn xanh.

---

## 4. Thứ tự đề nghị + nghiệm thu

1. **S2** (rủi ro ≈ 0, thuần cộng, user VI hưởng ngay)
2. **S1** (rủi ro thấp nhưng có bẫy base-import — theo đúng thiết kế lọc ở trên)
3. **S3** chỉ khi đợt 6 xác nhận n≥2

Sau khi fix: bump **v0.3.0** → `/campaign recheck` **cả 6 đợt** (đề đã đóng băng theo commit, chạy
lại nguyên văn) → bảng trước/sau cùng-đề cùng-model. Kỳ vọng: slug có nghĩa/`workflow_N`, notes VI
tiếng Việt, các verdict PASS/PARTIAL **không đổi chiều xấu đi** (đây là phép thử "không gây vấn đề khác").

## 5. Non-goals

- Không đổi ngữ nghĩa `deriveSlugName` cho `app.name` (base-import/promote giữ nguyên).
- Không đổi luật EN-first của `report.json` (chỉ thêm đường dịch client).
- Không fix propensity (H, I) bằng code.
- Không nới sandbox / không mở rộng catalog trong gói này (finding 7 cần user quyết riêng).
