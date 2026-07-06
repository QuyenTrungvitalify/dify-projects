# Spec 038 — P2 false-positive report (`lint_node_bodies.py`)

**Measured**: 2026-07-07, on the index rebuilt the same day (spec 038 D8 — the surface is
snapshotted here, not hard-coded). Tool at commit `e0c426f` (P1); pattern fix applied mid-measure
(see Adjudication). Replicates the [020-fp-report](020-fp-report.md) shape: surface → funnel →
demotion-necessity → verdict → reproduce.

## Surface (rebuilt index snapshot)

| tier | files | gated by pre-commit? |
|---|---|---|
| `templates/patterns` | 6 | **yes** |
| `templates/library` | 1 | **yes** |
| `examples` | 1 | no (indexed, promotion-vetted) |
| `project` | 3 | **yes** (at commit time) |
| `corpus:awesome-dify-workflow-en` | 26 | no (vendored, read-only) |
| `skill-assets` | 5 | no (vendored, read-only, old DSL) |
| **total indexed** | **42** | |
| `projects/_drafts/*/workflows/*.ya?ml` (gitignored, index-excluded; the D8 asymmetry — the gate regex WOULD match them if ever staged) | 14 | measured separately |

## Per-def violation funnel

| stage | count |
|---|---|
| nodes across the 42 indexed files | 402 |
| − sticky notes / no `data.type` (silent skip) | 10 |
| − def-less / `_error`-stub warn-skips | 14 (`http-request` ×8 — `_error` dump-stub, spec 024 S1; `assigner` ×6 — no def dumped) |
| = bodies validated | **378** |
| findings, first run | **14** — ALL in `agent`-type nodes: `templates/patterns/agent-with-tools.yml` ×13, `skills/Tomatio13/example/adoviser_bot.yml` ×1 |
| findings, after the true-positive fix (below) | **1** (adoviser_bot only) |
| findings on the GATE surface | **0** |
| `_drafts` sweep (14 files) | 0 findings, 0 skips |

Zero findings across every `llm`, `code`, `start`, `end`, `if-else`, `iteration`,
`template-transform`, `tool`, `knowledge-retrieval`, `question-classifier`,
`parameter-extractor`, `variable-aggregator`, `document-extractor`, `list-operator`,
`iteration-start` and `answer` body in the corpus — **the OQ1 fear (pydantic `required[]`
stricter than reality) did not materialize outside the agent def.**

## Adjudication — the agent findings are TRUE POSITIVES, not FPs

`templates/patterns/agent-with-tools.yml` (gate surface) failed 13 checks: the three
`agent_strategy_*` fields sat NESTED inside `agent_parameters` instead of at `data.*`, and every
`agent_parameters` value was a raw scalar/list where `AgentNodeData.agent_parameters:
dict[str, AgentInput]` requires `{type: constant|variable|mixed, value: …}` objects.

Authority: `vendor/dify-src/api/core/workflow/nodes/agent/entities.py` — `AgentNodeData` declares
`agent_strategy_provider_name/name/label: str` and `agent_parameters: dict[str, AgentInput]`
**without defaults**; Dify constructs `AgentNodeData(**node["data"])` at execution, so the
pattern as previously written was a guaranteed **runtime pydantic ValidationError**. The linter's
first catch is a real, latent bug in a curated pattern that all three existing linters, the
schema envelope hook, and yamllint had passed. **Fix applied to the pattern (same PR), not a
demotion.**

`skills/Tomatio13/example/adoviser_bot.yml` (1 finding — a `select` parameter type not in the
start-variable enum): vendored reference asset on an older DSL, never on the gate surface —
triaged per D8, not blocking, not demoted (never-gated files do not justify demotion rows).

## Demotion-necessity table

| def | field | FP count prevented | report citation |
|---|---|---|---|
| *(empty — zero demotions needed; `DEMOTED_REQUIRED` ships empty)* | | | |

## Verdict

**0 false positives on the gate surface** (and 0 anywhere — the 14 initial findings were 13 true
positives + 1 never-gated reference file). The spec-020 promotion condition is met: P3 may wire
`lint_node_bodies` as the 4th `LINTERS` entry and the pre-commit hook.

## Reproduce

```bash
.venv/bin/python tools/dify_base/build_index.py   # snapshot the surface first (D8)
.venv/bin/python - <<'PY'
import json, subprocess
paths = [e["path"] for e in json.load(open("tools/dify_base/index.json"))]
raise SystemExit(subprocess.run([".venv/bin/python", "tools/dify_base/lint_node_bodies.py", *paths]).returncode)
PY
# the gitignored drafts sweep (NUL-delimited — corpus filenames contain spaces):
find projects/_drafts -path '*/workflows/*' \( -name '*.yml' -o -name '*.yaml' \) -print0 \
  | xargs -0 .venv/bin/python tools/dify_base/lint_node_bodies.py
```

## Post-review changes log

- 2026-07-07 — initial measurement (14 findings) → agent adjudicated true-positive against the
  vendored Dify source → `agent-with-tools.yml` fixed (strategy fields lifted to `data.*`,
  `agent_parameters` values wrapped as `AgentInput` objects, TODO markers preserved) → re-measure:
  1 finding, never-gated tier only; gate surface clean.
- 2026-07-07 (same day, process note) — the first commit attempt raced a concurrent Builder turn
  whose confinement backstop reverted the (then-uncommitted) pattern fix + this report; both were
  re-applied and committed in a no-turn window. The measurement numbers were unaffected.
