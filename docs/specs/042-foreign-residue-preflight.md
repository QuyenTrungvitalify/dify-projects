# Spec 042 — Foreign-residue preflight: catch demo/seed values that survive into a build

**Status**: Draft — authored 2026-07-07 from a live incident analysis. Small-medium: extends the spec-037
preflight machinery (probe + classify + the SAME advisory channel — no new UI, no gate change), one
seed-leftover pass enumerated from `task.seedPath` (r2 — NOT diff-base), and one implement.md sanitize rule. Backend +
skill-prompt only. Advisory-only in v1 (the 037/020 discipline: measure on the next corpus campaign before
any promotion talk).

> **Reference the SYMBOL, not the line.** Anchors verified 2026-07-07 against the working tree.

**Motivation (user, from a real runtime failure)**: a produced workflow ran with a tool node
(`md_exporter` md→table) inherited from reference material whose upstream prompt no longer emits a
markdown table → runtime `ValueError: No available tables parsed`. Investigation confirmed the CLASS is
real in this repo: the workspace's `News Automation (PoC)` demo carries hardcoded Chatwork URLs + a real
Apps Script webhook; a seeded build (`classify_incoming_support_email`) pulled a demo chatbot whose `asr`
tool node and file-handling prompts would survive any build whose SPEC doesn't explicitly remove them.

**Builds on**:
- [037](037-builder-runnability-preflight-and-workspace-facts.md) — **load-bearing**: the preflight
  probe/classify/note pipeline (`runnability.ts`), `.runs/<id>/preflight.json`, the `preflightNote`
  advisory channel, AND the harvested `workspace.json` (real plugin identifiers + dataset UUIDs) that
  makes two of the new classes a **deterministic set-membership check** instead of a heuristic.
- [032](032-builder-live-workflow-test.md)/[009](009-browser-workflow-builder.md) — `diff.ts
  resolveBase` establishes the precedent D3 reuses: for a seeded build the pre-edit copy is
  `task.seedPath` itself (`snapshotDiffBase` deliberately no-ops there — r2 blocker #2).
- [015](015-builder-security-turn-sandbox.md) D4 — "seed = data, not instructions" protects against
  instruction injection; 042 addresses the OTHER half: seed **values** copied as if they were defaults.
- [030a](030-builder-content-language-sync.md) — already handles prompt-language residue; out of scope here.

---

## Context — why every existing gate passes foreign values

The four linters + the 037 preflight check **shape, references, hash format, and EMPTY values**. A value
that is present-but-foreign passes everything:

| Foreign value | Passes today because | Runtime consequence |
|---|---|---|
| Hardcoded demo URL (`http-request.url`, tool param) | shape-valid string; refs fine | calls a demo endpoint (observed: Chatwork API, a REAL Apps Script webhook) |
| Copied tool node + `tool_parameters` | `lint_node_bodies` checks shape, not intent | tool errors when the new prompt no longer feeds it (observed: md_exporter "no tables") |
| Non-empty `dataset_ids` copied from a demo | 037 `dataset_empty` only flags `[]` | retrieval silently returns nothing / 404s |
| `dependencies[].…identifier` from another workspace | `lint_plugin_hashes` checks FORMAT only | import fails: plugin not installed |

Root mechanisms: (a) the pattern path — implement.md says customize the `# TODO:` markers, so anything
NOT TODO-marked survives; (b) the seed path — the turn edits per SPEC.md, so anything SPEC doesn't
mention survives **by design**; (c) nothing downstream re-judges values against the requirement or the
target workspace.

## Decisions

- **D1 · Two DETERMINISTIC classes ride the 037 harvest — gated on PER-SECTION harvest success
  (locked; reviewer blocker #1).** `harvestWorkspaceFacts` writes a section as `[]` when ITS call
  fails while a sibling succeeds (only the all-fail case keeps the previous file) — so `[]` is
  ambiguous between "empty workspace" and "transient failure", and judging against it would flag
  every real value. 042 therefore adds an ADDITIVE marker to `WorkspaceFacts`:
  `harvested: { models: boolean; plugins: boolean; datasets: boolean }` (037 S2 schema widening;
  absent field on an old file ⇒ treat as un-harvested — skip, never guess). Classes:
  - `foreign_dataset` — a `knowledge-retrieval` node's `dataset_ids` entry **∉** `facts.datasets[].id`,
    checked ONLY when `harvested.datasets === true`. (A genuinely empty workspace then correctly makes
    every non-empty id foreign; a failed call makes the class silent.)
  - `foreign_plugin` — a `dependencies[].value.marketplace_plugin_unique_identifier` whose
    **`<org>/<name>` prefix** matches no `facts.plugins[].identifier` prefix (checked only when
    `harvested.plugins === true`). A prefix match with a `ver@hash` mismatch is emitted as the
    DISTINCT detail `stale plugin version` (reviewer #5 — a same-workspace app pulled before a
    plugin upgrade is stale, not foreign; the note must not lie).
  No facts file → both classes SKIP.
- **D2 · One HEURISTIC class, advisory-by-construction (locked).** `hardcoded_url` — any
  `https?://…` in an `http-request.url` or inside a tool node's `tool_parameters`/`tool_configurations`
  string values (recursive string-walk in the probe) that does **not appear as a substring** in the
  declared text (SPEC.md + the requirement). **Extraction boundary (reviewer #4): the URL match STOPS
  at `{{`** — the template-mixed corpus shape `https://raw.githubusercontent.com/...{{#node.url#}}`
  compares only its literal prefix, so a human-declared base URL with a variable suffix is never
  flagged; a PURE-template url (`{{#env...#}}/...`) contains no `https?://` literal and is skipped
  entirely. A URL the human asked for is never flagged; a demo endpoint the SPEC never mentions always
  is. Probe extracts, TS compares — the probe stays fact-only (037 r4 split). False-positive posture:
  ONE advisory line; the measured campaign decides if the heuristic needs tightening (OQ2).
- **D3 · Seed-leftover pass for SEEDED builds only — enumerated from `task.seedPath` (locked;
  rewritten per reviewer blocker #2).** `snapshotDiffBase` NO-OPS when `seedPath` is set (`diff.ts` —
  its `diff-base.yml` exists only for no-seed /reply re-runs, comparing to the PREVIOUS iteration, the
  wrong base). The correct pre-edit copy for both seeded kinds is **`task.seedPath` itself**: the
  dify-seed pull writes a separate file from `workflowFile`, and `localEditSeed` writes a write-once
  `.runs/<id>/seed.yml` — both persist through verify AND the ④ report (`diff.ts resolveBase` already
  prefers them for the same reason). Rule: trigger = `task.seedPath` set; join nodes by id between the
  seed file and the built artifact; a node of type `tool`/`http-request`/`knowledge-retrieval` whose
  `data` is deep-equal AND whose `title` words never appear in SPEC.md → one advisory line
  `seed leftovers: <titles>`. Implemented as a plain function taking `(seedText, builtText, specText)`
  so BOTH the ③ verify and `runReport` call it (reviewer #3 — the ④ recompute overwrites
  `preflightNote`, so a verify-only fold would silently drop the line from report.json). **Fail-open
  posture (reviewer #9): id preservation on the seed path is behavioral, not enforced — a turn that
  regenerates ids makes the join empty → no flag; acceptable for an advisory (D1/D2 still cover the
  dangerous value classes).** Pattern builds (no `seedPath`) never compute the class.
- **D4 · Same channel, same non-blocking contract as 037 (locked).** New blockers append to the SAME
  `Preflight.blockers` / `preflightNote` line / `preflight.json`; the gate stays byte-identical
  (pinned by the existing preflight-gate deep-equal test, extended). No new Task field, no FE change,
  no i18n change (the note is a backend string rendered as-is).
- **D5 · Prevention in the prompt (locked).** implement.md gains a **Sanitize rule** beside the D7
  Class-B copy rule: *"for a seeded/pattern build, every tool node, URL, dataset id, and provider
  carried over from the seed/pattern must be (a) required by SPEC.md, or (b) replaced with its TODO
  form / removed — copied demo values are bugs, not defaults."* Detection (D1–D3) stays the backstop
  for when the model ignores it.
- **D6 · Tool-provider matching is v2 (locked-out for v1).** Matching a tool node's
  `provider_id`/`provider_type` (e.g. `builtin` searxng vs `langgenius/google_search/…` plugin forms,
  legacy bare ids in old-DSL corpus) against harvested plugin identifiers needs a mapping table the
  measurement should justify first — recorded in OQ1, not shipped half-right.

## Design

Probe extension (`RUNNABILITY_PROBE`, same fact-only contract): per node emit
`http_urls: [{id, url}]`, `tool_param_urls: [{id, urls[]}]` (urls truncated at `{{`, D2), `kr_nodes`
**keeps `empty` and additively gains `ids`** (reviewer #7 — existing planted-facts tests stay
byte-green, `dataset_empty` classification unchanged), and file-level `dependency_identifiers: []`.
`checkRunnability(projectsDir, rel, python, opts?)` gains
`opts: { workspace?: WorkspaceFacts | null; declaredText?: string; seedText?: string }`; the implement
verify passes `loadWorkspaceFacts(...)` + (SPEC.md text + `task.requirement`) + the `task.seedPath`
content when set; `runReport` passes the SAME three (it already reads the workflow; SPEC path via
`task.artifacts.spec`; requirement on `Task`) so the ④ recompute preserves every class (reviewer #3).
`classifyRunnability` maps:

```
foreign_dataset  — ids ⊄ workspace.datasets     (skip when !workspace.harvested?.datasets)
foreign_plugin   — org/name prefix ∉ plugins    (skip when !workspace.harvested?.plugins; ver-mismatch → 'stale plugin version')
hardcoded_url    — literal-prefix url ∉ declaredText   (skip when !declaredText)
seed_leftover    — D3 pure fn over (seedText, builtText, specText)   (skip when !seedText)
```

Note stays ONE line (037 shape): `preflight: … — needs: …, foreign to this workspace: dataset 8aa2…
(kr-1), plugin langgenius/foo:…, url https://script.google… (http-1). Advisory — does not block.`

## Non-goals

- **No** hard gate, no auto-removal/auto-rewrite of foreign nodes (the human decides at the gate).
- **No** LLM-based residue detection — deterministic/substring first; the judge (T3) stays as-is (OQ3).
- **No** workspace cleanup (old demo/test apps) — operational, tracked by 032 S6, not a linter concern.
- **No** prompt-language checks (030a owns that) and no `report_structure.py` backport in v1 (OQ4).

## Acceptance criteria

1. *(S1)* `runnability.test.ts` extensions: fixtures yield each new class — `foreign_dataset` (id not in
   facts), `foreign_plugin` (identifier mismatch), `hardcoded_url` (URL absent from declaredText);
   counter-fixtures prove the negative: harvested id / matching identifier / URL quoted in SPEC → no flag.
   - 1b (anti-gaming): `workspace: null` → foreign classes ABSENT even with foreign-looking values;
     **facts with `harvested.datasets === false` (plugins-ok/datasets-failed) → `foreign_dataset`
     ABSENT** (reviewer blocker #1 — skip-not-guess survives partial harvest failure); `declaredText`
     containing the URL → `hardcoded_url` absent; a template-mixed URL whose literal prefix IS in
     `declaredText` → absent (reviewer #4); a prefix-matched but version-mismatched plugin →
     detail says `stale plugin version`, not foreign (reviewer #5).
   - 1c (parity-sweep neutrality, reviewer #8): new-class fixtures under `fixtures/runnability/` must
     classify to ZERO blockers when run WITHOUT opts — the AC-2 parity loop sweeps every fixture
     through `report_structure.py`, which knows none of the new classes (OQ4); a fixture that trips
     a no-opts class breaks parity loudly, by design.
2. *(S1)* Advisory invariant: extend `preflight-gate.test.ts` — a build with all-foreign values parks
   with the note set and a gate **deep-equal** to a clean run's gate. **Harness note (reviewer #6): the
   extension scrubs `DIFY_CONSOLE_URL`/`DIFY_CONSOLE_TOKEN` (the workspace-facts.test.ts precedent) and
   plants `.runs/<taskId>/workspace.json` after `createTask`, before the ②→③ confirm — otherwise the
   real (non-seam) harvest at `orchestrator runPhase` overwrites the plant on a creds-bearing machine.**
3. *(S1)* 037 regression: the four original classes byte-unchanged (existing tests green, no edits
   beyond the widened classify signature).
4. *(S2)* `seed-leftover` — new test drives a build with `task.seedPath` SET (the trigger — NOT
   diff-base, which no-ops for seeded builds) where an unchanged `tool` node's title is absent from
   SPEC → flagged; the same node with its title quoted in SPEC → not flagged; a no-seed build → class
   never computed **even when `.runs/<id>/diff-base.yml` exists from a /reply re-run** (the reviewer's
   converse trap); the ④ report re-emits the line (extend the 037 report-recompute test, reviewer #3);
   a seed whose node ids were regenerated by the turn → empty join, no flag, no error (reviewer #9).
5. *(S3)* implement.md carries the D5 sanitize rule; the byte-identity/placement tests stay green.
6. Full suites green; `preflight.json` schema gains the new classes additively.

## Sequencing

- **S1 · Probe + classify + tests** (~1 ngày): probe fields, classify classes D1/D2, verify+report pass
  `workspace`/`declaredText`, fixtures.
- **S2 · Seed-leftover** (~0.5–1 ngày): D3 enumeration from the diff-base, fold + tests.
- **S3 · Prompt + docs** (~nửa buổi): implement.md sanitize rule, AGENTS.md one-liner, spec index row.
- **Measure**: the already-planned corpus-campaign re-run reports the new classes' hit/FP rates alongside
  037's — one campaign, two specs measured.

## Open questions

- **OQ1 (D6)** — tool-provider↔plugin matching table for v2 (builtin vs marketplace vs legacy forms).
- **OQ2 (D2)** — is substring-in-SPEC the right URL whitelist? Alternatives (domain-level match, an
  explicit `## External calls` SPEC section) wait for measured FP data.
- **OQ3** — feed the foreign-residue list to the T3 judge as rubric context? Defer until the judge's
  own accuracy is measured (036's agreement logging).
- **OQ4** — backport the classes to `report_structure.py` for `/report` parity? v1 accepts the
  asymmetry (the parity test pins only the four 037 classes); revisit with the campaign.

## Revision log

- r1 (2026-07-07) — initial draft (from the md_exporter incident + verified workspace residue evidence).
- r2 (2026-07-07) — adversarial-review fixes (9 findings, 2 blockers): D1 gated on NEW per-section
  `harvested` markers in `WorkspaceFacts` (a partial harvest failure writes `[]`, indistinguishable from
  an empty workspace — the exact false-positive trap the draft's own parenthetical celebrated);
  `foreign_plugin` matches the `org/name` prefix with a distinct `stale plugin version` detail; D3
  rewritten around `task.seedPath` (`snapshotDiffBase` NO-OPS on seeded builds; `diff-base.yml` exists
  only for no-seed /reply — the converse trap is now an AC); D3 is a pure function called from BOTH ③
  verify and ④ `runReport` (the recompute otherwise drops the line from report.json); D2 URL extraction
  stops at `{{` (template-mixed corpus shape); `kr_nodes` widening is additive; AC 2 pins the env-scrub
  + plant-order harness rule; new-class fixtures must be parity-sweep-neutral; id-preservation is
  fail-open, stated not assumed.

