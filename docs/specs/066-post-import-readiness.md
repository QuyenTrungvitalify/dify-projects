# Spec 066 — Post-import readiness: stop telling the user there is "nothing to set up"

**Status**: **Implemented** — S1 ✅ · S2 ✅ · S3 ✅ · S4 ✅ · S5 ✅ (2026-07-17).

> **A revision of this line briefly claimed "Implemented" while S4 was 1-of-3 done.** Review caught it;
> both missing bullets are now shipped. What let a false status through is the interesting part: every
> suite was green, because **nothing asserted COMPLETENESS**. The 063 oracle measures *jargon*, never
> *omission* — it scores a note that forgets all four items as a clean PASS. That is this spec's own
> warning ("its AC must not be graded by the instrument it is fixing") landing on the spec itself.
> The fix is `apps/builder/test/readiness-checklist.test.ts` + a frozen fixture of the real build's
> shape (`fixtures/readiness/naive-slack-digest.yml`, run 1784192313811): it asserts the note names
> **all four** items, and it was **proven to fail** against the shipped-but-incomplete code
> (*"the note omits: ENABLE the schedule trigger"*). That test should have existed from the start.

**AC-1 met**: the `deploy=none` (default) build now names all four — add an AI model · paste
`SLACK_WEBHOOK_URL` · turn the trigger ON · import `…/main.yml` — and the complete note still scores
**PASS, 0 jargon** through the 063 oracle. AC-2/3/4/5 green; AC-1b's cloud + pattern-gap paths pass.

S4 notes: `TRIGGER_ENABLE_NOTE` is a *variant*, not an un-gating — 057's original keeps its "an API run
is a manual fire" clause where it is TRUE (selfhost/cloud, and `live-test.ts`'s parked reason), and a
`none` build never ran anything. The probe verdicts moved to ONE shared `probeVerdict` in `report.ts`:
two producers (`orchestrator.ts`, `base-import.ts`) carried private copies of the same four strings,
which is precisely why the first pass reworded one and left the other emitting the retired text.

Verified: pytest **260**, server **562/563** (the 1 = pre-existing creds-gated AC-9), web **191**,
typecheck clean. The 063 oracle scores the ORIGINAL dossier note **FAIL (6 jargon)** where it once
scored a blind **PASS** — the widened blocklist works; the reworded frames take it to **PASS 0**.

> **Correction to this spec's own S3, found during implementation:** the draft claimed the model auto-fill
> "never happens" when `models: []` **or** `deploy=none`. The `deploy` half is **false** — `live-test.ts`
> never reads `task.deploy`, so a `none` run can still be live-tested from the UI and the model *does*
> auto-inject. Keying the wording on `deploy` would have been a fresh lie in the opposite direction. The
> shipped condition is `workspaceModelCount === 0` only (verified at `live-test.ts:269-270`, the 0-model
> degrade), read through `enabledModelCount()` so a FAILED harvest arm counts as *unknown*, never as 0
> (067 S6 — the two slices nearly shipped past each other).

— Claude authors; user implements.
**Effort**: M (one new blocker class, three un-gatings, a workspace-aware advisory, a blocklist widening —
all advisory-channel; no gate/lint semantics change).
**Depends on**: spec 064 (made the blocker *details* plain — this makes the *set* of them complete and true),
spec 063 (the `comprehension` oracle — **which this spec proves is currently too narrow**), spec 037
(`runnability.ts` preflight — the four blocker classes), spec 057 (`TRIGGER_ENTRY_NOTE`), spec 062 (the run
dossier that surfaced all of this).

## The finding (dossier `1784192313811`, exported by the user 2026-07-16)

A real naive JP prompt (「毎朝9時に…トップ記事を取得して、日本語で3行に要約し、Slackに通知する」) built a
lint-clean, import-probe-OK workflow. The **entire** text a user reads (`analyze.json` `overview` +
`report.json` `notes`) told them:

> "all linters passed **preflight**: not runnable out-of-the-box — needs: the AI model (filled in
> automatically when you test — **nothing to set up**). Advisory — does not block the build.
> **import-probe: OK — Dify accepted this DSL (probe app deleted)**"

…while the digest promised 「毎朝9時(Asia/Tokyo)に**自動起動**し…**自走**ワークフロー」.

**Every one of those claims is wrong for this build.** Four things the user MUST do; the note names **none**:

| the user must | preflight sees it? | why |
|---|---|---|
| paste a **Slack webhook URL** into the `SLACK_WEBHOOK_URL` env secret (`main.yml:17-19`, `value: ''`, consumed at `:334`) | ❌ **blind** | `RUNNABILITY_PROBE` (`runnability.ts:80`) reads only `workflow.graph.nodes` — it **never** reads `workflow.environment_variables` |
| **add + enable an LLM model** in Dify | ❌ **false promise** | `workspace.json` = `"models": []`; `runnability.ts:104-110` promises "filled in automatically when you test" unconditionally, and this run (`deploy=none`) never tests |
| **ENABLE the schedule trigger** in Studio Quick Settings | ❌ **gated out** | `report.ts:247` gates `TRIGGER_ENTRY_NOTE` to `selfhost\|cloud`; `deploy=none` is the **default** (`task.ts:445`) |
| **import `main.yml`** into Dify at all | ❌ | Studio steps are gated to `deploy=cloud` (`report.ts:221`); nothing tells a `none` user the file exists |

**The user's actual experience**: reads "nothing to set up" → imports (if they work out that they should) →
waits → at 9am nothing arrives in Slack → no error, no explanation, unattended. The one deliverable they
asked for silently never happens.

The irony is the point: **spec 064 made the note readable enough for the lie to become visible.** It was
previously buried in jargon.

## The honest nuance

- **The `comprehension` oracle (063) scored this run PASS — and the oracle is wrong.** `JARGON_BLOCKLIST`
  does not contain `linters`, `preflight`, `import-probe`, `DSL`, or `probe app`, so it cannot see the jargon
  that is still there. Any fix here must **widen the blocklist first**, or the same blind PASS repeats. This
  spec's own AC must not be graded by the instrument it is fixing.
- **`report.ts:202` omits terminating punctuation** — the only note part that doesn't self-terminate — so the
  `join(' ')` at `:267` fuses it with the lowercase preflight note into **"all linters passed preflight"**,
  which parses as a *pass*. The real verdict ("not runnable") lands mid-sentence, contradicting it.
- **`deploy=none` is not a user choice** — it is the default and the terminal state of any auto-mode run. It
  is currently the *only* branch with no import guidance, which is exactly backwards: a `none` user is the
  one who must do everything by hand. `report.ts:49-53` already assumes this ("…and none (if they later
  import it)") — the gates at `:221`/`:247` contradict their own sibling.
- **Ungating `TRIGGER_ENTRY_NOTE` verbatim is wrong**: its "an API run is a manual fire" clause (and the JA
  frame at `i18n.ts:784-785`) presumes a test run that a `none` run never performs. It needs a reworded
  variant, not a removed `if`.
- **Dev channels stay dev.** `preflight.json`'s `nodeId`, `report.json`'s `lint`/`deploy`/
  `unresolved_plugin_todo` are untouched — this spec only changes the human text (the 064 precedent).
- The system already *knows*: `analyze.json` `risks[3]` says 「publish だけでは発火しない — Dify Studio で
  トリガーの ENABLE が別途必要」. `risks` is rendered **nowhere** in `web/src`. The knowledge exists and is thrown away.

## Goal

**G1 — the ④ note tells the user the complete, true set of what they must do before this workflow can run**,
in plain language, on the default `deploy=none` path — or says nothing is needed only when that is actually
true. No advisory may promise automatic behaviour the run did not perform.

## Non-goals

- NOT changing gate/lint/verdict behaviour — advisory channel only; structured `report.json` fields untouched.
- NOT fixing the built workflow's own bugs (see "Adjacent" below — separate work).
- NOT the full NOTE_JA localization port (063's deferred slice) — but every string added here ships its frame.

## Design

### S1 — widen the `comprehension` blocklist FIRST (S)

Add `linters`, `preflight`, `import-probe`, `DSL`, `probe app`, `advisory` (+ JA 「リンター」「プリフライト」
「アドバイザリ」) to `JARGON_BLOCKLIST`. This turns the current run **PASS → FAIL**, which is the correct
baseline: the note *is* still jargon. Ship this before S2-S5 so their ACs are graded by a working instrument.

**Consequence — S5 must reword the FRAMES, not just the details.** Each token added here binds a slice below:
`linter(s)` → `report.ts:202`'s lint line; `preflight` → `runnability.ts:140`'s `preflightNote` frame;
`advisory` → **both** `preflightNote` **and** `analysis.ts:72`'s `patternAdvisory` (it literally opens with
`advisory:`); `import-probe`/`probe app` → S4's probe tail — **all three** returns (`orchestrator.ts:722`,
`:727`, `:737`), not just `:722`. If a slice does not remove its token, AC-1 can never go FAIL → PASS.
Do not add a token to this list without the slice that retires it.

> **A token is jargon only if the user cannot ACT on it — a name they read off the screen is an affordance.**
> Review caught that a `DSL` token bricks the whole `deploy=cloud` path: `cloudStudioNote`
> (`report.ts:126`) tells the user to click Dify Studio's literal `"Import DSL"` button. Blocklisting the
> words printed on the button they must find is not a jargon fix — it is a permanently-red gate, and an
> always-red gate gets ignored, which costs more than the jargon ever did. **`DSL` is excluded by design.**
> Both tokens that bricked a path (`DSL`, `advisory`) were invisible to AC-1 because it graded only the one
> `deploy=none` fixture — hence AC-1b.

### S2 — a fifth blocker class: `env_secret_empty` (M)

Extend `RUNNABILITY_PROBE` to read `workflow.environment_variables` and flag any entry with an empty `value`
that is **referenced by the graph**. "Referenced" has **two** first-class forms in Dify, and a probe that
knows only the first produces a **false negative** — silently no blocker, i.e. the precise failure this
whole spec exists to end:
1. the **template** form — `{{#env.NAME#}}` in any string under the graph;
2. the **selector** form — `value_selector: ['env', 'NAME']` anywhere under the graph
   (`vendor/dify-src` `variable_factory.py:84` builds env refs as `[ENVIRONMENT_VARIABLE_NODE_ID='env',
   name]`).
This repo's own `tools/dify_base/lint_refs.py` already walks both (`REF_PATTERN` + `walk_value_selectors`,
`SPECIAL_NS = {conversation, env, sys}`) — mirror that logic rather than reinventing a grep. The parity
fixture must exercise **both** forms, or AC-5 passes while form 2 is unimplemented. Detail, plain: *"the Slack webhook URL (you'll paste this in
Dify — the workflow can't send without it)"*. Keep the class + var name on the structured blocker. Mirror it
in `report_structure.py` — `runnability.test.ts`'s AC-2 parity guard hard-fails on drift, by design.

### S3 — make the model advisory workspace-aware (S)

`runnability.ts:104-110` must stop promising "filled in automatically when you test — nothing to set up"
unconditionally. Condition it on the harvested facts + the deploy mode: with `models: []` **or**
`deploy=none`, the auto-fill never happens (`live-test.ts:269-270` degrades on 0-model), so the honest text is
*"an AI model — add one in Dify (this workflow can't summarize without it)"*. This is spec 064's own principle
applied correctly: 064 made it plain but left it **untrue**.

### S4 — un-gate the `deploy=none` path (M)

- `report.ts:247`: give `none` a **reworded** trigger advisory (drop the "API run is a manual fire" clause) +
  its NOTE_JA frame.
- `report.ts:221`: give `none` plain import guidance naming the workflow file path.
- Retire or plain-language the `import-probe: OK — Dify accepted this DSL (probe app deleted)` tail
  (`orchestrator.ts:722`) — it has **no** NOTE_JA frame and announces a deletion the user can only misread.

### S5 — one checklist, one voice (M — bigger than it looks)

Assemble the blockers into a single **"before this can run, you need to:"** list (061's `toolInstallNote`
voice), and fix `report.ts:202`'s missing terminator so the join can never fuse two sentences again.

**Reword the two jargon FRAMES** (S1's tokens are unreachable otherwise): `runnability.ts:140`'s
`preflight: not runnable out-of-the-box — needs: … Advisory — does not block the build.` and `report.ts:202`'s
`all linters passed`. Spec 064 made the blocker *details* plain and left the *frames* untouched — that is why
the note still reads as internal vocabulary.

**This breaks four pinned test files**, none of which 064 anticipated. Naming them is part of this slice:
`runnability.test.ts:70,76` · `preflight-gate.test.ts:144` · `report-plugin-todo.test.ts:127,150` ·
`linters.test.ts` — plus each frame's `NOTE_JA` entry in `i18n.ts`. AC-4 counts them as in-scope work, not
as breakage.

## Acceptance criteria

1. **The objective proof (AUTO)**: with S1's widened blocklist, the dossier-`1784192313811` note goes
   **FAIL → PASS** *after* S2-S5 — and its checklist names all four items (Slack webhook · AI model · enable
   the trigger · import the file). Reproducible pytest; **no LLM**.
   **Fixture, not the scratchpad**: the dossier lives outside the repo, so a test cannot reference it. Check
   in its `report.json`/`preflight.json`/`workspace.json`/`main.yml` (env-var block + the Slack node) under
   `apps/builder/test/fixtures/` as the frozen BEFORE case. Freezing it is what makes the transition
   reproducible rather than a one-off observation.
1b. **AUTO — grade MORE than one path.** AC-1's single `deploy=none` fixture is why two blocklist tokens
   shipped that bricked other paths forever. Add fixtures for the `deploy=cloud` note (contains
   `cloudStudioNote`'s `"Import DSL"`) and a pattern-gap note (contains `patternAdvisory`), and assert both
   **PASS**. A blocklist token is only correct if every note the product can emit still passes.
2. **AUTO**: the run-on is gone — no note contains `"passed preflight"`; every part self-terminates.
   Enforce this at the **join seam** (`joinNotes`), not by convention: `task.probeNote` is produced in
   `orchestrator.ts` and its error/skip branches end in a verbatim tail no author can punctuate at source,
   so a per-string rule cannot make the invariant true. Normalising at the seam makes it structural.
3. **AUTO**: no advisory promises auto-fill when `models: []` or `deploy=none` (unit-tested both ways).
4. **AUTO**: advisory-only preserved — the ③ gate stays deep-equal to a clean run's gate (the 037 AC-3b
   anti-gaming test); `report.json` structured fields unchanged; `npm test` + `pytest` green **with S5's four
   pinned test files updated to the new wording** (they are scope, not collateral damage).
5. **AUTO**: python↔TS parity holds for the new class (`runnability.test.ts` AC-2 over a new fixture) — the
   guard hard-fails on drift by design, so `env_secret_empty` lands in `report_structure.py` in the same PR.
6. **MANUAL**: a human confirms the JA render of the new frames in the real UI. Report per the 058
   three-bucket contract; never silently drop.

## Adjacent (found in the same dossier — NOT this spec)

Filed here so they are not lost; each is its own small piece of work:
- **The built workflow crashes on Ask HN posts**: the top Algolia hit can have `url: null` (`main.yml:150,160`),
  fed straight into an HTTP GET (`:198`) with no `error_strategy` → the run aborts. Several mornings a week.
- **"Top article" silently reinterpreted**: `search?tags=front_page` + `hits[0]` (`:120`,`:158`) = the
  highest-**points** story, not news.ycombinator.com's #1 slot. `SPEC.md:37` asserts it is the top.
- **~12 wasted turns/run**: `orchestrator.ts:392` inlines each phase doc **without its path**, so the
  `[SKILL.md](SKILL.md)` relative link every phase is ordered to read first cannot resolve — no phase reads
  the ground rules, and each rediscovers the shell-sandbox rules by trial-and-error (Analyze burned 8
  consecutive hook-denied `find` calls). The cheapest fix in the whole investigation.

## References

- Dossier `1784192313811` (spec 062 export) — `report.json:14`, `preflight.json`, `workspace.json`
  (`"models": []`), `main.yml:17-19,334`, `analyze.json` `risks[3]`.
- `apps/builder/server/lib/runnability.ts:24,80,104-110`; `report.ts:202,221,247,267`;
  `orchestrator.ts:722`; `apps/builder/web/src/lib/i18n.ts:784-785`; `apps/builder/scripts/e2e_check.py`
  (`JARGON_BLOCKLIST`); `.claude/skills/report/report_structure.py` (parity).
- [064](064-plain-language-runnability-notes.md) (made it plain; this makes it true+complete),
  [063](063-e2e-naive-user-fidelity.md) (the oracle this spec widens), [067](067-tool-nodes-are-buildable.md)
  (the sibling: making the tool buildable at all).
