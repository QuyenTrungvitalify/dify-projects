# Spec 045 — Turn-failure triage: surface the REAL cause when the `claude` CLI dies

**Status**: **Implemented** (2026-07-08, same day as authored — r2 folds the adversarial review's 2
blockers + 6 findings). **Small** (S): a bounded stderr ring in `claude-session.ts` (fed by BOTH the
stderr stream and the `'error'`(ENOENT) event), a pure classifier in `turn-runner.ts` wired at its THREE
non-timeout failure paths, a warn-only boot check, JA note frames + the one-line `errLines.map(localizeNotes)`
in `Chat.tsx` (the only FE plumbing change — without it the frames were dead, review blocker #2). No
gate/FSM change, no new Task field (additive `TurnResult.failureCls` only), no new deps.

> **Reference the SYMBOL, not the line.** Anchors verified 2026-07-08.

**Motivation (field incident, 2026-07-08)**: a UAT user's build failed with the gate showing only
`実装でエラー / exit 1 / artifact missing: projects/_drafts/chatwork_2/workflows/main.yml`. The real cause —
the `claude` CLI was out of usage quota — was visible ONLY in the CLI's stderr, which
`claude-session.ts` logs to the server log and discards (`onStderrData` → `this.log.error(...)`), while
`turn-runner.ts onExit` emits the generic note `process exited code ${code} before a result event`.
The user cannot self-diagnose; every environment failure (quota, not-logged-in, network, missing binary)
renders as the same misleading pair of lines. Remote triage cost a full prompt-driven diagnostic session
for what one classified note would have said instantly.

**Builds on**:
- [009](009-browser-workflow-builder.md)/spike E5 — `turnNote` is already the leading gate reason
  (verifyPhase unshifts it; the FE renders reasons as-is): zero new plumbing.
- [043](043-builder-live-test-model-optional-for-llm-less-workflows.md) — `localizeNotes`/`NOTE_JA`
  regex frames (`i18n.ts`), just extended for 037/043 notes: the JA path for the new messages.
- [024](024-reality-reconciliation-and-cross-cutting-gaps.md) SEC1 — the boot-smoke precedent
  (`smokePermissionHook` in `index.ts`); D4's `claude --version` check co-locates there but is
  WARN-only (an env gap must not brick a `deploy=none`-less… it just fails builds; SEC1's fail-closed
  rationale — a sandbox failing OPEN — does not apply here).
- [015](015-builder-security-turn-sandbox.md) — the turn env has every `DIFY_*` stripped, so Dify
  creds structurally cannot appear in turn stderr; D5 still redacts the tail (belt + braces).

---

## Decisions

- **D1 · Bounded per-turn stderr ring in `ClaudeSession` (locked).** The existing `onStderrData`
  listener additionally appends into a ring capped at **2 KB / 24 lines** (whichever trims first),
  reset on each `spawn()`. New accessor `stderrTail(): string`. Bounded by construction — no growth on
  a chatty CLI; the detach discipline (spec 011 listener hygiene) is untouched (the ring is data, the
  listener already exists).
- **D2 · A PURE classifier in `turn-runner.ts` (locked).**
  `classifyTurnFailure(tail: string, code: number | null): { cls, note }` — first-match-wins order
  (most-specific first):
  | cls | match (case-insensitive) | note template (EN, wording-stable — NOTE_JA keys off it) |
  |---|---|---|
  | `usage_limit` | `usage limit`, `session limit`, `rate limit`, `credit balance`, `quota`, `429`, `overloaded` | `Claude CLI usage limit reached — builds cannot run until the limit resets. (<matched line>)` |
  | `auth` | `log in`, `login`, `logged in`, `authentication`, `unauthorized`, `401`, `invalid api key`, `oauth` | `Claude CLI is not authenticated on this machine — run \`claude\` in a terminal and log in. (<matched line>)` |
  | `network` | `ENOTFOUND`, `ECONNREFUSED`, `ETIMEDOUT`, `EAI_AGAIN`, `fetch failed`, `network error` | `Cannot reach the Anthropic API from this machine (network/proxy). (<matched line>)` |
  | *(fallback)* | — | `process exited code ${code} before a result event — stderr tail: <last 2 lines, or "(empty)">` |
  `<matched line>` = the single stderr line that matched, so a limit message's own reset-time text
  survives verbatim. A wrong classification is COSMETIC by design: the class never changes
  status/outcome routing (`status:'error'`, Retry gate — exactly today's), and the verbatim line is
  always attached, so even `usage_limit` misfiring on an unrelated "quota" word still shows the truth.
- **D3 · Wired at the THREE non-timeout failure paths (locked; r2 blocker #1).** (a) `session.onExit`
  (exit before a result event); (b) the `spawn(prompt)` false branch (sync argv edge cases); and (c) —
  the one the draft missed — `onProcError` in `claude-session.ts`: a MISSING binary emits ONLY
  `'error'`(ENOENT), never `'exit'`, so the handler feeds `err.message` into the ring and fires the
  exit path (settled-guarded), otherwise the turn strands until the 10-min timeout. The classifier
  maps `ENOENT|command not found|no such file` to the `spawn` class
  (`failed to spawn claude process — is the \`claude\` CLI installed? (<tail>)`). The TIMEOUT note is
  untouched — its own actionable class; stderr is not its cause. The happy path and `result.is_error`
  turns (the model answered; lint loop handles it) are untouched.
- **D4 · Warn-only boot check (locked).** Next to the SEC1 hook smoke in `index.ts`: `execFile('claude',
  ['--version'])` with a 5 s timeout; on any failure `log.warn` a banner (`claude CLI not found or not
  runnable — every build will fail at its first turn; install it and run \`claude\` to log in`). Never
  gates boot (unlike SEC1: nothing fails open — builds just fail loudly, now with D2's note). No auth
  or quota probe at boot — both cost tokens/latency and expire anyway; classify-on-failure covers them.
- **D5 · The tail is redacted before it can render (locked).** `classifyTurnFailure` callers pass the
  tail through `redactSecrets` (import from `dify-io.ts` — no cycle: dify-io does not import
  turn-runner) before embedding in the note. Structurally the turn env carries no `DIFY_*` (015), so
  this is defense-in-depth, same posture as 032 B3.
- **D6 · JA frames ride `NOTE_JA` + ONE FE map call (locked; r2 blocker #2).** The gate
  error/still_failing cards render `task.error` lines raw — `Chat.tsx` now maps `errLines` through
  `localizeNotes` (the 043 pattern), else every frame below is dead. SIX regex frames keyed on the
  wording-STABLE
  prefixes (e.g. `Claude CLI usage limit reached` → `Claude CLIの利用上限に達しました — 上限リセット後に再試行してください。`);
  the `(<matched line>)` part passes through untranslated (it is machine output). The known
  exact-text-map fragility applies — the D2 templates are marked wording-stable in code comments.

## Non-goals

- **No** pre-turn API ping (costs tokens on every build; boot `--version` + classify-on-failure cover it).
- **No** auto-retry / wait-until-reset scheduling (the parked Retry gate is the recovery path — the
  bounded, human-gated design; auto-repair was explicitly killed in the 037-roadmap review).
- **No** parsing of reset timestamps into structured fields — the verbatim line carries them.
- **No** SPA/`Failed to fetch` handling (backend-down is a different class; the SSE reconnect banner
  already exists) and no diagnostics-bundle export (separate idea, separate spec if wanted).

## Acceptance criteria

1. *(S1)* `turn-runner.test.ts` (or a new `turn-failure-triage.test.ts`) — classifier table: each class
   maps from a REAL-shaped stderr line (use verbatim CLI wordings, e.g. "You've hit your usage limit"),
   the fallback carries `stderr tail:` + the last lines, `(empty)` when no stderr; precedence pinned
   (a line matching both `usage limit` and `network` words classifies `usage_limit` — first-match order).
2. *(S1)* Integration through the session seam: a fake session whose `stderrTail()` returns a planted
   quota message + `onExit(1)` without a result → `TurnResult.note` starts with
   `Claude CLI usage limit reached` and CONTAINS the planted line.
   - 2b (anti-gaming): the same run with empty stderr yields the fallback note — proving the
     classifier reads the RING, not a hardcoded guess from `code === 1`.
3. *(S1)* Redaction: a planted token string in the stderr ring never appears in the note
   (`redactSecrets` applied) — the workspace-facts 5b pattern.
4. *(S1)* Spawn-failure note now names the probable cause (`is the \`claude\` CLI installed?`) and the
   timeout note is byte-unchanged (pinned).
5. *(S2)* `localizeNotes` maps all four EN templates to JA (web test beside the 043 frames); EN
   templates carry a `// wording-stable (NOTE_JA keys off this)` comment.
6. *(S2)* Boot: with a PATH lacking `claude`, boot logs the D4 warn banner and still starts (manual
   verify note in the spec — index.ts boot is not unit-harnessed today).
7. Existing suites green; no change to gate.ts, orchestrator routing, or any FSM/status semantics.

## Sequencing

- **S1** — ring + classifier + wiring + redaction + tests (the value: field failures self-describe).
- **S2** — boot warn banner, JA frames + web test, HUONG_DAN troubleshooting row
  (`実装でエラー exit 1` → đọc dòng lý do đầu tiên: limit / login / network / install), spec-index row.

## Open questions

- **OQ1** — also classify `result.is_error` payloads (the CLI returned a structured error result)?
  Default: no for v1 — those already carry the model/CLI message through the existing path; revisit if
  field reports show a swallowed case.
- **OQ2** — surface the boot warn banner in the UI (not just the server log)? Default: log-only v1;
  the first build's D2 note covers the user-visible path.
- **OQ3 (r2, review #8)** — wire `TurnResult.failureCls` into the orchestrator's resume-fallback
  exclusion (today it note-sniffs `!turn.note`, a branch that has been unreachable since the first
  commit)? Default: not here — that is a routing change; revisit if field data shows expired-session
  resumes parking uselessly.

## Revision log

- r1 (2026-07-08) — initial draft (from the chatwork_2 field incident; anchors verified same day).
- r2 (2026-07-08) — IMPLEMENTED with the adversarial review folded in (13 server tests in
  `turn-failure-triage.test.ts` + 2 web frame tests; server 399/399, web 153/153, tsc clean):
  **Blocker #1** — a missing `claude` binary emits ONLY `'error'`(ENOENT), never `'exit'`; the draft's
  spawn-false wiring was unreachable and the turn stranded until the 10-min timeout. Fixed: `onProcError`
  now feeds `err.message` into the ring and fires the exit path (settled-guarded — no double-resolve),
  and the classifier treats `ENOENT|command not found|no such file` on the exit path as the `spawn`
  class; pinned by a session-level `attachTo` + fake-child-`'error'` test.
  **Blocker #2** — gate error/still_failing cards rendered `task.error` lines RAW; the JA frames would
  have shipped dead. Fixed: `Chat.tsx` `errLines.map(localizeNotes)` (the 043 pattern); the "no FE
  change" header claim was false and is amended.
  **#3** — the classifier sanitizes embedded stderr (`' | '` → `' ⏐ '`, newlines → `' ⏎ '`) so the FE's
  `' | '` split can't shred a note; pinned. **#4** — Ask no longer swallows the note: `askWithin`'s
  canned failure message appends `(turn.note)`; the live-test judge's silent degrade-to-smoke is
  accepted and recorded here. **#5** — ring reset moved to `attachListeners` (covers the `attachTo`
  seam). **#6** — the runTurn integration harness is a hand-rolled minimal session cast to
  `ClaudeSession` (the first turn-runner-level suite; no prior fakes existed to break). **#7** — SIX
  wording-stable strings (3 classes + spawn + fallback + the pre-existing timeout note) all carry
  NOTE_JA frames, including capture-group frames for the dynamic exit-code/seconds. **#8** —
  `TurnResult.failureCls` added (additive) so the orchestrator's structurally-dead resume-fallback
  (`!turn.note` at its fresh-turn retry — unreachable since the first commit) can one day key on the
  class instead of note-sniffing; behavior deliberately unchanged here (OQ3).
  Drive-by: the 030/043 `notes-i18n.test.ts` slug-collision case was ALREADY red on HEAD (the 043
  commit updated the server wording + regex but not the test's SAMPLE/assertion) — fixed to the current
  `'X' already exists in this project — …` wording.
