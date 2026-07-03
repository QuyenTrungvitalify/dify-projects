# Spec 031 — Make the "Create Project" modal real (name → an empty project folder that shows in the sidebar; retire the mock folder-linker)

**Status**: Implemented (r2 — shipped 2026-07-03). OQ2 → **extracted** (`scaffoldProjectTier` shared by the route + `ensureScaffold`); OQ3 → **Skip kept**. Route tested via Fastify `inject` with the `runPython` seam; modal behaviors covered indirectly by the `slug`/`store.createProject` pure-unit tests (repo has no component-render harness).
**Effort**: S–M (small-medium). One new server route (`POST /api/projects`) that shells the **already-present** `init_project.py --kind project` (the exact call [`ensureScaffold`](../../apps/builder/server/lib/scaffold.ts#L30) already makes at the Spec gate); one web API method; a modal rewrite that **deletes** the `FOLDER_POOL` mock and turns `onCreate` from a no-op into a real create; a tree refresh. No FSM change, no scaffold-timing change, no data-model change — `Task.project` ([task.ts:57](../../apps/builder/server/state/task.ts#L57)) and `settings.targetProject` (already in the store) are reused verbatim.

**Builds on** [030](030-builder-nested-project-workflow-folders.md) — the nested `projects/<project>/<workflow>/` layout is **already implemented** ([`buildTree`](../../apps/builder/server/lib/artifacts.ts#L240) is a real 2-level walk; [`ensureScaffold`](../../apps/builder/server/lib/scaffold.ts#L26) creates a project tier then a workflow tier). Spec 030's precedence table promised a row — *"New project (existing modal) → `projects/<project>/` shell scaffolded (manifest + envs), no workflow yet"* ([030 §Precedence](030-builder-nested-project-workflow-folders.md)) — that was **never wired**. 031 is exactly that unfinished row. **Relates to** [029](029-builder-new-task-into-existing-project.md) (the sidebar project-"+" → `targetProject` path, reused as the post-create landing).

**No change to**: the gate FSM, the phase ladder, the PreToolUse permission-gate hook, `confinementCheck` (project creation is a direct server route, not a build turn), or any Python except being *called* with existing flags.

---

## Context — the modal is a dead-end that lies about what a "project" is

The "Create Project" modal ([`CreateProjectModal`](../../apps/builder/web/src/components/Modal.tsx#L22)) renders three things: a **name** field, a **folder list** with a フォルダを追加 ("Add folder") button, and Create/Skip. Two independent defects:

**1. Typing a name does nothing.** `onCreate` is wired as a no-op ([App.tsx ~355](../../apps/builder/web/src/components/App.tsx#L355)):

```tsx
<CreateProjectModal
  onClose={() => setCreateOpen(false)}
  onCreate={() => { setCreateOpen(false); newTask(); }}   // ← discards {name, folders} entirely
/>
```

`onCreate` ignores the `{name, folders}` payload the modal collects ([Modal.tsx:36-38](../../apps/builder/web/src/components/Modal.tsx#L36)) and just calls `newTask()` **with no opts** ([App.tsx:178](../../apps/builder/web/src/components/App.tsx#L178)) → a blank from-scratch composer, `targetProject: null`. No `projects/<slug>/` folder is created, nothing appears in the sidebar. The typed name is thrown away. **The modal is indistinguishable from the footer "New task".**

**2. "Add folder" is a pure cosmetic mock.** It is **not** a native folder picker (no `webkitdirectory`, no `showDirectoryPicker`, no server dialog). It appends a fabricated row from a hardcoded pool ([Modal.tsx:13-33](../../apps/builder/web/src/components/Modal.tsx#L13)):

```ts
const FOLDER_POOL = ['grammar_check', 'jp_normalize', 'rubric_v2', 'export_csv', 'seed_loader', 'judge_prompts'];
function addFolder() {
  const next = FOLDER_POOL[folders.length % FOLDER_POOL.length];
  const path = '~/code/' + (name.trim() ? slug(name) : 'workspace') + '/' + next;
  setFolders((f) => [...f, { id: 'f' + Date.now() + f.length, name: next, path }]);
}
```

So the folders in the screenshot (`~/code/workspace/grammar_check`, `…/jp_normalize`) are **not linked from anywhere** — they are `FOLDER_POOL[0]` and `[1]`, materialized because the user clicked "Add folder" twice. This is the reported confusion: *"nhấn add folder, không rõ các folder kia được add từ đâu"* — because they come from nowhere real.

**Why the folder-linker doesn't fit the model at all.** Under spec 030 a **project is one repo folder** (`projects/<project>/`) that **contains workflow subfolders**; it is not a bag of linked OS directories. There is no OS path to link and no field on disk to store one. The mock models a concept the data model deleted. Keeping it — even upgraded to a *real* OS picker — would reintroduce the "flat folders you link" mental model 030 spent its whole budget removing, and cross-project references are an explicit 030 non-goal.

**What the user actually wants** (both asks): the ordinary "make a folder, then use it" flow — type a name → a real, empty project folder is created → it appears in the sidebar immediately → you add workflows into it. That is achievable with almost no new machinery, because [`buildTree`](../../apps/builder/server/lib/artifacts.ts#L289) already surfaces an **empty** project: [`getProject()` is called for every folder under `projects/` at :300](../../apps/builder/server/lib/artifacts.ts#L300) *before* the workflow loop, so a project with `workflows: []` still becomes a `TreeProjectNode` and [sorts into the tree at :341-348](../../apps/builder/server/lib/artifacts.ts#L341). The only missing pieces are (a) a route that scaffolds the project tier on demand, and (b) a modal that calls it.

---

## Design decisions (recommended defaults — adjustable before implement)

- **D1 · Delete the folder-linker; the modal creates ONE empty project by name.** Remove `FOLDER_POOL`, `addFolder`/`removeFolder`, the `folders` state, the folder-list UI, and the `foldersLinked`/`selectFolders`/`addFolder` i18n keys ([Modal.tsx:13-75](../../apps/builder/web/src/components/Modal.tsx#L13)). The modal keeps only the **name** field + Create/Skip. *Rationale:* a project is a single folder (030); selecting an **existing** project to work in is already the sidebar's job (each project row has a "+", spec 029). A create-dialog that also "picks existing folders" is conceptually confused. **Alternative considered and rejected** (the user's floated idea — "open the `projects/` folder to pick an existing project"): redundant with the sidebar, and an OS-native picker can't return a repo-relative project id anyway. *(If, later, "import an arbitrary on-disk Dify export as a project" is wanted, that is a distinct seed/import feature, not this modal — track separately.)*
- **D2 · The project name is English-only; the folder slug is that name normalized, shown live.** The name field accepts folder-safe input only — `[A-Za-z0-9]` plus spaces / `_` / `-` — and the folder slug is the name lowercased with spaces→`_` (reuse [`sanitizeSlug`](../../apps/builder/server/state/task.ts#L209)). The derived slug is rendered read-only beneath the input (`フォルダ: eiken_grammar`) so the only transforms (case, space→`_`) are visible — the "you see the folder name as you type" affordance of a normal create-folder dialog. *Rationale:* the name **is** the identity and the folder — no display-name/slug split, no generic `project_N`, no transliteration; the sidebar shows the entered name directly.
- **D3 · Non-English input is REJECTED on submit with a red inline error that teaches the fix — never silently coerced (user decision, 2026-07-03).** The placeholder states the constraint up front (English-only, with English examples — see §3/i18n); a name containing Japanese or other non-allowed characters fails validation on Create with a **red message that says plainly what to do**: 「プロジェクト名は英数字のみ（例: eiken_grammar）」("use English letters and numbers only"). **Both** the client (instant, before the request) **and** the server (`400`, authoritative) enforce the identical rule. *Rationale:* the corpus is Japanese so this guard fires often — forcing correct input at entry, with guidance, beats deriving an ugly `project_N` behind the user's back. **Accepted trade-off:** a project cannot be *named* in Japanese (the user types `eiken`, not `英検`); the sidebar then shows the English name.
- **D4 · Duplicate name → red inline error too (same treatment as D3).** A **named project is an identity** the user chose; never silently suffix (unlike an auto-derived *workflow* slug, which does via [`firstFreeSlug`](../../apps/builder/server/lib/slug.ts#L46)). If `projects/<slug>/` already exists, Create fails with a red message 「「<name>」は既にあります」 plus an **[開く]** action to jump to the existing project (set `targetProject` + close). Server returns `409 { error, existing }`; the modal renders it with the **same red-error affordance** as the D3 validation failure so the two failures feel consistent. *Rationale:* matches how Finder/Explorer refuse a duplicate folder name rather than inventing `foo (2)`; avoids two indistinguishable projects.
- **D5 · After a successful create, pre-select the new project and open the composer.** Set `settings.targetProject = <newslug>`, refresh the tree, close the modal, and land on the new-task composer with the 029 crumb reading 「<name> 内に新規タスク」. *Rationale:* "create → immediately usable" is the whole ask; the first workflow the user builds lands **inside** the new project (029's `targetProject` → `createTask({project})` path, already wired).

---

## Goals

1. **The modal creates a real, empty project.** Type an English name `Eiken Grammar` → `POST /api/projects` → `projects/eiken_grammar/` with `.dify-workspace.yaml` (name + endpoints) + `envs/`, **no workflow yet**. A non-English name is refused with guidance (D3), not silently mangled.
2. **It appears in the sidebar immediately.** After create, `loadTree()` refetches and the new (empty) project row renders — no reload, no build required.
3. **It is usable right away.** The composer opens pre-targeted at the new project; the first from-scratch build lands at `projects/<newslug>/<workflow>/` (reusing 029's `targetProject`).
4. **The folder-linker fiction is gone.** No `FOLDER_POOL`, no fabricated `~/code/…` rows, no dangling "linked N folders" hint.
5. **Duplicate names fail loudly, not silently.** A repeat name returns 409 and offers to open the existing project.

## Non-goals (the leanness boundary)

- **No OS-native folder picker / import of arbitrary on-disk directories.** A project is a repo folder scaffolded by the tool, not a link to somewhere on the user's disk (D1). Importing an external Dify export is a separate seed feature.
- **No project rename / delete / move UI.** Create-only. (Rename/delete are their own spec if wanted.)
- **No workflow created at project-create time.** The modal makes the *project shell*; workflows are added afterward via the composer/"+" (matches 030's precedence row).
- **No change to scaffold timing for workflows.** The workflow tier still scaffolds at the Spec gate ([`ensureScaffold`](../../apps/builder/server/lib/scaffold.ts#L42)); this spec only pulls the **project tier** earlier, to modal-time, for a project the user explicitly names.
- **No change to `confinementCheck`, the gate FSM, or validators.** Project creation is a direct route outside any build turn.

## Design

### §1 Server — `POST /api/projects`

New route in [`routes/ui.ts`](../../apps/builder/server/routes/ui.ts) (sibling to `GET /api/tree` at [:39](../../apps/builder/server/routes/ui.ts#L39)), or a small `routes/projects.ts` if preferred:

```ts
// POST /api/projects — scaffold an empty project tier (projects/<slug>/ manifest + envs, no workflow).
app.post('/api/projects', async (req, reply) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = String(body.name ?? '').trim();
  if (!name) return reply.code(400).send({ error: 'name_required' });
  // D3 — English/folder-safe only; reject (don't coerce) so the modal shows a red, teaching error.
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(name)) return reply.code(400).send({ error: 'name_charset' });

  const slug = sanitizeSlug(name);                                                  // D2 — normalize (lowercase, space→_)
  if (slug === DRAFTS_PROJECT) return reply.code(400).send({ error: 'reserved name' });   // guard `_drafts` (also fails the regex)

  const projectDirAbs = join(projectsDir, 'projects', slug);
  if (existsSync(projectDirAbs)) return reply.code(409).send({ error: 'project exists', existing: slug });   // D4

  const r = await runPython(projectsDir, [
    'tools/dify_base/init_project.py', '--non-interactive', '--kind', 'project',
    '--name', name, '--slug', slug, '--primary-lang', 'en',
  ]);
  if (r.code !== 0) return reply.code(500).send({ error: `scaffold failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}` });

  return reply.send({ project: slug, name });
});
```

- **This is the exact project-tier call [`ensureScaffold`](../../apps/builder/server/lib/scaffold.ts#L30) already makes** — same script, same `--kind project` flag, same manifest+envs output. No new Python. (Fold the shared spawn into one helper if churn is a concern; not required.)
- **Reserved-name guard:** reject `_drafts` (the [`DRAFTS_PROJECT`](../../apps/builder/server/state/task.ts#L226) sentinel) so the modal can't manufacture the drafts bucket.
- **Idempotency / race:** a create that loses to a concurrent one (or to a Spec-gate `ensureScaffold` that made the same folder) returns 409, which the modal treats as "open existing" (D4) — benign.
- **No confinement interaction:** this route writes `projects/<slug>/…` directly and is not a build turn; `confinementCheck` (which only guards turn-touched paths, [post-turn.ts:175](../../apps/builder/server/lib/post-turn.ts#L175)) is not in this path.

### §2 Web API + store

- **`api.ts`** — add next to `tree` ([api.ts:101](../../apps/builder/web/src/api.ts#L101)):
  ```ts
  createProject: (name: string, slug?: string): Promise<{ project: string; name: string }> =>
    request('POST', '/api/projects', { name, ...(slug ? { slug } : {}) }),
  ```
- **`store.ts`** — a thin action that creates, refreshes the tree, and pre-targets (D5):
  ```ts
  export async function createProject(name: string): Promise<{ project: string } | { error: string; existing?: string }> {
    try {
      const r = await api.createProject(name);
      await loadTree();                                             // empty project now visible
      settings.value = { ...settings.value, targetProject: r.project, workflow: 'none', seed: null };  // land inside it (029)
      return { project: r.project };
    } catch (e) { return surfaceCreateError(e); }                  // maps 409 → { error, existing }
  }
  ```
  Reuse the existing [`loadTree`](../../apps/builder/web/src/store.ts#L384) and the `targetProject` signal that 029/030 already carry — no new store field.

### §3 Frontend — the modal rewrite

In [`Modal.tsx`](../../apps/builder/web/src/components/Modal.tsx):

- **Delete** `FOLDER_POOL` ([:13-16](../../apps/builder/web/src/components/Modal.tsx#L13)), `addFolder`/`removeFolder` ([:29-34](../../apps/builder/web/src/components/Modal.tsx#L29)), the `folders` state, the `FolderEntry` import, the whole folder-list block + add-folder button ([:59-75](../../apps/builder/web/src/components/Modal.tsx#L59)), and the `foldersLinked` footer hint ([:78-80](../../apps/builder/web/src/components/Modal.tsx#L78)).
- **Keep** the name input; **English-only placeholder** (D3) that states the rule with English examples (i18n below); add a **live folder-slug preview** (D2) under it — `sanitizeSlug(name)` shown read-only (`フォルダ: eiken_grammar`), only for valid input. `slug()` in [Modal.tsx:18](../../apps/builder/web/src/components/Modal.tsx#L18) already does the `[a-z0-9]+→_` transform; align it to / share the server's `sanitizeSlug` so preview == reality.
- **Client-side validation mirrors the server (D3).** The same regex `^[A-Za-z0-9][A-Za-z0-9 _-]*$` gates the input: while it fails, Create is disabled and, on a submit attempt, a **red inline error** renders the teaching message (`nameCharsetError`). This is instant feedback; the server 400 is the authoritative backstop for the same rule (mismatch would be a bug).
- **`onCreate` becomes a real submit.** The modal calls `store.createProject(name)`:
  - success → close modal, `setArtifactOpen(false)`, composer opens pre-targeted (D5);
  - `409` → keep the modal open, show the **red inline error** 「「<name>」は既にあります」 (`projectExists`) with an **[開く]** button that sets `settings.targetProject = existing`, refreshes, and closes (D4);
  - `400 name_charset` → same red-error slot as the client validation (defensive; the client normally blocks this first).
- **`canCreate`** = the name is non-empty **and** passes the D3 regex (drop the `|| folders.length > 0` clause at [Modal.tsx:40](../../apps/builder/web/src/components/Modal.tsx#L40)).
- **Skip** stays "start a plain from-scratch task" → `onClose()` + `newTask()` (build lands in `_drafts`). Its label/behavior is unchanged; only its sibling (Create) gains real effect.

**i18n ([i18n.ts:43-54](../../apps/builder/web/src/lib/i18n.ts#L43) EN / [:93-104](../../apps/builder/web/src/lib/i18n.ts#L93) JA):** remove `selectFolders`, `addFolder`, `foldersLinked`; **rewrite `phProjectName`** to state the English-only rule with English examples (JA: 「英字のみ（例: eiken_grammar, toeic）」, EN: "English only — e.g. eiken_grammar"); add `folderPreview` («フォルダ: {slug}»), `nameCharsetError` («プロジェクト名は英数字のみ（例: eiken_grammar）» / "Use English letters and numbers only — e.g. eiken_grammar"), `projectExists` («「{name}」は既にあります»), and `openExisting` («開く»). Keep `createProject`, `projectName`, `createProjectBtn`, `skip`. **Note:** the current JA placeholder 「例：英検、TOEIC、社内ツール…」 ([i18n.ts:~93](../../apps/builder/web/src/lib/i18n.ts#L93)) — which suggests Japanese names — MUST change (it now contradicts the English-only rule).

### §4 Sidebar — empty project row

No `buildTree` change (an empty project already becomes a node — Context). **Verify + polish** [`Sidebar.tsx`](../../apps/builder/web/src/components/Sidebar.tsx) renders a `ProjectRow` whose `workflows` is `[]` without breaking (no "expand" affordance needed; the project "+" must still work to add the first workflow). If an empty project currently renders awkwardly (e.g. no visible children, chevron on nothing), add an empty-state hint row 「ワークフローがありません — + で追加」. QA item, likely CSS-only.

---

## §Precedence & edge cases

| Action | Result |
|---|---|
| **Create project** `英検` (non-English) | **rejected on submit** — red error `nameCharsetError`, no folder created (D3); user retypes `eiken` |
| **Create project** `Eiken Grammar` | `projects/eiken_grammar/`; sidebar shows **Eiken Grammar**, empty; composer pre-targets it |
| **Create**, name collides with existing folder | 409 → red "already exists" error + **[開く]** (opens existing, no new folder) (D4) |
| **Create**, name is/starts `_drafts` | rejected (D3 regex rejects leading `_`; §1 reserved-name guard as backstop) |
| **Skip** | close + plain from-scratch task → builds in `projects/_drafts/<slug>/` (unchanged) |
| **Create, then build a workflow** | first workflow lands at `projects/<newslug>/<workflow>/` (029 `targetProject`) |
| **Race:** modal-create vs Spec-gate `ensureScaffold` make same folder | second one 409s / is skipped; single folder, no corruption |

---

## Sequencing (ship order — each step compiles + tests green)

- **S1 · Server route (§1).** `POST /api/projects` + charset(400)/reserved(400)/collision(409) handling. Server test: valid name → `projects/<slug>/.dify-workspace.yaml` + `envs/` exist and `main.yml`/`workflows/` do **not** (project tier only); a non-English name → `400 name_charset` with **no** scaffold spawn; duplicate → 409 with `existing`; `_drafts` → rejected; the `runPython` fake seam (the 013-D2 injection already used by scaffold tests) asserts the `--kind project --name … --slug …` argv (and that it is NOT called on a rejected name).
- **S2 · Web API + store (§2).** `api.createProject`; `store.createProject` refreshes tree + sets `targetProject`; 409 maps to `{ error, existing }`. Web store test: success sets `settings.targetProject` and clears `workflow`/`seed`; 409 leaves settings untouched and returns `existing`.
- **S3 · Modal rewrite (§3) + i18n.** Delete the folder-linker; English-only placeholder; wire real submit + client-side D3 validation (red error, disables Create) + inline 409 error + live slug preview; drop dead i18n keys, add the new ones, rewrite `phProjectName`. Web test: a valid name calls `createProject` and closes on success; a non-English name blocks Create and renders `nameCharsetError` (no request sent); a 409 keeps the modal open and renders the "open existing" action; `canCreate` follows name-present **and** the D3 regex.
- **S4 · Sidebar empty-project polish (§4).** Confirm/adjust `ProjectRow` for `workflows: []`; optional empty-state hint. Manual QA: create → project visible immediately → its "+" opens a from-scratch composer targeting it → build lands inside.
- **S5 · Docs.** One line in [030 §Precedence](030-builder-nested-project-workflow-folders.md) ("New project modal") flipped from *promised* to *implemented → spec 031*; `GUIDE.md`/`README.md` project-create mention if any. `grep -rn 'FOLDER_POOL\|foldersLinked\|addFolder' apps/builder/web` returns 0.

---

## Acceptance criteria

1. `POST /api/projects { name: "Eiken Grammar" }` creates `projects/eiken_grammar/` with `.dify-workspace.yaml` (carrying the name) + `envs/`, and **no** `workflows/`/`main.yml`; returns `{ project, name }`.
2. **A non-English name (e.g. `英検`) is rejected on Create** — client shows a red inline error teaching the fix (`nameCharsetError`), Create stays disabled, and no request/folder is created; the server independently returns `400 name_charset` for the same input. The placeholder states the English-only rule before the user types.
3. Creating a valid project from the modal makes it appear in the sidebar **on the next tree refresh, with no build and no reload** — as an empty project row.
4. Immediately after create, the composer is pre-targeted at the new project (029 crumb 「<name> 内に新規タスク」); the first from-scratch build lands at `projects/<newslug>/<workflow>/`.
5. A duplicate name returns **409** and the modal stays open with the **same red-error affordance** showing "already exists" plus an **[開く]** action that selects the existing project; **no `project`/`project_2` twin folder is created**.
6. A name that would resolve to `_drafts` is rejected; `_drafts` is never creatable from the modal (the D3 regex already rejects a leading `_`).
7. `FOLDER_POOL`, `addFolder`, the fabricated `~/code/…` rows, and the `foldersLinked`/`selectFolders`/`addFolder` i18n keys are **gone** (`grep` clean); the modal shows only name + live folder-slug preview + Create/Skip.
8. Skip still opens a plain from-scratch task that builds under `projects/_drafts/`.
9. No change to `confinementCheck`, the gate FSM, validators, or `init_project.py` beyond being *called* with its existing `--kind project` flags; all suites + typechecks green.

## Biggest risks (with mitigations)

1. **English-only blocks the Japanese-thinking user (D3 trade-off).** A user who names the project 「英検」 is stopped and must retype `eiken`. → the placeholder states the rule *before* typing, and the red error on submit says plainly what to do with a concrete example (`nameCharsetError`), so it teaches rather than just rejecting. This is the accepted cost of ASCII-clean, meaningful folder names (no `project_N`). Validate the error copy in JA during QA — it must read as guidance, not a scold.
2. **Empty-project rendering.** A `TreeProjectNode` with `workflows: []` may render with a dead chevron / no way to see it's selectable. → S4 verifies and adds an empty-state row; buildTree already emits the node (no server risk).
3. **Modal/Spec-gate double-scaffold race.** Both paths call `--kind project`; a race could double-run. → `existsSync` guard in the route (§1) + `ensureScaffold`'s own `if (!existsSync(projectManifestAbs))` ([scaffold.ts:30](../../apps/builder/server/lib/scaffold.ts#L30)) make it idempotent; second caller 409s / skips.
4. **Slug preview drift from server truth.** If the modal's `slug()` ([Modal.tsx:18](../../apps/builder/web/src/components/Modal.tsx#L18)) diverges from server `sanitizeSlug` ([task.ts:209](../../apps/builder/server/state/task.ts#L209)), the preview lies. → use one shared function (export `sanitizeSlug` to the web bundle) or unit-test that both agree on a fixture set incl. a Japanese name.

## Open questions

1. ~~**Editable folder slug / non-ASCII handling.**~~ **Resolved (user, 2026-07-03):** English-only name, validated with a red teaching error (D3) — no editable-slug field, no generic fallback, no transliteration.
2. **Fold the project-tier spawn into a shared helper?** The route (§1) and `ensureScaffold` ([scaffold.ts:30-40](../../apps/builder/server/lib/scaffold.ts#L30)) run the same `init_project.py --kind project` argv. Extract a `scaffoldProjectTier(projectsDir, slug, name, runPython)` used by both, or leave duplicated (8 lines)? Decide in S1 (recommend: extract — one source of truth for the project-tier argv).
3. **Should Skip be removed now that Create is real?** With a real Create, "Skip" = "I don't want a named project, just build loosely in `_drafts`". Keep it (a fast path to the footer-"New task" behavior from the modal) or drop it as redundant? Recommend keep — it's the only in-modal way to bail to a loose build. Decide in S3.
