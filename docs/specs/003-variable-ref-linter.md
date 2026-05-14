# Spec 003 — Variable reference linter (`lint_refs.py`)

**Status**: Approved (all Q with defaults)
**Effort**: M (~3-4h, includes edge cases + tests)
**Depends on**: —

## Decisions resolved
- Q3.1: Iteration item field — lenient (opaque) cho v1
- Q3.2: Unknown node types — skip + log warning (forward-compat)
- Q3.3: Refs trong Python code strings — treat all `{{# #}}` là Dify ref (Dify cũng parse vậy)
- Q3.4: `value_selector: [id, field]` arrays — same linter cover cả 2 forms
- Q3.5: Baseline run trên corpus 51 examples — yes, document false-positives
- Q3.6: Performance <1s/file, <5s tổng pre-commit

## Context

Per `docs/GUIDE.md` section 8, "Variable reference error" là **lỗi import #1** khi đưa Dify YAML lên workspace. Cú pháp `{{#<node_id>.<field>#}}` quá dễ typo:

- Sai `node_id` (vd ref tới node không tồn tại trong graph)
- Sai `field` (vd `text` thay vì `result`)
- Reference field không có trong `outputs` của source node
- Mismatch khi rename node mà quên update refs

Validator hiện tại (`skills/mango-svip/scripts/validate_workflow.py`) **chỉ check edge references** (source/target node IDs), KHÔNG check var refs. JSON Schema cũng không catch — vì var refs xuất hiện trong string values, không trong field structure.

**Confirmed gap** từ verify earlier:
```
grep -E "\\{\\{|reference|node_outputs|cross.?check" validate_workflow.py
→ chỉ trả 2 hit về edge reference, không có var ref
```

## Goals

1. Detect broken `{{#node_id.field#}}` refs trong:
   - LLM prompt templates
   - Code node `code` field
   - HTTP body/headers/url
   - Tool config
   - Any string field
2. Build per-node-type output schema knowledge (start.variables[], code.outputs, llm: text/usage, etc.).
3. Handle iteration body refs: `{{#<iter_id>.item#}}` and `{{#<iter_id>.item.<field>#}}`.
4. Pre-commit hook integration (hook #10).
5. Run <1s on 4 patterns + corpus.

## Non-goals

- Type checking (vd `connect: int` ref returning string).
- Validate `{{#conversation.X#}}` or `{{#env.X#}}` namespaces — these reference workspace state, không phải graph nodes.
- Auto-fix typos.
- Validate expression syntax beyond simple references (Jinja templates, conditionals).

## Design

### Algorithm

```python
def lint_file(yaml_path):
    data = yaml.safe_load(...)
    nodes = data['workflow']['graph']['nodes']

    # Build {node_id: {field_names}} map
    node_outputs = {}
    for node in nodes:
        node_outputs[node['id']] = collect_outputs(node)

    # Walk YAML text, find all {{#X.Y#}} occurrences with line numbers
    errors = []
    for line_no, line in enumerate(text.splitlines(), 1):
        for match in REF_PATTERN.finditer(line):
            node_id, field = match.groups()
            # Skip well-known special namespaces
            if node_id in {'conversation', 'env', 'sys'}:
                continue
            # Check node exists
            if node_id not in node_outputs:
                errors.append((line_no, 'unknown-node', node_id))
            # Check field exists (skip if unknown node type)
            elif node_outputs[node_id] and field not in node_outputs[node_id]:
                errors.append((line_no, 'unknown-field', f"{node_id}.{field}"))
    return errors
```

### `collect_outputs` per node type

Map dựa trên `data.type`:

| Node type | Output fields | Source |
|---|---|---|
| `start` | `variables[].variable` | data.variables[] |
| `code` | `outputs` dict keys | data.outputs |
| `llm` | `text`, `usage`, `finish_reason` | Implicit (Dify standard) |
| `http-request` | `body`, `status_code`, `headers`, `files` | Implicit |
| `tool` | `text`, `files`, `json` | Implicit |
| `document-extractor` | `text` | Implicit |
| `knowledge-retrieval` | `result` | Implicit |
| `parameter-extractor` | `parameters[].name` | data.parameters[] |
| `question-classifier` | `class_name`, `class_id` | Implicit |
| `agent` | `text`, `usage` | Implicit |
| `variable-aggregator` | `variables[].variable` (output) | data.variables[] |
| `variable-assigner` | (assigns to var, không tạo output) | — |
| `iteration` | `output_selector[-1]`, `output` (array) | data.output_selector |
| `if-else` | (branching, no outputs) | — |
| `template-transform` | `output` | Implicit |
| `list-operator` | `result`, others | Implicit |
| Unknown types | `set()` (skip validation, log warning) | — |

Pattern trên *implicit* fields rút từ:
- `skills/mango-svip/references/node_types.md`
- Inspection 4 patterns + corpus examples
- Dify source `api/core/workflow/nodes/<type>/node.py` `__init_subclass__` để confirm

### Iteration body handling

Trong iteration, code/llm/http inner node có thể ref:
- `{{#<iter_id>.item#}}` — item current (string/object)
- `{{#<iter_id>.item.<field>#}}` — nếu item là dict, field từ upstream code split

Linter logic:
- Nếu source node là `iteration`: field `item` luôn valid (treat as opaque)
- Nếu ref tới `.item.<field>`: cannot statically verify — log info, không fail
- Field `output` của iteration valid (aggregated array)

### Special namespaces (skip validation)

- `conversation.<var>` — conversation variables (workspace-level)
- `env.<var>` — environment variables
- `sys.<var>` — system variables (user_id, files, ...)

→ Linter skip, không trying validate.

### File interface

```bash
python3 tools/dify_base/lint_refs.py <yml> [<yml> ...]
# Exit 0: clean
# Exit 1: at least 1 error
# Exit 2: parse error / file not found

# Output format:
projects/foo/workflows/main.yml:42: {{#1700.text#}} → node '1700' not found in workflow
projects/foo/workflows/main.yml:55: {{#1701.tex#}} → field 'tex' not in outputs of node '1701' (known fields: ['text', 'usage'])
```

### Pre-commit hook

```yaml
- id: dify-lint-refs
  name: variable reference linter
  entry: python3 tools/dify_base/lint_refs.py
  language: system
  files: ^(templates/patterns/.*\.yml|projects/.*/workflows/.*\.yml)$
  require_serial: false
```

### Test plan

Fixtures trong `tests/fixtures/lint_refs/`:

| File | Expected outcome |
|---|---|
| `valid_simple.yml` | exit 0 |
| `bad_node_id.yml` | exit 1, 1 error: unknown-node |
| `bad_field_name.yml` | exit 1, 1 error: unknown-field |
| `iteration_item.yml` | exit 0 (item access is opaque) |
| `conversation_var.yml` | exit 0 (namespace skipped) |
| `mixed_errors.yml` | exit 1, ≥3 errors |
| `code_node_string_with_ref.py` (in code field) | exit 0 (don't false-positive on Python strings that look like refs) |

Test pytest: `tests/test_lint_refs.py` parametrize over fixtures.

Plus: run linter trên `corpus/awesome-dify-workflow/DSL/*.yml` (51 community examples) → measure false-positive rate. Goal: <5% files flagged (community examples should be mostly valid).

## Open questions

**Q3.1**: Iteration item field access — strict vs lenient?
- (a) Lenient (proposed): `{{#iter.item.X#}}` luôn pass — không catch typo
- (b) Strict: infer item structure từ upstream code outputs → catch
- Tradeoff: (b) phức tạp gấp 3x, dynamic typing nên dễ false-positive
- Đề xuất: (a) cho v1; v2 thêm (b) nếu observed bug

**Q3.2**: Unknown node types — fail or skip?
- Dify ra node type mới → linter chưa biết
- (a) Fail: an toàn nhưng block workflow with new types
- (b) Skip with warning: forward-compat, miss bug
- Đề xuất: (b) + log to stderr (visible nhưng không block)

**Q3.3**: Refs trong Python code strings — cách phân biệt thật vs string literal?
- Code node có thể chứa `prompt = "Hello {{#abc.def#}}"` (string literal, không phải ref)
- Hoặc `prompt = f"...{some_var}..."` (real interpolation, but in Python not Dify)
- (a) Treat all `{{#X.Y#}}` trong YAML là Dify ref (false-positive risk)
- (b) Skip refs trong code field (false-negative risk)
- (c) Heuristic: detect Python string boundary (complex)
- Đề xuất: (a) — Dify itself parses `{{# #}}` from code, false-positive nghĩa là code thật bị Dify parse, đáng warn

**Q3.4**: `value_selector: [node_id, field]` arrays — validate cùng cách?
- Đây là cách khai báo refs khác (block form thay vì inline `{{# #}}`)
- Used in: iteration `iterator_selector`, code `variables[].value_selector`, end `outputs[].value_selector`, ...
- (a) Bao gồm trong cùng linter (recommended — cùng failure mode)
- (b) Linter riêng cho value_selector
- Đề xuất: (a) — extend linter cover cả 2 forms

**Q3.5**: Run linter trên corpus để baseline?
- Corpus có 51 examples từ community → có thể có typo
- Đề xuất: chạy 1 lần, document any false-positive ở fixtures, fix linter logic nếu cần

**Q3.6**: Performance budget?
- 4 patterns × ~300 lines: trivial
- + projects + corpus có thể scale lên 100+ files × 500 lines
- Đề xuất: <1s per file, <5s total cho `pre-commit run --all-files`

## Acceptance criteria

- [ ] `lint_refs.py` ~150 LOC, stdlib + pyyaml only
- [ ] 7+ test fixtures cover all bug classes
- [ ] All fixtures pass expected outcome
- [ ] Run on 4 patterns → 0 errors
- [ ] Run on full corpus (51 files) → ≤5% flagged (verify each flag is real bug, not false-positive)
- [ ] Pre-commit hook đăng ký, run trong <2s trên all files
- [ ] False-positive trên Python code strings: documented + acceptable behavior

## References

- `docs/GUIDE.md` section 8 — "Variable reference error" listed as common
- `skills/mango-svip/scripts/validate_workflow.py` — current depth (edges only)
- Dify source: `api/core/workflow/utils/variable_template_parser.py` — official regex parser (good reference for our regex)
- Related: Spec 002 (AGENTS.md mentions lint_refs as critical), Spec 004 (CI runs it)
