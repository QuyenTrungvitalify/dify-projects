# Spec 092 — Composer: hai hành động gửi (bỏ sticky mode ask|change)

**Status**: IMPLEMENTED (2026-08-10, cùng ngày draft) — S1+S2+S3 đã code xong trong một lượt:
tầng pure đổi `mode`→`intent` (composer-route + test), Composer 2 nút (`canChange`/`changeArmed`/
`sendGlyph`, ⌘⌃Enter), App.tsx bỏ state `mode` (thay bằng `armed` hint), i18n EN+JA, CSS
`.composer-change` (khối `.mode-*` xoá). Đã verify qua vite dev + build thật đang park ở gate ②:
2 nút render, arm từ 仕様を編集 → pill sáng + placeholder 何を変更しますか？ + focus, xoá hết draft
→ hint tan. 282/282 web test xanh, tsc sạch. CHƯA verify: gửi thật cả 2 chiều (không bắn /reply
vào build thật của user), ca 409 giữ-arm, IME Enter thật, promote/error/terminal-fixable trên UI.
 Open questions §6: (1) chọn highlight tĩnh accent-dim, không pulse; (2) placeholder JA giữ bản dài.
Tinh chỉnh sau review user (2026-08-11): nút gửi cũng có LABEL cho đồng bộ với pill — icon đổi
thành **↵ (phím Enter)** để dạy "bấm = Enter = send"; label = 「質問を送信」khi đứng cạnh pill ✎
(「送信」trần ở đó sẽ tái sinh bẫy toggle-rồi-send: bấm 変更を依頼 tưởng là mode, gõ, bấm 送信 →
đi thành câu hỏi), = 「送信」ở ngữ cảnh 1-nút; promote giữ glyph ✎; dưới 560px cả hai rụng label.
Phát hiện kèm theo: proxy vite `'/api'` match prefix nuốt luôn module `/api.ts` → dev 5199 chết
MIME error; đã sửa thành regex `^/api(/|$)` trong `web/vite.config.ts`.
**Đóng spec**: `/spec-close 092` sau khi user xác nhận chạy tốt; nhà của tri thức xem bảng cuối
(hàng vi đã ship + nguyên tắc: ĐÃ có ở `docs/state/ui-surface.md` §7 hàng `composer-route.ts`).

---

## 1. Bối cảnh — vấn đề và bằng chứng

### 1.1 Vấn đề (lời user, 2026-08-10)

Tại gate, composer có hai "mode": hỏi (Ask, mặc định) và yêu cầu sửa (change, phải arm).
User "nhiều khi không để ý mà chọn, cứ phải nhớ để bật qua lại" — tức là gánh nặng nằm ở việc
**phải nhớ một trạng thái ẩn** trước khi gõ, không phải ở việc không nhìn thấy chip.

### 1.2 Kiến trúc hiện tại (đọc code 2026-08-10 — mọi dòng dưới đây là file:line kiểm được)

- State dính `mode: 'ask' | 'change'` sống ở `App.tsx` (`useState`, App.tsx:80), kèm
  `changeLabel` (nhãn hành động đã arm, ví dụ "Edit spec") và `focusToken`.
- **Điểm arm** (bật `change`): nút reply-kind trên GateCard (App.tsx:691), docked bar
  (App.tsx:722), `armFix()` cho build done (App.tsx:415), nút `mode-arm` ở terminal row
  (App.tsx:437).
- **Điểm reset** (về `ask`): effect `[taskId, phase]` (App.tsx:169 — FIX-I), `openTask`/`newTask`/
  `newChat`, và **đường thành công của mỗi lần gửi** (`onDone`, App.tsx:246-249).
- **Điểm đọc duy nhất**: `composerTarget(task, mode)` + `replyLabel(...)` — hàm pure trong
  `lib/composer-route.ts`, có test riêng.
- UI chỉ báo: `.mode-row` (chip 「変更を依頼」 + link 「質問に戻る」) **chỉ render khi
  mode==='change'** (App.tsx:422) — ở Ask không có chỉ báo nào ngoài placeholder.

### 1.3 Vì sao bỏ state là đúng, không phải chỉ tăng visibility

**[ĐO — đọc code, kiểm tại các dòng trên]** Vòng đời thực tế của change-mode là **một tin
nhắn**: arm → gõ → gửi → tự tắt (reset ở onDone khi thành công, hoặc ở effect FIX-I khi phase
re-run). Một "mode" sống đúng một message thực chất là lựa chọn per-message được cài bằng state
dính — và chính state dính là nguồn của cả hai lớp lỗi đã ghi nhận:

- **[REPRO — đã xảy ra field, ghi tại comment App.tsx:238-245]** Send thất bại (409 turn-busy)
  từng disarm change-mode âm thầm → lần gửi lại đi vào `/ask`, fix không bao giờ chạy. Đã vá
  bằng cách chỉ reset trên success-path, nhưng lớp lỗi "state và ý định lệch nhau" vẫn còn đó.
- **[GIẢ THUYẾT — lời user, chưa đo tần suất]** Chiều ngược lại: user gõ câu hỏi khi state còn
  `change` (hoặc quên arm khi muốn sửa) — không có số đo, nhưng đây là complaint gốc.

Phương án "segmented control luôn hiện" chỉ giúp *nhận ra* đã quên; nó không xóa thao tác
phải-nhớ. Chuyển sang chọn-tại-lúc-gửi xóa nguồn gốc: **không còn state nào để nhớ, mỗi tin
nhắn tự khai báo ý định**.

## 2. Nguyên tắc (giữ khi implement)

1. **Asymmetry an toàn giữ nguyên**: hỏi nhầm thì rẻ (một câu trả lời), sửa nhầm thì đắt
   (re-run phase). Do đó **Enter và nút mặc định luôn luôn là Hỏi** — kể cả khi vừa được arm
   từ gate action. Gửi-sửa phải là cú click/phím tắt có chủ đích, không bao giờ là hệ quả của
   một trạng thái được bật từ trước. (Đây là quyết định đã cân nhắc trade-off: luồng arm-from-gate
   tốn thêm một click so với hiện tại, đổi lấy việc lớp lỗi "Enter gửi nhầm thành sửa" biến mất
   hoàn toàn — không có ngoại lệ nào để user phải học.)
2. **Ý định là thuộc tính của tin nhắn, không phải của composer**: không tái sinh state dính
   dưới tên khác. "Arm" từ gate action chỉ còn là *gợi ý trình bày* (focus + highlight nút +
   placeholder) cho tin nhắn kế tiếp — nó không đổi đường đi của Enter.
3. **Hai nút phải khác nhau bằng hình lẫn chữ** (yêu cầu user): Hỏi = icon chat, Sửa = icon
   edit + label. Không bao giờ hai icon trần cạnh nhau — hành động đắt phải có chữ.
4. **Quyết định route vẫn nằm ở hàm pure có test** — `composer-route.ts` đổi chữ ký chứ không
   bị bỏ; UI chỉ thi hành phán quyết (giữ nguyên lý do extract ghi ở đầu file đó).
5. **Hàng chip của composer giữ nowrap** — nút mới không được làm tràn hàng hay đẩy layout nút
   gửi (bài học cũ: cấm flex-wrap ở composer row; chỉ chip workflow được truncate).

## 3. Thiết kế

### 3.1 Bề mặt — hai nút gửi

Tại các composer nơi cả hai đích đều hợp lệ (xem ma trận 3.3), cụm gửi bên phải hàng chip trở
thành **hai nút**:

```
[⚙ chips … ]  [📎]  [ ✎ 変更を依頼 ]  [ 💬↑ ]
                     └ pill outline ┘  └ nút tròn accent ┘
```

- **Nút Hỏi** (mặc định): giữ vị trí ngoài cùng bên phải (muscle memory của nút gửi hiện tại),
  giữ kiểu tròn accent `.composer-send`, đổi glyph từ `arrowUp` → `message` (icon chat có sẵn
  trong `Icon.tsx`). Tooltip: 「質問を送信 (Enter)」/ "Send as question (Enter)".
- **Nút Sửa**: pill outline đứng NGAY TRÁI nút Hỏi — icon `edit` (bút chì, có sẵn) + label
  「変更を依頼」(EN: "Request changes", tái dùng key `modeChange`). Màu chữ/viền dùng token
  accent-dim như `.mode-chip.on` hiện có để nó đọc là "hành động can thiệp", khác hẳn nút tròn.
  Tooltip: 「変更依頼として送信 (⌘Enter)」/ "Send as change request (⌘Enter)".
- **Phím tắt**: Enter = Hỏi (như cũ, giữ nguyên IME-guard isComposing/keyCode 229 — cả hai
  phím tắt đều phải qua guard này); **⌘Enter (mac) / Ctrl+Enter = Sửa**.
- **Disabled**: cả hai theo đúng điều kiện của nút gửi hôm nay (`busy || asking`, text rỗng).
- **Hẹp ngang**: nút Sửa được phép rụng label còn icon-only (kèm tooltip) dưới một ngưỡng
  container-width, để tôn trọng nguyên tắc nowrap §2.5. Ngưỡng cụ thể đo lúc implement.

### 3.2 "Arm" từ gate action — hạ cấp thành gợi ý trình bày

Nút reply-kind trên gate ("Edit spec", "Request changes", Request-a-fix ở build done, docked
bar) **không còn setMode**. Thay vào đó chúng phát `armHint {label}`:

- focus composer (`focusToken` — giữ nguyên cơ chế),
- nút Sửa nhận highlight tạm (ví dụ chuyển sang nền accent-dim đậm + pulse một nhịp),
- placeholder đổi thành `phChangeMode` 「何を変更しますか？」,
- `changeLabel` = label của action (nguyên cơ chế FIX-G, để gate card resolved ghi đúng
  "Edit spec" thay vì generic).

`armHint` tan khi: gửi thành công bất kỳ chiều nào, đổi task/phase (effect [taskId, phase] hiện
có), hoặc user tự xoá hết draft. Nó **không** đổi hành vi Enter (§2.1). Send-sửa thất bại
(409…) khôi phục draft + files như hôm nay và **giữ nguyên armHint** — user chỉ việc bấm lại
đúng nút; không còn ca "retry rơi về /ask" vì không còn mode để disarm.

### 3.3 Ma trận hiển thị (bám đúng `composerTarget` hiện tại)

| Ngữ cảnh | Hôm nay | Sau 092 |
|---|---|---|
| Gate ①②③④ đang park (`askableGate`, kind≠promote) | 1 nút + mode dính | **2 nút** |
| Build `done` sửa được (`terminalFixable`) | 1 nút + nút arm "Request a fix" ở mode-row | **2 nút** |
| Build `done` không sửa được / `cancelled` / consult | 1 nút (ask-only) | 1 nút Hỏi (icon chat) |
| `error` (Retry path — route luôn là reply) | 1 nút | 1 nút (giữ nguyên, glyph giữ `arrowUp`) |
| Promote (route luôn là reply, không có Ask) | 1 nút | 1 nút, glyph `edit` cho trung thực |
| Empty surface (start build/consult) | 1 nút | 1 nút (không đổi — `mode` ask\|change vốn bị bỏ qua ở start) |

Ghi chú đặt tên: chip `モード: 相談|ビルド` ở empty view (spec 082) là `mode` KHÁC (consult|build)
— không đụng tới; nhân tiện S2 nên đổi tên prop đó nếu rẻ để hết trùng tên (không bắt buộc).

### 3.4 Những gì bị XÓA

- `const [mode, setMode]` ask|change + toàn bộ điểm set/reset của nó trong App.tsx (FIX-I
  effect chỉ còn nhiệm vụ tan armHint).
- `.mode-row`, `.mode-chip`, `.mode-back`, `.mode-arm` (markup + CSS) — cả `modeRow` lẫn
  `terminalModeRow`. Nút "Request a fix" ở gate-foot của build done **vẫn giữ** (nó là đường
  dẫn hữu ích khi card còn trên màn hình) nhưng giờ chỉ phát armHint.
- i18n key hết dùng sau khi xóa: `modeBackToAsk` (và `requestFix`/`requestFixHint` nếu
  terminal row rụng — kiểm lại lúc implement vì gate-foot vẫn dùng).
- Placeholder tách-theo-mode ở gate (`livePlaceholder`, App.tsx:404): thay bằng MỘT placeholder
  trung tính khi không armHint — đề xuất 「質問または変更依頼を入力…」(key mới `phAskOrChange`),
  armHint → `phChangeMode` như §3.2.

### 3.5 Tầng pure — `composer-route.ts`

Chữ ký đổi từ *state* sang *ý định per-send*:

```ts
composerTarget(task, intent: 'ask' | 'change'): 'start' | 'reply' | 'ask'
replyLabel(status, kind, intent, changeLabel): string | undefined
```

Bảng quyết định giữ NGUYÊN từng dòng (promote→reply, done+change→reply, done|cancelled→ask,
error→reply, change→reply, else ask) — chỉ nguồn của tham số đổi: trước là state dính, giờ là
nút nào được bấm. `send()` nhận thêm tham số `intent` và truyền thẳng xuống.

Một hệ quả phải pin bằng test: ở ngữ cảnh 1-nút, UI không có đường phát `intent:'change'` —
nhưng hàm pure vẫn phải trả lời đúng nếu bị gọi (ví dụ `cancelled + change → 'ask'` như dòng
hiện tại) để phòng UI tương lai nối sai.

## 4. Slices

### S1 — tầng pure + test (S)

`composer-route.ts` đổi chữ ký + `composer-route.test.ts` viết lại theo intent. Test phải
**đỏ-khi-revert**: case mới "error + intent:'ask' vẫn → reply" và "done + intent:'change' →
reply" phải fail nếu S2 lỡ nối UI mà quên truyền intent (tức intent bị default). Không đổi
hành vi — đây là refactor có lưới.

### S2 — composer hai nút + xóa state (M)

- `Composer` (Chat.tsx): prop `onSend` → `onSend(intent)`; render cụm 2 nút theo ma trận 3.3
  (prop mới, ví dụ `canChange: boolean`); phím tắt ⌘/Ctrl+Enter; CSS pill + rụng label khi hẹp.
- `App.tsx`: xóa `mode` + mode-row/terminal-row; `send(text?, intent)`; ba call-site Composer
  cập nhật; `armHint` thay `setMode('change')` tại 4 điểm arm (§1.2).
- i18n EN+JA: `phAskOrChange`, tooltip 2 nút; dọn key chết.
- Kiểm tay qua entry-point thật (bài học verification-discipline): chạy Builder thật, đủ 6 ô
  ma trận 3.3, gồm ca 409 turn-busy (giữ draft + armHint) và ca IME Enter tiếng Nhật.

### S3 — luồng arm + polish (S)

- Gate actions / Request-a-fix phát armHint; highlight + tan đúng §3.2.
- Đo ngưỡng rụng label; rà `store.test.ts`/UI test hiện có còn nhắc `mode`; cập nhật
  `docs/state/<doc chủ UI composer>` mô tả hành vi mới.

## 5. Non-goals

- **Không** làm classifier/heuristic đoán ý định từ nội dung tin nhắn (phương án 3 của thảo
  luận 2026-08-10). Chỉ cân nhắc lại NẾU sau khi ship còn quan sát được user gõ mệnh lệnh rồi
  bấm nút Hỏi — lúc đó nó là lưới đỡ trên nền per-message, không phải vá trên nền state dính.
- **Không** đụng route server (`/ask`, `/reply`, `/cancel`), không đổi wire format — 092 là
  client-only.
- **Không** đụng entry-mode consult|build (spec 082) ngoài việc (tuỳ chọn) đổi tên prop.
- **Không** thêm nút thứ ba nào khác vào cụm gửi (Retry của error gate vẫn nằm ở gate card).

## 6. Open questions (không blocker, chốt lúc implement)

1. Hình thức highlight của armHint (pulse một nhịp vs nền đậm giữ nguyên tới khi tan) — chọn
   theo cảm quan khi nhìn thật, không cần quyết trước.
2. `phAskOrChange` có làm placeholder dài quá ở khung hẹp không — nếu có, JA rút còn
   「質問 / 変更依頼…」.

## 7. Bảng nhà tri thức (cho /spec-close sau này)

| Mảnh | Nhà |
|---|---|
| Hành vi 2-nút + armHint (sau ship) | `docs/state/<doc chủ UI>` + CHANGELOG |
| Nguyên tắc "Enter luôn là hành động rẻ" + "ý định thuộc tin nhắn, không thuộc composer" | `docs/state/<doc chủ UI>` |
| Bài học 409-disarm (đã nằm ở comment App.tsx:238) | comment inline — đã có, kiểm còn đúng sau khi xóa mode |
| Nếu phát sinh ngõ cụt khi implement | `AGENTS.md §9` |
