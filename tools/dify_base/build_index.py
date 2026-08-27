#!/usr/bin/env python3
"""Build searchable index of all Dify workflow YAMLs in the base workspace.

Scans templates/, corpus/, skill assets, and any project workflows.
Outputs:
  - tools/dify_base/index.json (machine-readable)
  - INDEX.md (human-readable, sorted by source + complexity)

Usage:
    python3 tools/dify_base/build_index.py
"""
import json
import subprocess
import sys
import yaml
from pathlib import Path
from collections import Counter
from urllib.parse import quote

# dify-projects/tools/dify_base/build_index.py -> parent.parent.parent = base root
BASE = Path(__file__).parent.parent.parent

# Read the source registry (spec 022 D1) for registry-driven corpus discovery.
sys.path.insert(0, str(Path(__file__).parent))
from sources import load_sources, license_problems, missing_field_problems  # noqa: E402
from enrich import merge_enrichment  # noqa: E402 — folds the offline enrichment layer in (spec 076 E1)


def _md_link_target(abs_path):
    """Turn an absolute path into a repo-relative, URL-safe Markdown link target.

    Parentheses, spaces, and CJK chars in filenames can break Markdown links;
    quote() keeps '/' as-is so the relative structure stays readable.
    """
    rel = Path(abs_path).resolve().relative_to(BASE.resolve())
    return quote(str(rel), safe='/')

# Static (non-corpus) scan roots. Corpus roots are registry-driven (see scan_targets()).
STATIC_SCAN = [
    (BASE / "templates" / "patterns", "patterns"),
    (BASE / "templates" / "library", "library"),   # spec 022: promoted, provenance-stamped curated tier
    (BASE / "templates" / "_base", "starter"),
    (BASE / "examples", "example"),
    (BASE / "skills" / "mango-svip" / "assets", "skill-assets"),
    (BASE / "skills" / "Tomatio13" / "example", "skill-assets"),
    (BASE / "projects", "project"),
]


def scan_targets():
    """Return (scan_dir, source_tag, glob) triples to index.

    Static roots scan ``*.yml`` recursively; corpus roots come from the source registry
    (corpus/sources.yml) — each tagged ``corpus:<name>`` and scanned by its ``dsl_glob`` so
    INDEX/find.py show per-source provenance (spec 022 D3).

    Sources flagged ``indexed: false`` (spec 023) are skipped here — still cloned/refreshed/
    promotable, just absent from the browse index. This branch is the sole indexing consumer
    of the flag (write_markdown only annotates the note).
    """
    targets = [(d, tag, "*.yml") for d, tag in STATIC_SCAN]
    for s in load_sources():
        if not s["indexed"]:
            continue
        targets.append((BASE / "corpus" / s["name"], f"corpus:{s['name']}", s["dsl_glob"]))
    return targets

INTERESTING_NODE_TYPES = [
    "iteration", "loop", "code", "llm", "http-request", "tool",
    "if-else", "document-extractor", "knowledge-retrieval", "agent",
    "template-transform", "variable-aggregator", "variable-assigner",
    "assigner", "parameter-extractor", "question-classifier",
    "list-operator", "answer",
]


def analyze(yaml_path):
    # Spec 075 S4: the parse itself may raise on broken YAML — let it PROPAGATE so collect_entries can
    # name the file (a real defect worth fixing). A valid-but-non-workflow YAML (not a dict) stays a
    # silent skip: sources may legitimately carry non-workflow YAML and naming those would be noise.
    with open(yaml_path, encoding='utf-8') as f:
        data = yaml.safe_load(f)

    if not isinstance(data, dict):
        return None

    app = data.get('app') or {}
    workflow = data.get('workflow') or {}
    graph = workflow.get('graph') or {}
    nodes = graph.get('nodes') or []

    node_types = []
    has_file_input = False
    has_trigger = False
    trigger_variants: set[str] = set()  # spec 071 S3 — exact trigger-* types seen (webhook/schedule/plugin)
    for n in nodes:
        d = n.get('data') or {}
        ntype = d.get('type') or ''
        if not ntype or ntype in ('iteration-start', 'loop-start', 'custom-iteration-start', 'custom-loop-start'):
            continue
        node_types.append(ntype)
        # Spec 057: computed key (NOT an INTERESTING_NODE_TYPES append) so `find.py --has trigger`
        # matches any trigger-* entry (schedule/webhook/plugin).
        # Spec 071 S3: ALSO record the exact variant, so `find.py --has trigger-webhook` can find a
        # webhook example instead of returning silence (the 44-turn run queried exactly that and got
        # "No matching templates" → fell to denied greps). Additive — has_trigger (the family) stays.
        if ntype.startswith('trigger-'):
            has_trigger = True
            trigger_variants.add(ntype)
        if ntype == 'start':
            for v in (d.get('variables') or []):
                if v.get('type') in ('file', 'file-list'):
                    has_file_input = True

    type_counter = Counter(node_types)
    unique_types = sorted(type_counter.keys())

    plugins = []
    for dep in (data.get('dependencies') or []):
        if isinstance(dep, dict):
            pid = (dep.get('value') or {}).get('marketplace_plugin_unique_identifier', '')
            if pid:
                name = pid.split(':')[0]
                plugins.append(name)

    node_count = len(node_types)
    has_iter = 'iteration' in type_counter or 'loop' in type_counter
    if node_count <= 4 and not has_iter:
        complexity = "Simple"
    elif node_count >= 10 or (has_iter and node_count >= 7):
        complexity = "Complex"
    else:
        complexity = "Medium"

    info = {
        "file": yaml_path.name,
        "path": str(yaml_path),
        "name": app.get('name', '') or '',
        "description": ((app.get('description') or '').strip())[:100],
        "mode": app.get('mode', '') or '',
        "version": str(data.get('version', '') or ''),
        "node_count": node_count,
        "node_types": unique_types,
        "complexity": complexity,
        "has_file_input": has_file_input,
        "has_trigger": has_trigger,
        "plugins": plugins,
    }
    for t in INTERESTING_NODE_TYPES:
        info[f"has_{t.replace('-', '_')}"] = (t in type_counter)
    # Spec 071 S3 — per-variant trigger keys (has_trigger_webhook/_schedule/_plugin). Only emit the
    # ones actually seen, so `--list-features` stays honest about what the index really contains.
    for v in trigger_variants:
        info[f"has_{v.replace('-', '_')}"] = True
    return info


def write_markdown(entries, out_path):
    src_list = load_sources()
    if src_list:
        # Hidden sources (spec 023) are still vendored, so they belong in this note — but mark them
        # `intake-only` so a reader isn't left hunting for table rows that were deliberately excluded.
        srcs = "; ".join(
            f"`corpus:{s['name']}` ({s['license']}{'' if s['indexed'] else ', intake-only'})"
            for s in src_list
        )
        registry_note = (f"**Vendored sources** (registry [`corpus/sources.yml`](corpus/sources.yml)): {srcs}. "
                         "Add a source = one registry entry. `intake-only` = tracked + promotable but not indexed.")
    else:
        registry_note = "**Vendored sources**: none registered — see [`corpus/sources.yml`](corpus/sources.yml)."
    lines = [
        "# Dify Base — Template Index",
        "",
        f"Auto-generated by [`tools/dify_base/build_index.py`](tools/dify_base/build_index.py). **{len(entries)} files indexed.**",
        "",
        "**Tip**: Use `tools/dify_base/find.py --has <feature>` for quick CLI search. See [docs/GUIDE.md](docs/GUIDE.md) for full guide.",
        "",
        "**Sources**: `patterns` / `library` / `starter` / `example` / `project` are curated workspace files — "
        "English, current DSL version, copy-paste-ready. `corpus:<name>` and `skill-assets` are read-only "
        "third-party clones used as *reference only* — they are multilingual (often Chinese, as the "
        "prompt bodies define behaviour) and may use older DSL versions, so adapt before reuse. "
        "Precedence when picking an example: `patterns` > `library` > `project` > `corpus:*` > `skill-assets`.",
        "",
        registry_note,
        "",
        "## Main Table",
        "",
        "Sorted by source, then complexity.",
        "",
        "| Source | File | Nodes | Complexity | Key Features | Plugins | Description |",
        "|---|---|---|---|---|---|---|",
    ]

    order = {"Simple": 0, "Medium": 1, "Complex": 2}
    sorted_entries = sorted(entries, key=lambda x: (x['source'], order.get(x['complexity'], 9), x['file']))

    for e in sorted_entries:
        features = []
        if e['has_iteration']: features.append('iteration')
        if e['has_loop']: features.append('loop')
        if e['has_file_input']: features.append('file-in')
        if e['has_trigger']: features.append('trigger')
        if e['has_http_request']: features.append('http')
        if e['has_code']: features.append('code')
        if e['has_llm']: features.append('llm')
        if e['has_if_else']: features.append('if-else')
        if e['has_tool']: features.append('tool')
        if e['has_document_extractor']: features.append('doc-extract')
        if e['has_knowledge_retrieval']: features.append('rag')
        if e['has_agent']: features.append('agent')
        if e['has_parameter_extractor']: features.append('param-extract')
        if e['has_template_transform']: features.append('jinja')
        features_str = ', '.join(features) if features else '-'

        plugins_str = ', '.join(p.split('/')[-1] for p in e['plugins'][:2]) if e['plugins'] else '-'
        if len(e['plugins']) > 2:
            plugins_str += f' (+{len(e["plugins"])-2})'

        # Spec 076 E1: prefer the English enrichment summary so the browse table stops showing raw
        # Chinese/empty descriptions; fall back to the raw description, then the app name.
        desc = (e.get('summary_en') or e['description'] or e['name'] or '-').replace('|', '\\|').replace('\n', ' ')[:50]

        file_display = e['file'].replace('|', '\\|')
        file_link = f"[{file_display}]({_md_link_target(e['path'])})"

        lines.append(
            f"| `{e['source']}` | {file_link} | {e['node_count']} | {e['complexity']} | {features_str} | {plugins_str} | {desc} |"
        )

    lines.extend(["", "## By Feature", ""])

    feature_groups = {
        "Iteration / Loop (bulk processing)": ["has_iteration", "has_loop"],
        "File Input (upload)": ["has_file_input"],
        "Trigger entry (schedule/webhook — self-running)": ["has_trigger"],
        "Document Extractor (parse file)": ["has_document_extractor"],
        "HTTP Request (call external API)": ["has_http_request"],
        "Code Node (Python/JS)": ["has_code"],
        "LLM Node": ["has_llm"],
        "If-Else (branching)": ["has_if_else"],
        "Tool (call plugin)": ["has_tool"],
        "Knowledge Retrieval (RAG)": ["has_knowledge_retrieval"],
        "Agent": ["has_agent"],
        "Parameter Extractor": ["has_parameter_extractor"],
        "Template Transform (Jinja2)": ["has_template_transform"],
    }

    for label, keys in feature_groups.items():
        matches = [e for e in entries if any(e.get(k) for k in keys)]
        if not matches:
            continue
        lines.append(f"### {label} — {len(matches)} files")
        lines.append("")
        for e in sorted(matches, key=lambda x: (order.get(x['complexity'], 9), x['file'])):
            lines.append(f"- `{e['source']}` / [{e['file']}]({_md_link_target(e['path'])}) — {e['complexity']}, {e['node_count']} nodes")
        lines.append("")

    lines.extend(["## By Complexity", ""])
    for level in ["Simple", "Medium", "Complex"]:
        matches = [e for e in entries if e['complexity'] == level]
        if not matches:
            continue
        lines.append(f"### {level} — {len(matches)} files")
        lines.append("")
        for e in sorted(matches, key=lambda x: x['file']):
            lines.append(f"- `{e['source']}` / [{e['file']}]({_md_link_target(e['path'])}) — {e['node_count']} nodes")
        lines.append("")

    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))


#: The builder's reserved scratch project — never indexed (see collect_entries).
DRAFTS_DIR = BASE / "projects" / "_drafts"


def _filter_gitignored(paths):
    """Drop paths git would ignore, so the index mirrors the repo rather than local scratch.

    This used to be what kept builder scratch out of the index: QA runs land in projects/_drafts/,
    which was gitignored (spec 011 R2). Spec 112 un-ignored that folder — git has to SEE it for the
    builder's confinement check to police cross-workflow writes there — so the drafts exclusion moved
    to collect_entries() as an explicit DRAFTS_DIR test. What remains here is the general net: any
    OTHER path under projects/ that git ignores (env files, per-project throwaways someone adds) still
    has no business in a tracked index. Safe fallback: if git is unavailable (or errors), keep all
    paths — the index is never worse than today.
    """
    if not paths:
        return paths
    try:
        proc = subprocess.run(
            # core.quotePath=false keeps non-ASCII paths unquoted so the output matches the
            # input strings (git otherwise octal-escapes them, breaking the membership test).
            ["git", "-C", str(BASE), "-c", "core.quotePath=false", "check-ignore", "--stdin"],
            input="\n".join(str(p) for p in paths),
            capture_output=True, text=True,
        )
    except Exception:
        return paths
    if proc.returncode not in (0, 1):  # 0 = some ignored, 1 = none ignored, >1 = error
        return paths
    ignored = {line.strip() for line in proc.stdout.splitlines() if line.strip()}
    return [p for p in paths if str(p) not in ignored]


def collect_entries():
    """Scan every target and return (entries, broken). Shared by main() and tests.

    `broken` = [(path, reason)] for files whose YAML FAILED to parse — spec 075 S4 names them instead
    of folding them into an anonymous count. Valid YAML that simply isn't a workflow (analyze → None)
    is skipped silently, so a source's non-workflow YAML never adds noise.
    """
    all_entries = []
    broken = []
    for scan_dir, source_tag, pattern in scan_targets():
        if not scan_dir.exists():
            continue
        # Registry globs (e.g. "DSL/**/*.yml") are anchored; bare "*.yml" scans recursively to
        # catch YAMLs in subdirs (e.g., corpus/.../图文知识库/).
        matches = sorted(scan_dir.glob(pattern) if "/" in pattern else scan_dir.rglob(pattern))
        # The gitignore filter (spec 011 R2) targets ONLY projects/, where the builder writes
        # gitignored QA scratch. corpus/ and skills/ are gitignored-by-design read-only clones we
        # DO want indexed — filtering them silently dropped real reference workflows (every
        # ASCII-named file, since git check-ignore quotes only non-ASCII paths).
        if source_tag == "project":
            # Builder scratch lands in the reserved `projects/_drafts/` project (spec 030). It used to
            # be excluded here for free, because it was gitignored and `_filter_gitignored` swept it
            # up. Spec 112 un-ignored it (git had to be able to SEE the folder for the builder's
            # cross-workflow confinement check to work there at all), so the exclusion has to be said
            # out loud — by name, which is what it always meant. 26 throwaway YAMLs next to 47 real
            # workflows would be the majority of the index.
            matches = [p for p in matches if DRAFTS_DIR not in p.parents]
            matches = _filter_gitignored(matches)
        for yml in matches:
            try:
                info = analyze(yml)
            except Exception as e:  # genuine parse failure — name it (S4), don't swallow into a count
                reason = (str(e).splitlines()[0] if str(e).strip() else type(e).__name__)[:200]
                broken.append((str(yml), reason))
                continue
            if info:
                info['source'] = source_tag
                all_entries.append(info)
            # else: valid YAML but not a workflow → silent skip (no noise)
    return all_entries, broken


def main():
    # Spec 075 S3 — validate the registry at BUILD time (runtime), not just in the sources.py CLI.
    # A non-permissive license BLOCKS (the promoted templates are derivatives — spec 022 D7); a missing
    # required field only WARNS, so an incomplete legacy entry never turns a routine rebuild red. This
    # runs AFTER the venv exists (build_index is a Python step); setup.sh's pre-venv bootstrap is
    # untouched, per §2. `update_corpus.sh` reaches the same gate because it calls build_index.py.
    registry = load_sources()
    blockers = list(license_problems(registry))
    warnings = list(missing_field_problems(registry))
    for w in warnings:
        print(f"  ⚠ registry: {w}", file=sys.stderr)
    if blockers:
        print("✗ registry has non-redistributable sources — refusing to build the index:", file=sys.stderr)
        for b in blockers:
            print(f"  - {b}", file=sys.stderr)
        return 1

    all_entries, broken = collect_entries()

    # Spec 076 E1: fold the offline, English enrichment layer (summary_en/tags/when_to_use/gotchas)
    # onto each entry so intent-based lookup can see capabilities the raw (Chinese/empty) description
    # hides. Degrades to nothing when enrichment.json is absent; a stale orig_sha256 only WARNS.
    stale = []
    all_entries = merge_enrichment(all_entries, on_stale=stale.append)
    for k in sorted(set(stale)):
        print(f"  ⚠ enrichment stale (source changed since enriched — re-run enrich.py): {k}", file=sys.stderr)

    out_json = BASE / "tools" / "dify_base" / "index.json"
    out_json.parent.mkdir(parents=True, exist_ok=True)
    with open(out_json, 'w', encoding='utf-8') as f:
        json.dump(all_entries, f, ensure_ascii=False, indent=2)
    print(f"✓ Wrote {out_json.relative_to(BASE)} ({len(all_entries)} entries)")

    out_md = BASE / "INDEX.md"
    write_markdown(all_entries, out_md)
    print(f"✓ Wrote {out_md.relative_to(BASE)}")

    # Spec 075 S4 — name every file that FAILED to parse (a real defect), and say "0" explicitly so a
    # clean run reads differently from one that dropped N files. Warn-only: intake is reference-only
    # (update_corpus.sh), so a broken corpus YAML must not fail the build — it must not hide either.
    if broken:
        print(f"  ⚠ {len(broken)} file(s) FAILED to parse — named so they can be fixed (spec 075 S4):",
              file=sys.stderr)
        for path, reason in broken:
            try:
                rel = str(Path(path).relative_to(BASE))
            except ValueError:
                rel = path
            print(f"    - {rel}: {reason}", file=sys.stderr)
    else:
        print("  (0 files failed to parse)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
