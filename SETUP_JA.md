# Dify Builder のセットアップ

## A. 全員がやること

### A1. リポジトリを取得する

```bash
git clone <リポジトリのURL> ~/dify-projects
cd ~/dify-projects
```

### A2. コマンドを1つだけ実行する

```bash
./scripts/bootstrap.sh
```

これが、必要なバージョンの Node と Python を**リポジトリ内**の `.toolchain/` に取得し、
残りもすべて用意します。初回は数分かかります。

途中で止まった場合は、次に何をすればよいかを**一文だけ**表示します。そのとおりにしてから
もう一度実行してください。何度実行しても安全なコマンドです。

### A3. Claude にログインする

ターミナルからでも構いません。どちらでも同じところに行き着きます。

```bash
claude auth login
```

ログイン済みかどうかの確認:

```bash
claude auth status
```

アプリから（A4）— 未ログインなら、アプリがログイン欄を自動で出します。
**「ログインページを開く」**を押し、開いたページでログインすれば**それだけ**です。
アプリが自動で気づいて先へ進みます。

アプリの「コード」欄は、ブラウザを開けないマシン用の予備です。その場合はアプリ内のリンクを押し、
開いたページに出るコードをその欄に貼り付けてください。

### A4. アプリを開く

1. 起動方法は2つ、どちらでも構いません。
   - プロジェクトのフォルダーでターミナルを開き、`bash scripts/update-and-run.command`
   - Finder で `dify-projects/scripts/` を開き、`update-and-run.command` を**ダブルクリック**
     （Windows は `update-and-run.bat`）
2. ターミナルの窓が開いて数十秒動きます。処理はすべて手元のパソコンで動きます。
   **この窓は閉じないでください** — 閉じるとアプリも止まります。
3. ブラウザが **http://127.0.0.1:4123** を自動で開きます。開かないときは、このアドレスを自分で入力してください。

---

## B. 任意 — アプリを Dify につなぐ

手動でインポートする代わりに、**アプリから直接 Dify へ送りたい**場合だけ行ってください。

### B1. Dify Cloud を使う場合

```bash
cp apps/builder/.env.example apps/builder/.env
```

`apps/builder/.env` を開き、最後の3行の `#` を外して記入します。

```dotenv
DIFY_CONSOLE_URL=https://cloud.dify.ai/console/api
DIFY_CONSOLE_TOKEN=<下記の手順で取得>
```

トークンの取り方: ブラウザで Dify を開く → **F12** → **Network** タブ → Dify 上で何か操作する →
`/console/api/...` へのリクエストをどれか選ぶ → **Headers** → `Authorization` 行の `Bearer ` の
後ろをコピー。

> このトークンは**約60分で切れます**。切れたら同じ手順で取り直してください。

`.env` を変更したら、**アプリを一度終了してから開き直してください**
（`update-and-run.command` をもう一度ダブルクリック）。

### B2. 自分のマシンに Dify を立てる場合

#### B2.1 Docker を入れる

**macOS**: [Docker Desktop](https://www.docker.com/products/docker-desktop/) をダウンロードし、
チップ（Apple Silicon か Intel）を間違えないように選びます。Applications にドラッグして起動し、
メニューバーの 🐳 が *Running* になるまで待ちます。

確認:

```bash
docker compose version
```

必要なマシン: RAM **8 GB** 以上、空き容量 10 GB 程度。

#### B2.2 Dify を立てる

```bash
git clone https://github.com/langgenius/dify.git ~/dify
cd ~/dify
git checkout 1.13.0
cd docker
cp .env.example .env
```

`~/dify/docker/.env` を開き、**2行だけ**書き換えます。

```dotenv
SECRET_KEY=<下で生成した文字列を貼る>
EXPOSE_NGINX_PORT=8090
```

`SECRET_KEY` の生成:

```bash
openssl rand -base64 42
```

> **なぜ 80 ではなく 8090 なのか。** macOS では 80 番ポートがほかのアプリに取られていることが多く、
> そうなったときの症状が非常に分かりにくいためです。全員が同じ状態になるよう 8090 を使います。
> **この番号は B2.4 でもう一度出てきます — 必ず一致させてください。**

起動:

```bash
docker compose up -d
```

初回はイメージの取得に数分かかります。すべてのコンテナが `Up` か確認します。

```bash
docker compose ps
```

**http://localhost:8090/install** を開き、管理者アカウントを作成します。

そのあと **Settings → Model Provider** で LLM の API キー（OpenAI / Anthropic など）を追加してください。
これがないとワークフローは動きません。

#### B2.3 固定キーを有効にする（推奨）

**期限のない**キーを使えるようになり、1時間ごとにトークンを取り直す必要がなくなります。

`~/dify/docker/.env` をもう一度開き、次を追記します。

```dotenv
ADMIN_API_KEY_ENABLE=true
ADMIN_API_KEY=<好きな長い文字列を自分で決める>
```

再起動:

```bash
cd ~/dify/docker && docker compose restart api
```

ワークスペース ID を取得します。ブラウザで Dify を開いた状態（ログイン済み）のまま、
別タブで `http://localhost:8090/console/api/workspaces/current` を開き、`id` の値をコピーします。

#### B2.4 Builder を Dify につなぐ

```bash
cd ~/dify-projects
cp apps/builder/.env.example apps/builder/.env
```

`apps/builder/.env` を開き、`#` を外して記入します。

```dotenv
DIFY_CONSOLE_URL=http://localhost:8090/console/api
DIFY_CONSOLE_TOKEN=<B2.3 で決めた ADMIN_API_KEY>
DIFY_WORKSPACE_ID=<B2.3 で取得した id>
```

> **ここの `8090` は B2.2 の `EXPOSE_NGINX_PORT` と一致させてください。** ここが一番の間違いどころです。
> `ADMIN_API_KEY` ではなくブラウザのトークン（B1）を使う場合は、**`DIFY_WORKSPACE_ID` は空のまま**にします。

**アプリを終了して開き直してください。** これで最後の段階で「セルフホスト」を選ぶと、
アプリがそのまま Dify へ送ります。

Dify の日常コマンド:

```bash
cd ~/dify/docker
docker compose stop      # 停止（データは残る）
docker compose start     # 再開
docker compose down -v   # ⚠️ データごと削除
```

---

## C. Windows

Windows は **WSL2**（Windows の中で動く軽い Linux）経由で動かします。PowerShell を開きます。

```powershell
wsl --install
```

再起動してください。*(Docker Desktop を入れてあるなら WSL2 は既にあるので、この手順は不要です。)*

スタートメニューから **Ubuntu** を開き、あとは **A のとおり**に進めます。変更点はありません。

> ⚠️ **必ず守ってください**: リポジトリは（WSL の中の）`~/dify-projects` に置き、
> **`/mnt/c/...` には置かないでください。** `/mnt/c` に置くと、フリーズしたと錯覚するほど遅くなります。

毎日の起動: `scripts/update-and-run.bat` をダブルクリックし、Windows のブラウザで
**http://127.0.0.1:4123** を開きます。

---

## D. 毎日の使い方

**操作は1つだけ**: `scripts/update-and-run.command`（Windows は `.bat`）をダブルクリック。
または、プロジェクトのフォルダーでターミナルを開いて `bash scripts/update-and-run.command`。

最新版の取得と必要な更新を自分で済ませてから、アプリを開きます。Node の新しい版が出たときも含め、
`bootstrap.sh` を再実行する**必要はありません**。

---

## E. うまくいかないとき

**誰かに聞く前に、まずこの1つを実行してください。**

```bash
cd ~/dify-projects && ./scripts/doctor.sh
```

すべての項目を ✅/❌ の表で出し、❌ の行にはそれぞれ**直すためのコマンドが1つ**付いています。
それでも解決しないときは、**出力を全部コピーして**担当者に送ってください。これがあればすぐ診断できます。
なければ、やり取りを何往復もすることになります。

このコマンドは、まだ何も入っていないマシンでも動きます。

### よくあるトラブル

| 症状 | 原因 | 対処 |
|---|---|---|
| ダブルクリックしても何も起きない | ネットから取得したファイルを macOS が止めている | ファイルを右クリック → **開く** → **開く** |
| ターミナルが出てすぐ閉じる | `bootstrap.sh` がまだ | `./scripts/doctor.sh` を実行 |
| ブラウザが「接続できません」 | 起動が終わっていない、またはターミナルを閉じた | 30秒待つ。それでも駄目なら `update-and-run.command` を開き直す |
| Dify へのインポートが 401 / `DIFY_CONSOLE_URL` が必要と出る | トークン切れ、または `.env` のポートが Dify と違う | B2.4 と B2.2 を見比べる — 2つの数字は同じはず |
| ビルドを押すと Claude 未ログインと出る | ログインの期限切れ | アプリにログイン欄が自動で出ます。A3 のとおりに。入力したプロンプトは残ったままです |
| `localhost:8090` で Dify が開かない | コンテナが動いていない | `cd ~/dify/docker && docker compose ps` |

---

## 付録 — これはあなたのマシンに何もインストールしません

安心して使っていただくために。

- Node と Python は `~/dify-projects/.toolchain/` の中にあります。システムには**入れません**。
  `.zshrc` / `.bashrc` を**書き換えません**。共有の `PATH` も**変えません**。
  あなたのほかのプロジェクトには影響しません。
- 逆方向も手当て済みです。アプリは実行時にあなたのマシンの環境変数
  （`NODE_ENV`、`PYTHONPATH`、`PYTHONHOME` など）を**無視します**。
  ほかのプロジェクト用の設定が、このアプリを壊すことはありません。
- まるごと削除: `rm -rf ~/dify-projects`（Dify をローカルに立てた場合は `rm -rf ~/dify` も）。
- `apps/builder/.env` にはトークンが入るため、git に**絶対にコミットされません**。
