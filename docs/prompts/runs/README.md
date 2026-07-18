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
| 2026-07-18 | [P01](2026-07-18-P01-1784359444404.md) news-pipeline | 1784359444404 | ✅ PASS mạnh | 655.8s | honesty phạm vi tốt; plugin hash thật; **đối chứng A/B cho 071** |

| 2026-07-18 | [P03](2026-07-18-P03-1784361257820.md) morning-news | 1784361257820 | ✅ PASS mạnh | 518.1s | weekday+timezone+dedup-state đều đúng; schedule sạch (0 denied) |

| 2026-07-18 | [P06](2026-07-18-P06-1784361880397.md) rag-chatbot | 1784361880397 | ✅ PASS mạnh | — | advanced-chat mode, dataset không bịa, nhánh từ chối |
| 2026-07-18 | [P10](2026-07-18-P10-1784362368139.md) contract-VI | 1784362368139 | ✅ PASS mạnh | — | lang-sync VI cả digest+SPEC; disclaimer giữ |

| 2026-07-18 | [P02](2026-07-18-P02-1784375098683.md) screenshot-OCR | 1784375098683 | ✅ PASS mạnh | — | vision LLM + file-list + cấm bịa URL |
| 2026-07-18 | [P05](2026-07-18-P05-1784375623443.md) invoice-reconcile | 1784375623443 | ❌ **DEFECT** | — | ② hỏi thay vì viết SPEC.md (auto mode) |
| 2026-07-18 | P07 minutes-to-docs | 1784379467247 | ⚠️ lỗi mạng | — | API connection closed; lộ marketplace.py bị chặn (071 S5) |
| 2026-07-18 | [P08](2026-07-18-P08-1784380142492.md) glossary-translate | 1784380142492 | ✅ PASS mạnh | — | 2 bước tự soát + 3 output đúng |
| 2026-07-18 | [P12](2026-07-18-P12-1784380636506.md) edit-existing | 1784380636506 | ⚠️ 2 vấn đề | — | ① digest EN cho prompt JA; harness thiếu --workflow |

**→ [Tổng kết đợt 2026-07-18](2026-07-18-SUMMARY.md)** — **7/7 build đạt chất lượng**; lỗ hiệu năng duy nhất = webhook (071), 5 mẫu sạch vs 2 thrash.

## Điều kiện môi trường chung của đợt 2026-07-18

- Server: `dist` build 2026-07-17 17:13 (mọi fix đã commit tới `c68ef95`; **không** chứa WIP
  `linters.ts`/`post-turn.ts` đang sửa dở — cố ý, để phép đo sạch).
- Skill docs + `--dump-schema` + suite: bản mới nhất (đọc lúc chạy, không cần rebuild).
- `deploy: none` — không app nào được tạo trong Dify; build đáp vào `projects/_drafts/`.
- Mode: `auto` (đi thẳng 4 phase, không dừng gate).
