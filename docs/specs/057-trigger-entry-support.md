# Spec 057 — Trigger-entry support: workflows that start from a トリガー node (schedule/webhook)

**Status**: **Implemented** (2026-07-15 — S1/S1b/S2/S3/S4 landed same-tree; S5 deferred).
Verified: pytest 173/173 (+5 new: entry rule, ≤1 schedule, trigger reachability exit-1); builder
server 469/469 (13 new) + web 174/174 (5 new); 9th pattern passes 4 linters + 13 hooks +
`promote_gate eligible:true`; `find.py --has trigger` returns it; probe DSL passes all gates;
AC2 (live from-scratch build) pending a Builder run.
(r3 — implement-time probes 2026-07-13 OVERTURNED the review's blocker #2:
`POST /workflows/run` **works** for BOTH trigger-schedule AND trigger-webhook entries on the user's
Dify 1.15 (`status: succeeded`, correct outputs, inputs `{}`) — S4 is therefore simplified from
"skip run" to "run normally + manual-enable note". r2 folded the 4-agent impact review: 2 blockers
+ 6 moderates, every claim re-verified against code.)
**Effort**: S–M (S1+S1b = S, S2 = S, S3 = S–M incl. doc-sync, S4 = S; S5 deferred)
**Depends on**: 056 (trigger-surface rule — this extends its vocabulary), 049 (import-probe machinery),
036 (capability-aware test targets — S4 rides its shape), 050 (pattern conventions)

## Context

A user asked the Builder for a workflow with a **トリガー** start (goal: a schedule that runs
itself). After several Request-changes round-trips it still couldn't be produced, and they settled
for a normal user-input workflow. The stakeholder's feedback
「スタートノードをトリガーにする仕様で実装」 has now been **confirmed** to mean this (reading B);
spec 056 (reading A — raw-file inputs on the classic start) was the valid interim but its Non-goal
note overstated; this spec supersedes that note.

**Why the Builder cannot do it today** (all verified):

1. `tools/dify_base/validate_workflow.py` (~line 229) hard-errors `"Workflow must have at least one
   'start' node"` — a trigger-entry workflow fails the FIRST linter, so the ③ gate can never pass.
2. `tools/dify_base/lint_refs.py` reachability is start-rooted: `roots = [... if ty == "start" or
   ty in CONTAINER_START_TYPES]` (line ~272) — with a trigger entry, roots is empty → early-return
   advisory → **the spec-020 reachability gate is silently DISABLED** (empirically proven in the
   impact review: identical forward-ref graphs — start entry exits 1, trigger entry exits 0).
3. Zero skill guidance; a 定期/毎日 requirement gets re-shaped into a user-input workflow.
4. 0/8 patterns use a trigger entry; `find.py` has no trigger feature — and `analysis.ts` computes
   pattern-coverage advisories from index `has_*` keys, so a `trigger` feature without an indexed
   `has_trigger` would emit spurious "pattern missing feature" advisories (review finding → the
   index rider is REQUIRED, not optional; see S3).

**Why it is now cheap** (all verified 2026-07-13):

- Dify DSL **unchanged at 0.6.0** through 1.13 → 1.15 (code-checked on tags; the user's 1.15
  workspace reported `current_dsl_version: "0.6.0"` during the probe).
- **Live probe passed**: minimal `trigger-schedule` DSL imported via Console API
  (`status: completed`, no error) and **published** (success). Probe seed kept at
  `projects/_drafts/trigger_probe/workflows/main.yml` (gitignored, never indexed — spec 011 R2).
- Schema defs already present and correct for `trigger-schedule`
  (`NodeData_TriggerScheduleNodeData`, field-identical to 1.15). Review empirics on the probe DSL:
  validate_workflow fails ONLY the has-start error; lint_refs/lint_node_bodies/lint_plugin_hashes/
  check-jsonschema all pass; both runnability probes (TS inline python + report_structure.py) run
  clean on a no-start workflow with `runnable_blocker_classes=[]`.
- No other tools/ script or Builder backend module hard-assumes a start node (build_index, find,
  promote_gate, check_provenance, scaffold, criteria, analysis, diff, report, import, post-turn
  confinement, SPA — all swept in the review).

**Dify 1.15 semantics the design must mirror**: multiple triggers in parallel, **at most ONE
schedule trigger**; onboarding modal replaced by the on-canvas block selector (1.15.0, 2026-06-25);
production runs require **publish + trigger ENABLED** (Quick Settings). **GOTCHA**: entity
`timezone` defaults to **UTC** — a 9AM JST reminder silently becomes 18:00 unless `Asia/Tokyo` is
explicit (same class as the spec-050 `today`/JST incident).

**Scope note — this is a GENERAL Builder capability, not a fix for the ChatWork workflow.** The
ChatWork reminder was only the *discovery incident* (and stays untouched — Non-goals). Every slice
below applies to ALL future builds: S1/S1b harden the shared gate linters for any of the three
trigger types, S2 teaches the skill a new requirement class (定期/毎日/webhook — service-agnostic),
S4 fixes the ④ contract for any trigger build. S3's pattern is one teaching example (schedule →
fetch → notify), the same way `per-row-notify` teaches its class — not a ChatWork patch. Coverage
honesty: schedule + webhook are fully served at the gate layer; `trigger-plugin` is accepted by the
validator but its OAuth setup stays out of scope.

## Performance impact (4-phase runtime) — negligible; trigger builds get FASTER at ④

- **①/②**: S2 adds ~1KB of prompt text across analyze/spec/draft (~250 tokens on a ~8K-token skill
  body, <3% — and skill text is only part of the turn input). No new tool calls. Turn latency is
  dominated by generation, not prompt size at this delta. `implement.md` is untouched → ③ prompt
  unchanged.
- **③ gate**: the entry check replaces an existing O(nodes) has-start loop with a set-membership
  test (zero added cost); lint_refs roots is the same list comprehension with a wider set; the
  TYPE_TO_DEF fix is a dict-key rename. The 4 linters already run in parallel
  (`Promise.all(LINTERS…)`, post-turn.ts/report.ts) — wall-clock unchanged.
- **④**: non-trigger builds pay one extra JSON field (`entry_types`) and one text predicate —
  microseconds. Trigger builds run the SAME ④ flow as any build (r3 probes proved `/workflows/run`
  works for trigger entries) — identical cost, plus one advisory note string. The only manual step
  left is enabling the trigger (UX, not compute).

## Goals

- **G1 — the gates accept trigger-entry workflows** with **zero behavior change for existing
  start-workflows**, and with the spec-020 reachability guarantee EXTENDED to trigger entries
  (not silently dropped).
- **G2 — the skill proposes triggers when the requirement asks for them** (毎日・毎朝・定期・
  スケジュール・自動で・webhook経由), with the timezone + machine-fetchable-data rules.
- **G3 — a vetted pattern exists** (`scheduled-fetch-notify.yml`, 9th), seeded from the probe DSL.
- **G4 — the ④ gate stays honest**: import+publish works, the gate never pretends to have live-run
  a schedule, the card carries the app link and says exactly what remains manual.

## Non-goals

- Automating trigger ENABLE (no known Console-API surface — OQ1; manual enable + gate note is v1).
- `trigger-plugin` beyond validator acceptance (per-plugin OAuth — revisit with the
  使用頻度の高いツール work).
- Live-RUNNING a schedule/webhook in ④ (see S4 — the run step is explicitly skipped).
- Multiple-entry authoring guidance (validator won't reject start+triggers on one canvas, but
  patterns/skill teach single-entry shapes only).

## Design — additive-only; start-workflows byte-identically handled. **S1/S1b/S4 ship in the SAME release** (blocker finding: S1 alone makes a misleading ④ live-run reachable; S3's pattern commit hard-depends on S1 being in the same tree because the `dify-skill-validate` pre-commit hook runs `validate_workflow.py` over `templates/patterns/`).

### S1 — validator + node-body linter entry support (S)

`tools/dify_base/validate_workflow.py`:

- `ENTRY_TYPES = {"start", "trigger-schedule", "trigger-webhook", "trigger-plugin"}`; error only
  when no node's type is in ENTRY_TYPES. New message: `"Workflow must have at least one entry node
  (start or trigger-*)"` (verified: no test asserts the old string; all existing fixtures carry a
  start node and pass unchanged).
- New rule: **>1 `trigger-schedule` node → error** (mirrors Dify).
- `_validate_start_node` keeps running for `start` nodes only.
- Note: ENTRY_TYPES deliberately omits Dify's fifth `is_start_node` member `datasource`
  (rag-pipeline app mode, which this validator already rejects at `app.mode`).

`tools/dify_base/lint_node_bodies.py` (review finding — wrong TYPE_TO_DEF keys): rename keys
`"webhook"` → `"trigger-webhook"` and `"trigger-event"` → `"trigger-plugin"` (values unchanged;
Dify's enum defines `trigger-webhook`/`trigger-schedule`/`trigger-plugin` as the wire strings —
today webhook/plugin bodies are warn-skipped). Safe: the drift tests bind on VALUES, not keys.

Tests: trigger-schedule-only workflow passes; zero-entry errors with the new message; two schedule
triggers error; every existing fixture unchanged.

### S1b — lint_refs reachability roots (S) — **blocker fix**

`check_reachability` roots must include trigger entries:
`roots = [nid for nid, ty in node_type.items() if ty in ENTRY_TYPES or ty in CONTAINER_START_TYPES]`,
and the no-root advisory text becomes "add an entry node (start or trigger-*) or verify the graph".
Existing no-root advisory tests stay valid (their fixture uses only llm nodes). New test: trigger
entry + forward ref → **exit 1** (the case proven to slip through today).

Do NOT register trigger output fields in `_node_output_fields` in this spec (OQ3): unknown-type →
skip is permissive; registering empty sets would flip refs to trigger fields from skip to hard
error. The stderr "unknown node type trigger-*" warning is expected noise until OQ3 lands
(exit-code gating is unaffected — `lintClean` is exit-code-only).

### S2 — skill guidance (`analyze.md`, `spec.md`, `draft.md`) (S)

Additive sentences only; verified safe against every pin (content-language byte-pin, no-{{TOKEN}}
render pin, slug-charset, knowledge-inject — mechanically simulated in the review). Keep additions
inside `## Do` bodies; no `{{UPPERCASE}}` sequences; never write the literal `[a-z0-9_-]`.
`analyze.md` has no render-pin safety net — review the rendered ① prompt once manually.

- `analyze.md` (trigger-surface bullet, extending 056): a requirement that should run **by itself**
  (毎日・毎朝・定期・スケジュール・自動で・〜をトリガーに・webhook経由) has a **trigger node** as
  its surface — name the type and, for schedules, time + timezone. Autonomous modes: assume
  `trigger-schedule` when a cadence is named; state the assumption.
- **Vocabulary (review finding — contradiction fix)**: append `trigger` to BOTH hand-enumerated
  verbatim feature lists — `draft.md`'s MUST bullet and `analyze.md`'s from-scratch item 2 — in the
  same edit. Without this the model may lawfully drop the feature and a schedule→llm requirement
  auto-advances in fast+auto into a start→llm→end shape. Lands with (or before) S3's `has_trigger`
  index rider so vocabulary and `find.py --has trigger` stay in sync.
- `spec.md` (sub-bullet under the 056 trigger-surface step): trigger designs must state
  (a) `timezone: Asia/Tokyo` explicitly (**UTC default gotcha**), (b) ≤1 schedule trigger,
  (c) **machine-fetchable data source** (http-request/tool/dataset — no required user-file inputs
  with a trigger entry), (d) delivery is a side-effect (notify/write).
- `draft.md` (fast-mode honesty clause, after 056's sentence): a self-running cadence/webhook
  requirement is NEVER a pure single-LLM transform — write `trigger` honestly so fast mode pauses
  (verified: `featuresSubsetOfLlm` is fail-safe — any non-llm feature parks the build).

### S3 — pattern `templates/patterns/scheduled-fetch-notify.yml` (9th) + index feature (S–M)

Shape: `trigger-schedule` (visual daily, `time` TODO, `timezone: Asia/Tokyo`) → `http-request`
fetch data (TODO URL; env-var token) → `code` parse (defensive, never raise) → `llm` compose (B5
blank model) → `http-request` notify (no-auth + custom header via env secret) → `end` (status).

- `# Use case:` header + `# TODO:` markers; **`dependencies: []` written explicitly** (a bare
  `dependencies:` parses to None and fails pattern-consistency); `version: 0.6.0`.
- GOTCHA block: UTC-default timezone; publish **AND enable** required (workflow does nothing until
  the trigger is enabled in Quick Settings); ≤1 schedule; machine-fetchable data only;
  non-idempotent notify.
- Provenance stanza: `x-provenance: source=original … license=MIT spec=057
  known_good_dify=1.13.0` (must equal `.dify-tag` for the pytest `--strict` run). **The 1.15
  honesty note must be EQUALS-FREE prose** (review-verified parser footgun: any `key=value` token
  in a nearby comment silently overrides stanza fields — last occurrence wins). Pinned comment:
  `# Live import and publish verified on the user's Dify 1.15.0 during the 2026-07-13 probe.`
- **`build_index.py` `has_trigger` — REQUIRED** (promoted from optional; analysis.ts advisory
  correctness depends on it): a **computed key** in `analyze()` like `has_file_input`
  (`any node type startswith('trigger-')`) — NOT an INTERESTING_NODE_TYPES append (that would yield
  `has_trigger_schedule` and `--has trigger` would not match). `find.py` needs no change
  (`--list-features` derives dynamically).
- Same-commit doc-sync (dynamic drift tests): pattern count 8→9 — README tree ~line 76 + patterns
  table row + 1.C bullet **and its name list**, AGENTS §1 + §8, architecture ×2, GUIDE §5 (~line
  237); INDEX rebuild 44→45 ⇒ README headline `~44 template` → `~45`, **plus the surfaces the r1
  draft missed** (review finding): AGENTS §1 `(43-file template index)` → `(45-file template
  index)` (it is already one behind today), `docs/project-overview-vi.md` `~44` → `~45`, GUIDE
  ~line 217 `~44` → `~45`. Land AGENTS.md references and the pattern file in the same commit
  (`check_agents_refs.sh`).
- Caveat: the upstream **mango-svip skill-clone validator also hard-requires a start node**
  (review-verified by running it) but is wired into no gate — the vendored
  `tools/dify_base/validate_workflow.py` is canonical (spec 026). Do not run the skill-clone
  validator on this pattern; adjust README's "(all validate against schema + skill validator)"
  phrasing for the 1.C bullet accordingly.

### S4 — Builder ④ honesty for trigger workflows (S) — SIMPLIFIED by the r3 probes

**Probe result (2026-07-13, user's Dify 1.15)**: `POST /workflows/run` with `inputs: {}` against a
published trigger-entry app **succeeds and returns real outputs** — for BOTH `trigger-schedule` and
`trigger-webhook` (probe apps: import completed → publish success → run
`{"status": "succeeded", "outputs": {...}}` → deleted). The review's blocker #2 ("misleading run")
assumed Dify rejects the run; it does not — the API run is a manual fire of the same graph. The ④
live flow (import → publish → mint → run → judge) therefore **stays unchanged** for trigger builds:
`inputs_schema=[]` naturally yields `inputs {}`, no `need_input` park, and the judge verdict is
REAL.

What remains for honesty — a "live-test pass ≠ auto-run" note:

- **Detection seam**: `sync.py inject-model` now emits `entry_types: [...]` (landed with S1); mirror
  as optional `DeployResult.entryTypes?: string[]` in `dify-io.ts`, defaulting to assume-start when
  absent (the `llm_count` graceful-degrade precedent). Do NOT key off `inputs.length === 0`.
- **Advisory note** on every trigger-entry deploy (live AND static paths): the pure-text-predicate
  seam of `hasUnresolvedPluginTodo` (report.ts noteParts) plus the live-test result note. Backend
  emits an ENGLISH wording-stable line — `trigger-entry workflow: the API run above was a manual
  fire — the schedule/webhook only runs automatically after you ENABLE the trigger in Dify Studio
  Quick Settings` (`// wording-stable (NOTE_JA keys off this)`); `web/src/lib/i18n.ts` gains one
  NOTE_JA frame rendering 「トリガー起動のワークフローです。上のテスト実行は手動実行です —
  スケジュール/Webhook の自動起動は Studio の Quick Settings でトリガーを有効化した後に作動します」.
  Tests pin the EN string + the JA frame.
- **Card fix (kept from review)**: Chat.tsx's `infra_degraded` branch does not surface `lt.appUrl`
  — add the app-link summary line there (benefits every post-import infra park; no longer on the
  trigger path itself, which now ends at `test_result` like any build).
- S1 and S4 still land together: S1 opens the gate, S4 adds the note that keeps ④ honest.

### S5 (deferred) — trigger enable via API + webhook URL surfacing

Investigate the Console endpoints behind Quick Settings enable/disable and webhook URL allocation.

## Open questions

- **OQ1** — Console-API for trigger enable/disable (S5; v1 ships manual-enable).
- **OQ2** — Pattern data source default: http-request fetch (proposed) vs bare trigger→LLM.
- **OQ3** — Register trigger output fields in `lint_refs`/`IMPLICIT_OUTPUTS` (webhook payload,
  schedule `$current_time`)? Defer until a real build consumes them; prerequisite: S1's
  TYPE_TO_DEF key fix. Never register as empty sets.
- **OQ4** — ③ preflight "remember to enable" advisory? *Proposed: ④ only; preflight stays 4-class.*
- **OQ5** — Should a trigger entry under `app.mode: advanced-chat` warn (Dify has no chatflow
  trigger surface)? *Proposed: warning-only if added; not required for v1.*

## Acceptance criteria

1. Trigger-schedule-only workflow passes all 4 linters; two schedule triggers → error; a
   trigger-entry workflow with a forward ref → `lint_refs` **exit 1** (the silent-pass case);
   full existing pytest suite passes unchanged.
2. From-scratch build of 「毎朝9時に…を確認してChatWorkに通知」 (each_step): ① digest names a
   schedule trigger with time+timezone; ② SPEC declares `timezone: Asia/Tokyo`, a machine-fetchable
   source, no required user-file inputs; ③ emits a trigger-entry `main.yml` passing the gate;
   ④ live path runs END-TO-END (import → publish → run → judge — r3 probes proved the run works)
   and the gate card carries the manual-enable JA note.
3. `scheduled-fetch-notify.yml` lands in the same tree as S1; Use-case header, explicit
   `dependencies: []` (grep `marketplace_plugin_unique_identifier` = 0), equals-free 1.15 comment;
   passes 4 linters + applicable pre-commit hooks + `promote_gate.py check --distilled` lint tier;
   `find.py --has trigger` returns it after INDEX rebuild; ALL count surfaces updated same-commit
   (README ×3 + headline, AGENTS §1 both counts + §8, architecture ×2, GUIDE ×2,
   project-overview-vi) — `pytest tests/` green.
4. Builder suites green (`npm test` server+web); skill pins untouched; fast+auto on a
   schedule-shaped requirement PAUSES (features carry `trigger`).
5. Spec 056's Non-goal paragraph amended to point here; AGENTS.md §9 dated entry (confirmed
   reading + UTC gotcha), same commit as the pattern.

## References

- Impact review (2026-07-13, 4-agent adversarial pass): 2 blockers (start-rooted reachability
  silently disabled for trigger entries — empirically proven; S1-without-S4 misleading live-run),
  6 moderates (TYPE_TO_DEF keys, detection seam, i18n convention, card appUrl, vocabulary lists,
  provenance comment footgun) — all folded above. Cleared: validator fixtures, runnability parity,
  every skill pin, backend/SPA start-assumption sweep, provenance strict plan, hook arithmetic.
- Live probe 2026-07-13: import `{"status": "completed", "imported_dsl_version": "0.6.0",
  "current_dsl_version": "0.6.0"}`, publish `{"result": "success"}`; probe app deleted.
- Dify 1.15.0 entities (vendor tag): `trigger_schedule/entities.py` (**UTC default** timezone;
  VisualConfig 12-hour `time`), `core/trigger/constants.py` (wire strings), `enums.py`
  `is_start_node` (incl. `datasource`).
- [056](056-start-node-as-trigger-raw-inputs.md) · [049](049-dify-import-blocker-defense.md) ·
  [036](036-builder-capability-aware-test-targets.md) · [020](020-builder-graph-reachability-linter.md) ·
  [045](045-turn-failure-triage.md) (EN wording-stable + NOTE_JA convention).
- Memory: `trigger-entry-roadmap`.
