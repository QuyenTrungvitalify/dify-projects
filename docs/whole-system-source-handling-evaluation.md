# Đánh giá toàn hệ — mô hình xử lý & vận hành với nguồn data tham chiếu

> **Loại: doc tham chiếu (evaluation), không phải state-doc, không phải spec.** Chụp hiện trạng
> 2026-07-25 của mô hình xử lý build + cách hệ làm việc với nguồn data, trên các trục hiệu năng /
> tốc độ / linh hoạt / nạp nguồn / đồng bộ. Phán quyết + 5-track roadmap là **đề xuất**, chưa cam kết.
> Cơ chế chi tiết vẫn thuộc `docs/state/*`; doc này chỉ *đánh giá*. Bổ trợ cho
> [reference-data-enrichment-evaluation.md](reference-data-enrichment-evaluation.md) (track E ở đây =
> roadmap của doc đó).

## Nguồn dữ liệu của đánh giá

Ba mũi độc lập (2026-07-25): recon hot-path + risk-surface (tự đo), audit hiệu năng/redundancy
(agent), audit ergonomics/sync/scale nguồn (agent). Con số đo được: engine lõi ~1.566 dòng
(orchestrator 853 + analysis 187 + find.py 187 + build_index 339); khoá bằng **97 test** (20 Python +
77 TS) + **10 state-doc invariant**; **1 source** corpus active (26 entry, DSL 0.1.x); index **không**
rebuild per-build.

## 1. Mô hình xử lý (3 nhịp, đã xác thực code)

- **Tra cứu @ Analyze ①** — `find.py` đọc `index.json`, chọn pattern → `analyze.json`.
- **Bơm @ Implement ③** — nhồi `{{PATTERN_PATH}}` · `{{REFERENCES}}` · `{{SEED_PATH}}` ·
  `{{KNOWLEDGE}}` (harvest **live** từ Dify) · tool-catalog vào prompt. Gated `phaseId==='implement'`
  (`orchestrator.ts:421-436`).
- **Cưỡng chế @ Test ④** — 4 linter dùng JSON Schema chặn shape sai.
- **Nguồn** nạp từ registry phẳng `sources.yml` → clone gitignored (blobless + cone sparse-checkout)
  → index dựng 1 lần ở `setup.sh`/`update_corpus.sh`/promote-finalize (KHÔNG per-build).

## 2. Bảng sức khỏe theo tầng

| Tầng | Sức khỏe | Vấn đề THẬT (neo) | Đã tốt — ĐỪNG đụng |
|---|---|---|---|
| Engine/turn | 🟢 | — | transcript cap 64K/48K (`run-transcript.ts:20`), stderr ring (`claude-session.ts:192`), linter song song |
| Index lifecycle | 🟢 | full-rebuild nhưng **không** chạy trong build (`build_index.py:295`) | không per-build |
| **Harvest `{{KNOWLEDGE}}`** | 🟢 (spec 075 S1) | ~~không Node-timeout → treo ~60s~~ → **đã thêm Node-timeout 15s/arm** (`dify-io.ts` harvestWorkspaceFacts, env `DIFY_HARVEST_TIMEOUT_MS`); vẫn block mỗi Implement + mỗi `/reply` **cố ý** (freshness), TTL-cache HOÃN (§4 S2) | 3 arm `Promise.all` + per-arm timeout |
| Retrieval | 🟡 | đọc lại 50KB index ~2×/Implement, no memo (`analysis.ts:28-37,131`) — **negligible** | find.py 1 parse/lần |
| Nạp nguồn | 🟢 (spec 075 S3/S4/S5) | ~~`validate()` ngoài runtime; parse im lặng; không helper~~ → **`validate()` vào `build_index.py` (license block / field warn)**, **YAML hỏng được nêu tên**, **`sources_admin.py add/doctor`** (ghi phẳng thủ công) | single-entry-add, flat-schema |
| **Đồng bộ (sync)** | 🔴 | sync **thủ công-hoàn-toàn** (schema có cron `refresh-schema.yml:5`, corpus **không**); `ref:main` **không pin → không tái lập**, không lockfile | `update_corpus.sh` đa-nguồn + `--check`/`--all`/`<name>` + idempotent |
| Linh hoạt/scale | 🟡 | thiếu field `language/domain/priority`; INDEX 1 bảng phẳng phình ở 20 nguồn; precedence chỉ prose (`build_index.py:181`) | sparse-checkout, parity-guard 2 parser, `indexed:false` hatch |
| Độ giàu tham chiếu | 🟡 | patterns-only inject, no semantic, corpus 100% DSL cũ | (xem doc enrichment) |

## 3. Phán quyết khách quan — KHÔNG đại tu, tối ưu phối hợp có mục tiêu

**Không viết lại / big-bang.** Ba lý do:
1. **Đã hiệu quả nơi quan trọng** — audit hiệu năng chỉ ra **đúng 1 điểm nóng thật** (harvest). Index
   không per-build, transcript có cap, linter song song, confinement dùng git-delta → không có "mỡ".
2. **Rủi ro chất lượng cao** — 97 test + 10 invariant khoá hệ chặt; big-bang đe doạ đúng thứ cần giữ.
3. **Mọi vấn đề thật đều additive** — không cái nào đòi đổi kiến trúc: chỉ thêm timeout, lockfile,
   field, cron.

→ "Update tổng lực" đúng nghĩa = **chương trình tối ưu phối hợp chạm mọi tầng nguồn, bằng increment
nhỏ có test**, không đụng chất lượng.

## 4. Chương trình tối ưu — 5 track khớp mục tiêu

| Track | Mục tiêu | Việc | ROI/Rủi ro |
|---|---|---|---|
| **A. Tốc độ** | tăng tốc | Harvest: **Node timeout** + **TTL cache** (`/reply` back-to-back tái dùng `workspace.json`) | ⭐Cao/Thấp |
| **B. Nạp nguồn** | dễ nạp | Script `sources add/doctor` (validate **trước** khi ghi + resolve SHA + clone); `validate()` **vào runtime**; báo lỗi parse thay vì nuốt | ⭐Cao/Thấp |
| **C. Đồng bộ** | đồng bộ nguồn | `sources.lock` (SHA resolved, tracked) + cron mirror `refresh-schema.yml` mở PR; dạy updater đọc tag/SHA (`update_corpus.sh:60` hiện chỉ branch) | Trung/Thấp |
| **D. Linh hoạt** | linh hoạt xử lý | Field tùy chọn `language/domain/priority/description`; `find.py --domain/--language`; precedence thành **sort-key thật**; scale INDEX theo source | Trung/Vừa (dạy cả 2 parser + parity test) |
| **E. Giàu tham chiếu** | (đã đánh giá) | enrichment-layer + BM25/MMR + mở pool **library-first** | ⭐Cao/Vừa |

**Thứ tự:** A → B → E → C → D. A+B = quick-win; E = đòn bẩy chất lượng; C+D = nền cho scale nhiều nguồn.

## 5. Danh sách ĐỪNG ĐỤNG (bảo toàn chất lượng)

Flat-schema + dual-parser (bootstrap trước venv — justified), sparse-checkout, `indexed:false`,
transcript caps, linter tách-process (đảm bảo tương đương báo cáo ④), git-delta confinement,
index-không-per-build. Mọi tối ưu **thêm quanh** chúng, không thay.
