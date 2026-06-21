# Spec 017 — Skill-prompt + linter hardening & 4-phase performance

**Status**: Implemented (2026-06-21) — all open questions resolved below; D1–D7 landed with tests + the corpus gate green.
**Effort**: M
**Depends on**: [013](013-builder-linter-contract-and-test-seams.md) (the shared `linters.ts` the PRF parallelize + the plugin-hash gate both consume)

> **Two small themes, batched.** **(A) PRM** — tighten the `dify-build` prompt family + the python linters
> so a phase can't silently emit invalid Dify YAML (app-agnostic: helps CLI users too). **(B) PRF** — cut
> critical-path latency + streaming render jank. Each item is small; they're batched into one spec to
> amortize the corpus-regression and behavior-equivalence test cost they share.

> **One risky item, isolated.** Of the ~11 findings, exactly **one** (D1, the if-else `cases[]` validator)
> can regress existing workflows — it touches a validator the whole repo runs against **14 if-else YAML
> files**. Everything else is a prose edit, an advisory warning, or a behavior-preserving perf change.
> D1 carries a mandatory corpus-revalidation gate; the rest are low-risk.

## Context

Verified on current code (013/014/015 landed; seed-guard already fixed by 015 D4 → dropped):

**PRM — a phase can silently ship invalid Dify YAML:**
- **(P1) if-else `cases[]` is unchecked.** `_validate_ifelse_node`
  ([validate_workflow.py:214-218](../../skills/mango-svip/scripts/validate_workflow.py)) only asserts the
  legacy `conditions` key is present + non-empty; it never inspects `cases[]`. But Dify 0.6.0 runtime
  executes off `cases` (AGENTS.md §9). So a node with `conditions` but a missing/empty/wrong `cases` passes
  all three linters yet branches wrong at runtime. The prompt rule "emit BOTH" (implement.md:37) is the only
  guard — prose, no checker.
- **(P2) An unresolved plugin TODO ships clean.** `lint_plugin_hashes.py:31-36` only flags an *invalid*
  hash format; an empty `dependencies: []` loops zero times → clean. So a workflow that genuinely needs a
  marketplace plugin can ship `dependencies: []` + a `# TODO: add plugin hash`, pass every linter, be
  reported lint-clean, then fail on import for a missing plugin. No phase flags the TODO as deploy-blocking.
- **(P3) The custom/no-pattern path is unspecified.** `implement.md:32-34` only covers `new → copy a
  pattern` and `edit-existing → modify the seed`; `analyze.md` can output `pattern: custom` (find.py shows
  real gaps), and there's no instruction for a from-scratch build with no matching pattern — the highest-risk
  path gets the least guidance.
- **(P4, low) Prose drift:** `implement.md:37` hardcodes `version: 0.6.0` vs AGENTS.md §4.4 "(or the
  project's `dsl_version`)"; the edge-ID convention (§4.1) is never stated in any phase prompt; `test.md`
  has no `## Stop` section (breaking the family's uniform terminal contract); SKILL.md/AGENTS.md claim
  upstream-reachability is enforced but `lint_refs.py` does node-exists + field-in-outputs only, no graph
  traversal; `attachmentBlock` ([attachments.ts:155-156](../../apps/builder/server/lib/attachments.ts))
  hardcodes Japanese though the build language is `--primary-lang en`.

**PRF — avoidable latency + render jank on the critical path:**
- **(F1) Linters run sequentially.** `post-turn.ts:127-128` (③ verify) and `report.ts:78-79` (④ report)
  both `for (const l of LINTERS) await runPython(...)` — three cold Python spawns one-after-another, on the
  hot path of every Implement verify + every report. (These are BACKEND subprocesses — NOT gated by the
  015 turn hook, so parallelizing is safe.)
- **(F2) Streaming render is O(n²).** `applyOutput` ([store.ts:226-230](../../apps/builder/web/src/store.ts))
  appends `last.output + text` per `phase:output` fragment, and `Chat.tsx:85` runs `renderMarkdownHtml(output)`
  over the FULL accumulated buffer on every render → a long Analyze/Implement narration makes the chat
  progressively janky.
- **(F3, low) Smaller re-compute:** the 3 linters run TWICE per build (③ verify + ④ report) on the same
  file; `SplitDiffView` re-parses + Myers-word-diffs on every render; `GET /api/tasks/:id` re-reads every
  artifact from disk each call; the diff artifact is recomputed every Implement turn even when unchanged.

## Goals

1. A phase cannot silently emit an if-else workflow that branches wrong (P1) or ship an unresolved
   plugin TODO into a deploy (P2), and the custom/no-pattern path is specified (P3).
2. The prompt family is internally consistent + truthful (P4).
3. The Implement-verify / report linter step runs ~3× faster (F1) and the streaming chat stops getting
   janky on long output (F2) — **with no change to any linter verdict** (behavior-equivalent).

## Non-goals (deferred to backlog — keep 017 at M)

- **The real upstream-reachability linter** (a graph-BFS pass in `lint_refs.py` + full corpus
  re-validation) — its own follow-up; 017 only corrects the prose over-claim (P4), it does not build the
  checker.
- **The cross-phase lint cache** (reuse ③'s codes in ④ when the file is unchanged) — a correctness-bearing
  cache on `Task`; deferred. F1 (parallelize) is the cheap win; F3's "twice per build" stays.
- **Server-side SSE coalescing** of `phase:output` — F2 is fixed client-side (memo/coalesce); the server
  change is deferred.
- No new gate variants, no state-machine change, no security/hook change.

## Design

### Part A — PRM

**D1 — if-else `cases[]` check (THE risky one; corpus-gated).** Extend `_validate_ifelse_node` to also
validate `cases[]` when present: each case has an `id`, a `logical_operator`, non-empty `conditions`, and
its `id` matches an outgoing edge `sourceHandle`. **CRITICAL — do not regress the 14 corpus files:** accept
**legacy-only `conditions`**, **modern-only `cases`**, OR **both** (today's nesting is `cases[].conditions`).
Make a missing/empty `cases` a **warning by default**, not a hard error, unless corpus re-validation proves
every tracked if-else file already carries a coherent `cases` (Open Q1). **Mandatory gate:** run
`validate_workflow.py` over all 14 if-else YAMLs (+ the 66-file corpus) before/after — zero new failures.
Add a validator unit test (legacy-only passes, both passes, an incoherent `cases` warns/errors per Q1).

**D2 — plugin-TODO deploy gate (advisory).** Detect a workflow whose node types need a marketplace plugin
but ships `dependencies: []` + a `# TODO: add plugin hash`, and surface an `unresolved_plugin_todo` note in
`report.json` (test.md ④). It is **advisory** — it must NOT flip `lintClean` (coordinate with 013/014's
gate so it never blocks a `none` build) — but for `selfhost`/`cloud` it warns before import. Keeps the
documented `dependencies: [] + # TODO` authoring convention working (Open Q2: warning vs hard block on deploy).

**D3 — custom/no-pattern Implement path.** Add a third bullet to `implement.md` step 4: for a from-scratch
build with `pattern: custom`, start from the `templates/_base` skeleton (or the closest pattern as a
structural seed) and enumerate the mandatory scaffolding (start node, end node, `version`, `dependencies`,
edges) so a custom build can't omit required structure.

**D4 — prose batch (each XS, no checker):** `implement.md` uses the project `dsl_version` (not literal
`0.6.0`); state the edge-ID convention (§4.1) in `implement.md`; add a `## Stop` section to `test.md`;
correct the upstream-reachability over-claim in SKILL.md/AGENTS.md to what `lint_refs.py` actually checks;
`attachmentBlock` emits English by default (matches `--primary-lang en`).

### Part B — PRF (behavior-preserving)

**D5 — parallelize the linters.** In `post-turn.ts` and `report.ts`, replace the `for…await` loop with
`Promise.all(LINTERS.map(l => runPython(...)))`, collecting the exit codes into the same keyed
`lintCodes`/`lint` maps afterwards. **Behavior-equivalence is load-bearing** (these codes gate ③ still-failing
and ④ Import — AC #20/#25): add a golden test asserting the per-linter exit codes + the reason order are
identical to the sequential version. ~3 cold spawns → ~1 spawn's wall-clock.

**D6 — memoize the streaming render.** `useMemo` `renderMarkdownHtml(output)` on the `output` string in
the Disclosure (Chat.tsx:85) so it re-renders at most once per stable buffer, and coalesce `applyOutput`
fragments within an animation frame before reassigning `thread.value`. Byte-identical HTML; just not
recomputed on every unrelated render.

**D7 — small re-compute trims (low, include the safe subset):** `SplitDiffView` — `useMemo` the parse on
`file.diff`; diff artifact — short-circuit the recompute when `main.yml` is unchanged. (GET artifact caching
+ the cross-phase lint cache stay deferred — they border load-bearing paths.)

## Behavior — what changes after 017 is done

- **A wrong if-else is caught, not shipped.** Today a node with a malformed `cases` lints clean and then
  branches wrong in Dify; after D1 the validator flags it (warning or error per Q1) at Implement, so the
  build doesn't silently produce a workflow that runs the wrong branch.
- **A missing plugin is surfaced before deploy.** A workflow that needs a marketplace plugin but left
  `dependencies: []` now carries an `unresolved_plugin_todo` note in the report — so a selfhost/cloud user
  sees "this needs a plugin hash" *before* the import fails, instead of after.
- **A from-scratch build has a recipe.** When no pattern fits, Implement now follows the `_base` skeleton +
  the mandatory-structure checklist instead of improvising — fewer invalid graphs on the highest-risk path.
- **Builds feel faster.** The Implement-verify lint step (and the ④ report) finish in roughly a third of the
  time (3 linters in parallel), and a long streaming Analyze/Implement narration no longer makes the chat
  janky as it grows. **The verdicts are identical** — nothing about pass/fail changes, only the speed.
- **The prompts read true.** `version` follows the project's `dsl_version`, `test.md` ends with `## Stop`
  like the rest, the reachability claim matches what the linter actually does, and the attachment block is
  English by default.

## Open questions — RESOLVED

> **Corpus-count correction.** The "14 if-else files / 66-file corpus" in the draft counted a repo-wide
> `grep -rl "type: if-else"` (incl. `.md` + `skills/` fixtures). The CI-gated corpus is the **pre-commit
> pattern** `templates/{patterns,probes}/*.yml + projects/*/workflows/*.yml` = **27 files, of which 2 are
> if-else** (both `eiken` main/main_v2). All 27 pass before AND after D1 (the gate). `skills/` if-else files
> are NOT gate-relevant (the hook excludes `skills/`); the 5 that fail today (Tomatio13/lazeyliu fixtures)
> already failed pre-017.

- **Q1 (D1, the decisive one) — `cases` warning vs error? → SPLIT.** The corpus settled it: a green
  legacy-only file is intentionally kept (`skills/mango-svip/assets/conditional_workflow.yml` has only
  legacy `conditions`, no `cases`, and passes today). So a **MISSING `cases` is a WARNING** (don't regress
  it) and a **PRESENT-but-incoherent `cases` is an ERROR** (`cases: []`, a case with empty/missing
  `conditions`, or a case missing `id`/`case_id` — no green corpus file is in that state). A missing
  `logical_operator` and a case that routes to no outgoing edge are advisory WARNINGS.
- **Q2 (D2) — plugin-TODO: warning, or a deploy hard-block? → ADVISORY note.** `report.unresolved_plugin_todo`
  + a note; it NEVER flips `lintClean` and never blocks a build. Detection is textual (the documented
  `dependencies: [] + # TODO …plugin…hash` marker), so no node-type→needs-plugin signal is required. A
  deploy-time hard block stays a follow-up.
- **Q3 (D5) — acceptance bar for "faster". → Behavior-equivalence is the hard gate.** The 3 linters run via
  `Promise.all` and are folded in `LINTERS` order, so the keyed exit codes + the reason/note ORDER are
  identical to the sequential loop (golden test in `linters.test.ts`). "≈⅓ the lint wall-clock" is the soft
  target (3 cold spawns → ~1). `linters.test.ts`'s former invocation-ORDER assertion was relaxed to a SET
  comparison (completion order is racy under parallelism and not part of the contract).
- **Q4 (D6) — memo granularity. → Full-buffer `useMemo`** on `output` in the Disclosure, plus a safe
  rAF coalescer in `applyOutput` whose invariant is "`applyTask` flushes the buffer FIRST" so no fragment
  is lost at the run→gate boundary (pinned in `store.test.ts`).

## Acceptance criteria

1. **D1:** `validate_workflow.py` validates `cases[]` coherence; **all 14 if-else corpus YAMLs + the 66-file
   corpus still pass with zero new failures** (the gate); a malformed `cases` is flagged (warn/error per Q1);
   validator unit test added.
2. **D2:** a needs-plugin workflow with `dependencies: []` + `# TODO` produces an `unresolved_plugin_todo`
   note in `report.json` and does NOT flip `lintClean` / block a `none` build.
3. **D3/D4:** `implement.md` has the custom/no-pattern path + the project-`dsl_version` + edge-ID convention;
   `test.md` has `## Stop`; the reachability over-claim is corrected; `attachmentBlock` is English-default.
4. **D5:** the 3 linters run via `Promise.all` in ③ verify + ④ report; a golden test proves the per-linter
   exit codes + reason order are byte-identical to the sequential version (AC #20/#25 unbroken).
5. **D6/D7:** the Disclosure memoizes the markdown render (no recompute on unrelated renders);
   `SplitDiffView` memoizes its parse; the diff artifact short-circuits when unchanged.
6. `npm run typecheck` + `npm test` (server + web) + the python validator/corpus checks + CI green;
   013–016 acceptance unbroken; no linter VERDICT changed (only speed).

## References

- This session's audit (PRM + PRF clusters) + the re-sizing on current code (workflow `wdu12n91i`): P1–P4
  + F1–F3 verified; seed-guard already fixed by 015 D4 → dropped; the real reachability linter + cross-phase
  lint cache deferred to backlog.
- Code: [validate_workflow.py](../../skills/mango-svip/scripts/validate_workflow.py) (`_validate_ifelse_node`) ·
  [lint_plugin_hashes.py](../../tools/dify_base/lint_plugin_hashes.py) · [lint_refs.py](../../tools/dify_base/lint_refs.py) ·
  [implement.md](../../.claude/skills/dify-build/implement.md) / [test.md](../../.claude/skills/dify-build/test.md) ·
  [linters.ts](../../apps/builder/server/lib/linters.ts) (013) · [post-turn.ts](../../apps/builder/server/lib/post-turn.ts) ·
  [report.ts](../../apps/builder/server/lib/report.ts) · [store.ts](../../apps/builder/web/src/store.ts) /
  [Chat.tsx](../../apps/builder/web/src/components/Chat.tsx) · [attachments.ts](../../apps/builder/server/lib/attachments.ts).
