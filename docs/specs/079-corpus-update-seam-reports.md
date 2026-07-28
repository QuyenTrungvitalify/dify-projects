# Spec 079 — Corpus-update seam: enrichment-gap + provenance-stale, sửa-tại-chỗ

**Status**: Implemented (2026-07-28) — S1 (SKILL.md bước 4–5) + S2 (advisory step trong
sync-corpus.yml, gate `changed==true` vì index.json gitignored chỉ được rebuild khi có update).
Nghiệm thu còn lại: 1 lần `workflow_dispatch` xác nhận body render + 1 lần `/corpus-update` thật.
Kết quả của 3 vòng thiết kế (giữ lại để không đề xuất lại):
(1) bản đầu "3 chuông" — **chuông distill-hint bị user bắt đúng là THỪA**: build tham chiếu corpus
thành công thì chính build đó là nguyên liệu chưng cất tốt hơn file gốc (đã 0.6.0, đã proven, promote
052 có sẵn distill turn) — nudge 078 phủ trọn, khớp logic đóng E4; (2) đính chính: nguồn `indexed:false`
(svcvit-zh) **vô hình theo thiết kế** — enrichment-gap không áp dụng, đường của nó là browse tay +
`/template-promote`; (3) tối ưu cuối: seam `/corpus-update` là **session Claude đang chạy** → không in
"chuông" bảo user về sau nhờ Claude — **đề nghị sửa luôn tại chỗ**.
**Effort**: S1 ≈ XS–S (sửa 1 SKILL.md) · S2 ≈ XS (sửa 1 workflow yml) — tổng ≈ **XS–S, zero code mới**.
**Đóng spec**: qua `/spec-close 079`.

---

## 1. Bối cảnh — 2 gap thật còn lại của vòng đời corpus

Sau 078 (promote-the-build đã có chuông), vòng đời corpus còn đúng 2 điểm mù, cả hai chỉ phát sinh
**khi corpus thay đổi** — và hiện không surface ở đâu người nhìn:

- **Enrichment-gap**: nguồn *indexed* nhận file mới qua cron C3 → vào `index.json` nhưng **thiếu entry
  `enrichment.json`** → vô hình với BM25 `--name` (E2b). CLI phát hiện đã có (`enrich.py --check /
  --list-missing` — index-keyed) nhưng phải nhớ chạy tay.
- **Provenance-stale**: upstream đổi/xoá file gốc của một template đã chưng cất → `check_provenance.py`
  phát hiện stale/orphan nhưng **CI non-strict = warn chìm**, không ai đọc (đã document ở
  templates-and-promotion.md §8).

Cả hai là sự kiện **hiếm** (upstream ngủ đông là chính) → không đáng bề mặt mới; đáng đúng 2 mối nối
tại seam có sẵn.

## 2. Nguyên tắc

- **Zero cơ chế mới** — không field, không DevPanel, không CLI mới; chỉ nối output 2 CLI sẵn có vào
  2 seam sẵn có. Advisory thuần: không block update, không block PR.
- **Sửa-tại-chỗ hơn chuông**: trong session skill, phát hiện đi kèm **đề nghị làm ngay** (human gật);
  trong PR cron (không LLM), chỉ **báo cáo** để người đọc lúc review.
- **Human-gated giữ nguyên**: enrichment do Claude viết trong session vẫn là bản user thấy trước khi
  commit; re-distill luôn qua `/template-promote` per-file.

## 3. Cơ chế — neo đã verify

- `.claude/skills/corpus-update/SKILL.md` — Procedure 3 bước (`:16-37`) + mục Follow-up (`:39`); S1
  chèn sau bước 3.
- `.github/workflows/sync-corpus.yml` — `update_corpus.sh --all` (`:59`) → `create-pull-request@v6`
  với `body:` (`:73-76`); S2 sinh báo cáo ở run-step trước rồi nhét vào body.
- `tools/dify_base/enrich.py` — `--check` (missing/stale/orphan, advisory) · `--list-missing`
  (index-keyed → tự đúng với `indexed:false`: nguồn intake-only không vào index nên không bị báo oan).
- `tools/dify_base/check_provenance.py` — mặc định quét **cả** `templates/library` + `patterns`
  (`:130`), non-strict exit 0 (advisory sẵn) — dùng nguyên trạng, KHÔNG bật `--strict`.

## 4. Slices

### S1 — `/corpus-update`: 2 bước hậu-update, đề-nghị-sửa-tại-chỗ (XS–S)
Thêm vào SKILL.md sau bước 3 (Report):

4. **Enrichment gap** — chạy `enrich.py --check`. Có key missing/stale → liệt kê + hỏi user:
   *"Enrich ngay trong session này?"* → gật thì viết entry (`summary_en/tags/when_to_use/gotchas`)
   vào `enrichment.json`, chạy lại `build_index.py`, báo diff. Không gật → ghi nhận, thôi.
5. **Provenance stale** — chạy `check_provenance.py` (non-strict). Có stale/orphan → in verdict +
   hỏi: *"Xem diff upstream & chưng cất lại qua `/template-promote`?"* → gật thì mở diff file gốc và
   dẫn vào skill; không → thôi. (Orphan do upstream xoá: nêu lựa chọn giữ-làm-original / retire.)

- Guard chống nhiễu: 2 bước chỉ chạy **sau một update thật sự áp dụng** (bước 2 đã chạy); `--check`
  sạch thì im lặng hoàn toàn — không thêm dòng nào vào output.

### S2 — Cron C3: 2 khối báo cáo trong body PR (XS)
Trong `sync-corpus.yml`, sau bước update + rebuild: chạy `enrich.py --check` và
`check_provenance.py`, capture output (multiline → `$GITHUB_OUTPUT`/file), **append vào `body:`** của
`create-pull-request` dưới 2 heading:

```
### Enrichment gaps (advisory)
<output --check, hoặc "none">
### Provenance staleness (advisory)
<output check_provenance, hoặc "all current">
```

- Hai lệnh bọc `|| true` — advisory, **không bao giờ** fail workflow. PR không có gap in "none" — người
  review khỏi đoán "quên chạy hay sạch thật".

## 5. Guard / test phải xanh
- Không code Python/TS mới → không test unit mới bắt buộc. `tests/test_e2e_check.py`,
  `test_enrich.py`, `test_provenance.py` hiện có **không đổi**.
- `sync-corpus.yml` sau sửa phải qua `yaml.safe_load` (sanity như review 077) + chạy tay
  `workflow_dispatch` một lần xác nhận body render đúng markdown.
- SKILL.md: skill là văn bản quy trình (khuôn corpus-update hiện tại) — nghiệm thu bằng một lần chạy
  `/corpus-update` thật khi có update (hoặc mô phỏng bằng cách reset clone về SHA cũ).

## 6. Open questions
1. S1 bước 4, nguồn `indexed:false` lật sang `true` trong tương lai → lượng missing lớn (vd 46 file
   svcvit-zh): enrich cả loạt trong 1 session hay chia đợt? Đề xuất: chia đợt ≤15 file/lần để user
   còn duyệt nổi. Chốt khi ca đầu tiên xảy ra.
2. Orphan (upstream xoá file gốc) — default khuyến nghị là gì? Đề xuất: giữ template + đổi
   provenance thành `source=original` (nó đã sống độc lập), chỉ retire khi user muốn. Chốt khi gặp.

## 7. Non-goals (đã cân và LOẠI — đừng đề xuất lại)
- **Chuông distill-hint (đếm tham chiếu corpus trong find_query)** — LOẠI: build thành công là bản
  chưng cất tốt hơn file corpus gốc; nudge 078 + promote 052 (có distill turn) phủ trọn. Đề xuất lại
  = lặp sai lầm E4.
- **Auto-enrich trong cron** — CI không có LLM; enrichment cần mắt người duyệt trước commit.
- **Chuông cho nguồn `indexed:false`** — vô hình là thiết kế (spec 023); đường của intake-only là
  browse tay + `/template-promote`.
- **DevPanel field cho 2 gap này** — sai bề mặt: sự kiện corpus không xảy ra lúc build.
- **Bật `--strict` cho check_provenance ở CI** — đổi hợp đồng warn-only đang cố ý; ngoài phạm vi.
