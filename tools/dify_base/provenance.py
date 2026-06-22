#!/usr/bin/env python3
"""Parse/format the x-provenance comment header on curated templates (spec 022 D4).

A promoted template (templates/library/*.yml) carries, as comment lines at the TOP of the file:

    # x-provenance: source=<name> repo=<url>
    #   commit=<sha> file="<path>" orig_sha256=<hex> promoted=<YYYY-MM-DD> license=<spdx>

Comments are chosen for locality + import-safety (Dify ignores them). They do NOT survive a
PyYAML load+dump, so the writer must run LAST and tooling must never reserialize curated files.
Hand-authored-from-scratch templates use source=original (never flagged stale).
"""
import hashlib
import re
from pathlib import Path

FIELDS = ("source", "repo", "commit", "file", "orig_sha256", "promoted", "license")
# A token is key=value, where value may be "double-quoted with spaces" or a bare run of non-space.
_TOKEN = re.compile(r'(\w+)=(?:"([^"]*)"|(\S+))')


def sha256_file(path):
    """Hex SHA-256 of a file's bytes (used to detect upstream drift)."""
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def parse_header(path):
    """Return the provenance dict from a template's leading comment block, or None if absent.

    Only the run of comment/blank lines at the very top is considered; the first real YAML line
    ends the header region. Tokens before `x-provenance:` (e.g. a title comment) are ignored.
    """
    comment = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s.startswith("#"):
            comment.append(s[1:].strip())
        elif s == "":
            continue
        else:
            break
    blob = " ".join(comment)
    idx = blob.find("x-provenance:")
    if idx == -1:
        return None
    fields = {k: (q or u) for k, q, u in _TOKEN.findall(blob[idx + len("x-provenance:"):])}
    return fields or None


def format_header(fields, preamble=None):
    """Render the comment header (newline-terminated string) from a fields dict.

    `preamble` is an optional list of plain title/description comment lines placed above the
    machine-parseable x-provenance block.
    """
    lines = [f"# {p}" for p in (preamble or [])]
    lines.append(f"# x-provenance: source={fields['source']} repo={fields.get('repo','')}")
    lines.append(
        f'#   commit={fields.get("commit","")} file="{fields.get("file","")}"'
        f' orig_sha256={fields.get("orig_sha256","")}'
        f' promoted={fields.get("promoted","")} license={fields.get("license","")}'
    )
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    import sys
    for p in sys.argv[1:]:
        print(p, "->", parse_header(p))
