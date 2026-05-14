# Implementation Prompt — Phase Y.4: Cleanup & misc fixes

> Copy-paste vào fresh session.

---

You are implementing **Phase Y.4 — Cleanup & misc fixes** for `dify-projects` repo. Pre-req: Y.1 done (vendor/dify-src/ exists).

## Repo & specs

- Working directory: `/Users/quyenbt/Desktop/MyProjects/dify-projects`
- READ: `docs/specs/006-implementation-plan.md` (Phase Y.4 section)
- For agent node fix: `docs/specs/001-multi-version-schema.md` + existing `schemas/gen_schema.py`
- Open question reference: `_SmartConfigStub` discussion in current gen_schema.py + Polish 1.A commit

## Pre-flight

```bash
cd /Users/quyenbt/Desktop/MyProjects/dify-projects
git log -1 --oneline       # Y.1-Y.3 commits should be present
ls vendor/dify-src/        # Y.1 created this — must exist
git status                 # clean
.venv/bin/python schemas/gen_schema.py 2>&1 | tail -5
# Expect: 24/25 modules, 1 fail = agent
```

## Mission

4 unrelated fixes batched together:
1. INDEX.md uses relative paths (was absolute)
2. Refresh Dify source clone (already at 1.14.0 from Y.1)
3. Re-generate schema, diff old vs new, commit
4. Fix `agent` node in gen_schema.py → 25/25

## Tasks

### Y4.1 — INDEX.md relative paths

Currently `INDEX.md` has full paths like `/Users/quyenbt/Desktop/.../corpus/...`. Should be relative to repo root.

Modify `tools/dify_base/build_index.py`:

Find the line where path is written (search for `e['path']` and `file_link`). Change:
```python
# Before:
file_link = f"[{file_display}]({e['path']})"
# After:
rel_path = Path(e['path']).resolve().relative_to(BASE.resolve())
file_link = f"[{file_display}]({rel_path})"
```

Also URL-encode if filename contains special chars (parens `()` break Markdown links). Use `urllib.parse.quote` for the URL portion:
```python
from urllib.parse import quote
rel_path_url = quote(str(rel_path), safe='/')
file_link = f"[{file_display}]({rel_path_url})"
```

Re-run:
```bash
.venv/bin/python tools/dify_base/build_index.py
```

Verify no absolute paths:
```bash
grep -E "/Users/|/home/" INDEX.md && echo "FAIL" || echo "OK"
```

### Y4.2 — Refresh Dify source clone

Per spec 001, the canonical version is in `.dify-tag`. If Y.1 already vendored at 1.14.0, this might be no-op. But verify against latest stable:

```bash
cd vendor/dify-src
git fetch --tags
git tag --sort=-version:refname | head -5    # See latest tags
```

If a newer tag than `.dify-tag` exists AND user wants latest stable:
1. Update `.dify-tag` to newest stable (avoid -rc / -beta / -alpha)
2. `cd vendor/dify-src && git checkout <new-tag>`
3. Document in commit message

If `.dify-tag` already at latest stable: skip refresh, note in commit.

### Y4.3 — Regenerate schema

```bash
.venv/bin/python schemas/gen_schema.py --yes    # with auto-overwrite from Y.1
```

After regen, compare:
```bash
git diff schemas/dify-dsl-*.json | head -50
```

If schema changed:
- New `NodeData_X` defs? → log in commit
- Removed defs? → red flag, investigate (Dify might have refactored — Y.4 not the place to fix; document + revert if breaking)
- Field changes in existing defs? → log

Re-run patterns validation:
```bash
for f in templates/patterns/*.yml; do
  .venv/bin/python -c "
import json, yaml, jsonschema
s = json.load(open('schemas/dify-dsl-0.6.0.json'))  # adjust filename
y = yaml.safe_load(open('$f'))
errors = list(jsonschema.Draft7Validator(s).iter_errors(y))
print(f'$f: {len(errors)} issues')
"
done
```

Expect 0 issues per file. If any pattern breaks → that pattern needs update for new schema (do that in Y.4 or document as known break).

### Y4.4 — Fix `agent` node schema generation

Current state: `agent` fails with `'_Stub_version' object is not str` due to `core.mcp.types.Implementation(version: str)` strict pydantic validation.

Per spec 001 / 006: pre-stubbing `core.mcp` breaks `core.workflow` imports. Need narrower stub.

**Approach**: stub ONLY `core.mcp.types.Implementation` (and friends), not the whole `core.mcp` package.

Add to `schemas/gen_schema.py` after pre-stub setup but BEFORE node entity import loop:

```python
def _install_narrow_mcp_stubs():
    """Inject minimal valid Implementation/etc. into core.mcp.types BEFORE
    real core.mcp.types is imported. Lets agent node entities load without
    shadowing core.workflow.* imports.
    """
    import importlib
    # Import real core.mcp.types first so its other classes load
    try:
        real_mod = importlib.import_module('core.mcp.types')
        # Override only Implementation with a permissive subclass
        from pydantic import BaseModel, ConfigDict
        class Implementation(BaseModel):
            model_config = ConfigDict(extra='allow')
            name: str = "stub"
            version: str = "0.0.0"
        real_mod.Implementation = Implementation
    except Exception as e:
        print(f"  ⚠ MCP narrow stub failed: {e}", file=sys.stderr)

# Call after sys.path insert + pre-stubs but before node loop:
_install_narrow_mcp_stubs()
```

Test:
```bash
.venv/bin/python schemas/gen_schema.py --yes
# Expect: Imported 25/25 node entity modules
```

If still fails: similar issue with another class. Debug:
```bash
.venv/bin/python -c "
import sys; sys.path.insert(0, 'vendor/dify-src/api')
# replicate stubs from gen_schema
import schemas.gen_schema as gs
# trigger
import traceback
try:
    from core.workflow.nodes.agent.entities import AgentNodeData
    print('OK')
except Exception:
    traceback.print_exc()
"
```

If can't fix in 1h: document failure mode in `schemas/gen_schema.py` comment, keep at 24/25, move on. Spec 001 already accepts 24/25.

## Acceptance criteria

- [ ] `grep -E "/Users/|/home/" INDEX.md` → empty
- [ ] All Markdown links in INDEX.md resolve (test with `grep -oE '\[.*\]\([^)]+\)' INDEX.md | ...`)
- [ ] `.dify-tag` reflects current latest stable Dify tag (or unchanged with rationale)
- [ ] `gen_schema.py` exits cleanly, writes schema file
- [ ] If schema changed: 4 patterns still validate
- [ ] If schema unchanged: shasum identical to pre-Y.4 state
- [ ] `gen_schema.py` reports 25/25 modules (or 24/25 with documented agent failure)
- [ ] `pytest tests/` baseline still passes
- [ ] `pre-commit run --all-files` green

## NOT in scope

- New patterns (HITL, MCP, param-extract) — Y.6 optional
- CI workflow — Y.5
- Sync diff normalization — Y.6
- Migration tool — Spec 005 future

## Commit

Single commit:

```
Phase Y.4: cleanup — INDEX paths, Dify refresh, agent node fix

- INDEX.md: absolute → relative paths via build_index.py update
- .dify-tag: <bump version OR no change>
- gen_schema.py:
  - <agent fix description>
  - Coverage: 24/25 → 25/25 (or stay 24/25 with reason)
- Schema regenerated: <diff summary or "no change">

Refs: docs/specs/006-implementation-plan.md Phase Y.4
```

DO NOT push.

## On blocker

- INDEX urlencoding break existing links? → revert URL-encode, keep relative paths only
- Refresh Dify breaks 4 patterns? → revert .dify-tag bump, document in spec 001 update
- Agent node refuses to load → keep at 24/25, comment in gen_schema.py why, accept
