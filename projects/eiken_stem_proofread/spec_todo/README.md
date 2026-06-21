# Spec TODO — Eiken Stem Proofread

Tracking các risk, spec change, và implementation plan.

## 📂 Cấu trúc

| File | Status | Nội dung |
|------|--------|----------|
| [spec_change_v2.md](spec_change_v2.md) | ✅ **CURRENT** | KH spec change + decisions locked (Option 1 + Y1 multi-column XLSX/CSV) — ready to implement |
| [risks.md](risks.md) | 📌 Active | Risk analysis của workflow `main.yml` — sẽ update sau khi implement v2 |
| [placeholder_fix.md](placeholder_fix.md) | 📌 Active | Risk #6 detail: hard-coded PLACEHOLDER + giải pháp regex |
| [customer_confirm.md](customer_confirm.md) | 📌 Active | Items confirm với KH (NDA, data residency, format Excel) — phần lớn resolved |
| [api_alternatives.md](api_alternatives.md) | 📜 Historical | Survey API alternatives (LLM/Sapling/TextGears) — KH đã chọn LT, giữ làm reference |
| [deepl_spec_questions.md](deepl_spec_questions.md) | ⚠️ Deprecated | DeepL không dùng — superseded by [spec_change_v2.md](spec_change_v2.md) |

## 🎯 Implementation Phases

```
Phase 1 (MOCK demo, current main.yml):
  - ✅ Done — workflow chạy với mode=mock (DeepL skeleton)

Phase 2 (LanguageTool integration, Option 1 + Y1) ← NEXT
  - Apply patch theo spec_change_v2.md
  - Architecture: per-question iteration, GET LT API, 6-col XLSX output
  - Effort: ~5.5h
  - Test với sample data
  - KH UAT

Phase 3 (Production hardening):
  - Resolve PLACEHOLDER regex (placeholder_fix.md)
  - Update risks.md với spec v2 (deprecate DeepL risks)
  - Address remaining HIGH risks (#2, #4, #5)
```

## 📅 Current Status (2026-05-21)

| Phase | Status | Note |
|-------|--------|------|
| Phase 1 (MOCK demo) | ✅ Done | Workflow chạy với `mode=mock` |
| Phase 2 (LT integration) | 🔄 **Ready to start** | KH chốt Option 1 + Y1 (2026-05-21) |
| Phase 3 (Hardening) | ⏸️ Next | Sau Phase 2 |

## 🔗 Related

- Workflow: [../workflows/main.yml](../workflows/main.yml)
- Test workflows (kept for reference):
  - [../workflows/test_docx_highlight.yml](../workflows/test_docx_highlight.yml)
  - [../workflows/test_xlsx_highlight.yml](../workflows/test_xlsx_highlight.yml)
  - [../workflows/test_openpyxl_feasibility.yml](../workflows/test_openpyxl_feasibility.yml)
- Project README: [../README.md](../README.md)
