# Spec 056 — Start-node-as-trigger: raw-artifact inputs, in-flow derivation (スタートノードをトリガーにする仕様)

**Status**: **Implemented** (2026-07-13, same day as authored — S1+S1b+S2+S3 landed; S4 deferred
per Q3). Verified: pattern passes 4 linters + 12 pre-commit hooks; `promote_gate check --distilled`
→ `eligible:true, probe:skipped`; `find.py --has file-input --has iteration --has http-request` →
sole match (12 nodes); pytest 165/165 (+2 creds-skips) incl. drift 7→8 + INDEX 44 pins; builder
server 456/456 + web 169/169 + skill-pin suites 22/22. **AC1 verified** (2026-07-13, live
from-scratch run, task 1783936719245): ① digest named the 2-Excel trigger surface + asked ONE
combined column question WITH a stated fallback assumption; ② picked per-row-notify-excel via
find.py (sole hit) and declared "date-free judge → no today input"; ③ artifact independently
re-linted (4/4 green): 2 file-list vars, 0 required text inputs, 0 `today`, legacy-`conditions`
mirror, 0 real hash, `row_count` wired to End, 4 column guards, no naive `now()`. Side finding
(pre-existing, tracked separately): SPEC.md's "Proposed slug" is never parsed by the backend —
scaffold derives the slug from the requirement text (scaffold.ts:74).
(r2 — adversarial impact review folded in 2026-07-13: doc-sync gates, fast-mode coverage,
autonomous-mode default, live-test viability, promote-gate procedure; anchors verified.)
**Effort**: S–M (S1+S1b+S2 = S, S3 = S–M incl. doc-sync, S4 optional = S)
**Depends on**: 050 (pattern promotion conventions, B5 blank-model), 047 (④ live-test file inputs — makes this shape testable), 037 (advisory channel — S4 only)

## Context

A from-scratch Builder build ("リスト入力催促ChatWork通知フロー") shipped with **six required
text inputs** at Start: `list_json` (a JSON array the operator had to produce from Excel
*outside* Dify), `room_map_json` (same), `target_column` / `date_column` / `name_column`
(hand-typed column names), and `today` (hand-typed run date). It passed every gate — but the
Japanese stakeholder's verdict was:

> **スタートノードをトリガーにする仕様で実装**
> — "implement to the spec where the **Start node is the trigger**."

Meaning: whatever the operator **physically has** at run time (here: two Excel files) is the
*only* thing Start may demand; everything else is derived *inside* the workflow. The field fix
(export: `リスト入力催促ChatWork通知フロー.yml`, 2,505 lines, 44 nodes, running in production)
rebuilt the front-end exactly that way:

- Start: `list_excel` + `room_map_excel` — two `type: file-list` variables (`.xlsx`,
  `allowed_file_types: [document]`, `max_length: 1`, `local_file`). Nothing else.
- `document-extractor` ×2 (`is_array_file: true` → output is `array[string]`) →
  code nodes that parse the extractor's **markdown table** (separator-row skip, `nan`
  cleaning, header-row skip, first-element unwrap of the array).
- Column positions (`row[19]` = T列, `row[5]` = F列) moved into code constants, documented in
  the Start variables' `hint:` text.
- `today` disappeared entirely (the judge logic no longer needs a date — but see S3: the
  original absolutist GOTCHA is what pushed it into the required-input list in the first place).

None of the four gate linters could have flagged the original shape — it is not a correctness
bug, it is an **authoring-default bug**. Three root causes, all in our stack:

1. **Pattern front-end**: `templates/patterns/per-row-notify.yml` (distilled in spec 050)
   declares `list_json` / `destination_map_json` / `today` as required text inputs with
   `file_upload: enabled: false`. The Builder copies patterns faithfully (priority
   `patterns/ > …`), so the pattern's paste-JSON trigger surface was transplanted onto a
   requirement that plainly says Excel.
2. **Skill has no trigger-surface question**: neither `analyze.md` ("Do — ALWAYS" overview:
   goal / key requirements / *expected input → output*) nor `spec.md` ("Do" steps 1–6) — nor
   `draft.md`, the merged ①+② author on the fast path — ever asks *who runs this and what do
   they hand over, in what raw form?*
3. **The `today` GOTCHA is absolutist**: spec 050 D2b / AGENTS.md §9 (2026-07-08) says the run
   date MUST be a Start input (sandbox-timezone incident). Right for a machine caller (cron →
   API); wrong default for a human operator, where it becomes one more field to mistype.

Also observed in the field fix, for the pattern to teach honestly (S3): to parallelize under the
iteration limit (constraints.md §2, ≤30 items) the fix **duplicated the whole iteration body ×4**
("バッチ1–4", `BATCH_SIZE=10 × MAX_BATCHES=4`) and **silently truncates at 40 rows** (the
`count` output is wired to nothing). And the raw export fails `validate_workflow.py` (4× if-else
with modern `cases[]` only — the known legacy-`conditions` mirror, AGENTS.md §9 2026-05-19) while
`lint_node_bodies.py` warn-skips its 4 `http-request` nodes (spec 024 S1, tracked separately).
The distilled pattern must fix the former and must not reproduce the silent-truncation
anti-pattern.

**Verified-safe surfaces** (impact review 2026-07-13, so the implementer doesn't re-hunt): the
S1/S2 skill edits touch none of the pinned skill-text regions — `content-language.test.ts` pins
only the `## Output language` sections of draft.md/spec.md (byte-identical) and
`docs-contract-pin.test.ts` pins the slug charset; the spec-055 harnesses stub the skill files
and assert FSM/gate shape only; nothing references spec.md "Do" steps by number; `lint_refs.py` /
`lint_node_bodies.py` already handle `file-list` Start vars and `document-extractor` (green today
on `file-iteration.yml`, the same shape); and `build_index.py` tags `file-input` purely from
Start variable types `file`/`file-list`, so the new pattern indexes correctly even with
`features.file_upload` disabled.

## Goals

- **G1 — the trigger surface is decided consciously, at the gates.** The ① digest names who
  triggers the run and what raw artifacts they supply; the ② spec must justify every required
  Start input that could instead be derived in-flow. Fast mode (draft.md) routes file-shaped
  requirements honestly instead of silently re-digesting them into paste-text.
- **G2 — a vetted Excel front-end pattern exists**, so `find.py` has something correct to offer
  the next file-shaped requirement: `per-row-notify-excel.yml` (file-list Start → document-extractor
  → markdown-table parse → single iteration → judge/notify/aggregate), distilled with provenance
  from the proven field build.
- **G3 — the `today` guidance gets its missing nuance**: optional input + in-code fallback
  pinned to the business timezone is a sanctioned alternative when the trigger is a human.
- **G4 (optional) — the ③ gate can smell a pre-digested Start input** and say so, advisory-only.

## Non-goals

- No `trigger-webhook` / `trigger-schedule` / `trigger-plugin` entry nodes — `start` remains the
  only entry the Builder emits (that *is* the スタートノードをトリガー spec). A separate spec if
  ever needed. **UPDATE 2026-07-15: superseded on this point — trigger-entry support is spec 057**
  (the stakeholder confirmed reading B; this spec remains valid for reading A).
- No change to any linter's pass/fail semantics, gate FSM, or permission model.
- Not retro-fixing the production ChatWork workflow (owner declined; it works).
- Not auto-migrating existing builds/patterns beyond the S3 header edit.

## Design

### S1 — `analyze.md`: name the trigger surface in the digest (XS)

In `.claude/skills/dify-build/analyze.md`, "Do — ALWAYS" (the ①-gate overview), extend the third
bullet from "**expected input → output**" to:

> **expected input → output** — name the **trigger surface**: who runs this (human in Studio /
> external system via API) and what they hand over **in the raw form they possess it**
> (uploaded file(s)? pasted text? nothing?). If the requirement names a file format
> (Excel / CSV / PDF / 画像 …), the input line says *file input*, not a derived text form.

Two companion edits in the same section:

- **Qualify the question allowance explicitly**: extend the existing one-question sentence's
  example parenthetical from "(e.g. a missing field)" to "(e.g. a missing field, or the raw form
  of the runtime input — file vs pasted text — is unnamed)", so the trigger-surface question is a
  sanctioned ambiguity, not a stretch reading. When multiple blocking ambiguities exist,
  **combine them into the single question** (the budget stays ONE) — this resolves Q1.
- **Autonomous default** (`auto` / `spec_only` auto-confirm the ① gate — `boundaryAutoAdvances`,
  spec 055 D2 — so a question asked there is never answered): the digest must not *depend* on an
  answer. If the requirement names a file format ⇒ **assume file input** and state the assumption
  in the digest's input line (e.g. 「Excelファイルをアップロード（前提）」); if no concrete
  artifact is named ⇒ default to pasted text and record it under the digest's open point. The
  question is still asked — it pays off in `each_step`, and documents the assumption otherwise.

### S1b — `draft.md`: close the fast-path hole (XS)

`draft.md` replaces ① *and* ② on the fast path, has zero input-surface guidance, and a
file-shaped requirement mis-digested as `features: ["llm"]` would pass the backend's
`features ⊄ {llm}` pause guard unchallenged. Amend its step-1 honesty clause ("NOT actually a
pure single-LLM transform" bullet) with:

> A requirement that names a file format (Excel / CSV / PDF / 画像 …) is NEVER a pure single-LLM
> transform: its input surface is `file-input` (plus `document-extractor` for parsing) — write
> those features honestly so the backend pauses fast mode; do NOT re-shape a file artifact into a
> pasted-text Start input to stay eligible.

Keep the edit inside draft.md's own prose — **not** in its `## Output language` section (that
block is byte-pinned identical to spec.md's by `content-language.test.ts`).

### S2 — `spec.md`: the derivable-input rule (S)

Insert one numbered step into `.claude/skills/dify-build/spec.md` "Do" between current steps 3
and 4 — the new step becomes **step 4**; current steps 4–6 (propose slug / single-file-branched
preference / Acceptance Criteria) renumber to 5–7. Verified: no file references these numbers,
so no cross-reference updates are needed. The inserted text must contain no
`{{UPPERCASE}}`-shaped literal (content-language.test.ts asserts the rendered spec.md has zero
un-substituted tokens):

> **Trigger-surface rule (spec 056).** Every **required** Start variable must be something the
> runtime operator physically has. Anything derivable in-flow is derived by nodes — or made
> `required: false` with a documented default:
> - requirement names a file format ⇒ Start variable is `type: file-list` (or `file`) with
>   `allowed_file_types` / `allowed_file_extensions` / `max_length` set, feeding a
>   `document-extractor` front-end (with `is_array_file: true` its output is `array[string]` —
>   unwrap the first element defensively in the parse code node).
> - parsed/derived values (JSON arrays, maps, column names/positions, counts) live in code
>   nodes, with fixed column positions documented in the Start `hint:`.
> - run date: per the updated GOTCHA (S3) — optional input with a timezone-pinned fallback,
>   or required input when the caller is a machine.
> State the Start variables and their **variable types** in the start row's *purpose* cell of the
> **Nodes** table (e.g. `start | start | collect list_excel (file-list, .xlsx), room_map_excel
> (file-list, .xlsx)`) — the table's `type` column stays the NODE type. In **Open questions**,
> flag any required input you could not eliminate and why.

Cheap rider while editing the same file: fix step 2's priority line to
`templates/patterns/` > `templates/library/` > `projects/*/workflows/` > `corpus/` (and the
AGENTS.md §3 line it cites) — both currently omit the `library/` tier that INDEX.md declares.

### S3 — pattern `per-row-notify-excel.yml` + GOTCHA nuance (S–M)

Distill from the field export into ONE pattern file. **Genericization is per
`template-promote` D1 step 2 — the export is customer data; none of it lands verbatim:**

- `# Use case:` comment header (test_pattern_consistency gates it) + `# TODO:` markers on every
  customization point (AGENTS §5).
- **`dependencies: []`** + `# TODO: add plugin hash from target workspace` near the LLM node —
  the export's real `langgenius/openai` marketplace hash must NOT be carried over. NOTE:
  `lint_plugin_hashes.py` checks format only, so a real hash would pass every gate — only this
  convention (§4.3/§5) stands in the way; AC3's grep makes it checkable.
- B5 blank model; judge rule and LLM prompt wording become placeholder text (no
  請求書/Drive-link/customer terms); `app.name` = house slug (`per_row_notify_excel`);
  `app.description` names the problem shape + trigger with keywords front-loaded (D4
  retrievability); Start `hint:` documents column-position constants generically
  (`TARGET_COL`/`NAME_COL` + `# TODO`).
- `version: 0.6.0` (repo `.dify-dsl-version` — the version-guard hook gates it).
- Shape: Start (two `file-list` vars — rows file, mapping file — nothing else required) →
  `document-extractor` ×2 → two parse code nodes (markdown-table parser: separator-row skip,
  `nan` clean, header skip, `|`-in-cell caveat noted) → **one** iteration (`is_parallel: true`,
  `continue-on-error`) → judge → if-else (**modern `cases[]` AND legacy top-level `conditions`
  mirror** — validator requirement) → LLM → http-request (no-auth + custom token header via env
  `name:` form) → per-row result code nodes → variable-aggregator → merge/summary code → End.
- **Parse code nodes guard fixed-column access and always RETURN, never raise**
  (`len(row) <= COL_x` ⇒ skip + count as unparseable). This is also what makes the ④ live test
  viable: spec 047 uploads the bundled generic `sample.xlsx` (a 2-column name/value sheet) and
  reuses one upload for every file var — an unguarded `row[19]` would turn every pattern-derived
  live test into a spurious `workflow_fail`.
- **Truncation is surfaced, never silent**: the parse node outputs `count` (and drops nothing);
  End exposes `sent_count` + `results` + `row_count`. New GOTCHA header line: *scaling past the
  iteration limit (constraints.md §2, ≤30 items) is done by batching — if you cap batches, the
  End output MUST carry a truncated-signal; never slice the batch list silently.*
- **`today` GOTCHA rewrite** in both pattern headers; in AGENTS.md §9 **append a new dated
  entry** (the log is append-oriented — do not rewrite the 2026-07-08 record; at most add a
  "superseded by 2026-07-13 entry / spec 056" pointer):
  `- 2026-07-13: Builder shipped 6 required text inputs (list JSON, column names, today) for an
  Excel-shaped requirement; stakeholder rework (スタートノードをトリガー) → required Start inputs
  = only raw artifacts the operator holds; today is required only for a machine caller, else
  required:false + in-code fallback pinned to the business timezone (JST:
  datetime.now(timezone(timedelta(hours=9)))) — never naive now(). See
  templates/patterns/per-row-notify-excel.yml + spec 056.`
- **Same-commit doc-sync (dynamic drift tests gate these — CI is red otherwise):**
  - Pattern count 7→8 + name-list additions: README.md (tree comment, "Patterns sẵn có" table
    row, Phase 1.C bullet), AGENTS.md §1 "7 vetted workflow patterns" + §8 "7 vetted starting
    patterns" row, docs/architecture.md (Trụ 2 line + roadmap 1.C row), docs/GUIDE.md §5 "7 base
    patterns" (manual, not test-gated), docs/project-overview-vi.md if it names the count.
  - INDEX rebuild bumps "43 files indexed" → 44 ⇒ update README.md "CLI search ~43 template" →
    ~44 (`test_readme_corpus_count_matches_index`).
  - Land the pattern file and the AGENTS.md §9 edit in the SAME commit — the §9 entry backticks
    the new pattern path and `check_agents_refs.sh` exits 1 on a missing path.
- **Provenance stanza (full house form —
  `test_provenance.py::test_library_template_passes_strict` runs `--strict` over
  `templates/patterns/` too):**
  `x-provenance: source=original repo= commit= file="リスト入力催促ChatWork通知フロー.yml (field
  export, not committed)" orig_sha256= promoted=<date> license=MIT spec=056
  known_good_dify=1.13.0` — `license=` and `known_good_dify=` (must equal `.dify-tag`) are
  mandatory for `--strict`.
- **Promote-gate procedure** (the raw export is customer data AND fails `validate_workflow.py` —
  it never enters the repo): normalize a SCRATCH copy outside the repo (only edit: add the legacy
  `conditions` mirror to the 4 if-else nodes), then
  `.venv/bin/python tools/dify_base/promote_gate.py check <scratch>.yml --distilled
  templates/patterns/per-row-notify-excel.yml --json` — with no Dify creds the import probe
  auto-degrades to `skipped` and the blank model is a `warnings` entry, not a blocker (spec 054);
  expected verdict `eligible:true, probe:skipped, warnings:[llm model empty]`.
- Side chore (adjacent stale doc the implementer will hit): `template-promote` SKILL.md still
  calls an empty source model a promote **blocker** — spec 054 made it advisory; fix the line.
- Rebuild INDEX so `find.py` surfaces the pattern. Canonical disambiguating query:
  `find.py --has file-input --has iteration --has http-request` (plain
  `--has file-input --has iteration` also returns `file-iteration.yml`, which sorts first).

### S4 (optional, deferrable) — ③ preflight "pre-digested input" advisory (S)

A note — **not** a fifth blocker class — on the spec 037 advisory channel: flag a **required**
`text-input`/`paragraph` Start variable whose label/hint matches machine-digested content
(`JSON`, `配列`, `マップ`, `列名`, `YYYY/MM/DD`, …) with one line suggesting a file input or
in-flow derivation. Implementation constraints (verified):

- The blocker classes are parity-tested TS↔Python (`runnability.test.ts` "AC 2" vs
  `report_structure.py`'s `runnable_blocker_classes`) — the smell never enters `blockers[]`, so
  parity stays green.
- The `preflightNote` string format is $-anchor pinned in `runnability.test.ts` — do NOT append
  to it; ship the smell as a NEW optional field (e.g. `task.inputSmellNote`) rendered as its own
  gate-card summary line (the card carries multiple notes as separate lines).

Defer if lean matters more — S1+S1b+S2 already prevent the authoring mistake; S4 only catches
drift.

## Open questions

- **Q1** — *resolved in S1*: ask at the ① gate when the artifact form is unnamed; combine
  multiple blocking ambiguities into the single allowed question; autonomous modes use the
  stated-assumption default instead of depending on an answer.
- **Q2** — Should the pattern include the parallel-batch scale variant (the field build's ×4
  shape) as a commented appendix, or GOTCHA-text only? *Proposed: GOTCHA-text only — a pattern
  that duplicates its own body ×4 teaches the maintenance problem along with the fix.*
- **Q3** — S4 in the first slice or deferred? *Proposed: defer; revisit after the next
  field case or the corpus-campaign re-run.*

## Acceptance criteria

1. Re-running a ChatWork-style JP requirement ("Excelの一覧…空欄の行だけChatWorkへ通知") from
   scratch: the ② SPEC.md proposes **file-type Start inputs only** (rows Excel + mapping Excel)
   with an extractor/parse front-end — no required `*_json` / column-name / `today` text inputs.
   In `auto` mode the digest states the file-input assumption instead of parking on a question.
2. `templates/patterns/per-row-notify-excel.yml` exists with `# Use case:` header,
   `dependencies: []`, `# TODO:` markers, the full `x-provenance` stanza (incl. `license=MIT`,
   `known_good_dify=1.13.0`); passes all 4 linters, the 12 applicable pre-commit hooks, and
   `promote_gate.py check --distilled … --json` (expected: `eligible:true, probe:skipped`,
   blank-model warning only); `find.py --has file-input --has iteration --has http-request`
   returns it after INDEX rebuild.
3. Genericization proofs: `grep -c marketplace_plugin_unique_identifier
   templates/patterns/per-row-notify-excel.yml` returns 0, and
   `grep -vE '^\s*#' templates/patterns/per-row-notify-excel.yml | grep -F 'batches[:'` returns
   nothing (comment lines excluded — the GOTCHA text may name the anti-pattern).
4. `per-row-notify.yml` header + a NEW dated AGENTS.md §9 entry carry the two-form `today`
   guidance (machine → required input; human → optional + timezone-pinned fallback); the
   2026-07-08 entry is preserved (pointer allowed, no substance rewrite).
5. Full suites stay green in the same commit: `pytest tests/` (docs-drift count pins 7→8 and
   43→44 doc updates included; provenance `--strict`; pattern-consistency) and builder
   `npm test` server+web (`content-language.test.ts` byte-pin, `docs-contract-pin.test.ts` slug
   pin, `knowledge-inject.test.ts` no-`{{KNOWLEDGE}}` — S1/S1b/S2 touch none of the pinned
   regions).
6. If S4 ships: a fixture with a required "JSON配列" paragraph input renders the advisory as its
   own line on the ③ gate card; `runnability.test.ts` AC 2 parity and the `preflightNote`
   format pin both still pass with an unchanged class set.

## References

- Field export: `リスト入力催促ChatWork通知フロー.yml` (production, 2,505 lines, 44 nodes) — the
  Start/file-list + extractor front-end this spec canonicalizes; also the source of the ×4-batch
  and silent-truncation observations. Customer data — never committed; distill via a scratch
  copy.
- Original Builder output (same requirement, 6 text inputs) — Studio screenshots 2026-07-13.
- [050](050-proven-build-to-reusable-pattern-promotion.md) — pattern promotion conventions, D2b
  (`today` GOTCHA origin), B5 blank-model; [047](047-builder-live-test-file-inputs-and-timeout-classification.md) —
  ④ live-test file inputs + bundled `sample.xlsx`; [037](037-builder-runnability-preflight-and-workspace-facts.md) —
  advisory channel (S4); [054](054-reconcile-promote-gate-with-blank-model.md) — blank model =
  advisory at the promote gate; [055](055-from-scratch-analyze-requirement-digest.md) — the ①
  checkpoint S1 rides on; [028](028-builder-adaptive-phase-depth.md) — fast mode / draft.md (S1b).
- `skills/mango-svip/references/constraints.md` §2 — iteration ≤30 hard limit + batch pattern.
- AGENTS.md §9 — 2026-05-19 (if-else legacy `conditions` mirror), 2026-07-08 (`today` +
  custom-auth-header gotchas; superseded-in-part by this spec's new entry).
- Impact review (2026-07-13, 5-agent adversarial pass): cleared — content-language/055-harness
  pins, linter coverage for `file-list`+`document-extractor`, `file-input` index detection,
  promote-gate standalone callability, S4 parity feasibility. Producing the r2 amendments above.
