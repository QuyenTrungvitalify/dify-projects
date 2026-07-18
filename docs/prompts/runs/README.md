# docs/prompts/runs — Nhật ký chạy kho prompt

Mỗi lần chạy một prompt trong [`docs/prompts/`](../README.md) qua harness `/e2e` sinh **một file
báo cáo** ở đây: `<YYYY-MM-DD>-P##-<taskId>.md` — chứa trọn bộ prompt nguyên văn, timeline, cost
từng phase, thống kê transcript (call/lỗi/bị-chặn), userview + comprehension, chấm theo checklist
của chính file prompt, lỗi gặp phải, và phần MANUAL còn nợ.

Nguồn dữ liệu thô của mỗi run: `apps/builder/.runs/<taskId>/` (gitignored — task.json, report.json,
transcripts/…). Báo cáo ở đây là bản **chưng cất committed**; run dir mất thì báo cáo vẫn còn.

## Chỉ mục

| Ngày | Prompt | taskId | Kết cục | Tổng thời gian | Ghi chú nổi bật |
|---|---|---|---|---|---|
| 2026-07-18 | [P09](2026-07-18-P09-1784350435308.md) vague sales | 1784350435308 | ✅ PASS mạnh | 322.8s | digest biến mơ hồ→3 câu hỏi mở; 0 side-effect thừa |
| 2026-07-18 | [P04](2026-07-18-P04-1784358486934.md) form-routing | 1784358486934 | ⚠️ PASS chất lượng, ③ chậm | 839.0s | webhook 4-nhánh đúng; ③ thrash 522s — **lỗ 071 tái hiện (mẫu 2/2)** |
| 2026-07-18 | [P11](2026-07-18-P11-1784357457370.md) phone-call | 1784357457370 | ⚠️ PASS chất lượng, ③ chậm | 850.9s | trung thực về ranh giới; nhưng webhook thrash 490s → sống-chứng spec 071. Lần 1 fail vì HẾT QUOTA (không phải bug) |

## Điều kiện môi trường chung của đợt 2026-07-18

- Server: `dist` build 2026-07-17 17:13 (mọi fix đã commit tới `c68ef95`; **không** chứa WIP
  `linters.ts`/`post-turn.ts` đang sửa dở — cố ý, để phép đo sạch).
- Skill docs + `--dump-schema` + suite: bản mới nhất (đọc lúc chạy, không cần rebuild).
- `deploy: none` — không app nào được tạo trong Dify; build đáp vào `projects/_drafts/`.
- Mode: `auto` (đi thẳng 4 phase, không dừng gate).
