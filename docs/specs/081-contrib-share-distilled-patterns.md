# Spec 081 — Chia sẻ ngược: user bản-sạch đẩy pattern đã chưng cất về repo chung

**Status**: Draft v1 (2026-07-28). Kết quả của 2 vòng phân tích (giữ lại để không đề xuất lại):
(1) đề xuất gốc của user "chưng cất xong thì **tự động** commit + push" — giữ nhu cầu, **loại chữ
tự-động-không-gate** (secrets + chất lượng + quyền ghi, xem §7); (2) vòng 1 Claude đề xuất "repo
community riêng làm corpus source" — **tự bác sau khi soi lại 074/052**: contributor bản-sạch đã có
nguyên Builder + `templates/` + `tools/` trong view, và đường chưng cất của họ là **promote FSM có
sẵn** (spec 052/070/078) vốn đã sanitize + gate + đóng dấu provenance; sản phẩm đó xứng đáng tầng
`patterns` (precedence cao nhất khi retrieval), không phải tầng intake của một repo phụ phải nuôi
thêm. Repo community chỉ còn là đường scale tương lai (§7).
**Effort**: S1 ≈ XS · S2 ≈ S–M · S3 ≈ XS · S4 ≈ XS — tổng ≈ **M**, code mới tập trung ở Builder.
**Phụ thuộc**: spec 074 (bản sạch) phải ship trước — contributor có clone thì mới có chỗ push.
**Đóng spec**: qua `/spec-close 081`.

---

## 1. Bối cảnh — dặm cuối của flywheel

Vòng đời hiện tại trên máy contributor (bản sạch 074): build trong Builder → nudge 078 gợi ý chưng
cất → promote FSM (spec 052) distill + gate + `finalizePromotion` ghi pattern đóng dấu provenance
vào `templates/patterns/` **local** + rebuild INDEX. Dừng ở đó: pattern nằm kẹt trong clone của họ,
kệ chung không giàu lên, user khác không hưởng.

Dặm cuối còn thiếu đúng một mối nối: **file đã chưng cất → branch → PR → owner review → merge** —
sau đó mọi bản sạch khác nhận qua `git pull` thường (đường update sẵn của 074), vì `templates/` và
`INDEX.md` đều tracked trong view. Flywheel khép kín: build của mỗi người làm giàu kệ của mọi người.

## 2. Nguyên tắc

- **"Tự động" = one-click, KHÔNG = zero-gate.** Giữ đúng 2 cổng người: (a) contributor xem diff
  cuối (kèm kết quả scan secrets) và gật **trước khi** push — nội dung chưa rời máy họ khi chưa
  gật; (b) owner review PR trước khi merge. Không auto-push, không auto-merge — cùng DNA
  human-gated của toàn hệ (promote, enrichment, sync-corpus đều thế).
- **Đơn vị chia sẻ = pattern đã chưng cất**, không bao giờ là raw build/project export — bài học
  E4: distill turn đã thay domain specifics bằng placeholder, blank model, đóng dấu provenance;
  đây chính là lớp sanitize-by-design, share chỉ bồi thêm một lượt scan.
- **Không tầng mới, không repo mới, không backend.** Đóng góp đổ thẳng vào `templates/patterns/`
  qua PR trên chính repo này; GitHub là hàng đợi + nơi review; gate hub = CI sẵn có + mắt owner.
- **Git ops phía server Builder phải rón rén** (bài học B-series 074): chỉ pathspec-commit đúng
  các file của contribution, không đụng staging/working tree còn lại của user, mọi lỗi git
  (thiếu identity, không quyền push, offline) surface thành message hướng dẫn — không bao giờ
  chết im hay quét nhầm file.

## 3. Cơ chế — neo đã verify

- **`finalizePromotion`** (`apps/builder/server/lib/promote.ts:312`): ghi header + nội dung vào
  `templates/patterns/<slug>.yml`, rebuild INDEX, kết thúc với `task.status='done'`,
  `task.gate={actions:[]}` — **gate cuối rỗng này là chỗ treo action Share** (S2).
- **`provenanceHeader`** (`promote.ts` cùng file): local → `source=original` + MIT; external
  (paste, spec 070) → `source=external` + license khai báo (`unknown` nếu không khai). **Share
  phải chặn** external có license unknown/non-permissive — không redistribute đồ không rõ nguồn.
- **CI đã gate PR**: `ci.yml` chạy `pytest tests/` + builder tests trên `pull_request`;
  `test_docs_drift.py::test_index_file_count_matches` buộc INDEX.md khớp số file trên đĩa →
  **commit contribution phải gồm cả `INDEX.md`** (đã được finalize rebuild sẵn); headline
  "~N template" của README là mục checklist cho reviewer — đúng khuôn PR sync-corpus (077 C3).
- **Dup-check có sẵn**: `catalog.py check --shelf` (078) — chạy ở preflight, verdict đưa vào body
  PR để reviewer khỏi tự dò trùng.
- **`promote_gate.py`**: CLI gate eligibility sẵn có (đã chạy lúc promote) — nhà đúng cho mode
  scan mới (S3), theo kỷ luật 013/049 "fold vào tool sẵn có, không script mới". Không nhét rule
  secrets vào `lint_refs.py`: URL/token trong build **local** là hợp lệ, chỉ sai khi **rời máy**
  — rule lint sẽ nag oan mọi build thường.
- **074 view**: builder server/web + `templates/` + `tools/` + `INDEX.md` đều trong sparse view →
  ship S2 trong Builder là mọi contributor tự nhận qua pull, **không cần thêm path nào** vào
  `sparse-view.txt`.

## 4. Slices

### S1 — Hub: checklist review + xác nhận gate CI (XS)
- Thêm mục "Nhận contribution pattern" vào doc state chủ (templates-and-promotion.md): checklist
  reviewer — provenance header hợp lệ (source=original/external+permissive), placeholder sạch
  (không URL nội bộ/token sót), verdict dup trong body PR, README headline nếu count đổi.
- Kiểm lúc implement: PR chỉ thêm `templates/patterns/*.yml` + `INDEX.md` có qua trọn
  `test_pattern_consistency.py` + drift suite không (kỳ vọng: có — nếu thiếu, bổ sung vào
  checklist chứ không nới test).

### S2 — Builder: turn "Share upstream" sau promote (S–M)
Sau `finalizePromotion` thành công, **nếu** workspace là git repo có remote `origin` **và**
provenance đủ điều kiện share (§3): gate cuối nhận thêm action `share` (label kiểu
"Đẩy pattern này lên repo chung?"). Flow khi user bấm:
1. **Preflight** (server): `promote_gate.py share-scan <file>` (S3) + `catalog.py check --shelf`;
   render kết quả + diff file cuối (header đã đóng dấu) cho user xem.
2. **User gật** (cổng người thứ nhất — bắt buộc, không có đường tắt).
3. **Git ops** (server, rón rén): branch `contrib/<slug>-<YYYYMMDD>` từ HEAD hiện tại →
   pathspec-commit đúng 2 path (`templates/patterns/<slug>.yml`, `INDEX.md`) → `git push -u
   origin <branch>` → dựng URL `https://github.com/<owner>/<repo>/compare/main...<branch>?expand=1`
   trả về UI kèm nhắc "mở link để tạo PR". Body PR gợi ý sẵn (copy được): verdict gate +
   known_good_dify + dup-check + checklist S1.
4. **Lỗi git surface tử tế**: thiếu `user.email` → hướng dẫn `git config`; push bị từ chối
   (không quyền) → hướng dẫn fork thủ công (v1 không tự fork); offline → báo thử lại. Không lỗi
   nào được nuốt im.

### S3 — `promote_gate.py share-scan` (XS)
Mode mới, chỉ chạy lúc share (không đụng gate promote thường): scan file cho (a) chuỗi dạng
token/key (regex: bearer/api[_-]key/sk-…/AKIA…/hex dài), (b) URL không phải placeholder
(allowlist: `example.com`, `{{…}}`, `# TODO`), (c) email/hostname nội bộ. Kết quả **advisory** —
liệt kê cho user tự quyết ở bước gật (secrets thật thì họ sửa rồi share lại); exit 0 luôn,
`--json` cho server parse. + unit test cho từng lớp pattern.

### S4 — Docs + vòng nhận (XS)
- GUIDE (phần user bản sạch): mục "Chia sẻ pattern của bạn" — bấm Share, mở link PR; và chiều
  ngược lại: `git pull` là nhận được pattern người khác (index.json rebuild theo đường sẵn có).
- Ghi rõ license: share = đồng ý phát hành pattern theo MIT (header promote đã stamp sẵn) —
  một dòng trong turn confirm, không cần CLA.

## 5. Guard / test phải xanh

- Builder server tests (khuôn `apps/builder/test/`): action `share` chỉ xuất hiện khi có origin +
  provenance hợp lệ (external license unknown → không có action); pathspec-commit không cuốn file
  dirty khác của user (dựng repo tạm có file dirty làm chứng); mọi nhánh lỗi git trả message,
  không throw chết task.
- `share-scan`: unit test 3 lớp pattern + case sạch im lặng.
- Toàn bộ suite hiện có không đổi hành vi khi **không** bấm share (promote thường byte-identical).
- Nghiệm thu tay: một lần share thật end-to-end trên máy thứ hai (hoặc clone thứ hai giả lập
  contributor) → PR mở được, CI xanh, merge xong máy kia `git pull` thấy pattern + INDEX.

## 6. Open questions

1. **Quyền push của user bản sạch**: họ là collaborator (push branch được) hay chỉ read? Quyết
   trước khi implement S2 — nếu chỉ read, v1 chuyển sang hướng dẫn fork thủ công trong message
   lỗi (đã có ở S2.4), v2 mới cân tự động hoá fork qua `gh`.
2. **Dọn branch `contrib/*`**: bật "Automatically delete head branches" trên GitHub là đủ? Đề
   xuất: đủ. Chốt khi có PR đầu tiên.
3. **Đụng độ INDEX.md** giữa 2 contribution song song: conflict giải bằng regenerate
   (`build_index.py`) — ghi vào checklist S1 hay đợi gặp thật? Đề xuất: ghi sẵn một dòng.
4. **README headline "~N template"**: giữ là việc của reviewer (khuôn 077) hay để contributor
   commit luôn? Đề xuất: reviewer — contributor không nên đụng README ngoài phạm vi.

## 7. Non-goals (đã cân và LOẠI — đừng đề xuất lại)

- **Auto-commit + auto-push không cổng người** (đề xuất gốc) — LOẠI: distill có thể sót secret/
  URL nội bộ; push là hành vi publish; thiếu mắt contributor lẫn owner là vector leak + rác kệ.
- **Push thẳng `main` / auto-merge** — LOẠI: kệ curated là tầng precedence cao nhất, một file rác
  đầu độc mọi retrieval phía sau; PR review là giá rẻ nhất cho chất lượng đó.
- **Repo community riêng đăng ký làm corpus source** — LOẠI cho bài toán này (vòng tin cậy nội
  bộ, volume thấp): thêm một repo phải nuôi + độ trễ sync tuần + đóng góp rơi xuống tầng intake
  precedence thấp nhất, trong khi sản phẩm promote xứng tầng patterns. **Giữ làm đường scale**
  nếu một ngày mở cho contributor ngoài vòng tin cậy — lúc đó mở spec mới, đừng nhét vào 081.
- **Backend/service nhận submission** — LOẠI: trái zero-backend; GitHub PR là hàng đợi đủ tốt.
- **Share raw project export chưa distill** — LOẠI: trái bài học E4; đơn vị chia sẻ duy nhất là
  sản phẩm của promote FSM.
- **CLA/legal infra** — LOẠI: nội bộ + MIT stamp sẵn trong header; một dòng xác nhận ở turn
  confirm là đủ.
