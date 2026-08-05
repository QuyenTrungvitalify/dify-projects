# Builder — changelog

Versions exist so a run can be correlated with the code that produced it. Every run already stamps
`builderVersion` + `gitSha` into `.runs/<id>/build-info.json` (and into an exported dossier), so a
report from any date can be traced back to exactly this table.

**Bump the version when behavior a test campaign could observe changes** — a new advisory, a new
pattern, a changed gate. Not for docs-only edits.

---

## 0.3.0 — 2026-08-05

The version campaigns after 2026-08-05 are measured against. Cut because the model advisory and
the import path both changed behavior a campaign can observe — leaving it at 0.2.0 would have
credited the new numbers to the code that produced the old ones.

**Build quality**
- Model auto-inject now covers ALL model-carrying node types (llm + parameter-extractor +
  question-classifier — spec 087): the live-test 0-model gate catches PE/QC-only workflows, and
  the static selfhost 'Import to Dify' best-effort injects the workspace model into a temp copy
  before pushing (falls back to the exact pre-087 push on any hiccup). "Empty model" now means the
  same thing to the injector as to the advisory — `provider` blank OR `name` blank — so a node
  carrying an enabled model name under a blank provider is patched instead of being flagged by the
  advisory and then dying at runtime anyway. The model advisory no
  longer promises "nothing to set up" when the workspace model count could not be verified — the
  promise becomes conditional ("if your Dify has a model enabled — this could not be checked
  right now", JA frame included). Validated live A/B: same QC workflow, injected copy runs,
  empty-model copy imports clean but dies at run.
- Phase 4 now reads back the acceptance criteria the build wrote for itself and folds the run
  timeline — `report.json` gains `criteria_check` (each criterion bucketed: `auto_fail` is a sound
  structural-impossibility verdict, `auto_pass` is withheld to pure lint/import claims, everything
  behavioral is `manual` with the structural fact attached) and `timeline` (per-phase working ms).
  Additive fields, backward compatible. Before this, the criteria were parsed to criteria.json and
  never read back — the build set its own yardstick and nothing graded against it.

**UI**
- Phase-completion notifications (spec 088) — while the tab is hidden, a settled phase badges the
  tab (`✅ <what settled> — Dify Workflow Builder` + a green-dot favicon swap, cleared on focus)
  and, when the header bell is enabled (browser permission asked on that click; a denied origin is
  surfaced on the bell tooltip, not silent), fires a browser notification whose click focuses the
  tab. Fires on running→gate/done/error and on an Ask answer settling; `cancelled` and
  opening-an-already-gated-task (undefined→gate) are deliberately silent. Client-only — the SSE
  stream already carries every transition (`web/src/lib/notify.ts`). While a build runs with the
  permission still un-asked, a slide-down banner nudges once ("enable notifications?") — Enable
  runs the same bell flow; ✕ or enabling retires it permanently (localStorage). While the bell is
  OFF (and askable), a tiny chat-bubble callout hangs under it ("Ping when a phase is done") —
  rendered fixed from a measured anchor because the pill row's overflow-x would clip it.
- First own favicon + `/logo.svg`: a plain "DB" lettermark on the dark tile (simplified per
  review — no graph motif, no tagline), palette lifted from surface-blocks.css. The alert favicon
  adds a green (ok) dot. Gotcha: XML comments must not contain `--`, so CSS var names inside SVG
  comments are written dash-less — a `--ok` in a comment made the favicon malformed XML.

**Harness**
- `campaign.py summary <dir>` (spec 086) — ONE mechanical Pass line per campaign (build done +
  4 linters clean + no accept-override + probe not failed), computed purely from the recorded
  manifest so it survives run-dir cleanup and is machine-comparable across campaigns; fail
  categories map to the Chat2Workflow taxonomy (format/graph/semantic/import/build-error).
  `report.json` gains a structured `probe` field (additive) so the aggregator never greps prose.
- `campaign.py journey <taskId>` renders a run as the user's per-phase experience — wait time, the
  verbatim text the user read (digest / self-set criteria / notes), and the change at ③ — so a
  campaign report opens with the journey before any technical grading.
- `/campaign` hardening after its acceptance run (spec 073 S5): `record` now harvests EVERY
  `workflows/*.yml` of a build and flags unlinted extras (a build shipped monthly_summary.yml that
  ④ never linted or mentioned); failed tool-calls are split into gate-denials vs ran-and-failed
  (a raw ✗ count read 4 normal lint self-correct rounds as thrash); `init` generates the manifest
  (hand-authored YAML ate a bare `#6` as a comment); the runner's error paths — retry once,
  double-error stop, resume — are now permanently drilled by stub-backed tests, zero turns burned.
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
