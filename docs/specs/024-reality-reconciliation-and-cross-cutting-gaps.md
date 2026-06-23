# Spec 024 — Reality reconciliation & the cross-cutting gaps (post-022/023)

**Status**: Draft
**Effort**: (meta — umbrella; per-item effort in the tables below)
**Depends on**: [019](019-builder-output-quality-and-lean-roadmap.md) (the lean discipline + the builder items it already discharged — **not** relitigated here), [020](020-builder-graph-reachability-linter.md) (reachability is now a hard gate — the fact that makes several docs stale), [022](022-multi-source-template-library.md) + [023](023-intake-only-sources.md) (the corpus reshuffle that created most of the doc drift below)

> **Thesis (review 2026-06-23).** A full, four-front re-evaluation (authoring core · builder app · corpus/governance · quality infra) found the **engineering meaningfully better than the documentation that describes it**, and the *machine* far more polished than the *output is verified*. Crucially, almost every remaining problem is **not inside any one subsystem** — it is in the seams **between specs**: 019 was builder-scoped, 020 was the reachability linter, 022/023 were corpus-scoped, and the items below are the ones **no spec owned**, so they drifted. This umbrella does exactly one thing: **make the repo's claims match its code, close the two "green-but-broken" cracks, and shut the few genuine guarantee gaps — and nothing more.** It is deliberately a *subtraction/correction* spec, not a feature spec.
>
> **The bar, in the user's words:** *tối ưu, tinh gọn, nhưng chất lượng chuyên nghiệp* — update **only** what is genuinely worth updating. Every candidate was triaged against that bar; the ones that didn't clear it are listed in §"Considered & deliberately NOT done" with the reason, because choosing *not* to act is the lean discipline made visible.

## Context — what changed since 019/020/022/023, and what fell through

019's roadmap is **largely shipped**: O1 reachability landed as a hard gate (020), the orchestrator was extracted 930→494 LOC, `/api/dev/run-implement` was lock-gated, C1–C4 + L4 boot-smoke merged, O2 pattern-persist merged. 022/023 made the corpus registry-driven and went "English-only." Good. But three classes of problem were **created or left open by that very churn**, and none is a 019/020/022/023 follow-up:

1. **Docs now contradict the code and the data** (the largest class). 022/023 moved the corpus and 020 changed the reachability guarantee, but the cross-cutting docs ([README.md](../../README.md), [docs/architecture.md](../architecture.md), [AGENTS.md](../../AGENTS.md), the `corpus-update` skill) were not all repointed. Concrete, verified contradictions are tabled in **R-items** below.
2. **Two "green-but-broken" cracks** — the pre-commit gate **fails on `main`** (committed whitespace defects), and the headline **"English-only corpus" is false in the committed data** (17/26 corpus descriptions in [INDEX.md](../../INDEX.md) are Chinese; 21 of all 46 indexed rows carry CJK somewhere). Both are credibility holes, both are cheap.
3. **A few genuine guarantee gaps that were never any spec's job** — the JSON-Schema gate validates envelope-only while shipping a **broken `http_request` schema under a "25/25" success print**; the meta-builder's own E2E test **runs in no gate**; Python deps drift across **three unpinned lists**; and the permission hook still **fails OPEN** if it can't load (019 L4 chose "warn for v1" — this is the v2 decision).

None of these is a new feature. All of them are "the repo isn't telling the truth, or a gate isn't actually gating."

## Goals

1. **Truth** — every claim in README/architecture/AGENTS/skills matches the code and the committed data, enforced where cheaply possible by the existing drift hooks.
2. **A green, honest gate** — `pre-commit run --all-files` passes on `main`; no gate prints a success metric it didn't earn (`gen_schema` "25/25"); the core promise (generator emits importable YAML) is exercised by *a* gate, not a manual script.
3. **Close the cheap real gaps** — schema-dump failures fatal, deps single-sourced, hook fail-**closed** by default.
4. **Stay ruthlessly lean** — the default verdict for any candidate is *exclude*; inclusion must be justified by a real correctness, security, or credibility cost. The excluded set is documented, not silent.

## Non-goals (the leanness boundary)

- **No new features**, no UI, no multi-user, no model picker.
- **No re-spec of 009–021** — done items stay done; this sits on top.
- **No expansion of the corpus/provenance machinery** — it is over-built for N=1 (one indexed source, one promoted template), but it is *cheap and harmless*; shrinking it is not worth the churn. Left as-is by deliberate choice (see §"Considered & deliberately NOT done").
- **No corpus content translation** — orthogonal and heavy; `/template-promote` is the per-file path and stays the only one.
- **No further security hardening beyond the fail-OPEN→fail-CLOSED flip** — the 015/018 model is complete for single-user localhost; OS-sandbox stays deferred.
- **No mandatory node-body schema validation** in v1 — wiring the dead per-node `$defs` is a *real* but *optional* quality upgrade with corpus blast-radius; it is an **opt-in fork** (Q-A), not a baseline requirement.
- **Not the builder live-run E2E** — that already has a home in [021](021-builder-e2e-live-run-verification.md) (Draft). 024 takes only the **XS down-payment** (T1) and explicitly leaves the rest in 021.

## The no-disruption discipline (binds every code item — carried over from 019 §3)

1. **Docs-only items** (all R-items, G1) ship in one "reconciliation" PR; the [`agents-md-refs`](../../.pre-commit-config.yaml) drift hook + [`test_docs_drift.py`](../../tests/test_docs_drift.py) must stay green, and the drift test is **extended** (R0) so the corrected claims can't silently rot again.
2. **A new/changed check ships warn-only first**, is measured across the live surface (corpus 46 · templates 7 · projects ~20), false positives fixed, **then** gated — applies to the schema fork (Q-A) only; it does not apply to honesty fixes that *remove* a false claim.
3. **Behavior change → one test before merge** (S1, T1, Q1, SEC1 each land with a pinning test).
4. **Pure deletion** (L1) is gated only on `tsc` + the existing suites green before & after.
5. **Fail-closed change (SEC1) must not false-refuse** — mirror the exact runtime invocation; ship behind an explicit escape-hatch env so a legitimately-unusual host can opt out rather than be bricked.

## Design — the triage (this is the deliverable the user asked for)

**Reading the table:** every candidate surfaced by the review is here with its *reason*, *fix approach*, *complexity*, *disruption*, and *priority*. **Disruption:** 🟢 none (docs / deletion / additive) · 🟡 low (touches a live path, +1 test) · 🟠 staged. **Priority:** **P0** stop-the-bleeding · **P1** truth & integrity (the spec's core) · **P2** lean polish (do if cheap) · **fork** = a real decision, see Open Questions · **excl** = deliberately not done.

| id | Item | Why it matters (reason) | How (fix approach) | Effort | Disrupt | Priority |
|---|---|---|---|---|---|---|
| **P0** | CI is **red on `main`** | `pre-commit run --all-files` rewrites 5 committed `docs/specs/*.md` files (`trailing-whitespace`/`end-of-file-fixer`) → CI's `--all-files` step ([ci.yml:50](../../.github/workflows/ci.yml)) fails on a clean checkout. A red `main` erodes every other green signal. | Run `pre-commit run --all-files`, commit the result once. | XS | 🟢 | **P0** |
| **R0** | Drift hooks too shallow to catch the rot below | [`test_docs_drift.py`](../../tests/test_docs_drift.py) has only 3 shallow checks (a *README-only* pattern-count, the *NodeData count* string, an INDEX file-count sanity bound); the contradictions in R1–R4 all slipped past it. | Extend the drift test to assert: pattern-count (README vs disk vs AGENTS/architecture), INDEX file-count vs README "51+", and which nodes carry `_error` in the schema. | S | 🟡 | **P1** |
| **R1** | Pattern count **4 vs 6** | [architecture.md:44,103](../architecture.md) + [AGENTS.md:14,174](../../AGENTS.md) say "**4** patterns"; there are **6** on disk ([README.md:72](../../README.md) correct). Agents reading AGENTS under-discover `file-to-llm`/`meta-workflow-builder`. | Fix the two stale docs to 6; let R0 pin it. | XS | 🟢 | **P1** |
| **R2** | architecture.md **Phase 2.A/2.B = ⏳** but shipped | [architecture.md:105-106](../architecture.md) still marks GitOps sync + pre-commit as planned; both are ✅ in README and live in the tree. The doc is frozen at 2026-05-14 and README links it as authoritative. | Update the two rows to ✅, **or** stamp the doc `STALE — see README roadmap` if it won't be maintained. Recommend update. | XS | 🟢 | **P1** |
| **R3** | README version block **two schemes stale** | [README.md:221](../../README.md) "schema for **v0.1.4** … Dify mainline **v1.14.x**" contradicts the repo's own pins (`.dify-tag=1.13.0`, `.dify-dsl-version=0.6.0`) and README's *own* lines 187/201. | Rewrite to "schema generated at DSL **v0.6.0** from Dify **1.13.0**". | XS | 🟢 | **P1** |
| **R4** | README schema-coverage claim **inverted** | [README.md:201,214](../../README.md): "24/25 … 1 fail: `agent`" + "**fixed** http_request". Reality (verified): `agent` **succeeds**; `http_request` ships **broken** (`_error: SchemaSerializer`). The docs claim the exact opposite of the artifact. | Correct to "25/25 modules import; `http_request` schema-dump fails (tracked S1)". | XS | 🟢 | **P1** |
| **R5** | AGENTS.md §4.2 **understates** the now-gating guarantee | [AGENTS.md:68](../../AGENTS.md) tells agents reachability "does **not** (yet) verify graph reachability … so keeping refs upstream is on you" — but [020](020-builder-graph-reachability-linter.md) made it a **hard gate** (exit 1). Agents are told to do manually what the linter now blocks on. | Rewrite §4.2: reachability **gates by default**; note the one documented exception (intra-container forward refs, `lint_refs` E3 skip). | XS | 🟢 | **P1** |
| **R6** | `corpus-update` skill names a **deleted** source | [SKILL.md:3,33](../../.claude/skills/corpus-update/SKILL.md): "svcvit/Awesome-Dify-Workflow" + sparse "DSL/" — both removed in 023. The skill's own description points at a registry entry that no longer exists; the agent that invokes it is misled. Same stale ref in [GUIDE.md](../GUIDE.md) references section. | Repoint to `Formyselfonly/…-EN` + sparse `Workflow-Store`; fix the GUIDE ref. | XS | 🟢 | **P1** |
| **R7** | README "**51+**" vs INDEX "**46**" | [README.md:8](../../README.md) "51+ template" vs [INDEX.md:3](../../INDEX.md) "46 files indexed" (the 023 prune dropped it). Minor, but it's a number a reader checks. | Change to "46+" or "~46"; R0 pins it. | XS | 🟢 | **P1** |
| **R8** | "**English-only**" is false in the data | 023 + README declare English-only, but the `-en` upstream is an MIT-relicensed fork that **didn't translate bodies**: **17/26** corpus descriptions in INDEX are Chinese (verified — `AdvancedTranslate.yml` → "中译英…", `TitleCreator.yml` → "标题党创作"; 21 of all 46 indexed rows carry CJK somewhere). The headline deliverable of 023 is unmet. | **Honesty path (default, lean):** relabel the corpus everywhere as "multilingual reference (mostly Chinese-described)" — drop "English-only" from 023's status line, README, and the INDEX source-note. The curate-a-real-English-tier path is the **fork Q-B**, not required here. | S | 🟢 | **P1** |
| **S1** | Schema gate prints a **success it didn't earn** | [gen_schema.py](../../schemas/gen_schema.py) swallows per-class dump failures into `_error` and still prints "Imported 25/25" + exits 0, so `http_request` ships broken silently. The gate's success signal is a lie. | Make `schemas_from_module` failures **fatal** (or: print "X/Y schemas dumped OK" separately and exit non-zero if any `_error` present), then fix the `http_request` stub. Regen + commit. | S | 🟡 | **P1** |
| **T1** | Core promise tested by **no gate** | [`test_meta_builder_codenode.py`](../../tests/test_meta_builder_codenode.py) validates the *generator emits importable YAML* — arguably the repo's whole point — but is a `main()/sys.exit` script with **0 collectable `def test_`**, referenced in no CI/pre-commit. | Rename its checks to `def test_*` (drop `main()/sys.exit`) so `pytest tests/` collects it. The artifact it validates already exists. | XS | 🟡 | **P1** |
| **Q1** | Python deps **drift across 3 unpinned lists** | [setup.sh:191](../../scripts/setup.sh), [ci.yml:32](../../.github/workflows/ci.yml), [tests/requirements.txt](../../tests/requirements.txt) declare deps independently, none pinned; a new `pydantic` release can pass CI and break `gen_schema` locally (or vice-versa). Biggest "works-in-CI-breaks-locally" vector; Node side already has `npm ci`. Compounded: the 3 local Python pre-commit hooks call bare `python3` (not `.venv/bin/python`), so they crash on a fresh clone whose system python lacks pyyaml. | Single pinned source of truth (`pyproject.toml` or `uv pip compile` lock) consumed by both `setup.sh` and CI; change the 3 hook `entry:` lines to `.venv/bin/python`. | S | 🟡 | **P1** |
| **SEC1** | Permission hook **fails OPEN** | If the PreToolUse hook can't load (host Node < 22.6, file moved), Claude Code treats no-output as no-decision and runs **unguarded**; 019 L4's boot-smoke only **warns** ("warn-not-fail for v1"). On a misconfigured host the builder runs fully unsandboxed with one log line — the single largest residual security risk. | Boot **refuses to start** when the hook is unloadable, behind an explicit `BUILDER_ALLOW_UNGUARDED=1` escape-hatch (discipline §5: mirror the real invocation so a valid host never false-refuses). | S | 🟠 | **P1** |
| **L1** | Dead `/api/dev/run-implement` | [index.ts:144](../../apps/builder/server/index.ts), **0 code callers** (verified) — a 90-LOC second spawn path duplicating verify logic. Now lock-gated so the invariant is safe, but it's maintenance + a second thing to keep secure. 019 L1 *preferred* deletion but took the gate. | Delete the route + reconcile its 3 doc smoke-endpoint refs in the same PR. | XS | 🟢 | **P2** |
| **G1** | Spec **status taxonomy** inconsistent | [specs/README.md:5](README.md) defines 5 statuses; the index uses **"Implemented"** for 8 specs (013–018, 020, 023) — a 6th, undefined status — and never distinguishes Done / Done† / Implemented. | Add "Implemented" to the legend (or normalize all to "Done"); define the † footnote once. | XS | 🟢 | **P2** |
| **C1** | Builder **comment-prose is load-bearing** | `orchestrator.ts`/`tasks.ts`/`lock.ts` carry 15–40-line doc-blocks per function citing spec IDs no test enforces; a refactor silently rots them. 019 §7 already flagged "spec prose is the heaviest small thing." | Trim to intent-level comments; move spec archaeology to the specs. **Judgment call — only if touching the file anyway.** | S | 🟢 | **P2** |
| **Q-A** | Node-body schema **not validated** (29 dead `$defs`) | The generated per-node schemas are referenced by **zero** `$ref`s; `Node.data` requires only `{type: string}`, so `check-jsonschema` validates envelope shape only. 95% of the schema artifact is decorative — a guarantee gap dressed as a guarantee. | **Fork.** Either (a) wire a `data.type`-discriminated `oneOf` → real node-body validation (M, **warn→measure→gate** per §3.2, fixes `http_request` en route), or (b) accept envelope-only + **delete** the dead `$defs` + state the limit honestly. See Open Questions. | M / XS | 🟠 / 🟢 | **fork** |
| **Q-B** | A *real* English curated tier doesn't exist | `templates/library/` has **1** template; R8's honesty path relabels but doesn't *build* the English resource the workspace wants. | **Fork.** Opportunistically `/template-promote` genuinely-English corpus files into `templates/library/` over time. Not required for 024. | (ongoing) | 🟢 | **fork** |

### Tiers / sequencing (Bước)

```
Bước 0  P0  · 🟢 trivial      : commit the pre-commit whitespace fixes  → CI green
Bước 1  P1 docs · 🟢 one PR    : R0 R1 R2 R3 R4 R5 R6 R7 R8(honesty)    → claims == reality
Bước 2  P1 gates · 🟡/🟠 +test : S1 (schema honest) · T1 (gate the E2E) · Q1 (deps) · SEC1 (fail-closed)
Bước 3  P2 polish · 🟢 if cheap: L1 (delete dead route) · G1 (status legend) · C1 (trim prose, opportunistic)
fork    decide separately     : Q-A (schema oneOf) · Q-B (English library tier)
```

Bước 0+1 alone close **both** credibility cracks and **all** doc contradictions for ~one PR of effort — that is the highest truth-per-byte in the backlog and should land first regardless of whether Bước 2/3 follow.

## Considered & deliberately NOT done (the lean discipline, made visible)

| Candidate | Why it's tempting | Why excluded |
|---|---|---|
| Shrink the provenance/registry machinery (4 files + skill for N=1) | Over-built for current scale | **Cheap and harmless**; the bash/Python dual-parser solves a real bootstrap-ordering constraint, and license-checking pays for itself the moment a 2nd template lands. Churn > benefit. |
| Translate the corpus to English | Would make R8 *true*, not just honest | Heavy, orthogonal, and `/template-promote` already owns per-file English curation (Q-B). |
| Further security hardening (OS sandbox, 015 option B) | Defense in depth | 015/018 is complete for single-user localhost; SEC1 (fail-closed) is the only gap worth closing. |
| Re-spec / re-open 009–021 done items | Tidiness | They're done and verified; re-litigating burns the leanness budget. |
| Builder live-run E2E (import→run→assert on real Dify) | Closes the deepest output gap | **Already owned by [021](021-builder-e2e-live-run-verification.md)** (Draft). 024 takes only the XS T1 down-payment; duplicating 021 here would be spec sprawl. |
| Relax the plugin-hash regex (rejects prerelease/hyphenated/uppercase-hex ids) | Latent false-positive gate | Today's corpus has 4 ids, none trip it. Defer until a real id is rejected — fixing a non-biting gate now is premature. |
| Mandatory node-body validation (force Q-A path a) | Real guarantee | Has corpus blast-radius and adds a staged-rollout cost; made an **opt-in fork**, not a baseline, to honor "tinh gọn". |

## Open questions (the genuine forks)

- **Q-A (schema).** Wire the per-node `$defs` via a `data.type`-discriminated `oneOf` (real node-body validation, M, warn→measure→gate, fixes `http_request`), **or** delete the dead `$defs` and document the gate as envelope-only (XS)? *Recommend:* **decouple from 024.** Ship S1 (stop the lie) in Bước 2 regardless; treat the `oneOf` wiring as its own short follow-up spec only **if** node-body validation is actually wanted — it has the same corpus blast-radius as O1 did and deserves O1's 3-phase discipline, which is more than a reconciliation umbrella should carry. If it is *not* wanted, take the XS delete so the artifact stops implying coverage it lacks.
- **Q-B (corpus).** Relabel-only (R8 default), or also start curating genuinely-English files into `templates/library/`? *Recommend:* relabel now (required); curate opportunistically via `/template-promote` (no deadline, no spec).
- **Q-C (process).** Do Bước 1–3 items get individual AC tracking or close as one "024 reconciliation" changelog? *Recommend:* per-`Bước` changelog entries, **no per-item specs** (the 019 §7 right-sizing). Only Q-A, if taken, earns a follow-up spec.
- **Q-D (R8 scope).** Does relabel touch the historical specs (002/003/020/022 Context) that reference the old corpus? *Recommend:* **no** — those are point-in-time records (the 023 revision log already set this precedent); only *current* docs get reconciled.

## Acceptance criteria

1. **P0** — `pre-commit run --all-files` exits 0 on a clean `main` checkout; CI's `--all-files` step is green.
2. **Bước 1 (truth)** — every R-item contradiction is gone: pattern count = 6 everywhere; architecture.md phases ✅ (or stamped stale); README version block reads v0.6.0/1.13.0; the `http_request`/`agent` claim matches the artifact; AGENTS §4.2 states reachability gates; `corpus-update` skill + GUIDE point at the live source; README count reconciled with INDEX; **no current doc claims "English-only"** (relabeled to multilingual). R0's extended drift test pins pattern-count + index-count + schema-`_error` and is green.
3. **S1** — a schema-dump failure makes `gen_schema.py` exit non-zero (no more "25/25" over a broken dump); `http_request` either dumps clean or is explicitly listed as the one known `_error` in both the script summary and README (consistent).
4. **T1** — `pytest tests/` **collects and runs** the meta-builder generator check (≥1 `def test_*`); it asserts the generated YAML validates.
5. **Q1** — Python deps resolve from **one** pinned source consumed by both `setup.sh` and CI; the 3 local pre-commit hooks invoke `.venv/bin/python`; a fresh-clone bootstrap on a host whose *system* python lacks pyyaml still passes the hooks.
6. **SEC1** — with the permission hook made unloadable, the builder **refuses to start** unless `BUILDER_ALLOW_UNGUARDED=1`; a normally-configured host starts unchanged (no false-refuse); a test pins both branches.
7. **Bước 3 (if taken)** — `/api/dev/run-implement` removed with its doc refs reconciled, suites green; spec-status legend defines every status the index uses.
8. **No regression** — 009–023 acceptance criteria remain satisfied; the §"no-disruption discipline" is what guarantees this. Forks Q-A/Q-B may be deferred without blocking 024.

## References

- Re-evaluation session 2026-06-23 (this repo) — four parallel deep reviews (authoring core · builder · corpus/governance · quality infra), each grounded in file:line evidence and live test runs (`pytest tests/` 80 passed/2 skipped; builder 181 server + 55 web tests green; `pre-commit run --all-files` red on the whitespace hooks). Two headline findings independently re-verified by hand: INDEX has 17 Chinese corpus descriptions (21 of all 46 indexed rows carry CJK somewhere); the whitespace/EOF hooks rewrite 5 committed `docs/specs/*.md`.
- [019 §3 no-disruption discipline](019-builder-output-quality-and-lean-roadmap.md) — the rollout rules carried over here.
- [020](020-builder-graph-reachability-linter.md) — the reachability gate that makes AGENTS §4.2 stale (R5).
- [021](021-builder-e2e-live-run-verification.md) — owns the builder live-run E2E that 024 deliberately does **not** duplicate (only T1 down-payment).
- [023 revision log](023-intake-only-sources.md) — precedent that historical specs keep point-in-time corpus refs (Q-D).

## Revision log

- 2026-06-23 — initial draft. Scope set by the post-022/023 re-evaluation: reconcile docs to reality (R0–R8), close the two green-but-broken cracks (P0, R8, S1), shut the cheap real gaps (T1, Q1, SEC1), and triage everything else to P2/fork/excluded. Forks Q-A (schema oneOf) and Q-B (English library tier) deliberately decoupled to keep the umbrella lean.
