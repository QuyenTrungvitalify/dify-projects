# Builder — changelog

Versions exist so a run can be correlated with the code that produced it. Every run already stamps
`builderVersion` + `gitSha` into `.runs/<id>/build-info.json` (and into an exported dossier), so a
report from any date can be traced back to exactly this table.

**Bump the version when behavior a test campaign could observe changes** — a new advisory, a new
pattern, a changed gate. Not for docs-only edits.

---

## Unreleased

**Webhook workflows can be published again, and tools you must connect are named (spec 095)**
- A workflow built around a webhook trigger could be imported into Dify and then **not published**:
  Dify's pre-publish checklist flagged every step reading from the webhook with "invalid variable",
  and the Publish button stayed blocked. Cause: the webhook step must also declare its output fields
  in a `variables` list — Dify's editor builds the variable list from that and never from the body
  fields — and neither the pattern we build from nor the generated workflows carried it. Import
  succeeded and all four linters passed the whole time, so nothing warned you. Fixed in the pattern
  and in the build instructions. Confirmed on Dify 1.15.
- Two notes were also misleading: the checklist item on the webhook step itself ("webhook URL
  required") is EXPECTED after an import — Dify creates that URL when you first open the step — and
  the trigger only appears under Quick Settings after the workflow is published, not before.
- The pre-run checklist gained a sixth item: **tools you have to connect**. A workflow using a
  marketplace tool (Tavily, Slack, Google Sheets, …) cannot be published until that tool is connected
  in your workspace, and until now the checklist listed only models, secrets, datasets and code
  problems — so you could read "just paste these values" and still be unable to publish. Named once
  per tool, by the label shown on the canvas.
- Existing builds made before this fix still carry the gap; rebuilding them picks up the corrected
  pattern.
- The node-body linter now also **warns** when a webhook step omits that list, so a build catches it
  while it is still being written. Warning only — it cannot fail a build or block a commit, because
  the rule encodes Dify's editor behaviour rather than its file format, and that is not something to
  gate on until it has run quietly for a while. Verified: exit codes are unchanged on all 93 workflow
  files in the repo.

**A fix round that changed nothing now says so (spec 094 S1)**
- When a "Request changes" round ends without altering the workflow file, the ③ gate says so: a
  **No file change** badge and a line leading the summary, with the model's own explanation underneath.
  Previously an empty round rendered identically to one that fixed two real bugs — on the run that
  prompted this, two of five rounds were empty, and the user re-imported an unchanged file believing it
  was a new fix.
- The ④ Import gate adds one line when the file on disk is byte-for-byte what was already imported, with
  the time of that import. The Import button is untouched and still works — re-importing is your call,
  and since the ④-overwrite change it lands on the same app anyway.
- The run timeline records `artifact_unchanged`, so an exported dossier shows the empty round. Until now
  the only way to tell was opening the transcript and counting file writes by hand.
- Measured by hashing the workflow file before and after each ③ turn. Deliberately not a git diff: a
  from-scratch build lives in `projects/_drafts/`, which the repo gitignores, so git cannot see the file
  at all — and on a re-run the file is already dirty from the previous turn, which hides a real edit.
  Both traps are pinned by tests.
- Nothing gates on this. A round that changes nothing is often the right answer; it just has to be said.

**Gate questions and how the model writes to you (spec 094 S4/S5/S2a)**
- Questions put to you at a gate are now **always** a numbered list, each item ending with the default
  the model would take, so you can answer with a digit or "go with your suggestions". This shape shipped
  in 093 but only when the chat and requirement languages differed — chat and build in one language and
  you still got a paragraph to unpack. Now it covers ① and ② unconditionally.
- ②③④ gained the write-for-the-reader rules ① already had: say what a step DOES before naming the node,
  keep machine names only where you must see or type them (env vars, plugin names, sheet columns, Studio
  buttons — not `array[string]` / `value_selector` / `error_strategy`), and give the flow as a plain-word
  chain instead of a node-by-node recital. Carries a worked BAD/GOOD pair. The fix-round explanations at
  ③ — the ones you read when a Studio error is reported — follow it too.
- Unchanged: what lands in the YAML and `SPEC.md` still follows the requirement's language (093). This is
  about HOW the model writes to you, not WHICH language.
- The skill body no longer tells a build turn that the Grep/Glob tools are callable straight away; they
  are deferred in that session and must be loaded first. The old claim contradicted the permission gate's
  own recorded evidence and cost one run 25 wasted calls.

**Conversation language (spec 093)**
- A chat-language pill on the header (`Auto` / `Tiếng Việt` / `日本語`, remembered across reloads,
  visible to every user — not dev-gated) now decides what language the model ANSWERS in. It is
  independent of the 🌐 UI-chrome toggle beside it.
- The deliverable does not follow it: node titles/descs, LLM prompts, notification bodies and the
  `SPEC.md` body still follow the requirement's language, so a Vietnamese team can chat in Vietnamese
  and hand a Japanese client a Japanese build. When the two differ, `SPEC.md` gains a final
  "summary & questions" appendix in the chat language, so the gate can actually be reviewed.
- `auto` (the default, and what every pre-093 task.json reads as) now resolves as a chain: this turn's
  own message → the language remembered from the last message → the requirement. Previously EVERY turn
  read the requirement, so a Japanese-worded requirement answered a Vietnamese user in Japanese
  indefinitely. Nothing changes for a user who never touches the setting.
- The pin now also covers surfaces that had none: both `/ask` doors (including the gate-side "ask a
  question", where the friction was actually observed), the distill turn, and the ④ judge's
  summary/evidence.

## 0.4.0 — 2026-08-06

Cut because three campaign-observable surfaces changed after the 0.3.0 cut: what the sandbox
allows (091), what a failed tool-call records (091), and what a build can be started against (090)
— numbers from the next campaign belong to this code, not 0.3.0's.

**Build quality**
- Phantom edit-target killed four ways (spec 090): POST /api/tasks now refuses a nonexistent
  edit-existing target at the door (400 naming the right door — "Import base" when a YAML is
  attached); the sidebar's synthetic draft rows (BOTH generators — the `(unsaved)` bucket and the
  orphan-in-existing-project row) are display-only, no longer selectable as a base; ② verify adopts
  a good SPEC.md misplaced into the run dir instead of dying `artifact missing` (the field bundle's
  unrecoverable retry loop); and ② is handed the RESOLVED `{{SPEC_PATH}}` instead of a two-branch
  rule that both observed agents mis-evaluated against the disk. Validated: deterministic repro
  (fire `--workflow "(unsaved)"`) now 400s; a real edit build writes the canonical path first try.
- ② stops hunting the error-branch syntax (spec 091 S4): spec.md now carries the same
  `references/error-strategy.yml` pointer implement.md has had since 085 — the measured hunt
  (11 denied calls, 54% of build cost in phase ②) dropped to zero on re-fire (49 calls → 6).

**Build cost** (spec 085 — landed 2026-08-04, unlisted at the 0.3.0 cut)
- ③ turn timeout default 10→15 min IN CODE (not .env — gitignored files don't travel with git pull);
  a timeout that leaves a lint-clean, id-clean artifact is SALVAGED to success instead of thrown
  away; `turn_spawned` event separates turn-active from the phase window (host-sleep inflation);
  `marketplace.py resolve` (only) allowed — the phase docs had instructed it while the gate denied
  it; `references/error-strategy.yml` worked example + implement.md pointers ended the fail-branch
  hunt (8/8 denied calls in the field run).

**Attachments** (spec 089)
- Office attachments extract at upload: `.docx`/`.xlsx`/`.pptx` are unpacked server-side (own zip
  reader, 3 extractors) into a text sidecar the turn reads; empty extraction is a 400, not a silent
  empty sidecar. `/ask` accepts files mid-conversation (previously only the first message could).

**Sandbox** (spec 091 S2)
- The gate decides on a QUOTE-NORMALIZED view of each Bash command (execution stays raw): the
  documented `find.py --name "<keywords>"` intent pass (076 E2b) works for the first time in a real
  build, while the invariant got STRONGER — a quote can no longer hide a metachar or split a secret
  literal (`cat apps/builder/.e''nv` is now caught by the secret check itself, earlier than the old
  blanket quote-ban). 16-case attack battery + K1/K2 calibration pinned in permission-gate.test.ts.

**Harness / observability** (spec 091 S1+S3)
- Every failed tool-call in a transcript now carries its REASON on an indented `↳` line under the ✗
  (redacted, capped; the ✗-anchored line format both external parsers depend on is unchanged and
  pinned by tests). `campaign.py classify_failed_calls` reads the minted reason instead of guessing
  with a second heuristic (the old guess missed quote-denials entirely); pre-091 transcripts keep a
  corrected legacy heuristic (quotes = denial, matching the gate that produced them).
- Doc↔gate contract audit as a permanent test (`doc-gate-contract.test.ts`): every command the
  phase docs instruct must pass the real `decide()`, every denial hint must name an allowed door,
  suite predicate keys must be in e2e_check's vocabulary, the token table and artifact paths must
  match the code — with K1–K5 calibration cases so the instrument itself is checked first. This is
  the class of drift that cost specs 071→085→091.

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
