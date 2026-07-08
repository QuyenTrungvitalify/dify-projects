# Hướng dẫn cài đặt & sử dụng Builder

**Builder** là một web app chạy **local** giúp tạo Dify workflow bằng cách chat. Bạn nhập yêu cầu,
nó chạy qua 4 bước (**Analyze → Spec → Implement → Test**) để sinh ra file YAML, và có thể **tự
import** thẳng vào Dify của bạn.

> Chạy ở `127.0.0.1` (chỉ máy bạn), một build tại một thời điểm. Mỗi người tự chạy bản của mình.

---

## 1. Yêu cầu

- **Python 3.12+**
- **Node.js 20.6+** (khuyến nghị 22)
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
DEFAULT_DEPLOY=selfhost
```

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
   - **Workflow / ワークフロー**: `none (new)` / `なし（新規）` = làm mới từ đầu; hoặc chọn workflow có sẵn để sửa.
   - **Confirm / 確認**: `each step`/`各ステップ` (dừng mỗi bước) · `spec only`/`仕様のみ` (chỉ dừng ở Spec) · `auto`/`自動` (tự chạy).
   - **Deploy / デプロイ**: `none`/`なし` (chỉ tạo file local) · `selfhost`/`セルフホスト` (tự import vào Dify) · `cloud`/`クラウド`.
   - **Fast build / 高速ビルド**: `on`/`オン` = tạo nhanh workflow đơn giản (1 node LLM), chỉ dùng khi làm mới từ đầu.
3. Bấm gửi → Builder chạy qua 4 bước.
4. **Duyệt ở Spec gate**: xem lại/chỉnh bản thiết kế rồi xác nhận đi tiếp.
5. **Import**: cuối cùng bấm nút **"Import to Dify"** → workflow được đẩy lên Dify, kèm link mở app.

> Kể cả chế độ **Tự động**, bước Import **luôn** chờ bạn bấm — đẩy lên Dify luôn là quyết định của người.

---

## 6. Lưu ý quan trọng

- **Import luôn tạo app MỚI.** Chạy lại cùng một workflow sẽ tạo app trùng tên → xóa bản cũ trong Dify nếu cần.
- **Bảo mật token**: token Dify chỉ nằm ở backend, không lọt vào chat/log. Nếu dùng Admin key, giữ kín và đổi key khi cần.
- **Dừng Builder**: `lsof -ti:4123 | xargs kill`.
- **Build fail ngay lập tức (フェーズ失敗 / exit 1)**: đọc dòng lý do ĐẦU TIÊN trên gate card — từ spec
  045 nó tự nói nguyên nhân: *usage limit* (Claude hết hạn mức — chờ reset), *not authenticated* (chạy
  `claude` trong terminal để login), *cannot reach the Anthropic API* (mạng/proxy), *is the `claude`
  CLI installed?* (chưa cài CLI). Server log lúc khởi động cũng cảnh báo sớm nếu thiếu `claude`.
- Kết quả build được lưu ở `projects/<project>/<workflow>/workflows/main.yml` (cấu trúc 2 tầng, spec 030) — có thể import thủ công vào Dify Studio nếu không dùng auto-import.

---

## 7. Lỗi thường gặp

| Triệu chứng | Cách xử lý |
|---|---|
| Import báo *"needs DIFY_CONSOLE_URL..."* | Chưa điền `.env`, hoặc chưa restart backend sau khi sửa `.env`. |
| Import bị **401** | Thiếu/sai `DIFY_WORKSPACE_ID`, hoặc chưa bật `ADMIN_API_KEY_ENABLE=true` + restart `api` trong Dify. |
| Mở trang trắng / không cập nhật | Hard-refresh trình duyệt (`Cmd/Ctrl+Shift+R`). |
| `claude` không chạy | Chạy `claude auth login` để đăng nhập lại. |
| Hay bị *timeout* (phase dài / live-test chạy quá 2 phút) | Tăng `BUILDER_TURN_TIMEOUT_MS` / `BUILDER_LIVE_RUN_TIMEOUT_MS` trong `apps/builder/.env` (đơn vị ms — xem `.env.example`), rồi restart Builder. |
| Import YAML vào Dify báo lỗi | Copy **nguyên văn** thông báo lỗi của Dify → mở build trong Builder. Build đã xong (done) thì bấm **「このワークフローを編集」(Edit this workflow)** để mở lại; đang dừng ở gate thì bấm thẳng **"Request changes"**. Dán lỗi + ghi rõ "import vào Dify thì bị lỗi này" → build tự sửa → tải lại YAML và import lại. ⚠ KHÔNG dùng Ask — Ask chỉ trả lời, không sửa file. |
