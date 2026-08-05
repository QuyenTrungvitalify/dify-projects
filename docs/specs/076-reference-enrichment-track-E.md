# Spec 076 — Track E: làm giàu nguồn tham chiếu (enrichment-layer + ranking + mở pool library-first)

**Status**: v4 (2026-07-26) — **E1 + E2 + E2b ĐÃ TRIỂN KHAI & VALIDATED** (xem §9). A/B: retrieval
recall 2→14/15; E2E before/after chứng minh chuỗi khép kín (build "dịch giữ code" từ 1-LLM → mask/restore
2 code node). E3 / E4 còn mở. Hiện thực hoá
[docs/reference-data-enrichment-evaluation.md](../reference-data-enrichment-evaluation.md) (Tier 1 +
T2.3). Là track **E** của chương trình 5-track
([whole-system-source-handling-evaluation.md](../whole-system-source-handling-evaluation.md) §4).
Độc lập với spec 075 (A+B) và track C/D — chạy song song được.
**Effort**: E1 ≈ M · E2 ≈ S–M · E3 ≈ M · E4 ≈ S (content, per-file) — tổng ≈ M–L
**Đóng spec**: qua `/spec-close 076`.

---

## 1. Bối cảnh

Đánh giá SOTA (đã research, verified) chốt: ở quy mô ~44 example offline, **KHÔNG** nhảy embeddings/
reranker; điểm ngọt = **tầng enrichment do LLM sinh + ranking lexical (BM25/MMR)**. Ba nút thắt hiện tại:

- **Bơm reference chỉ từ `patterns` (11 file)** — `analysis.ts:33` `filter(source==='patterns')`; library
  (1) + corpus (26) không bao giờ vào `{{REFERENCES}}`.
- **Không tầng ngữ nghĩa** — mô tả là passthrough thô, đa phần **tiếng Trung/rỗng** (`build_index.py:138`)
  → data phân tích (`chart_demo`/`matplotlib`/`json-repair`) **vô hình với tra-theo-ý-định**.
- **`find.py` sort alphabet** (`find.py:148`) — corpus đứng trước patterns; precedence chỉ là prose.

## 2. Nguyên tắc (giữ khi implement)

- **Repo runtime giữ pure-Python/offline/zero-network.** Enrichment do LLM sinh **offline, commit vào
  tree**; `find.py`/build vẫn thuần stdlib, deterministic. **KHÔNG** kéo scikit/numpy/torch — BM25 **viết
  tay ~40 dòng**.
- **"Richer ≠ safe".** Corpus **100% DSL 0.1.x** (repo pin 0.6.0) → **library-first**: mở pool tới
  `library` (đã migrate + lint-vet qua promote) TRƯỚC; corpus thô chỉ vào sau, đóng khung
  "reference-only, adapt". Reference không được là DSL chưa-lint bơm thẳng như "mẫu để chép".
- **Precedence thành luật thật, không prose** — `patterns > library > project > corpus:* > skill-assets`
  phải là sort-key trong `find.py`, không để alphabet quyết.
- **Không phá guard tầng patterns** — lint/consistency (`test_pattern_consistency.py`,
  `test_lint_refs.py`) chỉ áp `patterns`; mở pool sang tầng khác **không** được ngầm đòi chúng phải sạch
  như patterns — phải đóng khung là "tham khảo", không phải "template vetted".
- **Enrichment là tri thức phái sinh** — lưu tách khỏi file gốc (không sửa corpus/clone read-only), keyed
  theo `source+file+hash` để tái sinh khi upstream đổi.

## 3. Cơ chế — neo file:line

- `apps/builder/server/lib/analysis.ts:28-37` `patternEntries` (`filter source==='patterns'`) — dùng
  chung cho chọn-pattern **và** `gapReferences`.
- `analysis.ts:120-155` `gapReferences` — `max=2` (`:124`), allowlist `^[A-Za-z0-9_-]+\.yml$` (`:131`),
  **path hardcode** `templates/patterns/${file}` (`:150`) ← blocker chính khi mở tầng.
- `apps/builder/server/lib/orchestrator.ts:431` — seam bơm `{{REFERENCES}}` (implement-only).
- `tools/dify_base/build_index.py:76-154` `analyze()` — nơi metadata sinh; `:138` truncate description;
  `:67-73` `INTERESTING_NODE_TYPES` (vocab đóng 18 type).
- `tools/dify_base/find.py:148` sort `(complexity, source, file)`; `:126-146` filter boolean AND.
- `tools/dify_base/index.json` (gitignored) — reader = find.py + analysis.ts; sinh bởi build_index.
- Test bị pin: `apps/builder/test/gap-references.test.ts:38` (assert đúng 1 path patterns), `:85-105`
  (assert tên kiểu-corpus **bị từ chối**). `find.py` **mới chỉ có 1 test** (`tests/test_find_unknown_feature.py`,
  path unknown-feature rc=2 — spec 071 S4); **chưa có** test sort/ranking/prefix/AND — đó là net-add của E2.

## 4. Slices

> **Thứ tự thực thi: E1 → E4 → E3 (E2 chạy song song bất kỳ lúc nào sau E1).** `library` hiện **chỉ có 1
> file** (`seo-slug-generator.yml`, domain SEO — KHÔNG phải data-analysis). E3 mở pool "library-first"
> mà E4 chưa promote `chart_demo`/`matplotlib`/`json-repair` thì E3 **gần như không có vật liệu liên quan
> để bơm**. Vì vậy **E4 là prerequisite cứng của E3**, dù là slice "content, không code" — phải xong (hoặc
> chạy song song trước) E3, không xếp sau như ưu tiên thấp nhất.

### E1 — Tầng enrichment (lever #1, M) — ✅ ĐÃ TRIỂN KHAI (§9)
Script offline (`tools/dify_base/enrich.py` hoặc skill giống `promote`) sinh mỗi entry:
`{ summary_en, tags[], when_to_use, gotchas }`. Lưu **file tracked** `tools/dify_base/enrichment.json`
keyed `source/file` (+ `orig_sha` để phát hiện lệch). `build_index.py` **merge** enrichment vào
`index.json` khi build. Fix tận gốc: mô tả tiếng Trung/rỗng → text Anh tra được; `tags` gồm domain
(`data-analysis`/`translation`/`notify`…) + topology.
- **Sinh bằng LLM, offline, commit** — không nằm trên hot-path; runtime chỉ đọc JSON.
- Test: entry thiếu enrichment → build_index vẫn chạy (degrade, dùng description cũ); enrichment lệch
  `orig_sha` → cảnh báo stale.

### E2 — Relevance ranking trong `find.py` (S–M) — ✅ ĐÃ TRIỂN KHAI (§9)
Thay sort-alphabet bằng **BM25/TF-IDF cosine viết tay** (zero-dep) trên text enriched (summary_en +
tags + name). Feature-flag hạ xuống **soft-boost/pre-filter**, không AND-cứng zero-out. Precedence thành
**tier-weight** trong sort key. **Thêm test đầu tiên cho find.py** (sort, prefix-match, AND, rc=1).
> **Đã làm (§9):** (a) precedence tier-weight (`source_rank`); (b) `--name` chuyển từ substring →
> **BM25 zero-dep** trên text enriched (IDF toàn index; normalize hyphen→space), có substring-fallback
> để không bao giờ tệ hơn cũ; (c) test ranking đầu tiên cho find.py. **Quyết định Q2:** BM25 (k1=1.5,
> b=0.75), KHÔNG scikit — vì A/B cho thấy substring là nút thắt thật (xem §9), token-ranking đóng gap.
- Test: query "phân tích CSV vẽ chart" → `chart_demo`/`matplotlib` lên top (sau E1); patterns xếp trước
  corpus cùng độ liên quan.

### E3 — Mở pool reference, library-first (M) — **cần E4 xong trước**
`analysis.ts`: `gapReferences` rút thêm tầng **`library`** (corpus **chưa**, để E4/track sau), **emit
path thật theo `source`** (bỏ hardcode `:150`), giữ traversal-guard. Thêm **lượt MMR** chọn ref đa
dạng; nâng `max` có kiểm. **Thương lượng lại** `gap-references.test.ts` (đảo assert patterns-only).
- Test: gap phủ bởi 1 pattern + 1 library → cả hai được emit đúng path; ref library gắn nhãn
  "adapt-first" trong prompt.

### E4 — Chưng cất data-analysis vào `library` (content, S mỗi file) — **prerequisite của E3**
Dùng `/template-promote` đưa `chart_demo`/`matplotlib`/`json-repair` (corpus) → `templates/library/`
(migrate 0.6.0 + lint-vet + provenance). Nuôi vật liệu sạch cho E3. Per-file, human-gated (skill sẵn có).
- Không code, nhưng **phải xong (hoặc song song) TRƯỚC E3**: library hiện chỉ 1 file SEO, không đủ để E3
  bơm gì liên quan. Đây là điều kiện cần để E3 có vật liệu data-analysis để mở tới.

## 5. Validation (bắt buộc — SOTA khuyến nghị)
**A/B trên harness `/report`** (hoặc `/e2e`, `/campaign`): so bản enriched-lexical+MMR (E1+E2+E3) vs
hiện tại trên cùng bộ prompt. Chốt bằng số, không cảm tính — vì không nguồn nào benchmark riêng
Dify-YAML few-shot selection.

## 6. Guard / test phải xanh
- `gap-references.test.ts` — E3 **đổi hợp đồng** (từ patterns-only → +library); update có chủ đích.
- `find.py` tests sort/ranking/prefix/AND (E2) — **net-add**, coexist với `tests/test_find_unknown_feature.py`
  đã có (đừng xoá nhầm nó khi thêm file test mới).
- `test_pattern_consistency.py`/`test_lint_refs.py` — **không đổi** (vẫn chỉ áp patterns); E3 không được
  làm chúng đòi library/corpus phải sạch như patterns.
- `test_docs_drift.py` — E1 đổi nội dung INDEX; giữ số file trong dải + headline README khớp.

## 7. Open questions
> **Q1 + Q2 phải chốt TRƯỚC khi bắt đầu E1/E2** (quyết định trực tiếp hình dạng code). Q3 + Q4 chốt sau
> khi có số A/B.

1. **[chốt trước E1] Enrichment sinh bằng gì** (E1) — skill riêng (giống `promote`, human-gated) hay
   script 1-lần? Tái sinh khi corpus refresh: tự động (build_index phát hiện `orig_sha` lệch → cảnh báo)
   hay lệnh tay?
2. ~~**[chốt trước E2] BM25 vs TF-IDF cosine** (E2)~~ — **ĐÃ CHỐT (§9): BM25 k1=1.5/b=0.75, zero-dep**,
   IDF toàn index, có test ranking. A/B chứng minh (recall 2→14/15).
3. **`max` reference sau khi mở pool** (E3) — vẫn 2, hay 3–4 khi có MMR đa dạng?
4. **Corpus thô có bao giờ vào pool** không — hay mãi chỉ library? (nếu có: cần pre-check lint + khung
   adapt-first mạnh hơn) → có thể tách thành slice E5 sau khi đo A/B.

## 8. Non-goals (KHÔNG làm trong spec này)
- **Embeddings/dense retrieval/reranker** — SOTA loại ở quy mô này; chỉ cân nhắc khi >vài trăm entry
  Anh-sạch + query paraphrase-heavy (`bge-small-en` CPU). Ghi để không đề xuất lại.
- **Field per-source `language/domain/priority` + filter** — đó là **track D** (đụng 2 parser); E dùng
  `tags` per-entry của enrichment, không phải field registry.
- **Bơm corpus thô làm reference** — hoãn (open Q4); library-first trước.
- **Đổi vocab `INTERESTING_NODE_TYPES`** — enrichment `tags` phủ nhu cầu ngữ nghĩa mà không cần mở vocab.

## 9. Trạng thái triển khai (2026-07-26)

**Đã ship — E1 (đầy đủ) + E2 (phần precedence & enriched-search):**

- **`tools/dify_base/enrich.py`** (mới) — quản lý tầng enrichment: schema-validate, `orig_sha256`,
  `--check` (missing/stale/orphan, advisory), `--list-missing`, `--strict`. `merge_enrichment()` dùng
  chung với build. Reuse `provenance.sha256_file` (cùng cơ chế phát hiện drift với promotion).
- **`tools/dify_base/enrichment.json`** (mới, tracked) — **44/44 entry** có `{summary_en, tags,
  when_to_use, gotchas, orig_sha256}`. Sinh offline bằng LLM (đọc YAML thật), tách khỏi corpus read-only.
- **`build_index.py`** — merge enrichment vào `index.json` lúc build (degrade khi thiếu; cảnh báo khi
  `orig_sha256` lệch). INDEX.md `Description` giờ ưu tiên `summary_en` → hết CJK/rỗng.
- **`find.py`** — `source_rank` tier-weight thay sort-alphabet (precedence thành luật); `--name` chuyển
  từ substring → **BM25 zero-dep** (`_bm25_scorer`, k1=1.5/b=0.75, IDF toàn index, hyphen→space) với
  substring-fallback; `--full` in summary/tags; `DIFY_INDEX_PATH` env để test được.
- **Tests (mới, +21)** — `tests/test_enrich.py` (schema/merge/degrade/stale), `tests/test_find_ranking.py`
  (precedence order + BM25 multi-word/hyphen + rank-best-first). Toàn bộ pytest **344 passed**; node suite
  **không đổi** (1 fail duy nhất là `phase-doc-links` — **pre-existing**, không do track E).
  `gap-references.test.ts` **chưa đụng** (hợp đồng patterns-only còn nguyên — E3 mới đảo).
- **Governance**: `enrich.py`/`enrichment.json` đã khai chủ ở `docs/state/templates-and-promotion.md`.

**A/B (offline, tầng retrieval, cùng `find.py`, 15 query data-analysis kiểu người dùng):**

| Arm | recall@5 |
|---|---|
| baseline (không enrichment, substring) | **2/15** |
| E1 (enrichment + substring) | **4/15** |
| E1 + E2-BM25 (enrichment + token ranking) | **14/15** |

Phát hiện then chốt: **enrichment TEXT đúng nhưng substring `--name` không tiêu hoá được** ("data
analysis" ≠ tag "data-analysis", "chain of thought" ≠ "chain-of-thought", "repair json" ≠ "Repairs …
JSON"). BM25 tokenized đóng đúng gap đó → đây là bằng chứng khiến BM25 (Q2) được ưu tiên NGAY, trước
E3/E4. `--name "data analysis"` → `matplotlib`+`chart_demo` lên top; `--name "repair json"` → `json-repair`
đầu. (Chỉ "tokenize" còn trượt — morphology thuần, chấp nhận.)

**A/B end-to-end (4 build thật qua `/e2e`, deploy=none) — phát hiện lớn:**

| Prompt (VI) | `find_query` phase ① | `--name`? | Build |
|---|---|---|---|
| CSV → biểu đồ cột | `--has file-input --has code --full` | ❌ | valid, echarts bar chart (stdlib) |
| dịch markdown giữ code | `--has llm --has template-transform` | ❌ | valid, 1 LLM — **bỏ lỡ `example/main.yml`** |
| đọc URLs → tóm tắt bảng | `--has iteration --has http-request --has llm` | ❌ | valid, iteration+http+template |

**4/4 build dùng `--has`, 0 dùng `--name`.** Gốc: `analyze.md:84`/`spec.md`/`implement.md` chỉ dạy
`find.py --has <feature>`; **`--name` KHÔNG được nhắc ở bất kỳ skill nào**. ⇒ Cải tiến E1/E2 (BM25
`--name`) đúng và có test, **nhưng nằm trên path Builder không đi**, nên chưa chuyển thành lift chất
lượng build.

**Upside định lượng (chạy `--name` offline cho đúng 3 prompt):** intent-search surface **đúng ví dụ
chuyên biệt lên top** cả 3 — `chart_demo`/`matplotlib`; **`example/main.yml` md_en2ja** (đúng cái mask/
restore code mà build B bỏ lỡ); **`Jina Reader Jinja`** (đúng shape đọc-URL→tóm-tắt→bảng). `--has`
feature-match + ưu tiên patterns thì trượt chúng.

### E2b — intent `--name` trong analyze — ✅ ĐÃ TRIỂN KHAI + VALIDATED
Sửa `analyze.md`: bước "pattern" thành **hai lượt** — feature pass (`--has`) GIỮ nguyên, thêm **intent
pass** `find.py --name "<English intent keywords>" --full` (dịch intent của requirement sang từ khoá
Anh), đọc top hit để định hình `pattern` + `planned_nodes` (khung "reference — adapt, don't clone"). Ghi
cả 2 lệnh vào `find_query`. **Chỉ guidance, không đụng runtime/code.** Node suite/pytest không đổi.

**A/B before/after (cùng prompt "dịch markdown giữ code", `/e2e`):**

| | pattern-pick phase ① | shape build ra | giữ code block |
|---|---|---|---|
| trước E2b (run …416898) | chỉ `--has llm --has template-transform` | `start → llm → end` | ❌ mong manh (chỉ nhờ prompt) |
| **sau E2b** (run …663337) | `--has code --has llm` **+ `--name markdown-translate`** | `start → code → llm → code → end` | ✅ mask/restore (đúng `example/main.yml`) |

Lint 0/0/0 cả hai. Intent pass surface `example/main.yml` (md_en2ja) và model tái tạo đúng shape 2 code
node che/khôi phục — **chuỗi E1→E2→E2b khép kín: enrichment → BM25 rank → analyze tra intent → build
tốt hơn thật.** Giá trị E1/E2 đã được mở khoá.

### Đóng track E (quyết định 2026-07-27)
E2b đã đóng vòng: enrichment → BM25 → analyze tra intent → build tốt hơn thật (E2E chứng minh). **Quyết
định: dừng feature, chốt track E ở E1+E2+E2b.** Lý do dựa trên bằng chứng, không phải bỏ dở:
- **E3/E4 ROI thấp sau E2b** — intent-search đã dẫn model tới ví dụ chuyên biệt qua đường analyze; không
  cần đụng `gapReferences` (đảo hợp đồng test) hay migrate DSL.
- **E4 còn phản-chỉ-định một phần** — E2E cho thấy model **cố ý tránh matplotlib** (bẫy sandbox) và chọn
  echarts; promote `matplotlib` lên `library/` làm "seed sạch" có thể phản tác dụng. Nếu làm E4, cân nhắc
  BỎ matplotlib, chỉ promote `json-repair` (+ `chart_demo` nếu vet kỹ endpoint).
- **Regression lock**: thêm suite entry `code-preserve-translate` (`apps/builder/scripts/e2e-suite.yml`)
  — canh E2b không âm thầm quay lại single-LLM (validated: 4 AUTO-PASS/0 FAIL trên run 1785076663337).

**Còn mở (không cam kết — mở lại nếu A/B end-to-end sau này cho thấy cần):**
- **E3** (mở pool `gapReferences` sang library ở ③ implement, emit path theo source, MMR) — cần **E4** trước.
- **E4** (`/template-promote` chart_demo/matplotlib/json-repair → `library/`) — **chưa** (human-gated,
  migrate DSL 0.1.x→0.6.0 cần review người).
- **Đo A/B end-to-end** trên `/report`\|`/e2e`\|`/campaign` (chạy Builder thật) — A/B ở §9 mới là tầng
  retrieval offline; đo E2E để xác nhận chất lượng workflow xuất ra thực sự tốt lên.

**Bước kế tiếp đề xuất:** (1) A/B end-to-end qua `/e2e` trên prompt data-analysis để xác nhận lift
retrieval chuyển thành lift chất lượng build; (2) nếu build vẫn hụt vì **thiếu mẫu 0.6.0 sạch** cho
data-analysis → E4 (promote `chart_demo`/`matplotlib`/`json-repair`) rồi E3 (mở pool `gapReferences`).
Không mở corpus thô (Q4) tới khi có số.

### Đo lại điều kiện mở-lại (2026-08-05) — điều kiện KHÔNG kích hoạt, E3/E4 tiếp tục park ✅

Chạy đúng "bước kế tiếp (1)": `/e2e` prompt JA json-repair (vùng mà ví dụ chuyên biệt CHỈ có trong
corpus 0.1.x — đúng kịch bản "thiếu mẫu 0.6.0 sạch" nếu có). Run `1785891839496`:
- `find_query` = `--has llm --has code ; --name repair --full` — **cả hai lượt E2b đều chạy**;
  intent pass surface `corpus json-repair.yml` lên **top-1**.
- Build: start → code → end, **4 linter 0/0/0, probe ok**; code node tự dựng **vượt** ví dụ corpus
  (bóc code-fence + lời giải thích, sửa quote string-aware, cân bằng ngoặc string-aware, guard
  None/rỗng, fail-có-理由 JA) — model đọc reference qua đường analyze rồi TÁI TẠO đúng shape,
  không cần `gapReferences` bơm ở ③.
⇒ Build **không hụt** vì thiếu mẫu 0.6.0 sạch; cộng với chuỗi bằng chứng cũ (markdown-translate
sau E2b, CSV→chart echarts) → **quyết định 2026-07-27 đứng vững, nay có thêm số**: E3/E4 giữ park,
chỉ mở lại nếu một campaign sau này cho thấy lớp build data-analysis hụt CÓ HỆ THỐNG (n≥2) mà
nguyên nhân trỏ về thiếu reference ở ③.
