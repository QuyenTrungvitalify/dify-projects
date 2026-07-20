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
| **Bằng chứng đo / repro** | số liệu, block lệnh tái hiện | `docs/prompts/runs/CAMPAIGNS.md` (findings / runbook) |
| **Quyết định chốt lúc implement** | open question đã được code trả lời | comment inline tại dòng liên quan — thường ĐÃ có, chỉ cần kiểm |

## 5 câu nghiệm thu — trả lời được KHÔNG CẦN MỞ SPEC thì mới xoá

1. Mỗi **hành vi đã ship** — `docs/state` mô tả nó chưa? (grep keyword phải ra)
2. Mỗi **việc chưa làm** — đã nằm trong mục để-ngỏ của CAMPAIGNS.md chưa?
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
