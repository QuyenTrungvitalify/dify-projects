# DeepL Write API — Spec Questions

Câu hỏi cần làm rõ trước khi fill nhánh `mode=deepl` trong workflow.

Workflow hiện tại có 3 chỗ `<<< FILL >>>` đánh dấu cần verify (xem [main.yml:28-32](../workflows/main.yml#L28-L32)).

---

## 1. Endpoint URL

**Current placeholder**: [main.yml:614](../workflows/main.yml#L614)
```yaml
url: '<<< FILL: e.g. https://api.deepl.com/v2/write >>>'
```

**Questions**:
- [ ] Endpoint chính xác cho DeepL **Write** API là gì? (`/v2/write`? `/v2/improve`? endpoint riêng?)
- [ ] Có khác nhau giữa free tier (`api-free.deepl.com`) và pro tier (`api.deepl.com`) không?
- [ ] KH dùng plan nào?

---

## 2. Request Body Shape

**Current assumed shape**: [main.yml:581-584](../workflows/main.yml#L581-L584)
```python
payload = {
    "text": texts,           # array of strings
    "target_lang": "EN-US",
}
```

**Questions**:
- [ ] Field name chính xác cho input text: `text`? `texts`? `input`?
- [ ] Field name cho target language: `target_lang`? `target_language`? `lang`?
- [ ] Có cần `source_lang` không? Nếu bỏ → DeepL auto-detect, có rủi ro misdetect không?
- [ ] Có field optional nào cần thêm:
  - [ ] `tone` (formal/informal/business/...)?
  - [ ] `writing_style` (academic/casual/...)?
  - [ ] `glossary_id` (term consistency)?
- [ ] Max array length cho `text`? (Hiện đang gửi 40 text/request)
- [ ] Max chars total per request? (Cần biết để tính BATCH_SIZE phù hợp)
- [ ] Max chars per single text?

---

## 3. Response Body Shape

**Current assumed shape**: [main.yml:677](../workflows/main.yml#L677)
```python
data = json.loads(response_body)
improvements = data.get("improvements", [])
# Assumed: { "improvements": [{"text": "..."}, ...] }
```

**Questions**:
- [ ] Field name chính xác cho list output: `improvements`? `translations`? `results`?
- [ ] Field name cho improved text trong mỗi item: `text`? `improved_text`? `output`?
- [ ] **CRITICAL**: Response có **giữ đúng thứ tự** input không?
  - Nếu KHÔNG → cần `id` field để match → phải tự gắn ID trước khi gửi
  - Nếu CÓ nhưng có thể drop item → cần validate length response == request
- [ ] Có metadata gì khác trong response không? (`detected_source_lang`, `usage`, ...)
- [ ] Status code success: chỉ 200, hay cả 201/202?
- [ ] Error response shape: `{"error": {"message": "..."}}`? Cần parse để log lỗi rõ hơn `[API_ERROR_xxx]`.

---

## 4. Authentication

**Current**: [main.yml:619](../workflows/main.yml#L619)
```yaml
Authorization: DeepL-Auth-Key {{#env.DEEPL_API_KEY#}}
```

**Questions**:
- [ ] Format header chính xác: `DeepL-Auth-Key <key>`? `Bearer <key>`?
- [ ] Có cần API key riêng cho Write API hay dùng chung với Translate API?
- [ ] KH đã có API key chưa? Đã test với endpoint nào chưa?

---

## 5. Rate Limit & Quota

**Questions**:
- [ ] Request/second limit?
- [ ] Request/day limit?
- [ ] Character/month quota?
- [ ] Behavior khi vượt: 429 + retry-after header? Hay block luôn?
- [ ] Hiện workflow set `parallel_nums=2` + retry 2× — có vượt limit không?

---

## 6. Pricing

**Questions**:
- [ ] Pricing model: per character? per request? per text item?
- [ ] Estimate chi phí cho 84 câu × 4 choices = 336 text/run, mỗi text ~50-100 chars
  - Tổng ~25-35K chars/run
- [ ] KH chấp nhận chi phí bao nhiêu/run? Cần optimize không?

---

## 7. Data Retention & Privacy

**Questions** (related to [customer_confirm.md](customer_confirm.md) Risk #18):
- [ ] DeepL có log request/response không?
- [ ] Data retention policy?
- [ ] KH có DeepL Pro contract với clause "no data retention"?
- [ ] Có cần dùng DeepL on-premise/self-hosted không?

---

## 📅 Status

- [ ] Get DeepL Write API official docs link từ KH
- [ ] Test 1 request thật với 1 text → verify URL + body + response shape
- [ ] Test 1 request với 40 text → verify batch handling + ordering
- [ ] Test rate limit với parallel=2 → verify không bị 429
- [ ] Update workflow main.yml với spec đã verify
- [ ] Document final spec ở đây để team reference

## 🔗 References

- (TODO) DeepL Write API docs URL
- (TODO) DeepL Pro contract / NDA document
- (TODO) Sample request/response từ Postman test
