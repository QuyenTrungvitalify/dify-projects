# Spec 038 — Node-body schema linter: wire the 29 dormant `NodeData_*` $defs (`lint_node_bodies.py`)

**Status**: Partially implemented — P1 shipped 2026-07-07 (see r3: tool + 18 tests + dead-code removal,
UNWIRED as designed); P2 preview measured (41 indexed files → findings ONLY in agent-type nodes, 2 files);
the formal P2 report (038-fp-report.md, agent-def adjudication) and P3 promotion remain. Rollout copies spec
020's mandatory 3 phases verbatim — nothing gates until the written FP report over the indexed surface ships.
D1–D8 locked (adversarially judged pre-implementation).

**Builds on**:
- [020](020-builder-graph-reachability-linter.md) — the 3-phase rollout discipline (warn-only → measured
  0-FP report → promote) and the full-line escape-hatch marker precedent (`# lint-refs: allow-reach`,
  [lint_refs.py `ALLOW`-marker handling](../../tools/dify_base/lint_refs.py#L176)). **Load-bearing**: phase 2's
  report ([020-fp-report.md](020-fp-report.md)) is the template this spec's report replicates, funnel and all.
- [013](013-builder-linter-contract-and-test-seams.md) — the single-source `LINTERS` contract
  ([linters.ts:26](../../apps/builder/server/lib/linters.ts#L26)). This spec **owns the first widening** of the
  3-linter key union since 013 (D5) — 020 deliberately avoided one; 038 explicitly makes the opposite choice.
- [003](003-variable-ref-linter.md) — `lint_refs.py`'s CLI/exit-code conventions, copied verbatim (D-conventions
  in §Design), and its warn-skip-unknown-type precedent ([lint_refs.py:131](../../tools/dify_base/lint_refs.py#L131)).
- [024](024-reality-reconciliation-and-cross-cutting-gaps.md) — S1 (fix the `HttpRequestNodeData` dump) is a
  **sibling, not a prerequisite**: D4 derives the skip from the schema file at runtime, so fixing the dump turns
  http-request coverage on automatically with zero linter edits.
- [032](032-builder-live-workflow-test.md) — composes, no collision: 032's ④ live test catches **runtime**
  failures after deploy; 038 catches **shape** failures at the ③ post-turn gate, offline and earlier. 032 B5's
  `verified ≠ shipped` model-empty policy stays valid (see Context). 032 OQ3 (builder emits model-empty llm
  nodes) is exactly the class of drift the measure phase will quantify.
- [039](039-post-turn-multi-workflow-lint.md) — same-day sibling, composes: 039's per-extra-file gate maps
  over `LINTERS` generically (039 D3), so the 4th entry from D5 flows through with **zero** 039 code edits —
  but its worst-case per-extra spawn count becomes 5 (probe + 4 linters), and its "all 3 `LINTERS` scripts" /
  "three python linters" phrasings go stale at 038's promotion. 039 D6 also widens the five DSL pre-commit
  `\.yml$` regexes to `\.ya?ml$` — P3's hook clone tracks whichever regex is live at land time (see P3).

**Depends on**: nothing new. `jsonschema==4.26.0` is **already in the venv** — a direct requirement
([requirements.in:8](../../requirements.in#L8), also pulled by `check-jsonschema`,
[requirements.txt:64](../../requirements.txt#L64)) — no new external deps, no Dify contact, no gate-FSM change,
no schema regeneration, no edit to `gen_schema.py`. Phases 1–2 touch **neither** `linters.ts` **nor**
`.pre-commit-config.yaml` — existing paths byte-unchanged until promotion.

---

## Context — 29 schemas, zero consumers

The weekly-regenerated DSL schema carries a full pydantic-derived object schema for every node body — and
**nothing reads them**. Confirmed directly:

- [dify-dsl-0.6.0.json:220](../../schemas/dify-dsl-0.6.0.json#L220) — `"NodeData_AnswerNodeData"` is the first
  of exactly **29** `NodeData_*` $defs. Of the file's 228 `$ref` occurrences, **none** targets a `NodeData_*`
  def — root-level `$ref`s point only at `#/$defs/Node`, `#/$defs/Edge`, `#/$defs/Position`.
- [gen_schema.py:431](../../schemas/gen_schema.py#L431) — the root `Node.data` subschema is
  `{"type": "object", "required": ["type"], "properties": {"type": {"type": "string"}}}`. So the existing
  check-jsonschema pre-commit hook ([.pre-commit-config.yaml:56-61](../../.pre-commit-config.yaml#L56-L61))
  validates only that `data.type` **exists** — node bodies are otherwise unvalidated.
- [validate_workflow.py:182-197](../../tools/dify_base/validate_workflow.py#L182-L197) — the dispatch covers
  7 types (`start`/`end`/`answer`/`llm`/`code`/`variable-aggregator`/`if-else`), 6 of them with deep checks —
  `answer` only sets a presence flag — and those checks are shallow required-key checks (e.g. llm
  `model.provider/name/mode` + `prompt_template`).

The gap concretely: a typo'd optional key, a missing `code_language`, a `prompt_template` shaped as a dict where
a list is required — all pass every committed gate today and surface only at Dify import or at 032's live run
(late, online, and after a full build). `lint_node_bodies.py` closes this by dispatching each node's `data.type`
to its `NodeData_*` def and validating the body.

**One 032 interaction named precisely so it isn't oversold:** `NodeData_LLMNodeData` requires
`['title','model','prompt_template','context']` and its nested `ModelConfig` requires `['provider','name','mode']`
(verified in the live schema). The builder's model-empty emission (032 OQ3, `{name:''}`) passes `type: string`
with empty strings — the linter does **not** collide with the B5 portability policy — but if `implement.md` emits
a `model` object missing the `provider`/`mode` **keys**, the measure phase will flag every builder llm node. That
is either a real catch (fix `implement.md` — the 032 OQ3 root cause) or a D3 demotion; the report decides.

## Design decisions

- **D1 · Validate each def as a standalone schema document; the $defs stay unreferenced (locked).** Every
  `NodeData_*` def is self-contained: it carries its own nested `$defs` block, and all of its internal
  `#/$defs/Foo` pointers resolve **within that nested block** — but NOT from the full document root (root
  `$defs` holds only `Node`/`Edge`/`Position` + the `NodeData_*` keys). The linter therefore extracts
  `schema["$defs"]["NodeData_X"]` and validates the node's `data` block against it as its own document, so the
  nested `$defs` travel with it. **A rejected alternative** (recorded so it isn't re-litigated): wiring `$ref`s
  from the root `Node` def into the `NodeData_*` defs. That would flip the existing check-jsonschema pre-commit
  hook into a hard body-gate **INSTANTLY** — skipping the advisory phase entirely. The defs stay unreferenced;
  type-matching happens inside the new linter only, and AC 6 pins this structurally.
- **D2 · Hand-authored `TYPE_TO_DEF` table + drift test; no generator change in v1 (locked).** The mapping
  cannot be derived from the schema: 27 of 29 defs carry **no** `type` discriminator property (only the two
  Knowledge* defs do). The convention is `PascalCase(kebab-type) + 'NodeData'` with exceptions —
  `llm → NodeData_LLMNodeData` (all-caps), `webhook → NodeData_WebhookData` (no `Node`) — and
  `NodeData_Base{Iteration,Loop}NodeData` are pydantic base classes, not node types (never mapped). So the
  linter carries an explicit table, `IMPLICIT_OUTPUTS`-style
  ([lint_refs.py:28](../../tools/dify_base/lint_refs.py#L28)), kept honest by a drift test: every non-`None`
  table entry must resolve to a def in the schema file (`None` rows sit on the documented skip list — AC 5),
  and every non-base def must be mapped or on that skip list.
  **Rejected for v1:** extending `gen_schema.py` to stamp an `x-node-type` onto each def — it touches the weekly
  generator ([refresh-schema.yml:5](../../.github/workflows/refresh-schema.yml#L5)) and needs a regeneration PR;
  the drift test buys the same safety with zero generator surface. Revisit if the table ever drifts in practice
  (OQ ledger). **Adjacent drift killed honestly, not oversold:** `KNOWN_NODE_TYPES`
  ([lint_refs.py:40-57](../../tools/dify_base/lint_refs.py#L40-L57)) is **dead code** (no consumer outside its
  own definition — repo-wide grep) → **delete it** in P1; `TYPE_TO_DEF` becomes the authoritative type list.
  `IMPLICIT_OUTPUTS` itself **cannot** be regenerated from the defs — its values are *runtime output* fields
  (`llm → text/usage`), which the `NodeData_*` *input-shape* schemas simply do not contain. Instead, the drift
  test asserts `IMPLICIT_OUTPUTS.keys() ⊆ TYPE_TO_DEF.keys()`, so a renamed/removed type can no longer drift
  silently between the two tools.
- **D3 · Strictness: `additionalProperties` stays open; `required[]` validates as-dumped, with a measured
  demotion list (locked).** The pydantic dumps omit `additionalProperties` entirely (verified: absent on all
  29) — and that is **load-bearing**: real data blocks carry keys no def declares (`type` itself is absent from
  27 defs; `selected`, `isInIteration`, `isInLoop`). Setting `additionalProperties: false` would FP on
  essentially every file — a non-goal, permanently. `required[]` is the aggressive part (`StartNodeData` requires
  `title`; `CodeNodeData` requires 5 fields; `ToolNodeData` 8) and whether Dify's importer actually rejects a
  missing field or applies pydantic defaults is unknown (OQ1) — exactly what phase 2 measures. Mechanism: a
  `DEMOTED_REQUIRED: dict[def_name, set[field]]` table in the linter; demoted findings print as **warnings →
  stderr and never gate**; the FP report justifies every demotion row. The **shipped table starts empty** in P1
  (no row exists before P2 evidence), so the demotion path needs a test seam that crosses the subprocess
  boundary (the AC-suite runs the linter via `sys.executable` — no monkeypatching): a repeatable
  `--demote DEF:FIELD` CLI flag that unions into the table for that run, used only by the AC 2 fixture test.
  Before promotion, the escape hatch lands:
  a full-line, line-start-anchored comment `# lint-bodies: allow <node_id>` suppresses all body findings for that
  node (mirrors 020's marker — without it the only escape is `--no-verify`, which bypasses *all* hooks).
- **D4 · Def-less and `_error`-stub types: warn-skip, derived from the schema at runtime — zero hand-sync
  (locked, closes a sync-burden gap the adversarial pass found).** Two of the 19 corpus-used types can't be
  validated today: `assigner` (no def was ever dumped) and `http-request`
  ([dify-dsl-0.6.0.json:1466](../../schemas/dify-dsl-0.6.0.json#L1466) — a 3-line `_error` stub with no
  properties). Rule: if `TYPE_TO_DEF` has no entry for the type, **or** the mapped def carries an `_error` key,
  emit a stderr warning and skip — exactly the [lint_refs.py:131](../../tools/dify_base/lint_refs.py#L131)
  precedent. Because the `_error` detection reads the schema file, the linter needs **no** allowlist synced with
  `KNOWN_BROKEN_DUMPS` ([gen_schema.py:267](../../schemas/gen_schema.py#L267)) or
  [test_docs_drift.py:125](../../tests/test_docs_drift.py#L125): when 024 S1 fixes the dump, the next schema
  regeneration turns http-request coverage on automatically (that refresh then warrants a mini FP re-measure —
  see Risks). Sticky-note/annotation nodes (empty `data.type`) are silently skipped, matching `build_node_map`.
- **D5 · A new script and a 4th `LINTERS` entry at promotion — own the spec-013 contract change explicitly
  (locked).** 020 folded into `lint_refs`' key because it reused that tool's parser/node-map/walker (its Q3).
  Here **nothing** is reused from any existing linter — the machinery is `jsonschema` + the schema file — so a
  separate `tools/dify_base/lint_node_bodies.py` duplicates nothing, and the alternative (folding into
  `validate_workflow.py`'s `validate` key) would bolt `import jsonschema` and a schema-file dependency onto the
  canonical vendored structural validator. The contract change is mechanical **because** linters.ts is
  single-source ("a linter added/renamed/repathed here changes all consumers at once",
  [linters.ts:9-10](../../apps/builder/server/lib/linters.ts#L9-L10)); the promotion slice edits exactly: the
  key union ([linters.ts:21](../../apps/builder/server/lib/linters.ts#L21)), the `LINTERS` array (:26), the
  `lintClean` conjunction (:37-38), and `LintCodes` (:33). The ③ post-turn gate picks the 4th entry up with zero
  further edits ([post-turn.ts:136](../../apps/builder/server/lib/post-turn.ts#L136) maps over `LINTERS`
  concurrently via `runPython`), and — because `lintClean` also guards the ④ Import precondition
  ([linters.ts:36](../../apps/builder/server/lib/linters.ts#L36)) — a promoted body failure blocks import/live
  before 036's test targets ever run (composes; 036 unchanged).
- **D6 · Schema selection: pin `schemas/dify-dsl-0.6.0.json` as the default, `--schema <path>` to override
  (locked).** The pin matches the check-jsonschema hook arg
  ([.pre-commit-config.yaml:61](../../.pre-commit-config.yaml#L61)) and the `dify-dsl-version-guard`, so every
  body-adjacent gate agrees on one schema version. Everything — def list, properties, `required[]`, `_error`
  stubs — is read from the file **at runtime**; the linter hard-codes no shapes, so the weekly refresh cannot
  silently diverge from it. A DSL version bump (refresh-schema.yml opens the PR) updates the pin alongside the
  hook args in the same commit; `--schema schemas/_latest.json`
  ([gen_schema.py `_update_latest_symlink`](../../schemas/gen_schema.py#L658)) serves ad-hoc runs against a
  fresh regeneration.
- **D7 · Shape vs semantics split: the schema linter is authoritative for shape; `validate_workflow.py` keeps
  its 6 deep checks (locked).** The overlap on start/end/llm/code/variable-aggregator/if-else is real but those
  checks also carry semantics a JSON Schema can't express (`cases[]`→edge-handle routing, mode-dependent
  terminal node). Double-reporting on the 6 types is accepted in v1; retiring the purely-shallow key checks is
  **future work**, considered only after 038 has gated for a while (touching the vendored canonical validator
  for a de-dup is not worth it now — not "phình").
- **D8 · Measure over the index REBUILT at measure time; gate only the pre-commit regex surface (locked).**
  020's split, updated for the corpus swap — and single-sourced, because the checked-in
  [index.json](../../tools/dify_base/index.json) is **stale**: all 7 of its `projects` entries point at files
  deleted from disk (`eiken_stem_proofread/*`, `news_automation/*`), so "run over the 46 entries as checked in"
  would exit 2 on 7 file-not-founds. P2 therefore starts with an index rebuild (`build_index.py`, the
  corpus-update flow) and measures **every file in the rebuilt index**; the report snapshots that surface table
  (counts per source) rather than this spec hard-coding them. The rebuilt indexed surface spans 19 distinct
  `data.type` values — the index's `node_types` rollup shows 18 because
  [build_index.py:95-96](../../tools/dify_base/build_index.py#L95-L96) deliberately drops the container-start
  types, but 6 indexed files carry `data.type: iteration-start` in their raw YAML (5 corpus Workflow-Store
  files + [file-iteration.yml](../../templates/patterns/file-iteration.yml)). Skills/examples/corpus are
  indexed-but-never-gated; the hard gate covers only
  `^(templates/(patterns|probes|library)/.*\.yml|projects/.*/workflows/.*\.yml)$` — the same `files` regex as
  the sibling hooks ([.pre-commit-config.yaml:98](../../.pre-commit-config.yaml#L98)), copied verbatim so a
  future re-path (spec [030 nested folders](030-builder-nested-project-workflow-folders.md), which already
  verified the validators are path-agnostic) edits all hooks the same way. One honest asymmetry, measured
  anyway: the gate regex also matches `projects/_drafts/*/workflows/*.yml` builder outputs, which the rebuilt
  index **excludes** (its gitignore filter drops them, [build_index.py `_filter_gitignored`](../../tools/dify_base/build_index.py#L253));
  P2 measures those on-disk files too, listed separately in the report. The reproduce command keeps the
  NUL-delimited idiom from [020-fp-report.md:53-60](020-fp-report.md#L53-L60) — corpus filenames contain spaces.

## Design

### The check (per file)

```
schema  = json.load(--schema | schemas/dify-dsl-0.6.0.json)          # D6
defs    = schema["$defs"]
for node in workflow.graph.nodes:                                     # non-dict node → structured error, exit 2
    t = node.data.type
    if not t:                 continue                                # sticky note — silent skip (D4)
    def_name = TYPE_TO_DEF.get(t)
    if def_name is None or "_error" in defs[def_name]:
        warn(stderr, f"no usable schema for node type '{t}' — skipping body validation"); continue   # D4
    if allow_marker_covers(node.id):  continue                        # '# lint-bodies: allow <id>' (D3)
    for err in jsonschema.Draft202012Validator(defs[def_name]).iter_errors(node.data):   # standalone doc (D1)
        if is_demoted_required(def_name, err):  warn(stderr, ...)     # D3 demotion list
        else: error(stdout, f"{path}:{line}: node '{id}' ({t}): {err.json_path}: {err.message}")
exit: 0 clean · 1 ≥1 finding · 2 usage/parse-error/file-not-found     # lint_refs.py:12-15 contract, copied
```

CLI conventions copied verbatim from `lint_refs.py` (:396-435): plain argv loop (no argparse), multi-file with
overall = max(per-file codes), warnings→stderr, errors→stdout with `path:line:` prefixes where a line is
attributable, and `validate_workflow.py`'s V1 rule — malformed input (non-dict node, non-list `nodes`) produces
a structured error, **never** a traceback (a hard gate that stack-traces is a spec-026-class regression).

**Line attribution, specified** (lint_refs' precedent does NOT transfer — it regex-scans raw text lines for
`{{#...#}}` ([lint_refs.py:348](../../tools/dify_base/lint_refs.py#L348)), which cannot locate a data block or
a *missing* field, and `yaml.safe_load` discards marks): parse once more with `yaml.compose()` (or a
mark-capturing `SafeLoader` subclass) to build a `node_id → start_mark.line + 1` map; the prefix line is the
**node's own mapping start** (its `- id:` line), never the offending field's; if the id can't be resolved
(duplicate/missing ids), degrade to a `path:` prefix with no line — a finding is never dropped over attribution.

### The mapping table (v1)

`TYPE_TO_DEF` covers all 29 defs minus the 2 base classes; the 19 corpus-used types are the measured surface.
Regular rows are `kebab-case → NodeData_{PascalCase}NodeData` (`code → NodeData_CodeNodeData`,
`question-classifier → NodeData_QuestionClassifierNodeData`, …); the irregulars, spelled out:
`llm → NodeData_LLMNodeData`, `webhook → NodeData_WebhookData`. `assigner` gets an explicit
`None`-with-comment row (no def dumped — D4 warn-skip, revisit when gen_schema dumps VariableAssignerNodeData);
`None` rows double as entries on the D2 documented skip list, so the AC 5 drift test asserts resolution only
for non-`None` values. The container-start spelling is **verified, closed** (was OQ2): real DSL puts
`data.type: iteration-start` inside nodes whose node-level `type` is `custom-iteration-start`
([file-iteration.yml:223-226](../../templates/patterns/file-iteration.yml#L223-L226),
[gen_schema.py:428](../../schemas/gen_schema.py#L428)), so `iteration-start → NodeData_IterationStartNodeData`
is a corpus-exercised row (6 indexed files), and `loop-start` maps symmetrically. Defs the corpus never uses
(datasource, human-input, knowledge-index, trigger-*, loop family incl. loop-start) are mapped anyway — free
coverage, but **zero FP-measurement signal**, stated honestly in the report.

### Tests (fixture-based, mirroring `tests/test_lint_refs.py`)

`tests/test_lint_node_bodies.py` + `tests/fixtures/lint_node_bodies/*.yml`, driven by the
`EXPECTED: dict[fixture, exit_code]` + `@pytest.mark.parametrize` + subprocess-via-`sys.executable` pattern
([test_lint_refs.py:13-31](../../tests/test_lint_refs.py#L13-L31)), plus targeted message-text assertions and
the drift tests from D2/D4. Fixture set enumerated in AC 1–5.

## Goals

1. A wrong-shaped node body (missing required field, wrong-typed nested value, malformed enum) is caught at the
   ③ post-turn gate / pre-commit — **offline, before** Dify import and before 032's ④ live run.
2. **Zero false positives on the gated surface** before anything gates (the 019 §3.1 / 020 discipline), proven
   by a written report over the full indexed surface, rebuilt at measure time (D8).
3. The 29 generated schemas become load-bearing **without touching the generator or the root schema** — a
   weekly `refresh-schema.yml` regeneration changes linter behavior only through the schema file it already
   reads (D6), never through code drift.
4. One authoritative node-type table (`TYPE_TO_DEF`) replaces `lint_refs.py`'s dead `KNOWN_NODE_TYPES`, with
   drift tests binding it to the schema and to `IMPLICIT_OUTPUTS` (D2).

## Non-goals

- **No** wiring `$ref`s from the root `Node` def into `NodeData_*` (D1) — that path instantly hard-gates via the
  existing check-jsonschema hook and is structurally excluded, not just deferred (AC 6).
- **No** `additionalProperties: false` and **no** unknown-key/edit-distance advisory in v1 (D3) — typo'd
  *optional* keys still pass; tracked in the OQ ledger for after the gate is live (OQ3).
- **No** `gen_schema.py` changes: no `x-node-type` stamping (D2), no fixing the `HttpRequestNodeData` dump —
  that is spec 024 S1's job, referenced by number only; D4 makes 038 pick the fix up automatically.
- **No** retiring `validate_workflow.py`'s 6 deep checks (D7) — double-reporting accepted in v1.
- **No** autofix, **no** multi-attempt repair loop, **no** severity model beyond gate/warn — report only,
  matching every sibling linter.
- **No** builder-UI surface beyond what the 4th `LINTERS` entry buys for free (③ failure reason + ④ report note
  through the existing plumbing).

## Rollout — the mandatory 3 phases (019 §3.1, exactly as 020 ran them)

One simplification vs 020, stated up front: because the tool is **new**, its exit-code contract is final from
day 1 (0/1/2) and "advisory" means **unwired** — phases 1–2 add it to neither `LINTERS` nor pre-commit, so
nothing enforces it. No flag-flip or default-exit change happens at promotion; promotion is pure wiring.

1. **P1 · Tool + tests (warn-only by non-wiring).** `tools/dify_base/lint_node_bodies.py` (D1–D4, D6),
   `tests/test_lint_node_bodies.py` + fixtures, delete `KNOWN_NODE_TYPES` from `lint_refs.py`, add the D2 drift
   tests. Touches neither `linters.ts` nor `.pre-commit-config.yaml`; existing gates byte-unchanged.
2. **P2 · Measure.** First **rebuild the index** (`build_index.py` via the corpus-update flow — the checked-in
   one is stale, D8), then run over **every file in the rebuilt index** plus the on-disk
   `projects/_drafts/*/workflows/*.yml` gate-regex matches the index excludes (D8; NUL-delimited paths —
   filenames contain spaces). Produce [`038-fp-report.md`](038-fp-report.md) replicating 020's shape: surface
   table (a snapshot of the rebuilt index at measure time, counts per source), a **per-def violation funnel**
   (total nodes → skipped sticky/def-less/`_error` → validated → findings per def, so reviewers see exactly
   which `required[]` fields dominate), a demotion-necessity table (each `DEMOTED_REQUIRED` row with the FP
   count it prevents), the reproduce command, and a post-review changes log. Iterate the demotion list until
   the report is **0 FP on the gate surface**; findings on never-gated files (skills/examples/corpus) are
   triaged in the report but do not block. The 032-OQ3 model-empty question (Context) is answered here.
3. **P3 · Promote + docs.** The spec-013 contract change (D5: key union + array + `lintClean` + `LintCodes`),
   the escape-hatch marker (D3), a `dify-lint-node-bodies` local hook cloned from the `dify-lint-refs` block
   ([.pre-commit-config.yaml:92-99](../../.pre-commit-config.yaml#L92-L99), `require_serial: false`, and the
   same `files` regex **as it stands at land time** — `\.ya?ml$` if 039 D6 has merged first; conversely, if 038
   lands first, 039's "five regexes" count becomes six). Verify non-breaking: gate-surface files pass the
   default run; `pre-commit run dify-lint-node-bodies --all-files` → Passed. Docs: one AGENTS.md line (the
   4-linter list),
   one builder-README line, and an index row in [docs/specs/README.md](README.md).

## Acceptance criteria

1. Fixture `bad_missing_required.yml` (an `llm` node without `prompt_template`) → exit 1, message names the
   node id, the type, and the missing field with a `path:line:` prefix. *(P1)*
   - 1b. **Hardened variant proving D1's standalone-subschema extraction (the weak test above would pass
     without it):** fixture `bad_nested_ref.yml` is valid at the top level but breaks a constraint that lives
     only inside the def's **nested `$defs`** (e.g. an llm `model` object missing `provider` — resolved via the
     internal `#/$defs/ModelConfig` ref). A naive implementation that validates only top-level
     `properties`/`required[]` passes 1 but fails 1b; exit 1 with the nested `json_path` in the message.
2. Fixture `valid_real_shape.yml` (a realistic body carrying `type`, `selected`, `isInIteration` — keys absent
   from the defs) → exit 0, proving D3's open-`additionalProperties` posture. A demoted-required fixture
   exercises the demotion path via the test-only `--demote NodeData_X:field` flag (D3 — the shipped
   `DEMOTED_REQUIRED` table is empty until P2 justifies rows, and the subprocess harness can't monkeypatch it):
   warning on **stderr**, exit **0**; the same fixture without `--demote` exits **1**. *(P1)*
3. Def-less/broken skips (D4): fixture with an `assigner` node and an `http-request` node, otherwise clean →
   exit 0 with two stderr warnings. *(P1)*
   - 3b. **Hardened variant proving the skip is schema-derived, not hand-coded:** the test copies the schema,
     deletes the `_error` key from `NodeData_HttpRequestNodeData` and gives it a minimal object schema, passes
     the copy via `--schema` — and asserts the same http-request node **is now validated** (a finding appears).
     A hard-coded `if type == 'http-request': skip` passes 3 but fails 3b.
4. Malformed input (fixture with a non-dict node, and a non-YAML file) → exit 2 with a structured one-line
   error, **no traceback** (assert `Traceback` not in output) — the spec-026-class regression guard. *(P1)*
5. Drift tests (D2): every **non-`None`** `TYPE_TO_DEF` value resolves to a def in the pinned schema, and every
   `None` row (`assigner`) appears on the documented skip list; every non-base `NodeData_*` def is mapped or on
   the documented skip list; `IMPLICIT_OUTPUTS.keys() ⊆ TYPE_TO_DEF.keys()`; `KNOWN_NODE_TYPES` no longer
   exists in `lint_refs.py`. All in `tests/test_lint_node_bodies.py`. *(P1)*
6. **Instant-gate guard (D1, anti-gaming):** a test asserts the pinned schema's root `Node.data` subschema is
   still the bare `{type}` shape ([gen_schema.py:431](../../schemas/gen_schema.py#L431)) — i.e. nobody "helpfully"
   wired the `$ref`s and hard-gated the corpus through the check-jsonschema hook while this spec was mid-rollout. *(P1)*
7. [`038-fp-report.md`](038-fp-report.md) exists with the P2 contents (per-def funnel, demotion-necessity table,
   reproduce command) and shows **0 FP on the gate surface**; every `DEMOTED_REQUIRED` row cites the report. *(P2)*
8. Promotion (P3): `LINTERS` has 4 entries and the ③ gate + ④ report run all four. Proving test: the
   apps/builder unit suite extends the linter-contract tests to assert
   `lintClean({validate:0, lint_refs:0, lint_plugin_hashes:0, lint_node_bodies:1}) === false`. *(P3)*
   - 8b. **Why 8's array-length check alone is insufficient (anti-gaming):** adding the array entry while
     forgetting the `lintClean` conjunction ([linters.ts:37-38](../../apps/builder/server/lib/linters.ts#L37-L38))
     passes any "4 entries exist" test yet never gates — 8's assertion is specifically on the **conjunction**
     rejecting a non-zero 4th code, and a mirror assertion accepts all-zero.
9. `pre-commit run dify-lint-node-bodies --all-files` → Passed on the current tree; the escape-hatch marker
   `# lint-bodies: allow <id>` suppresses a deliberate fixture finding (full-line anchored — a `#` inside a
   prompt string must NOT forge it; both cases fixtured). *(P3)*

## Biggest risks (+ mitigations)

1. **`required[]` is stricter than Dify's importer** (pydantic defaults may make a missing llm `context`
   harmless) → the entire P2 phase exists to measure this; `DEMOTED_REQUIRED` demotes per-field with report
   evidence, never blanket-disables `required[]` (D3).
2. **Weekly schema refresh changes def shapes under the promoted gate** → no shapes are hard-coded (D6); the
   drift tests (AC 5) fail the PR if a def disappears/renames; the refresh PR that first un-stubs http-request
   (024 S1) triggers a documented mini re-measure before merge (D4).
3. **The instant-gate hazard** — someone wires the root `$ref`s "while they're in there" → excluded by D1 and
   pinned by AC 6, so the hazard is **dissolved structurally, not mitigated by review vigilance**.
4. **Contract widening breaks a `lintClean` consumer** → linters.ts is the single source (spec 013's whole
   point); AC 8/8b prove the conjunction, and the ③ gate / ④ report consume the array generically.
5. **Mapping-table mistakes on never-exercised types** (loop-start, trigger family) → those rows carry zero
   measurement signal (D8, stated in the report); `iteration-start` is NOT in this class — its row gets real
   gate-surface signal in P2 ([file-iteration.yml](../../templates/patterns/file-iteration.yml) sits on the
   hard-gated `templates/patterns/` surface, plus 5 corpus files); unknown spellings degrade to a stderr
   warn-skip, never a wrong gate (D4).

## Open questions

- **OQ1 (D3)** — does the Dify importer apply pydantic defaults for missing required fields, or reject?
  Default: assume reject until P2 evidence says otherwise; demote only fields the P2 measurement proves
  are routinely absent in imported-and-working workflows (and note 032's live-verified runs as corroboration).
- **OQ2 — CLOSED (r2)** — real DSL spells container-start as `data.type: iteration-start` under node-level
  `type: custom-iteration-start` ([file-iteration.yml:223-226](../../templates/patterns/file-iteration.yml#L223-L226);
  same shape in 5 corpus Workflow-Store files: BookTranslate, Claude3 Code Translation, dify_course_demo,
  json_translate, llm2o1.cn). The original premise ("the index shows no such entries") was an artifact of the
  `node_types` rollup dropping container-start types ([build_index.py:95-96](../../tools/dify_base/build_index.py#L95-L96)).
  The `iteration-start` row is trusted and measured (D8, Risk 5); unmatched spellings still degrade to a D4
  warn-skip.
- OQ3 (unknown-key advisory) and the `x-node-type` generator stamp are **closed for v1** — recorded as rejected
  alternatives in D3/D2 respectively; revisit only after the gate has run quietly for a while.

## Revision log

- r1 (2026-07-06) — initial draft (authored via multi-agent analysis; design pre-judged adversarially, code
  anchors verified against the live tree the same day).
- r2 (2026-07-06) — adversarial-review fixes: OQ2 closed (iteration-start verified in real DSL → 19 corpus-used
  types, Risk 5 corrected); D8 re-anchored to the index **rebuilt at measure time** (the checked-in index's 7
  `projects` entries point at deleted files, making "run over the 46 entries" unimplementable as written) +
  `_drafts` gate-regex note; D3/AC 2 gained the `--demote` test seam; AC 5 scoped to non-`None` rows; `path:line`
  mechanism specified; 039 sibling coordination added; anchor/count nits (symlink L658, requirements.in:8,
  validate_workflow 7-dispatch/6-deep).
- r3 (2026-07-07) — P1 IMPLEMENTED red-first: `tools/dify_base/lint_node_bodies.py` (D1 standalone-def
  validation — re-verified all 29 defs resolve their internal refs within their own nested `$defs`; D2 table
  27 mapped + `assigner: None`; D3 `DEMOTED_REQUIRED` ships empty + `--demote` seam; D4 runtime-derived
  `_error`/def-less warn-skip; D6 `--schema` override; V1 no-traceback), 18 tests + 6 fixtures in
  `tests/test_lint_node_bodies.py` (ACs 1, 1b, 2, 3, 3b, 4, 5, 6 all covered), dead known-node-types constant
  deleted from `lint_refs.py`. Full pytest 124 passed. P2 PREVIEW (informal, the formal report still owed):
  41 indexed files → exit 1 on exactly 2: `templates/patterns/agent-with-tools.yml` (13 findings — the agent
  node lacks `agent_strategy_name/provider_name/label` and its `agent_parameters` values are scalars where
  `NodeData_AgentNodeData` wants `{type, value}` objects; ON the gate surface, needs P2 adjudication:
  pattern-bug vs importer-leniency) and `skills/Tomatio13/example/adoviser_bot.yml` (1 — never-gated tier);
  14 warn-skips as designed (http-request ×8 `_error`, assigner ×6 def-less). 39/41 clean, zero findings on
  llm/code/start/end/if-else/iteration across the corpus — the `required[]` fear (OQ1) did not materialize
  outside the agent def.
