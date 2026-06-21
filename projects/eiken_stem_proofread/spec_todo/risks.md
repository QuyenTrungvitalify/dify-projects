# Risk Analysis — `workflows/main.yml`

Last updated: 2026-05-19

Liệt kê toàn bộ risk phát hiện được khi review workflow. Severity sắp theo mức độ impact lên data correctness và UX.

---

## 🔴 HIGH — Risk làm SAI DATA mà không crash (nguy hiểm nhất)

### #1. Index-based matching DeepL response ⚠️ **MOST CRITICAL**

**Location**: [main.yml:681-687](../workflows/main.yml#L681-L687)

```python
for idx, it in enumerate(items):
    if idx < len(improvements) and isinstance(improvements[idx], dict):
        it["proofread"] = improvements[idx].get("text", it["fulltext"])
```

**Risk**: Code giả định DeepL trả response **đúng thứ tự** input. Nếu DeepL:
- Drop 1 text bị invalid → tất cả index từ đó lệch 1 → **wrong proofread gán cho wrong row**
- Reorder vì optimization batch → 40 row đều sai
- Trả thiếu (39 thay vì 40) → row cuối mất proofread mà KH không biết

**Impact**: Silent corruption — KH cầm CSV thấy text "校閲 OK" nhưng thực ra là proofread của câu khác. Rất khó phát hiện.

**Fix proposed**:
- Option A: DeepL có thể trả `id` field cho mỗi text → match theo id thay vì index (verify spec)
- Option B: Tự gắn ID vào text trước khi gửi (`"[#1] I went..."`) rồi strip + match khi parse response
- Option C: Verify length response == request, nếu không match → fail batch + log

**Effort**: Medium
**Status**: TODO — must fix before prod

---

### #2. Excel cell chứa `|` làm vỡ Markdown table parse

**Location**: Parser tại [main.yml:285](../workflows/main.yml#L285)

**Risk**: Document Extractor convert Excel → Markdown table dùng `|` làm separator. Nếu cell Excel chứa `|` (vd: stem `"Choose A | B | C"`):

```
| 1 | E2-001 | Choose A | B | C | yesterday | went | go | going | gone |
```

→ Parser split theo `|` → **lệch cột**, items bị shift. Hậu quả: `stem` chứa fragment của choices, `correct` parse từ ô sai → câu sai hoàn toàn.

**Impact**: Silent data corruption cho câu cụ thể có `|`.

**Fix proposed**:
- Option A: Force input format = CSV (KH save Excel as CSV trước khi upload). Nhược: ít linh hoạt.
- Option B: Detect cell có `|` trước, warning + skip câu đó.
- Option C: Document Extractor có thể có config dùng separator khác (TSV) — kiểm tra Dify settings.

**Effort**: Low
**Status**: TODO — must fix before prod

---

### #3. Full-width chars + special chars trong cell

**Risk**: Excel Nhật thường có:
- 改行 (alt+enter) trong cell → Document Extractor convert thành `<br/>` hoặc literal `\n` → code clean ([main.yml:269](../workflows/main.yml#L269)) chỉ handle 3 dạng `<br>`. Nếu Extractor dùng dạng khác (vd `<br class="...">`) → text bị giữ nguyên HTML.
- 全角 quotes `"` `"` → có thể làm CSV writer escape sai.
- Tab characters trong cell → CSV writer giữ nguyên nhưng Excel hiển thị lạ.

**Fix proposed**: Mở rộng `clean()` function với regex `r"<br[^>]*/?>"` + normalize full-width punctuation.

**Effort**: Low
**Status**: TODO — should fix

---

### #4. `int(correct_raw)` crash mềm khi format khác

**Location**: [main.yml:319-320](../workflows/main.yml#L319-L320)

```python
correct_raw = clean(row.get("Correct Answer Number"))
correct = int(correct_raw) if correct_raw.isdigit() else 0
```

**Risk**: Nếu Excel ghi:
- `"1."` (Excel auto format số) → `isdigit()` False → correct = 0 → **không câu nào được mark `is_correct`**
- `"①"` (full-width 1) → False → 0
- `"A"` (chữ thay số) → False → 0
- `"1,2"` (multi-correct) → False → 0

KH thấy cột "Is Correct" toàn rỗng mà không có warning.

**Fix proposed**:
```python
import re
def parse_correct(raw):
    raw = raw.strip().rstrip(".")
    # Full-width digit → half-width
    raw = raw.translate(str.maketrans("０１２３４５６７８９①②③④", "01234567891234"))
    m = re.search(r"\d+", raw)
    return int(m.group()) if m else 0
```

**Effort**: Low
**Status**: TODO — should fix

---

### #5. Choices có thể < 4 hoặc > 4 → silent drop

**Location**: [main.yml:313-318](../workflows/main.yml#L313-L318) hard-code lấy 4 choice.

**Risk**:
- Nếu Excel có câu chỉ 3 choice → `row.get("Answer Choice 4")` = None → fulltext có placeholder thay bằng `""` → vô nghĩa nhưng không crash.
- Ngược lại nếu có 5+ choices → choice thứ 5 bị **silently dropped**.

**Fix proposed**: Loop dynamic dò column `"Answer Choice N"` từ N=1 đến hết, không hard-code N=4.

**Effort**: Low
**Status**: TODO — should fix

---

### #6. Hard-coded PLACEHOLDER = "(          )" (exactly 10 spaces)

**Location**: [main.yml:262](../workflows/main.yml#L262) và [main.yml:430](../workflows/main.yml#L430)

**Risk**: Workflow fail silent với data có placeholder format khác (1 space, full-width parens, underscores, ...).

**Chi tiết & 3 option giải pháp**: xem [placeholder_fix.md](placeholder_fix.md)

**Status**: TODO — must fix, recommend Option A (regex)

---

## 🟡 MEDIUM — Risk operational / UX

### #7. DeepL request size limit chưa biết

**Risk**: Mỗi batch gửi **40 text trong 1 request**. DeepL Write API có thể có giới hạn:
- Max request body size (vd 128KB)
- Max array length (vd 50 items)
- Max chars total per request

Nếu vượt giới hạn → 413/400 → fallback `[API_ERROR_413]` cho cả batch 40 row.

**Fix proposed**: Sau khi có spec, tính max safe batch size. Nếu DeepL limit thấp → giảm BATCH_SIZE từ 10 xuống 5.

**Effort**: Low (chỉ thay constant)
**Status**: BLOCKED — chờ spec DeepL (xem [deepl_spec_questions.md](deepl_spec_questions.md))

---

### #8. Hard-code `target_lang: "EN-US"`, không có `source_lang`

**Location**: [main.yml:583](../workflows/main.yml#L583)

**Risk**: Eiken hiện là EN→EN proofread, OK. Nhưng:
- Nếu cell chứa text Nhật (vd hướng dẫn câu hỏi tiếng Nhật trộn lẫn) → DeepL có thể detect ngôn ngữ nhầm và convert thành text Anh hoàn toàn.
- Không declare `source_lang: "EN"` → DeepL auto-detect → đôi khi sai.

**Fix proposed**: Add `"source_lang": "EN"` vào payload (verify spec).

**Status**: BLOCKED — chờ spec DeepL

---

### #9. Multi-sheet xlsx — chỉ extract sheet đầu tiên

**Risk**: Document Extractor mặc định chỉ lấy sheet 1. Nếu KH gửi file có:
- Sheet 1: instructions
- Sheet 2: actual 84 questions

→ Workflow extract sheet 1 → parse không ra question nào → output CSV rỗng. Không có warning.

**Fix proposed**:
- Option A: Thêm validation Code node sau parser, nếu `item_count == 0` → fail rõ ràng với message "no questions detected — check Excel sheet structure".
- Option B: Note rõ trong README và Start node hint.

**Status**: TODO — should fix

---

### #10. Workflow timeout với DeepL chậm

**Risk**: Iteration `continue-on-error` + HTTP timeout 60s + retry 2× = worst case 1 batch ~3 phút. Dify workflow có **default timeout cho toàn workflow** (thường 5-15 phút tuỳ plan). Nếu 9 batch đều slow → có thể timeout trước khi xong.

**Fix proposed**: Monitor + tăng workflow timeout trong Dify settings, hoặc giảm retry/timeout HTTP.

**Status**: Monitor, tune sau khi có production data

---

### #11. md_exporter plugin không pin filename → ghi đè

**Location**: [main.yml:851](../workflows/main.yml#L851)

```yaml
output_filename: eiken_proofread
```

**Risk**: Mỗi lần run đều ra file tên `eiken_proofread.csv`. Nếu KH run nhiều lần, file sau có thể ghi đè file trước trong Dify storage.

**Fix proposed**: Append timestamp via Dify template:
```yaml
output_filename: eiken_proofread_{{sys.workflow_run_id}}
```

**Effort**: Trivial
**Status**: TODO — quick win

---

### #12. `md_escape` làm mất newline trong proofread

**Location**: [main.yml:759](../workflows/main.yml#L759)

```python
return s.replace("|", "\\|").replace("\n", " ").replace("\r", " ")
```

**Risk**: Nếu DeepL trả proofread có newline (multi-line suggestion) → bị flatten thành 1 line với space. KH mất formatting gốc.

**Fix proposed**: Thay `\n` bằng `<br>` trong Markdown, md_exporter có thể respect (verify plugin behavior).

**Status**: TODO — should fix nếu DeepL trả multi-line

---

### #13. `csv_text` build xong nhưng không expose

**Location**: [main.yml:808](../workflows/main.yml#L808) build `csv_text` (có BOM đẹp) nhưng End node **không output** field này.

**Risk**: Nếu plugin md_exporter generate CSV với encoding/BOM khác → KH mở Excel có thể bị mojibake mà mình không kiểm soát được.

**Fix proposed**: Expose `csv_text` ra End như backup string output, hoặc verify md_exporter có BOM UTF-8.

**Effort**: Trivial
**Status**: TODO — quick win

---

## 🟢 LOW — Nice-to-have / edge case

### #14. Hard-code BATCH_SIZE = 10

Không config được. Nếu DeepL spec ra rate limit thấp → phải sửa code rebuild workflow.

**Fix**: Move BATCH_SIZE thành Start node input (number, default 10).

**Status**: TODO — quick win

---

### #15. `parallel_nums = 2` hard-code

Tương tự #14, không config qua Start input. Iteration node hiện không support biến cho `parallel_nums` (Dify limitation).

**Status**: Verify Dify version mới có support không.

---

### #16. api_errors = 0 không có nghĩa là success thật

**Risk**: Nếu chạy `mode = mock` → mọi row đều `api_ok = True` → `api_errors = 0`. KH nhìn metric "0 errors" có thể tưởng DeepL chạy OK.

**Fix proposed**: Thêm output `mode_used: "mock" | "deepl"` ở End để KH biết chính xác mode nào đã chạy.

**Effort**: Trivial
**Status**: TODO — quick win

---

### #17. `skipped_items` là JSON string, KH khó đọc

**Location**: [main.yml:922-924](../workflows/main.yml#L922-L924)

**Risk**: KH xem trong Dify UI thấy `'[{"row_no": "5", "item_id": "E2-005", ...}, ...]'` — phải copy ra parser JSON mới đọc được.

**Fix proposed**: Format thành Markdown list trong node "10問づつバッチ分割":
```python
skipped_md = "\n".join(f"- Row {s['row_no']}: {s['item_id']} — {s['stem'][:50]}..." for s in skipped)
```

**Status**: TODO — should fix for UX

---

### #18. File security & confidentiality 🔒

**Risk**: Excel chứa Eiken question stem → có thể là **nội dung đề thi chưa publish**. Workflow gửi text tới:
- Dify storage (Dify cloud nếu dùng SaaS)
- DeepL servers (data có thể bị log theo DeepL Terms — kiểm tra DeepL Pro contract về data retention)

**Status**: BLOCKED — cần confirm với KH (xem [customer_confirm.md](customer_confirm.md))

---

### #19. File upload extension không cover `.xlsm`

**Location**: [main.yml:202-205](../workflows/main.yml#L202-L205)

**Fix proposed**: Thêm `.xlsm` vào `allowed_file_extensions` nếu KH dùng template có macro.

**Status**: Confirm với KH

---

### #20. Choice text trùng PLACEHOLDER

**Risk**: Nếu choice 1 là `"(          )"` (rỗng, hợp lý trong fill-in-the-blank đôi khi) → fulltext thành stem rỗng → DeepL校閲 ra kết quả vô nghĩa.

**Status**: Edge case — low priority, monitor

---

### #21. Mode = "deepl" khi URL chưa fill → confusion

**Risk**: Hiện URL là `<<< FILL: e.g. https://api.deepl.com/v2/write >>>`. Nếu KH vô tình chọn `mode=deepl` → HTTP node sẽ fail với error rất khó debug ("invalid URL"). Không có guard.

**Fix proposed**: Thêm validation Code node sau if-else true: check URL không chứa `<<<` → fail fast với error message rõ. Hoặc set default `mode=mock` và disable option `deepl` cho đến khi spec ready.

**Status**: TODO — defensive guard

---

## 📊 Priority Matrix

| # | Risk | Severity | Effort | Recommend Phase |
|---|------|----------|--------|-----------------|
| 1 | Index-based matching DeepL | 🔴 High | Medium | **Phase 1.5 — MUST FIX** |
| 2 | `|` trong cell vỡ Markdown table | 🔴 High | Low | **Phase 1.5 — MUST FIX** |
| 6 | PLACEHOLDER format | 🔴 High | Low | **Phase 1.5 — MUST FIX** |
| 4 | `correct` parsing format khác | 🔴 High | Low | Phase 1.5 — Should fix |
| 5 | Choices < 4 hoặc > 4 | 🔴 Medium | Low | Phase 1.5 — Should fix |
| 3 | Full-width chars / `<br>` variants | 🟡 Medium | Low | Phase 1.5 |
| 9 | Multi-sheet xlsx validation | 🟡 Medium | Low | Phase 1.5 |
| 11 | md_exporter ghi đè filename | 🟡 Medium | Trivial | Phase 1.5 — Quick win |
| 13 | csv_text không expose | 🟡 Medium | Trivial | Phase 1.5 — Quick win |
| 16 | mode_used không trả về | 🟢 Low | Trivial | Phase 1.5 — Quick win |
| 17 | skipped_items khó đọc | 🟢 Low | Low | Phase 1.5 — Quick win |
| 12 | md_escape mất newline | 🟡 Medium | Low | Phase 2 (sau khi thấy DeepL response thật) |
| 7 | DeepL request size limit | 🟡 Medium | Low | Phase 2 — chờ spec |
| 8 | source_lang | 🟡 Medium | Trivial | Phase 2 — chờ spec |
| 10 | Workflow timeout | 🟡 Medium | Trivial | Phase 2 — monitor |
| 21 | URL chưa fill guard | 🟢 Low | Low | Phase 1.5 |
| 14 | BATCH_SIZE hard-code | 🟢 Low | Trivial | Phase 2+ |
| 15 | parallel_nums hard-code | 🟢 Low | N/A | Future (Dify limitation) |
| 18 | Confidentiality | 🟢 Critical (business) | High (legal) | **BLOCKER — confirm KH** |
| 19 | `.xlsm` extension | 🟢 Low | Trivial | Confirm KH |
| 20 | Choice = PLACEHOLDER | 🟢 Low | Low | Monitor |
