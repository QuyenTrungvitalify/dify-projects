# Spec 103 — `SPEC.md` phải còn đúng sau vòng fix thứ N

**Status**: **L0 + S1 + bước 1 + bước 2 ĐÃ SHIP** (2026-08-20). **Làn B (L1) · S4 · S5 còn mở** — cố ý,
chờ số đo từ bước 2.
Lập 2026-08-20; sửa lớn cùng ngày sau một vòng kiểm chứng với code (§0).

> Đã ship: ③ hoà giải `SPEC.md` · tripwire `specStale` (hash, advisory) · cảnh báo ở gate ③ ·
> `snapshotDiffBase({restart})` · từ vựng một gốc từ (JA). Nhà tri thức: `docs/state/build-lifecycle.md`
> §8.1 + §12, `docs/state/ui-surface.md` §6.2a + §6.2b. Test: `test/spec-stale.test.ts` (17),
> `test/vocab-one-root.test.ts` (2), `web/src/gate-spec-stale.test.ts` (4),
> `web/src/lib/vocab-one-root.test.ts` (3).
>
> **Bug đã phát hiện + đã sửa sau khi ship (2026-08-20, do user hỏi đúng chỗ)**: chỉ thị hoà giải ban
> đầu chỉ nằm trong `implement.md` — mà prompt `/reply` **không mang thân skill body**, nên vòng fix
> (đường duy nhất L0 đo) **chưa từng nhận được chỉ thị nào**. Đã chuyển sang seam resume
> (`SPEC_RECONCILE`, `orchestrator.ts`) với điều kiện y hệt `specHashBefore`. Bài học vào
> `AGENTS.md §9` + `build-lifecycle.md §8.1`; bất biến **được-đo ⇔ được-dặn** ghim bằng
> `test/spec-reconcile-prompt.test.ts`.
>
> **Hệ quả ngoài dự tính của S1**: nút gate và pill composer giờ **cùng chữ** 「修正を依頼」 nhưng
> **khác hành vi** (nút *nạp đạn*, pill *bóp cò*). Trước S1 hai chữ khác nhau ít nhất còn gợi ý là hai
> thứ khác nhau. User bấm nút gate và báo *"không có gì xảy ra"* — đúng, vì nó chỉ đổi placeholder và
> làm sáng pill. §1.5 chưa chết, nó chỉ đổi hình. Việc chưa làm, cần một spec riêng.
>
> **Bước 1 (2026-08-20)** — chụp `SPEC.md` mỗi vòng fix (`spec-base.md`, một file, một tầng) ·
> `undoFixRound` lùi **cả vòng** (both-or-neither) · link 「この修正を取り消す」 ở **hàng link nhỏ**, KHÔNG
> phải nút thứ 5 (`破棄` và `取り消す` gần đồng nghĩa mà hậu quả lệch một trời — đặt cùng cỡ là tái diễn
> §1.5) · tab `差分` thêm mục 仕様 · route giữ **turn lock** xuyên suốt restore.
> Test: `test/undo-fix-round.test.ts` (10), `web/src/lib/undo-fix.test.ts` (9).
>
> **Bước 2 — ĐÃ GỠ (2026-08-20, cùng ngày).** Từng có caret + dòng probe 「仕様の修正案を先に作る」
> ghi `fix_propose_wanted` để đếm nhu cầu Làn B. Gỡ toàn bộ vì: (a) dòng probe ngang hàng trong menu
> chọn **hứa rằng bấm được**, user thật bấm 10 lần/20 giây tưởng nút hỏng — phép đo ghi lại sự bực bội
> chứ không phải nhu cầu; (b) dự án sắp mở cho nhiều người dùng, mà **fake door không được ship ra công
> chúng**. Quyết định Làn B từ nay dựa trên lý lẽ sản phẩm, không dựa trên 2 phiếu của một người.
>
> Kèm theo, phát hiện lớn hơn cho Làn B **khi có nhiều user**: đặt lựa chọn ở nút gửi là sai, vì nó bắt
> **mọi** người — kể cả người chưa biết "spec" là gì — trả lời một câu hỏi họ không trả lời được
> (§P1 nay đã có bằng chứng thực địa). Nếu xây, kích hoạt phải nằm ở pill `確認:` — bề mặt cài đặt mà
> người mới bỏ qua tự nhiên — chứ không nằm trên đường đi mặc định.

> **Còn nợ, đã biết**: tiếng Anh vẫn hai chữ (`Request a fix` / `Request changes`) — gộp được thì phải
> đổi chính label `gate.ts`, mà đó là **key** của `ACTION_JA`, tức đổi kiến trúc chứ không phải đổi
> display string. Sửa nửa vời chỉ dời chỗ lệch. Xem `ui-surface.md` §6.2a.

Sinh ra từ một câu hỏi vận hành của user: *"với 1 workflow rất dài, nhiều lần fix, mỗi lần fix có nên
tạo spec riêng (SPEC-FIX.md) không? hay luôn giữ 1 spec?"* — và câu trả lời hoá ra không nằm ở quy ước
đặt tên file, mà ở chỗ **không ai cập nhật `SPEC.md` trong vòng fix**, nên nó là write-once và bắt buộc
phải sai sau vòng fix đầu tiên.

Phạm vi: **vòng sửa sau khi build `完了`.** Hai tầng độc lập — **L0** (hồ sơ luôn khớp, XS) và **L1**
(cửa duyệt trước khi tiêu tiền, L) — cộng ba slice độc lập S1/S6/S5.

Không chạm: 4 phase của build mới, lint cap-5, import Dify, live test, ba mức `confirmMode`.
Liên quan: [092](092-composer-two-send-actions.md) (hai nút gửi — S1 sửa **chữ**, không sửa kiến trúc),
[094](094-gate-readability-and-fix-loop.md) (vòng fix đọc được — spec này nối tiếp, **và mượn thẳng cơ
chế `artifactHash` của 094 S1 làm nền cho L0**).

---

## 0. Bản này khác bản đầu ở đâu (2026-08-20)

Bản đầu gộp **hai tính năng độc lập** vào một spec 6-slice và để hở cơ chế trung tâm. Vòng kiểm chứng
với code tìm ra năm điểm chặn; bản này sửa cả năm.

| # | Bản đầu | Bản này |
|---|---|---|
| 1 | `fixes/*.md` **chỉ** delta (§2.3) **nhưng** `apply` → *"`SPEC.md` ← nội dung đề xuất"* (§3.3). Delta không copy đè lên spec được — cơ chế trung tâm bỏ trống. | **Đảo chiều**: ② sửa một bản SPEC **đầy đủ** (`SPEC.next.md`), máy **tự sinh** delta. `apply` = `rename()`. §3.6 |
| 2 | Quét secret bắt buộc, `by: <email>` bắt buộc → **tự triệt tiêu nhau** ở file đầu tiên. | Quét **chỉ khi path được track**; chỉ class `credential` mới chặn. Và L0 **không sinh file nào** → không cần quét. §3.7 |
| 3 | S1 sửa "EN/JA/**VI**" | **VI không tồn tại** — `Lang = 'en' \| 'ja'`. Bỏ VI. §S1 |
| 4 | *"gate.ts: gate `fix_proposal`"* — `computeGate` là hàm **thuần**, chỉ biết `phase`, không có đường nào biết "② lần này là revise". | Thêm `fix_proposal` vào `GateVerify.outcome`, đúng khuôn `still_failing`. §3.8 |
| 5 | Bảng routing ④ thiếu `infra_degraded` (biến thể thứ **năm** có `Request changes`). | Bảng đủ năm dòng. §3.8 |
| 6 | Coi *"vòng fix bỏ qua ②"* là nguyên nhân gốc, nên **mọi** giải pháp đều phải đi qua ②. | Nguyên nhân gốc hẹp hơn: **không ai ghi lại**. Đi qua ② là **một** cách; ③ tự ghi là cách kia, rẻ hơn ~20 lần. Tách thành L0/L1. §3 |

**Một tiền đề đã sụp**: §7 Q4 bản đầu chốt *"`fixes/` commit vào git"*.

| Nhãn | Bằng chứng |
|---|---|
| `[ĐO]` | [`.gitignore:62`](../../.gitignore) — `projects/_drafts/` bị ignore **WHOLESALE**. |
| `[ĐO]` | `git ls-files projects/ \| wc -l` → **1** (chỉ `.gitkeep`). `ls projects/_drafts \| wc -l` → **18**. |
| `[ĐO]` | [`post-turn.ts:60`](../../apps/builder/server/lib/post-turn.ts) đã ghi đúng điều này thành comment khi giải thích vì sao 094 S1 dùng content-hash chứ không dùng git. |

Tức là **18/18 build đang tồn tại đều không được commit**. Chuỗi ràng buộc "vào git vĩnh viễn → phải
quét secret" bảo vệ một ca **chưa xảy ra**, trong khi chặn ca **đang xảy ra**.

---

## 1. Bối cảnh

### 1.1 Sự cố nguồn — một workflow thật đã drift, và user tự vá bằng tay

Dự án `projects/_drafts/build_requirement_news_automation_2/`:

| Nhãn | Sự việc |
|---|---|
| `[ĐO]` | `SPEC.md` — 175 dòng, sửa lần cuối **2026-08-12**, tự xưng là `rev.7`. |
| `[ĐO]` | `SPEC-FIX.md` — 582 dòng, **2026-08-19**, user viết tay. Dòng 1 tự đặt tên là **「SPEC hiện hành」**, dòng 3 ghi *"Yêu cầu gốc nằm ở `SPEC.md` (rev.7)"*. |
| `[ĐO]` | `SPEC-FIX.md` §13 là bảng **13 dòng** liệt kê "Khác biệt so với rev.7" — drift đã lớn tới mức phải lập bảng đối chiếu. |
| `[ĐO]` | 15/16 project khác trong `_drafts/` chỉ có một `SPEC.md`. Đây là project duy nhất phải đẻ file thứ hai. |

> **Tri thức trong file đó đã được cứu (2026-08-20)** trước khi user xoá data để test lại. 8/11 ràng
> buộc kỹ thuật được chuyển nhà (`AGENTS.md §9`, `implement.md`, `references/error-strategy.yml`), 3 cái
> đã có sẵn. Phát hiện kèm theo: `templates/patterns/chatwork-1-10-20.yml` **đang dạy** `datetime.utcnow()`
> — chính cái giết node — trong khi `AGENTS.md` đã ghi luật đúng từ 2026-07-13. Pattern đã được sửa.
> Đây là bằng chứng cho nguyên tắc 2.3 ở tầng khác: tri thức nằm sai nhà thì **out-teach** cả tài liệu đúng.

Người dùng không làm sai. **Hệ thống buộc họ phải làm vậy** — không có chỗ nào để cái sửa đó đi vào.

### 1.2 Nguyên nhân gốc — bất biến bị phá

Bất biến lẽ ra phải giữ: **`main.yml` là hàm của `SPEC.md`.**

Sau một fix free-text nó thành `f(SPEC.md, fix₁, fix₂, …)`, với các `fixᵢ` **chỉ sống trong chat**.

| Nhãn | Bằng chứng |
|---|---|
| `[ĐO]` | [`orchestrator.ts:258`](../../apps/builder/server/lib/orchestrator.ts) — mọi "Request changes" ở gate ④ **và** trên build `done` gọi `runPhaseAndGate(task, 'implement', …)`. |
| `[ĐO]` | [`implement.md:127`](../../.claude/skills/dify-build/implement.md) — ③ **đọc** `SPEC.md` (*"source of truth for what to build"*), dòng 30 *"Re-read it fresh"*. **Không có chỉ thị ghi.** |
| `[ĐO]` | `spec.md` skill không có nhánh nào cho "revise một spec đã có" (grep `revise/existing/update` → 0 hit). |
| `[ĐO]` | Không tồn tại cơ chế lịch sử/phiên bản spec nào trong `apps/builder` (grep `specHistory\|spec-history` → 0 hit). |

Chỉ có **hai** cách phục hồi bất biến, và spec này làm cả hai theo thứ tự:

| | Cách | Ai ghi `SPEC.md` | Chi phí |
|---|---|---|---|
| **L0** | ③ hoà giải `SPEC.md` **trong chính lượt của nó** | ③ | **XS** — không thêm lượt, không đổi route |
| **L1** | Sửa `SPEC.md` **trước** khi ③ chạy, có người duyệt | ② → `apply` | **L** — thêm một lượt ②, gate mới, UI mới |

> **Bản đầu chỉ thấy L1.** Nó đặt L0 xuống làm "đường nhanh phụ" (§3.3b cũ) trong khi L0 mới là nền:
> L0 đóng drift trên **mọi** đường (kể cả `still_failing`, kể cả `auto`, kể cả free-text hôm nay), còn
> L1 chỉ đóng drift trên đúng đường nó kiểm soát.

### 1.3 L1 không tiết kiệm tiền — nó tốn thêm. Ghi rõ để định giá đúng.

Bản đầu bán L1 như một tính năng **đúng đắn**. Không phải. ② cũng là một lượt.

```
Đường duyệt (L1):  turn② (viết đề xuất)  +  turn③ (implement)
Đường thẳng (L0):                            turn③ (implement)
```

Giá trị của L1 là **không phí một ③ đắt cho một hiểu lầm** — với build 52 node thì đáng, với chỉnh
ngưỡng `0.5 → 0.2` thì thuần overhead. Đó là một tính năng **kiểm soát chi phí cho build lớn**, không
phải một tính năng đúng-sai. Định giá đúng thì thứ tự ưu tiên tự lộ ra: **L0 trước, L1 sau, và chỉ khi
dùng thật thấy cần.**

### 1.4 Hệ quả thứ hai — người dùng tạo project mới thay vì sửa

Đếm `projects/_drafts/` sau khi bỏ hậu tố số:

```
4 ng_quy_tr_nh          2 build_requirement_news_automation
2 tsv_webhook_url_wf    2 app2_build_requirement_news
```

| Nhãn | Sự việc |
|---|---|
| `[ĐO]` | 18 thư mục, nhưng chỉ ~8 workflow phân biệt. **Nửa số thư mục là bản đánh số của chính nó.** |
| `[GIẢ THUYẾT]` | Nguyên nhân là "sửa không tới đâu nên làm lại từ đầu". Chưa có transcript nào chứng minh trực tiếp — nhưng nó khớp với 1.2, và §3.9 thiết kế một lối thoát rẻ hơn cho ca này thay vì cấm đoán. |

### 1.5 Hệ quả thứ ba — hai chữ cho cùng một việc, cùng lúc trên một màn hình

| Nhãn | Bằng chứng ([`web/src/lib/i18n.ts`](../../apps/builder/web/src/lib/i18n.ts)) |
|---|---|
| `[ĐO]` | `:748` `modeChange: '変更を依頼'` — pill ở composer |
| `[ĐO]` | `:813` `requestFix: '修正を依頼'` — nút trên card của build đã xong |
| `[ĐO]` | `:1035` gate action `Request changes → '変更を依頼'`; `:1037` `Edit spec → '仕様を編集'` |
| `[ĐO]` | Trên build `done`, `terminalFootActions().requestFix` và pill `composerTarget(done,'change')` **cùng render**. Người dùng thấy 「修正を依頼」 và 「変更を依頼」 cạnh nhau, cùng nghĩa. |

Cơ chế thì không trùng — nút gate **nạp đạn** (`replyButtonKind → 'arm'`), pill **bóp cò**. Nhưng
người dùng không đọc được sự phân công đó từ hai chữ khác nhau.

### 1.6 Thiết kế ĐÃ BỊ LOẠI — ghi lại để không ai đề xuất lại

**(a) "Mỗi vòng fix một file `SPEC-FIX-<n>.md`."** Loại vì:

- Câu hỏi lúc vận hành chỉ có một: *"hôm nay nó chạy thế nào?"* — N file bắt đọc N file theo đúng thứ
  tự rồi tự hợp nhất trong đầu. Chi phí đọc tăng theo số lần fix, trong khi thứ cần biết không đổi.
- Mỗi node bị mô tả ở nhiều nơi, không nơi nào là chuẩn.
- Chính `SPEC-FIX.md` của user đã chứng minh: nó mô tả **toàn hệ thống** nên cạnh tranh vai trò với
  `SPEC.md` — và thắng. `SPEC.md` thành rác.

**(b) "② viết một tài liệu delta, `apply` dựng lại `SPEC.md` từ delta."** — thiết kế của **chính bản
đầu spec này**, loại 2026-08-20. Delta không copy đè lên spec được; muốn dựng lại phải hoặc tốn thêm
một lượt merge (phá luôn lập luận chi phí), hoặc phẫu thuật chuỗi trên khối `前/後` (vỡ ở ca đầu). Và
nó bắt model học một **format mới** trong khi nó đã biết viết `SPEC.md` rất tốt — một failure mode
mới, đổi lấy không gì cả. §3.6 đảo chiều: model viết **sự thật mới**, máy **suy ra** delta.

Cả hai bài học rút thành nguyên tắc §2.3.

---

## 2. Nguyên tắc thiết kế

**2.1 · Bất biến là `main.yml = f(SPEC.md)`, không phải "spec phải đi qua ②".** Mọi thiết kế được đo
bằng nó. Route qua ② là *phương tiện*, không phải mục tiêu — nhầm hai cái là lý do bản đầu bỏ lỡ L0.

**2.2 · Người dùng không bao giờ thấy tên file.** Ba lớp tài liệu vẫn nằm trên đĩa nhưng do Builder
sinh và đọc. Trên màn hình chỉ có tab, pill và nút. Người dùng của bản sạch *"vốn dĩ không hiểu nhiều
về builder, họ chỉ nhìn màn hình và làm theo"* — nên bất kỳ thiết kế nào bắt họ quản lý file là hỏng.

**2.3 · `SPEC.md` = hiện trạng. Hồ sơ thay đổi = CHỈ delta — và phải do MÁY sinh.** Bản đầu ghi luật
này rồi giao cho model tuân thủ. Luật nào cần người/model nhớ thì sẽ bị phá. Hồ sơ do máy suy ra từ
`diff(SPEC.md, SPEC.next.md)` **không thể** phình thành đối thủ toàn cảnh của `SPEC.md`, và **không
thể nói dối** về nội dung thay đổi.

**2.4 · Hồ sơ đã áp dụng thì khoá.** Sửa được một fix `applied` thì hồ sơ nói dối. Read-only.

**2.5 · Bỏ được CỬA DUYỆT, không bỏ được HỒ SƠ.** "Không cần duyệt" nghĩa là *không cần dừng hỏi*,
không bao giờ nghĩa là *không ghi lại*. **L0 chính là nguyên tắc này tổng quát hoá thành mặc định.**

**2.6 · Phát hiện được ≠ ngăn được — và phải nói rõ mình đang làm cái nào.** L0 làm cho vi phạm
**hiện ra** (§3.3); chỉ phép `rename()` của L1 mới làm nó **bất khả thi**. Spec này không được viết
"đảm bảo" ở chỗ chỉ có "phát hiện". Xem §3.4 để biết vì sao không chọn chặn cứng.

**2.7 · Một `提案中` tại một thời điểm.** Bất biến của L1, phải **cưỡng chế** chứ không hy vọng (§3.9).

**2.8 · Không tự chạy một lượt tốn tiền dựa trên phỏng đoán.** Máy được phép **đoán ý định và mời**;
người quyết định có tiêu tiền hay không. Đoán sai mà tự chạy tệ hơn đoán sai mà hỏi.

**2.9 · Một gốc từ cho một việc.** Xem S1.

---

## 3. Thiết kế

### 3.1 Hai tầng

```
L0  (luôn bật, mọi đường)
    ③ sửa main.yml  →  ③ VIẾT LẠI SPEC.md cho khớp  →  ④
                       ↑ badge nếu nó quên

L1  (opt-in, chỉ khi muốn duyệt trước)
    ② sửa SPEC.next.md  →  gate fix_proposal  →  apply = rename()  →  ③  →  ④
       ↑ backend cp SPEC.md trước               ↑ SPEC.md chưa từng bị đụng
```

L0 đứng một mình đã đóng sự cố §1.1. L1 nằm **trên** L0, không thay thế.

---

## L0 — Hồ sơ luôn khớp (không đổi route, không thêm lượt)

### 3.2 ③ hoà giải `SPEC.md`

[`implement.md`](../../.claude/skills/dify-build/implement.md) thêm **một bước cuối**: sau khi `main.yml`
đã lint sạch, cập nhật `SPEC.md` cho khớp workflow vừa có.

Ba ràng buộc, và cả ba đều load-bearing:

1. **Viết HIỆN TRẠNG, không viết NHẬT KÝ.** Chỉ thị phải là *"`SPEC.md` mô tả workflow đang có"*,
   tuyệt đối không phải *"ghi lại bạn vừa đổi gì"*. Đắp thêm chính là bệnh `SPEC-FIX.md` (§1.1) tái
   sinh ở tầng khác — lần này do máy tự gây ra, mỗi vòng một lần.
2. **Nhật ký đi riêng, ở cuối file, mỗi vòng một dòng.** Một bảng `## 変更履歴` append-only:
   `| 2026-08-19 | 中国語の記事を除外する言語フィルタを追加 | task 1786966632804 |`. Nó là *chỉ mục*,
   không phải *nội dung* — nội dung nằm ở thân spec đã viết lại.
3. **Không đụng ngôn ngữ.** `SPEC.md` theo ngôn ngữ của requirement, đúng luật `Output language` đã có
   trong `implement.md` (`:50`) và `spec.md`. Không phát minh luật mới.

**Quyền ghi đã có sẵn** — không cần làm gì thêm:

| Nhãn | Bằng chứng |
|---|---|
| `[ĐO]` | [`post-turn.ts:379`](../../apps/builder/server/lib/post-turn.ts) — whitelist confinement là `projects/<project>/<workflowSlug>/`. `SPEC.md` nằm trong đó. ③ ghi nó **hôm nay đã hợp lệ**. |
| `[ĐO]` | [`ui.ts:274`](../../apps/builder/server/routes/ui.ts) `PUT /api/tasks/:id/spec` — người dùng **đã** sửa tay được `SPEC.md` từ panel, và `implement.md:30` đã lường trước (*"a human may…"*). Ghi từ ③ không phá giả định nào đang có. |

### 3.3 Tripwire — mượn nguyên cơ chế 094 S1

094 S1 đã dựng sẵn đúng thứ cần, cho `main.yml`. L0 dùng **lần thứ hai**, cho `SPEC.md`:

| Nhãn | Mảnh có sẵn |
|---|---|
| `[ĐO]` | [`post-turn.ts:75`](../../apps/builder/server/lib/post-turn.ts) `artifactHash(projectsDir, rel)` — sha256 một file repo-relative. |
| `[ĐO]` | `post-turn.ts:51` `artifactHashBefore` · `:121` `artifactChanged` — *"did this turn change the file at all?"* |
| `[ĐO]` | [`orchestrator.ts:494`](../../apps/builder/server/lib/orchestrator.ts) chụp hash **trước** turn ③ · `:723` gấp kết quả lên `task.artifactUnchanged`. |
| `[ĐO]` | Dùng content-hash chứ **không** dùng git là bắt buộc: `projects/_drafts/` gitignore wholesale nên `gitDirtyPaths` mù với mọi ghi ở đó (`post-turn.ts:60`). |

Thêm vào, đối xứng từng dòng:

- `specHashBefore` chụp cùng chỗ `artifactHashBefore` được chụp (`orchestrator.ts:494`).
- `PostTurnDetail.specChanged`, tính cùng chỗ `artifactChanged` được tính (`post-turn.ts:270`).
- `task.specStale = artifactChanged === true && specChanged === false`.

Giữ nguyên hợp đồng "không đo thì không đoán" của 094: `undefined` ⇒ *chưa đo*, và `specStale` ở
`undefined` — **không bao giờ** suy ra "không đổi" từ một phép đo vắng mặt.

### 3.4 `specStale` là BADGE, không phải lỗi — và vì sao

Ở gate ③, khi `specStale`: một dòng cảnh báo cạnh badge `artifactUnchanged` đã có, cùng một vệt UI.

```
⚠ ワークフローは変わりましたが、仕様書は更新されていません
```

**Không** `reasons.push` (sẽ thành `status: error`), **không** gate variant mới. Ba lý do:

- Giết một build `main.yml` **đã lint sạch** vì một dòng sổ sách là đắt hơn cái nó bảo vệ.
- Chặn cứng ⇒ retry ⇒ thrash. Bài học 085 (thrash ở ③) mua bằng tiền thật, không mua lại lần nữa.
- Badge **đo được**: sau khi ship, đếm event `spec_stale` trong `.runs/<taskId>/events.jsonl`
  (KHÔNG phải `chat.jsonl` — đó là transcript của Ask). Đó là con số nói cho ta
  biết `implement.md` có làm được việc không — và nếu tỉ lệ cao thì mới là lúc bàn chuyện chặn cứng,
  với dữ liệu trong tay thay vì phỏng đoán.

> **Nói thẳng theo nguyên tắc 2.6**: L0 làm cho drift **hiện ra**, không làm nó **bất khả thi**.
> Bảo đảm đến từ `implement.md`; badge là dây bẫy báo khi bảo đảm đó hụt. Chỉ `rename()` của L1 mới
> là bảo đảm cấu trúc, và chỉ trên đúng đường L1 kiểm soát.

### 3.5 L0 không cần gì trong số này

Ghi ra để thấy nó rẻ tới mức nào: **không** route change · **không** gate mới · **không** thư mục mới
(nên §7 Q1 *không chặn L0*) · **không** file mới (nên **không** cần quét secret) · **không** UI mới
ngoài một dòng chữ · **không** đụng `computeGate` · **không** carve-out `confirmMode`.

---

## L1 — Cửa duyệt trước khi tiêu tiền (chỉ làm khi dùng thật thấy cần)

### 3.6 Cơ chế — `SPEC.next.md`, và máy suy ra delta

> Đây là chỗ bản đầu bỏ trống (§1.6b). Chiều đúng: **model viết sự thật mới, máy suy ra bản ghi.**

```
backend:  cp SPEC.md → SPEC.next.md          ← turn chỉ phải emit HUNK đã đổi, không rewrite 37KB
②     :  sửa SPEC.next.md tại chỗ
backend:  delta = unifiedDiffOfFiles(SPEC.md, SPEC.next.md)
gate   :  hiện 変更点 (lời chat của ②) + delta (máy tính)
apply  :  rename(SPEC.next.md → SPEC.md)  +  ghi bản ghi vào fixes/  +  ③
見送る :  rename(SPEC.next.md → fixes/<date>-<nn>.rejected.md)
```

Được gì, so từng điểm với bản đầu:

| | |
|---|---|
| ② làm **đúng việc nó đã biết làm** — viết một `SPEC.md`. Không format mới, không failure mode mới. |
| Vì là bản copy có sẵn, turn chỉ emit hunk đã đổi (Edit) → **rẻ ngang viết delta**, không phải rewrite cả file. |
| `SPEC.md` không bị đụng **do cấu trúc** — nên AC L1-2 (byte-identical) là **tính chất**, không phải hy vọng. Bản đầu để hở đúng chỗ này: turn ② có full quyền ghi trong workflow dir (`post-turn.ts:379`), không gì ngăn nó sửa `SPEC.md`, mà cả spec dựng trên việc nó không sửa. |
| `[ĐO]` Khối `仕様の差分` = [`unifiedDiffOfFiles`](../../apps/builder/server/lib/diff.ts) (`diff.ts:76`) — **đã có sẵn**, hai đường dẫn tuyệt đối, miễn phí. Và nó **không thể nói dối**; khối `前/後` do model viết thì có thể. |
| `apply` = `rename()`. Cơ học, **không tốn lượt**. |
| `artifactRel` = `SPEC.next.md` → backend biết tên file **trước** turn, verify `stat` như mọi phase khác. Đúng bài học 090 S4 mà [`phases.ts:33`](../../apps/builder/server/lib/phases.ts) chép lại: *"the agent is handed a value, never a condition"*. Bản đầu để model tự nghĩ ra `<slug>` từ tiêu đề — mà `artifactRel` chính là thứ verify stat. |
| Nguyên tắc **2.3 thành enforced-by-construction**: bản ghi do máy sinh nên không thể phình thành đối thủ toàn cảnh. Đó chính là bài học §1.6a — thiết kế này làm nó **bất khả phá**, thay vì một luật phải nhớ. |

Thứ mất đi: đoạn văn "vì sao" do model viết trong file delta. `変更点` (3–6 gạch) + `依頼` nguyên văn
đã phủ, và cả hai vào bản ghi.

### 3.6b Cú ③ SAU khi duyệt — lỗ dễ vấp nhất của Làn B

> Ghi trước khi implement, vì nó là loại lỗ chỉ lộ ra sau khi đã sai.

② viết spec mà **chưa từng đụng thực tế Dify** — lint, schema node, plugin hash chỉ bắn ở ③. Nên ③
hoàn toàn có thể **không xây được** đúng thứ vừa được người duyệt:

```
SPEC.md (đã duyệt) nói X   →   ③ thấy X không làm được   →   xây X′
```

Phản xạ đầu tiên là tắt cả cờ lẫn chỉ thị sau `apply` (để ③ khỏi ghi đè bản spec người vừa duyệt).
**Sai** — và sai theo hướng đắt nhất: `SPEC.md` = X, `main.yml` = X′, không ai sửa, không ai báo, mà
spec lại mang dấu *"người duyệt rồi"* nên ai đọc cũng tin.

| | Sau `apply` |
|---|---|
| Cờ `specStale` | **TẮT** — `SPEC.md` đổi do `rename` **trước** turn, nên `specHashBefore` chụp sau đó ⇒ cờ báo động giả 100% |
| Chỉ thị | **GIỮ, đổi lời**: *"spec này người vừa duyệt. Nếu không xây được đúng như thế, KHÔNG lặng lẽ làm khác — sửa spec cho khớp thứ bạn thật sự xây, và nói rõ chỗ nào lệch, vì sao."* |

Tắt cờ **không** đồng nghĩa với tắt trách nhiệm.

### 3.7 Bản ghi `fixes/<YYYY-MM-DD>-<nn>.md` — do BACKEND ghi

Tên file **backend sinh**, đánh số trong ngày (`-01`, `-02`) → không có bài toán slug collision, không
cần model đặt tên. Tiêu đề người đọc nằm **trong** file.

```markdown
---
date: 2026-08-19
status: applied           # applied | rejected
task: 1786966632804
by: quyenbt@vitalify.jp
target: _drafts/build_requirement_news_automation_2
speed: reviewed           # reviewed (qua L1) | quick (chỉ L0)
---

# 中国語の記事が候補に混入する

## 依頼
「中国語のニュースが混ざる。日本語だけにしたい」   ← NGUYÊN VĂN, không diễn giải

## 変更点                    ← lời ② nói ở gate, 3–6 gạch, mỗi gạch một câu
1. 受信後にかな判定で日本語以外を除外
2. 優先ドメインは判定を免除
3. スコアしきい値 0.5 → 0.2

## 仕様の差分                ← MÁY SINH, unifiedDiffOfFiles. Không ai gõ tay.
@@ § 6. 受信後のフィルタ @@
- スコア < 0.5 を除外
+ スコア < 0.2 を除外／かな無しを除外（優先ドメインは免除）
```

`変更点` **3–6 gạch**: đây là thứ 90% người dùng đọc và là toàn bộ cơ sở để họ bấm nút — dài hơn thì
không ai đọc, và cửa duyệt thành nghi thức.

**`by:` ngay từ đầu** dù giai đoạn này một máy một người: lúc lên product mà thiếu nó thì cả lịch sử
sửa chữa không biết ai duyệt cái gì, và thêm sau phải sửa mọi file cũ.

`rejected` **giữ lại**, không xoá: *"đã cân nhắc và quyết định không làm"* là tri thức mọi đội đều
đánh mất rồi 6 tháng sau bàn lại từ đầu.

**Quét secret — có điều kiện, không mặc định.** Bản đầu bắt quét mọi file, đồng thời bắt mọi file có
`by: <email>`. Hai luật đó tự triệt tiêu nhau ở file đầu tiên:

| Nhãn | Bằng chứng |
|---|---|
| `[ĐO]` | [`promote_gate.py:177`](../../tools/dify_base/promote_gate.py) `share_scan_text` báo finding cho **mọi email không phải `@example.com`** (`"email address"`) và **mọi URL ngoài allowlist** (`"non-placeholder url"`). |
| `[ĐO]` | Docstring của chính nó: *"Advisory — callers must not turn this into a block."* |
| `[ĐO]` | `share.ts:129` `sharePreflight` gọi CLI bằng **đường dẫn file** — mà file do turn ghi, nên *"quét trước khi ghi"* không khả thi như bản đầu viết. |

Luật thay thế, ba dòng:

1. Chỉ quét khi path **thật sự được track** (`git check-ignore` → không ignore). `_drafts/` là bản
   nháp dùng-một-lần, không vào git, không có gì để rò rỉ vĩnh viễn.
2. Chỉ class **`credential`** (bearer / `api_key=` / `sk-`/`AKIA`/`ghp_`) mới **chặn**. `url` và
   `email` là **cảnh báo** — `依頼` là lời user nguyên văn về một workflow tin tức; user sẽ dán URL vào
   đó thường xuyên, và chặn vì URL là một doom-loop.
3. Quét **sau khi backend ghi, trước khi commit**, không phải "trước khi ghi".

### 3.8 Routing — điều kiện đọc `gate.flag`, KHÔNG đọc `status`

`[ĐO]` [`orchestrator.ts:258`](../../apps/builder/server/lib/orchestrator.ts) — điều kiện hiện tại là
`(status==='awaiting_confirm' || status==='done') && sessionIds.implement`. **Cả năm** biến thể của ④
đều park ở `awaiting_confirm`, nên điều kiện theo `status` sẽ kéo luôn `still_failing` qua ② — bắt
người dùng duyệt một "đề xuất sửa spec" cho một lỗi lint.

| flag ở ④ | "修正を依頼" nghĩa là | Đi đâu |
|---|---|---|
| `still_failing` (lint đỏ) | sửa lỗi kỹ thuật trong YAML | **③ thẳng** — spec không đổi |
| `awaiting_import` | đổi workflow trước khi import | ② |
| `test_result` | hành vi sai | ② |
| `infra_degraded` | hành vi sai (live không chạy được vì hạ tầng, **không phải** vì workflow) | ② |
| (`done`, không flag) | fix sau import | ② |

`infra_degraded` là biến thể **thứ năm**, bản đầu bỏ sót ([`gate.ts:290`](../../apps/builder/server/lib/gate.ts)
— nó cũng mang `REPLY('changes')`). Nó đi ② vì lỗi hạ tầng không làm workflow đúng lên; người bấm
"修正を依頼" ở đó vẫn đang muốn đổi hành vi.

**Gate `fix_proposal` vào bằng đường nào.** `[ĐO]` [`gate.ts:185`](../../apps/builder/server/lib/gate.ts)
`computeGate(phase, verify, deploy, targets)` là hàm **thuần** và chỉ biết `phase` — không có đường nào
để nó biết "② lần này là revise". Bản đầu chỉ ghi *"gate.ts: gate `fix_proposal`"* mà không nói bằng
cách nào.

→ Thêm `fix_proposal` vào **`GateVerify.outcome`**, đúng khuôn `still_failing` / `awaiting_import` /
`test_result` đang dùng. Giữ hàm thuần; không đọc task-state bên trong nó.

**Hard-stop kể cả `confirmMode: auto`.** `[ĐO]` `boundaryAutoAdvances` (`orchestrator.ts:369`) cho
`auto` vượt mọi cửa; `orchestrator.ts:341-344` hard-stop theo `gate.flag`. Thêm dòng thứ năm cho
`fix_proposal` — cả L1 dựng lên là để có người duyệt.

### 3.9 Gate `fix_proposal`, cảnh báo vượt phạm vi, bất biến một-đề-xuất

```
┌─ 修正案ができました ─────────────────────────┐
│ 中国語の記事が候補に混入する                  │
│  1. 受信後にかな判定で日本語以外を除外        │
│  2. 優先ドメインは判定を免除                  │
│  3. スコアしきい値 0.5 → 0.2                  │
│                            [ 詳細を見る ]     │
│ ┌─────────────────┐┌──────────┐┌────────┐    │
│ │この内容で修正する││説明を直す││ 見送る │    │
│ └─────────────────┘└──────────┘└────────┘    │
└───────────────────────────────────────────────┘
```

`変更点` mang lên **gate card**, không chỉ nằm trong panel: hai trong ba nút không cần gõ gì, nên
người dùng quyết được mà không phải rời khu vực hội thoại.

| Action | kind | Hệ quả |
|---|---|---|
| `apply` | confirm | `rename(SPEC.next.md → SPEC.md)` · ghi `fixes/…` `applied` · chạy ③ |
| `changes` | reply | ② chạy lại có góp ý; vẫn chỉ sửa `SPEC.next.md`; `SPEC.md` vẫn chưa đụng |
| `reject` | confirm | `rename(SPEC.next.md → fixes/….rejected.md)`. **Không đụng gì khác.** |
| `as_new` | confirm | tách thành workflow mới — luôn có mặt, cỡ chữ phụ |

**Cảnh báo vượt phạm vi.** ② đã đọc `SPEC.md` + `main.yml` nên nó **biết** yêu cầu có nằm trong phạm
vi không. Khi không — đảo thứ tự nút:

```
╔═══════════════════════════════════════════════════╗
║ ⚠ この修正は今のワークフローの範囲を超えています   ║
║  「HTML を生成する」は APP2 の役割です。          ║
║  [ 別のワークフローとして作る ]   それでも入れる  ║
╚═══════════════════════════════════════════════════╝
```

Khuyến nghị đặt ở chỗ **có bằng chứng** (sau khi đã thấy `変更点`), không bắt chọn trước lúc chưa biết
gì — chọn sai lúc đó chính là §1.4.

**Cưỡng chế 2.7.** Đang có `SPEC.next.md` mà người dùng đòi sửa tiếp → trỏ về cái đang chờ:

```
┌────────────────────────────────────────────┐
│ 修正案がまだ 1 件 未確定です。               │
│ 先にそちらを決めてください。                 │
│         [ 修正案を見る ]                    │
└────────────────────────────────────────────┘
```

> **Đường L0 cũng phải bị chặn ở đây.** Bản đầu chỉ chặn nhánh `修正案`. Nhưng một fix đi thẳng ③ sẽ
> ghi `SPEC.md` **dưới chân** một `SPEC.next.md` đang chờ, làm delta của nó tính so với một spec không
> còn tồn tại. Khi có đề xuất treo, **cả hai** lối đều bị chặn.

### 3.10 Strip chọn bản trong tab `仕様`

Thay đúng chuỗi literal `SPEC.md` đang là **chữ chết** ở
[`ArtifactPanel.tsx:218`](../../apps/builder/web/src/components/ArtifactPanel.tsx) — không thêm một
pixel chrome nào:

```
┌ 現在 ┐┌ 提案中 ●┐┌ 08-18 ┐┌╌08-14╌┐→     プレビュー 編集 分割
└──────┘└═════════┘└───────┘└╌╌╌╌╌╌╌┘
  ghim    chờ duyệt   applied   rejected
```

- `現在` **ghim trái**, không cuộn mất — luôn có đường về.
- Lịch sử mới→cũ sang phải; cuộn ngang bằng đúng pattern `.chat-top-right`
  ([`surface-blocks.css:509`](../../apps/builder/web/src/styles/surface-blocks.css) —
  `overflow-x:auto; scrollbar-width:none`). **Không dùng `flex-wrap`** (làm vỡ layout hàng chip, đã
  từng xảy ra ở composer).
- `rejected` viền đứt + mờ. Hover → tooltip tiêu đề đầy đủ.
- Có `提案中` → dot trên pill **và** trên tab `仕様`, dùng lại đúng từ vựng dot của `main.yml`
  (`ArtifactPanel.tsx:424`), không phát minh ký hiệu mới.

Banner khi không ở `現在`:

```
📌 2026-08-14 の修正（見送り） — 現在の仕様ではありません
```

Quyền theo trạng thái (nguyên tắc 2.4):

| Chọn | Chế độ | Nút |
|---|---|---|
| `現在` | プレビュー / 編集 / 分割 | 保存 |
| `提案中` | プレビュー / 編集 | この内容で修正する · 説明を直す · 見送る |
| `applied` / `rejected` | **プレビューのみ** | 書き出し · 再開 |

Tab `履歴` riêng **đã bị loại**: hàng tab trên cùng phân theo *loại tài liệu* (仕様/yml/差分/レポート),
còn lịch sử là *các phiên bản của chính 仕様*. Đặt ngang hàng là trộn hai trục phân loại.

> **S3 là điều kiện để L1 dùng được, không phải trang trí.** Bản đầu nói S2 "ship một mình đã có giá
> trị" nhưng chỗ duy nhất xem được đề xuất lại nằm ở S3, còn tab `仕様` vẫn hiện `SPEC.md` chưa đụng —
> `詳細を見る` bấm vào hư không. Bản này gộp: **L1 = gate + strip**, không tách.

### 3.11 Thẻ nhận diện ý định

`[ĐO]` Lượt Ask đã đọc sẵn `SPEC.md` + `main.yml` + `report.json` (`ask.ts:737-785`, `buildAskSeed`) và
**read-only** (hook chặn mọi ghi file, kèm backstop snapshot/restore `restoreAndDiff`). Nó đã có đủ bối
cảnh để tự phân loại — **không tốn thêm lượt nào**.

Ask emit một trailer có cấu trúc; server bóc khỏi text trước khi hiển thị (cùng cơ chế
`truncationNotice`, `ask.ts:52`, ngược chiều):

```json
{"intent":"fix","summary":"中国語の記事を除外する言語フィルタを追加","confidence":"high"}
```

`intent`: `fix` | `question` | `new_build`. Chỉ render thẻ khi `intent==='fix'` và `confidence==='high'`.

```
┌──────────────────────────────────────────────────┐
│ こういう修正ですね:                               │
│ 中国語の記事を除外する言語フィルタを追加          │
│                                                  │
│  [ すぐ直す ]      修正案を作って確認する         │
│  今の仕様は変更しません。案を見てから決められます  │
└──────────────────────────────────────────────────┘
```

Hai nút = hai tầng: `すぐ直す` → L0 (③ thẳng), `修正案を作って確認する` → L1. **② khuyến nghị bằng thứ
tự**, người dùng **luôn** bấm được cái kia. Nhỏ → `すぐ直す` trước; lớn / vượt phạm vi → `修正案` trước.

**Neo vào TIN NHẮN, không vào gate-foot.** Một build `done` có một gate-foot nhưng nhiều câu trả lời
Ask; thẻ mang `summary` chưng cất từ **chính câu trả lời đó**; luật "đã bỏ qua thì không hiện lại cho
cùng `summary`" cần danh tính theo tin nhắn; cuộn ngược lên vẫn thấy các lời mời cũ đúng ngữ cảnh.

Nhãn `修正案` — chữ **案** làm toàn bộ công việc: nó nói "dự thảo", không nói "đã sửa". Dòng micro-copy
dưới nút mới là thứ thật sự giết nỗi sợ: nó nói thẳng **chưa có gì bị đổi**.

| Nhãn | Rủi ro |
|---|---|
| `[GIẢ THUYẾT]` | Trailer phân loại đủ chính xác để thẻ hữu ích. **Chưa đo.** |

Thiết kế sao cho đoán sai **không mất gì**: nhầm thành `question` → thẻ không hiện → người dùng dùng
pill như hôm nay (§3.12 giữ pill làm van an toàn). Nhầm thành `fix` → thẻ hiện, người dùng lờ đi.
**Không lượt tốn tiền nào chạy vì một phỏng đoán** (nguyên tắc 2.8). Đo sau khi ship: đếm tỉ lệ thẻ
hiện / thẻ được bấm trên `.runs/<taskId>/chat.jsonl` (transcript Ask — đúng file cho S4).

### 3.12 Từ vựng — một gốc từ

| Chỗ | Trước | Sau |
|---|---|---|
| pill composer (`modeChange`, `i18n.ts:748`) | 変更を依頼 | **修正を依頼** |
| gate ①③④ (`Request changes`, `:1035`) | 変更を依頼 | **修正を依頼** |
| gate ② (`Edit spec`, `:1037`) | 仕様を編集 | **仕様を修正** |
| foot build done (`requestFix`, `:813`) | 修正を依頼 | *giữ* |
| bản nháp (L1) | — | **修正案** |
| trạng thái chờ (L1) | — | **提案中** |
| duyệt / từ chối (L1) | — | **この内容で修正する** / **見送る** |

**Không bỏ nút nào.** Nút trên foot vẫn cần cho việc *nhìn thấy là sửa được* — người dùng không rành
sẽ không tự biết cứ gõ là được. Pill vẫn cần làm van an toàn cho ca §3.11 phân loại nhầm. Chỉ bỏ
**một chữ** (`変更`).

**Chỉ EN + JA.** `[ĐO]` [`i18n.ts:20`](../../apps/builder/web/src/lib/i18n.ts) —
`export type Lang = 'en' | 'ja'`, `DICT = { en: EN, ja: JA }`. **VI không tồn tại.** Bản đầu viết
"EN/JA/VI" ở S1 và "cả ba ngôn ngữ" ở AC — sai. Thêm VI là một spec khác, không phải một dòng của spec này.

Không đụng kiến trúc hai nút gửi của [092](092-composer-two-send-actions.md) — chỉ đụng chuỗi hiển
thị. 092 §tinh-chỉnh đã chốt nhãn nút gửi là 「質問を送信」 khi đứng cạnh pill; giữ nguyên.

### 3.13 Attach fix-file

`[ĐO]` `.md`/`markdown` đã nằm trong `ACCEPTED_EXT` ([`attachments.ts:70`](../../apps/builder/server/lib/attachments.ts)) —
ống dẫn có sẵn. Chỉ cần nhận diện frontmatter (`status` + `target` + `変更点`) và mời đi thẳng vào ②.

> **Xem lại trước khi làm.** Dưới cơ chế §3.6, thứ mang đi được có giá trị là **một SPEC đầy đủ**, chứ
> không phải delta — delta "§6: 0.5→0.2" vô nghĩa với APP2 nếu APP2 không có §6. Mà "dùng tài liệu này
> làm nền cho app khác" thì gần với [`base-import.ts`](../../apps/builder/server/lib/base-import.ts)
> (spec 051) đang làm cho YAML. S5 phải trả lời được *nó giải bài gì mà 051 chưa giải* trước khi được
> xếp lịch. Xem §7 Q3.

### 3.14 Diff base theo từng đợt

`[ĐO]` `snapshotDiffBase` ([`diff.ts:66`](../../apps/builder/server/lib/diff.ts)) `return` sớm nếu
snapshot đã tồn tại — idempotent **một lần mỗi task**. Trên build `done` được sửa lại, base vẫn là bản
trước vòng 1, nên tab `差分` trả lời "từ đầu tới giờ đổi gì" chứ không phải "đợt này đổi gì".

Snapshot lại tại **mỗi lần bắt đầu một vòng fix** — tức mỗi `apply` (L1) **và** mỗi ③ mang `replyText`
(L0). Bản đầu chỉ nói `apply`, bỏ sót đường L0 — mà L0 là đường mặc định.

---

## 4. Slices

Thứ tự theo **giá trị / chi phí** giảm dần.

### L0 — ③ hoà giải `SPEC.md` (XS) · **ĐÃ SHIP 2026-08-20**
- `implement.md`: bước cuối §3.2 (hiện trạng + bảng `変更履歴` append-only).
- `orchestrator.ts:494` chụp thêm `specHashBefore`; `post-turn.ts:270` tính `specChanged`;
  `task.specStale`.
- Gate ③: một dòng cảnh báo cạnh badge `artifactUnchanged` có sẵn.
- `diff.ts`: snapshot lại khi ③ mang `replyText` (§3.14, phần L0).

**Đây là slice đóng sự cố §1.1.** Ship một mình đã đủ trả lời câu hỏi gốc của user.

### S1 — Thống nhất từ vựng (XS) · **ĐÃ SHIP 2026-08-20**
`i18n.ts` (JA) + grep toàn `web/src`. Ba chuỗi **văn xuôi gọi tên nút** (`gateAnalyzeSummary2`,
`promoteDistillFailedSummary`, `askAnomalyMsg`) là nhóm bị sót ở lượt rà theo key — chỉ grep bắt được.
EN không gộp được mà không đụng kiến trúc; xem ghi chú Status ở đầu file.

### S6 — Diff base theo đợt, phần L1 (XS) · **chờ L1**
Phần L0 (`{restart}` khi ③ mang `replyText`) đã ship cùng L0. Phần còn lại — snapshot lại ở `apply` —
không tồn tại cho tới khi có `apply`, tức cho tới khi có L1.

### ─── MỐC HIỆN TẠI: dùng thật một thời gian, đo `specStale`, rồi mới quyết ───

Việc còn lại trước khi bàn L1: chạy vài vòng fix thật và đếm event `spec_stale` trong
`.runs/*/events.jsonl`.

> **Cạm bẫy của phép đo này**: `spec_stale` chỉ được ghi khi nó TRUE, y hệt `artifact_unchanged`.
> Nên "0 event" **không** phân biệt được *đo rồi và ổn* với *chưa đo lần nào*. Mọi vòng fix trước
> 2026-08-20 chạy dưới code cũ, không đo gì cả. Phải lọc theo `ts` ≥ thời điểm ship, nếu không mẫu số sai.
Tỉ lệ thấp ⇒ `implement.md` bước 6 làm được việc, và L1 chỉ còn là tính năng kiểm-soát-chi-phí (§1.3),
đáng làm hay không tuỳ build có lớn không. Tỉ lệ cao ⇒ đó mới là lúc bàn chặn cứng (§7 Q6), với số
trong tay thay vì phỏng đoán.

### L1 — Cửa duyệt (L) · sau L0 · **gate + strip là một, không tách**
- `orchestrator.ts:258` → route theo `gate.flag`, KHÔNG theo `status` (§3.8, bảng năm dòng).
- `phases.ts` slot `spec`: chế độ `revise` — backend `cp SPEC.md → SPEC.next.md`, `artifactRel` trỏ
  `SPEC.next.md`, thêm `{{SPEC_NEXT_PATH}}` + `{{CURRENT_SPEC}}` + `{{WORKFLOW_PATH}}`. Giữ đúng
  contract "mọi token luôn được thay".
- `spec.md` skill: nhánh revise — đọc spec + yml + yêu cầu, **sửa `SPEC.next.md` tại chỗ**, nói
  `変更点` 3–6 gạch trong chat, tự đánh giá phạm vi (§3.9).
- `gate.ts`: `fix_proposal` vào `GateVerify.outcome` (§3.8) + hard-stop `orchestrator.ts:341-344`.
- `apply` = `rename()` + ghi `fixes/` (backend, §3.7) + quét có điều kiện + snapshot diff + ③.
- `ArtifactPanel.tsx` §3.10 + CSS + đọc `fixes/`.

### S4 — Thẻ nhận diện ý định (M) · sau L0 (nút `すぐ直す` đã có đích), giàu hơn sau L1
Trailer trong `ask.ts` + thẻ trong bong bóng answer. Mang `[GIẢ THUYẾT]` — đã thiết kế để đoán sai
không mất gì (§3.11).

### S5 — Attach fix-file (S) · **chưa xếp lịch** — phải trả lời §7 Q3 trước

### Thời điểm

`[ĐO]` `projects/_drafts/` vẫn còn **18** thư mục — user **chưa** xoá data.

```
cứu §1.1 (XONG 2026-08-20) → land L0 + S1 → rồi mới xoá data → test lại
```

Xoá trước rồi mới làm L0 thì loạt dữ liệu test đầu tiên lại sinh ra dưới cơ chế cũ, và phải test lại
lần nữa. L0 là XS nên cái giá của việc chờ nó rất nhỏ. **L1 KHÔNG cần chờ** — nó không có migration.

---

## 5. Non-goals

1. **Không** đụng 4 phase của build mới, lint cap-5, import Dify, live test.
2. **Không** chặn cứng build khi `specStale` (§3.4) — badge, đo, rồi mới bàn.
3. **Không** tự động route một tin nhắn vào `/reply` dựa trên phân loại (nguyên tắc 2.8).
4. **Không** bỏ pill composer hay nút foot (§3.12).
5. **Không** thêm ngôn ngữ thứ ba (§3.12) — VI là một spec riêng.
6. **Không** làm strip điều khiển cả panel (`差分`/`レポート` nhảy theo đợt được chọn). Ý tưởng tốt
   nhưng làm nửa vời — `仕様` nhảy mà `差分` đứng yên — thì người dùng mất hoàn toàn cảm giác `現在`
   nghĩa là gì. Để phase sau, làm trọn một lần.
7. **Không** bộ dò lệch khi user sửa tay `main.yml` hoặc sửa trong Dify UI. Lỗ thật, nhưng track riêng.
8. **Không** đụng `SPEC-FIX.md` hiện có của user. Việc dọn dự án đó là thủ công, một lần.

---

## 6. Nghiệm thu

### L0

| # | Tiêu chí |
|---|---|
| L0-1 | Một vòng fix qua ③: `main.yml` đổi **và** `SPEC.md` đổi trong **cùng một lượt**. |
| L0-2 | **`SPEC.md` sau vòng fix mô tả `main.yml` hiện tại** — không phải bản trước, không phải một danh sách vá đắp thêm. (Người đọc chấm; §9.4.) |
| L0-3 | `変更履歴` được **append** đúng một dòng mỗi vòng; thân spec **không** phình theo kiểu nhật ký. |
| L0-4 | `main.yml` đổi mà `SPEC.md` không đổi → `task.specStale === true` + cảnh báo ở gate ③. |
| L0-5 | `main.yml` **không** đổi → `specStale` **không** bật (không báo động giả cho vòng rỗng). |
| L0-6 | Không đo được (`specHashBefore === undefined`) → `specStale === undefined`, **không** đoán thành `false`. |
| L0-7 | ③ ghi `SPEC.md` **không** bị confinement revert (whitelist `post-turn.ts:379` đã phủ). |
| L0-8 | Route **không đổi**: ④/`done` + change vẫn vào ③, mọi flag như hôm nay. |

### S1

| # | Tiêu chí |
|---|---|
| S1-1 | `変更を依頼` không còn ở bất kỳ đâu trong `web/src`, **loại trừ `web/src/dist/`** (bundle build sẵn được commit — grep phải trừ nó hoặc rebuild trước). |
| S1-2 | Mọi key mới đủ **EN + JA**. Không có key VI. |

### L1

| # | Tiêu chí |
|---|---|
| L1-1 | Trên build `done`, "修正を依頼" chạy **② trước**, không phải ③. |
| L1-2 | Suốt `提案中`, `SPEC.md` **byte-identical** — kể cả sau `説明を直す` lần 2, 3. Test bằng hash. |
| L1-3 | ④ `still_failing` + change → **③ thẳng** (không bị kéo qua ②). |
| L1-4 | ④ `infra_degraded` + change → **②**. |
| L1-5 | `見送る` → `SPEC.md` byte-identical; `fixes/….rejected.md` tồn tại, **không bị xoá**. |
| L1-6 | `この内容で修正する` → `SPEC.md` đổi **bằng rename** (nội dung byte-identical với `SPEC.next.md` trước đó), fix file `applied`, ③ chạy. |
| L1-7 | Khối `仕様の差分` trong fix file **khớp byte** với `unifiedDiffOfFiles(SPEC.md_cũ, SPEC.next.md)` — máy sinh, không ai gõ. |
| L1-8 | `confirmMode: 'auto'` **vẫn dừng** ở gate `fix_proposal`. |
| L1-9 | Đang có `SPEC.next.md` → **cả** `修正案` **và** `すぐ直す` đều bị chặn, trỏ về cái đang chờ. |
| L1-10 | Đóng trình duyệt rồi mở lại → pill `提案中` còn nguyên, nội dung không mất. |
| L1-11 | Chọn pill `applied`/`rejected` → **không có** đường nào sửa được nội dung. |
| L1-12 | Strip 20 đợt: `現在` vẫn thấy được, không có scroll ngang ở `<body>`, layout không vỡ. |
| L1-13 | Sau `apply` lần 2, tab `差分` chỉ hiện thay đổi **của đợt đó**. |
| L1-14 | Mọi fix file có `by:` — **và** không bị chính bộ quét chặn vì nó (§3.7). |
| L1-15 | `依頼` chứa **credential** (`sk-…`, `AKIA…`, `api_key=…`) → chặn commit. Chứa **URL / email** → cảnh báo, **không** chặn. |
| L1-16 | Target nằm trong `_drafts/` (gitignored) → **không chạy** quét. |

### S4

| # | Tiêu chí |
|---|---|
| S4-1 | Thẻ hand-off bị bỏ qua → không hiện lại cho cùng `summary`; hiện lại khi `summary` đổi thực chất. |
| S4-2 | Trailer JSON **không bao giờ** lọt vào text người dùng thấy, kể cả khi lượt bị cắt giữa chừng. |
| S4-3 | ② đánh giá độ lớn → thứ tự nút đảo đúng chiều; nút còn lại **luôn** bấm được. |

---

## 7. Open questions

1. **Trailer đặt ở đâu trong luồng stream?** (S4) Cuối text thì lượt bị cắt sẽ mất trailer (chấp nhận
   được: không thẻ). Đầu text thì phải giấu trước khi render dòng đầu tiên. → chốt lúc implement,
   AC S4-2 canh.
2. **Đặt tên `fixes/` hay `changes/`?** (chỉ chặn L1 — **L0 không cần thư mục nào**) `fixes/` nhất
   quán với `修正`; nhưng có đợt là "thêm tính năng". Nghiêng về `changes/`. → hỏi user trước L1.
3. **S5 giải bài gì mà [051 base-import] chưa giải?** (§3.13) Nếu câu trả lời là "không" thì S5 bị
   loại, không phải hoãn.
4. **② revise resume session cũ hay chạy tươi?** (L1) Session `spec` có thể đã hết hạn sau nhiều ngày.
   Nghiêng về: resume khi còn, else chạy tươi với `SPEC.md` + `main.yml` làm đầu vào.
5. **`Discard` lúc đang có `SPEC.next.md` thì sao?** (L1) Nghiêng về: xoá `SPEC.next.md`, không ghi
   `fixes/` (chưa từng có quyết định nào để lưu). → chốt lúc implement.
6. **Ngưỡng `specStale` bao nhiêu thì chuyển từ badge sang chặn?** (§3.4) Cố ý **không** chốt bây giờ —
   chốt bằng số đo sau khi L0 chạy thật, không bằng phỏng đoán.

> **Đã chốt, không mở lại**: `fixes/` vào git → **có điều kiện** (§3.7 luật 1: chỉ khi path được track;
> `_drafts/` gitignored nên không). Quét secret → **chỉ credential mới chặn**. Ai tính `SPEC.md` mới ở
> `apply` → **không ai**, `rename()` (§3.6). Slug của fix file → **backend đánh số**, model không đặt tên.

---

## 8. Bảng nhà tri thức (cho `/spec-close` sau này)

| Loại | Mảnh trong spec này | Nhà |
|---|---|---|
| Hành vi đã ship | L0 (③ hoà giải + badge `specStale`) | [`docs/state/build-lifecycle.md`](../state/build-lifecycle.md) |
| Hành vi đã ship | S1 từ vựng · L1 gate/strip · S4 thẻ | [`docs/state/ui-surface.md`](../state/ui-surface.md) |
| Hành vi đã ship | routing ④ theo `gate.flag` (bảng §3.8) | `docs/state/build-lifecycle.md` |
| Nguyên tắc còn chi phối | §2.1 (bất biến là `main.yml=f(SPEC.md)`), **2.3** (hồ sơ do MÁY sinh), **2.6** (phát hiện ≠ ngăn), 2.8 (không tự chạy vì phỏng đoán) | `docs/state/build-lifecycle.md` — mảnh đắt nhất, đừng bỏ sót |
| Bài học từ thất bại thật | §1.2 không ai ghi → spec write-once; §1.5 hai chữ một việc; §1.6a N-file đã loại; **§1.6b delta-rồi-dựng-lại đã loại** | `AGENTS.md §9` |
| Việc chưa làm | Non-goal 6 (strip điều khiển cả panel), Non-goal 7 (dò lệch khi sửa tay), §7 Q6 (ngưỡng chặn) | `docs/prompts/runs/CAMPAIGNS.md` mục để-ngỏ |
| Bằng chứng đo | §1.1, §1.4 (đếm `_drafts/`), §1.5 (i18n refs), §0 (gitignore) | `CAMPAIGNS.md` findings |

---

## 9. Kế hoạch QA

Ba tầng. **Đừng trộn plumbing với quality** — QA cơ học chứng minh được đường ống, không chứng minh
được nội dung.

### 9.1 Unit — server (`node --test` + tsx)

**L0 — hash + badge** (đối xứng với suite `artifactUnchanged` của 094 S1; sao chép khuôn, đừng phát minh)

| # | Kiểm |
|---|---|
| U1 | `main.yml` đổi + `SPEC.md` đổi → `specStale === false` |
| U2 | `main.yml` đổi + `SPEC.md` **không** đổi → `specStale === true` |
| U3 | `main.yml` **không** đổi → `specStale === false` (vòng rỗng không báo động giả) |
| U4 | `specHashBefore === undefined` → `specStale === undefined` (không đoán) |
| U5 | `SPEC.md` chưa tồn tại trước turn (`null` hash) → hành vi xác định, không throw |
| U6 | ③ ghi `SPEC.md` → `confinementCheck` **không** revert (whitelist `projects/<p>/<w>/`) |
| U7 | Badge **không** làm `ok=false` — build vẫn `awaiting_confirm`, không `error` |
| U8 | Snapshot diff base được chụp lại khi ③ mang `replyText`, **không** chụp lại ở ③ đầu tiên |

**L1 — routing** (chỗ dễ sai nhất)

| # | Kiểm |
|---|---|
| U9 | ④ `done` + change → phase `spec`, **không** `implement` |
| U10 | ④ `test_result` → `spec` · U11 ④ `awaiting_import` → `spec` · U12 ④ `infra_degraded` → `spec` |
| U13 | ④ **`still_failing` → `implement`** (lỗ §3.8) |
| U14 | ③ `still_failing` → `implement` (không hồi quy) · U15 ①② → phase hiện tại |

**L1 — bất biến "chưa đụng file"** (trái tim của L1)

| # | Kiểm |
|---|---|
| U16 | Suốt `提案中`, hash `SPEC.md` **byte-identical**; `説明を直す` lần 2, 3 → **vẫn** byte-identical |
| U17 | `apply` → `SPEC.md` byte-identical với `SPEC.next.md` **ngay trước rename** (chứng minh là rename, không phải viết lại) |
| U18 | `見送る` → `SPEC.md` byte-identical · `fixes/….rejected.md` tồn tại |
| U19 | Khối `仕様の差分` == `unifiedDiffOfFiles` output, byte-for-byte |
| U20 | ② revise **lỗi giữa chừng** → `SPEC.next.md` không để lại trạng thái nửa vời; `SPEC.md` nguyên vẹn |
| U21 | `Discard` lúc có `SPEC.next.md` → hành vi xác định (§7 Q5) |

**L1 — bất biến "một 提案中" · hard-stop**

| # | Kiểm |
|---|---|
| U22 | Đang có `SPEC.next.md` → `修正案` bị chặn · U23 **và `すぐ直す` cũng bị chặn** (§3.9) |
| U24 | Hai tab cùng `apply` → `lock.ts` chặn |
| U25 | `confirmMode: 'auto'` **vẫn dừng** ở `fix_proposal` · U26 `spec_only` · U27 `each_step` |

**L1 — fix file · quét**

| # | Kiểm |
|---|---|
| U28 | Tên file backend đánh số: hai fix **cùng ngày** → `-01`, `-02`, không collision |
| U29 | Target trong `_drafts/` (gitignored) → **không** chạy quét |
| U30 | `依頼` chứa `sk-…` → chặn · U31 chứa URL/email (kể cả `by:`) → **cảnh báo, không chặn** |
| U32 | `変更点` ra 0 hoặc 20 gạch → hành vi xác định |

**S4 — trailer (model sinh ra, coi là dữ liệu bẩn)**

| # | Kiểm |
|---|---|
| U33 | Trailer bóc sạch khỏi text hiển thị · U34 lượt **bị cắt** → không trailer, không JSON lọt ra |
| U35 | JSON hỏng / thiếu field → không thẻ, không throw · U36 trailer xuất hiện 2 lần |
| U37 | Chuỗi giống trailer **trong câu hỏi hợp lệ** không bị bóc nhầm · U38 `summary` chứa markdown/HTML → escape |

**S5** (nếu §7 Q3 trả lời được)

| # | Kiểm |
|---|---|
| U39 | Frontmatter thiếu field → attachment thường, không crash · U40 `target` khác project đang mở |

### 9.2 Unit — web (vitest, hàm thuần)

| # | Kiểm |
|---|---|
| W1 | `現在` luôn index 0 · W2 `status` → class · W3 `applied`/`rejected` **không** trả `edit` |
| W4 | Đã bỏ qua → ẩn cùng `summary`; hiện lại khi `summary` đổi thực chất |
| W5 | Thẻ chỉ render khi `intent==='fix' && confidence==='high'` |
| W6 | Mọi key mới đủ **EN + JA** · W7 **grep `変更を依頼` = 0 hit trong `web/src` trừ `dist/`** |

### 9.3 Browser QA

Theo format `docs/prompts/qa/ask-meter-browser-qa.md`.

| # | Kiểm |
|---|---|
| T1 | **L0 đủ một vòng**: gõ fix → ③ → mở tab `仕様` → nội dung **đã phản ánh** cái vừa sửa. Số lần bấm = **1** |
| T2 | Thẻ hiện **dưới bong bóng trả lời**, không ở gate-foot |
| T3 | `修正案を作る` → panel mở tab 仕様, pill `提案中` tự chọn |
| T4 | Gate card mang `変更点` — quyết được **mà không mở panel** |
| T5 | **Đóng trình duyệt, mở lại** → pill `提案中` còn, nội dung nguyên |
| T6 | Pill `applied` → **không có đường nào** sửa được |
| T7 | Banner hiện khi không ở `現在` · T8 dot trên tab `仕様` khi có `提案中` |
| T9 | **20 đợt fix**: `現在` vẫn thấy · `<body>` không scroll ngang |
| T10 | Dưới 560px nhãn không tràn (luật rụng label của spec 092) |
| T11 | Một vòng L1 đầy đủ: gõ → thẻ → duyệt → ③ → ④ → import. Số lần bấm = **2** |

### 9.4 KHÔNG kiểm được bằng máy — đừng để agent báo PASS

| Việc | Thuộc về |
|---|---|
| **`SPEC.md` sau N vòng có THẬT SỰ mô tả `main.yml` không** (AC L0-2) — máy chỉ biết nó *đổi*, không biết nó *đúng* | spot-check người đọc · `/report` · campaign |
| `SPEC.md` có bị biến thành nhật ký đắp thêm không (AC L0-3) | spot-check người đọc |
| `変更点` viết có đúng và đọc được không | `/report`, `/e2e` |
| ② nhận diện vượt phạm vi có chuẩn không | campaign |
| ② đánh giá "nhỏ / lớn" có chuẩn không (§3.11) | campaign |
| Trailer phân loại chính xác cỡ nào (`[GIẢ THUYẾT]` §3.11) | đo sau ship trên `chat.jsonl` (transcript Ask) |

### 9.5 Hồi quy

| # | Kiểm |
|---|---|
| R1 | Build mới ①②③④ đầu-cuối không đổi · R2 `still_failing` ở ③ và ④ giữ nguyên |
| R3 | Import Dify · live test · `cleanup_apps` |
| R4 | `promote` / `consult` không có `fix_proposal` |
| R5 | Badge `artifactUnchanged` của 094 S1 **không hồi quy** khi `specChanged` chen vào cùng chỗ tính |
| R6 | Suite hiện tại còn xanh: server 935+, web 301+ |

### 9.6 Nếu phải cắt

**L0: U2 · U3 · U4 · U6 · T1.** Năm cái này là toàn bộ L0 — mất cái nào là mất luôn lý do làm.

**L1: U13 · U16 · U17 · U19 · U22+U23 · U25 · T5 · T9.** `U17` (apply là `rename`) và `U19` (delta do
máy sinh) mới thêm và load-bearing ngang phần còn lại: chúng là thứ duy nhất chứng minh cơ chế §3.6
thật sự chạy đúng chiều, chứ không lặng lẽ thoái hoá về thiết kế đã loại ở §1.6b.
