# `docs/specs/` — spec đang mở, và cách ĐÓNG một spec

Spec ở đây là **tạm thời có chủ ý**: nó tồn tại khi việc còn dở, và **bị xoá khi ship xong**.
Nhưng "xoá" không phải `rm` — spec là bảng phân loại tạm của nhiều loại tri thức, và mỗi loại có
đúng **một nhà cố định**. Xoá spec mà chưa mổ nó ra là mất tri thức thật (đã xảy ra: đợt reset
2026-07-17 xoá 77 spec, và 5/5 hành vi spec 071/072 ship ra **không hề có mặt** trong `docs/state`).

> **Đóng spec = chạy skill [`/spec-close <số>`](../../.claude/skills/spec-close/SKILL.md).**
> Không `rm` tay. Skill thực thi đúng quy trình dưới đây và từ chối xoá khi còn mảnh chưa về nhà.

## Bảng "loại tri thức → nhà"

Mỗi section của spec rơi vào một trong các loại sau. Nhà là **duy nhất** — không chép một mảnh vào
hai nơi:

| Loại tri thức | Nhận diện trong spec | Nhà |
|---|---|---|
| **Hành vi đã ship** | slice đã implement, code đang chạy | `docs/state/<doc chủ>` (+ `apps/builder/CHANGELOG.md` nếu campaign quan sát được) |
| **Nguyên tắc còn chi phối tương lai** | "Nguyên tắc thiết kế", non-goal loại *"đừng bao giờ…"* | `docs/state/<doc chủ>` — đây thường là mảnh ĐẮT NHẤT, đừng bỏ sót |
| **Bài học từ thất bại thật** | mục sự cố, "chẩn đoán SAI đã loại", ngõ cụt | `AGENTS.md §9` (định dạng `YYYY-MM-DD: sai gì → luật ngăn được`) |
| **Việc CHƯA làm** | slice chưa ship, open question chưa chốt | `docs/prompts/runs/CAMPAIGNS.md` mục "để ngỏ" |
| **Chờ QUAN SÁT** | "chưa đủ bằng chứng để sửa", "nếu còn tái phát thì…" | [`docs/watch/`](../watch/README.md) — **bắt buộc có `detector`**: một lệnh chạy được trên `apps/builder/.runs/` cho biết nó vừa xảy ra lần nữa |
| **Bằng chứng đo / repro** | số liệu, block lệnh tái hiện | `docs/prompts/runs/CAMPAIGNS.md` (findings / runbook) |
| **Quyết định chốt lúc implement** | open question đã được code trả lời | comment inline tại dòng liên quan — thường ĐÃ có, chỉ cần kiểm |

## 5 câu nghiệm thu — trả lời được KHÔNG CẦN MỞ SPEC thì mới xoá

1. Mỗi **hành vi đã ship** — `docs/state` mô tả nó chưa? (grep keyword phải ra)
2. Mỗi **việc chưa làm** — đã nằm trong mục để-ngỏ của CAMPAIGNS.md chưa?
   (Nếu nó là *"chờ xem có tái phát không"* thì nhà là `docs/watch/`, và **không có detector thì không
   được nhận** — mảnh đó chưa về nhà, spec chưa đóng được.)
3. Mỗi **ngõ cụt / bài học** — AGENTS.md §9 có dòng tương ứng chưa?
4. Mỗi **nguyên tắc còn hiệu lực** — `docs/state` có chưa?
5. **Repro / bằng chứng đo** — CAMPAIGNS.md giữ chưa?

Nguyên tắc khi chuyển nhà: **chưng cất, không chép nguyên văn** — nhà nhận *bất biến* (docs/state
không chứa số đo), spec giữ *diễn biến*. Diễn biến chi tiết vẫn tra được trong git (dưới).

## Tra một spec đã xoá (không phụ thuộc mốc sha nào)

```bash
# liệt kê mọi spec đã xoá + commit xoá nó
git log --diff-filter=D --name-only --format="%h %ad" --date=short -- 'docs/specs/*.md'
# đọc nội dung: <sha>^ = trạng thái NGAY TRƯỚC commit xoá
git show <sha-xoá>^:docs/specs/<file>.md
```

(Đợt retire hàng loạt 2026-07-17 nằm ở `ca5e39e`; spec sinh sau mốc đó tra bằng lệnh trên.)

## Quy ước viết spec mới (để lúc đóng rẻ)

- Cấu trúc section theo đúng các loại ở bảng trên (sự cố / nguyên tắc / slices / repro / non-goals /
  open questions) — spec 071/072 là mẫu tốt.
- Comment trong code sinh ra từ spec phải **tự đủ nghĩa**: số spec chỉ là hậu tố xuất xứ `(spec NNN)`,
  không bao giờ là lời giải thích; **không** viết mã lát cắt (`S3`, `D5`, `r4`) vào code vĩnh viễn —
  spec sẽ bị xoá, mã lát cắt chết ngay lúc gõ.

### Kỷ luật bằng chứng (từ spec 091 — sau chuỗi 071→085 đi lạc vì chẩn đoán không kiểm)

- **Mọi claim trong mục sự-cố/chẩn-đoán mang một nhãn**: `[REPRO]` = có lệnh tái hiện tất định,
  chạy lại được ngay; `[ĐO]` = số đếm nêu rõ nguồn + cỡ mẫu; `[CẬN DƯỚI]` = số bị nghẽn bởi chính
  instrument (chỉ được dùng làm "ít nhất"); `[GIẢ THUYẾT]` = chưa kiểm — **không slice nào được
  xây trên nó**.
- **Chẩn đoán gốc phải có repro tất định hoặc n≥2 run độc lập** — một bundle/một run chỉ đủ cho
  giả thuyết. (090 v1 đổ cho thrash; repro 5-denial-vẫn-chết bác bỏ ngay và đổi cả hướng fix.)
- **Mọi instrument dùng để đo/validate phải HIỆU CHUẨN trước khi tin**: tái hiện được ≥1 ca
  đã-biết-đáp-án dương VÀ bỏ qua ≥1 ca đã-biết-là-nhiễu. Instrument tự viết trong lúc điều tra
  càng phải hiệu chuẩn (091: script audit chưa hiệu chuẩn cho 4 báo động giả và sót đúng lỗi thật).
- **Phép thử đi qua entry-point thật**, không qua hàm con (091: thí nghiệm qua `analyzeBashCommand`
  thay vì `decide()` suýt bác bỏ một fix đúng — `checkForbiddenPath` chạy trước nó).
- **Gate/predicate/suite-entry mới: bắn thử trên artifact thật TRƯỚC khi commit**, và predicate đo
  ARTIFACT chứ không đo lời-tự-khai của model (một entry từng AUTO-FAIL build xanh vì assert
  `analyze.features` — danh sách model tự viết).
- **Test mới phải chứng minh đỏ-khi-revert-fix** (tạm revert, chạy, khôi phục) — không thì là test
  trang trí: hai test từng xanh kể cả khi fix bị gỡ vì chúng assert chính stub của mình.
