# Spec 004 — GitHub Actions CI

**Status**: Approved (defaults applied; canary creds will be added separately when ready)
**Effort**: S (~1-2h, includes secret setup)
**Depends on**: 001 (multi-schema), 003 (lint_refs)

## Decisions resolved
- Q4.1: Weekly schedule (Monday 9am UTC)
- Q4.2: Skip real Dify tests v1; **enable khi canary creds provisioned** (user confirmed canary coming)
- Q4.3: Single open schema-refresh PR (check existing first)
- Q4.4: Ubuntu + Python 3.12 only
- Q4.5: GitHub built-in notifications cho v1
- Q4.6: Trust pre-commit pin (no extra reproducibility check)

## Context

Hiện tại không có CI. Pre-commit chỉ chạy local — push trực tiếp lên main không bị catch nếu user `--no-verify` hoặc clone bị stale. Specs 001 + 003 add automation chỉ có giá trị khi CI enforce.

Đồng thời, Spec 001 đề xuất CI cron weekly refresh schema từ upstream Dify — đây là nơi automate.

## Goals

1. Chạy pre-commit + pytest trên mọi push/PR.
2. Validate tất cả patterns + project workflows pass schema + skill + ref linter.
3. Weekly cron pull Dify upstream tag, regen schema, open PR if changed.
4. Total CI time < 3 minutes (cached deps).
5. Skip gracefully khi không có Dify creds (don't fail because no DIFY_API_KEY).
6. Visible status badge trong README.

## Non-goals

- Deploy / publish steps.
- Real Dify import test (cần workspace + creds — Spec 005 canary).
- Multi-OS matrix (Linux đủ — Python 3.12 portable).
- Auto-merge schema-refresh PRs (human review always).

## Design

### Files tạo

```
.github/
└── workflows/
    ├── ci.yml              # On push/PR — pre-commit + pytest + lint
    └── refresh-schema.yml  # Weekly cron — regen schema từ Dify upstream
```

### `.github/workflows/ci.yml` outline

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # for any git-history checks

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: pip

      - name: Install uv
        run: pip install uv

      - name: Bootstrap workspace
        run: ./scripts/setup.sh --skip-venv

      - name: Install Python deps
        run: |
          uv pip install --system \
              pre-commit pytest pyyaml jsonschema python-dotenv \
              requests syrupy check-jsonschema yamllint pydantic

      - name: Cache pre-commit envs
        uses: actions/cache@v4
        with:
          path: ~/.cache/pre-commit
          key: precommit-${{ hashFiles('.pre-commit-config.yaml') }}

      - name: Run pre-commit (all files)
        run: pre-commit run --all-files --show-diff-on-failure

      - name: Run pytest
        run: pytest tests/ -v --tb=short
        # Tests skip gracefully if no DIFY_API_KEY
```

### `.github/workflows/refresh-schema.yml` outline

```yaml
name: refresh-schema
on:
  schedule:
    - cron: '0 9 * * MON'   # Monday 9am UTC
  workflow_dispatch:        # Manual trigger

jobs:
  refresh:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }

      - name: Read pinned Dify tag
        id: tag
        run: |
          TAG=$(cat .dify-tag 2>/dev/null || echo "main")
          echo "tag=$TAG" >> $GITHUB_OUTPUT

      - name: Clone Dify upstream
        run: |
          ./scripts/setup.sh --skip-venv

      - name: Install deps + regen schema
        run: |
          uv pip install --system pydantic pydantic-settings pyyaml \
              pycryptodome httpx sqlalchemy charset-normalizer pytz flask \
              redis yarl flask-login cachetools jsonschema requests
          python3 schemas/gen_schema.py

      - name: Check for changes
        id: changed
        run: |
          if git diff --quiet schemas/; then
            echo "changed=false" >> $GITHUB_OUTPUT
          else
            echo "changed=true" >> $GITHUB_OUTPUT
          fi

      - name: Open PR if schema changed
        if: steps.changed.outputs.changed == 'true'
        uses: peter-evans/create-pull-request@v6
        with:
          title: "schema: refresh from Dify ${{ steps.tag.outputs.tag }}"
          body: |
            Auto-generated PR from weekly schema refresh.
            Diff against upstream Dify tag `${{ steps.tag.outputs.tag }}`.

            **Reviewer checklist**:
            - [ ] Run `./scripts/setup.sh && python3 schemas/gen_schema.py` locally to confirm
            - [ ] Diff doesn't break existing patterns (check pre-commit)
            - [ ] DSL version bumped? → may need migration plan (see specs/005)
          branch: schema-refresh-${{ github.run_id }}
          commit-message: "schema: refresh from Dify ${{ steps.tag.outputs.tag }}"
```

### CI green/red surface

README badge:
```markdown
![CI](https://github.com/QuyenTrungvitalify/dify-projects/actions/workflows/ci.yml/badge.svg)
```

### Failure routing

Pre-commit fail → CI fail with diff output (developer sees exact problem).
pytest fail → CI fail with traceback.
Schema regen fail → CI green (no auto-PR), but next run will retry.

## Open questions

**Q4.1**: Trigger schedule frequency?
- (a) Weekly (recommended): low noise, catches monthly Dify releases
- (b) Daily: more current but spam PRs
- (c) On-demand only (manual): no automation
- Đề xuất: (a) Monday 9am UTC

**Q4.2**: Should CI run real Dify integration tests (when creds available)?
- Currently `tests/test_workflow_smoke.py` skips without creds
- (a) Skip in CI (current behavior): clean but missing test coverage
- (b) Set GitHub secrets DIFY_API_KEY etc., run real tests
- Đề xuất: (a) cho v1; (b) khi có canary workspace (Spec 005)

**Q4.3**: Concurrency limit on schema-refresh PRs — what if there's an open one already?
- Risk: weekly cron mở PR mới mỗi tuần, accumulate
- (a) Cron check existing open PR with `schema-refresh-` prefix, skip if exists
- (b) Always open new PR, accept clutter
- Đề xuất: (a) — single open PR at a time

**Q4.4**: CI matrix testing?
- Python versions: chỉ 3.12 (Dify min)? Or 3.11 + 3.12?
- OS: Ubuntu only? macOS?
- Đề xuất: chỉ Ubuntu + Python 3.12 (workshop targets Linux dev, macOS dev tested locally)

**Q4.5**: Failure notifications — Slack, email, GitHub notification only?
- Đề xuất: GitHub built-in only cho v1; Slack webhook khi team scale

**Q4.6**: Should CI block merging if pre-commit-hook hash differs from local? (i.e., reproducibility)
- Pre-commit version pin trong `.pre-commit-config.yaml` → likely deterministic
- Đề xuất: trust pin, skip extra check

## Acceptance criteria

- [ ] Push commit clean → CI green within 3 min
- [ ] Push commit với broken YAML (typo node id) → CI fail at lint_refs step
- [ ] Push commit với wrong DSL version → CI fail at check_dsl_version step
- [ ] Push commit thay đổi gen_schema.py → CI re-runs schema gen, no false-positive diff
- [ ] Weekly cron manual trigger (workflow_dispatch) → mở PR nếu schema khác
- [ ] CI status badge live trên README
- [ ] Pre-commit cache hit: subsequent runs < 60s

## References

- [GitHub Actions docs](https://docs.github.com/en/actions)
- [peter-evans/create-pull-request](https://github.com/peter-evans/create-pull-request)
- Related: Spec 001 (schema refresh), Spec 003 (lint_refs as a CI step), Spec 005 (when canary workspace is added)
