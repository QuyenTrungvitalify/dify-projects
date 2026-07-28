# Spec 075 — Tối ưu nguồn data (quick-win): Track A (tốc độ harvest) + Track B (nạp nguồn an toàn)

**Status**: Draft v1 (2026-07-25). Tách từ đánh giá toàn hệ
[docs/whole-system-source-handling-evaluation.md](../whole-system-source-handling-evaluation.md) §4 —
hai track ROI cao nhất, rủi ro thấp nhất (A+B). Track C/D/E để ngỏ, không thuộc spec này.
**Effort**: A ≈ S · B ≈ S–M — tổng ≈ M. **Phạm vi làm chắc = S1, S3, S4, S5.** S2 (TTL) đánh giá lại
là **optional/hoãn** — xem §4 S2. Nếu bỏ S2, A rút còn mỗi S1.
**Đóng spec**: qua `/spec-close 075` (docs/specs/README.md).

---

## 1. Bối cảnh

Audit hiệu năng + ergonomics (2026-07-25, ba mũi độc lập) kết luận: hệ **không cần đại tu** — engine
lõi gọn (~1.566 dòng), khoá bởi 97 test, index không rebuild per-build, transcript có cap. Nhưng có
**hai vết thật, cả hai additive**:

- **A — Harvest là điểm nóng hot-path DUY NHẤT.** `harvestWorkspaceFacts` chạy trước **mỗi** Implement
  (kể cả mỗi `/reply` revise), **không cache/TTL, không Node-timeout**. Trên Dify chậm/treo, mỗi
  Implement block tới ~60s (chỉ chặn bằng client-side `timeout=60` của Python) trước khi turn spawn.
- **B — Nạp nguồn có 3 failure mode im lặng.** `validate()` (allowlist license + field bắt buộc) nằm
  **ngoài** đường chạy thật; parser awk và YAML **nuốt lỗi**; không có helper để "add" nguồn an toàn.

## 2. Nguyên tắc (giữ khi implement)

- **Harvest phải vẫn degrade-to-nothing khi thiếu cred/Dify** (bất biến hiện có, `dify-io.ts` D5) —
  thêm timeout/TTL **không được** biến "thiếu cred → rỗng, không chặn" thành lỗi cứng.
- **KHÔNG đụng flat-schema + dual-parser** — awk shim chạy ở bootstrap trước khi venv/PyYAML tồn tại
  (`setup.sh` clone corpus trước, dựng venv sau). Mọi thứ track B thêm phải hoặc (a) chạy phía Python
  sau venv, hoặc (b) nếu chạm bootstrap thì giữ nguyên quy tắc single-line-scalar.
- **`validate()` chỉ cảnh báo/khối ở đúng chỗ, không phá bootstrap** — bật nó trên runtime **không**
  được làm `setup.sh` chết khi một source cũ chưa đủ field; ưu tiên warn to, block chỉ khi license
  non-permissive (đã là copyleft = không redistribute được, phải chặn).
- **Không thêm dependency** — track A thuần TS; track B thuần Python stdlib + PyYAML đã có.

## 3. Cơ chế — neo file:line (đọc trước khi sửa)

### Track A
- `apps/builder/server/lib/orchestrator.ts:421-423` — `await harvestWorkspaceFacts(...)` trong nhánh
  `phaseId==='implement'`, trên hot-path trước render/spawn. Chạy lại mỗi `runPhase` (fresh + `/reply`).
- `apps/builder/server/lib/dify-io.ts:550-554` — 3 arm (`models`/`plugins`/`datasets`) qua
  `Promise.all`, **mỗi arm `sync(projectsDir, ['x'])` KHÔNG truyền `RunSyncPyOpts`**.
- `apps/builder/server/lib/dify-io.ts:169` — `runSyncPy` dùng `timeout: opts?.timeoutMs ?? 0` = không
  kill. Đối chiếu path live-test có timeout: `dify-io.ts:730` `runSyncPy(..., {timeoutMs: timeoutMs+5000})`.
- `tools/dify_base/sync.py:122` — client-side `timeout=60` (chặn duy nhất hiện tại).
- Artifact tái dùng: `.runs/<taskId>/workspace.json` (đọc bởi `loadWorkspaceFacts`,
  `orchestrator.ts:423,656`; `report.ts:312`).

### Track B
- `tools/dify_base/sources.py:63` `validate()` (allowlist `:26-29`), gọi **chỉ** ở CLI `main()` `:91`
  + parity test. `build_index.py`/`setup.sh`/`update_corpus.sh` import `load_sources`, **không**
  `validate`.
- `scripts/lib/sources.sh:20-44` — awk positional extract, không validate → field sai im lặng.
- `tools/dify_base/build_index.py:76-84` — `analyze()` nuốt mọi exception → `None` → list `skipped`;
  `:334-335` chỉ in **số lượng**, không tên.
- `tools/dify_base/build_index.py:181` — dòng registry note của INDEX (nơi có thể echo cảnh báo).

## 4. Slices

### S1 — Harvest Node-timeout (A, S) — ✅ clear win, làm chắc
Truyền `timeoutMs` vào 3 arm harvest ở `dify-io.ts:550-554` (ví dụ ~15s/arm; song song nên wall-clock
= max). Khi timeout → arm đó trả rỗng, **không chặn** (giữ degrade-to-nothing); arm timeout **tính là
failed-nhưng-không-fatal** (giữ luật bail-chỉ-khi-cả-3-fail, `dify-io.ts:555`). Test: giả `runSyncPy`
treo → harvest trả trong ~timeout, task vẫn tiến tới Implement.

> **Cân nhắc ngưỡng (khách quan):** timeout quá thấp → harvest cụt → `{{KNOWLEDGE}}` thiếu model/tool
> đang có → build "không thấy" tài nguyên, **giảm chất lượng âm thầm**. Chọn đủ rộng (≪ 60s cũ nhưng đủ
> cho Dify chậm-mà-khoẻ). Đây là đánh đổi tốc-độ ↔ đầy-đủ, không phải tinh chỉnh vô hại.

### S2 — Harvest TTL cache (A, S) — ⚠️ OPTIONAL / HOÃN (mặc định không làm)
> **Đề xuất: bỏ khỏi đợt A+B, cân nhắc lại sau S1.** Ba lý do khách quan: (a) **đi ngược chủ đích**
> harvest-mỗi-Implement — thiết kế cố ý mua freshness ("2-3 GET rẻ xoá câu hỏi staleness",
> `dify-io.ts:535-536`); TTL **tái lập cửa sổ stale** (thêm model xong /reply ngay → nhận facts cũ).
> (b) lợi ích **chồng lấn S1** — Dify khoẻ thì harvest chỉ vài trăm ms; Dify chậm thì S1 đã chặn.
> (c) N giây là **đoán mò**. Sau S1 cơn đau đã hết; S2 thêm phức tạp + stale để đổi lợi ích biên nhỏ.

Nếu **vẫn** muốn: `.runs/<taskId>/workspace.json` mtime trong N giây (khuyến nghị **10–15s, không
120s**) → tái dùng; chỉ `/reply` back-to-back, fresh Implement luôn harvest; **ghi rõ trong SKILL/doc
rằng nó nới freshness**. Test: hai `runPhase` implement liên tiếp trong N giây → 1 lần spawn sync.

### S3 — `validate()` vào runtime (B, S) — ✅ clear win, làm chắc
Gọi `sources.load_sources` + `validate()` ở đầu `build_index.py main()` và (phía Python, sau venv)
trong `update_corpus.sh`. License non-permissive → **block** (exit ≠ 0, message rõ); thiếu field/ref
lạ → **warn to**, không chặn. `setup.sh` bootstrap (trước venv) **không** đổi — validate chạy ở bước
build_index sau venv. Test: registry có license copyleft → `build_index.py` đỏ với lý do nguyên văn.

### S4 — Không nuốt lỗi parse (B, S) — ✅ clear win, rẻ nhất
`build_index.py main()` in **tên** file trong `skipped` (không chỉ số lượng) và exit-code/note phân
biệt "0 skipped" với "N skipped". Cân nhắc nhỏ: phân biệt "không phải workflow" (bỏ qua, không kể) vs
"workflow hỏng" (kể tên) để tránh nhiễu với source cố tình chứa YAML không-workflow. Test: một YAML
hỏng trong scan target → tên nó xuất hiện ở output.

### S5 — Helper `sources add/doctor` (B, S–M) — 💰 giá trị cao, cẩn thận bẫy write-format
Script Python nhỏ (`tools/dify_base/sources_admin.py` hoặc mở rộng `sources.py` CLI): `add` = validate
block **trước khi ghi** vào `sources.yml` (license + field + schema phẳng) → resolve SHA hiện tại của
`ref` → append đúng format phẳng → gợi ý lệnh clone+index. `doctor` = quét registry, báo source lệch
license/ref-không-branch/clone-thiếu. Không tự `git clone` trong turn (permission); chỉ in lệnh.

> **🚨 BẪY BẮT BUỘC TRÁNH:** khi append, **KHÔNG** `yaml.safe_dump` toàn file — nó reflow thành
> YAML lồng/multiline và **phá awk bash-parser** (`sources.sh:20-44`), đúng hazard mà luật flat-schema
> (`sources.yml:8-9`) canh. Phải **ghi text phẳng thủ công** (mỗi value 1 scalar 1 dòng, `sparse` 1
> list 1 dòng), giữ nguyên phần file đã có. `doctor` cũng chỉ **đọc**, không reserialize.
> Giữ `doctor` tối giản — đừng để phình thành lint tổng hợp.

Test: `add` license xấu → từ chối ghi; `add` hợp lệ → block mới đúng format phẳng, **`sources.sh` awk
đọc lại ra đúng field** + parity 2 parser vẫn xanh (đây là test chống-regression cho bẫy trên).

## 5. Guard / test phải xanh sau spec

- `test_sources_registry.py` (parity 2 parser) — S3/S5 thêm field/validate không được phá parity.
- `apps/builder/test/*` harvest-liên-quan — S1 (và S2 nếu làm) không đổi hợp đồng "degrade-to-nothing".
- `pre-commit run --all-files` — S3 không làm đỏ bootstrap CI trên registry hiện tại (1 source MIT).

## 6. Open questions

1. **Có làm S2 (TTL) không?** Mặc định **không** (§4 S2). Chỉ mở lại nếu đo thực tế cho thấy S1 chưa
   đủ và /reply-loop tốn mạng đáng kể. Nếu làm: N = 10–15s, không 120s.
2. **Timeout mỗi arm** (S1) — 15s cứng, hay lấy từ env như path live-test? Cân với rủi ro harvest-cụt (§4 S1).
3. **`doctor` có nên vào CI** không, hay chỉ lệnh tay? (liên quan track C sau này)
4. **Resolve SHA lúc `add`** (S5) — ghi thẳng `ref: <sha>` sẽ **vô hiệu hoá** freshness-check của
   `update_corpus.sh:60` (chỉ đọc `refs/heads/$branch`). ⇒ hoặc hoãn phần pin sang track C, hoặc S5
   ghi cả `ref: main` + một field lock riêng. Chốt khi làm C.

## 7. Non-goals (đã cân, KHÔNG làm trong spec này)

- **Lockfile + cron sync** (track C) — cần xử lý tag/SHA ở updater; để spec riêng.
- **Field `language/domain/priority` + filter find.py + scale INDEX** (track D) — đụng cả 2 parser
  sâu hơn; spec riêng.
- **Enrichment-layer + ranking + mở pool** (track E) — đã có
  [reference-data-enrichment-evaluation.md](../reference-data-enrichment-evaluation.md).
- **Gộp 3 spawn harvest thành 1 lệnh sync** — MINOR (process-startup, song song), ROI thấp, bỏ.
- **Đại tu index thành incremental** — index không per-build nên vô nghĩa cho tốc độ build.
