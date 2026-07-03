# Spec 029 — New task into an existing project (wire the sidebar "+" so a build lands where you clicked)

**Status**: Draft (r1)
**Effort**: M — one persisted `targetGroup` field threaded createTask → task.json → scaffold; one `--group` arg on the *already-supported* `init_project.py` call (the tool has had `--group` since spec-scaffold; only `scaffoldAtSpecGate` never passed it); one composer `settings.targetProject` selector surfaced through a **dynamic empty-crumb** (the existing header chip on the new-task screen, made to reflect the pre-selection instead of a static "新規タスク"); a **distinct sidebar icon** for the workflow "+" (`I.newFile`) vs the project "+" (`I.plus`); a richer `onNewTask` signature that separates the workflow-"+" (edit-existing) intent from the project-"+" (target-group) intent; a `resetToNew` non-clobber; force-off precedence when a workflow/seed is also set; tests. **No new FSM, no migration, no change to the gate/confinement/validator/scaffold-timing model** — the ②→③ scaffold still runs at the Spec gate, still writes `projects/<slug>/`, and now also stamps `project.group`.

**Depends on**: nothing new. **Builds on** [010](010-*) (F4 slug-collision auto-suffix — orthogonal to group and re-used verbatim), the §Data model tree (`project.group → projects/<slug>/ → .runs task`, [artifacts.ts:205-290](../../apps/builder/server/lib/artifacts.ts#L205-L290)), and [028](028-builder-adaptive-phase-depth.md) (the `fastMode` force-off pattern is the template for the new `targetGroup` force-off). **Relates to** the "base on existing workflow" edit path ([scaffold.ts:104](../../apps/builder/server/lib/scaffold.ts#L104) `localEditSeed`) — this spec is its from-scratch sibling.

## Context — the sidebar "+" is dead-wired

The sidebar is a 3-level tree: **Project (group) ▸ Workflow (`projects/<slug>/`) ▸ Task (`.runs/<id>/`)**. Each Project row and each Workflow row shows a hover "+" button. Both call `onNewTask(...)` with an id:

- Workflow "+" → `onNewTask(wf.id)` ([Sidebar.tsx:51](../../apps/builder/web/src/components/Sidebar.tsx#L51)), title `newTaskInWorkflow` = 「このワークフローに新規タスク」.
- Project "+" → `onNewTask(project.workflows[0]?.id ?? '')` ([Sidebar.tsx:80](../../apps/builder/web/src/components/Sidebar.tsx#L80)), title `newTask` = 「新規タスク」.

But App wires `onNewTask={newTask}` ([App.tsx:207](../../apps/builder/web/src/components/App.tsx#L207)) and `newTask()` **takes no argument** ([App.tsx:164](../../apps/builder/web/src/components/App.tsx#L164)):

```js
function newTask(): void { store.resetToNew(); setArtifactOpen(false); }
```

So the id is silently dropped. Worse, `resetToNew()` then **actively clears** the base selectors ([store.ts:592](../../apps/builder/web/src/store.ts#L592)):

```js
settings.value = { ...settings.value, workflow: 'none', seed: null, fast: false };
```

**Net effect:** clicking "+" on ANY project or workflow opens a blank from-scratch new-task screen with zero indication of where the build will land — identical to the global "New task" at the sidebar footer. This is the reported defect: *"bấm + trên project sẵn có nhưng màn hình add-new không biểu thị gì cho việc gắn với project đó."* The feature was drawn (buttons, titles, an id argument) but never connected.

## The two "+" buttons have two DIFFERENT intents

They must not collapse to one behavior. The tree data model ([artifacts.ts:259-267](../../apps/builder/server/lib/artifacts.ts#L259-L267)) makes the distinction concrete:

| Button | Its id is… | Correct intent | Server mechanism |
|---|---|---|---|
| **Workflow "+"** | `wf.id` = the **slug** (`projects/<slug>/`) | New task that **edits this one workflow** | `settings.workflow = wf.id` → `localEditSeed` (edit-existing). Init is **skipped**; the workflow's existing `project.group` is untouched → the task stays under the same project. |
| **Project "+"** | `project.id` = the **group key** | New from-scratch workflow that **lands in this project's group** | `settings.targetProject = project.id` → scaffold passes `--group <group>` to `init_project.py` → the new `projects/<newslug>/.dify-workspace.yaml` gets `project.group: <group>` → `buildTree` buckets it under that project. |

The key insight: `buildTree` groups workflows purely by `wp.group` ([artifacts.ts:264](../../apps/builder/server/lib/artifacts.ts#L264)). Group is **independent of slug**. So "add a new workflow to project my_app" = "give the new slug `project.group: my_app`", regardless of what slug Spec derives. The mechanism to write that already exists — `init_project.py --group` ([init_project.py:181-182](../../tools/dify_base/init_project.py#L181-L182)) — it is simply never called with it. The comment at [scaffold.ts:200](../../apps/builder/server/lib/scaffold.ts#L200) (`No --group (the tool has none)`) is **stale and wrong**; correcting it is part of this spec.

## Goals

1. **Workflow "+" pre-selects that workflow, with a distinct icon.** Clicking it opens the new-task composer with the "base on existing workflow" dropdown (`settings.workflow`) set to `wf.id`; the build edits that workflow (the existing edit-existing path). The sidebar button uses `I.newFile` (a "new task on this file/workflow" glyph) — **visually distinct from the project "+"** (`I.plus`) so the two intents are told apart at a glance.
2. **Project "+" targets that project's group.** Clicking it opens a **from-scratch** new-task composer (workflow = none) with a new `settings.targetProject = project.id`; the button keeps `I.plus` ("add into this project"). On build, the derived new `projects/<slug>/` is stamped `project.group: <that group>`, so the freshly-built workflow appears **under the project you clicked** in the sidebar — even though it bases on no existing workflow.
3. **The empty-crumb reflects the pre-selection (the visible, clearable indicator).** The new-task screen already renders a header chip — the **empty-crumb** ([App.tsx:385](../../apps/builder/web/src/components/App.tsx#L385)), today a static `<I.folder /> 新規タスク`. Make it dynamic: it shows the target project («my_app 内に新規タスク») or the workflow being edited («chatbot を編集») with the matching icon, and clicking it clears back to a plain new task. This is the primary fix for the reported defect (silent state → a labelled breadcrumb) and replaces the earlier pills-row-chip idea (one indicator, in the most prominent spot). The chat-top crumb ([App.tsx:220](../../apps/builder/web/src/components/App.tsx#L220)) shares the same label helper so the two stay in sync.
4. **`resetToNew` no longer clobbers the pre-selection.** A "+"-launched new task keeps its `workflow`/`targetProject`; the manual footer "New task" still resets to a clean from-scratch slate.
5. **Fail-safe precedence.** `targetProject` is honored **only on a from-scratch build** (no workflow, no seed). If a workflow or Dify seed is also chosen, `targetProject` is force-off'd server-side (the edited/seeded workflow's own group wins — init is skipped). Mirrors the [028](028-builder-adaptive-phase-depth.md) `fastMode` force-off exactly.

## Non-goals (the leanness boundary)

- **No new "create empty project / rename group" UI.** This spec only *targets an existing group at build time*. Renaming a project, moving a workflow between projects, or creating a group with no workflows are out of scope.
- **No change to slug derivation or the F4 collision suffix.** Spec still derives the slug from the requirement; F4 ([scaffold.ts:161-174](../../apps/builder/server/lib/scaffold.ts#L161-L174)) still auto-suffixes a colliding slug. Group is orthogonal: a new workflow whose derived slug collides gets `<slug>_N` **and** still lands in the target group. Worked example: project `my_app` (workflows `a`), click "+", requirement "summarize PDFs" → Spec derives slug `summarizer` → `projects/summarizer/` with `group: my_app` → appears under `my_app`. If instead Spec derived `my_app` (collision) → `my_app_2` slug, `group: my_app` → still under `my_app`.
- **No change to the gate FSM, confinement whitelist, validators, or scaffold timing.** `--group` is one extra arg on the existing `init_project.py` spawn; everything downstream is byte-identical.
- **No group on edit-existing / Dify-seed builds.** Those skip `init_project.py` (the dir already exists) — there is nothing to stamp, and the existing `.dify-workspace.yaml` group is authoritative. `targetProject` is ignored there (Goal 5).
- **Project "+" does NOT pre-pick a workflow to edit.** A project can hold many workflows; picking one to edit is arbitrary. Project "+" is always a from-scratch *add*, never an edit. (Editing is reachable via the specific Workflow "+".)

## Design

### §1 Frontend — separate the two intents, carry `targetProject`, show it

**`onNewTask` signature (App/Sidebar).** Widen from `(slug: string)` to an intent object so the two buttons can't be confused:

```ts
type NewTaskOpts = { baseWorkflow?: string; targetProject?: string };
onNewTask: (opts?: NewTaskOpts) => void;
```

- Workflow "+" ([Sidebar.tsx:51](../../apps/builder/web/src/components/Sidebar.tsx#L51)) → `onNewTask({ baseWorkflow: wf.id })`; swap the glyph `<I.plus />` → `<I.newFile />` so it reads as "new task on this workflow", distinct from the project "+".
- Project "+" ([Sidebar.tsx:80](../../apps/builder/web/src/components/Sidebar.tsx#L80)) → `onNewTask({ targetProject: project.id })`; keeps `<I.plus />` ("add into this project"). **Guard**: pass `targetProject` only when `project.id !== '__drafts__'` (the synthetic Drafts group is not a real target — clicking its "+", if reachable, degrades to a plain new task).
- Footer "New task" ([Sidebar.tsx:169](../../apps/builder/web/src/components/Sidebar.tsx#L169)) → `onNewTask()` (no opts → clean slate); keeps `<I.plus />`.

`I.newFile` already exists in [Icon.tsx](../../apps/builder/web/src/components/Icon.tsx) (used by the composer today) — no new asset. Distinct `title=` tooltips stay as-is (`newTaskInWorkflow` vs `newTask`).

**`newTask` (App.tsx:164)** applies the opts after reset:

```js
function newTask(opts?: NewTaskOpts): void {
  store.resetToNew();
  if (opts?.baseWorkflow) store.settings.value = { ...store.settings.value, workflow: opts.baseWorkflow };
  if (opts?.targetProject) store.settings.value = { ...store.settings.value, targetProject: opts.targetProject };
  setArtifactOpen(false);
}
```

Order matters: `resetToNew()` first (clears prior state), then set from opts.

**`Settings` type ([types.ts:128](../../apps/builder/web/src/types.ts#L128)) + store signal ([store.ts:57](../../apps/builder/web/src/store.ts#L57))** gain `targetProject: string | null` (default `null`).

**`resetToNew` ([store.ts:592](../../apps/builder/web/src/store.ts#L592))** must also reset `targetProject` to `null` in its clear line (a stale target must not survive a manual "New task") — the non-clobber for the "+" path is achieved by `newTask` re-applying opts *after* `resetToNew`, exactly as above, NOT by making `resetToNew` conditional.

**Payload ([store.ts:416-427](../../apps/builder/web/src/store.ts#L416-L427))** — send `target_group` only on the from-scratch path, mirroring the `fast_mode` guard one line above:

```js
...(s.targetProject && (!s.workflow || s.workflow === 'none') && !s.seed ? { target_group: s.targetProject } : {}),
```

**Indicator — the dynamic empty-crumb (App.tsx EmptyState + chat-top).** Replace the static crumb ([App.tsx:385-388](../../apps/builder/web/src/components/App.tsx#L385-L388)) with a small helper that derives `{ icon, label }` from settings + the tree (for a friendly display name; fall back to the raw id/slug):

```ts
function newTaskCrumb(settings, tree): { icon: 'newFile' | 'folder'; label: string } {
  if (settings.workflow && settings.workflow !== 'none')
    return { icon: 'newFile', label: tf('editingWorkflow', { name: wfName(tree, settings.workflow) }) };  // 「chatbot を編集」
  if (settings.targetProject)
    return { icon: 'folder', label: tf('newTaskInProjectName', { name: settings.targetProject }) };        // 「my_app 内に新規タスク」
  return { icon: 'folder', label: tr('newTask') };                                                          // 「新規タスク」 (today)
}
```

- The EmptyState crumb becomes clickable: when a pre-selection is active, clicking it calls `onSettings({ workflow: 'none', targetProject: null })` → clears back to a plain new task (the crumb IS the "×"). When nothing is selected it is inert (as today).
- The chat-top crumb ([App.tsx:220](../../apps/builder/web/src/components/App.tsx#L220)) uses the same `label` so the header and the crumb never disagree.
- `wfName(tree, slug)` looks up the workflow's display name in the tree; `targetProject` is already a group **name** (`TreeProjectNode.id === name`, [artifacts.ts:264](../../apps/builder/server/lib/artifacts.ts#L264)), so it is shown directly.

No pills-row chip is added — the crumb is the single, prominent indicator, which is where the user expected the feedback.

### §2 Server — accept, persist, force-off `targetGroup`

**`CreateTaskInput` ([task.ts:112](../../apps/builder/server/state/task.ts#L112))** gains:

```ts
/** spec 029: existing project group to stamp on a from-scratch build (project "+" in the sidebar).
 *  Force-off in createTask when a seed/workflow is set (the edited/seeded workflow's group wins). */
targetGroup?: string | null;
```

**`Task` state ([task.ts](../../apps/builder/server/state/task.ts))** gains `targetGroup: string | null` (persisted in task.json; read by the scaffold).

**`createTask` ([task.ts:240-261](../../apps/builder/server/state/task.ts#L240-L261))** — normalize + force-off, next to the existing `fastMode` force-off:

```ts
const targetGroup = input.targetGroup && input.targetGroup.trim() && !workflow && !seedAppId
  ? sanitizeGroup(input.targetGroup.trim())
  : null;
```

Note the force-off condition is `!workflow && !seedAppId` (a from-scratch build). A user-supplied `slug` does **not** force it off (unlike fastMode): a slug names the new dir, a group names its bucket — they compose fine.

**`sanitizeGroup`** — group is written into YAML as a scalar `project.group: <value>` and substituted by `init_project.py`. It is **not** a path (slug is the dir). Minimal, robust rule: **validate against the existing groups** rather than free-form sanitize. `createTask` (or the route) reads `buildTree(projectsDir)` groups and accepts `targetGroup` only if it matches an existing `TreeProjectNode.id` (excluding `__drafts__`); otherwise drop to `null`. This simultaneously (a) blocks YAML-breaking/injection input, and (b) handles the "project deleted between click and build" race benignly (unknown group → ungrouped from-scratch build, no crash). *(Alternative if the tree read is unwanted at this seam: a charset sanitize stripping newlines/`:`/quotes and capping length — but validate-against-existing is preferred because it also fixes the race. Decide in Sequencing S2.)*

**Route ([tasks.ts:144-159](../../apps/builder/server/routes/tasks.ts#L144-L159))** — read the wire param into the input:

```ts
targetGroup: (body.target_group as string | null | undefined) ?? null,
```

### §3 Scaffold — pass `--group`, fix the stale comment

**`scaffoldAtSpecGate` ([scaffold.ts:193-204](../../apps/builder/server/lib/scaffold.ts#L193-L204))** — on the init spawn (the from-scratch, dir-does-not-exist branch), append `--group` when `task.targetGroup` is set:

```ts
const r = await runPython(projectsDir, [
  'tools/dify_base/init_project.py', '--non-interactive',
  '--name', task.name ?? slug,
  '--slug', slug,
  '--app-type', 'workflow',
  '--primary-lang', 'en',
  ...(task.targetGroup ? ['--group', task.targetGroup] : []),  // spec 029
]);
```

Correct the stale comment at [scaffold.ts:200](../../apps/builder/server/lib/scaffold.ts#L200): `init_project.py` **does** support `--group` (has since it gained `project.group` substitution) — the previous "the tool has none" is wrong.

**Why this branch only:** the `--group` stamp belongs exclusively to the genuine-new path. Edit-existing (`localEditSeed`) and Dify-seed (`difySeedScaffoldAndPull`) resolve their slug to an existing `projects/<slug>/` whose init is skipped ([scaffold.ts:193](../../apps/builder/server/lib/scaffold.ts#L193) `if (!existsSync(projectDirAbs))`), so there is no init call to stamp and the existing group is authoritative. `targetGroup` is already `null` on those paths (§2 force-off), so this is defense-in-depth, not the sole guard.

### §4 Precedence & interaction (single source of truth)

| Composer state | `workflow` | `seed` | `targetProject` | Result |
|---|---|---|---|---|
| Project "+" (from-scratch) | none | null | `my_app` | scaffold `--group my_app` → new workflow under `my_app` |
| Workflow "+" (edit) | `<slug>` | null | (force-off'd) | `localEditSeed` edits `<slug>`; group untouched |
| Footer "New task" | none | null | null | ungrouped from-scratch (today's behavior) |
| Project "+", then user picks a workflow | `<slug>` | null | (force-off'd) | edit wins; target ignored |
| Project "+", then user picks a Dify seed | none | `<appId>` | (force-off'd) | seed wins; target ignored |

The force-off is **server-authoritative** (`createTask`); the frontend payload guard (§1) merely keeps the wire honest. Both must agree on the condition `from-scratch = no workflow && no seed`.

### §5 Data-model & edge cases

- **Ungrouped target.** An ungrouped project's tree node id = its slug ([artifacts.ts:220](../../apps/builder/server/lib/artifacts.ts#L220), group defaults to slug). Clicking its "+" passes `targetGroup = <that slug>`. The new build stamps `project.group: <slug>`; the OLD project's `.dify-workspace.yaml` still defaults its group to the same slug, so `buildTree` buckets both together. Correct grouping with no change to the old file.
- **F4 collision** (§Non-goals) — orthogonal, re-used verbatim.
- **Race: project deleted after click** — validate-against-existing (§2) drops the unknown group → benign ungrouped build.
- **`__drafts__`** — never a valid target (§1 guard).
- **Workflow "+" inherits the dropdown's `main.yml` assumption (pre-existing, NOT introduced here).** Setting `settings.workflow = <slug>` sends only the slug; `start()` does not send `workflowFile`, so `createTask` defaults it to `main.yml` ([task.ts](../../apps/builder/server/state/task.ts)) and `localEditSeed` seeds from `projects/<slug>/workflows/main.yml`. For a Builder-built project (which always scaffolds `main.yml`) this edits the real workflow — the common, intended case. For a project whose canonical file is **not** `main.yml` (e.g. a Dify-pulled `workflows/<app-slug>.yml`), `localEditSeed` finds no `main.yml` and takes its existing warn-fallback — *"build into the existing project with an empty seed"* ([scaffold.ts:112-118](../../apps/builder/server/lib/scaffold.ts#L112-L118)): the new task still lands under the right project, but does **not** literally seed-edit the old YAML, so the crumb's 「…を編集」 label is optimistic there. This is a **pre-existing property of the "base on existing workflow" dropdown** (029 only pre-selects it) — out of scope to fix here. If it matters, a follow-up would resolve the true canonical file per slug (tree carries the slug, not the filename) and thread it as `workflowFile`; tracked as Open question 5.

## Sequencing (ship order — each step compiles + tests green)

- **S1 (frontend, inert):** add `targetProject` to `Settings`/signal/`resetToNew` clear; widen `onNewTask`/`newTask`; wire the two sidebar buttons + footer; swap the workflow-"+" glyph to `I.newFile`. No payload field yet → behavior-equivalent to today except the workflow "+" now pre-selects the dropdown (immediately useful, low-risk). Web store test: `newTask({baseWorkflow})` sets `settings.workflow`; `newTask({targetProject})` sets `settings.targetProject`; footer `newTask()` clears both.
- **S2 (server plumbing):** `CreateTaskInput.targetGroup` + `Task.targetGroup` + `createTask` normalize/force-off + `sanitizeGroup`/validate-against-existing + route `target_group`. Unit tests: force-off when workflow/seed set; validate rejects unknown group; persists on from-scratch.
- **S3 (payload):** add the `target_group` guard to `store.start`. Now the field reaches the server.
- **S4 (scaffold):** `--group` arg + comment fix. Unit test (fake `runPython` — the 013-D2 injection seam already used by scaffold tests): a from-scratch task with `targetGroup='my_app'` spawns `init_project.py … --group my_app`; a task with `targetGroup=null` omits it; an edit-existing task never reaches the init spawn.
- **S5 (indicator + i18n):** the dynamic `newTaskCrumb` helper wired into the EmptyState crumb (clickable-to-clear) + chat-top crumb; `editingWorkflow` + `newTaskInProjectName` labels (EN + JA). Web test: crumb label/icon switches with `settings.workflow` / `settings.targetProject`; clicking it clears the pre-selection.
- **S6 (integration):** one server test through `POST /api/tasks` with `target_group` → task.json has `targetGroup`; and (if a scaffold-through harness exists) a `buildTree` assertion that the stamped workflow buckets under the target group.

## Acceptance criteria

1. The two sidebar buttons use **distinct icons** — workflow "+" = `I.newFile`, project "+" / footer = `I.plus` — so they are told apart at a glance.
2. Workflow "+" opens the composer with `settings.workflow` = the clicked slug and the **empty-crumb reading 「<name> を編集」** with the `newFile` icon; building edits that workflow (lands under the same project). Clicking the crumb clears back to a plain new task.
3. Project "+" opens a **from-scratch** composer (ワークフロー = none) with the **empty-crumb reading 「<name> 内に新規タスク」** (folder icon); clicking the crumb clears `targetProject`. The chat-top crumb shows the same label.
4. Building from a project-"+" composer produces `projects/<derivedslug>/.dify-workspace.yaml` with `project.group: <clicked group>`, and the new workflow appears **under that project** in the sidebar on the next tree refresh.
5. A user-supplied slug composes with the target group (slug names the dir, group buckets it). A chosen workflow or Dify seed **overrides** the target group (force-off, server-authoritative) — the crumb then reflects the workflow-edit label, not the project one.
6. Footer "New task" still resets to a clean ungrouped from-scratch slate (`workflow=none`, `targetProject=null`), crumb back to 「新規タスク」.
7. A malformed/unknown target group never breaks the build — **no crash**. *(As shipped: `sanitizeGroup` charset-cleans to a YAML-safe scalar rather than validating against existing groups (OQ2 decision), so a group that no longer matches any existing one is passed through and `buildTree` manufactures a fresh single-member bucket for it — it does **not** literally drop to "ungrouped". The load-bearing guarantee is "no crash / no YAML break", which holds; blank-after-sanitize ⇒ null = ungrouped.)*
8. The stale [scaffold.ts:200](../../apps/builder/server/lib/scaffold.ts#L200) comment is corrected; `init_project.py --group` is exercised by a unit test.

## Open questions

1. ~~Chip vs. header.~~ **Resolved (user):** the indicator is the **dynamic empty-crumb** — the existing header chip on the new-task screen, made to reflect the pre-selection and clickable-to-clear. No separate pills-row chip.
2. ~~**Group validation seam.**~~ **Resolved (implemented):** chose **charset-sanitize** (`sanitizeGroup` in `createTask`) over validate-against-existing — it avoids a new `buildTree` import (and near-circular dep: `artifacts.ts` imports `Task` from `task.ts`) at the create seam, and needs no `nowMs`. Trade-off: it does *not* drop an unknown/deleted group to "ungrouped"; that group becomes its own bucket (still no crash — see AC7). Acceptable given a group value normally round-trips an existing tree-node id; the deleted-between-click-and-build race is benign, not corrupting.
3. ~~**Crumb icon set.**~~ **Resolved (implemented):** the spec's `I.newFile` for the workflow-"+" button/crumb was **rejected** — `I.newFile` is already the sidebar **New-project** button's glyph ([Sidebar.tsx](../../apps/builder/web/src/components/Sidebar.tsx) header), so reusing it would collide. Shipped `I.message` for the workflow-"+" button and the workflow-edit crumb (a "new build/chat on this workflow"), keeping `I.plus` for project-"+"/footer and `I.folder` for the project/plain crumb — three distinct glyphs (still satisfies AC1). No new asset. Visual legibility of `message` as an "add" affordance is a manual-QA item.
4. **Should Workflow "+" ALSO be reachable when the workflow is mid-build?** Out of scope here — the "+" is a compose-time affordance; the turn-lock (Lát 6) governs whether the resulting build can start. No change.
5. **Resolve the true canonical workflow file per slug (deferred).** The workflow "+" (and today's dropdown) assume `main.yml` (§5 caveat). A project whose file is a Dify-pulled `<app-slug>.yml` therefore edits an empty seed, not the real YAML, and the 「…を編集」 crumb over-promises. A follow-up could enumerate `projects/<slug>/workflows/*.yml`, carry the filename on `TreeWorkflowNode`, and pass it as `workflowFile` so edit-existing seeds the actual file. Out of scope for 029 (it fixes a pre-existing dropdown limitation, not the "+" wiring).
