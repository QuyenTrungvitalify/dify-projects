#!/usr/bin/env python3
"""trace_phases.py — extract the PROCESS (not just the artifact) of each Builder phase.

Given a taskId, reads apps/builder/.runs/<taskId>/task.json -> sessionIds {analyze,spec,implement},
locates each phase's Claude session transcript (~/.claude/projects/*/<sessionId>.jsonl), and emits
structured JSON: the tool-call sequence, bash commands, file writes/reads, tool errors, retries, and
the phase's final conclusion — plus a few phase-specific procedure checks. Phase ④ (test) is backend-run
(no Claude session) so it has no transcript.

Usage:  python3 trace_phases.py <taskId> [--repo <root>] [--full]
        --full  include each phase's full final_text (default: last 600 chars)
Output: JSON to stdout. Exit 0 even if some transcripts are missing (found:false per phase).
"""
import json, os, sys, glob

def find_transcript(session_id):
    if not session_id:
        return None
    home = os.path.expanduser("~/.claude/projects")
    hits = glob.glob(os.path.join(home, "*", f"{session_id}.jsonl"))
    return hits[0] if hits else None

def arg_hint(name, inp, full=False):
    if not isinstance(inp, dict):
        return ""
    for k in ("command", "file_path", "path", "pattern", "url", "old_string"):
        v = inp.get(k)
        if isinstance(v, str) and v:
            return v if full else (v[:140])
    return ""

def classify_error(cmd, msg):
    """Precisely label each is_error so the report echoes a fact, not a freehand guess."""
    m = (msg or "").lower()
    c = cmd or ""
    if "not in the builder allow-set" in m:
        return "allow-set (script run by absolute path / not whitelisted)"
    if "cancelled: parallel tool call" in m:
        return "parallel-batch cancellation (collateral, benign)"
    if "file does not exist" in m or "no such file" in m:
        return "file-not-found probe (benign)"
    if "dangerous executable" in m:
        return "dangerous-executable rejection"
    if "shell metacharacter" in m:
        # the generic harness message doesn't say which — inspect the command itself
        if "&&" in c or "||" in c or ";" in c:
            return "shell-metachar: command chaining (&& / ; / ||)"
        if "|" in c:
            return "shell-metachar: pipe (|)"
        if ">" in c or "<" in c:
            return "shell-metachar: redirect (> / <)"
        if "$(" in c or "`" in c:
            return "shell-metachar: subshell ($() / ``)"
        if "*" in c or "?" in c or "{" in c:
            return "shell-metachar: glob/expansion (* ? {})"
        return "shell-metachar (unclassified)"
    if "exit code" in m and "passed" not in m:
        return "NON-ZERO EXIT — verify benign (recoverable) vs REAL failure"
    return "other (read the message)"


def parse_transcript(path, full=False):
    tools, bash, writes, reads, errors = [], [], [], [], []
    final_text = ""
    # map tool_use id -> (name, command/file) so we can attribute + classify tool_result errors
    id2name = {}
    id2cmd = {}
    for line in open(path, encoding="utf-8", errors="replace"):
        line = line.strip()
        if not line:
            continue
        try:
            o = json.loads(line)
        except Exception:
            continue
        msg = o.get("message", o)
        role = msg.get("role") or o.get("type")
        content = msg.get("content")
        if isinstance(content, str):
            if role == "assistant" and content.strip():
                final_text = content
            continue
        if not isinstance(content, list):
            continue
        for b in content:
            if not isinstance(b, dict):
                continue
            t = b.get("type")
            if t == "tool_use":
                name = b.get("name", "?")
                inp = b.get("input", {})
                id2name[b.get("id")] = name
                id2cmd[b.get("id")] = (inp.get("command") or inp.get("file_path")
                                       or inp.get("pattern") or inp.get("path") or "")
                hint = arg_hint(name, inp, full)
                tools.append({"name": name, "arg": hint})
                if name == "Bash":
                    bash.append(inp.get("command", "") if full else inp.get("command", "")[:200])
                elif name in ("Write", "Edit", "NotebookEdit"):
                    writes.append(inp.get("file_path", ""))
                elif name == "Read":
                    reads.append(inp.get("file_path", ""))
            elif t == "tool_result":
                is_err = b.get("is_error")
                if is_err:
                    rc = b.get("content")
                    if isinstance(rc, list):
                        rc = " ".join(x.get("text", "") for x in rc if isinstance(x, dict))
                    tid = b.get("tool_use_id")
                    cmd = id2cmd.get(tid, "")
                    errors.append({"tool": id2name.get(tid, "?"),
                                   "command": (cmd if full else cmd[:120]),
                                   "class": classify_error(cmd, str(rc)),
                                   "snippet": str(rc)[:200]})
            elif t == "text" and role == "assistant":
                if b.get("text", "").strip():
                    final_text = b["text"]
    return {
        "tool_calls": len(tools),
        "tools": tools,
        "bash": bash,
        "writes": writes,
        "reads": reads,
        "errors": errors,
        "final_text": final_text if full else final_text[-600:],
    }

def phase_checks(phase, data):
    """Cheap, phase-specific procedure signals. The skill does the judging; these are facts."""
    bash = " \n".join(data.get("bash", []))
    writes = data.get("writes", [])
    wrote_yaml = any(w.endswith((".yml", ".yaml")) for w in writes)
    c = {"wrote_yaml": wrote_yaml, "write_targets": writes}
    if phase == "analyze":
        # Analyze must NOT touch workflow files; should only write analyze.json
        c["touched_workflow_file"] = wrote_yaml
        c["only_wrote_analyze_json"] = all("analyze.json" in w for w in writes) if writes else False
    if phase == "spec":
        # Spec should consult the pattern library before choosing; must NOT write yml or mint ids
        c["searched_patterns"] = ("find.py" in bash) or any("templates/patterns" in r for r in data.get("reads", []))
        c["minted_ids"] = "generate_id.py" in bash
        c["wrote_yaml_violation"] = wrote_yaml
    if phase == "implement":
        c["ran_generate_id"] = "generate_id.py" in bash
        c["ran_validate"] = "validate_workflow.py" in bash
        c["ran_lint_refs"] = "lint_refs.py" in bash
        c["ran_lint_plugin_hashes"] = "lint_plugin_hashes.py" in bash
        c["validate_runs"] = bash.count("validate_workflow.py")
        c["lint_refs_runs"] = bash.count("lint_refs.py")
        c["wrote_yaml"] = wrote_yaml
    return c

def main():
    args = [a for a in sys.argv[1:]]
    full = "--full" in args
    args = [a for a in args if a != "--full"]
    repo = "."
    if "--repo" in args:
        i = args.index("--repo"); repo = args[i+1]; del args[i:i+2]
    if not args:
        print(json.dumps({"error": "usage: trace_phases.py <taskId> [--repo <root>] [--full]"}))
        sys.exit(2)
    task_id = args[0]
    task_path = os.path.join(repo, "apps/builder/.runs", task_id, "task.json")
    if not os.path.exists(task_path):
        print(json.dumps({"error": f"task.json not found: {task_path}"}))
        sys.exit(1)
    task = json.load(open(task_path))
    sessions = task.get("sessionIds", {}) or {}
    out = {"taskId": task_id, "slug": task.get("slug"), "status": task.get("status"),
           "phase": task.get("phase"), "sessionIds": sessions, "phases": {}}
    for phase in ("analyze", "spec", "implement"):
        sid = sessions.get(phase)
        tp = find_transcript(sid)
        if not tp:
            out["phases"][phase] = {"found": False, "sessionId": sid,
                                    "note": "no transcript (pruned, or backend phase)"}
            continue
        data = parse_transcript(tp, full)
        data["found"] = True
        data["sessionId"] = sid
        data["transcript"] = tp
        data["checks"] = phase_checks(phase, data)
        out["phases"][phase] = data
    out["phases"]["test"] = {"found": False, "note": "Phase ④ is backend-run (no Claude session); verify via re-running validators on the yml."}
    print(json.dumps(out, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
