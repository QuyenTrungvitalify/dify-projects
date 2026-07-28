# Đánh giá — hệ thống chưng cất & nguồn tham chiếu (reference data)

> **Loại: doc tham chiếu (evaluation), không phải state-doc, không phải spec.** Chụp hiện trạng
> 2026-07-23 của pipeline promotion/distillation + tầng bơm reference vào build, đối chiếu với
> nghiên cứu SOTA. Chưa có quyết định triển khai — roadmap ở §C là đề xuất, không phải cam kết.
> Cơ chế chi tiết vẫn thuộc [state/templates-and-promotion.md](state/templates-and-promotion.md) và
> [state/knowledge-system.md](state/knowledge-system.md); doc này chỉ *đánh giá*, không sở hữu cơ chế nào.

## Bối cảnh câu hỏi

"Hệ thống chưng cất" = pipeline promotion/distillation: chưng cất một workflow (corpus hoặc YAML dán)
thành template tái dùng, rồi hệ thống cấp "nguồn tham khảo" cho AI mỗi lần build. Câu hỏi: làm cho
**nguồn tham chiếu & data liên quan giàu hơn**, đặc biệt cho domain phân tích data.

Reference data đến build qua **2 kênh máy** ở phase Implement ③: `{{PATTERN_PATH}}` (1 pattern được
chọn) + `{{REFERENCES}}` (ví dụ bù gap). Cả hai được nuôi từ **đúng 1 tầng** (`source==='patterns'`)
và **1 vector cờ boolean**, **không có tầng ngữ nghĩa**.

Hiện trạng đo được (index.json): `patterns`=11 · `library`=1 · `example`=1 · `skill-assets`=5 ·
`corpus:awesome-dify-workflow-en`=26 → **44 file**. Corpus = **1 source** duy nhất, `ref: main`
(không pin), mô tả đa phần tiếng Trung.

## A. Sáu "trần" giới hạn độ giàu (có neo file:line)

| # | Trần | Neo | Hệ quả |
|---|---|---|---|
| 1 | **Reference chỉ rút từ `patterns` (11 file)** | `apps/builder/server/lib/analysis.ts:33` `filter(source==='patterns')` (dùng chung cho cả chọn pattern lẫn `gapReferences`) | Library (1) + corpus (26) **không bao giờ** được bơm. Nguồn giàu nhất không nuôi build. |
| 2 | **Chặn cứng `max=2` + path hardcode tầng** | `analysis.ts:124` (`max=2`), path hardcode `:150` (`templates/patterns/${file}`), allowlist `:131-133` (`^[A-Za-z0-9_-]+\.yml$`) | Tối đa 2 ref. **Blocker thật khi mở pool = path hardcode `:150`** — emit `templates/patterns/<file>` cho mọi entry, nên tầng ≠ patterns (vd `chart_demo.yml`) ra **sai đường dẫn**, phải map path theo `source`. Allowlist chỉ phụ: **20/27** file corpus *lọt* regex, chỉ 7 (space/CJK) bị chặn — regex là guard traversal load-bearing (implement.md bảo ③ mở path không kiểm), không phải rào corpus. |
| 3 | **Chỉ khớp feature-flag, không semantic** | `build_index.py:67-73` (`INTERESTING_NODE_TYPES`, 18 type đóng); `find.py:126-146` (boolean AND + substring); `analysis.ts:40-46` | Hỏi theo *ý định* không match; vocab đóng → node lạ vô hình. |
| 4 | **Mô tả là passthrough thô (tiếng Trung/rỗng)** | `build_index.py:138` (cắt 100 ký tự, không summarize/tag) | `chart_demo`=`一个图表渲染的示例`; `matplotlib`/`json-repair`/`AdvancedSearch`(44 node)=rỗng → **data phân tích đã có sẵn nhưng vô hình với tra cứu theo ý định**. |
| 5 | **Precedence chỉ là văn xuôi** | `find.py:148` sort `(complexity, source, file)` alphabet → `corpus:*` đứng **trước** `patterns` | Đọc top-down dễ lấy mẫu thô trước mẫu curated; `patterns>library>project>corpus:*>skill-assets` là prose ở `INDEX.md`+`AGENTS.md`, **không code nào cưỡng chế**. |
| 6 | **Kho curated gần rỗng + corpus đơn nguồn** | `library`=1; `starter` luôn rỗng (glob `*.yml` trượt `.dify-workspace.yaml`); `probes` không index; `corpus/sources.yml:26-32`=1 source `ref: main` | Ít vật liệu để chọn; upstream đổi là số trôi (`test_docs_drift.py` chỉ gác *số file*, không gác nội dung). |

**Chẩn đoán cốt lõi:** data phân tích-data *đã tồn tại* trong corpus (`chart_demo`, `matplotlib`,
`json-repair`, `AdvancedSearch`) nhưng bị (a) mô tả rỗng/tiếng Trung → không tra ra, và (b) tầng inject
loại bỏ. **Vấn đề không phải thiếu data — là data không được mô tả và không được dẫn vào build.**

Phụ: `find_query` (retrieval ① đã chạy) được lưu làm provenance rồi **vứt**, không tái bơm vào build
(`analysis.ts:178-184`).

## Độ an toàn khi tái thiết kế

- **An toàn (chưa test):** `find.py` **không có test nào** (sort/prefix-match/AND/rc=1); tầng semantic
  của index (`complexity` heuristic, truncation, vocab) không có unit test; nội dung `INDEX.md` không
  được gác (chỉ số file).
- **Phải thương lượng (đang bị pin):** `apps/builder/test/gap-references.test.ts` (`:38` assert đúng 1
  path patterns; `:85-105` assert tên kiểu-corpus bị **từ chối** — mở corpus sẽ đảo test này);
  `analysis.test.ts`; guard lint tầng patterns (`test_lint_refs.py`, `test_validate_workflow.py`,
  `test_pattern_consistency.py` — quét **chỉ** `templates/patterns/*.yml`).

## B. Phán quyết SOTA — mô hình tối ưu ở quy mô này

Ở **44 → vài trăm example, offline**, bằng chứng **KHÔNG** ủng hộ nhảy lên dense-embedding +
cross-encoder reranker: reranker giải bài "sắp xếp trong pool lớn/recall" — quy mô này ≈ cả pool là
candidate, không có bài đó. Khoảng trống ngữ nghĩa đang cảm thấy đến từ **mô tả bẩn (tiếng Trung/rỗng)**
— sửa trực tiếp được, không cần vector store.

> **Điểm ngọt = tầng enrichment do LLM sinh** (summary tiếng Anh + tag chuẩn hoá + "when to use" +
> gotchas) đặt **trên** index lexical hiện có, rồi rank bằng **TF-IDF/BM25 cosine + 1 lượt MMR đa
> dạng**. Đạt ~80% lợi ích dense-search, giữ repo pure-Python/offline, không kéo theo torch.

Bằng chứng chính (đã verify nguồn):
- Relevance ≫ random: KATE (arXiv 2101.06804); code few-shot BLEU 33→65 (arXiv 2304.11384).
- Diversity/MMR giúp task cấu trúc/compositional: SIGIR 10.1145/3726302.3730194; coverage-selection
  arXiv 2305.14907.
- Corpus nhỏ (<100 doc): TF-IDF/BM25 thường đủ; reranker ROI phụ thuộc quy mô (pyimagesearch;
  digitalapplied hybrid-search reference).
- Tầng semantic không-vector: Document Summary Index (LlamaIndex); LLM auto-tagging/metadata
  enrichment (arXiv 2512.05411).
- Bank curated-verified ≫ corpus thô: Voyager (arXiv 2305.16291, verified-before-store); Reflexion
  (lưu *vì sao* fail); Generative Agents (rank = recency×relevance×**importance**, không chỉ cosine).
- Chỉ vượt vài-trăm-entry-Anh-sạch + query nặng paraphrase mới cân nhắc `bge-small-en` CPU
  (HF BAAI/bge-small-en-v1.5); cross-encoder reranker: chưa cần.

Caveat: không nguồn nào benchmark riêng Dify-YAML few-shot selection → đây là suy luận chuyển giao từ
code/structured-gen lân cận. Nên **A/B rẻ tại chỗ** trên harness `/report` (hoặc `/e2e`, `/campaign`)
để chốt bằng số.

## C. Lộ trình cải thiện đồng bộ (đề xuất, xếp theo ROI)

**Tier 1 — đòn bẩy lớn nhất, pure-Python/offline:**
- **T1.1 — Tầng enrichment (lever #1).** Script offline sinh mỗi entry: `summary_en`, `tags`
  (domain: `data-analysis`/`translation`/`notify`…, topology), `when_to_use`, `gotchas`; lưu file
  **tracked** (vd `tools/dify_base/enrichment.json`, vì `index.json` gitignored/regenerated),
  `build_index.py` merge vào index. → xử tận gốc trần #3+#4.
- **T1.2 — Relevance ranking trong `find.py`.** Thay sort-alphabet bằng BM25/TF-IDF cosine trên text
  enriched; feature-flag hạ xuống soft-boost/pre-filter (không AND cứng zero-out); **cưỡng chế
  precedence bằng tier-weight**. Thêm test (hiện 0). → trần #5. **Ràng buộc:** `find.py` hiện thuần
  stdlib (`json/argparse/pathlib`) và requirements không có scikit/numpy → **viết tay BM25 (~40 dòng,
  zero-dep)**, KHÔNG kéo scikit-learn vào công cụ này.
- **T1.3 — Mở pool reference.** `analysis.ts:33/150`: cho `gapReferences` rút thêm tầng, **emit path
  thật theo `source`** (blocker chính là hardcode `templates/patterns/${file}` ở `:150`, không phải
  allowlist regex), giữ traversal-guard. Nâng `max` + lượt MMR. Thương lượng lại
  `gap-references.test.ts`. → trần #1+#2. **Thứ tự an toàn: `library`-first.** Corpus 100% DSL 0.1.x
  (xem §D) → mở tới `library` (đã migrate 0.6.0 + lint-vet qua T2.3) TRƯỚC; corpus thô chỉ vào sau
  dưới khung "reference-only, adapt". ⇒ **T2.3 gắn chặt/đi trước T1.3.**

**Tier 2 — nếu chất lượng còn hụt:**
- **T2.1** Complexity-matching (đã có `complexity`+`node_count`).
- **T2.2** Quality-weight: ưu tiên template đã-approve hơn corpus thô (importance của Generative Agents).
- **T2.3** Chưng cất data-analysis: `/template-promote` đưa `chart_demo`/`matplotlib`/`json-repair`
  lên `library/` (đồng thời nuôi T1.3).
- **T2.4** Mở corpus registry: thêm source Dify permissive thiên data-analysis vào `sources.yml`,
  **pin `ref`**.

**Tier 3 — chỉ khi vượt ngưỡng quy mô:** `bge-small-en` CPU dense (chấp nhận torch) sau vài trăm
entry Anh sạch; cross-encoder reranker — chưa cần.

## D. Guardrail đồng bộ (không thể bỏ)

Bơm corpus thô làm reference = đưa DSL **chưa-lint, DSL CŨ, đa ngôn ngữ** vào prompt build. Định lượng:
**toàn bộ 27 workflow corpus là DSL 0.1.0/0.1.2/0.1.3**, repo pin 0.6.0 → shape 0.1.x import sạch rồi
có thể chết runtime. **"Richer" ≠ "safe".** Vì thế con đường tối ưu là **library-first** (§C, T1.3):
`/template-promote` (T2.3) migrate DSL + lint-vet + provenance khi lên `library/`, nên mở pool tới
`library` an toàn; corpus thô chỉ vào sau, bắt buộc (a) đóng khung "reference-only, adapt" hoặc (b)
pre-check lint trước khi inject. Validate cả roadmap bằng A/B enriched-lexical+MMR vs hiện tại trên
harness `/report`.
