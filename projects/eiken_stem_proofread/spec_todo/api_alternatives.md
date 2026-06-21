# API Alternatives Research

Date: 2026-05-19
Context: KH đã pivot từ DeepL Write → LanguageTool free. Mục đích file này: khảo sát thêm các option khác cho **English grammar/spell check API**, dùng với Eiken stem proofread use case.

## 🎯 Yêu cầu use case

- Detect grammar + spell errors trong English text
- Output: highlight lỗi + suggest correction ("red line" UX)
- Input size: ~50-200 chars/text, ~84 text/run
- Budget: ưu tiên free hoặc rẻ
- Privacy: Eiken stem có thể là đề thi chưa publish → sensitive
- Integration: Dify HTTP node (REST API)

---

## 🔍 Candidates đã khảo sát

### 1. LanguageTool (current pick)

| Aspect | Info |
|--------|------|
| Endpoint | `https://api.languagetool.org/v2/check` |
| Auth | Không cần (free) / API key (premium) |
| Format | GET/POST, form-encoded |
| Free tier | Public anonymous: ~20 req/min, no daily cap docs. Đăng ký account: 40k chars/day (chưa verify exact) |
| Paid tiers | 100 / 250 / 500 / 1k / 10k API calls/day — monthly plans, từ ~€20/month |
| Max text | 20KB free, 60k chars premium |
| Privacy | ✅ GDPR compliant, servers ở Đức, **không lưu text** |
| Self-hosted | ✅ Docker image free, unlimited |
| Quality | Tốt cho grammar cơ bản, miss advanced rules (premium hint trong response) |
| Languages | 30+, đầy đủ English variants (US/GB/AU/CA/NZ/ZA) |

**Verdict**: ✅ Default choice — đã verify, free, no auth, response rich

---

### 2. Sapling.ai

| Aspect | Info |
|--------|------|
| Endpoint | `https://api.sapling.ai/api/v1/edits` |
| Auth | API key (header hoặc body) — **bắt buộc** |
| Format | POST JSON |
| Free tier | Có (chưa verify exact limits trên docs page) |
| Max text | 100k chars/request, recommend 4k |
| Privacy | Có business/enterprise tier với SOC2 |
| Quality | Neural-based, target Grammarly competitor — generally **tốt hơn LT cho nuanced grammar** |
| Languages | Đa ngôn ngữ, English chính |
| Output | `edits[]` với `start/end/replacement/error_type/general_error_type` |
| Special | Có `neural_spellcheck`, `medical` mode, `auto_apply` |

**Verdict**: 🟡 Backup option — quality tốt hơn LT nhưng cần API key + sign up. Verify free tier giới hạn trước khi pick.

---

### 3. TextGears

| Aspect | Info |
|--------|------|
| Endpoint | `https://api.textgears.com/check.php` (legacy) hoặc `/grammar` v3 |
| Auth | API key (query param `key`) |
| Format | GET/POST |
| Free tier | Có — 100 req/day không cần đăng ký (cũ); register free → 50k chars/day |
| Pricing | Từ $9/month cho 10k req/day |
| Privacy | US-based, chưa rõ retention policy |
| Quality | OK cho basic, không bằng LT/Sapling cho advanced |
| Languages | Multi-lang, English mạnh nhất |

**Verdict**: 🟡 Alternative đơn giản — API simpler hơn LT, nhưng quality kém hơn. Tốt nếu LT rate limit không đủ.

⚠️ Note: fetch docs site bị ECONNREFUSED nhiều lần khi test → server availability có thể không stable. Cần verify trước khi commit.

---

### 4. LLM-based (Claude / GPT / Gemini) 🔥

**Concept**: Dùng LLM với prompt cụ thể thay vì API grammar dedicated:

```
Prompt: "You are an English grammar checker for Japanese EFL exam questions.
Analyze the following text and return JSON with this exact schema:
{
  "errors": [
    {"offset": int, "length": int, "type": "grammar|spelling|style",
     "message": "...", "suggestion": "..."}
  ]
}
Text: <fulltext>"
```

| Aspect | Info |
|--------|------|
| Endpoint | OpenAI: `api.openai.com/v1/chat/completions` / Anthropic: `api.anthropic.com/v1/messages` / Gemini: `generativelanguage.googleapis.com` |
| Auth | API key bắt buộc |
| Format | POST JSON |
| Free tier | OpenAI: $5 credit free đợt đầu / Anthropic: pay-as-you-go / Gemini: 60 req/min free tier rộng rãi |
| Cost (Eiken estimate 84 text × 200 chars) | Claude Haiku: ~$0.001/run / GPT-4o-mini: ~$0.005/run / Gemini Flash: ~free tier |
| Privacy | Tuỳ vendor — Anthropic không train trên API data, OpenAI tương tự với opt-out |
| Quality | **Best-in-class** cho nuanced grammar, có thể custom prompt theo Eiken style (BrE, exam English…) |
| Languages | All |
| Special | Có thể: detect Eiken-specific issues, explain in JP, custom rule sets per câu |

**Pros LLM cho use case này**:
- ✅ Flexible nhất — adjust prompt cho từng exam grade
- ✅ Có thể explain lỗi bằng tiếng Nhật cho KH dễ review
- ✅ Có thể skip false positive với context (vd "this is grammatically correct in question form")
- ✅ Output structured JSON theo schema mình design
- ✅ Cost rất thấp với Haiku/Flash cho text ngắn

**Cons**:
- ❌ Không có "offset/length" tự nhiên — LLM phải tính, có thể off-by-one
- ❌ Phụ thuộc prompt quality
- ❌ Non-deterministic — run 2 lần có thể khác kết quả (set temperature=0 giảm)
- ❌ API key risk (rotate, leak)

**Verdict**: 🚀 **Strong contender** — recommend evaluate vs LanguageTool

---

### 5. LanguageTool Self-Hosted (Docker)

| Aspect | Info |
|--------|------|
| Setup | `docker run -d -p 8010:8010 erikvl87/languagetool` |
| Cost | $0, on infrastructure của mình |
| Auth | Không (private network) |
| Rate limit | Unlimited |
| Privacy | ✅ Hoàn toàn local, không gửi data ra ngoài |
| Quality | Cùng engine với LT cloud free (không có premium rules) |
| Ops | Cần host (Dify server, VPS, cloud) → ~$5/month VPS |

**Verdict**: 🏆 **Best privacy + quality combo** nếu KH lo về data confidentiality (Risk #18 trong [risks.md](risks.md))

---

### 6. Grammarly API

| Aspect | Info |
|--------|------|
| Availability | **Limited public access** — chỉ qua Grammarly Business / Enterprise contract |
| Cost | Expensive, custom pricing |
| Quality | Industry-leading |
| Verdict | ❌ **Skip** — không phù hợp với scale + budget Vitalify dự án này |

---

### 7. Khác (mention nhưng không phù hợp)

- **Ginger Software** — API ít docs public, không recommend
- **ProWritingAid** — paid only, focus rewrite không phải grammar check
- **After the Deadline** (OSS) — không maintained lâu rồi
- **Microsoft Editor API** — không public
- **Google Cloud Natural Language** — không có grammar check, chỉ sentiment/entity

---

## 📊 So sánh nhanh

| API | Cost | Auth | Privacy | Quality | Dify-friendly | Recommend |
|-----|------|------|---------|---------|---------------|-----------|
| **LanguageTool cloud free** | $0 | None | Cloud DE | Tốt | ✅✅ | ✅ Default |
| **LanguageTool self-hosted** | $0 + ops | None | Local | Tốt | ✅✅ | 🏆 Nếu lo privacy |
| **LLM (Claude Haiku)** | ~$0.001/run | API key | Vendor policy | **Best** | ✅ | 🚀 Nếu cần flexibility |
| **LLM (Gemini Flash free)** | $0 (free tier) | API key | Vendor policy | Best | ✅ | 🚀 Free + quality |
| **Sapling.ai** | Free tier? Paid | API key | OK | Tốt+ | ✅ | 🟡 Backup |
| **TextGears** | $0 (limit) / paid | API key | OK | OK | ✅ | 🟡 Alt LT |
| **LT premium cloud** | €20+/month | API key | Cloud DE | Tốt++ | ✅ | 💰 Nếu LT free không đủ |
| **Grammarly** | $$$ | Contract | OK | Best | ❌ | ❌ Overkill |

---

## 🎯 Recommendation framework

### Scenario A: Stay với LanguageTool free
→ Phù hợp nếu:
- Rate limit free OK với run frequency của KH (~5 run/day)
- KH chấp nhận miss một số advanced rules
- Confidentiality chưa critical
- Cần go-live nhanh

### Scenario B: Switch sang LLM (Claude Haiku / Gemini Flash)
→ Phù hợp nếu:
- KH cần explain lỗi bằng tiếng Nhật trong CSV
- KH muốn custom rules per Eiken grade (vd: 2級 strict hơn 3級)
- Cần consistent quality (LT free miss → KH complain)
- Có sẵn API key Anthropic / Google
- **Bonus**: cùng vendor với Dify nếu dùng Claude → invoice gọn

### Scenario C: Switch sang LanguageTool self-hosted
→ Phù hợp nếu:
- Eiken stem là confidential content (đề thi chưa public)
- KH có infra Docker sẵn
- Run frequency cao (vượt free tier)
- **Best ROI** dài hạn: $0 forever + privacy + unlimited

### Scenario D: Hybrid — LT primary + LLM fallback
→ Phù hợp nếu:
- LT bắt được 70% lỗi → cost-effective
- 30% còn lại escalate lên LLM khi LT confidence thấp
- Phức tạp hơn nhưng optimize cost vs quality

---

## ❓ Questions để KH chọn direction

- [ ] **Confidentiality**: Eiken stem có phải đề thi chưa publish không? Nếu CÓ → recommend Scenario C (self-hosted)
- [ ] **Quality bar**: Có chấp nhận miss advanced grammar rules của LT free không? Nếu KHÔNG → Scenario B/C
- [ ] **Volume**: Bao nhiêu run/day, mỗi run bao nhiêu câu? → check rate limit phù hợp
- [ ] **Infrastructure**: KH có sẵn Docker/VPS không? → enable Scenario C
- [ ] **Budget**: $0 strict, hay có $10-50/month budget? → Mở rộng options
- [ ] **Localization**: Cần explain lỗi bằng tiếng Nhật trong output không? → Scenario B (LLM)

---

## 🚧 Action items

- [ ] Verify TextGears API availability (vài lần fetch bị ECONNREFUSED)
- [ ] Verify Sapling.ai free tier exact limits (sign up test)
- [ ] Test LLM (Claude Haiku) với 5 sample stem → compare quality vs LT
- [ ] Test LanguageTool self-hosted Docker (5 phút setup) → benchmark
- [ ] Confirm Scenario với KH trước khi commit hướng nào

---

## 📎 References

- LanguageTool docs: https://languagetool.org/http-api/
- LanguageTool premium: https://languagetool.org/proofreading-api
- Sapling docs: https://sapling.ai/docs/api/edits-overview/
- TextGears: https://textgears.com (instability noted)
- LT self-hosted Docker: https://hub.docker.com/r/erikvl87/languagetool
- Claude API: https://docs.anthropic.com
- Gemini API: https://ai.google.dev (free tier rộng rãi)
