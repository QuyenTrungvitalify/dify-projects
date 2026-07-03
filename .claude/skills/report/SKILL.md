---
name: report
description: Evaluate a Builder run against its REQUIREMENT (and the corpus ground truth as a secondary check). Use when the user types "/report #N" (N = a test number from manifest.json), "/report <slug>", or "/report <taskId>". Reads BOTH the artifacts AND the per-phase process transcripts, re-runs the validators (does NOT trust report.json), traces phase-to-phase consistency, grades the result against requirement-derived acceptance criteria, and honestly separates what is verified statically from what needs a live run.
---

# /report — corpus-test evaluator for Builder runs

Answers per run: **"At each phase, what did the Builder do (process + output), does it meet the requirement, is the result good — or does it need work?"** Prompts + grading data live in [manifest.json](manifest.json); each test maps to a `Workflow-Store` ground-truth file.

## Three non-negotiable principles

**1. Grade against the REQUIREMENT, not the ground-truth file.** The yardstick is `must_do` (acceptance criteria derived from the prompt). The store `ground_truth`/`expected_nodes` are a **secondary sanity reference only** — never the target. A correct lean build that doesn't clone the (often over-engineered) store file must score WELL. Differences in `allow_diff` are EXPECTED and never count against the builder. Only a missing `must_do` is a genuine miss.

**2. Read the PROCESS, not just the output.** Each phase persists a Claude session transcript (the actual tool calls, retries, errors, and reasoning). The artifact is *what* a phase produced; the transcript is *how*. Always read both (Step 3). The transcript catches things the artifact hides — e.g. a phase that claims "clean, one pass" but actually fixed errors mid-run, or a phase that skipped a required step. It also **prevents false accusations**: an oddity in the artifact (a linter run 3×) is often explained innocently by the transcript (a chained command the harness rejected, re-run plainly).

**3. The honesty contract — two tiers, never blurred.** A YAML tells you what a workflow is *designed* to do, not what it *does* when run.
- **Tier 1 — Static (always, reliable):** per-phase process + output, requirement-fit, validity, fidelity-vs-ground-truth. Answers *"built right?"*
- **Tier 2 — Runtime (manual spot-check):** does it actually produce good output? Needs a live run. Default builds are `deploy=none` with an empty `model` ⇒ not runnable as-is, so Tier 2 is **almost always `NOT VERIFIED`** until the user fills the model, imports, runs the `sample_input`, and pastes the output back. **Never infer Tier-2 from Tier-1.**

## Argument forms

- `/report #N` — manifest test N; find the run whose `task.json.requirement` **exactly equals** `prompt_jp`; full evaluation (most recent matching run).
- `/report #N <taskId>` — pin the exact run dir.
- `/report <slug>` / `/report <taskId>` — that run; ground-truth + must_do only if its requirement matches a manifest entry, else Tier-1 + process only.
- `/report #N output: <pasted runtime output>` — Tier-2 grading follow-up (Step 7).
- `/report` (no arg) — most recent run under `apps/builder/.runs/`.

## Step 1 — Resolve the run

Run dirs: `apps/builder/.runs/<taskId>/` — each has `task.json` (index: `requirement`, `slug`, `phase`, `status`, `deploy`, `artifacts{}`, `sessionIds{}`, `analysisPattern`, `analysisFeatures`), plus `analyze.json`, `diff.json`, `report.json`. For `#N`: read manifest entry N, glob `apps/builder/.runs/*/task.json`, keep those whose `requirement === prompt_jp`, pick the highest `taskId`. None → tell the user *"Chưa thấy run cho prompt #N (`<prompt_jp>`). Chạy trong Builder rồi /report lại."* and STOP. If `status != done`, report only the phases that exist and name the missing ones.

## Step 2 — Read the artifacts (the chat text is a claim; files are evidence)

From disk: `analyze.json`, `SPEC.md`, the implemented YAML, `diff.json`, `report.json`, `task.json`, and (for `#N`) `corpus/awesome-dify-workflow-en/Workflow-Store/<ground_truth>`.

## Step 3 — Read the PROCESS of each phase (MANDATORY)

Run the trace extractor (from repo root) — it maps `task.json.sessionIds` → each phase's transcript and emits the tool-call sequence, bash commands, file writes/reads, tool errors, and procedure checks:
```
.venv/bin/python .claude/skills/report/trace_phases.py <taskId>
```
(add `--full` to get full bash commands + final texts when you need to dig into an anomaly). Phase ④ (test) is backend-run — no transcript; verify it by re-running the validators (Step 4).

From the trace, establish **per phase**:
- **Did it follow the dify-build procedure?** ① Analyze must NOT write any workflow file (`checks.touched_workflow_file` false). ② Spec must consult the pattern library before choosing (`checks.searched_patterns` true) and must NOT mint IDs or write YAML. ③ Implement must mint IDs via `generate_id.py` (`checks.ran_generate_id`) and run all three validators (`ran_validate`/`ran_lint_refs`/`ran_lint_plugin_hashes`).
- **Triage every error — count them, quote them verbatim.** State the EXACT number of `is_error` results per phase (don't enumerate "a X and a Y" if the trace has four). Classify each into: **harness rejection** (`shell metacharacter` on a chained/piped command, `dangerous executable: find`, a `File does not exist` probe), **parallel-batch cancellation** (`Cancelled: parallel tool call …` — collateral when a sibling in the same batch was rejected; benign), or **REAL problem** (a validator that exited non-zero and was then patched, a fabrication, a failed write). When you name the failing command/flag, **copy the literal string from the `--full` trace — never paraphrase or abbreviate it** (writing `--complexity Simp` when the trace says `--complexity simple` is a fabrication; the actual cause there is a case mismatch against the enum `Simple/Medium/Complex`, not a "typo"). Repeated validator runs are usually a chained command rejected then re-run individually — confirm with `--full` before reporting a phase as "fixed errors mid-run." `trace_phases.py` now emits a **`class`** and the **`command`** for every error — **echo that `class` label verbatim**; do not re-characterize freehand (don't call a `find`/`grep`/`ls` rejection "chained" when the classifier says `redirect`/`pipe`/`unclassified`). **Do not report benign rejections as defects, do not under-count, and do not let a real mid-run fix hide behind a clean final claim.**
- **Does the transcript corroborate the phase's final claim?** e.g. Implement saying "lint clean, one pass" must match the actual bash exit codes in the trace.

## Step 4 — Re-run validators + extract structure facts (trust nothing, count nothing by hand)

Don't copy `report.json`'s lint block — reproduce it from repo root:
```
.venv/bin/python tools/dify_base/validate_workflow.py    projects/<slug>/workflows/<file>
.venv/bin/python tools/dify_base/lint_refs.py            projects/<slug>/workflows/<file>
.venv/bin/python tools/dify_base/lint_plugin_hashes.py   projects/<slug>/workflows/<file>
```
Record each exit code. **A disagreement with `report.json.lint` is a finding.**

Then extract the structure/runnability facts mechanically (don't hand-count nodes or eyeball code imports — that's where large-workflow reports silently err). Pass the ground-truth path too for an automatic histogram delta:
```
.venv/bin/python .claude/skills/report/report_structure.py projects/<slug>/workflows/<file> "corpus/awesome-dify-workflow-en/Workflow-Store/<ground_truth>"
```
Use its output verbatim for: the node histogram + `histogram_delta` + `mode_match` (Step 5.5), each model-bearing node's `model_empty` (`model_nodes` covers `llm` + `parameter-extractor` + `question-classifier` — a workflow whose only model node is an extractor/classifier is still non-runnable when empty), each code node's `nonstdlib_imports`/`sandbox_trap` (the §4.5 trap — e.g. #8 matplotlib), and `runnable_blockers` (Step 6). Re-derive `unresolved_plugin_todo` from `dependencies.empty` + `has_todo_marker`.

**If the run parked at `still_failing` (status `awaiting_confirm`, gate flag `still_failing`): diagnose the ACTUAL cause — never assume.** `still_failing` = `!lintClean(lintCodes) || !idsOk` ([orchestrator.ts:400](../../../apps/builder/server/lib/orchestrator.ts#L400)); it is **never** the plugin-TODO advisory (that is only a NOTE in `report.json`, which won't even exist when parked at the ③ gate). Reproduce both inputs: (a) the 3 linter exit codes (above) — a non-zero one IS the cause; (b) `idsOk` — every node id must match `/^\d{13}(start)?$/` (pure 13-digit, or an iteration/loop-start child `<id>start`). If linters are 0/0/0, the cause is an id that fails that regex (a hand-written string id, or — pre-fix #9 — a now-accepted `<id>start`). State the reproduced cause; do not label it "plugin-TODO" by assumption.

## Step 5 — Tier 1: grade each phase (process + output), trace the chain

Evaluate the phases **as a chain** — each phase vs the requirement, vs the previous phase (drift), AND vs its own transcript (process). Cite the file/transcript for every claim.

1. **① Analyze.** Process: only wrote `analyze.json`, no workflow file. Output honest? from-scratch ⇒ `seed:null`, empty `nodes/var_flow/plugins`, no invented `find_query`/`change_points`. Does `analysisFeatures`/risks sensibly anticipate the requirement (an iteration-shaped ask should hint more than `["llm"]`)?
2. **② Spec.** Process: searched the pattern library (trace), didn't mint IDs / write YAML. Output: node table covers **every `must_do`**? pattern justified and *reduced* when lean (good) vs over-/under-built? drift from analyze? open questions surfaced?
3. **③ Implement.** Process: minted IDs via `generate_id.py`, ran all three validators (trace); any REAL mid-run fix? Output: YAML realizes the spec's node table **exactly** (node added/dropped silently = drift)? lint verdict (Step 4)? node IDs = 13-digit ms-timestamp **quoted** strings (§4.1)? every `{{#id.field#}}` ref names a declared upstream `outputs` field (§4.2)? runnability blockers: `model.provider/name` empty? sandbox-illegal code node (`matplotlib`/`requests` — §4.5)? unresolved `# TODO` hash?
4. **Requirement-fit (primary verdict).** For each `must_do`: **met / not-met**, citing the node. Bucket: **(a)** met, **(b)** differs-but-allowed (per `allow_diff`), **(c) genuine miss** (a `must_do` the prompt demanded is absent — e.g. #9 no iteration despite "分割して", #11 in workflow mode). Only (c) + validity/runnability defects are real problems.
5. **Structure fidelity (secondary).** Histogram the YAML's node types vs `expected_nodes` and `mode`. Context, not the grade.

## Step 6 — Tier 2: the manual run kit (runtime is manual spot-check)

Builds are `deploy=none`, so /report does NOT auto-run. Determine runnability and emit a ready-to-run kit:
- **Runnable check:** every LLM node's `model.provider/name` non-empty; no unresolved plugin `# TODO`; no sandbox-illegal code node; any external tool/KB available. List every blocker.
- **Emit the kit:** the exact pre-run edits (which `model.provider/name` to set, plugin/KB to install), the import path (`Studio → Import DSL`, or `sync.py push` if `selfhost` creds exist), the manifest **`sample_input`** to paste, the **`expected_signals`** to grade on, and `runtime_note` gotchas (#8 matplotlib trap, #6 needs a KB, #11 needs multi-turn).
- **Verdict:** `RUNTIME: NOT VERIFIED` + the kit. Never fake a runtime result.

## Step 7 — Tier 2 grading follow-up (`/report #N output: …`)

When the user pastes a manual run's output, grade it against that test's `expected_signals` and `must_do`: each signal met/not-met with evidence from the pasted output, then a one-line runtime verdict. Mark it **VERIFIED (manual run)**.

## Step 8 — (optional, `--deep` / high effort) adversarial cross-check

Spawn one subagent to **refute** the Tier-1 verdict: schema fields Dify would reject, refs that lint-pass but break at runtime, silent-break IDs, sandbox-illegal code, or an `allow_diff` applied too generously. Fold confirmed refutations in. One skeptic unless a thorough audit was asked for.

## Step 9 — Output: write the report FILE, then summarize in chat

**Always persist the report to disk** (so a run can be reviewed later without re-deriving). Write TWO files into `.claude/skills/report/reports/` (create it if missing):
- `report-N<N>-<taskId>.md` — the human-readable report card below, verbatim. (For a non-`#N` run, name it `report-<slug>-<taskId>.md`.)
- `report-N<N>-<taskId>.json` — a machine scorecard: `{ taskId, slug, ground_truth, status, phases:{analyze,spec,implement,test:{process_ok, errors_real, note}}, must_do:[{item, verdict}], lint:{validate,lint_refs,lint_plugin_hashes}, runnable:bool, runtime:"NOT VERIFIED|VERIFIED", genuine_misses:[...], verdict }`.

Then in chat: print the report card AND the two file paths. The card (and the `.md` body) has this structure:

- **Header:** `#N · <ground_truth> · run <taskId> · status <…>`.
- **Run status (state this FIRST, never let it hide behind the build verdict):** is the run `done`, or **parked** (`awaiting_confirm` at a gate) needing a user action? These are DIFFERENT from build quality. A build can be high-quality AND still parked — say both explicitly: e.g. "Build quality: PASS — **but the run is PARKED at the ③ implement gate (still_failing); click 「Accept anyway」 to finish; it did NOT auto-complete.**" Never imply a parked run is "done" just because the build is good. If parked, name the exact button/action and (per Step 4) the real gate cause.
- **Per-phase line** (①②③④, ✅/⚠️/❌): **process** (tool-call count, procedure followed?, errors benign vs real) **+ output** (what it produced) + any drift. This is the "có cái nhìn tổng quan về những gì workflow đã làm" answer.
- **Requirement-fit (the headline):** a `must_do` checklist — ✅ met / ⚠️ allowed-diff / ❌ **genuine miss** — each citing the node. The "có đúng yêu cầu không" answer.
- **Validity & lint:** your re-run vs recorded; runnability blockers.
- **Structure vs ground truth:** one line of context (histogram diff), explicitly secondary.
- **Runtime:** `NOT VERIFIED` + the manual run kit, OR (after Step 7) `VERIFIED (manual run)` + result.
- **"What this workflow actually does":** 2–4 lines from the YAML graph (not the SPEC's claims).
- **Process detail (on request / when something is off):** the per-phase tool-call trace (from Step 3) — offer it, and always surface it when a phase had a REAL error or a procedure deviation.
- **Needs-improvement:** only real defects (genuine misses, lint/schema/runnability, dishonest provenance, procedure violations), each with file/transcript evidence + a concrete fix. None → say so plainly.
- **Verdict:** one line, scoped to what was actually verified (pass / pass-with-caveats / needs-rework), explicit that result-quality is unverified until a manual run is graded.

Then update the campaign index `.claude/skills/report/reports/INDEX.md` — fill this test's row (run/slug, per-phase ✅/⚠️/❌, lint, mode, requirement-fit, runtime, verdict). This is the durable one-glance matrix (the per-run `report-N<N>.md/.json` hold the detail).

## Stop

After the report, STOP. `/report` observes and judges; it does not edit the run or re-build unless asked.
