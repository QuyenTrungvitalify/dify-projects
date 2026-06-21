# T15 — Edit an existing workflow (Workflow ≠ none → Analyze summarizes; incremental edit-diff)

| Field | Value |
|---|---|
| **ID** | T15 |
| **Title** | Build target = an existing local workflow; Analyze summarizes it, Implement edits it in place, Diff has a non-empty (pre-edit) base |
| **Traces to** | AC#2 (seed/edit → Analyze summarizes & stops) · AC#4 (Implement → `main.yml`) · the Diff edit-base (non-empty). Exercises the local edit-existing path closed by **[GAP-REPORT #14](GAP-REPORT.md)** (`localEditSeed`, fixed 2026‑06‑18). |
| **Priority** | P1 |
| **Cost** | **~3 turns**. Reuses an existing **`done`** project as the edit target. |

> **History:** the first T15 run (2026‑06‑18) FAILED — selecting a local Workflow-chip slug silently built from-scratch (`seed: null`), a known 009 limitation (GAP #14). That gap is now **fixed** (`localEditSeed` snapshots the chosen workflow as the seed). T15 therefore tests the **working** edit-existing path below. If you see the OLD behavior again (Analyze says `seed: null` despite Workflow ≠ none), the fix regressed — that is a **FAIL** (see Negative variants).

> **Strings:** pin English (Step 0 of [T13](T13-build-capability.md#step-0--pin-the-ui-language-to-english-chrome-string-determinism)) or substitute `i18n.ts` `ja`. YAML/SPEC/diff content is model-generated and NOT translated → edit-detection assertions are structural/semantic.
>
> **The Workflow chip** (composer settings row) lists `none (new)` plus every existing workflow slug from `/api/tree` (`Chat.tsx:328`). Selecting a slug makes that workflow the **build target**; the backend's `localEditSeed` prelude resolves it into a seed (snapshot of `projects/<slug>/workflows/main.yml` → `.runs/<taskId>/seed.yml`).

---

## Preconditions

- App at **http://127.0.0.1:4123**, reachable; clean (no live/parked build). Language pinned to English.
- **An existing target workflow must exist.** Open the **Workflow** chip dropdown:
  - If it lists ≥1 slug besides `none (new)` (e.g. a `done` topic→summary workflow from [T02](T02-build-happy-path.md), or any **Projects**-tree entry whose `projects/<slug>/workflows/main.yml` exists) → pick one. Prefer a **simple, known** one.
  - If it shows only `none (new)` → no target yet: run [T02](T02-build-happy-path.md) to `done` first, or **STOP and report**.
- Settings: **Workflow** = *(the chosen slug)*, **Confirm** = `each step`, **Deploy** = `none`.

---

## Steps

### Step 1 — Set the target + submit an edit requirement
1. **Observe:** the **Workflow** chip reads `none (new)`.
2. **Act:** click it, select the existing target slug (e.g. `workflow_topic_string_3`). The chip now shows the slug.
3. **Act:** type the edit requirement (corpus **G3-EDIT-ADD**) and Send:
   ```
   Add a translation step after the summary so the final output is the summary translated into Japanese.
   ```
4. **Wait (≤10s):** thread view appears; phase track visible; Analyze `Running` / `Working…`.
5. **Assert:** the artifact panel sub-header (`ah-sub`, `ArtifactPanel.tsx:312`) shows the target slug/name — **not** the `new workflow` fallback.

### Step 2 — Analyze gate → assert it SUMMARIZED the existing workflow (edit signal)
1. **Wait (≤300s):** poll until the **Analyze gate** (badge `Analyze complete` / title `Ready to write the spec`). If none in 300s, **STOP and report**.
2. **Act:** read the Analyze output in the conversation thread (the `SPEC.md` tab is still empty pre-Spec).
3. **Assert (key — edit vs from-scratch, GAP #14 fixed):** the Analyze output **describes the existing workflow** — it references the current node(s) (the start input, the existing summary `llm`, the end node) and names the **change point** ("add a translate node after the summary"). It must **NOT** say "this is a from-scratch build" / "no seed to analyze" / record `seed: null`. *(Old GAP #14 behavior = `seed: null` here = FAIL/regression.)*
4. **Act:** click `Continue to Spec` once.

### Step 3 — Spec gate → assert an incremental plan (keep existing + add translate)
1. **Wait (≤300s):** Spec gate (badge `Spec ready`).
2. **Act:** click `open SPEC.md`, read the Spec tab.
3. **Assert:** the Nodes table **keeps** the existing nodes and **adds** a translate `llm` node after the summary; it's an **edit**, not a full rewrite. **No new slug** is proposed (it edits the chosen target).
4. **Act:** click `Implement this spec` once.

### Step 4 — Implement gate → YAML reflects the edit; Diff has a non-empty base
1. **Wait (≤300s):** Implement gate (clean = badge `Implemented` / title `main.yml built and linted`). *(Still-failing variant → OBSERVE per [T13](T13-build-capability.md) Step 4.1.)*
2. **Act:** open the **`main.yml`** tab; read the `<pre>` YAML.
3. **Assert (structural):** the YAML contains **both** the original summary `llm` and a new translate `llm` (≥2 `type: llm`), wired summary→translate→end. The original behavior is preserved; the translate step added.
4. **Assert (lint):** `Lint results` rows `validate_workflow` / `lint_refs` / `lint_plugin_hashes` all **pass** (`ok`).
5. **Act:** click the **`Diff`** tab.
6. **Assert (the T15 headline — non-empty base):** the Diff shows a **`Split diff`** whose **OLD/base column is NON-empty** — it renders the **pre-edit** workflow (the `localEditSeed` snapshot) with the change as `+`/`−` lines amid unchanged context (the inserted translate node as added lines). This is the discriminator vs a from-scratch build:
   - **Edit-existing (here):** base = the pre-edit snapshot (`localEditSeed` → `.runs/<taskId>/seed.yml`; `resolveBase` prefers `seedPath`) → populated OLD column + real +/− hunks.
   - **From-scratch ([T13](T13-build-capability.md) Step 4.5):** empty base → whole file as additions (`@@ -0,0 +1,N @@`).
   - **If you instead see an all-additions empty-base diff here** (empty OLD column, like from-scratch) → the edit seed/snapshot failed = **FAIL** (GAP #14 regression). The `No diff yet …` empty-state must NOT appear after a successful Implement.

### Step 5 — Finish or Discard
1. **Act:** `Continue to Test` → Done (Deploy:none, no 4th turn), **or** `Discard build`.
2. If continued: **Assert** Done gate + Report `Deploy` row `not deployed (local)`.

---

## Expected

- With **Workflow ≠ none**, Analyze produces a **summary of the existing target** (references its nodes + the change point), **not** a `seed: null` / from-scratch note.
- The Spec is an **incremental edit** (keeps existing, adds translate), no new slug.
- The produced `main.yml` contains **both** the original summary `llm` and the added translate `llm`, lint green.
- The **Diff** tab shows a `Split diff` with a **non-empty OLD/base column** (the pre-edit version) and the change as `+`/`−` lines.

---

## Negative / edge variants

- **REGRESSION of GAP #14:** Analyze says `seed: null` / from-scratch despite Workflow ≠ none → **FAIL** (the `localEditSeed` fix regressed). Capture the Analyze text + the chip value.
- **Workflow dropdown lists only `none (new)`:** precondition unmet — STOP/report or create a target first.
- **Implement wholesale-rewrites** (drops the original summary node / unrelated graph): **FAIL** — an edit must preserve unrelated existing behavior.
- **Empty-base diff here** (all-additions, like from-scratch): **FAIL** — the pre-edit snapshot wasn't used.
- **Target with no `main.yml`** (a project that never built one): `localEditSeed` falls back to slug-only / empty seed → it builds *into* that project from scratch. Edge case; not the primary path. Prefer a target with a real `main.yml`.

---

## Pass / Fail

**PASS** — all of:
1. The chip targeted an existing slug (chip + panel sub-header show it, not `new workflow`).
2. Analyze **summarized the existing workflow** (referenced real nodes + change point; `seed` ≠ null).
3. Spec was **incremental** (no new slug); Implement's `main.yml` kept the original summary `llm` and added a translate `llm` (≥2 `llm`), lint green.
4. The Diff showed a `Split diff` with a **non-empty OLD/base column** (pre-edit) and the change as `+`/`−` lines.

**FAIL** — any of: Analyze treated it as from-scratch (`seed: null` — GAP #14 regression); Implement wholesale-rewrote; the Diff rendered empty-base (snapshot not used); lint failed on a clean build with no still-failing gate; or the target slug was never honored.

**Evidence (on any FAIL):** screenshot the Analyze output + the `main.yml` `<pre>` + the Diff tab; quote what Analyze said (summary vs `seed: null`) and the node set found.

---

## Cleanup

- `Discard build` / sidebar hover-× on the build you started. Discard is non-destructive (a discarded build wrote only to `.runs/<id>/`; the in-place `projects/<slug>/main.yml` is only updated on a confirmed Implement/Done).
- **Important:** if you take the edit to **Done**, the target's `projects/<slug>/workflows/main.yml` **is updated in place** (that's the point). To restore the original for other tests, `git checkout` that file (or re-run the original requirement).
