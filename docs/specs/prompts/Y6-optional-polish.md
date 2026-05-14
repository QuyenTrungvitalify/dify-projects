# Implementation Prompt — Phase Y.6: Optional QA depth + polish

> Copy-paste vào fresh session. **OPTIONAL phase** — skip if budget tight.

---

You are implementing **Phase Y.6 — Optional QA depth** for `dify-projects` repo.

## Scope

This phase has 4 sub-tasks, each independent. Implement **as many as time allows**, prioritized by user need:

1. **Y6.1**: Code sandbox import checker (sub-spec 005.2)
2. **Y6.2**: Sync diff normalization (sub-spec 005.4) — REQUIRES canary Dify export sample
3. **Y6.3**: AGENTS.md periodic self-test script (sub-spec 005.5)
4. **Y6.4**: Migration tool design doc (new spec 006.M)

Each can be done independently. Pick whichever subset matches current need.

## Repo & specs

- Working dir: `/Users/quyenbt/Desktop/MyProjects/dify-projects`
- READ: `docs/specs/005-qa-strategy.md` (sub-specs 005.1-005.5)
- Pre-req: Phases Y.1-Y.5 done

## Pre-flight

```bash
cd /Users/quyenbt/Desktop/MyProjects/dify-projects
git log --oneline | head -10   # Should show Y.1-Y.5 commits
.venv/bin/pytest tests/ -q     # baseline
```

---

## Y6.1 — Code sandbox import checker

### Mission

Detect `import X` statements in `code` node Python that aren't in Dify's Python sandbox whitelist.

### Pre-req research

Find Dify sandbox whitelist:
1. Check `vendor/dify-src/api/` for sandbox config — likely under `core/helper/code_executor/` or `services/`
2. Look for `ALLOWED_MODULES` or similar constant
3. If not found: document in spec 005 as "whitelist unknown" + skip

### Implementation

`tools/dify_base/lint_code_imports.py` (~80 LOC):

```python
"""Lint Python `import` statements in Dify code nodes.

Whitelist sourced from vendor/dify-src/api/<sandbox-location>/<file>.py
(documented in this file + spec 005 sub-005.2).
"""
import ast, yaml, sys
from pathlib import Path

# TODO: derive from Dify source. Hardcoded fallback for now:
WHITELIST = {
    # stdlib commonly available
    "csv", "io", "json", "re", "datetime", "math", "hashlib", "base64",
    "collections", "itertools", "functools", "string", "urllib.parse",
    # Dify-specific allowed
    "requests", "yaml",  # verify against actual Dify config
}

def check_code(code_str: str) -> list[str]:
    """Return list of disallowed imports."""
    try:
        tree = ast.parse(code_str)
    except SyntaxError:
        return ["code has Python syntax error"]
    errors = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split('.')[0] not in WHITELIST:
                    errors.append(f"disallowed: import {alias.name}")
        elif isinstance(node, ast.ImportFrom):
            mod = (node.module or "").split('.')[0]
            if mod and mod not in WHITELIST:
                errors.append(f"disallowed: from {node.module} import ...")
    return errors

def lint_file(path):
    d = yaml.safe_load(Path(path).read_text())
    nodes = (d.get("workflow", {}).get("graph", {}) or {}).get("nodes", [])
    errs = []
    for n in nodes:
        data = n.get("data") or {}
        if data.get("type") == "code":
            for e in check_code(data.get("code", "")):
                errs.append(f"{path}: node {n['id']}: {e}")
    return errs

def main():
    if len(sys.argv) < 2:
        print("Usage: lint_code_imports.py <yml> ..."); return 2
    fail = 0
    for f in sys.argv[1:]:
        for e in lint_file(f):
            print(f"❌ {e}"); fail += 1
    return 1 if fail else 0

if __name__ == "__main__":
    sys.exit(main())
```

Pre-commit hook + test fixtures. Effort: M (~3h)

### Acceptance

- [ ] `lint_code_imports.py` exists
- [ ] Whitelist derived from Dify source OR documented as fallback in spec 005
- [ ] Tests on 4 patterns: all pass (current patterns use stdlib only)
- [ ] Test fixture with disallowed `import requests` (if not whitelisted) → fail correctly
- [ ] Pre-commit hook registered

---

## Y6.2 — Sync diff normalization

### Mission

`sync.py diff` currently does literal string diff between local + remote YAML. Dify export contains volatile fields (timestamps, internal IDs, viewport positions, `_runningStatus`, etc.) → 100% false-positive diff every time.

Need: strip known-volatile fields before compare.

### Pre-req: canary export sample

REQUIRES user to:
1. Have a working Dify Cloud workspace (per their earlier commitment)
2. Create one app there
3. Run `sync.py pull --project test --app-id <uuid>` to fetch
4. Save the YAML somewhere as reference

WITHOUT canary sample, this task is design-only.

### Implementation

Add to `tools/dify_base/sync.py`:

```python
# Fields to strip before diff (per node)
NORMALIZE_NODE_FIELDS = {
    "selected", "_runningStatus", "_isCandidate", "_iterationLength",
    "_iterationIndex", "_loopLength", "_loopIndex", "_retryIndex",
    "_waitingRun", "_connectedSourceHandleIds", "_connectedTargetHandleIds",
    "position", "positionAbsolute",  # canvas position is cosmetic
}

# Top-level fields to strip
NORMALIZE_TOP_FIELDS = {
    "viewport",  # canvas state
    # any timestamps?
}

def normalize(yml_data):
    """Strip volatile fields. Return normalized copy."""
    import copy
    d = copy.deepcopy(yml_data)
    workflow = d.get("workflow", {})
    graph = workflow.get("graph", {})
    for field in NORMALIZE_TOP_FIELDS:
        graph.pop(field, None)
    for node in graph.get("nodes", []):
        for field in NORMALIZE_NODE_FIELDS:
            node.pop(field, None)
        # Also strip from node.data if present
        data = node.get("data", {})
        for field in NORMALIZE_NODE_FIELDS:
            data.pop(field, None)
    return d
```

Use in `cmd_diff` before diff'ing.

### Acceptance

- [ ] `NORMALIZE_NODE_FIELDS` + `NORMALIZE_TOP_FIELDS` lists curated from real canary sample
- [ ] `sync.py diff` on round-trip (pull + immediately diff) → no false-positive
- [ ] `sync.py diff` after real local edit → shows real diff
- [ ] Documented in `docs/specs/005-qa-strategy.md` sub-spec 005.4 with sample export reference

---

## Y6.3 — AGENTS.md periodic self-test

### Mission

Spec 002 Y2.4 ran 1 self-test manually. This task: automate periodic re-test + structured log.

### Implementation

`scripts/agents_md_self_test.sh`:

```bash
#!/usr/bin/env bash
# Run a structured self-test of AGENTS.md effectiveness.
# Spawns a fresh agent (via Claude Code CLI or similar) with a canned task.

# This requires a way to spawn agent. If claude CLI available:
# claude code "Create a Dify workflow for X" --no-context

# Else: print task to user, ask them to run + paste outcome.

# Log to docs/specs/002-agents-md-self-test.md (append new section)
```

Effort: M (~2-3h depending on automation availability)

### Acceptance

- [ ] Script exists
- [ ] One additional self-test run logged
- [ ] If observed failures from baseline run not fixed → flagged in log

---

## Y6.4 — Migration tool design (Spec 006.M)

### Mission

When Dify bumps DSL (vd 0.6.0 → 0.7.0), existing patterns + projects' workflows may need updates. Design a tool to assist (not auto-execute).

### Implementation

Write `docs/specs/006-M-migration-tool.md`:

Outline:
- Trigger: detected by `gen_schema.py` (new schema file with bumped version)
- Approach: per-version migrator (functions: `migrate_0_6_to_0_7(yml_dict) -> yml_dict`)
- Diff display tool
- Validation against both old + new schema
- Per-project migration flag

Status: Design only — actual implementation when DSL bumps.

### Acceptance

- [ ] `docs/specs/006-M-migration-tool.md` exists
- [ ] Identifies trigger + interface + acceptance criteria
- [ ] References real-world examples (n8n migration tool?)

---

## Commit (per sub-task)

Each sub-task = separate commit:

```
Phase Y.6.X: <title>

[describe]

Refs: docs/specs/005-qa-strategy.md sub-spec 005.X
```

Push only after entire Y.6 subset done (per user push policy).

## On blocker

- Y6.1 whitelist unknown → log spec 005 + skip implementation, mark "research needed"
- Y6.2 no canary sample → design only, no code
- Y6.3 no agent CLI available → manual checklist, document
- Y6.4 always design-only at this stage
