# Spec 007 — Capability docs: pitfall log + plugin behavior matrix

**Status**: Approved (2026-05-29)
**Effort**: S (~1.5-2h)
**Depends on**: 002 (AGENTS.md)

> **Scope note**: Earlier draft of this spec bundled 3 phases (capability docs +
> reusable patterns + spec-management doc + api probe utility). Phases B/C have
> been split out because they extrapolated cross-project conventions from a
> single project ([projects/eiken_stem_proofread/](../../projects/eiken_stem_proofread/)).
> Pattern extraction needs n≥2 to avoid baking in eiken-specific shape. See
> [§ Deferred follow-ups](#deferred-follow-ups) at bottom.

## Context

Building real projects on this base surfaces gotchas that aren't in `AGENTS.md`
or `constraints.md` because they only manifest when you wire up a specific
sandbox/plugin combination. Recent project [projects/eiken_stem_proofread/](../../projects/eiken_stem_proofread/)
discovered ≥2 truly new gotchas through trial-and-error that future projects
shouldn't have to rediscover:

1. **Dify template `{{#<id>.<field>#}}` only resolves numeric-timestamp IDs.**
   String IDs like `node-code` silently render as literal text — output appears
   as raw template string in downstream nodes (no error, no warning). This is a
   new failure mode not currently logged.
2. **Free-tier ToS of third-party APIs.** When integrating a tiered API
   (LanguageTool, etc.) for production use, "free tier" often restricts
   automated/non-interactive use in ToS. Discovered after building integration
   skeleton against LT free tier.

Additionally, per-tool **behavior of multi-tool plugins** (e.g.
`bowenliang123/md_exporter` exports 15+ formats — `md_to_docx`, `md_to_xlsx`,
`md_to_csv`, …) is not documented anywhere. `constraints.md §5` mentions only
the whitespace caveat for `md_to_csv`. Each tool has different behavior with
inline markdown (`**bold**`, `~~strike~~`, raw HTML). Eiken's 2 plugin-matrix
test workflows (`test_docx_highlight.yml`, `test_xlsx_highlight.yml`) verified
several cells of this matrix; the verifications should be captured for reuse.
A third test workflow (`test_openpyxl_feasibility.yml`) verifies a separate
fact — `openpyxl` not in the Code-node sandbox — which feeds A.3, not A.2.

## What's already covered (do NOT re-document)

These already live in [constraints.md](../../skills/mango-svip/references/constraints.md):

- §1 Code-node sandbox (stdlib whitelist, "no requests", Code→HTTP→Code pattern)
- §4 Plugin hash is workspace-specific
- §5 md_exporter whitespace collapsing (`md_to_csv` specific)
- §7 if-else dual-schema (modern `cases` + legacy `conditions`)

This spec only adds **net-new** information. Where existing constraints.md
content lacks a project-discovered fact (e.g. §1 doesn't list `openpyxl` as
confirmed-not-available, even though eiken's `test_openpyxl_feasibility.yml`
proves it), this spec captures the fact in a new local supplement
([`docs/runtime-supplement.md`](../runtime-supplement.md)) rather than editing
the upstream clone in place — see A.3 for rationale.

## Goals

1. Future projects don't re-discover the 2 new gotchas via trial.
2. Per-tool behavior of `bowenliang123/md_exporter` is recorded with a clear
   convention for future verifications (any plugin, any tool).
3. Eiken's empirical sandbox finding (`openpyxl` not available — verified via
   [test_openpyxl_feasibility.yml](../../projects/eiken_stem_proofread/workflows/test_openpyxl_feasibility.yml))
   is captured in a committable local supplement (`docs/runtime-supplement.md`)
   that complements the upstream skills-clone `constraints.md §1` without
   editing the clone. A generic probe workflow ships alongside so any project
   can verify its own workspace sandbox without trial-and-error in production
   code.

## Non-goals

- Eiken-specific implementations (stay in `projects/eiken_stem_proofread/`).
- New patterns in `templates/patterns/` (see [§ Deferred follow-ups](#deferred-follow-ups)).
- New utilities like `tools/api_probe.py` (curl/WebFetch already cover the
  use case; revisit only if a 2nd project shows the need).
- Generalizing `spec_todo/` folder convention (n=1; defer to spec 008+).
- Changing AGENTS.md core conventions §1-§8.
- New schema versions or DSL changes.

## Design

### A.1 — AGENTS.md §9 pitfall entries (terse, per existing convention)

`AGENTS.md §9` convention is **1-2 lines per entry, dated, terse, only real
failures**. Append exactly 2 new entries — no more, no behavioral matrices:

```markdown
- 2026-05-21: Used string node IDs (`node-code-1`) in a workflow → downstream
  `{{#node-code-1.text#}}` rendered as literal text in output, no error. → Dify
  template engine only resolves numeric-timestamp IDs. Always use
  `skills/mango-svip/scripts/generate_id.py` per §4.1.
- 2026-05-22: Proposed LanguageTool free tier for production proofread → ToS
  prohibits automated/non-interactive use. → For any tiered third-party API,
  read ToS for "automated requests" clause before designing free-tier
  production path. Tracker: `projects/eiken_stem_proofread/spec_todo/api_alternatives.md`.
```

Plugin behavior detail does **not** go here (would violate the terse
convention). It goes in A.2.

### A.2 — New file `docs/plugin-capabilities.md`

Per-plugin per-tool behavior matrix. Stub for new plugins, fully verified rows
for what eiken already tested.

```markdown
# Plugin Capabilities

Tested behaviors of marketplace plugins used across projects. Add a row when
you verify a plugin tool's behavior in a project. Link back to the test
workflow that established the verification.

## Format

Per plugin: `<provider>/<plugin>` + version. One table per plugin listing tools
and observed behavior. Marks:
- ✅ works as expected
- ❌ does not work / strips / errors
- ⚠️ partial — see notes
- ❓ untested in this repo (next project verifying this cell should fill in)

## bowenliang123/md_exporter v2.1.1

Verified 2026-05-21 via [projects/eiken_stem_proofread/workflows/test_*.yml](../projects/eiken_stem_proofread/workflows/).

| Tool         | `**bold**` | `~~strike~~`    | inline `<span>` HTML | `<br>` | Tables | Notes |
|--------------|------------|-----------------|----------------------|--------|--------|-------|
| md_to_docx   | ✅         | ✅              | ❌ stripped          | ❌ stripped | ✅  | Best for visual review with inline formatting |
| md_to_xlsx   | ❌ stripped | ⚠️ literal `~~` | ❌ stripped          | ❌     | ✅ structure only | No inline format; whitespace also collapses (see [constraints.md §5](../skills/mango-svip/references/constraints.md)) |
| md_to_csv    | ⚠️ literal | ⚠️ literal      | ⚠️ literal           | ⚠️ literal | ✅ structure | CSV is plain text — markdown syntax passes through as literal characters in cells. Whitespace also collapses (see [constraints.md §5](../skills/mango-svip/references/constraints.md)). |
| md_to_html   | ❓         | ❓              | ❓ likely pass-through | ❓   | ❓     | Untested |
| md_to_pdf    | ❓         | ❓              | ❓                   | ❓     | ❓     | Untested |
| Other tools (md_to_md, md_to_json, md_to_yaml, md_to_latex, md_to_xml, md_to_typst) | ❓ | ❓ | ❓ | ❓ | ❓ | Untested |

Cross-references:
- [constraints.md §5](../skills/mango-svip/references/constraints.md) — md_to_csv whitespace collapse
- Source verifications:
  - [eiken/workflows/test_docx_highlight.yml](../projects/eiken_stem_proofread/workflows/test_docx_highlight.yml)
  - [eiken/workflows/test_xlsx_highlight.yml](../projects/eiken_stem_proofread/workflows/test_xlsx_highlight.yml)
```

**Convention**: untested cells stay `❓`. Future projects that exercise a tool
add a row (or fill cells) + a link to their test workflow.

### A.3 — Capture stdlib finding in a LOCAL supplement (not the upstream clone)

Current upstream `constraints.md §1` lists `json, csv, re, math, datetime, io,
collections, itertools` as available. The original draft proposed adding
`unicodedata` and `urllib.parse` here — **dropped after audit**:
`grep -rn 'unicodedata\|urllib' projects/eiken_stem_proofread/` returns zero
hits, so the "verified empirically" claim was unfounded.

**Crucial correction (revision 2)**: the original draft also told us to edit
[skills/mango-svip/references/constraints.md](../../skills/mango-svip/references/constraints.md)
in place. This contradicts [AGENTS.md §2](../../AGENTS.md):
*"Never edit anything under skills/ — read-only external clones."* The
`skills/mango-svip/` directory is a clone of
`https://github.com/mango-svip/dify-workflow-skills.git`, gitignored via
`.gitignore` line 5 (`skills/*/`), and refreshable via
[scripts/setup.sh](../../scripts/setup.sh). An edit there is not committable,
not propagated to teammates, and may be wiped on environment refresh.

**Resolution**: create a new local file
[`docs/runtime-supplement.md`](../runtime-supplement.md) that records
**project-discovered findings net-new vs upstream** without touching the
clone. Generic findings (rare; e.g. plugin behavior on a new Dify version)
get upstreamed via PR to `mango-svip/dify-workflow-skills` and then removed
from the supplement. Project-specific findings stay local.

Concrete change: add to `docs/runtime-supplement.md` (new file) a
"§1-supplement — confirmed-missing modules" table with ONE evidence-backed
row (`openpyxl` → linked to `test_openpyxl_feasibility.yml`) and a pointer
to the probe workflow (A.5) for per-workspace verification of additional
modules.

This avoids the trap of static lists drifting against unverified guesses
(`pandas`/`numpy`/`httpx` etc. were in the previous draft as "confirmed NOT
available" but had no probe — dropped). It also avoids the broader trap of
writing to a clone whose edits silently disappear.

### A.4 — Make new docs discoverable via [AGENTS.md §8](../../AGENTS.md)

`INDEX.md` is regenerated by [tools/dify_base/build_index.py](../../tools/dify_base/build_index.py)
which only scans workflow YAMLs in `templates/patterns/`, `templates/_base/`,
`corpus/`, and `projects/`. The new artifacts (`docs/plugin-capabilities.md`,
`docs/runtime-supplement.md`, `templates/probes/stdlib_check.yml`) won't
appear there — by design.

Instead, add 3 rows to AGENTS.md §8 "Where to find what" table so agents
encounter them on session warmup:

```
| Plugin tool behavior matrix (md_exporter formats etc.)         | docs/plugin-capabilities.md             |
| Project-discovered runtime findings (supplements skills clone) | docs/runtime-supplement.md              |
| Sandbox stdlib probe (run in your workspace to verify modules) | templates/probes/stdlib_check.yml       |
```

No INDEX.md change. (If we later add a `docs/` table to INDEX.md, that is a
separate task — out of scope here.)

### A.5 — New file `templates/probes/stdlib_check.yml`

3-node generic workflow (Start → Code → End) that imports a curated list of
~15 candidate stdlib modules inside the Dify sandbox and returns a dict of
`<module_name>: "ok" | "missing: <error>"` plus a summary verdict string.
Includes the 8 currently-verified modules, the 2 candidates dropped from A.3
(`unicodedata`, `urllib.parse`), and a few known-or-suspected-missing
(`openpyxl`, `requests`, `pandas`, `numpy`, `httpx`) so the output is a
single-shot truth table.

**Why `templates/probes/` rather than `tools/`**: probes are workflows
imported into Dify (YAML), not local Python scripts. The `templates/`
namespace is the right home; `probes/` is a new subdirectory because the
artifact is neither a starting pattern (`patterns/`) nor a project scaffold
(`_base/`) — it is a diagnostic any project can run, on-demand, against
its own workspace.

**Why not `templates/patterns/`**: it's not a workflow shape developers build
on top of. Putting it in `patterns/` would pollute `tools/dify_base/find.py`
output. `templates/probes/` is intentionally outside `build_index.py`'s scan
list (probes are diagnostic, not template).

Customer-facing teams can copy → run → paste output into their project's
`spec_todo/` or `constraints.md`-equivalent. Generic, project-agnostic.

## Open questions

- **Q7.1**: Plugin matrix — single `docs/plugin-capabilities.md` or split per plugin?
  **Default**: single file. Split trigger: file exceeds ~300 lines OR 2+ plugins
  each have >5 verified rows (whichever first). Threshold "≥5 plugins" from
  earlier draft was arbitrary; line-based trigger keeps file readable without
  premature split.
- **Q7.2**: Should the LT free-tier ToS entry name LanguageTool specifically, or
  stay generic? **Default**: stay generic ("any tiered third-party API"). LT
  details live in `spec_todo/api_alternatives.md` (already linked from the entry).
- **Q7.3**: stdlib whitelist phrasing — "verified-working" or "supported"?
  **Default**: "verified-working in this repo's test workflows" — strongest
  honest claim (Dify does not publish a sandbox spec; per-deployment variation
  possible). Probe in A.5 lets each workspace generate its own truth.

## Acceptance criteria

- [ ] `AGENTS.md §9` has the 2 new entries above, dated, ≤2 lines each, matching
  the existing terse convention. No multi-paragraph behavioral docs in §9.
- [ ] `docs/plugin-capabilities.md` exists. `bowenliang123/md_exporter` v2.1.1
  has ≥2 fully-verified rows (`md_to_docx`, `md_to_xlsx`) + `md_to_csv` row
  (with `⚠️ literal` markers, not `N/A`) + remaining tools listed as `❓ Untested`.
- [ ] `docs/runtime-supplement.md` exists with §1-supplement table containing
  ONE row (`openpyxl` verified-missing, linked to test workflow), pointer to
  the probe, and clear statement that it supplements (not replaces) upstream
  `skills/mango-svip/references/constraints.md`.
- [ ] `skills/mango-svip/references/constraints.md` is UNCHANGED (it is a
  gitignored read-only clone — edits there are not committable and may be
  wiped by `setup.sh`).
- [ ] `templates/probes/stdlib_check.yml` exists, validates via
  `skills/mango-svip/scripts/validate_workflow.py`, contains zero
  `<<< FILL >>>` / `<<< VERIFY >>>` markers, and lists ≥15 candidate modules.
- [ ] `AGENTS.md §8` table has 3 new rows pointing to
  `docs/plugin-capabilities.md`, `docs/runtime-supplement.md`, and
  `templates/probes/stdlib_check.yml`.
- [ ] `docs/specs/README.md` index updates spec 007 status `Draft` → `Approved`.
- [ ] No regressions: `pre-commit run --all-files` passes.
- [ ] No new `templates/patterns/*.yml` (those are deferred — see below).
- [ ] No new `tools/*.py` (deferred — see below).

## Deferred follow-ups

The following were in the earlier draft of spec 007 but require **n≥2 evidence**
before extraction. Promoting from n=1 risks baking eiken's specific shape into
a "generic" template. Spec each separately when a 2nd project exercises the
same pattern:

- **`templates/patterns/feasibility-check.yml`** — eiken's 3 test workflows
  (`test_docx_highlight`, `test_xlsx_highlight`, `test_openpyxl_feasibility`)
  share shape, but the "Start → Code → Tool → End" skeleton is generic enough
  that it's borderline whether it earns a pattern file or just a paragraph in
  `docs/GUIDE.md`. Decide after project #2 needs feasibility-checking.
- **`templates/patterns/multi-tier-api.yml`** — eiken's `free | premium` mode
  shape for LanguageTool is theoretically generic for any tiered API, but the
  retry tuning, auth schema, and aggregator shape are LT-specific. Extract
  after eiken Phase 2 implementation is stable and a 2nd tiered-API project
  reuses the shape.
- **`docs/spec-management.md`** — eiken's `spec_todo/` folder pattern (Final
  Decisions + Decision History) is appealing, but n=1. Don't generalize a
  process from one customer-facing project.
- **`tools/api_probe.py`** — Python CLI for API probing. `curl -v` and
  `WebFetch` already cover this. Revisit only if a project shows repeated
  friction.
- **`templates/customer_confirm.md`**, **`samples/` convention**,
  **pre-commit hook for `output_filename` extension** — original Phase C
  items; all deferred per original spec, still deferred.

## References

- Source project: [projects/eiken_stem_proofread/](../../projects/eiken_stem_proofread/)
- Test workflows that verified the plugin matrix:
  [test_docx_highlight.yml](../../projects/eiken_stem_proofread/workflows/test_docx_highlight.yml),
  [test_xlsx_highlight.yml](../../projects/eiken_stem_proofread/workflows/test_xlsx_highlight.yml),
  [test_openpyxl_feasibility.yml](../../projects/eiken_stem_proofread/workflows/test_openpyxl_feasibility.yml)
- Existing canonical pitfall log: [AGENTS.md §9](../../AGENTS.md)
- Existing runtime constraints: [constraints.md](../../skills/mango-svip/references/constraints.md)
- Build-index source paths reference:
  [tools/dify_base/build_index.py](../../tools/dify_base/build_index.py)
  (probes intentionally not scanned)
- Spec template: [docs/specs/README.md](README.md)

## Revision log

- **2026-05-29 (revision 2)**: Multiple corrections found during review +
  implementation audit:
  1. Original A.3 claimed `unicodedata`/`urllib.parse` were "verified
     empirically" in eiken — `grep` showed zero usage. Dropped.
  2. Original A.3 listed `pandas`/`numpy`/`httpx`/`urllib3`/`xlrd`/`xlsxwriter`
     as "confirmed NOT available" — only `openpyxl` had evidence. Trimmed.
  3. Original A.3 told us to edit `skills/mango-svip/references/constraints.md`
     in place. Caught during Phase 2 pre-commit audit:
     [AGENTS.md §2](../../AGENTS.md) forbids editing `skills/` (gitignored
     read-only clone). Pivoted to a new local
     [`docs/runtime-supplement.md`](../runtime-supplement.md) that
     supplements upstream without modifying the clone.
  4. Matrix row `md_to_csv` cells were `N/A` — semantically wrong for plain
     text where markdown syntax passes through. Corrected to `⚠️ literal`.
  5. Added A.5 (generic probe workflow `templates/probes/stdlib_check.yml`)
     so any project can self-verify sandbox state without depending on a
     static repo-level list.
  6. Added A.4 (AGENTS.md §8 entries) so new docs are discoverable.
  7. Extended pre-commit `files:` regex to cover `templates/probes/` so
     future probes stay validated.
- **2026-05-27 (revision 1)**: Phase B/C deferred pending n≥2.
