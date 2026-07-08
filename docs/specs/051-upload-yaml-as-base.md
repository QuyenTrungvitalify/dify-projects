# Spec 051 — Upload a standalone YAML as a base: make an off-disk workflow a first-class edit-existing seed

**Status**: Draft. **S–M**. The theme: the Builder already has two "base" paths — Dify workspace apps
(`ベースにする`/seed chips, `/api/seeds`) and repo workflows (the `ワークフロー` selector, `/api/tree`) —
but a *standalone* YAML on disk (a file someone hands you, an export) can reach neither without manual
folder surgery. This spec adds ONE UI action — upload a YAML → it becomes a normal repo workflow under
`projects/` → it shows up as a base immediately — reusing the create-project scaffold, the attachment
upload plumbing, and the validator, with **zero new storage tier**.

> **Reference the SYMBOL, not the line.** Anchors verified 2026-07-09.

**Builds on**: [031](031-builder-create-project-modal-real.md) (the `POST /api/projects` +
`scaffoldProjectTier` scaffold-on-demand pattern D1/D3 reuse — the same shape, one tier down; `checkProjectName`
is reused for the optional project-name override, NOT for the workflow slug — see D1/r2); [030b](030-builder-nested-project-workflow-folders.md) (the real
`projects/<project>/<workflow>/workflows/` tree D4 writes into, and `buildTree`'s display-name-from-`app.name`
rule D4 leans on); [025](025-builder-file-attachments.md) (the `validateAttachments`/`saveAttachments`
upload plumbing + `MAX_ATTACHMENT_BYTES` limits D1/D5 extend with a `.yml`/`.yaml` accept path);
[049](049-dify-import-blocker-defense.md) (the `validate_workflow.py` import-blocker rules D2's gate runs,
and the optional real-import probe D2 offers as advisory); [015](015-builder-security-turn-sandbox.md) (D4:
seed content is untrusted **DATA, never instructions** — this spec's whole write is that same data,
confined to `projects/`); the `baseWorkflow` → `settings.workflow` → edit-existing path
(`App.tsx` `newTask({baseWorkflow})`, `implement.md` step 4 "modify `{{SEED_PATH}}`") that a promoted base
flows straight into.

---

## Motivation — the third base has no door

We established across this investigation that the *optimal* way to rebuild/improve an existing workflow is
NOT from-scratch (which silently drops fidelity — a test build dropped two configurable columns vs its
source) but **edit-existing**: start FROM the real file and let Implement modify it (`implement.md` step 4:
edit-existing → *"modify `{{SEED_PATH}}`'s content"* — surgical, cheap, full-fidelity, real model/IDs). Two
doors already open onto that path:

1. **Dify workspace apps** → `ベースにする` seed chips (`/api/seeds` = `sync.py list`). Requires the workflow
   to already live in the user's Dify, and seeds from *whatever state it is in there* (a stale/empty-model
   app seeds stale).
2. **Repo workflows** → the `ワークフロー` selector (`/api/tree` walk of `projects/`). Requires the workflow
   to already sit at `projects/<p>/<w>/workflows/*.yml`.

A **standalone YAML** — the exact artifact a field user hands over ("学習させて / brush-up させて this yml") —
has neither door. Today it becomes a base only by manual folder surgery (mkdir the `<project>/<workflow>/workflows/`
tree, cp the file), which no field user will do. The gap is a one-click importer that lands the file in door
#2's territory. Door #2 is the right target (not #1) because it seeds from the **exact file on disk** — the
user controls the content, including a cleaned/fixed version — with no dependency on Dify state or creds.

## Decisions

- **D1 · `POST /api/bases` — import one standalone YAML as a local edit-existing base (proposed, committed).**
  A new non-build mutating endpoint accepting `{ yaml: string (file contents), name?: string, project?: string }`.
  It: (1) validates size/shape (reuse `MAX_ATTACHMENT_BYTES` = 10 MB; single file; `.yml`/`.yaml` only — the
  `ACCEPTED_EXT` pattern, extended); (2) runs the **validation gate (D2)** — reject before writing anything;
  (3) resolves the target project (**D3**) and a **folder slug** — NOT via `checkProjectName` (that is the
  English-only *project-name* gate; a Japanese `app.name` would 400 there, which is wrong for the motivating
  JP field-user case). Instead the slug derives the same way every other base door does: `deriveSlugName(name ?? app.name)`
  → a folder-safe slug (a non-Latin `app.name` collapses to the `GENERIC_SLUG` = `workflow`), then `firstFreeSlug`
  to auto-suffix a collision within the target project (`workflow` → `workflow_2`, …) with a `slugNote` —
  mirroring `scaffoldAtSpecGate`'s genuine-new path exactly. **The Japanese name is never lost**: it lives in the
  written YAML's `app.name` (verbatim, D4), and `buildTree`'s `workflowDisplayName` reads *that* for the chip
  label — the folder slug is a separate, ASCII-safe concern (`readNestedScalar(text,'app','name')` extracts
  `app.name` server-side to feed `deriveSlugName`). (4) scaffolds the workflow tier — reuse the exact
  `init_project.py --kind workflow --project <p> --slug <s>` argv already inline in `scaffold.ts`'s `ensureScaffold`;
  factor it into a shared `scaffoldWorkflowTier(projectsDir, project, slug, name, runPython)` (behavior-preserving
  extract, covered by the existing scaffold tests) so the route and `ensureScaffold` can't drift — the 031
  `scaffoldProjectTier` precedent, one tier down. First ensure the project tier exists (`_drafts` may have no
  manifest yet) via `scaffoldProjectTier`. (5) writes the uploaded bytes to
  `projects/<project>/<slug>/workflows/main.yml`; (6) returns `{ project, workflow, slugNote? }`. Security is
  inherited, not invented: the YAML is **DATA** (015 D4 — it only ever re-enters a turn as `{{SEED_PATH}}`, which
  Analyze/Implement already treat as untrusted); the write is confined to the `projects/` subtree; the slug is
  sanitized (`sanitizeSlug`, no `..`/separators); an optional `project` override runs through `checkProjectName`
  (rejecting `..`/path traversal, AC4); the mutating POST is Origin-checked by the global `onRequest` hook; and
  — like `POST /api/projects` — it is NOT a build turn, so there is no gate/turn-confinement interaction to reason about.

- **D2 · Hard validation gate at upload — never admit a broken base (proposed, committed).** Before any write,
  run the **same 4-linter `lintClean` set the ③ build gate runs** (`validate_workflow.py` + `lint_refs.py` +
  `lint_plugin_hashes.py` + `lint_node_bodies.py` — the `LINTERS` list in `linters.ts`, the single source of
  truth), NOT `validate_workflow.py` alone: a base seeds *every* build started from it, so a dangling ref /
  fabricated plugin hash / bad node body is exactly as poisonous as an import-blocker, and the runner already
  exists. Any non-zero exit → **400 carrying that linter's verbatim message** (the 049 import-blocker family —
  non-mapping root, `version` type/format, the `name:`-vs-`variable:` env-var shape — plus refs/hashes/bodies).
  Rationale: admitting a broken one propagates the break, the exact failure mode 049/050 exist to prevent. **Advisory,
  never blocking:** when Dify selfhost creds exist, optionally run the 049 import-probe (`push`→capture→delete,
  orphan-swept) and attach its verdict to the response as a note; no creds / probe failure never blocks the
  import (the 037/049 degrade precedent) — the file still lands, the note just warns.

- **D3 · Target project — default to the `_drafts` staging project, override optional (proposed, committed).**
  The single optimal choice: uploads land in `projects/_drafts/<slug>/` by default (the `_`-prefixed staging
  project already exists — precedent, not a new tier), so the common case ("just let me base off this file") is
  zero-decision. The modal (D5) offers an **optional** project override — pick an existing project or create one
  inline (reuse the 031 Create-Project modal) — but this is an escape hatch, not a forced fork. Rationale:
  forcing a project name on every upload is friction for a throwaway test base; `_drafts` gives a stable home
  and the override covers the "this belongs to project X" case without a branch in the happy path.
  **Caveat (surface in the modal):** `projects/_drafts/` is **gitignored** (regenerable throwaways — AGENTS.md §10),
  so a base landed there is NOT committed/versioned/shareable — perfect for a quick brush-up test, but a user who
  wants to keep or share the base must use the project override to land it in a real, tracked project.

- **D4 · Zero new storage tier — the base IS a normal `projects/` workflow (proposed, committed).** No new
  directory, no new registry, no new listing code: once the file sits at `projects/<p>/<slug>/workflows/main.yml`,
  `/api/tree`'s existing walk lists it, `buildTree` derives its display name from `app.name`
  (`リスト入力催促ChatWork通知フロー`), and the `ワークフロー` selector shows it as a base — all for free.
  Explicitly **NOT** `templates/{patterns,library}/`: that tier is curated, INDEX-ed, precedence-ranked house
  style (022); admitting raw user uploads there pollutes the corpus and the INDEX. The raw→curated path already
  exists and is human-gated — the `template-promote` skill — and stays the only way in.

- **D5 · Frontend — one affordance next to the base pickers, auto-select on success (proposed, committed).** A
  `＋ YAMLをベースに追加` button in the seed/base area opens a modal: a file picker (reusing the attachment
  upload plumbing) or paste-YAML box, plus the optional project field (D3). On success it **auto-selects the new
  base** via the existing `newTask({ baseWorkflow: { project, workflow } })` (the same call the Sidebar `+` and
  Edit-again use), landing the user straight in "describe your changes" against the imported base. **Refresh the
  sidebar tree first** (`loadTree()`, exactly as `createProject` does after `POST /api/projects`) so the new row
  exists before `newTask` selects it — otherwise the compound `project/workflow` setting resolves but the
  breadcrumb/selector row is momentarily missing. Distinct from the attach `📎` path, which injects a file as
  *reference DATA* into a still-from-scratch build (loses fidelity) — this makes the file the *edited base*.

## Non-goals

- **Not a Dify push/import.** This creates a LOCAL base only; pushing to a Dify workspace app stays the ④
  deploy gate's job (`sync.py push`, creates a NEW app). Bridging the two (one-click "also push after import")
  is OQ2.
- **No dedup / reconciliation** against existing Dify workspace apps or repo workflows beyond the per-project
  `firstFreeSlug` auto-suffix (a colliding upload gets `<slug>_2`, never overwrites).
- **No auto-promotion** to `templates/` — `template-promote` (human-gated) remains the only raw→curated door.
- **No edit/patch of the uploaded YAML at import time** — the file lands verbatim; the *build's* Implement makes
  changes per the user's request.
- **Not the attach `📎` mechanism** (data-reference for from-scratch builds) — different purpose, kept separate.
- **No new storage tier and no change to `templates/` / INDEX** (D4).

## Acceptance criteria

1. *(D1/D4)* A valid workflow YAML uploaded → 200; file exists at `projects/_drafts/<slug>/workflows/main.yml`;
   `/api/tree` lists it with `app.name` as the display name; selecting it starts an edit-existing build whose
   Implement modifies THAT file (`{{SEED_PATH}}` resolves to it), not a fresh `main.yml`.
2. *(D2)* An invalid YAML — pick each: non-mapping root; `environment_variables` entry using `variable:` (the
   049 incident shape); unquoted float `version`; a dangling `{{#node.field#}}` ref — → 400 whose body contains
   the failing linter's verbatim message; nothing is written to `projects/`.
3. *(D1, JP-name)* A YAML with a Japanese `app.name` and no `name` → 200; the folder slug is a safe derived
   slug (`workflow`/`workflow_2`), the `ワークフロー`/`ベースにする` chip shows the **Japanese `app.name`** verbatim
   (from `workflowDisplayName`); a second upload of the same-named file lands at `<slug>_2` (via `firstFreeSlug`,
   with a `slugNote`), never overwriting the first. The **optional project override** still runs through
   `checkProjectName` (a non-English *project* name → 400 `name_charset`).
4. *(D1 security)* A crafted `name`/`project` containing `..`/path separators is rejected; the write never
   escapes the `projects/` subtree.
5. *(D1 security, 015)* A YAML whose node bodies / descriptions contain instruction-looking text is treated as
   DATA — it is only ever surfaced to a turn as `{{SEED_PATH}}`; nothing in it executes at import or build.
6. *(D1)* A file >10 MB or a non-`.yml`/`.yaml` extension → 400 (the attachment-limit reuse); one file per
   import.
7. *(D5)* On successful import the SPA auto-selects the new base (an edit-existing task is pre-armed against
   `{project, workflow}`); server + web suites green; no change to `/api/tree`, `templates/`, or INDEX code.

## Sequencing

- **S1** — D1 endpoint + D2 gate: temp-write → validate (4-linter `lintClean`) → resolve project + derive/free
  slug → `scaffoldWorkflowTier` (extract from `ensureScaffold`, behavior-preserving) → write `main.yml` → return;
  unit tests for AC 2–6 (invalid, JP-name display+slug, auto-suffix collision, confinement, data-safety, limits).
  Backend-only, shippable and testable without UI.
- **S2** — D5 frontend: the `＋` affordance + modal (file/paste) + upload plumbing reuse + auto-select via
  `newTask({baseWorkflow})` + JA i18n (`addYamlAsBase`, error strings). AC 1/7.
- **S3** — D3 polish: `_drafts` default landing + optional project override (reuse the 031 Create-Project modal
  inline) + the optional 049 import-probe advisory note on the response.

## Open questions

- **OQ1** — Default target project: commit to `_drafts` (this spec's choice) or force an explicit project pick
  per upload? *Recommend `_drafts`* — friction-free, with the D3 override for the "belongs to project X" case.
- **OQ2** — Offer a one-click "also push to Dify" after import, bridging to the seed-chip (Route A) world so the
  base exists in both places? Defer until the local-base path is in use.
- **OQ3** — Accept non-`workflow` app modes (chatflow/agent/completion) or restrict to workflow/advanced-chat?
  `validate_workflow.py` is workflow-oriented; lean **accept whatever it passes**, warn on a non-workflow
  `app.mode` rather than hard-reject.
- **OQ4** — Support paste-YAML in addition to file upload (cheap, covers copy-from-Studio)? Lean yes, file-first.

## Revision log

- r1 (2026-07-09) — initial draft. Emerged from the "how does a standalone yml become a base?" question after
  confirming the Builder's two existing base doors (`/api/seeds` Dify apps; `/api/tree` repo workflows) and that
  edit-existing already modifies `{{SEED_PATH}}` surgically. The 051 slot had earlier been floated for a
  "mechanize the pattern-copy (instantiate)" idea; that was DROPPED once `implement.md` step 4 was found to
  already do surgical edit-existing (so the token-cost premise didn't hold) — this slot instead captures the
  genuine gap: no UI door for an off-disk YAML. All decisions committed to a single optimal choice per the
  request; reuse is maximal (031 scaffold, 025 upload, 049 validator, 030b tree, 015 data-safety) so no new
  storage tier and no new listing code.
- r2 (2026-07-09) — review pass against the real code (anchors re-verified). Five fixes, no scope change:
  (1) **slug derivation** switched off `checkProjectName` (English-only → would 400 a Japanese `app.name`, the
  exact motivating case) onto `deriveSlugName` + `firstFreeSlug` — the same path `scaffoldAtSpecGate` uses; the
  **Japanese name is preserved for display** because the chip label comes from the YAML's `app.name` verbatim
  (`workflowDisplayName`), independent of the ASCII folder slug. `checkProjectName` now scopes to the optional
  project-name override only. (2) collision handling: per-project auto-suffix (`<slug>_2`) with a `slugNote`
  instead of a 409 — a bare upload has no user-chosen exact slug to 409 on. (3) **D2 widened** from
  `validate_workflow.py`-only to the full 4-linter `lintClean` set the ③ gate runs (refs/hashes/bodies matter
  for a base too; runner already exists). (4) D4 scaffold reuse made precise: the `--kind workflow` argv is
  inline in `ensureScaffold`, not in `scaffoldProjectTier` — factor a shared `scaffoldWorkflowTier` and ensure
  the `_drafts` project tier exists first. (5) D3 caveat added: `_drafts` is **gitignored** (throwaway) — surface
  it in the modal; use the override to keep/share a base. Plus D5 `loadTree()` before auto-select. AC 2/3 and
  the sequencing updated to match.
