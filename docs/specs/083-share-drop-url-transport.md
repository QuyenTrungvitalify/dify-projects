# Spec 083 — Share transport v2: drop-URL (Apps Script → Drive), git/PR lùi làm fallback

**Status**: Implemented (2026-07-29) — S1 (`tools/share_inbox/` Code.gs + appsscript.json
Asia/Tokyo + DEPLOY.md kèm curl smoke) · S2 (`share.ts`: `loadShareConfig`/`postContribution`/
`runShareShip`, seam `fetchFn` trong runners, `mode` trên PromoteShare, i18n EN+JA) · S3 (skill
`/shelf-inbox`) · S4 (`.dify-share.json` template url-rỗng → tự fallback git; docs GUIDE §9b +
state doc §9). Test: pytest 393✓ · server 719✓ · web 206✓. Đính chính lúc implement: §3 đoán sai
— sparse-view 074 mở đầu `/*` nên file root `.dify-share.json` TỰ có trong view, không cần thêm
dòng nào. **Nghiệm thu còn lại (cần Google thật)**: admin deploy theo DEPLOY.md + 2 lệnh curl
smoke (hợp lệ → ok:true + file trong Drive; secret sai → bị chặn) → điền url/secret vào
`.dify-share.json`, commit → một máy user share thật → `/shelf-inbox` vet + land end-to-end. Kết quả của 3 vòng thiết kế sau khi 081 ship (giữ lại để không
đề xuất lại): (1) 081 branch+PR chạy đúng nhưng **user bắt đúng lỗ**: đòi quyền push + git identity
+ GitHub account — không phục vụ được all user (chính là open question #1 của 081, thực tế đã trả
lời); (2) vòng "folder Drive sync từng máy" — LOẠI làm đường chính: vẫn là friction per-máy (cài
Drive for Desktop + trỏ config); (3) vòng "Drive API / anyone-link" — **kiểm chứng: không tồn tại**,
mọi upload qua Drive API đều đòi OAuth; dạng đạt đúng semantics "biết link là ném vào" là **Google
Apps Script Web App**: admin deploy một lần, ra một URL HTTPS công khai, script chạy dưới quyền
admin và ghi vào folder Drive của admin, tự chia thư mục tháng. Phía user **zero setup** — URL nằm
trong file config commit sẵn, về máy qua `git pull`.
**Effort**: S1 ≈ XS–S (script + doc deploy) · S2 ≈ S (swap transport trong Builder) · S3 ≈ S
(skill `/shelf-inbox`) · S4 ≈ XS (config + docs) — tổng ≈ **S–M**.
**Quan hệ với 081**: sửa đúng **bước cuối** (transport) — preflight/2 gate/share-scan/i18n/UI của
081 tái dùng nguyên vẹn. Đường git+PR **giữ làm fallback** (đã có test đầy đủ, hợp dev có quyền
push); drop-URL là đường chính. `contrib-pr.yml`/`ci.yml contrib/**` giữ nguyên phục vụ fallback.
**Đóng spec**: qua `/spec-close 083`.

---

## 1. Bối cảnh

081 khép flywheel bằng branch+PR, nhưng cổng vào đòi 3 thứ không phải user nào cũng có (push
right, git identity, GitHub account). Đối tượng thật của Builder có người không phải dev. Yêu cầu
mới: **phía user tuyệt đối zero setup** — bấm approve là xong; admin nhận, vet, và tự land theo
nhịp riêng (ví dụ mỗi tuần).

## 2. Nguyên tắc

- **Hai cổng người giữ nguyên** (DNA từ 081): scan + cái gật của contributor TRƯỚC khi byte rời
  máy; mắt admin TRƯỚC khi lên kệ chung. Transport đổi, gate không đổi.
- **Builder vendor-neutral**: phía Builder chỉ biết "POST JSON lên `url` trong config". Apps
  Script là *reference receiver* — org khác trỏ URL sang receiver khác mà không đổi code Builder.
- **Ngoại lệ zero-backend có chủ ý, ghi thành văn**: receiver là ~40 dòng Apps Script do Google
  host, admin sở hữu, không phải service tự nuôi. Đây là lần đầu nguyên tắc zero-backend nhận
  ngoại lệ — phạm vi đúng một script nhận-file, không mở rộng.
- **Admin-side cũng không viết Drive API**: chỉ MỘT máy (admin) cài Drive for Desktop để folder
  thành đường dẫn local; skill đọc filesystem thường.
- **Fail = surface, không nuốt**: POST lỗi (offline / non-200 / script từ chối) → re-park với
  guidance + Try-again, pattern vẫn nguyên trên kệ local (như 081).

## 3. Cơ chế — neo đã verify

- **Seam transport đã tách sẵn**: `apps/builder/server/lib/share.ts` — `pushContribution` là bước
  cuối duy nhất chạm git; FSM (`runSharePreflight`/`runShareGitOps`/gate `promote_share_offer|
  review`) + share-scan + near-dup + i18n dùng lại nguyên vẹn. `shareOfferEligible` hiện probe
  origin — S2 đổi thành: **có config drop-URL → eligible ngay** (ưu tiên), không có → probe origin
  như cũ (fallback), không nữa → không offer.
- **Node fetch**: server chạy Node 22 (ci.yml `node-version: '22'`) — `fetch` global, follow
  redirect mặc định. **Gotcha Apps Script**: POST trả **302** sang `script.googleusercontent.com`
  — client phải follow (fetch mặc định làm đúng); implement KHÔNG được tắt redirect.
- **Tiền lệ config root**: `.dify-tag`, `.dify-dsl-version` — thêm `.dify-share.json`
  (`{"url": "...", "secret": "...", "maxKb": 512}`, commit vào repo). Secret chỉ để chặn người lạ
  ngoài vòng repo-read; người đọc được repo = người được phép gửi, đúng vòng tin cậy.
- **Nhật ký quyết định admin có sẵn**: `catalog.py record <file> --decision {promoted|rejected|
  study|…} --reason` (spec 078) — `/shelf-inbox` ghi quyết định qua đây, không chế state mới.
- **Timezone**: bài học schedule-trigger — mặc định UTC lệch ngày JP. Apps Script phải set
  timezone **Asia/Tokyo** (appsscript.json `timeZone`) để folder tháng `YYYY-MM` đúng lịch admin.
- **Sparse view 074**: `.dify-share.json` phải được thêm vào `scripts/sparse-view.txt` (khác 081
  — lần này CÓ một path mới cần vào view).

## 4. Slices

### S1 — Receiver: Apps Script + hướng dẫn deploy một lần (XS–S)
`tools/share_inbox/Code.gs` (commit vào repo, để review/sửa được) + `tools/share_inbox/DEPLOY.md`:
- `doPost(e)`: parse JSON `{secret, slug, contributor, yaml, meta}` → check secret (đọc từ
  **Script Properties**, không hardcode trong .gs) → cap kích thước (`maxKb`, mặc định 512KB —
  chặn spam phình Drive) → validate hình dạng (yaml string, meta object) → `getOrCreateFolder
  ("<root>/inbox/YYYY-MM")` → ghi 2 file `<slug>--<contributor>--<timestamp>.yml` + `.meta.json`
  → trả `{ok:true}` / `{ok:false, error}` qua ContentService JSON.
- `appsscript.json`: `timeZone: "Asia/Tokyo"`.
- DEPLOY.md: tạo project → dán code → set Script Property `SECRET` → Deploy web app (*Execute as:
  Me / Access: Anyone*) → copy URL vào `.dify-share.json` → **lưu ý sửa code phải "Manage
  deployments → New version"** (không thì URL cũ chạy code cũ — gotcha có thật) → curl test mẫu.

### S2 — Builder: swap bước cuối sang POST (S)
- `share.ts`: thêm `loadShareConfig(projectsDir)` (đọc `.dify-share.json`, false-safe) +
  `postContribution(cfg, {slug, contributor, yaml, meta})` — fetch POST, timeout ~30s, follow
  redirect; phân loại lỗi: network → "offline, thử lại"; `{ok:false}` từ script → nguyên văn
  error; non-JSON/response lạ → tail thô. Trả `ShareOutcome` cùng shape với `pushContribution`.
- `runShareGitOps` → đổi tên khái niệm thành "ship step": config URL có → POST; không → git path
  cũ nguyên trạng. `meta` = đúng nội dung `contributionMessage` body hiện tại (verdict gate,
  share-scan, near-dup, checklist) dạng JSON thay vì commit-body.
- Contributor identity: `BUILDER_CONTRIBUTOR` env → fallback `os.userInfo().username`; ghi cả
  hostname vào meta để admin truy được "PC-xxx là ai" một lần.
- i18n: done-line mới cho drop mode ("Đã gửi lên kệ chung — admin sẽ review", EN+JA) — dòng
  `promoteSharePushedLine` (branch/PR) chỉ còn dùng cho fallback git.
- Test (khuôn share.test.ts): eligibility ưu tiên URL trên origin; POST success → done+pushed
  (state ghi mode `drop`); POST fail từng lớp → re-park guidance; config hỏng/thiếu → rơi về git
  path; **suite git thật hiện có không đổi**.

### S3 — Admin: skill `/shelf-inbox` (S)
Procedure text (khuôn `/scout`): đọc `SHELF_INBOX_DIR` (đường dẫn local do Drive for Desktop
sync) → liệt kê `inbox/YYYY-MM/*.yml` chưa xử lý → với TỪNG file: hiện meta + chạy lại
`promote_gate.py check` + `share-scan` + `catalog.py check --shelf` trên máy admin → admin gật:
copy vào `templates/patterns/`, rebuild INDEX, bump số pattern ở 3 docs (khuôn checklist 081 §9),
commit; từ chối: nêu lý do. Mọi quyết định ghi `catalog.py record --decision promoted|rejected
--reason ...`; file xử lý xong move sang `processed/YYYY-MM/` (Drive sync ngược lên). Một file
một lượt, human-gated, không bulk-apply.

### S4 — Config + docs (XS)
- `.dify-share.json` commit (URL + secret sau khi admin deploy S1) + thêm vào
  `scripts/sparse-view.txt` (074).
- GUIDE §9b: viết lại theo drop mode (user: approve là xong, không cần git); state doc
  templates-and-promotion.md §9: thêm đoạn transport v2 + đường nhận `/shelf-inbox`.

## 5. Guard / test phải xanh

- S2 unit tests với fetch fake (không network trong test) — các case ở S2. Suite 081 (share git
  thật, promote, web, pytest) **không đổi hành vi**.
- Script: không test tự động được trong repo (chạy trên Google) → DEPLOY.md kèm **curl smoke
  test** (payload mẫu + secret sai phải bị từ chối) — nghiệm thu tay sau deploy.
- Nghiệm thu end-to-end: một máy user (không git identity) share thật → file + meta xuất hiện
  trong folder tháng đúng Asia/Tokyo → `/shelf-inbox` trên máy admin vet + land → commit lên main
  → máy khác pull thấy pattern.

## 6. Open questions

1. **Xoay secret**: nhịp nào, ai nhớ? Đề xuất: chỉ xoay khi nghi lộ (đổi Script Property + commit
   `.dify-share.json` mới); không đặt lịch. Chốt khi gặp sự cố đầu tiên.
2. **Trần dung lượng Drive** của admin khi inbox phình: `processed/` có nên tự dọn sau N tháng?
   Đề xuất: để nguyên (YAML nhỏ), chốt khi thấy số thật.
3. **Nhắc nhịp tuần** cho admin: thêm reminder (cron/schedule) hay để tự nhớ? Đề xuất: tự nhớ
   trước, thêm reminder nếu quên thật 2 tuần liên tiếp.

## 7. Non-goals (đã cân và LOẠI — đừng đề xuất lại)

- **Drive API/OAuth trên máy user** — LOẠI: đổi rào git lấy rào Google, friction per-máy.
- **Service-account key phân phát trong repo** — LOẠI: secret sprawl; key bị đẩy lên GitHub còn
  có thể bị secret-scanning thu hồi/lộ.
- **Google Form** — LOẠI: file-upload đòi sign-in + thao tác browser tay (mất one-click); dạng
  text chết vì Sheets cap 50k ký tự/cell — pattern vượt.
- **Folder Drive sync trên TỪNG máy user làm đường chính** — LOẠI (vòng 2): friction per-máy;
  sync chỉ còn ở MỘT máy admin.
- **Serverless ngoài Google (Cloudflare Workers…)** — LOẠI: thêm account + hạ tầng ngoài
  Workspace, không hơn gì Apps Script cho org này.
- **Bỏ đường git+PR 081** — LOẠI: đã build + test đầy đủ, là fallback tự nhiên khi config URL
  vắng và là đường của dev có quyền push.
- **Auto-apply không qua mắt admin** — LOẠI: cổng người thứ hai là hợp đồng chất lượng của kệ.
- **Receiver tự nuôi (VPS/container)** — LOẠI: ngoại lệ zero-backend chỉ cấp cho script Google
  host, không cấp cho service phải vận hành.
