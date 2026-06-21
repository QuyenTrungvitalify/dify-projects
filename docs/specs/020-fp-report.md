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
| **E4** (aggregator/answer weaker rule) | **0** on this corpus | **Precautionary** — the aggregators' incoming edges already make their branch sources ancestors, so the strict rule would also pass here. Kept as the correct safety net for the cross-branch case (spec 020 Q1) — it never tightens, only loosens, so it cannot introduce a FP. |
| **E1** (sys/env/conversation) | 118 refs excluded | Necessary — these are not node outputs. |
| **E2** (source is `*-start`) | 0 | Not triggered (body refs to `*-start` are already E3-excluded by consumer). Kept belt-and-suspenders. |

## Conclusion

- **0 false positives over 72 files** → the phase-2 gate is satisfied.
- The pass is warn-only today (`--check-reachability` prints, exits 0; the default invocation is
  byte-for-byte unchanged) and is regression-tested (3 new tests in `tests/test_lint_refs.py`).
- **Ready for phase 3 (promote)** — fold reachability into the default `lint_refs.py` exit code so it
  flows through `lintClean` + pre-commit — **pending review of this report** (spec 020 AC5).

> Reproduce: `python3 tools/dify_base/lint_refs.py --check-reachability $(ls corpus/awesome-dify-workflow/DSL/*.yml templates/patterns/*.yml templates/probes/*.yml projects/*/workflows/*.yml)`
