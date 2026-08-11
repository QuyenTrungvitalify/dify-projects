#!/usr/bin/env python3
"""report_structure.py — mechanize the structure / runnability / §4.5 facts a report needs.

Hand-counting nodes and eyeballing code-node imports is where a report on a LARGE workflow
(#5/#11/#12) silently goes wrong. This emits those facts as data so /report echoes them.

Usage:  python3 report_structure.py <yml> [<ground_truth_yml>]
Output: JSON to stdout — mode, node histogram, edge count, per-LLM model-empty check,
        per-code-node non-stdlib import scan (the §4.5 sandbox trap), dependencies state,
        and (if a ground_truth is given) its histogram + a delta.
"""
import sys, re, json

try:
    import yaml
except Exception:
    print(json.dumps({"error": "pyyaml not available"})); sys.exit(1)

# stdlib module names — the Dify code sandbox is stdlib-only (no pip). Anything else = §4.5 trap.
try:
    STDLIB = set(sys.stdlib_module_names)  # py3.10+
except AttributeError:
    STDLIB = set("re html json math random datetime time collections itertools functools "
                 "string io base64 hashlib urllib textwrap statistics decimal fractions "
                 "csv struct binascii unicodedata difflib calendar uuid".split())
STDLIB |= {"__future__"}


def nodes_of(doc):
    return (doc.get("workflow", {}).get("graph", {}) or {}).get("nodes", []) or []


def edges_of(doc):
    return (doc.get("workflow", {}).get("graph", {}) or {}).get("edges", []) or []


def histogram(doc):
    h = {}
    for n in nodes_of(doc):
        t = (n.get("data") or {}).get("type", "?")
        h[t] = h.get(t, 0) + 1
    return dict(sorted(h.items()))


def scan_code_imports(code):
    found = set()
    for line in (code or "").splitlines():
        m = re.match(r'\s*import\s+([a-zA-Z0-9_]+)', line) or re.match(r'\s*from\s+([a-zA-Z0-9_]+)', line)
        if m:
            found.add(m.group(1))
    nonstd = sorted(x for x in found if x not in STDLIB)
    return sorted(found), nonstd


def analyze_file(path):
    raw = open(path, encoding="utf-8").read()
    doc = yaml.safe_load(raw)
    app = doc.get("app", {}) or {}
    out = {
        "path": path,
        "mode": app.get("mode"),
        "name": app.get("name"),
        "node_histogram": histogram(doc),
        "node_count": len(nodes_of(doc)),
        "edge_count": len(edges_of(doc)),
        "model_nodes": [],
        "code_nodes": [],
    }
    # Every node type that carries a `model` config and so can be a runnability blocker when empty.
    MODEL_NODE_TYPES = {"llm", "parameter-extractor", "question-classifier"}
    for n in nodes_of(doc):
        d = n.get("data") or {}
        t = d.get("type")
        nid = n.get("id")
        if t in MODEL_NODE_TYPES:
            model = d.get("model") or {}
            prov, name = model.get("provider", ""), model.get("name", "")
            out["model_nodes"].append({
                "id": nid, "type": t, "title": d.get("title"),
                "provider": prov, "name": name,
                "model_empty": (not prov) or (not name),
            })
        if t == "code":
            imports, nonstd = scan_code_imports(d.get("code", ""))
            out["code_nodes"].append({
                "id": nid, "title": d.get("title"),
                "imports": imports, "nonstdlib_imports": nonstd,
                "sandbox_trap": bool(nonstd),  # §4.5: non-stdlib import → fails at runtime
            })
    # dependencies / plugin-TODO state
    deps = doc.get("dependencies", None)
    out["dependencies"] = {
        "value": deps,
        "empty": (deps == [] or deps is None),
        "has_todo_marker": bool(re.search(r'#\s*TODO[^\n]*(plugin|hash)', raw, re.I)),
    }
    # spec 037 D2 backport: knowledge-retrieval nodes with empty dataset_ids are a runnability
    # blocker too (retrieval returns nothing) — mirrors the builder's runnability.ts detector.
    out["kr_nodes"] = []
    for n in nodes_of(doc):
        d = n.get("data") or {}
        if d.get("type") == "knowledge-retrieval":
            out["kr_nodes"].append({"id": n.get("id"), "title": d.get("title"),
                                    "dataset_empty": not d.get("dataset_ids")})
    # quick runnability rollup — prose in `runnable_blockers` (human-facing, kept), plus the
    # machine-readable `runnable_blocker_classes` (spec 037 r2: the AC 2 parity test between this
    # file and apps/builder/server/lib/runnability.ts compares THIS field, never prose substrings).
    out["runnable_blockers"] = []
    classes = set()
    empty_models = [m for m in out["model_nodes"] if m["model_empty"]]
    if empty_models:
        classes.add("model_empty")
        out["runnable_blockers"].append(
            "model.provider/name empty on: " + ", ".join(f"{m['type']} {m['id']}" for m in empty_models))
    traps = [c["id"] for c in out["code_nodes"] if c["sandbox_trap"]]
    if traps:
        classes.add("sandbox_trap")
        out["runnable_blockers"].append(f"code node(s) import non-stdlib (§4.5 trap): {traps}")
    if out["dependencies"]["empty"] and out["dependencies"]["has_todo_marker"]:
        classes.add("plugin_todo")
        out["runnable_blockers"].append("unresolved plugin TODO (dependencies: [] + # TODO hash)")
    kr_empty = [k["id"] for k in out["kr_nodes"] if k["dataset_empty"]]
    if kr_empty:
        classes.add("dataset_empty")
        out["runnable_blockers"].append(f"dataset_ids empty on knowledge-retrieval: {kr_empty}")
    # spec 066 S2 — the fifth class, mirrored from apps/builder/server/lib/runnability.ts
    # (RUNNABILITY_PROBE + classifyRunnability). The AC-2 parity test compares
    # `runnable_blocker_classes` between the two implementations and HARD-FAILS on drift, so this
    # block and the TS one must stay semantically identical: an env var is a blocker only when it is
    # BOTH empty AND referenced by the graph via {{#env.NAME#}}.
    wf = (doc.get("workflow") or {}) if isinstance(doc, dict) else {}
    # BOTH Dify env-reference forms — the template one and the selector one. lint_refs.py already
    # walks both (REF_PATTERN + walk_value_selectors, SPECIAL_NS includes "env"); a probe that greps
    # only the template form yields a false negative, which is the failure 066 exists to end.
    env_ref_re = re.compile(r"{{\s*#env\.([A-Za-z0-9_]+)#\s*}}")
    graph = wf.get("graph") or {}
    referenced = set(env_ref_re.findall(yaml.safe_dump(graph, allow_unicode=True, default_flow_style=False)))

    def _walk_selectors(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "value_selector" and isinstance(v, list) and len(v) >= 2:
                    if str(v[0]) == "env":
                        referenced.add(str(v[1]))
                else:
                    _walk_selectors(v)
        elif isinstance(o, list):
            for it in o:
                _walk_selectors(it)

    _walk_selectors(graph)
    empty_env = [
        str(ev.get("name") or ev.get("variable"))
        for ev in (wf.get("environment_variables") or [])
        if isinstance(ev, dict)
        and (ev.get("name") or ev.get("variable"))
        and not ev.get("value")
        and str(ev.get("name") or ev.get("variable")) in referenced
    ]
    if empty_env:
        classes.add("env_secret_empty")
        out["runnable_blockers"].append(f"environment variable(s) declared empty but used: {empty_env}")
    out["env_vars_empty_used"] = empty_env
    # spec 095 S5 — the SIXTH class, mirrored from apps/builder/server/lib/runnability.ts
    # (RUNNABILITY_PROBE + classifyRunnability). The AC-2 parity test compares
    # `runnable_blocker_classes` between the two implementations and HARD-FAILS on drift, so this
    # block and the TS one must stay semantically identical.
    #
    # A MARKETPLACE tool node needs a workspace connection before Dify will PUBLISH the workflow
    # (the editor's own checkValid → `notAuthed`). Keyed on a slashed provider_id (org/plugin/provider),
    # which is what a marketplace plugin looks like; a Dify-native builtin has no slashes and needs no
    # connecting. Deduped per provider — two nodes using the same tool are ONE thing to connect.
    tool_providers = []
    for n in nodes_of(doc):
        d = n.get("data") or {}
        if d.get("type") != "tool":
            continue
        pid = str(d.get("provider_id") or d.get("provider_name") or "")
        if "/" in pid and pid not in tool_providers:
            tool_providers.append(pid)
    if tool_providers:
        classes.add("tool_auth")
        out["runnable_blockers"].append(f"tool provider(s) need a workspace connection: {tool_providers}")
    out["tool_providers_needing_auth"] = tool_providers
    out["runnable_blocker_classes"] = sorted(classes)
    return out


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: report_structure.py <yml> [<ground_truth_yml>]"})); sys.exit(2)
    result = {"builder": analyze_file(sys.argv[1])}
    if len(sys.argv) >= 3:
        gt = analyze_file(sys.argv[2])
        result["ground_truth"] = {"path": gt["path"], "mode": gt["mode"],
                                  "node_histogram": gt["node_histogram"], "node_count": gt["node_count"]}
        bh, gh = result["builder"]["node_histogram"], gt["node_histogram"]
        keys = sorted(set(bh) | set(gh))
        result["histogram_delta"] = {k: {"builder": bh.get(k, 0), "ground_truth": gh.get(k, 0)} for k in keys}
        result["mode_match"] = (result["builder"]["mode"] == gt["mode"])
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
