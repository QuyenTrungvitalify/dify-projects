# Implementation Prompt — Spec 009, Lát 4 (design): VISUAL LAYER from `docs/design/`

> Copy-paste vào fresh session. **Pairs with [lat4-ui.md](lat4-ui.md)** — do this one
> **first** (build the look), then lat4-ui wires it to the backend (the data/logic).

---

You are building the **visual layer** of the Spec 009 SPA — a Preact+Vite+TS, **dark-only**
3-region app — **faithful to the bespoke design in `docs/design/`**. The design is already
done (HTML/CSS/JSX prototype + a 35 KB design-token stylesheet); your job is to port it into
real Preact components and a reusable stylesheet, rendering a **static shell** off mock data.
[lat4-ui.md](lat4-ui.md) then replaces the mock data with the live store/SSE/endpoints.

> **Source of truth for everything visual = `docs/design/`.** Where [lat4-ui.md](lat4-ui.md)
> says "copy the nexus component's visual shell," that is **superseded for the look**: the
> markup, class names, layout, and CSS come from `docs/design/`. nexus is a **logic** reference
> only (parsing, SSE reconnect, draft persistence — handled in lat4-ui), **not** a visual one.

## Repo & specs

- Working directory: `/Users/quyenbt/Desktop/MyProjects/dify-projects`
- **READ FIRST:**
  - [docs/design/surface-blocks.css](../../../design/surface-blocks.css) — the **complete design system**: CSS custom props (dark theme `--bg-canvas`/`--accent` oklch/`--ok`/`--warn`/`--danger`, `--mono-chip-*`, `--diff-*`, radii, shadows, fonts Geist/Geist Mono, `--sb-w`/`--artifact-w`) + every component class (`.app`, `.sidebar`, `.tree-*`, `.composer`, `.gate`/`.gate-*`, `.phase-track`/`.phase-step`, `.artifact`/`.atab`, `.diff`/`.diff-col*`, `.spec-edit`, …). **Reuse it verbatim — do not invent a new color/spacing system.**
  - [docs/design/Dify Workflow Builder.html](../../../design/Dify%20Workflow%20Builder.html) — the prototype shell (React 18 + Babel-standalone loading the 7 `.jsx` files + Geist via Google Fonts).
  - [docs/design/component/](../../../design/component/) — the prototype components to PORT (React/Babel `.jsx` → Preact `.tsx`):
    - `app.jsx` → `App`, `EmptyState`, `Seg` (the shell + new-task empty state)
    - `sidebar.jsx` → `Sidebar`, `ProjectRow`, `WorkflowRow`, `TaskRow`, `Twist` (the **3-level** Project ▸ Workflow ▸ Task tree)
    - `chat.jsx` → `PhaseTrack`, `Disclosure`, **`GateCard`**, `SettingChip`, `Composer`
    - `artifact.jsx` → `ArtifactPanel`, `SpecTab`, `YamlTab`, `DiffTab`, `ReportTab`
    - `modal.jsx` → `CreateProjectModal`; `icons.jsx` → the `Svg` base **+ the `I` glyph map** (`window.I` — components render `<I.folder/>`/`<I.check/>` etc., so port the whole `I` map, not just `Svg`); `data.jsx` → mock fixtures with their **real export names**: `TREE`, `SUGGESTIONS`, `PHASES`, `RUN_DETAIL`, `GATES`, `SPEC_MD`, `YAML_LINES`, `LINTERS`, `LINTERS_FAIL`, `DIFF`, `REPORT` (renameable, but match these when porting).
  - [docs/specs/009-design-prompt.md](../../009-design-prompt.md) — the design language + the 7 surfaces + **how it deliberately differs from nexus** (settings = Workflow/Confirm/Deploy not model/Local; 4-step phase indicator; **gate cards**; right artifact panel; 3-level sidebar).
  - [docs/specs/009-browser-workflow-builder.md](../../009-browser-workflow-builder.md) → §B (3 regions), §D (gate variants → the gate-card states), Acceptance **#13** (sidebar tree), **#14** (settings-below-input), **#16** (inline gate buttons), **#3** (SPEC editable), **#4** (diff).

## Why this matters

The product *is* the gate experience. `docs/design/` already specifies it precisely — the
**gate cards** (`Continue` / `Request changes`; clean vs still-failing tones; the danger-toned
`Import into Dify`; the red retry card), the 4-step phase track, the settings-below-input, the
3-level sidebar, the right artifact/diff panel. Re-deriving the look from nexus would lose all
of that. Build the shell to match the design exactly; wiring comes next.

## Stack note (prototype → app)

The prototype is **React 18 + Babel-standalone** (`.jsx`, CDN React). The app is **Preact + Vite
+ TS** (`tsconfig` `jsxImportSource: "preact"`). Port, don't lift: `.jsx` → `.tsx`, drop the
CDN React/Babel, keep component structure + props + the exact `className` strings (so
`surface-blocks.css` applies unchanged). Hooks (`useState`/`useEffect`) map 1:1 to `preact/hooks`.
The actual React-isms to swap (the only ones present): `React.Fragment` (chat.jsx) → `Fragment`/`<>…</>`;
`React.createElement` (icons.jsx) → JSX/`h`; `ReactDOM.createRoot(...).render(<App/>)` (app.jsx) →
`render(<App/>, root)` from `preact`. No `React.Children`/legacy-context is used.

## Tasks

### 1. Vendor the stylesheet + fonts
- Copy `docs/design/surface-blocks.css` → `apps/builder/web/src/styles/surface-blocks.css` (verbatim). Import it once in `main.tsx`. (Keep it a single file; do not split. If lat4-ui's Vite is set up, this lives under that `web/src`.)
- Load **Geist** + **Geist Mono** — the prototype uses Google Fonts. For a local app keep the same `<link>` in `index.html` (acceptable v1), or vendor the woff2 if offline use is required; do not substitute a different typeface (the design is tuned to Geist + the `--mono` chips).

### 2. Port `icons.jsx` + the shell (`app.jsx`)
- `src/components/Icon.tsx` = the `Svg` base + the **`I` glyph map** (export `I`; components render `<I.folder/>` etc.). `src/components/App.tsx` = the `.app` grid (`grid-template-columns: var(--sb-w) 1fr`, `.sb-collapsed` variant) + `.main` (and `.main.has-artifact` → `1fr var(--artifact-w)` when the panel is open). Render `<Sidebar/>`, the chat region, and the (conditional) `<ArtifactPanel/>`.
- `EmptyState` = the centered new-task surface: breadcrumb chip `📁 <project> ⌄`, the large rounded `Composer` (placeholder "Describe the workflow or change…", with the 3 setting chips in its `.composer-row` **inside** the composer — not a separate row), then the **`.empty-suggest` "TRY" block** (3 `.suggest-row` from `SUGGESTIONS` — don't omit it). (Empty-state input is centered; once a run starts it docks to the bottom — `.composer-dock`.)

### 3. Sidebar (`sidebar.jsx`) — the 3-level tree (AC #13)
- `Sidebar` with `.sb-head` ("Projects" + filter + new-task icons), a floating **"+ New task"** (`.sb-newtask`), the scroll area, and `.sb-foot` Settings. `ProjectRow ▸ WorkflowRow ▸ TaskRow` with the `Twist` disclosure caret; classes `.tree-project`/`.tree-workflow`/`.tree-task`/`.tree-row`/`.tree-children`.
- **Project** = the `project.group` label (NOT a folder); hovering a Project shows **only "+"** (New task), no gear. Active task = highlight pill. Render off mock `TREE` for now (lat4-ui swaps in `/api/tree`).

### 4. Chat region (`chat.jsx`) — phase track, composer, settings, **gate cards** (AC #14, #16)
- `PhaseTrack` = the slim **4-step** indicator `① Analyze · ② Spec · ③ Implement · ④ Test` (`.phase-track`/`.phase-step`/`.phase-num`/`.phase-sep`), current step highlighted.
- `Composer` = sticky bottom input (`.composer*`) with the `SettingChip` row **below the input** (`Workflow ▾` · `Confirm ▾` · `Deploy ▾`) — **no model picker, no pattern picker** (AC #14). The chips render whatever `settings` holds: the spec **default is `none`/`each step`/`none`** (AC #14), though the prototype's mock fixture seeds `workflow:"stem_proofread"` — so the static shell will show that until wired. Thread: user bubble right (`.bubble-user`/`.msg-user`), assistant output left full-width (`.msg-assistant`), `Disclosure` with the prototype's literal label **"Running ① Analyze…"** (port the actual string, not a paraphrase).
- **`GateCard`** (the centerpiece — `.gate`/`.gate-head`/`.gate-body`/`.gate-foot`/`.gate-badge`/`.gate-list`) render the per-phase states from §D / mock `GATES`:
  - Analyze/Spec: `[ ✔ Continue to <phase> ] [ 💬 Request changes ]`
  - Implement **clean**: "`main.yml` · 3 linters passed · view diff" + `[ ✔ Implement this spec ] [ 💬 ]`
  - Implement **still-failing** (warn tone): "lint still failing after 5" + `[ Accept anyway ] [ Keep trying ] [ Abandon ]`
  - **Import** (danger/primary, only when Deploy≠none): `[ ✔ Import into Dify ]`
  - **Error** (danger tone): `[ ↻ Retry phase ]`
  Buttons are presentational here (onClick stubs); lat4-ui wires them to `api.confirm`/`api.reply`.

### 5. Artifact panel (`artifact.jsx`) — right slide-in (AC #3, #4)
- `ArtifactPanel` (`.artifact`/`.artifact-head`/`.artifact-tabs`/`.atab`/`.artifact-body`, `--shadow-panel` slide-in) with tabs: `SpecTab` (renders `SPEC.md`, **editable** `.spec-edit` textarea + Save button — AC #3), `YamlTab` (`main.yml` + `.lint-list`/`.lint-row` results), `DiffTab` (`.diff`/`.diff-cols`/`.diff-col`/`.diff-line`/`.dstat-add`/`.dstat-del` split view — AC #4), `ReportTab` (`.report-row` + the `.app-url-card` clickable `app_url` when Deploy≠none). Render off mock `SPEC/YAML/LINTERS/DIFF/REPORT`.
- **Secret/token is NEVER rendered** (`.secret-note` reminder pattern only).

### 6. Modal + states
- `CreateProjectModal` (`.modal*`) for new-project creation (used by lat4-ui's new-task flow). Show all four run states clearly via classes/tones: `running` (spinner `.spin`/disclosure) · `awaiting_confirm` (gate card) · `error` (danger card + retry) · `done`.

### 7. Build the static shell
- **Prereq:** the `apps/builder/web` toolchain (`package.json` with `"build":"tsc --noEmit && vite build"`, `vite.config.ts`, `tsconfig.json` with `jsxImportSource:"preact"`) is **lat4-ui task 1** — set it up first (it doesn't exist yet; `apps/` is created in Lát 1–4). Do that toolchain step, then this prompt's components.
- `main.tsx` mounts `<App/>` with the mock `data` fixtures so the **whole UI renders statically** (no backend). `npm --prefix apps/builder/web run build` passes `tsc --noEmit`.

## Acceptance

- [ ] `surface-blocks.css` vendored verbatim + Geist loaded; the app renders **dark-only**, matching the prototype's look (open `docs/design/Dify Workflow Builder.html` in a browser to compare side-by-side).
- [ ] **AC #13** — 3-level Project ▸ Workflow ▸ Task sidebar; Project hover shows only "+"; active-task pill.
- [ ] **AC #14** — settings (`Workflow`/`Confirm`/`Deploy`) sit **below** the input; no model/pattern picker.
- [ ] **AC #16 (visual)** — gate cards render all variants (clean / still-failing / import / error) as inline cards in the thread.
- [ ] **AC #3 (visual)** — SPEC tab has an editable textarea + Save; **AC #4 (visual)** — split diff renders add/del columns.
- [ ] Every component uses the design's exact class names so `surface-blocks.css` styles it with **no extra CSS**; `tsc --noEmit` passes; the shell renders off mock data with no backend.

## On blocker

- **A prototype `.jsx` React-ism** → the only ones present are `React.Fragment`, `React.createElement`, `ReactDOM.createRoot` (see the Stack note for the Preact swaps); rewrite those few lines, do not pull in React/`preact/compat`.
- **A class in the JSX isn't in `surface-blocks.css`** → grep the CSS; if genuinely missing, add the minimal rule **in the design's token language** (reuse `--` vars), and note it. Do not restyle with ad-hoc colors.
- **Vite/tsconfig not set up yet** → this prompt assumes lat4-ui's toolchain task (1) ran, or do that toolchain step first (Preact preset, `jsxImportSource: preact`). Coordinate with [lat4-ui.md](lat4-ui.md) task 1.

## Guardrails

- **`docs/design/` is read-only source** — copy `surface-blocks.css` and port the components into `apps/builder/web/`; do not edit files under `docs/design/`.
- **Visual fidelity over nexus reuse:** if a nexus component's CSS would change the look, the design wins. nexus contributes **logic** (in lat4-ui), never the look.
- **Confinement unchanged:** your only writes are under `apps/builder/web/`. `git status --porcelain` clean elsewhere before committing.
- **Commit LOCAL only** after the shell renders + `tsc --noEmit` passes; branch first if on `main`; do NOT push; do NOT `--no-verify`.
