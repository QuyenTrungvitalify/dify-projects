# Spec 030 — Content-language sync: author SPEC.md / narration in the requirement's language (a skill directive, no plumbing)

**Status**: Draft (r3 — pivoted to the **match-the-requirement** model (Option B) per the user's "simplest" decision; the persist-a-`lang`-setting model (Option A) is retained as the documented alternative). **P1 (SPEC.md prose) and P2 (`report.notes`) are both implemented** — P2 via a client-side `localizeNotes` that follows the language toggle, which turned out NOT to need any backend language signal (correcting the r2 assumption — see §Considered / OQ2).
**Effort**: S — a shared **"Output language"** directive added to the two SPEC-authoring skill bodies (`draft.md`, `spec.md`) instructing the model to write prose in the **same language as `{{REQUIREMENT}}`** while pinning *identifiers* to English; optionally the same block in `analyze.md`/`implement.md` for narration consistency. **No client change, no wire field, no `Task` field, no new inject token, no FSM/gate/confinement/validator/scaffold change, no migration.** The work is entirely in checked-in skill markdown + a guard test. The load-bearing part is the localization **boundary** (§2) and the fact that LLM compliance is not enforceable — only validator-guarded (§3).

**Depends on**: nothing. **Builds on** the existing `{{REQUIREMENT}}` inject token (analyze phase injects it at [phases.ts:55](../../apps/builder/server/lib/phases.ts#L55); the `spec` phase — which renders *both* `draft.md` and `spec.md` — injects it at [phases.ts:69](../../apps/builder/server/lib/phases.ts#L69)) — the directive references a value the prompt already carries, which is *why* no plumbing is needed. **Relates to** the client-only i18n layer ([i18n.ts:8-11](../../apps/builder/web/src/lib/i18n.ts#L8-L11)), whose header scopes LLM-generated content OUT of v1 and names "a prompt/server change" as the fix — this is the (prompt-only) version of that change.

## Context — the language of the output tracks the prompt, not the requirement

The composer language toggle ([i18n.ts:34-45](../../apps/builder/web/src/lib/i18n.ts#L34-L45)) flips a client-side `lang` signal that re-renders fixed UI strings via `t()`/`tf()`. Its header comment states the boundary ([i18n.ts:8-11](../../apps/builder/web/src/lib/i18n.ts#L8-L11)):

> **SCOPE (v1): fixed UI strings only.** LLM/tool-generated content — the streamed run output, SPEC.md, YAML, diff, report details — stays in whatever language the build produced (**out of scope; that needs a prompt/server change**).

The reported defect (from the screenshot): requirement `簡単ワークフロー作成して` (Japanese) → a fully **English** `SPEC.md` (`# Simple LLM Workflow`, `## Goal`, `## Chosen shape`…).

**Root cause — layer 4 only.** A build's content passes through the prompt (`{{…}}` render) and then the model. The model does **not** infer output language from the requirement; it follows the language of the *skill body it executes*, which is English, and there is **no directive telling it otherwise** ([draft.md:54-70](../../.claude/skills/dify-build/draft.md#L54-L70), [spec.md:32-43](../../.claude/skills/dify-build/spec.md#L32-L43)). So a Japanese requirement yields an English spec by default. Fixing this is a **single-layer** change: add the missing directive. Everything else (the setting, a wire field, a `Task.lang`, a `{{LANG}}` token) is only needed if you want to *override* the requirement's language — which this design deliberately does not (see §Considered, Option A).

**Report is a separate, harder sub-problem — deferred.** The report tab renders every *label* through the client's `tr()` ([ArtifactPanel.tsx:262-297](../../apps/builder/web/src/components/ArtifactPanel.tsx#L262-L297)) (already JA when the toggle is JA); the only raw-English content is the freeform `report.notes` blob ([ArtifactPanel.tsx:299](../../apps/builder/web/src/components/ArtifactPanel.tsx#L299)), built from hard-coded literals in backend Node ([report.ts:134-162](../../apps/builder/server/lib/report.ts#L134-L162)). Under this design the backend has **no signal of the requirement's language** (it would have to language-detect `task.requirement`, or an explicit `lang` field would have to be reintroduced), so localizing `report.notes` is a distinct effort — **deferred to P2** (§Considered notes the honest cost).

## Goals

1. **Prose follows the requirement's language.** A Japanese requirement produces a `SPEC.md` whose Goal / Chosen shape / node purposes / Open questions (and the app name) are Japanese; an English requirement produces today's English spec, unchanged; a Vietnamese requirement produces Vietnamese prose — **any language, for free**, because the model reads the requirement's language directly.
2. **Identifiers stay English — the build must still validate.** slug (`[a-z0-9_]`), node id-placeholders + minted 13-digit ids, node `type` values, `{{#id.field#}}` variable references, YAML keys, plugin hashes/`dependencies`, and the `find.py --has` feature vocabulary are technical tokens — English/ASCII regardless of the requirement's language. Localizing any of them would break `validate.py`/`lint_refs` (§3). This boundary is the load-bearing content of the directive (§2).
3. **Zero plumbing, zero new state.** No client/api/task/phases change; the directive uses the `{{REQUIREMENT}}` token the prompt already injects. Nothing to persist, nothing to migrate.
4. **Fail-safe to today.** An English requirement is behavior-equivalent to today ("same language as the requirement" = English). A build with an ambiguous/short requirement degrades to the model's best judgment — never an error.
5. **Zero change to correctness/security/scaffold.** Same turns, gates, validators, confinement, scaffold timing. The directive changes only the natural-language prose the model emits — never the graph, ids, or file layout.

## Non-goals (the leanness boundary)

- **No explicit language override.** This design cannot force an English spec from a Japanese requirement (that is Option A — see §Considered). If an override is ever wanted, the natural superset is a persisted `lang` with an `auto` default that means exactly this design.
- ~~**No `report.notes` localization in v1 (P2, deferred).**~~ **Superseded — P2 was implemented** (user asked for it after seeing the English notes blob in a JA build). It did NOT need the "persisted language signal" the r2 note feared: the report tab is client-rendered and already has the toggle in scope, so `notes` is localized the SAME way the labels are — a client-side `localizeNotes` (§3). Backend/`report.json` unchanged.
- **Do NOT localize machine-read artifacts.** `analyze.json` `pattern`/`features` use the `find.py` vocabulary VERBATIM (parsed by the gate + `applyAnalysisToTask`, [analysis.ts](../../apps/builder/server/lib/analysis.ts)); only its free-text `note`/`risks` may follow the requirement's language. `main.yml` (types/refs/keys) and the derived `diff` are never localized.
- **Do NOT localize lint/validator tool output** (raw `validate.py`/`find.py` stderr in `report.notes`, [report.ts:112-113](../../apps/builder/server/lib/report.ts#L112-L113)) — developer diagnostics, English.
- **Do NOT try to enforce the output language.** The directive instructs; the model complies imperfectly (§3). No build fails because a heading stayed English. The only hard guard is the existing validators, which reject a localized *identifier* (a bug), not localized *prose* (the goal).
- **Do NOT regress the English path.** An English requirement = every existing corpus build, every string-asserting test, unchanged.

## No-disruption discipline

- **English requirement ≡ today.** "Write prose in the language of the requirement" is a semantic no-op when the requirement is English — the model already does this. Byte-diff in the rendered prompt (the directive line is present) but behavior-equivalent; treat a measured behavior change on the English corpus as a regression (mirror 028's B3 stance).
- **CI is untouched.** No unit test renders a real turn: `golden-build.test.ts` uses a fake `runReport`/runner ([golden-build.test.ts:67](../../apps/builder/test/golden-build.test.ts#L67)); `linters.test.ts` asserts linter-script output, not SPEC.md prose. Adding a skill-body directive changes no CI assertion. The only verification of the actual language behavior is a live build + manual read (Acceptance).
- **The dangerous direction is validator-caught, not merely discouraged (§3).** If the model localizes an *identifier* (a Japanese `type:`, a translated `{{#…#}}` ref, a non-ASCII YAML key), `validate.py`/`lint_refs` reject it → the still_failing gate ([orchestrator.ts:414-426](../../apps/builder/server/lib/orchestrator.ts#L414-L426)), never a silent ship. Localized *prose* (the intended effect) touches nothing the validators inspect.
- **Localizing SPEC.md prose is inherently safe — nothing machine-parses it.** The Spec-gate scaffold takes slug/name from the `/confirm` **payload** (a UI form field) or the requirement-derived fallback `deriveSlugName(task.requirement)` ([scaffold.ts:148-160](../../apps/builder/server/lib/scaffold.ts#L148-L160)); the web `confirm()` carries slug/name from a gate form field ([store.ts:443](../../apps/builder/web/src/store.ts#L443)), **not** from parsing SPEC.md. So no layer regex-reads SPEC.md's `**Proposed slug / name**` / `## Goal` headings — translating them cannot break slug resolution or the scaffold. (*Pre-existing aside:* `deriveSlugName` strips non-ASCII from the requirement — [slug.ts:19](../../apps/builder/server/lib/slug.ts#L19) — so a Japanese requirement already falls back to the `workflow` slug today; that is why draft.md/spec.md require the model to propose an explicit ASCII slug. Spec 030 does not change this, and Goal 2 keeps the proposed slug ASCII.)

## Design

**Priority:** **P1** the directive in `draft.md` + `spec.md` (the two SPEC.md authors — closes the reported defect) · **P1.5** the same block in `analyze.md`/`implement.md` for narration consistency (optional) · **P2** `report.notes` (deferred). **Disrupt:** 🟢 additive, prompt-only, no-op on English.

### §1 — Where the directive goes (minimal surface)

Two skill bodies author `SPEC.md` and are **mutually exclusive** per build:
- **`draft.md`** — the fast merged Analyze+Spec turn (fast path, [phases.ts:62](../../apps/builder/server/lib/phases.ts#L62)).
- **`spec.md`** — the standard Spec turn.

Both are rendered by the `spec` phase, which injects `{{REQUIREMENT}}` ([phases.ts:69](../../apps/builder/server/lib/phases.ts#L69)). Adding the directive to **these two** closes the reported defect with the smallest surface, and — because a build renders only one of them — there is no cross-file runtime coupling (the drift concern below is maintenance-only).

**Optional (P1.5) narration consistency:**
- `analyze.md` (standard path, seed/edit builds) presents a chat summary + writes `note`/`risks` — user-facing prose worth localizing. Its `analyze.json` `pattern`/`features` stay structural English (Non-goals).
- `implement.md` emits YAML (English identifiers) + narration; it does **not** receive `{{REQUIREMENT}}` (its `injectVars` omits it, [phases.ts:83-94](../../apps/builder/server/lib/phases.ts#L83-L94)) but it **reads `SPEC.md`** (`{{PRIOR_ARTIFACT}}`), which is now in the target language, so its directive says *"narrate in the same language as the SPEC.md you are implementing"* — no token change needed.

Ship P1 first; P1.5 is a follow-up if streamed narration in the wrong language is judged jarring.

### §2 — The "Output language" directive (the crux — the localization boundary)

A single block near the top of `draft.md` / `spec.md` (identical wording), and the `implement.md` variant (SPEC.md-referenced) noted above:

> ## Output language
> Write all **human-facing prose** — chat narration, and in `SPEC.md` the app **name**, Goal, Chosen shape/pattern rationale, node **purpose** descriptions, and Open questions — in the **same language as the requirement** (`{{REQUIREMENT}}`). If the requirement is written in English, write English. Match the requirement's language; do not translate it to English first.
>
> **Keep these in English/ASCII exactly, regardless of the requirement's language** (localizing any of them breaks the build — the validators reject a translated identifier):
> - `slug` values (`[a-z0-9_]`), node **id-placeholders**, and minted 13-digit ids;
> - node `type` values (`start`, `llm`, `end`, `answer`, `if-else`, …) and all YAML keys;
> - `{{#node.field#}}` variable references;
> - plugin hashes / `dependencies` / `@sha256`;
> - the `find.py --has` feature vocabulary and the `pattern` name in `analyze.json`.
>
> `analyze.json` is machine-read: its `pattern`/`features` stay English (above); only its free-text `note`/`risks` may follow the requirement's language.

**Why the boundary lives in the skill body:** authoring instructions belong in the skill (028's `{{DEPTH}}` fence is the precedent), so the *what-stays-English* rules are reviewable alongside the procedure they constrain and versioned with it.

**Drift hazard (maintenance, not correctness).** The block is duplicated across the bodies (skill markdown has no include mechanism). A build only ever renders one SPEC author, so divergence can't corrupt a single build — but the copies should stay consistent. Mitigate with a cheap test that the "## Output language" section is byte-identical wherever it appears (§Sequencing S2).

### §3 — Safety: prompt-contingent, but the dangerous failure is validator-caught

The directive is an *instruction*; the model may under-comply or over-comply. The two directions are asymmetric:

- **Under-comply (prose stays English):** cosmetic. No build breaks; iterate via `/reply`.
- **Over-comply (an identifier gets translated):** a *bug* — but the **existing Implement validators catch it deterministically.** A Japanese `type:` fails `validate.py` (unknown node type); a translated `{{#…#}}` ref fails `lint_refs` (dangling reference); a non-ASCII YAML key fails the schema. All route to the still_failing gate ([orchestrator.ts:414-426](../../apps/builder/server/lib/orchestrator.ts#L414-L426)) — never a silent ship.

So the *only* place a localization mistake could corrupt a workflow is guarded by machinery this spec does not touch, and the *only* place it can't (prose) doesn't affect correctness. No new enforcement is added. (If models frequently translate identifiers and burn the cap-5 self-fix loop, the follow-up is a pre-loop lint flagging non-ASCII in `type:`/refs — deferred; trigger = observed churn.)

## Sequencing (Bước — each step compiles + tests green)

1. **S1 (P1, the win):** add the **Output language** directive (§2) to `draft.md` and `spec.md`. No code change. **This closes the reported defect** — a Japanese requirement now authors a Japanese `SPEC.md`.
2. **S2 (guard):** a test asserting the "## Output language" section is byte-identical across the bodies that carry it (drift guard, §2); confirm `renderPrompt` still substitutes `{{REQUIREMENT}}` and leaves no stray token in the edited bodies. (Fits the existing skill-body/`phases` test precedent.)
3. **S3 (P1.5, optional):** add the block to `analyze.md` (chat summary + `note`/`risks`) and the SPEC.md-referenced variant to `implement.md` (narration). Ship only if narration-language matters in practice.
4. **S4 (QA — the real verification):** a Japanese from-scratch build (`簡単ワークフロー作成して`) — assert (deterministic) it STOPS at the Spec gate, writes SPEC.md on the normal path, and Implement still exits **0/0/0** with 13-digit ids and English `type:`/refs; and (manual) that SPEC.md's Goal/shape/purposes/Open questions are Japanese while slug/ids/types/refs are English. Repeat an English build (no regression) and, ideally, a Vietnamese build (confirms the "any language" claim).

## Considered & deliberately NOT done

- **Option A — persist a `lang` setting and obey it (the r1 design).** Threads `lang` from the toggle → `CreateTaskBody` → `Task.lang` → a `{{LANG}}` inject token → the same directive keyed on the setting, plus a backend notes-dict for the report. **Rejected as primary (user chose "simplest").** It is the right design *only if an explicit override is required* — the ability to force an English spec from a Japanese requirement, or to drive a language the requirement isn't written in. Its costs the simplest model avoids: 5-layer plumbing, a persisted field + migration story, and it is still capped at the chrome's `en/ja` (so it can't express Vietnamese without extending the whole i18n layer). **Adoptable later with no rework:** add a persisted `lang: 'auto' | 'en' | 'ja'` whose `auto` default IS this spec's directive, and whose `en`/`ja` swap `{{REQUIREMENT}}`'s language for a fixed one. This spec is the `auto` half.
- ~~**Backend notes-dict keyed by a persisted `lang`.**~~ The r1 §3 approach (extract `report.ts` literals into a `Lang`-keyed backend map). **Not taken.** The r2 note claimed Option B made this "harder" (no persisted lang signal). That framing was wrong: the notes are *rendered on the client*, where the toggle is already in scope — so localizing them needs **no** backend signal at all. **What shipped instead (P2):** `localizeNotes(notes)` in [i18n.ts](../../apps/builder/web/src/lib/i18n.ts) — a client-side, ordered `[RegExp, ja]` map (same spirit as `tAction`/`ACTION_JA`) that translates each known English frame in place while capture-groups keep the interpolated slug/URL/path literal; unknown text (validator stderr, or a future wording drift in `report.ts`) passes through in English (graceful). It follows the toggle live and stays consistent with the already-localized labels. No `report.json` shape change, no backend edit, no `lang` field. Trade-off: the regex frames are coupled to `report.ts`'s English wording — guarded by a vitest (`notes-i18n.test.ts`) that feeds the real notes string and asserts the JA output + literal-identifier preservation.
- **A separate content-language composer control.** More flexible (chrome EN, content JA) but adds UI + state for a rarely-wanted split. Out of scope.
- **Localizing `main.yml` comments / `analyze.json` structure / lint stderr.** Identifiers and tool output stay English (Non-goals, §3).
- **Enforcing output language with a validator.** Deferred — the existing validators already catch the *dangerous* (identifier) case; a prose-language linter would be brittle/false-positive-prone. Trigger: observed identifier-translation churn.

## Acceptance criteria

1. **JA requirement → JA prose, English identifiers.** A Japanese from-scratch build produces a `SPEC.md` whose Goal / Chosen shape / node purposes / Open questions (and app name) are **Japanese**, while `slug`, node id-placeholders, `type:` values, `{{#…#}}` refs, `pattern`, and `features` are **English/ASCII**. *(Prose-language is a manual-QA judgment; the machine-checkable half is criteria 2–3.)*
2. **No correctness regression.** That JA build's Implement mints 13-digit ids, runs all 3 validators, exits **0/0/0**, and meets the requirement's `must_do` (via `/report`) — localized prose never breaks the graph. A model that translates an identifier is caught by the still_failing gate, not shipped (§3).
3. **English path unchanged.** An English requirement runs the current all-English pipeline; all existing string-asserting UI/report tests pass unmodified.
4. **Any-language claim.** A Vietnamese requirement produces Vietnamese prose with the same English-identifier boundary (confirms the model reads the requirement's language, not a fixed set).
5. **No plumbing added.** No client/api/`Task`/`phases` change lands for this spec beyond the skill-body edits + the drift-guard test.
6. **Drift guard.** The "## Output language" section is byte-identical across the bodies that carry it (S2 test).
7. **(Implemented, P2) report.notes follows the toggle.** `localizeNotes` translates the backend-built notes string client-side per the current `lang`: EN passes through verbatim; JA translates each known frame while keeping interpolated slugs/URLs/paths English. Unknown/new frames degrade to English (no crash). Guarded by `apps/builder/web/src/lib/notes-i18n.test.ts`.

## Open questions

1. ~~**Obey-the-setting (A) vs match-the-requirement (B)?**~~ **Resolved (user):** simplest → **B (match the requirement)**. Option A retained as the documented superset for a future explicit override.
2. ~~**Report notes in scope now?**~~ **Resolved (user):** **defer to P2.**
3. **P1.5 narration — include `analyze.md`/`implement.md` in v1, or wait?** The reported defect is SPEC.md (covered by P1). Streamed narration in the "wrong" language is cosmetic and transient; ship P1 first and add P1.5 only if it grates in practice. *(Recommendation: ship P1, revisit P1.5 after the first JA build's QA.)*
4. **Requirement-language ambiguity.** A terse or code-heavy requirement (e.g. `"translate ZH→EN"`) gives the model little to judge language from; it will pick its best guess (usually English). Acceptable — no build fails. If mis-detection is common, that is the trigger to adopt the Option A explicit control.
