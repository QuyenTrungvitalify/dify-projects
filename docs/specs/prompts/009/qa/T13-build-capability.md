# T13 — Build-capability coverage (artifact-panel structural verification)

| Field | Value |
|---|---|
| **ID** | T13 |
| **Title** | Engine builds more than single-LLM — verify node types in the produced `main.yml` |
| **Traces to** | AC#4 (Implement → `main.yml` + 3 lints) · AC#8 (validate→fix self-correct, OBSERVE) · extends T07 (artifact panel) to **non-trivial shapes**. Closes the gap that T01–T12 only ever drove trivial single-LLM builds — see [BUILD-PROMPT-CORPUS.md](BUILD-PROMPT-CORPUS.md) G1/G2. |
| **Priority** | P1 |
| **Cost** | **~3 turns** for the primary branching build; **+~3 turns each** for the optional extension builds (run only the ones you need). |

> **String source:** deterministic UI chrome = [00-README String Dictionary](00-README.md#4-string-dictionary). **But note (NEW):** the app is now **i18n (EN ⇆ JA)** — a language toggle sits **top-right** (`apps/builder/web/src/lib/i18n.ts`; key `lang` in `localStorage`, default `en`). The dictionary in 00-README is the **English** column. **Before asserting any chrome string, set the language to English** (Step 0) so the dictionary applies verbatim; or assert the JA value from `i18n.ts`.
>
> **The build CONTENT (YAML, SPEC, report, lint lines) is NOT translated** (`i18n.ts:9–13` scope note) — so the **capability assertions below are language-independent** (YAML `type:` tokens, lint row names `validate_workflow`/`lint_refs`/`lint_plugin_hashes`). Assert those regardless of UI language.
>
> ⚠️ Engine output is **non-deterministic**. Unlike T01–T12's exact-string gate assertions, the capability checks here are **structural/semantic** (does the produced YAML contain node type X? are all linters green?) — not character-for-character.

---

## Preconditions

- App running and reachable at **http://127.0.0.1:4123** ([00-README §1.1](00-README.md#11-preconditions-human-one-time)). If the page does not load, **STOP and report**.
- **Clean app:** no build running, no gate parked from a prior test. If one is live, finish/Discard it first (else this build won't be the one under test).
- Settings (composer chip row): **Workflow** = `none (new)`, **Confirm** = `each step`, **Deploy** = `none`.

---

## Step 0 — Pin the UI language to English (chrome-string determinism)

1. **Observe:** top-right of the header — a globe/language control. If the app shows Japanese (e.g. the composer placeholder reads `ワークフローや変更内容を入力…`), the language is `ja`.
2. **Act:** if it is Japanese, click the language control once to switch to English (the control's tooltip in EN reads `Switch to Japanese` — i.e. **English is active when it offers to switch to Japanese**).
3. **Assert:** the empty composer placeholder now reads exactly `Describe the workflow or change…` (EN, `i18n.ts:65`). All chrome-string assertions below assume this.

> If you prefer to run in Japanese, that's fine — just substitute the `ja` column from `i18n.ts` for every quoted chrome string. The YAML/lint assertions are unchanged.

---

## Primary build — a branching workflow (covers if-else + llm×2 + variable-aggregator + template in ONE turn)

This is the most node-type coverage per build-turn. Requirement = corpus **G2-MEDIUM**.

### Step 1 — Submit the requirement (Phase ① Analyze)
1. **Observe:** empty-state composer, placeholder `Describe the workflow or change…`.
2. **Act:** type the requirement exactly, then Send:
   ```
   A workflow that takes a product review, detects whether sentiment is positive or negative, and for negative reviews drafts an apology plus an escalation note, while for positive reviews drafts a thank-you. Format the final result as "[sentiment] reply".
   ```
3. **Wait (≤10s):** the view switches to the thread; phase track `Analyze · Spec · Implement · Test` is visible; first run shows `Running` / `Working…`.
4. **Assert:** the phase track is present and Analyze is running.

### Step 2 — Analyze gate → Continue to Spec
1. **Wait (≤300s):** poll until the **Analyze gate** appears. If none in 300s, **STOP and report** (do not re-submit).
2. **Assert** (EN dictionary): badge `Analyze complete` · title `Ready to write the spec` · buttons `Continue to Spec` · `Request changes` · `Discard build`.
3. **Act:** click `Continue to Spec` **once**.

### Step 3 — Spec gate → check the chosen pattern, then Implement
1. **Wait (≤300s):** poll until the **Spec gate** appears (badge `Spec ready` / title `Spec drafted — review before I build`).
2. **Act:** click `open SPEC.md` to open the artifact panel on the **Spec** tab.
3. **Assert (structural, language-independent):** the `SPEC.md` text describes a **branched** design — it should mention an **if-else / conditional** split and a **merge / aggregator** of the two branches (the chosen pattern + Nodes table). It should **not** propose two separate parallel workflow files (`AGENTS.md §9` — single-file branched is preferred). Record the **Chosen pattern** line.
4. **Act:** click `Implement this spec` **once**.

### Step 4 — Implement gate → READ THE YAML (the core capability assertion)
1. **Wait (≤300s):** poll until the **Implement gate** appears. Clean path = badge `Implemented` / title `main.yml built and linted` / summary `Workflow YAML generated; all linters green.` / buttons `Continue to Test` · `Request changes` · `Discard build`.
   - **AC#8 OBSERVE-ONLY:** if instead the **still-failing** gate shows (badge `Lint still failing` / title `Still failing after the cap-5 attempts` / buttons `Accept anyway` · `Keep trying` · `Abandon`), record it as an observation and continue to Step 4.3 to read whatever YAML was produced — do **not** treat a deterministic requirement as expected-to-fail.
2. **Act:** click the `main.yml` gate-strip link (or open the artifact panel and click the **`main.yml`** tab — its label is the literal `main.yml`, never translated, `ArtifactPanel.tsx:299`).
3. **Assert — node types (language-independent):** read the `<pre>` YAML block. The text **must contain** these node-type tokens (Dify DSL `type:` values, per `build_index.py:42–48`):
   - a **conditional-split** node — **either** `if-else` **or** `question-classifier` (both are valid binary-sentiment splits; the engine legitimately picks the classifier for "positive vs negative" — accept whichever it chose)
   - `variable-aggregator` **or** an explicit merge node joining the branches
   - at least **two** `llm` nodes (the per-branch replies), plus `start` and `end`
   - *(bonus, if the engine used one)* `template-transform` for the `"[sentiment] reply"` formatting
   - **Capture** the set of `type:` tokens you find — this is the evidence of build capability. (Plugin hashes left as `# TODO: …` and a blank model are **correct**, not a defect — never invented, `AGENTS.md §4.3`.)
4. **Assert — lint (language-independent row names):** below the YAML, the **`Lint results`** section shows three rows, names exactly `validate_workflow` · `lint_refs` · `lint_plugin_hashes`, each marked **pass** (EN message `ok`, JA `ok` too; fail would read `exit {code}`). On the clean gate, all three are `ok`.
5. **Assert — Diff tab (POPULATED empty-base diff for from-scratch — corrected):** click the **`Diff`** tab. For a from-scratch build, after Implement the panel renders a **`Split diff`** (`SplitDiffView`) showing an **empty OLD/base column** and the **whole produced file as additions** — a hunk header like `@@ -0,0 +1,N @@` with `+N −0`. **This is the spec'd behavior** (`diff.ts:10` "no-seed / new → an empty base ⇒ the diff is the whole file as additions"; spec 009 AC#4 "diff/empty-base"; the producer is wired in `orchestrator.ts:403`). The empty-state string `No diff yet …` (`i18n.ts:210`) appears **only BEFORE Implement** (no `diff.json` yet — `artifacts.ts:68–72`); seeing it *after* a successful Implement would be the bug. *(NOTE: an older comment `artifacts.ts:8` and an earlier draft of this test wrongly said the diff "stays null" for from-scratch — that comment predates the Lát-5 producer and is stale. The discriminator vs an **edit-existing** diff is the OLD column: empty here, the pre-edit version in [T15](T15-edit-existing.md).)*

### Step 5 — Finish to Done (optional) or Discard
1. **Act:** click `Continue to Test` once (Deploy:none → no 4th turn, advances to Done) **or** `Discard build` if you only needed the Implement-gate evidence.
2. If you continued: **Assert** Done gate (badge `Done` / title `Test passed — workflow updated`) and Report `Deploy` row `not deployed (local)`.

---

## Optional extension builds — one node type each (run only what you need)

Each is a **fresh ~3-turn build** from scratch. Same flow as Steps 1–4: submit → Analyze gate → Spec gate → Implement gate → open `main.yml` → assert the listed `type:` token + lint green → Discard. Requirements are copy-paste from [BUILD-PROMPT-CORPUS.md](BUILD-PROMPT-CORPUS.md).

| Sub-test | Requirement (corpus id) | Assert `main.yml` contains | Notes |
|---|---|---|---|
| **T13-CODE** | G1-CODE — *"…count, sum, and average … Use a code node for the math; do not call an LLM."* | `type: code` (and likely **no** `llm`) | Python stdlib only; deterministic. |
| **T13-ITER** | G1-ITER — *"…JSON array of up to 10 product descriptions and, for each one, generates a one-line tagline."* | `type: iteration` | Stays under the ≤30 cap. |
| **T13-CHAIN** | G1-CHAIN — *"…chains three LLM steps: draft → critique → revise."* | **≥2** `type: llm` in sequence | `multi-step-llm` pattern. |
| **T13-JSON** | G1-JSON — *"…returns a JSON object with keys title, authors, abstract, keywords."* | `llm` **or** `parameter-extractor`; SPEC pins the exact key set | Structured output. |
| **T13-TEMPLATE** | G1-TEMPLATE — *"…formatted sentence … Use a template node, not an LLM."* | `type: template-transform` | Deterministic. |
| **T13-FILE** | G1-FILE — *"…user uploads a document … extracts text … 5-bullet summary."* | `type: document-extractor` + `type: llm`; start declares a **file** input | `file-to-llm` pattern. |
| **T13-RAG** | G1-RAG — *"…retrieving relevant passages from a knowledge base …"* | `type: knowledge-retrieval` + `type: llm` | Dataset id should be a **TODO/open question**, not fabricated. |
| **T13-AGENT** | G1-AGENT — *"…uses an agent with web-search and calculator tools …"* | `type: agent` | Plugin hashes left as `# TODO: hash` (never invented — `AGENTS.md §4.3`); a plugin-hash open question is **correct**, not a failure. |
| **T13-CLASSIFY** | G1-CLASSIFY — *"…classifies a support email into {billing, bug, other} …"* | `type: question-classifier` **or** `type: if-else` | **Thin corpus (1 example)** — engine may fall back to if-else or need a `/reply`; record which shape it chose. |
| **T13-EXTRACT** | G1-EXTRACT — *"…extracts recipient, street, city, postal code, country."* | `type: parameter-extractor` **or** an `llm` JSON node | **Thin corpus (1)** — either is acceptable; record the choice. |

> **Thin-corpus sub-tests (T13-CLASSIFY / T13-EXTRACT)** are also robustness probes: a graceful fallback or a clarifying `/reply` is a PASS; a hard error gate is a FAIL.

---

## Expected

- The branching primary build reaches the **Implement gate** (clean `Implemented` path expected) within the 300s windows, with every quoted EN chrome string matching the dictionary (or its JA equivalent).
- The produced `main.yml` (read from the panel `<pre>`) **contains the expected node-type tokens** for the requirement (primary: a conditional split — `if-else` **or** `question-classifier` — + a merge + ≥2 `llm`).
- The **`Lint results`** rows `validate_workflow` / `lint_refs` / `lint_plugin_hashes` are all **pass** (`ok`) on the clean gate.
- The **Diff** tab shows a **`Split diff` with an empty OLD column / whole file as additions** (`@@ -0,0 +1,N @@`) for from-scratch builds — the empty-base diff, NOT the `No diff yet …` message (which only shows pre-Implement).
- Each optional extension build whose YAML contains its target `type:` token + green lint is a PASS for that node type.

---

## Negative / edge variants

- **Still-failing Implement gate** (`Lint still failing`): OBSERVE only — record it, read the partial YAML, do not count the deterministic requirement as expected-to-fail (forcing a still-fail is **Impl‑CLI‑1**, [00-README §5](00-README.md#5-appendix-not-browser-testable)).
- **Wrong pattern chosen** (e.g. classifier built as plain if-else): not a FAIL by itself — record it; if the shape is clearly wrong, exercise `Request changes` / `/reply` (mechanics in [T03](T03-gates-and-decisions.md); reply templates in [BUILD-PROMPT-CORPUS.md](BUILD-PROMPT-CORPUS.md) G5) to steer, and note whether the re-run corrects it.
- **Over-large / out-of-scope requirements** (G2-OVER-CAP, G6-OOS-*): covered in [T14-input-robustness.md](T14-input-robustness.md), not here.

---

## Pass / Fail

**PASS** — all of:
1. The branching build reached the Implement gate within its windows; all quoted chrome strings matched (EN dictionary, language pinned in Step 0).
2. The produced `main.yml` contained the expected branch node types (a conditional split — `if-else` **or** `question-classifier` — + a merge + ≥2 `llm`), captured as evidence.
3. The three lint rows were all `ok` on the clean gate (or, if still-failing, the gate + partial YAML were recorded as an observation).
4. The Diff tab showed the from-scratch **empty-base split diff** (empty OLD column, whole file as additions) — not the pre-Implement `No diff yet…` message.
5. For each optional extension run: its target `type:` token was present and lint was green (thin-corpus fallbacks recorded, not failed).

**FAIL** — any of: a gate didn't appear within its timeout; an **unexpected error gate** (`Phase failed` / `{phase} errored`) appeared for an in-scope requirement; the produced YAML **lacked the core node type** the requirement demands (e.g. a branching requirement produced a single linear LLM with no conditional); a lint row showed `exit {code}` on what should be a clean build with no still-failing gate; or a chrome string differed from the active-language dictionary value.

**Evidence (on any FAIL):** screenshot the gate + the `main.yml` `<pre>`; quote the `type:` tokens actually found vs expected, and the lint row states.

---

## Cleanup

- Discard/Cancel every build you started: `Discard build` on the gate, or sidebar hover-× `Cancel this build`. Cancel is non-destructive — `projects/` + `.runs/` stay on disk ([00-README §1.3](00-README.md#13-conventions-every-test-file-assumes)).
- A completed build scaffolds `projects/<slug>/`; that's expected, no manual cleanup needed. If resetting for a clean re-run, remove only the newly created `projects/<slug>/` dirs you generated.
