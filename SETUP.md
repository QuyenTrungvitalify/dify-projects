# Cài đặt Dify Builder

> ⚠️ **Chưa phát cho user.** Các script đã có và đã chạy được, nhưng còn **chưa nghiệm thu trên máy
> sạch** và **chưa kiểm trên Windows/WSL2**. Làm xong hai việc đó rồi hãy gửi tài liệu này đi.

Bạn cần đúng **hai** thứ. Không cần cài Node, không cần cài Python, không cần quyền admin.

| | |
|---|---|
| **1** | `git` — macOS đã có sẵn (chạy `git --version`; nếu máy hỏi cài Xcode Command Line Tools thì bấm đồng ý) |
| **2** | Quyền truy cập repo (hỏi người phụ trách) |

Bạn **không cần biết** phiên bản Node hay Python nào. Repo tự lo, và nó **không đụng** tới Node/Python
mà các dự án khác trên máy bạn đang dùng.

---

## A. Phần chung — mọi người đều làm

### A1. Tải repo về

```bash
git clone <URL-repo> ~/dify-projects
cd ~/dify-projects
```

### A2. Chạy một lệnh duy nhất

```bash
./scripts/bootstrap.sh
```

Lệnh này tự tải Node và Python đúng phiên bản vào thư mục `.toolchain/` **bên trong repo**, rồi dựng
mọi thứ còn lại. Lần đầu mất vài phút.

**Dung lượng cần trống: khoảng 1 GB.** (Tải về ~230 MB; sau khi cài xong toàn bộ thư mục chiếm
~570 MB — đã đo trên máy thật.)

Nếu nó dừng giữa chừng, nó sẽ in **đúng một câu** nói cần làm gì. Làm theo rồi chạy lại — lệnh này an
toàn khi chạy lại nhiều lần.

> **Không lo về máy đang có sẵn Node/Python bản khác.** Repo này dùng bản riêng của nó, chỉ trong lúc
> nó chạy. Sau khi cài xong, mở Terminal gõ `node -v` vẫn ra bản cũ của bạn. Muốn gỡ sạch:
> `rm -rf .toolchain`.

### A3. Đăng nhập Claude

**Không cần làm gì ở bước này.** Mở app (A4) — nếu máy chưa đăng nhập, app tự hiện ô đăng nhập: bấm
**「ログインページを開く」**, đăng nhập trên trang vừa mở, **xong**. App tự nhận ra và đi tiếp, không
phải copy gì cả.

Ô "code" trong app là đường dự phòng cho máy không mở được trình duyệt (WSL2, máy chủ không màn hình):
khi đó bấm link trong app, trang mở ra sẽ hiện một đoạn mã — dán đoạn đó vào ô.

Muốn làm trước bằng Terminal cũng được — hai đường dẫn tới cùng một chỗ:

```bash
claude auth login
```

Kiểm tra máy đang đăng nhập hay chưa:

```bash
claude auth status
```

### A4. Mở app

Vào Finder, mở thư mục `~/dify-projects/scripts/`, **double-click** `update-and-run.command`.

Lần đầu macOS có thể chặn: chuột phải vào file → **Open** → **Open** lần nữa.

Một cửa sổ Terminal hiện ra, chạy vài chục giây, rồi trình duyệt tự mở **http://127.0.0.1:4123**.

**Đừng đóng cửa sổ Terminal đó** — đóng là app tắt.

---

## B. Phần tuỳ chọn — nối app vào Dify

Chỉ làm phần này nếu bạn muốn app **tự đẩy workflow vào Dify** thay vì import tay.

### B1. Nếu bạn dùng Dify Cloud

```bash
cp apps/builder/.env.example apps/builder/.env
```

Mở `apps/builder/.env`, bỏ dấu `#` ở ba dòng cuối và điền:

```dotenv
DIFY_CONSOLE_URL=https://cloud.dify.ai/console/api
DIFY_CONSOLE_TOKEN=<xem bên dưới>
```

Lấy token: mở Dify trên trình duyệt → **F12** → tab **Network** → bấm một thứ gì đó trong Dify →
chọn một request bất kỳ tới `/console/api/...` → mục **Headers** → copy phần sau chữ `Bearer ` trong
dòng `Authorization`.

> Token này **hết hạn sau khoảng 60 phút**. Hết hạn thì lấy lại y như trên.

Sửa `.env` xong phải **tắt app rồi mở lại** (double-click `update-and-run.command` lần nữa).

### B2. Nếu bạn tự dựng Dify trên máy

#### B2.1 Cài Docker

**macOS**: tải [Docker Desktop](https://www.docker.com/products/docker-desktop/), chọn đúng chip
(Apple Silicon hay Intel), kéo vào Applications, mở lên và chờ icon 🐳 trên thanh menu báo *Running*.

Kiểm tra:

```bash
docker compose version
```

Máy cần: RAM **8 GB** trở lên, ổ trống ~10 GB.

#### B2.2 Dựng Dify

```bash
git clone https://github.com/langgenius/dify.git ~/dify
cd ~/dify
git checkout 1.13.0
cd docker
cp .env.example .env
```

Mở `~/dify/docker/.env`, sửa **đúng hai dòng**:

```dotenv
SECRET_KEY=<dán chuỗi sinh ở dưới>
EXPOSE_NGINX_PORT=8090
```

Sinh `SECRET_KEY`:

```bash
openssl rand -base64 42
```

> **Vì sao 8090 chứ không phải 80?** Cổng 80 trên macOS rất hay bị ứng dụng khác chiếm, và triệu
> chứng khi đó rất khó hiểu. Dùng 8090 để mọi máy giống nhau. **Con số này xuất hiện lại ở B2.4 —
> phải khớp.**

Khởi động:

```bash
docker compose up -d
```

Lần đầu tải image mất vài phút. Kiểm tra mọi container đã `Up`:

```bash
docker compose ps
```

Mở **http://localhost:8090/install** → tạo tài khoản admin.

Sau đó vào **Settings → Model Provider** thêm API key của LLM (OpenAI/Anthropic/…) — không có bước
này thì workflow không chạy được.

#### B2.3 Bật khoá cố định cho Dify (khuyến nghị)

Cách này cho một khoá **không hết hạn**, khỏi phải lấy lại token mỗi tiếng.

Mở lại `~/dify/docker/.env`, thêm:

```dotenv
ADMIN_API_KEY_ENABLE=true
ADMIN_API_KEY=<tự đặt một chuỗi dài bất kỳ>
```

Khởi động lại:

```bash
cd ~/dify/docker && docker compose restart api
```

Lấy workspace id — mở Dify trên trình duyệt (đã đăng nhập), rồi mở tab mới vào:
`http://localhost:8090/console/api/workspaces/current` → copy giá trị `id`.

#### B2.4 Nối Builder vào Dify

```bash
cd ~/dify-projects
cp apps/builder/.env.example apps/builder/.env
```

Mở `apps/builder/.env`, bỏ `#` và điền:

```dotenv
DIFY_CONSOLE_URL=http://localhost:8090/console/api
DIFY_CONSOLE_TOKEN=<ADMIN_API_KEY vừa đặt ở B2.3>
DIFY_WORKSPACE_ID=<id vừa lấy ở B2.3>
```

> **`8090` ở đây phải trùng `EXPOSE_NGINX_PORT` ở B2.2.** Đây là chỗ sai nhiều nhất.
> Nếu bạn dùng token trình duyệt (B1) thay vì `ADMIN_API_KEY` thì **để trống `DIFY_WORKSPACE_ID`**.

**Tắt app rồi mở lại.** Giờ chọn「セルフホスト」ở bước cuối là app tự đẩy vào Dify.

Lệnh Dify hằng ngày:

```bash
cd ~/dify/docker
docker compose stop      # dừng, giữ dữ liệu
docker compose start     # chạy lại
docker compose down -v   # ⚠️ xoá sạch dữ liệu
```

---

## C. Windows

Windows chạy qua **WSL2** (một Linux nhẹ bên trong Windows). Mở PowerShell:

```powershell
wsl --install
```

Khởi động lại máy. *(Nếu bạn đã cài Docker Desktop thì WSL2 có sẵn rồi, bỏ qua bước này.)*

Mở **Ubuntu** từ Start Menu, rồi làm **y hệt phần A**, không sửa gì.

> ⚠️ **Bắt buộc**: clone repo vào `~/dify-projects` (bên trong WSL), **không** để ở `/mnt/c/...`.
> Để ở `/mnt/c` thì mọi thứ chậm tới mức bạn tưởng máy treo.

Chạy hằng ngày: double-click `scripts/update-and-run.bat`, rồi mở trình duyệt Windows vào
**http://127.0.0.1:4123**.

---

## D. Dùng hằng ngày

**Chỉ một thao tác**: double-click `scripts/update-and-run.command` (Windows: `.bat`).

Nó tự lấy bản mới nhất, tự cập nhật những gì cần, rồi mở app. Bạn **không cần** chạy lại
`bootstrap.sh`, kể cả khi có bản Node mới — nó tự lo.

---

## E. Khi có trục trặc

**Chạy đúng một lệnh này trước khi hỏi ai:**

```bash
cd ~/dify-projects && ./scripts/doctor.sh
```

Nó in bảng ✅/❌ cho mọi thứ, và mỗi dòng ❌ kèm **đúng một lệnh** để sửa. Nếu vẫn không xong,
**copy toàn bộ output đó** gửi người phụ trách — có nó thì chẩn đoán được ngay, không có thì phải
hỏi qua hỏi lại.

Lệnh này chạy được cả khi máy chưa cài gì.

### Vài lỗi thường gặp

| Hiện tượng | Nguyên nhân | Cách sửa |
|---|---|---|
| Double-click nhưng không có gì xảy ra | macOS chặn file tải từ mạng | Chuột phải file → **Open** → **Open** |
| Terminal hiện rồi tắt ngay | Chưa chạy `bootstrap.sh` | Chạy `./scripts/doctor.sh` |
| Trình duyệt báo không kết nối được | App chưa khởi động xong, hoặc Terminal đã bị đóng | Chờ 30 giây; vẫn không thì mở lại `update-and-run.command` |
| Import vào Dify báo 401 / cần `DIFY_CONSOLE_URL` | Token hết hạn, hoặc cổng trong `.env` không khớp cổng Dify | Đối chiếu B2.4 với B2.2 — hai số phải giống nhau |
| Bấm build thì báo chưa đăng nhập Claude | Phiên đăng nhập hết hạn | Ô đăng nhập tự hiện trong app — làm theo A3. Prompt vừa gõ vẫn còn trong khung soạn |
| Dify không mở được ở `localhost:8090` | Container chưa chạy | `cd ~/dify/docker && docker compose ps` |

---

## Phụ lục — cái này KHÔNG cài gì lên máy bạn

Để bạn yên tâm:

- Node và Python nằm trong `~/dify-projects/.toolchain/`, **không** cài vào hệ thống, **không** sửa
  `.zshrc`/`.bashrc`, **không** đổi `PATH` chung. Các dự án khác của bạn không bị ảnh hưởng.
- Chiều ngược lại cũng đã được xử lý: app **bỏ qua** các biến môi trường của máy bạn
  (`NODE_ENV`, `PYTHONPATH`, `PYTHONHOME`…) khi chạy, nên cấu hình bạn đặt cho dự án khác
  không làm hỏng app này.
- Gỡ sạch toàn bộ: `rm -rf ~/dify-projects` (và `rm -rf ~/dify` nếu có dựng Dify local).
- `apps/builder/.env` chứa token và **không bao giờ** được commit lên git.
