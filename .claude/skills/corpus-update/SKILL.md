---
name: corpus-update
description: Check for and apply updates to the gitignored corpus clone (Formyselfonly/Awesome-Dify-Workflow-EN), then rebuild INDEX and lint. Use when the user wants to refresh the corpus, see if upstream has new workflows, or fix a stale INDEX after a corpus change.
---

# corpus-update — refresh the awesome-dify-workflow corpus

Thin wrapper around [`scripts/update_corpus.sh`](../../../scripts/update_corpus.sh). Corpora are sparse,
read-only clones declared in the registry [`corpus/sources.yml`](../../../corpus/sources.yml) (spec 022) —
see [`scripts/setup.sh`](../../../scripts/setup.sh). Never hand-edit corpus files.

The script is **multi-source**: bare / `--all` updates every registered source, `<name>` updates one,
and `--check` reports per-source fresh/stale. INDEX is rebuilt once at the end; each source is tagged
`corpus:<name>`.

## Procedure

1. **Always check first** (cheap — uses `git ls-remote`, downloads nothing):

   ```bash
   scripts/update_corpus.sh --check
   ```

   - Prints local HEAD vs remote `main`. If equal → already up to date, **stop here** and report that.
   - If they differ → an update is available; continue.

2. **Apply** the update only after confirming with the user (or if they asked to update directly):

   ```bash
   scripts/update_corpus.sh
   ```

   This does, in order: `fetch --depth=1` → `reset --hard FETCH_HEAD` (sparse `Workflow-Store/` preserved)
   → rebuild `INDEX.md` + `index.json` via `build_index.py` → lint all corpus refs.

3. **Report** the result: the new short SHA, any DSL files added/removed (the script prints a
   diff), and whether lint stayed clean.

## Follow-up

- If the script warns the **DSL file count changed**, report it — a corpus that grew or shrank means
  the lint numbers moved, which is worth a human's attention even though nothing tracks a baseline
  today. (A `003-lint-refs-baseline.md` used to record the corpus commit + file count; it was
  retired in the 2026-07-17 reset. Read it with `git show ca5e39e:docs/specs/003-lint-refs-baseline.md`.)
- `INDEX.md` / `index.json` are regenerated, not hand-edited. If they changed, that is expected.

## Notes

- Requires `.venv` (from `scripts/setup.sh`) for `build_index.py` and `lint_refs.py`.
- Offline → the `--check` step aborts cleanly; nothing is mutated.
- This only updates the *upstream commit*. It does **not** fix DSL-version skew: corpus examples
  may still use an older DSL version than the project targets (`.dify-dsl-version`). For
  current-version examples, prefer authoring into `templates/patterns/` instead.
