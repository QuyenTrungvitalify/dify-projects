# lint_refs.py baseline run

Date: 2026-05-14
Corpus version: `corpus/awesome-dify-workflow` @ `e730ed3`

## Stats

- Files scanned: **46** (recursive `find corpus/awesome-dify-workflow/DSL -name "*.yml"`)
- Files with ≥1 issue: **0** (0%)
- Total issues: **0**
- Unknown-type warnings: **0** (after silently skipping sticky-note nodes with `data.type: ''`)
- Total runtime (46 files, single process): **~0.86s** (well under the <5s pre-commit budget)

Command (note: corpus filenames contain spaces, must use null-delim):

```bash
find corpus/awesome-dify-workflow/DSL -name "*.yml" -print0 \
  | xargs -0 .venv/bin/python tools/dify_base/lint_refs.py \
  > /tmp/lint_corpus.stdout 2> /tmp/lint_corpus.stderr
```

The spec quoted "51 files" but the actual checkout at `e730ed3` has 46 `.yml`
files (plus one `.7z` archive and one nested `图文知识库` directory which are
excluded by the glob).

## Sample flagged

None — every ref in the 46 community examples resolves to a real node + field.

Sanity-spot check (to confirm the linter is actually parsing refs, not silently
matching zero):

| File | Refs found |
|---|---|
| `AgentFlow.yml` | 3 |
| `Artifact.yml` | 2 |
| `translation_workflow.yml` | 27 |

(Counted by direct `REF_PATTERN.findall(text)` — all 32 refs validated as
existing node+field pairs.)

## False-positives identified

None. The known-risky case (`code_with_string_ref.yml`-style Python literal
that looks like a Dify ref) doesn't appear in the corpus.

Per Q3.3 the linter is intentionally lenient about this — if such a literal
showed up, the linter would flag it, but so would Dify's own parser at import.

## Action

- [x] False-positive rate ≤5% → **ship**
- [ ] If >5%: tune algorithm before shipping  *(not needed)*

## Notes for future tuning

- 26 corpus files contain sticky-note nodes with empty `data.type` (visual
  annotations, no refs). The linter silently skips these — see
  [tools/dify_base/lint_refs.py:130](../../tools/dify_base/lint_refs.py#L130)
  (`if outputs is None and ntype:`).
- The regex tolerates iteration sub-paths (`{{#iter.item.subfield#}}`) but only
  validates `node_id + first segment`. This is intentional per Q3.1 lenient
  default; revisit if observed bugs.
