# Spec 070 — Cửa nạp YAML ngoài: base **và** chưng cất trực tiếp, provenance thật

**Status**: **Implemented** (2026-07-17 — awaiting review). OQ1–4 resolved as the recommended defaults (single action=distill door; license stamped-not-blocked; `source=external`→orphan accepted; one route, two branches). Per README convention this spec can be **deleted** once the diff is reviewed.
**Effort**: M (S1 modal reframe = M · S2 distill-from-paste = M · S3 provenance honesty = S · S4 handoff+i18n = S · S5 test+docs = S)
**Depends on**: `base-import.ts` (spec 051, đã ship — cửa `POST /api/bases`; nhãn lịch sử, tra bằng `git show ca5e39e:docs/specs/051-*`) · `promote.ts` (spec 052, đã ship — luồng `kind:'promote'`) · [069](069-chunk-tier-and-fragments-injection.md) (bối cảnh **hạt** distill — xem §Context)

## Context

### Điều người dùng muốn

Modal `＋ Add YAML as base` hiện là **một cửa một việc**: dán/upload YAML → land thành base dưới `projects/`. Yêu cầu: biến nó thành **cửa chung để nạp YAML *từ ngoài* (chưa tồn tại trong project)** rồi **chọn xử lí**: dùng-làm-base, **chưng cất lên kệ**, (chừa chỗ cho action sau).

Điểm chốt của người dùng (nguyên văn ý): *"modal này chuyển để xử lí yml ở ngoài không tồn tại trong project cho các xử lí như chọn base, chưng cất…"* → **input luôn giống nhau** (YAML ngoài, paste/upload); cái thay đổi là **động từ** áp lên nó.

### Điều code hiện tại đã có (xanh, tái dùng nguyên)

- **Nạp base**: [`importYamlAsBase`](../../apps/builder/server/lib/base-import.ts) (`base-import.ts:103`) đã validate 4-linter trên temp file, guard traversal, derive slug **giữ tên JP** (`app.name` verbatim cho chip, slug ASCII riêng), scaffold tier, ghi verbatim vào `projects/<project>/<slug>/workflows/main.yml`. Route [`POST /api/bases`](../../apps/builder/server/routes/ui.ts) (`ui.ts:87`). UI [`ImportBaseModal`](../../apps/builder/web/src/components/Modal.tsx) (`Modal.tsx:101`), mở từ `App.tsx:433`, bàn giao qua `onImported → newTask({baseWorkflow})` (`App.tsx:572`).
- **Chưng cất (distill)**: [`promote.ts`](../../apps/builder/server/lib/promote.ts) là luồng `kind:'promote'` đầy đủ: `startPromote` → gate B1 `promote_gate.py check <sourceFile>` → `runDistillTurn` (ghi **staging** `apps/builder/.runs/<id>/promote/<slug>.yml`, **không thể** chạm `templates/`) → re-gate B2′ → gate `promote_review` → **human Approve là đường ghi DUY NHẤT** vào `templates/patterns/`. Route [`POST /api/promote`](../../apps/builder/server/routes/tasks.ts) (`tasks.ts:205`). **Bàn giao UI đã xong**: [`store.promote()`](../../apps/builder/web/src/store.ts) (`store.ts:772`) set task trả về làm active → panel promote (`ArtifactPanel` + gate) render nó — cả `App.tsx` đã xử lí `kind==='promote'` (không Ask, gate inline).

→ Reframe base **không đụng backend**. Distill-from-paste **đụng nhỏ** (stage nguồn + một nhánh nguồn mới). Bàn giao **miễn phí**.

### Hai chỗ bằng chứng bắt phải xử lí (không phải khẩu vị)

1. **Lỗ provenance có sẵn.** [`provenanceHeader`](../../apps/builder/server/lib/promote.ts) (`promote.ts:352`) **hard-code** `source=original … license=MIT` cho **mọi** pattern lên kệ. Với YAML **bên thứ ba** dán vào, stamp đó **khai man**: gán nhãn "của mình, MIT" cho tác phẩm không rõ nguồn/giấy phép — trong khi `templates/` là kệ **được redistribute** (lý do tồn tại allowlist `PERMISSIVE_LICENSES` + `THIRD_PARTY.md`). Đây là **defect có sẵn** của promote flow (base-import YAML ngoài rồi promote hôm nay đã dính); feature này chỉ làm nó **dễ gặp**. **Người dùng đã chốt: sửa cho thật** (D3).

2. **Hạt distill (tension với 069, chấp nhận có ý thức).** [069](069-chunk-tier-and-fragments-injection.md) — viết cùng ngày — kết luận bằng transcript rằng **distill hạt workflow là "SAI HẠT"** (chỉ ~3 pattern; 85% build `pattern: custom`; ③ **không gọi retrieval** ở hạt đó) và đang chuyển sang hạt **node/fragment** (`nodes:1`). Spec này **không phản đối 069** và **không tăng đầu tư vào nội dung kệ workflow** — nó chỉ mở **một cửa nạp** cho luồng promote **đang tồn tại và được bảo trì**. Nếu 069 thắng, cửa này vẫn trung lập: nó nạp *nguồn*, không quyết định *hạt*. Ghi ra đây để review cân nhắc, không để âm thầm.

## Goals

- **G1 — Một cửa, nhiều động từ.** Modal nhận YAML ngoài (paste/upload) **một lần**, rồi chọn action (base | chưng cất). Không bắt dán YAML hai lần cho hai việc.
- **G2 — Distill trực tiếp từ YAML dán.** `POST /api/promote` nhận thêm nguồn *pasted YAML* (ngoài nguồn *project workflow* hiện có), stage nó, chạy đúng pipeline B1→distill→B2′→Approve, **bàn giao sang panel promote sẵn có** (không dựng lại UI gate).
- **G3 — Provenance THẬT cho nguồn ngoài.** Pattern chưng từ YAML ngoài **không bao giờ** stamp `source=original`/`license=MIT` mặc định. Stamp trung thực `source=external`, `file="<nhãn người nhập/tên file>"`, `orig_sha256=<hash bytes dán>`, `license=<người chọn / unknown>`.
- **G4 — ỔN ĐỊNH TRƯỚC HẾT.** Không đụng FSM ①②③④, 4-linter gate, hay đường promote-from-project hiện có. Nguồn *project workflow* stamp **y hệt hôm nay** (`source=original`) — nhánh mới chỉ áp cho nguồn *external*. Không dời file, không script linter mới (kỷ luật 013/049).
- **G5 — Đãi lỗi sớm ở modal.** YAML rác (fail 4-linter) hiện lỗi **inline trong modal** như base-import, không đẩy người dùng sang gate `promote_blocked` mới hiểu.

## Non-goals

- ❌ **Không** tăng đầu tư vào *nội dung* kệ workflow (069 lo hạt; spec này chỉ lo *cửa nạp*).
- ❌ **Không** dựng lại UI gate/review trong modal — distill **bàn giao** sang panel task (`store.promote` đã làm việc này). "Full trong modal" bị bác có chủ đích: tái dùng > nhân bản.
- ❌ **Không** đụng luồng promote-from-project (nguồn local vẫn `source=original`, không đổi một byte).
- ❌ **Không** tạo tier lưu trữ mới. Base vẫn vào `projects/`; pattern vẫn vào `templates/patterns/`.
- ❌ **Không** auto-promote. Human Approve vẫn là đường ghi duy nhất vào kệ (050/052 giữ nguyên — đúng ở hạt này).
- ❌ **Không** làm "tab tạo corpus" (corpus read-only/gitignored; hành động thật là sửa `corpus/sources.yml` + re-clone).
- ❌ **Không** hoãn-đổi tên file/route hiện có ngoài phạm vi liệt kê ở Slices.

## Design

### D1 — Modal reframe: một input dùng chung + action picker (web, không backend)

`ImportBaseModal` (`Modal.tsx:101`) đổi thành cửa nạp chung. **Không cần component `Tabs` mới** — dùng lại pattern thanh `.artifact-tabs`/`.atab` của [`ArtifactPanel.tsx:328`](../../apps/builder/web/src/components/ArtifactPanel.tsx) + skeleton `.modal` (`surface-blocks.css:1160-1220`). `ImportBaseModal` vốn đã có **multi-view trong một modal** (bước "notice", `Modal.tsx:151`) — bằng chứng pattern này chạy được với code hiện có.

```
┌─ Add external workflow YAML ───────────────┐
│  [ Choose .yml/.yaml ]  hoặc dán ↓          │  ← input DÙNG CHUNG (như hôm nay)
│  ┌───────────────────────────────────────┐  │
│  │ app:  name: My Workflow  …            │  │
│  └───────────────────────────────────────┘  │
│                                              │
│  Dùng làm gì:  ( • Base )  ( ○ Chưng cất )  │  ← action picker
│  ─────────────────────────────────────────  │
│  «fields đổi theo action»                    │
│    Base:    Name(optional) · Target project  │  ← y hệt hôm nay
│    Distill: Source label · License(select)   │  ← D3, chỉ hiện khi action=distill
│                                    [ Cancel ][ Add ] │
└──────────────────────────────────────────────┘
```

- **Không dán YAML hai lần** (G1): input ở trên, action ở dưới, fields phụ thuộc action. Đây trực tiếp là "tránh trùng" người dùng dặn.
- Đổi tiêu đề `importBaseTitle` → chuỗi chung (vd "Add external workflow YAML"); mọi chuỗi mới có frame JA trong `i18n.ts` (hợp đồng localization).

### D2 — Distill-from-paste: stage nguồn → promote → bàn giao (backend nhỏ)

`promote_gate.py check <sourceFile>` **đọc nguồn từ đĩa** (`promote.ts:87`), và distill turn nhận `SOURCE_PATH` (`promote.ts:145`). Nên YAML dán phải **thành file** trước khi `startPromote` chạy B1. Đường đi:

```
POST /api/promote  { origin:'paste', yaml, name?, sourceLabel?, license? }   ← nhánh MỚI
  1. validate: 4-linter trên temp (TÁI DÙNG y hệt base-import.ts:136-154) → fail ⇒ 400 inline (G5)
  2. resolvePastedPromoteSource(yaml, name):
       slug ← deriveSlugName(app.name) → house-style hyphen (như resolvePromoteSource:393)
  3. createPromoteTask(… , sourceFile = 'apps/builder/.runs/<taskId>/promote/source.yml')
       → mint taskId + tạo run dir (task.ts:480,515)
  4. GHI yaml dán vào <sourceFile> TRƯỚC dispatch  (B1 đọc được ngay)
  5. dispatch(startPromote)  ← từ đây pipeline B1→distill→B2′→review CHẠY NGUYÊN

POST /api/promote  { project, workflow }                                      ← nhánh CŨ, 0 đổi
```

- `PromoteState` (`task.ts:125`) thêm trường mô tả nguồn (xem D3). Nguồn *paste* không có `{project, workflow}` thật → dùng giá trị tổng hợp (`project='(external)'`, `workflow=slug`) chỉ để hiển thị pill; **không** rò vào provenance (D3 dùng nhãn riêng).
- `stagedRel` (output distill, `promote.ts:47`) và `source.yml` **cùng thư mục** `…/promote/` nhưng **khác tên** — không đụng nhau.
- **Bàn giao**: `store.promote` (`store.ts:772`) đã set task active. Mở rộng nó (+ `api.promote`) nhận `{yaml, name, sourceLabel, license}`; modal action=distill gọi nó → **đóng modal → panel promote sẵn có render gate**. **Zero dòng UI gate mới** (Non-goal #2).

### D3 — Provenance THẬT: một nhánh `source=external` (backend nhỏ, đúng đắn)

`provenanceHeader(sourceFile, knownGoodDify)` (`promote.ts:352`) thêm tham số **origin**. Rẽ hai nhánh:

```
origin=local (project workflow)  → source=original repo= … license=MIT spec=052   ← Y HỆT HÔM NAY
origin=external (pasted YAML)     → source=external  repo= …
                                     file="<sourceLabel|tên file>"
                                     orig_sha256=<sha256(bytes dán)>
                                     promoted=<today>  license=<license|unknown>  spec=070
```

- `PromoteState` mang: `origin: 'local'|'external'`, `originLabel?`, `originSha256?`, `license?`. `finalizePromotion` (`promote.ts:309`) đọc chúng để stamp.
- **Hệ quả với `check_provenance.py` là ĐÚNG, không phải bug.** `classify()` (templates-and-promotion.md §5): `source=external` không có trong registry → **orphan**; `license_problems()` gắn cờ nếu license ngoài `PERMISSIVE_LICENSES`. Với một artifact **third-party không rõ nguồn**, bị đánh dấu orphan/license-review **chính là câu trả lời trung thực**. CI chạy `check_provenance.py` **không `--strict`** (warn-only) nên **không đỏ CI** — chỉ hiện cảnh báo, đúng ý.
- Vì sao không stamp `source=original` cho tiện: nó tắt trục nội dung của classify (axis 2 → current) và **giấu** đúng thứ cần lộ. Provenance thà **ồn mà thật** còn hơn **im mà dối** (bài học §5: "doc kém chính xác âm thầm nói dối").

### D4 — UX lỗi + eligibility

- **Fail 4-linter** (YAML hỏng) → 400, hiện inline trong modal như base-import (`base-import.ts:149`). Không tạo promote task.
- **Qua linter nhưng B1 ineligible** (vd ref/schema hợp lệ nhưng gate chặn vì lý do khác) → task park ở `promote_blocked` **trong panel** (đã có UI). Chấp nhận: distill vốn là luồng gated, một số phán quyết chỉ hiện sau khi task tồn tại.
- License: người dùng chọn từ dropdown (`PERMISSIVE_LICENSES` + `unknown`/`private`). **Không chặn** promote khi license không permissive — human Approve là control, và đây là kệ của chính người dùng; chỉ **stamp thật** để `check_provenance` cảnh báo. (Xem OQ2.)

## Slices

- **S1 — Modal reframe (web).** `ImportBaseModal` → cửa nạp chung: input dùng chung + action picker (`.atab` bar) + fields theo action. Base giữ nguyên hành vi. Đổi tiêu đề + chuỗi i18n (frame JA). **Không backend.**
- **S2 — Distill-from-paste (backend).** `POST /api/promote` nhận nhánh `origin:'paste'`: validate 4-linter (tái dùng base-import) → `resolvePastedPromoteSource` (slug từ `app.name`) → `createPromoteTask` với sourceFile trong run dir → ghi YAML → `startPromote`. Nhánh `{project, workflow}` cũ **không đổi**.
- **S3 — Provenance honesty (backend).** `provenanceHeader` thêm nhánh `origin=external`; `PromoteState` thêm `origin/originLabel/originSha256/license`; `finalizePromotion` stamp thật. Nguồn local stamp **y hệt hôm nay**.
- **S4 — Handoff + i18n (web).** `api.promote`/`store.promote` nhận `{yaml,name,sourceLabel,license}`; modal action=distill gọi nó → đóng modal → panel promote render. Chuỗi mới có frame JA.
- **S5 — Test + docs.** Server test: paste-source blocked (rác) → 400 không tạo task; paste-source clean → task `kind:'promote'`, staged chỉ trong run dir, Approve stamp `source=external` + hash; nguồn local vẫn `source=original` (0 hồi quy). Docs: cập nhật `docs/state/templates-and-promotion.md` §4/§5 (nhánh external) + `dify-io.md`/README nếu chạm cửa nạp; ghi rõ base `_drafts` **không index** (không phải reference cho retrieval).

## Open questions

- **OQ1 — Nguồn distill có cần nút "Chưng cất base này" ở panel không?** Sau khi land base, có nên thêm một nút chain sang promote-from-project (nguồn local, `source=original`) — hay để người dùng luôn đi qua action=distill (nguồn external)? Đề xuất: **chỉ action=distill trong modal** cho v1 (một đường, provenance nhất quán); nút-ở-panel để spec sau nếu có nhu cầu.
- **OQ2 — License không-permissive: chặn hay chỉ stamp?** Đề xuất **chỉ stamp thật + cảnh báo**, không chặn (human Approve là control; kệ của người dùng). Nhưng nếu repo muốn `templates/patterns/` sạch redistribute-able tuyệt đối, đổi thành **chặn Approve khi license ∉ `PERMISSIVE_LICENSES`**. Quyết định này thuần chính sách, chốt ở review.
- **OQ3 — `source=external` gây orphan trong `check_provenance.py`: chấp nhận ồn, hay thêm một `source` value được registry công nhận?** Đề xuất **chấp nhận orphan** (nó *đúng* — không có upstream đăng ký) vì CI warn-only. Thêm một registry entry giả cho "external" sẽ nói dối theo hướng ngược. Ghi để review biết trước tiếng ồn.
- **OQ4 — Có nên tái dùng `POST /api/promote` hay tách route `/api/promote-external`?** Đề xuất **một route, hai nhánh theo `origin`** (ít bề mặt, cùng lifecycle lock/gate). Tách route nhân đôi acquireTurn/dispatch mà không lợi gì.

## Acceptance criteria

1. *(G1/S1)* Modal nạp YAML **một lần**, chọn Base hoặc Chưng cất; chuyển action **không xoá** YAML đã dán. Base cho ra hành vi **y hệt** `POST /api/bases` hôm nay (server test base không đổi).
2. *(G2/S2)* `POST /api/promote {origin:'paste', yaml}` với YAML hợp lệ → tạo task `kind:'promote'`, chạy B1→distill→B2′, park `promote_review`; staged **chỉ** trong `apps/builder/.runs/<id>/promote/`; `templates/` **không** bị ghi trước Approve.
3. *(G5/S2)* YAML fail 4-linter → **400 inline trong modal**, **không** tạo promote task, **không** ghi gì.
4. *(G3/S3)* Approve một distill **nguồn paste** → `templates/patterns/<slug>.yml` mang header `source=external`, `file="<label>"`, `orig_sha256=<hash bytes dán>`, `license=<chọn/unknown>` — **không** `source=original`, **không** `license=MIT` mặc định.
5. *(G4/S3)* Promote một **project workflow** (nhánh cũ) vẫn stamp `source=original license=MIT` **y hệt hôm nay** — 0 hồi quy (server test promote cũ xanh).
6. *(G2/S4)* Sau khi POST distill-from-paste, SPA **tự mở** task đó trong panel promote (gate render inline) — không cần thao tác thêm; dùng lại đúng `store.promote`→`setTaskValue`.
7. *(Non-goal)* `git diff --name-only`: **không** dời file trong `templates/patterns/`, **không** thêm script linter, **không** đụng `orchestrator.ts`/FSM/`gate.ts` computeGate; thay đổi `promote.ts` **chỉ** ở `provenanceHeader` + đọc trường `PromoteState` mới.

## Findings

Node 22 (nvm; repo `engines` ≥22.6). Server `node --test`, web `vitest run`, typecheck `tsc --noEmit`.

| Kiểm | Kết quả |
|---|---|
| Typecheck server (`tsconfig.test.json`) + web (`web/tsconfig.json`) | **EXIT 0** cả hai |
| **Full server suite** (`test/**/*.test.ts`) | **576 pass / 0 fail / 1 skip** (skip pre-existing) |
| **Full web suite** (`vitest run`) | **191 pass / 0 fail** (18 files) |
| paste rác (linter fail) → 400, 0 task minted (AC3/G5) | ✅ `promote-external-route.test.ts` |
| empty paste → 400 door paste (không nhầm "project required") | ✅ same |
| paste clean → staged `source.yml` trong run dir + `origin=external` → review | ✅ `promote.test.ts` |
| Approve external → stamp `source=external` + license khai + hash + `spec=070`, **không** `source=original/MIT` (AC4/G3) | ✅ same |
| project workflow (nhánh cũ) → `source=original`/`spec=052` (AC5, 0 hồi quy) | ✅ `provenanceHeader` 2-arg test + AC5/AC6 flow xanh |
| Base door sau reframe (`POST /api/bases`) | ✅ `base-import.test.ts` 4-linter reuse xanh |

**Bug bắt được trong review (fake đã giấu):** stage `source.yml` trong `promote/` khiến `relocateRunArtifacts`
(`rename` `.runs/<id>/promote` → canonical `promote/` non-empty) **ENOTEMPTY-fail** khi turn thật ghi shorthand
→ distill task error. **Fix:** stage ở **run-dir ROOT** (`apps/builder/.runs/<id>/source.yml`), giữ `promote/`
chỉ chứa output của turn. Repro độc lập xác nhận OLD=ENOTEMPTY / NEW=OK; thêm test ghi-shorthand ép relocate chạy thật.

**Verify runtime THẬT (không fake):**
- `promote_gate.py check` + **4 linter thật** trên source → `eligible:true`, `probe:skipped` (no creds), **không chặn theo path** → external source ở run-dir chạy được.
- `check_provenance.py` thật trên pattern `source=external` → `[orphan] source 'external' not in registry`; **non-strict EXIT 0** (finalize + CI), `--strict` EXIT 1 (opt-in, flag đúng). Khớp D3/OQ3.
- `vite build` production → Modal/Sidebar/App vào bundle OK.

**Chưa auto-verify (bản chất khó):** distill turn `claude` thật (cần auth, đắt) — luồng quanh nó có test, chất lượng output turn thì không; và click-through browser thật (nút header→modal→panel) — route phủ bằng Fastify inject, tương tác DOM thị giác thì không.

## References

- `base-import.ts:103` (`importYamlAsBase`) — cửa base, validate/slug/scaffold **tái dùng nguyên** (S1/S2)
- `promote.ts` — luồng `kind:'promote'`: `startPromote:101` · `runDistillTurn:131` · `stagedRel:47` · `provenanceHeader:352` (điểm sửa D3) · `resolvePromoteSource:378` (mẫu cho nguồn paste)
- `state/task.ts:480` (`createPromoteTask`, mint id + run dir) · `:125` (`PromoteState`, thêm trường origin)
- `routes/tasks.ts:205` (`POST /api/promote`, thêm nhánh paste) · `routes/ui.ts:87` (`POST /api/bases`, tham chiếu)
- web: `Modal.tsx:101` (`ImportBaseModal`) · `ArtifactPanel.tsx:328` (pattern `.atab`) · `store.ts:772` (`promote`, bàn giao) · `:689` (`importBase`) · `api.ts:123` (`importBase`/`promote`)
- [069](069-chunk-tier-and-fragments-injection.md) — **hạt** distill (bối cảnh: cửa này trung lập với kết luận của 069)
- `docs/state/templates-and-promotion.md` §4 (pipeline promote) · §5 (`classify`/`license_problems` — vì sao `source=external` → orphan là **đúng**)
