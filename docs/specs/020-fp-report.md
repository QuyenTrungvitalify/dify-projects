# Spec 020 O1 — false-positive report (phase 2 measurement)

**Companion to** [020](020-builder-graph-reachability-linter.md). The phase-2 artifact the spec gates
promotion on: `--check-reachability` run across the full **72-file** surface, false positives classified.

## Surface

| Source | Files |
|---|---|
| `corpus/awesome-dify-workflow/DSL/*.yml` | 45 |
| `templates/{patterns,probes}/*.yml` | 7 |
| `projects/*/workflows/*.yml` | 20 |
| **Total** | **72** |

## Result — **0 false positives**

```
files with a start/container anchor : 72 / 72   (none skipped for "no root")
total variable refs                 : 801
  ├─ E1  sys/env/conversation       : 118   (excluded — not node outputs)
  ├─ E2  source is *-start          :   0   (not exercised by the corpus)
  ├─ E3  consumer inside container  : 100   (excluded — container-scope refs)
  ├─ source node-not-found          :   0   (the existing id-exists check is clean)
  └─ self-ref                       :   0
reachability-CHECKED                : 583
  ├─ reachable (ok)                 : 583
  └─ flagged (unreachable)          :   0   ← 0 false positives
```

**The check has real teeth, not vacuous:** 583 of the 801 refs were genuinely run through the
ancestor/reachable test (the rest are legitimately excluded), and a synthetic forward reference IS
caught (see `tests/fixtures/lint_refs/reach_forward_ref.yml` + `test_reachability_flag_catches_forward_ref`).

## Carve-out necessity (measured)

| Exclusion | FPs it prevents on the corpus | Verdict |
|---|---|---|
| **E3** (container body) | **48** refs would FP without it | **Load-bearing** — iteration/loop body nodes reference main-DAG / iteration inputs that aren't main-DAG ancestors. |
| **E4** (aggregator/answer weaker rule) | **0** on this corpus | **REMOVED post-review** — the aggregators' incoming edges already make their branch sources ancestors, so the strict rule also passes here (re-measured: still 0 FP). The weaker "reachable-from-any-start" rule prevented 0 FPs while *hiding* real forward refs (e.g. an `answer` referencing a node that runs after it), so `variable-aggregator`/`answer` now use the same strict ancestor rule as every other consumer. Rare legitimate cross-branch shapes are handled by the escape hatch (`# lint-refs: allow-reach <id>.<field>`), not by blanket leniency. |
| **E1** (sys/env/conversation) | 118 refs excluded | Necessary — these are not node outputs. |
| **E2** (source is `*-start`) | 0 | Not triggered (body refs to `*-start` are already E3-excluded by consumer). Kept belt-and-suspenders. |

## Conclusion

- **0 false positives over 72 files** → the phase-2 gate is satisfied.
- **Phase 3 PROMOTED** (post-review): reachability is folded into the default `lint_refs.py` exit code, so
  it gates through `lintClean` + pre-commit. Re-verified non-breaking — 27 gate-surface files + all 72
  corpus files pass the default gating run (exit 0); `pre-commit run dify-lint-refs --all-files` → Passed.
  `--check-reachability` remains the reachability-only, non-gating view.
- Regression-tested: **23** tests in `tests/test_lint_refs.py` (incl. the gate, escape hatch, no-root,
  loop, and answer-forward cases).

> Reproduce (note: corpus filenames contain spaces / non-ASCII, so `$(ls …)` word-splits and silently
> skips ~17 files — use a NUL-delimited list):
> ```sh
> { find corpus/awesome-dify-workflow/DSL -maxdepth 1 -name '*.yml' -print0
>   find templates/patterns templates/probes -maxdepth 1 -name '*.yml' -print0
>   find projects -path '*/workflows/*.yml' -print0
> } | xargs -0 python3 tools/dify_base/lint_refs.py --check-reachability
> ```

## Post-review changes (2026-06-21)

Adversarial review of this report tightened the checker before any promotion:

- **E4 weak rule removed** — `variable-aggregator`/`answer` now use the strict ancestor rule (re-measured:
  still **0 FP** over 72 files). The weak rule bought 0 FP-reduction here while hiding answer/aggregator
  forward refs. (+ test `test_reachability_answer_forward_caught`)
- **Escape hatch added** — `# lint-refs: allow-reach <id>.<field>` suppresses a specific finding, so a
  promoted hard gate has a per-ref override (not just `git commit --no-verify`).
  (+ test `test_reachability_escape_hatch_suppresses`)
- **Rootless files no longer silently skipped** — a file with node-to-node refs but no start/container
  anchor now emits an advisory. (+ test `test_reachability_no_root_advisory`)
- **Loop fixtures added** — the corpus exercises **0** loops (`type:loop`/`loop-start`/`isInLoop` all
  absent), so loop handling was untested; two fixtures now cover it.
  (+ tests `test_reachability_loop_valid_clean`, `test_reachability_loop_forward_caught`)
- **Known limitation (deferred):** E3 skips *every* container-body consumer, so a forward ref BETWEEN two
  nodes inside the same iteration/loop body is **not caught** (52 such body→body refs in the corpus go
  unchecked). Catching them needs per-container sub-graph reachability — a v2 follow-up, documented in the
  spec's exclusion table so the gate does not over-claim coverage.
