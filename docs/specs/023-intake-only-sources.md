# Spec 023 — Intake-only sources (`indexed: false` registry flag)

**Status**: Implemented (2026-06-23) — `indexed` flag live (AC1–AC5 verified); AC6 superseded — the Chinese
demo source was then **fully removed**, so the workspace is English-only and no source uses `indexed: false`.
**Effort**: XS
**Depends on**: [022](022-multi-source-template-library.md) (the source registry this extends —
`corpus/sources.yml`, `tools/dify_base/sources.py`, `build_index.py` `scan_targets()`).

## Context

Spec 022 made every registered corpus do **two** jobs at once: it is (a) **vendored + tracked** (cloned by
`setup.sh`, refreshed by `update_corpus.sh`, available as a `/template-promote` source) **and** (b) **indexed**
into the committed `INDEX.md` / `index.json` and surfaced by `find.py`.

For a multilingual source those two jobs conflict. The Chinese `awesome-dify-workflow` contributes ~46
Chinese-named rows to the committed `INDEX.md` — the human-browsable resource — which is noise for an
English-first workspace, even though the source is still wanted as a **promotion source** (harvest a good
upstream workflow → standardize to English under `templates/library/`).

The two reasonable wants pull apart:

- **Clean English browse-resource** — nothing Chinese in `INDEX.md` / `find.py`.
- **Keep harvesting** — when the Chinese upstream adds workflows later, `update_corpus.sh --check` should still
  flag them and `/template-promote` should still be able to convert them.

Simply **removing** the source from the registry (the obvious "clean it up") satisfies the first and *breaks the
second* — it drops automatic update-tracking and the promote source. The missing capability is: **vendor + track
a source without indexing it.**

> **The one design idea:** *vendoring ≠ indexing.* A source can be present, refreshed, and promotable while being
> absent from the browse index.

## Goal

A per-source boolean **`indexed`** in `corpus/sources.yml` (default `true`). `indexed: false` = the source is
cloned, refreshed, staleness-checked, and promotable **as today**, but is **excluded from `INDEX.md` /
`index.json` / `find.py`**.

## Non-goals

- **Translating / language-filtering content** — orthogonal; that is what `/template-promote` does per file.
- **Hiding a source from update-tracking, promotion, or staleness** — those must keep working on hidden sources
  (that is the entire point). Only the *index* hides them.
- **Auto language detection** — `indexed` is an explicit per-source switch, not inferred.

## Design

- **D1 — `sources.py`**: normalize the new field, `indexed = s.get("indexed", True)` (truthy default → existing
  registries are unchanged). Expose it on the source dict.
- **D2 — `build_index.py` `scan_targets()`**: skip registry sources whose `indexed` is false. This is the **only**
  code consumer — one branch.
- **D3 — `setup.sh` / `update_corpus.sh`**: **unchanged.** They clone + `git fetch`/`reset` **all** registered
  sources regardless of `indexed`; the flag never reaches the bash shim. (Crux: vendoring ≠ indexing.)
- **D4 — `find.py`**: **unchanged** — it reads `index.json`, which already omits hidden sources, so
  `--source corpus:<hidden>` simply returns nothing.
- **Data**: set `awesome-dify-workflow` (Chinese) `indexed: false`; leave `awesome-dify-workflow-en` indexed.
  Rebuild INDEX → English-only browse-resource, Chinese source still tracked + promotable.

## Resolved decisions (defaults)

- **Field name + default**: `indexed`, default `true` — backward-compatible; no existing source changes behaviour.
- **What a hidden source still does**: cloned (`setup.sh`), refreshed (`update_corpus.sh --all` / `--check`),
  promotable (`/template-promote` reads files off disk, not the index), staleness-checked (`check_provenance.py`
  reads the on-disk clone). **Only** `INDEX.md` / `index.json` / `find.py` hide it.
- **`find.py --source corpus:<hidden>`** returns nothing — consistent with "not indexed". The clone is still
  `grep`-able on disk for power users (AGENTS.md §6 discovery commands).

## Acceptance criteria

- **AC1** — A source with `indexed: false` is cloned by `setup.sh` and reported by `update_corpus.sh --check`, yet
  contributes **zero** rows to `INDEX.md` / `index.json`.
- **AC2** — `/template-promote` can still promote a file from a hidden source (reads disk, not the index).
- **AC3** — `check_provenance.py` still classifies a template whose `source` is hidden (`current`/`stale` via the
  on-disk clone, not `orphan`).
- **AC4** — A source with no `indexed:` key (or `indexed: true`) is indexed exactly as today — existing INDEX
  unchanged for `awesome-dify-workflow-en` + others.
- **AC5** — `tests/` covers: hidden source absent from `scan_targets()`/index, present-but-default still indexed.
- **AC6** — *(Superseded 2026-06-23.)* The original demo set the Chinese source `indexed: false` (INDEX
  English-only while `update_corpus.sh --check` still tracked it). The workspace then chose to **fully remove**
  the Chinese source (registry + clone) rather than merely hide it, so no registry source uses `indexed: false`
  today. The flag remains a verified general capability — exercised by the synthetic
  `test_indexed_defaults_true_and_flag_is_parsed` / `test_hidden_source_excluded_from_scan_targets` /
  `test_bash_shim_ignores_indexed` — ready to re-enable by re-adding a multilingual upstream with `indexed: false`.

## References

- [022](022-multi-source-template-library.md) — the registry + indexer this extends (`scan_targets()`,
  `sources.py`, `update_corpus.sh`, `check_provenance.py`).
- AGENTS.md §6 — on-disk `grep` discovery still works for hidden sources.

## Revision log

- 2026-06-22 — initial draft; decisions locked to defaults (field `indexed`, default `true`).
- 2026-06-23 — implemented. `sources.py` normalises `indexed` (D1); `scan_targets()` skips hidden
  sources (D2); `write_markdown` marks them `intake-only` in the registry note (small extension of D2
  — the note lists vendored sources, so a hidden one is annotated rather than dropped). Data: Chinese
  `awesome-dify-workflow` set `indexed: false`; INDEX 92→46 rows, English-only. Tests added
  (`tests/test_sources_registry.py`). All ACs verified: AC1 (0 rows, still cloned/checked), AC2 (clone
  on disk for promote), AC3 (provenance classifies via on-disk clone, not orphan), AC4 (`-en` unchanged),
  AC6 (`update_corpus.sh --check` still reports the Chinese source fresh). Bash shim unchanged (D3).
- 2026-06-23 — **Chinese source fully removed.** The workspace went English-only, so rather than keep the
  Chinese `awesome-dify-workflow` as a hidden intake source it was dropped entirely (registry entry + local
  clone). Repointed AGENTS.md §6/§8 + GUIDE.md §4.2 corpus references to `awesome-dify-workflow-en`; updated
  the two real-registry tests (`test_registry_has_en_source`, `test_real_registry_yields_en_scan_target`) and
  the ASCII-indexing regression guard (now an `-en` file). The `indexed` flag is retained as a general,
  synthetic-test-covered capability — re-add a multilingual upstream with `indexed: false` to harvest without
  cluttering the English index. Historical specs (002/003/020/022 Context) keep their original corpus
  references as point-in-time records.
