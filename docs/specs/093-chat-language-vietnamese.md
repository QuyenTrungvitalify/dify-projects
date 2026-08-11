# Spec 093 — Ngôn ngữ hội thoại tiếng Việt (`chatLang: auto|vi|ja`)

**Status**: IMPLEMENTED (2026-08-11) — S1+S2+S3 code xong sau khi sửa spec. Đã ship: `lib/language.ts`
(module lá: `ChatLang`/`detectLang`/`resolveLang`/`languagePin` — tách khỏi `phases.ts` vì `phases.ts`
import `state/task.ts`, để `createTask` normalize được mà không tạo vòng); `Task.chatLang` + `langHint`
+ `noteUserLang`; **7 call site** pin (4 phase turn qua orchestrator, `askWithin`, `askTestWithin`,
`consultWithin`, distill, judge) — nhiều hơn 4 dự kiến vì rà thêm được distill + judge; route
`chat_lang` trên `/api/tasks` · `/api/consult` · `/api/promote`; pill header + localStorage
(`withChatLang` là cửa duy nhất ra wire); banner hai tầng ở analyze/spec/draft/implement/judge/promote
+ section song ngữ SPEC. **Đã verify**: 916/916 server test + 282/282 web xanh, tsc sạch cả hai;
đỏ-khi-revert bắn thử 3 lần (đảo thứ tự detect → đỏ; bỏ bậc hint/requirement → 6 test đỏ; bỏ forward
`chat_lang` ở route → đỏ); UI thật ở vite (pill hiện KHÔNG cần `?dev=1`, xoay auto→vi→ja, nhãn+tooltip
đổi, sống qua reload, ⚙ vẫn ẩn). **CHƯA verify**: một build thật tiếng Việt end-to-end (§S3 mục b/c —
YAML title/desc còn JP, SPEC có section VN đúng chỗ, chat không lọt preamble EN) — cần user chạy.

**Rà độc lập (2026-08-11, phiên sau)** — chạy lại từ đầu, không tin lời khai ở trên: 917/917 server
(+1 test mới) · 294/294 web · tsc sạch cả hai; pill kiểm tận mắt trên **bản KHÔNG dev** (web 5198 →
backend 4181): xoay đủ `auto → vi → ja → auto`, nhãn + `aria-label` + localStorage khớp nhau, sống qua
reload, console sạch. Tooltip nói thẳng ranh giới §2.1 ("the workflow itself keeps the requirement's
language") — đúng chỗ user cần đọc. **Hai lỗ đã bịt**:
1. **Thứ tự bậc 2 > bậc 3 của chuỗi resolve KHÔNG có test nào ghim.** Bắn thử: bỏ hẳn
   `latest: opts?.replyText` ở `orchestrator.ts` ⇒ **5/5 test wire vẫn xanh**; đảo `hint` lên trước
   `latest` ⇒ 30 test vẫn xanh. Nguyên nhân: mọi entry point đều `noteUserLang` (refresh `hint`) TRƯỚC
   khi tính pin, nên hôm nay hai bậc cho cùng kết quả — bậc `latest` là lớp phòng thủ cho entry point
   tương lai quên stamp, chứ không phải đường sống duy nhất. Đã thêm test ghim đúng thứ tự
   (`content-language.test.ts`, ca "latest thắng hint cũ"); xác minh đỏ-khi-revert: chỉ mình nó đỏ,
   29 test còn lại xanh.
2. `state/task.ts:280` JSDoc trỏ `{@link import('../lib/phases.js').resolveLang}` — sai module sau khi
   tách `language.ts` (đúng ra là `../lib/language.js`). Đã sửa.
Đóng spec bằng `/spec-close 093` sau khi user xác nhận; nhà tri thức xem bảng §7 (build-lifecycle.md
§prompt-render + bảng test, ui-surface.md §6, CHANGELOG "Unreleased" đã ghi).

<details><summary>Bản REVIEWED (2026-08-11) — 8 điểm đã sửa so với draft 08-10</summary>


⚙ dev-only ⇒ pill header (§3.2), một-nguồn-detect ⇒ **chuỗi fallback 5 bậc** (§3.3), thêm
`langHint` dính cho lượt Continue (§2.5), 2 call site ⇒ **4** (thêm `askWithin`/`askTestWithin`),
di trú 2 test cũ + tuyên bố supersede spec 046 AC 3 (S1), tầng cho `judge.md` (§3.4), section
song ngữ viết theo ngôn ngữ chat chứ không hardcode VN (§3.5), non-goal "VN không dấu" (§5).
</details>

User chốt scope: "thêm ngôn ngữ tiếng Việt, chủ yếu user dùng là tiếng Việt và tiếng Nhật".

---

## 1. Bối cảnh — vấn đề và bằng chứng

### 1.1 Vấn đề (lời user, 2026-08-10)

"khi t chat tiếng việt nhưng output luôn là tiếng nhật (theo setup) […] ví dụ spec cũng vậy
mặc dù yêu cầu tiếng việt nhưng nội dung spec là tiếng nhật". Người dùng Builder là đội VN
(kèm khách/PM Nhật) — hai ngôn ngữ cần phục vụ là **vi** và **ja**.

### 1.2 Kiến trúc hiện tại (đọc code 2026-08-10 — mọi dòng dưới đây kiểm được)

- `languagePin(requirement)` ở `server/lib/phases.ts:182`: thấy **một ký tự kana** trong
  requirement ⇒ trả pin 「【最重要・言語】…すべて日本語で…」; Latin ⇒ `''`. Pin được prepend
  vào **mọi** prompt.
- Hai call site, cả hai luôn truyền `task.requirement`:
  `server/lib/orchestrator.ts:461` (build turns — fresh **và** reply) và
  `server/lib/ask.ts:596` (consult — mọi prompt; comment `state/task.ts:636` ghi rõ message
  đầu "doubles as the `languagePin` source").
- Tầng prompt phase: section `## Output language` trong `.claude/skills/dify-build/`
  (`analyze.md:31`, `spec.md:22`, `implement.md:43`) trói **toàn bộ** human-facing prose —
  cả chat reply LẪN nội dung SPEC.md — vào ngôn ngữ của `{{REQUIREMENT}}`.

Hệ quả: một requirement trộn VN+JP (chỉ cần vài heading như 目的とスコープ) ⇒ kana thắng ⇒
cả task bị ghim tiếng Nhật vĩnh viễn, bất kể user nhắn gì.

### 1.3 Bằng chứng field (run 1786089321835, dossier export 2026-08-10)

- Requirement phần thân chủ yếu tiếng Việt, heading JP ⇒ pin JP. Cả 12 turn trả lời JP trong
  khi **cả 9 tin nhắn** của user là tiếng Việt.
- Friction đo được ở gate ②: user hai lần phải nhắn "các câu hỏi khác thì t ko rõ lắm giải
  thích lại đi" trước đoạn 確認していただきたいこと bằng văn kỹ thuật JP, và chốt bằng
  "mấy cái khác thì theo recommend đi" — tức phần *câu hỏi cần user quyết* không đến được
  người đọc.

### 1.4 Vì sao setting tường minh, không phải auto-detect thuần

Tin nhắn VN thật của user nhúng kana giữa câu ("phàn **合流後** chính là phần
**共通ワークフロー C**…" — events.jsonl run trên). Detect theo script trên từng tin nhắn sẽ
misfire sang JP thường xuyên. Detect chỉ được làm **fallback** khi setting là `auto`, và khi
detect thì **dấu tiếng Việt phải thắng kana** (câu VN nhúng danh từ JP là phổ biến; chiều
ngược lại thực tế không xảy ra).

## 2. Nguyên tắc (giữ khi implement)

1. **`chatLang` chỉ điều khiển HỘI THOẠI** — text trả lời ở chat, giải thích fix, câu hỏi
   gate. **Artifact bàn giao giữ ngôn ngữ requirement/khách**: title/desc node, prompt LLM
   trong workflow, message thông báo (Chatwork…), tên cột sheet, và **thân SPEC.md**. Ranh
   giới này là lý do tồn tại của spec — vi phạm nó là hỏng deliverable cho khách JP.
2. **Pin viết bằng chính ngôn ngữ đích** (lý do đã ghi ở comment `phases.ts:173-181`: model
   bám theo ngôn ngữ của chỉ thị nổi bật nhất — pin EN cho reply VN sẽ không chặn được
   preamble tiếng Anh/Nhật).
3. **Máy móc giữ ASCII** bất kể ngôn ngữ: node id, YAML key, `{{#…#}}`, slug, plugin hash —
   nguyên văn quy tắc đã có trong pin JP và các banner Output-language.
4. **`auto` là default và back-compat**: task.json cũ không có field ⇒ `auto`; user JP không
   đụng setting thì hành vi y như hôm nay (requirement JP ⇒ pin JP). Không đổi hành vi cho
   ai không opt-in. **Điều này buộc resolve phải là một CHUỖI fallback, không phải một nguồn
   duy nhất**: nếu chỉ đọc text vừa gõ, một task JP mà user reply "OK" / dán một node id /
   dán error tiếng Anh sẽ rơi về `''` ⇒ mất pin ⇒ preamble EN quay lại — đúng thứ pin sinh ra
   để chặn. Chuỗi ở §3.3 giữ lời hứa này.
5. **Ngôn ngữ không được nhảy giữa các lượt trong cùng một task.** Lượt Continue sau gate là
   turn *fresh*, không mang text user (`orchestrator.ts:142/161` gọi `runPhaseAndGate` không
   `replyText`) — nếu nguồn detect chỉ là "text của lượt này" thì lượt reply nói VN còn lượt
   Continue nói JP. Vì vậy ngôn ngữ đã nhận ra từ tin nhắn user được **ghim dính** (`langHint`)
   trên task và dùng cho các lượt không có text.
6. **Một nguồn sự thật**: resolve ngôn ngữ là hàm pure có test riêng; orchestrator/ask chỉ
   gọi, không tự suy.
7. **Mọi surface CHAT đều phải theo setting** — không chỉ turn phase. Friction §1.3 xảy ra khi
   user *hỏi tại gate*, tức `askWithin`; hôm nay `askWithin`/`askTestWithin` không gọi
   `languagePin` (grep: chỉ 2 call site). Setting bật mà hỏi ở gate vẫn ra JP thì tính năng
   coi như hỏng.

## 3. Thiết kế

### 3.1 Kiểu và giá trị

```ts
type ChatLang = 'auto' | 'vi' | 'ja';
```

Không có `'en'` tường minh — `auto` không match VN/JP thì trả `''` như hôm nay (prompt gốc
tiếng Anh tự đọc là English). Thêm `'en'` sau nếu có user cần, không đoán trước.

### 3.2 Client — setting persist một lần, dùng mãi

- `RunSettings` (`web/src/store.ts:126`) thêm `chatLang: ChatLang`, persist localStorage
  theo đúng pattern `mode` (`store.ts:96-107`) — chọn `vi` một lần, mọi task sau đều VN.
- UI: **pill trên header, cạnh nút 🌐 ngôn ngữ UI và nút theme** (`App.tsx:605-614`) — cùng
  họ khái niệm ("ngôn ngữ"), luôn hiện với MỌI user. KHÔNG thêm chip vào hàng composer (hàng
  chip giữ nguyên tắc nowrap: cấm flex-wrap, chỉ chip workflow được truncate), và **KHÔNG đặt
  trong panel ⚙**: `SettingsModal` là surface **dev-only** (`Sidebar.tsx:386` render dưới
  `{devMode && …}`) và render field registry **server-side** ghi `.dify-settings.local.json` —
  bản sạch chạy không `BUILDER_DEV=1` sẽ không bao giờ thấy nút đó, tức đúng nhóm user đích
  bị mất tính năng. Pill xoay vòng `auto → vi → ja`, nhãn ngắn `Auto` · `VI` · `JA`, tooltip
  giải thích "ngôn ngữ trả lời trong chat"; i18n key EN+JA.
- **Phân biệt với `lang` của i18n**: `lang` (EN⇆JA) là ngôn ngữ **chrome UI**, client-only;
  `chatLang` là ngôn ngữ **model trả lời**, đi xuống server. Hai thứ độc lập — không suy cái
  này từ cái kia (user JA-chrome vẫn có thể muốn chat VN).
- Wire: gửi kèm lúc tạo task như `confirmMode`/`fastMode` — `TaskInput` thêm
  `chatLang?: string` (`state/task.ts:367` vùng), normalize tại `createTask`
  (cạnh `task.ts:554`): `vi`/`ja` giữ, mọi giá trị khác ⇒ `auto`; persist vào task.json.
  Đường consult (`ask.ts`) nhận cùng field khi tạo session.

### 3.3 Server — resolve pin

Đổi chữ ký, giữ hàm pure trong `phases.ts` (nhà đã có: `docs/state/README.md:129`). Một object
tham số thay vì positional — 4 call site truyền cùng một hình dạng, không site nào tự suy:

```ts
type ChatLang = 'auto' | 'vi' | 'ja';
detectLang(text: string): 'vi' | 'ja' | ''                     // pure, test riêng
resolveLang(o: { chatLang?; latest?; hint?; requirement? }): 'vi' | 'ja' | ''
languagePin(o: { chatLang?; latest?; hint?; requirement? }): string   // = pin của resolveLang
```

**Chuỗi resolve — dừng ở tín hiệu đầu tiên** (thay cho bảng một-nguồn của bản draft):

| # | Nguồn | Lý do |
|---|---|---|
| 1 | `chatLang` là `vi`/`ja` | setting tường minh luôn thắng detect (§1.4) |
| 2 | `detectLang(latest)` — text user vừa gõ ở lượt này | fix lỗi gốc "reply pin theo requirement" |
| 3 | `hint` — `task.langHint` đã ghim từ tin nhắn user gần nhất có tín hiệu | phủ lượt Continue (fresh, không có text) — §2.5 |
| 4 | `detectLang(requirement)` | back-compat: task JP + reply "OK" vẫn giữ pin JP — §2.4 |
| 5 | còn lại | `''` (prompt gốc EN tự đọc là English) |

Trong đó `detectLang`: **dấu tiếng Việt thắng kana** (kiểm trước), rồi kana ⇒ `ja`.

- **`langHint` (ghim dính)**: field mới `langHint?: 'vi'|'ja'` trên `Task`. Mỗi entry point
  nhận text user (`replyWithin`, `askWithin`, `askTestWithin`, `consultWithin`) stamp
  `task.langHint = detectLang(text) || task.langHint` rồi `saveTask`. Text không có tín hiệu
  KHÔNG xoá hint đang có (một câu "ok" không được phép reset ngôn ngữ cả task).
- **Bốn call site** (không phải hai): `orchestrator.ts:461`, `ask.ts:596` (`consultWithin`),
  và **thêm** `askWithin` (`ask.ts:225` — hỏi tại gate, đúng chỗ friction §1.3) +
  `askTestWithin` (`ask.ts:380` — ask ở ④/terminal). Cả hai hôm nay build prompt bằng tay,
  không có pin nào.
- **Detect VN**: khối Latin Extended Additional `U+1EA0–U+1EF9` (gần như chỉ tiếng Việt dùng)
  + `ăâđêôơư`/`ĂÂĐÊÔƠƯ` + tổ hợp sẵn `àáảãạ èéẻẽẹ ìíỉĩị òóỏõọ ùúủũụ ỳýỷỹỵ` (U+00C0–U+00FF phần
  nguyên âm có dấu). Chốt tập chính xác bằng test S1.
- **Pin JP giữ NGUYÊN VĂN** (byte-identical) — §2.4: không đổi một chữ nào cho nhóm không
  opt-in. Câu chốt ranh giới artifact chỉ thêm vào pin VN, nơi ca "chat ≠ artifact" thực sự
  xảy ra; ca `ja`-chat/VN-artifact đã có banner hai tầng §3.4 đỡ.
- **Pin VN** (cùng cấu trúc pin JP, viết bằng tiếng Việt):

  > 【QUAN TRỌNG — NGÔN NGỮ】Trả lời toàn bộ bằng tiếng Việt ngay từ ký tự đầu tiên. Cấm mọi
  > mở đầu tiếng Anh ("Let me…", "I'll start by…") hoặc tiếng Nhật. Không viết bằng ngôn ngữ
  > khác rồi dịch. CHỈ giữ nguyên: định danh máy (code, node ID, YAML key, tham chiếu
  > `{{#…#}}`) bằng ASCII, và các chuỗi sẽ nằm BÊN TRONG artifact bàn giao (title/desc node,
  > prompt LLM, message thông báo, tên cột sheet, thân SPEC) — những chuỗi đó theo ngôn ngữ
  > của requirement, không dịch sang tiếng Việt.

  Câu cuối là chốt ranh giới §2.1 ngay trong pin — vì pin là chỉ thị mạnh nhất, phải tự nó
  nói rõ ngoại lệ, không dựa vào banner ở dưới.

### 3.4 Tầng prompt phase — banner Output-language hai tầng

Sửa section `## Output language` trong `analyze.md` / `spec.md` / `implement.md`
(+ `draft.md`, `judge.md` nếu có banner tương tự — rà lúc implement) từ "mọi prose theo
requirement" thành hai tầng:

- **Chat prose** (mọi thứ trả lời trong hội thoại): theo chỉ thị ngôn ngữ ở đầu prompt
  (= pin; không có pin thì theo requirement như cũ).
- **Artifact prose** (nội dung ghi vào SPEC.md, YAML): theo ngôn ngữ requirement — nguyên
  trạng hôm nay, kể cả khi chat là tiếng Việt.

Ranh giới cắt theo **ai đọc**, không theo file: prose user duyệt tại gate là chat prose kể cả
khi nó nằm trong file JSON. Cụ thể:

| Chỗ | Tầng | Vì sao |
|---|---|---|
| Lời trả lời trong chat, overview gate ①, câu hỏi gate ② | chat | user đọc để quyết |
| `judge.md` → `summary` / `evidence` (báo cáo ④) | **chat** | user đọc để quyết pass/fail; không bàn giao cho khách |
| `analyze.json` `note`/`risks`, thân SPEC.md, title/desc/prompt trong YAML | artifact | đi vào deliverable / prompt hạ nguồn |
| `analyze.json` `pattern`/`features`/`find_query`, mọi id/key/ref | ASCII | máy đọc (§2.3) |

### 3.5 SPEC song ngữ — trị trực tiếp friction §1.3

Trong `spec.md` prompt, thêm yêu cầu: **khi ngôn ngữ chat ≠ ngôn ngữ artifact**, SPEC.md phải
kết thúc bằng section:

```
## <"Tóm tắt & câu hỏi" — viết bằng NGÔN NGỮ CHAT, không hardcode tiếng Việt>
- Quyết định chính: <3-6 bullet>
- Câu hỏi cần người duyệt trả lời: danh sách ĐÁNH SỐ, mỗi câu kèm
  "→ Đề xuất: <phương án mặc định>" (user chỉ cần trả lời số, hoặc "theo đề xuất").
```

Section viết bằng **ngôn ngữ chat** (ca vi-chat/JP-artifact là ca thực tế, nhưng luật phải
generic — ja-chat/VN-artifact cũng đúng). Thân SPEC phía trên giữ nguyên ngôn ngữ requirement
(bàn giao được cho khách); section này là **phụ lục duyệt nội bộ ở cuối file**, chấp nhận có
mặt trong bản bàn giao — nếu sau này cần bản sạch cho khách thì cắt phần sau heading cuối, mở
spec riêng. Gate ② từ nay duyệt bằng section này — đúng chỗ user từng phải hỏi lại hai lần.

## 4. Slices

### S1 — hàm pure + test (S)

`detectLang` / `resolveLang` / `languagePin` theo chuỗi §3.3, test đỏ-khi-revert:

- tin nhắn VN **có nhúng kana** + `auto` ⇒ pin VN (case chống misfire — phải fail nếu ai đảo
  ưu tiên về kana-trước);
- `chatLang:'ja'` + text VN ⇒ pin JP (setting thắng detect);
- requirement JP + reply VN + `auto` ⇒ pin VN (fix nguồn detect — phải fail nếu call site
  quên truyền text reply);
- requirement JP + `latest:'OK'` + không hint + `auto` ⇒ **pin JP** (back-compat §2.4 — phải
  fail nếu ai bỏ bậc 4 của chuỗi);
- requirement JP + `latest:''` + `hint:'vi'` + `auto` ⇒ pin VN (lượt Continue — §2.5);
- Latin thuần + `auto` ⇒ `''` (giữ hành vi cũ).

**Di trú test cũ (bắt buộc, cùng slice)**: `test/content-language.test.ts:88+` và
`test/knowledge-inject.test.ts:184-191` gọi `languagePin(requirement)` một tham số ⇒ vỡ khi
đổi chữ ký. Riêng `knowledge-inject.test.ts:185` codify **spec 046 AC 3** *"JA-first /
English-fallback — no other languages"* — 093 **cố ý thay thế** AC đó; sửa test kèm comment
"supersedes spec 046 AC 3" để lần sau không ai revert nhầm như một regression. (Case
`languagePin('yeu cau khong dau') === ''` vẫn đúng sau đổi — VN không dấu không detect được.)

### S2 — wire end-to-end (M)

- `RunSettings.chatLang` + persist localStorage + **pill header cạnh 🌐/theme** (§3.2) + i18n.
- `TaskInput.chatLang` → normalize → task.json; `createConsultTask` nhận cùng field; route
  `POST /api/tasks` + `POST /api/consult` forward `chat_lang`.
- `Task.langHint` + stamp ở 4 entry point nhận text user (§3.3).
- Bốn call site (`orchestrator.ts:461`, `consultWithin`, `askWithin`, `askTestWithin`) gọi
  `languagePin({ chatLang, latest, hint, requirement })`.
- Kiểm tay qua entry-point thật (kỷ luật verification): một build requirement trộn VN+JP,
  setting `vi` ⇒ mọi reply VN; setting `auto` + nhắn VN có kana ⇒ reply VN; setting `ja` ⇒
  y hệt hôm nay.

### S3 — prompt hai tầng + SPEC song ngữ (S)

- Sửa banner Output-language (§3.4) và thêm yêu cầu section song ngữ (§3.5).
- Chạy một build thật tiếng Việt xem: (a) SPEC thân JP + section VN đúng chỗ; (b) YAML
  title/desc/prompt vẫn JP; (c) chat từ token đầu là VN, không preamble EN/JP.

## 5. Non-goals

- **Không** dịch UI chrome web sang tiếng Việt (`i18n.ts` `Lang = 'en'|'ja'` giữ nguyên) —
  việc riêng, mở spec khác nếu team cần.
- **Không** thêm setting `artifactLang` — ngôn ngữ artifact vẫn requirement-driven; chỉ mở
  khi có ca thực tế cần artifact khác ngôn ngữ requirement.
- **Không** auto-dịch spec/reply của các run cũ; không đổi wire format ngoài một field mới.
- **Không** detect per-token/mixed-output (trả lời nửa VN nửa JP) — một ngôn ngữ mỗi turn.
- **Không** detect được **tiếng Việt không dấu** ("lam giup t cai nay") — `auto` sẽ rơi xuống
  bậc 3/4 của chuỗi. Đây là giới hạn CÓ CHỦ Ý (không có tín hiệu script nào để bám); lối thoát
  là setting tường minh `vi`, chọn một lần là xong. Đừng coi là bug lúc test.
- **Không** đổi pin JP hiện hành, kể cả thêm chữ — §2.4.

## 6. Open questions (không blocker, chốt lúc implement)

1. ~~Consult ở empty-surface: setting global trong ⚙ là đủ?~~ **CHỐT ở §3.2**: pill header
   (luôn hiện, mọi surface — empty/consult/build đều thấy), không chip composer, không ⚙.
2. Wording pin VN — thử 1–2 build thật xem có chặn hết preamble EN không; chỉnh câu chữ tại
   chỗ nếu lọt (như đã từng phải làm với pin JP: banner EN không đủ, phải viết bằng JP).
3. `draft.md`/`judge.md`/`promote.md` có banner ngôn ngữ riêng không — rà và sửa cùng đợt S3.

## 7. Bảng nhà tri thức (cho /spec-close sau này)

| Mảnh | Nhà |
|---|---|
| Ranh giới chat-lang vs artifact-lang + chuỗi resolve | comment tại `languagePin` + `docs/state/build-lifecycle.md:41` (dòng đang mô tả "kana → chỉ thị JP", phải viết lại) |
| Lý do ưu tiên VN-diacritics > kana (tin nhắn VN nhúng kana) | comment hàm pure + test case tương ứng |
| Lý do `langHint` dính (lượt Continue không mang text) | comment tại field `Task.langHint` |
| Map test → hành vi | `docs/state/build-lifecycle.md:475` (bảng test, cập nhật dòng `languagePin kana`) |
| Pill ngôn ngữ chat trên header ≠ toggle i18n | `docs/state/ui-surface.md` |
| Section song ngữ của SPEC (hành vi sau ship) | `.claude/skills/dify-build/spec.md` (tự nó là nhà) + CHANGELOG |
| Bằng chứng field run 1786089321835 | spec này; sau close, tóm 1 dòng vào doc chủ |
