# Implementation Prompt — Spec 009, Lát 1: SKELETON — spawn 1 phase + post-turn verify

> Copy-paste vào fresh session.

---

You are implementing **Lát 1 — SKELETON: spawn 1 phase + post-turn verify** for the dify-projects repo.

## Repo & specs

- Working directory: `/Users/quyenbt/Desktop/MyProjects/dify-projects`
- **READ FIRST** (read the parts relevant to this slice):
  - [docs/specs/009-implementation-plan.md](../../009-implementation-plan.md) — the **"### Lát 1 — SKELETON"** section ((a)–(g)) **plus** "Cross-cutting decisions", "Divergences", and the "Spec-update ledger".
  - [docs/specs/009-spike-findings.md](../../009-spike-findings.md) — §5 (the **final corrected `headless-settings.json`** you copy verbatim) + §4 (event shapes: `init.session_id`, terminal `result.is_error`; `tool_result.is_error=True` mid-stream does **not** fail the turn) + §2 (`--setting-sources local` isolation).
  - [docs/specs/009-browser-workflow-builder.md](../../009-browser-workflow-builder.md) — §A (turn-I/O shape), §I (post-turn check), Acceptance **#4** and **#10**.
  - [.claude/skills/dify-build/SKILL.md](../../../../.claude/skills/dify-build/SKILL.md) + [.claude/skills/dify-build/implement.md](../../../../.claude/skills/dify-build/implement.md) — the Implement (③) prompt body you render with vars substituted.
  - nexus copy-targets (COPY, **not** a dependency): `/Users/quyenbt/Desktop/MyProjects/claude-nexus/src/server/lib/claude-session.ts` and `…/task-spawning.ts` (lines `60-64`, `148-157`, `208-220` for session_id + turn-end).

## Why this matters

This slice proves the **net-new core** the whole app rests on: the backend can spawn one `claude` Implement turn under the spike-decided permission model (model C), parse the `stream-json` stream to capture `session_id`/`result`, write the workflow YAML, and then **verify it itself** — correctness (3 linters + 13-digit IDs) and confinement (`git status` whitelist, **revert** on breach). Everything downstream (chaining, gate, SSE, UI) is plumbing on top of this. The transport is copied from nexus; the verify + the model-C spawn flags are the only new, load-bearing logic, so they get all the attention here.

## Pre-flight

```bash
cd /Users/quyenbt/Desktop/MyProjects/dify-projects
git status                                   # note baseline; must end this slice clean outside the whitelist
claude --version                             # expect 2.1.156 (model-C contract is version-anchored)
node --version                               # need a Node with built-in fetch / stable ESM (≥18)
ls .venv/bin/python skills/mango-svip/scripts/generate_id.py \
   skills/mango-svip/scripts/validate_workflow.py \
   tools/dify_base/lint_refs.py tools/dify_base/lint_plugin_hashes.py \
   tools/dify_base/find.py                    # repo tools must exist (run ./scripts/setup.sh if .venv missing)
ls templates/patterns/*.yml                  # a seed/pattern to feed Implement
# Prior-slice artifacts (Lát 0 + 0.5) MUST exist:
ls docs/specs/009-spike-findings.md          # Lát 0 deliverable (the settings seed lives in §5)
ls .claude/skills/dify-build/SKILL.md .claude/skills/dify-build/implement.md   # Lát 0.5 engine
test -d apps/builder && echo "apps/builder EXISTS — confirm it is empty/this slice owns it" || echo "apps/builder absent (expected) — this slice creates it"
```

If `apps/builder/` already has prior content you did not create, STOP and report — do not overwrite another slice's work.

## Mission

Stand up `apps/builder/` as a minimal Fastify backend with **one** dev endpoint that:
1. spawns a single **Implement (③)** turn (model C: `acceptEdits` + `--settings apps/builder/headless-settings.json` + `--setting-sources local`, prompt via **stdin**) on a hardcoded requirement + an existing seed/pattern,
2. parses the `stream-json` NDJSON stream — captures `system/init`→`session_id` and the terminal `result` (turn-end),
3. after the turn, runs **post-turn verify**: correctness (`yaml.safe_load` truncation → 3 linters exit 0 → `^\d{13}$` node-ID regex → artifact non-empty) **and** confinement (`git status --porcelain` whitelist; any path outside → **revert** + `status:error`),
4. returns a small JSON status.

**Out of scope** (do NOT build): the permission gate / `awaiting_confirm`, phase chaining (① ② ④), SSE, any UI, any Dify I/O (`sync.py`), run-lock, recovery. One phase, one curl.

## Tasks

### 1. Seed the permission settings FIRST (the spawn consumes it)

Copy the **winning Lát-0 candidate verbatim** — the final corrected `headless-settings.json` block from [009-spike-findings.md](../../009-spike-findings.md) **§5** — to `apps/builder/headless-settings.json`. It is `defaultMode: acceptEdits` + broad allow `["Bash","Read","Write","Edit","Glob","Grep"]` + the **dialect-fixed** deny carve-out (**no leading slash** on repo-relative patterns: `Write(tools/**)`, `Edit(skills/**)`, …, plus `Read(projects/*/envs/*.env)`, `Bash(sudo:*)`, etc.). Do **not** redesign it — it is *hardened* (created) here and only extended in Lát 5. Confirm byte-for-byte against §5.

### 2. Scaffold `apps/builder/` (TypeScript + Fastify, ESM)

- `apps/builder/package.json` — `"type": "module"`, deps: `fastify`; dev deps: `typescript`, `tsx` (or `ts-node`), `@types/node`. Scripts: `"dev": "tsx server/index.ts"`, `"build": "tsc -p tsconfig.json"`, `"start": "node dist/server/index.js"`. (No web/UI deps — that's Lát 4.)
- `apps/builder/tsconfig.json` — `module`/`moduleResolution` for NodeNext ESM, `target` ES2022, `outDir: dist`, `rootDir: .`, `strict: true`, include `server/**/*`.
- `apps/builder/server/index.ts` — Fastify app, **bind `127.0.0.1` hardcoded** (not env-overridable), port `4123`. One route: `POST /api/dev/run-implement`. Resolve `DIFY_PROJECTS_DIR` = the repo root (default to the dir two levels above `apps/builder/`; allow env override of the path only, never the bind host).

### 3. `apps/builder/server/lib/claude-session.ts` — COPY + STRIP from nexus

Copy `/Users/quyenbt/Desktop/MyProjects/claude-nexus/src/server/lib/claude-session.ts`, then **STRIP** everything not needed:
- **Remove** the multimodal path (`images`/`SessionImage`/`--input-format stream-json`/the JSON stdin branch), `--mcp-config`/`mcpConfigPath`, the `bundleHintPath`/`bundleFallbackCwd` final-cwd race block, all `SWARM_*` env (`SWARM_DRY_RUN`/`SWARM_TASK_ID`/`SWARM_TOKEN`/`SWARM_URL`), all `NEXUS_*` env (`autoApproveGlobs`/`hardBlockGlobs`), `dryRun`, `model`/`systemPrompt`/`appendSystemPrompt`/`allowedTools`/`maxTurns` options.
- **KEEP** exactly: `spawn('claude', args, {cwd, env, stdio:['pipe','pipe','pipe']})`; the **stdin-prompt** write (plain text — `stdin.write(spawnPrompt)` at `:215`, `stdin.end()` at `:217`; rationale comment at `:91`); the **readline NDJSON** parser (`createInterface({input: stdout})` → `JSON.parse(line)` per line → `onEvent`, swallow non-JSON, lines `226-235`); the **`CLAUDE_CODE*` env-clean loop** (`for key in env: if key.startsWith('CLAUDE_CODE') || key==='CLAUDECODE' delete` — lines `127-133`); `--resume <session_id>` support (`resumeSessionId`, kept for Lát 3 `/reply` — must precede the prompt); `onExit`; `capturedSessionId`; `kill`/`forceKill`/`pid`.
- **ADD** the model-C spawn flags to `args` (after `--output-format stream-json --verbose`): `--permission-mode acceptEdits`, `--settings <abs path to apps/builder/headless-settings.json>`, `--setting-sources local`. (Take a `settingsPath` option; do **not** hardcode a relative path — `cwd` is `DIFY_PROJECTS_DIR`, so pass the resolved absolute path.) **Note on `-p`:** nexus's `args` do **not** include `-p`/`--print`, and in 2.1.156 `--output-format stream-json --verbose` runs headless and completes **without** `-p` (init+result emitted, exit 0) — so the copied invocation (no `-p`) is correct. The canonical `claude -p …` string in the spike doc / other prompts is equivalent; don't add `-p` just to match it.
- The logger param can be the Fastify logger or a tiny `console`-shim — your call, but keep it injectable.

### 4. `apps/builder/server/lib/turn-runner.ts` — RE-IMPLEMENT (~20 lines, from nexus)

`claude-session.ts` deliberately lacks turn-end + session_id capture (those live in nexus `task-spawning.ts`). Re-implement a thin `runTurn(session, prompt): Promise<{ sessionId: string|null, result: ClaudeStreamEvent|null, isError: boolean }>`:
- wire `session.onEvent`: on `event.type==='system' && event.subtype==='init' && event.session_id` → set `capturedSessionId` (nexus `:60-64`); on `event.type==='result'` → record it, `isError = !!event.is_error`, resolve (nexus `:148-157`).
- wire `session.onExit`: if no `result` was seen, resolve with `isError:true` + a "process exited code N" note (nexus `:208-220`).
- `await session.spawn(prompt)` then await the promise. **Do not** trust `is_error` as success — §4 of the findings: per-tool `tool_result.is_error=True` does not fail the turn, and `result.is_error:false` ≠ phase success. The post-turn check is authoritative.

### 5. `apps/builder/server/lib/shell.ts` — repo-tool runner

A helper to run repo tools via `${DIFY_PROJECTS_DIR}/.venv/bin/python <args>` with `cwd = DIFY_PROJECTS_DIR`, capturing `{ code, stdout, stderr }` (use `execFile`/`spawn`, never a shell string — avoid injection). This is what post-turn uses to run the 3 linters and `git`.

### 6. `apps/builder/server/lib/post-turn.ts` — the load-bearing verify

Export `postTurnCheck({ projectsDir, slug, workflowFile, taskId })` → `{ ok: boolean, status: 'done'|'error', reasons: string[] }`. Do **both** checks; NEVER trust `is_error` alone.

**(a) Correctness:**
1. **Truncation first** — read `projects/<slug>/workflows/<workflowFile>`; `yaml.safe_load` it (shell out to `.venv/bin/python -c` or a tiny helper script). Parse failure → `error` (truncated/corrupt).
2. **3 linters, each must exit 0** (run via shell.ts, paths are the canonical relative form, cwd = projectsDir):
   ```
   .venv/bin/python skills/mango-svip/scripts/validate_workflow.py projects/<slug>/workflows/<workflowFile>
   .venv/bin/python tools/dify_base/lint_refs.py                    projects/<slug>/workflows/<workflowFile>
   .venv/bin/python tools/dify_base/lint_plugin_hashes.py           projects/<slug>/workflows/<workflowFile>
   ```
   Do **not** branch on a shared exit code — semantics differ per tool (findings/plan). Each non-zero = a reason.
3. **13-digit node-ID regex** — every node `id` must match `^\d{13}$` (validators miss hand-written string IDs — AGENTS.md §4.1). Extract node ids from the parsed YAML; any id failing the regex = `error`.
4. **Artifact non-empty** — file exists and size > 0.

**(b) Confinement:**
- `git -C <projectsDir> status --porcelain` (use shell.ts / `git`, not python). Compute the set of touched paths (tracked-modified **and** untracked).
- **Whitelist** (any path outside → breach): `projects/<slug>/`, `apps/builder/.runs/<taskId>/`, `.vscode/settings.json`, `projects/<slug>/.dify-workspace.yaml`. (The last two are `init_project` side-effects — **pre-provisioned for Lát 2, inert here** since Lát 1 runs no `init_project`. Include them anyway.)
- On any breach: **REVERT it** — `git -C <projectsDir> checkout -- <path>` for tracked, `git -C <projectsDir> clean -fd -- <path>` (or `rm`) for untracked — then return `status:error` with the offending path(s) in `reasons`. **Detection alone is not enough** (model C lets an opaque Bash write land during the turn — findings E2d; #3b must revert, plan Cross-cutting).

### 7. Wire `POST /api/dev/run-implement`

Body: `{ "slug": "...", "workflowFile": "main.yml", "requirement": "...", "seedPath": "..." }` (all dev-supplied; this slice has no scaffold, so `projects/<slug>/workflows/` must already exist — create it if absent before the turn, it is inside the whitelist).
1. Render the **Implement (③)** prompt: read `.claude/skills/dify-build/implement.md`. ⚠ **`implement.md` only contains `{{SLUG}}` `{{WORKFLOW_FILE}}` `{{PRIOR_ARTIFACT}}` `{{SEED_PATH}}`** — it has **no `{{REQUIREMENT}}`/`{{TASK_ID}}`/`{{DEPLOY}}` slot** (the full 7-var set is for later phases; see SKILL.md). It reads `{{PRIOR_ARTIFACT}}` **as SPEC.md** ("the source of truth for what to build"). So **the `requirement` body field must be materialized into a file** and `{{PRIOR_ARTIFACT}}` pointed at it: write the requirement as a one-paragraph mini-`SPEC.md` (e.g. `apps/builder/.runs/<taskId>/SPEC.md` or `projects/<slug>/SPEC.md`), set `{{PRIOR_ARTIFACT}}` = that path, `{{SEED_PATH}}` = the dev seed (or empty). Substituting `{{REQUIREMENT}}` directly is a no-op (no placeholder), so the requirement would silently never reach the turn. The rendered body is the turn prompt fed via stdin.
2. `runTurn(...)` with a fresh `ClaudeSession` (settings path = absolute `apps/builder/headless-settings.json`, cwd = `DIFY_PROJECTS_DIR`, a `taskId` you mint).
3. `postTurnCheck(...)`.
4. Respond `{ taskId, sessionId, turnIsError, status, reasons, workflowPath }`.

## Acceptance

Run the demo, then tick each box. Map to spec **AC #4** (Implement correctness) and **AC #10** (no hang under model C).

```bash
# build + boot
cd /Users/quyenbt/Desktop/MyProjects/dify-projects/apps/builder
npm install && npm run build && npm start &     # binds 127.0.0.1:4123
# (or: npm run dev)
```

```bash
# happy path — one curl (pick a real seed/pattern from templates/patterns/*.yml)
curl -sS -XPOST http://127.0.0.1:4123/api/dev/run-implement \
  -H 'content-type: application/json' \
  -d '{"slug":"lat1_probe","workflowFile":"main.yml",
       "requirement":"Build a minimal 2-node workflow (start → end) per the seed.",
       "seedPath":"templates/patterns/<some-pattern>.yml"}'
```

- [ ] **(AC #4)** The curl returns `status:"done"`; `projects/lat1_probe/workflows/main.yml` **appears**, is non-empty, and **all 3 linters exit 0** (`validate_workflow.py` + `lint_refs.py` + `lint_plugin_hashes.py`).
- [ ] **(AC #4)** Every node `id` in the produced YAML matches `^\d{13}$` (minted by `generate_id.py`, not hand-written) — the post-turn regex passes.
- [ ] The captured `sessionId` is a non-null UUID (from `system/init`) and the turn ended on a `result` event (turn-end parse works).
- [ ] **(AC #10)** The turn ran its repo commands and wrote the file **without hanging** on any permission prompt and the process exited — proving `--permission-mode acceptEdits` + `--settings apps/builder/headless-settings.json` + `--setting-sources local` (host **and** project `.claude` layers, incl. the `permission-gate.js` hook, excluded). Near-miss / out-of-allowlist behavior under model C is non-blocking (no fail-fast), consistent with the spike.
- [ ] **(confinement, the crux)** Re-run with a **deliberately seeded out-of-confinement write**: have the requirement instruct an opaque write outside the whitelist, e.g. append to the requirement *"…then run `python3 -c \"open('tools/x','w').write('x')\"`"* (mirrors findings E2d — this escapes the deny-list). Result: `status:"error"`, `reasons` names `tools/x`, **and `tools/x` is gone afterward** (`ls tools/x` → No such file). Verify:
  ```bash
  git -C /Users/quyenbt/Desktop/MyProjects/dify-projects status --porcelain   # clean outside whitelist
  ls /Users/quyenbt/Desktop/MyProjects/dify-projects/tools/x 2>&1 | grep -q 'No such' && echo "REVERTED ✅"
  ```
- [ ] After both runs, `git status` for the repo is clean of any write **outside** `{projects/lat1_probe/, apps/builder/}` (the probe project + the app are expected; nothing in `tools/`, `skills/`, `.venv/`, `.git/`, another `projects/*`).

When all boxes pass: clean up the throwaway probe — `rm -rf projects/lat1_probe` (it is not a committable artifact) — then commit **locally only** the `apps/builder/` skeleton (settings + package/tsconfig + `server/**`). Do **not** push; do **not** `--no-verify`. If pre-commit touches `.vscode/settings.json`, that's the whitelisted side-effect — fine.

## On blocker

- **`claude` headless hangs / never returns a `result`** → confirm `claude auth login` was done; confirm the spawn args match the §5 canonical invocation exactly (stdin prompt, not `-p "text"`); confirm `--setting-sources local` is present (without it the host/project `permission-gate.js` hook can stall the turn up to 31 min — findings §2). Do not work around a hang by removing isolation.
- **A spike-untested deny form misbehaves** (the `//absolute` / `~/home` patterns in §5 were flagged untested) → the **confinement #3b check is the real boundary anyway**; record the observation (it's a Lát-1 known-gap to confirm, plan (f)) and rely on the post-turn revert, not the deny-list.
- **`yaml.safe_load` / a linter reports a parse error** on a truncated file → that is a *correct* `error` result (truncation), not a bug in your harness — surface it in `reasons`.
- **The Implement turn cannot make linters pass in its 5-pass loop** → that is an engine/prompt outcome, not a Lát-1 failure; the harness must still return cleanly with `status:"error"` + the last linter reason. Report it; don't paper over it.
- If anything contradicts the spike findings or the plan's Lát 1 contract → STOP and surface it; do not reshape the model to fit.

## Guardrails

- **Permission MODEL C only** — the exact spawn is `claude -p --output-format stream-json --verbose --permission-mode acceptEdits --settings apps/builder/headless-settings.json --setting-sources local`, prompt via **stdin**. Never `dontAsk`, never an `--allowedTools` fail-fast allowlist, never omit `--setting-sources local`.
- **Never run `sync.py`** and never touch a Dify token — Dify I/O is backend-owned and entirely out of scope for this slice (no token anywhere).
- **Phase = one fresh turn** handed the seed/SPEC **path**; no cross-phase `--resume` (kept only for a future in-phase `/reply`). No chaining here.
- **`headless-settings.json` is copied verbatim from findings §5** — do not redesign or "improve" the deny-list; hardening is Lát 5's job.
- **Localhost only**: bind `127.0.0.1` hardcoded, port `4123`. Don't make the bind host env-overridable.
- **Confinement #3b must REVERT, not just flag** — a detected-but-unreverted breach is a failing implementation (it leaves the leak on disk).
- No UI, no SSE, no gate, no `init_project`/scaffold. The two `init_project` paths (`.vscode/settings.json`, `.dify-workspace.yaml`) appear in the whitelist only to pre-provision Lát 2 — they are inert here.
- **No spec edit is owed by this slice** (plan ledger (g) = "None new"). While implementing, *confirm* the §A turn-I/O shape against the Lát-0 `init`/`result` findings; if it diverges, note it for the Lát 2 ledger row — do not silently edit the spec.
- Commit **locally** only after every acceptance box passes; do not push.
