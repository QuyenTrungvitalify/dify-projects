# Spec 105 — Không phải việc sửa nào cũng là một build mới

> **Status**: **mở** · **S0 + S2b ĐÃ SHIP (2026-08-21)**. Lập 2026-08-20 · **VIẾT LẠI HOÀN TOÀN
> 2026-08-21** theo phân loại hai-loại của user, sau một vòng khảo sát code 5 hướng + phản biện 3
> lăng kính (FSM · UX · chi phí) + một vòng kiểm chứng 116 claim. Xem §0 — bản trước sai ở một chỗ
> nền tảng.
>
> **S0 landed** — nhánh `spec-103-lane-b`, 5 commit: ba bài học field 2026-08-19 · làn 提案 của 103 ·
> route `undo-fix` · ba spec đang mở. (Một `tsconfig.audit.json` scratch lọt vào commit qua một
> `git add` theo thư mục, đã gỡ bằng commit riêng — **bài học: stage theo Ý ĐỊNH, không theo thư mục**.)
>
> **S2 landed** — loại trừ hai chiều. `canPropose` **tách ra lib thuần** (`propose-lane.ts`) đúng lý do
> `composer-route.ts`/`gate-foot.ts` đã tách: nó hỏng **im lặng cả hai chiều**. Một test cũ grep source
> App.tsx bị **nghỉ hưu theo đúng lời nó tự khai** — nó tồn tại *"vì predicate là biểu thức JSX inline
> không có chỗ unit-test riêng"*, giờ đã có. Suite **1193/1193** · web **447/447**.
>
> **S2c landed** — `autoAdvanceAfterFix` ở **ba** chỗ (không phải hai như §4.3.2 dự đoán: `replyWithin`
> return sớm ở 4/5 nhánh) + nhánh `apply_spec`, kẹp `phase==='implement'`. ~~Hard-stop `specStale` quay
> lại ở đây~~ — **đã ship rồi GỠ ngay sau đó, xem §8.0.** Harness phải học cùng một chuyện: ③ của nó chưa từng chạm
> `SPEC.md` nên **mọi** vòng fix đo thành spec-stale — một phán quyết về CÁI FAKE, không phải về code.
> Suite **1190/1190**. Năm mảnh đỏ-khi-revert riêng lẻ.
>
> **S3 landed** — `snapshotDiffBase` khoá theo `seedAppId` thay vì `seedPath`: Undo giờ có mặt trên
> đúng ca nó sinh ra để phục vụ. Phần predicate của S3 **bị bỏ** — kiểm chứng cho thấy nó gây báo
> động giả trên **mọi** build edit-existing (§4.4.1); nó thuộc LOẠI 2, không thuộc đây.
>
> **S2b landed — NHƯNG chỉ MỘT NỬA**, và nửa kia bị gỡ sau một vòng soát (§4.3.1a). Hard-stop
> `artifactUnchanged` đã ship, kiểm đỏ-khi-revert **qua đường sản phẩm thật** (build edit-existing,
> phép đo tự suy từ đĩa). Hard-stop `specStale` **BẤT KHẢ ĐẠT** hôm nay ⇒ đã gỡ, chuyển vào **S2c**.
> Suite server **1178/1178**, typecheck sạch.
>
> Phạm vi: **hai loại việc, hai đường khác nhau.**
> **LOẠI 1** — sửa một workflow đã có: cơ chế **đã ship gần hết** (spec 103 Làn B); còn lại là hành vi
> `自動` + hai lỗ im lặng, **backend-only**.
> **LOẠI 2** — mang một thứ (yml / spec / yêu cầu) vào để dựng hoặc sửa: chọn **điểm bắt đầu**, tối
> thiểu ③+④.
>
> **Không chạm**: cap-5 lint · import Dify · promote · `computeGate` (giữ thuần) · cơ chế Làn B của 103.
> Liên quan: [103](103-spec-stays-true-through-the-fix-loop.md) (**cả cơ chế ③-tự-viết-lại-spec lẫn làn 提案 đều đã ship trong
> working tree, CHƯA COMMIT** — §0.2) · [092](092-composer-two-send-actions.md) (ý định per-message).

---

## 0. Bản này khác bản trước ở đâu

### 0.1 Sai lầm nền tảng của bản trước

Bản trước (2026-08-20) thiết kế một **"phiên adopt"** — mint một task park sẵn ở gate ③ — và coi đó
là phát minh trung tâm. Sai ở chỗ: nó **không đọc working tree**. Toàn bộ vòng "chat → chọn sửa ngay
hay lập kế hoạch trước → duyệt → sửa" **đã được implement rồi** (spec 103 Làn B). Bản trước đề xuất
xây lại một thứ đang chạy.

| # | Bản trước | Bản này |
|---|---|---|
| 1 | "Vòng fix cần một cửa mới (adopt) park ở gate ③" | Vòng fix **đã đủ**, kể cả nhánh 提案 spec — **và cửa vào cũng đã đúng**. Cái sai là *build chui ra từ cửa* chạy ①②③④ trên một workflow đã tồn tại. §4.2 |
| 2 | `fixNeedsSpec` — một **setting** bật/tắt việc fix có qua spec không | **Đã có, và tốt hơn**: một lựa chọn **per-message** ngay ở nút gửi — 「すぐ直す」 / 「先に計画を見せて」 (i18n.ts:764/766). Không cần setting nào. §4.1 |
| 3 | Coi `startPhase` là chuyện của "phiên adopt" | Tách bạch: **LOẠI 1 KHÔNG dùng startPhase** (nó đi qua `/reply`, giữ được diff-base + Undo + hoà giải spec). Chỉ **LOẠI 2** mới cần. §5 |
| 4 | Không biết ba lỗi im lặng đang khoá vào `opts?.replyText` | Một lượt ③ **tươi** không được dặn hoà giải `SPEC.md`, không đo `specStale`, không có Undo — và đó đúng là lượt mà cả hai loại sẽ tạo ra. §4.4 |
| 5 | Đề xuất "自動 tự duyệt 提案 spec" (ý của user) | **LOẠI**, 3/3 phản biện độc lập cùng kết luận. Thay bằng: `auto` thì **không chào** lựa chọn 提案. §4.3 |

### 0.2 `[ĐO code]` Spec 103 Làn B ĐÃ SHIP — và chưa commit

Đọc-là-thấy, tự kiểm 2026-08-21:

| Mảnh | Ở đâu |
|---|---|
| Cờ per-task `specRevise` + `specReviseFrom` (để quay lại đúng chỗ khi 「やめる」) | `state/task.ts` |
| ⚠️ **Một khe hở còn lại**: nhánh `apply_spec` khi `applySpecProposal` trả `false` dựng gate lỗi **thiếu** `{ specRevise }` ⇒ gate chỉ có Retry/Discard, mà `PUT /spec` vẫn 409 ⇒ **build kẹt với một 提案 không xoá được bằng UI**. Gộp vào S2 (cùng file) | `confirmAdvance` nhánh `apply_spec` |
| **Lối thoát khi lượt ② revise CHẾT**: gate lỗi được thêm `drop_spec` 「やめる」 — quan sát thật trên task `1787220388060` (revise dính usage limit) | `gate.ts` — nhánh `if (opts.specRevise)` trong khối `outcome === 'error'` |
| Gate 提案 với ba hành động `Go with this` / `Change the plan` / `Never mind` | `gate.ts` — `case 'spec'` → `if (verify.outcome === 'spec_proposal')` |
| `auto` **HARD-STOP** trên gate đó — comment nói thẳng *"`auto` must never self-approve"* | `maybeAutoAdvance` (orchestrator) · `flag: 'spec_proposal'` (gate.ts) |
| ② chạy prompt riêng `spec-revise.md`, ghi ra `SPEC.next.md` (không đụng `SPEC.md`) | `phases.ts:41,121` |
| `beginSpecProposal` / `applySpecProposal` (= `rename`) / `dropSpecProposal` | `lib/diff.ts` · gọi từ `orchestrator.ts` |
| Gác server-side `wantsPropose` — tự suy lại tính hợp lệ, không tin FE | `routes/tasks.ts` (trong `POST /reply`) |
| Hai lối gửi ở composer: 「すぐ直す」/「先に計画を見せて」 | khoá i18n `sendFixNow`/`sendPlanFirst` · `SendVariants` (Chat.tsx) · `canPropose` (App.tsx) |
| Sự kiện timeline + dòng dossier cho applied/dropped | `spec_proposal_applied`/`_dropped` — `run-events.ts` · `dossier.ts` |

**Cảnh báo vận hành**: khối này **chưa commit** (hàng chục file `M` + `??`). Mọi việc của spec 105
đều đụng đúng các file đó. **Commit hoặc stash có nhãn khối 103 TRƯỚC khi bắt đầu 105** — nếu không,
một lần `git checkout --` là mất Làn B.

### 0.3 Nhật ký quyết định — mọi câu đã chốt, và câu chưa

Bảng này để đọc thay cho cả spec khi cần nhớ *"đã chốt gì rồi"*.

| # | Câu hỏi | Chốt | Ở đâu |
|---|---|---|---|
| 1 | Sửa một workflow đã có: xây cửa mới hay dùng cái đã có? | **Dùng cái đã có.** Vòng fix + hai lối gửi 「すぐ直す」/「先に計画を見せて」 **đã ship**. Chỉ thiếu **cửa vào** | §0.2 · §4.1-4.2 |
| 2 | Fix có bắt buộc qua spec không? | **Không — và không cần setting.** Là lựa chọn **per-message** ở nút gửi, đã có | §4.1 |
| 3 | `自動` có tự duyệt 提案 không? | **KHÔNG.** Cổng $0,36–2,23 đang gác lệnh mua $6,85–15,84; và auto-approve cũng **không** cho ra tự-động thật | §4.3 |
| 4 | Vậy ở `自動` ai giữ `SPEC.md` khỏi lạc hậu? | **Chính lượt ③** — nó tự viết lại sau khi linter xanh. Không cần cửa duyệt | §4.3 |
| 5 | `自動` ↔ 提案 loại trừ mấy chiều? | **Hai.** Chiều ngược đang **hỏng thật**: `PATCH` không gác `specRevise` ⇒ bật auto giữa lúc 提案 treo thì **không gì xảy ra** | §4.3 |
| 6 | `自動` có chạy hết cả vòng fix không? | **Có** — một dòng `maybeAutoAdvance` ở đuôi `replyWithin`. Hôm nay build mới tự chạy, vòng fix thì không: bất đối xứng chưa ai chủ ý chọn | §4.3.2 |
| 7 | Ship thứ tự nào? | **S2b TRƯỚC S2c.** Gate ③ đang là phanh duy nhất của vòng fix ở auto — gỡ phanh trước khi lắp phanh mới là sinh lỗi im lặng | §4.3.2 ⛔ |
| 8 | Tiêu chí "lượt này có phải sửa cái đã có không"? | **`main.yml` đã tồn tại**, KHÔNG phải `SPEC.md` tồn tại (bản trước tôi viết sai — sẽ bật phép đo trên mọi build mới) | §4.4.1 |
| 9 | LOẠI 2 điểm bắt đầu: mấy lựa chọn? | **Hai trên UI** (ぜんぶ作る / あるものを直す). Bỏ 「từ ②」 — không ai trả lời được | §5.4 |
| 10 | Thêm chip thứ 6? | **Không.** Thay chip 高速ビルド bằng chip thang bậc — hàng chip hết slack, đã có tiền lệ từ chối | §5.3 |
| 11 | QA tay bao nhiêu mục? | **2** nếu chỉ ship LOẠI 1 · **4** nếu ship cả LOẠI 2. Mọi thứ khác là unit test | §6.9 |
| 12 | Cây bút chì ở sidebar? | **Giữ nguyên** — lối thoát *cố ý đắt*, nhãn đang dạy đúng | §4.2 · §7 |
| 13 | Có sửa gì ở cửa vào sidebar không? | **KHÔNG.** Cửa vào đã đúng cả 4 ca; `workflow-row.ts` đã bác bỏ đúng đề xuất cũ của tôi bằng chữ. Vấn đề nằm ở **cái build chui ra**, không ở cửa. (LOẠI 1 vẫn đụng FE **hai chỗ** trong S2 — không phải "không dòng nào") | §4.2 |
| 18 | Mint LOẠI 2 sai kiểu thì sao? | **400 fail-loud**, không hạ cấp im lặng. Guard bám `start_phase`, **không** bám `slug` | §6 S4 |
| 19 | Số đo §1.2 tin được tới đâu? | Có **đóng dấu ngày**. Ô chi phí đã bị gỡ một con số **không dựng lại được** và sửa tỉ số ②:③ từ "15–40×" (so min-với-max) xuống **~2,5× trung vị / ~27× đuôi** | §1.2 · §4.3 |
| 20 | Làm LOẠI 2 ngay sau LOẠI 1? | **Không.** Ship LOẠI 1 → **đo nhu cầu** → mới quyết. Giá trị của LOẠI 2 là **thời gian**, không phải tiền | §6 |
| 15 | Đặt `maybeAutoAdvance` ở đâu? | **HAI chỗ** (nhánh `phase==='test'` + đuôi), **kẹp `phase==='implement'`**. Một dòng ở đuôi ⇒ auto chạy **so le** giữa các vòng fix | §4.3.2 |
| 16 | ~~Ràng buộc thứ tự?~~ | **Không còn áp dụng**: ràng buộc đó tồn tại vì hard-stop `specStale`, mà guard đó đã bị gỡ (§8.0). S2c đứng một mình | §8.0 |
| 17 | Hàng chip có mấy chip? | **4**, không phải 5 (chip `mode` là code chết). Chip 作り方 là thứ **5** — vẫn thay chip 高速ビルド, nhưng vì **ngữ nghĩa**, không vì layout | §5.3 |
| 14 | Vậy còn lại gì cho cửa vào? | Một **giá trị mặc định** của chip 作り方 khi workflow đã được chọn sẵn — không phải affordance mới | §4.2.1 |

**Còn để ngỏ** (§8): `/report` chấm task rút gọn bằng gì · `_drafts` vắng trong dropdown · hai build
cùng một workflow đè `SPEC.next.md`/Undo của nhau · `自動` trên build đang `testMode='live'` sẽ tự
chuyển sang kiểm tĩnh mà không nói.

---

### 0.4 ⚠️ Cảnh báo về mọi trích dẫn `file:line` trong spec này

`[ĐO]` Một vòng soát tự động (2026-08-21) đối chiếu **từng** trích dẫn với code và tìm ra **lệch có hệ
thống**: `orchestrator.ts` +10…+36 dòng · `App.tsx` ~+11 · `Chat.tsx` ~+14 · `task.ts` +4 ·
`diff.ts` trỏ vào JSDoc thay vì thân hàm · `i18n.ts` trộn lẫn block EN và JA (hai block cách nhau
~500 dòng nên số dòng trần luôn mơ hồ).

**Nguyên nhân không phải cẩu thả — là bản chất**: khối spec 103 đang được sửa **trong lúc** spec này
được viết. Số dòng là một toạ độ trên một mặt đất đang dịch chuyển.

⇒ **Luật cho spec này**: trích dẫn neo theo **TÊN KÝ HIỆU** (hàm, field, khoá i18n, tên nhánh), không
theo số dòng. Chỗ nào còn số dòng thì đọc là *"khoảng đó"*, và **luôn `grep` tên ký hiệu trước khi
sửa**. Nội dung mọi câu trích nguyên văn đã được kiểm và **đúng** — chỉ toạ độ sai.

> **Bài học đắt hơn, đáng ghi vào `AGENTS.md` §9**: cùng vòng soát đó tìm ra spec này **bịa ra một
> lỗi không tồn tại** (§4.4 ô đính chính — guard `PUT /spec` đã được vá sẵn). Viết spec dựa trên một
> lần đọc code **cũ vài giờ** là đủ để sinh ra việc làm thừa. Với một working tree đang sống:
> **grep lại ngay trước khi code, đừng tin spec.**

---

---

## 1. Vấn đề

### 1.1 Một câu

Builder chỉ biết **một** cách bắt đầu: chạy từ ① với một tờ giấy trắng. Nhưng người dùng thường
**đã cầm sẵn thứ gì đó** — một workflow đang chạy, một file yml ai đó đưa, một bản spec đã viết — và
với họ, "sửa nó" không phải là "dựng lại nó".

### 1.2 Bằng chứng

Đo trên `.runs/` máy tác giả — **đóng dấu 2026-08-21: 54 task** (23 build · 20 consult · 11 promote).
⚠️ Cây `.runs` lớn lên mỗi ngày, nên **mọi ô dưới đây phải đọc kèm ngày**; repro §1.3 chạy lại được bất cứ lúc nào.

| Nhãn | Sự việc |
|---|---|
| `[ĐO — 2026-08-21]` | **Vòng fix LÀ công việc chính**: `phase_start` — ③ **59** lần, ② 30, ① **21**. Tỉ lệ ③:① ≈ **2,8×**. Trên một build: **26** `phase_start`, **22** `request_changes`, **73** tin nhắn. *(Bản 2026-08-20 ghi 44/20 ≈ 2,2× — cây `.runs` đang lớn lên, hướng không đổi.)* |
| `[ĐO — 2026-08-21]` | **Giá vào vòng đó**: trung vị ① **129s** (n=20) + ② **190s** (n=27) = **~319s máy + 2 gate** trước khi ③ chạm file. |
| `[ĐO — n nhỏ, đọc kỹ]` | **Tiền KHÔNG nằm ở ①②** — nhưng số liệu mỏng hơn bản trước của spec này tuyên bố. Toàn `.runs` chỉ có **23** sự kiện `turn_cost`, thuộc **4** task, và **phase ① CHƯA TỪNG ghi `turn_cost` lần nào**. Đo được: ② **$0,36–0,59** (n=6) · ③ **trung vị ~$1,1, đuôi tới $15,84** (n=17). ⇒ tỉ lệ ②:③ là **~2,5× ở trung vị**, **~27× ở đuôi**. Con số "①+② median $1,70 (n=21)" ở bản trước **không dựng lại được từ repro §1.3** — đã gỡ. Kết luận **không đổi**: bỏ phase không phải chuyện tiết kiệm (§5.4). |
| `[ĐO]` | **Cửa "chọn WF có sẵn" chưa từng dùng được**: 2/21 build đặt `workflow`; cả hai chết trước ③. |
| `[ĐO code]` | Bấm hàng workflow ở sidebar: **1 build** → mở build đó (đúng); **0 hoặc 2+ build** → `newTask` = build mới ①②③④ (`web/src/lib/workflow-row.ts:30-33`). Cây bút chì thì **luôn** `newTask`, và nhãn của nó nói thẳng: 「新しい会話で編集」 (`i18n.ts:354`). |
| `[ĐO code]` | `init_project.py --kind workflow` **không** tạo `SPEC.md`, **không** tạo `main.yml`. Template `templates/_base/workflow/` chỉ có 4 thư mục rỗng `.gitkeep`. `SPEC.md` xuất hiện là do gate ② `rename` vào. |

### 1.3 Repro

```bash
cd apps/builder && python3 - <<'PY'
import json,glob,statistics as st,collections
per=collections.defaultdict(list); costs=[]
for f in sorted(glob.glob('.runs/*/events.jsonl')):
    ev=[json.loads(l) for l in open(f) if l.strip()]; pend={}
    for e in ev:
        if e['kind']=='phase_start': pend[e['phase']]=e['ts']
        elif e['kind']=='gate_reached' and e.get('phase') in pend:
            d=(e['ts']-pend.pop(e['phase']))/1000
            if 0<d<1800: per[e['phase']].append(d)
        elif e['kind']=='turn_cost': costs.append((f.split('/')[1],e['phase'],e['cost']['totalCostUsd']))
for p,v in per.items(): print(p,f"n={len(v)} median={st.median(v):.0f}s")
print(costs)
PY
```

---

## 2. Hai loại việc

Đây là phân loại của **người thiết kế**, không phải nhãn cho người dùng (§7 — UI không bao giờ được
nói "loại 1 / loại 2").

| | LOẠI 1 — sửa cái đã có | LOẠI 2 — mang một thứ vào |
|---|---|---|
| Người dùng đang cầm | một workflow **đang chạy trong app** | một file yml / một bản spec / một yêu cầu |
| Đường đi | `/reply` — **vòng fix**, giữ nguyên session ③ | `POST /api/tasks` — một build **rút gọn** |
| Chọn gì | 「すぐ直す」 hay 「先に計画を見せて」 | **điểm bắt đầu**: ①②③④ hay ③④ |
| Trạng thái | **đã ship ~90%** (§0.2) — còn hành vi `自動` + 2 lỗ im lặng, **không đụng FE** | **chưa có gì** — 5 điểm vỡ cứng + chip |
| Đảm bảo giữ được | diff-base · Undo · hoà giải `SPEC.md` · rubric ④ | 4 linter (③ + ④) · preflight |
| Đảm bảo **mất** | — | rubric ④ (`criteria.json`) · pattern-pick của ① |

**Ranh giới người dùng thật sự đọc được không phải "loại", mà là VỊ TRÍ** — và app đã dạy nó rồi:
đang ở trong một hội thoại thì 「修正を依頼」; ở màn hình trống thì 「新しい会話で編集」 (`i18n.ts:343-347`).
Giữ nguyên ranh giới đó.

---

## 3. Nguyên tắc

1. **Đường rẻ phải là đường mặc định, và phải nói ra được.** Sửa ≠ dựng lại. Một cú click ở sidebar
   không được âm thầm mua một build $6–16.
2. **Không thêm trạng thái mới. Tái dùng cơ chế đã ship.** Làn B đã có; `startPhase` là mở rộng một
   dòng đã tồn tại (`orchestrator.ts:113`), không phải một FSM thứ hai.
3. **Enter luôn là hỏi; hành động đắt là một click có chủ đích** (092). `auto` không được biến một
   lựa chọn người dùng vừa bấm thành thứ khác (§4.3).
4. **Bỏ bước thì phải NÓI ra đã bỏ gì.** Mọi phép kiểm không chạy phải hiện thành CHỮ, không được
   biến mất im lặng — đúng luật `AGENTS.md` §9 (2026-08-05).
5. **Không lỗi im lặng.** Ưu tiên sửa "chạy được nhưng sai" hơn "chết ồn ào". Ba lỗi nặng nhất của
   spec này đều thuộc loại đó (§4.4, §5.6).
6. **UI nói tiếng người dùng cuối.** "spec / implement / phase" là tiếng máy ở chỗ QUYẾT ĐỊNH —
   chính codebase đã tự cưỡng chế luật này (`Chat.tsx:831-832`: nhãn menu gửi cố ý tránh từ "spec").

---

## 4. LOẠI 1 — sửa một workflow đã có

### 4.1 Đã có gì (đừng dựng lại)

Người dùng đang ở trong một hội thoại của một build, gõ điều muốn sửa, rồi chọn **một trong hai lối gửi**:

```
┌────────────────────────────────────────────────────────────────┐
│  [gõ điều muốn sửa...]                                         │
│                              [✎ 修正を依頼 ▾]      [↵ 送信]     │
│                                 ├ すぐ直す          ← ③ ngay    │
│                                 └ 先に計画を見せて   ← ② 提案    │
└────────────────────────────────────────────────────────────────┘
                                          │
                        ┌─────────────────┴──────────────────┐
                        ▼                                    ▼
              ③ resume, sửa main.yml            ② spec-revise → SPEC.next.md
              lint cap-5 → gate ③               (SPEC.md KHÔNG bị đụng)
                                                          │
                                      ┌───────────────────┼───────────────────┐
                                      ▼                   ▼                   ▼
                              draft KHÁC spec       draft TRÙNG spec      lượt ② CHẾT
                              → gate 提案            → tự bỏ draft,        → gate lỗi
                                [Go with this]        repark im lặng-      + [Never mind]
                                [Change the plan]     có-giải-thích,       (lối thoát $0)
                                [Never mind]          KHÔNG tốn gate
```

Đây **chính xác** là 1a/1b của anh, và **đã chạy**. Không cần setting `fixNeedsSpec`: lựa chọn nằm ở
**từng tin nhắn**, đúng nguyên tắc 092.

### 4.2 Cửa vào ở sidebar **KHÔNG hỏng** — đừng đụng vào

Bản trước của mục này đề xuất đổi hành vi click hàng workflow (2+ build → mở build mới nhất + arm
sẵn 修正を依頼; 0 build → mint rút gọn). **Bỏ.** `[ĐO code]` Chính `workflow-row.ts` đã cân nhắc và
**bác bỏ** đúng đề xuất đó, bằng chữ:

> *"anything else (0 or 2+) → arm a new edit-existing build. **With several children, picking one for
> the user would be a guess**; with none there is nothing to open."*

Đọc lại từng ca thì cửa vào hôm nay **đã đúng**:

| Hàng workflow X | Hôm nay làm gì | Có vấn đề không |
|---|---|---|
| 1 build | mở thẳng build đó | **Không** — vào ngay hội thoại, có 修正を依頼 |
| 2+ build | hàng **mở ra**, người dùng bấm đúng build mình muốn | **Không** — 2 click, và **người dùng chọn**, không phải máy đoán hộ |
| 0 build | mint task mới, **workflow đã được chọn sẵn** ở chip ワークフロー | **Không** — không có gì để mở thì task mới là đúng |
| synthetic `(unsaved)` | không làm gì | **Không** — spec 090 đã chặn |

**Vấn đề thật không nằm ở CỬA, nằm ở CÁI BUILD chui ra từ cửa đó**: task mint ra chạy ①②③④ trong
khi workflow đã tồn tại. Sửa chỗ đó là việc của **chip 作り方** (§5.3-5.4), không phải việc của
sidebar.

⇒ **LOẠI 1 không đụng SIDEBAR / cửa vào.** Nhưng nó **vẫn đụng FE đúng hai chỗ**, cả hai thuộc S2:
một mệnh đề trong `canPropose` (`App.tsx`), và lọc giá trị `auto` khỏi option list của chip 確認
(`Chat.tsx` — hôm nay hardcode cả ba). Phần còn lại là backend. Cửa vào giải quyết trọn trong LOẠI 2.

#### 4.2.1 Mảnh duy nhất còn lại — một giá trị **mặc định**, không phải một cửa

Khi click hàng workflow X (ca 0-build) hoặc bấm bút chì, `newTask({ baseWorkflow })` đã đặt sẵn
`settings.workflow = "<project>/<slug>"`. Ở đúng khoảnh khắc đó, người dùng vừa nói *"tôi muốn làm
gì đó với X"* — nên mặc định hợp lý của chip 作り方 là **「あるものを直す」**, không phải 「ぜんぶ作る」.

Một dòng, cùng chỗ `fastMode` đang bị force-off. Điều kiện: chỉ mặc định như vậy khi
`workflows/<file>` **thật sự tồn tại** — một workflow đã scaffold nhưng chưa từng có `main.yml` thì
không có gì để sửa, phải rơi về 「ぜんぶ作る」.

**Đây là một `default`, không phải một affordance mới** — người dùng vẫn đổi chip được, và không có
hành vi nào của sidebar thay đổi.

### 4.3 「自動」 và 提案 spec — KHÔNG auto-approve

Anh đề xuất: `確認=自動` thì 提案 spec tự được duyệt. **Ba phản biện độc lập cùng kết luận: đừng.**

| Lăng kính | Lý do |
|---|---|
| **Kinh tế** *(lăng kính YẾU NHẤT — đọc sau hai cái trên)* | Cổng đúng chiều, nhưng tỉ số khiêm tốn hơn bản trước ghi: ② đo được **$0,36–0,59** (n=6) gác một lượt ③ **trung vị ~$1,1** (n=17), **~2,5×** — chỉ ở **đuôi** ($15,84) mới thành ~27×. *(Bản trước ghi "15–40×" bằng cách so min-với-max — đã sửa.)* Điều **không** đổi: 「やめる」 tốn **$0**, và auto-approve bỏ luôn lối thoát miễn phí duy nhất. |
| **UX** | 「先に計画を見せて」 là ý định **per-message** — người dùng vừa bấm đúng cái nút xin được xem kế hoạch. Auto-approve = app trả lời "không" cho một yêu cầu vừa được nói ra. |
| **FSM** | Nó cũng **không** cho ra tự-động thật: nhánh `apply_spec` `return` ngay sau `runPhaseAndGate` (`orchestrator.ts:199-200`), bỏ qua `maybeAutoAdvance` ở đuôi — nên auto vẫn **dừng cứng ở gate ③**. Kết quả là "nửa tự động": mất người duyệt mà không được tự động. |

**Thay bằng: `自動` = làn tự-ghi, và đó KHÔNG phải mất mát.**

Câu hỏi đúng không phải *"auto có được duyệt hộ không"* mà *"trong auto, ai giữ cho `SPEC.md` khỏi lạc
hậu"* — và câu trả lời đã có sẵn: **chính lượt ③ tự làm việc đó**. `implement.md` §6 bắt chính lượt ③ mở `SPEC.md` ra và làm
nó khớp workflow sau khi linter xanh, **trên cả đường tươi lẫn đường resume** (§4.4 ô đính chính).

```
確認 = 各ステップ / 仕様のみ          確認 = 自動
  hai lối gửi:                        MỘT lối gửi:
  ├ すぐ直す        → ③ (tự ghi spec)   └ すぐ直す → ③ (tự ghi spec)
  └ 先に計画を見せて → ② → gate → ③     (không menu, không gate 提案)
     ↑ mua một cửa duyệt $0,36–2,23        ↑ đúng nghĩa "không dừng lại"
```

**Luật, một câu**: 提案 là **cửa cho người**; 自動 là **chế độ không người**. Hai thứ không cùng tồn
tại — và phải cưỡng chế **cả hai chiều**, vì mỗi chiều bịt một lỗ khác nhau.

| Chiều | Cưỡng chế ở đâu | Lỗ nó bịt |
|---|---|---|
| `自動` ⇒ **không chào** 提案 | `canPropose` — **MỘT** định nghĩa duy nhất trong `App.tsx` (hai chỗ dưới chỉ truyền prop): thêm `&& task.confirmMode !== 'auto'`. Hôm nay nó đã là `project && workflowSlug && artifacts.implement && !specRevise` | nút xin xem kế hoạch mà chế độ đã khai là "đừng hỏi tôi" |
| **提案 đang treo** ⇒ **không cho bật** `自動` | `[ĐO code]` `PATCH /api/tasks/:id` (`routes/tasks.ts`) gác `done`/`cancelled`/turn-running/`isCancelled` — **không** có guard `specRevise`. Thêm: `if (wantsConfirm && task.specRevise && mode==='auto') return 409`; FE bỏ dòng 自動 khỏi menu chip khi `task.specRevise` | **nút nói dối**: hôm nay người dùng đứng ở gate 提案 vẫn bật được 自動, rồi **không có gì xảy ra** — `maybeAutoAdvance` hard-stop trên `spec_proposal`. Một chế độ được bật mà không làm gì |

Chiều thứ hai là chiều **hiện đang hỏng**, và nó hỏng im lặng.

Nút không tồn tại thì nút không nói dối — và **hồ sơ vẫn đúng**, chỉ là đúng nhờ chính lượt ③ thay vì nhờ một
cửa duyệt. Đây chính là *"chạy chế độ auto fix spec cũ"* — nó không phải một chế độ mới phải xây, nó
là hành vi mặc định khi bỏ làn 提案 ra.

### 4.3.1 Nhưng `自動` phải dừng khi ĐO ĐƯỢC có gì sai

`auto` không dừng để **hỏi** — nó vẫn luôn dừng khi **đo được** một vấn đề. Đó là triết lý đã có:
`[ĐO code]` `maybeAutoAdvance` hard-stop bằng **ba loại guard khác nhau** — đếm cho đúng, vì người
implement sẽ đi tìm nhầm chỗ:

| Loại | Gồm |
|---|---|
| **5 gate-flag** | `spec_proposal` · `still_failing` · `awaiting_import` · `test_result` · `infra_degraded` |
| **1 guard STATUS** | `if (task.status !== 'awaiting_confirm') return;` — chặn luôn `error`/`done`/`cancelled`. **KHÔNG có `flag === 'error'`** |
| **1 guard fast+auto** | `featuresSubsetOfLlm` (spec 028 §5) |

Tất cả đều là *sự thật đo được*, không phải *câu hỏi ý kiến*.

`[ĐO code]` Có **hai** tín hiệu cùng loại đang bị bỏ ngoài danh sách, và cả hai đều nguy hiểm gấp bội
trong auto vì auto là chế độ **không ai nhìn màn hình**:

| Tín hiệu | Trạng thái | Vì sao auto phải dừng |
|---|---|---|
| `artifactUnchanged` | ✅ **ĐÃ SHIP** (S2b) | ③ chạy xong mà **file không đổi một byte** — trong auto sẽ đi thẳng tới ④ và báo 完了 cho một việc chưa làm |
| ~~`specStale`~~ | ❌ **KHÔNG làm — xem §8.0.** Lập luận ở ô bên phải nghe hợp lý và **đã sai**: phép đo hai bit không phân biệt được "quên hoà giải" với "hoà giải rồi thấy không cần sửa", mà chỉ thị cho ③ **cho phép** vế thứ hai | ③ được **dặn** hoà giải `SPEC.md` nhưng **không làm**. Trong auto, việc ③ tự viết lại là cơ chế **duy nhất** giữ hồ sơ đúng (không có làn 提案) ⇒ tripwire của nó không được phép vô hình |

#### 4.3.1a ~~Vì sao `specStale` phải đi cùng S2c~~ — LỖI THỜI, đọc §8.0 trước

> ⚠️ **Mục này đúng về CHỖ ĐẶT và sai về VIỆC CÓ NÊN ĐẶT KHÔNG.** Nó chứng minh hard-stop `specStale`
> bất khả đạt ở S2b (đúng), rồi kết luận là phải chuyển sang S2c (sai). Chuyển sang S2c rồi thì nó
> **đạt được — và chặn nhầm việc đúng**. §8.0 giải thích. Giữ lại nguyên văn vì phần chứng minh
> bất-khả-đạt vẫn dùng được cho bất kỳ ai định đặt lại guard đó.

`[ĐO code]` Ship S2b xong mới phát hiện: hard-stop `specStale` **không bao giờ chạy được** ở bản hiện tại.

```
specStale chỉ được tính khi orchestrator đưa cho post-turn một before-hash của SPEC.md
   └─ và nó chỉ làm thế trên lượt ③ MANG THEO change request (replyText)

maybeAutoAdvance có ĐÚNG HAI call-site:
   ├─ startTask          → phase luôn là ① hoặc ②
   └─ đuôi confirmAdvance → hop ②→③ gọi runPhaseAndGate KHÔNG kèm replyText
   (replyWithin thì KHÔNG BAO GIỜ gọi maybeAutoAdvance — đó chính là §4.3.2)

⇒ tại đúng khoảnh khắc guard được đánh giá, specStale luôn là `undefined`.
```

Nó trở nên **đạt được** chính xác khi vòng fix bắt đầu auto-advance — tức khi S2c landing. Nên nó
thuộc S2c, cạnh một test có thể đỏ. **Không ship code không kiểm được.**

> **Bài học đắt hơn cả cái bug** — và là bài học về TEST, không phải về code: guard chết vẫn có một
> test **xanh**, vì harness cho phép test **KHAI** `artifactChanged`/`specChanged` thay vì **ĐO** chúng.
> Một stub được phép khẳng định một phép đo mà caller chưa từng yêu cầu sẽ pin được một trạng thái
> production không thể tạo ra. Đã sửa: fake giờ **hash chính những file bản thật hash** rồi so với
> chính before-hash nó nhận — phép đo chỉ có thể **tái hiện**, không thể **khai báo**. Đúng thay đổi
> đó làm nhánh chết đỏ lên.
>
> `[ĐO code]` Kèm một đính chính: `artifactHash` trả **`null`** khi file thiếu, **không phải
> `undefined`**, và ③ **luôn** nhận before-hash. Nên một build từ đầu đi tiếp vì **phép đo LÀNH**
> (`null` ≠ hash mới ⇒ có đổi), **không phải** vì "không đo". Bản trước của spec này và của commit
> đều nói sai chỗ đó.

⇒ hai dòng **cạnh nhóm `if (task.gate?.flag === … ) return;` bên trong hàm `maybeAutoAdvance`**
(neo theo ký hiệu, không theo số dòng — xem cảnh báo §0.4):

```ts
if (task.phase === 'implement' && task.artifactUnchanged === true) return;
if (task.phase === 'implement' && task.specStale === true) return;
```

**Đây là điều kiện để §4.3 đứng vững**: bỏ cửa duyệt trong auto chỉ chấp nhận được **nếu**
tripwire của làn tự-ghi thật sự dừng được build. Không có hai dòng này thì `自動` = "sửa mà không ai kiểm".

### 4.4 Ba lỗi im lặng phải vá KÈM (nếu không, LOẠI 1 đi lùi)

Cả ba cùng một gốc: **ba đảm bảo của 103 đang khoá vào `opts?.replyText`**, tức chỉ sống trên một
lượt ③ **resume**. Nhưng LOẠI 1 ca "0 build" và cả LOẠI 2 đều tạo ra lượt ③ **tươi**.

| # | Lỗi | Ở đâu | Sửa tối thiểu |
|---|---|---|---|
| **a** | ③ tươi **không đo** `specStale` và **không arm** Undo. (Lời **dặn** hoà giải thì CÓ — xem ô dưới bảng.) | `specHashBefore` (`orchestrator.ts:672-673`) và `snapshotSpecBase`+`fixUndoable` (`:654-660`) cùng khoá `phaseId==='implement' && opts?.replyText` | tính **một** biến `workflowExistedBefore` cho cả hai — xem §4.4.1 cho tiêu chí ĐÚNG (không phải cái tôi viết ở bản trước) |
| **b** | **Undo KHÔNG BAO GIỜ khả dụng trên workflow edit-existing** — đúng ca LOẠI 1 nhắm tới | `snapshotDiffBase` early-return khi `task.seedPath`, mà `localEditSeed` set `seedPath` cho **mọi** build edit-existing local | đổi guard thành `task.seedAppId`. Tab 差分 **không** đổi — `resolveBase` vẫn ưu tiên `seedPath` |

> **`[ĐO code]` Sắc thái quan trọng cho (b)** — early-return đó là một quyết định **cố ý có ghi chép**:
> JSDoc của `snapshotDiffBase` gọi nó là *"KNOWN GAP (deliberate, not an oversight)"* và giải thích
> phạm vi là *"a **Dify-seed** build still diffs against its original seed"*.
>
> **Nhưng phạm vi thật rộng hơn ghi chép**: `seedPath` không chỉ do build Dify-seed đặt — `localEditSeed`
> đặt nó cho **mọi** build sửa-workflow-local. Nên cái gap "cố ý" đang nuốt luôn đường chính của LOẠI 1,
> một hệ quả tác giả của nó không nhắm tới.
>
> Và lý do được viện dẫn để **không** đóng gap — *"closing that means changing `resolveBase`'s precedence,
> which would also destroy the 'compare with the Dify app I started from' view"* — **không áp dụng** cho
> đề xuất này: ta **không** đụng `resolveBase` (tab 差分 giữ nguyên, vẫn ưu tiên `seedPath`), chỉ **thêm**
> một snapshot để nút Undo có cái mà lùi về. Trade-off mà comment lo ngại không phát sinh.

> **`[ĐO code]` Một lỗ thứ ba tôi tưởng có — nhưng nó ĐÃ ĐƯỢC VÁ.** Bản trước của mục này viết rằng
> panel 仕様 vẫn Save đè được `SPEC.md` trong lúc 提案 treo. **Sai**: `PUT /api/tasks/:id/spec`
> (`routes/ui.ts`) đã có đúng guard đó — `if (task.specRevise) return 409` kèm thông điệp *"a plan is
> waiting for your decision — settle it before editing the spec"*, và một comment mô tả chính xác kiểu
> hỏng ấy: *"Silent data loss wearing the costume of a successful save"*. **Không có việc gì phải làm.**

> **`[ĐO code]` Chỗ thứ TƯ khoá vào `replyText` — và nó phải GIỮ NGUYÊN.** `snapshotDiffBase` được
> gọi với `{ restart: !!opts?.replyText && !retryFromError }`. **Đừng đổi theo predicate mới**: trên ③
> tươi `snapAbs` chưa tồn tại nên lần chụp đầu vẫn chạy, và các vòng sau có `replyText` nên `restart`
> vẫn đúng. Ghi ra để người implement không đổi nhầm khi "quét sạch `replyText`".
>
> **`[ĐO code]` Đính chính một claim của chính spec này (bản 2026-08-21 v1 nói sai).** Lời **dặn** ③
> hoà giải `SPEC.md` **CÓ MẶT trên cả hai đường**: đường tươi nhận nó qua thân `implement.md` §6 được
> inline vào prompt; đường resume nhận qua `reconcileTail` (vì prompt resume không mang thân skill).
> Comment tại `orchestrator.ts:617` nói thẳng: *"Duplicated in `implement.md` step 6 for the fresh path"*.
> Cái thiếu trên đường tươi là **phép ĐO** (`specStale`) và **Undo** — tức: ③ được bảo phải làm, nhưng
> không ai kiểm nó có làm không, và làm sai thì không lùi được. Đó mới là lỗ, và nó hẹp hơn — nhưng
> nguy hiểm hơn: một chỉ thị không được đo là một chỉ thị **giả định** là đã tuân thủ.

#### 4.4.1 ~~Tiêu chí đúng là `main.yml` đã tồn tại~~ — **SAI, ĐÃ BỎ**

> **`[ĐO code]` Toàn bộ mục này (bản 2026-08-21) là một chẩn đoán SAI.** Một vòng kiểm chứng đã
> **implement thử** predicate `workflowExistedBefore` rồi chạy suite: **2 test đỏ**, và lý do quan
> trọng hơn con số.
>
> Comment của `specHashBefore` nói: *"On a **first** Implement ② has just written SPEC.md from the
> requirement, so the document already describes the workflow about to be built"*. Tôi đọc câu đó
> như thể nó nói về build **từ đầu**. Nó nói về **mọi ③ đầu tiên** — kể cả edit-existing.
>
> ```
> build edit-existing hôm nay:
>   ① đọc seed → ② VIẾT SPEC.md mô tả thay đổi sắp làm → ③ sửa main.yml cho khớp
>                                                          │
>   main.yml đã tồn tại → predicate của tôi BẬT phép đo ───┘
>   nhưng SPEC.md ĐÚNG rồi nên ③ không cần sửa nó → specChanged = false
>   ⇒ isSpecStale(true, false) = TRUE ⇒ BÁO ĐỘNG GIẢ trên MỌI build edit-existing
> ```
>
> **Tiêu chí đúng không phải "file đã tồn tại", mà là "② có vừa viết `SPEC.md` cho CHÍNH vòng này
> không".** Hôm nay hai thứ đó trùng nhau ở đúng một biểu thức: `opts?.replyText`. Tức **cổng hiện
> tại ĐANG ĐÚNG**, và khoảng trống chỉ mở ra khi ② bị **bỏ qua** — tức `startPhase='implement'`,
> tức **LOẠI 2**.
>
> ⇒ Phần (a) của S3 **chuyển sang LOẠI 2** (S4/S5), với predicate đúng:
> `opts?.replyText || task.startPhase === 'implement'`.
>
> Và một bất biến phải giữ khi làm: `reconcileTail` (chỉ thị), `specHashBefore` (phép đo) và
> `snapshotSpecBase` (undo) **phải dùng CHUNG một biểu thức cổng** — comment tại chỗ nói thẳng
> *"the instruction is delivered on exactly the turns the measurement judges"*. Đổi lệch nhau là
> tự sinh ra báo động giả.

<details><summary>Bản gốc của §4.4.1 (giữ để thấy lập luận sai ở đâu)</summary>

##### Tiêu chí ~~đúng~~ đã đề xuất: `main.yml` đã tồn tại

Bản trước của §4.4(a) đề xuất `editsExistingSpec = existsSync(SPEC.md)`. **Sai, và sai theo hướng
nguy hiểm** — nó sẽ bật phép đo trên **mọi build mới**:

| Ca | `SPEC.md` có? | `main.yml` có? | Có cần hoà giải? |
|---|---|---|---|
| Build mới, lượt ③ đầu | **CÓ** (② vừa ghi) | KHÔNG | **KHÔNG** — spec là **nguồn**, workflow đang được sinh ra **từ** nó. Không có gì để hoà giải |
| Vòng fix (resume) | CÓ | CÓ | **CÓ** |
| LOẠI 2 khởi từ ③ trên yml đã import | CÓ (bản tối thiểu) | **CÓ** | **CÓ** — bản tối thiểu phải được làm cho đúng |
| LOẠI 1 ca "0 build", lượt ③ tươi | CÓ | **CÓ** | **CÓ** |

`[ĐO code]` Chính code đã cảnh báo đúng điều này: *"On a first Implement ② has just written SPEC.md
from the requirement, so the document already describes the workflow about to be built; **measuring
there would mark every new build stale on its first turn**"* (`orchestrator.ts:674-677`).

⇒ Tiêu chú đúng: **workflow đã tồn tại TRƯỚC lượt này** — và đại lượng đó **đã được tính sẵn**:
`artifactHashBefore` (`orchestrator.ts:670-671`), với comment nói rõ *"`null` here means the file does
not exist yet (a first Implement)"*.

```ts
// nâng artifactHashBefore lên TRƯỚC hai chỗ dưới, rồi:
const workflowExistedBefore =
  phaseId === 'implement' && artifactHashBefore !== null && !task.specApplied;
//  → dùng cho HAI chỗ: snapshotSpecBase+fixUndoable · specHashBefore
```

**Ba đính chính so với bản trước của chính mục này** — cả ba do vòng kiểm chứng 2026-08-21 tìm ra:

| # | Bản trước viết | Thật |
|---|---|---|
| a | "ba chỗ dùng", gồm `reconcileTail` | **HAI.** `reconcileTail` chỉ xuất hiện trong nhánh `replyText` của `resumePrompt`; đổi predicate **không có tác dụng** ở đó. Và nó vốn **thừa** trên đường tươi — `implement.md` §6 đã phủ (đúng như ô đính chính §4.4) |
| b | không có vế `!task.specApplied` | **Bắt buộc.** Nhánh `apply_spec` trong `confirmAdvance` **đã** gọi `snapshotSpecBase` + `fixUndoable` **trước** khi chạy ③. Thiếu vế loại trừ ⇒ S3 **làm hỏng Undo của làn 提案** — một hồi quy do chính spec gây ra |
| c | "workflow đã tồn tại" | Chính xác hơn: **`{{WORKFLOW_FILE}}` đã tồn tại**. Hai thứ lệch nhau ở đường **Dify-seed**: `difySeedScaffoldAndPull` pull app về một file **KHÁC** `main.yml` (comment: *"Record the pulled seed file (NOT main.yml)"*), nên `main.yml` vẫn chưa có ⇒ predicate trả `false`, đúng ý |

**Một thay đổi hành vi CÓ CHỦ Ý** (ghi ra để test S3a không bị đọc nhầm là hồi quy): một `/reply` sau
khi ③ đầu **chết trước khi ghi được `main.yml`** — hôm nay có `replyText` nên tripwire bật; với
predicate mới thì tắt. Đúng: lúc đó chưa có gì để hoà giải, và `fixUndoable` vốn đã `false`.

**Hệ quả cho QA**: build mới **không cần** đọc `SPEC.md` (② vừa viết nó, ③ không được phép sửa nó).
Chỉ **vòng fix trên một build đã có** mới cần — QA-1 §6.9.

</details>

`[ĐO code]` **Một lỗ cùng họ đã được VÁ** — bản trước của spec này ghi nhầm: `SPEC.next.md` **là
per-TASK** (`apps/builder/.runs/<taskId>/SPEC.next.md`), và JSDoc của `specNextRel` nói thẳng nó từng
nằm ở `projects/<p>/<w>/` "for exactly one revision" rồi được chuyển, kèm test. Không có việc phải làm.

`[GIẢ THUYẾT]` Lỗ còn lại, chưa đo tần suất, **không slice nào dựa vào**: `undoFixRound` copy snapshot
**per-task** đè lên file **dùng chung** của workflow ⇒ Undo của build A có thể đè fix của build B.

### 4.3.2 `自動` phải chạy hết cả VÒNG FIX, không chỉ build đầu

`[ĐO code]` Hôm nay `自動` chạy end-to-end **chỉ trên build mới**, và dừng cứng ở gate ③ trên **mọi
lần sửa** — một bất đối xứng chưa ai chủ ý chọn cho vòng fix:

| Đường | `maybeAutoAdvance` được gọi? | Kết quả ở `自動` |
|---|---|---|
| `startTask` (build mới) | **CÓ** — `orchestrator.ts:116` | ①→②→③→④ liền mạch → `完了` ✅ |
| `confirmAdvance` (qua mỗi gate) | **CÓ** — `orchestrator.ts:279` | tiếp tục chuỗi ✅ |
| **`replyWithin` (mọi lần sửa)** | **KHÔNG** — *mọi* nhánh đều `return` trần | dừng ở gate ③, chờ người bấm 「テストへ進む」 ❌ |

Docstring nói thẳng ý định: *"A /reply never auto-advances — it is a human revise, so it always pauses
for the next decision (**even in `auto`**)"* (`orchestrator.ts:285-286`).

**Lý lẽ đó đúng cho `各ステップ`, và sai cho `自動`.** "Người vừa gõ nên được nhìn kết quả" là một giả
định về sự có mặt — mà `自動` chính là lời khai rằng **người dùng không ngồi đó**. Hệ quả thực tế: bật
`自動` rồi gửi một fix thì được đúng một nửa lời hứa — máy sửa xong, rồi đứng im chờ một cú click mà
người dùng đã nói trước là họ không muốn phải bấm.

⇒ **Sửa — và đơn thuốc "một dòng ở đuôi" là SAI.** `[ĐO code]` `replyWithin` có **năm** nhánh, bốn
nhánh `return` **sớm**; chỉ nhánh cuối là fall-through. Một dòng ở đuôi chỉ phủ được nhánh cuối:

| Nhánh | Khi nào | `return` sớm? | Cần `maybeAutoAdvance`? |
|---|---|---|---|
| propose | `mode==='propose'` hợp lệ | ✔ | **KHÔNG** — 提案 phải park cho người |
| spec no-op | ② revise không đổi gì | ✔ | **KHÔNG** — repark, không có gì để tiến |
| **`phase==='test'` → ③** | fix gửi từ gate ④ **hoặc build `done`** | ✔ | ✅ **CÓ** — *đây chính là đường LOẠI 1* |
| `phase==='test'` → live/④ | retry lỗi | ✔ | ✅ CÓ |
| **fall-through cuối** | fix ở phase `implement` (vòng 2 trở đi) | ✖ | ✅ CÓ |

**Nếu chỉ đặt ở đuôi**, `自動` sẽ chạy vòng fix **so le**: vòng #1 (gửi từ gate ④/`done`) dừng ở gate ③;
vòng #2 (phase đã là `implement`, đi fall-through) tự chạy tới `完了`; vòng #3 lại dừng. Một hành vi
không ai giải thích được.

⇒ Đặt ở **HAI** chỗ — nhánh `phase==='test'` và đuôi hàm — và **kẹp điều kiện phase**:

```ts
if (task.phase === 'implement') await maybeAutoAdvance(task, ctx);
```

**Vế `task.phase === 'implement'` là bắt buộc**, không phải cho gọn. `[ĐO code]` Nhánh fall-through
chạy với **bất kỳ** phase nào trong {analyze, spec, implement}, và `boundaryAutoAdvances('spec_only',
'analyze')` = **`true`** — nên nếu không kẹp, một Retry-lỗi ở gate ① dưới `仕様のみ` sẽ **tự tiến**,
một thay đổi hành vi ngoài phạm vi spec này. (`各ステップ` thì đúng là không đổi gì — nó trả `false`
ở mọi phase.)

**Ba hệ quả kèm theo, phải chốt cùng lúc:**

| | Hệ quả | Phán quyết |
|---|---|---|
| a | `仕様のみ` cũng sẽ auto-advance ③→④ trên vòng fix (`boundaryAutoAdvances('spec_only','implement')` = `true`) | **ĐÚNG ý nghĩa của nó** — "chỉ dừng ở cửa 仕様". Build mới ở `仕様のみ` vốn đã tự đi ③→④; vòng fix đứng im là bất nhất |
| b | Nhánh `apply_spec` `return` ngay sau ③ (`orchestrator.ts:199-200`), bỏ qua `maybeAutoAdvance` ở đuôi `confirmAdvance` | thêm `await maybeAutoAdvance(task, ctx)` trước `return` đó — nếu không, `仕様のみ` duyệt 提案 xong vẫn kẹt ở gate ③ |
| c | Một build đang ở `testMode='live'` mà bật `自動` rồi sửa: auto sẽ lấy `continue` (test tĩnh), **không** lấy `test_live` | Đúng chính sách đã có (036 D5: *"an autonomous build is ALWAYS static at the implement gate"*). Nhưng nó **im lặng** — người dùng vừa live-test xong sẽ tưởng lần sau cũng live. ⇒ ghi một dòng vào thẻ gate. Xem §8 câu 6 |

> ### ⛔ RÀNG BUỘC THỨ TỰ — bắt buộc
>
> **Dòng này CHỈ được ship SAU §4.3.1 VÀ SAU §4.4.1.** Hai điều kiện, không phải một.
>
> `[ĐO code]` Lý do thêm §4.4.1: `specHashBefore` hôm nay **chỉ được chụp trên vòng có `replyText`**,
> và `post-turn` chỉ tính `specChanged` khi `specHashBefore !== undefined`. Nghĩa là trên một lượt ③
> **tươi**, tripwire `specStale` **câm hoàn toàn**. Mà lượt ③ tươi đúng là thứ hai đường mới của spec
> này sinh ra (LOẠI 1 ca "0 build" · LOẠI 2 khởi từ ③). Ship S2c mà thiếu S3 ⇒ `自動` chạy thẳng tới
> `完了` với một trong hai cái phanh **không có dây**.
>
> Hôm nay gate ③ là **cái phanh duy nhất** của vòng fix ở `自動`: mọi fix đều dừng ở đó, nên hai
> tripwire kia không hiện cũng không ai chết. Gỡ phanh trước khi lắp phanh mới = mỗi lần sửa ở `自動`
> đi thẳng tới `完了` **mà không ai kiểm** file có đổi không và `SPEC.md` có được hoà giải không.
> Đó là cách biến một tiện ích thành một máy sinh lỗi im lặng.

**Sau khi cả hai landing, `自動` mới đúng nghĩa của tên nó:**

```
自動 + gửi một fix
   ▼
③ sửa file · lint cap-5 · TỰ viết lại SPEC.md cho khớp
   ▼
   ├── file KHÔNG đổi?        ──► DỪNG ở gate ③   (§4.3.1)
   ├── SPEC.md KHÔNG hoà giải? ──► DỪNG ở gate ③   (§4.3.1)
   ├── lint đỏ sau cap-5?     ──► DỪNG (still_failing — đã có)
   ▼  đều sạch
④ tự chạy → 完了                                    (§4.3.2)
```

Dừng khi **đo được** có vấn đề; không dừng để **hỏi**. Đó là cùng một nguyên tắc, áp cho cả hai đầu.

---

---

## 5. LOẠI 2 — mang một thứ vào

### 5.1 `startPhase` — mở rộng một dòng đã tồn tại

`[ĐO code]` Điểm xuất phát hôm nay là **đúng một biến** (`orchestrator.ts:113`):

```ts
const startPhase: 'analyze' | 'spec' = task.fastMode ? 'spec' : 'analyze';
```

⇒ mở rộng union thành `'analyze' | 'spec' | 'implement'`, đọc từ một field start-bound
`task.startPhase`. Chuỗi tiến ③→④ **đã sẵn sàng** — `confirmAdvance` là if/else theo `cur`, không cần bảng thứ tự.
⚠️ **Nhưng backend CÓ một `PHASE_ORDER`** (`state/task.ts`) drive `/restore` (điểm vỡ #5), và web có
một **bản sao** drive thanh phase (S7). **Cả hai đều phải biết `startPhase`** — S4 không phải chỉ là
mở rộng một union.

> **`fastMode` KHÔNG phải "bỏ ①".** Nó **gộp** ①② vào `draft.md`, và `draft.md` **tự viết**
> `analyze.json` — verify của ② trên đường fast còn **bắt buộc** đọc lại file đó
> (`orchestrator.ts:1088-1096`). Nên fast **không** giải bài toán "artifact của phase bị bỏ không tồn tại".
> Đó là toàn bộ độ khó của LOẠI 2.

### 5.2 **Năm** điểm vỡ CỨNG khi bắt đầu từ ③

| # | Vỡ gì | Vì sao | Sửa |
|---|---|---|---|
| 1 | Đường dẫn của ③ thành chuỗi **`null/…`** → phase chết `artifact missing`, **VÀ** `confinementCheck` đọc cùng cặp null ⇒ **mọi file ③ vừa ghi bị coi là breach và REVERT** — build không chỉ chết mà **mất sạch output** | ⚠️ **Nguyên nhân KHÔNG phải thiếu scaffold** (bản trước ghi sai). `[ĐO code]` Trên đúng luồng mà điểm #4 **bắt buộc** (mint bằng `workflow`+`project`), `startTask` chạy `localEditSeed` **TRƯỚC** `runPhaseAndGate`, và `localEditSeed` mở đầu bằng `task.workflowSlug = …` + `task.project ??= _drafts`. ⇒ null-path chỉ xảy ra khi **THIẾU CLAMP** (mint `startPhase='implement'` mà không có `workflow`) | **Hai việc, đừng lẫn**: (a) **gác ở `createTask`** — `startPhase='implement'` không kèm `workflow` ⇒ **400** (§6 S4); (b) gọi `scaffoldAtSpecGate` trước ③ để **thư mục con** (`prompts/ inputs/ tests/`) tồn tại như task thường. ⚠️ **Test S5a phải assert (a), không assert (b)** — assert "đường dẫn không chứa `null`" sẽ **XANH kể cả khi bỏ (b)**, tức test trang trí |
| 2 | ③ được trỏ tới một `SPEC.md` **không tồn tại** và **không ai báo lỗi** — agent lặng lẽ build từ `{{REQUIREMENT}}` | `scaffold.ts:250` gán `artifacts.spec` **vô điều kiện**; backend **không** kiểm `SPEC.md` trước ③ (verify của ③ chỉ chạy `postTurnCheck` trên `main.yml`) (a) `scaffoldAtSpecGate` có **HAI** chỗ gán `artifacts.spec`; chỉ chỗ **sau `rename`** là lỗ (nhánh short-circuit đã `existsSync` — đừng đụng). (b) ghi **`SPEC.md` tối thiểu** trước khi spawn ③ — ⚠️ **THỨ TỰ BẮT BUỘC: `scaffoldAtSpecGate` TRƯỚC, ghi `SPEC.md` SAU.** Hàm này short-circuit `if (existsSync(projectSpecAbs)) return;` **trước** `ensureScaffold` ⇒ ghi `SPEC.md` trước sẽ khiến `init_project.py` **không bao giờ chạy** |
| 3 | `criteria.json` không bao giờ được sinh ⇒ ④ live-test tụt xuống smoke-test **im lặng** | `criteria.json` do ② ghi; `runJudge` trả `null` khi không có criteria (`live-test.ts:87`) và FE chỉ render judge khi có ⇒ **sự vắng mặt là vô hình** | gọi `persistCriteria(...)` một lần sau bước ghi `SPEC.md` tối thiểu (hàm đã non-fatal). **Và** khi `criteria.length===0`, đổi label live-test khỏi `live-verified` thành một giá trị **nói thật** (`live-test.ts:398-399`) |
| 4 | Nếu mint task bằng `slug` thay vì `workflow`, ③ sẽ **dựng lại từ pattern và đè chết file yml vừa import** | nhánh "sửa tại chỗ" của ③ được chọn bằng `{{SEED_PATH}}` (`implement.md:32,172`), mà `SEED_PATH` chỉ có giá trị khi `localEditSeed` chạy — và nó **chỉ chạy khi `task.workflow` được set** **Luồng này ĐÃ TỒN TẠI**: `onImported` trong `App.tsx` sau khi import base đã mint task với `baseWorkflow`. S5 chỉ còn (i) đính `start_phase='implement'` vào lời mint đó, (ii) thêm guard server-side. Đây cũng là điều kiện để nút nhắc Promote **không** bật trên yml của người khác |

| **5** | **Huỷ một build khởi-từ-③ rồi Khôi phục ⇒ rơi vào GATE ② MA** | `restoreTargetPhaseFor` lùi **một mốc** theo `PHASE_ORDER`; `restoreTargetPhase('implement')` = `'spec'` — một phase **chưa từng chạy**. Hàm này đã có **đúng một** tiền lệ đặc cách (fast build), nên khuôn đã sẵn | `if (task.startPhase === 'implement' && task.phase === 'implement') return null;` → rơi vào nhánh else = reopen dạng error retryable, y như `fastMode`. Test cạnh `test/fast-mode.test.ts` |

Ngoài năm cái trên: `analysisPattern`/`KNOWLEDGE`/`REFERENCES` chỉ **rỗng**, không gây lỗi — hậu quả
là ③ mất pattern-pick và tự chạy `find.py`. Chấp nhận, nhưng **phải nói ra** (§5.5).

### 5.3 Chip: KHÔNG thêm chip thứ 6

`[ĐO code]` Hàng chip màn hình mới có **4** chip thật (model · workflow · confirm · fast) — **không
phải 5**. Chip `mode` là **code chết, chưa từng render**: nó nằm sau guard `{mode && onMode && …}`,
mà `onMode` không được truyền ở bất kỳ đâu (`grep -rn "onMode=" web/src` → rỗng). Nên chip 作り方 sẽ
là chip thứ **5**, không phải thứ 6 — hàng chip còn nhiều slack hơn bản trước của spec tưởng. Và
`.composer-row` là `flex-wrap: nowrap` **cố ý** (`surface-blocks.css:619-628`). Comment tại
`Chat.tsx:1063-1066` ghi: ở viewport 820px chip model thêm 93px vào một hàng *"fit exactly without
it"*. Repo đã có tiền lệ **từ chối** thêm chip vì đúng lý do này (`docs/state/ui-surface.md:251-252`).

⇒ **Vẫn nên thay** chip 高速ビルド bằng **một chip thang bậc** — nhưng lý do bây giờ là **ngữ nghĩa**,
không phải layout: 高速ビルド và "điểm bắt đầu" nói **cùng một câu**, để cạnh nhau là hai điều khiển
có thể bật mâu thuẫn. Gộp thành một trục ⇒ loại trừ nhau **về mặt cấu trúc**, không cần guard runtime.
(Số chip giữ nguyên 4 — thêm slack, không mất.)

### 5.4 Chỉ HAI lựa chọn, không phải ba

Ba lựa chọn của anh (full / từ ② / chỉ ③) có **hai** câu người dùng trả lời được và **một** câu chỉ
kỹ sư trả lời được:

```
✅ 「ぜんぶ作る」      — "tôi chưa có gì"          → ①②③④
❌ 「仕様から」        — cần biết ① làm gì mới chọn được. Và nó nói CÙNG một câu với 高速ビルド
✅ 「あるものを直す」  — "tôi đã có file rồi"      → ③④
```

**Bỏ lựa chọn giữa khỏi UI**; backend vẫn hỗ trợ `start_phase='spec'` cho API/test nếu muốn.

**Nhãn theo THỨ NGƯỜI DÙNG MANG TỚI, không theo phase** (nguyên tắc 6). Đề xuất chip 「作り方」:

```
作り方:  ぜんぶ作る（要件から）      ← mặc định
         高速（①②統合）            ← chính là 高速ビルド hôm nay
         あるものを直す（③④のみ）
```

Kèm hai sửa nhỏ làm chip **tự giải thích được** — nếu không, cả ba dòng đều là chữ trần:

- `[ĐO code]` `SettingSelect`: `title={disabled ? (title ?? tr('setAtStart')) : undefined}` — tooltip
  **chỉ** render khi chip bị **disable**.
  ⚠️ **Đính chính bản trước** (vòng kiểm chứng 2026-08-21): (1) khoá `workflowHint` **không tồn tại**
  — chip workflow dùng `workflowFixed`; (2) `fastHint` **không** chết trên màn hình trống — chip fast
  `disabled` ngay khi chọn một workflow, nên tooltip **có** hiện. Cái chết là tooltip ở trạng thái
  **enabled**, tức đúng lúc người ta đang cân nhắc chọn gì.
  ⇒ hai việc, đừng lẫn: (a) đổi thành `… : title` để tooltip sống khi enabled; (b) **viết khoá hint
  MỚI** theo giọng mô tả-chức-năng — **không** tái dùng `workflowFixed`/`setAtStart` (chúng là câu
  giải thích *vì sao bị khoá*, đọc ở trạng thái enabled sẽ vô nghĩa).
- Thêm trường phụ đề cho từng dòng menu (menu chip hiện là một dòng, không có chỗ cho mô tả).

**Đừng đặt tên chip theo tiền.** `[ĐO]` Bỏ ①② cắt đúng **5%** rẻ nhất của hoá đơn và làm phình phần
**95%** đắt nhất (vòng fix ③), vì bỏ ② là bỏ `SPEC.md` + `criteria.json` — hai thứ khiến vòng fix
hội tụ và khiến ④ chấm được.

### 5.5 Bỏ bước thì phải nói đã bỏ gì (nguyên tắc 4)

| Nơi | Phải nói |
|---|---|
| Lúc chọn | phụ đề dòng menu: 「あるものを直す」 = *"không viết 仕様書; kiểm nghiệm thu sẽ chỉ là kiểm chạy được"* |
| Lúc bắt đầu | banner một dòng — dùng lại slot `maybeNudgeAuto()` đã gọi sẵn trong `start()` (`store.ts:1267`) |
| Tab 仕様 | hôm nay hiện 「SPEC.md はまだありません — 仕様フェーズの後に表示されます」 (`i18n.ts:525`) = một **lời hứa có mốc thời gian** cho một phase **sẽ không bao giờ chạy** ⇒ cần key mới `noSpecByDesign` |
| Report ④ | `criteriaSummaryNote` trả `null` khi rỗng và `patternAdvisoryLine` trả `null` khi gap rỗng ⇒ **biến mất** thay vì đổi câu. Khi `startPhase !== 'analyze'`, push một `noteParts` nói thẳng **phép kiểm nào đã không chạy** |
| Thanh phase | ①② hiện ✓ cho phase chưa từng chạy ⇒ thêm **giá trị thứ SÁU** vào `UiPhaseState` (nó đã có 5), lớp CSS thứ 5 ở `PhaseTrack`. ⚠️ Cần **field mới trên wire** (`task.startPhase`) — `phaseStates` không có nguồn nào khác ⇒ **S7 không phải slice thuần FE** |

### 5.6 Lỗi im lặng nặng nhất của cả spec

**`確認=自動` + bắt đầu từ ③ trên một yml đã có → build báo 完了 cho một lượt ③ KHÔNG SỬA GÌ.**

`main.yml` đã tồn tại trước lượt ③ nên `artifactHashBefore` là hash thật; nếu ③ no-op (yêu cầu đã
được đáp ứng sẵn, hoặc turn chỉ trả lời chứ không sửa), `artifactUnchanged` **được đo** — nhưng nó
**không vào `outcome`** và chỉ hiện ở gate ③, mà `auto` **không dừng ở gate ③**.

⇒ thêm một hard-stop cạnh nhóm ở `orchestrator.ts:422-426`:

```ts
if (task.phase === 'implement' && task.artifactUnchanged === true) return;
```

Dùng đúng phép đo đã có, **không** đụng `computeGate` (giữ tính thuần).

Kèm hai clamp nữa, cùng khuôn force-off `fastMode` đã có (`task.ts:707`):

- `fastMode = false` khi `startPhase !== 'analyze'` — **đai an toàn thứ hai, gần như miễn phí**:
  `createTask` đã force-off `fastMode` khi có `workflow`, mà đường mint bắt buộc của LOẠI 2 luôn có
  `workflow` ⇒ mệnh đề mới chỉ phủ đường API mint bằng `slug`. Một `&&`, không phải một việc;
- `confirmMode='spec_only'` + `startPhase='implement'` → **đồng nhất với `auto`**, và nhãn 「仕様のみ」
  đọc thành **phản nghĩa** ("chỉ làm phần spec") cho một build **không có** bước spec ⇒ **lọc bỏ dòng
  đó khỏi menu** khi điểm bắt đầu bỏ qua ②.

### 5.7 Cái bẫy một-click (không thuộc LOẠI nào, nhưng LOẠI 2 làm nó chết người)

`[ĐO code]` `.empty-suggest` render **vô điều kiện** (`App.tsx:1014`) và mỗi dòng gợi ý **gửi ngay**
khi bấm (`onClick={() => send(s)}`, `App.tsx:1017`), trong khi `store.start` vẫn đọc
`settings.workflow` đang trỏ vào workflow X.

⇒ Với `start='implement'`, **một cú click vào một dòng 「例」 sẽ ghi đè `main.yml` của X bằng một yêu
cầu hoàn toàn không liên quan** — không gate nào chặn.

**Sửa: một điều kiện** — chỉ render `.empty-suggest` khi `settings.workflow === 'none'`. Gợi ý
"thử cái này" vốn chỉ có nghĩa cho một trang trắng.

---

## 6. Slices

### ~~Bắt buộc trước tất cả — S0: commit khối spec 103~~ ✅ **ĐÃ SHIP 2026-08-21**

Nhánh `spec-103-lane-b`. Tách làm **ba việc khác nhau** thay vì một khối 44-file: bài học field ·
làn 提案 · spec đang mở. Route `undo-fix` xuất hiện **giữa lúc commit** (working tree đang được sửa
song song) — typecheck + 13 test undo xanh nên commit riêng, không bỏ rơi.

### LOẠI 1

| | Việc | Cỡ |
|---|---|---|
| ~~**S2**~~ ✅ | **Loại trừ hai chiều** 自動 ↔ 提案 — **ĐÃ SHIP 2026-08-21** (`cdfa96c`). **BỐN** mảnh, không phải hai: `canPropose` (tách ra lib thuần `propose-lane.ts`) · chip 確認 rút `auto` · `PATCH` 409 · **+ khe hở gate lỗi `apply_spec`** (build kẹt với 提案 không xoá được). Mỗi mảnh đỏ-khi-revert riêng. §4.3 | XS |
| ~~**S2b**~~ ✅ | ~~Hai~~ **MỘT** hard-stop — `artifactUnchanged` — trong `maybeAutoAdvance`. **ĐÃ SHIP 2026-08-21** (`bf6e598` + sửa `f554493`). Ba test qua **đường sản phẩm thật** (build edit-existing), đã kiểm đỏ-khi-revert. `specStale` **chuyển sang S2c** vì bất khả đạt — §4.3.1a | XS |
| ~~**S2c**~~ ✅ | **BA** chỗ, không phải hai — và hard-stop `specStale` kèm theo đã bị **GỠ** (§8.0) — `replyWithin` return sớm ở **4/5** nhánh. **ĐÃ SHIP 2026-08-21** (`de448ee`), 5 mảnh đều đỏ-khi-revert riêng lẻ. Chi tiết cũ: | XS |
| ~~(mô tả cũ)~~ | ~~**`maybeAutoAdvance` ở HAI chỗ** (nhánh `phase==='test'` + đuôi `replyWithin`), kẹp `phase==='implement'`; và ở nhánh `apply_spec`. **CỘNG hard-stop `specStale`** (chuyển từ S2b — §4.3.1a: chỉ ở đây nó mới đạt được, vì vòng fix có `replyText`). **KHÔNG còn chờ gì** — S3 đã ship, và phần predicate hoá ra không thuộc LOẠI 1. §4.3.2~~ | — |
| ~~**S3**~~ ✅ | **MỘT** lỗ: `snapshotDiffBase` `seedPath`→`seedAppId` (§4.4b) — **ĐÃ SHIP 2026-08-21** (`6576020`), 4 test đỏ-khi-revert cả hai chiều. *(Phần predicate **chuyển sang LOẠI 2** — §4.4.1 giải thích vì sao nó SAI. Guard `PUT /spec` đã có sẵn.)* | XS |

**AC S3 (đỏ-khi-revert bắt buộc)**: (a) một lượt ③ **tươi** trên workflow **đã có `main.yml`** →
`specStale` được đo + nút Undo **hiện**; (b) lượt ③ **đầu tiên của build mới** → **KHÔNG** đo (§4.4.1);
(c) revert từng sửa một → đúng một test đỏ.

### LOẠI 2

| | Việc | Cỡ |
|---|---|---|
| **S4** | `startPhase` end-to-end: field trên `Task` + `CreateTaskInput` + đọc body + `orchestrator.ts:113`. **Gác server-side**: `start_phase='implement'` mà **không** kèm `workflow` ⇒ **400 fail-loud** (KHÔNG hạ cấp im lặng — nguyên tắc 5). ⚠️ Guard phải bám `start_phase`, **tuyệt đối không** bám `slug` (`POST /api/tasks` cố ý không gác `slug`; bám nhầm ⇒ mọi build mới 400). | M |
| **S5** | **Năm** điểm vỡ cứng §5.2: `restoreTargetPhaseFor` · scaffold-trước-③ · `SPEC.md` tối thiểu · `persistCriteria` + label live-test nói thật · **bắt buộc qua `/api/bases`, mint bằng `workflow`** | M |
| **S6** | Chip 「作り方」 thay chip 高速ビルド (2 lựa chọn hiện, 3 giá trị wire) + khoá i18n của chính nó + **mặc định 「あるものを直す」 khi workflow đã chọn sẵn VÀ file tồn tại** (§4.2.1). §5.3-5.4 | S |
| **S9** | *(tách khỏi S6 — **KHÔNG CHẶN GÌ**)* Tooltip chip nói được chức năng: `SettingSelect` nhận `title` khi enabled + **viết khoá hint MỚI** cho workflow/confirm/fast × EN+JA. §5.4. Gộp vào S6 sẽ bị làm ẩu và phơi ra chữ sai | S |
| **S7** | Nói-ra-đã-bỏ-gì: `noSpecByDesign` · note ở report ④ · state `skipped` trên thanh phase · banner lúc start. §5.5 | S |
| **S8** | `.empty-suggest` chỉ hiện khi `workflow === 'none'`. §5.7 | XS |

> ### Giá trị của LOẠI 2 là THỜI GIAN, không phải TIỀN
>
> `[ĐO]` Bỏ ①② cắt **~319s chờ + 2 gate**, nhưng cắt đúng phần **rẻ nhất** của hoá đơn (§1.2) và làm
> phình phần đắt nhất (§5.4). Đối ứng: **5 điểm vỡ CỨNG** + một field wire + M+S+S+S.
>
> **Khuyến nghị**: ship trọn LOẠI 1, rồi **DỪNG LẠI ĐO** — đếm bao nhiêu build thật sự đặt `workflow`,
> bao nhiêu lần người dùng bấm 「先に計画を見せて」 — **trước khi** bỏ tiếp M+S+S+S vào LOẠI 2. Chính
> §1.2 ghi cửa edit-existing mới được dùng **2/23 lần** và cả hai đều chết; xây to trên một nhu cầu
> chưa đo là cách spec trước của tôi đã sai một lần rồi.

**Ngưỡng dùng được**: S0 → S2+S2b+S2c → S3 **(LOẠI 1 xong — không đụng sidebar; S2 đụng FE 2 chỗ)** →
S4+S5+S8 (LOẠI 2 an toàn) → S6+S7 (đọc được).
**S8 phải đi cùng S4** — nó là cái bẫy do chính S4 mở ra.
**S6 gánh cả cửa vào**: sau §4.2, "sửa workflow đã có mà không chạy ①②" là việc của chip, không phải
của sidebar.

### 6.9 QA — cái gì kiểm bằng máy, cái gì phải mở trình duyệt, cái gì KHÔNG kiểm được

Ba tầng. Luật chung: **test mới phải chứng minh đỏ-khi-revert** (tạm gỡ fix → chạy → khôi phục);
test chỉ assert stub của chính nó là test trang trí.

```bash
cd apps/builder      && npm test        # test server (node --import tsx --test)
cd apps/builder/web  && npm test        # test web (vitest run)
cd apps/builder      && npm run typecheck
```

#### Tầng 1 — unit, BẮT BUỘC xanh trước khi mở trình duyệt

| Slice | Test | Đỏ-khi-revert bằng cách |
|---|---|---|
| S2 | (a) `canPropose` false khi `confirmMode==='auto'`, **true** ở hai mức kia (một dòng, một chỗ); (b) `PATCH confirm_mode='auto'` khi `task.specRevise` ⇒ **409**, và `specRevise` vẫn nguyên | bỏ từng vế ⇒ đúng một test đỏ mỗi vế |
| **S2b** | **`maybeAutoAdvance` hard-stop trên `artifactUnchanged` và trên `specStale`** (§4.3.1) | gỡ từng dòng ⇒ đúng một test đỏ mỗi lần |
| **S2c** | `/reply` ở `auto` **có** advance ③→④; ở `各ステップ` **không**; và một fix `artifactUnchanged` ở `auto` **vẫn dừng** | bỏ lời gọi ⇒ test 1 đỏ · ship S2c mà thiếu S2b ⇒ test 3 đỏ (đây là test giữ ràng buộc thứ tự) |
| S3a | ③ **tươi** trên workflow **đã có `main.yml`** → `specHashBefore` được chụp + `fixUndoable` true. **VÀ**: ③ đầu tiên của một build **mới** (`main.yml` chưa có) → **KHÔNG** chụp, `specStale` **không** được đặt | đổi về `replyText` ⇒ vế 1 đỏ · đổi predicate thành `existsSync(SPEC.md)` ⇒ **vế 2 đỏ** (đây là test giữ §4.4.1) |
| S3b | `snapshotDiffBase` **có** chụp khi `seedPath` set nhưng `seedAppId` null | trả guard cũ ⇒ đỏ |
| S4 | `startPhase` round-trip: body → `createTask` → `task.json` → `orchestrator.ts:113`; **gác**: `'implement'` không kèm `workflow` ⇒ **400**; `fastMode` đã tự false trên đường mint bắt buộc | bỏ guard ⇒ đỏ |
| S5a | `start='implement'` ⇒ `scaffoldAtSpecGate` chạy TRƯỚC ③; `artifactRel` **không bao giờ** chứa chuỗi `null` | bỏ lời gọi scaffold ⇒ đỏ (assert trên đường dẫn, không phải trên turn) |
| S5b | `start='implement'` không có `SPEC.md` ⇒ file tối thiểu được ghi + `criteria.json` tồn tại | bỏ ⇒ đỏ |
| S5c | live-test `criteria.length===0` ⇒ label **không** phải `live-verified` | trả label cũ ⇒ đỏ |
| S5d | mint LOẠI 2 bằng `slug` (không `workflow`) ⇒ **400**, không mint task | bỏ precondition ⇒ đỏ |
| S6 | i18n **parity** EN/JA cho mọi khoá mới; option list **không** chứa `spec_only` khi bỏ ② | xoá một khoá JA ⇒ đỏ |
| S7 | `report.json` có note khi `startPhase !== 'analyze'`; thanh phase trả `skipped` | bỏ ⇒ đỏ |
| S8 | `.empty-suggest` **không** render khi `settings.workflow !== 'none'` | bỏ điều kiện ⇒ đỏ |

> **Cảnh báo hiệu chuẩn** (bài học đã ghi ở `AGENTS.md` §9): phép thử phải đi qua **entry-point thật**
> (`/reply`, `/confirm`, `startTask`), không qua hàm con — và predicate phải đo **artifact**, không đo
> lời tự khai của model.

#### Tầng 2 — QA tay: **suy ra từ slice bạn ship**, không phải một danh sách cố định

Chỉ hai câu hỏi ở đây là thật sự cần mắt người. Mọi thứ khác đã là unit test.

**Nếu chỉ ship LOẠI 1 (S0·S2·S2b·S2c·S3) — đúng 2 mục:**

| # | Làm gì | Câu hỏi nó trả lời | Vì sao máy không trả lời được |
|---|---|---|---|
| **QA-1** | Ở `自動`, trên **một build ĐÃ CÓ** (không phải build mới), gửi một fix → đợi xong → **mở `SPEC.md` đọc** | *Máy có thật sự viết lại tài liệu cho khớp workflow vừa sửa không, và viết có đúng không?* | Máy đo được **file có đổi** (`specStale`), **không** đo được **đổi có đúng**. Hiệu chuẩn niềm tin **một lần**, không phải kiểm mỗi lần. **Build mới KHÔNG cần kiểm** — ② vừa viết `SPEC.md` từ requirement, ③ không có gì để hoà giải (§4.4.1) |
| **QA-2** | Ở `自動`, gửi một yêu cầu **không thể làm được** — cách dễ nhất: bảo nó sửa một thứ workflow **không có** (vd "đổi node Slack" trên workflow không có Slack) | *Nó có dám báo `完了` cho một việc chưa làm không?* | Không ép được một lượt no-op bằng test — phải để model thật gặp một yêu cầu thật vô nghĩa |

QA-2 kiểm hai thứ, và **thứ tự quan trọng**: fix bình thường phải **chạy thẳng tới `完了`** (phanh cũ
đã gỡ — S2c), rồi fix vô nghĩa phải **DỪNG** (phanh mới đã lắp — S2b). Kiểm vế một mà bỏ vế hai là tự
tay bật đường ship lỗi im lặng.

> ⚠️ **Gửi fix HAI LẦN liên tiếp.** `[ĐO code]` Fix **đầu tiên** sau `完了` đi nhánh `phase==='test'`
> (return sớm); fix **thứ hai** đi nhánh fall-through. Với đơn thuốc HAI lời gọi của §4.3.2, **cả hai
> phải chạy tới `完了`** — nếu chỉ vòng #2 chạy còn vòng #1 dừng, nghĩa là mới vá được một chỗ.

**Nếu ship thêm LOẠI 2 (S4·S5·S6·S7·S8) — thêm 2 mục:**

| # | Làm gì | Vì sao |
|---|---|---|
| **QA-3** | Import một yml → 作り方 =「あるものを直す」→ gửi một yêu cầu nhỏ → **mở tab 差分** | Phải thấy **sửa tại chỗ**, KHÔNG phải dựng lại từ pattern. Nhánh này do token `{{SEED_PATH}}` quyết định **trong prompt** — code đúng vẫn ra hành vi sai. **Dụng cụ là tab 差分, KHÔNG phải `git diff`**: `projects/_drafts/` bị `.gitignore` nuốt trọn (`.gitignore:62`), nên git không thấy gì cả |
| **QA-4** | Thu cửa sổ về **820px** với dòng 作り方 dài nhất, rồi hover chip | Layout `nowrap` và tooltip chỉ mắt thấy. 30 giây, làm một lần lúc chip landing |

**KHÔNG thuộc QA của spec này**: chất lượng bản 提案 spec. Đó là Làn B của
[103](103-spec-stays-true-through-the-fix-loop.md) — spec đó có test và QA riêng. 105 chỉ đụng
**AI được mở làn đó** (luật loại trừ hai chiều, §4.3), không đụng **nội dung** nó sinh ra.

#### Thứ tự QA

```
npm test (server) + npm test (web) + typecheck   ← cổng bắt buộc
        ▼
QA-1 + QA-2      ← LOẠI 1 ship được sau đây (≈10 phút)
        ▼
QA-3 + QA-4      ← chỉ khi ship LOẠI 2
```

---

---

## 7. Non-goals & thiết kế đã LOẠI

- **Không** gọi "loại 1 / loại 2" trong UI — người dùng không đọc ra được; ranh giới họ đọc được là
  **vị trí** (trong hội thoại vs màn hình trống), và app đã dạy nó rồi.
- **Không** cho `startPhase` chạm LOẠI 1. LOẠI 1 đi qua `/reply` để **giữ** diff-base + Undo + hoà
  giải spec — đúng ba thứ mà lượt ③ tươi làm mất.
- **Không** có biến thể "chỉ ④" hay "ghi thẳng vào `projects/`". Ranh giới an toàn của LOẠI 2 là
  **③④ bắt buộc** + **vào qua `/api/bases`**: toàn bộ lớp chống `AGENTS.md` §4.2 nằm ở đó (4 linter
  chạy trong ③, chạy lại ở ④, preflight tính lại).

| Đã loại | Vì sao |
|---|---|
| **`自動` tự duyệt 提案 spec** | §4.3 — 3/3 phản biện. Cổng $0,36–2,23 gác lệnh mua $6,85–15,84; và nó cũng không cho ra tự-động thật (vẫn dừng ở gate ③) |
| **Setting `fixNeedsSpec`** (bản trước) | Đã có thứ tốt hơn và đã ship: lựa chọn **per-message** ở nút gửi |
| **"Phiên adopt" park ở gate ③** (bản trước) | Vòng fix đã có; ca duy nhất thật sự cần mint là "workflow 0 build", và nó là LOẠI 2 |
| **Đổi hành vi click hàng workflow** (2+ build → mở build mới nhất + arm; 0 build → mint rút gọn) | `workflow-row.ts` đã cân nhắc và bác bỏ bằng chữ: *"picking one for the user would be a guess"*. Với 2+ build hàng tự mở ra và **người dùng chọn** — 2 click, không đoán hộ. Với 0 build thì task mới là đúng; cái sai là task đó chạy ①②③④, và đó là việc của chip 作り方 (§4.2) |
| **Đổi hành vi cây bút chì** | Nhãn + hint hiện tại đang **dạy đúng** hai đường (`i18n.ts:343-347`). Đổi hành vi mà không sửa 4 khoá i18n + 1 comment ⇒ app tự mâu thuẫn |
| **Thêm chip thứ 6** | Hàng chip hết slack, có tiền lệ từ chối |
| **Prompt "sửa nhanh" rút gọn cho ③** | Phần đắt không phải đọc spec — là vòng validate cap-5, đúng thứ giữ file không hỏng. Muốn rẻ thì hạ **model**, đừng hạ **kiểm tra** |
| **Lựa chọn 「từ ②」 trên UI** | Không ai trả lời được, và nói cùng một câu với 高速ビルド |

---

## 8. Open questions

1. **Ca "workflow 0 build"** — mint rút gọn với requirement gì? Người dùng chưa gõ gì cả. Đề xuất:
   mở màn hình trống với chip 作り方 = 「あるものを直す」 + workflow đã chọn sẵn, để họ gõ điều cần sửa.
2. **`/report` chấm task rút gọn bằng gì?** Cần đọc `startPhase` và ghi rõ phase nào **SKIPPED BY
   DESIGN** chứ không phải *missing*.
3. **`_drafts` không có trong dropdown ワークフロー** nhưng base-import mặc định vào đó — LOẠI 2 sẽ đẩy
   nhiều yml vào `_drafts`; xoá crumb một cái là mất đường quay lại.
4. **Hai build cùng một workflow** ghi đè `SPEC.next.md` / Undo của nhau (§4.4 `[GIẢ THUYẾT]`).
5. ~~(trống)~~
6. **`自動` trên một build đang `testMode='live'`**: sau S2c, vòng fix sẽ tự đi ③→④ **tĩnh**, không live
   (chính sách 036 D5). Đúng, nhưng im lặng — cần một dòng trên thẻ gate nói rõ "lần này kiểm tĩnh".
7. **Spec 103 §Status đã lỗi thời** (nói Làn B "còn mở" trong khi code đã có) — sửa trước khi ai đó
   lập kế hoạch dựa trên nó. Ba mảnh còn thiếu thật của L1: hồ sơ `fixes/`, strip tab 仕様, action `as_new`.

### 8.0 ⚠️ Một quyết định của spec này đã bị GỠ — đọc trước khi đề xuất lại

**`specStale` KHÔNG được làm hard-stop.** §4.3.1 của spec này lập luận rằng `auto` phải dừng khi ③ bỏ
lại `SPEC.md`. Đã ship — và **gỡ sau đúng một commit**.

`[ĐO code]` Phép đo chỉ có **hai bit**: `isSpecStale = artifactChanged && !specChanged`. Nó **không
phân biệt được**:

| | |
|---|---|
| ③ **quên** hoà giải | ✗ sai — đáng cảnh báo |
| ③ hoà giải **rồi kết luận đúng là không cần sửa** | ✓ **đúng, và được chỉ thị** |

Chỉ thị gửi cho **chính lượt đó** kết bằng: *"If nothing in the document has become untrue, change
nothing — **a no-op is a correct outcome**."* Nên chặn trên tín hiệu này là **treo một build không
người trông vì nó làm đúng lời dặn**.

Và spec 103 **đã chốt chuyện này rồi**, kèm lý do, ngay tại chỗ đo:

> *"ADVISORY, deliberately … Whether the badge should ever become a block is a question for the
> **measured rate after this ships**, not for a guess today."*

Spec 105 đè lên quyết định đó **bằng một phỏng đoán**, đúng thứ câu trên cấm. Suite không thấy vì fake
mô hình hoá một agent **luôn** ghi `SPEC.md` ở vòng > 1 — nó chưa từng diễn cái no-op mà prompt cho phép.

⇒ **Muốn chặn thì phải có tín hiệu ba trạng thái**, không phải hai: bắt ③ **tuyên bố** kết quả hoà giải
theo cách máy đọc được, rồi mới phân biệt "đã xem, không cần sửa" với "im lặng hoàn toàn". Trước khi có
cái đó, giữ nguyên advisory.

---

### 8.0b Ba hệ quả của S2c — một đã vá, hai còn để ngỏ

Cho `auto` chạy hết vòng fix mở ra ba chuyện. Ghi cả ba, vì hai cái còn lại là **quyết định**, không
phải lỗi — và người quyết phải thấy chúng.

| | Hệ quả | Trạng thái |
|---|---|---|
| **a** | **Dify giữ bản CŨ trong khi build báo `完了`.** Build không-giám-sát cố ý bỏ qua cổng Import (036 D5), và S2c làm vòng fix chạy thẳng qua ④ ⇒ bề mặt DUY NHẤT từng so "trên đĩa" với "đã import" là bề mặt build đó không bao giờ thấy | ✅ **ĐÃ VÁ** (`e7a2c71`) — thẻ `done` nói ra. Không đổi chính sách deploy, chỉ bỏ sự im lặng |
| **b** | **Mỗi vòng fix không-giám-sát giờ CHẠM Dify thật.** ④ chạy `runImportProbe` → tạo app `[probe] <taskId>` rồi xoá. Trước S2c một vòng fix `auto` không bao giờ tới ④ nên không hề chạm Dify. Xoá hỏng ⇒ mỗi vòng để lại một app mồ côi | ⏳ **để ngỏ** — cần đo trước: probe có thật sự chạy khi `deploy='none'` không, và tỉ lệ xoá hỏng. Đừng đoán (bài học §8.0) |
| **c** | **S2c nới cả `仕様のみ`, không chỉ `自動`.** `boundaryAutoAdvances('spec_only','implement')` là `true`, nên vòng fix dưới `仕様のみ` cũng tự đi ③→④ — kể cả nhánh `apply_spec` | ⏳ **đúng nghĩa của nó** ("chỉ dừng ở ②"), nhưng commit chỉ nói về `auto`. Cần một câu trong `docs/state` lúc đóng spec, không cần sửa code |

---

### 8.1 Việc tồn phát sinh trong lúc ship (2026-08-21) — **chưa làm, cố ý**

Bốn thứ vòng soát tìm ra sau khi S2b/S3b landing. Không cái nào chặn S2c; ghi ra để không rơi.

| # | Vấn đề | Vì sao hoãn | Cỡ |
|---|---|---|---|
| **T1** | **Tab 差分 trộn HAI mốc thời gian** trên build edit-existing — và thẻ gate nói ngược lại tab. `resolveBase` ưu tiên `seedPath`, mà `localEditSeed` đặt field đó cho **mọi** build edit-existing local ⇒ phần workflow của diff luôn là *"kể từ đầu build"*, còn `specDiff` là *"lượt này"*. Badge no-change nói 「このラウンドではワークフローは変わっていません」 trong khi mở tab ra vẫn thấy diff to. **Đây là S2b gặp S3b** — trên đúng cấu hình mà comment của S2b gọi là cấu hình DUY NHẤT sinh được lượt byte-identical | Sửa đúng nghĩa là đổi thứ tự ưu tiên của `resolveBase` (ưu tiên `diff-base.yml`, chỉ rơi về seed khi không có snapshot) — chạm view *"so với app Dify tôi bắt đầu từ đó"*, một quyết định riêng có trade-off riêng. **Là cái DUY NHẤT trong bốn cái người dùng NHÌN THẤY SAI** | S |
| **T2** | `fixUndone` bị **tiêu thụ** trên đường `apply_spec` mà **không bao giờ gửi cho model**: nhánh đó dựng prompt riêng, không nối `undoneTail`, nhưng verify vẫn xoá cờ — kèm comment sai sự thật *"the undo note rode THIS turn's prompt, so it is delivered"*. Session ③ vẫn giữ trong context các sửa đã bị lùi | Lỗi của Làn B (spec 103), không phải của 105. Sửa: nối `undoneTail` vào nhánh `specApplied`, HOẶC chỉ xoá cờ khi đã thật sự gửi (*"hand the value, don't restate the condition"*) | XS |
| **T3** | Bất biến *"import chỉ xảy ra ở ④, nên không undo nào mâu thuẫn được với thứ đã đẩy lên Dify"* — **SAI**. Vòng fix hậu-import (041) đưa build từ ④/`done` **về ③** kèm `replyText`, nên snapshot được arm lại và Undo khả dụng trên build **đã nằm trong Dify** | Hậu quả hôm nay lành (state đầu-lượt chính là state đã import), nhưng lý lẽ này được viết ở **ba** chỗ comment và đang gánh vai *"vì thế không cần cảnh báo"* | XS |
| **T4** | `/restore` không dọn cờ vòng fix (`fixUndoable`, `artifactUnchanged`, `specStale`, `specEdits`) ⇒ thẻ ③ phục hồi có thể mời *"Take this fix back"* cho một lượt người dùng **đã chấp nhận và đã đi qua**, và đeo badge của lượt đó | Độc lập, nhỏ. Route undo đã xoá đúng ba trường đó với lý do *"the two measurements described the round that no longer exists"* — lý do y hệt áp cho restore | XS |

---

---

## 9. Khi đóng spec — loại tri thức → nhà

| Mảnh | Nhà |
|---|---|
| `startPhase` + scaffold-trước-③ + `SPEC.md` tối thiểu + clamp | `docs/state/build-lifecycle.md` §1 (FSM) + §8 (`task.json`) |
| Ba lỗi im lặng của lượt ③ tươi (§4.4) — và **tiêu chí đúng** là `main.yml` đã tồn tại — không phải "có replyText", cũng KHÔNG phải "SPEC.md đã tồn tại" | `docs/state/build-lifecycle.md` §7 + `AGENTS.md` §9 (bài học: đảm bảo khoá vào cờ *cách thức* thay vì *điều kiện thật*) |
| Cửa vào: click hàng workflow, bút chì, `/api/bases` | `docs/state/ui-surface.md` §7 (lib thuần — cạnh `workflow-row.ts`) |
| Chip 作り方 + tooltip hồi sinh + `.empty-suggest` | `docs/state/ui-surface.md` §3 + §6 (i18n) |
| "Bỏ bước phải nói ra đã bỏ gì" (§5.5) | `docs/state/build-lifecycle.md` §nguyên tắc |
| §7 (7 phương án đã loại) | `docs/state/build-lifecycle.md` — mục "đã cân nhắc và loại" |
| Số đo §1.2 + repro §1.3 | `docs/prompts/runs/CAMPAIGNS.md` |
| Open questions §8 | `docs/prompts/runs/CAMPAIGNS.md` mục để-ngỏ |
