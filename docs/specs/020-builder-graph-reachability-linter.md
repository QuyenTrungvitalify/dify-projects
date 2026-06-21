# Spec 020 — Graph-reachability check for `lint_refs.py` (019 O1 follow-up)

**Status**: Approved (Q1–Q4 resolved 2026-06-21 — adopt the recommended defaults below)
**Effort**: L
**Depends on**: [019](019-builder-output-quality-and-lean-roadmap.md) (O1 — this is its carved-out sub-spec),
[013](013-builder-linter-contract-and-test-seams.md) (the single linter contract this folds into),
[003](003-variable-ref-linter.md) (the original `lint_refs.py`), [017](017-builder-prompt-linter-and-perf.md)
(where reachability was explicitly **deferred**).

> **Why a separate spec (per 019 §7).** 019 carries Tier 0–2 as changelog-grade work, but O1 is the one
> item whose **blast radius is large enough to earn its own spec**: it changes what *passes* a gate that
> runs on **72 committed files** (corpus 45 + `templates/{patterns,probes}` 7 + `projects/*/workflows` 20),
> and a premature gate breaks vetted patterns + committed projects. The reachability pass also has a
> non-trivial **exclusion list** (Dify's graph has containers, branches, and cross-branch merges) that a
> one-line table in 019 can't hold. This spec exists to get that list right *before* any BFS is written.

## Context

[AGENTS.md §4.2](../../AGENTS.md) calls a bad variable ref *"the #1 cause of silent import success +
runtime failure."* Today [lint_refs.py](../../tools/dify_base/lint_refs.py) checks two of the three things
that make a `{{#id.field#}}` ref valid:

1. the source **node `id` exists** in `graph.nodes` — ✅ checked (`build_node_map` + `REF_PATTERN`);
2. the **`field` is a declared output** of that node — ✅ checked (`collect_outputs` + `IMPLICIT_OUTPUTS`);
3. the source node is **upstream-reachable** in the graph (it runs *before* the consumer; no forward /
   dangling reference) — ❌ **not checked**. 017 corrected the prose over-claim
   ([SKILL.md:27-30](../../.claude/skills/dify-build/SKILL.md), [implement.md:44-45](../../.claude/skills/dify-build/implement.md))
   and left a caveat: *"keeping refs upstream is on you."*

So the most common silent-failure mode in the whole domain is guarded by one sentence and zero checkers.
This spec closes (3), reusing the machinery (1)/(2) already built.

**What the graph gives us.** Each workflow has `workflow.graph.edges[]` with `source`, `target`,
`sourceHandle`. A normal edge is `sourceHandle: source`; an **if-else branch** edge carries a UUID handle
(the case id); container bodies (iteration/loop) have their own start node `<container_id>start`. A
`{{#S.field#}}` in node `C` resolves at runtime only if `S` has executed before `C` — i.e. `S` lies on a
directed path from a start node to `C`. The check is therefore a **reachability/ancestor test over the
edge graph**, with carve-outs for the structures where "ancestor of C" is the wrong question.

## Goals

1. A `lint_refs.py` pass that flags any `{{#S.field#}}` / `value_selector [S, field]` whose source `S`
   is **not upstream-reachable** to its consumer `C`, catching forward/dangling refs **at Implement**,
   not at Dify import.
2. **Zero false positives on the 72-file surface** before it can gate anything (the 019 §3.1 discipline).
3. Reuse the existing contract: the check is a new signal **inside** `lint_refs.py`, surfaced through the
   single [linters.ts](../../apps/builder/server/lib/linters.ts) `lint_refs` key — no new linter id.

## Non-goals

- **Not O4.** Start→end connectivity / orphan-node / dangling-handle is the *graph-soundness* smoke check
  (019 O4, a separate follow-up). This spec is only about **variable-reference** reachability.
- **No field-existence rework.** (2) stays as-is; this only adds the ordering dimension.
- **No new linter id / contract change.** Same `lint_refs` key, same pre-commit hook surface.
- **No autofix.** Report only.

## Design

### The check (per file)

```
build directed graph G: for each edge e in graph.edges → arc e.source ──▶ e.target
roots = start node(s)  (type == 'start')  ∪  every container start  (<id>start, iteration-start/loop-start)
reachableFrom(n)  = nodes on some directed path  n ──▶…──▶ x      (forward closure)
ancestors(C)      = { S : C ∈ reachableFrom(S) }                  (S can reach C)

for each reference (consumer C, source S, field f) found by walk_value_selectors + REF_PATTERN:
    if EXCLUDED(C, S):  continue              # see exclusion list — these are NOT errors
    if S not in ancestors(C):                 # S cannot have run before C
        REACHABILITY ERROR: "{{#S.f#}} in <C>: source not upstream-reachable"
```

`ancestors(C)` is computed once per file via reverse-BFS from `C`, or once globally via a transitive
closure (≤ a few hundred nodes — trivial). The consumer `C` is the node the selector/ref lexically lives
in (the node whose `data` subtree `walk_value_selectors` is inside).

### The exclusion list (the load-bearing part — these are legitimate, NOT errors)

A reachability pass that ignores Dify's graph shape would false-positive constantly. Exclude:

| # | Case | Why it's not an error | How to detect |
|---|---|---|---|
| E1 | **Non-node-output selectors**: `sys.*`, `env.*`, `conversation.*` | Not produced by a graph node — no ordering applies | already `SPECIAL_NS` in lint_refs.py — skip |
| E2 | **Container start**: `<container>start`, `iteration-start`/`loop-start` | A synthetic entry node; child nodes legitimately reference it + the container's item | id endswith `start` matching a container id, or node type in {`iteration-start`,`loop-start`} |
| E3 | **Child-of-iteration/loop referencing the container input/item** | The body runs *inside* the container each item; its refs resolve in the container scope, not the main DAG | node lives in the container sub-graph (parentId / `isInIteration`/`isInLoop` flag) |
| E4 | ~~**Cross-branch merge nodes**: `variable-aggregator`, `answer`~~ **REMOVED (post-review).** Originally these were to relax to a weaker "S reachable from a start" rule. The phase-2 measurement showed that rule prevented **0** FPs (a merge node's incoming edges already make its branch sources ancestors) while *hiding* real forward refs (e.g. an `answer` referencing a node that runs after it). So merge nodes now use the same **strict ancestor rule**; rare legit cross-branch shapes use the escape hatch (below), not blanket leniency. | n/a — strict ancestor rule for all consumers |
| E5 | **if-else / parallel branch handles** | Branch edges (UUID `sourceHandle`) still form the DAG; a node may reference an upstream node regardless of which case-handle the edge used | treat all edges as arcs for reachability — the handle doesn't change ancestry, so no special-case needed *except* not to require same-branch |
| E6 | **Unmodeled node-type outputs** | A node type whose outputs aren't in `IMPLICIT_OUTPUTS` still appears as a graph node with edges — reachability is unaffected; only field-existence (2) cares | none for reachability; extend `IMPLICIT_OUTPUTS` only if (2) trips (per 019 Q1) |

> The subtle one is **E3** (container scoping), where a naive main-DAG ancestor test is *wrong*, not just
> noisy. (E4 was originally the other; post-review it was removed — see the table.)

### Known limitation — intra-container forward refs (deferred, spec 020 Mục 3)

Because **E3 skips every container-body consumer**, a forward ref **between two nodes inside the same
iteration/loop body** (`A` refs `{{#B.field#}}` where `B` runs after `A`, both in the body) is **NOT
caught**. The corpus has **52** body→body refs across 14 files that go unchecked for ordering. Catching
them requires per-container sub-graph reachability (seed BFS at the container's `*-start`, treat the
container input/item as valid externals) — a v2 follow-up. Until then the gate must not claim to catch
intra-container forward refs; Goal 1 / AC 3 below are scoped to the **main DAG**.

### Escape hatch (spec 020 Mục 1 — required before promotion)

A reachability finding can be suppressed with a **full-line comment marker** in the file (anchored to
line-start so a `#` inside a prompt/quoted string can't forge one):

```yaml
# lint-refs: allow-reach <id>.<field>[, <id>.<field> ...]
```

This gives a promoted hard gate a **per-ref override** for the rare legitimate graph shape the BFS can't
model — without it the only escape is `git commit --no-verify`, which bypasses *all* hooks. (Mirrors the
`IMPLICIT_OUTPUTS` extend path that field-existence already has.)

### Rootless files (spec 020 Mục 5)

A file with node-to-node refs but **no** `start`/container-start anchor is no longer silently skipped —
the pass emits an advisory ("reachability NOT checked") so a mislabeled entry node isn't a blind spot.

### Rollout — the mandatory 3 phases (019 §3.1)

1. **Warn-only.** Add `--check-reachability`: runs the pass, **prints findings, exits 0**. Does **not**
   touch [linters.ts](../../apps/builder/server/lib/linters.ts) `lintClean` or the
   [pre-commit hook](../../.pre-commit-config.yaml). Off by default (existing callers unchanged).
2. **Measure.** Run `--check-reachability` across all **72 files** (corpus 45 · patterns+probes 7 ·
   projects 20). Produce a **false-positive report** (file · ref · why-it's-actually-fine). Fix the
   checker / extend the exclusion list until the report is **0 FP**. The report is the primary review
   artifact and ships **with the PR**.
3. **Promote — ✅ DONE.** After the report was reviewed clean: reachability is folded into the default
   `lint_refs.py` exit code (`lint_file` step 3) → it flows through `lintClean` (`lint_refs` key, no
   contract change) and the pre-commit hook (`templates/(patterns|probes)` + `projects/*/workflows`).
   Verified non-breaking: the 27 gate-surface files and the full 72-file corpus all pass the default
   gating run (exit 0); `pre-commit run dify-lint-refs --all-files` → Passed. The no-root **advisory** is
   informational-only and does **not** gate (you can't hard-fail a file on a check you couldn't run); it
   surfaces via `--check-reachability`, which remains the reachability-only, non-gating view.

## Open questions

> **Decision (2026-06-21): adopt all four recommendations below.** Q1/Q2 lean lenient-first — over-strictness
> is the #1 false-positive risk, and the warn-only phase only *prints*, so tightening can be measured on the
> real corpus before any gate. Q2's container-detection field is confirmed against the actual iteration/loop
> DSLs in phase 2 (no guessing). Q3 = a flag on `lint_refs.py` (reuse parser/node-map/walker). Q4 = same
> exit code, distinguish in the message. These are the implementation defaults for phase 1.

- **Q1 (E4 rule).** For `variable-aggregator`/`answer`, is "S reachable from *any* start" sufficient, or
  do we need "S reachable from start AND on the same branch family as one of C's incoming edges"?
  *Recommend:* start with the weaker rule (reachable-from-start); tighten only if the corpus shows a real
  miss. Over-strictness here is the #1 FP risk.
- **Q2 (container model).** Detect container membership via the node's `parentId` / `isInIteration` flag,
  or by walking the container node's child list? *Recommend:* whichever the corpus DSLs actually carry —
  confirm against real iteration/loop files in phase 2 before committing to one.
- **Q3 (warn-only surface).** New `--check-reachability` flag (opt-in) vs a separate `lint_reach.py`?
  *Recommend:* a flag on `lint_refs.py` — it already has the parser, node map, and selector walker; a
  second script would duplicate all three.
- **Q4 (promote granularity).** When promoted, is a reachability failure the same exit code (2) as a
  missing-node/field failure, or a distinct code so the builder can label it? *Recommend:* same code (the
  `lint_refs` key is binary in `lintClean`); distinguish only in the human message.

## Acceptance criteria

1. ✅ `lint_refs.py --check-reachability <file>` exists, runs the BFS, **prints findings and exits 0**
   (reachability-only, non-gating view). *(Phase 3: the **default** invocation now additionally gates on
   reachability — see AC5.)*
2. ✅ A **false-positive report over all 72 files** exists and is **0 FP** — every exclusion that the
   corpus exercises is implemented + cited ([020-fp-report.md](020-fp-report.md)).
3. ✅ A workflow with a **downstream-only / forward reference** (`{{#S.f#}}` where S runs after C, or S
   unreachable) is **caught**, with a clear message naming S and C. *Scope:* main-DAG (and cross-branch-
   merge) consumers; intra-container forward refs are a documented v2 gap (see **Known limitation** above).
4. ✅ The exclusion families the corpus exercises — `sys/env/conversation` (E1), iteration/loop bodies
   (E2/E3), if-else branches (E5) — produce **no** reachability error. *(E4's weak rule was removed
   post-review; `variable-aggregator`/`answer` use the strict ancestor rule + escape hatch.)*
5. ✅ Reachability folds into `lintClean` + pre-commit (`lint_file` step 3); the full corpus + patterns +
   projects still pass (27 gate files + 72 corpus → exit 0; `pre-commit run dify-lint-refs --all-files` →
   Passed). No regression on vetted/committed files.
6. ✅ The builder surfaces a reachability failure at **Implement** through the existing `lint_refs` key —
   no contract / new-linter-id change ([linters.ts](../../apps/builder/server/lib/linters.ts) unchanged).

## References

- [019 §Design O1](019-builder-output-quality-and-lean-roadmap.md) — the parent item + the 3-phase rule.
- [lint_refs.py](../../tools/dify_base/lint_refs.py) — reuse `REF_PATTERN`, `SPECIAL_NS`,
  `build_node_map`, `collect_outputs`/`IMPLICIT_OUTPUTS`, `walk_value_selectors`.
- [AGENTS.md §4.1/§4.2](../../AGENTS.md) — edge id format `<src>-source-<tgt>-target`, iteration-start id
  `<iter>start`, and refs-as-#1-silent-failure.
- **Measurement surface (live tree):** corpus **45** · `templates/{patterns,probes}` **7** ·
  `projects/*/workflows` **20** = **72 files** (note: 019 said 73; corpus is 45, not 46).
