# Builder ⇄ Workflow-Store — campaign index

One row per test. Authoritative per-run detail = `report-N<N>-<taskId>.md/.json` in this dir.
Grading rule: against the REQUIREMENT (`must_do` in [../manifest.json](../manifest.json)), ground-truth is a secondary sanity ref.
Runtime is manual spot-check → `runtime` stays `NOT VERIFIED` until a `/report #N output:` grade.

| # | run / slug | analyze | spec | implement (lint) | mode | requirement-fit | runtime | verdict |
|---|---|---|---|---|---|---|---|---|

_No runs yet — the 2026-07-17 workspace reset cleared the previous campaign. Fill one row per `/report #N`._

## Notes / lessons

_Empty. Add a lesson here only if it is NOT already enforced by code or by the skill — when a run
exposes a bug, fix the bug; note it here only if the fix leaves a residual rule a human must remember._

---

## Previous campaign (2026-06-27 → 07-03) — archived

12 JP prompts vs Workflow-Store, all 12 **PASS**. Retired in the reset: it graded a Builder that has
since changed substantially (tool nodes, trigger entries, readiness checklist, and the naive-user
oracle all landed after), and the runs it referenced lived in `apps/builder/.runs/`, which the reset
cleared. Re-run against the current Builder rather than comparing against it.

```bash
git show 4bbf294:.claude/skills/report/reports/INDEX.md    # the full 12-row matrix + its lessons
git show 4bbf294 --stat -- .claude/skills/report/reports/  # every per-run report
```

Its two technical lessons were **fixed at the source** and need no re-reading:

- chatflow vs the validator — `validate_workflow.py` now accepts `mode: advanced-chat` (it requires an
  `answer` node instead of `end`).
- iteration-start vs the implement gate — `post-turn.ts` `idsOk` now matches `^\d{13}(start)?$`, so a
  legitimate `<id>start` child no longer false-parks the build at `still_failing`.
