# Spec 022 — Multi-source curated template library (vendored intake + standardized curated tier)

**Status**: Done — **022a (D1–D3) + 022b (D4–D7) implemented 2026-06-22**; all AC met
(Q1–Q6 resolved 2026-06-21 — defaults below)
**Effort**: L
**Depends on**: [003](003-variable-ref-linter.md) (`lint_refs.py` — the baseline that must stay green across all
vendored sources), [007](007-capability-docs-and-patterns.md) (the "capture findings in a LOCAL supplement, never
edit the upstream clone" principle this generalises), plus the in-repo `scripts/setup.sh`, `scripts/update_corpus.sh`,
and `tools/dify_base/build_index.py` that currently hard-code the single corpus source.

> **Why a spec, not a changelog.** This touches the three places that define what counts as a "source"
> (`setup.sh` clone list, `build_index.py` `SCAN_PATHS`, `update_corpus.sh`) and introduces a *second class of
> artifact* — standardized templates derived from upstream — that needs a provenance + staleness contract.
> The blast radius (gitignore rules, lint baseline across N corpora, license redistribution) earns a design pass
> before code.

## Context

Today there is exactly **one** vendored reference source and **one** curated layer:

- `corpus/awesome-dify-workflow/` — a gitignored, read-only, sparse (`DSL/` only) clone of
  `svcvit/Awesome-Dify-Workflow`. Multilingual (often Chinese — the prompt bodies *are* the behaviour) and on
  older DSL versions (0.1.x–0.3.0 vs the project target `0.6.0`). It is **reference only**; per
  [AGENTS.md](../../AGENTS.md) it must never be hand-edited (changes are wiped by `setup.sh` and by
  `update_corpus.sh`'s `reset --hard`).
- `templates/patterns/` — 6 hand-authored, English, DSL-`0.6.0`, tracked patterns. The curated, copy-paste-ready
  layer (highest precedence: `patterns > project > corpus > skill-assets`).

Three frictions block the stated goal — *"a template set that can be updated from multiple sources, not just
awesome-dify-workflow"*:

1. **Sources are hard-coded in two places.** `scripts/setup.sh` (`REPOS`) decides *what to clone*;
   `tools/dify_base/build_index.py` (`SCAN_PATHS:36`) decides *what to index*. Adding a source means editing both,
   and they can silently drift.
2. **No path from raw → standardized.** A good corpus example cannot be promoted into the curated layer in a
   repeatable way (validate → migrate DSL → selective-translate → rename → record where it came from).
3. **No "is it stale?" signal.** Once a corpus example is standardized it forks from upstream; nothing tells you the
   upstream version later changed.

### The core tension (must be designed around, not wished away)

> **"Standardized" and "auto-updatable from upstream" pull in opposite directions.** You cannot `git pull` a house
> style: the moment a file is translated / migrated / renamed it diverges from its origin, so an upstream edit can no
> longer be fast-forwarded in.

The resolution is **two tiers** joined by **provenance**, where the curated tier's "update" is an *assisted
re-promotion triggered by a staleness signal*, never an auto-merge.

| Tier | What it is | How it "updates" |
|---|---|---|
| **Intake** — `corpus/<name>/` | N raw, read-only, sparse clones. Multilingual, mixed DSL versions. Gitignored. | ✅ Automatic — `git fetch`/`reset` per source (`update_corpus.sh --all`). |
| **Curated** — `templates/library/` (new; `patterns/` keeps the 6 canonical archetypes) | Owned, tracked, standardized (English, v0.6.0, house naming). | ⚙️ Assisted *promotion*; a staleness checker flags which to re-promote. |

## Goals

1. **Single source registry** `corpus/sources.yml` (tracked) as the one source of truth for every vendored upstream;
   `setup.sh`, `build_index.py`, and `update_corpus.sh` all read it — no hard-coded corpus paths remain.
2. **Multi-source intake.** Vendor N upstreams under `corpus/<name>/` (blobless + sparse, gitignored), refreshable
   individually or together.
3. **Indexer is registry-driven.** Each source's DSLs are indexed and tagged `source: corpus:<name>` so INDEX shows
   provenance and `find.py --source corpus:<name>` works.
4. **Provenance on curated templates.** Any template derived from an upstream file records source repo + commit +
   original path + license, in a machine-parseable, import-safe form.
5. **A documented promote workflow** turning one corpus file into one standardized, provenance-stamped template.
6. **A staleness checker** that compares each curated template's recorded commit to live upstream and flags
   re-promotion candidates (warn-only; wired into `update_corpus.sh` and optionally CI).
7. **License hygiene.** Every source declares its license; every promoted template carries attribution; a check
   enforces it.

## Non-goals

- **Auto-merging upstream changes into curated templates** — impossible by design (see the tension above).
- **Bulk auto-translation / auto-migration** at scale — promotion is human/AI-gated **per file** (translating a
  domain-bound Chinese workflow, e.g. `中译英`, would *break* it, not clean it).
- **Mirroring non-DSL assets** (images/snapshots) — sparse `DSL/`-only stays, as today.
- **Promoting the whole corpus** — curate the ~10–20 generally-useful examples; skip novelties.
- **Reordering** the existing precedence — the new `library` tier is *added* beside `patterns`
  (`patterns > library > project > corpus:* > skill-assets`); the relative order of existing tiers is unchanged.
- **Replacing `/dify-build`** — promote reuses it, does not fork it.

## Implementation phasing

D4–D7 cannot be acceptance-tested until a real template is promoted, and promotion (D5) needs a chosen second
source **plus** the provenance machinery — yet there are **zero curated templates today**. Ship in two passes to
break that circularity:

- **022a — intake infrastructure (D1–D3).** Source registry + multi-source vendoring + registry-driven indexer.
  Low risk; unblocks Goals 1–3; AC1/AC2/AC3/AC5 are verifiable on their own.
- **022b — provenance + promotion (D4–D7).** `x-provenance` + `/template-promote` + staleness + license, plus
  AC4/AC6/AC8. Settle the still-soft knobs (D4 header round-trip, D6 hash compare) against the **first real
  promotion**, not in the abstract — per this spec's own rule that changing a knob before its machinery exists
  just moves the design, not the system.

## Design

### D1 — Source registry `corpus/sources.yml`

```yaml
# corpus/sources.yml — single source of truth for vendored reference corpora.
# The clones it describes live at corpus/<name>/ and stay gitignored; THIS file is tracked.
sources:
  - name: awesome-dify-workflow
    repo: https://github.com/svcvit/Awesome-Dify-Workflow.git
    ref: main                 # branch/tag/commit. Pin to a tag or SHA for reproducibility (see Q3).
    sparse: [DSL]             # subdirs to materialise (blobless + sparse-checkout)
    dsl_glob: "DSL/**/*.yml"  # how the indexer finds workflows under this source
    license: MIT              # SPDX id, copied from the source repo's LICENSE
```

- A tiny shared reader (`tools/dify_base/sources.py`, used by `build_index.py` and `update_corpus.sh`) parses it.
  **Bootstrap constraint:** `setup.sh` must read the registry *before the venv exists* (clones run in step
  `[2/5]`, the venv is created in `[3/5]`) and `yq` is **not** guaranteed on PATH. Resolution: keep `sources.yml`
  real YAML but constrain it to a **grep/awk-parseable subset** (flat scalars, `sparse` as a single-line `[DSL]`) —
  a tiny `grep`/`awk` shim in bash reads it, Python uses `sources.py` + PyYAML. No `yq` dependency, no setup.sh
  reordering, no flat-file rename. One schema, three consumers.
- The registry is the *only* edit needed to add a source.

### D2 — Multi-source vendoring + update tooling

- **`setup.sh`**: replace the corpus line of `REPOS` with a loop over `sources.yml`, doing
  `git clone --depth=1 --filter=blob:none --sparse … && git -C … sparse-checkout set --cone <sparse>` (exactly the
  shape introduced for awesome-dify-workflow this session).
- **`.gitignore`**: already ignores `corpus/*/` and un-ignores `corpus/.gitkeep`. Since `corpus/*/` matches only
  sub*directories*, the top-level `corpus/sources.yml` file is **already trackable as-is** — no new rule needed,
  just `git add corpus/sources.yml`.
- **`update_corpus.sh`** generalised:
  - `--check` → for every source, `ls-remote` vs local HEAD; print a `fresh/stale` table (no download).
  - `<name>` → update one source; bare / `--all` → update all; then rebuild INDEX + lint **once** at the end.
  - reuses the existing `fetch --depth=1` + `reset --hard FETCH_HEAD` + sparse-preserved logic.

### D3 — Indexer generalisation

- In `build_index.py`, replace the single hard-coded corpus `SCAN_PATHS` entry with registry-driven discovery: for
  each source, scan `corpus/<name>/<dsl_glob>` tagged `corpus:<name>`. Only the corpus tuple is replaced — the
  `skills/*` + curated tuples in `SCAN_PATHS` stay (Q1 defers skills to the registry), so the implementer swaps
  one entry and *appends* the per-source results.
- `find.py --source` switches from a fixed `choices=[…]` list + exact match to **namespace prefix-match**:
  `--source corpus` matches every `corpus:*`; `--source corpus:<name>` matches one; non-namespaced tags
  (`patterns`, `library`, `project`, …) still match exactly. This keeps existing callers working — e.g.
  [AGENTS.md](../../AGENTS.md) §6 and the `find.py` docstring both run `--source corpus`.
- The **Sources** note already added to INDEX this session is extended to enumerate the registered sources and their
  licenses.

### D4 — Provenance on curated templates

Recommended form: a fixed **comment header** at the top of the `.yml` (Dify ignores comments, so it survives
import — locality beats a sidecar). Parsed by the checker:

```yaml
# x-provenance: source=awesome-dify-workflow repo=https://github.com/svcvit/Awesome-Dify-Workflow.git
#   commit=e730ed3 file="DSL/json-repair.yml" orig_sha256=ab12…  promoted=2026-06-21 license=MIT
```

`orig_sha256` is the hash of the **upstream file as it was at promote time** — the staleness check (D6) compares
it to the current upstream copy, which avoids needing the historical `commit` to be reachable in a shallow clone.

Hand-authored-from-scratch templates use `source=original` (no upstream, never flagged stale).

> **Comment-headers survive Dify import (comments are ignored) but NOT YAML reserialization** — PyYAML
> `safe_load`+`dump` strips them. Two mitigations, **both required**: (1) `/template-promote` injects the header as
> its **final write step**, after every migrate/translate/dump pass; (2) a round-trip test asserts the header
> survives a `load`+`dump`. (This is the real risk the Q2 sidecar trade-off was hedging — locality is kept, the
> fragility is closed by the inject-last + test discipline rather than by a second file.)

### D5 — Promote workflow

A thin skill `/template-promote <corpus-file>` wrapping `/dify-build` phases:
validate → migrate to current DSL (`0.6.0`) → **selective** translate (skip + flag if domain-bound) → rename to house
style → inject the `x-provenance` header + license attribution → land in the curated dir → rebuild INDEX → lint.
Human-gated, one file per run (matches the repo's phase-stops-for-review culture).

### D6 — Staleness checker `tools/dify_base/check_provenance.py`

- Parse every `x-provenance` header in the curated dir.
- Classify each as `current` | `stale` (upstream changed → consider re-promote) | `orphan` (source gone from
  registry / file gone), in two modes:
  - **`--check` (no download):** `ls-remote` the source HEAD vs the local clone HEAD — cheap, network-light, but
    coarse (any upstream commit flags every template from that source).
  - **full run (precise, no history fetch):** after `update_corpus.sh --all` refreshes the local sparse clones,
    hash the **local** upstream file `corpus/<name>/<orig_path>` and compare to the recorded `orig_sha256`. Because
    this reads the already-on-disk clone, it needs **no git history and no extra network** — sidestepping the
    shallow (`--depth=1`) + blobless (`--filter=blob:none`) clone's inability to reach the recorded historical
    `commit`. (This is how Q4's "file-changed" precise mode is actually made feasible.)
- Output a table; exit non-zero only in an opt-in `--strict` mode. Wired into `update_corpus.sh`'s tail and,
  optionally, a warn-only CI step.

### D7 — License hygiene

- `license` is **mandatory** in the registry.
- **v1 accepts permissive licenses only** — `license` must be in an allowlist (MIT, Apache-2.0, BSD-2/3-Clause,
  ISC, Unlicense, CC0-1.0, CC-BY-4.0). Promote **rejects** copyleft (GPL/LGPL/AGPL, CC-BY-SA) and non-commercial
  (CC-*-NC) sources: a promoted template is a *derivative work* (translated + DSL-migrated), so those carry
  redistribution obligations well beyond attribution. Supporting copyleft/NC is a deferred follow-up.
- Promote injects `license=<id>` + attribution into the provenance header.
- `check_provenance.py` (or a lint) verifies every promoted template names a license and a registered source; a
  top-level `THIRD_PARTY.md` aggregates attributions for redistribution.

## Resolved decisions (Q1–Q6 → defaults, 2026-06-21)

All six were locked to the recommended defaults so implementation can proceed; the `*Default…*` note on each is now
**the decision**. To change any once the system exists, see
[Revisiting these decisions after implementation](#revisiting-these-decisions-after-implementation).

- **Q1 — Registry scope.** Fold `skills/*` upstreams into `sources.yml` too, or keep it corpus-only? Skills are
  consumed as *assets*, not just DSL, so a `kind: corpus|skill` field may be cleaner than one flat list.
  *Default if unanswered: corpus-only; revisit skills later.*
- **Q2 — Provenance form.** Comment-header (chosen above, locality + import-safe) vs sidecar `.provenance.yml`
  (robust parse, but two files to keep in sync). *Default: comment-header.*
- **Q3 — Pinning.** Default sources to a pinned tag/SHA (reproducible, manual bump — matches spec 003's
  `e730ed3` pin) or track `main` (fresh, drifts)? Per-source `ref` supports both. *Default: track `main`, document
  that pinning is available per-source.*
- **Q4 — Staleness granularity.** Source-HEAD-moved (cheap, noisy: any upstream commit flags every template from
  that source) vs specific-file-changed (precise, needs a blob fetch per template). *Default: HEAD-moved for
  `--check`, file-changed for the full run.*
- **Q5 — Curated location.** Promote into `templates/patterns/` (mixed with the 6 canonical archetypes) or a new
  `templates/library/` (keeps archetypes vs harvested examples separate)? *Default: new `templates/library/`,
  `source: library` tag, same precedence band as `patterns`.*
- **Q6 — License gating.** Warn-only, or hard-fail CI when a promoted template lacks attribution? *Default:
  warn-only first run, promote to hard-fail once clean (mirrors spec 020's warn→measure→gate rollout).*

## Acceptance criteria

- **AC1** ✅ — `corpus/sources.yml` exists and is the only place a source is declared; `setup.sh`, `build_index.py`,
  and `update_corpus.sh` read it; **no hard-coded corpus path remains** in any of the three.
- **AC2** ✅ — Adding a source = one registry entry; `setup.sh` (or `update_corpus.sh --all`) materialises it, and
  INDEX gains `corpus:<name>` rows. **Demonstrated** with a real second source:
  `awesome-dify-workflow-en` (Formyselfonly/Awesome-Dify-Workflow-EN, MIT, 26 English workflows under
  `Workflow-Store/`) — a *different* `sparse`/`dsl_glob` than source #1, proving per-source config works.
- **AC3** ✅ — `update_corpus.sh --check` reports per-source fresh/stale with zero downloads.
- **AC4** ✅ — `templates/library/seo-slug-generator.yml` carries an `x-provenance` header (incl. `orig_sha256`);
  `check_provenance.py` classifies it `current`, and flips to `stale` when the upstream file's content diverges
  from the recorded `orig_sha256` (verified in `tests/test_provenance.py`).
- **AC5** ✅ — Lint policy is **tier-split**: `lint_refs.py` **gates** the curated tier (`templates/library/`,
  tracked → pre-commit), and runs **warn-only** over intake (`corpus/*`, gitignored, reference-only —
  multilingual + older DSL, so it cannot be required green). This matches today's `update_corpus.sh` warn-only
  corpus lint; the 003 baseline applies to the curated tier.
- **AC6** ✅ — Every promoted template names a license + registered source (enforced by `check_provenance.py`
  `--strict`); `THIRD_PARTY.md` aggregates attributions (auto-generated via `--write-third-party`).
- **AC7** ✅ — Docs updated: AGENTS.md gains registry + `templates/library/` rows, INDEX reflects the registry. Precedence is
  **extended, not reordered** — the new curated tier sits beside `patterns`:
  `patterns > library > project > corpus:* > skill-assets`.
- **AC8** ✅ — `sources.py` (`tests/test_sources_registry.py`) and `provenance.py`/`check_provenance.py`
  (`tests/test_provenance.py`) have unit tests; a warn-only CI step runs `check_provenance.py`
  ([ci.yml](../../.github/workflows/ci.yml), per specs 011/020 discipline).

## Revisiting these decisions after implementation

Each default is reversible; the cost is localized to the design block(s) that own it. **Do this only after D1–D7
exist** — changing a knob before its machinery is built just moves the design, not the system.

| Q | To change | Where to edit | Cost |
|---|---|---|---|
| **Q1** corpus-only → include `skills/*` | add a `kind: corpus\|skill` field to `sources.yml`; branch on it in `setup.sh` (clone style) + `build_index.py` (scan + tag) | D1–D3 | **M** — schema + 2 consumers; one-time move of skills' hard-coded lines into the registry |
| **Q2** comment-header → sidecar `.provenance.yml` | swap the writer in `/template-promote` + the parser in `check_provenance.py`; one-time extract existing headers to sidecars | D4–D6 | **S** — localized; migrate N files |
| **Q3** track `main` → pin a source | set that source's `ref:` to a tag/SHA in `sources.yml` | D1 | **XS** — data-only, per-source, **no code** |
| **Q4** HEAD-moved → file-changed everywhere | flip the default mode (add `--mode head\|file`) in `check_provenance.py` | D6 | **S** — one tool |
| **Q5** `templates/library/` → merge into `patterns/` (or split further) | move files + update the `source:` tag mapping in `build_index.py` `SCAN_PATHS` and `find.py --source` choices | D3, D5 | **S** — mechanical move + tag rename |
| **Q6** warn-only → hard-fail CI | switch the CI step to `check_provenance.py --strict`, **only after** a clean measurement run (follow 020's warn→measure→gate discipline) | D7 + CI | **XS** code / discipline gate |

Rule of thumb: **Q3 is data-only (instant), Q4/Q6 are one-tool flips, Q2/Q5 are localized moves, Q1 is the only
schema-level change.** None requires re-promoting templates except Q2 (the header→sidecar migration). When you do
change one, update this spec's *Resolved decisions* note rather than letting reality drift (per
[specs/README.md](README.md) "How to use" §3).

## Deferred follow-ups

- A mechanical `0.1.x → 0.6.0` DSL migration helper (its own spec) to cut promotion cost.
- A cross-source **dedup detector** (every corpus has a translation workflow).
- A browsable catalog/UI over `index.json`.

## References

- `scripts/setup.sh` (corpus clone loop — slimmed to blobless+sparse this session)
- `scripts/update_corpus.sh` (single-source refresh — generalise in D2)
- `tools/dify_base/build_index.py` (`scan_targets()` / `STATIC_SCAN` — registry-driven since D3; was the
  hard-coded `SCAN_PATHS` corpus tuple)
- [003](003-variable-ref-linter.md) — lint baseline across sources
- [007](007-capability-docs-and-patterns.md) — "local supplement, never edit the upstream clone"
- [AGENTS.md](../../AGENTS.md) §3 (precedence), "never edit corpus"

## Revision log

- 2026-06-21 — initial draft.
- 2026-06-21 — Q1–Q6 resolved to defaults; Status → Approved; added "Revisiting these decisions after
  implementation" guidance.
- 2026-06-22 — review pass (validated against `setup.sh`/`update_corpus.sh`/`build_index.py`/`find.py`). Resolved
  6 implementation refinements: (1) grep/awk shim on a controlled-schema `sources.yml`, **not** `yq` (bootstrap
  reads it pre-venv); (2) `find.py --source` namespace prefix-match so `--source corpus` keeps working;
  (3) comment-header kept but `orig_sha256` added + inject-last + round-trip test; (4) staleness compares
  `orig_sha256` to the local fresh clone (no history/network); (5) tier-split lint (curated gates, intake
  warn-only); (6) permissive-only licenses (reject copyleft/NC). Split delivery into **022a (D1–D3)** /
  **022b (D4–D7)**. Updated tier table, D1–D4, D6–D7, AC2/AC4/AC5/AC7; added AC8 + "Implementation phasing".
- 2026-06-22 — **022a (D1–D3) implemented.** New: `corpus/sources.yml` (registry), `scripts/lib/sources.sh`
  (bash shim), `tools/dify_base/sources.py` (Python reader), `tests/test_sources_registry.py`. Changed:
  `setup.sh` (registry-driven corpus clone loop), `update_corpus.sh` (multi-source `--all`/`<name>`/`--check`),
  `build_index.py` (`scan_targets()` tags `corpus:<name>` + new `library` tier), `find.py` (`--source`
  namespace prefix-match), AGENTS.md + corpus-update skill (docs). **AC1/AC3 met; AC5 (intake-warn side) met;
  AC2 mechanism proven by tests** — the one remaining piece is cloning a *real* permissively-licensed second
  source (data-add). AC4/AC6/AC8(provenance half) belong to 022b. Full pytest suite green (66 passed).
- 2026-06-22 — **AC2 closed + indexer correctness fix.** Added real second source `awesome-dify-workflow-en`
  (MIT, English, `Workflow-Store/` glob); `setup.sh` materialised it; INDEX gains 26
  `corpus:awesome-dify-workflow-en` rows. Exposed + fixed a **pre-existing bug**: `build_index._filter_gitignored`
  ran over *all* scan roots and silently dropped every ASCII-named file under the gitignored-by-design
  `corpus/`+`skills/` clones (non-ASCII names survived only because `git check-ignore` octal-quotes them). Fix:
  scope the filter to `projects/` (its real spec-011-R2 purpose) + `core.quotePath=false`. Index 36 → 91 entries
  (recovered 24 awesome + 5 skill-assets workflows). The EN source's noisy lint validates AC5's intake-warn tier.
- 2026-06-22 — **022b (D4–D7) implemented; spec Done.** New: `tools/dify_base/provenance.py` (header
  parse/format), `tools/dify_base/check_provenance.py` (current/stale/orphan + license gating + THIRD_PARTY.md),
  `THIRD_PARTY.md`, `.claude/skills/template-promote/SKILL.md` (D5), `tests/test_provenance.py`, and the **first
  real promotion** `templates/library/seo-slug-generator.yml` (migrated 0.1.0→0.6.0 from the EN source, model
  blanked to house style, passes validate + lint + version gate). Staleness compares `orig_sha256` to the local
  clone (no history/network); wired warn-only into `update_corpus.sh` tail + a CI step. AC4/AC6/AC8 met. Full
  suite 76 passed, 2 skipped.
