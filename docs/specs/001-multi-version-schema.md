# Spec 001 — Multi-version schema infrastructure

**Status**: Approved (defaults applied, 2 Q awaiting confirm)
**Effort**: M (~3-4h)
**Depends on**: —

## Decisions resolved
- Pin Dify tag: **v1.13.0** (last tag before "graphon refactor"). `.dify-tag` file commits target tag.
- Q1.3: `.vscode/settings.json` → generator script approach (committed, regen khi scaffold)
- Q1.4: Refresh weekly (CI cron) — yes, dù DSL chưa bump
- Q1.5: Parse YAML qua Python (không thêm `yq` dep)
- Q1.6: Setup.sh offline → skip clone + warn

Awaiting confirm (can proceed with defaults):
- Q1.1: Keep all schema versions in git (default: yes)
- Q1.2: `.dify-tag` commit (default: yes)

## Critical context: Dify "graphon refactor" (2026-02 → 2026-03)

Between Dify v1.13.0 (Feb 7, 2026) and v1.13.1, the team moved **most node type definitions out of `api/core/workflow/nodes/`** into a separate package `graphon` (PyPI `graphon~=0.2.2`). Observed via `git checkout` matrix:

| Tag | entities.py count in core/workflow/nodes/ | graphon import in node_factory.py |
|---|---|---|
| 1.10.0 | 26 | no |
| 1.11.x | 26 | no |
| 1.12.x | 26 | no |
| **1.13.0** | **26** | **no** ← last pre-refactor |
| 1.13.1 | 7 | no (refactored but still inline) |
| 1.13.2 | 7 | no |
| 1.13.3 | 7 | no |
| 1.14.0 | 7 | **yes** (uses graphon package) |
| 1.14.1 | 7 | yes |

**Impact on this spec**:
- Originally targeted "latest stable" = v1.14.x → would yield only 7 NodeData schemas (broken)
- **Pinned to v1.13.0** instead: gen_schema produces 28 NodeData (24/25 nodes imported, agent still fails per Polish 1.A limitation)
- v1.14+ support requires future spec: either vendor `graphon` package source, or pip install graphon + extend gen_schema to walk that namespace

**`.dify-tag` semantics changed**: previously thought to track latest stable; actually tracks "last tag with full monolithic source". Document this in `.dify-tag` comment + spec.

## Context

Hiện tại workshop pin cứng vào **một** DSL version `0.6.0` (`schemas/dify-dsl-0.6.0.json`). Dify ship liên tục (Dify product version v1.14.x tháng 5/2026 — riêng product version có thể bump mà DSL format chưa bump, hoặc ngược lại). Khi:

- Dify bump DSL format (vd `0.6.0 → 0.7.0`) → mọi pattern hiện tại bị flag sai version
- 1 team có nhiều project, mỗi project deploy lên Dify workspace version khác nhau (khách A v1.12, khách B v1.14)
- User muốn target một version cụ thể (vd build cho khách đang ở v1.13.x, không phải latest)

…workshop hiện tại **không hỗ trợ**. Tất cả pin chung một schema.

## Goals

1. Mỗi project khai báo target DSL version trong `.dify-workspace.yaml`.
2. `setup.sh` cho phép pin Dify source tag (`--dify-tag 1.14.0`).
3. `gen_schema.py` auto-derive output filename từ source `CURRENT_DSL_VERSION` → cho phép nhiều schema cùng tồn tại.
4. `check_dsl_version.sh` validate per-project (đọc project config), không chỉ "latest schema".
5. VS Code template `yaml.schemas` map phù hợp với từng project.
6. CI có thể regen schema theo tag lịch trình (weekly cron) → mở PR review human nếu thay đổi.

## Non-goals

- **Auto-migrate** workflow từ DSL version cũ sang mới. (Migration tool là spec riêng nếu cần.)
- Hỗ trợ nhiều **Dify branch** đồng thời (chỉ pin tag/main).
- Backwards-compat layer cho YAML cũ tự động chạy được trên DSL mới (user trách nhiệm sync).

## Design

### Folder layout sau khi xong

```
dify-projects/
├── vendor/
│   └── dify-src/                  # Cloned từ langgenius/dify, gitignored
│       └── .git/HEAD               # Tracks pinned tag
├── schemas/
│   ├── gen_schema.py
│   ├── dify-dsl-0.6.0.json         # Generated từ tag 1.13.x
│   ├── dify-dsl-0.7.0.json         # Generated từ tag 1.14.x (nếu DSL bump)
│   └── _latest.json -> dify-dsl-0.7.0.json   # Symlink, optional
├── projects/<slug>/
│   └── .dify-workspace.yaml         # Chứa dsl_version: "0.6.0"
└── .dify-tag                        # File 1 dòng: "1.14.0" — default pin cho repo
```

### Changes per file

#### `scripts/setup.sh`

- Accept `--dify-tag <tag>` flag (default: đọc từ `.dify-tag` ở root, fallback `main`)
- Clone `https://github.com/langgenius/dify.git` vào `vendor/dify-src/` tại tag chỉ định
- Nếu `vendor/dify-src/` đã tồn tại với khác tag → prompt user: pull or skip
- Sau clone, chạy `schemas/gen_schema.py --dify-src vendor/dify-src/`

#### `schemas/gen_schema.py`

- Default `--dify-src` đổi từ `~/Desktop/MyProjects/dify-workspace/` → `vendor/dify-src/` (relative to repo root)
- Output filename: `schemas/dify-dsl-<X>.json` với `<X>` = `CURRENT_DSL_VERSION` từ source
- Nếu file đã tồn tại → so sánh diff trước khi overwrite, prompt nếu khác
- Cập nhật `_latest.json` symlink trỏ vào schema mới nhất

#### `templates/_base/project/.dify-workspace.yaml`

Thêm field:
```yaml
project:
  name: "{{project_name}}"
  slug: "{{project_slug}}"
  app_type: "{{app_type}}"
  dsl_version: "{{dsl_version}}"      # Đã có, giữ
  dify_tag: "{{dify_tag}}"            # MỚI: Dify source tag tham chiếu (vd "1.14.0")
```

#### `tools/dify_base/init_project.py`

- Khi prompt DSL version, list các schema có sẵn trong `schemas/dify-dsl-*.json` → user pick
- Auto-set `dify_tag` field (default: nội dung file `.dify-tag` ở root)

#### `scripts/check_dsl_version.sh`

Hiện tại: `ls schemas/dify-dsl-*.json | head -1` lấy version đầu tiên.
Mới:

```bash
for f in "$@"; do
    # Find which project this file belongs to
    project_dir=$(dirname "$f" | sed 's|/workflows.*||')
    expected_version=$(yq '.project.dsl_version' "$project_dir/.dify-workspace.yaml" 2>/dev/null)

    # If no project config, fall back to .dify-tag default
    [ -z "$expected_version" ] && expected_version=$(default_for_repo)

    actual=$(grep '^version:' "$f" | head -1 | awk '{print $2}' | tr -d "'\"")
    [ "$actual" = "$expected_version" ] || { echo "❌ ..."; exit 1; }
done
```

Note: dependency mới `yq` — hoặc parse YAML bằng Python để tránh thêm tool.

#### `.vscode/settings.json`

Hiện tại 1 schema hard-coded. Đổi sang multi-mapping template — sau khi có nhiều schema:

```json
{
  "yaml.schemas": {
    "./schemas/dify-dsl-0.6.0.json": [
      "projects/*/workflows/*.yml",
      "templates/patterns/*.yml"
    ]
    // Khi nhiều schema: cần file-pattern theo project. Cân nhắc generator script.
  }
}
```

→ **Open question Q3** below.

### Workflow: refresh schema khi Dify ra version mới

1. `cd vendor/dify-src/ && git fetch --tags && git checkout 1.15.0`
2. `python3 schemas/gen_schema.py --dify-src vendor/dify-src/`
3. Nếu output `dify-dsl-0.6.0.json` → no change, skip
4. Nếu output `dify-dsl-0.7.0.json` mới → commit cả schema mới + giữ schema cũ
5. Update `.dify-tag` nếu muốn promote default

CI cron weekly (xem Spec 004):
1. Pull `vendor/dify-src/` latest tag
2. Regen schema
3. Nếu khác → mở PR "schema: refresh from Dify <tag>"
4. Human review + merge

## Open questions

**Q1.1**: Giữ tất cả schema versions trong git, hay chỉ schema hiện hành?
- (a) Tất cả: clear history, dễ rollback, mỗi schema ~180KB
- (b) Chỉ latest: gọn, nhưng git history mất thông tin schema cũ
- Đề xuất: (a) — schema files là nguồn-thật-duy-nhất, giữ cả

**Q1.2**: `.dify-tag` ở root commit hay gitignored?
- (a) Commit: team pin chung version, reproducible
- (b) Gitignore: mỗi dev tự chọn
- Đề xuất: (a) — pin chung như `package-lock.json` của npm

**Q1.3**: `.vscode/settings.json` cấu hình multi-schema khó (file-pattern theo project name). Approach?
- (a) 1 schema mặc định toàn repo (current behavior, đơn giản)
- (b) Generator script: đọc tất cả projects + auto-gen settings.json (committed)
- (c) Per-project `.vscode/settings.json` trong từng `projects/<slug>/`
- Đề xuất: (b) — committed, regen mỗi khi project mới scaffold

**Q1.4**: Khi Dify chưa bump DSL nhưng đã release product version mới — value của việc refresh source clone?
- Pydantic models có thể thêm field optional → schema có field mới (vẫn DSL 0.6.0)
- Đề xuất: vẫn refresh weekly để bắt kịp field optional mới

**Q1.5**: Phụ thuộc `yq` hay parse YAML qua Python?
- (a) `yq`: nhanh, nhưng thêm dep external
- (b) Python script: chậm hơn nhưng đã có `.venv`
- Đề xuất: (b) — đã có Python, không thêm dep

**Q1.6**: Khi user clone repo lần đầu, chưa có `vendor/dify-src/`. Setup.sh fail nếu network không reach github?
- Đề xuất: skip clone với warning, gen_schema sẽ skip + cảnh báo schema không có

**Q1.7** (surfaced during Y.1 implementation, 2026-05-14): `gen_schema.py` fails on vendored Dify v1.14.0 — only 2/7 node entity modules import (vs 24/25 on legacy 2026-02-20 clone). The `api/core/workflow/nodes/` tree has been refactored upstream: 7 dirs instead of 25, several use new pydantic patterns that break our stubbing (`metaclass conflict`, `Implementation.version` strict-validation). Also DSL constant moved from `services/app_dsl_service.py` literal → alias of `constants/dsl_version.CURRENT_APP_DSL_VERSION` (now handled by read_dsl_version).
- Decision (defaulted, Y.1 scope): keep the legacy-generated `schemas/dify-dsl-0.6.0.json` as the shipped baseline; vendor folder exists + default points to it; refresh + stub adaptation is Y.4 work. Users wanting to regen against the (still-working) legacy clone: `python schemas/gen_schema.py --dify-src ~/Desktop/MyProjects/dify-workspace/`.
- Reason: matches "Decisions resolved" tone ("for now, vendor is created but stays at 1.14.0 tag" — Y.4 refresh, not Y.1).

## Acceptance criteria

- [ ] `./scripts/setup.sh --dify-tag 1.13.0` clone vào `vendor/dify-src/` tag 1.13.0, gen schema 0.6.0 (giả định tag đó vẫn DSL 0.6.0)
- [ ] `./scripts/setup.sh --dify-tag 1.14.0` clone lại (cùng folder, fetch tag mới), gen schema 0.6.0 hoặc 0.7.0
- [ ] Tạo 2 project A và B với khác `dsl_version` → mỗi cái pass `check_dsl_version.sh` riêng
- [ ] Pre-commit chạy trên workflow của project A không trigger false-positive trên schema project B
- [ ] `gen_schema.py` idempotent: 2 lần chạy cùng tag → shasum identical
- [ ] CI workflow refresh weekly → tạo PR (nội dung Spec 004)

## References

- Local Dify source clone date: 2026-02-20 → already 3 months stale at time of spec
- Issue #1 từ external review: framing sai (claim DSL drift v0.6→v1.14), thực tế DSL vẫn 0.6 stable
- Related: Spec 004 (CI cron), Spec 005 (QA strategy section "version migration")
