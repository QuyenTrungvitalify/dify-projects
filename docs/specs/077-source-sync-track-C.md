# Spec 077 — Track C: đồng bộ & tái lập nguồn (lockfile + updater tag/SHA-aware + cron sync)

**Status**: Draft v2 (2026-07-26 — v2 sửa theo review độc lập thứ 2: fix mâu thuẫn bootstrap-order ở C1
(SHA-pin phải là bước RIÊNG post-venv), + 3 làm-rõ: lock ghi qua helper Python dùng chung, bỏ ghi-lock
lúc `add`, fallback SHA-unreachable). Neo file:line đã verify 100% hai lượt). Track **C** của chương trình 5-track
([whole-system-source-handling-evaluation.md](../whole-system-source-handling-evaluation.md) §4). Nối
tiếp 075 (A+B, đã ship — `sources_admin.py` **cố ý chưa** resolve SHA, để dành đây: 075 Q4) và độc lập
076 (track E, đã ship).
**Effort**: C1 ≈ S · C3 ≈ S · **C2 ≈ S (OPTIONAL — chỉ nguồn tag-based, xem §4 C2)** — phạm vi làm chắc = C1+C3 ≈ S–M
**Đóng spec**: qua `/spec-close 077`.

> **⚠️ Đọc trước — ROI thành thật.** C **thấp giá trị hơn** 075/076: bạn là 1 dev, **1 nguồn**, upstream
> hiếm đổi. C mua *reproducibility* + *auto-freshness* — lợi ích tăng theo **số nguồn**, hiện còn nhỏ.
> Vẫn đáng làm vì rẻ (S–M) và là nền đúng khi track thêm nguồn (E4/tương lai), nhưng **đừng kỳ vọng lift
> nhìn thấy ngay** như enrichment. Nếu ưu tiên có hạn: làm **C1 (lockfile)** trước, C3 (cron) sau, C2
> chỉ khi thực sự pin.

---

## 1. Bối cảnh

Audit sync (2026-07-25) tìm ra hai vết HIGH ở tầng đồng bộ nguồn:
- **`ref: main` không pin → không tái lập.** `sources.yml:28` ghi một branch di động; clone **gitignored**
  nên chỉ `sources.yml` tracked, không có gì ghi lại *commit đã dùng*. Hai lần `setup.sh` cách nhau =
  corpus khác nhau, im lặng.
- **Sync thủ công-hoàn-toàn.** Chỉ khi người chạy `update_corpus.sh`/skill `corpus-update`. Schema tự
  refresh cron tuần (`.github/workflows/refresh-schema.yml:5`); corpus **không** có gì tương đương.
- **Sharp edge:** pin sang tag/SHA **hôm nay phá luôn updater** — `update_corpus.sh:60` chỉ resolve
  `refs/heads/$branch`; ref không-branch → "could not reach remote … skipping" (`:61-63`), tắt âm thầm
  đường update. Nên "pin cho tái lập" phải đi kèm dạy updater đọc tag/SHA.

## 2. Nguyên tắc (giữ khi implement)

- **KHÔNG đụng `sources.yml` flat-schema / dual-parser.** Lockfile là **file riêng** (`corpus/sources.lock`),
  đọc **chỉ phía Python sau venv** — awk shim bootstrap không chạm nó. `sources.yml` giữ nguyên hình dạng.
- **Clone vẫn gitignored;** chỉ `sources.yml` + `sources.lock` + `INDEX.md` tracked.
- **Degrade offline** — thiếu mạng: `setup.sh`/updater **warn, không chặn** (giữ tiền lệ hiện có).
- **Cron KHÔNG auto-merge** — mở **PR** cho người duyệt (y như `refresh-schema.yml`), vì đổi corpus =
  đổi số file INDEX + headline README (`test_docs_drift.py` gác).
- **Không phá bootstrap-trước-venv** — mọi thứ đọc lock chạy ở bước sau venv (build_index/updater),
  không ở bước clone awk.

## 3. Cơ chế — neo file:line

- `corpus/sources.yml:28` `ref: main` (unpinned); header `:14` mời pin nhưng entry active không pin.
- `scripts/update_corpus.sh:59-60` freshness: `local_head=rev-parse HEAD` vs
  `ls-remote origin -h refs/heads/$branch` — **branch-only**; `:61-63` warn+skip nếu không-branch.
- `scripts/update_corpus.sh:76-77` `fetch --depth=1 origin $branch` + `reset --hard FETCH_HEAD` (luôn
  nhảy tip) — nơi ghi lock sau reset.
- `scripts/setup.sh` (clone sparse) — nơi **đọc** lock để clone tái lập.
- `.github/workflows/refresh-schema.yml:5` `cron: '0 9 * * MON'` — mẫu cho C3 (mirror, mở PR).
- `tools/dify_base/sources_admin.py` (075 S5) — **cố ý chưa** resolve SHA; C mở rộng để ghi lock lúc `add`.

## 4. Slices

### C1 — Lockfile tái lập (S)
`corpus/sources.lock` (tracked, **JSON**): mỗi source → `{ name, resolved_sha, ref, updated }`. **KHÔNG**
bị `.gitignore` bắt (`corpus/*/` chỉ khớp thư mục con, không khớp file `corpus/sources.lock`) → tracked.

**(a) Ai GHI lock — helper Python dùng chung, KHÔNG bash JSON.** `update_corpus.sh` là bash; hand-roll
JSON trong bash = đúng bẫy `yaml.safe_dump` mà S5 (spec 075) đã né. ⇒ thêm hàm **`write_lock(name, sha)`
vào `sources.py`/`sources_admin.py`**, gọi từ `update_corpus.sh` **bằng `$PY`** (script này luôn chạy
post-venv — `$PY build_index.py` ở `:104`). Nguồn `sha` = `git rev-parse HEAD` sau mỗi `reset --hard`
(`:77`). **KHÔNG ghi lock lúc `sources_admin.py add`** — `add` cố ý **clone-free/pure-local** (chỉ append
+ in lệnh; không `ls-remote`); thêm network vào nó là đổi bản chất. Lock do **lần clone/update ĐẦU** ghi.

**(b) Ai ĐỌC + áp lock — bước RIÊNG post-venv trong `setup.sh` (🔴 fix bootstrap-order).** `setup.sh`
clone corpus ở **`[2/5]` (`:112,144-157`) TRƯỚC venv `[3/5]` (`:169`)** → **không** đọc lock JSON trong
vòng clone (chưa có Python → `python: not found`). ⇒ thêm **bước SHA-pin RIÊNG chạy SAU `[3/5]`**: dùng
`$PY` (hoặc system `python3` khi `--skip-venv`), **gate bởi `--skip-clones`**; với mỗi source có
`resolved_sha` → `git fetch --depth=1 origin <sha>` + `git checkout FETCH_HEAD`. Clone `[2/5]` **vẫn theo
`ref` (branch) shallow như cũ**; bước pin chỉ dịch clone tới sha đã khoá.

> **Shallow-đúng (giữ):** clone là `--depth=1` (`setup.sh:150`, `update_corpus.sh:76`) → **KHÔNG**
> `git checkout <sha>` trên clone đã có (commit cũ không tồn tại) và **KHÔNG** ghi `ref: <sha>` vào
> `sources.yml` (`git clone --branch <sha>` fail với SHA thuần, `:150`; comment `:155` xác nhận). Đây là
> lý do lock TÁCH khỏi `ref`: `ref` giữ branch (cho clone), lock mang SHA (fetch riêng). Fetch-by-sha
> chạy khi commit reachable từ ref (GitHub hỗ trợ).

**(c) Fallback SHA-unreachable (🟡 fix).** `fetch origin <sha>` fail (upstream force-push/GC `main`, hay
offline) → **warn + giữ tip của `ref`** (degrade, không chặn — đúng tinh thần offline). Vắng lock → tip.
- Test: lock có sha → bước pin ra đúng sha (mock fetch); **fetch-sha fail → warn + tip** (nhánh riêng);
  xoá lock → tip (back-compat); `--skip-clones` → bỏ qua pin; clone vẫn `--depth=1`.

### C2 — Updater tag/SHA-aware (S) — ⚠️ OPTIONAL, KHÔNG phải prerequisite của C1
> **Làm rõ quan hệ (quan trọng):** C1 pin qua **lock (SHA riêng)** trong khi `ref` **vẫn là `main`
> (branch)** → freshness-check `:60` vẫn chạy đúng (branch), update vẫn nhảy tip rồi ghi lock mới.
> Nên **C1 tự đủ cho tái-lập-mà-vẫn-auto-update — KHÔNG cần C2.** C2 chỉ cần cho use-case **track một
> tag** thay vì branch (nguồn phát hành theo tag). Bạn hiện **không có** use-case đó → **C2 hoãn/bỏ**
> trừ khi thêm một nguồn tag-based.

Nếu làm: dạy `update_corpus.sh:60` freshness resolve **cả tag/SHA** (thử `ls-remote origin "$ref"` khớp
branch **và** tag; `ref` là SHA thuần thì so trực tiếp `local_head`). Gỡ sharp-edge "pin `ref` = tắt
update".
- Test: source `ref: <tag>` → `--check` báo đúng fresh/stale thay vì "skipping".

### C3 — Cron sync (S)
`.github/workflows/sync-corpus.yml` mirror `refresh-schema.yml`: cron tuần → `update_corpus.sh --all`
→ `build_index.py` → nếu có diff, **mở PR** với `sources.lock` + `INDEX.md`. Không auto-merge.
- Test/verify: chạy tay workflow (workflow_dispatch) → PR sinh ra khi upstream đổi; no-op khi không.

## 5. Guard / test phải xanh
- `test_sources_registry.py` — C **không** thêm field vào `sources.yml` (lock là file riêng) → parity
  2 parser **không đổi**. Đây là lý do chọn lockfile-riêng thay vì nhồi sha vào registry.
- `test_docs_drift.py` — **có gác số file INDEX**: `test_index_file_count_matches:68` (`**N files
  indexed**` trong dải 30–200) + `test_readme_corpus_count_matches_index:78` (README `~N template` ==
  INDEX). ⇒ **Sharp edge C3:** nếu cron refresh làm **đổi số file corpus**, PR phải **sửa cả headline
  `~N template` của README** cùng lúc, nếu không CI đỏ. Workflow C3 nên regenerate INDEX + nhắc/tự-sửa
  headline trong cùng PR (hoặc để PR đỏ cho người sửa — chấp nhận được vì có mắt người ở PR).
- `update_corpus.sh` — C2 thêm case tag/SHA (freshness resolve non-branch).

## 6. Open questions
1. **`setup.sh` mặc định clone theo lock (frozen) hay theo tip?** Frozen = tái lập nhưng có thể tụt hậu;
   tip = mới nhưng không tái lập. Đề xuất: **frozen mặc định** + flag `--latest` để nhảy tip (rồi ghi
   lock mới). Chốt khi làm C1.
2. **Cron cadence** — tuần (như schema) hay thưa hơn? 1 nguồn ít đổi → có thể 2 tuần/tháng.
3. **Lock format JSON vs phẳng** — JSON (Python-only) đủ; chỉ cân nhắc phẳng nếu sau này muốn bash đọc
   lock lúc bootstrap (hiện không cần).

## 7. Non-goals
- **Field per-source `language/domain/priority` + filter `find.py`** — đây là **track D**, và
  **khuyến nghị RÚT** (xem §8): track E đã ship tag-search + `source_rank` precedence, nuốt phần lõi của D.
- **Auto-merge PR sync** — luôn để người duyệt (đổi INDEX là quan sát được, cần mắt người).
- **Đổi enrichment/ranking** — track E, đã đóng.

## 8. Khuyến nghị: RÚT track D (không viết spec riêng)

Đánh giá 5-track ban đầu xếp D = "linh hoạt: field `language/domain/priority` + `find.py --domain` +
precedence sort-key + scale INDEX". Sau khi track E ship, **lõi của D đã có**:
- `find.py --name` BM25 đã bao gồm `tags` (`find.py:67,130`), lọc theo tag (`:239`), hiển thị (`:270`).
- Precedence đã thành `source_rank` sort-key thật (E2), không còn là prose.

Còn lại của D chỉ là: field `language` per-source (niche khi enrichment đã English-first) + scale INDEX
(không cấp thiết ở **1 nguồn**). ⇒ **Không đáng một track riêng.** Nếu sau này thêm nhiều nguồn đa ngữ
làm INDEX nhiễu, mở lại như một slice nhỏ của C (nhóm INDEX theo source) hoặc một spec mini — nhưng
không phải bây giờ. Ghi ở đây để không ai "làm lại D" theo quán tính roadmap cũ.
