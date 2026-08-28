# Dify Projects

![CI](https://github.com/QuyenTrungvitalify/dify-projects/actions/workflows/ci.yml/badge.svg)

[Tiếng Việt](README_VI.md) · **日本語**

Dify のワークフローを作るための作業場です。やりたいことを言葉で書くと **Builder** がファイルを作り、
各段階であなたが確認しながら進めます。

## まずはここから

| | |
|---|---|
| 初回セットアップ | [SETUP_JA.md](SETUP_JA.md) |
| Builder の使い方 | [BUILDER-USAGE_JA.md](BUILDER-USAGE_JA.md) |

アプリを使うだけなら、この2つで足ります。ここから下は、もう少し踏み込みたい方向けです。

---

## 入っているもの

- **Builder** ([apps/builder/](apps/builder/)) — 手元のパソコンで動く web UI。ワークフローを4つの段階で
  作り、各段階であなたの確認を待って止まります。
- **約47のテンプレート**を機能から検索できます。すぐ使える骨組みも14種類
  （[templates/patterns/](templates/patterns/)）。
- **自動チェック**がコミット前に走り、Dify へ取り込む前に問題を見つけます。
- Dify ワークスペースとの**双方向同期**（取得／送信／差分）。
- リポジトリ内で AI エージェントが参照するスキルとコーパス。

## もっと詳しく

| 知りたいこと | 読むもの |
|---|---|
| YAML を作る手順、困ったときの対処 | [docs/GUIDE.md](docs/GUIDE.md) |
| 構成と設計上の判断 | [docs/architecture.md](docs/architecture.md) |
| 既存テンプレートを探す | [INDEX.md](INDEX.md) |
| 手作業でワークフローを作る手順 | [AGENTS.md](AGENTS.md) §3 |
| AI エージェントで作業する（Claude Code、Codex、Cursor など） | [AGENTS.md](AGENTS.md) |

## ディレクトリ構成

```
apps/builder/       Builder アプリ（web UI）— Node のツールチェーンは独立
templates/          すぐ使える骨組みと、整えたテンプレート集
projects/           あなたのワークフロー: projects/<project>/<workflow>/
tools/dify_base/    CLI: テンプレート検索、プロジェクト作成、Dify 同期、各種チェック
docs/               運用ガイド、構成、システムの現状
skills/  corpus/    参照用の資料（別クローン、git には入りません）
schemas/            Dify DSL の JSON Schema（自動生成）
tests/              pytest — 接続情報がなくても静かにスキップします
```

## よく使うコマンド

```bash
# 初回セットアップ（詳しくは SETUP_JA.md）
./scripts/bootstrap.sh

# うまくいかないとき — 誰かに聞く前にこれを実行
./scripts/doctor.sh

# 機能からテンプレートを探す
python3 tools/dify_base/find.py --has iteration --has file-input
python3 tools/dify_base/find.py --list-features

# Dify へ取り込む前にファイルを検査する
.venv/bin/pre-commit run --files projects/<project>/<workflow>/workflows/main.yml
```

Dify 同期、プロジェクト作成、テンプレートの昇格などを含む全一覧は
[docs/GUIDE.md](docs/GUIDE.md) にあります。

## 知っておいてほしい制限

- **DSL のバージョン**: スキーマは DSL **v0.6.0** 向けで、Dify **1.13.0** から起こしています
  （`.dify-tag` / `.dify-dsl-version` で固定）。ワークスペースがそれより新しい場合は、
  フィールド名を確認したうえでスキーマを作り直してください。
- **チェックが見るのは構造だけ**です — ID の重複、壊れた参照、必須フィールドの欠落。
  Dify への取り込みが成功することを**保証するものではありません**。
- **プラグインのハッシュは時間とともに変わります。** プラグインが原因で取り込みに失敗したら、
  取り込み先ワークスペースのバージョンを確認してください。
- **既知の問題**: `http_request` のスキーマだけ、きれいに出力されず `_error` 印が付きます
  （既定値 `HTTP_REQUEST_MAX_*` に対する `SchemaSerializer`）。ほかの29個は正常です。

## 出典

- [langgenius/dify](https://github.com/langgenius/dify) — Dify 本体
- [mango-svip/dify-workflow-skills](https://github.com/mango-svip/dify-workflow-skills) — 土台にしたスキル
- [Tomatio13/DifyWorkFlowGenerator](https://github.com/Tomatio13/DifyWorkFlowGenerator) — 日本語文脈の DSL 生成
- [lazeyliu/dify-dsl-generator-skills](https://github.com/lazeyliu/dify-dsl-generator-skills) — 階層構成のスキル
- [Formyselfonly/Awesome-Dify-Workflow-EN](https://github.com/Formyselfonly/Awesome-Dify-Workflow-EN) — 参照用コーパス（MIT）
- [Dify 公式ドキュメント](https://docs.dify.ai/)
