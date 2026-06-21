# Phase‑1 Review — Architecture, Safety Model & Risk Register

*Spec 009 (Browser Workflow Builder) + 010 (UX hardening). Grounded in the code under `apps/builder/`, read 2026‑06‑14. This is a review for QA prioritization — not an app-code change.*

---

## 1. Architecture soundness

The Builder is a **local single-user web app**: a Fastify backend (Node 20.6+) that spawns headless `claude` turns, fronted by a Preact SPA. The shape is clean and the seams are well chosen:

- **A 4-phase gated state machine** — ①Analyze → ②Spec → ③Implement → ④Test&Report (`phases.ts`, `orchestrator.ts`). The first three phases are *fresh Claude turns*; the fourth is *backend-only* (no turn) for `Deploy: none`/`cloud`, and parks at an Import gate for `selfhost`. Each phase produces a file artifact (`analyze.json` / `SPEC.md` / `workflows/main.yml` / `report.json`) and **stops** — the gate is out-of-band from the turn, which is the right call: the model never decides whether to advance.
- **The browser is a dumb renderer over SSE.** Authoritative state always comes from `GET /api/tasks/:id`; the SPA optimistically advances then reconciles against the stream. This is sound and is the source of two *fixed* regressions the suite must guard (optimistic-dup disclosure, dead-end composer).
- **Net-new vs copied** is honest: the transport shell + diff renderer are adapted from claude-nexus; the phase machine, gate, sidebar tree, and slim store are net-new. AC#11 asserts no *runtime* nexus dependency (vendored only).
- **Confirm-mode** (`each_step` / `spec_only` / `auto`) is a single predicate (`boundaryAutoAdvances`, orchestrator.ts:282–286) consulted at each boundary — small surface, easy to reason about. The verbose wire values (`confirm each step` / `confirm at spec only` / `auto`) normalize to internal tokens (`normalizeConfirmMode`).

**Verdict:** architecturally sound for its scope (local, single-user, one-turn-at-a-time). The complexity that remains is concentrated where it should be — the gate/confirm state machine and the security confinement — and that is exactly where QA effort belongs.

---

## 2. Safety model (the load-bearing invariants)

This app spawns an LLM that runs repo commands and writes files. Its safety rests on **five** invariants — QA must treat each as P0:

1. **127.0.0.1-only binding.** `const HOST = '127.0.0.1'` is **hardcoded, not env-overridable** (`index.ts:82`, listen at :283). Only the port is configurable. → Browser-adjacent test (T11) + curl.
2. **Permission model C** (not a fail-fast allowlist): turns run under `--permission-mode acceptEdits --setting-sources local` with a broad allow + a defense-in-depth deny list (`headless-settings.json`). The *real* boundary is the **post-turn #3b `git status` confinement check** — any path the turn newly dirtied outside `projects/<slug>/` or `apps/builder/.runs/<taskId>/` is **reverted** with `git checkout -- <path>` + `git clean -fd` (`post-turn.ts:163–222`), and the phase becomes `status:error`. Crucially this catches **opaque** writes the deny-list can't (e.g. `python -c open('tools/x','w')`). → CLI-only (Sec‑CLI‑2).
3. **Dify token never enters a turn.** `claude-session.ts:101–105` strips every `DIFY_*`, `CLAUDE_CODE*`, `CLAUDECODE` var from the child env before spawn; the token lives **only** in the backend's own `sync.py` subprocess env (`dify-io.ts`), and `redactSecrets` scrubs it from logs/SSE. → CLI-only (Sec‑CLI‑3).
4. **Human gates.** Every advance is an explicit out-of-band confirm; routine repo tools don't prompt; Phase ④ import keeps an explicit button when `Deploy≠none` (except `auto`). → Browser (T02/T03/T16).
5. **Turn-level run-lock (Lát 6).** A single in-memory `turnHolder` serializes *model turns* 1-at-a-time across all builds (`lock.ts`). It is acquired synchronously right before dispatch and released when the turn settles (parks at a gate or terminates). **A build parked at a gate holds nothing** — so multiple parked builds never block each other; only a genuine *turn* collision returns `409` (+ `holder` for "Open it"). This invariant is also what keeps the #3b baseline-delta valid (no concurrent writers). → Browser (T05) + curl.

Cross-origin enforcement backs #1: all mutating methods (POST/PUT/DELETE/PATCH) and the SSE hijack reject disallowed origins with `403 origin not allowed` (`index.ts:216–218`, `sse.ts:165–166`). Read endpoints are intentionally open ("dumb renderer").

**Verdict:** the model is coherent and the spike (E1/E4/E2d) appears to have stress-tested the dangerous edges. The weakest point for a *reviewer* is that the two strongest guarantees (#2 confinement-revert, #3 token isolation) are **invisible to a browser** — they must be exercised by CLI, and it would be easy for a browser-only QA pass to declare victory while never touching them. The suite addresses this head-on with named CLI checks (Sec‑CLI‑2/3) wired into the coverage matrix.

---

## 3. Known limitations / pre-existing gaps

- **Edit-existing slug targeting is a pre-existing gap.** F4 only auto-suffixes *derived* slugs for genuine new-workflow builds. An *edit-existing* build (or a user-typed explicit slug) writes the targeted `main.yml` as-is — by design, but it means a user who types an existing slug can still overwrite (the "plausibly targeting it" assumption, 010 F4).
- **Cloud deploy needs Dify creds** for the real import; the cloud path itself (skip-import + copyable YAML + Studio steps) is reachable without creds, but **selfhost import** and **push idempotency** require `DIFY_CONSOLE_URL/TOKEN` — CLI-gated.
- **Diff producer** note still references "lands in Lát 5" in the empty-diff string (`ArtifactPanel.tsx:114`) — for a brand-new workflow the Diff tab shows additions-against-empty-base; verify it isn't stuck on the placeholder.
- **`spec_only` mode** was under-exercised in prior plans; `auto` end-to-end (AC#15) and `auto`+still-failing hard-stop (AC#25) were **explicitly unverified** in the first QA pass (010 notes) — they are promoted to first-class P0 here.
- **Restart recovery / boot-reconcile** and **push idempotency** are inherently non-browser (server lifecycle) — covered only by CLI.
- **Forcing a lint failure via the UI is not reliable** (010 F2‑5 concedes this) — AC#8/#20/#25-auto-hardstop are *observe-if-it-happens* in the browser, *force* via CLI.

---

## 4. Risk register (most likely to break / most costly if wrong)

| # | Risk | Likelihood | Blast radius | Why | Primary test |
|---|---|---|---|---|---|
| R1 | **Confinement-revert fails to catch an opaque out-of-scope write** | Low | **Critical** (arbitrary repo write by an LLM) | The single strongest safety guarantee; deny-list provably leaks (E2d), so all weight is on the post-turn git check | Sec‑CLI‑2 |
| R2 | **Dify token leaks into a turn / SSE / `.runs` JSON** | Low | **Critical** (secret exfil) | Relies on an env-strip + redaction that must hold on every spawn | Sec‑CLI‑3 |
| R3 | **`auto` mode does NOT hard-stop on a still-failing Implement** → silent import of a broken workflow | Medium | High (broken app pushed to Dify) | AC#25; was unverified; one early-return guards it (orchestrator.ts:272) | T04 + Impl‑CLI‑1 |
| R4 | **Turn-lock regressions** — a parked build wrongly 409s ("Busy"), or two turns run at once | Medium | High (multi-build unusable; or #3b baseline corrupted) | The Lát 6 redesign superseded Lát 3 "409 Busy"; easy to regress | T05 |
| R5 | **Cross-origin / non-loopback binding** | Low | **Critical** (LAN exposure of an LLM that writes your repo) | One hardcoded host + one origin check stand between local and exposed | T11 |
| R6 | **Optimistic-snapshot duplicate "Running" disclosure** returns | Medium | Low (cosmetic, but erodes trust) | Known fixed bug; store-level optimistic advance is subtle | T02 |
| R7 | **Dead-end composer** — typing on a `done` build errors instead of starting a new build | Medium | Medium (workflow blocked) | Known fixed bug (`/reply needs awaiting_confirm or error`) | T10 |
| R8 | **F4 silent clobber** — a colliding derived slug overwrites an unrelated project's `main.yml` | Medium | High (data loss) | The whole reason F4 exists | T10 |
| R9 | **Confirm-mode PATCH is a no-op** (the 010 F2 bug) or clobbers a running turn | Medium | Medium (mode lies to the user) | F2‑A; rejection rules are subtle (terminal vs turn-running vs cancelled) | T09 |
| R10 | **Cancel doesn't free the lock** → next build can't start | Low | High (app wedged) | AC#24; lock release on cancel/dispatch-finally | T08 |
| R11 | **SSE reconnect loses the gate** on reload | Medium | Medium (user stranded at an invisible gate) | AC#22; re-fetch path | T06 |
| R12 | **Blank/garbage SPEC.md save** arms a silent ② failure | Low | Medium | PUT `/spec` guards `SPEC.md cannot be empty` | T10 |

---

## 5. Prioritized: the highest-risk behaviors the suite MUST cover

1. **Security boundary** (R1, R2, R5) — confinement-revert (Sec‑CLI‑2), token isolation (Sec‑CLI‑3), 127.0.0.1-bind + cross-origin 403 (T11). *Never green the suite without these.*
2. **`auto` correctness** (R3) — auto hands-free to `done` (AC#15) **and** auto + still-failing hard-stop (AC#25) — T04, with Impl‑CLI‑1 to force the failure.
3. **Turn-level lock** (R4) — two parked builds, no Busy; genuine collision → 409 + Open it — T05.
4. **The two fixed UI regressions** (R6, R7) — optimistic-dup (T02) and dead-end composer (T10) — explicit regression assertions.
5. **F4 anti-clobber** (R8) — colliding slug → `_3` suffix + gate note, original untouched — T10.
6. **Confirm-mode live patch** (R9) — patch takes effect, read-only chips, reject-on-done — T09.
7. **Cancel/lock-release & reconnect** (R10, R11) — T08, T06.

Everything else (smoke, artifact panel, gate labels, validation negatives) is necessary for completeness and traceability but lower blast-radius.
