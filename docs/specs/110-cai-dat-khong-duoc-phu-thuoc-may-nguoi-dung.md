# Spec 110 — Cài đặt không được phụ thuộc vào máy người dùng

> **Status**: **mở**, chưa implement. Lập 2026-08-25, viết lại 2026-08-25 sau phản hồi thực địa của user.
>
> Xuất phát từ trải nghiệm thật, không phải suy đoán. User đã setup một lượt và mất **rất nhiều
> thời gian**, với nguyên văn ba triệu chứng:
>
> > *"máy user đang setting các bản version khác nhau cho các dự án khác nhau, đồng thời việc
> > không biết nên setup từ nguồn nào, bỏ vào thư mục nào vvv... dẫn đến 1 loạt các vấn đề"*
>
> Ba triệu chứng đó **không phải ba lỗi kỹ thuật**. Chúng là **ba quyết định mà script đang bắt
> user tự đưa ra** — và user không có cơ sở nào để trả lời. §1.3–1.5 chỉ ra đúng dòng làm việc đó.
>
> Phạm vi — **năm lát, một nguyên tắc**:
> **S1** toolchain nằm trong repo (`.toolchain/`, prebuilt, không cài) · **S2** launcher tự dựng PATH ·
> **S3** `doctor.sh` — một lệnh, một bảng, lệnh sửa kèm theo · **S4** gộp tài liệu thành một lõi
> chung + một module Dify tuỳ chọn · **S5** launcher chỉ cài/build khi có gì đó thật sự đổi.
>
> **Không chạm**: mọi trình quản lý phiên bản — mise/nvm/pyenv/asdf/brew (§5 **N4**, đã cân nhắc và
> **loại**) · đóng gói Builder vào Docker (§5 **N1**, đã phân tích lại và **hoãn có điều kiện**) ·
> Windows **native** (§5 N2 — Windows đi qua WSL2) · bản sạch/sparse-checkout của
> [074](074-release-split-hai-repo.md) (trực giao: 074 quyết *user thấy file nào*, 110 quyết
> *máy user chạy được không*) · mọi thứ trong `apps/builder/server/**` (§5 N3).

---

## 0. Nguyên tắc — user chốt 2026-08-25

> **User không được phải đưa ra một quyết định nào về toolchain.**
> Không chọn nguồn, không chọn thư mục, không biết bản nào đang active, không gõ một số phiên bản nào.

Đây là phát biểu mạnh hơn bản đầu của spec ("máy phải chạy đúng phiên bản"), và mạnh hơn có chủ ý:
ghim được phiên bản mà vẫn bắt user chọn *cài từ đâu, để ở đâu* thì **chưa chữa được cái đã làm
user mất thời gian**.

### Ba quyết định phải biến mất

| Câu hỏi user từng phải tự trả lời | Nguồn cơn trong repo | Sau spec này |
|---|---|---|
| **Cài từ nguồn nào?** | [`setup.sh:174`](../../scripts/setup.sh:174) chỉ `warn` kèm một URL rồi đi tiếp; [`setup-node.sh:21`](../../scripts/setup-node.sh:21) in *"install Node.js 22.6+"* rồi `exit 1` | **Một** nguồn, hardcode trong script, verify bằng checksum đã ghim. User không chọn. |
| **Bỏ vào thư mục nào?** | không có câu trả lời ở đâu cả | `<repo>/.toolchain/`. Luôn luôn. Không hỏi. |
| **Bản nào đang active?** | `command -v node` / `python3` — lấy bất kỳ bản nào máy đó đang trỏ tới | **Không còn khái niệm "active"**. Launcher tự set `PATH` cho tiến trình của chính nó. |

### Hệ quả — thước đo của cả spec

| Trước | Sau |
|---|---|
| Doc liệt kê 4 tiền đề (Python 3.12+, Node 20.6+, Claude CLI, Dify) và **giao user tự lo** | Doc liệt kê **2**: `git` + một lệnh |
| Phiên bản sai ⇒ hỏng **muộn**, giữa một build, bằng lỗi không liên quan | Phiên bản sai **không xảy ra được**; sai thì **dừng ngay tại chỗ** với một câu chỉ dẫn |
| Repo im lặng dùng node/python của dự án khác trên máy đó | Repo **không nhìn thấy** node/python của dự án khác, và ngược lại |

### Ba quyết định chốt kèm (2026-08-25)

- **Không dùng trình quản lý phiên bản nào.** Bản đầu của spec đề xuất `mise`; **đã rút** — §5 N4.
- **Docker**: hoãn, nhưng lý do đã được viết lại sau khi soi code (§5 N1) — phản đối cũ ("repo
  private ⇒ phải `docker login ghcr.io`") **sai** và đã rút.
- **OS**: macOS + Windows, Windows **qua WSL2**, không native — §3 và §5 N2.

---

## 1. Vấn đề

### 1.1 Một câu

Repo ghim phiên bản ở **CI** và ở **`package.json`**, nhưng trên máy user thì không ghim gì — nó chỉ
**kiểm tra rồi than phiền**, và ở hai nhánh thì **im lặng đi tiếp bằng phiên bản sai**.

### 1.2 `[ĐO code]` Bốn tầng nói bốn chuyện khác nhau về cùng một phiên bản

| Tầng | Nói gì | Ở đâu |
|---|---|---|
| CI | python `3.12`, node `22` | `.github/workflows/ci.yml:26, 69` |
| `package.json` (cả backend lẫn web) | `"node": ">=22.6"` | `apps/builder/package.json`, `apps/builder/web/package.json` |
| Tài liệu phát cho user (`Builder_Guide_JA`) | **"Node.js 20.6+(22 推奨)"** | file .docx đang phát |
| Máy user | **không ghim gì** — chỉ `command -v node` rồi `exit 1` | [`setup-node.sh:21`](../../scripts/setup-node.sh:21) |

Dòng thứ ba là một **lời mời hỏng máy**: doc cho phép một phiên bản mà chính app từ chối. Người làm
đúng theo doc, cài Node 20.6, dựng được repo rồi gặp lỗi ở chỗ khác.

### 1.3 `[ĐO]` Nhánh không-có-`uv` của `setup.sh` tạo ra một venv **hỏng**

`setup.sh` đi đúng hướng cho Python: ưu tiên `uv`, và `uv venv --python 3.12` **tự tải Python 3.12
riêng** — không đụng python hệ thống ([setup.sh:185-186](../../scripts/setup.sh:185)). Nhưng khi
không có `uv`, nó **cảnh báo rồi vẫn đi tiếp** bằng `python3 -m venv .venv`
([setup.sh:174-190](../../scripts/setup.sh:174)):

```
warn "uv not found. Install it: ..."
warn "Falling back to system python3 + pip (may need Python 3.11+)"
```

`[ĐO]` Trên macOS nguyên bản, `python3` là **3.9.6** (`/usr/bin/python3 --version`, máy tác giả).
`[ĐO]` Ba gói đã khoá trong `requirements.txt` **không cài được** trên 3.9 — đọc từ metadata của
chính `.venv` hiện tại:

| Gói (pin trong `requirements.txt`) | `Requires-Python` |
|---|---|
| `pytest==9.1.1` | `>=3.10` |
| `pre-commit==4.6.0` | `>=3.10` |
| `check-jsonschema==0.37.3` | `>=3.10` |

Nhánh fallback **không** cho ra môi trường "kém hơn nhưng chạy được" — nó cho ra một `pip install`
gãy, sau một dòng `warn` vàng đã trôi khỏi màn hình. Chữ *"may need Python 3.11+"* cũng sai chiều:
không phải *may*, mà là **chắc chắn hỏng**.

> **Đây chính là triệu chứng "mỗi dự án một version" của user.** Máy đang để `pyenv` ở 3.9 cho một
> dự án khác ⇒ venv lặng lẽ thành 3.9 ⇒ hỏng **rất xa** chỗ gây ra. Không ai truy ngược được từ lỗi
> `pip` về một dòng `warn` đã trôi mất.

> `[ĐO]` Nói rõ để không sửa nhầm: 6 script phase (`find.py`, `lint_refs.py`, `validate_workflow.py`,
> `lint_plugin_hashes.py`, `lint_node_bodies.py`, `generate_id.py`) **parse được** trên 3.9 (thử
> `ast.parse` cả 6 bằng `/usr/bin/python3`). Chỗ gãy là **cài deps**, không phải cú pháp.
> Đừng đi sửa cú pháp.

### 1.4 `[ĐO]` Node: không có nhánh nào tự lo được, và cửa kiểm tra quá lỏng

```bash
# scripts/setup-node.sh:21
command -v node >/dev/null 2>&1 || { echo "❌ node not found — install Node.js 22.6+"; exit 1; }
```

Kiểm **sự tồn tại**, không kiểm **phiên bản**. Hệ quả có hai mức, mức sau tệ hơn:

- `nvm` đang ở node 18 cho dự án khác ⇒ chết ngay, kèm một câu bắt user tự đi cài (quyết định #1 và #2).
- `nvm` đang ở node 20 ⇒ **qua được cửa này**, rồi chết lúc build hoặc lúc chạy, ở một lỗi không
  nhắc gì tới phiên bản.

`py.sh` có cùng hình dạng: [`scripts/py.sh`](../../scripts/py.sh) fallback về `python3` hệ thống.
Ở đó fallback là **cố ý và đúng** (CI chạy `setup.sh --skip-venv` + `uv pip install --system`), nên
giữ — nhưng phải nói rõ trong spec để lần sau không ai gỡ nhầm.

### 1.5 `claude` và PATH — chỗ hỏng thứ hai, khó chẩn đoán hơn

`[ĐO code]` Builder gọi `spawn('claude', args, …)`
([claude-session.ts:175](../../apps/builder/server/lib/claude-session.ts:175)) — **tra theo PATH**,
không phải đường dẫn tuyệt đối. `turn-runner.ts:104-109` bắt ENOENT và nói đúng câu ("is the
`claude` CLI installed?"), nhưng chỉ **sau khi** user đã bấm build.

PATH lúc `update-and-run.command` chạy **không nhất thiết** là PATH trong Terminal của user: `nvm` và
`fnm` là **hàm shell**, nạp từ file rc; một script mở từ Finder chỉ thấy PATH mà tiến trình cha đã
export. Đây là loại lỗi "trên máy tôi chạy được" đắt nhất để chẩn đoán từ xa.

⇒ Cách chữa triệt để không phải dặn user sửa rc, mà là **launcher tự dựng PATH của chính nó** (S2),
không đọc của ai cả.

### 1.6 Hai tài liệu đang lệch nhau ở đúng chỗ user sẽ làm theo

| Nói gì | Ở đâu |
|---|---|
| Web Dify ở **cổng 80** ⇒ `http://localhost` | `SETUP-DIFY-LOCAL.md` §3, `EXPOSE_NGINX_PORT=80` |
| Ví dụ điền `.env`: `DIFY_CONSOLE_URL=http://localhost:8090/console/api` | `Builder_Guide_JA` §3 |

Người làm đủ cả hai doc sẽ dựng Dify ở `:80` rồi trỏ Builder vào `:8090`. Triệu chứng đúng bằng dòng
đầu trong bảng lỗi của chính guide đó ("インポートで needs DIFY_CONSOLE_URL..." / 401) — guide đang
**tự tạo ra** lỗi mà nó dạy cách sửa.

### 1.7 `[ĐO]` Mỗi máy user là một chỗ build, chạy lại từ đầu **mỗi lần khởi động**

[`update-and-run.command:50`](../../scripts/update-and-run.command:50) gọi `./scripts/setup-node.sh`
ở **mọi lần mở app**, tức `npm install` + `tsc` + `vite build`, trên mọi máy, mọi lần.

`[ĐO]` Cái giá của khối đó:

| Đo gì | Số | Cách đo |
|---|---|---|
| `node_modules` backend | **49 MB** | `du -sh apps/builder/node_modules` |
| `node_modules` web | **93 MB** | `du -sh apps/builder/web/node_modules` |
| Output sinh ra | **1.3 MB** (`dist` 972K + `web/dist` 308K) | `du -sh apps/builder/dist apps/builder/web/dist` |
| Gói có **install script** (mỗi lock) | **2** — `esbuild`, `fsevents` | `grep -B6 '"hasInstallScript": true' package-lock.json` |
| `dist/` có được commit không | **Không** (0 file) | `git ls-files apps/builder/dist apps/builder/web/dist` |

142 MB toolchain chạy trên máy người khác để sinh 1.3 MB, trong đó `esbuild` có postinstall tải
binary theo nền tảng và `fsevents` là native macOS — **đúng loại "máy này chạy được, máy kia không"**.

Hai điều khác nhau, đừng gộp:

- **Phiên bản node không đồng nhất** ⇒ chữa bởi S1.
- **Cài + build lặp vô ích mỗi lần mở app** ⇒ chữa bởi S5 (rẻ). Xoá hẳn việc build khỏi máy user là
  chuyện khác và **không làm trong spec này** — §5 N5, có lý do và có mốc mở lại.

---

## 2. Các lát

### S1 — Toolchain nằm **trong repo**, và không "cài" gì cả

Nguyên tắc: **không ai cần "cài" Node hay Python.** Cả hai đều có bản **prebuilt** — tải về, giải
nén, chạy. Bỏ hẳn bước "cài" thì cả ba quyết định ở §0 biến mất cùng lúc, và mặt hỏng còn lại **chỉ
còn một câu hỏi**: tải được hay không.

**Thêm `scripts/bootstrap.sh`** — cửa vào duy nhất của một máy mới:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TC="$ROOT/.toolchain"

NODE_VERSION=22.21.1          # [cần chốt] xem §6 Q1 — phải ≥ engines của CẢ HAI package.json
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  PLAT=darwin-arm64 ;;
  Darwin-x86_64) PLAT=darwin-x64  ;;
  Linux-x86_64)  PLAT=linux-x64   ;;
  Linux-aarch64) PLAT=linux-arm64 ;;
  *) echo "❌ nền tảng chưa hỗ trợ: $(uname -s)-$(uname -m)"; exit 1 ;;
esac

# 1. Node — tarball CHÍNH THỨC từ nodejs.org, verify sha256 theo checksum đã ghim trong repo
if ! "$TC/node/bin/node" --version 2>/dev/null | grep -qx "v$NODE_VERSION"; then
  rm -rf "$TC/node"; mkdir -p "$TC/node"
  url="${NODE_MIRROR:-https://nodejs.org/dist}/v$NODE_VERSION/node-v$NODE_VERSION-$PLAT.tar.gz"
  curl -fsSL "$url" -o "$TC/node.tar.gz"
  verify_sha256 "$TC/node.tar.gz" "$ROOT/scripts/toolchain-checksums.txt" "$PLAT"   # sai ⇒ dừng
  tar -xzf "$TC/node.tar.gz" -C "$TC/node" --strip-components=1
  rm -f "$TC/node.tar.gz"
fi

# 2. uv — binary prebuilt, cài vào .toolchain/bin, KHÔNG vào ~/.local/bin, KHÔNG sửa PATH toàn cục
if [ ! -x "$TC/bin/uv" ]; then
  UV_INSTALL_DIR="$TC/bin" UV_NO_MODIFY_PATH=1 curl -fsSL https://astral.sh/uv/install.sh | sh
fi

# 3. Từ đây mọi thứ chạy bằng toolchain của repo — và chỉ trong tiến trình này
export PATH="$TC/node/bin:$TC/bin:$PATH"
"$ROOT/scripts/setup.sh"        # uv venv --python 3.12 → uv tải bản PRECOMPILED, không biên dịch
"$ROOT/scripts/setup-node.sh"
```

Bốn điểm phải giữ đúng khi implement:

- **`.toolchain/` vào `.gitignore`.** Gỡ sạch = `rm -rf .toolchain`, không để lại gì trên máy.
- **Không sửa `.zshrc`/`.bashrc`, không đụng PATH toàn cục.** User gõ `node -v` trong Terminal vẫn ra
  bản của dự án khác. `nvm`/`pyenv`/`brew` của họ **không hay biết repo này tồn tại**. Đây là điều
  kiện để chữa được triệu chứng "mỗi dự án một version" mà không bắt ai gỡ gì.
- **`verify_sha256` bắt buộc, và sai ⇒ dừng.** Checksum ghim trong `scripts/toolchain-checksums.txt`
  (4 nền tảng), lấy từ `SHASUMS256.txt` của chính release đó. Không có checksum thì `curl | tar` chỉ
  là một hình thức tin tưởng mạng.
- **`NODE_MIRROR` là cửa thoát hiểm** cho proxy công ty / SSL interception — mặt hỏng **duy nhất**
  còn lại sau S1 (§4 AC7).

**`claude` CLI — ngoại lệ có chủ ý, không đưa vào `.toolchain/`.** Nó là binary tự chứa, tự cập
nhật, và **không có xung đột phiên bản giữa các dự án** — ba lý do khiến việc ghim nó vào repo chỉ
gây hại (đánh nhau với cơ chế tự cập nhật của chính nó). `bootstrap.sh` chỉ đảm bảo nó **tồn tại**
bằng installer chính thức với thư mục mặc định (`~/.local/bin`), và **không hỏi user** thư mục nào.
S2 đưa `~/.local/bin` vào PATH của launcher.

#### Phần bắt buộc đi kèm — có `.toolchain/` mà không làm phần này thì vô nghĩa

Cung cấp bản đúng **chưa đủ**; phải làm cho bản sai **không dùng được**. Xoá các nhánh fallback:

| File | Sửa gì |
|---|---|
| [`setup.sh:174`](../../scripts/setup.sh:174) | không có `uv` ⇒ **dừng hẳn**, một câu, trỏ về `bootstrap.sh`. Không `warn` rồi đi tiếp. |
| [`setup.sh:189`](../../scripts/setup.sh:189) | **xoá** nhánh `python3 -m venv`. Không có `uv` thì không có venv (§1.3). |
| [`setup-node.sh:21`](../../scripts/setup-node.sh:21) | kiểm **phiên bản**, và kiểm node **đến từ `.toolchain/`**; sai ⇒ dừng, trỏ `bootstrap.sh`. Không bắt user tự cài. |
| [`scripts/py.sh`](../../scripts/py.sh) | **giữ nguyên** fallback — nó phục vụ CI (`--skip-venv` + `--system`), §1.4. Ghi comment để lần sau không gỡ nhầm. |
| `setup.sh --skip-venv` | **giữ** — dành cho CI và cho người biết mình đang làm gì. |

Sau đó chỉ còn hai trạng thái: **chạy đúng**, hoặc **dừng ngay với một câu chỉ dẫn**. Không còn
trạng thái thứ ba "đi tiếp bằng bản sai rồi chết ở đâu đó".

### S2 — Launcher tự dựng PATH, không đọc của shell người dùng

Sửa `scripts/update-and-run.command`, chèn ngay sau `cd` về repo root, **trước** mọi lệnh khác:

```bash
export PATH="$PWD/.toolchain/node/bin:$PWD/.toolchain/bin:$HOME/.local/bin:$PATH"
[ -x .toolchain/node/bin/node ] || ./scripts/bootstrap.sh    # máy mới, hoặc vừa bump phiên bản
```

Sau đó `node`, `npm`, `python`, `claude` đều là bản đã ghim, **bất kể** user mở bằng Finder,
Terminal hay iTerm, và bất kể rc file của họ có gì. Chữa tận gốc §1.5.

**Hệ quả đáng giá cho việc nâng cấp sau này**: dòng thứ hai so phiên bản node thực tế với số đã ghim,
lệch thì `bootstrap.sh` tự tải lại. ⇒ **Nâng Node = bạn sửa một dòng rồi commit**; máy user tự cập
nhật ở lần mở tiếp theo. Không email, không hướng dẫn, không ai phải gỡ cài lại gì.

Giữ nguyên và **đừng đụng vào**: không tự `git checkout main` (lý do đã ghi dài trong chính file
đó), nhánh `.builder-dev`, và `lsof -ti:4123 | xargs kill` ở đầu.

### S3 — `scripts/doctor.sh`: một lệnh, một bảng, lệnh sửa kèm theo

In bảng ✅/❌ cho: `.toolchain/node` (+ phiên bản vs số đã ghim) · `.toolchain/bin/uv` · `.venv`
(+ phiên bản python) · `claude` (+ đã login chưa) · `skills/` · `corpus/` · `vendor/dify-src/` ·
`apps/builder/.env` (chỉ *có hay không*, **không in giá trị token**) · cổng 4123 có ai chiếm không.
Mỗi dòng ❌ kèm **đúng một lệnh** để sửa.

Ba ràng buộc:

- **Phải chạy được khi chưa có gì cả** ⇒ bash thuần, không phụ thuộc `node_modules`, không phụ thuộc
  `.toolchain/`. Đây là công cụ chẩn đoán *một máy hỏng*, nên nó không được hỏng theo.
- **Phải phân biệt được "node của repo" và "node của máy"** — in cả hai, vì §1.4 cho thấy nhầm lẫn
  giữa hai thứ này là nguồn cơn.
- **Không lặp lại** readiness gate của server: `GET /health` đã kiểm `.venv/bin/python` + `skills/`
  ([index.ts:101](../../apps/builder/server/index.ts:101)). `doctor.sh` là phiên bản chạy được
  **trước khi** server sống. Giữ hai danh sách trùng nhau ở phần giao — lệch thì `/health` là chuẩn.

Giá trị thật: máy ở xa gặp sự cố thì xin **một** output, thay vì hỏi vòng.

### S4 — Một tài liệu: lõi chung + module Dify tuỳ chọn

Bỏ mô hình "hai doc cho hai loại user" — trùng lặp, và §1.6 cho thấy chúng **đã** lệch nhau.
Thay bằng **một** `SETUP.md`:

1. **Lõi chung** (mọi người): `git clone` → `./scripts/bootstrap.sh` → `claude auth login` →
   double-click `update-and-run.command` → `http://127.0.0.1:4123`.
   Nhóm **không dùng Dify local** dừng ở đây: chọn デプロイ「なし」, YAML nằm ở
   `projects/<tên>/workflows/main.yml`, import tay vào Dify Studio. **Không cần `.env`.**
2. **Module tuỳ chọn "Kết nối Dify"**, hai nhánh:
   - **Dify Cloud** — chỉ cần URL + token.
   - **Dify Local** — nội dung `SETUP-DIFY-LOCAL.md` hiện tại, **sửa §1.6**: chốt một cổng duy nhất,
     và để ví dụ `DIFY_CONSOLE_URL` **suy ra từ chính cổng đó**, không phải một số khác.

Sửa luôn trong lúc gộp: "Node.js 20.6+" **biến mất hoàn toàn** — doc mới **không chứa một số phiên
bản nào**, vì user không còn phải biết (§0). Mục 必要なもの rút còn `git` + một lệnh.

### S5 — Launcher chỉ cài/build khi có gì đó thật sự đổi

§1.7: hiện `setup-node.sh` chạy đủ `npm install` + 2 build ở **mọi** lần mở app. Sửa thành:

- **Cài**: so hash của `package-lock.json` (cả hai) với stamp ở `.toolchain/.npm-stamp`. Khác ⇒
  chạy **`npm ci`** (tất định, đúng lockfile) rồi ghi stamp. Giống ⇒ bỏ qua.
- **Build**: bỏ qua khi không file nguồn nào mới hơn output tương ứng trong `dist/`.
- `--force` để bỏ qua cả hai kiểm tra khi cần.

Hai cái lợi, cái thứ hai quan trọng hơn: mở app hằng ngày nhanh hơn hẳn, và `npm install` (có thể
trôi khỏi lockfile) được thay bằng `npm ci` (không thể) — **mà chỉ chạy khi lockfile thật sự đổi**,
nên không phải trả giá "xoá sạch rồi cài lại" mỗi lần.

---

## 3. Windows — qua WSL2, và chỉ WSL2

`[ĐO code]` Repo hiện **không có** một dòng nào cho Windows: không `.bat`, không `.ps1`; toàn bộ
setup là bash (`setup.sh`, `setup-node.sh`, `update-and-run.command`, hook pre-commit), và
permission-gate của Builder **parse cú pháp bash** để quyết định cho phép/từ chối
([`server/hooks/permission-gate.ts`](../../apps/builder/server/hooks/permission-gate.ts)). Port sang
shell Windows là port **cả tầng an toàn** — không đáng.

Nên: **WSL2 là đường Windows duy nhất.**

- Nhóm dùng **Dify local** đã phải cài WSL2 cho Docker Desktop (`SETUP-DIFY-LOCAL.md` §1) ⇒ chi phí
  thêm ≈ 0.
- Nhóm **không** dùng Dify local: thêm một bước `wsl --install`. Bên trong WSL2, `bootstrap.sh` chạy
  **không sửa một dòng nào** — nó đã có nhánh `Linux-x86_64` (S1).
- Thêm `scripts/update-and-run.bat` để double-click từ Windows: gọi
  `wsl -d <distro> -- ./scripts/update-and-run.sh`. ⇒ tách phần thân của `.command` ra
  `scripts/update-and-run.sh` để `.command` (macOS) và `.bat` (Windows) **dùng chung một bản thân**,
  không phải hai bản đi lệch nhau theo thời gian.
- **Cảnh báo bắt buộc có trong doc**: repo phải nằm **trong** filesystem của WSL (`~/dify-projects`),
  **không** đặt ở `/mnt/c/...` — `npm install`/`git` trên `/mnt/c` chậm tới mức người ta tưởng treo.

`[GIẢ THUYẾT]` Trình duyệt Windows mở được `http://127.0.0.1:4123` nhờ localhost-forwarding của WSL2
— **chưa tự kiểm trên máy Windows thật**. Đây là điều kiện *sống còn* của cả nhánh Windows (Builder
bind cứng `127.0.0.1`, [index.ts:80](../../apps/builder/server/index.ts:80), không cho đổi) ⇒ **phải
kiểm trước khi viết doc**, không phải sau. Nếu sai, nhánh Windows phải đi Docker (§5 N1) thay vì WSL2.

---

## 4. Nghiệm thu

Chuẩn duy nhất, và phải chạy trên **máy sạch** (VM hoặc user mới), không phải máy tác giả:

1. macOS chưa từng có node/python/uv/claude: `git clone` → `./scripts/bootstrap.sh` →
   `claude auth login` → double-click `update-and-run.command` → build được một workflow.
   **Không** cài gì thêm bằng tay, **không** cần quyền admin.
2. **Máy đã có sẵn node 18 và pyenv 3.9 đang active** (mô phỏng đúng máy user, §0): vẫn chạy đúng.
   Và sau khi chạy xong, trong Terminal của user `node -v` **vẫn là 18**, `python3 -V` **vẫn là 3.9**
   — repo không đụng gì tới các dự án khác.
3. `./scripts/doctor.sh` trên máy sạch chưa bootstrap: mọi dòng đỏ, mỗi dòng một lệnh sửa; chạy đúng
   các lệnh đó ⇒ mọi dòng xanh. Không in token.
4. `setup.sh` trên máy **không có `uv`**: **dừng**, một câu, trỏ `bootstrap.sh` — không còn tạo venv
   3.9 rồi gãy ở `pip install` (§1.3).
5. Sửa `NODE_VERSION` trong `bootstrap.sh` rồi mở lại launcher ⇒ **tự tải bản mới**, không cần user
   làm gì (S2).
6. Mở launcher **hai lần liên tiếp không đổi gì**: lần hai **không** chạy `npm ci`, **không** build
   lại (S5).
7. `bootstrap.sh` với checksum cố tình sai ⇒ **dừng**, không giải nén. Với `NODE_MIRROR` trỏ một
   thư mục local ⇒ chạy được, không cần internet ra nodejs.org (S1).
8. Windows/WSL2: lặp lại (1) trong WSL2; trình duyệt Windows mở được `127.0.0.1:4123` (§3).
9. Đọc `SETUP.md` từ đầu tới cuối: không có cổng nào mâu thuẫn cổng khác (§1.6), và **không có một
   số phiên bản nào** (§0/S4).

Repro cho §1.3 và §1.7 (chạy được ngay, không cần máy sạch):

```bash
/usr/bin/python3 --version                       # 3.9.6 trên macOS nguyên bản
grep -E '^(pytest|pre-commit|check-jsonschema)==' requirements.txt
grep -i '^Requires-Python' .venv/lib/python3.12/site-packages/pytest-*.dist-info/METADATA
du -sh apps/builder/node_modules apps/builder/web/node_modules apps/builder/dist apps/builder/web/dist
grep -B6 '"hasInstallScript": true' apps/builder/package-lock.json | grep '"node_modules/'
git ls-files apps/builder/dist apps/builder/web/dist | wc -l    # 0 ⇒ dist không được commit
```

---

## 5. Non-goals — và vì sao

### N4 — Không dùng trình quản lý phiên bản nào (mise / nvm / pyenv / asdf / brew): **loại**

Bản đầu của spec đề xuất `mise`. **Đã rút sau phản hồi thực địa của user.** Lý do:

- Mọi trình quản lý phiên bản đều **thêm một thứ phải cài, và một cấu hình phải hiểu** — đúng loại
  chi phí user vừa nói là đã ngốn rất nhiều thời gian. Nó **cũng chỉ tải prebuilt** như S1, nhưng qua
  một lớp trung gian có cache riêng, settings riêng, backend riêng.
- Riêng với Python, backend của các công cụ này theo truyền thống là **`python-build`/pyenv — biên
  dịch từ nguồn**, cần Xcode CLT + openssl + readline đúng bản. `[GIẢ THUYẾT]` mise đời mới có thể đã
  mặc định dùng bản precompiled — **nhưng không cần biết**: S1 giao Python cho `uv`, vốn **luôn** tải
  bản precompiled. Thiết kế để **không phải trả lời câu hỏi này** thì tốt hơn là trả lời đúng nó.
- `nvm`/`fnm` là **hàm shell**, và §1.5 cho thấy hàm shell chính là thứ launcher không nhìn thấy.
- `brew` bản thân nó là một hệ phải bảo trì, và cài **toàn cục** — vi phạm điều kiện "không đụng dự
  án khác" (§0, AC2).

Với **2 công cụ** và **1 repo**, tự tải thẳng ít mặt hỏng hơn một công cụ quản lý. Nếu sau này repo
cần 5-6 toolchain thì tính lại — **mốc mở lại**: khi số thứ phải ghim vượt quá 3.

### N1 — Đóng gói Builder vào Docker: **hoãn có điều kiện**, không phải bỏ

Đã phân tích lại bằng code (2026-08-25), và **rút một phản đối cũ vì nó sai**: bản đầu viết "repo
private ⇒ user phải `docker login ghcr.io` bằng PAT". Sai — user **đã có repo qua `git clone`**, nên
`docker compose up --build` **build image tại chỗ**, không cần registry, không cần PAT.

Cái Docker thật sự xoá được: toàn bộ §1.7 (142 MB + 2 install script + build) chuyển vào image, chạy
trong **một Linux cố định giống hệt nhau trên mọi máy**. Cộng thêm: nhóm Dify-local cho container
join chung network với Dify ⇒ `DIFY_CONSOLE_URL=http://nginx/console/api`, hết sạch §1.6.

**Bốn ràng buộc `[ĐO code]` khiến nó không rẻ như tưởng:**

1. **`.venv` bắt buộc nằm trong repo, không nướng vào image được.** `/health` kiểm
   `.venv/bin/python` **tương đối với `DIFY_PROJECTS_DIR`** ([index.ts:101](../../apps/builder/server/index.ts:101)),
   và permission-gate hardcode đúng chuỗi `.venv/bin/python` là interpreter **duy nhất** một turn
   được chạy ([permission-gate.ts:174](../../apps/builder/server/hooks/permission-gate.ts:174)).
   Repo phải bind-mount (user cần thấy `projects/`), mà bind mount **che** mọi thứ image đặt ở đó ⇒
   venv phải tạo *trong* mount lúc chạy. Thêm nữa venv macOS (host) và venv Linux (container) **cùng
   đường dẫn, không dùng chung được**.
2. **`claude` phải sống trong image và phải login lại trong đó** — `spawn('claude')` tra PATH
   ([claude-session.ts:175](../../apps/builder/server/lib/claude-session.ts:175)); credential macOS
   có thể ở Keychain, không mount sang container Linux được.
3. **`setup.sh` vẫn phải chạy** — nó clone `vendor/dify-src`, `skills/`, `corpus/` **vào repo**.
   Đó là *nội dung*, không phải toolchain; nằm trong mount; Docker không giúp gì.
4. **Nhóm không dùng Dify phải cài Docker Desktop** (~1.5 GB + máy ảo + WSL2/virtualization) chỉ để
   chạy Builder — một cài đặt "mỗi máy hỏng một kiểu" y hệt cái spec này đang muốn thoát.

**Phán quyết theo nhóm** (khác nhau, và đây là điểm chính):

- **Nhóm dùng Dify local**: Docker **thắng rõ** — họ đã có Docker, không thêm prerequisite nào.
- **Nhóm không dùng Dify**: Docker là **bước lùi** — S1 chỉ tải ~250 MB prebuilt, không máy ảo.

**Mốc mở lại** (một trong hai là đủ): (a) việc build trên máy user gãy **thật** dù đã có S1+S5 —
không phải khi đoán là sẽ gãy; (b) nhóm Dify-local vượt quá nhóm kia đủ xa để chỉ nuôi một đường.

**Câu hỏi chặn trước khi mở lại**: Docker Desktop yêu cầu **license trả phí** cho tổ chức >250 người
hoặc >$10M doanh thu. Chưa xác nhận cho Vitalify (§6 Q4).

### N5 — Ship bản dựng sẵn (bỏ hẳn build khỏi máy user): **không làm trong spec này**

Hấp dẫn (§1.7), nhưng repo **private** ⇒ không có kênh phát hành nào không cần auth, ngoài chính
`git`. Nghĩa là phải **commit `dist/` vào repo** — 1.3 MB mỗi lần build, diff noise, và merge
conflict trên file sinh tự động ở mỗi nhánh. Giá đó do tác giả trả hằng ngày, để đổi lấy thứ mà S5 +
node đã ghim (S1) đã lấy được phần lớn.

**Mốc mở lại**: khi `npm ci` dưới node đã ghim vẫn gãy trên máy user (tức S1+S5 không đủ), hoặc khi
074 (bản sạch) tạo ra một kênh phát hành riêng — lúc đó `dist/` đi theo kênh đó, không cần vào git.

### N2 — Windows native: **không làm** (§3). Windows = WSL2.

### N3 — Không đụng `apps/builder/server/**`

Spec này là tầng cài đặt. `/health` đang đúng việc của nó và giữ nguyên (S3).

---

## 6. Câu hỏi để ngỏ

1. **`NODE_VERSION` chính xác là bao nhiêu?** `[GIẢ THUYẾT]` `22.21.1` — **chưa kiểm được**
   (không có mạng lúc soạn spec). Phải đọc `https://nodejs.org/dist/index.json`, lấy bản **LTS mới
   nhất của dòng 22**, kiểm `≥ 22.6` (engines của cả hai `package.json`), rồi ghim cùng 4 checksum.
   **Ghim chính xác chứ không theo dải** — cả điểm của spec là *hai máy giống nhau*.
2. **Cờ chính xác của installer `uv`** (`UV_INSTALL_DIR` / `UV_NO_MODIFY_PATH`): `[GIẢ THUYẾT]`,
   chưa chạy thử. Phải xác nhận lúc implement — nếu installer không cho chọn thư mục thì tải thẳng
   binary từ GitHub release của astral thay vì qua script.
3. **`bootstrap.sh` có nên tự cài `claude` không**, hay chỉ kiểm và in lệnh? Đề xuất: **tự cài, nhưng
   hỏi một lần** — `curl | bash` chạy im lặng lên máy người khác là thứ không nên bình thường hoá.
4. **Quy mô Vitalify** — quyết định N1 có mở lại được không (license Docker Desktop).
5. **`NODE_VERSION` và `engines` phải khớp** — kiểm bằng CI hay bằng mắt? Rẻ nhất: một bước trong
   `ci.yml` so hai con số, lệch thì đỏ. Cùng chỗ đó kiểm luôn `SETUP.md` không chứa số phiên bản nào.

---

## 7. Effort

| Lát | Ước lượng |
|---|---|
| S1 `bootstrap.sh` + checksum 4 nền tảng + hardening 3 script | 4-5h |
| S2 launcher (tách `update-and-run.sh` dùng chung + `.command` + `.bat`) | 2h |
| S3 `doctor.sh` | 2h |
| S4 gộp tài liệu (bỏ số phiên bản + chốt một cổng) | 2h |
| S5 stamp lockfile + `npm ci` + bỏ build thừa | 1.5h |
| Nghiệm thu trên máy sạch (macOS VM có sẵn node 18 + pyenv 3.9, và WSL2) | 2-3h |

**Tổng: ~M — khoảng 2 ngày.** N1 (Docker) nếu mở lại sau: thêm 2-2.5 ngày, và khi đó phải nuôi
**hai** đường setup song song.
