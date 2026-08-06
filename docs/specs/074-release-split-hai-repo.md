# Spec 074 — Bản "sạch" cho user: MỘT repo, sparse-checkout tự áp

**Status**: **PENDING — chưa làm, không nằm trong hàng đợi hiện tại** (đánh dấu 2026-08-06).
Thiết kế đã chốt ở Draft v3 và không có gì phải quyết thêm; **0/3 slice có code** (`scripts/sparse-view.txt`
và `scripts/lib/sparse.sh` chưa tồn tại). Khi nào làm thì vào thẳng §5, không cần thiết kế lại.
Draft v3 (2026-07-20/21 — v2 pivot từ mô hình 2-repo khi user gỡ ràng buộc "giấu";
v3 sửa theo review đối kháng 12-agent: 1 blocker + 3 major được xác nhận, xem §4b. Draft v1/v2
chưa từng commit.)
**Effort**: S1 = S–M · S2 = S · S3 = S–M — tổng ≈ M
**Đóng spec**: KHÔNG đóng được lúc này — `/spec-close` chỉ chạy khi S1–S3 đã ship, hoặc khi user
quyết bỏ hẳn (lúc đó là spec chết non: một dòng `AGENTS.md §9` giải thích vì sao chết rồi xoá).
Hai bài học ĐÃ được chuyển đi trước (B1 stdin-rỗng, M3 inode) — xem `AGENTS.md §9` mục 2026-07-21;
phần còn lại của spec vẫn là nhà duy nhất của nó.

> ⚠️ Số đo trong §1 (~429 file tracked, ~215 đồ dev) là ảnh chụp 2026-07-20 và **đã trôi** —
> đếm lại bằng `git ls-files | wc -l` trước khi dùng làm căn cứ.

---

## 1. Bối cảnh

Repo track ~429 file, trong đó ~215 là đồ dev thuần (`apps/builder/test/` 81, `tests/` 55,
`docs/prompts|state|specs` 47, `.github/` + pre-commit…). Người dùng cuối (không phải dev) clone
repo và double-click `scripts/update-and-run.command` (git pull → build → chạy). Máy họ nhận về
toàn bộ đồ dev — rối và thừa cho mục đích "chạy app + xem qua dự án".

## 2. Quyết định đã chốt với user (2026-07-20, ba lượt hỏi)

1. Chỉ có MỘT dev; các user khác clone repo này về để chạy, update bằng `git pull` trên `main`.
2. **User đọc được đồ dev cũng không sao** — mục tiêu là *sạch trên máy user*, không phải *giấu*.
   (Ràng buộc "giấu" từng có ở draft v1 → đã gỡ; có user biết code còn chủ động vào đọc docs.)
3. Giữ README tổng quan (+ tài liệu đọc-hiểu) cho user; đồ vận hành dev thì user không cần thấy.

→ Mô hình: **một repo duy nhất, giữ nguyên mọi thứ trên GitHub**. "Sạch" thực hiện phía client
bằng `git sparse-checkout`, do script sẵn có tự áp — user không thao tác gì, không phải re-clone,
`git pull` hoạt động y như cũ.

## 3. Nguyên tắc (giữ khi implement)

1. **Server nguyên vẹn**: GitHub vẫn đầy đủ 100% — ai muốn đọc test/spec cứ đọc. Sparse chỉ là
   "view" trên máy user, không phải cơ chế che giấu.
2. **Tự động, idempotent, tôn trọng opt-out**: script áp view mỗi lần chạy (nhận pattern mới sau
   pull), nhưng ai đã `git config difyprojects.sparse off` thì không bao giờ bị bật lại.
   Mỗi lần áp phải **echo một dòng cố định** kèm lệnh xem full — cơ chế tự thông báo, không âm thầm.
3. **Fail-open, nhưng fail-open phải ĐỨNG TRƯỚC lệnh nguy hiểm**: mọi điều kiện bất thường
   (git cũ, thiếu file pattern, file rỗng) phải được chặn TRƯỚC khi gọi `sparse-checkout set` —
   vì bản thân lệnh này có chế độ hỏng rc=0 (§4b B1) mà `|| true` phía sau không bắt được.
   Sạch là enhancement; không bao giờ là lý do app không chạy được.
4. **Danh sách pattern = deny-list các Ổ dev lớn**, không phải allowlist runtime: mặc định mọi thứ
   MỚI đều hiện ra (an toàn chiều "app vỡ vì thiếu file"; chiều "lộ file dev mới" không còn là rủi
   ro vì §2.2). Đây là đảo ngược có chủ đích so với nguyên tắc allowlist của draft v1.

## 4. Cơ chế — đã test thực nghiệm 2026-07-20 (git 2.50.1 Apple Git-155)

Pattern list, versioned tại `scripts/sparse-view.txt` (nằm trong `scripts/` nên có mặt trong view;
**không dùng comment đầu dòng thì tốt, nhưng nếu có thì git tự hiểu `#` trong --stdin** — đã test;
tránh khoảng trắng cuối dòng: pattern có trailing space bị git match hụt trong im lặng):

```
/*
!/tests/
!/docs/prompts/
!/docs/state/
!/docs/specs/
!/apps/builder/test/
!/.github/
!/.claude/
/.claude/skills/dify-build/**
```

### 4a. Bằng chứng thực nghiệm nền (session 2026-07-20)

| Test | Kết quả |
|---|---|
| Clone mới `--no-checkout` + `sparse-checkout set --no-cone` + checkout | 213/429 file; `tools/` 14, `templates/` 24, `server/` 51, `web/` 50 đủ nguyên; 6 ổ dev = 0 file; **re-include `.claude/skills/dify-build/**` bên trong `!/.claude/` hoạt động** (sparse match theo từng path trong index, không bị giới hạn "không re-include con của dir bị loại" như .gitignore) |
| Áp hậu kỳ lên clone FULL sẵn có (đường migration user hiện tại) | 429 → 213 file, `git status` sạch (skip-worktree, không phát sinh deletion) |
| `git pull` trong clone sparse khi upstream thêm 1 file runtime + 1 file dev | file runtime materialize, file dev không (vẫn được fetch vào object store) |
| `git sparse-checkout disable` (opt-out coder) | full tree quay lại nguyên vẹn, status sạch |

### 4b. Kết quả review đối kháng (12 agent, 2026-07-21) — các fix ĐÃ nhập vào thiết kế dưới

**Xác nhận, phải xử lý:**

- **B1 (blocker) — stdin rỗng = xoá trắng working tree, rc=0.** `sparse-checkout set --stdin`
  nhận pattern list RỖNG (file thiếu/bị user xoá/chỉ còn comment/sai cwd) → git ghi pattern set
  rỗng, **gỡ mọi tracked file khỏi working tree, exit 0**, `git status` sạch. `|| true` phía sau
  vô dụng vì rc=0. Kẹt vĩnh viễn: chính sparse-view.txt cũng bị gỡ nên mọi lần chạy sau lặp lại;
  `git pull` vẫn rc=0 mà không materialize gì. → Fix: guard non-empty TRƯỚC lệnh (repro: scratch
  wf-git, 11→0 file).
- **M1 (major) — `setup.sh` bước [5/5] chạy `.venv/bin/pytest tests/`** dưới `set -euo pipefail`
  (setup.sh:23,223) → trong view sparse, pytest exit 4 ("file or directory not found: tests/"),
  setup.sh chết trước "Setup complete." (pytest luôn có mặt vì requirements.txt:105 pin nó).
  → Fix một dòng trong setup.sh: thêm `[ -d tests ]` vào guard (không nới pattern chỉ để dev-tool
  xanh — nhất quán với tiền lệ typecheck §5-S3).
- **M2 (major) — mô hình lỗi "dirty file trong vùng bị ẩn" của v2 SAI.** git không refuse:
  rc=0, áp sparse MỘT PHẦN — gỡ các file dev sạch, để lại file dirty kèm warning trôi mất trong
  Terminal. Fail-open không bao giờ kích hoạt. Đã kiểm chứng thêm phần control: `git pull` đụng
  file dirty đó abort Y HỆT như trong clone full — tức end-state không tệ hơn hiện trạng, nhưng
  văn bản spec phải mô tả đúng hành vi thật (§7.2 viết lại) và dòng echo §3.2 là mitigation chính.
  Hệ quả thực tế: **máy dev đang có diff ở test/spec — dev là nạn nhân đầu tiên** nếu lỡ chạy
  .command; dev phải `git config difyprojects.sparse off` trong clone của mình TRƯỚC khi ship (S1).
- **M3 (major) — "gọn ngay lần chạy đầu" của v2 SAI với đường `.command`.** `git pull` thay file
  `update-and-run.command` bằng rename, bash tiếp tục chạy bản CŨ từ inode cũ (đã repro) — nếu móc
  bước áp sparse vào .command thì máy user chỉ gọn từ lần chạy THỨ HAI. → Fix: gọi
  `apply_sparse_view` từ **`scripts/setup-node.sh`** — file này được `.command` exec như process
  con SAU git pull, đọc fresh từ đĩa, nên bản mới có hiệu lực NGAY lần chạy đầu (đã xác minh flow
  .command:22-32).

**Tấn công mà thiết kế ĐỨNG VỮNG (ghi lại để khỏi nghi ngờ lại):** idempotency của re-apply mỗi
lần chạy; thứ tự re-include `.claude/skills/dify-build/**`; floor version `--no-cone` cần git
≥ 2.35 (fail-open đỡ máy cũ); `git pull` fail vì INDEX.md diff xảy ra TRƯỚC bước sparse nên spec
này không làm tệ hơn; opt-out 2 lệnh là thiết kế có chủ đích (native `disable` đơn lẻ bị áp lại —
đã document, dòng echo mỗi lần áp là lời nhắc); trailing-whitespace trong pattern chỉ gây "thừa
file dev" vô hại, ghi chú giữ file sạch là đủ.

### 4c. Tích hợp (bản đã sửa theo 4b)

Hàm dùng chung `scripts/lib/sparse.sh::apply_sparse_view` — gọi với cwd = repo root:

```bash
apply_sparse_view() {
  local view="scripts/sparse-view.txt"
  # Opt-out vĩnh viễn của người muốn full tree (README/HUONG_DAN hướng dẫn).
  [ "$(git config --get difyprojects.sparse)" = "off" ] && return 0
  # Guard SỐNG CÒN (§4b B1): stdin rỗng làm `sparse-checkout set` XÓA TRẮNG working tree
  # với rc=0 — phải chặn TRƯỚC lệnh. Chỉ áp khi file tồn tại và có ≥1 pattern thật.
  grep -q '^/' "$view" 2>/dev/null || return 0
  # Tự thông báo mỗi lần áp (§3.2) — cũng là mitigation cho §4b M2.
  echo "▶ Áp chế độ xem gọn (xem full tree: git config difyprojects.sparse off && git sparse-checkout disable)"
  # Redirect chứ không pipe: thiếu file thì fail TRƯỚC khi git chạy, không đổi state.
  # git ≥2.35 (--no-cone); git cũ hơn / lỗi khác → fail-open, chạy full tree.
  git sparse-checkout set --no-cone --stdin < "$view" || true
}
```

Điểm gọi (§4b M3 quyết định vị trí):

- **`scripts/setup-node.sh`** (đầu file, sau khi cd về repo root): đường chính cho user hiện hữu —
  `.command` exec nó fresh SAU git pull → máy user gọn NGAY lần double-click đầu tiên sau khi ship.
- **`scripts/setup.sh`** (cuối bootstrap): đường cho clone mới. Kèm fix M1 (guard `[ -d tests ]`
  ở bước [5/5] — đứng TRƯỚC điểm gọi nên không guard thì không bao giờ tới).
- KHÔNG sửa `update-and-run.command` (tránh bẫy self-update M3; nó vốn đã gọi setup-node.sh).

## 5. Slices

### S1 — `sparse-view.txt` + `apply_sparse_view` + tích hợp + 2 fix setup.sh (S–M)

Như §4c, cộng: guard `[ -d tests ]` cho setup.sh:223 (M1) và sửa dòng gợi ý "Run tests" ở
epilogue setup.sh:234 tương tự; **trước khi push: dev chạy `git config difyprojects.sparse off`
trong clone của chính mình** (M2 — máy dev đang dirty ở test/spec).

Nghiệm thu:
- (a) máy có clone FULL sẵn (giả lập user cũ): double-click `.command` MỘT lần → tree còn ~213
  file, app build + chạy bình thường, Terminal có dòng "Áp chế độ xem gọn".
- (b) chạy lại lần nữa → không đổi gì thêm (idempotent), vẫn build + chạy.
- (c) `git config difyprojects.sparse off` + `git sparse-checkout disable` → chạy .command không
  bật lại sparse.
- (d) **chống-wipe (B1)**: xoá `scripts/sparse-view.txt` (hoặc làm rỗng) rồi chạy .command →
  KHÔNG có gì bị gỡ, tree nguyên trạng, app vẫn chạy.
- (e) `./scripts/setup.sh` chạy trọn trong tree ĐÃ sparse → tới "Setup complete.", không chết ở
  bước pytest.

### S2 — Tài liệu cho hai loại người dùng (S)

- README (mục ngắn): "clone về chỉ thấy một phần repo? — chủ đích, xem full bằng
  `git config difyprojects.sparse off && git sparse-checkout disable`" (đúng CẶP lệnh — một lệnh
  `disable` đơn lẻ sẽ bị áp lại ở lần chạy sau, xem §4b).
- HUONG_DAN.md: một dòng trấn an user thường ("thư mục gọn hơn trước là bình thường").

### S3 — Verify closure bằng app thật (S–M)

Test file-level đã xong (§4a); còn phải chứng minh app CHẠY trong view sparse: clone tạm → áp
sparse → `./scripts/setup.sh` (giờ qua được nhờ M1-fix) → `./scripts/setup-node.sh` →
`npm ci && npm run build && npm start` trong `apps/builder` + 1 request smoke. Thiếu file nào →
sửa `sparse-view.txt` (nới pattern), KHÔNG sửa code app. Lưu ý đã biết trước: `npm run typecheck`
sẽ vỡ trong view sparse (thiếu `apps/builder/test/` mà `tsconfig.test.json` glob tới) — chấp nhận,
user không chạy typecheck; KHÔNG thêm test/ lại chỉ để typecheck xanh.

## 6. Non-goals — các đường đã cân và loại (đừng đề xuất lại khi implement)

- **2 repo mirror + sync script** (draft v1): chỉ thắng khi cần GIẤU — ràng buộc đã gỡ. Chi phí
  còn lại (repo mới, manifest allowlist, lệnh release, closure phải đủ 100% nếu không app vỡ)
  không mua được gì thêm.
- **2 branch cùng repo** (main sạch + dev): vẫn cần script sync + đổi flow làm việc của dev; thua
  sparse ở mọi mặt khi không cần giấu.
- **Tarball / GitHub Release**: đổi flow update của user (bỏ git pull), mất update một-click.
- **Tách thư mục / submodule**: đồ dev xen kẽ đồ runtime (`apps/builder/test` trong `apps/builder`,
  `.claude` nửa dev nửa runtime) → refactor lớn, đụng tsconfig/CI/AGENTS refs. Không đáng.
- **Giấu bất kỳ thứ gì phía server**: chủ đích ngược lại — coder được khuyến khích đọc.

Ghi chú closure (từ draft v1, vẫn đúng và là LÝ DO các pattern chừa lại gì): runtime không chỉ là
`apps/builder` — server shell-out `tools/dify_base/*.py` (`linters.ts:30`, `promote.ts:44`,
`dify-io.ts:164`), ghi `templates/patterns/` (`promote.ts:332`), đọc `schemas/`
(`lint_node_bodies.py:39`), đọc `.claude/skills/dify-build/judge.md` (`live-test.ts:26`); session
spawn load `AGENTS.md`/`CLAUDE.md`; `examples/` + `corpus/sources.yml` là scan root của index
(`build_index.py:42,64`); AGENTS.md tham chiếu 4 file docs (GUIDE, architecture,
runtime-supplement, plugin-capabilities) — vì vậy pattern docs chỉ loại `prompts|state|specs`,
không loại cả `docs/`.

## 7. Open questions

1. Vét thêm cho tối giản? Trong view còn vài file dev lặt vặt: `.pre-commit-config.yaml`,
   `requirements.in`, `scripts/check_*.sh`, `scripts/regen_vscode_settings.py`,
   `docs/linter-candidates.md`. Thêm ~5 dòng `!` là ẩn được — mặc định spec: KHÔNG, giữ pattern
   list ngắn dễ hiểu; vài file lẻ không gây rối bằng 215 file.
2. (Viết lại theo §4b M2.) User có diff local ở file NẰM TRONG vùng bị ẩn: `sparse-checkout set`
   KHÔNG refuse — nó áp một phần (gỡ file sạch, giữ file dirty kèm warning), rc=0. Với user thường
   điều này gần như không xảy ra (họ không sửa file dev); với dev thì S1 đã bắt preset opt-out.
   Còn lại chấp nhận: end-state khi pull đụng file dirty y hệt clone full (đã kiểm chứng control),
   và dòng echo mỗi lần áp là dấu vết chẩn đoán. Không làm gì thêm trong spec này.
3. `INDEX.md` bị `setup.sh` rebuild trên máy user → diff local → có ngày `git pull` fail (hành vi
   cũ, xảy ra TRƯỚC bước sparse nên spec này không đổi gì). Đáng một spec riêng: gitignore
   INDEX.md hoặc rebuild vào chỗ gitignored.
