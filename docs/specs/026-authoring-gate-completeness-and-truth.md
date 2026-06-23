# Spec 026 — Authoring-gate completeness & residual truth gaps (post-024)

**Status**: Draft
**Effort**: S (umbrella — per-item effort in the table)
**Depends on**: [020](020-builder-graph-reachability-linter.md) (reachability is a hard gate; this closes the *sibling* gap it left — ref **targets** are checked, node **ids** are not), [024](024-reality-reconciliation-and-cross-cutting-gaps.md) (the reality-reconciliation pass; this is its narrow follow-up — the two gaps 024's doc-sweep did not own, plus the one cheap robustness hole)

> **Thesis.** 024 made the repo's *claims* match its *code*. A focused re-check of the **authoring gates themselves** then found three small things 024 did not cover, because they are not doc-drift — they are *the gate not gating the thing the repo says matters most*: (1) the repo's own **#1 silent-failure class** (non-numeric node IDs) is enforced by **no gate**; (2) the JSON-Schema gate is **envelope-only** while the docs still headline "29 NodeData types", implying a depth it does not have; and (3) the structural validator **stack-traces** on malformed input instead of failing as a gate should. None is a feature. This spec closes exactly the **XS "tighten + subtract + tell the truth" set** — and nothing more. The two genuinely *additive* candidates (read-side sandbox confinement, wiring real node-body validation) are **explicitly deferred** with their trigger conditions stated, so the umbrella cannot bloat.
>
> **The bar (user's words):** *tối ưu, hiệu quả nhất, nhưng không phình to.* Every item here makes the repo **smaller or stricter or more honest** — never larger. The additive forks are in §"Considered & deliberately NOT done", with the precise trigger that would make each worth doing.

## Context — what 024 closed, and the seam it left

024 reconciled docs↔code and shut the cheap real gaps (CI-red, schema-dump honesty, deps, hook fail-closed). It was, by design, a *doc/honesty* pass over the corpus reshuffle. It did **not** re-audit the **DSL-authoring gates** (`validate_workflow.py`, the JSON Schema, `lint_refs.py`) for *completeness*, because that was not the drift it was chasing. This spec is that audit's result. Three findings:

1. **The node-ID gate that does not exist.** [AGENTS.md §9 pitfall 2026-05-21](../../AGENTS.md) records the failure verbatim: a string node ID (`node-code-1`) makes `{{#node-code-1.text#}}` render as a **literal string at runtime — no error, no warning**. The repo calls this its #1 silent-failure class. Yet [`lint_refs.py:25`](../../tools/dify_base/lint_refs.py) `REF_PATTERN` accepts `[A-Za-z0-9_-]+` (it **must** — `sys`/`env`/`conversation` ref namespaces are non-numeric), and [`validate_workflow.py`](../../skills/mango-svip/scripts/validate_workflow.py) never checks `nodes[].id` format. **Verified:** a workflow whose nodes use `node-code-1` IDs and whose refs match passes *both* tools with exit 0. The convention (`generate_id.py`, the builder) prevents this on the happy path; nothing **enforces** it, and it has bitten once already.

2. **The "29 NodeData" guarantee that isn't one (024 Q-A, decided here for the lean half).** The committed schema [`schemas/dify-dsl-0.6.0.json`](../../schemas/dify-dsl-0.6.0.json) carries 29 `NodeData_*` defs, but **zero `$ref`s point to them**: `Node.data` validates as `{ "type": "object", "required": ["type"], "properties": { "type": {"type": "string"} } }` — any node body passes `check-jsonschema`. Meanwhile [README.md:12](../../README.md), [README.md:86](../../README.md), and [architecture.md:101](../architecture.md) headline "**29 NodeData types**" as a schema feature, and [`test_docs_drift.py`](../../tests/test_docs_drift.py) *pins that count* — reinforcing the implication that 29 node bodies are validated. They are not. This is the repo's "no guarantee dressed as a guarantee" value, unmet.

3. **The gate that crashes instead of failing.** [`validate_workflow.py:150-162`](../../skills/mango-svip/scripts/validate_workflow.py) (edge loop) and the node loop at `:109-110` call `.get()` on entries without an `isinstance(..., dict)` guard — even though the *same file* already guards exactly this in the `edge_handles` loop at [`:96-98`](../../skills/mango-svip/scripts/validate_workflow.py). **Verified:** a non-dict edge entry produces a raw `AttributeError` traceback, not a validation error. A hard gate must fail with a diagnostic.

Plus one residual doc contradiction 024's own sweep missed (so R0's drift test didn't catch it): [README.md:46](../../README.md) says "Runs **12** hooks" (correct), but [README.md:213](../../README.md) still says "**9** hooks … + 5 built-in" — the list predates `agents-md-refs`, `dify-lint-refs`, `dify-lint-plugin-hashes`.

## Goals

1. **Close the #1 silent-failure class with a real gate** — non-numeric `nodes[].id` is caught by an authoring gate, with one test pinning both directions.
2. **Make the schema's depth claim honest** — no current doc implies node-body validation the gate does not perform; the drift test pins the *honest* wording, not just the count.
3. **A gate fails like a gate** — malformed graph input yields a structured validation error, never a stack trace.
4. **Stay strictly subtractive/neutral** — every change makes the repo smaller, stricter, or more truthful. No new subsystem, no rollout machinery, no corpus blast-radius. Additive forks are deferred, not silently dropped.

## Non-goals (the leanness boundary — what keeps this from phình)

- **No wiring of real node-body validation** (the 024 Q-A `oneOf`/discriminator path). That has corpus blast-radius (46 corpus + 7 templates + ~20 projects) and needs the O1/020 three-phase warn→measure→gate discipline — *exactly* the bloat the user is guarding against. Deferred as **fork F-B**; D1 here only stops the *claim*, keeping the option open.
- **No read-side sandbox confinement** for the builder turn-hook. Real but additive (~40 LOC + tuning risk) and defensible to defer for single-user localhost. Deferred as **fork F-A** with its trigger stated.
- **No re-spec of 009–024**; done stays done.
- **No new gate beyond N1**, no new linter, no corpus changes, no schema *content* fix (the `http_request` stub stays the tracked, honest `_error` from 024 S1).

## No-disruption discipline (carried over from 019 §3 / 024)

1. **N1 ships warn-first if measurement isn't clean.** During implementation, enumerate `graph.nodes[].id` across all committed files the gate covers (`templates/{patterns,probes,library}/*.yml` + `projects/*/workflows/*.yml`). Pre-measurement signal is **clean** (the only non-numeric `id:` values in committed YAML are *case ids* like `'true'` and *env-var ids* like `env-lt-apikey`, neither of which is a graph node id — which is precisely why the check lives in the node loop, not in a blanket regex). If a legitimate non-numeric node id surfaces, ship N1 as a **warning**, not an error, and record the exception.
2. **Behavior change → one test before merge** (N1, V1 each land with a pinning test).
3. **Docs-only items** (D1, D2) ship green under the extended `test_docs_drift.py`; the drift test is **widened** so the corrected claims can't silently rot.
4. **L1 is gated** on `tsc` green before & after — and only the *known* dead imports are removed in this PR; if `noUnusedLocals` surfaces broader fallout, that fallout is split to a follow-up rather than fixed under this umbrella.

## Design — the triage (the deliverable)

**Priority:** **P1** correctness/truth (the spec's core) · **P2** lean polish (do if cheap) · **fork** = additive, decide separately. **Disrupt:** 🟢 none/subtractive · 🟡 touches a live gate, +1 test.

| id | Item | Why it matters | How (fix approach) | Effort | Disrupt | Priority |
|---|---|---|---|---|---|---|
| **N1** | Node-ID format **ungated** | Repo's self-declared #1 silent-failure class (string id → ref renders literal at runtime, no error). `REF_PATTERN` can't enforce it (must accept `sys`/`env`); `validate_workflow` doesn't. Verified: `node-code-1` passes both tools exit 0. | In [`validate_workflow.py`](../../skills/mango-svip/scripts/validate_workflow.py) node loop (after `:110`, where `node_id` is read), assert the id matches `^\d+(start)?$` (numeric, plus the documented container-start child `<id>start`, AGENTS §4.1). Error by default; warning if §discipline-1 measurement isn't clean. | XS | 🟡 | **P1** |
| **D1** | "29 NodeData" implies depth the gate lacks | Schema is envelope-only (29 defs, 0 `$ref` from `Node.data`); docs headline the count as a feature; drift test pins the count → compounds the implication. "Guarantee dressed as a guarantee." | Reword [README.md:12](../../README.md), [README.md:86](../../README.md), [architecture.md:101](../architecture.md): "29 generated NodeData reference defs (envelope-validated; node bodies **not** schema-enforced — see fork F-B)". Re-aim the drift assertion at the *honest* wording, keeping the count pin. **Do not** delete the defs (keeps F-B cheap). | XS | 🟢 | **P1** |
| **V1** | Validator **crashes** on malformed graph | `validate_workflow.py` node/edge loops `.get()` without `isinstance(dict)` guard (the `edge_handles` loop at `:96-98` already has it). Non-dict entry → raw `AttributeError`, not a validation error. A hard gate must diagnose, not crash. | Mirror the existing `:97` guard into the node loop (`:109`) and edge loop (`:150`): non-dict entry → structured error + `continue`. | XS | 🟡 | **P1** |
| **D2** | README hook count **12 vs 9** (024 missed) | [README.md:46](../../README.md) "12 hooks" (correct) contradicts [README.md:213](../../README.md) "9 hooks … + 5 built-in"; the list omits `agents-md-refs`, `dify-lint-refs`, `dify-lint-plugin-hashes`. R0's drift test doesn't cover hook count, so it can re-rot. | Fix `:213` to 12 and list the 3 missing hooks; extend [`test_docs_drift.py`](../../tests/test_docs_drift.py) to assert README hook-count == number of hook `id:`s in [.pre-commit-config.yaml](../../.pre-commit-config.yaml). | XS | 🟢 | **P1** |
| **L1** | Builder dead imports + blind typecheck | [orchestrator.ts:17-18,34](../../apps/builder/server/lib/orchestrator.ts) import `existsSync`, `copyFile/mkdir/readdir/rename/rm/rmdir`, `sanitizeSlug` — all unused (spec-019 extraction residue). `tsconfig.json` lacks `noUnusedLocals`, so `tsc` can't see them. Cuts against the LEAN value. | Delete the dead imports; turn on `noUnusedLocals`/`noUnusedParameters` in [apps/builder/tsconfig.json](../../apps/builder/tsconfig.json). If the flags surface only these, fix in-PR; if broader, split the rest to a follow-up (discipline §4). | XS↔S | 🟢 | **P2** |

### Sequencing (Bước)

```
Bước 1  P1 · 🟢/🟡 one PR : N1 (+test) · V1 (+test) · D1 (docs+drift) · D2 (docs+drift)
Bước 2  P2 · 🟢 if cheap  : L1 (dead imports + noUnusedLocals; split fallout if any)
fork    decide separately : F-A (read-confinement) · F-B (schema oneOf)
```

Bước 1 is the whole point: it closes the #1 silent-failure class, makes the validator fail like a gate, and makes the schema/hook claims honest — all XS, all subtractive-or-stricter, one small PR (~30 LOC + 3–4 tests + 3 doc lines; **no schema regen** since the schema content is unchanged).

## Considered & deliberately NOT done (the lean discipline, made visible)

| Candidate | Why it's tempting | Why excluded (and the trigger that would change that) |
|---|---|---|
| **F-A — Read-side turn confinement** (builder hook is allowlist on writes, deny-list on reads; `cat /etc/hosts`, `Read` outside repo, `Grep /etc` all allow) | Closes a real info-disclosure asymmetry vs the hook's own "default-deny" philosophy | Additive (~40 LOC + tests) with **false-deny tuning risk** (must allowlist every dir a phase legitimately reads or it bricks builds — discipline "fail-closed must not false-refuse"). For **single-user localhost** the headline threats (token exfil, `.venv` RCE, network) are already blocked; 024 judged 015/018 complete for this model. **Trigger to do it:** the builder ever runs **untrusted seeds/images**, or is **exposed beyond localhost**. Until then, a one-line "known limitation" note in the builder README is the honest minimum. |
| **F-B — Wire real node-body validation** (024 Q-A path a: `data.type`-discriminated `oneOf` → the 29 defs) | Makes D1's claim *true*, not just honest; adds real depth + IDE autocomplete | This is **the bloat the user is guarding against**: M effort, **corpus blast-radius** (46+7+~20 files re-validated against possibly-stricter generated schemas), and it needs O1/020's full warn→measure→gate rollout. **Trigger to do it:** hand-authoring YAML in VS Code becomes a primary path and node-body validation/autocomplete is genuinely wanted. It then deserves **its own spec** with the 3-phase discipline — not this umbrella. D1 keeps the defs so this stays cheap to pick up. |
| Delete the 29 dead `$defs` outright (the other Q-A half) | ~7700 fewer lines; pure subtraction | Would make F-B more expensive to ever adopt (regenerate the wiring from scratch). D1's honesty reword captures the *truth* win at zero option-cost; the byte win isn't worth foreclosing F-B. Revisit only if F-B is formally rejected. |
| Fix the `http_request` schema stub | Removes the one `_error` | Tracked + honest since 024 S1; and while the schema is envelope-only (D1) a fixed def validates nothing. Couple it to F-B if/when that happens. |
| Tighten `REF_PATTERN` to numeric | "Looks like the same fix as N1" | **Wrong layer** — refs legitimately target `sys`/`env`/`conversation` (non-numeric) and edge ids are `<src>-source-<tgt>-target`. Node-id format belongs only in the node-definition loop. |

## Open questions

- **Q1 (N1 severity).** Ship the node-id check as **error** (default — measurement is clean) or **warning**? *Recommend:* error, with the discipline-§1 fallback to warning if implementation-time measurement finds a legitimate non-numeric node id.
- **Q2 (F-A timing).** Add the "known limitation" read-confinement note to the builder README now (cheap honesty), or wait until a trigger? *Recommend:* add the one-line note now; do the code only on trigger.
- **Q3 (process).** Close Bước 1+2 as one "026" changelog, no per-item specs? *Recommend:* yes (024 Q-C precedent). Only F-B, if taken, earns a follow-up spec.

## Acceptance criteria

1. **N1** — a workflow whose `graph.nodes[].id` is non-numeric (e.g. `node-code-1`) **fails** `validate_workflow.py` (or warns, per Q1) with a clear message; numeric ids and the `<id>start` container-child form pass. A test in [`test_validate_workflow.py`](../../tests/test_validate_workflow.py) pins both directions.
2. **D1** — no current doc (README/architecture) claims or implies node-body schema validation; the wording states envelope-only + 29 reference defs. `test_docs_drift.py` asserts the honest phrasing (not merely the count) and is green.
3. **V1** — a malformed graph (non-dict node or edge entry) yields a structured validation error and exit 1, **not** an `AttributeError` traceback; a negative-input test pins it.
4. **D2** — README states 12 hooks consistently and lists them; `test_docs_drift.py` asserts README hook-count == hook-`id` count in `.pre-commit-config.yaml`.
5. **L1** (if taken) — the named dead imports are gone; `npm run typecheck` is green with `noUnusedLocals`/`noUnusedParameters` on (or any broader fallout is split to a tracked follow-up); server + web suites green.
6. **No regression** — `pre-commit run --all-files` exits 0 on `main`; `pytest tests/` green; builder CI green. Forks F-A/F-B may be deferred without blocking 026.

## References

- Re-evaluation session 2026-06-23 (this repo), four-front review — the authoring-core pass surfaced N1/V1/D1; the corpus/docs pass surfaced D2; the builder pass surfaced L1 and fork F-A.
- [AGENTS.md §9 pitfall 2026-05-21](../../AGENTS.md) — the string-node-id silent failure N1 gates.
- [020](020-builder-graph-reachability-linter.md) — ref-**target** reachability gate; N1 is the ref-**source** (node-id) sibling it didn't cover.
- [024 §Q-A + Open Questions](024-reality-reconciliation-and-cross-cutting-gaps.md) — the schema-depth fork; D1 takes its lean (honesty) half, F-B carries the additive half.

## Revision log

- 2026-06-23 — initial draft. Scope: the three authoring-gate completeness gaps 024's doc-sweep didn't own (N1 node-id gate, V1 validator crash, D1 schema-depth honesty) + the one residual doc contradiction (D2 hook count) + one P2 lean cleanup (L1). The two additive candidates (F-A read-confinement, F-B schema oneOf) deliberately deferred with explicit triggers to keep the umbrella subtractive. Numbered 026 (025 taken by builder-file-attachments).
- 2026-06-23 — **implemented** (N1, V1, D1, D2, L1). Verified each claim against code first (line refs, regex, schema shape, doc contradictions, dead imports), then reproduced the two crux gaps empirically (string-id workflow passed both gates at exit 0; non-dict edge stack-traced). N1 shipped as **error** (Q1) — measurement clean: 0 non-numeric graph-node ids across 29 committed files / 165 nodes. Tightened beyond the table on three cheap points: V1 also guards **non-list** `nodes`/`edges` (not just non-dict entries); D1 drift test pins the **honest wording** (`envelope` + "not enforced") across README **and** architecture.md, not just the count; D2 drift test **parses** `.pre-commit-config.yaml` (`hooks[]`) instead of grepping `id:` lines. L1 turned on both `noUnusedLocals` **and** `noUnusedParameters` — surfaced only 2 extra dead-code findings (artifacts.ts `stat`, tasks.ts cancel-handler `task`), both fixed in-PR per discipline §4.
- 2026-06-23 — **durability finding (not in the original spec) + resolution.** N1/V1 target `validate_workflow.py`, which lives in the **gitignored, read-only `skills/mango-svip` clone** (AGENTS.md §"never edit skills/"). Upstream `mango-svip/dify-workflow-skills@main` carries **neither** N1/V1 **nor even spec-017's `cases[]`** — the whole 96-line customization was uncommitted local-only edits a fresh `setup.sh` clone (CI) would not have, so the tracked validator tests were latently CI-fragile. **Resolution (user-approved): vendored** the customized validator to tracked **`tools/dify_base/validate_workflow.py`** (alongside `lint_refs.py`/`lint_plugin_hashes.py`), rescuing both 017 and 026, and repointed the **CI-enforced execution paths**: the `dify-skill-validate` pre-commit hook + `tests/test_validate_workflow.py` + `tests/test_meta_builder_codenode.py`. **Deferred follow-up (lean boundary):** the builder still invokes the skill-clone copy via `linters.ts` + `permission-gate.ts` allowlist + the `.claude/skills/dify-build/{implement,test}.md` / `template-promote` phase prompts, and ~16 instructional-doc lines (GUIDE/README/project & template READMEs) still cite the skill path. Repointing those is a clean, separable PR (keep the two copies in sync until then) — folding it in here would balloon to ~20 files, against this spec's "không phình to" bar.
- 2026-06-23 — **deferred follow-up now completed** (user-approved: *"fix luôn đi để test 1 thể"* — the deferral above was overridden). Repointed **every** remaining `validate_workflow.py` caller to the vendored canonical in one mechanical path-string sweep — 16 tracked files, no logic change, so it corrects a source-of-truth split rather than adding weight (not "phình"): builder runtime (`linters.ts` registry = the authoritative **backend-run** ③/④ gate via `report.ts`/`post-turn.ts`; `permission-gate.ts` `ALLOWED_PYTHON_SCRIPTS`) + their pinning tests (`linters.test.ts`, `permission-gate.test.ts`) + the turn phase prompts (`.claude/skills/dify-build/{implement,test}.md`, `template-promote/SKILL.md`) + the authoritative/instructional docs (AGENTS.md, README.md, docs/GUIDE.md, docs/architecture.md, templates/_base + examples + the two kept-project READMEs). The gitignored skill copy is now **fully decoupled** — no more manual sync burden; the only residual skill ref is the canonical file's own provenance header + the §9 bare-name pitfall. `generate_id.py` stays in the skill clone by design (no local customizations needing durability — the asymmetry is intentional). Gates after the sweep: `pytest` 100 passed/2 skipped · `pre-commit run --all-files` 12/12 (incl. `agents-md-refs`) · builder typecheck clean + 188 tests pass. The gitignored throwaway project READMEs (`llm_gpt`, `dify_mode_workflow_2`) were left untouched (regenerable; not committed).
