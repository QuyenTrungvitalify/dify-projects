# Deploy share-inbox receiver (spec 083 S1) — làm MỘT lần, bởi admin

Receiver là một Google Apps Script Web App chạy dưới account của **admin**, ghi file vào folder
Drive của admin. User bản-sạch không cần setup gì — Builder POST lên URL trong `.dify-share.json`.

## Bước 1 — Tạo folder Drive

1. Drive → New → Folder, ví dụ `dify-share-inbox`. (Không cần share cho ai — script ghi hộ.)
2. Mở folder, copy **folder id** từ URL: `https://drive.google.com/drive/folders/<FOLDER_ID>`.

## Bước 2 — Tạo Apps Script project

1. [script.google.com](https://script.google.com) → New project, đặt tên `dify-share-inbox`.
2. Dán nguyên nội dung [`Code.gs`](Code.gs) đè lên file mặc định.
3. Project Settings (⚙) → bật *Show "appsscript.json" manifest file* → dán nội dung
   [`appsscript.json`](appsscript.json) (quan trọng: `timeZone: Asia/Tokyo` — mặc định UTC sẽ
   lệch ngày folder tháng).
4. Project Settings → **Script Properties** → thêm:
   - `SECRET` — một chuỗi ngẫu nhiên dài (ví dụ `openssl rand -hex 24`)
   - `FOLDER_ID` — id folder ở Bước 1
   - `MAX_KB` — (tuỳ chọn) trần KB mỗi upload, mặc định 512

## Bước 3 — Deploy Web App

1. Deploy → New deployment → type **Web app**.
2. *Execute as*: **Me** · *Who has access*: **Anyone** (bắt buộc — Builder POST không đăng nhập;
   lớp chặn là `SECRET` + admin gate ở `/shelf-inbox`).
3. Authorize khi được hỏi → copy **Web app URL** (`https://script.google.com/macros/s/…/exec`).

> **Gotcha có thật — sửa code phải "New version"**: sau này sửa `Code.gs`, phải vào
> Deploy → **Manage deployments** → ✎ → *Version: New version* → Deploy. Không làm bước này thì
> URL cũ **vẫn chạy code cũ** dù editor đã lưu code mới. URL không đổi qua các version.

## Bước 4 — Điền config vào repo

Sửa [`.dify-share.json`](../../.dify-share.json) ở repo root rồi commit + push:

```json
{ "url": "<Web app URL vừa copy>", "secret": "<SECRET ở bước 2.4>", "maxKb": 512 }
```

Mọi bản sạch nhận config qua `git pull` — từ đó nút Share trong Builder đi đường drop này
(không cần git identity/quyền push nữa; máy không có config vẫn rơi về đường git+PR cũ).

## Bước 5 — Smoke test (bắt buộc trước khi công bố)

```bash
URL="<Web app URL>"; SECRET="<secret>"
# 1. Gửi hợp lệ → {"ok":true,"path":"inbox/YYYY-MM/..."} và file xuất hiện trong Drive
curl -sL -X POST "$URL" -H 'Content-Type: application/json' \
  -d "{\"secret\":\"$SECRET\",\"slug\":\"smoke-test\",\"contributor\":\"admin\",\"yaml\":\"app:\\n  name: Smoke\\n\",\"meta\":{\"note\":\"deploy smoke\"}}"
# 2. Secret sai → {"ok":false,"error":"bad secret"} và KHÔNG có file mới
curl -sL -X POST "$URL" -H 'Content-Type: application/json' \
  -d '{"secret":"wrong","slug":"x","yaml":"a: 1\n"}'
```

Lưu ý `-L` (follow redirect) — Apps Script trả **302** sang `script.googleusercontent.com`;
client nào tắt follow-redirect sẽ chỉ thấy trang redirect, không thấy JSON.

## Vận hành

- **Quét inbox**: cài Google Drive for Desktop trên máy admin (chỉ máy admin), sync folder
  `dify-share-inbox` → chạy skill `/shelf-inbox` theo nhịp tuần (xem
  `.claude/skills/shelf-inbox/SKILL.md`).
- **Xoay secret** (khi nghi lộ): đổi Script Property `SECRET` → sửa `.dify-share.json` → commit.
- **Quota**: Web App ~20k execution/ngày (Workspace) — dư rất xa nhu cầu.
