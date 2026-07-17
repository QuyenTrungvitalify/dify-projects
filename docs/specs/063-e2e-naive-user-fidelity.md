# Spec 063 — E2E test fidelity: judge a build as a NAIVE user, not as the developer

**Status**: **Partially implemented** (2026-07-16 — the OBJECTIVE CORE shipped: `e2e-run.sh userview`
+ `comprehension` (deterministic jargon blocklist in `e2e_check.py`, English + JA katakana) → AUTO-FAIL
per jargon hit, live-verified on the tool build (the 061 oracle), 11 pytest; skill `--persona naive`
+ human-final-call prose. A 13-agent impl-review folded 7 fixes: empty/parked run → MANUAL exit 2 (not
a false AUTO-PASS), word-boundary matching (no prose false-positives), extended blocklist + leaked-ref
patterns ({{#…#}}, bare 13-digit node id), the naive persona rewritten to a **context-isolated
subagent** (not "un-know"), and the honest note that the check scans the ENGLISH notes today (katakana
fires only once the port lands). **Deferred as a heavier follow-up slice** (an
implementation finding: bigger than the "S" estimate): the full `NOTE_JA` localization port (~30 frames)
+ the `Chat.tsx` contract/snapshot test (AC1) + the LLM `next_step_clear` proxy code — `userview` is
currently a pragmatic reconstruction from `overview`+`notes`, not the full localized render.). r2 — a
review folded the objectivity/fidelity fixes: `userview` is
a RECONSTRUCTION (not the literal render) drift-guarded by a `Chat.tsx` contract test; `overview` is
a content-twin, not what the gate card shows; the jargon check is a DETERMINISTIC blocklist (objective,
regression-safe) with the LLM quarantined to open-ended `next_step_clear`; the naive persona is
context-isolated + majority-of-N; locale tracks the run). Renumbered 062→063 (062 taken by
run-dossier-export). Claude authors; user implements.
**Effort**: **S** (S1 user-view extractor ≈ S, S2–S4 skill prose ≈ S).
**Depends on**: spec 058 (the e2e harness — this makes its judgment faithful), spec 059/060 (unchanged
— structural + cost checks stay), `/report` skill (its `trace_phases.py` reads the transcripts this
reuses), spec 030a/i18n (`localizeNotes` — the user sees LOCALIZED notes, which the user-view must show).

## Why (the honest gap this closes)

The e2e harness (058) verifies **build artifacts** and the **gate flow** well. But a review of the
spec-061 reproduction (run 1784174040711) found it is **not** a faithful test of how a real
non-technical user experiences the app — in two concrete ways:

1. **It judges on the DEVELOPER's information, not the user's.** `check` greps `analyze.json`,
   `main.yml`, `report.json`; the reviewer read `features`/`planned_nodes` and ran the 4 linters.
   A real user sees NONE of that — they read the CHAT: the digest, the assistant's messages, and the
   **localized** note. So the harness can pass "structurally correct" while the chat is jargon a user
   can't act on — the exact spec-061 defect (a note saying "add the plugin hash before deploying"),
   which a substring grep will never flag as unclear.
2. **The reviewer played an EXPERT, not the naive target.** In the repro, the each_step reviewer
   Request-changed "use a Dify scrape tool, not http+code" — knowledge the target user (per 061)
   does not have. A naive user would have accepted the default http+code build. So the test
   **understated** the real gap: the naive user never self-corrects to a tool.

The result: the harness measures "built right," but not "usable by the person it's for." This spec
adds the second measurement — and is honest about its ceiling (below).

## The honest ceiling (stated up front, not buried)

**An LLM playing "naive" is NOT a real naive user** — it still knows too much. So the comprehension
judge here is a **cheap first-pass proxy**, never proof. The only objective test of "does a real
user understand this" is a **real non-technical human** reading the actual chat. This spec therefore
does two things: (a) a proxy judge that flags likely-confusing output cheaply, and (b) surfaces the
user-view cleanly so a human makes the final call on the cases that matter. It does not pretend (a)
replaces (b).

## Goals

- **G1 — judge on the user's information.** A mode that evaluates a build using ONLY what the user
  actually reads in chat (digest + assistant messages + LOCALIZED notes), with the raw
  features/YAML/lint hidden.
- **G2 — a naive persona.** The each_step reviewer role, when asked, drops all dev/schema knowledge:
  accepts defaults, never issues an expert Request-changes, asks only questions a layperson would —
  so the test reveals what the target user actually gets.
- **G3 — a comprehension verdict.** A cheap LLM pass over the user-view answering: *does a
  non-technical user understand what was built, and know what to do next, with no unexplained
  jargon?* — flagged clearly as a proxy.
- **G4 — hand the hard call to a human.** The user-view is surfaced cleanly so a real person can
  eyeball the flagged cases and make the objective final judgment.

## Non-goals

- **NOT replacing the structural/cost checks** (058/059/060) — those stay for regression; this adds a
  parallel user-experience lens, it doesn't remove the dev lens.
- **NOT in-loop live runtime** — actually importing + running each build is spec 021's creds-gated
  job; it stays in the MANUAL bucket. This spec is about the CHAT experience, not runtime output.
- **NOT claiming the LLM judge is objective truth** — see "the honest ceiling."
- **NOT a new UI** — reuses the existing chat surfaces + the terminal harness.

## Design

### S1 — `e2e-run.sh userview <taskId>` — a RECONSTRUCTION of the user's-eyes text (S)

A new subcommand that prints a **text transcript of the rendered chat content** — NOT the developer
view. **Honest framing (r2 — the review corrected two false premises):**
- The literal render lives **browser-side in `Chat.tsx`**, not in `.runs/<id>`. An offline extractor
  therefore **RECONSTRUCTS** the user-view from the run's artifacts + transcript + a **port of the
  `NOTE_JA`/`localizeNotes` frames** — it is a *reconstruction proxy*, not the DOM. Keeping it in
  sync with `Chat.tsx`/`i18n.ts` is an ongoing drift risk, called out and guarded by AC1's contract
  test.
- The gate CARD does **not** render `analyze.json.overview`; the digest the user actually reads is
  the **streamed Disclosure prose** (thread `run.output`), whose structured twin is `overview`. So
  the extractor sources the digest from the streamed output where available, and labels `overview`
  a **content-twin proxy** when it falls back to it — never claims it's "what the card showed."
- **Include**: the streamed per-phase prose the user read + every note **through the SAME
  localization the run used** (JA for a JA run, VI for a VI run — track the run's locale, do NOT pin
  JA) + the fixed gate-card copy/advisory the card does show.
- **Exclude**: `features`, `planned_nodes`, `pattern`, raw `main.yml`, lint exit codes, node counts.
- It is a *text* transcript: **visual prominence/placement** (a note present but buried) is out of
  scope — that stays a human-eyeball (S4) concern, not something this captures.
- **The exact rendered-field list is resolved IN THIS SPEC at implement time against `Chat.tsx`
  `gateView()`/`promoteGateView()` + the Disclosure**, and pinned by a **contract/snapshot test**
  (AC1) so a `Chat.tsx` change that drifts the reconstruction AUTO-FAILS — not deferred to an OQ.

### S2 — the naive-persona reviewer (skill prose) (XS)

`.claude/skills/e2e/SKILL.md` gains a **`--persona naive`** discipline for each_step. **The guardrail
(r2 — an instruction to "un-know" the artifacts it just read is unenforceable):** the naive reviewer
runs in a **separate context that receives ONLY the S1 user-view** — never the phase artifacts
(features/YAML/linters) the default reviewer reads. It cannot self-correct with tool/schema knowledge
because it never saw it. It accepts the plan as offered and may only ask layperson questions. This is
still a **propensity, not a property** — so AC4 is a majority-of-N reproducibility bar, not a
one-shot claim. (The expert/dev reviewer stays the default for structural regression testing.)

### S3 — the comprehension check: deterministic jargon + a quarantined LLM judge (XS)

Split into an objective half and a proxy half (r2 — a free LLM verdict is non-reproducible and
would raise false regression alarms):
- **Deterministic (objective, in `e2e_check.py`):** a pinned **jargon blocklist** — the exact tokens
  a layperson won't get (`plugin hash`, `dependencies`, `provider_id`, `deploy`, `hash`, `TODO`, …,
  extensible) — checked against the S1 user-view. Any hit → an **AUTO-FAIL** row
  (`comprehension.jargon["plugin hash"]`), reproducible run-to-run, exit-code-affecting. This is the
  load-bearing, regression-safe check (and the before/after oracle for spec 061).
- **Proxy (LLM, quarantined):** for open-ended judgment a blocklist can't do — mainly
  `next_step_clear` (does the user know what to do next?) — an LLM pass over ONLY the user-view, in
  its **own COMPREHENSION bucket**, explicitly **labeled non-reproducible**, NOT folded into the
  exit code, and **never compared across runs as a regression signal** (a changed LLM verdict on
  unchanged output is noise, not a regression).

### S4 — human-final-call surfacing (skill prose) (XS)

The `/e2e` verdict ends by naming the cases the comprehension judge flagged (jargon / unclear
next-step) and printing the clean S1 user-view for each, with: *"A real non-technical user should
eyeball this — the judge above is only a proxy."* So a human (you/the stakeholder) reads exactly what
the user would, fast, and makes the objective call on what matters.

### S5 — docs (XS)

`docs/specs/README.md` row; one line in `apps/builder/scripts/README.md` (the 058 usage guide) for
`userview` + `--persona naive`. No count pins touched.

## Acceptance criteria

1. **`userview` is faithful AND drift-guarded (headline).** `e2e-run.sh userview <taskId>` prints
   the reconstructed user-facing text (streamed digest + notes in the RUN's locale) and omits
   features/planned_nodes/YAML/lint. A **contract/snapshot test** pins the reconstructed fields to
   `Chat.tsx`'s rendered surfaces — a component change that drifts the reconstruction AUTO-FAILS the
   test. (Verified against repro run 1784174040711: contains the digest + localized note, none of
   `features`/`type:`/lint tokens.)
2. **Deterministic jargon check (objective).** The pinned jargon blocklist (`plugin hash`,
   `dependencies`, `provider_id`, `deploy`, `hash`, …) run over the repro build's userview →
   AUTO-FAIL rows for the current note ("add the plugin hash before deploying") — reproducible
   run-to-run, exit-code-affecting. This is the before/after oracle for spec 061's fix, and a
   regular pytest (a grep can't judge understandability, but a FIXED blocklist objectively can).
3. **The LLM proxy is quarantined.** `next_step_clear` (and any open-ended judgment) is in its own
   **COMPREHENSION** bucket, labeled non-reproducible, NOT in the exit code, and the skill forbids
   comparing it across runs as a regression signal.
4. **Naive persona is context-isolated + N-run.** `--persona naive` runs the reviewer in a context
   given ONLY the userview (never the artifacts); a **majority-of-N** naive run of the scrape prompt
   does NOT self-correct to a tool (a propensity bar, not a one-shot claim). Documented in the skill
   with the human-final-call step.
5. No regression: structural `check`/`time`/cost unchanged; `pytest`, builder `npm test` (incl. the
   new `userview`↔`Chat.tsx` contract test), drift tests, `check_agents_refs` green.

## References

- Evidence: the spec-061 reproduction (run 1784174040711) + the fidelity review that found the two
  gaps (dev-view judging; expert reviewer). 058's `check` reads artifacts, not chat.
- [058](058-e2e-simulation-harness.md) — the harness this extends; `apps/builder/web/src/components/Chat.tsx`
  `gateView()`/`promoteGateView()` + the Disclosure — the render surfaces `userview` reconstructs
  and the contract test pins against; `apps/builder/web/src/lib/i18n.ts` `localizeNotes`/`NOTE_JA` —
  the localization the reconstruction ports (per run locale); `.claude/skills/report/trace_phases.py`
  — the transcript reader reused only where the UI surfaces a streamed message;
  [021](021-builder-e2e-live-run-verification.md) — the runtime lens this deliberately leaves out.
