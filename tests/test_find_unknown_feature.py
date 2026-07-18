"""find.py --has <feature>: an UNKNOWN key must NOT fail silently (spec 071 S4).

The 44-turn run queried `--has trigger-webhook`, got the same 'No matching templates' a real empty
result gives, could not tell typo from absence, and fell to denied greps. A key present in NO indexed
workflow now errors (exit 2) with the valid list; a KNOWN key with 0 matches still returns the normal
empty result (exit 0). This is the same lesson as lint_node_bodies --dump-schema on an unknown type.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

TOOL = Path(__file__).parent.parent / "tools" / "dify_base" / "find.py"


def run(*args: str):
    return subprocess.run([sys.executable, str(TOOL), *args], capture_output=True, text=True)


def test_unknown_feature_errors_with_the_valid_list():
    r = run("--has", "trigger-webook")  # typo of trigger-webhook
    assert r.returncode == 2, r.stderr
    assert "unknown feature" in r.stderr
    assert "trigger-schedule" in r.stderr, "the valid-feature list must be printed to guide the fix"
    assert r.stdout == "", "no normal output on an unknown key"


def test_known_feature_with_zero_matches_is_not_an_error():
    # trigger-schedule AND iteration: both real keys, but no single pattern has both → empty, exit 0.
    r = run("--has", "trigger-schedule", "--has", "iteration")
    assert r.returncode == 0, r.stderr
    assert "unknown feature" not in r.stderr
    assert "No matching" in r.stdout


def test_normal_query_still_works():
    r = run("--has", "iteration")
    assert r.returncode == 0
    assert "match" in r.stdout.lower()


def test_unknown_in_without_also_caught():
    r = run("--has", "iteration", "--no", "definitely-not-a-feature")
    assert r.returncode == 2
    assert "unknown feature" in r.stderr
