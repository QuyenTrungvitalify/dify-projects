# Linter-rule candidates (spec 050 D2a)

Mechanical, checkable rules surfaced by promotions/incidents, waiting to be folded into an
EXISTING linter (013/049 discipline — never a new script). One bullet per rule; dedup key is
the exact rule statement. When a rule ships, move its bullet to the shipping spec's log.

- environment_variables entries must use 'name:' (not 'variable:', the start-node input shape) — Dify import 400s 'missing name' — cite: `api/factories/variable_factory.py build_environment_variable_from_mapping`
- A downstream ref to a bowenliang123/md_exporter md_to_xlsx (or md_to_csv/md_to_docx) tool node MUST select its `files` field (value_type array[file]); the tool node declares NO outputs: block, so a ref to `.text`/`.output`/`.result` on it is a dangling ref. — cite: `docs/runtime-supplement.md §1-supplement (md_to_xlsx tool node — no outputs:, downstream reads `files`)`
- A Code node feeding md_text of md_to_xlsx must build a Markdown TABLE string that includes both a header row and the `| --- |` separator row (line 2); a bare list of `|`-lines yields zero columns in the produced .xlsx. — cite: `docs/plugin-capabilities.md (md_exporter Markdown-table inline-formatting) + projects/_drafts/exel_pdf_url_excel build`
- Code nodes must not import openpyxl (or other non-sandbox modules) to build spreadsheets; use the Code→Tool md_to_xlsx bridge instead. — cite: `docs/runtime-supplement.md §1-supplement (openpyxl confirmed-missing; probe test_openpyxl_feasibility.yml)`
- A code node that consumes a document-extractor's `text` output must handle BOTH array[string] and a bare string (isinstance(x, list) guard) — document-extractor returns ArrayStringSegment when its input file variable is a list (multi-file / is_array_file) but a plain string for a single File, so code that assumes one shape crashes on the other. — cite: `vendor/dify-src/api/core/workflow/nodes/document_extractor/node.py _run (list input -> ArrayStringSegment; single File -> str)`
