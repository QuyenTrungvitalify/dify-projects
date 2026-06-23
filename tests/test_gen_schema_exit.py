"""Unit-test the pure dump_exit_code() gate (spec 024 S1).

We do NOT run gen_schema for real here (it needs vendor/dify-src and is heavy).
Instead we pin the pure decision function: exit 0 iff the observed `_error`
dump-failure set EXACTLY equals the known-broken allowlist; any divergence
(a new/regressed failure, or a known-broken node that started dumping clean)
must be non-zero so a human reconciles the allowlist + R0 test + README.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from schemas.gen_schema import dump_exit_code


def test_exact_known_set_is_clean():
    assert dump_exit_code({"A"}, {"A"}) == 0


def test_empty_both_clean():
    assert dump_exit_code(set(), set()) == 0


def test_new_failure_is_fatal():
    assert dump_exit_code({"A", "B"}, {"A"}) == 1


def test_fixed_node_is_fatal():
    assert dump_exit_code(set(), {"A"}) == 1
