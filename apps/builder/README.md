# Builder — browser workflow builder (spec 009)

A local, single-user web app that drives the repo's `dify-build` skill through a gated 4-phase build
(**Analyze → Spec → Implement → Test**) and, optionally, imports the result into Dify. The backend
owns all Dify I/O and the `claude` turns; the browser is a dumb renderer over SSE.

> Binds **`127.0.0.1` only** (hardcoded). One build at a time. The Dify token is backend-only — it
> never enters a `claude` turn, the SSE stream, or any `.runs/` JSON.

## Prerequisites

1. **Python substrate** — from the repo root, run the Python bootstrap once so the builder can shell
   `.venv/bin/python tools/dify_base/...`:
   ```bash
   ./scripts/setup.sh
   ```
2. **Claude CLI** — the builder spawns headless `claude` turns. Install it and log in:
   ```bash
   claude auth login
   ```
3. **Node.js 20.6+** (22 recommended).

## Install & run

```bash
# From the repo root — installs + builds the builder backend and the web SPA:
./scripts/setup-node.sh

# Configure (only needed for deploy≠none or Dify-seed — see below):
cp apps/builder/.env.example apps/builder/.env   # then edit

# Start the backend (serves the built SPA at http://127.0.0.1:4123):
cd apps/builder
npm install      # (no-op if setup-node.sh already ran)
npm run build
npm start
```

Open <http://127.0.0.1:4123>. For live development of the web SPA, run `npm run dev` in
`apps/builder/web` (the vite dev server proxies the API to `BUILDER_PORT`).

## Development (rebuild & restart)

Neither `npm start` nor `npm run dev` hot-reloads the **backend**, and the backend serves the **built**
SPA from `web/dist`. So what you rebuild depends on what you changed:

- **Web change** (`web/src/**` — components, store, styles): rebuild the SPA and hard-refresh the
  browser (`Cmd/Ctrl+Shift+R`). The running backend serves the fresh `web/dist` per request — **no
  backend restart needed**. The content-hashed bundle name changes, so a refresh always picks it up.
  ```bash
  cd apps/builder/web && npm run build
  ```
- **Backend change** (`server/**` — orchestrator, routes, state): stop the process and start it again.
  ```bash
  lsof -ti:4123 | xargs kill                     # stop the running backend
  cd apps/builder && npm run build && npm start   # rebuilt dist
  # …or run the TS directly (no build step):      npm run dev
  ```
- **Fastest inner loop** (HMR, no manual rebuilds): run the backend and the vite dev server in two
  terminals and open the **vite** URL (it proxies `/api` → `BUILDER_PORT`):
  ```bash
  cd apps/builder && npm run dev            # terminal A — backend API on :4123
  cd apps/builder/web && npm run dev        # terminal B — SPA with HMR (usually :5173)
  ```

Rebuild + full test suite before committing (mirrors the CI `builder` job):
```bash
cd apps/builder && npm run typecheck && npm test     # backend: tsc --noEmit + node:test via tsx
cd apps/builder/web && npm run build && npm test     # web: tsc --noEmit + vite build + vitest
```

Stop the backend:
```bash
lsof -ti:4123 | xargs kill
```

## Configuration (`.env`)

Copy [`.env.example`](.env.example) to `.env` (gitignored). Keys (spec §F):

| Key | Default | Notes |
|---|---|---|
| `DIFY_PROJECTS_DIR` | repo root | Where `.venv/`, `tools/`, `projects/` live. |
| `DEFAULT_DEPLOY` | `none` | Default deploy target: `none` \| `selfhost` \| `cloud`. |
| `BUILDER_PORT` | `4123` | The only configurable bind knob; host stays `127.0.0.1`. |
| `DIFY_CONSOLE_URL` | — | `https://<host>/console/api`. **Only** for `deploy=selfhost` or Dify-seed. |
| `DIFY_CONSOLE_TOKEN` | — | Bearer from a logged-in Dify browser session. **Backend-only.** |

The real `.env` is gitignored; only `.env.example` is committed.

## The 4-phase run

1. **Analyze ①** — read the seed (a Dify-workspace app, a local workflow, or none) and summarize it.
   A Dify-seed is scaffolded + pulled by the backend first; the turn reads the local file only.
2. **Spec ②** — draft `SPEC.md` (editable in place at the gate; last write wins).
3. **Implement ③** — generate `main.yml`, self-correcting against the 4 linters (capped). The
   post-turn gate lints **every** turn-touched `workflows/*.ya?ml` (spec 039), and an extension
   twin of the declared file (`main.yaml` beside `main.yml`) hard-errors. With console creds the
   backend harvests **workspace facts** (real plugin identifiers + dataset ids + enabled models)
   into the turn as data, and the ③ gate shows an advisory **runnability preflight** note when the
   build still isn't runnable out-of-the-box (spec 037).
4. **Test ④** — re-run the linters + write `report.json`. Then by **deploy**:
   - **`none`** — local only; reports the workflow path.
   - **`selfhost`** — an **Import** button pushes to Dify and reports a clickable `app_url`.
   - **`cloud`** — skips auto-import (CSRF); reports the copyable YAML + Dify Studio steps.

Each boundary pauses for confirmation per the **Confirm mode** (each step / spec only / auto).

**Ask vs Request changes** (spec 033) — at a parked Analyze/Spec/Implement gate, the composer defaults
to **Ask**: a conversational, resume-the-session question that streams a message↔message answer and
never touches the gate or the artifact (SPEC.md/main.yml) — enforced structurally (a permission-hook
write-deny + a byte-snapshot/restore backstop), not by trusting the model. Explicitly switch to
**Request changes** (via a gate's "Edit spec"/"Request changes" action) to actually re-run the phase and
revise the artifact — the two are always an explicit choice, never inferred from the text. **Spec 034**
extends Ask to the ④ Test gates and to a terminal `done`/`cancelled` build: since there is no phase
session to resume there, it runs a **fresh-seeded** turn (assembled from requirement/SPEC.md/main.yml/
report.json/liveTest, shown as a "based on:" caption), and a terminal build's composer becomes Ask-only.
**Spec 035** adds an "Edit this workflow" button on the done/cancelled gate foot to start a new
edit-existing build (starting a brand-new build lives at the sidebar "+").

**⚡ Fast build** (spec 028) — a composer toggle for **from-scratch single-LLM** builds: it merges
Analyze ①+② into one turn (skips the `find.py` pattern search) and still **stops at the Spec gate**.
Off by default; auto-forced off for seed/edit/slug builds. Under `auto` confirm-mode a structural
sanity-check hard-stops at the Spec gate if the merged draft turns out non-single-LLM.

## Notes

- Dify import **always creates a NEW app** — editing an existing workflow with `selfhost` produces a
  duplicate; the report surfaces a prominent warning.
- A crash mid-import is recovered on boot (the app id is reconciled via `sync.py list`, never
  re-pushed) so an interrupted build can't silently duplicate the app.
