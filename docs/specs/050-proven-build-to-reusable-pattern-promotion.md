# Spec 050 — Proven-build → reusable pattern promotion: distill once, help every similar build after

**Status**: Implemented (r5, 2026-07-08). **M**. The theme: a field build that survives real Dify is the most valuable teaching
artifact we own — but today it dies in `projects/` as a one-off. This spec makes the leverage explicit:
turn a proven build into a **generic, self-documenting, import-verified PATTERN** (not just a near-duplicate
library file), and encode its hard-won gotchas where they survive — as linter rules if enumerable, as
annotated pattern knowledge if not. One distillation should raise the floor for *every* future build of the
same shape, not just re-runs of the original.

> **Reference the SYMBOL, not the line.** Anchors verified 2026-07-08.

**Builds on**: [022](022-multi-source-template-library.md) (the curated-tier + provenance + staleness
model this extends — 022 built the *library* tier; 050 builds the *pattern* distillation on top and reuses
its staleness detection); [049](049-dify-import-blocker-defense.md) (the import-probe oracle D3 reuses as
the promotion gate, AND the philosophy this spec is bound by — *"patterns + linters + oracle beat retrieval
at this scale"*, so the lever is patterns/linters, NOT more corpus samples); [007](007-capability-docs-and-patterns.md)
(the pitfall log D2b writes non-enumerable gotchas into); [013](013-builder-linter-contract-and-test-seams.md)
(the linter contract D2a's candidate rules extend from the inside, no new script); the
`template-promote` skill (the human-gated one-file-per-run promoter D1 adds a `pattern` target to); the
INDEX auto-tagger (`tools/dify_base/build_index.py` `has_*` → Key Features) D4 leans on.

---

## Motivation — the one-off trap

The 2026-07-08 ChatWork 催促通知フロー build (the same one that drove spec 049) is a textbook high-value
artifact: it survived real Dify import after a one-key fix, and it carries FOUR reusable lessons the corpus
has zero coverage of — per-row conditional dispatch, HTTP notification to a mapped destination, `today`
injected from outside to dodge sandbox-timezone skew, and parallel iteration with `continue-on-error` +
skip-branch aggregation. A field user's instinct ("cho hệ thống học file này") is *correct in spirit* — that
build **should** make the next similar build better.

But three structural gaps stop that from happening today:

1. **The artifact dies as a one-off.** It lives in `projects/<name>/` — indexed as `project` precedence, but
   ChatWork-specific and never distilled. The next build of a *different* notification target (Slack, Teams,
   email) can't reuse it because the reusable skeleton is fused to ChatWork specifics. The high-leverage tier
   — `patterns` (precedence `patterns > library > project > corpus:*`) — never receives it.
2. **The "why" evaporates.** The `today`-injection and header-shape decisions are the exact gotchas a future
   build needs, but they live only in the original author's head / a code node body. Spec 049 caught ONE of
   them (`variable:` vs `name:`) precisely because it became a *linter rule*. The rest — non-enumerable design
   choices — have nowhere durable to live, so they regress (049's own lesson #1: "rules that exist only in the
   model's memory WILL regress").
3. **Promotion has no quality floor.** Nothing stops a broken build (empty LLM model, always-reports-`sent`
   logic) from being promoted verbatim — which would *teach the break*. Promotion must guarantee a known-good,
   self-documenting seed, or it makes future builds worse, not better.

The repo already decided the mechanism (049 Non-goal): **not** RAG/fine-tuning, **not** "add more samples and
hope retrieval finds them" — but **patterns + linters + oracle**. This spec operationalizes that verdict into
a repeatable promotion pipeline so the answer to "will feeding this file help future builds?" becomes a
reliable *yes, for the whole shape-class* instead of *maybe, if retrieval happens to surface a near-duplicate*.

## Decisions

- **D1 · `template-promote` gains a `pattern` distillation target (proposed).** Today the skill promotes one
  raw build → one standardized `library/` file (concrete, near-duplicate reuse). Add a second, higher-leverage
  target: **distill → generic `templates/patterns/<name>.yml`**. Distillation is a bounded transform:
  (a) replace domain-specifics with placeholders + `# TODO:` customization points, following the EXISTING
  pattern-header convention (`# Pattern:` / `# Use case:` / `# Flow:` / `# Customization points (# TODO:)` /
  the placeholder-model note — see `templates/patterns/multi-step-llm.yml`); (b) keep the *skeleton* that
  generalizes (iteration + per-row judge + if-else + notify + aggregate) and strip the *instance* (ChatWork
  URL/header → `{{HTTP endpoint}}` + `# TODO: auth header`). One pattern per run, human-gated (the skill's
  existing one-file-per-run + provenance discipline is inherited, not rebuilt). Rationale: a pattern helps
  *every* build of the shape; a library file helps only near-identical prompts — and precedence already ranks
  patterns highest, so this is where cross-domain leverage compounds.

- **D2 · Gotcha capture — route each lesson to where it SURVIVES (proposed).** A promotion is not done until its
  hard-won gotchas are recorded, split by enumerability:
  - **D2a · Enumerable → linter candidate.** If a gotcha is a mechanical, checkable rule (like 049's
    `variable:`-vs-`name:`), the promotion emits a **linter-candidate note** (file + rule statement +
    `vendor/dify-src` citation if it's a Dify import rule). It extends an EXISTING linter from the inside per
    the 013/049 contract (no new script, LINTERS list byte-unchanged) once confirmed. This is the durable,
    regression-proof channel — the 049 precedent proved it works.
  - **D2b · Non-enumerable → annotated pattern knowledge + pitfall log.** Design gotchas that can't be a boolean
    check (why `today` is injected from outside; ChatWork uses a custom `X-ChatWorkToken` header with
    `no-auth`; the workflow is not idempotent so re-runs re-notify) are captured as `# GOTCHA:` comments in the
    pattern header AND a one-line entry in the capability pitfall log (spec 007). Rationale: for the LLM, the
    *why* in a comment body teaches better than the *shape* alone — and the pitfall log is the cross-build
    memory that survives past any single pattern. **Dedup (r3, was OQ4):** when two promotions surface the same
    lesson, merge on a match key rather than duplicating — the **rule statement** for a D2a candidate, a
    **node-shape signature** for a D2b entry. This is S3 implementation work, not an open design question.

- **D3 · Promotion quality gate — no broken seed (proposed).** A file MAY NOT be promoted to `patterns/` or
  `library/` unless it passes, in order, reusing existing infra:
  1. **Lints clean under ALL linters — on BOTH the source AND the distilled output (r3: output re-lint pinned).**
     `validate_workflow.py` + refs + reachability + node-body schema, exit 0, no warnings above the promote
     threshold — run once on the source, and **again on the distilled output** *after* the placeholder
     transform (literal→`# TODO:`, blank-model). This closes the gap that D3.3 scopes the model check to the
     source: the transform is the one step that can silently break a ref or schema in the seed, and nothing else
     re-checks the seed. Re-linting the output is what carries the source's import guarantee forward (see check 2).
  2. **Import-probe OK against real Dify — on the SOURCE build (r3: artifact pinned; r4: rationale corrected by
     an actual probe).** The probe pushes the *source proven-build* → captures → deletes, orphan-swept per 049 r3,
     when selfhost creds exist. **Why the source and not the seed:** the source carries the *real* model + plugin
     dependencies — the meaningful import surface — whereas the distilled output is a stripped structural subset
     (blanked `''` model + `dependencies: []`). **Empirically verified 2026-07-08 against Dify 1.13.0:** a
     blanked-`''`-model, `dependencies: []` workflow imports cleanly (`{status: completed, error: ''}`) — so
     probing the output would neither *false-block* (an earlier r3 assumption, now disproven) NOR test anything
     the source probe doesn't already cover. The source is the right target because surviving import is already
     its premise (it is a "proven build") and it exercises the real model/plugin combo; the probe re-confirms that
     premise against the CURRENT pinned Dify. The seed inherits the guarantee **structurally**: the
     literal→`# TODO:` + blank-model transform changes no graph/ref/schema (check 1's re-lint of the output proves
     it introduced no new blocker), and the blanked shape is *independently known to import*. *(Probe logic lives
     in the builder's TS orchestrator (`apps/builder/server`); this gate re-orchestrates the same
     push→capture→delete mechanics on `sync.py`'s `push --json-out`/`delete` primitives from the skill/CLI context
     — reused seam, not reused code.)*
     No creds → the gate degrades to lint-only with an explicit `probe: skipped` provenance stamp (never
     block field promotion on missing creds — the 037/049 degrade precedent).
  3. **Model wiring on the SOURCE build — proof it actually ran (r2: scope corrected).** The empty-model check
     runs against the *candidate proven-build* — the source `projects/` artifact being promoted — NOT against
     the distilled output pattern. Every `type: llm` node (and any declared `reranking_model`) in the source
     must have a *present* `provider`+`name` — the real model the build ran with, or a named placeholder — but
     NEVER the empty `provider:''`/`name:''` shape the ChatWork build shipped. Rationale: an empty model means
     the LLM step was never wired, so a build claiming to be *proven* could not have actually run it — empty in
     the source is a hard block. **This does NOT touch the repo's template convention:** the D1 distillation
     deliberately *resets* the output pattern's model back to the established empty-`''` + `# TODO:` template
     shape (a marked strip, exactly like the `api.chatwork.com` → `# TODO:` strip), so every existing
     `templates/patterns|library/*.yml` is unaffected and needs **zero migration**. The check is a plain
     structural test (`provider != '' and name != ''`) on parsed nodes — no comment-proximity heuristic, no new
     linter script. (Present-in-source is fine whether real or named-placeholder; source-empty is the block.)
  Rationale: promotion is the moment a mistake becomes *contagious*. The gate is the immune system.

- **D4 · Retrievability contract — a pattern the builder can't find is dead weight (proposed).** Feature tags
  are auto-derived from node types by the INDEX builder (`has_iteration`/`has_http`/… → Key Features), so
  feature-retrieval is free — but **intent-retrieval depends on the `description`**, and a distilled skeleton
  with a vague description won't surface for "send a reminder per row". So every promotion MUST: (i) write an
  intent-rich `app.description` naming the *problem shape + trigger* (e.g. "per-row conditional notification
  dispatch: iterate a list, judge each row, POST to a mapped destination, aggregate results"), which flows into
  the INDEX Description column. **(r2/r3 NB — TWO truncations, both in `build_index.py`: the INDEX *table* shows
  `description[:50]`, and the stored/searched value itself is `description[:100]`. So `find.py --name` keyword
  search reads the *first 100 chars* — not the full description — and the table shows only 50. Front-load the
  problem-shape keywords into the first ~50 chars so they survive both cuts; 100 chars is wide enough that the
  remedy holds, but intent-retrieval IS bounded, not unlimited.)** (ii) rebuild INDEX as the final promote step (already the skill's job — pinned
  here so it can't be skipped). Rationale: the whole point is the next build *retrieving* this — an unfindable
  pattern is the same as no pattern.

- **D5 · Provenance + staleness re-probe (proposed; r2: staleness axis clarified).** Each promoted artifact
  stamps origin (source project path, promote date, driving spec/incident link) and the Dify version the
  import-probe last passed against — a new `known_good_dify` provenance field. Staleness here is a **second axis,
  distinct from 022's**: `check_provenance.py` today compares a source-file `orig_sha256` (upstream *content*
  drift), whereas D5 compares `known_good_dify` to the current `.dify-tag` (import-*behavior* drift). D5 reuses
  022's flagging/reporting **surface** (the `check_provenance.py` run + its status table), **not** its
  hash-comparison logic. **(r3: this is not pure "surface reuse" — it is a small *additive code change* in
  `check_provenance.py`'s `classify()`: a new branch comparing `known_good_dify` to the current `.dify-tag`
  (verified present, pins `1.13.0`), sitting alongside the existing `orig_sha256` branch and feeding the same
  status table.)** On a Dify version bump, artifacts whose `known_good_dify` is behind the pin are flagged for a
  re-probe (D3.2 re-run). Rationale: "known-good" is
  version-relative — 049 r3 proved Dify's import behavior shifts (orphan-on-commit, HTTP 202 pending); a pattern
  good today can rot silently.

## Non-goals

- **No RAG / vector retrieval / fine-tuning.** The 049 verdict stands at this corpus scale — this spec is the
  *patterns + linters + oracle* alternative, not a retreat from it.
- **No auto-promotion.** Human-gated, one-file-per-run, per the existing `template-promote` discipline. The
  gate (D3) decides *eligibility*, a human decides *promotion*.
- **No new linter script / no change to the 4-linter contract count.** D2a's candidate rules extend existing
  linters from the inside (013/049 discipline; LINTERS list + docs-contract-pin byte-unchanged).
- **Not about speed.** Generation is LLM-driven and stays the same wall-clock; the win is first-pass
  correctness and consistency for the shape-class, which reduces *rework* rounds, not raw generation time.
- **No one-off fixes to the ChatWork `main.yml` in scope here** — it is the worked example that motivates the
  pipeline; fixing/distilling it is the first *application* of this spec, not part of the spec's machinery.

## Acceptance criteria

1. *(D1)* `template-promote` with the pattern target, run on the **committed per-row-notify fixture** (a
   minimal ChatWork-shaped proven-build under `tests/fixtures/`, so this AC is CI-runnable without field
   creds — the real field build stays out-of-tree and is only illustrative in Motivation; the fixture MUST
   contain all five node types `iteration` + `http-request` + `if-else` + `code` + `llm` so the auto-derived
   Key Features exercise AC5), produces a
   `templates/patterns/*.yml` whose skeleton is domain-generic (no `api.chatwork.com`, no `X-ChatWorkToken`
   literal — both behind `# TODO:` customization points) and whose header carries the `Use case / Flow /
   Customization points` sections. The concrete-library target still works unchanged (regression).
2. *(D2a)* A promotion that surfaces a mechanical Dify-import rule emits a linter-candidate note with a
   `vendor/dify-src` citation; a fixture proves the note is produced. (The `variable:`-vs-`name:` rule is the
   worked witness — already shipped by 049, so this AC proves the *channel*, not a new rule.)
3. *(D2b)* The pattern distilled from the fixture carries `# GOTCHA:` header lines for the `today`-injection
   and the custom-header-with-`no-auth` decisions (the fixture reproduces both by design), AND a matching
   one-line entry lands in the capability pitfall log ([AGENTS.md §9](../../AGENTS.md)).
4. *(D3)* Red: a **source candidate** whose `type: llm` node has `provider:''`/`name:''` → gate blocks with the
   empty-model reason (the build was never actually wired/run). Red: a candidate that fails the import-probe →
   gate blocks and surfaces Dify's verbatim (redacted) error. Green: a lint-clean, probe-OK, model-present
   (real or named-placeholder) candidate → gate passes, and the D1 distillation then resets the output pattern's
   model to the `''` + `# TODO:` template convention (output-empty is by design, not re-gated). No-creds: gate
   degrades to lint-only with a `probe: skipped` provenance stamp and does NOT block.
5. *(D4)* The promoted artifact's `description` names the problem shape + trigger; INDEX rebuild includes it
   with correct auto-derived Key Features (`iteration, http, if-else, code, llm`); `find.py --has iteration`
   and a description-keyword search both surface it. **(This presumes the AC1 fixture actually contains a
   `type: code` node etc. — a fixture missing any of the five node types fails this AC even when the pipeline is
   correct; the five-type requirement is pinned in AC1.)**
6. *(D5)* The artifact carries a provenance stamp (source path, date, spec link, `known_good_dify` version); a
   simulated `.dify-tag` bump past `known_good_dify` flags it for re-probe via the version axis surfaced through
   the `check_provenance.py` status table (distinct from 022's `orig_sha256` content axis).
7. Full suites green; LINTERS list + docs-contract-pin byte-unchanged; the `template-promote` one-file-per-run
   + provenance invariants hold.

## Sequencing

- **S1** — D1 pattern-distillation target in `template-promote` (skeleton-vs-instance transform + header
  scaffold) + AC 1. Ship first: it's the visible leverage and unblocks the worked example.
- **S2** — D3 promotion quality gate, composing the 049 import-probe seam + the linter run + the empty-model
  check + AC 4. The gate is the safety floor before any promotion is trusted.
- **S3** — D2a linter-candidate note + D2b `# GOTCHA:` header + pitfall-log line + AC 2/3. Gotcha capture.
- **S4** — D4 retrievability contract (description discipline + pinned INDEX rebuild) + D5 provenance/staleness
  stamp + AC 5/6. Findability + freshness.

## Open questions

- **OQ1 (r3: mostly resolved)** — Should D3's import-probe be a HARD gate? Now that the probe is pinned to the
  **SOURCE build** (D3.2), a hard gate is *safe*: the source has a real model and its importability is its own
  premise, so a hard gate cannot self-block the way a hard gate on the blanked output would have (that was the
  latent trap — hard-gating the empty-model seed = every promotion blocked). **Lean yes, on the source probe.**
  Remaining: confirm the no-creds degrade path keeps field promotion unblocked (unchanged from r1).
- **OQ2** — Distillation (D1) is currently a human-in-the-loop transform inside the skill. Is there a
  mechanical "skeleton extractor" (strip node bodies to structure + `# TODO:`) worth building, or does the
  judgment of *what generalizes* stay human? Lean human for now; revisit if promotion volume grows.
- **OQ3** — Does the pitfall log (D2b) risk unbounded growth / staleness of its own? Define a review cadence or
  a "supersede" discipline, mirroring the specs-index status model.
- *(OQ4 resolved in r3 — folded into D2b as a dedup match-key note; it is S3 work, not an open question.)*

## Revision log

- r5 (2026-07-08) — **implemented S1→S4** (inline adversarial review — the subagent pool was
  quota-limited; every r3/r4 anchor re-verified against the tree and ALL held: the [:100]/[:50]
  truncation pair, `has_*` auto-derive, `.dify-tag`=1.13.0, the `classify()` extension point, the
  header convention, CI's warn-only `check_provenance` run). Shipped:
  * `tools/dify_base/promote_gate.py` — the D3 gate (`check`: 4 linters on source + distilled,
    source model-wiring, source import-probe with 049-style orphan sweep + `pending`
    classification, hard on probe-FAIL per OQ1, degrade-to-lint-only without creds) and the D2a
    channel (`candidate`: dedup on the exact rule statement → `docs/linter-candidates.md`, seeded
    with the 049 `variable:`-vs-`name:` witness).
  * First application: `tests/fixtures/promote/per_row_notify.yml` (all five node types, WIRED
    model, both D2b gotchas by design) distilled → `templates/patterns/per-row-notify.yml`
    (generic, `# GOTCHA:` ×3, blanked model, front-loaded description) — **also closes the
    pattern-library http-request gap** that made a field implement turn reverse-engineer the node
    shape from linters. **End-to-end probe run against the live Dify 1.13.0: eligible, probe ok,
    probe app deleted, `known_good_dify` stamped.**
  * D5: `check_provenance.py` — `classify(…, dify_tag=)` version axis (None = axis off, 022
    callers unchanged), default scan now covers `templates/patterns/` too (header-keyed, archetype
    patterns ignored), pitfall-log line in AGENTS.md §9, SKILL.md pattern-target procedure.
  * Implementation deltas vs r4 (all toward the standing contracts): (a) 022's pinned license-
    hygiene test requires the `license` field even for `source=original` → promotions stamp
    `license=MIT` (conform, don't special-case); (b) AC1 is realized as the COMMITTED fixture +
    COMMITTED distilled pattern + property tests (the skill stays human-run); (c) learned red-first:
    `lint_refs` scans comments, so GOTCHA/TODO prose must not contain literal `{{#…#}}` refs.
  * Verification: pytest 162 passed (13 in test_promote_gate) — the docs-drift pins caught the
    pattern count in FOUR docs (README ×2, architecture, AGENTS) exactly as designed; server suite
    425/425; INDEX rebuilt (43 files — per-row-notify surfaces with `iteration, http, code, llm,
    if-else` and the front-loaded description).
- r4 (2026-07-08) — **empirical check of the load-bearing assumption.** r3 rested on an *untested* claim that a
  blanked-`''`-model seed might not import (used to argue "probe the source, not the output"). Ran an actual
  push→delete probe against the live self-host (Dify 1.13.0, admin-key path) with `templates/patterns/multi-step-llm.yml`
  (blanked model + `dependencies: []`): import returned `{status: completed, error: ''}` — **blanked-model
  imports cleanly**. This *confirms* the seed is import-valid but *corrects* r3's rationale: probing the output
  would NOT false-block (r3 said it would). D3.2 check 2 reworded — the source is probed because it carries the
  real model/plugin surface, not because the output would fail. No structural change to the gate; the assumption
  is now a cited fact, not a hope.
- r3 (2026-07-08) — second review pass. (1) **D3.2 probe artifact pinned (was a blocking gap)**: r2 fixed the
  empty-model *scope* to the source but left D3.2 silent on WHICH artifact the probe runs — a hidden
  contradiction (probing the blanked output could hard-block every promotion = the 049 regression; the r1
  "seed is known-good-importable" claim was false since the seed is never probed). Now: probe the **source
  build**; the seed inherits the guarantee structurally via the transform + a **re-lint of the distilled output**
  (check 1, r3), not by its own probe; the false "seed imports" claim is removed. (2) **D3 check 1**: pinned the
  post-transform output re-lint (was implicit) — closes the gap that the substitution transform could break a
  ref/schema nothing re-checks. (3) **D4**: corrected "full stored description" → the searched value is
  `description[:100]` and the table `[:50]` (both truncations named). (4) **AC1/AC5**: the fixture MUST carry all
  five node types or AC5 fails on `has_code`/etc. even with a correct pipeline. (5) **D5**: no longer undersold
  as pure "surface reuse" — named the additive `classify()` branch in `check_provenance.py`. (6) **OQ1**: mostly
  resolved — hard gate is safe on the source probe. (7) **OQ4** folded into D2b as a dedup match-key note.
- r2 (2026-07-08) — review-driven corrections after verifying every anchor against the tree. (1) **D3.3 scope
  fix**: the empty-model check was mis-scoped onto the output template — but *both* `templates/patterns/` and
  `templates/library/` intentionally ship `provider:''` + `# TODO:` (verified: 5/6 patterns + the sole library
  file), and the `template-promote` skill mandates blanking. Re-scoped to the **source proven-build** (empty
  model there = the LLM step was never wired, so "proven" is false); the distilled output keeps the repo's
  empty-`''` convention via D1's marked strip → **zero migration, no convention reversal, no comment heuristic,
  no new linter**. (2) **D5**: relabelled as a *second* staleness axis (`known_good_dify` vs `.dify-tag`, import-
  behavior drift) reusing 022's reporting surface — not 022's `orig_sha256` content-hash logic. (3) **D3.2**:
  clarified the 049 import-probe *logic* lives in the builder's TS orchestrator; the gate re-orchestrates the
  same push→capture→delete *mechanics* on `sync.py` primitives (reused seam, not reused code). (4) **AC1/AC3**:
  witness is now a committed `tests/fixtures/` per-row-notify build (CI-runnable, no field creds); the real
  ChatWork build stays out-of-tree and illustrative — the goal is the whole shape-class, not that one file.
  (5) **D4**: noted the INDEX table's 50-char `description` truncation (front-load keywords; `find.py` reads the
  full string).
- r1 (2026-07-08) — initial draft. Motivated by a field user's request to "have the system learn" the ChatWork
  build; reframed against the repo's standing 049 verdict (patterns + linters + oracle, not retrieval) into a
  repeatable proven-build → generic-pattern promotion pipeline with a known-good quality gate (D3 reuses the
  049 import-probe) and durable gotcha capture split by enumerability (D2a linter / D2b pitfall-log). The
  ChatWork `main.yml` is the worked example throughout, not part of the machinery.
