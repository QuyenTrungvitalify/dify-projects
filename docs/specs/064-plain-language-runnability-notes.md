# Spec 064 — Plain-language runnability notes: kill the jargon a naive user reads, not just the tool case

**Status**: **Implemented** (2026-07-16). `runnability.ts` (model_empty → plain reassurance, node id
off the human text; plugin_todo → plain) + `report.ts` (non-tool advisory → plain; `deploy=none`
dropped from the note, kept on `report.deploy`) + 4 NOTE_JA frames (retired the jargon frames, added
whole-message plain ones). 5 pinned test files updated and each now ALSO asserts the jargon is
ABSENT (regression guard). **AC #1 met objectively**: the real naive non-tool build (run
1784185934247) goes **FAIL (6 jargon) → PASS (0)** through the spec-063 `comprehension` oracle.
server 517/518 (the 1 = pre-existing creds-gated AC9), web 188, pytest 215, typecheck clean.
— Authored 2026-07-16 from a live finding.
**Effort**: M (systematic + test-pinned strings + i18n frames; touches a core 037 advisory).
**Depends on**: spec 061 (fixed the TOOL slice — this generalizes it), spec 063 (the `comprehension`
jargon-blocklist is this spec's OBJECTIVE acceptance oracle), spec 037 (`runnability.ts` preflight —
the other jargon source).

## The finding (surfaced by a live naive-user prompt, 2026-07-16)

A real naive prompt (「毎朝ニュースを取得して要約しSlackに通知」, run 1784185934247) built an
http+code+LLM workflow (NO tool node — confirming spec-063's naive-user finding). Its ④ report note,
run through the spec-063 `comprehension` gate, **FAILED with 6 jargon hits**:

```
plugin hash · dependencies · # TODO · deploy=none · unresolved_plugin_todo · <13-digit node id>
```

Spec 061 only rewrote the note for **tool** workflows. This build has no tool, so it hit the ELSE
branch → the developer-jargon note remained. **A naive user building a common (non-tool) workflow
still reads jargon they can't act on.** The problem is systemic, not tool-specific.

**Where each jargon token comes from (traced):**
- `runnability.ts` `preflightNote` (037): `model fill (llm <id>; …)` leaks the 13-digit node id, and
  `plugin hash (dependencies TODO)` is raw jargon — and its JA localization keeps the needs-list
  LITERAL (062 review), so the JA user reads English tech terms.
- `report.ts`: `unresolved_plugin_todo: dependencies are empty but a "# TODO add plugin hash" remains
  — add the plugin hash before deploying.` (the ELSE branch 061 left untouched).
- `report.ts`: `deploy=none (no Dify contact).` — a dev detail with no meaning to a user.

## The honest nuance (why this isn't just "reword")

- **The model note is often MISLEADING, not just jargon.** The model auto-injects at live-test/deploy
  (043) — the user does NOT need to "add" anything. So the plain version must be *reassuring*
  ("the AI model fills in automatically when you test"), not a directive.
- **These strings are TEST-PINNED** (workspace-facts + report tests assert the exact wording) and the
  `preflightNote` feeds BOTH the ③ gate card AND the ④ report — so every reword updates its NOTE_JA
  frame AND its pinned tests, and must not change the gate's advisory/lint behavior.
- **Dev vs user tension:** the raw `report.json` fields (`unresolved_plugin_todo: true`, `lint`, the
  node ids) stay for `/report`/dev; only the human-readable NOTE text goes plain.

## Goal

**G1 — a naive user reads plain language for EVERY runnability advisory, not just tools.** After this
spec, the ④ report note + ③ gate card for the common non-tool build (empty model + a plugin TODO)
carry NO `comprehension`-blocklisted jargon: no `plugin hash` / `dependencies` / `# TODO` /
`deploy=none` / raw node id. The model advisory reads as reassurance (auto-fills), not a directive.

## Non-goals

- NOT changing gate/lint behavior — advisory only; the raw `report.json` fields are untouched (dev/
  `/report` still read them).
- NOT the full spec-063 userview localization port (that renders the plain notes to JA); this makes
  the SOURCE notes plain so both EN and (framed) JA are jargon-free.
- NOT re-opening 061's tool checklist — this generalizes the same principle to the other blockers.

## Design

### S1 — plain the `runnability.ts` blocker details (M)

Reword the two jargon `detail` strings (+ their NOTE_JA frames + pinned tests), keeping the `class`
and node ids on the STRUCTURED blocker object (dev-readable) but OUT of the human `detail`:
- `model_empty`: `the AI model fills in automatically when you test — nothing to set up` (drop the
  raw `<id>`; keep `nodeId` on the object).
- `plugin_todo`: `a plugin this workflow needs — install it in Dify Studio → Plugins if a run says
  it's missing` (no "plugin hash" / "dependencies").
- The `preflightNote` frame keeps "not runnable out-of-the-box … Advisory" (understandable) but now
  joins plain details.

### S2 — plain the `report.ts` non-tool + deploy notes (S)

- The ELSE branch (non-tool `unresolvedPluginTodo`): replace the `unresolved_plugin_todo: … add the
  plugin hash before deploying` string with a plain sentence (mirrors 061's toolInstallNote voice but
  for the generic/model case). Tool workflows keep 061's checklist.
- `deploy=none (no Dify contact).`: drop from the user-facing note (a dev detail) or move it to a
  structured field; it means nothing to a user.

### S3 — i18n NOTE_JA frames + tests (S)

Every reworded string gets its NOTE_JA frame updated (wording-stable) and its pinned unit tests
updated to the new wording.

## Acceptance criteria (the 063 oracle is the gate)

1. **The objective proof**: `e2e-run.sh comprehension <taskId>` on the naive non-tool build
   (1784185934247 shape) goes from **FAIL (6 jargon) → PASS (0 jargon)** — the same before/after
   001 the tool case already passes. This is a reproducible pytest over the reworded notes.
2. The model advisory reads as reassurance (auto-fills), not a directive; no raw node id in the human
   text. Unit-tested against `preflightNote`.
3. Advisory-only preserved: lint/gate/verdict unchanged; `report.json` structured fields
   (`unresolved_plugin_todo`, `lint`, node ids) unchanged — only human NOTE text goes plain.
   builder `npm test` green (with the pinned-string tests updated), `pytest` green.
4. Both surfaces covered: the ③ gate card and the ④ report note carry the plain wording (they share
   `preflightNote`); JA localizes the whole thing (no literal needs-list leak).

## References

- Live finding: run 1784185934247 (naive news prompt → non-tool build → jargon note → comprehension
  FAIL 6). [061](061-builder-tool-node-support.md) — the tool slice this generalizes;
  [063](063-e2e-naive-user-fidelity.md) — the `comprehension` blocklist = the acceptance oracle;
  [037](037-builder-runnability-preflight-and-workspace-facts.md) — `runnability.ts` preflight.
- `apps/builder/server/lib/runnability.ts` (`classifyRunnability`/`preflightNote`),
  `apps/builder/server/lib/report.ts` (the note assembly), `apps/builder/web/src/lib/i18n.ts`
  (NOTE_JA frames).
