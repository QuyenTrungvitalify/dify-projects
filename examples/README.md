# Examples — fully-worked Dify projects

Read-only **end-to-end examples** showing how a complete Dify project looks once
built with this base workspace. Unlike `templates/patterns/` (skeletons with
`# TODO:` markers), examples here have real prompts, real code, and concrete
node configurations that can be imported and tested with minimal edits.

Use these to:
- See what a "done" project structure looks like
- Copy + adapt as a starting point for similar tasks
- Verify the toolchain works end-to-end (validate + lint + JSON schema all pass)

## Index

| Folder | Use case | Pattern source | Nodes |
|---|---|---|---|
| [md_en2ja/](md_en2ja/) | Translate English markdown → Japanese, preserving code blocks via mask/restore | `templates/patterns/multi-step-llm.yml` (simplified to 1 LLM) | 5 (start → code-mask → llm → code-restore → end) |

## Conventions

Each example is a self-contained legacy single-tier layout (kept as-is for one-command import).
Note: `init_project.py` now scaffolds the **2-tier** `projects/<project>/<workflow>/` layout
(spec 030) — the tree below is this example's own shape, not what the scaffolder produces today:

```
examples/<slug>/
├── README.md               # What this example does + how to import
├── .dify-workspace.yaml    # DSL version + project metadata
├── .gitignore              # envs/*.env etc.
├── workflows/
│   └── main.yml            # The actual Dify DSL — importable as-is
├── prompts/                # (Empty unless example uses externalized prompts)
├── inputs/                 # Sample input files for testing
├── tests/fixtures/         # Reusable test fixtures
└── envs/dev.env.example    # Env template — never commit a real .env
```

The `workflows/main.yml` in each example:
- Passes `tools/dify_base/validate_workflow.py`
- Passes JSON Schema (`schemas/dify-dsl-0.6.0.json`)
- Passes `tools/dify_base/lint_refs.py`
- Pre-commit hooks green

## How to use an example

```bash
# 1. Read the example's README to understand the task + decisions
cat examples/md_en2ja/README.md

# 2. Read the actual workflow YAML (it's importable as-is)
cat examples/md_en2ja/workflows/main.yml

# 3. Import into Dify workspace
#    Studio → Import DSL file → upload workflows/main.yml

# 4. Customize: model.provider + model.name + plugin hash for YOUR workspace
#    (see AGENTS.md §4.3 "How to obtain a real plugin hash")

# 5. Optional — copy as starting point for a new project of yours (2-tier, spec 030)
.venv/bin/python tools/dify_base/init_project.py \
    --non-interactive --kind project --name "My Variant" --slug my_variant
.venv/bin/python tools/dify_base/init_project.py \
    --non-interactive --kind workflow --project my_variant --name "Main" --slug main
cp examples/md_en2ja/workflows/main.yml projects/my_variant/main/workflows/main.yml
# Then edit prompts / model / etc.
```

## Adding a new example

Examples grow organically from real work — promote a `projects/<project>/<workflow>/` that:
1. Has reusable patterns or non-trivial techniques (mask/restore, etc.)
2. Passes all validation hooks
3. Has no client-specific data (sanitize before promoting)

```bash
# Move (preserve git history; flatten the workflow tier into the example slug)
git mv projects/<project>/<workflow>/ examples/<slug>/
# Add an entry to this README index
```

Examples should stay **self-contained** — don't reference `projects/` paths
from example workflows or READMEs.
