# Spec 096 — Chọn model ở composer: từ "môi trường tự quyết" thành một lựa chọn có chủ đích

**Status**: **ĐÃ SHIP (2026-08-12)**. Nguồn: user hỏi *"sao lúc build lại dùng haiku nhỉ, việc chọn
model là có chủ đích?"* sau khi soi dossier hai build liền nhau.

Câu trả lời hoá ra là **không** — và đó là một lỗ hổng đo lường, không chỉ là chuyện tò mò.

---

## 1. Trước spec này: model là giá trị môi trường

**[ĐỌC]** Không có chỗ nào trong repo chọn model. Kiểm bốn đường:

| đường có thể set | thực tế trước 096 |
|---|---|
| `--model` khi spawn | **không truyền** — header `claude-session.ts` liệt kê nguyên văn: *"STRIPPED (not needed here): … `model`/systemPrompt/appendSystemPrompt/allowedTools/maxTurns options"* |
| `headless-settings.json` (đi qua `--settings`) | **không có khoá `model`** |
| env | strip chỉ xoá `CLAUDE_CODE*`, `CLAUDECODE`, `DIFY_*`; `ANTHROPIC_MODEL` sẽ đi qua nhưng **không ai set** |
| `~/.claude` của operator | **bị loại** bởi `--setting-sources local` |

`cost.ts:42` chỉ **ghi lại** model đọc từ result stream. Grep `docs/state/` + `AGENTS.md`: **0 dòng**
nói về việc chọn model cho turn.

**[ĐO]** Hệ quả là nó trôi thật, giữa các run và giữa các phase trong cùng một run:

| run | analyze | spec | implement |
|---|---|---|---|
| 1786089321835 | haiku | **opus** | **opus** |
| app1 (08-12) | haiku | — | có opus |
| app2 (08-12) | haiku | haiku | haiku |

app2 dựng 27 node **toàn Haiku**, $4.37. Run gốc tốn ~$7.5 chỉ 3 phase vì có Opus.

**Vì sao đây là vấn đề, không chỉ là thiếu tiện nghi:**

1. **Phép đo before/after mất hiệu lực.** `/campaign` chấm điểm trước/sau khi sửa prompt. Model trôi
   giữa hai lần chạy ⇒ một cải thiện có thể do model chứ không do bản sửa, mà không ai biết. Đây đúng
   loại nhiễu cả repo này đang cố loại.
2. **Không kiểm soát rủi ro.** Graph 52 node dựng bằng Haiku và bằng Opus không cùng một mức cược.
3. **Không kiểm soát chi phí.**

## 2. Quyết định thiết kế: ALIAS, không phải id ghim

`claude --help` ghi: *"Provide an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a
model's full name"*. Alias nghĩa là **"bản mới nhất của họ đó"** — chính là đòi hỏi *"model mới nhất có
thể dùng của môi trường hiện tại"*, và **không phải tự bảo trì bảng phiên bản** sẽ cũ đi sau mỗi
release.

**[ĐO]** Bắn thử thật, dưới **đúng bộ flag Builder dùng** (`--permission-mode acceptEdits --settings
<headless> --setting-sources local`, env đã strip):

| alias | resolve ra |
|---|---|
| `opus` | `claude-opus-5` |
| `sonnet` | `claude-sonnet-5` |
| `haiku` | `claude-haiku-4-5-20251001` |
| `fable` | `claude-fable-5` |

Id đầy đủ vẫn được `cost.ts` ghi lại ⇒ dossier tiếp tục chứng minh **cái gì đã chạy thật**, không phải
cái gì được yêu cầu.

## 3. Ngữ nghĩa: START-BOUND

Chọn một lần cùng tin nhắn đầu, rồi **khoá**, giống `fastMode` và workflow target (`lockStartBound`).
Lý do: cả bốn phase của một build phải là **cùng một mức cược**, nếu không dossier mất nghĩa.

`normalizeModel` trả `undefined` cho giá trị lạ/thiếu — **không** trả về default. Đây là chỗ
load-bearing: `undefined` là thứ giữ cho `--model` không xuất hiện, tức task tạo **trước** 096 chạy y
như cũ; và một typo không bao giờ âm thầm thành một model khác cái được yêu cầu.

## 4. Đã đụng

**Server** — `claude-session.ts` (`SessionOptions.model`, và tách `buildSpawnArgs` thành hàm pure để
argv test được mà không tạo process); `state/task.ts` (`MODEL_CHOICES`/`DEFAULT_MODEL`/`normalizeModel`,
`Task.model`, wiring trong `createTask` **và** `createConsultTask`); `orchestrator.ts` (truyền
`task.model` cho mọi phase spawn); `ask.ts` (3 spawn: ask/askTest/consult); `routes/tasks.ts` (nhận
`model` ở cả POST build lẫn POST consult).

**Web** — `store.ts` (`RunSettings.model`, `MODEL_OPTIONS`, `initialModel`/`rememberModel`, `withModel`
đi cùng seam `withChatLang`); `api.ts`; `types.ts`; `Chat.tsx` (chip); `App.tsx` (persist + subset);
`i18n.ts` (EN + JA).

**Chip nằm NGOÀI khối build-only** — nó áp cho consult y như build; đưa ra một lựa chọn rồi âm thầm bỏ
qua ở một trong hai chế độ thì tệ hơn không đưa ra.

## 5. Ba lỗi bị bắt bởi kiểm hình, không phải bởi đọc lại code

Đây là phần đáng ghi nhất của spec này — cả ba đều typecheck sạch và test xanh:

1. **Hàng chip overflow 93px ở viewport 820.** `.composer-row` là `flex-wrap: nowrap` có chủ đích (chỉ
   chip Workflow được truncate). Đo bằng cách ẩn/hiện chính chip mới: không có nó `sw=cw=453`, có nó
   `sw=546`. Sửa bằng `shrink` trên chip Model. Sau sửa: `453/453`, hàng 32px, Send đúng chỗ.
2. **`rememberModel` được export mà chưa hề gọi.** localStorage trả `null` sau khi đổi chip. Nối vào
   `onSettings` — cái phễu duy nhất cho mọi thay đổi setting của composer.
3. **`settingsSubset` thiếu `model`** ⇒ chip **luôn hiện "Opus"** dù giá trị đã đổi, đã persist và đã
   được gửi lên. Một control nói dối về việc nó đang làm gì — tệ hơn hẳn một control không tồn tại.

Không lỗi nào trong ba lỗi trên bị test bắt. Chúng chỉ lộ ra khi mở app thật và bấm thật.

## 6. Kiểm chứng

| # | phép | kết quả |
|---|---|---|
| 1 | 4 alias resolve dưới đúng flag của Builder | ✅ real spawn |
| 2 | `normalizeModel`: alias / hoa-thường / id đầy đủ → alias; lạ+thiếu → `undefined` | ✅ 5 test |
| 3 | `buildSpawnArgs`: có chọn ⇒ `--model` đúng 1 lần; không chọn ⇒ **argv y hệt pre-096** (deepEqual) | ✅ 3 test |
| 4 | Hàng composer ở 1280 / 1024 / 820: một dòng, Send cùng dòng, không overflow | ✅ đo DOM |
| 5 | Chip đổi giá trị + persist qua reload | ✅ `Opus → Sonnet`, localStorage `sonnet` |
| 6 | **Payload thật** gửi lên có `model` | ✅ chặn `fetch`, đọc body, **không tạo task nào** |
| 7 | server 946/946 · web 309/309 · typecheck cả hai nửa | ✅ |

## 7. Non-goals

- **Không** ghim id cụ thể (`claude-opus-5`) ở bất kỳ đâu — alias là hợp đồng "mới nhất của họ đó";
  ghim id là tự tạo việc bảo trì và sẽ cũ.
- **Không** chọn model **theo phase** (Haiku cho ①, Opus cho ③). Đúng về kinh tế và là bước hợp lý
  tiếp theo, nhưng cần số liệu trước — start-bound một model là nền để đo.
- **Không** đổi hành vi của task đã tạo trước 096: thiếu `model` ⇒ không có `--model` ⇒ y như cũ.
- **Không** ghim model cho `promote` (distill) và `judge` — chúng chưa nhận `task.model`; ghi lại ở §8.

## 8. Còn để ngỏ

1. **Model theo phase.** ① Analyze là digest ngắn; ③ Implement dựng graph 27–52 node. Tiền và rủi ro
   nằm ở ③. Cần số liệu từ vài build start-bound trước khi tách.
2. **`promote` / `judge` turn** chưa nhận `task.model`. Không sai (chúng vẫn ambient như trước), nhưng
   là chỗ không đồng nhất còn lại.
3. **`/campaign` nên từ chối so sánh hai run khác model** — giờ model đã có trong `task.json` nên việc
   này kiểm được; trước 096 thì không.

## 9. Bảng nhà tri thức (cho `/spec-close`)

| Mảnh | Nhà |
|---|---|
| Model trước 096 là AMBIENT + bằng chứng trôi (bảng §1) | `AGENTS.md §9` (bài học) + `docs/state/build-lifecycle.md` |
| Vì sao dùng ALIAS chứ không id ghim, kèm bảng resolve đã đo | comment tại `SessionOptions.model` + `MODEL_CHOICES` |
| `model` start-bound; `undefined` ≠ default và vì sao | comment tại `normalizeModel` + `Task.model` |
| `.composer-row` là nowrap: chip mới phải `shrink`, kèm số đo 820px | `docs/state/ui-surface.md` (cùng nhà với bài học nowrap đã có) |
| Ba lỗi chỉ kiểm hình mới bắt được (§5) | `AGENTS.md §9` — *typecheck xanh + test xanh ≠ UI đúng* |
| Việc chưa làm (§8) | `docs/prompts/runs/CAMPAIGNS.md` mục để-ngỏ |
