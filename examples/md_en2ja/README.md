# Markdown EN→JA Translator

Translate English Markdown documents to Japanese **while preserving code blocks
unchanged** — using a stdlib-only "mask → translate → restore" pattern.

**App type**: workflow · **DSL version**: 0.6.0 · **Pattern source**: [`templates/patterns/multi-step-llm.yml`](../../templates/patterns/multi-step-llm.yml) (simplified to 1 LLM)

## Why this is a useful example

The naive approach — feeding raw Markdown to an LLM and asking for translation —
breaks badly: LLMs love to "fix" code (rename identifiers, translate strings
inside code, etc.). The mask/restore pattern solves it deterministically:

1. **Mask** code blocks (fenced ` ``` ` AND inline ` ` `) with numbered placeholders
   like `[[CODE_BLOCK_0]]` before sending to the LLM.
2. **Translate** the masked text — LLM sees plain prose with opaque tokens.
3. **Restore** original code blocks back into their placeholders.

LLM never sees the code → cannot mistranslate it.

## Flow

```
Start (markdown_en: string)
  → Code (mask): extract fenced ``` + inline ` blocks, replace with [[CODE_BLOCK_N]] placeholders
  → LLM:        translate only the natural-language prose to Japanese
  → Code (restore): swap [[CODE_BLOCK_N]] tokens back to their original code
  → End (markdown_ja: string)
```

5 nodes. ~80 lines of stdlib Python across the two code nodes.

## How to import

```bash
# 1. Read the YAML to understand the structure
cat workflows/main.yml

# 2. Validate locally (should pass clean)
cd /Users/quyenbt/Desktop/MyProjects/dify-projects
.venv/bin/python tools/dify_base/validate_workflow.py examples/md_en2ja/workflows/main.yml
.venv/bin/python tools/dify_base/lint_refs.py examples/md_en2ja/workflows/main.yml

# 3. Import into your Dify workspace
#    Dify Studio → top-right "+" → Import DSL file → upload workflows/main.yml

# 4. Before saving, customize:
#    - The LLM node's `model.provider` + `model.name` (currently empty —
#      pick from plugins installed in your workspace)
#    - The plugin dependency: add the marketplace hash for your chosen LLM
#      provider (see AGENTS.md §4.3 "How to obtain a real plugin hash")

# 5. Test the imported app
#    Click "Run" → paste sample Markdown with code blocks → check Japanese output
#    has the code blocks preserved verbatim.
```

## Sample input

```markdown
# Greet the user

This function takes a name and returns a greeting in English.

```python
def greet(name: str) -> str:
    return f"Hello, {name}!"
```

Call it like `greet("Alice")` — make sure not to pass `None`.
```

Expected Japanese output (LLM-dependent, but code blocks should be byte-identical):

```markdown
# ユーザーに挨拶する

この関数は名前を受け取り、英語で挨拶を返します。

```python
def greet(name: str) -> str:
    return f"Hello, {name}!"
```

`greet("Alice")` のように呼び出します。`None` を渡さないように注意してください。
```

## Limitations

- **Inline code spans inside text are also masked** — the LLM sees `[[CODE_BLOCK_3]]`
  instead of `greet("Alice")`, which may make sentences feel awkward to translate.
  For prose-heavy docs this is fine. If your docs are code-heavy, consider only
  masking fenced blocks.
- **No streaming output** — workflow returns the full translation at once.
  For very long documents (>4k tokens), add a chunking layer (see
  `templates/patterns/file-iteration.yml`).
- **Single language pair** — pre-baked English → Japanese. To make it generic,
  add a `target_lang` Start variable and template it into the LLM prompt.

## Files

```
md_en2ja/
├── README.md                ← this file
├── .dify-workspace.yaml     ← project metadata (dsl_version, dify_tag)
├── .gitignore               ← envs/*.env etc.
├── workflows/
│   └── main.yml             ← the importable DSL (5 nodes)
├── prompts/                 ← (empty — prompts are inline in the LLM node)
├── inputs/                  ← (empty — paste samples directly into Dify UI to test)
├── tests/fixtures/          ← (empty — add JSON fixtures here when wiring pytest harness)
└── envs/dev.env.example     ← workspace URL + API key template
```

## Adapt this example for your project

```bash
# Scaffold a new project, then drop the YAML in as a starting point.
.venv/bin/python tools/dify_base/init_project.py \
    --non-interactive --name "My Variant" --slug my_variant
cp examples/md_en2ja/workflows/main.yml projects/my_variant/workflows/main.yml
# Edit prompts, model, mask regex, etc. in your copy.
```

## Sources

- Base workspace: [README.md](../../README.md)
- Pattern source: [templates/patterns/multi-step-llm.yml](../../templates/patterns/multi-step-llm.yml)
- Plugin hash how-to: [AGENTS.md §4.3](../../AGENTS.md)
- Schema: [schemas/dify-dsl-0.6.0.json](../../schemas/dify-dsl-0.6.0.json)
