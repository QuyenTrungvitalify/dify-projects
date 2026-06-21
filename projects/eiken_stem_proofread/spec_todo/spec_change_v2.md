# Spec Change v2 — Customer Update

**Initial date**: 2026-05-19
**Final decisions locked**: 2026-05-21
**Last updated**: 2026-06-02 (output row policy reversed — see §Update)
**Status**: ✅ Implemented

---

## 🔄 Update 2026-06-02 — Output row policy reversed

**Trigger**: KH chạy thử workflow trên file thật, output chỉ thấy 2 row (cả 2 đều có lỗi).
Mong đợi: file XLSX chứa **mọi câu hợp lệ**, cột Errors chỉ có nội dung khi câu thực sự có lỗi.

**Diff vs spec gốc (2026-05-21)**:

| Phần | Trước (2026-05-21) | Sau (2026-06-02) |
|------|--------------------|--------------------|
| Mục 4 "Original spec" | "Output filter: chỉ output câu có lỗi (`len(matches) > 0`)" | "Output mọi câu hợp lệ. Câu không lỗi: Errors rỗng, Error Count = 0, Fixed (clean) = Original" |
| `LT 統合` (Free/Premium) | `if not matches: return {"output": ""}` → drop row | Luôn emit JSON. No-matches → `fixed=fulltext`, `errors=""`, `count=0` |
| `LONG TABLE出力生成` | `if not raw: continue` filter "no-errors" sentinel | Chuyển thành safety net cho iteration failures only |
| `データ正規化` (no-placeholder drop) | Drop row data defect | **Không đổi** — vẫn drop, vẫn báo cáo qua `skipped_items` |

**Unchanged**:
- Row không có `(          )` placeholder vẫn bị drop ở `データ正規化` (data defect, không phải proofread issue) → report qua `skipped_items` output để KH biết
- `row_count` ở End node giờ = số câu hợp lệ output (≤ `total_items`, có thể > số câu có lỗi)
- `api_error_count` không đổi semantics — vẫn đếm rows mà HTTP gọi LT fail

**Updated example table** (mục 📊 Output Format Detail bên dưới):

| # | Item ID | Original | Fixed (clean) | Errors | Error Count |
|---|---------|----------|---------------|--------|-------------|
| 1 | E2-001 | I dont to read from a paper. | I don't to read from a paper. | dont → don't (grammar) | 1 |
| 2 | E2-002 | She have a apple yesterday. | She has an apple yesterday. | have → has (grammar); a → an (grammar) | 2 |
| 3 | E2-003 | He is very happy. | He is very happy. | _(empty)_ | 0 |
| 4 | E2-004 | They went to school. | They went to school. | _(empty)_ | 0 |

Row 3 & 4: stem hợp lệ, không lỗi → vẫn xuất hiện trong file.

**KH workflow tip**: Để xem nhanh chỉ những câu cần sửa, dùng Excel filter trên cột `Error Count` (>0) hoặc conditional formatting trên cột `Errors` (not empty).

---

## 🎯 Final Decisions Summary

KH đã chốt (2026-05-21):

| # | Decision | Choice | Note |
|---|----------|--------|------|
| 1 | **API** | LanguageTool | Verified 2026-05-19. Endpoint chung cho cả 2 tier: `api.languagetoolplus.com/v2/check` |
| 2 | **Performance strategy** | **Option 1 — Per-request** (~60s với Premium, ~5 phút với Free) | KH OK chờ 1 phút |
| 3 | **Tier mode** | **2-mode: `free` \| `premium`** với placeholder env vars | KH dự định subscribe Premium. Test với Free trước, swap mode khi có key. |
| 4 | **Output format** | **Y1 — XLSX/CSV multi-column** (no inline highlight) | Visual highlight không feasible với plugin/sandbox hiện tại |
| 5 | **File type cụ thể** | Default **XLSX** (`md_to_xlsx`) | KH có thể switch CSV nếu cần |
| 6 | **Highlight strategy** | Multi-column structure, KH apply Excel conditional formatting nếu cần | Setup 1 lần, auto cho file sau |

### ⚠️ Compliance warning (Japanese)

Free mode **chỉ dùng test/dev** — ToS LanguageTool cấm automated requests trên free tier. Production phải Premium. Warning text dùng trong workflow:

```
⚠️ Free モードはテスト・開発専用です。
LanguageTool 利用規約により Free プランでの自動リクエストは禁止されています。
本番運用には Premium プランの契約が必要です（環境変数 LT_USERNAME と LT_API_KEY を設定後、Premium モードに切替えてください）。
```

**Pending KH confirm** (không blocker, có default):
- Language code (default `en-GB`)
- Confidence threshold (default `≥0.5`)
- Issue types filter (default keep all: grammar/misspelling/typographical/style)
- Skipped items handling (default report vào `skipped_items` output)
- Premium tier (Starter 100/day, Basic 250/day, Pro 500/day, ...) — KH chọn theo volume run/ngày
- Multi-line stem format (default join với `\n` natively, LT handles fine)

---

## 📋 Spec mới từ KH (6 điểm)

### Original spec (2026-05-19)

1. **Stem fill**: Chỉ dùng `Correct Answer Number` để chọn 1 choice → tạo **1 fulltext** (không phải 4)
2. **No placeholder = data defect**: Xoá khỏi processing (không output stem-as-is)
3. **API change**: DeepL → **LanguageTool**
4. ~~**Output filter**: Chỉ output câu có lỗi (`len(matches) > 0`) → câu không lỗi không xuất~~ — **revised 2026-06-02**: output mọi câu hợp lệ; câu không lỗi vẫn xuất với Errors rỗng + Error Count = 0. Xem §Update ở đầu file.

### Clarifications (2026-05-19)

5. **Stem multi-line dialog**: format A:/B: với newline giữa các dòng
   ```
   A: How are you going to prepare for your history presentation?
   B: I'm going to learn the speech (          ). I don't want to read from a paper.
   ```
   → Code hiện tại đã handle `\n` đúng (qua `clean()` function). LT support multi-line natively.

6. **Highlight visual yêu cầu** (originally): KH muốn "bôi đỏ/gạch chân" như Word/Grammarly.
   - **Final outcome**: Pivot sang multi-column structure (Y1) vì không có path khả thi cho inline format trong XLSX/CSV.

---

## 🔄 Implementation Plan (Option 1 + Y1 + 2-mode)

### Architecture diagram

```
TRƯỚC (current DeepL skeleton):
Start (file + mode=[mock|deepl]) → Doc Extractor → 10問づつバッチ分割 → Iteration [parallel=2, 9 batches]
  ├─ バッチ展開 (1→40 fulltext, 4 choices each)
  ├─ if-else mode
  ├─ MOCK | (DeepL構築 → HTTP → 統合) → aggregator
→ LONG CSV (13 cols, 336 rows) → md_to_csv → End (csv_file)

SAU (Option 1 + Y1 + 2-mode):
Start (file + mode=[free|premium]) → Doc Extractor → データ正規化 → Iteration [parallel=1, 84 items]
  ├─ if-else mode (free | premium)
  ├─[free]    LT HTTP GET (no auth, retry 8×10s) → LT 統合
  ├─[premium] LT HTTP GET (auth via env vars, retry 4×5s) → LT 統合
  └─ ブランチ統合 (aggregator)
→ LONG TABLE (6 cols, ≤84 rows) → md_to_xlsx → End (xlsx_file)
```

**Key changes vs current**:
- ✅ Replace MOCK branch → real `free` LT call (no auth)
- ✅ Replace DeepL branch → real `premium` LT call (with auth)
- ✅ Iteration unit = 1 stem (per-question), bỏ batch concept
- ✅ Bỏ node `バッチ展開` (logic move lên データ正規化)
- ✅ Bỏ node `DeepL リクエスト構築` (GET URL template đủ)
- ✅ Giữ if-else + aggregator pattern (familiar architecture)
- ✅ Cùng endpoint `api.languagetoolplus.com/v2/check` cho cả 2 branches — chỉ khác auth params

### Impact Map — chi tiết từng node

| # | Node hiện tại | Action | Change details |
|---|--------------|--------|----------------|
| 1 | `Start` [main.yml:196](../workflows/main.yml#L196) | 🟡 Modify | Rename mode options: `mock|deepl` → **`free|premium`** (default `free`). Update hint text với Japanese ToS warning. |
| 2 | `テキスト抽出` (Doc Extractor) | ⏸️ No change | Giữ nguyên |
| 3 | `10問づつバッチ分割` [main.yml:251](../workflows/main.yml#L251) | 🔴 Rewrite + rename → `データ正規化` | **Output thay đổi**: thay vì 9 batches × 10 items, output **84 items × 1 item** (`array[string]`, mỗi phần tử = JSON 1 câu). Logic: parse + **filter no-placeholder** + **pre-compute fulltext** từ `choices[correct-1]` |
| 4 | `バッチ校閲イテレーション` [main.yml:377](../workflows/main.yml#L377) | 🟡 Modify | `parallel_nums: 2 → 1` (tôn trọng rate limit cả Free và Premium). `iterator_input_type` vẫn `array[string]` |
| 5 | `バッチ展開` [main.yml:419](../workflows/main.yml#L419) | ❌ **DELETE** | Logic đã move lên node 3 (pre-compute fulltext). Không cần expand vì 1 iteration = 1 câu. |
| 6 | `モード分岐` (if-else) [main.yml:492](../workflows/main.yml#L492) | 🟡 Modify | Condition: `mode is "premium"` (true branch). Giữ pattern |
| 7 | `MOCK 校閲` [main.yml:526](../workflows/main.yml#L526) | 🔴 Replace → **`LT Free HTTP`** | Thay node Code MOCK bằng HTTP node gọi LT (không auth). URL: `https://api.languagetoolplus.com/v2/check?text={{url_encode(fulltext)}}&language=en-GB`. Retry: 8×10s. Theo sau là Code node parse response. |
| 8 | `DeepL リクエスト構築` [main.yml:565](../workflows/main.yml#L565) | ❌ **DELETE** | GET method, URL template đủ rồi |
| 9 | `DeepL Write API` [main.yml:606](../workflows/main.yml#L606) | 🔴 Reconfigure → **`LT Premium HTTP`** | Method `POST → GET`. URL: `https://api.languagetoolplus.com/v2/check?text={{url_encode(fulltext)}}&language=en-GB&username={{#env.LT_USERNAME#}}&apiKey={{#env.LT_API_KEY#}}`. Retry: 4×5s. |
| 10 | `DeepL レスポンス統合` [main.yml:649](../workflows/main.yml#L649) | 🔴 Rewrite → **`LT 統合`** (used by both branches) | Parse `matches[]`. Filter `confidence < 0.5`. Build `Fixed (clean)` + `Errors detail` từ replacements. **Revised 2026-06-02**: ~~nếu `len(matches) == 0` → drop row~~ → always emit JSON. No-matches → `fixed = fulltext`, `errors = ""`, `count = 0`. **Note**: cùng code logic dùng cho cả Free và Premium response — tạo 2 instance (Free parse + Premium parse) hoặc share 1 node nếu Dify support. |
| 10b | **NEW Code node** `LT Free 統合` | 🆕 **CREATE** | Same logic as #10. Sub-node trong Free branch để parse Free HTTP response. |
| 11 | `ブランチ統合` (aggregator) | ⏸️ No change | Merge `batch_results` từ Free hoặc Premium branch |
| 12 | `LONG CSV出力生成` [main.yml:737](../workflows/main.yml#L737) | 🔴 Rewrite → `LONG TABLE出力生成` | **Y1 design**: 6-col markdown table (#, Item ID, Original, Fixed (clean), Errors, Error Count). Build từ batch_results đã filter. |
| 13 | `CSV変換` [main.yml:829](../workflows/main.yml#L829) | 🟡 Modify | `tool_name: md_to_csv → md_to_xlsx`. `output_filename: eiken_proofread` |
| 14 | `出力` (End) [main.yml:907](../workflows/main.yml#L907) | 🟡 Modify | Rename output variable: `csv_file → xlsx_file` |
| 15 | `dependencies` | ⏸️ No change | Cùng plugin `bowenliang123/md_exporter` (đổi tool name only) |
| 16 | `environment_variables` | 🔴 Rewrite | **Replace** `DEEPL_API_KEY` với **`LT_USERNAME` + `LT_API_KEY`** (cả 2 Secret type, default empty). Free mode chạy không cần fill. Premium mode cần fill 2 vars. |

→ Tổng: **10 nodes thay đổi**, **2 nodes xoá**, **1 node tạo mới**, 5 nodes giữ nguyên.

---

## 📊 Output Format Detail (Y1)

### 6-column structure

**Revised 2026-06-02**: Mọi câu hợp lệ đều xuất, kể cả câu không lỗi (Errors rỗng, Error Count = 0).

| # | Item ID | Original | Fixed (clean) | Errors | Error Count |
|---|---------|----------|---------------|--------|-------------|
| 1 | E2-001 | I dont to read from a paper. | I don't to read from a paper. | dont → don't (grammar) | 1 |
| 2 | E2-002 | She have a apple yesterday. | She has an apple yesterday. | have → has (grammar); a → an (grammar) | 2 |
| 3 | E2-003 | He is very happy. | He is very happy. | _(empty)_ | 0 |
| 4 | E2-004 | They went to school. | They went to school. | _(empty)_ | 0 |

### Column sources (100% deterministic từ LT API, không cần LLM)

| Column | Source | Logic |
|--------|--------|-------|
| `#` | sequential | Counter |
| `Item ID` | input Excel | Pass-through từ Excel |
| `Original` | input + fill | Stem sau khi fill `choices[correct-1]` vào placeholder |
| `Fixed (clean)` | apply LT suggestions | Sort matches by offset DESC, replace `text[offset:offset+length]` với `replacements[0].value` |
| `Errors` | LT matches | Concat `f"{original_word} → {replacements[0].value} ({rule.issueType})"` cho mỗi match |
| `Error Count` | `len(matches)` | Number of issues detected |

### Code snippets — Y1 implementation

#### Build `Errors` column
```python
def build_errors_column(fulltext, matches):
    """Build 'word1 → suggest1 (type1); word2 → suggest2 (type2)'"""
    if not matches:
        return ""
    parts = []
    for m in matches:
        original_word = fulltext[m["offset"]:m["offset"] + m["length"]]
        suggestion = m["replacements"][0]["value"] if m["replacements"] else "(no suggestion)"
        issue_type = m["rule"]["issueType"]
        parts.append(f"{original_word} → {suggestion} ({issue_type})")
    return "; ".join(parts)
```

#### Build `Fixed (clean)` column
```python
def build_fixed_text(fulltext, matches):
    """Apply all suggestions → clean corrected text.
    CRITICAL: sort by offset DESC để không lệch position khi replace."""
    matches_sorted = sorted(matches, key=lambda m: m["offset"], reverse=True)
    result = fulltext
    for m in matches_sorted:
        if not m["replacements"]:
            continue
        start = m["offset"]
        end = start + m["length"]
        result = result[:start] + m["replacements"][0]["value"] + result[end:]
    return result
```

#### Filter response (revised 2026-06-02)
```python
def parse_lt_response(fulltext, response_body, status_code, confidence_threshold=0.5):
    """Parse LT response, filter low confidence, always return an item.
    No-error rows are kept with empty errors and count=0 (revised 2026-06-02)."""
    if status_code != 200:
        return {"fulltext": fulltext, "fixed": fulltext, "errors": f"[API_ERROR_{status_code}]", "count": 0, "api_ok": False}

    data = json.loads(response_body)
    matches = data.get("matches", [])

    # Filter by confidence
    matches = [m for m in matches if m["rule"].get("confidence", 1.0) >= confidence_threshold]

    return {
        "fulltext": fulltext,
        "fixed": build_fixed_text(fulltext, matches) if matches else fulltext,
        "errors": build_errors_column(fulltext, matches) if matches else "",
        "count": len(matches),
        "api_ok": True,
    }
```

### KH conditional formatting (optional, KH tự setup trong Excel)

Nếu KH muốn visual highlight, setup 1 lần trong Excel:
1. Select cột `Errors`
2. Home → Conditional Formatting → New Rule
3. "Format only cells that contain" → "not empty" → format: background red, bold
4. → Mọi row có lỗi tự động highlight đỏ. File sau cũng auto apply.

---

## ⚙️ Configuration parameters

### Environment variables (Dify Studio → Settings)

```yaml
environment_variables:
  - name: LT_USERNAME
    type: Secret
    default: ""              # ← Empty OK. Free mode không cần fill.
    description: "LanguageTool Premium account email. Required khi mode=premium."

  - name: LT_API_KEY
    type: Secret
    default: ""              # ← Empty OK. Free mode không cần fill.
    description: "LanguageTool Premium API key (lấy từ Premium account dashboard). Required khi mode=premium."
```

→ KH có thể import workflow và chạy Free mode ngay mà **không cần fill env vars**. Khi subscribe Premium → fill 2 vars → switch mode dropdown sang `premium`.

### Start node — variables

```yaml
variables:
- variable: input_file
  type: file-list
  allowed_file_extensions: [.xlsx, .xls, .csv]
  required: true
  hint: "Excel ファイル (.xlsx/.xls) または CSV をアップロードしてください（最大100問）"

- variable: mode
  type: select
  options: [free, premium]         # ← Replace [mock, deepl]
  default: free
  required: true
  hint: |
    ⚠️ Free モードはテスト・開発専用です。
    LanguageTool 利用規約により Free プランでの自動リクエストは禁止されています。
    本番運用には Premium プランの契約が必要です（環境変数 LT_USERNAME と LT_API_KEY を設定後、Premium モードに切替えてください）。
```

### HTTP node — Free branch (no auth)

```yaml
title: 'LT Free 校閲 (テスト用)'
method: get
url: 'https://api.languagetoolplus.com/v2/check?text={{url_encode(#データ正規化.fulltext#)}}&language=en-GB'
headers: ''                         # ← No auth needed
timeout:
  max_connect_timeout: 10
  max_read_timeout: 30
  max_write_timeout: 10
retry_config:
  retry_enabled: true
  max_retries: 8                    # ← Free tier 20/min → cần nhiều retry hơn
  retry_interval: 10000             # ← 10s interval để qua rate window 60s
ssl_verify: true
```

### HTTP node — Premium branch (with auth)

```yaml
title: 'LT Premium 校閲 (本番用)'
method: get
url: 'https://api.languagetoolplus.com/v2/check?text={{url_encode(#データ正規化.fulltext#)}}&language=en-GB&username={{#env.LT_USERNAME#}}&apiKey={{#env.LT_API_KEY#}}'
headers: ''
timeout:
  max_connect_timeout: 10
  max_read_timeout: 30
  max_write_timeout: 10
retry_config:
  retry_enabled: true
  max_retries: 4                    # ← Premium 80/min → ít retry hơn
  retry_interval: 5000              # ← 5s đủ vì rate cao hơn
ssl_verify: true
```

### md_exporter tool
```yaml
plugin_id: bowenliang123/md_exporter
tool_name: md_to_xlsx              # ← thay md_to_csv (KH có thể chọn csv nếu muốn)
tool_parameters:
  md_text: '{{#LONG_TABLE.table_markdown#}}'
  output_filename: eiken_proofread  # plugin tự append .xlsx
```

### App description (Japanese)

```yaml
app:
  name: 'Eiken Stem Proofread 84問 (LanguageTool)'
  description: |
    Excel 84問→Stem に Answer Choice を入力→LanguageTool で校閲→XLSX 出力。
    Free モード (テスト用) と Premium モード (本番用) を選択可能。
    Premium モード使用時は環境変数 LT_USERNAME と LT_API_KEY を設定してください。
```

---

## 🚀 Effort Estimate (Option 1 + Y1 + 2-mode)

| Task | Effort |
|------|--------|
| Start node mode rename + JP hint | 10 min |
| データ正規化 rewrite (filter + pre-fill + 84 items output) | 45 min |
| Iteration parallel_nums tune | 5 min |
| Delete バッチ展開 + DeepL構築 | 5 min |
| if-else condition update (mode is "premium") | 5 min |
| **Free HTTP node** (no auth, retry 8×10s) | 15 min |
| **Premium HTTP node** (with env auth, retry 4×5s) | 15 min |
| LT 統合 code (parse + Y1 columns) | 1h |
| Duplicate LT 統合 node cho Free branch | 10 min |
| LONG TABLE rewrite (6-col Y1) | 45 min |
| md_to_csv → md_to_xlsx config swap | 5 min |
| End node variable rename | 5 min |
| Env vars setup (LT_USERNAME, LT_API_KEY placeholder) | 10 min |
| App description + JP warning text | 10 min |
| Update [risks.md](risks.md) (deprecate DeepL risks, add ToS warning) | 30 min |
| Test Free mode với 10 stems | 30 min |
| Test Free mode với 84 stems | 30 min |
| Buffer for edge cases | 30 min |
| **TOTAL** | **~5.5 hours** |

---

## ❓ Pending KH confirm (non-blocker, có default)

| Question | Default if no answer | Impact if changed |
|----------|---------------------|-------------------|
| Language code (`en-US`/`en-GB`/...) | `en-GB` (Eiken thường BrE) | LT detect rules khác giữa US/GB |
| Confidence threshold | `≥ 0.5` (balanced) | Lower = catch nhiều, noisier. Higher = chỉ chắc chắn |
| Issue types filter | Keep all (grammar/misspelling/typographical/style) | Drop `style` nếu KH muốn ít noise |
| Skipped items handling | Report vào `skipped_items` (KH thấy câu bị skip) | Silent drop nếu KH không quan tâm |
| `ignoreForIncompleteSentence` | Respect (skip nếu stem fragment) | Recommend yes để giảm false positive |
| File type cuối (XLSX vs CSV) | **XLSX** | CSV nếu KH cần import tool legacy |
| Output 2 file (XLSX + DOCX)? | Single XLSX | Add `md_to_docx` node nếu muốn visual review |

→ Có thể start implementation với defaults, adjust khi KH confirm.

---

## 📜 Decision history (appendix — for context)

### Tested + rejected options

| Date | Tested | Result | Decision |
|------|--------|--------|----------|
| 2026-05-19 | LanguageTool API (live probe) | ✅ Endpoint work, response structured | Adopted as API |
| 2026-05-19 | DOCX với `md_to_docx` + Section J design | ✅ Bold + strikethrough render | Initial pick, later superseded |
| 2026-05-21 | Performance Option 2 (Batching with concat) | Analyzed | KH pick Option 1 (simpler) |
| 2026-05-21 | XLSX với `md_to_xlsx` (inline format) | ❌ Strip markers + không format | Confirmed XLSX không support inline highlight |
| 2026-05-21 | `openpyxl` trong Code Node (rich text) | ❌ `ImportError: No module named 'openpyxl'` | Dify sandbox không có module — idea blocked |
| 2026-05-21 | HTML-as-XLS workaround | Discussed | Skipped (KH OK với Y1 multi-column) |

### Why Y1 (multi-column) over visual highlight

1. **Plugin limit**: `md_to_xlsx` strip Markdown inline markers, no formatting preserved
2. **Sandbox limit**: `openpyxl` direct manipulation không available
3. **Trade-off acceptable**: KH có thể setup Excel conditional formatting cho visual; data structure rõ ràng hơn cho processing

### Test workflows (giữ lại trong repo cho reference)

- [test_docx_highlight.yml](../workflows/test_docx_highlight.yml) — verified DOCX bold/strike work (alternative path)
- [test_xlsx_highlight.yml](../workflows/test_xlsx_highlight.yml) — verified XLSX không preserve markdown format
- [test_openpyxl_feasibility.yml](../workflows/test_openpyxl_feasibility.yml) — verified Dify sandbox thiếu openpyxl

---

## ✅ Verified LanguageTool API Spec (probe 2026-05-19)

### Endpoint
- URL: `https://api.languagetool.org/v2/check`
- Methods: GET hoặc POST đều OK
- Auth: **không cần API key** (free tier)
- Content-Type (nếu POST): `application/x-www-form-urlencoded`

### GET example (recommend cho Option 1 + Y1)
```
GET https://api.languagetool.org/v2/check?text=She%20have%20a%20apple.&language=en-GB
```

### Response shape (verified)

Top-level fields:
- `software.{name, version, premium, premiumHint}` — `premium: false` trên free
- `warnings.incompleteResults` — boolean
- `language.{name, code, detectedLanguage}`
- **`matches[]`** ← cốt lõi, list lỗi
- `sentenceRanges`, `extendedSentenceRanges` — chia câu

Mỗi `match`:
```json
{
  "message": "human-readable explanation",
  "shortMessage": "Agreement error",
  "replacements": [
    {"value": "has", "shortDescription": "form of 'have'"},
    {"value": "had", "shortDescription": "past of 'have'"}
  ],
  "offset": 4,                                  // vị trí lỗi trong text
  "length": 4,
  "context": {"text": "...", "offset": 4, "length": 4},
  "sentence": "She have a apple yesterday.",
  "type": {"typeName": "Other"},
  "rule": {
    "id": "HE_VERB_AGR",                         // rule ID
    "description": "Agreement error: ...",
    "issueType": "grammar",                       // grammar/misspelling/typographical/style
    "category": {"id": "GRAMMAR", "name": "Grammar"},
    "isPremium": false,                           // nếu true → free tier missed
    "confidence": 0.58                             // 0-1 — filter threshold
  },
  "ignoreForIncompleteSentence": true,
  "contextForSureMatch": -1
}
```

### Rate limits (KH cung cấp 2026-05-19)

| Limit | Free | Premium |
|-------|------|---------|
| Requests/min | 20 | **80** |
| Chars/min | 75,000 | 300,000 |
| Chars/request | 20,000 | 60,000 |

→ KH dùng Premium. Option 1 với 84 stems = sát limit 80/min → cần retry config (đã configure).

### English language codes
- `en-US`, `en-GB` (recommend cho Eiken), `en-AU`, `en-CA`, `en-NZ`, `en-ZA`, `en` (generic)

---

## 📅 Status checklist

- [x] ~~Verify LanguageTool API spec~~ ✅ Done 2026-05-19
- [x] ~~Verify exact rate limits~~ ✅ KH cung cấp 2026-05-19
- [x] ~~Clarify stem multi-line format~~ ✅ KH gửi sample 2026-05-19
- [x] ~~Clarify highlight requirement~~ ✅ KH gửi screenshot 2026-05-19
- [x] ~~Research output format alternatives~~ ✅ Tested DOCX/XLSX/openpyxl 2026-05-19→21
- [x] ~~KH chọn Performance Option~~ ✅ Option 1 (2026-05-21)
- [x] ~~KH chọn Output Format~~ ✅ Y1 multi-column XLSX/CSV (2026-05-21)
- [x] ~~KH chọn Tier Strategy~~ ✅ 2-mode `free|premium` với placeholder env vars (2026-05-21)
- [x] ~~Verify Premium endpoint + auth~~ ✅ `api.languagetoolplus.com/v2/check` + query `?username=...&apiKey=...` (probed 2026-05-21)
- [ ] **Apply patch vào main.yml** ← next step
- [ ] Test Free mode với 10 stems
- [ ] Test Free mode với 84 stems (chấp nhận ~5 phút do rate limit)
- [ ] Update [risks.md](risks.md) — deprecate DeepL risks, add Free tier ToS warning
- [ ] KH subscribe Premium → fill env vars `LT_USERNAME` + `LT_API_KEY` → switch mode
- [ ] KH confirm settings minor (language, confidence, file type) — non-blocker
