# Spec 019 — Builder output-quality & lean roadmap (post-018 umbrella)

**Status**: Draft
**Effort**: (meta — umbrella; per-item effort in the tables below)
**Depends on**: [009](009-browser-workflow-builder.md) (the app), [013](013-builder-linter-contract-and-test-seams.md) (the linter contract this builds on), [015](015-builder-security-turn-sandbox.md) + [018](018-builder-turn-write-allowlist.md) (security — declared **done**, not extended here)

> **Thesis (review 2026-06-21).** A full read of 009→018 + the 4-phase prompts found the system
> **well-built**: clean backend decomposition, a correctly-tiered security model, disciplined specs
> (013-as-keystone, the 015 mid-spec pivot, no silent AC drift). But the investment has gone almost
> entirely into **hardening the MACHINE** (orchestrator state, security sandbox, gate UX) while the
> quality of the **OUTPUT** — the Dify workflow YAML the app actually produces — was *deferred*.
> Meanwhile "nhỏ nhẹ" is under real pressure, not from the binary but from a few accreted hotspots
> **and from the spec process itself** (six hardening specs ≈1000 lines now rival the app they govern).
>
> This umbrella pivots the next round to **output quality + staying lean**, under one non-negotiable
> rule: **no change may disrupt a build that passes today.** It is the single roadmap; most items are
> tracked here as changelog-grade work rather than spawning their own full specs (see §7).

## Context

009→018 delivered a correct, gated 4-phase builder with a sound security boundary and a strong unit
net. Three facts shape what comes next:

1. **The highest-leverage correctness gap is still open and documented.** [AGENTS.md §4.2](../../AGENTS.md)
   calls a bad variable ref *"the #1 cause of silent import success + runtime failure."* Yet
   [lint_refs.py](../../tools/dify_base/lint_refs.py) checks only *id-exists* + *field-in-declared-outputs*
   — it does **not** verify the source node is upstream-reachable in the graph. [017](017-builder-prompt-linter-and-perf.md)
   explicitly **deferred** the reachability checker and only corrected the over-claim in prose
   ([SKILL.md:27-30](../../.claude/skills/dify-build/SKILL.md), [implement.md:44-45](../../.claude/skills/dify-build/implement.md)).
   The most common silent-failure mode in the whole domain is guarded by one sentence and zero checkers.
2. **Pattern selection — the single biggest lever on output shape — is an unguarded, unrecorded judgment call.**
   [implement.md:24](../../.claude/skills/dify-build/implement.md) tells the turn to run `find.py` and "pick
   the closest pattern" with nothing constraining or persisting the choice; a wrong pick is invisible until
   a structurally-off graph surfaces at import.
3. **Lean pressure is concentrated, not diffuse.** [orchestrator.ts](../../apps/builder/server/lib/orchestrator.ts)
   is **930 LOC** because it absorbed scaffold/import/slug IO that has nothing to do with the gate FSM; there
   is an un-gated second turn-spawn path ([index.ts:143-221](../../apps/builder/server/index.ts) `/api/dev/run-implement`)
   that can violate the 1-writer invariant; and there is dead code in both server and web. The spec *prose*
   is itself the heaviest "small" thing in the repo.

The security arc (015/018) is **complete and well-executed for the single-user localhost threat model** and
is **out of scope to extend** here (one exception: a fail-open *operational* hole, item **L4**).

## Goals

1. **Raise OUTPUT quality** — close the deferred correctness gaps so the generated YAML fails *at Implement*,
   not silently at runtime in Dify (reachability, pattern verification, custom-path graph soundness).
2. **Stay lean** — the highest-leverage moves are **deletions** (un-gated endpoint, dead types, accreted IO
   in the orchestrator). Shrink, don't add.
3. **Zero disruption** — every item ships behind the discipline in §3 so it cannot break a passing build or a
   green pre-commit.
4. **Right-size process** — small/cleanup/frontend items are tracked here as changelog-grade work, **not**
   full specs (§7). Reserve the full Context/Goals/Non-goals/Open-Q/AC scaffold for behavior-changing or
   risk-bearing work.

## Non-goals

- **No further security hardening.** 015/018 are done for the stated model; the OS-sandbox (015 option B) stays
  deferred until the tool is actually multi-user/exposed.
- **No new features**, no multi-user, no model picker UI.
- **Not a re-spec of 009–018.** This sits on top; it does not relitigate settled decisions.
- No change that gates a build on a new check **before** that check is proven clean on the existing corpus (§3).

## The no-disruption discipline (binds EVERY item below)

This is the load-bearing section. Each rule decouples *"improve quality"* from *"disrupt a working build."*

1. **Linter / contract change → `warn-only` first.** A new structural check ships as an advisory signal
   (separate flag or non-zero-suppressed exit) that **prints but exits 0**. Measure its hit-rate across the
   existing surface — **corpus (46 DSL) + templates/{patterns,probes} (7) + projects/\*/workflows (20)** — fix every
   false positive, and **only then** fold it into [linters.ts](../../apps/builder/server/lib/linters.ts)
   `lintClean` and the [pre-commit hook](../../.pre-commit-config.yaml) (which runs `lint_refs.py` on
   `templates/` + `projects/*/workflows/` — so a premature gate breaks vetted patterns and committed projects).
2. **Schema / task-field → optional + back-compat.** Any new `task.json` / `analyze.json` field is optional;
   an old `.runs/<id>/` without it must still load and reconcile.
3. **Behavior change → one test before merge.** Anything that changes what a build *does* (not a pure deletion
   of unreachable code) lands with a unit test pinning the new behavior.
4. **Refactor → byte-identical bodies, suite green before *and* after.** A move/extract keeps function bodies
   unchanged and is gated on the full server+web suites being green on both sides of the change.
5. **Default model change → opt-in.** A per-phase model override defaults to *today's* behavior; the override is
   config, not a forced default, and is measured on a few real builds before any default flips.

## Design — the roadmap (4 tiers by disruption)

Item ids carry through from the review. **Disruption** is the risk of breaking a working build/commit:
🟢 none (deletion / additive) · 🟡 low (touches a live path, +1 test) · 🟠 staged rollout required.

### Tier 0 — zero-disruption cleanup · one "dọn nhà" PR · 🟢

Pure deletions / additive error-handling; `tsc` + the existing suites catch any slip. No behavior change a user can see — **one exception flagged in the coordination notes below**: the L5c modal removal deletes a no-op "New Project" button.

| id | Change | File(s) | Effort | Note |
|---|---|---|---|---|
| **L1** | Delete `/api/dev/run-implement` (or hard-gate on `turnBusy()`) | [index.ts:143-221](../../apps/builder/server/index.ts) | XS | **Zero *code* callers** (verified) — removes an un-locked 2nd spawn path that can break the 1-writer invariant the confinement model rests on. ⚠️ It is still a documented dev curl smoke-endpoint ([009-implementation-plan.md:246](009-implementation-plan.md), [lat1-skeleton.md:105,126](prompts/009/lat1-skeleton.md)); deleting orphans those 3 doc refs (doc-drift hook). **Prefer the `turnBusy()` hard-gate** (keeps the smoke path, closes the invariant hole); if deleting, clean the doc refs in the same PR. |
| **L3** | Delete the **dead** presentational types (the design-mock block, ~L115-234); keep the **live** ones: `FileChange`, `PhaseKey`, `PhaseState`, `PhaseStates`, `ArtifactTab`, **`Settings`** | [types.ts](../../apps/builder/web/src/types.ts) | XS | ~120 dead type-LOC; removes the dead `Gate` that shadows the live `WireGate` (the real dual-`Gate` footgun). ⚠️ `Settings` is **live** ([App.tsx:86-87,370-371](../../apps/builder/web/src/components/App.tsx#L86), [Chat.tsx:330-331](../../apps/builder/web/src/components/Chat.tsx#L330)) — **keep it**; there is no dual-`Settings`. `FolderEntry` (L236-240) is dead **only after** L5a removes its consumer — see coordination notes. Zero runtime/bundle cost. |
| **L5a** | Drop genuinely-dead web exports/glyphs: `buildUnifiedRows` ([diff-parser.ts](../../apps/builder/web/src/lib/diff-parser.ts), exported, 0 callers) + unused `Icon` glyphs | web | XS | Truly unused — pure deletion, no observable diff. |
| **L5c** | Resolve the `CreateProjectModal` stub ([Modal.tsx](../../apps/builder/web/src/components/Modal.tsx)) | web | XS | ⚠️ **Not unused** — it is imported + rendered ([App.tsx:13,325](../../apps/builder/web/src/components/App.tsx#L325)); it is *wired-but-non-functional* (ships a `FOLDER_POOL` mock + no-op `onCreate`). Wiring it = a new feature (out of scope). **Default = remove stub + its trigger + `FolderEntry`** (deletes a no-op "New Project" button — **observable**, though it does nothing today), or defer. Couples with L3 (`FolderEntry`). The one Tier-0 change a user can notice. |
| **L6** | Delete the superseded §E body in 009 (the banner-marked `--allowedTools` model + its stale allowlist that still lists `sync.py`) | [009](009-browser-workflow-builder.md) | XS | Docs only. Banner isn't enough — a turn/contributor can mis-read a dead allowlist. |
| **C2** | Reset `_appliedTaskId`/`_appliedRev` in `resetToNew` | [store.ts:140](../../apps/builder/web/src/store.ts) | XS | Fixes a reproducible "blank thread on re-open after reset". 1 line + 1 test. |
| **C3** | `saveSpec` → wrap in try/catch, route through `surfaceError` | [store.ts](../../apps/builder/web/src/store.ts) `saveSpec` | XS | The one action with no error feedback today (a failed PUT dies in console). Additive. |

> **Tier-0 coordination notes (added in the 2026-06-21 review pass — these correct the original inventory):**
> - **`Settings` is live, not dead** — the original L3 ("delete everything below `Wire*`") would have deleted a type used by App/Chat and broken `tsc`. It is now in the keep-list. Only the *dead* presentational types go; the genuine duplicate is `Gate`-vs-`WireGate`, not `Settings`.
> - **L3 ↔ L5c ordering:** `FolderEntry` is the consumer of `CreateProjectModal`. Delete the type *with or after* the modal, never before — type-before-consumer breaks `tsc` mid-PR.
> - **L5c is observable:** `CreateProjectModal` is rendered, not unused. Its removal is the single Tier-0 change a user could see (a no-op button disappears). It is split out of L5a for that reason; if you want strict "zero observable diff", defer L5c and keep L5a/🟢 clean.

### Tier 1 — low-risk correctness · touches a live path · +1 test each · 🟡

| id | Change | File(s) | Effort | Risk & guard |
|---|---|---|---|---|
| **C1** | Harden `flushPendingOutput` against post-transition stragglers (buffer-key by phase; don't `clear()` a phase with no live target) | [store.ts:240](../../apps/builder/web/src/store.ts) | S | Only **silent data-loss** path (dropped streamed text at the run→gate boundary). Done wrong → double-append; guard = a "straggler after transition" test in `store.test.ts`. |
| **C4** | `init` SSE event must use a freshly-incremented id, not the stale last-broadcast counter | [sse.ts](../../apps/builder/server/plugins/sse.ts) (`eventCounter`/`init` path) | XS | Off-by-one in the exact `Last-Event-ID` replay AC #22 relies on; guard = a reconnect-replay test. |
| **L4** | Boot-time assertion that the permission hook is **loadable** (spawn-smoke mirroring how Claude Code invokes it); refuse-to-start (or warn loudly) if not | [index.ts](../../apps/builder/server/index.ts) `start()` | XS | The **one** security item kept: the sandbox **fails OPEN** if `node` can't run the `.ts` hook (e.g. host Node < 22.6) and nothing detects it. Inverse risk (too strict → false refuse-to-start) → mirror the real invocation exactly; warn-not-fail acceptable for v1. |
| **L5b** | Remove the diff content-hash short-circuit + its `diff.hash` sidecar | [diff.ts:108-132](../../apps/builder/server/lib/diff.ts) | XS | Premature opt (saves one sub-100ms `difflib` spawn on a single-user box). Behavior = one extra spawn (slower, never wrong). Delete with `diff-shortcircuit.test.ts`. |

### Tier 2 — behavior-preserving refactor · 🟠 (load-bearing file) gated on green suite

| id | Change | File(s) | Effort | Discipline |
|---|---|---|---|---|
| **L2** | Extract scaffold/import/slug IO out of the orchestrator → `lib/scaffold.ts` + `lib/import.ts` (`difySeedScaffoldAndPull`, `localEditSeed`, `scaffoldAtSpecGate`, `runImportAndFinish`/`finishWithoutImport`, `relocateRunArtifacts`, `deriveSlugName`, `firstFreeSlug`) | [orchestrator.ts](../../apps/builder/server/lib/orchestrator.ts) (930 → ~350) | M | **Behavior change = 0.** Keep bodies byte-identical; full suite (golden-build, advance-loop, auto-advance, gate, confinement, restore, recovery, lock) green before+after. Lets the gate FSM fit in one head — the core "powerful but small" win. |

### Tier 3 — output quality · 🟠 staged rollout (the "đủ mạnh, chất lượng" core)

These change what passes. **None gates a build until proven clean per §3.1.**

| id | Change | File(s) | Effort | Rollout |
|---|---|---|---|---|
| **O2** | Persist the chosen pattern + the `find.py` query as a task field; assert `features(pattern) ⊇ features(analyze.json)` | orchestrator + `analyze.json`/`task.json` schema + [spec.md](../../.claude/skills/dify-build/spec.md)/[implement.md](../../.claude/skills/dify-build/implement.md) | S | Field **optional** (§3.2); verification = **surfaced advisory**, not a hard gate. Makes wrong-pattern picks visible (today invisible) and unlocks a true pattern-delta diff. **Do first** — lowest disruption of the tier. **Prereq:** the `⊇` check needs Analyze to persist a feature-set into `analyze.json` (the `find.py --has <feature>` vocabulary already defines the feature names — reuse it; if Analyze records none yet, this becomes part of O2's scope). |
| **O1** | **Graph-reachability check** in `lint_refs.py`: a BFS that verifies every `{{#id.field#}}` / `value_selector` source is actually upstream-reachable | [lint_refs.py](../../tools/dify_base/lint_refs.py) → [linters.ts](../../apps/builder/server/lib/linters.ts) | M | **3-phase per §3.1:** (1) `--check-reachability` warn-only, exit 0; (2) run across corpus+patterns+projects, fix/whitelist false positives (unmodeled node-type outputs → extend `IMPLICIT_OUTPUTS` or whitelist); (3) promote into `lintClean` + pre-commit. Closes the documented **#1 runtime-failure cause**. Highest output leverage in the backlog. |
| **O4** | Custom-path graph smoke check: start→end connectivity, no orphan nodes / dangling handles | new linter / `validate_workflow.py` extension | M | Same warn-only → measure → promote as O1. Targets the "passes 3 structural linters but branches wrong" class that LLMs hit most on from-scratch graphs ([implement.md:34-40](../../.claude/skills/dify-build/implement.md)). |
| **O3** | Per-phase model tier (Implement = stronger; Analyze/Test = cheaper/faster) | claude-session / phases / orchestrator + config | S–M | **Opt-in (§3.5)**, default = today. Rare item that improves quality *and* leanness (cost/latency). **Consult the Claude model reference for tier ids/pricing — do not guess.** |

## Sequencing

```
Bước 1  (PR "dọn nhà", 🟢 zero-disruption):   L1 + L3 + L5a + L6 + C2 + C3   (L5c optional — observable, see notes)
Bước 2  (correctness, +test, 🟡):             C1 + C4 + L4 + L5b
Bước 3  (lấy lại "nhỏ", 🟠 refactor):          L2   (gate on green suite)
Bước 4  (output quality, warn-only):          O2 (advisory) → O1 (3-phase) → O4
Bước 5  (opt-in):                              O3 model-tier
```

## Open questions

- **Q1 (O1).** Unmodeled node-type outputs: extend `lint_refs.py` `IMPLICIT_OUTPUTS` to cover every node type the
  reachability pass touches, or whitelist-and-warn the unknowns? *Recommend:* extend incrementally during the
  warn-only phase, whitelist only what the corpus actually trips on.
- **Q2 (O3).** Which model tier per phase, and is per-phase override worth the config surface for a solo tool?
  *Recommend:* decide against the Claude model reference (not from memory); ship Implement-only override first,
  default unchanged.
- **Q3 (process).** Do Tier 0–2 items get individual AC tracking, or are they closed as one "019 cleanup"
  changelog under this spec? *Recommend:* one changelog entry per `Bước`, no per-item specs (this is the §7
  right-sizing in action). Only **O1** likely earns its own follow-up spec given the corpus blast radius.
- **Q4 (O2).** Persist the chosen pattern in `task.json` or in `analyze.json`? *Recommend:* `analyze.json` (it is
  Analyze's output and already the diff-baseline source), surfaced onto the task for the gate.

## Acceptance criteria

1. **Tier 0** merged: `/api/dev/run-implement` gone (or `turnBusy`-gated, with its doc refs reconciled);
   dead types/exports/glyphs removed (`Settings` **kept** — it is live); 009 §E body deleted; `resetToNew`
   resets `_appliedTaskId`/`_appliedRev`; `saveSpec` surfaces errors. Both server+web suites green; **no
   functional behavior change** — the only user-visible diff permitted is the L5c no-op "New Project" button
   removal (and only if L5c is taken in this Bước).
2. **Tier 1** merged with a test each: no streamed-output loss at the run→gate boundary; `init` replay id correct;
   boot refuses-to-start (or warns) when the hook is unloadable; diff hash sidecar gone.
3. **Tier 2**: orchestrator ~350 LOC after extraction (< ~400 LOC); full suite green before+after; zero behavior diff.
4. **Tier 3 / O1**: reachability check exists and runs **warn-only**; a measured false-positive report over
   corpus+patterns+projects exists; it is promoted to `lintClean`+pre-commit **only after** that report is clean.
   A workflow with a downstream-only ref is **caught at Implement**, not at Dify import.
5. **Tier 3 / O2**: the chosen pattern is persisted and visible at the gate; a pattern missing a required feature
   is surfaced as an advisory (no build hard-fails on it in v1).
6. **Tier 3 / O4**: the custom-path graph smoke check (start→end connectivity, no orphan nodes / dangling handles)
   ships **warn-only** first and is promoted to a gate **only after** a clean false-positive report over the same
   surface as O1. A from-scratch graph with an orphan node is caught at Implement, not at Dify import.
7. **Tier 3 / O3** (if taken): per-phase model tier is **opt-in**, default = today's behavior; measured on a few
   real builds before any default flips. Shipping O3 is optional — it may be deferred without blocking 019.
8. **No regression**: 009–018 acceptance criteria remain satisfied throughout (the discipline in §3 is what
   guarantees this).

## §7 — Process: this spec is the lean experiment

Per the review, the spec *prose* is the one place this lightweight tool is genuinely getting heavy. 019 is
deliberately the **single umbrella** for a batch of work that, pre-019, would have been 4–6 separate specs
(each with a full scaffold). The standing rule going forward:

- **Behavior-changing or risk-bearing** (O1, O3) → may earn a short follow-up spec.
- **Cleanup / refactor / frontend / XS correctness** (all of Tier 0–2) → tracked here, closed as per-`Bước`
  changelog entries. **No individual specs.**

## References

- Review session 2026-06-21 (this repo), re-verified against the tree before this revision: backend / web /
  spec+prompt deep reviews; blast-radius confirmed (`lint_refs.py` in [pre-commit](../../.pre-commit-config.yaml)
  on `templates/(patterns|probes)/*.yml` + `projects/*/workflows/*.yml`; `/api/dev/run-implement` has **zero code
  callers** but 3 doc smoke-endpoint references; orchestrator 930 LOC). **§3.1 measurement surface (corrected to the
  live tree): corpus 46 · templates patterns+probes 7 · project workflows 20.** The
  [linters.ts](../../apps/builder/server/lib/linters.ts) single contract is unchanged.
- [AGENTS.md §4.2](../../AGENTS.md) — variable refs as the #1 silent-failure cause (the gap O1 closes).
- [017](017-builder-prompt-linter-and-perf.md) §"deferred" — where the reachability checker was punted.
- [SKILL.md](../../.claude/skills/dify-build/SKILL.md) / [implement.md](../../.claude/skills/dify-build/implement.md)
  — the 4-phase prompts whose honest "keeping refs upstream is on you" caveat O1 makes obsolete.
