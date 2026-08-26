# Hướng dẫn cài đặt & sử dụng Builder

**Builder** là một web app chạy **local** giúp tạo Dify workflow bằng cách chat. Bạn nhập yêu cầu,
nó chạy qua 4 bước (**Analyze → Spec → Implement → Test**) để sinh ra file YAML, và có thể **tự
import** thẳng vào Dify của bạn.

> Chạy ở `127.0.0.1` (chỉ máy bạn). Có thể mở nhiều build song song (dừng ở gate); tại một thời
> điểm chỉ một lượt AI chạy. Mỗi người tự chạy bản của mình.

---

## 1. Yêu cầu

- **Python 3.12+**
- **Node.js 22.6+** (backend cần load hook `.ts` native — Node cũ hơn sẽ từ chối khởi động, SEC1)
- **Claude CLI** — đã cài và đăng nhập (Builder gọi `claude` để chạy các bước)
- **(Tùy chọn) Dify** (local hoặc cloud) — chỉ cần nếu muốn tự import workflow vào Dify

---

## 2. Cài đặt lần đầu

```bash
git clone <repo-url> dify-projects
cd dify-projects

./scripts/setup.sh        # tạo Python venv + tải skills/corpus/dify-src (gitignored)
./scripts/setup-node.sh   # cài + build Builder (backend + giao diện web)

claude auth login         # đăng nhập Claude CLI (bắt buộc)
```

---

## 3. Cấu hình Dify (bỏ qua nếu chỉ build local, không import)

Bước này để Builder kết nối và **tự import** workflow vào Dify. Copy file mẫu:

```bash
cp apps/builder/.env.example apps/builder/.env
```

Mở [apps/builder/.env](apps/builder/.env) và điền, dùng **Admin API key** (ổn định, không hết hạn):

```env
DIFY_CONSOLE_URL=http://localhost:8090/console/api    # đổi host/port cho đúng Dify của bạn
DIFY_CONSOLE_TOKEN=<ADMIN_API_KEY>
DIFY_WORKSPACE_ID=<tenant/workspace id>
```

> Chỉ cần ba dòng này. Builder **không** cần khai trước đích deploy: hễ với tới được Dify bằng creds
> ở trên, các nút chạm Dify (seed, "Test with workflow", Import) tự hiện ra ở gate.

> 📄 Cách lấy `ADMIN_API_KEY`, `DIFY_WORKSPACE_ID` và các thông số liên quan sẽ được hướng dẫn ở một tài liệu riêng.

File `.env` đã được gitignore — token **không bao giờ** bị commit hay lộ ra ngoài.

---

## 4. Chạy Builder

```bash
cd apps/builder
npm start
```

Mở trình duyệt: **http://127.0.0.1:4123**

---

## 5. Tạo workflow đầu tiên

1. Nhập yêu cầu vào ô chat (ví dụ: *"Tạo workflow tóm tắt văn bản"*).
2. Chọn các tùy chọn ở dưới ô nhập (giao diện là **English** hoặc **日本語** — có nút đổi ngôn ngữ):
   - **Workflow / ワークフロー**: `none (new)` / `なし（新規）` = làm mới từ đầu; chọn workflow có sẵn để sửa;
     hoặc bấm **＋ Add YAML as base / ＋YAMLをベースに追加** để upload/dán một file YAML có sẵn làm base chỉnh sửa (spec 051).
   - **Confirm / 確認**: `each step`/`各ステップ` (dừng mỗi bước) · `spec only`/`仕様のみ` (chỉ dừng ở Spec) · `auto`/`自動` (tự chạy).
   - **Fast build / 高速ビルド**: `on`/`オン` = tạo nhanh workflow đơn giản (1 node LLM), chỉ dùng khi làm mới từ đầu.
   - Việc **test/deploy không chọn ở đây nữa** (spec 036): đến gate Test, Builder tự hiện các nút
     "Test with workflow" theo Dify khả dụng, và nút **Import to Dify** luôn chờ bạn bấm.
3. Bấm gửi → Builder chạy qua 4 bước.
4. **Duyệt ở Spec gate**: xem lại/chỉnh bản thiết kế rồi xác nhận đi tiếp.
5. **Import**: cuối cùng bấm nút **"Import to Dify"** → workflow được đẩy lên Dify, kèm link mở app.

> Kể cả chế độ **Tự động**, bước Import **luôn** chờ bạn bấm — đẩy lên Dify luôn là quyết định của người.

> **Build xong rồi mới thấy cần sửa?** Đó là chuyện bình thường và có đường riêng — xem **mục 6**.
> Đừng build lại từ đầu.

---

## 6. Sửa một workflow đã dựng

Đây là phần **hay dùng nhất sau khi build xong**: bạn import vào Dify, chạy thử, rồi mới phát hiện
cần đổi gì. Sửa **ngay trong hội thoại đó**, không cần build lại từ đầu.

### 6.1 Mở lại để sửa

- Build còn **đang mở** (dừng ở gate): gõ thẳng vào ô nhập.
- Build đã **完了 (done)**: cũng gõ thẳng vào ô nhập rồi bấm **✎ 修正を依頼** — hội thoại chưa đóng,
  workflow vẫn sửa được tại chỗ.
- Workflow cũ **không còn hội thoại nào**: bấm workflow ở thanh bên → nếu có sẵn build thì nó mở build đó;
  nếu không, nó mở màn hình mới với workflow đã chọn sẵn.

**Trường hợp cuối này giờ chạy khác trước.** Nếu workflow đã có **cả `SPEC.md` lẫn file `.yml`** —
tức là do chính Builder dựng ra — thì build mới **bắt đầu thẳng ở ③ 実装**, không chạy lại ① 分析 và
② 仕様:

- ① đọc workflow để hiểu nó, ② viết tài liệu mô tả nó. Cả hai thứ đó **đã có sẵn trên đĩa**, nên chạy
  lại là trả tiền hai lượt để đọc lại thứ mình vừa viết. Nói rõ: đây **vẫn là một task mới** (hội thoại
  mới, thư mục `.runs/` mới, không nhớ gì từ hội thoại trước) — chỉ là nó **bắt đầu từ file đã có**
  thay vì phân tích lại từ đầu.
- Thanh bước hiện ①② bằng **gạch ngang trong vòng nét đứt**, không phải tích xanh — vì chúng **không
  chạy**, chứ không phải "đã xong". Rê chuột lên để xem lý do.
- Yêu cầu bạn gõ được đưa vào lượt ③ **dưới dạng yêu cầu sửa**, đúng như khi bấm ✎ trên một build
  đang mở. `SPEC.md` cũ được **chụp lại trước** khi sửa, nên nút 「この修正を取り消す」 (§6.4) vẫn dùng được.
- Chế độ 「仕様のみ」/`spec only` vẫn **dừng đúng một lần** — nhưng ở **③** thay vì ②, vì build này
  không có ②. (Đúng lời hứa của nó: một lần dừng để bạn xem trước khi đi tiếp.)

Ngược lại, **YAML bạn import từ ngoài vào** (「Import base」) thì **vẫn chạy đủ 4 bước**: chưa ai đọc
file đó, và tài liệu giải thích nó chưa tồn tại. Không có nút nào để bật/tắt — nó tự nhận ra qua việc
trên đĩa có gì.

### 6.2 Hai lối gửi — Enter và ✎ khác nhau

| Bấm | Đi đâu | Có sửa file không |
|---|---|---|
| **Enter** (nút `↵ 送信`) | câu hỏi — nó **trả lời**, đọc file thật để trả lời | ❌ **không** |
| **✎ 修正を依頼** | yêu cầu sửa — nó **sửa file** | ✅ **có** |

> **Enter luôn là hỏi**, kể cả khi bạn vừa gõ "sửa giúp tôi X". Hỏi nhầm chỉ tốn một câu trả lời;
> sửa nhầm thì ghi đè file thật. Nếu bạn gõ yêu cầu sửa rồi Enter, nó sẽ trả lời **và nhắc bạn bấm ✎**.

> **Chỉ còn MỘT nút 修正を依頼 trên màn hình.** Trước đây thẻ gate cũng có một nút cùng tên, nhưng nó
> không gửi gì — chỉ đưa con trỏ xuống ô nhập rồi tô sáng đúng nút ✎ vốn đã nằm sẵn ở đó. Hai nút
> cùng chữ, khác việc. Giờ nút ✎ cạnh ô nhập là cửa duy nhất, ở **mọi** trạng thái: gate đang chạy,
> build đã xong, và cả build promote (ở đó ô nhập chỉ có một nút và nó cũng mang tên 修正を依頼).

### 6.3 Bấm ✎ có hai lựa chọn (bấm mũi tên ▾ cạnh nút)

- **「すぐ直す」 / "Fix it now"** — sửa luôn. Một lượt.
- **「先に計画を見せて」 / "Show me the plan first"** — nó **viết kế hoạch ra trước** rồi hỏi bạn.
  `SPEC.md` **không bị đụng** cho tới khi bạn đồng ý.

Chọn "xem kế hoạch trước" thì build dừng ở một thẻ có **ba nút**:

| Nút | Nghĩa | Giá |
|---|---|---|
| **「これで進める」** | duyệt kế hoạch → sửa file luôn | một lượt sửa |
| **「説明を直す」** | kế hoạch chưa đúng, viết lại | một lượt viết kế hoạch |
| **「やめる」** | bỏ kế hoạch, về đúng chỗ cũ | **miễn phí** — chưa có gì bị đổi |

> Dùng "xem kế hoạch trước" khi thay đổi **lớn hoặc mơ hồ**. Sửa ba dòng thì "すぐ直す" rẻ hơn.
> Nếu lượt viết kế hoạch **chết giữa chừng** (hết hạn mức chẳng hạn), thẻ lỗi vẫn có **「やめる」** —
> bấm là thoát, không tốn thêm lượt nào.

### 6.4 Lỡ tay thì lùi lại được

Sau mỗi lần sửa, thẻ có **「この修正を取り消す」 / "Take this fix back"**.

- Nó trả **CẢ HAI** file về trước lượt sửa: `main.yml` **và** `SPEC.md`. Không bao giờ trả một nửa.
- **Miễn phí** — chỉ là chép file, không tốn lượt AI nào.
- **Hội thoại giữ nguyên**; muốn làm lại thì gõ lại và tốn một lượt.
- Nếu **ai đó/việc khác đã đổi file** kể từ lượt của bạn, nó **từ chối** thay vì xoá đè lên việc của họ.

### 6.5 Chế độ 「自動」 khi sửa

**Đổi lớn nhất**: trước đây `自動` chỉ tự chạy cho **build mới**, còn mỗi lần sửa vẫn dừng lại chờ bấm.
Giờ **sửa cũng chạy hết** — sửa xong tự kiểm tra rồi báo `完了`.

Nhưng nó **vẫn dừng khi ĐO ĐƯỢC có vấn đề**:

| Build dừng vì | Thẻ nói gì |
|---|---|
| **File không đổi một byte nào** | 「ファイル変更なし」 — lượt đó không sửa gì; đọc câu trả lời để biết vì sao |
| **Kiểm tra kỹ thuật đỏ** sau 5 vòng tự sửa | thẻ `still_failing` — chọn chấp nhận, thử tiếp, hay bỏ |
| **Lỗi** (hết hạn mức, turn chết…) | thẻ lỗi, kèm lý do ở dòng đầu |

> Nói cách khác: `自動` **không dừng để hỏi ý bạn**, nhưng **luôn dừng khi có gì đó đo được là sai**.

Còn một thứ nó **chỉ cảnh báo, không dừng**: 「ワークフローは変わりましたが、仕様書は更新されていません」
— file đổi mà tài liệu không đổi. Đôi khi đó là **đúng** (thay đổi không ảnh hưởng mô tả), nên nó
không chặn; nhưng nếu thay đổi có ảnh hưởng thì tài liệu đang lệch, **kiểm trước khi tin nó**.

### 6.6 「自動」 và "xem kế hoạch trước" không dùng chung được

Đúng như tên: "xem kế hoạch trước" là **một cửa chờ người**, `自動` là **chế độ không có người chờ**.

- Đang ở `自動` → **không hiện** lựa chọn "先に計画を見せて".
- Đang có kế hoạch treo → chip 確認 **không cho chọn** `自動` (phải quyết định kế hoạch đó trước).

### 6.7 Nếu bạn đã import lên Dify

Sau khi sửa, thẻ 完了 sẽ nói nếu **Dify vẫn đang giữ bản cũ**:

> 「Dify には HH:MM にインポートした版が残っています。その後ワークフローは変わりました。」

⚠️ **`完了` không có nghĩa là Dify đã có bản mới.** Muốn đẩy bản mới lên thì bấm nút test/import trên
thẻ — Builder **không bao giờ tự đẩy** lên Dify.

### 6.8 Chỗ còn biết là chưa hoàn hảo

Để bạn khỏi tưởng là lỗi mới:

- **Tab 差分 có thể hiện diff to trong khi thẻ nói "lượt này không đổi file"** — với workflow sửa-từ-cái-có-sẵn,
  tab đang so **với bản gốc lúc bắt đầu build**, còn thẻ nói **về lượt vừa rồi**. Thẻ nói đúng về lượt;
  tab nói đúng về cả build. Đang chờ sửa (spec 105 T1).
- Vài thông báo lỗi (409) hiện **tiếng Anh** dù giao diện đang tiếng Nhật/Việt.

---

## 7. Lưu ý quan trọng

- **Import luôn tạo app MỚI.** Chạy lại cùng một workflow sẽ tạo app trùng tên → xóa bản cũ trong Dify nếu cần.
- **Bảo mật token**: token Dify chỉ nằm ở backend, không lọt vào chat/log. Nếu dùng Admin key, giữ kín và đổi key khi cần.
- **Dừng Builder**: `lsof -ti:4123 | xargs kill`.
- **Build fail ngay lập tức (フェーズ失敗 / exit 1)**: đọc dòng lý do ĐẦU TIÊN trên gate card — từ spec
  045 nó tự nói nguyên nhân: *usage limit* (Claude hết hạn mức — chờ reset), *not authenticated* (chạy
  `claude` trong terminal để login), *cannot reach the Anthropic API* (mạng/proxy), *is the `claude`
  CLI installed?* (chưa cài CLI). Server log lúc khởi động cũng cảnh báo sớm nếu thiếu `claude`.
- Kết quả build được lưu ở `projects/<project>/<workflow>/workflows/main.yml` (cấu trúc 2 tầng, spec 030) — có thể import thủ công vào Dify Studio nếu không dùng auto-import.

---

## 8. Lỗi thường gặp

| Triệu chứng | Cách xử lý |
|---|---|
| Import báo *"needs DIFY_CONSOLE_URL..."* | Chưa điền `.env`, hoặc chưa restart backend sau khi sửa `.env`. |
| Import bị **401** | Thiếu/sai `DIFY_WORKSPACE_ID`, hoặc chưa bật `ADMIN_API_KEY_ENABLE=true` + restart `api` trong Dify. |
| Mở trang trắng / không cập nhật | Hard-refresh trình duyệt (`Cmd/Ctrl+Shift+R`). |
| `claude` không chạy | Chạy `claude auth login` để đăng nhập lại. |
| Hay bị *timeout* (phase dài / live-test chạy quá 2 phút) | Tăng `BUILDER_TURN_TIMEOUT_MS` / `BUILDER_LIVE_RUN_TIMEOUT_MS` trong `apps/builder/.env` (đơn vị ms — xem `.env.example`), rồi restart Builder. |
| Import YAML vào Dify báo lỗi | Copy **nguyên văn** thông báo lỗi của Dify → mở build trong Builder. Build đã xong (done) thì gõ vào ô nhập rồi bấm **✎ 修正を依頼** để sửa **ngay trong hội thoại đó** (mục 6); 「このワークフローを編集」 mở một hội thoại MỚI và chạy lại cả 4 bước — đắt hơn nhiều. Dán lỗi + ghi rõ "import vào Dify thì bị lỗi này" → build tự sửa → tải lại YAML và import lại. ⚠ KHÔNG dùng Ask — Ask chỉ trả lời, không sửa file. |
