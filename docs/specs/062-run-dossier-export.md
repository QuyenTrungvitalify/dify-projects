# Spec 062 — Run dossier export: one button → a zip that explains a run

**Status**: **Implemented — Slice 1** (2026-07-16; full-flow capture: S1 per-attempt transcript
[`run-transcript.ts`], S1b timeline [`run-events.ts`], S2 zip [`zip.ts`] + bundle [`bundle.ts`] +
`GET /api/tasks/:id/bundle`, S3 [`dossier.ts` + `cost-cause.ts`], S4 Export button, S5 redaction —
**+36 unit/integration/route tests, server 509/1-pre-existing-creds, web 188, typecheck+build clean; zero
regression, broadcast byte-identical**. Deferred to Slice 2: raw tool payloads, full Ask-Q&A thread,
wall-clock event log, `live_test` verdict event on the live-test path, browser-QA of the button.
**Live-QA r5 (2026-07-16)**: a real user export surfaced + fixed two dossier bugs — `criteria.json` is an
array of STRINGS (not `{criterion}` objects), so the acceptance rubric rendered empty; and the Gaps rows
doubled the note's own `preflight:`/`probe:` label. Both fixed + pinned with regression tests against the
real shapes. Also folded a **tool-activity tally** into `summary.md`'s `## Process` — `parseToolStats`
[`run-transcript.ts`] parses each transcript's `### Tool calls` back into per-phase `N calls, M ✗ (%)
— top tools`, so the "how much groping" a ③-cost analysis hand-counts now reads at a glance; pure,
no orchestrator touch, +5 tests.
**Fleet-data r6 (2026-07-16)** — for using client exports to improve the Builder, folded two provenance/
aggregation adds: **`build-info.json`** (git SHA · builder version · node · **model id** — `costFromResult`
now reads `result.modelUsage`; correlate behavior ↔ version) and **`dossier.json`** (machine-readable twin
of `summary.md` — `buildDossierData`, so N zips aggregate with `jq` keyed on `gitSha`). Both pure, no
orchestrator touch, +7 tests. Still open (bigger, deferred): failed-tool output text, the Ask-Q&A thread,
and a fleet-collection channel — the export stays per-run/manual by design (privacy Non-goal).)
Approved (authored 2026-07-16; **r2 2026-07-16** — review pass folded: cap wording,
truncate-per-spawn, in-memory/attachment bound, binary-not-redacted, zip round-trip + classifier-drift
ACs. **All OQ resolved**: OQ1 = hand-rolled store-only zip, OQ5 = ~25 MB attachment cap; OQ2–OQ4 folded
as proposed). **r3 2026-07-16** — attachments simplified: always included (~25 MB cap), opt-in toggle +
⌥/alt UI dropped. **r4 2026-07-16** — max-context redesign: S1 now per-attempt (prompt + output +
tool-summary + result, all attempts appended, flush-on-error/timeout/cancel), new S1b run timeline
(`events.jsonl`), `summary.md` gains `## Flow` + `## Process`; OQ4 → tool-summary folded, raw trace
deferred; **effort M→L, staged** (Slice 1 = full-flow). Claude authors; implement on confirm.
**Effort**: L (S1 per-attempt transcript incl. prompt+output+tool-summary+result = M, S1b run
event-log/timeline = S, S2 zip assembler = M, S3 summary.md incl. Flow/Process = M, S4 button = XS,
S5 redaction = XS). **Staged**: Slice 1 = full-flow capture (S1/S1b/S3 core + S2/S4/S5); Slice 2
(follow-up) = raw tool payloads + full chat thread (Ask Q&A) + wall-clock event log.
**Depends on**: spec 059 (`task.cost` — the cost/cause in the dossier), spec 032 (`criteria.json`,
liveTest judge), spec 037 (preflight note), spec 049 (probe note), `redactSecrets`
([dify-io.ts:120](../../apps/builder/server/lib/dify-io.js)).

## Context

A run's story is scattered across the disk: `task.json` (requirement, status, **cost/cause**, gate,
notes) in `.runs/<taskId>/`, alongside `analyze.json` / `criteria.json` / `report.json` / `diff.json`
/ `preflight.json` / `workspace.json`; the **SPEC.md** and the **DSL** (`workflows/*.yml`) live under
`projects/<project>/<slug>/`; user attachments under `.runs/<taskId>/uploads/`. To understand *why a
run turned out the way it did — and what to improve* — a user (or a Claude session they hand it to)
must currently open six files in two trees and reconstruct the picture by hand.

The user wants **one header button → a zip with everything** needed to grasp the run and its
improvement gaps. Architecture chosen (this session): a **backend endpoint that streams a zip of the
on-disk files + attachments, PLUS backend steps to persist the full per-attempt transcript (prompt +
output + tool-calls + result, S1) and a run timeline (S1b)** — today that process is FE-only (the phase
output is capped in localStorage; the prompt, the tool calls, prior attempts, and the gate-decision
timeline are never persisted), so a pure-backend bundle would miss the richest "why did ③ do X" signal.

**What is NOT in the run dir today (verified):** the per-phase Claude transcript — nor the **prompt**
that produced it, the **tool calls** it made, any **prior attempt**, or a **timeline** of gate
decisions. `runPhase` relays only assistant text via `onText → broadcast('phase:output')`
([orchestrator.ts:433](../../apps/builder/server/lib/orchestrator.js#L433)); the prompt string, the
`tool_use`/`tool_result` blocks (which already flow through `session.onEvent`,
[turn-runner.ts:130](../../apps/builder/server/lib/turn-runner.js#L130)), the `result` metrics, and
every re-run all evaporate when the turn ends. S1/S1b close that. No zip/archive dependency exists in
the repo either.

## Goals

- **G1 — one click, one file**: a header button on an open run → downloads
  `builder-<slug>-<taskId>.zip` with the full run picture. Works for done / error / still-running
  (whatever artifacts exist so far).
- **G2 — a readable dossier, not a raw dump**: a generated `summary.md` at the zip root that states
  intent → result → cost/cause → gaps, so the reader grasps "what to improve" in one screen.
- **G3 — the whole flow is inspectable, not just the artifacts**: for every phase and **every
  attempt**, persist the **exact prompt sent to `claude`**, the assistant output, a **tool-call
  summary**, and the result (cost/turns/cache/error) — plus a run-level **timeline** of phase-starts,
  gate decisions (confirm / request-changes + the user's text / ask), errors and retries. The reader
  sees *why* the build went the way it did, including the bumps in the middle.
- **G4 — safe to share**: secrets redacted defensively across every text file; the zip is a local
  download the user triggers, never auto-sent. The user's attachments ride along (bounded by a size cap).

## Non-goals

- Not a workflow-level history export (this is per-RUN / per-taskId; aggregating a workflow's many
  runs is a future extension).
- Not an upload/telemetry feature — the zip is a LOCAL download the user chooses what to do with; it
  is never sent anywhere automatically.
- Not a full RAW tool trace in v1 — S1 captures a **tool-call summary** (each `tool_use`'s name + a
  short arg digest + ok/err from `tool_result.is_error`); dumping every raw `tool_use.input` /
  `tool_result.content` payload (can be megabytes) is a named follow-up, as is the full chat thread
  (Ask Q&A beyond the change-request text) and a wall-clock event log.
- Not compression-optimal — the payload is small text; a store-only (uncompressed) zip is fine.

## Design

### S1 — persist the full per-attempt transcript (prompt + output + tools + result) (M)

Today `runPhase` relays only assistant text via `onText → broadcast('phase:output')`
([orchestrator.ts:433](../../apps/builder/server/lib/orchestrator.js#L433)); the prompt, the tool
calls, the result metrics, and every prior attempt vanish when the turn ends. S1 records the whole
thing to `.runs/<taskId>/transcripts/<phase>.md`, **appending one block per attempt** — no overwrite;
the messy middle is exactly what G3 wants. This **supersedes the r2 "last-run-wins / truncate-per-spawn"
call**: the transcript now keeps every attempt (an error→retry keeps both). `task.cost` stays last-wins
in `task.json` (spec 059) — no conflict; the transcript is the richer record.

Each spawn ([`spawnOnce`](../../apps/builder/server/lib/orchestrator.js#L419)) appends a block:

```md
## ③ Implement — attempt N · resume=<yes|no> · <ISO-ts JST> · outcome: <gate|ERROR|cancelled>
### Prompt (sent to claude)
<the exact constructed prompt — fresh or resume — REDACTED (S5); carries {{KNOWLEDGE}} / requirement / attachment refs>
### Assistant output
<the onText stream, tail-capped ~64 KB>
### Tool calls
- Edit  projects/…/main.yml             ✓
- Bash  "validate_workflow.py main.yml"  ✗ exit 1
… (name + short arg digest + ok/err — from the `tool_use` / `tool_result` content blocks)
### Result
cost=$<usd> · turns=<n> · cache=<%> · duration=<s> · <error note / spec-045 triage if any>
```

- **Data sources — all already flowing, none new to the subprocess:**
  - *Prompt* — the `prompt` string `spawnOnce` passes to `runTurn` / `session.spawn` (`freshPrompt` or
    `resumePrompt`).
  - *Assistant output* — the existing `onText` tee.
  - *Tool calls* — the `tool_use` / `tool_result` blocks already in `session.onEvent`'s `assistant` /
    `user` events ([turn-runner.ts:130](../../apps/builder/server/lib/turn-runner.js#L130)); surface
    them via a small `onEvent` / `onTool` hook on `runTurn` opts — a modest extension of the `onText`
    seam, no new plumbing.
  - *Result* — the terminal `result` event (spec 059 already parses cost/turns/cache from it).
- **Buffer + flush**: accumulate in memory, flush on **every** attempt-end — success, gate, **error,
  timeout, OR cancel** (a `finally`, not just a clean phase-end) so a crash's tail survives (the #1
  thing you want when it dies mid-way). Non-fatal on write error (never breaks a turn).
- **Cap** the assistant portion per attempt (tail + `…truncated…`, same shape as the FE `capRunOutput`
  / `RUN_OUTPUT_CAP` = 32 KB; **propose ~64 KB** server-side — disk isn't localStorage-quota-bound). The
  prompt + tool-summary are bounded already.
- The merged fast-mode draft appends under `transcripts/spec.md` (its phaseId), consistent with the
  cost map.

### S1b — the run timeline / event log (S)

`.runs/<taskId>/events.jsonl` — one JSON line appended at each orchestrator transition (the points that
already call `emit` / `saveTask` / handle a gate action): `phase_start`, `gate_reached`, `gate_action`
(`confirm` | `request_changes` **+ the user's change text** | `ask` **+ the question**), `error` (+
spec-045 triage), `retry`, `live_test` (verdict). Each line `{ ts, phase, kind, detail }`. Append-only,
non-fatal on write error. This is the backbone S3 renders as `## Flow`, and the machine-readable trace a
Claude session can replay. The user-side text (replies / change-requests / ask questions) rides in
`detail` — so the bundle captures the user's steering, not just the assistant's output.

### S2 — the bundle endpoint + zip assembler (M)

`GET /api/tasks/:id/bundle` → assemble and stream a zip (`Content-Type:
application/zip`, `Content-Disposition: attachment; filename="builder-<slug>-<taskId>.zip"`). It is a
**read** endpoint → register it in [routes/ui.ts](../../apps/builder/server/routes/ui.js) (beside
`GET /api/tasks/:id/spec`), NOT the gated `tasksRoutes` (POST confirm/reply/cancel). Sanitize `<slug>`
in the filename (reuse the [slug util](../../apps/builder/web/src/lib/slug.js) shape) so a stray char
can't break the `Content-Disposition` header.

**Manifest** (include only what exists; a missing file is simply omitted and noted in `summary.md`):
```
summary.md                 ← S3, the dossier (generated, human-readable)
dossier.json               ← #2, the machine-readable twin of summary.md (fleet aggregation via jq)
build-info.json            ← #1, provenance stamp (git SHA · builder version · node · models · exportedAt)
task.json                  ← redacted (S5): strip sessionIds; cost/notes/verdict kept
analyze.json  criteria.json  report.json  diff.json  preflight.json  workspace.json
SPEC.md                    ← from projects/<p>/<slug>/ (or the pre-scaffold .runs copy)
workflows/<file>.yml       ← the DSL (+ any extra workflow files)
transcripts/<phase>.md     ← S1 (per attempt: prompt + output + tool-summary + result)
events.jsonl               ← S1b (the run timeline: phases · gate decisions · errors · retries)
attachments/…              ← the user's uploaded files, ALWAYS included (over the size cap → rest omitted + noted)
```

**Zip writer — dependency-free, store-only** (recommended, OQ1): a ~80-line writer emitting local file
headers + CRC32 + central directory + EOCD, no compression (the payload is small text; deflate buys
little and adds risk). Keeps the repo lean (no `archiver`). Assemble in memory and `reply.send(buffer)`
— no temp files, no streaming-archive lifecycle.

**Attachments are always included, bounded by a size cap.** The on-disk artifacts + transcripts are
small text (KBs); the user's uploaded attachments can be multi-MB PDFs/images. Since the zip is
assembled in memory, **cap total attachment bytes at ~25 MB** as a safety valve: within budget → all
attachments bundled; over budget → bundle up to the cap, skip the rest, and state the omission in
`summary.md` (the never-silent rule, S5). A higher ceiling later ⇒ switch this endpoint to a streaming
archive (out of scope here).

Path resolution reuses `specPathFor` / `workflowDir` / the run-dir artifact paths already in
[artifacts.ts](../../apps/builder/server/lib/artifacts.js). Confinement: only read under
`.runs/<taskId>/` and the task's `projects/<project>/<slug>/` subtree — never arbitrary paths.

### S3 — `summary.md` generator (S)

A **pure** function `buildDossier(task, files) → string`. One screen, improvement-oriented:

```md
# Run dossier — <name or slug> · <taskId>

**Intent**    <requirement>
**Result**    status=<done|error|…> · phase=<④> · runnable: <yes|no — from preflight/probe>
**Pattern**   <analysisPattern> · features [<…>]

## Flow — what happened, in order            (events.jsonl → S1b)
① Analyze            ✓ confirm                 · $0.03 · 2 turns
② Spec               ⤺ request-changes          "đổi Slack → Teams"
② Spec (re-run)      ✓ confirm                  · $0.05
③ Implement          ✗ ERROR                    lint gate: plugin hash TODO
③ Implement (retry)  ✓ confirm                  · $0.11 · 11 turns
④ Test               ⚠ live-run FAIL            node 'summarize' KeyError → done-with-warning

## Acceptance criteria            (criteria.json + the ④ judge)
- [x] <criterion>            ← ✓/✗ per the liveTest judge / report
- [ ] <criterion>

## Cost & cause (spec 059)
| phase | share | turns | cache% | cause |
…
→ <hint: e.g. "② spec 36% · tool-loop → fewer internal turns"> (balanced-aware)

## Gaps to improve
- preflight: <preflightNote>
- probe:     <probeNote>
- report:    <report.notes>
- error:     <task.error / spec-045 triage>   (if any)

## Process — attempts & steering              (per-phase detail → transcripts/<phase>.md)
- ③ Implement: 2 attempts (1 error → 1 ok) — see transcripts/implement.md (prompt + tools + output)
- user steering: ② "đổi Slack → Teams" (request-changes)

## Graph (DSL)                    <n nodes: start → … → end>   — see workflows/<file>.yml
## Files in this bundle           <listing + what was omitted>
```

The cost `cause` reuses spec 059's decision rules — **but `diagnose()` lives in the FE
([web/src/lib/dev.ts](../../apps/builder/web/src/lib/dev.js))**. OQ2: duplicate the ~15-line classifier
server-side (cold-start ▸ tool-loop ▸ generation ▸ inconclusive, + balanced) vs render the raw cost
table only and point at the dev panel. *Proposed: duplicate the tiny classifier — the dossier is worth
a self-contained verdict.*

### S4 — the header button (XS)

In the conversation-view header ([App.tsx](../../apps/builder/web/src/components/App.tsx), the
`chat-top-right` cluster, beside "Artifact"/"Edit this workflow"): a `ghost-pill` **"⬇ Export"** shown
when a run is open and has at least one artifact (running/done/error). Click → trigger the browser
download of `GET /api/tasks/:id/bundle` (an `<a download>` or fetch→blob→objectURL). NOT dev-gated —
this is a first-class user feature (unlike the `?dev=1` panel). A tooltip names what's inside (the
dossier + artifacts + transcripts + the user's attachments). No opt-in toggle in v1 — the button always
downloads the full bundle (attachment opt-out is a deferred follow-up if size/privacy ever bites).

### S5 — redaction & confinement (XS)

- Run every **text** file (summary.md, task.json, the `*.json` artifacts, SPEC.md, the DSL yml,
  transcripts) through `redactSecrets` (dify-io.ts:120) before adding to the zip — defense in depth
  (task.json already carries no creds; the turn env is stripped — but a DSL/report could echo a pasted
  token). `summary.md` is generated in memory → redact it too, after building and before it enters the
  zip (not only the on-disk files).
- Strip `sessionIds` from the bundled `task.json` (internal claude session ids — noise, not useful to
  a reader).
- Attachments are **user data**, always included (the zip is a local download the user triggers, never
  sent anywhere — Non-goals). They are **binary** → added **raw**, never passed through `redactSecrets`
  (it operates on text and would corrupt a PDF/PNG). Bounded by the ~25 MB cap (S2); any overflow is
  stated in `summary.md` so the omission is never silent.
- The endpoint reads ONLY the run dir + the task's workflow subtree (confinement); it never takes a
  path from the request.

## Open questions

- **OQ1 — zip mechanism** *(RESOLVED r2 — hand-rolled store-only zip)*: dependency-free ~80-line
  store-only writer (lean, payload is tiny text; hand-rolled ⇒ the AC #1 `unzip -t` pin is load-bearing).
  (Rejected: `archiver` dep — against the repo's lean ethos; `tar.gz` — worse Windows double-click.)
- **OQ5 — attachments** *(RESOLVED r3 — always included, ~25 MB cap)*: v1 drops the opt-in
  `?attachments=1` toggle and the ⌥/alt UI — the bundle **always** includes the user's attachments,
  bounded by a ~25 MB total cap (in-memory safety valve); overflow omitted + noted in `summary.md`.
  (Streaming archive + an attachment opt-OUT are deferred until size/privacy is a real concern.)
- **OQ2 — cause in summary** *(RESOLVED r2 — folded)*: duplicate the ~15-line 059 classifier server-side,
  **pinned against the FE `classify()`** by AC #3 so it can't drift. (Rejected: raw table only — the
  dossier is worth a self-contained verdict.)
- **OQ3 — button visibility** *(RESOLVED r2 — folded)*: always in the header; `summary.md` marks a
  partial run "IN PROGRESS".
- **OQ4 — transcript fidelity** *(RESOLVED r4 — max-context redesign)*: capture per attempt the
  **prompt + assistant output + tool-call summary + result**, all attempts appended (S1), plus a run
  **timeline** (S1b). Deferred (Non-goals): raw `tool_use.input` / `tool_result.content` payloads, the
  full Ask-Q&A chat thread, and a wall-clock event log.

## Acceptance criteria

1. `GET /api/tasks/:id/bundle` returns a valid zip containing `summary.md` + every artifact that exists
   for the run + `transcripts/<phase>.md` for each phase that ran. **Machine-pinned**, not just a manual
   open: a unit test runs the emitted buffer through the system `unzip -t` / `unzip -l` (present on macOS
   + CI Linux) — a bad CRC32 / central-directory / EOCD fails `-t`, catching a subtly-malformed store
   zip that Finder tolerates but Windows Explorer rejects.
2. After a build, `.runs/<taskId>/transcripts/<phase>.md` exists for each phase that ran and holds,
   **per attempt**, the exact prompt sent + the assistant output (capped) + a tool-call summary + the
   result (cost/turns/cache/error). Attempts are **appended, not overwritten** — an error→retry keeps
   BOTH blocks. The buffer flushes on attempt-end including **error / timeout / cancel** (a crash's tail
   survives). A write failure never fails the turn (builder tests stay green).
3. `summary.md` renders intent + result + acceptance ✓/✗ + the 059 cost table with a cause hint +
   the gap notes, and lists what the bundle contains + what was omitted. A partial (errored /
   in-progress) run produces a coherent dossier noting the missing pieces. The server-side cause
   classifier (OQ2) is **pinned against the FE `classify()`**: a unit test feeds the same cost-object
   vectors as [dev.test.ts](../../apps/builder/web/src/lib/dev.test.js) and asserts identical causes, so
   the duplicated 059 rules can't silently drift.
4. The header "⬇ Export" button appears on an open run and downloads the zip; the user's attachments are
   included up to the ~25 MB cap, and any cap-overflow omission is stated in `summary.md`.
5. No secret leaks: every text file — **including the captured prompts** (they carry the `{{KNOWLEDGE}}`
   block: plugin hashes / dataset ids) — passes `redactSecrets`; `sessionIds` are stripped from the
   bundled task.json; the endpoint reads only the run dir + the task's workflow subtree (unit-pinned
   confinement — a crafted id can't escape).
6. No regression: `pytest tests/` + builder `npm test` green; the added `onEvent`/transcript tee leaves
   the live broadcast path byte-identical (the `onText` fragments still reach the SSE relay unchanged —
   only added file writes + a new event hook).
7. `.runs/<taskId>/events.jsonl` records the ordered run timeline — phase-starts, gate decisions
   (confirm / request-changes **with the user's change text** / ask), errors, retries, live-test verdict
   — and `summary.md`'s `## Flow` renders it as a readable sequence (the build's "dòng chảy").

## References

- [059](059-phase-cost-instrumentation.md) — `task.cost` (the cost/cause the dossier surfaces) +
  the `diagnose()`/`classify()` rules S3 reuses.
- `artifacts.ts` (`specPathFor`, run-dir paths), `orchestrator.ts:433` (the `onText` tee point) /
  `:419` (`spawnOnce`, the per-attempt seam), `turn-runner.ts:130` (`session.onEvent` — the
  `tool_use`/`tool_result` + `result` stream the tool-summary/metrics read), `dify-io.ts:120`
  (`redactSecrets`).
- Prior art: `/report` skill (reads a run's artifacts + transcripts to grade) — the dossier is the
  offline, shareable counterpart of that read.
