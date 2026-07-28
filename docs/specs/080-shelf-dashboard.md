# Spec 080 — Shelf Dashboard: màn hình dev "kệ tham khảo đang giàu đến đâu"

**Status**: Draft **v1.1** (2026-07-28) — self-review vá 4 điểm: (1) **timeline promote phải parse
CẢ `templates/patterns/`** — `finalizePromotion` đóng dấu `x-provenance` vào patterns
(`promote.ts:310-336`), chỉ đọc `library/` sẽ mù đúng các promote mà nudge 078 tạo ra (panel
flywheel báo "đứng" trong khi nó chạy); (2) doctor trong stats chỉ live-parse **curated** (~12
file), house-collision derive từ `collected.json` — sửa claim perf mâu thuẫn (doctor() nguyên bản
parse cả nhà); (3) thêm **`seed_coverage`** (index N vs seeded M — bắt collected.json stale, kèm
hint `catalog.py seed`); (4) enrichment dùng lại `enrich.check()` (đã có từ 079) cho
missing/stale/orphan thay vì chỉ đếm `summary_en`. + diversity chỉ tính entry trên-kệ (loại
rejected/study từ hunt). **Bài toán**: không có chỗ nào NHÌN được tình trạng data tham
khảo — bao nhiêu mẫu corpus, bao nhiêu template chưng cất (promote), độ đa dạng shape/feature, độ
phủ enrichment, flywheel 078 chạy chưa. Hiện muốn biết phải chạy tay 4–5 lệnh (`find.py
--list-features`, `catalog.py doctor`, đếm `ls templates/…`, đọc `collected.json`) và tự ráp.
**Đầu ra**: MỘT màn hình dev (BUILDER_DEV) trả lời 3 câu trong một cái liếc:
(i) kho có gì, tầng nào bao nhiêu; (ii) lỗ hổng đa dạng ở đâu; (iii) flywheel tự-gặt chạy chưa.
**Effort**: S1 ≈ S–M · S2 ≈ XS · S3 ≈ M — tổng ≈ M. **Đóng spec**: `/spec-close 080`.

---

## 1. Nguyên tắc

- **Read-only tuyệt đối.** Dashboard là kính nhìn, không phải tay gạt: route + CLI stats không ghi
  bất kỳ file nào (khác 078: `catalog.py stats` KHÔNG đụng `collected.json`).
- **Một nguồn số liệu = một parser đã có.** Registry đã có ĐÚNG 2 parser (python `sources.py` + bash
  shim — bẫy S5/075); cấm parser thứ 3 trong TS. Mọi con số compose ở **python** (`catalog.py stats
  --json`), server TS chỉ passthrough. TS không tự đọc index.json/sources.yml để "tiện".
- **Dev-surface only.** Route mount sau cổng `BUILDER_DEV=1` (khuôn `routes/dev.ts`), UI gate
  `devMode` (khuôn RebuildButton/DevPanel). User cuối không bao giờ thấy — "corpus/tier/fingerprint"
  là jargon (spec 063), và đây là công cụ quản kệ, không phải tính năng build.
- **Số đo sống ở runtime, không ở doc** (nối quy ước docs/state): màn hình này chính là chỗ "chạy để
  xem số" — không chép số vào tài liệu.
- **Không chart lib.** Bar/tile bằng CSS thuần (khuôn DevPanel bảng cost) — web app là preact tối
  giản, không thêm dependency cho một màn dev.

## 2. Cơ chế — neo đã verify

- **Cổng dev có sẵn 2 tầng**: server `routes/dev.ts` chỉ được register khi `BUILDER_DEV=1`
  (`index.ts:146`, warn log rõ); web `devMode` runtime flag (`web/src/lib/dev.ts:25`, bật `?dev=1`),
  precedent nút dev trong Sidebar header (`Sidebar.tsx:222` RebuildButton — kèm hint khi server 404
  vì thiếu BUILDER_DEV).
- **Nguồn số liệu — tất cả đã tồn tại, chỉ chưa được ráp**:
  - `tools/dify_base/index.json` — 1 entry/file: `source` (tier), `node_count`, `node_types`,
    `complexity` (Simple/Medium/Complex), toàn bộ `has_*` (từ vựng feature của `find.py`), `plugins`,
    và các trường enrichment 076 đã merge (`summary_en`/`tags`/`when_to_use`/`gotchas`).
  - `tools/dify_base/collected.json` (078 S1) — `entries{tier, fingerprint, node_count, decision,
    date}` + `hunts[]` (nhật ký săn — tiến độ cổng S4 078 đọc từ đây).
  - `catalog.py doctor()` — trả `(problems, notes)` sẵn dạng cấu trúc; chỉ cần expose `--json`.
    ⚠ nguyên bản parse YAML **cả nhà** — trong stats chỉ tái dùng phần **curated live-parse**
    (~12 file, chỗ duy nhất kỳ vọng 0-dup); house-collision derive từ fingerprint đã lưu trong
    `collected.json` (nhanh, và độ lệch seed đã có `seed_coverage` bắt riêng).
  - `provenance.parse_header` (`provenance.py:27`) — đọc `x-provenance … promoted=YYYY-MM-DD
    license=…` trên từng file của **CẢ HAI tầng curated** (`templates/patterns/` +
    `templates/library/`) → timeline chưng cất, không cần log mới. Lý do phải cả hai (v1.1):
    `finalizePromotion` stamp x-provenance vào **patterns** (`promote.ts:310-336`) — promote khởi
    từ nudge 078 nằm ở đó; pattern viết tay không có header → không có ngày, bỏ qua im lặng.
  - `enrich.check(strict=False)` (`enrich.py:121`, có sẵn từ 079) — missing/stale/orphan cho panel
    enrichment; import hàm, không chỉ đếm `summary_en`.
  - `sources.load_sources()` + `read_lock_sha()` — registry + SHA pin (077 C1) → panel nguồn.
- **Đường gọi python từ route**: seam `runPython` (013 D2) — khuôn `report.ts`/`base-import.ts`;
  route dev spawn `catalog.py stats --json`, parse, trả nguyên.
- **Ràng buộc UI đã biết**: composer chip row cấm wrap — dashboard là overlay riêng, không đụng
  composer. View FSM hiện chỉ có `empty`/`conversation` (App.tsx) — **không thêm view thứ 3**;
  overlay toàn màn (khuôn modal import-base) đóng bằng ESC là đủ, FSM literally untouched.
- **Turn confinement không đổi**: `stats` là lệnh read-only nhưng `catalog.py` vẫn NẰM NGOÀI
  allow-set python của turn (permission-gate.test.ts đã ghim) — route dev chạy ở backend, không
  qua turn, nên không cần (và không được) nới allow-set.

## 3. Slices

### S1 — `catalog.py stats --json` + `doctor --json` (S–M) — NỀN
Một lệnh compose **toàn bộ** số liệu thành một JSON (python-side, theo nguyên tắc một-parser):

```jsonc
{
  "generated_at": "2026-07-28",
  "tiers": [ {"tier":"patterns","count":11}, {"tier":"corpus:awesome-dify-workflow-en","count":26}, … ],
  "total": 44,
  "diversity": {                          // từ collected.json — CHỈ entry trên-kệ (decision
    "unique_fingerprints": 0,             //   shelf/promoted/vendored; loại rejected/study từ hunt)
    "per_tier": [ … ],                    // per-tier: {tier, files, unique_shapes}
    "weak_shapes": 0                      // shape <4 node (tín-hiệu-yếu, hiển thị riêng)
  },
  "seed_coverage": {"indexed":44,"seeded":44,"stale":false}, // lệch ⇒ stale:true + hint `catalog.py seed`
  "features": [ {"key":"has_iteration","count":7}, … ],   // TỪ index.json — trùng từ vựng find.py
  "complexity": {"Simple":15,"Medium":10,"Complex":19},   // + per-tier stack
  "enrichment": {"missing":0,"stale":0,"orphan":0,"per_tier":{…}}, // reuse enrich.check() (079)
  "doctor": {"curated_problems":[…],"house_notes":[…]},   // curated live-parse + house từ collected
  "promotes": [ {"file":"…","tier":"patterns|library","promoted":"2026-06-22","source":"…","license":"…"} ],
  "sources": [ {"name":"…","license":"MIT","indexed":true,"locked_sha":"88842fc…","cloned":true} ],
  "hunts": {"count":0,"last":null,"median_new":null}      // tiến độ cổng S4 (spec 078 §5-b)
}
```

- `stats` đọc: index.json (nếu vắng → `ok:false` kèm lệnh rebuild, KHÔNG tự build), collected.json
  (vắng → diversity null kèm hint `catalog.py seed`), library headers qua `parse_header`,
  registry/lock qua `sources.py`. Không ghi gì.
- `doctor --json` — cùng dữ liệu `doctor()` hiện tại, output máy đọc (stats nhúng lại).
- Test (`tests/test_catalog.py` mở rộng): schema key đủ; số đếm khớp fixture tree; index.json vắng
  → ok:false; collected.json vắng → không crash; feature count khớp `has_*` trong fixture.

### S2 — `GET /api/dev/shelf` (XS)
Thêm vào `routes/dev.ts` (đã sau cổng BUILDER_DEV + Origin-check global + bind 127.0.0.1):
spawn `runPython(projectsDir, ['tools/dify_base/catalog.py','stats','--json'])` → parse → trả.
Lưu ý khuôn: `DevRoutesOpts` hiện chỉ có `{builderDir, port}` — thêm `projectsDir` vào opts (index.ts
đang có sẵn giá trị này khi register routes khác). Python exit ≠ 0 / JSON hỏng → `{ok:false, reason,
tail}` (khuôn dev/rebuild trả 200+ok:false). Không cache — mở màn hình = chạy một lần: YAML
live-parse CHỈ ~12 file curated, phần còn lại là đọc 2 JSON + headers curated (v1.1) — <1s.
- Test: khuôn test route dev hiện có — fake runPython, passthrough shape + nhánh ok:false.

### S3 — Overlay "Shelf" trong web (M)
- **Lối vào**: nút `📊 shelf` trong Sidebar header, CẠNH RebuildButton (`devMode` gate y hệt; server
  thiếu BUILDER_DEV → hint như RebuildButton).
- **Overlay toàn màn** (không phải view thứ 3): ESC/✕ đóng; fetch on-open + nút ↻.
- **Bố cục** (trên → dưới):
  1. **Hàng tile**: Tổng mẫu · unique shapes · enrichment (missing/stale) · doctor badge (✓ curated
     sạch / ✗ N vấn đề). Kèm **chip cảnh báo** khi `seed_coverage.stale` (⚠ "collected.json lệch
     index — chạy `catalog.py seed`") — số diversity dưới đây chỉ đáng tin khi seed tươi.
  2. **Bar theo tầng** (CSS): patterns / library / example / skill-assets / corpus:* — đập vào mắt
     "kệ chưng cất mỏng thế nào so với corpus".
  3. **Feature coverage** — bảng 2 cột (feature · count) sort tăng dần, **highlight count ≤ 1**:
     đây chính là "lỗ hổng đa dạng" — thứ để quyết `/scout` hay build-để-promote tiếp theo.
  4. **Complexity stack** per tier + **enrichment %** per tier (076 phủ đến đâu).
  5. **Flywheel panel** (078): timeline `promotes` (ngày · file · tier · nguồn — CẢ patterns lẫn
     library, v1.1) + dòng tóm "N promote trong 30 ngày qua" · hunts (count/last/median — kèm dòng
     "cổng S4: N/3 hunt, median M") · weak-shapes count.
- Component thuần render-off-props (khuôn DevPanel — không store write); vitest: render đúng số từ
  fixture JSON, không mount khi `!devMode`, nhánh lỗi hiển thị reason.

## 4. Validation — "nhìn một cái là biết"

Mở màn hình phải trả lời được, không cần terminal:
- (a) "Corpus đang có bao nhiêu, promote chưng cất được bao nhiêu?" → hàng tile + bar tầng.
- (b) "Data tham khảo NGHÈO ở đâu?" → bảng feature count ≤1 (ví dụ hôm nay: `has_answer`,
  `has_list_operator`… — số thật lấy lúc chạy).
- (c) "Flywheel 078 có chạy không?" → panel promotes/hunts/doctor — nếu 2 tuần nữa timeline
  promotes vẫn dừng ở 2026-06-22 thì nudge 078 chưa chuyển hoá (khớp §5-a của 078).

## 5. Guard / test phải xanh
- `test_catalog.py` nhóm stats mới (S1) — như slice, cộng 3 case v1.1: (a) promote stamp trong
  `templates/patterns/` PHẢI xuất hiện trong `promotes` (fixture stamp bằng `provenance_header`);
  (b) index có file chưa seed → `seed_coverage.stale == true`; (c) entry decision `rejected` (hunt)
  KHÔNG được tính vào diversity.
- Test route dev (S2) — passthrough + ok:false, khuôn test dev hiện có.
- Vitest overlay (S3) — devMode gate + render số + nhánh lỗi.
- `permission-gate.test.ts` — KHÔNG đổi: catalog.py vẫn ngoài allow-set turn.
- `test_state_docs_ownership` — cập nhật `docs/state/` (ui-surface.md nhận overlay; công thức stats
  ở templates-and-promotion.md đã own catalog.py).

## 6. Open questions
1. **Overlay vs view thứ 3**: đề xuất overlay (FSM untouched). Nếu sau này cần deep-link
   (`?view=shelf`) thì nâng cấp.
2. **Drill-down**: click một feature/tier → list file (path + name)? Đề xuất v2 — v1 chỉ số tổng,
   giữ S3 ở mức M.
3. **Đếm nudge→promote conversion** (078 §5-a cần): đòi event log promote-khởi-từ-nudge — chưa có
   chỗ ghi. Hoãn; v1 chỉ hiển thị timeline promotes (đủ thấy flywheel động/đứng).
4. **Auto-refresh sau promote/corpus-update**: v1 nút ↻ tay là đủ (màn dev, tần suất thấp).
5. **Tags diversity (076)**: index đã có `tags[]` per entry — thêm tile "unique tags" + top-10 là
   một trục "độ giàu" nữa, rẻ (đếm từ index.json trong stats). Đề xuất: CÓ trong S1 JSON
   (`"tags":{"unique":N,"top":[…]}`), UI để v2 nếu S3 chật.

## 7. Non-goals (đã cân, KHÔNG làm)
- **Expose ngoài BUILDER_DEV / cho user cuối** — jargon + không phải job của họ (spec 063).
- **Chart library / SSE realtime** — CSS bars + fetch-on-open; dashboard dev không đáng dependency.
- **Parser registry thứ 3 trong TS** — mọi compose ở python (bẫy S5/075).
- **Bất kỳ đường ghi nào từ dashboard** (kể cả "tiện tay" nút seed/doctor-fix) — kính nhìn thuần;
  hành động vẫn qua CLI/skill có human-gate.
- **Số liệu chất lượng nội dung** (BM25 score, độ tốt mô tả…) — ngoài phạm vi; đây là đếm cấu trúc.
