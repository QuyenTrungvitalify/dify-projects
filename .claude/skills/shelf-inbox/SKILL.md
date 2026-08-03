---
name: shelf-inbox
description: Sweep the team share-inbox (patterns dropped by bản-sạch users via the Builder's Share turn, spec 083) — vet each file with the existing gates, land approved ones on templates/patterns/ with a commit, and journal every decision. Use when the user asks to "quét inbox", review shared patterns, or process the weekly contribution sweep. One file per decision, human-gated.
---

# shelf-inbox — quét kệ đóng góp của team (spec 083 S3)

User bản-sạch bấm Share trong Builder → file rơi vào Drive folder của admin
(`inbox/YYYY-MM/<slug>--<contributor>--<stamp>.yml` + `.meta.json` — receiver ở
[`tools/share_inbox/`](../../../tools/share_inbox/)). Skill này là **cổng người thứ hai**: không
có gì lên kệ chung mà không qua mắt admin. Chạy theo nhịp tuần (hoặc khi được nhờ).

**Tiền đề**: env `SHELF_INBOX_DIR` trỏ tới bản sync local của folder Drive (Google Drive for
Desktop, chỉ cần trên máy admin). Không có env → hỏi user đường dẫn, đừng đoán.

## Procedure

1. **Liệt kê việc**: mọi `"$SHELF_INBOX_DIR"/inbox/*/*.yml` (bỏ qua file đã nằm trong
   `processed/`). Rỗng → báo "inbox sạch" và dừng. Có N file → báo danh sách (slug, contributor,
   tháng) và xử lý **từng file một** theo các bước dưới — không bulk-apply.

2. **Đọc trước khi tin** (per file): đọc `.meta.json` (verdict gate, share-scan, near-dup,
   contributor, hostname) và đọc lướt chính file YAML. Meta là lời khai của máy gửi — bước 3
   kiểm lại độc lập, đừng chỉ tin meta.

3. **Vet lại trên máy admin** (per file, chạy cả ba):

   ```bash
   .venv/bin/python tools/dify_base/promote_gate.py check "<file>" --skip-probe
   .venv/bin/python tools/dify_base/promote_gate.py share-scan "<file>"
   .venv/bin/python tools/dify_base/catalog.py check "<file>" --shelf
   ```

   Tổng hợp: lint 4-linter đỏ → khuyến nghị reject (nêu lý do cụ thể); share-scan có finding →
   liệt kê từng dòng cho admin nhìn; near-dup → nêu match. Kèm nhận xét chất lượng của chính
   Claude (header convention `# Pattern:`/`# Use case:`/`# TODO:`, placeholder đã bóc instance
   chưa — khuôn `test_pattern_consistency`).

4. **Hỏi admin quyết** (per file): *approve / reject / để lại lần sau?* — đợi trả lời, không tự
   quyết.

5. **Approve** →
   - Copy vào `templates/patterns/<slug>.yml` (trùng slug → hỏi: overwrite hay suffix `-2`,
     khuôn collision của promote).
   - `.venv/bin/python tools/dify_base/build_index.py` → rebuild INDEX.
   - Bump số pattern ở **3 docs**: README + AGENTS.md + docs/architecture.md (drift suite pin số
     chính xác — `pytest tests/test_docs_drift.py tests/test_pattern_consistency.py -q` phải
     xanh trước khi commit).
   - Ghi nhật ký: `.venv/bin/python tools/dify_base/catalog.py record "templates/patterns/<slug>.yml"
     --decision promoted --reason "shelf-inbox: từ <contributor>, <tóm tắt 1 dòng>"`.
   - Commit các file trên (message `contrib(shelf-inbox): add pattern <slug> from <contributor>`),
     **hỏi trước khi push**.

6. **Reject** → KHÔNG copy gì; ghi `catalog.py record "<file trong inbox>" --decision rejected
   --reason "<lý do>"`.

7. **Dọn** (mọi quyết định, kể cả reject): move cả `.yml` + `.meta.json` từ `inbox/YYYY-MM/`
   sang `processed/YYYY-MM/` (tạo nếu chưa có) — Drive sync ngược lên, inbox chỉ còn việc chưa
   xử lý. File "để lại lần sau" thì để nguyên chỗ cũ.

8. **Báo cáo cuối**: bảng N file → approved / rejected / deferred, kèm lý do từng dòng, và nhắc
   push nếu có commit chưa push.

## Notes

- Cần `.venv` (scripts/setup.sh). Mọi lệnh chạy từ repo root.
- `--skip-probe` ở bước 3 vì đây là vet nhanh offline; muốn oracle Dify thật cho một file đáng
  ngờ, chạy lại không có cờ đó (cần creds — khuôn template-promote bước gate).
- Đừng sửa nội dung file đóng góp trong lúc vet — cần sửa thì reject kèm lý do, hoặc approve rồi
  sửa như một commit riêng của admin (đổi gì phải thấy được trong diff).
- Quyết định sống ở `collected.json` (qua `catalog.py record`) — nhật ký "đã thấy gì / đã từ chối
  gì" mà các skill khác (scout, nudge) tra cứu; đừng ghi chỗ khác.
