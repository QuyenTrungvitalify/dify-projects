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
3. **Implement ③** — generate `main.yml`, self-correcting against the 3 linters (capped).
4. **Test ④** — re-run the linters + write `report.json`. Then by **deploy**:
   - **`none`** — local only; reports the workflow path.
   - **`selfhost`** — an **Import** button pushes to Dify and reports a clickable `app_url`.
   - **`cloud`** — skips auto-import (CSRF); reports the copyable YAML + Dify Studio steps.

Each boundary pauses for confirmation per the **Confirm mode** (each step / spec only / auto).

## Notes

- Dify import **always creates a NEW app** — editing an existing workflow with `selfhost` produces a
  duplicate; the report surfaces a prominent warning.
- A crash mid-import is recovered on boot (the app id is reconciled via `sync.py list`, never
  re-pushed) so an interrupted build can't silently duplicate the app.
