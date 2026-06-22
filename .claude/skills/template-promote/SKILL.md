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
   .venv/bin/python skills/mango-svip/scripts/validate_workflow.py templates/library/<slug>.yml
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

## Notes

- Provenance + staleness machinery: [`tools/dify_base/provenance.py`](../../../tools/dify_base/provenance.py),
  [`check_provenance.py`](../../../tools/dify_base/check_provenance.py). Staleness compares the recorded
  `orig_sha256` to the **local** clone file (no history/network).
- To later refresh a promoted template flagged `stale`, re-run this procedure on the same file (it's a
  re-promotion, never an auto-merge — see spec 022's core tension).
