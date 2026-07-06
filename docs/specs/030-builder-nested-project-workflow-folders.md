# Spec 030 — Nested project→workflow folders (make the sidebar tree a real on-disk hierarchy)

**Status**: Draft (r2 — accuracy-reviewed against current code; D1/D2/D5/D6 decisions locked; **not yet implemented**, awaiting go-ahead)
**Effort**: M–L (medium-large) — a genuine data-model refactor, ~2–2.5× spec 029. No architectural blocker: the cost is (1) splitting the conflated `slug` into `project` + `workflowSlug`, (2) restructuring the `init_project.py` template into two tiers, (3) rewriting `buildTree` from a synthetic group-by-tag into a real 2-level directory walk, and (4) re-pathing the **turn's own skill-body templates** (§8 — the easy-to-miss, build-breaking one). Everything else is mechanical path edits. Existing `projects/` are **disposable test data** (user-confirmed) — delete them wholesale, no migration branch — which is why this lands at M–L rather than L.

**Supersedes**: [029](029-builder-new-task-into-existing-project.md) — the entire `targetGroup`/`--group`/`project.group` grouping machinery exists ONLY to fake a hierarchy over a flat namespace; a real nesting makes the folder the group, so 029 is retired in place (see §6). **Builds on** the §Data model, [010](010-*) (F4 collision → rescoped per-project), and the confinement backstop ([015](015-*)). **Depends on**: nothing new. **No change to** the gate FSM, the phase ladder, the PreToolUse permission-gate hook, or the workflow validators (`validate_workflow.py`/`lint_refs.py`/`lint_plugin_hashes.py` are path-agnostic — verified).

---

## Context — the "Project" in the sidebar is a fiction

Today every workflow is a **flat** directory `projects/<slug>/`, and the 3-level sidebar tree (Project ▸ Workflow ▸ Task) is **synthetic**: [`buildTree`](../../apps/builder/server/lib/artifacts.ts#L219) globs `projects/*/`, reads each `.dify-workspace.yaml`, and buckets the flat dirs by a `project.group` **tag** ([parseWorkspaceProject](../../apps/builder/server/lib/artifacts.ts#L123) returns `group: out.group || slug`, [artifacts.ts:150](../../apps/builder/server/lib/artifacts.ts#L150)). Spec 029 added a `--group` stamp so a from-scratch build lands in a chosen bucket.

Consequences of the fiction, all reported or observed:
- **Confusing folder names.** A new workflow for project `workflow_uppercases_input_string` lands at `projects/workflow_11/` — the folder name is unrelated to the project because the slug is a *global* name derived from the requirement. (029 mitigated the label, not the structure.)
- **Global slug collisions.** [`firstFreeSlug`](../../apps/builder/server/lib/slug.ts#L51) scans **all** of `projects/*` for global uniqueness → `workflow_2 … workflow_11`. Two clients can't each have a `summarizer`.
- **Best-effort isolation.** [`confinementCheck`](../../apps/builder/server/lib/post-turn.ts#L175) whitelists `projects/<slug>/`, but a flat layout cannot *structurally* stop a rogue turn from writing into a sibling `projects/<other>/`.
- **No project-level sharing.** Dify endpoints + secrets ([`envs/dev.env`](../../tools/dify_base/sync.py#L76)) are duplicated per workflow; there is no place for per-project shared config.

**The change:** make the hierarchy REAL on disk —

```
projects/
  <project>/                      ← a Project (real folder)
    .dify-workspace.yaml          ← PROJECT manifest (name + shared Dify workspace/env config)
    envs/dev.env                  ← shared per-project secrets (gitignored)
    README.md
    <workflow>/                   ← a Workflow (folder within the project)
      workflows/main.yml
      SPEC.md
      prompts/  inputs/  tests/
    <workflow_2>/
      workflows/main.yml
      …
```

The filesystem **becomes** the tree; `buildTree` stops grouping and just walks two levels. The whole 029 tag machinery is deleted.

---

## Design decisions (resolved defaults — adjustable before implement)

These are the open questions the feasibility map surfaced. Each is **resolved with a recommended default** so implementation isn't blocked. **D1, D2, D5, D6 are user-confirmed (2026-07-02) — locked to the defaults below.** D3/D4/D7 stay engineering defaults (settle at their noted step).

- **D1 · `.dify-workspace.yaml` lives at the PROJECT level** (`projects/<project>/.dify-workspace.yaml`), one per project. It carries `project.name` + the Dify workspace/console endpoints. *Rationale:* it already describes a workspace mapping (shared), not a single workflow. A per-workflow override is out of scope.
- **D2 · `envs/` (Dify creds) are PER-PROJECT, shared** (`projects/<project>/envs/dev.env`). All workflows in a project push/pull against the same Dify workspace. *Rationale:* matches how a real "project" groups related workflows; halves credential duplication. If two workflows must target different Dify apps, they belong in different projects. **App-id is still per-workflow** (each Dify app has its own `DIFY_APP_ID`) — see D6.
- **D3 · Workflow-slug uniqueness is PER-PROJECT.** `firstFreeSlug` scans `projects/<project>/*` (not all of `projects/`). `summarizer` may coexist in `client_a/` and `client_b/`. *Rationale:* the whole point of nesting.
- **D4 · The project folder name is chosen at project-creation** (the existing "New project" modal already collects a name → slug). A from-scratch build via **workflow-"+"** on a project creates a workflow *inside* an existing project; a build via the global **"New task"** with no project targets a fallback project (see D5).
- **D5 · Ungrouped / "loose" workflows live under a reserved project folder** `projects/_drafts/` (real folder, replacing today's synthetic `__drafts__`). A global "New task" that never picks a project builds there. *Rationale:* keeps the invariant "every workflow is `projects/<project>/<workflow>/`" with no null-project special case on disk. *(Alternative: keep loose workflows one level up as `projects/<workflow>/` and treat a project as "a folder that contains workflow subfolders". Rejected — it makes `buildTree` ambiguous about whether a dir is a project or a workflow.)*
- **D6 · Workflow display name** = the Dify DSL `app.name` inside that workflow's `main.yml` when present, else `titleCaseSlug(<workflow folder>)`. *Rationale:* no extra per-workflow manifest; `main.yml` already carries the authored name. Pre-implement `main.yml` (phase ①/②) → folder-name fallback.
- **D7 · The legacy `Task.slug` field is REMOVED** and replaced by `project` (folder) + `workflowSlug` (subfolder). *Rationale:* carrying a conflated third identifier alongside the real two invites drift. A computed `${project}/${workflowSlug}` convenience getter is allowed if churn is a concern.

---

## Goals

1. **A project is a real folder; a workflow is a real subfolder.** `projects/<project>/<workflow>/workflows/main.yml`. The sidebar tree is a direct read of the FS.
2. **Per-project workflow namespacing.** A workflow named `summarizer` in project `my_app` is `projects/my_app/summarizer/`, independent of any `summarizer` in another project. Collisions are resolved per-project.
3. **Structural confinement.** A build turn is confined to its own `projects/<project>/<workflowSlug>/` subtree — a turn for workflow X **cannot** resolve into a sibling workflow Y or a sibling project by construction.
4. **Shared per-project config.** One `projects/<project>/.dify-workspace.yaml` + `envs/dev.env` serve every workflow in the project.
5. **029 retired, not carried.** All `targetGroup`/`--group`/`project.group`/`target_group` code is deleted; the folder IS the group.

---

## Non-goals (the leanness boundary)

- **No data migration.** Existing `projects/<slug>/` are wiped, not moved (user-confirmed). The spec evaluates the code/tooling change only.
- **No change to the gate FSM or the PreToolUse permission-gate hook.** The hook's blanket `projects/` allow ([permission-gate.ts](../../apps/builder/server/hooks/permission-gate.ts)) stays a backstop; the load-bearing gate is post-turn's now-tighter per-`(project, workflow)` confinement. *(The phase **ladder** — Analyze→Spec→Implement→Test order + gates — is unchanged; but the **paths injected into the turn** (§8 skill bodies + `injectVars`) DO change — that is a path re-point, not an FSM change.)*
- **No change to the workflow validators.** `validate_workflow.py` / `lint_refs.py` / `lint_plugin_hashes.py` take a file path and are layout-agnostic — verified, zero change.
- **No project rename / move-workflow-between-projects UI.** Creating a workflow in a chosen project is in scope; reorganizing afterward is not.
- **No cross-project workflow references.** A workflow bases on / edits a workflow within reach; cross-project seeding is out of scope.

---

## Design

### §1 Task identity — split `slug` into `project` + `workflowSlug`

The conflation is the spine. Today ([task.ts:57,58,59,84](../../apps/builder/server/state/task.ts#L57)):

```ts
project: string | null;   // "slug; null until Spec proposes/derives one"
workflow: string | null;  // workflow NAME (edit-existing target), NOT the folder
workflowFile: string;     // "main.yml"
slug: string | null;      // "== project once Spec proposes/derives one"
```

and scaffold does `task.slug = task.project = <slug>` in **four** places ([scaffold.ts:34](../../apps/builder/server/lib/scaffold.ts#L34) difySeed, [:107](../../apps/builder/server/lib/scaffold.ts#L107) localEditSeed, [:153](../../apps/builder/server/lib/scaffold.ts#L153) override, [:183](../../apps/builder/server/lib/scaffold.ts#L183) derived).

**New model:**

```ts
project: string | null;       // the PROJECT folder (projects/<project>/), null pre-scaffold
workflowSlug: string | null;  // the WORKFLOW subfolder (…/<workflowSlug>/), null pre-scaffold
workflow: string | null;      // unchanged — the display name / edit-existing target
workflowFile: string;         // unchanged — "main.yml"
// slug: REMOVED (D7) — or a computed getter `${project}/${workflowSlug}`
```

- Both are set **atomically at the Spec gate** (the one existing scaffold seam, [scaffoldAtSpecGate](../../apps/builder/server/lib/scaffold.ts#L140)).
- `createTask` ([task.ts:265](../../apps/builder/server/state/task.ts#L265)) accepts `project` (target project folder) + optionally a proposed `workflowSlug`; the wire field `slug` → `workflow_slug` (and a `project` field). `sanitizeSlug` ([task.ts:217](../../apps/builder/server/state/task.ts#L217)) is reused for BOTH the project and workflow folder names (both are `[a-z0-9_]` dir names).
- **Migration-in-flight guard:** default `workflowSlug` to `main` during the refactor so half-flipped paths still resolve (Sequencing S1).

**Path builders that read the pair** (all today read `t.slug`): [phases.ts:64](../../apps/builder/server/lib/phases.ts#L64) (spec artifactRel `projects/${t.slug}/SPEC.md`), [phases.ts:82](../../apps/builder/server/lib/phases.ts#L82) (implement `projects/${t.slug}/workflows/${t.workflowFile}`), [artifacts.ts:32](../../apps/builder/server/lib/artifacts.ts#L32) `specPathFor`, [artifacts.ts:40-44](../../apps/builder/server/lib/artifacts.ts#L40) `workflowPathFor` (the **Reveal-in-Finder** path, called from [ui.ts:129](../../apps/builder/server/routes/ui.ts#L129) — easy to miss; opens a dead flat path if not flipped), [artifacts.ts:55](../../apps/builder/server/lib/artifacts.ts#L55) `readArtifactContents`. Each becomes `projects/${t.project}/${t.workflowSlug}/…`. Mechanical, ~one edit each.

**The turn also writes by path — see §8.** The `t.slug` split is NOT just internal path builders: the phase skill bodies (`.claude/skills/dify-build/*.md`) are rendered with a `{{SLUG}}` token ([phases.ts:68,86](../../apps/builder/server/lib/phases.ts#L68) `injectVars`) and tell the *turn itself* where to write. Those 23 templates + the inject token are a first-class touchpoint (§8), not a phase-ladder change — the ladder is unchanged; only the paths it hands the turn change.

### §2 Confinement — the security-critical edit (test FIRST)

> Reader note (2026-07-06): [spec 039](039-post-turn-multi-workflow-lint.md) extends this
> delegation — the ③ gate now also LINTS every turn-touched `workflows/*.ya?ml` inside the
> whitelisted subtree (this spec polices only the boundary).

[`confinementCheck`](../../apps/builder/server/lib/post-turn.ts#L175) reverts any turn-touched path not whitelisted. The rule today ([post-turn.ts:180-189](../../apps/builder/server/lib/post-turn.ts#L180)):

```ts
const isWhitelisted = (path: string): boolean =>
  (p.slug !== null && path.startsWith(`projects/${p.slug}/`)) ||
  path.startsWith(`apps/builder/.runs/${p.taskId}/`) ||
  path.startsWith(`.runs/${p.taskId}/`) ||
  path === '.vscode/settings.json' ||
  (p.slug !== null && path === `projects/${p.slug}/.dify-workspace.yaml`);
```

**New rule** — confine to the WORKFLOW subtree:

```ts
(p.project !== null && p.workflowSlug !== null &&
   path.startsWith(`projects/${p.project}/${p.workflowSlug}/`)) ||
// …runs + .vscode unchanged…
```

- **The trailing `/` already anchors the prefix** — `"projects/a/sum_2/x".startsWith("projects/a/sum/")` is `false`. Keep the trailing slash; do NOT compare without it (that reintroduces the `sum`-prefixes-`sum_2` bug). This is why nesting is *structurally* safer: sibling workflows live in disjoint subtrees.
- **The `.dify-workspace.yaml` special-case is DROPPED** (D1): it moves to the project level, and a workflow build turn has no business writing the project manifest. If a build ever must (it should not), whitelist `projects/${p.project}/.dify-workspace.yaml` explicitly — but default is to omit it.
- **Pre-scaffold null case unchanged:** when `project`/`workflowSlug` are null (phases ①/②), no `projects/` write is whitelisted → any write under `projects/` is a breach, exactly as today.
- **Interface + all callers, one step.** `ConfinementParams.slug` ([post-turn.ts:65](../../apps/builder/server/lib/post-turn.ts#L65)) AND `PostTurnParams.slug` ([post-turn.ts:32](../../apps/builder/server/lib/post-turn.ts#L32)) — which also carries the flat artifact path at [post-turn.ts:88](../../apps/builder/server/lib/post-turn.ts#L88) (`projects/${p.slug}/workflows/${p.workflowFile}`) — both gain `project`/`workflowSlug`, drop `slug`. Their **two callers in `orchestrator.ts`** must pass the pair in the SAME step or tsc breaks: `postTurnCheck({… slug: task.slug! …})` ([orchestrator.ts:404](../../apps/builder/server/lib/orchestrator.ts#L404)) and `confinementCheck({… slug: task.slug …})` ([orchestrator.ts:466](../../apps/builder/server/lib/orchestrator.ts#L466)). (tsc catches these — a good backstop; import.ts in §7 does NOT get one.)

**MANDATORY: write these confinement tests BEFORE the refactor** (they must pass unchanged after):
1. a write to a **sibling workflow** under the same project (`projects/my_app/other/…`) is reverted;
2. a write to a **sibling project** (`projects/other/…`) is reverted;
3. **pre-scaffold** (project/workflowSlug null) still reverts any `projects/` write;
4. the legitimate `projects/<project>/<workflow>/workflows/main.yml` write is NOT reverted.

### §3 `buildTree` — flat glob → 2-level walk

Today ([artifacts.ts:219-273](../../apps/builder/server/lib/artifacts.ts#L219)): one `readdir(projects/)`, read each `.dify-workspace.yaml`, then a group-bucket loop ([:267-272](../../apps/builder/server/lib/artifacts.ts#L267)) keyed on `project.group`.

**New:**

```
for project in readdir(projects/):                       # each is a Project row
    read projects/<project>/.dify-workspace.yaml → project name          (D1)
    for workflow in readdir(projects/<project>/):        # skip reserved: envs/, README.md, .dify-workspace.yaml
        if not isDir or no workflows/ inside → skip      # a workflow folder has workflows/
        name = app.name(main.yml) ?? titleCaseSlug(workflow)             (D6)
        tasks = .runs tasks whose (project, workflowSlug) match
```

- Delete `parseWorkspaceProject`'s `group` derivation ([artifacts.ts:150](../../apps/builder/server/lib/artifacts.ts#L150)) and the whole bucket loop. `TreeProjectNode.id` ([artifacts.ts:103](../../apps/builder/server/lib/artifacts.ts#L103)) flips from **group key** → **project folder name**; `TreeWorkflowNode.id` becomes the workflow folder name (was the global slug).
- The synthetic `__drafts__` node ([artifacts.ts](../../apps/builder/server/lib/artifacts.ts)) becomes the real `_drafts` project folder (D5) — a normal walk, no special node.
- Tasks bucket by the `(project, workflowSlug)` pair on `task.json` instead of `slug`.
- **Reserved names** at the project level: `envs`, `README.md`, `.dify-workspace.yaml`, and any dotfile — not workflows.
- **Orphan-visibility must survive the rewrite.** Today buildTree has TWO fallbacks beyond the null-slug draft path ([artifacts.ts:255-261](../../apps/builder/server/lib/artifacts.ts#L255)): a loop ([artifacts.ts:277-284](../../apps/builder/server/lib/artifacts.ts#L277)) that surfaces a task whose `slug` points at a `projects/<slug>/` that does NOT exist (scaffold raced, or the dir was removed) so the build isn't stranded/invisible. The 2-level walk must keep this: a task whose `(project, workflowSlug)` matches no folder yet is bucketed under `_drafts` (or a synthetic orphaned row) — NOT silently dropped.

### §4 Python tooling + templates

- **`init_project.py` splits into two tiers** (the biggest single Python change). Today [`copy_template`](../../tools/dify_base/init_project.py#L143) copies the ONE flat `templates/_base/project/` tree ([init_project.py:24](../../tools/dify_base/init_project.py#L24)) to `projects/<slug>/`. New:
  - **Project tier** — `.dify-workspace.yaml` (name + endpoints, no `group`), `envs/`, `README.md`. Created once when a project is created.
  - **Workflow tier** — `workflows/`, `SPEC.md`, `prompts/`, `inputs/`, `tests/`. Created per workflow inside `projects/<project>/<workflow>/`.
  - Implement as either a `--kind project|workflow` flag OR a sibling `init_workflow.py`. Split the template dir into `templates/_base/project/` (tier-1) + `templates/_base/workflow/` (tier-2). Golden-file test the resulting tree.
  - `Answers.group` + the `{{group}}` substitution are **removed** (029 retired). `.dify-workspace.yaml` template line `group: "{{group}}"` is deleted.
- **`sync.py`** already parametrizes by `--project` + a relative `--file` ([sync.py:362,378,379](../../tools/dify_base/sync.py#L362)), and loads envs from `projects/<project>/envs/dev.env` ([sync.py:76](../../tools/dify_base/sync.py#L76)). Change: add a `--workflow` flag (or accept a two-segment `--project` value); keep **envs at the project level** (D2), route **workflow files** to `projects/<project>/<workflow>/workflows/` ([sync.py:213,262](../../tools/dify_base/sync.py#L213) messages + the interior joins). Change `sync.py` and `dify-io.ts` **in one commit** (§7).
- **`.gitignore` QA-scratch patterns — a real trap (not "low risk").** The throwaway-build ignore rules ([.gitignore:48-62](../../.gitignore#L48): `projects/workflow_*/`, `projects/[0-9]*/`, `projects/llm*/`, `projects/t_o_1_workflow*/`, …) are all **single-level** (a mid-string `/` stops `*` crossing it). Verified with `git check-ignore`: flat `projects/workflow/` is ignored, but nested `projects/_drafts/workflow_11/…` is **NOT** → under D5 every global "New task" QA build (depth 2) becomes git-tracked AND leaks into `INDEX.md` (`build_index.py`'s `_filter_gitignored` keys on `git check-ignore`). This is exactly the throwaway leakage [011 R2](011-*) prevents. **Rewrite the QA-scratch patterns for the nested layout** (e.g. ignore `projects/_drafts/` wholesale and/or `projects/*/workflow_*/`) and re-verify with `git check-ignore` that (a) nested QA scratch IS ignored and (b) real nested projects are NOT. *(Since existing `projects/` are disposable test data — user-confirmed — the current one-off patterns can simply be deleted, not migrated.)*
- **`build_index.py`** scans `projects/` with a **bare `*.yml` glob** ([build_index.py:60](../../tools/dify_base/build_index.py#L60), taken via the `rglob` branch [build_index.py:287](../../tools/dify_base/build_index.py#L287) since `*.yml` has no `/`) rooted at `STATIC_SCAN`'s `projects/`→'project' tag. `rglob` **already recurses arbitrarily deep**, so nested `projects/<project>/<workflow>/workflows/*.yml` are picked up with **no glob change** — only the gitignore round-trip above needs re-verifying.
- **`regen_vscode_settings.py`** keys the mapping on `slug = cfg.parent.name` ([:48](../../scripts/regen_vscode_settings.py#L48)) and emits a single-level per-slug workflow glob `projects/{slug}/workflows/*.{yml,yaml}` ([:96-97](../../scripts/regen_vscode_settings.py#L96)). Under nesting: keep the manifest glob at `projects/*/.dify-workspace.yaml` (D1), re-read the key as the **project**, and emit the schema pattern as `projects/<project>/*/workflows/*.{yml,yaml}`.
- **`.pre-commit-config.yaml`** regexes use `projects/.*/workflows/` — `.*` crosses `/`, so they already match nested paths (verified). No change, but confirm the intent.
- **No change:** `validate_workflow.py`, `lint_refs.py`, `lint_plugin_hashes.py` (path-agnostic — take a file path via argv, verified).

### §5 Frontend

- **`store.ts`** — remove `RunSettings.targetProject` ([store.ts:42](../../apps/builder/web/src/store.ts#L42)), the signal-init default ([:58](../../apps/builder/web/src/store.ts#L58)), the `target_group` POST guard ([:430](../../apps/builder/web/src/store.ts#L430)), and the `resetToNew` clear ([:609](../../apps/builder/web/src/store.ts#L609)). Replace with a `project` (folder) identifier carried on the from-scratch build, and a `workflow_slug`/`project` pair on the wire (§1).
- **`Sidebar.tsx`** — project-"+" ([Sidebar.tsx:84](../../apps/builder/web/src/components/Sidebar.tsx#L84)) now passes the project **folder** (its `project.id` IS the folder under nesting — the value flows, only the meaning changes). Workflow-"+" ([Sidebar.tsx:53](../../apps/builder/web/src/components/Sidebar.tsx#L53)) must carry a **compound `{project, workflow}` key** so edit-existing resolves the right pair (see §Risks — the same workflow name can now exist in multiple projects). The `__drafts__` guard becomes the `_drafts` project (D5).
- **`crumb.ts`** — `newTaskCrumb` ([crumb.ts:31](../../apps/builder/web/src/lib/crumb.ts#L31)) and `runContextCrumb` ([crumb.ts:52,56](../../apps/builder/web/src/lib/crumb.ts#L52)) stop reading `targetGroup`; the crumb's group label is just the project folder (which `runContextCrumb` can now read directly from `task.project`). The spec-029 run-crumb feature stays — it only changes its data source.
- **`types.ts`** — add `workflowSlug`/`project` to `WireTask` and drop `WireTask.targetGroup` ([types.ts:58](../../apps/builder/web/src/types.ts#L58)). (The "group key" comment lives on `TreeProjectNode.id` at [artifacts.ts:103](../../apps/builder/server/lib/artifacts.ts#L103) — flipped by §3, not here; `WireTreeProject.id` at [types.ts:104](../../apps/builder/web/src/types.ts#L104) is uncommented, no edit.)
- **`ui.ts`** — the Reveal-in-Finder route ([ui.ts:129](../../apps/builder/server/routes/ui.ts#L129)) calls `workflowPathFor`; no change here once §1 flips that builder, but re-test the endpoint opens the real 2-level path.

### §6 Retire spec 029 (delete, don't dormant)

Remove, in one dedicated step: `Task.targetGroup` ([task.ts:81](../../apps/builder/server/state/task.ts#L81)), `sanitizeGroup` ([task.ts:237](../../apps/builder/server/state/task.ts#L237)) + its `createTask` call, the `--group` stamp ([scaffold.ts:223](../../apps/builder/server/lib/scaffold.ts#L223) `...(task.targetGroup ? ['--group', task.targetGroup] : [])` + `init_project.py --group`), the `target_group` route field, `RunSettings.targetProject` + the payload guard + the crumb `targetGroup` source, and `project.group` from the template + `parseWorkspaceProject`. **The project-based naming fix (spec 029 follow-up in `scaffold.ts:159-183`) is subsumed** — under nesting the workflow folder lives inside the chosen project, so a generic requirement just yields `projects/<project>/workflow/` (already identifiable); `GENERIC_SLUG`/`titleCaseSlug` in [slug.ts](../../apps/builder/server/lib/slug.ts) stay (still used for the display name and the generic fallback).

**Test files that must be updated in lockstep** (each red-fails otherwise — the spec's earlier draft missed these): delete/rewrite `target-group.test.ts`; drop `targetProject` from `crumb.test.ts` + `store.test.ts` fixtures; `slug.test.ts` ([:40-55](../../apps/builder/test/slug.test.ts#L40)) calls the 2-arg `firstFreeSlug(dir, slug)` → update for the per-project rescope (S6); `edit-existing.test.ts` ([:39,66](../../apps/builder/test/edit-existing.test.ts#L39)), `fast-mode.test.ts` ([:187,205,219](../../apps/builder/test/fast-mode.test.ts#L187)), and `advance-loop.test.ts` ([:182,283](../../apps/builder/test/advance-loop.test.ts#L182)) assert on `task.slug` → migrate to `task.project`/`task.workflowSlug` (D7).

### §7 Dify I/O — `sync.py` ↔ `dify-io.ts` in lockstep

[`dify-io.ts`](../../apps/builder/server/lib/dify-io.ts) shells `sync.py` with `--project` + a `--file` relative to `projects/<slug>/` ([dify-io.ts:14-15](../../apps/builder/server/lib/dify-io.ts#L14)). Under nesting, `pullApp`/`pushApp` pass `--project <project>` + `--workflow <workflowSlug>` (matching §4's `sync.py` interface) and a `--file` relative to the workflow folder. `localEditSeed`/`difySeedScaffoldAndPull` set BOTH `project` + `workflowSlug` before pulling.

**The ④ push caller must change too (no compiler backstop — easy to miss).** [`import.ts`](../../apps/builder/server/lib/import.ts) is the **sole production caller of `pushApp`**: it reads `task.slug!` ([import.ts:31](../../apps/builder/server/lib/import.ts#L31)), passes it as the single `--project` arg ([import.ts:61](../../apps/builder/server/lib/import.ts#L61)), and writes it into the `push_intent` marker ([import.ts:60,86](../../apps/builder/server/lib/import.ts#L60)); [`recovery.ts`](../../apps/builder/server/lib/recovery.ts) persists `PushIntent.slug` ([recovery.ts:24](../../apps/builder/server/lib/recovery.ts#L24)) to `.runs/<taskId>/push_intent.json` and reconciles it at crash-recovery. Because `slug` is a plain `string`, dropping `Task.slug` (D7) here is a SILENT wrong-arg, not a tsc error. `import.ts` must build `project`+`workflowSlug` for `pushApp`/`writePushIntent`, and `PushIntent` must gain both fields.

**Ship §4's `sync.py` change, `dify-io.ts`, and `import.ts`/`recovery.ts` in ONE commit** with an integration/dry-run test asserting the resolved absolute target `== projects/<project>/<workflow>/workflows/<file>` for **both** pull (Analyze/seed) **and** push (④ import).

### §8 Turn injection & skill bodies — the LOAD-BEARING path templates

This is the touchpoint most likely to be missed and the one that silently breaks every Implement if skipped. The phase skill bodies under `.claude/skills/dify-build/*.md` are rendered into the turn prompt at [orchestrator.ts:270-271](../../apps/builder/server/lib/orchestrator.ts#L270) via `renderPrompt` (a `replaceAll` of `phase.injectVars(task)`, [phases.ts:105-108](../../apps/builder/server/lib/phases.ts#L105)). The injected `{{SLUG}}` token ([phases.ts:68,86](../../apps/builder/server/lib/phases.ts#L68) — `SLUG: t.slug`) is **the instruction that tells the turn WHERE to write** its files. The bodies hardcode ~23 **flat** `projects/{{SLUG}}/…` templates: [implement.md:41,56,67-69,76](../../.claude/skills/dify-build/implement.md), [spec.md:47](../../.claude/skills/dify-build/spec.md), [test.md:11,36](../../.claude/skills/dify-build/test.md), `draft.md`, `SKILL.md`.

**Why it breaks:** after §1/§2, the turn is still told to write `projects/<slug>/workflows/main.yml` (or, once D7 removes `t.slug`, `{{SLUG}}` renders empty → `projects//workflows/…`). That path is **outside** the new `projects/${project}/${workflowSlug}/` whitelist, so [`confinementCheck`](../../apps/builder/server/lib/post-turn.ts#L175) **reverts every Implement/Test write**. Also [test.md:36](../../.claude/skills/dify-build/test.md) runs `sync.py push --project {{SLUG}} --file …`, which contradicts §4/§7's new `--project X --workflow Y` interface.

**Change:**
- `injectVars` ([phases.ts:68,86](../../apps/builder/server/lib/phases.ts#L68)) exposes `PROJECT` + `WORKFLOW_SLUG` (or a compound `SLUG = ${project}/${workflowSlug}`), replacing the single flat token.
- Every `projects/{{SLUG}}/…` in the skill bodies is rewritten to the nested form; re-point the [implement.md:56](../../.claude/skills/dify-build/implement.md) `.dify-workspace.yaml` reference **one level up** to the PROJECT dir (D1); update the `sync.py push` invocation ([test.md:36](../../.claude/skills/dify-build/test.md)) to `--project X --workflow Y`.
- **Sequence this INSIDE S4/S7** (before §2's confinement is relied on end-to-end) — NOT in the docs step (S9). Skill bodies are executable instructions, not prose.
- **Definition of Done:** `grep -rn '{{SLUG}}\|projects/{{' .claude/skills/dify-build/` returns 0 flat hits.

---

## §Precedence & edge cases

| Action | Result |
|---|---|
| **New project** (modal) | `projects/<project>/` shell scaffolded (manifest + envs), no workflow yet — **implemented in [spec 031](031-builder-create-project-modal-real.md)** (`POST /api/projects`; the modal was a no-op until then) |
| **Workflow-"+"** on project `my_app`, edit an existing workflow | `project=my_app`, `workflowSlug=<that workflow>`; edits in place, confined to `projects/my_app/<workflow>/` |
| **Workflow-"+"** … but requirement is a *new* from-scratch workflow in `my_app` | new `projects/my_app/<derivedslug>/`; per-project `firstFreeSlug` (D3) |
| **Global "New task"** (no project) | builds in the `_drafts` project (D5): `projects/_drafts/<slug>/` |
| **Slug collision within a project** | per-project suffix (`summarizer`, `summarizer_2` in the SAME project only) |
| **Same workflow name in two projects** | fine — disjoint folders; edit-existing needs the `{project, workflow}` pair (§Risks) |

---

## Sequencing (ship order — each step compiles + tests green; data may be wiped, so no migration)

- **S0 · Decide (this doc's D1–D7).** Do not start code until the manifest+resource split is fixed — it's the fan-in point. *(Defaults resolved above; confirm or flip.)*
- **S1 · Data model.** Add `project` + `workflowSlug` to `Task`, wire fields, and set both atomically in `scaffoldAtSpecGate`. Temporarily default `workflowSlug='main'` so flat paths still resolve mid-refactor. Remove/compute `slug` last.
- **S2 · Confinement tests FIRST, then the whitelist edit** (§2). Sibling-workflow / sibling-project / pre-scaffold reverts must pass. Flip `ConfinementParams` **and** `PostTurnParams` (both drop `slug`, gain the pair) **and their two `orchestrator.ts` callers** ([:404,:466](../../apps/builder/server/lib/orchestrator.ts#L404)) in the SAME step (tsc enforces).
- **S3 · Python scaffolding.** Split `init_project.py` into project+workflow tiers (or add `init_workflow.py`); split the template dir; golden-file the tree. Update `sync.py` (envs project-level, files workflow-level) — with §7.
- **S4 · Backend path builders + turn injection.** Flip every `projects/${slug}/…` → `projects/${project}/${workflowSlug}/…`: `phases.ts` (artifactRel), `artifacts.ts` (`specPathFor`, `readArtifactContents`, **`workflowPathFor`**), `scaffold.ts`, `post-turn.ts` (artifact path :88), `report.ts`, `diff.ts`, `dify-io.ts`. **AND (§8) the load-bearing turn injection:** `phases.ts` `injectVars` exposes `PROJECT`+`WORKFLOW_SLUG`, and every `.claude/skills/dify-build/*.md` `projects/{{SLUG}}/…` template is rewritten to the nested form — this MUST land here (not S9) or the new confinement reverts every Implement.
- **S5 · `buildTree` rewrite** (§3): 2-level walk; delete group bucket + parsing; `_drafts` becomes a real folder.
- **S6 · Retire 029 + fix its tests** (§6): delete `targetGroup`/`sanitizeGroup`/`--group`/`target_group`/`RunSettings.targetProject`/`project.group`; rescope `firstFreeSlug` to per-project; delete/rewrite `target-group.test.ts`; migrate the `task.slug`/2-arg-`firstFreeSlug` asserts in `slug.test.ts`, `edit-existing.test.ts`, `fast-mode.test.ts`, `advance-loop.test.ts` (else the suite red-fails). `import.ts`/`recovery.ts` push-caller changes land with §7's lockstep.
- **S7 · Frontend + Dify I/O lockstep** (§5,§7): compound `{project, workflow}` key for workflow-"+"; crumb data source → `task.project`; wire types; **`sync.py` + `dify-io.ts` + `import.ts` + `recovery.ts` in ONE commit** with the pull+push resolved-target assertion.
- **S8 · Tooling globs + gitignore + pre-commit** (§4): **rewrite `.gitignore` QA-scratch patterns for the nested layout and re-verify with `git check-ignore`** (nested scratch ignored, real projects not); `regen_vscode_settings.py` two-level glob; confirm `build_index.py` `rglob` + pre-commit regexes already match nested (no change) via a round-trip.
- **S9 · Docs last:** `AGENTS.md` (enforced law — do NOT skip), `GUIDE.md`, `README.md`, `architecture.md`, and the path examples/data-model prose in specs 009/010/019/020/026/028/029. `grep -rn 'projects/<slug>\|projects/[^/]*/workflows\|{{SLUG}}'` and fix every hit. *(Existing `projects/` are disposable test data — delete them wholesale; no migration.)*

---

## Acceptance criteria

1. `projects/<project>/<workflow>/workflows/main.yml` is the on-disk layout; the sidebar tree is a direct 2-level read (no `project.group` anywhere).
2. Creating a workflow in project `my_app` from a generic (e.g. Japanese) requirement lands at `projects/my_app/<slug>/` — never a global `workflow_N`.
3. `summarizer` can exist in two different projects simultaneously; a within-project collision suffixes (`summarizer_2`) but a cross-project one does not.
4. **Confinement:** a turn for `projects/my_app/wf_a/` that writes to `projects/my_app/wf_b/…` OR `projects/other/…` has that write **reverted** (tests S2). The legitimate workflow write is not.
5. One `projects/<project>/.dify-workspace.yaml` + `envs/dev.env` serve all workflows in the project; **both** `sync.py pull` (Analyze/seed) **and** `sync.py push` (④ import via `import.ts`) resolve to `projects/<project>/<workflow>/workflows/<file>` with project-level envs.
6. **Turn writes land in-confinement:** `grep -rn '{{SLUG}}\|projects/{{' .claude/skills/dify-build/` returns 0 flat hits; a full Analyze→Test build writes only under `projects/<project>/<workflow>/` (nothing reverted by `confinementCheck`).
7. No `targetGroup`/`--group`/`project.group`/`target_group`/`RunSettings.targetProject` remains (029 fully retired); `target-group.test.ts` gone/rewritten; the `task.slug` asserts in `slug.test.ts`/`edit-existing.test.ts`/`fast-mode.test.ts`/`advance-loop.test.ts` migrated; all suites + typechecks green.
8. QA-scratch builds under `projects/_drafts/` are git-ignored (verified via `git check-ignore`) and absent from `INDEX.md`; real nested projects are NOT ignored.
9. `validate_workflow.py`/`lint_refs.py`/`lint_plugin_hashes.py`, the gate FSM, and the permission-gate hook are unchanged and still pass.
10. `AGENTS.md` + specs' path examples reflect the 2-level layout; `grep` finds no stale flat-`projects/<slug>` path assumption.

---

## Biggest risks (with mitigations)

0. **Skill bodies re-pathed too late (§8) → every Implement reverted.** The 23 flat `projects/{{SLUG}}/…` templates the *turn* executes are the easiest touchpoint to overlook; if they lag §2's confinement tightening, `confinementCheck` reverts every workflow write and builds silently produce nothing. → treat §8 as a first-class S4 edit (NOT S9 docs); DoD = `grep {{SLUG}} .claude/skills == 0` + one full green Analyze→Test build.
1. **Silent confinement regression (security).** A `startsWith` without the trailing slash lets a sibling through, or the pre-scaffold null case breaks. → **Tests before refactor** (S2); keep trailing-slash anchoring; reject prefix-of-sibling matches.
2. **`init_project.py` two-tier split drift.** A wrong resource split (e.g. `workflows/` scaffolded at project level) breaks scaffold + buildTree + sync at once. → decide D1/D2 first; golden-file test the exact tree; iterate freely (data wipeable).
3. **`sync.py` ↔ `dify-io.ts` interface skew.** Pull lands YAML in the wrong folder → the diff base + Analyze input point at nothing. → ship both in one commit (§7) + a resolved-target assertion; keep envs project-level explicitly.
4. **Edit-existing ambiguity.** The same workflow name in multiple projects means a bare name no longer identifies a workflow. → workflow-"+" passes a `{project, workflow}` compound key; `createTask`/`localEditSeed` require both; error clearly on ambiguity.
5. **Docs long-tail scope creep.** `AGENTS.md` + pre-commit globs are project law; stale patterns fail CI or mislead future turns. → docs are part of Definition of Done; grep the repo in the same PR.

---

## Open questions

1. **Workflow display-name source (D6).** `app.name` from `main.yml` vs a per-workflow marker file vs folder-name only. Defaulted to `app.name ?? titleCase(folder)`; a per-workflow `.workflow.yaml` is heavier but survives a broken `main.yml`. Decide in S5.
2. **`_drafts` vs one-level-loose (D5).** A reserved `projects/_drafts/` project vs allowing `projects/<workflow>/` beside project folders. Defaulted to `_drafts` (unambiguous walk). Decide in S0.
3. **Keep or drop `Task.slug` (D7).** Removed vs a computed `${project}/${workflowSlug}` getter to reduce churn. Decide in S1 by counting the remaining `t.slug` read sites after S4.
4. **Per-project vs per-workflow Dify app target (D2/D6).** Envs are shared (D2) but each workflow has its own `DIFY_APP_ID`; confirm the `envs/dev.env` schema holds one shared workspace token + per-workflow app-ids (a `<WORKFLOW>_DIFY_APP_ID` convention) vs a per-workflow env fragment. Decide in S3 with the `sync.py` change.
