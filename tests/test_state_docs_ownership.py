"""Guard the `docs/state/` ownership law, and the copies of it that live in prose.

`docs/state/README.md` states the law ("mỗi file trong bề mặt thuộc đúng MỘT doc") and says it is
checked *bằng mắt*. Every doc in that set is required to end with a "Guard ở đâu" section naming the
test that enforces what it describes — but the doc set itself had no such test, so the checks here
are that missing guard.

Deliberately NOT enforced: which doc owns a file. Ownership is declared in prose (`Phạm vi:`), is
routinely *partial* ("nửa workspace-facts"), and is split across docs by hand. A parser that
adjudicated that would false-fail on any reformat, and a guard that cries wolf gets deleted. These
tests assert only what can be checked without judgment.
"""
import re
from pathlib import Path

BASE = Path(__file__).parent.parent
STATE = BASE / "docs/state"

# The "bề mặt chịu luật" from docs/state/README.md. `templates/` and `schemas/*.json` are omitted:
# they are data, and the docs reference them by directory rather than per-file.
GOVERNED = [
    ("apps/builder/server/lib", "*.ts"),
    ("apps/builder/server/hooks", "*.ts"),
    ("apps/builder/server/routes", "*.ts"),
    ("apps/builder/server/state", "*.ts"),
    ("apps/builder/web/src/lib", "*.ts"),
    ("tools/dify_base", "*.py"),
]


def _governed_files():
    out = []
    for d, pat in GOVERNED:
        for p in sorted((BASE / d).glob(pat)):
            if p.name.endswith(".test.ts") or p.name == "__init__.py":
                continue
            out.append(p.relative_to(BASE))
    return out


def _backticked():
    ticks = set()
    for md in STATE.glob("*.md"):
        ticks |= set(re.findall(r"`([^`\n]+)`", md.read_text()))
    return ticks


def test_every_governed_file_is_accounted_for():
    """A file in the governed surface must appear somewhere in docs/state.

    This is the drift that actually happens: code lands, no doc notices, and the README's
    §"Bề mặt chưa có doc sở hữu" table silently stops being the authoritative gap list. Being
    *mentioned* is the floor, not ownership — a file may legitimately be named only in that
    unowned table.
    """
    ticks = _backticked()

    def mentioned(rel):
        return any(
            t == rel.name or t.endswith("/" + rel.name) or rel.name in t.split()
            for t in ticks
        )

    missing = sorted(str(r) for r in _governed_files() if not mentioned(r))
    assert not missing, (
        "These files are in the governed surface but no docs/state doc mentions them:\n  "
        + "\n  ".join(missing)
        + "\n\nEither give each an owner (add it to a doc's `Phạm vi:` line) or declare it "
        "in README.md §'Bề mặt chưa có doc sở hữu'. Leaving it out makes that table lie."
    )


def test_unowned_table_has_no_phantom_files():
    """Every file the README declares unowned must still exist.

    A stale entry is worse than a missing one: the table is the authoritative gap list, so a
    phantom makes the surface look bigger (and the debt look larger) than it is.
    """
    readme = (STATE / "README.md").read_text()
    section = readme.split("## Bề mặt chưa có doc sở hữu", 1)
    assert len(section) == 2, "README.md lost its §'Bề mặt chưa có doc sở hữu' heading"
    body = section[1].split("## Không thuộc thư mục này", 1)[0]

    # Source files only. `.json` is deliberately excluded: the table names runtime artifacts
    # (`analyze.json`) that never exist on disk, and telling those apart from committed data
    # files needs the same lookup this test is doing — not worth the false-positive risk.
    cands = {
        t for t in re.findall(r"`([^`\n]+)`", body)
        if re.fullmatch(r"[A-Za-z0-9_./-]+\.(ts|py)", t) and "*" not in t
    }
    # Resolve by basename against every real source file — avoids guessing path roots.
    real = {
        p.name
        for d in ("apps/builder/server", "apps/builder/web/src", "tools/dify_base", "schemas")
        for p in (BASE / d).rglob("*")
        if p.is_file()
    }
    phantom = sorted(
        t for t in cands
        if Path(t).name not in real and not (BASE / t).exists()
    )
    assert not phantom, (
        "README.md §'Bề mặt chưa có doc sở hữu' names files that no longer exist:\n  "
        + "\n  ".join(phantom)
        + "\n\nIf the file was deleted or renamed, drop/update the row."
    )


def test_skill_token_table_matches_phases_ts():
    """`SKILL.md`'s token table is a hand-kept copy of `phases.ts`'s `vars()` — pin them together.

    `phases.ts` renders `.claude/skills/dify-build/*.md` as the prompt body for phases ①②③ and
    guarantees "every known token is always substituted", citing the SKILL.md token table as the
    contract. Nothing compared the two, and they have already drifted once: a `phases.ts` comment
    records the map was "mislabeled 8" when it had grown past 8.

    A token in the code but not the table is an undocumented input; one in the table but not the
    code renders as a literal `{{TOKEN}}` into a real prompt.
    """
    phases = (BASE / "apps/builder/server/lib/phases.ts").read_text()
    m = re.search(r"const vars = \(partial[^)]*\)[^{]*=> \(\{(.*?)\n\}\)", phases, re.S)
    assert m, (
        "Could not locate the `vars = (partial…) => ({…})` map in phases.ts. It was refactored — "
        "update this test's anchor, do not delete the check."
    )
    code = set(re.findall(r"^\s{2}([A-Z_]+):", m.group(1), re.M))
    assert code, "Parsed phases.ts `vars()` but found no tokens — the anchor matched wrongly."

    skill = (BASE / ".claude/skills/dify-build/SKILL.md").read_text()
    documented = set(re.findall(r"\{\{([A-Z_]+)\}\}", skill))

    assert code == documented, (
        f"Token drift between phases.ts `vars()` ({len(code)}) and SKILL.md ({len(documented)}).\n"
        f"  in phases.ts only: {sorted(code - documented) or '—'}\n"
        f"  in SKILL.md only : {sorted(documented - code) or '—'}\n"
        "Both must list the same tokens; update them in the same commit."
    )
