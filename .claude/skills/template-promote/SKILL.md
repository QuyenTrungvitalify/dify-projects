---
name: template-promote
description: Promote one corpus example into a standardized, provenance-stamped curated template under templates/library/. Use when turning a raw vendored workflow into a reusable house-style template (spec 022 D5). One file per run, human-gated.
---

# template-promote — raw corpus example → curated template (spec 022 D5)

Turn **one** `corpus/<source>/...` workflow into one standardized template in
[`templates/library/`](../../../templates/library/), stamped with provenance so its staleness can be
tracked later. This is **assisted, per-file, human-gated** — never bulk/auto (translating a
domain-bound workflow would break it). It reuses the [`dify-build`](../dify-build/) authoring phases;
it does not fork them.

## Preconditions

- The source must be a **registered, permissively-licensed** entry in
  [`corpus/sources.yml`](../../../corpus/sources.yml) (MIT/Apache-2.0/BSD/ISC/Unlicense/CC0/CC-BY — see
  spec 022 D7). Copyleft / non-commercial sources are **not** promotable.
- The corpus clone is present (`./scripts/setup.sh` or `scripts/update_corpus.sh <source>`).

## Procedure (one file per run)

1. **Pick + read** the corpus file. Prefer simple, generally-useful examples; skip novelties.
2. **Record provenance values** from the clone:
   ```bash
   SRC=awesome-dify-workflow-en; F="Workflow-Store/SEO Slug Generator.yml"
   git -C corpus/$SRC rev-parse --short HEAD          # -> commit
   .venv/bin/python -c "import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "corpus/$SRC/$F"
   ```
3. **Author the 0.6.0 template** into `templates/library/<house-slug>.yml`:
   - **Migrate** DSL to the project version (`0.6.0`): top-level `version`, `dependencies: []`,
     `conversation_variables`/`environment_variables`, edge `data.isInLoop`, end-node `value_type`, etc.
   - **Selective translate**: translate prose to English **only if it doesn't change behaviour**.
     If the workflow is domain-bound to its language (e.g. a `中译英` translator), keep it and flag —
     do not "clean" it into breakage.
   - **Rename** app + node titles to house style; regenerate node IDs
     (`skills/mango-svip/scripts/generate_id.py`) — never reuse upstream IDs.
   - **Blank the model** (`provider: ''`, `name: ''`) + a `# TODO: configure model` note, like the
     `templates/patterns/` archetypes (model + plugin hash are workspace-specific).
4. **Inject the `x-provenance` header LAST**, at the very top of the file (after all edits — PyYAML
   `dump` would strip a comment, so it must be the final write):
   ```yaml
   # <Title> — promoted curated template (spec 022 D5).
   # x-provenance: source=<name> repo=<url>
   #   commit=<sha> file="<path>" orig_sha256=<hex> promoted=<YYYY-MM-DD> license=<spdx>
   ```
5. **Validate + lint + version-check** (the curated tier is a hard gate, unlike warn-only intake):
   ```bash
   .venv/bin/python tools/dify_base/validate_workflow.py templates/library/<slug>.yml
   .venv/bin/python tools/dify_base/lint_refs.py templates/library/<slug>.yml
   bash scripts/check_dsl_version.sh templates/library/<slug>.yml
   ```
6. **Rebuild INDEX + provenance + attributions**:
   ```bash
   .venv/bin/python tools/dify_base/build_index.py
   .venv/bin/python tools/dify_base/check_provenance.py --write-third-party   # expect: current
   ```
7. **Report**: the new template path, its `current` provenance status, and that lint/validate passed.
   Stop for review (one file per run).

## Pattern distillation target (spec 050 D1 — proven build → generic `templates/patterns/`)

The higher-leverage target: distill **one proven `projects/` build** into a **generic pattern** that
helps every future build of the same shape (patterns rank highest in retrieval precedence). Same
one-file-per-run, human-gated discipline. Procedure:

1. **Gate FIRST (D3 — eligibility, not promotion):**
   ```bash
   .venv/bin/python tools/dify_base/promote_gate.py check <source.yml> --json
   ```
   Blocks on: any linter failure, or an import-probe FAILURE against the real Dify
   (push→capture→delete; no creds → degrades to lint-only with `probe: skipped`). An EMPTY
   `model.provider/name` in the source is a **warning only, not a blocker** (spec 054 — it lands
   in the verdict's `warnings`, since a blank model is the house template convention anyway).
   Record the verdict's `known_good_dify` for step 4.
2. **Distill** — skeleton stays, instance goes: replace domain specifics (service URL, auth-header
   name, judge rule, prompts) with placeholders + `# TODO:` customization points; **blank the
   model** back to the `''` + `# TODO:` template convention; keep the structural lessons. Header
   follows the existing pattern convention (`# Pattern:` / `# Use case:` / `# Flow:` /
   `# Customization points`) **plus `# GOTCHA:` lines** for the non-enumerable lessons (D2b — the
   *why* teaches better than the shape alone). Re-run the gate WITH the output:
   ```bash
   .venv/bin/python tools/dify_base/promote_gate.py check <source.yml> --distilled templates/patterns/<name>.yml --json
   ```
3. **Route the gotchas (D2):** a MECHANICAL rule → the linter-candidate channel
   (`promote_gate.py candidate --rule "…" --citation "vendor/dify-src/…"` — deduped on the rule
   statement); a DESIGN gotcha → the `# GOTCHA:` header lines AND one dated line in the
   [AGENTS.md §9 pitfall log](../../../AGENTS.md).
4. **Stamp provenance** (comment header, LAST write — see step 4 above):
   ```yaml
   # x-provenance: source=original repo=
   #   commit= file="<source path>" orig_sha256= promoted=<YYYY-MM-DD>
   #   license=MIT spec=<driving spec/incident> known_good_dify=<from the gate verdict>
   ```
   (`license=MIT` — the repo's own license; the 022 hygiene check requires the field even for
   `source=original`.)
   `known_good_dify` is the second staleness axis (D5): on a Dify version bump,
   `check_provenance.py` flags the pattern for a re-probe.
5. **Retrievability (D4):** the `app.description` MUST name the *problem shape + trigger*, with the
   keywords **front-loaded into the first ~50 chars** (the INDEX table truncates at 50 and keyword
   search reads only the first 100). Then rebuild INDEX + provenance (step 6 above) — a pattern the
   builder can't find is dead weight.

## Notes

- Provenance + staleness machinery: [`tools/dify_base/provenance.py`](../../../tools/dify_base/provenance.py),
  [`check_provenance.py`](../../../tools/dify_base/check_provenance.py). Staleness compares the recorded
  `orig_sha256` to the **local** clone file (no history/network) — and, for pattern promotions,
  `known_good_dify` to the current `.dify-tag` (spec 050 D5's import-behavior axis).
- To later refresh a promoted template flagged `stale`, re-run this procedure on the same file (it's a
  re-promotion, never an auto-merge — see spec 022's core tension).
