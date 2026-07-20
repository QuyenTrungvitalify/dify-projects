# Hướng dẫn `/campaign` — chạy một đợt test tự động từ A đến Z

Dành cho người vận hành. Tiêu chí đề: [CHARTER.md](CHARTER.md) · thiết kế: spec 073 · thủ tục chi
tiết máy làm theo: [`.claude/skills/campaign/SKILL.md`](../../.claude/skills/campaign/SKILL.md) ·
đối chiếu các đợt: [runs/CAMPAIGNS.md](runs/CAMPAIGNS.md).

> **Trạng thái**: harness đã có unit test (19 test `campaign.py`) và smoke test, nhưng **chưa có đợt
> chạy thật trọn vòng** — đợt đầu tiên chính là nghiệm thu, nên chạy NHỎ (2–3 đề). Spec 073 còn mở
> vì lý do này; nghiệm thu xong thì `/spec-close 073`.

## Vòng đời một đợt

```
plan ──► bạn duyệt/sửa đề ──► chốt ──► run (nền) ──► report ──► bạn fix ──► recheck
```

Phân vai cố định: **máy** phân tích/sinh đề/chạy/chấm/ghi sổ — **bạn** duyệt đề, quyết fix, quyết
bump version, làm các mục MANUAL. Máy không bao giờ tự fix Builder theo finding.

## 0. Điều kiện trước khi bắt đầu

- Backend Builder đang chạy: `cd apps/builder && npm start`
- `claude` đã đăng nhập, `jq` có trên PATH
- Biết chi phí: **mỗi đề đốt 2–4 turn thật** (~8–13 phút). Đợt 8 đề ≈ 25–30 turn, có thể chạm quota
  giữa chừng — runner tự dừng an toàn (xem §4).

## 1. `plan` — sinh đề

```
/campaign plan "đợt này test mảng kế toán và CS, thử lại nghi vấn lang-sync ①, khoảng 6 đề"
```

- Số đề: ghi trong yêu cầu (hoặc `--n 6`); không ghi thì máy đề xuất từ số trục tìm được và bạn
  chỉnh ở gate.
- Máy đọc CHANGELOG (hành vi mới đổi) + mục để-ngỏ CAMPAIGNS (nghi vấn cần thêm mẫu) + bản đồ phủ,
  giao với yêu cầu của bạn → sinh `docs/prompts/gen/<YYYY-MM-DD-slug>/`:
  - `campaign.yml` — manifest (`status: draft`, version Builder bị ghim tại đây);
  - `G##-*.md` — từng đề đúng giải phẫu CHARTER, đã qua linter chống lộ nghề.
- Kết quả trình cho bạn: bảng {đề × trục × vì sao} + toàn văn đề + ước lượng turn. **Máy DỪNG ở đây.**

## 2. Gate — việc của bạn (quan trọng nhất cả vòng)

Mở `docs/prompts/gen/<id>/`, đọc từng đề như một người sếp đọc yêu cầu của nhân viên:

- Đề có giống việc thật ở công ty bạn không? Không giống → sửa thẳng file hoặc xóa (nhớ xóa cả
  entry trong `campaign.yml`).
- Muốn thêm đề tay? Viết file mới theo giải phẫu 5 mục + thêm entry manifest — file không khai
  trong manifest sẽ KHÔNG được lint và không được chạy.
- Xong thì ra lệnh **"chốt đi"** → máy re-lint bản đã sửa, lật `status: approved`, commit đóng băng.

**Sau chốt KHÔNG sửa đề nữa** (kể cả chính tả) — sửa là `recheck` sau này mất nghĩa so-cùng-đề.

## 3. `run` — chạy nền, bạn đi làm việc khác

```
/campaign run 2026-07-25-ketoan-cs
```

Máy khởi động `campaign-run.sh` chạy **nền**: fire → wait → ghi kết quả → đề kế tiếp. Theo dõi lúc
nào cũng được:

```bash
.venv/bin/python apps/builder/scripts/campaign.py status docs/prompts/gen/<id>/
```

Hai tình huống giữa chừng, đều là hành vi đúng:

| Thấy gì | Nghĩa là | Làm gì |
|---|---|---|
| `🔒 turn busy — chờ 120s` lặp lại | có build khác (thường là build tay) đang giữ turn lock | không cần làm gì — runner tự chờ đến khi lock rảnh |
| `🛑 <đề> lỗi 2 lần liên tiếp — DỪNG CẢ ĐỢT` | retry rồi vẫn lỗi, nghi quota cạn / backend chết — dừng để không đốt các đề còn lại | xử lý nguyên nhân (đợi quota reset / dựng lại backend) rồi **chạy lại chính script** — đề đã xong không chạy lại |

Version lệch (bạn lỡ bump giữa plan và run) → runner từ chối ngay từ `verify`, hỏi bạn retarget
hay hủy. Không có chuyện chạy im lặng trên version khác.

## 4. `report` — chấm và ghi sổ

```
/campaign report 2026-07-25-ketoan-cs
```

Ba tầng, độ tin giảm dần, tầng nào không phủ được thì **nói ra chứ không bỏ im**:

1. **Cơ học** (tất định): 4 linter · comprehension · denied-calls từng phase · lang-sync · model+turn.
2. **Judge** — `/report` chạy trong **subagent context sạch**: judge chỉ thấy đề + artifact, KHÔNG
   thấy mục "Bẫy đã biết" (để chấm như người thật đọc kết quả, không thiên vị).
3. **MANUAL** — các mục máy không chấm được, liệt kê tường minh để bạn làm tay.

Ra: report từng run (`runs/<ngày>-G##-<taskId>.md`) + SUMMARY đợt + một dòng CAMPAIGNS.md +
danh sách finding. Đọc finding nhớ 3 luật:

- nhãn **n=1** = "cần thêm mẫu", không phải "đem đi fix ngay" (tiền lệ: 2/4 chẩn đoán đầu của đợt
  v0.1.0 sai vì vội kết luận từ 1 mẫu);
- **fail hạ tầng** (mạng/quota) không nằm trong tỉ lệ đạt chất lượng;
- so sánh cost/thrash chỉ có nghĩa **cùng model**.

## 5. Bạn fix → `recheck` — khép vòng

Bạn fix finding (máy không tự fix), bump version nếu đáng, rồi:

```
/campaign recheck 2026-07-25-ketoan-cs
```

Máy chạy lại **nguyên văn** các đề đã lộ lỗi trên code mới → bảng trước/sau cùng-đề (mỗi cột ghi
version + model), ghi vào SUMMARY đợt gốc mục "Recheck sau fix". Không mở đợt mới.

## Khắc phục sự cố nhanh

| Triệu chứng | Nguyên nhân thường gặp | Xử lý |
|---|---|---|
| `run` bị từ chối: "status là 'draft'" | chưa chốt gate | ra lệnh chốt (hoặc `campaign.py approve <dir>`) |
| `run` bị từ chối: "version lệch" | bump version sau khi plan | sửa `builder_version` trong manifest (nếu chủ đích test version mới) hoặc bỏ đợt |
| lint báo từ-nghề trong đề bạn viết tay | đề "thơm mùi kỹ sư" | viết lại theo giọng user — xem mẫu P04/P09/P10/P11 |
| runner dừng lỗi kép nhưng quota còn | backend chết / mạng | `npm start` lại rồi chạy lại script |
| muốn hủy build đang chạy giữa đợt | — | `e2e-run.sh cancel <taskId>` rồi chạy lại script (đề đó sẽ được đếm là một attempt) |

## Chạy tay không qua skill (fallback / debug)

Mọi bước đều là lệnh thường — skill chỉ xâu chuỗi chúng:

```bash
PY=.venv/bin/python; C=apps/builder/scripts/campaign.py; D=docs/prompts/gen/<id>
$PY $C lint $D          # charter check
$PY $C approve $D       # gate (sau khi bạn duyệt bằng mắt)
apps/builder/scripts/campaign-run.sh $D          # chạy cả đợt (foreground)
$PY $C status $D        # xem tiến độ / kết quả
```
