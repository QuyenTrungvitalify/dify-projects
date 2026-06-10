# Implementation Prompt — Spec 009, Lát 5: SHELL — selfhost, seeds, diff, recovery, security, cloud, docs

> Copy-paste vào fresh session.

---

You are implementing **Lát 5 — SHELL (selfhost, seeds, diff, recovery, security, cloud, docs + repo-tool changes)** for the dify-projects repo. This is the final vertical slice of Spec 009. It wires the backend to Dify (push/list/pull, all backend-owned with the token in a subprocess env), builds the diff producer + seed list + restart-recovery, hardens the headless permission settings, adds Cloud fallback, writes the docs/repo-prep, and makes two small repo-tool changes (`--json-out` on `sync.py push`, `--group` on `init_project.py`).

## Repo & specs

- Working directory: `/Users/quyenbt/Desktop/MyProjects/dify-projects`
- **READ FIRST** (read the parts relevant to this slice):
  - [docs/specs/009-implementation-plan.md](../../009-implementation-plan.md) → the **"### Lát 5 — SHELL"** section (goal / in-out scope / files / exact commands / acceptance / gotchas / spec-to-update), plus **"Cross-cutting decisions"**, **"Divergences"** (#3 `project.group`, #4 `app_id`), and the **"Spec-update ledger"** (the two Lát 5 rows).
  - [docs/specs/009-browser-workflow-builder.md](../../009-browser-workflow-builder.md) → **§F** (Configuration), **§G** (Deploy modes + Dify-workspace seed contract), **§I** (Error handling & recovery — per-phase idempotency, `push_intent`, boot reconcile), **§H** (repo-prep checklist), **§J** (Security & threat model), **Acceptance #5, #9, #11, #12, #17, #18, #23, #25**.
  - [docs/specs/009-spike-findings.md](../../009-spike-findings.md) → §5 (the WINNING MODEL C `headless-settings.json` content — this slice **hardens** that file) and §2 (`--setting-sources local` isolation).
  - [.claude/skills/dify-build/](../../../../.claude/skills/dify-build/) → the phase prompt engine (only ④/selfhost touches this slice indirectly; the test phase is human/CLI, not an app turn).
  - **Prior-slice code you extend**: `apps/builder/server/` (Fastify backend from Lát 1–4), `apps/builder/headless-settings.json` (seeded Lát 1 from the spike winner — you HARDEN it here), `apps/builder/web/` (UI from Lát 4 — the seed picker + diff panel already exist and call `/api/seeds` + render `{path, diff}`; they degrade to empty until this slice lands the backends).
  - **Repo tools you edit**: [tools/dify_base/sync.py](../../../../tools/dify_base/sync.py), [tools/dify_base/init_project.py](../../../../tools/dify_base/init_project.py), [templates/_base/project/.dify-workspace.yaml](../../../../templates/_base/project/.dify-workspace.yaml).

## Why this matters

Lát 1–4 produced and gated a `main.yml` entirely offline; this slice makes the build actually reach Dify (selfhost import + clickable `app_url`), lets a user seed from a live Dify app, shows a real diff, and survives a crash mid-push without creating a duplicate app — all while keeping the Dify token strictly backend-side (never in a Claude turn, never in the SSE stream or `.runs/` JSON). It also hardens the permission carve-out and writes the docs that make the app installable, closing AC #5/#9/#11/#12/#17/#18/#23/#25.

## Pre-flight

```bash
cd /Users/quyenbt/Desktop/MyProjects/dify-projects
git status                                            # note pre-existing dirty files; you add to this, don't revert others
git rev-parse --abbrev-ref HEAD                       # if 'main', branch first (see Guardrails)

# Prior-slice artifacts MUST exist (Lát 1–4). If any are missing, STOP — this slice builds on them:
ls apps/builder/headless-settings.json                # seeded Lát 1 from the spike winner (you harden it)
ls apps/builder/server/index.ts apps/builder/server/lib/   # backend from Lát 1–4
ls apps/builder/web/src                               # UI from Lát 4 (seed picker + diff panel)

# Repo substrate (run ./scripts/setup.sh if .venv is missing):
ls .venv/bin/python tools/dify_base/sync.py tools/dify_base/init_project.py templates/_base/project/.dify-workspace.yaml
.venv/bin/python tools/dify_base/sync.py push --help   # CONFIRM no --json-out yet (you add it)
.venv/bin/python tools/dify_base/init_project.py --help # CONFIRM no --group yet (you add it)
```

Verify the current ground-truth lines before editing (they anchor the gotchas):
- `sync.py` `cmd_push` (~:299) joins `BASE / "projects" / args.project / args.file` and prints `f"\n✓ Import result: {json.dumps(result, indent=2)}"` — **raw `r.json()`, no field extraction**; `--json-out` does not exist; `cmd_list` (~:176) prints `a.get('id')` as the `app_id` column.
- `init_project.py`: `@dataclass Answers` (~:36) has no `group`; `vars = asdict(answers)` (~:145) feeds template substitution, so adding a `group` field auto-exposes `{{group}}`; `main()` (~:166) has no `--group` flag.
- `.dify-workspace.yaml` template `project:` is a **mapping** with `name/slug/app_type/dsl_version/dify_tag`; both `scripts/regen_vscode_settings.py` (~:54) and `scripts/check_dsl_version.sh` read `(data.get("project") or {}).get("dsl_version")` — a scalar `project:` would make `.get()` raise `AttributeError` (regen only catches `yaml.YAMLError`) and brick pre-commit. **`project:` MUST stay a mapping.**

## Mission

Land seven things, each independently verifiable: (1) repo-tool changes (`--json-out`, `--group`, `project.group` sub-key); (2) backend selfhost push ④ with `app_id` capture + `app_url` + `push_intent` idempotency; (3) `/api/seeds` (backend `sync.py list`, graceful degrade); (4) the diff producer (backend `difflib`, payload `{path, diff}`); (5) Phase ① Dify-seed scaffold-then-pull; (6) recovery (boot reconcile + idempotency) + security hardening (harden `headless-settings.json`, token redaction, hardcoded `127.0.0.1`); (7) Cloud fallback + docs/repo-prep. Then apply the Spec-update-ledger edits (§F, §A) so the spec doesn't drift.

## Tasks

### 1. Repo-tool change A — add `--json-out` to `sync.py push`

In [tools/dify_base/sync.py](../../../../tools/dify_base/sync.py):
- Add `p_push.add_argument("--json-out", action="store_true", help="Print machine-readable JSON of the import result (raw r.json()) and nothing else")` to the `push` subparser (~:354–361).
- In `cmd_push` (~:313–318), when `args.json_out`, print **only** `json.dumps(result)` (single line, no `✓ Import result:` prefix, no `indent`) to stdout so the backend can `JSON.parse` the last stdout line; otherwise keep the existing pretty print.
- **The `app_id` field name is NOT confirmed** (Divergence #4 — `cmd_push` prints raw `r.json()` with no extraction). Do **not** hard-code `result["id"]`. Run a real push against a dev Dify (or inspect a captured response) and record the actual key in a code comment. The import endpoint is `/apps/imports` (~:140–145); `cmd_list` surfaces the app id as `a.get('id')` (~:187), so the import response most plausibly carries it under `id` (or a nested `app.id`) — **confirm against a live response, comment the verified path, and have the backend read that exact key with a fallback to the `list`-reconcile path (Task 2) if absent.**
- Do **not** change `--file`'s relative-to-`projects/<slug>/` semantics.

Verify:
```bash
.venv/bin/python tools/dify_base/sync.py push --help | grep -- --json-out   # flag present
.venv/bin/python -c "import ast,sys; ast.parse(open('tools/dify_base/sync.py').read())"  # parses
```

### 2. Repo-tool change B — add `--group` to `init_project.py` + `project.group` sub-key

- [templates/_base/project/.dify-workspace.yaml](../../../../templates/_base/project/.dify-workspace.yaml): add a `group:` sub-key **inside** the existing `project:` mapping (sibling of `name/slug/...`), value `"{{group}}"`. **Keep `project:` a mapping** (do NOT make it a scalar). Example:
  ```yaml
  project:
    name: "{{project_name}}"
    slug: "{{project_slug}}"
    group: "{{group}}"
    app_type: "{{app_type}}"
    dsl_version: "{{dsl_version}}"
    dify_tag: "{{dify_tag}}"
  ```
- [tools/dify_base/init_project.py](../../../../tools/dify_base/init_project.py):
  - Add `group: str` to the `@dataclass Answers` (~:36) — since `vars = asdict(answers)` (~:145) drives substitution, this auto-fills `{{group}}`.
  - Add `p.add_argument("--group", default="", help="App sidebar grouping (project.group); empty = ungrouped")` to `main()` (~:166), and pass `group=args.group` in the `--non-interactive` `Answers(...)` construction (~:188). Provide a sensible interactive prompt in `collect_interactive()` (default `""`) so the interactive path doesn't crash on the new required field.
- **Backward-compat:** an empty `group` must render `group: ""` (harmless sibling key; the dsl scripts only read `dsl_version`).

Verify (scaffold a throwaway project, assert standalone tooling is unaffected — AC #17):
```bash
.venv/bin/python tools/dify_base/init_project.py --non-interactive --name "Lat5 Probe" --slug lat5_probe --app-type workflow --primary-lang en --group "QA"
grep -n 'group:' projects/lat5_probe/.dify-workspace.yaml          # group sub-key present, project: still a mapping
.venv/bin/python scripts/regen_vscode_settings.py                  # MUST exit 0 (no AttributeError) — the real `group`-ignored / mapping test
cp templates/patterns/multi-step-llm.yml projects/lat5_probe/workflows/main.yml   # a real workflow (init scaffolds workflows/ EMPTY)
bash scripts/check_dsl_version.sh projects/lat5_probe/workflows/main.yml; echo "check_dsl exit=$?"  # 0 = dsl_version read from .dify-workspace.yaml unaffected by group
.venv/bin/python -m pytest -q 2>/dev/null | tail -5 || echo "(run the repo test suite if present)"
rm -rf projects/lat5_probe                                         # cleanup throwaway scaffold
.venv/bin/python scripts/regen_vscode_settings.py                  # regen again so .vscode/settings.json drops the probe
```

### 3. Backend seeds — `/api/seeds` (graceful degrade)

Add a backend route (e.g. `apps/builder/server/lib/dify-io.ts` + a route in the server) that shells, in a **backend subprocess with the Dify env injected** (`DIFY_CONSOLE_URL` + `DIFY_CONSOLE_TOKEN` in that child's `env`, never in any Claude turn), cwd = `DIFY_PROJECTS_DIR`:
```
.venv/bin/python tools/dify_base/sync.py list
```
- **No `--project`** (env is injected directly; do not rely on `dev.env`+dotenv per Cross-cutting).
- Parse the human table (`cmd_list` prints `  {id:<38} {mode:<14} {name}` rows after a header) into `[{app_id, mode, name}]`.
- **Degrade gracefully (`list` exits 1 for BOTH missing-cred AND request failure — indistinguishable by exit code, plan §0):** on exit 1, parse **stderr** — `not set` ⇒ `{seeds:[], reason:"no-credentials"}`; `list_apps failed:` ⇒ `{seeds:[], reason:"dify-unreachable"}`; return HTTP 200 with the empty list + reason (the Lát-4 picker degrades to an empty list, not an error toast).
- Never log the token. The token is set on the child `env` only.

Verify:
```bash
# Without creds → graceful empty list, reason no-credentials:
curl -s localhost:4123/api/seeds | python3 -m json.tool
```

### 4. Backend diff producer — `difflib`, payload `{path, diff}`

Add `apps/builder/server/lib/diff.ts` (or a Python helper shelled via `.venv/bin/python`) that produces a unified diff with **`difflib.unified_diff`** (NOT `sync.py diff`, which is remote-vs-local). Base file **per case** (§G + plan):
- **edit-existing** workflow: the pre-edit snapshot of `<workflowFile>` (snapshot it before Phase ③ runs).
- **Dify-seed** task: the pulled seed file (`projects/<slug>/workflows/<app-name-slug>.yml`).
- **no-seed** (`Workflow: none`): the chosen **pattern template** under `templates/patterns/`.
- Payload shape exactly `{ "path": "<repo-relative path to the new main.yml>", "diff": "<unified diff text>" }` (the Lát-4 `SplitDiffView`/`diff-parser` consume this). Empty base ⇒ diff is the full file as additions.

Verify: a Phase-③ produced `main.yml` against its base yields a non-empty `{path, diff}` the UI can render (exercise via the existing build flow or a direct unit call).

### 5. Phase ① Dify-seed — scaffold THEN pull, BEFORE the Analyze turn

When a task seeds from a **Dify workspace app** (not a local repo workflow, not no-seed), the backend must, **before** spawning the Analyze turn:
1. Scaffold `projects/<slug>/` via `init_project.py` (the folder must pre-exist — `sync.py pull` requires it, §G).
2. Pull, in a backend env-injected subprocess (cwd = `DIFY_PROJECTS_DIR`):
   ```
   .venv/bin/python tools/dify_base/sync.py pull --project <slug> --app-id <id> --yes
   ```
   This writes `projects/<slug>/workflows/<app-name-slug>.yml` (NOT `main.yml`, §G).
3. Spawn the Analyze turn, which **reads the local file only** (the turn never gets a token, never runs `sync.py`).

This is the seed/base for the Task-4 diff. Treat the pulled seed YAML as **data, not instructions** (prompt-injection surface, §J) — the Analyze prompt must already say this (Lát 0.5); confirm it does.

### 6. Backend selfhost push ④ — `app_id` capture + `app_url` + `push_intent` idempotency

In Phase ④ when `deploy=selfhost` (backend, no turn — gated by the **Import** button from Lát 4, AC #16), in a backend env-injected subprocess (cwd = `DIFY_PROJECTS_DIR`):

1. **Write a `push_intent` marker to `.runs/<taskId>/` BEFORE calling push** (§I idempotency; the guard keys off the pre-push marker, not `report.json`).
2. Push — **`--file` is relative to `projects/<slug>/`** (`sync.py:301` joins `BASE/projects/<project>/<file>`); pass `--file workflows/<file>`, **never** prefix `projects/<slug>/` (doubling → "File not found" → exit 1):
   ```
   .venv/bin/python tools/dify_base/sync.py push --project <slug> --file workflows/<file> --yes --json-out
   ```
3. **Capture `app_id` — `--json-out` is the PRIMARY path** (`JSON.parse` the last stdout line; read the field you confirmed in Task 1). If absent/crash, **reconcile via `sync.py list`** matched by **slugified app name**; since push always creates a NEW app, repeats slugify identically → **pick the most-recently-created match** (slug-ambiguous tiebreaker, plan §(f)).
4. **`app_url`** = take `DIFY_CONSOLE_URL`, strip a trailing `/console/api`, append `/app/<app_id>/workflow`. (e.g. `http://localhost/console/api` → `http://localhost/app/<id>/workflow`.) Put `app_url` in `report.json` and the SSE stream.
5. **Idempotency on re-run (§I):** if `push_intent` exists **without** a confirmed `app_id`, do **NOT** re-push (would duplicate the app) — reconcile via `list` or surface "push may have completed — check Dify". Write `app_id` back into the marker once confirmed.
6. **Footgun warning (spec):** push always makes a NEW app, so `auto`+selfhost+edit-existing silently duplicates → the report must surface a prominent **"created a NEW app (duplicate)"** notice for the edit-existing case.
7. **Token discipline:** the token is on the child `env` only; redact it from any captured stdout/stderr before it reaches SSE or `.runs/` JSON.

### 7. Recovery — boot reconcile + idempotency

Add `apps/builder/server/lib/recovery.ts` (or extend the boot path):
- **Boot:** any task in `running` → `error` + clear the run-lock (already in Lát 3 — confirm); additionally, for a task whose `.runs/<taskId>/` holds a `push_intent` **without** a confirmed `app_id`, run the `list`-reconcile (Task 6 step 3) to recover the id or mark "push may have completed".
- **`scaffolding` status:** the non-atomic `init_project` + `SPEC.md`-move (and the Dify-seed scaffold-then-pull) must be idempotent — re-running over a partial scaffold must not corrupt it (Lát 2/3 own the move; confirm the Dify-seed scaffold path here is idempotent too).

### 8. Security hardening — `headless-settings.json` + token redaction + bind

- **Harden** [apps/builder/headless-settings.json](../../../../apps/builder/headless-settings.json) (created Lát 1 from the spike winner). Ensure the deny carve-out matches the spike findings §5 **exactly** (dialect-fixed, **no leading slash** on repo-relative patterns), including `Read(projects/*/envs/*.env)` and the `tools/** skills/** .venv/** .git/** .claude/**` Write/Edit denies. Do **not** introduce a leading-slash repo-relative pattern (silent no-op, spike E0). Spawn flags stay `--permission-mode acceptEdits --settings apps/builder/headless-settings.json --setting-sources local`.
- **Token redaction:** audit every place stdout/stderr or env flows into SSE or `.runs/` JSON and assert the Dify token can never appear. The token enters ONLY the backend subprocess `env` for `list/pull/push`.
- **Bind `127.0.0.1` hardcoded** (not env-overridable — only `BUILDER_PORT` configurable, §J). Confirm the server bind is a hardcoded literal.

### 9. Cloud fallback

When `deploy=cloud`: Phase ④ **skips import** (CSRF blocks auto-import), validates + writes `main.yml`, and the report emits the **copyable YAML** + Studio-import steps (§G). No token required; no `sync.py push`.

### 10. Docs + repo prep (§H Nhịp-0 checklist)

- `README.md` (or `apps/builder/README.md`): install (`./scripts/setup.sh` prerequisite + `cd apps/builder && npm install && npm run build && npm start`), `claude auth login`, `.env` (point to `.env.example`), and the 4-phase run. (AC #12)
- `apps/builder/.env.example` — mirror §F: `DIFY_PROJECTS_DIR`, `DEFAULT_DEPLOY=none`, `BUILDER_PORT=4123`, and commented `DIFY_CONSOLE_URL`/`DIFY_CONSOLE_TOKEN` (only for `deploy≠none` or Dify-seed). Real `.env` is gitignored.
- `scripts/setup-node.sh` — app-only Node bootstrap (separate from Python `setup.sh`).
- `.gitignore` — append `apps/*/node_modules/`, `apps/*/dist/`, `apps/*/.runs/`, `apps/*/.env*`.
- `.pre-commit-config.yaml` — add `exclude: ^(apps/|node_modules/)` so `check-yaml`/hooks don't choke on `package.json` etc. (additive; don't remove existing per-hook excludes).

### 11. Spec-update ledger (no silent drift — REQUIRED)

Apply the two Lát 5 rows of the ledger to [docs/specs/009-browser-workflow-builder.md](../../009-browser-workflow-builder.md):
- **§F** — add an explicit **"Backend-owned Dify I/O; token never enters a turn"** subsection (today only *implied*, and partially contradicted by §C/§E older wording): all `sync.py` list/pull/push run in a backend subprocess with the token in its own env; the token never enters a Claude turn, the SSE stream, or any `.runs/` JSON; phases never run `sync.py`.
- **§A** — document the **`app_id` capture method**: `--json-out` (PRIMARY; record the confirmed field name) + `sync.py list` reconcile (crash tiebreaker, slug-ambiguous → most-recent). Note `--json-out` (new flag) and `--group` (new flag) in **§References "Reused tooling"** and **AGENTS.md §8** if you adopt them as canonical.
- Tick the remaining **Nhịp-0 checkboxes** in the spec's implementation plan: `.gitignore`, pre-commit `exclude`, `setup-node.sh`, `project.group`.

## Acceptance

Map each to the spec's AC #N. Tick only on real evidence.

- [ ] **AC #5** — `deploy=none` ④ writes/validates `main.yml` + reports path (no Dify); `deploy=selfhost` ④ also imports and reports a **clickable `app_url`** (`/console/api` stripped + `/app/<id>/workflow`).
- [ ] **AC #9** — `deploy=cloud` cleanly **skips import** and reports copyable YAML + Studio steps.
- [ ] **AC #11** — no runtime dependency on claude-nexus (only copied/vendored code; `grep -rn "claude-nexus\|@nexus" apps/builder/server apps/builder/web/src` shows no live import).
- [ ] **AC #12** — README covers install, `claude auth login`, `.env`, the 4-phase run; `.env.example` present.
- [ ] **AC #17** — **standalone untouched**: `project.group` sub-key added, `project:` still a mapping; `scripts/regen_vscode_settings.py` exits 0 and `scripts/check_dsl_version.sh` degrades gracefully; existing CLI/tests/CI pass (verified in Task 2).
- [ ] **AC #18** — new-workflow slug/name at the Spec gate scaffolds via `init_project.py` (with `--group` available); build proceeds.
- [ ] **AC #23** — security confinement: an **opaque** out-of-confinement write (e.g. seeded `python -c open('tools/x','w')`) is caught + reverted by the #3b check (→ `status:error`); deny carve-out (dialect-fixed, no leading slash) + `Read(projects/*/envs/*.env)` are defense-in-depth; the Dify token never appears in SSE or `.runs/` JSON and never enters a turn; bind is hardcoded `127.0.0.1`.
- [ ] **AC #25** — push idempotency: a Phase-④ `selfhost` re-run after a **simulated mid-push crash** (a `push_intent` marker present without a confirmed `app_id`) does **NOT** create a duplicate app (reconciles via `list`), and `auto`+still-failing-Implement never imports lint≠0.
- [ ] **`/api/seeds`** degrades gracefully (empty list + reason on no-creds / unreachable, HTTP 200).
- [ ] **diff** producer returns `{path, diff}` for all three base cases (edit-existing / Dify-seed / no-seed pattern).
- [ ] Spec-update-ledger edits applied (§F subsection, §A `app_id` method, Nhịp-0 checkboxes ticked, tool flags noted in §References + AGENTS.md §8).

## On blocker

- **No live Dify available** to confirm the `app_id` field or test push: implement against the documented `r.json()` shape, read the field defensively (try the confirmed key, else `list`-reconcile), leave a `# TODO: confirm app_id field against a real Dify import response` comment, and verify the `list`-reconcile path with a fake/stubbed list. Do NOT guess `result["id"]` silently — surface the uncertainty in the code comment and the §A spec note.
- **`sync.py list` exit/stderr ambiguity** (exit 1 for both no-cred and failure): rely on the stderr substring match (`not set` vs `list_apps failed:`); if neither matches, return `{seeds:[], reason:"unknown"}` and log the raw stderr tail (token-redacted).
- **A prior slice (Lát 1–4) artifact is missing** (no `apps/builder/server` / `headless-settings.json` / UI): STOP and report which slice is incomplete — this slice cannot be built on a missing shell.
- **`regen_vscode_settings.py` crashes** after the `project.group` edit: you turned `project:` into a scalar or broke the mapping — revert to a mapping with `group:` as a sibling sub-key.
- **A repo tool change breaks existing tests/CI:** the `--group`/`--json-out` additions must be **purely additive** (defaulted, optional). If a test fails, fix the addition to be backward-compatible; do not weaken an existing test.

## Guardrails

- **Backend-owned Dify I/O, always.** `sync.py list/pull/push` run only in a backend subprocess with the token in that child's `env`. The token NEVER enters a Claude turn, the SSE stream, or any `.runs/` JSON. Phases never run `sync.py`. (Confirm against §F/§J.)
- **Permission MODEL C (spike-decided):** every generating turn still spawns with `claude -p --output-format stream-json --verbose --permission-mode acceptEdits --settings apps/builder/headless-settings.json --setting-sources local`, prompt via stdin. The #3b post-turn `git status` check (reject **and revert** outside the whitelist `{projects/<slug>/, apps/builder/.runs/<taskId>/, .vscode/settings.json, projects/<slug>/.dify-workspace.yaml}`) is the real boundary — never trust `is_error` alone.
- **`sync.py push --file` is relative to `projects/<slug>/`** — pass `--file workflows/<file>`, never prefix `projects/<slug>/`.
- **`project:` MUST stay a mapping** in `.dify-workspace.yaml` (a scalar crashes `regen_vscode_settings.py`). The `group` sub-key is read only by the app; the dsl scripts ignore it.
- **`app_id`:** `--json-out` PRIMARY (confirmed field), `list`-reconcile (most-recent slug match) as crash tiebreaker. Push always creates a NEW app → surface the duplicate warning for edit-existing.
- **Localhost only:** bind `127.0.0.1` hardcoded (not env-overridable); only `BUILDER_PORT` configurable. One build at a time (409 on a 2nd `POST /api/tasks` — from Lát 3, don't regress).
- **Any new UI surface follows [docs/design/](../../../design/)** (`surface-blocks.css`): the Cloud copy-YAML + Studio-steps card and the clickable `app_url` reuse existing classes (`.app-url-card`, the gate/report card patterns from Lát 4·design — see [lat4-design.md](lat4-design.md)). Do **not** introduce a new visual style; most of these surfaces already exist from Lát 4 and you only feed them real data.
- **No silent drift:** apply the Spec-update-ledger §F/§A edits + Nhịp-0 checkboxes when the slice's acceptance passes.
- **Cleanup throwaway artifacts** (`projects/lat5_probe`, any test scaffold) and re-run `regen_vscode_settings.py` so `.vscode/settings.json` doesn't carry probe entries into the commit.
- If on `main`, **branch first**. Commit **LOCAL only** after acceptance passes; do **NOT** push; do **NOT** `--no-verify`. Do not revert pre-existing dirty files from other in-flight work — only stage what this slice touches.
