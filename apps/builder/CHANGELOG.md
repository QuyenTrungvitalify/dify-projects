# Builder — changelog

Versions exist so a run can be correlated with the code that produced it. Every run already stamps
`builderVersion` + `gitSha` into `.runs/<id>/build-info.json` (and into an exported dossier), so a
report from any date can be traced back to exactly this table.

**Bump the version when behavior a test campaign could observe changes** — a new advisory, a new
pattern, a changed gate. Not for docs-only edits.

---

## Unreleased

**Harness**
- `/campaign` — versioned auto-test campaigns (spec 073): analyze what to test → generate
  user-realistic prompts per `docs/prompts/CHARTER.md` (charter-linted: solution-jargon in a đề is
  rejected) → human gate freezes the prompt set in `docs/prompts/gen/<id>/` → `campaign-run.sh`
  runs sequentially in the background (retry once, stop the whole run on a double error — no
  quota-burn) → three-tier grading with a clean-context subagent judge → per-run reports, SUMMARY,
  CAMPAIGNS row. Version is pinned at plan time and re-checked at run time. The human fixes
  findings; `recheck` re-runs the exact failing prompts for a before/after table.

---

## 0.2.0 — 2026-07-18

Shipped after the [v0.1.0 12-prompt campaign](../../docs/prompts/runs/CAMPAIGNS.md) surfaced them.

**Build quality**
- ④ notes now state the **external-input contract** for webhook builds — which fields the client's
  SOURCE must POST, read from the trigger body (spec 072 S1+S2). Before this, a correct webhook build
  told the client 5 of the 6 setup steps and silently omitted "wire your source", so the workflow
  never fired.
- ① flags an assumed webhook payload as an open point, so a wrong field-name guess is caught before
  the build (spec 072 S3).
- ② is told never to end a turn without writing `SPEC.md`: in `auto`/`spec_only` nobody answers a
  question, so it must assume a default and record it under Open questions (spec.md).

**Build cost**
- `templates/patterns/webhook-per-row-notify.yml` — the missing `trigger-webhook` example. Every
  webhook build used to thrash ③ hunting for one (~500s, 7–17 denied searches); with the pattern it
  reads the example directly (0 denied). (spec 071 S1)
- `lint_node_bodies.py --dump-schema <node-type>` — one allowed call returns a node's `NodeData_*`
  def. A build previously burned 44 turns reconstructing `trigger-webhook` because every extraction
  route (grep/rg/`python -c`/probe script) is sandboxed. (spec 071, root cause)
- `--dump-schema` on a node type that EXISTS but has no detailed def (warn-skip, or an `_error`
  dump-stub) now exits **0** with the explanation on stdout. It shipped as exit 2, so a correct answer
  rendered `✗` — which reads to a turn as "rejected, try another route", the exact hunt this flag
  exists to end, and inflated the denied-call oracle below. A misspelled type still exits 2 with the
  known-type list; not knowing is the schema's limit, not the caller's error. (found by P07)
- `find.py --has <unknown>` now errors with the valid feature list instead of the same silent "No
  matching templates" a real empty result gives. (spec 071 S4)
- Per-variant trigger keys `has_trigger_webhook/_schedule/_plugin` in the index. (spec 071 S3)

**Harness**
- `e2e_check.py`: `denied_calls_max` — the correct oracle for search-thrash. Turn count is the wrong
  axis (denied calls compress into few turns: a 22-denied run passed a 30-turn cap). (spec 071 S2)
- `e2e-run.sh fire --workflow <slug>` — fires an edit-existing build. Without it the harness could
  only ever start from scratch, so the edit path had **zero** e2e coverage.

---

## 0.1.0 — 2026-07-17 (retroactive tag)

The version the [12-prompt campaign](../../docs/prompts/runs/CAMPAIGNS.md) was run against. Not
released separately — recorded so that campaign's numbers have a name. Includes the workspace reset
(specs 001–067 retired), tool-node support, run dossier export, cost instrumentation, readiness
checklist, and the naive-user comprehension oracle.
