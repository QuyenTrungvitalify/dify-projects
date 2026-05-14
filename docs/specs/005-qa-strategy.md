# Spec 005 — QA strategy

**Status**: Approved (Tier 3 unblocked by user canary commitment)
**Effort**: (meta — design only, implementation tracked per category)
**Depends on**: 001, 003, 004

## Decisions resolved
- **Q5.1**: **Yes — user setup Dify Cloud free tier** → Tier 3 (round-trip, real import) unblocked
- Q5.2: Code sandbox whitelist research deferred (Sub-spec 005.2 → Y.6)
- Q5.3: AGENTS.md self-test manual với markdown checklist log
- Q5.4: Migration tool reactive (design khi DSL bumps)
- Q5.5: Sync diff normalization design after first canary export sample
- Q5.6: Plugin hash validation chỉ khi present, skip `# TODO:` lines

## Context

QA hiện tại chỉ cover **static validation** (schema + skill validator + future ref linter). Còn nhiều dimension chưa đụng tới:

- Round-trip (local → Dify → export → diff)
- Pattern consistency (cross-pattern naming, structure)
- Docs drift (README claim vs reality)
- Real import canary (test against live Dify)
- Migration tests (when DSL version bumps)
- Code-node sandbox compatibility
- Plugin hash format
- Sync diff normalization
- AGENTS.md effectiveness self-test

Spec này map từng dimension → status hiện tại → cách address.

## Goals

1. Liệt kê tất cả QA dimension cần cân nhắc.
2. Phân loại: automated / manual / deferred (with reason).
3. Định nghĩa "good enough" cho mỗi category (acceptance bar).
4. Surface category nào blocked bởi external dep (vd cần Dify workspace).

## Non-goals

- Implement từng QA check ở đây — chỉ design strategy.
- Performance benchmarking (separate concern).
- Security audit (separate spec nếu cần).

## QA Categories Matrix

### Tier 1 — Static (automated trong pre-commit + CI)

| Category | What it checks | Tool | Status |
|---|---|---|---|
| YAML syntax | Parseable YAML | yamllint, check-yaml | ✅ Done (Spec 2.B) |
| Schema structure | Top-level + node-data structure | check-jsonschema | ✅ Done |
| Skill validator | Edge refs, unique IDs, required fields | mango-svip validator | ✅ Done |
| DSL version match | `version:` in YAML matches schema | `check_dsl_version.sh` | ⚠️ Single version; **Spec 001** đa version |
| Variable refs | `{{#X.Y#}}` field exists | **Spec 003** lint_refs.py | ❌ Not yet |
| Plugin hash format | sha256-like format `<prov>/<plug>:<ver>@<hash>` | New regex linter | ❌ Not yet — Spec 005.1 |
| Code sandbox imports | Python `import X` in code nodes whitelisted | New AST checker | ❌ Not yet — Spec 005.2 |

### Tier 2 — Pattern + repo consistency (automated pytest)

| Category | What it checks | Implementation |
|---|---|---|
| Pattern has `# Use case:` | Every pattern documents purpose | `tests/test_pattern_consistency.py` (parametrized) |
| Pattern has `# TODO:` markers | Customization points marked | Same |
| Patterns use `generate_id.py` format | Unix-timestamp-ms IDs (regex check) | Same |
| Patterns have empty `dependencies: []` | No hardcoded plugin hashes | Same |
| INDEX.md matches reality | Pattern count, node count | New `test_docs_drift.py` |
| README claims match | "28 schemas", "4 patterns" → assert true | New |
| All commands in AGENTS.md work | Run + verify | Manual + scheduled |

### Tier 3 — Round-trip QA (requires Dify workspace)

| Category | What it checks | Status |
|---|---|---|
| Import canary | Pattern import vào Dify thành công | ⏸ Defer — cần canary workspace |
| Export round-trip | Import → export → diff matches | ⏸ Defer |
| Diff normalization | sync.py diff strip volatile fields | ⏸ Implement once we know what Dify adds on export |
| Live workflow run | Snapshot test against running workflow | ⚠️ Skeleton có (tests/test_workflow_smoke.py), default skip |

### Tier 4 — AGENTS.md effectiveness

| Category | What it checks | Implementation |
|---|---|---|
| Agent self-test | Fresh-session agent build workflow → success rate | Manual periodic (every 2 weeks?) |
| Token usage | Agent reads AGENTS.md once, doesn't re-discover | Measure via Claude transcript |
| Convention compliance | Agent uses `generate_id.py`, không invent hash | Observed errors logged |

### Tier 5 — Migration (when DSL bumps)

| Category | What it checks | Status |
|---|---|---|
| Old patterns still valid? | Re-run all checks against new schema | ⏸ Until DSL bump |
| Migration tool? | Auto-fix old → new pattern | ⏸ Until needed |
| Backwards-compat? | Multiple schemas in repo (Spec 001 supports) | ✅ Plan ready |

## Tools / hooks proposed

### Sub-spec 005.1: Plugin hash format linter

```python
# Add to pre-commit hooks:
# tools/dify_base/lint_plugin_hashes.py
# Regex: ^[a-z0-9_]+/[a-z0-9_]+:\d+\.\d+\.\d+@[a-f0-9]{64}$
# Catches: typos, fabricated hashes, wrong format
```

Effort: XS (~30 min)

### Sub-spec 005.2: Code sandbox import checker

Dify's Python sandbox has whitelist:
- stdlib: csv, io, json, re, datetime, math, hashlib, base64, ...
- 3rd-party: requests (limited), httpx, ... (per Dify docs)

Linter:
```python
# Parse code field → AST → extract Import nodes → cross-check whitelist
```

Effort: M (~3h, needs sandbox whitelist research)

### Sub-spec 005.3: Docs drift test

```python
# tests/test_docs_drift.py
def test_readme_pattern_count():
    readme = (BASE / "README.md").read_text()
    actual = len(list((BASE / "templates/patterns").glob("*.yml")))
    assert f"{actual} reusable patterns" in readme

def test_readme_schema_count():
    schema = json.load(open(BASE / "schemas/dify-dsl-0.6.0.json"))
    nodedata_count = sum(1 for k in schema["$defs"] if k.startswith("NodeData_"))
    readme = (BASE / "README.md").read_text()
    assert f"{nodedata_count} NodeData" in readme
```

Effort: S (~1h)

### Sub-spec 005.4: Sync diff normalization

Khi `sync.py diff` chạy, Dify export có fields thay đổi mỗi lần (timestamps, internal IDs, viewport positions). Cần normalize trước khi compare.

Approach:
- Define `NORMALIZE_FIELDS = {position, positionAbsolute, viewport, ...selected, _runningStatus, ...}`
- Strip trước khi diff

Effort: M (~2h, requires test against real Dify export)

### Sub-spec 005.5: AGENTS.md self-test (periodic)

```bash
# scripts/agents_md_self_test.sh
# Spawn agent với canned task → measure:
#   - Did it read AGENTS.md?
#   - Did it use init_project.py?
#   - Did it use generate_id.py?
#   - Errors count
# Log to docs/specs/002-agents-md-self-test-log.md
```

Effort: M (~3h to design + run baseline)

## Open questions

**Q5.1**: Có canary Dify workspace không?
- Required cho Tier 3 (round-trip, real import).
- Options:
  - (a) Dify Cloud free tier (free up to N apps)
  - (b) Self-host Dify trong CI (docker-compose, slow)
  - (c) Skip Tier 3 indefinitely
- Đề xuất: Hỏi user (xem **Blocker A** ở summary)

**Q5.2**: Code sandbox whitelist từ đâu?
- Dify docs / source? Cần research
- Đề xuất: Defer Sub-spec 005.2 đến khi có whitelist source

**Q5.3**: AGENTS.md self-test bằng tay hay automated?
- Tự động: spawn Claude Code / Codex CLI subprocess → khó
- Manual periodic: dễ nhưng dễ skip
- Đề xuất: manual với checklist, log results trong markdown

**Q5.4**: Migration tool — preempt build hay reactive?
- Preempt: build trước khi DSL bumps, no immediate use
- Reactive: chờ DSL bump → vội build
- Đề xuất: Reactive, nhưng design tool interface trước trong Spec mới (006.M)

**Q5.5**: Sync diff normalization — cần Dify export real để test fields cần strip
- Defer đến khi có canary

**Q5.6**: Plugin hash format — chấp nhận `# TODO:` placeholder mà không validate?
- Pattern hiện có `dependencies: []` (empty) → no hash → no check
- Nếu user fill hash, linter check format
- Đề xuất: Yes, validate khi hash present, skip khi `# TODO:` line

## Acceptance criteria (overall QA strategy)

- [ ] Every category trong matrix có status rõ ràng (automated / manual / deferred)
- [ ] Tier 1+2 fully automated trong CI
- [ ] Tier 3 unlocked sau khi user provide canary creds
- [ ] Tier 4 baseline self-test logged
- [ ] Sub-specs 005.1, 005.3 implemented (low-hanging fruit)
- [ ] Sub-spec 005.2, 005.4 documented + acceptance for future

## References

- External review section "QA dimensions" — input cho spec này
- Spec 003 (lint_refs is Tier 1 highest priority)
- Spec 001 (DSL version multi-support → enables Tier 5 migration)
- Spec 004 (CI as the runtime for Tier 1+2)
