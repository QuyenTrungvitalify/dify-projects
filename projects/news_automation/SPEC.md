# News Automation — PoC Full Workflow

> **Spec version**: PoC v1 (2026-06-12)
> **Target file**: `projects/news_automation/workflows/main.yml`
> **Trigger mode**: Manual run on-demand (no cron yet — out of scope for PoC)
> **Probe complete**: `workflows/probe_fetch_chatwork.yml` — Chatwork OCR pipeline verified, kept as reference

## Goal
End-to-end news automation demo trong **1 Dify workflow file**, chạy manual:

1. Thu thập từ 2 nguồn: ảnh Chatwork (đã verified) + Web RSS
2. Gộp + dedup theo URL
3. Chấm điểm LLM (relevance + recency)
4. Chọn top N articles
5. Sinh draft JP cho mỗi article (title, lead, body, tags)
6. Ghi vào Google Sheets qua Apps Script webhook
7. Output: link tới sheet đã write

## Out of scope cho PoC
- Cron auto-trigger (manual only)
- WordPress HTML conversion (optional, dễ add sau)
- Approval UI riêng (dùng Sheet làm UI)
- Multi-language (JP only)
- Dedup semantic (chỉ dedup theo URL normalized)
- Email notification
- Production-grade error reporting (chỉ basic error fields)

## Chosen pattern
**Custom composite** — kết hợp 3 patterns:
- `file-iteration` (cho Chatwork OCR — verified in probe)
- `multi-step-llm` (cho scoring + drafting chain)
- HTTP-request fan-in (cho RSS fetching parallel)

Single-file branched design (AGENTS.md §9 — eiken pattern), không split workflows trong PoC.

## High-level Node Graph

```
Start (3 inputs)
  │
  ├─► Branch A: Chatwork OCR
  │   HTTP1 → CodeParse → Iteration[HTTP2,Code,HTTP3,LLMVision,CodeWrap]
  │   Output: array of {source: "chatwork", title, source_url, summary, raw_text, posted_at}
  │
  ├─► Branch B: Web RSS
  │   CodeSplitURLs → Iteration[HTTPFetchRSS, CodeParseXML]
  │   Output: array of {source: "rss", title, source_url, summary, published_at}
  │
  ├─► VariableAggregator: merge Branch A + B → unified array
  │
  ├─► Code Normalize+Dedup
  │   Normalize URL (strip utm_*, ?ref=, trailing /)
  │   Dedup by normalized URL
  │   Output: deduped array
  │
  ├─► Iteration C: Score
  │   LLM (gpt-4o-mini) rate relevance(0-100) + recency(0-100) → composite
  │   Output: array with `score` field added
  │
  ├─► Code Sort+TopN
  │   Sort by score desc, take top {top_n}
  │
  ├─► Iteration D: Draft
  │   LLM (gpt-4o-mini) generate {title, lead, body, tags}
  │   Output: array of drafts
  │
  ├─► Code FormatRows
  │   Build CSV-like rows for Sheet
  │
  ├─► HTTP POST Apps Script webhook
  │   Write rows + return sheet_url
  │
  └─► End
      Outputs: sheet_url, drafts_count, processing_log
```

## Nodes Table (placeholder IDs — mint via generate_id.py in Implement)

| Section | Type | Title | Purpose |
|---|---|---|---|
| Start | start | Input | 3 inputs: `chatwork_api_token`, `room_id`, `hours_back` (default 24). `rss_feed_urls` is hardcoded in Code node for PoC simplicity. |
| **A. Chatwork** | http-request | List Messages | Same as probe |
| | code | Parse File Messages | Same as probe |
| | iteration | Chatwork OCR loop | 5 child nodes (HTTP2 → Extract → HTTP3 → LLM Vision → Wrap) — copy verbatim from probe |
| | code | Map to Unified Schema | Adapt OCR output → `{source: "chatwork", title, source_url, summary, raw_text, posted_at}` |
| **B. RSS** | code | RSS URL List | Hardcoded array of 3-5 RSS feed URLs |
| | iteration | RSS Fetch loop | parallel_nums=3 |
| | http-request | Fetch RSS | GET each feed URL |
| | code | Parse XML | `xml.etree.ElementTree` extract `<item>` → list of articles |
| | code | Flatten + Map | Flatten array[array] → array, map to unified schema |
| **Merge** | variable-aggregator | Merge sources | output_type: array[object] (or array[string] of JSON) |
| | code | Normalize+Dedup | URL normalize + dedup |
| **C. Score** | iteration | Score loop | per article |
| | llm | Score (gpt-4o-mini) | Output JSON `{relevance: 0-100, recency: 0-100}` |
| | code | Extract Score | Compose composite = `0.7*relevance + 0.3*recency` |
| **Pick** | code | Sort + Top N | Sort desc by composite score, slice top N |
| **D. Draft** | iteration | Draft loop | per top article |
| | llm | Draft (gpt-4o-mini) | Output JSON `{title, lead, body, tags}` |
| **Output** | code | Build Sheet Rows | Format each draft into row dict |
| | http-request | Write to Sheet | POST Apps Script webhook |
| | end | Output | sheet_url, drafts_count, error_log |

**Tổng node**: ~18-20 (incl. iteration children)

## Variable flow (high level)

```
start.{token, room_id, hours_back}                  ──► Chatwork branch (probe)
chatwork_branch.iteration.output                    ──► Map to unified ──► aggregator
rss_branch.iteration.output (after flatten)         ──► aggregator
aggregator.output                                   ──► dedup
dedup.unique_articles                               ──► score iteration
score iteration.output                              ──► sort + top
sort.top_articles                                   ──► draft iteration
draft iteration.output                              ──► sheet rows
sheet rows                                          ──► http write
http_write.body                                     ──► end.sheet_url
```

## Plugins

| Plugin | Version | Hash | Note |
|---|---|---|---|
| `langgenius/openai` | 0.3.7 | `f16dcbd99f632f3f3f29212641afae3e54795d6545ffcf6464038eee0481d05c` | ✅ Đã có (from `Test chat - longlh.yml`) |
| Sheets plugin | — | — | ❌ KHÔNG dùng plugin — dùng raw HTTP POST tới Apps Script webhook |

Không cần plugin bổ sung. `dependencies` chỉ chứa OpenAI hash.

## Apps Script Web App (1 lần setup ngoài Dify)

```javascript
// User cần copy đoạn này vào Google Apps Script, deploy as Web App.
const SHEET_ID = 'YOUR_SHEET_ID';   // tạo Sheet riêng, copy ID từ URL
const SHEET_NAME = 'Drafts';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const rows = body.rows || [];
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Date', 'Source', 'Title', 'Summary', 'Draft Body', 'Tags', 'URL', 'Score', 'Status']);
    }
    rows.forEach(r => sheet.appendRow([
      r.date, r.source, r.title, r.summary, r.body, (r.tags || []).join(', '),
      r.url, r.score, 'pending'
    ]));

    return ContentService.createTextOutput(JSON.stringify({
      success: true, written: rows.length,
      sheet_url: 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit',
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false, error: String(err),
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
```

Deploy: Apps Script editor → Deploy → New deployment → type: Web app → Access: "Anyone" → Copy URL.

Workflow Dify dùng URL này làm endpoint HTTP POST.

## Open questions — CẦN USER CONFIRM/CUNG CẤP

### 1. RSS source list ✅ CONFIRMED
3 feeds JP:
- ITmedia AI+: `https://rss.itmedia.co.jp/rss/2.0/aiplus.xml`
- ZDNet Japan: `https://feeds.japan.zdnet.com/rss/zdnet/all.rdf`
- MIT Tech Review JP: `https://www.technologyreview.jp/feed/`

### 2. Top N — pending confirm (assume 2)
Default `top_n = 2` theo spec gốc. Sẽ hardcode trong workflow, dễ adjust sau.

### 3. Sheet schema ✅ CONFIRMED
**Schema chốt** (5 cột):
```
Date | Title | URL | Source | Description
```
- Đơn giản hơn — bỏ Draft Body / Tags / Score / Status
- LLM Draft chỉ cần produce `description` (1 paragraph JP tối ưu cho posting)
- `title` lấy từ OCR/RSS (có thể polish nhẹ)
- `url` từ source
- `date` = workflow run time
- `source` = "chatwork" hoặc tên RSS feed

### 4. Sheet/Apps Script setup ✅ PARTIAL
- **Sheet**: `12Tqjg1dFvlj_7JyJlE31vqgPb_4f3BHej2FVYrFXODc` ✅
- **Apps Script project**: created ✅
- **Web App deploy URL**: ⏳ pending (user deploys + sends URL)
- Code paste + SHEET_ID đã chuẩn bị sẵn trong conversation

### 5. Scoring weight (NICE TO HAVE)
Composite = `α * relevance + β * recency`. Default `α=0.7, β=0.3` (relevance ưu tiên hơn).
Khách có thiên vị recency hơn không?

### 6. Draft prompt details (NICE TO HAVE — có thể iterate sau)
- Style: formal hay casual?
- Length: title ≤50字 / lead 1段落 / body 300-500字 — chốt?
- Tag count: 3-5 tags JP — OK?

### 7. Dify model availability (CẦN CHECK)
- ✅ `gpt-4o-mini` (đã verified work)
- ❌ `gpt-4o` (model disabled in workspace — đã gặp)
- Score + Draft cần text reasoning — `gpt-4o-mini` đủ?
- Hay nâng cấp lên `gpt-4o` cho draft quality? Cần enable model trong provider config trước.

### 8. RSS pagination
Default fetch top 20 items/feed, no pagination. OK?

### 9. Content filter
Spec gốc nói "AI・DX関連". Có cần keyword pre-filter trước khi LLM score không?
Default: skip pre-filter, để LLM score lo. Chấp nhận tốn extra tokens cho irrelevant articles.

### 10. Error handling
Nếu RSS fetch fail (1 source dead), workflow vẫn continue với sources còn lại? Default YES (continue-on-error).

## Effort estimate (recap)

| Phase | Hours |
|---|---|
| Build (per-step như estimate trước) | 14.5h |
| Integration test | 3h |
| Demo prep | 1h |
| Buffer 15% | 2.5h |
| **TOTAL** | **~21h ≈ 3 working days** |

## Test plan (Phase ④)

1. **Unit test per branch**: chạy riêng Chatwork branch (input chỉ token/room) → verify array A
2. **Unit test RSS**: hardcode test feed → verify array B
3. **Integration test**: full workflow với 1 ảnh Chatwork + 2 RSS feeds → expect 2 drafts trong Sheet
4. **Cost check**: 1 run nên < $0.30
5. **Latency check**: 1 run < 60s (Chatwork OCR ~10s + RSS ~3s + Scoring ~5s + Drafting ~15s + Sheet ~2s)

## Reference workflows used
- `projects/news_automation/workflows/probe_fetch_chatwork.yml` (current probe — Chatwork OCR section sẽ copy verbatim)
- `templates/patterns/file-iteration.yml` (iteration pattern)
- `templates/patterns/multi-step-llm.yml` (multi-LLM chain)
- `/Users/quyenbt/Downloads/Test chat - longlh.yml` (OpenAI plugin hash)
