# P12 — Edit-existing: thêm tính năng vào flow dịch đang có

> **Cần base**: prompt này chỉ có nghĩa khi đã có một workflow dịch trong workspace (vd build từ
> P08, hoặc entry `fast-single-llm` của suite). Bắn kèm `--project <slug>` + chọn workflow, hoặc
> chọn trong UI. Không có base → đây thành test khác (builder xử lý thiếu context ra sao).

```
前に作ってもらった翻訳のフローに機能を足したいです。
訳した英語の文字数もカウントして出してほしいのと、
もし300文字を超えたら、意味を変えずに短くした案も一緒に出すようにしてほしいです。
元の翻訳の動きは変えないでください。
```

## Bối cảnh giả định
User cũ quay lại ("前に作ってもらった") — không nhớ workflow tên gì, chỉ nhớ nó dịch. Yêu cầu mới
+ một ràng buộc vàng: **đừng làm hỏng cái đang chạy**.

## Trục năng lực được thử
Edit-existing (seed local, diff so bản gốc) · thêm node vào graph có sẵn (code đếm ký tự + if-else
>300 + LLM rút gọn) · **bảo toàn hành vi cũ** · cảnh báo duplicate-app khi import lại (spec 014 D7).

## Hình dạng build tốt
- ① đọc seed và tóm đúng flow hiện tại trước khi bàn thay đổi (analyze seed-summary path).
- Diff tối thiểu: node cũ + edges cũ giữ nguyên id; chỉ thêm code(count) → if-else(>300) →
  LLM(shorten) → gộp output. Đổi id cũ / viết lại prompt dịch = vi phạm 「元の動きは変えない」.
- Đếm ký tự bằng **code node** (đếm là việc của máy, không phải LLM).
- Note nhắc: import lại tạo app MỚI trong Dify (duplicate warning) — user cũ dễ tưởng update đè.

## Bẫy đã biết
Edit mà rebuild from scratch (mất tính bảo toàn) · quên fast-mode bị force-off cho edit (đúng
thiết kế) · 300 ký tự hay 300 từ? — digest nên xác nhận cách hiểu (文字数 = ký tự).

## MANUAL dự kiến
So diff bằng mắt: phần cũ có bị đụng không · dịch một đoạn <300 và một đoạn >300 xem nhánh rút gọn
chỉ chạy đúng ca sau.
