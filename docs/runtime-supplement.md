# Runtime Supplement — project-discovered findings

This file supplements [skills/mango-svip/references/constraints.md](../skills/mango-svip/references/constraints.md)
with **project-discovered facts** that originate in this repo's `projects/`
workflows and shouldn't live in the upstream `mango-svip` skills clone
(which is gitignored, externally maintained, and wiped/refreshed by
[scripts/setup.sh](../scripts/setup.sh)).

The upstream constraints.md is authoritative for general Dify runtime rules.
This file adds **net-new** findings that are evidence-backed by checked-in
test workflows under `projects/*/workflows/`. When a finding here is general
enough to upstream, send a PR to `mango-svip/dify-workflow-skills` and remove
the row here.

> See [AGENTS.md §2](../AGENTS.md) for the "do NOT edit external clones" rule
> that motivated this split, and [docs/specs/007-capability-docs-and-patterns.md](specs/007-capability-docs-and-patterns.md)
> revision 2 for the rationale.

## §1-supplement — Code-node Python sandbox: confirmed-missing modules

The base `constraints.md §1` lists the verified-working stdlib modules
(`json`, `csv`, `re`, `math`, `datetime`, `io`, `collections`, `itertools`).
The following modules are **confirmed NOT available** in the Dify Code-node
sandbox via a checked-in probe workflow — do not waste time designing logic
that depends on them; use the alternative path in the rightmost column.

| Module     | Evidence | Alternative |
|------------|----------|-------------|
| `openpyxl` | probe `test_openpyxl_feasibility.yml` — `ImportError: No module named 'openpyxl'` | Code → Tool node bridge: build a markdown table in Code, feed it to a `bowenliang123/md_exporter` `md_to_xlsx` **tool node** (shape below; see [plugin-capabilities.md](plugin-capabilities.md) for inline-formatting caveats). |

> **Note (2026-07-03):** the `projects/eiken_stem_proofread/workflows/*.yml` probe workflows these
> tables cite were **removed** from the tree — the findings stand, but the links are gone (history:
> `git show 565480c^:projects/eiken_stem_proofread/workflows/<file>`). **Do not chase those paths.**

### `md_to_xlsx` tool node — the correct `builtin` shape (verbatim from a lint-clean build)

This block is copied verbatim from a build whose 4 linters (incl. `lint_node_bodies.py` against the
generated `NodeData_ToolNodeData` schema) passed — so it is **schema-valid**, though the `@sha256` still
needs the workspace hash before a real import. `node_types.md §13`'s generic example shows
`provider_type: api` and omits several required keys — it does **NOT** match a real marketplace-plugin tool
node. Use this shape for `bowenliang123/md_exporter`
(`md_to_xlsx` / `md_to_csv` / `md_to_docx`) so a build does not have to reverse-engineer it. The tool node
declares **no `outputs:`** — a downstream node reads its `files` (and `text`) via `value_selector`. Keep
`dependencies: []` + the `# TODO:` hash comment (§4.3 — never fabricate the `@sha256`).

```yaml
- data:
    title: Markdown → XLSX
    type: tool
    provider_id: bowenliang123/md_exporter/md_exporter    # provider name doubled
    provider_name: bowenliang123/md_exporter/md_exporter
    provider_type: builtin                                 # NOT `api`
    tool_name: md_to_xlsx
    tool_label: md_to_xlsx
    tool_configurations: {}
    tool_parameters:
      md_text:
        type: mixed
        value: '{{#<upstream_code_id>.markdown_table#}}'   # a Markdown-table string
  id: '<fresh 13-digit id>'
  type: custom
# downstream `end` reads the produced file:
#   - variable: excel_file
#     value_selector: ['<this tool id>', files]
#     value_type: array[file]
```

**Important caveats**:

- The list is **observed-not-exhaustive**. Dify does not publish a sandbox
  spec and sandbox config may differ between Dify Cloud and self-host
  deployments. A module missing here in one workspace may exist in another.
- To probe additional modules in YOUR target workspace, import + run
  [templates/probes/stdlib_check.yml](../templates/probes/stdlib_check.yml).
  The probe is read-only (no network, no filesystem) and safe to re-run.
  Paste the output into your project's `spec_todo/` or equivalent.

## Cross-references

- [skills/mango-svip/references/constraints.md](../skills/mango-svip/references/constraints.md)
  — upstream authoritative constraints (§1-§10)
- [docs/plugin-capabilities.md](plugin-capabilities.md) — plugin per-tool
  behavior matrix
- [templates/probes/stdlib_check.yml](../templates/probes/stdlib_check.yml)
  — probe workflow for per-workspace verification
- [AGENTS.md §8](../AGENTS.md) — doc index for agents

## Adding new findings to this file

A finding belongs here when ALL of:

1. Originates in this repo's `projects/*/workflows/` (not a generic Dify
   behavior).
2. Has a checked-in probe / test workflow that reproduces it.
3. Is **net-new** vs upstream `constraints.md` (don't duplicate; add a row
   only when the upstream cell would be misleading without the addition).

If the finding is general enough to apply outside this repo, upstream it to
`mango-svip/dify-workflow-skills` and remove from here.
