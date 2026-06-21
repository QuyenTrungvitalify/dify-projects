# Customer Confirmation Checklist

Items cần xác nhận với khách hàng trước khi go-prod.

---

## 🔒 Data Confidentiality (CRITICAL — Risk #18)

Excel chứa Eiken question stem → có thể là **nội dung đề thi chưa publish** → highly sensitive.

Workflow gửi text qua:
1. **Dify storage** (Dify cloud nếu dùng SaaS) — file upload + intermediate results
2. **DeepL servers** — text được gửi đi校閲

### Questions cho KH

- [ ] Eiken stem này có phải đề thi đã publish hay chưa publish?
- [ ] Có NDA với DeepL không? Hoặc cần ký NDA mới?
- [ ] DeepL Pro contract của KH có clause "no data retention" / "data deletion after processing" không?
- [ ] Có yêu cầu data residency cụ thể không? (Nhật Bản? EU?)
- [ ] Có cần switch sang **DeepL on-premise** thay vì cloud API không?
- [ ] Dify đang dùng SaaS hay self-hosted? Nếu SaaS → check Dify ToS về data handling.

### Action items

- [ ] Confirm với security/legal của KH
- [ ] Nếu cần on-premise → reassess architecture
- [ ] Document data flow diagram cho audit

---

## 📋 Excel Format Spec

Cần KH gửi **sample file thật** (1-2 file đại diện) để verify format.

### Questions

- [ ] Excel có bao nhiêu sheet? Sheet nào chứa data chính?
- [ ] Tên cột chính xác (case-sensitive):
  - `#` hay `No.` hay `番号`?
  - `Item ID` hay `ID` hay `問題ID`?
  - `Stem` hay `問題文` hay `Question`?
  - `Answer Choice 1` hay `選択肢1` hay format khác?
  - `Correct Answer Number` hay `正解` hay format khác?
- [ ] Placeholder format chính xác trong stem:
  - `(          )` 10 spaces?
  - `( )` ít spaces hơn?
  - `（　　　　）` full-width parens + full-width spaces?
  - `___` underscores?
  - Khác?
- [ ] `Correct Answer Number` format:
  - Số `1` `2` `3` `4`?
  - Full-width `１２３４`?
  - `①②③④`?
  - Chữ `A` `B` `C` `D`?
- [ ] Số choices có cố định 4 không? Có câu nào 3 hoặc 5 không?
- [ ] Có câu nào có **multi-placeholder** trong 1 stem không? (vd 2 chỗ trống cần fill)
- [ ] Có câu nào có **multi-correct answer** không?
- [ ] Có cell nào chứa ký tự `|` không? (sẽ vỡ Markdown table parse — xem Risk #2)
- [ ] Có cell nào có 改行 (multi-line, alt+enter) không?

### Action items

- [ ] Nhận 1-2 sample file từ KH
- [ ] Run thử với MOCK mode → verify parse đúng
- [ ] Update workflow code nếu format khác giả định
- [ ] Document format chuẩn vào project README

---

## 🌐 DeepL API Access

Liên quan trực tiếp đến [deepl_spec_questions.md](deepl_spec_questions.md).

### Questions

- [ ] KH đã có DeepL API account chưa? Plan nào (Free / Pro / Business)?
- [ ] API key sẵn sàng cung cấp chưa?
- [ ] Có giới hạn budget/quota tháng không?
- [ ] Có muốn dùng DeepL Translate (đã GA) hay chờ DeepL Write (có thể beta)?
- [ ] Endpoint nào chính thức dùng?

### Action items

- [ ] Nhận API key (transfer secure channel, không qua chat plain)
- [ ] Add vào Dify env var với type Secret
- [ ] Test 1 request → verify
- [ ] Document plan + quota vào project README

---

## 🎯 Acceptance Criteria

### Questions

- [ ] Định nghĩa "校閲 thành công" của KH là gì?
  - Chỉ cần text được DeepL Write process?
  - Có cần manual review trước khi accept không?
  - Có metric quality nào không?
- [ ] CSV output format đã đủ chưa? Có cần thêm/bớt cột nào không?
- [ ] Có cần báo cáo thêm (summary stats, error report) không?
- [ ] Workflow chạy frequency: ad-hoc (mỗi lần KH upload) hay batch nightly?
- [ ] Số lượng câu tối đa per run: 84 hiện tại có scale lên 500/1000 không?

### Action items

- [ ] Define acceptance test cases với KH
- [ ] Run final UAT trước khi handover

---

## 📤 Deployment & Handover

### Questions

- [ ] KH tự run workflow qua Dify Studio UI hay qua API call?
- [ ] Ai sẽ maintain workflow sau handover? Team KH? Hay vẫn Vitalify?
- [ ] Documentation cần language nào (JP, EN, VN)?
- [ ] Training session cần không?

### Action items

- [ ] Prepare user manual (JP)
- [ ] Prepare technical doc (EN)
- [ ] Schedule training nếu cần
- [ ] Define SLA / support channel

---

## 📅 Open Status

| Item | Status | Owner | Due |
|------|--------|-------|-----|
| Confidentiality confirm | ⏸️ Pending | KH legal | TBD |
| Sample Excel files | ⏸️ Pending | KH | TBD |
| DeepL API access | ⏸️ Pending | KH | TBD |
| Acceptance criteria | ⏸️ Pending | KH PM | TBD |
| Deployment plan | ⏸️ Pending | Both | TBD |
