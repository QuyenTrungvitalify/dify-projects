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
| `openpyxl` | [test_openpyxl_feasibility.yml](../projects/eiken_stem_proofread/workflows/test_openpyxl_feasibility.yml) — `ImportError: No module named 'openpyxl'` | Code → Tool node bridge: build markdown table in Code, pipe to `bowenliang123/md_exporter` `md_to_xlsx` (see [plugin-capabilities.md](plugin-capabilities.md) for caveats around inline formatting). |

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
