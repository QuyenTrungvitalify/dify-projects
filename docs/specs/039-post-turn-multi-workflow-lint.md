# Spec 039 — Post-turn lint completeness: gate every workflow YAML the turn touched

**Status**: Implemented (2026-07-06, same day as authored — see r3). Small, surgical, backend-only (~30 lines
in `post-turn.ts` + a variant-resolution touch in `orchestrator.ts` + tests), with a 5-regex pre-commit widening
as an in-scope companion (D6). D1–D7 locked; two OQs parked with defaults. No new deps, no Dify contact, no
gate-FSM change, no permission-hook change. Implemented S1→S3 failing-test-first; one implementation addition
recorded in r3 (`gitDirtyPaths -uall`).

> **Reference the SYMBOL, not the line.** Line links below were verified 2026-07-06; re-grep before editing.

**Builds on**:
- [030](030-builder-nested-project-workflow-folders.md) — the per-workflow-subtree confinement
  ([030:59](030-builder-nested-project-workflow-folders.md#L59)) that widened the writable-but-unlinted surface;
  030 delegates `projects/` policing to post-turn's confinement ([030:68](030-builder-nested-project-workflow-folders.md#L68)
  — boundary policing; it says nothing about linting inside the subtree). **Load-bearing**: 039 extends that
  delegation to in-subtree correctness.
- [013](013-builder-linter-contract-and-test-seams.md) — `linters.ts` as the SINGLE linter contract ([linters.ts:26-30](../../apps/builder/server/lib/linters.ts#L26-L30));
  039 reuses `LINTERS`/`lintClean` verbatim, adding a file dimension only in `PostTurnDetail`, never in `LintCodes`.
- [015](015-builder-security-turn-sandbox.md)/018 — the PreToolUse allowlist hook. Its blanket `projects/` allow
  ([permission-gate.ts:247](../../apps/builder/server/hooks/permission-gate.ts#L247)) stays **byte-unchanged** (D7).
- [020](020-builder-graph-reachability-linter.md) — the warn-only→measure→promote rollout precedent. 039 deliberately
  does **not** use it (see D6 rationale): it runs already-promoted linters over files with zero legitimate producers,
  so the false-positive surface is empty by construction.
- [032](032-builder-live-workflow-test.md) — *(sibling, composes)*: the live-test `deploy.yml` is written to
  `apps/builder/.runs/<taskId>/deploy.yml` ([live-test.ts:199](../../apps/builder/server/lib/live-test.ts#L199)),
  **outside** `workflows/`, so 039's scan never sees it — no collision. If 032 OQ3 (model-empty emit) ever spawns a
  spec that writes alternate files under `workflows/`, 039 gates them automatically — compose, not collide.
- [036](036-builder-capability-aware-test-targets.md) — *(sibling, not a prerequisite)*: FE composer + test-target
  machinery, zero overlap with the ③ correctness pass.

**Depends on**: nothing new. No new external deps, no new Dify contact, no gate-FSM change, no change to the three
python linters themselves (D3 keeps them single-file-per-spawn), no hook change.

---

## Context — why one linted file is not a gate

The ③ post-turn gate is a three-layer alignment failure. Confirmed directly:

- [permission-gate.ts:247](../../apps/builder/server/hooks/permission-gate.ts#L247) — `if (p.startsWith('projects/')) return false;`
  — the hook allows **any** `projects/` write mid-turn, by design ("cross-project caught post-turn").
- [post-turn.ts:194](../../apps/builder/server/lib/post-turn.ts#L194) — `confinementCheck` whitelists the **entire**
  `projects/<project>/<workflowSlug>/` subtree (spec 030 §2, by design).
- [post-turn.ts:93](../../apps/builder/server/lib/post-turn.ts#L93) — but the correctness pass inspects exactly **ONE**
  path: `const rel = \`projects/${p.project}/${p.workflowSlug}/workflows/${p.workflowFile}\``. The YAML probe
  ([post-turn.ts:112](../../apps/builder/server/lib/post-turn.ts#L112)), the 3 linters
  ([post-turn.ts:136](../../apps/builder/server/lib/post-turn.ts#L136)), and the node-id regex
  ([post-turn.ts:156](../../apps/builder/server/lib/post-turn.ts#L156)) all run on that single `rel`.

So a turn that writes a sibling `workflows/extra.yml` — or a `main.yaml` **extension twin** of the declared
`main.yml` — ships with zero lint, zero yaml-parse check, zero `idsOk`. The exact needed set already exists:
`turnTouched` ([post-turn.ts:190](../../apps/builder/server/lib/post-turn.ts#L190)) — but the breach loop
([post-turn.ts:203-207](../../apps/builder/server/lib/post-turn.ts#L203-L207)) acts only on NON-whitelisted paths and
silently drops the clean in-whitelist touched list.

The twin is uniquely dangerous downstream: `isValidWorkflowFile` legally accepts `.yaml`
([task.ts:268-270](../../apps/builder/server/state/task.ts#L268-L270)), yet 5 of the 6 pre-commit DSL hooks match
`\.yml$` only ([.pre-commit-config.yaml:58](../../.pre-commit-config.yaml#L58),
[:72](../../.pre-commit-config.yaml#L72), [:81](../../.pre-commit-config.yaml#L81),
[:98](../../.pre-commit-config.yaml#L98), [:107](../../.pre-commit-config.yaml#L107) — only the relaxed yamllint at
[:50](../../.pre-commit-config.yaml#L50) uses `\.ya?ml$`). And ④ push (`sync.py push --file workflows/<workflowFile>`)
pushes only the canonical file — the twin ships to git as an unvalidated look-alike a human or a future turn may
treat as canonical.

## Design decisions

- **D1 · Enumerate from `confinementCheck`'s own delta; run confinement FIRST (locked).** `confinementCheck` changes
  its return from `string[]` to `{ breaches: string[]; touched: string[] }` where `touched` = the in-whitelist
  survivors of `turnTouched` (breaches excluded — they were just reverted). `postTurnCheck` reorders: confinement
  (revert) runs **before** the correctness pass, so the lint set can never include a path that is about to be
  reverted, and there is no second `git status` spawn racing the reverts. The **surfaced `reasons` order stays
  byte-identical** — confinement-breach reasons are still appended LAST, after correctness reasons (execution order
  changes; assembly order does not). Renames count as touched via `parsePorcelainPath`'s new-name behavior
  ([post-turn.ts:228-235](../../apps/builder/server/lib/post-turn.ts#L228-L235), pinned by `porcelain.test.ts`).
  tsc flags the one other caller, the ①/② verify spread at
  [orchestrator.ts:521](../../apps/builder/server/lib/orchestrator.ts#L521) (`...breaches`), and
  `confinement.test.ts` destructures `.breaches` — assertions otherwise unchanged. **Types pinned**: `breaches`
  stays the FORMATTED reason strings exactly as returned today (`confinement breach (reverted): <path>`), while
  `touched` is raw repo-relative paths — the asymmetry is deliberate so the `confinement.test.ts` assertions and
  the :521 spread are byte-unchanged. **A rejected alternative**
  (recorded so it isn't re-litigated): recompute `gitDirtyPaths` inside `postTurnCheck` after confinement — one extra
  spawn, and two independent deltas that can drift; the explicit `{breaches, touched}` contract is the single source.
- **D2 · Scope = turn-touched `workflows/*.ya?ml` only, mirroring pre-commit (locked).** The lint set is
  `touched.filter(p → p startsWith \`projects/<project>/<workflowSlug>/workflows/\` && /\.ya?ml$/)`, minus the
  declared `rel`. Spec 030's workflow tier legitimately contains `tests/`, `inputs/`, `prompts/`, `SPEC.md`
  ([030:165](030-builder-nested-project-workflow-folders.md#L165)) — YAML fixtures there are NOT Dify DSL and would
  false-fail the 3 linters; they stay confinement-only. Project-level YAML (`envs/`, `.dify-workspace.yaml`) is a
  non-issue post-030: outside the whitelist, already reverted as breaches. **Rejected**: whole-subtree lint (fixture
  false-positives) and hook-level per-file deny (the hook knows only `BUILDER_TASK_ID`, not
  project/workflowSlug/workflowFile — per-file deny needs new env plumbing through `claude-session.ts` and would
  foreclose the multi-file futures `isValidWorkflowFile` and pre-commit already anticipate).
- **D3 · Full same gate per extra file, one spawn per (linter, file) (locked).** Each extra file gets exactly the
  declared file's treatment: YAML probe → the 3 `LINTERS` → `^\d{13}(start)?$` idsOk. **Never batch argv**:
  `validate_workflow.py` reads `sys.argv[1]` only and SILENTLY ignores extras
  ([validate_workflow.py:347](../../tools/dify_base/validate_workflow.py#L347)); `lint_refs.py` /
  `lint_plugin_hashes.py` loop argv but collapse exit codes to max/1
  ([lint_refs.py:423-435](../../tools/dify_base/lint_refs.py#L423-L435),
  [lint_plugin_hashes.py:44-49](../../tools/dify_base/lint_plugin_hashes.py#L44-L49)), losing per-file attribution.
  Per-file spawns reuse the D5-017 `Promise.all` pattern; results fold in sorted-path order, each file's reasons in
  probe→`LINTERS`-order→ids order, all AFTER the declared file's reasons — deterministic despite concurrency.
- **D4 · Extension twin = hard error, stem-relative to the task's OWN `workflowFile` (locked).** A twin is a touched
  file sitting DIRECTLY in `workflows/` (same directory as the declared file — a nested same-stem file like
  `workflows/sub/main.yaml` is an ordinary extra per D3, not a twin; pinned by AC 2c) whose stem equals
  `workflowFile`'s stem with the other `.ya?ml` extension — covering BOTH
  directions (declared `main.yml` / twin `main.yaml`, and the reverse), never hardcoding `main.yml`
  (the default at [task.ts:342](../../apps/builder/server/state/task.ts#L342) is just a default; `.yaml` is legal per
  [task.ts:268-270](../../apps/builder/server/state/task.ts#L268-L270)). A twin produces a dedicated `reasons` entry
  (`extension twin of <workflowFile>: <path>`) and forces the hard-error variant **even if its lint is clean** — two
  canonical-looking artifacts is a correctness ambiguity, not a lint fix-up. The twin is still fully linted (diagnostic
  value). **Rejected**: auto-rename (which one is authoritative? content may differ) and revert (destroys inspectable
  work; the parked gate + Request-changes is the recovery path).
- **D5 · Additive `PostTurnDetail.extraFiles`; primary fields byte-unchanged (locked).** `LintCodes` stays
  per-linter with no file dimension ([linters.ts:33](../../apps/builder/server/lib/linters.ts#L33)). New:
  `extraFiles: { path: string; yamlOk: boolean; lintCodes: LintCodes | null; idsOk: boolean; twin: boolean }[]`
  (`[]` when the turn touched only the declared file — the universal case today). The ③ variant resolve
  ([orchestrator.ts:462-471](../../apps/builder/server/lib/orchestrator.ts#L462-L471)) extends symmetrically:
  `hardError |= extraFiles.some(f → !f.yamlOk || f.twin)` (a missing/empty extra reports `yamlOk: false` +
  `lintCodes: null` — §2 — so it folds to hard error like a missing declared artifact); `success` additionally requires
  `extraFiles.every(f → lintClean(f.lintCodes) && f.idsOk)`; anything else parks at `still_failing`. Existing
  consumers of `lintClean(d.lintCodes)`/`idsOk` (verifyPhase, advance-loop) read the SAME primary-artifact fields.
- **D6 · Pre-commit regex widening is IN scope (locked).** Widen the five `\.yml$` DSL-hook regexes
  ([.pre-commit-config.yaml:58](../../.pre-commit-config.yaml#L58), [:72](../../.pre-commit-config.yaml#L72),
  [:81](../../.pre-commit-config.yaml#L81), [:98](../../.pre-commit-config.yaml#L98),
  [:107](../../.pre-commit-config.yaml#L107)) to `\.ya?ml` — BOTH occurrences per line, see §4. A builder-only fix
  leaves the manual-commit path open; the change is ~5 chars × 2 × 5 lines. Verified 2026-07-06
  (`git ls-files '*.yaml'`): **no existing tracked file newly matches** — the full `*.yaml` inventory is
  `.pre-commit-config.yaml` itself, `examples/md_en2ja/.dify-workspace.yaml`, and the project-level
  `.dify-workspace.yaml` manifests (at `projects/*/` and `templates/_base/project/`), all outside both regex halves —
  so `pre-commit run --all-files` stays green. No 020-style warn-only phase: these are
  already-promoted checks gaining files that have no legitimate producer today; a warn-only lap would only delay
  closing a gate bypass.
- **D7 · ④ report/import path unchanged (locked).** `runReport` keeps linting only the declared file: it has no
  baseline `Set` at report time, so it structurally cannot compute a turn delta — and Import is gated on a clean ③,
  where every extra already passed the full gate. Stated honestly: ③ and ④ are no longer file-set-identical — the
  `linters.test.ts` identity pin's header comment is reworded to "identical per-file contract on the DECLARED
  artifact" (the test itself passes unchanged — its fixture has no extras). The hook's blanket `projects/` allow
  ([permission-gate.ts:239-252](../../apps/builder/server/hooks/permission-gate.ts#L239-L252)) also stays
  byte-unchanged: post-turn remains the load-bearing gate, exactly as 030:68 assigned.

## Design

### §1 · Enumeration (post-turn.ts)

`confinementCheck` → `{ breaches, touched }` (D1). `postTurnCheck` body reorders to: (b) CONFINEMENT (revert) →
(a) CORRECTNESS on the declared `rel` → (a′) CORRECTNESS on `extras`, where

```
extras = touched
  .filter(p => p.startsWith(`projects/${project}/${workflowSlug}/workflows/`) && /\.ya?ml$/.test(p))
  .filter(p => p !== rel)
  .sort()
```

`reasons` assembly order (byte-compatible): declared-file reasons (existing order, pinned by `linters.test.ts` D5) →
per-extra-file reasons (sorted path; probe → `LINTERS` order → ids within a file; each prefixed with the path) →
twin reason(s) → confinement breach reasons LAST (as today, [post-turn.ts:163-164](../../apps/builder/server/lib/post-turn.ts#L163-L164)).

### §2 · Per-file gate (D3) + twin (D4)

Each extra mirrors the declared-file contract EXACTLY ([post-turn.ts:98-158](../../apps/builder/server/lib/post-turn.ts#L98-L158)):
stat first — a missing/empty extra (a turn-deleted tracked file is still turn-touched) gets its own reason and
`lintCodes: null`, `yamlOk: false` (→ hard error per D5); when size > 0, the probe AND the 3 linters ALL run — the
linters are gated on size, not on the probe result, exactly like the declared file at
[post-turn.ts:130-136](../../apps/builder/server/lib/post-turn.ts#L130-L136), so a probe-failing extra is still fully
linted. Per size-positive extra: `runPython(-c YAML_PROBE, path)` → 3 × `runPython(lint.script, path)` (`Promise.all`,
one file per spawn) → idsOk regex. Twin test (D4): `dirname(path) === dirname(rel)` (directly in `workflows/` —
nested `workflows/sub/main.yaml` is an ordinary extra) `&& stem(basename(path)) === stem(workflowFile) &&
basename(path) !== workflowFile`, where `stem` strips the final `.ya?ml` extension. Zero extra spawns when `extras`
is empty — the happy path today.

### §3 · Detail + gate variant (D5)

`PostTurnDetail` gains `extraFiles` (shape above). The ③ resolve at
[orchestrator.ts:462-471](../../apps/builder/server/lib/orchestrator.ts#L462-L471) folds extras into
hard-error/success/still_failing as D5 specifies. Everything is additive; a single-file turn produces
`extraFiles: []` and byte-identical behavior.

### §4 · Pre-commit companion (D6)

Each of the five `files:` regexes is `^(templates/(patterns|probes|library)/.*\.yml|projects/.*/workflows/.*\.yml)$`
— TWO `\.yml` occurrences per line (one per alternation half), and the line ends `\.yml)$` (group close), not a bare
`\.yml$`. Widen BOTH occurrences in each line to `\.ya?ml` (the line then ends `\.ya?ml)$`); the
`templates/(patterns|probes|library)/` half widens too — harmless, verified no matches. yamllint
([:50](../../.pre-commit-config.yaml#L50)) already matches `.yaml`.

## Goals

1. Every turn-touched `projects/<p>/<wf>/workflows/*.ya?ml` receives the FULL ③ gate (probe + 3 linters + idsOk) —
   enforced structurally from the confinement delta, not by trusting the turn to declare its outputs.
2. An extension twin of the declared workflow file **hard-errors** the turn (parked gate), in both extension
   directions.
3. A same-stem-free, lint-clean extra workflow file does NOT block success — multi-file futures stay open.
4. A committed `main.yaml` twin can no longer bypass the DSL pre-commit hooks.
5. Zero behavior change (byte-identical reasons, codes, variants) for every turn that touches only its declared file.

## Non-goals

- **No** hook-level per-file deny (D2) — the hook lacks project/slug/file context; post-turn stays the load-bearing
  gate per [030:68](030-builder-nested-project-workflow-folders.md#L68).
- **No** lint of subtree YAML outside `workflows/` (tests/inputs/prompts fixtures) — confinement-only (D2, OQ1).
- **No** ④ report multi-file re-scan (D7) — no baseline exists at report time; the asymmetry is named, not hidden.
- **No** auto-rename / auto-repair of the twin, and **no** multi-attempt repair loop — the parked gate +
  Request-changes is the recovery path (D4).
- **No** change to the three python linters (no argv batching, no multi-file exit-code protocol) (D3).
- **No** 020-style warn-only rollout phase (D6 rationale).

## Acceptance criteria

1. **Extra file fully gated** *(S1/S2, `apps/builder/test/post-turn-multi-lint.test.ts`)*: in a real tmp git repo
   (the `confinement.test.ts` `makeRepo` pattern) with the S1 EXTENDED shim (same `LINT_RECORD`/`LINT_FAIL` env
   contract, but records `<script> <file>` per invocation including the `-c` probe, and `LINT_FAIL` accepts
   `script:file` keys — see S1; the stock `linters.test.ts` shim records the script path only and cannot support
   per-file assertions), a turn-touched `workflows/extra.yml` beside the declared `main.yml` → the shim record
   contains the YAML probe AND all 3 `LINTERS` scripts **for `extra.yml`'s path**; forcing `lint_refs.py` to fail on
   `extra.yml` alone (a `script:file` `LINT_FAIL` key) yields ③ variant-resolve outcome `still_failing` (asserted at
   the layer AC 2 names) with a reason containing `extra.yml`.
   - 1b. **Anti-gaming — per-file argv attribution**: the record must show each linter invoked with `extra.yml` as its
     own single file argument (one spawn per (linter, file)). A batched-argv implementation
     (`validate_workflow.py a.yml extra.yml`) would pass a naive "script ran" assertion while never validating
     `extra.yml` ([validate_workflow.py:347](../../tools/dify_base/validate_workflow.py#L347) ignores argv[2+]) —
     this sub-test fails it.
   - 1c. **`.yaml` extension**: same as 1 with `extra.yaml` — proves the `\.ya?ml$` filter, not a `.yml`-only match.
2. **Twin hard error, both directions** *(same file)*: declared `main.yml` + lint-clean touched `main.yaml` →
   ③ variant-resolve outcome `error` (hard variant, not `still_failing`) with `detail.extraFiles[i].twin === true`
   and a reason naming the twin; AND declared `main.yaml` + touched `main.yml` → same. Proves stem-relative
   detection, not a hardcoded `main.yml`-vs-`main.yaml` pair. Do NOT assert `PostTurnResult.status` here — it is
   `'error'` for ANY failure ([post-turn.ts:58-63](../../apps/builder/server/lib/post-turn.ts#L58-L63)) and cannot
   distinguish hard from `still_failing`. **Layer**: the hard/still_failing/success split lives in the unexported ③
   resolve ([orchestrator.ts:462-471](../../apps/builder/server/lib/orchestrator.ts#L462-L471)); the test reaches it
   EITHER by injecting the REAL `postTurnCheck` via `ctx.runners` (`resolveRunners`, 013 D2 — the
   `advance-loop.test.ts` seam) and driving the Implement phase, OR by S2 extracting the D5 fold into a small
   exported pure helper unit-tested directly — implementer's choice; ACs 1/2/2b/2c all assert at this layer.
   - 2b. **Anti-gaming — no blanket ban**: a lint-clean, ids-clean, non-twin `extra.yml` yields `outcome: success`
     (variant resolve) — proves the mechanism lints rather than rejecting every sibling, which a "treat any extra as a
     breach" shortcut would fail.
   - 2c. **Nested same-stem is NOT a twin**: a touched `workflows/sub/main.yaml` under declared `main.yml` is an
     ordinary extra (linted per AC 1, `twin: false`, no hard error) — pins D4's directly-in-`workflows/` twin scope.
3. **Baseline exclusion** *(same file)*: a `workflows/old.yml` already dirty in the `baseline` Set is ABSENT from the
   shim record — proves enumeration is the turn delta, not a `readdir(workflows/)` glob (which would lint baseline
   files and fail this).
4. **Ordering + revert-before-lint** *(same file + existing suites)*: an out-of-whitelist breach is still reverted and
   its reason still appears AFTER all correctness reasons; the reverted path never appears in the shim lint record
   (defense-in-depth only: a breach is by definition OUTSIDE the whitelist while the D2 filter prefix is inside it,
   so this clause is structurally unreachable via the lint record — it guards a future filter-prefix regression, and
   does NOT pin D1's breaches-excluded-from-`touched` contract). `confinement.test.ts` passes with only the
   mechanical `.breaches` destructure; `linters.test.ts` D5 order tests and `post-turn-ids.test.ts` pass
   **unchanged**.
5. **Fixture exemption** *(same file)*: a turn-touched `tests/fixture.yml` inside the subtree is absent from the lint
   record (D2) — whitelisted by confinement, untouched by lint.
6. **Detail shape** *(same file)*: `detail.extraFiles` carries one entry per extra with per-file `lintCodes` + `idsOk`
   + `twin`; a probe-failing extra still shows all 3 linters in the shim record (linters gate on size, not `yamlOk` —
   §2) and its `yamlOk: false` yields variant-resolve `error` per D5; for a single-file turn `extraFiles` deep-equals
   `[]` and `lintCodes`/`idsOk` are byte-identical to pre-039 (pinned by the unchanged existing suites in AC 4).
7. **Pre-commit widening** *(S3, manual + CI)*: the five `files:` regexes at
   [:58](../../.pre-commit-config.yaml#L58)/[:72](../../.pre-commit-config.yaml#L72)/[:81](../../.pre-commit-config.yaml#L81)/[:98](../../.pre-commit-config.yaml#L98)/[:107](../../.pre-commit-config.yaml#L107)
   carry `\.ya?ml` at BOTH occurrences per line (each line ends `\.ya?ml)$` — not a bare `\.ya?ml$`, see §4);
   `pre-commit run --all-files` stays green (verified: no existing tracked file newly matches); a spot-check
   `pre-commit run check-jsonschema --files <tmp projects/x/y/workflows/main.yaml>` shows the hook MATCHED (not
   "no files to check").
8. **④ unchanged** *(existing `linters.test.ts`)*: the cross-consumer identity test passes unchanged (declared-artifact
   contract); only its header comment gains the D7 rewording.

## Sequencing (each landed step compiles + tests green; additive, existing paths byte-unchanged)

- **S1 · Failing tests first (red, observed — not committed).** Author
  `apps/builder/test/post-turn-multi-lint.test.ts` covering ACs 1–6 against the UNMODIFIED `post-turn.ts` and observe
  the new assertions fail (today the extra file records zero linter invocations and the twin sails through). That red
  run is the proof the tests bite. Harness: the `confinement.test.ts` real-tmp-git-repo pattern, plus the new file's
  OWN extended copy of the `linters.test.ts` shim — the stock shim
  ([linters.test.ts:63-76](../../apps/builder/test/linters.test.ts#L63-L76)) records only the script path (`"$1"`,
  never the file argument), records nothing in its `-c` probe branch, and keys `LINT_FAIL` on script name alone, so
  the per-file assertions in ACs 1/1b/3/5 are impossible with it. The extended copy records `<script> <file>` per
  invocation (linter branch: `"$1 $2"`; a record line added in the `-c` probe branch with ITS file arg, `"$3"`) and
  additionally accepts `script:file` keys in `LINT_FAIL` for per-file failure injection. `linters.test.ts` and its
  shim stay byte-unchanged, so the pinned suites stay green.
- **S2 · Backend mechanism (lands together with S1, green).** `confinementCheck` → `{breaches, touched}` + the two
  caller updates ([orchestrator.ts:521](../../apps/builder/server/lib/orchestrator.ts#L521) spread,
  `confinement.test.ts` destructure); reorder `postTurnCheck` (D1); extras loop (D3) + twin (D4);
  `PostTurnDetail.extraFiles` + variant resolve (D5); reword the `linters.test.ts` header comment (D7). Full suite
  green: new file + `linters.test.ts` / `post-turn-ids.test.ts` / `confinement.test.ts` / `porcelain.test.ts`.
- **S3 · Pre-commit + docs.** Widen the five regexes (D6), `pre-commit run --all-files` green, the AC 7 spot-check.
  Docs: one line in AGENTS.md (③ gate now lints every turn-touched `workflows/*.ya?ml`; extension twin = hard error),
  a line in the builder README, and a one-line reader note in
  [030](030-builder-nested-project-workflow-folders.md) §Structural confinement pointing here (retro-annotation, part
  of the slice, not a to-do).

## Biggest risks (+ mitigations)

1. **Reordering confinement before correctness perturbs observable output** → mitigated by decoupling execution order
   from `reasons` assembly order (D1): breach reasons still append last; pinned by `linters.test.ts` D5 order tests +
   `confinement.test.ts` passing unchanged (AC 4).
2. **Spawn-count blowup** — worst case 4 spawns × N extras → mitigated: N = 0 on every legitimate turn today (zero
   added spawns on the happy path); extras run `Promise.all` per file mirroring D5-017.
3. **Foreclosing legitimate multi-file workflows** → mitigated by D3+D4: extras get the same gate, not a ban; only the
   extension twin hard-errors — and that is an ambiguity, not a capability.
4. **Pre-commit widening breaks unrelated commits** → mitigated: verified 2026-07-06 that no tracked `*.yaml` matches
   the widened halves; AC 7 re-proves it at land time with `--all-files`.

## Open questions

- **OQ1 (D2)** — should subtree YAML outside `workflows/` (tests/inputs fixtures) get at least a `yaml.safe_load`
  truncation probe? Default: no — confinement-only, mirroring pre-commit's DSL scoping; revisit on the first real
  corrupted-fixture incident.
- **OQ2 (D4/D5)** — once a legitimate multi-file producer exists, should the UI surface per-extra-file lint results
  (today they appear only as path-prefixed gate reasons)? Default: reasons-only until a producer exists; the
  `extraFiles` detail field already carries the structure a future UI needs.
- **OQ3 (post-implement review, 2026-07-06) — the multi-turn escape.** Turn 1 writes a BAD `extra.yml` → gate
  parks with the extra's failure reason; a `/reply` turn 2 that fixes ONLY `main.yml` and never touches
  `extra.yml` sees it in its own baseline (dirty since turn 1) → `extras = []` → the gate resolves success while
  the known-bad extra still sits on disk. This is a DIRECT consequence of AC 3's turn-delta enumeration (the
  alternative — a `readdir` glob — would lint baseline-dirty files that are not ours to judge, exactly what AC 3
  forbids). Mitigations today: the human SAW the extra's failure at the turn-1 gate, and pre-commit (D6) still
  gates the file at commit time. If this bites in practice, the fix shape is: persist the extras list from the
  prior verify in task state and re-lint the union on subsequent verifies of the same task. Related note: the
  `\.ya?ml$` filter is lowercase-only, matching `isValidWorkflowFile` and the pre-commit regexes — an
  `extra.YAML` is not swept (unchanged from pre-039; the whole toolchain is lowercase-extension).

## Revision log

- r1 (2026-07-06) — initial draft (authored via multi-agent analysis).
- r2 (2026-07-06) — adversarial-review fixes: S1/AC 1 now name the EXTENDED per-file shim (stock shim can't attribute
  files); AC 1/2 assert at the ③ variant-resolve layer with a named harness (runners injection or extracted D5
  helper); D1 pins `breaches` = formatted reason strings vs `touched` = raw paths; D4/§2 scope the twin to directly
  in `workflows/` (+ AC 2c); §2 pins the extra-file stat/probe edge contract (+ AC 6 clause); D6 `*.yaml` inventory
  completed; §4/AC 7 regex wording corrected (both `\.yml` occurrences, `\.ya?ml)$` line end); AC 4 breach-record
  clause marked defense-in-depth; 030-delegation bullet softened. No Decision intent changed.
- r3 (2026-07-06) — IMPLEMENTED (S1 red-first → S2 → S3; 12 tests in
  `apps/builder/test/post-turn-multi-lint.test.ts`, full server suite 347/347, pre-commit all-files green).
  AC 2's layer implemented via the exported-pure-helper option: `resolveImplementOutcome(detail, turnNote)` in
  `orchestrator.ts`. One addition the spec missed: `gitDirtyPaths` now passes `-uall` — default porcelain
  collapses a NEW untracked directory to one `dir/` entry, which hid a nested `workflows/sub/x.yaml` from the
  D2 filter (caught by AC 2c's red run); baseline and after are captured by the same function, so the
  delta semantics are unchanged, and breach reverts gain per-file granularity as a side effect.
