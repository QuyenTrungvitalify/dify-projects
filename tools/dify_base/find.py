#!/usr/bin/env python3
"""Query the Dify Workshop template index.

Usage:
    python3 tools/dify_base/find.py --has iteration
    python3 tools/dify_base/find.py --has http-request --no llm
    python3 tools/dify_base/find.py --complexity Simple
    python3 tools/dify_base/find.py --plugin md_exporter
    python3 tools/dify_base/find.py --has iteration --has file-input
    python3 tools/dify_base/find.py --source corpus --has code
    python3 tools/dify_base/find.py --name translation
"""
import json
import argparse
from pathlib import Path

INDEX_PATH = Path(__file__).parent / "index.json"

COMPLEXITY_ORDER = {"Simple": 0, "Medium": 1, "Complex": 2}


def feature_key(name):
    """Normalize 'iteration' -> 'has_iteration', 'http-request' -> 'has_http_request'."""
    return f"has_{name.replace('-', '_')}"


def main():
    parser = argparse.ArgumentParser(
        description="Search Dify workflow templates",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
Common features (use with --has / --no):
  iteration, loop, code, llm, http-request, tool, if-else,
  document-extractor, knowledge-retrieval, agent, file-input,
  template-transform, parameter-extractor

Sources: patterns, library, starter, example, corpus:<name>, skill-assets, project
  --source corpus      matches every corpus:* source (namespace prefix)
  --source corpus:<n>  matches one vendored source exactly
"""
    )
    parser.add_argument("--has", action="append", default=[], metavar="FEATURE",
                        help="Must have this feature (can repeat)")
    parser.add_argument("--no", dest="without", action="append", default=[], metavar="FEATURE",
                        help="Must NOT have this feature (can repeat)")
    parser.add_argument("--complexity", choices=["Simple", "Medium", "Complex"],
                        help="Filter by complexity")
    parser.add_argument("--plugin", help="Must use this plugin (substring match)")
    parser.add_argument("--mode", help="Filter by mode (workflow / advanced-chat / agent-chat)")
    parser.add_argument("--source", metavar="SOURCE",
                        help="Filter by source. Namespace prefix-match: 'corpus' matches every "
                             "'corpus:<name>'; 'corpus:<name>' matches one. Plain tags "
                             "(patterns, library, project, …) match exactly.")
    parser.add_argument("--name", help="Substring match in app name or description")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--full", action="store_true", help="Show full info per match")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--list-features", action="store_true",
                        help="List all available features for --has/--no (with file counts)")
    args = parser.parse_args()

    if not INDEX_PATH.exists():
        print(f"❌ Index not found at {INDEX_PATH}")
        print("   Run: python3 tools/dify_base/build_index.py")
        return 1

    with open(INDEX_PATH) as f:
        entries = json.load(f)

    # --list-features: enumerate available features with counts
    if args.list_features:
        print(f"Indexed: {len(entries)} files\n")
        print("Available features for --has / --no:\n")
        feature_keys = set()
        for e in entries:
            for k in e.keys():
                if k.startswith("has_"):
                    feature_keys.add(k[len("has_"):])
        for feat in sorted(feature_keys):
            display = feat.replace("_", "-")
            count = sum(1 for e in entries if e.get(f"has_{feat}"))
            print(f"  {display:25} ({count:3} files)")
        print("\nOther filters: --complexity, --plugin, --mode, --source, --name")
        return 0

    # No-filter summary mode
    has_filter = bool(args.has or args.without or args.complexity or
                      args.plugin or args.mode or args.source or args.name)
    if not has_filter:
        print(f"📊 Dify Base — Template Index — {len(entries)} files\n")
        by_source = {}
        by_complexity = {}
        for e in entries:
            by_source[e['source']] = by_source.get(e['source'], 0) + 1
            by_complexity[e['complexity']] = by_complexity.get(e['complexity'], 0) + 1
        print("By source:")
        for k in sorted(by_source):
            print(f"  {k:14} {by_source[k]:3}")
        print("\nBy complexity:")
        for k in ["Simple", "Medium", "Complex"]:
            if k in by_complexity:
                print(f"  {k:14} {by_complexity[k]:3}")
        print("\n💡 No filter given. Try:")
        print("  python3 tools/dify_base/find.py --has iteration")
        print("  python3 tools/dify_base/find.py --has file-input --has code")
        print("  python3 tools/dify_base/find.py --complexity Simple")
        print("  python3 tools/dify_base/find.py --plugin md_exporter")
        print("  python3 tools/dify_base/find.py --list-features  (see all available filters)")
        print("  python3 tools/dify_base/find.py --help")
        return 0

    # Spec 071 S4 — a feature that exists in NO index entry is almost always a typo, and answering it
    # with the same silent "No matching templates" as a real empty result is what sent the 44-turn run
    # to grep. Distinguish the two: an UNKNOWN key errors with the valid list; a KNOWN key that simply
    # has 0 matches falls through to the normal empty result below.
    known = {k[len("has_"):] for e in entries for k in e if k.startswith("has_")}
    unknown = [h for h in (args.has + args.without) if feature_key(h)[len("has_"):] not in known]
    if unknown:
        import sys as _sys
        for u in unknown:
            print(f"❌ unknown feature: '{u}' — not present in any indexed workflow.", file=_sys.stderr)
        print(f"   Valid features: {', '.join(sorted(k.replace('_', '-') for k in known))}", file=_sys.stderr)
        print("   (See `--list-features` for counts. A feature only appears once a workflow uses it.)", file=_sys.stderr)
        return 2

    results = entries
    for h in args.has:
        results = [e for e in results if e.get(feature_key(h))]
    for w in args.without:
        results = [e for e in results if not e.get(feature_key(w))]
    if args.complexity:
        results = [e for e in results if e['complexity'] == args.complexity]
    if args.plugin:
        q = args.plugin.lower()
        results = [e for e in results if any(q in p.lower() for p in e['plugins'])]
    if args.mode:
        results = [e for e in results if e['mode'] == args.mode]
    if args.source:
        s = args.source
        # Namespace prefix-match: `--source corpus` matches every `corpus:<name>` tag, while
        # `--source corpus:<name>` (or a plain tag like `patterns`) matches exactly.
        results = [e for e in results if e['source'] == s or e['source'].startswith(s + ':')]
    if args.name:
        q = args.name.lower()
        results = [e for e in results
                   if q in e['name'].lower() or q in e['description'].lower() or q in e['file'].lower()]

    results.sort(key=lambda e: (COMPLEXITY_ORDER.get(e['complexity'], 9), e['source'], e['file']))

    if args.json:
        print(json.dumps(results[:args.limit], ensure_ascii=False, indent=2))
        return 0

    if not results:
        print("No matching templates.")
        print("Total indexed:", len(entries))
        return 0

    print(f"Found {len(results)} match{'es' if len(results) != 1 else ''}"
          f"{f' (showing first {args.limit})' if len(results) > args.limit else ''}:\n")

    for e in results[:args.limit]:
        print(f"  [{e['complexity']:7}] {e['source']:12} {e['file']}")
        types_str = ', '.join(e['node_types'][:6])
        if len(e['node_types']) > 6:
            types_str += f', ... (+{len(e["node_types"])-6})'
        print(f"            nodes={e['node_count']:3} | types: {types_str}")
        if e['plugins']:
            plugin_names = [p.split('/')[-1] for p in e['plugins']]
            print(f"            plugins: {', '.join(plugin_names)}")
        if args.full:
            if e['description']:
                print(f"            desc: {e['description'][:80]}")
            if e['name']:
                print(f"            name: {e['name'][:80]}")
            print(f"            version: {e['version']} | mode: {e['mode']}")
        print(f"            → {e['path']}")
        print()

    if len(results) > args.limit:
        print(f"... and {len(results) - args.limit} more. Use --limit to show more.")

    return 0


if __name__ == "__main__":
    exit(main())
