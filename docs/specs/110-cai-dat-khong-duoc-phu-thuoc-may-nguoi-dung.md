# Spec 110 — Cài đặt không được phụ thuộc vào máy người dùng

> **Status**: **ĐÃ SHIP** 2026-08-27 — S1–S7 đều đã implement và chạy thật trên máy tác giả.
> Kết quả nghiệm thu ở **§9**. Lập 2026-08-25, viết lại sau phản hồi thực địa, ship 2026-08-27.
> Đóng spec bằng `/spec-close 110` (đừng `rm` tay — xem `docs/specs/README.md`).
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
> Phạm vi — **bảy lát, một nguyên tắc**:
> **S1** toolchain nằm trong repo (`.toolchain/`, prebuilt, không cài) · **S2** launcher tự dựng PATH ·
> **S3** `doctor.sh` — một lệnh, một bảng, lệnh sửa kèm theo · **S4** gộp tài liệu thành một lõi
> chung + một module Dify tuỳ chọn · **S5** launcher chỉ cài/build khi có gì đó thật sự đổi ·
> **S6** vệ sinh biến môi trường + khoá chống chạy chồng · **S7** bỏ clone Dify source khỏi đường user.
>
> **Vòng review 2026-08-25** (sau khi user hỏi "có xung đột trên máy user không") tìm ra §1.8 và §1.9
> và thêm S6/S7. §1.8 phủ nhận một giả định nền của bản trước — xem §8 về phạm vi chữ "tối ưu".
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

`[ĐO]` Trên macOS nguyên bản, `python3` là **3.9.6** (`/usr/bin/python3`).
`[ĐO 2026-08-27]` Và trên chính máy tác giả nó còn thấp hơn: `python3` → **3.8.18**, qua
`~/.pyenv/shims/python3` — tức bản của một dự án khác. Phát hiện khi chạy `doctor.sh` lần đầu.
Đây là §1.3 xảy ra thật, không phải kịch bản giả định: nhánh fallback sẽ tạo venv **3.8**.
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

### 1.8 `[REPRO]` Biến môi trường của user vẫn chui vào được — PATH riêng **không phải** là cách ly

Đây là lỗ nghiêm trọng nhất, và nó nằm ở **giả định nền của chính spec này**: *"dựng PATH riêng là
cách ly xong"*. Sai. `[ĐO]` `grep -rn "NODE_ENV\|PYTHONHOME\|PYTHONPATH\|VIRTUAL_ENV\|npm_config" scripts/`
⇒ **không một dòng nào**.

Ba repro, chạy trên máy tác giả 2026-08-25 (npm 10.9.4, macOS arm64):

```bash
# R1 — NODE_ENV=production làm npm BỎ devDependencies
$ npm config get omit                        # → (rỗng)
$ NODE_ENV=production npm config get omit    # → dev
```

`[ĐO]` Hệ quả cụ thể: `tsx` + `typescript` (backend) và `typescript` + `vite` + `vitest` +
`@preact/preset-vite` (web) **đều nằm trong `devDependencies`** — `dependencies` chỉ có `fastify`, và
`preact` + `@preact/signals`. Dưới `NODE_ENV=production`, npm bỏ hết ⇒ **cả hai build gãy**, bằng lỗi
"không tìm thấy tsc/vite" **không nhắc gì tới `NODE_ENV`**. S5 (đổi sang `npm ci`) không tạo ra lỗi
này, nhưng cũng không che nó.

```bash
# R2 — PYTHONHOME phá venv triệt để
$ PYTHONHOME=/tmp/nonexistent .venv/bin/python -c "print('venv ok')"
Current thread 0x… (most recent call first):
  <no Python frame>          # ← crash ở tầng C, không có traceback Python để lần ra
```

```bash
# R3 — PYTHONPATH tiêm được module tuỳ ý vào venv python
$ mkdir -p /tmp/pp && echo "print('DOC NHAM MODULE')" > /tmp/pp/sitecustomize.py
$ PYTHONPATH=/tmp/pp .venv/bin/python -c "pass"
DOC NHAM MODULE
```

**`~/.npmrc` cũng không bị chặn**: registry nội bộ, proxy, `strict-ssl=false`, token hết hạn — đều áp
vào `npm ci`. `[ĐO]` Máy tác giả: registry = `https://registry.npmjs.org/`, không có `~/.npmrc` —
**không suy ra được** máy user cũng vậy, và đó chính là vấn đề.

⇒ Đây là câu trả lời cho *"setup có xung đột trên máy user không"*. Phải tách **hai chiều**:

| Chiều | Trạng thái |
|---|---|
| **repo → máy user** (repo làm hỏng máy) | S1 đã an toàn: không sửa rc, không PATH toàn cục, gỡ bằng `rm -rf` |
| **máy user → repo** (máy làm hỏng repo) | **CHƯA an toàn** — R1/R2/R3 + `~/.npmrc` |

Và chiều thứ hai tệ nhất đúng ở loại máy spec này nhắm tới: máy đã cấu hình nhiều cho các dự án khác.
Chữa ở **S6**.

### 1.9 `[ĐO]` Đường của user đang clone cả source code Dify mà họ không dùng tới

`setup.sh` bước **[1/5]** clone `vendor/dify-src`. Bằng chứng cho thấy nó **thừa** với user:

| Câu hỏi | Trả lời |
|---|---|
| Ai đọc `vendor/dify-src`? | **chỉ** `schemas/gen_schema.py`. Các linter runtime chỉ nhắc tên nó trong comment/docstring |
| Ai gọi `gen_schema.py`? | `.github/workflows/refresh-schema.yml` + chạy tay. **Không có** trong `update-and-run.command` hay bất kỳ đường nào của user |
| Schema đã có sẵn chưa? | Rồi — `schemas/dify-dsl-0.6.0.json` nằm trong git (5 file tracked dưới `schemas/`) |
| `check_dsl_version.sh` có cần nó không? | Không. Và nó chỉ được gọi bởi `.pre-commit-config.yaml` — đường tác giả, không phải đường user |
| Cỡ bao nhiêu? | `[ĐO]` docstring `permission-gate.ts` ghi bản full là **8.5 GB**. `setup.sh` clone `--depth=1 --branch <tag>` nên nhỏ hơn nhiều — **chưa đo bản shallow** |

⇒ Bước **nặng nhất và dễ hỏng nhất** của bootstrap là bước user không cần.

`[ĐO]` Tin tốt: `setup.sh:103-105` **đã** tha thứ khi clone hỏng (`warn` rồi đi tiếp) ⇒ bỏ nó là thay
đổi **rủi ro thấp**. Nhưng `--skip-clones` hiện gộp cả `skills/` + `corpus/`, mà hai thứ đó **bắt
buộc** (`/health` kiểm `skills/`) ⇒ phải **tách cờ**. Chữa ở **S7**.


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

### S6 — Vệ sinh môi trường: cách ly cả `env`, không chỉ `PATH` (§1.8)

`bootstrap.sh` và launcher, ngay sau khi `cd` về repo root và **trước** mọi lệnh khác:

```bash
# Biến của máy user không được quyết định cách repo này build — §1.8 R1/R2/R3
unset NODE_ENV NODE_OPTIONS PYTHONHOME PYTHONPATH PYTHONSTARTUP VIRTUAL_ENV
unset npm_config_prefix npm_config_production
export PIP_REQUIRE_VIRTUALENV=false     # vài máy set true toàn cục → uv pip gãy
```

Ba ràng buộc:

- **`unset`, không phải `export …=<giá trị>`.** Đặt `NODE_ENV=development` là **chọn hộ** user một
  giá trị; xoá nó là trả về mặc định của npm. Ít giả định hơn, và đó là cả điểm của spec này.
- **Không đụng `~/.npmrc`** (§1.8): máy trong mạng công ty có thể **bắt buộc** đi qua registry nội bộ,
  nên ghi đè im lặng là làm hỏng máy đang chạy được. `doctor.sh` **in** `npm config get registry` để
  nhìn thấy được, và spec **không** tự quyết — xem Q6.
- Mỗi biến trong danh sách phải có **comment trỏ repro tương ứng** ngay tại chỗ. Không thì lần sau sẽ
  có người "dọn dẹp" nó đi vì trông như code thừa.

**Khoá chống chạy chồng** (cùng lát, cùng lý do "máy user làm gì cũng có thể xảy ra"): `bootstrap.sh`
và launcher lấy lockfile `.toolchain/.lock` (fallback `/tmp` khi `.toolchain/` chưa tồn tại). Đang
chạy rồi ⇒ in *"đang chạy ở cửa sổ khác"* rồi thoát, thay vì hai tiến trình cùng ghi. **User
double-click hai lần là chuyện bình thường**, nhất là lần đầu khi thấy lâu mà không có phản hồi.

### S7 — Bỏ `vendor/dify-src` khỏi đường của user (§1.9)

- Thêm cờ **`--skip-dify-src`** cho `setup.sh`, **tách khỏi** `--skip-clones` (vốn gộp cả
  skills/corpus — hai thứ bắt buộc).
- `bootstrap.sh` gọi `setup.sh --skip-dify-src`. Người cần sinh lại schema (tác giả, CI) chạy
  `setup.sh` trần như cũ ⇒ **CI không đổi**.
- Dòng cuối `setup.sh` (*"Dify source is vendored at vendor/dify-src/…"*) phải đổi theo — không thì nó
  nói dối về một thứ vừa bị bỏ.
- `gen_schema.py` **đã** in đúng câu khi thiếu nguồn (`gen_schema.py:507-513`) ⇒ giữ nguyên, không sửa.

Lát này cắt **bước mạng lớn nhất** và một mặt hỏng ra khỏi trải nghiệm lần đầu — chỗ mà người mới ít
khả năng tự gỡ nhất.


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
10. **Máy đặt sẵn `NODE_ENV=production` + `PYTHONHOME=/tmp/x` + `PYTHONPATH=/tmp/pp`**: bootstrap,
    build và chạy **vẫn đúng** (§1.8 R1/R2/R3 — S6). Đây là AC quan trọng nhất trong nhóm mới.
11. Double-click launcher **lần thứ hai trong lúc lần đầu còn đang chạy** ⇒ lần hai in "đang chạy ở
    cửa sổ khác" rồi thoát; `.toolchain/` không hỏng (S6).
12. `bootstrap.sh` trên máy sạch **không** clone `vendor/dify-src`, và vẫn build được một workflow
    hoàn chỉnh (S7).
13. Terminal chạy dưới Rosetta trên Apple Silicon ⇒ `doctor.sh` **cảnh báo** thay vì im lặng dùng bản
    Intel (§6 Q7).
14. `./scripts/doctor.sh` in `npm config get registry` hiệu lực, để một máy dùng registry nội bộ nhìn
    ra được ngay (§1.8 — S6).

Repro cho §1.3 / §1.7 / §1.8 (chạy được ngay, không cần máy sạch):

```bash
/usr/bin/python3 --version                       # 3.9.6 trên macOS nguyên bản
grep -E '^(pytest|pre-commit|check-jsonschema)==' requirements.txt
grep -i '^Requires-Python' .venv/lib/python3.12/site-packages/pytest-*.dist-info/METADATA
du -sh apps/builder/node_modules apps/builder/web/node_modules apps/builder/dist apps/builder/web/dist
grep -B6 '"hasInstallScript": true' apps/builder/package-lock.json | grep '"node_modules/'
git ls-files apps/builder/dist apps/builder/web/dist | wc -l    # 0 ⇒ dist không được commit

# §1.8 — ba repro của lỗ env (mỗi dòng tự đủ, không cần dựng gì)
npm config get omit; NODE_ENV=production npm config get omit          # (rỗng) → dev
PYTHONHOME=/tmp/nonexistent .venv/bin/python -c "print('ok')"          # crash tầng C
mkdir -p /tmp/pp && echo "print('DOC NHAM')" > /tmp/pp/sitecustomize.py
PYTHONPATH=/tmp/pp .venv/bin/python -c "pass"                          # in DOC NHAM

# §1.9 — chứng minh vendor/dify-src thừa với user
git ls-files schemas/ | wc -l                                          # 5 ⇒ schema đã commit
grep -rln "dify-src" tools/ --include='*.py'                           # chỉ trúng comment
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

### N6 — **Không** cần thêm bảo vệ `.toolchain/` trong permission-gate (đã kiểm)

Phải kiểm, vì thoạt nhìn `.toolchain/node/bin/node` là một **interpreter mới nằm trong repo** — đúng
loại mục tiêu mà gate đang bảo vệ `.venv/bin/python` khỏi bị đầu độc
([permission-gate.ts:7-15](../../apps/builder/server/hooks/permission-gate.ts:7)).

`[ĐO code]` **Không phải làm gì cả.** `pathIsProtectedWrite` là **allowlist**: nó trả `true` (được
bảo vệ) cho **mọi thứ** trừ `projects/`, `.runs/<task của chính nó>/` và `.vscode/settings.json` —
nên một đường dẫn mới trong repo **mặc định đã được bảo vệ**. Phía Bash cũng kín: `rm`/`cp`/`mv`/
`tee`/`ln` nằm trong `DENY_EXECUTABLES`, và python chỉ chạy được **script đã biết** (cấm `-c`).

⇒ **N3 vẫn đúng**: spec này không đụng `apps/builder/server/**`. Ghi lại đây để lần sau không ai đi
thêm một lớp bảo vệ thừa — và để nếu ai đó đổi `pathIsProtectedWrite` sang deny-list thì biết rằng
`.toolchain/` là một trong những thứ mất bảo vệ theo.

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
6. **`~/.npmrc` của user: nhìn thấy, hay cách ly?** (§1.8) Cách ly (`npm_config_userconfig` trỏ file
   rỗng trong repo) cho tái lập tuyệt đối, **nhưng làm hỏng máy trong mạng công ty bắt buộc đi
   registry nội bộ**. Đề xuất: **chỉ nhìn thấy** (doctor.sh in ra), và chỉ cách ly khi gặp ca thật.
   Đây là quyết định của bạn, không phải mặc định kỹ thuật.
7. **Rosetta: cảnh báo hay tự sửa?** `sysctl -n sysctl.proc_translated` trả `1` khi terminal chạy dưới
   Rosetta trên Apple Silicon (`[ĐO]` máy tác giả trả `0`, `uname -m` = `arm64` — key tồn tại và dùng
   được). Tự ép `darwin-arm64` thì nhanh hơn nhưng có thể sai nếu user cố tình chạy x64. Đề xuất:
   **cảnh báo trong `doctor.sh`**, không tự quyết.
8. **Bump Node bảo trì thế nào?** 4 checksum cho 4 nền tảng; quên một cái thì **chỉ user nền tảng đó**
   phát hiện, và phát hiện muộn. Đề xuất: `scripts/bump-node.sh` tự tải `SHASUMS256.txt` sinh lại cả
   file, + một bước CI kiểm đủ 4 dòng và khớp `NODE_VERSION`.

---

## 7. Effort

| Lát | Ước lượng |
|---|---|
| S1 `bootstrap.sh` + checksum 4 nền tảng + `bump-node.sh` + hardening 3 script | 5-6h |
| S2 launcher (tách `update-and-run.sh` dùng chung + `.command` + `.bat`) | 2h |
| S3 `doctor.sh` (kèm registry npm + cảnh báo Rosetta) | 2.5h |
| S4 gộp tài liệu (bỏ số phiên bản + chốt một cổng + sửa dung lượng) | 2h |
| S5 stamp lockfile + `npm ci` + bỏ build thừa | 1.5h |
| **S6 vệ sinh env + lockfile chống chạy chồng** | 2h |
| **S7 tách `--skip-dify-src`** | 1h |
| Nghiệm thu máy sạch (macOS VM có node 18 + pyenv 3.9 + `NODE_ENV=production`, và WSL2) | 3h |

**Tổng: ~M — khoảng 2.5 ngày.** N1 (Docker) nếu mở lại sau: thêm 2-2.5 ngày, và khi đó phải nuôi
**hai** đường setup song song.

---

## 8. Phạm vi của chữ "tối ưu"

Ghi lại để không ai đọc spec này rồi tưởng nó là phương án tốt nhất trong mọi hoàn cảnh.

**Đúng** trong khung ràng buộc đã chốt: một repo, hai toolchain, không quyền admin, không đụng dự án
khác trên cùng máy. Trong khung đó, tải prebuilt vào `.toolchain/` là phương án **ít mặt hỏng nhất** —
ít hơn mọi trình quản lý phiên bản (N4), và ít hơn Docker cho người **chưa** có Docker (N1).

**Không đúng** ở hai chỗ, và cả hai đã được đo chứ không phải phỏng đoán:

1. **`.toolchain/` cách ly `PATH`, không cách ly `env` và `~/.npmrc`** (§1.8 R1/R2/R3). S6 vá được ba
   biến đã biết, nhưng đó là **deny-list** — nó không chứng minh được là đã hết. **Docker mới là cách
   ly thật.** Ai cần bảo đảm tuyệt đối thì câu trả lời là N1, không phải spec này.
2. **Với nhóm đã có Docker (Dify-local), Docker ít mặt hỏng hơn** (N1). Tỉ lệ hai nhóm user là con số
   quyết định, và **vẫn chưa có** — xem Q4.

---

## 9. Kết quả implement (2026-08-27)

### 9.1 Đã tạo / sửa

| File | Việc |
|---|---|
| `scripts/lib/toolchain.sh` | **mới** — pin (`NODE_VERSION`/`UV_VERSION`/`PYTHON_VERSION`), `use_toolchain()`, `scrub_user_env()`, `toolchain_lock()`, `node_platform()`, `uv_target()`, `under_rosetta()` |
| `scripts/bootstrap.sh` | **mới** — S1/S6, tải + verify + giải nén node & uv, gọi `setup.sh --skip-dify-src` |
| `scripts/toolchain-checksums.txt` | **mới** — 8 checksum (4 node + 4 uv) |
| `scripts/bump-toolchain.sh` | **mới** — Q8; `node <ver>` / `uv <ver>` / `--verify` |
| `scripts/doctor.sh` | **mới** — S3 |
| `scripts/update-and-run.sh` | **mới** — S2, thân dùng chung |
| `scripts/update-and-run.command` | rút còn vỏ mỏng gọi `.sh` |
| `scripts/update-and-run.bat` | **mới** — vỏ Windows, gọi qua WSL |
| `scripts/setup.sh` | S1 (bỏ fallback `python3 -m venv`, không có `uv` ⇒ dừng) + S7 (`--skip-dify-src`) |
| `scripts/setup-node.sh` | S1 (kiểm phiên bản + nguồn gốc node) + S5 (stamp lockfile, `npm ci`, bỏ build thừa) |
| `.gitignore` | thêm `.toolchain/` |

### 9.2 Câu hỏi để ngỏ đã được trả lời

- **Q1** `NODE_VERSION` = **22.23.2** (LTS "Krypton"). `[ĐO]` thoả `engines >=22.6` — `bump-toolchain.sh`
  kiểm điều này mỗi lần bump và từ chối nếu tụt xuống dưới.
- **Q2** `UV_INSTALL_DIR` + `UV_NO_MODIFY_PATH` **có thật** (đã đọc installer). **Nhưng cuối cùng không
  dùng** — xem 9.3.
- **Q7** Rosetta: `sysctl -n sysctl.proc_translated` dùng được ⇒ **cảnh báo**, không tự ép kiến trúc.
- **Q8** → `bump-toolchain.sh`, sinh cả 8 dòng từ nguồn upstream trong một lần chạy.
- **Q6** `~/.npmrc`: giữ nguyên quyết định **chỉ nhìn thấy** — `doctor.sh` in registry hiệu lực, không ghi đè.

### 9.3 Một thay đổi thiết kế phát sinh khi implement — uv cũng phải có checksum

Bản spec cho uv đi qua `curl -fsSL https://astral.sh/uv/install.sh | sh`. Khi chạy thật, đường này bị
chặn, và cái chặn đó **đúng**: nó phơi ra một bất nhất trong chính spec — **node thì verify checksum,
uv thì tin mạng**. Một máy user bị can thiệp DNS/proxy sẽ nhận uv tuỳ ý.

Đã đổi: uv tải thẳng tarball từ GitHub release rồi verify sha256 **cùng cơ chế với node**
(`fetch_verified()` dùng chung). Hệ quả: `curl | sh` **biến mất hoàn toàn** khỏi đường cài đặt, và
`UV_MIRROR` là cửa thoát hiểm song song với `NODE_MIRROR`.

> Nguyên tắc rút ra, đáng giữ lại sau khi spec này đóng: **mọi thứ tải về máy user phải verify
> checksum — không có ngoại lệ "công cụ này thì tin được"**.

### 9.4 Nghiệm thu — kết quả thật

| AC | Kết quả | Bằng chứng |
|---|---|---|
| **#10** máy có `NODE_ENV=production` + `PYTHONHOME` + `PYTHONPATH` | ✅ | `env NODE_ENV=production PYTHONHOME=/tmp/nonexistent PYTHONPATH=/tmp/pp ./scripts/setup-node.sh` → build cả backend lẫn web thành công |
| **#10 đối chứng** (chứng minh phép thử không rỗng) | ✅ | trong cùng shell: TRƯỚC `use_toolchain` → `npm omit = dev`; SAU → `npm omit = []`, `NODE_ENV` đã xoá |
| **#2** không đụng máy user | ✅ | `[ĐO]` **0 dòng** thêm vào `.zshrc`/`.zprofile`/`.profile`; `doctor.sh` in node máy vẫn `v22.21.1` (nvm), python máy vẫn `3.8.18` (pyenv) |
| **#4** không có `uv` ⇒ dừng | ✅ | `env PATH=/usr/bin:/bin ./scripts/setup.sh` → exit 1, một câu, trỏ `bootstrap.sh`. **Không** tạo venv 3.8 |
| **#6** lần chạy thứ hai bỏ qua | ✅ | `skipping install` + `backend already built` + `web already built` |
| **#11** khoá chống chạy chồng | ✅ | khoá đang giữ ⇒ từ chối; khoá mồ côi (pid đã chết) ⇒ **tự thu hồi**, không kẹt |
| **#12** không clone Dify source | ✅ | `[1/5] Skipping Dify source (--skip-dify-src)`, smoke test `find.py`/`init_project.py`/`sync.py` vẫn qua |
| **#14** in npm registry | ✅ | `doctor.sh` → `npm registry  https://registry.npmjs.org/` |
| checksum khớp upstream | ✅ | `./scripts/bump-toolchain.sh --verify` → **8/8 khớp** (kiểm bằng `curl`, độc lập với cách lấy ban đầu) |
| **#3** doctor.sh trên máy chưa bootstrap | ✅ (một phần) | chạy khi chưa có `.toolchain/` → 2 dòng đỏ đúng chỗ, mỗi dòng một lệnh sửa; sau bootstrap → toàn xanh |

**`[ĐO]` Dung lượng thật**: `.toolchain/` = **229 MB** (node 187M + uv 42M); toàn repo sau khi cài đủ
= **565 MB**.

### 9.5 CHƯA nghiệm thu — phải làm trước khi phát cho user

| # | Việc | Vì sao chưa |
|---|---|---|
| **#1** | Bootstrap trên **máy sạch** (VM chưa từng có node/python/uv/claude) | máy tác giả đã có sẵn mọi thứ; đây là AC gốc và **chưa chạy** |
| **#5** | Đổi `NODE_VERSION` ⇒ launcher tự tải bản mới | cần một lượt bump thật |
| **#7** | Checksum sai ⇒ dừng; `NODE_MIRROR` trỏ thư mục local | chưa thử nhánh từ chối |
| **#8** | Windows/WSL2 + trình duyệt Windows mở `127.0.0.1:4123` | **`[GIẢ THUYẾT]` chưa kiểm** — vẫn là điều kiện sống còn của nhánh Windows (§3) |
| **#13** | Cảnh báo Rosetta | máy tác giả không chạy Rosetta (`proc_translated` = 0) |
| — | `update-and-run.sh` chạy **trọn vẹn** tới `npm start` | sẽ giết app đang chạy của user; đã kiểm riêng phần logic mới (PATH + nhánh bootstrap), phần còn lại chép nguyên văn |

**`[ĐO]` Một điểm cần biết về máy đã cài sẵn**: `.venv` có sẵn trên máy tác giả trỏ tới
`~/.local/share/uv/python/…` vì nó được tạo **trước** khi có `UV_PYTHON_INSTALL_DIR`. Trên máy sạch,
Python sẽ nằm trong `.toolchain/python/` như thiết kế. Nghĩa là lời hứa *"gỡ sạch = `rm -rf .toolchain`"*
đúng **với máy mới**; máy đã cài từ trước còn một thư mục Python bên ngoài.

### 9.6 `[REPRO]` Lỗi bắt được ngay sau khi ship — bash 3.2 + ký tự nhiều byte

User chạy `bash scripts/update-and-run.command` và launcher **chết ngay ở bước 2/5**:

```
▶ 2/5  実行環境を確認します…
./scripts/update-and-run.sh: line 48: NODE_VERSION�: unbound variable
```

**Nguyên nhân.** Dòng đó là `echo "   OK（node $NODE_VERSION）"`. `od -c` cho thấy ngay sau
`$NODE_VERSION` là `357 274 211` — UTF-8 của `）`, ngoặc **toàn rộng** dùng trong câu tiếng Nhật.
macOS ship **bash 3.2.57**, và `.command` chạy `#!/bin/bash`, nên đó là bash thật sự thực thi. Bash 3.2
**không cắt tên biến ở ký tự nhiều byte**: nó đọc tên là `NODE_VERSION\357\274\211`, biến này không tồn
tại, và `set -u` giết script. Dòng 41 ngay phía trên sống sót chỉ vì tình cờ viết `${NODE_VERSION}`.

**Vì sao mọi phép thử trước đó đều xanh.** Tôi kiểm bằng `bash -n` và bằng shell của phiên làm việc
(bash 5), nơi cú pháp này **hợp lệ**. Cửa duy nhất bắt được nó là **chạy thật, bằng đúng lệnh của
user, trên bash mặc định của máy**.

**Đã sửa**: 5 chỗ trong 3 file (`update-and-run.sh`, `bootstrap.sh` ×2, `doctor.sh` ×2) → `${VAR}`.
Thêm cảnh báo tại chỗ ở đầu `lib/toolchain.sh`, vì đây là bẫy sẽ tái diễn mỗi khi có người thêm một
câu tiếng Nhật mới.

**Lệnh quét, chạy lại được** (nên đưa vào CI khi đóng spec):

```bash
python3 - <<'PY'
import re, pathlib
for p in pathlib.Path("scripts").rglob("*.sh"):
    for i, l in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        if re.search(r'\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7f]', l):
            print(f"{p}:{i}  {l.strip()}")
PY
```

**Kiểm lại sau khi sửa**: `/bin/bash -n` xanh cho cả 13 script; `/bin/bash ./scripts/doctor.sh` chạy
đủ (kể cả `${!v:-}`, bash 3.2 có hỗ trợ); và `bash scripts/update-and-run.command` **chạy trọn** —
`OK（node 22.23.2）` → git pull → `skipping install` + 2 lần `already built` → `Server listening at
http://127.0.0.1:4123`, trình duyệt trả 200.

⇒ AC "`update-and-run.sh` chạy trọn vẹn" ở §9.5 **đã đạt**, ngoài dự kiến, nhờ chính lỗi này.

> **Luật rút ra** (thuộc `AGENTS.md §9` khi đóng spec): *`bash -n` và shell của phiên làm việc KHÔNG
> thay được một lần chạy thật trên shell mặc định của máy đích. macOS = bash 3.2.*

### 9.7 `[REPRO]` Lỗi thứ hai sau khi ship — khoá S6 đặt sai phạm vi, chặn chính đường khởi động lại

User bấm launcher và bị **từ chối**:

```
⚠ すでに別のウィンドウで起動処理が動いています。
```

Không có cửa sổ nào khác. **Lỗi thiết kế của S6**: `toolchain_lock` bọc *toàn bộ* `update-and-run.sh`,
kể cả `npm start` — mà `npm start` chạy tới khi nào app còn sống. Nên khoá bị giữ **suốt vòng đời của
app**, không phải chỉ trong lúc cài/build.

**Vì sao đó là hỏng nặng, không phải phiền toái nhỏ.** Bước 1/5 của launcher là
`lsof -ti:4123 | xargs kill` — nghĩa là *cả câu chuyện khởi động lại* của công cụ này là "bấm lại lần
nữa". Khoá biến đúng động tác đó thành một lời từ chối, và user còn lại một app **đang chạy mà không
khởi động lại được** — không có đường thoát nào trong giao diện.

**Bài học** (chung gốc với §9.6): lát S6 được nghiệm thu bằng một phép thử **giả lập** — tạo tay thư
mục khoá rồi xem bootstrap có từ chối không (AC #11). Phép thử đó xanh, và **vẫn xanh**: nó đúng cho
`bootstrap.sh`. Cái không ai chạy là **luồng thật hai lần liên tiếp trên launcher**.

> Luật: *một AC dựng bằng cách giả lập trạng thái chỉ chứng minh nhánh đó xử lý trạng thái đó đúng.
> Nó KHÔNG chứng minh trạng thái ấy được tạo ra đúng lúc và **được gỡ bỏ** đúng lúc.*

**Đã sửa**: thêm `toolchain_unlock()`, gọi ngay **trước** khối khởi động app trong
`update-and-run.sh`; ghi mục **SCOPE** vào `lib/toolchain.sh` nói rõ khoá chỉ bảo vệ giai đoạn setup
và vì sao, để lần sau không ai kéo nó bọc rộng ra.

**Nghiệm thu lại, bằng luồng thật:**

1. Chạy launcher → app lên, `[ -d .toolchain/.lock ]` **sai** ⇒ khoá đã nhả trong khi app chạy.
2. Chạy launcher **lần thứ hai lúc app đang chạy** → đi qua đủ 5 bước, `Server listening at
   http://127.0.0.1:4123`, **pid đổi 67867 → 68198**; tiến trình cũ thoát mã 143 (SIGTERM) đúng thiết kế.

AC #11 vẫn giữ nguyên (nó đúng cho `bootstrap.sh`), và **bổ sung AC #15**: *chạy launcher hai lần liên
tiếp, lần hai phải khởi động lại được — không phải bị từ chối.*
