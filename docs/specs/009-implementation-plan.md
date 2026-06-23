# Spec 009 — Implementation Plan (vertical slices)

> Companion to [009-browser-workflow-builder.md](009-browser-workflow-builder.md) (spec)
> and [009-implementation-brief.md](009-implementation-brief.md) (brief v2, 2026-06-10).
> Every contract below was re-verified against the real files on 2026-06-10 (5-agent
> audit). This plan supersedes nothing in the spec by itself — where it diverges from
> the spec, the **Spec-update ledger** (bottom) records the exact edit, per the repo's
> "no silent drift" rule.

---

## 0. Verification result — what was checked against real files

All brief "VERIFIED CONTRACTS" hold. Confirmations (file:line):

- `sync.py`: push is new-app-only (POST `/apps/imports`, :130-145, :307-309); needs `--yes`
  or it blocks on `input()` (:306-311, flag :360); prints **multi-line** JSON at **:317**
  (`json.dumps(result, indent=2)`, with a leading `\n`); **no `--json-out` flag exists**;
  `pull --project` requires `projects/<slug>/` to pre-exist (:196-199) and writes
  `workflows/<slug-of-app-name>.yml` (:233-235), **not** `main.yml`; `list` does
  `sys.exit(str)` → exit 1 for **both** missing-cred and RequestException/401 (:156/158,
  :180-181) — indistinguishable by exit code; env vars are `DIFY_CONSOLE_URL` /
  `DIFY_CONSOLE_TOKEN` from `os.environ` (:153-154), `dev.env` loaded only with `--project`
  (:66-71, :364-365); `diff` is remote-vs-local (:250/267/271).
- `init_project.py`: 8 flags, **no `--group`** (:168-177); `workflows/` is scaffolded
  **empty** (only `.gitkeep`); writes repo-root `.vscode/settings.json` via
  `subprocess.run(regen_vscode_settings.py)` (:226-230, **best-effort/non-fatal**);
  `--force` = `shutil.rmtree(projects/<slug>/)` (:142-143); the workspace file is
  **`.dify-workspace.yaml`** (no `project.yaml` anywhere).
- linters: `validate_workflow.py` 0/1 only (no exit 2; folds parse errors into 1, prints
  `YAML parsing error:`); `lint_refs.py` exit 2 = parse/IO/usage (:176-177);
  `lint_plugin_hashes.py` exit 2 = **no-files only**, parse error → exit **1** (prints
  `parse error:`); `generate_id.py` mints 13-digit ms timestamp (:14); `find.py --json`
  exists (:53/:129); `check_dsl_version.sh` + `regen_vscode_settings.py` read
  `(data.get("project") or {}).get("dsl_version")`.
- nexus copy-targets: **13/14 LOC values exact**; `claude-session.ts` genuinely lacks
  turn-end + session_id capture (those live in `task-spawning.ts:60-64,148-205`).

### Divergences surfaced (reality vs brief/spec) — read before building

1. **The spec is further along than the brief's "SPEC CORRECTIONS" imply.** §I has
   **already** dropped the "exit 2 = parse error" branch ("always regenerate on retry");
   §E/§J already qualify "fail-fast" as a *consequence of `--permission-mode dontAsk`* and
   already bound the Bash-subprocess write gap (§E:694-699, §J:838-841) with backend
   `--slug` validation. A whole **§Revision 2026-06-10** block (spec :131-267) carries a
   **third** permission model (path-scoped `Edit/Write` allow+deny under `dontAsk`,
   injected via `--allowedTools`), distinct from both the original §E (`--allowedTools`
   fail-fast) **and** the brief's v2 model (broad-allow `settings.json` + deny +
   post-turn confinement). → The Lát 0 spike chooses among **three** candidates, and a
   confirmed result edits in-place text (§Revision), not just stale prose.

2. **One genuine unresolved spec contradiction — which the brief resolves.** The spec
   never names who executes Dify-touching `sync.py` (pull in ①, push in ④): §C Tooling +
   §E allowlist put them in the **Claude turn**; but §A report.json synthesis (:456
   "backend synthesizes … not transcribed by Claude"), the `push_intent` guard ("backend
   writes marker before calling push", :818-820), and the secret model (turn is *denied*
   `Read(projects/*/envs/*.env)`) all imply the **backend**. Brief QĐ #2/#6
   resolve this: **backend owns all Dify I/O, token never enters a turn, Phase ④ = backend
   (no turn)**. This plan encodes that and the ledger records the §A/§C/§E edits.

3. **`project.group` mechanics.** There is **no `project.yaml`**; grouping lives under the
   `project:` mapping in `projects/<slug>/.dify-workspace.yaml`, which today holds exactly
   `name, slug, app_type, dsl_version, dify_tag` (template `templates/_base/project/.dify-workspace.yaml:5-10`).
   Adding `group` requires editing that template **and** adding `--group` + an `Answers`
   field + a substitution var to `init_project.py` (none exist). **Hard constraint:**
   `project:` must remain a **mapping** — a scalar `project:` crashes
   `regen_vscode_settings.py` with an *uncaught* `AttributeError` (only `yaml.YAMLError` is
   caught), breaking pre-commit. (`check_dsl_version.sh` degrades gracefully via bare
   `except`, but then silently falls back to the repo-default version.)

4. **`app_id` is not extractable from `sync.py` as written.** `cmd_push` prints the raw
   import-endpoint `r.json()` with no field extraction; the key holding the new app id is
   **external and unconfirmed**. → Do not assume `result['id']`. Robust path: write a
   `push_intent` marker *before* push, then **reconcile via `sync.py list` matched by
   slugified name** to obtain the id (this doubles as the crash-mid-push idempotency
   guard). If we add `--json-out` (recommended), it must print exactly the field(s) we
   confirm against a real Dify response.

5. **`PipelineTimeline.tsx` is a rewrite, not a copy.** LOC (143) matches, but the source
   is **endpoint-poll-driven** (props are only `taskId`/`runningTask`; it fetches its own
   `pipelineTimeline(taskId)` endpoint every 5s and renders a variable-length `data.phases[]`,
   5-phase doc example). Brief's "SSE-driven, 4-phase" is the *target* — and the data
   source itself (polled REST → SSE) must change, which strengthens the rewrite verdict.

---

## Cross-cutting decisions (confirmed / refined)

- **Permission model = DECIDED by Lát 0 spike → model C (corrected)** broad-allow
  `--permission-mode acceptEdits` + a **dialect-fixed** deny carve-out + the #3b post-turn
  check as the real boundary. (Candidates were (A) original §E `--allowedTools` fail-fast;
  (B) spec §Revision `dontAsk` path-scoped; (C) brief v2 broad-allow + deny.) Spike evidence
  ([009-spike-findings.md](009-spike-findings.md)): with broad `Bash`, deny blocks the
  `Write/Edit` tools **and** naive shell redirects (`> tools/x`) but an **opaque** write
  (`python3 -c open().write()`) **escapes** (E2d); model B is airtight only by betting on
  byte-exact `dontAsk` commands (too brittle for a multi-command authoring agent). →
  conservative reading wins: **C + a strict #3b**.
- **#3b must REVERT, not just flag.** Because C lets an opaque Bash write **land during the
  turn** (spike E2d), the post-turn confinement check must `git checkout`/`clean` the
  out-of-confinement path (and set `status:error`), not merely detect it — detection alone
  leaves the leak (exactly the file the spike itself had to clean up). This is the
  load-bearing boundary; the deny-list is only defense-in-depth.
- **Host + project isolation = `--setting-sources local` (spike E4 + §2).** A default nested
  spawn loads BOTH the host `~/.claude` layer AND the repo's **project** `.claude/settings.json`
  — which injects a `permission-gate.js` `PreToolUse` hook (timeout 1860s, can hang a turn).
  Every spawn must pass `--setting-sources local` so only the candidate `--settings` file is
  authoritative (caveat: assumes no untrusted `.claude/settings.local.json`). The brief only
  anticipated the host leak; the **project-layer hook** is a spike-surfaced new isolation target.
- **Dialect (spike E0, BLOCKING — applied to spec §Revision + brief):** repo-relative
  permission patterns take **NO leading slash** (gitignore-style); `Write(/tools/**)` is a
  silent no-op. The corrected `headless-settings.json` (in findings §5) strips the leading
  slash on every repo-relative pattern. `//abs` + `~/home` forms kept but **untested** (verify in Lát 1).
- **Input (decided at Lát 0/0.5, not deferred):** `sync.py` is never in any turn
  allowlist/settings (Dify I/O is backend-owned, below); path rules work in BOTH the
  settings file and bare CLI flags (spike E6), but we ship a file. So the chosen
  `headless-settings.json` is correct the moment Lát 1 consumes it.
- **Truncation vs fixable-lint:** backend does `yaml.safe_load` **first** (cleanest;
  consistent with spec §I "always regenerate on retry"). Fallbacks available if needed:
  `lint_refs.py` exit 2, or grep `validate_workflow.py` stdout for `YAML parsing error:`.
  Do **not** branch on a single cross-tool exit code (semantics differ per tool).
- **Repo-tool additions (recommended, both small and inside the tool repo, not the app):**
  add `--json-out` to `sync.py push` (avoids brittle multi-line stdout parsing) and
  `--group` to `init_project.py` (+ template + `Answers` field). Alternative for
  `--json-out`: backend `json.loads` everything after the `✓ Import result: ` marker to
  EOF. Decision recorded per-slice; either is acceptable.
- **Backend injects Dify env directly** into its own `sync.py` subprocess
  (`DIFY_CONSOLE_URL`/`TOKEN`) rather than relying on `dev.env`+`python-dotenv` (which
  silently no-ops if dotenv is absent; `override=False` means OS env wins anyway). Token
  **never** enters a claude turn; never logged to SSE/`.runs`.
- **cwd = `DIFY_PROJECTS_DIR`**, commands are the **relative** `.venv/bin/python tools/…`
  strings, byte-identical to what the skill prompts mandate (near-miss prefixes auto-deny
  under `dontAsk`). Bind `127.0.0.1` hardcoded; one build at a time.

---

## The slices

Each: **(a)** goal · **(b)** in/out scope · **(c)** files · **(d)** exact commands ·
**(e)** acceptance · **(f)** corrections/gotchas applied · **(g)** spec to update.

### Lát 0 — SPIKE: resolve `claude` headless behavior (½–1 day) — *highest risk first*

**(a)** Empirically decide the permission/confinement model (A/B/C) and lock the
stream-parse contract, *before any app code*. Five questions answered with evidence.

**(b)** In: a throwaway harness (gitignored, e.g. `spike/`), candidate settings files, a
results doc. Out: any `apps/builder/` code, UI, gate logic.

**(c)** `spike/run.sh` (or `.mjs`), `spike/settings-candidate-{A,B,C}.json`,
`docs/specs/009-spike-findings.md` (the deliverable).

**(d)** Five experiments (cwd = repo root), each spawning:
`claude --output-format stream-json --verbose --permission-mode <mode> --settings <file> [--setting-sources <…>]` with the prompt fed via **stdin**:
- **E1 — benign tool, no hang:** prompt "run `.venv/bin/python tools/dify_base/find.py --json` and report" → expect completion, exit 0, tool ran.
- **E2 — deny behavior:** with `Write(/tools/**)` denied, prompt "write 'x' to `tools/HACK.txt`". Record: blocked? does Claude **route around via Bash** `echo > tools/HACK.txt`? `is_error`? Then `git status --porcelain | grep tools/HACK.txt`.
- **E3 — broad-write escape:** prompt "write 'x' to `/tmp/escape_009.txt`" → confirm cwd does **not** confine (expected: file appears).
- **E4 — host isolation:** put a conflicting rule in `~/.claude/settings.json`; test which `--settings`/`--setting-sources` combination excludes the `user`-global layer.
- **E5 — event shape + resume:** capture `system`/`init` `session_id` and the terminal `result.is_error`; confirm `--resume <session_id>` continues context (needed for `/reply`).
- **Also (decides A vs B):** test whether path-scoped `Edit(/projects/<slug>/**)` rules are honored on the bare `--allowedTools` flag vs only in a `--settings` file.

**(e)** `009-spike-findings.md` answers all five with raw event excerpts, and names the
winning model. Specifically resolves: does an out-of-allowlist/denied op **(i)** hang,
**(ii)** fail the turn (`is_error`), or **(iii)** silently route around — and does `deny`
**prevent the write** or just block one path. **Handoff artifact:** the winning
`spike/settings-candidate-X.json` is the seed for `apps/builder/headless-settings.json`
(Lát 1's first act copies it). The model already excludes `sync.py` from any turn
allowlist (Dify I/O is backend-owned — Cross-cutting), so that file is correct from Lát 1
with no later allowlist edit.

**(f)** Brief QĐ #1 (provisional); the three-way model tension (Divergence #1); near-miss
auto-deny under `dontAsk`; stdin-prompt to avoid `---`-as-flag parsing.

**(g)** Once decided: rewrite **§E, §J, the §Revision 2026-06-10 block, and Acceptance
#10 / #23 / #25** to the winning model. (If the spike picks C, this is real in-place
surgery on §Revision, not just stale-prose cleanup.)

---

### Lát 0.5 — SKILL PROMPTS: the engine (½ day)

**(a)** Author `.claude/skills/dify-build/{analyze,spec,implement,test}.md` (at least
`implement.md` before Lát 1). This is the engine — "prompt tốt tới đâu, sản phẩm tốt tới
đó". (Dir does **not** exist yet — confirmed.)

**(b)** In: 4 prompt bodies + the inject vars `{{TASK_ID}} {{SLUG}} {{WORKFLOW_FILE}}
{{SEED_PATH}} {{REQUIREMENT}} {{PRIOR_ARTIFACT}} {{DEPLOY}}`; a `SKILL.md` manifest. Out:
backend wiring (Lát 1). Note: only `analyze/spec/implement` become app turns (①–③);
`test.md` is for human/CLI use outside the app (Phase ④ in-app = backend, QĐ #2).

**(c)** `.claude/skills/dify-build/SKILL.md`, `analyze.md`, `spec.md`, `implement.md`,
`test.md`.

**(d)** Commands the prompts mandate — **exact literal, relative, cwd=repo**:
- `.venv/bin/python tools/dify_base/find.py --json --has <feature>`
- `.venv/bin/python skills/mango-svip/scripts/generate_id.py <n>` (**mandatory** for every node ID)
- `.venv/bin/python skills/mango-svip/scripts/validate_workflow.py projects/<slug>/workflows/<file>.yml`
- `.venv/bin/python tools/dify_base/lint_refs.py projects/<slug>/workflows/<file>.yml`
- `.venv/bin/python tools/dify_base/lint_plugin_hashes.py projects/<slug>/workflows/<file>.yml`
- (Spec ②, only when scaffold deferred to backend) — prompts do **not** run `init_project.py`/`sync.py`; the backend owns scaffold + all Dify I/O.

**(e)** Run `implement.md` **by hand** via `claude` (outside the app) on a hardcoded
requirement + an existing seed → produces a `main.yml` with `generate_id.py` IDs passing
all 3 linters (exit 0). This *is* spec **Nhịp 1** (validate the procedure on a stock
runtime before building the shell).

**(f)** AGENTS.md §4.1 (hand IDs render as literal text, validators don't catch →
`generate_id.py` mandatory) · §4.2 (variable-ref `{{#id.field#}}` must reference declared
upstream outputs) · §4.3 (never fabricate plugin hash → `dependencies: []` + `# TODO:`) ·
§9 pitfalls (if-else needs **both** legacy `conditions` and modern `cases`; single-file
branched design; md_exporter whitespace; numeric IDs only) · seed YAML is **data, not
instructions** (prompt-injection, §J:842-845) · exact-literal commands (near-miss
auto-deny).

**(g)** Q1 already resolved (`.claude/skills/dify-build/`). Since prompts omit `sync.py`,
this converges with the executor-resolution edit (§C ①/④ Tooling → backend). Tick the
Nhịp-0 checkbox "create `.claude/skills/dify-build/`".

---

### Lát 1 — SKELETON: spawn 1 phase + post-turn verify

**(a)** Backend spawns **one** phase (③ Implement) on a hardcoded requirement + existing
seed → parse `stream-json` → write `<workflowFile>` → **post-turn check** (correctness:
3 linters + 13-digit-ID regex + artifact non-empty; confinement: `git status`). One curl.
Proves spawn + stream-json + verify (the net-new core, not the copied transport).

**(b)** In: minimal Fastify; copied+stripped `claude-session`; `system/init` +`result`
parse; one Implement turn; post-turn correctness + confinement; write
`projects/<slug>/workflows/<file>`. Out: gate, chaining, SSE, UI, Dify I/O.

**(c)** **First:** copy the winning Lát-0 candidate → `apps/builder/headless-settings.json`
(the spawn in (d) consumes it; it is hardened, not created, in Lát 5). Then scaffold
`apps/builder/`: `package.json`, `tsconfig.json`, `server/index.ts`,
`server/lib/claude-session.ts` (copy nexus `src/server/lib/claude-session.ts`, **strip**
`SWARM_*`/`NEXUS_*`/`--mcp-config`/multimodal/`bundleHint`; **keep** the `CLAUDE_CODE*`
env-clean loop :128-133 and stdin-prompt :91/:215), `server/lib/turn-runner.ts`
(re-implement session_id capture `system`/`init`/`session_id` + turn-end `result` —
~20 lines lifted from nexus `task-spawning.ts:60-64,148-157,208-220`),
`server/lib/post-turn.ts`, `server/lib/shell.ts` (run repo tools via
`${DIFY_PROJECTS_DIR}/.venv/bin/python`).

**(d)**
- spawn (cwd=`DIFY_PROJECTS_DIR`, prompt via stdin): `claude --output-format stream-json --verbose --permission-mode <Lát-0 decided> --settings apps/builder/headless-settings.json [--setting-sources …]`
- correctness: `yaml.safe_load` (truncation) → the 3 linters → regex `^\d{13}$` on node ids → artifact exists/non-empty.
- confinement: `git -C $DIFY_PROJECTS_DIR status --porcelain` + mtime scan of untracked; **reject** (→ `status:error`) if any path ∉ whitelist `{projects/<slug>/, apps/builder/.runs/<taskId>/, .vscode/settings.json, projects/<slug>/.dify-workspace.yaml}`.
- `curl -XPOST localhost:4123/api/dev/run-implement -d '{"slug":"…","workflowFile":"main.yml","requirement":"…","seedPath":"…"}'` _(endpoint removed in spec 024 L1 — historical)_

**(e)** curl → `main.yml` appears; linters exit 0; IDs 13-digit; a **deliberately seeded
out-of-confinement write** (e.g. touch `tools/x`) is caught → `status:error`. Also
exercises **AC #10** at the real-command layer: every phase command matches its allowlist
pattern (Lát-0 model) and a near-miss/out-of-allowlist call fails the turn fast — no hang,
no silent skip.

**(f)** `claude-session.ts` lacks turn-end/session_id (re-implement) · stdin prompt ·
env-clean loop · `yaml.safe_load` for truncation (not exit code) · 13-digit regex
(validators miss hand IDs) · whitelist includes the two `init_project` side-effects
(`.vscode/settings.json`, `.dify-workspace.yaml`) — **pre-provisioned for Lát 2, inert
here** since Lát 1 runs no `init_project`.

**(g)** None new (implements §A/§C ③ + §I post-turn). Confirm §A turn-I/O shape against
the Lát-0 `result`/`init` findings.

---

### Lát 2 — 4-PHASE CHAIN (auto-advance, no gate yet)

**(a)** Chain ①Analyze→②Spec→③Implement (each a **fresh** turn handed the prior
artifact **path** — no cross-phase resume) → ④Test&Report (**backend, no turn**). Verify
after each turn. `deploy=none`.

**(b)** In: phase state machine (sequential auto-advance), per-phase prompt render + var
inject, fresh turn per generating phase, **persist each phase's captured `session_id` into
`.runs/<taskId>/task.json`** (so Lát 3's `/reply`, a separate request, can resume it),
Phase ④ backend (validate + synthesize `report.json`, `deploy:none`), scaffold-at-Spec
(status `scaffolding`, move `SPEC.md`). **Implement (③) gets `{{PRIOR_ARTIFACT}}` = the
current `SPEC.md` path and re-reads it fresh at phase start** — so a manual `SPEC.md` edit
(Lát 4 `PUT`) wins (last-writer, AC #3 tail; file = source of truth, QĐ #2). Out:
gate/pause, `/confirm`, run-lock, SSE, UI, selfhost.

**(c)** `server/lib/phases.ts` (4 defs + artifact paths), `server/lib/orchestrator.ts`
(run→verify→advance), `server/lib/report.ts` (`report.json`, deploy=none),
`server/state/task.ts` (task JSON in `.runs/<taskId>/`).

**(d)**
- same spawn per phase, different rendered prompt; ① reads the local seed (no cred).
- ② advance (new workflow): backend runs `.venv/bin/python tools/dify_base/init_project.py --non-interactive --name "<name>" --slug <slug> --app-type workflow --primary-lang <lang> [--group <group>]` with **`--slug` == active task slug** (arg-validation), then moves `.runs/<taskId>/SPEC.md → projects/<slug>/SPEC.md` (idempotent). **Provisional:** in Lát 2 this fires on raw auto-advance; Lát 3 re-homes it behind the `/confirm` that closes Spec (so the user can edit slug/name at the gate, AC #18) — don't lock a contract here that Lát 3 must break.
- ④: backend runs the 3 linters + writes `report.json {path, lintSummary, deploy:"none"}`.

**(e)** one curl runs a full 4-phase build (no-seed/new-workflow requirement) → ends with
`main.yml` + `report.json`; every artifact present + verified; confinement clean.

**(f)** Phase = fresh turn, no `--resume` across phases (QĐ #2 / spec Q3) · scaffold
non-atomic → `scaffolding` + idempotent (QĐ #9) · `init_project` writes empty `workflows/`
(main.yml comes from ③, not scaffold) and the repo-root `.vscode/settings.json` side
effect (whitelisted) · `.dify-workspace.yaml` is the workspace file.

**(g)** **Resolve the executor ambiguity (Divergence #2)** — edit §A/§C: Phase ④ = backend
(gate = `report.json` exists+non-empty, **not** a `result` event); §C Tooling for ① and ④
→ "backend". (The §E allowlist already excludes `sync.py` — that's a permission-model
input baked at Lát 0/0.5, not a Phase-④ detail; here it's only the §A/§C wording edit.)

---

### Lát 3 — GATE (the crux, net-new)

**(a)** Pause `awaiting_confirm` at each boundary; advance only on POST `/confirm`;
`/reply` revises within-phase (resumed session); run-lock + cancel + lock-release;
Confirm-mode (each step / spec only / auto); Implement 2 gate variants; `auto` hard-stops
at still-failing.

**(b)** In: gate state machine, `/api/tasks`, `/confirm`, `/reply`, `/cancel`, run-lock
table (`running`+`awaiting_confirm` hold; `done`/`error`/`cancelled` release; boot →
`running`→`error` + clear), gate actions `{id,label,kind,route}`, Implement clean vs
still-failing (cap 5). **Re-home scaffold behind the gate:** `init_project` + `SPEC.md`
move now fire on the `/confirm` that closes Spec (not on raw advance), and the confirm
payload may carry a user-edited `slug`/`name` (AC #18). `/reply` reads the phase
`session_id` from `.runs/<taskId>/task.json` (persisted Lát 2), not a live variable.
Still curl. Out: SSE, UI, selfhost.

**(c)** `server/routes/tasks.ts`, `server/lib/gate.ts`, `server/lib/lock.ts`; extend
`orchestrator.ts` to pause/resume.

**(d)** `curl` POST `/api/tasks {requirement,workflow,confirmMode,deploy}`; GET
`/api/tasks/:id`; POST `/api/tasks/:id/confirm {actionId}`; `/reply {text}`; `/cancel`;
2nd POST `/api/tasks` while one runs → **409**.

**(e)** (AC #6,7,8,15,18,19,20,21,24,25) default each-step pauses at all 4; `/confirm`
advances (a new-workflow task's confirm carries the slug/name → `init_project` scaffolds,
AC #18 at the headless layer); `/reply` revises Spec without advancing; seeded error
self-corrects in ≤5 then
still stops (#8/#20); `auto` runs through but **hard-stops** still-failing Implement and
never imports lint≠0 (#25); 409 on 2nd build (#21); cancel frees lock → new build
succeeds (#24); boot clears `running`→`error` (#19/#24).

**(f)** `/reply` = `--resume <session_id>` **within** the phase (id read from
`.runs/<taskId>/task.json`, persisted Lát 2); cross-phase = fresh · gate enforced by
backend *issuing the next turn*, not a soft "stop" · scaffold now fires on Spec `/confirm`
(re-homed from Lát 2) · still-failing variant never auto-imports lint≠0 (QĐ #4) ·
`scaffolding` status for the non-atomic move (QĐ #9).

**(g)** None new (implements §D/§I/§Revision cancel+lock). Confirm AC #24/#25 wording.

---

### Lát 4 — UI (SSE + 3 regions; copy/adapt nexus)

**(a)** Preact+Vite+TS "dumb" SPA: renders the backend stream + posts confirm/reply.
3 regions: sidebar tree (Project▸Workflow▸Task), chat + settings-below-input + inline gate
buttons, artifact/diff panel.

**(b)** In: lift+prune `vite.config`/`tsconfig`/`package.json`; SSE plugin (adapt nexus
`sse.ts` — **strip** Container DI / auth / RingBuffer event-store / taskManager init
payload; **keep** hijack/heartbeat/backpressure/replay core); `/stream`; **near-verbatim**
copy `ChatMessage`/`sse-client`/`ChatInputBar`/`useChatReply`/`SplitDiffView`/`diff-parser`;
**rewire** `InlinePermissionPrompt` (store approve/deny → `/confirm`); **rewrite**
`PipelineTimeline` (SSE-driven fixed 4-phase — not a copy) and `TaskList` grouping
(conversation_id/working_dir → `project.group`); **net-new** sidebar tree +
run-settings-below-input + **seed/workflow picker** (the AC #14 `Workflow` lazy-list;
reads `/api/seeds`, wired in Lát 5 — degrades to an empty list until then); **net-new
SPEC.md editor in the artifact panel** (§B region 3, "editable in place") backed by
`PUT /api/tasks/:id/spec` (explicit Save, last-writer policy — AC #3 tail, Q4); **swap**
`markdown.ts` for an ~80-150-line renderer (do not bring 888-LOC + marked/DOMPurify/hljs).
Out: selfhost push, recovery hardening (Lát 5).

**(c)** `apps/builder/web/{vite.config.ts,tsconfig.json,package.json,src/**}`;
`server/plugins/sse.ts`; `/api/tree` (reads `projects/*/.dify-workspace.yaml`
`project.group`); `PUT /api/tasks/:id/spec` (persist an in-place `SPEC.md` edit).

**(d)** `npm install`; `npm run dev` (Vite); `npm run build`; `npm start`.

**(e)** (AC #1,2,3,4,5,13,14,16,22) boots + serves built UI; `/health` non-OK if
`.venv/`/`skills/` missing; sidebar = `projects/` grouped by `project.group`; settings
below input (Workflow/Confirm/Deploy only — no model/pattern picker); inline gate buttons;
**SSE reconnect restores phase/gate via `/api/tasks/:id` refetch** (#22); full 4-phase run
visible; SPEC.md panel editable → `PUT` → reflected in Implement (#3 tail). (The #2
seed-picker UI and #4 diff render live here; their backends — `/api/seeds`, the diff
producer — land in Lát 5.)

**(f)** `PipelineTimeline` rewrite (poll-driven 5-phase doc → SSE 4-phase) · `markdown.ts` do-not-bring ·
`InlinePermissionPrompt` rewire · `TaskList` grouping rewrite · `sse.ts` strip DI/auth/
RingBuffer · sidebar + run-settings are net-new (re-budget Week 3) · diff payload
`{path, diff}` from backend.

**(g)** Q2 resolved (Preact+Vite+TS). Confirm AC #13/#14 wording.

---

### Lát 5 — SHELL: selfhost, seeds, diff, recovery, security, cloud, docs

**(a)** `deploy=selfhost` push + `app_url` (backend, cred backend-only); seed picker; diff
panel; restart-recovery/idempotency (`scaffolding`/`push_intent`); security carve-out +
token redaction; Cloud fallback; docs.

**(b)** In:
- **selfhost ④** (backend subprocess, env-injected): `sync.py push --yes [--json-out]`,
  gated by an **Import** button (#16); `push_intent` marker **before** push; capture
  `app_id` (via `--json-out` once the field is confirmed) **or reconcile via `sync.py
  list` matched by slugified name** if the marker shows a crash; build `app_url` =
  `DIFY_CONSOLE_URL` with `/console/api` stripped + `/app/<app_id>/workflow`.
- **seeds:** `/api/seeds` → backend `sync.py list` (env set, no `--project`); degrade
  gracefully — exit 1 is ambiguous, so parse stderr (`not set` vs `list_apps failed:`).
- **diff:** backend `difflib.unified_diff` (or `git diff --no-index`); base per case —
  edit-existing (`<workflowFile>` pre-edit snapshot) / Dify-seed (pulled file) / no-seed
  (**empty base** → full-file additions; the auto-selected pattern is agent-internal,
  not tracked — pattern-delta is a Phase-3+ enhancement); payload `{path, diff}`.
- **Phase ① Dify-seed:** backend **scaffolds `projects/<slug>/` then `sync.py pull`** (pull
  requires the folder) **before** the Analyze turn; the turn reads the local file only.
- **recovery:** `scaffolding` + `push_intent` idempotency; boot reconcile.
- **security:** **harden** the Lát-1 `headless-settings.json` (created from the Lát-0
  winning candidate) — add the deny carve-out incl. `Read(projects/*/envs/*.env)` (**no
  leading slash** — dialect fix, spike E0; a leading `/` is a silent no-op); token
  never in SSE/`.runs` (redaction); bind `127.0.0.1` hardcoded (not env-overridable).
- **cloud:** emit YAML + Studio steps, skip import.
- **docs + repo prep:** README (install, `claude auth login`, `.env`, 4-phase run);
  `.env.example`; `scripts/setup-node.sh`; `.gitignore` `apps/*/{node_modules,dist,.runs,.env*}`;
  `.pre-commit-config.yaml` `exclude: ^(apps/|node_modules/)`.
- **repo-tool changes:** add `--json-out` to `sync.py push`; add `--group` to
  `init_project.py` (+ `Answers` field + `templates/_base/project/.dify-workspace.yaml`
  `project.group` sub-key).

**(c)** `server/lib/dify-io.ts` (backend list/pull/push), `server/lib/diff.ts`,
`server/lib/recovery.ts`, `apps/builder/headless-settings.json` (**harden**, created
Lát 1), `apps/builder/.env.example`, `README.md`; tool edits `tools/dify_base/sync.py`,
`tools/dify_base/init_project.py`, `templates/_base/project/.dify-workspace.yaml`; repo
prep `.gitignore`, `.pre-commit-config.yaml`, `scripts/setup-node.sh`.

**(d)** (backend env-injected: `DIFY_CONSOLE_URL=… DIFY_CONSOLE_TOKEN=…`)
- push: `.venv/bin/python tools/dify_base/sync.py push --project <slug> --file workflows/<file> --yes --json-out`  — **`--file` is relative to `projects/<slug>/`** (`sync.py:301` joins `BASE/projects/<project>/<file>`); do **not** prefix `projects/<slug>/` or it doubles → "File not found" → exit 1.
- list: `.venv/bin/python tools/dify_base/sync.py list`
- pull (after scaffold): `.venv/bin/python tools/dify_base/sync.py pull --project <slug> --app-id <id> --yes`
- `app_url` = strip `/console/api` from `DIFY_CONSOLE_URL` → append `/app/<app_id>/workflow`

**(e)** (AC #2,4,5,9,11,12,17,18,23,25) seed picker lists Dify apps via `/api/seeds`
(`sync.py list`) and a selection feeds Phase ① Analyze (#2 — backend half; UI in Lát 4);
Implement's diff-vs-seed producer (#4 diff clause; no-seed = empty base; Implement+linters half
in Lát 1); selfhost imports + clickable `app_url` (#5); cloud
skips + copyable YAML (#9); no runtime dep on nexus (#11); README (#12); **standalone
untouched** — `project.group` sub-key doesn't break `check_dsl_version.sh`/
`regen_vscode_settings.py`, CLI/tests/CI pass (#17); new-workflow slug/name at Spec gate
(#18); confinement + token-redaction + `127.0.0.1` (#23); push idempotency — no duplicate
app after a simulated mid-push crash (#25).

**(f)** **`app_id` key unknown** → don't assume `result['id']`; capture via `--json-out`
(define what it prints against a real response) as the **primary** path; `list` reconcile
is only a crash-recovery tiebreaker and is **slug-ambiguous** (push always makes a new app,
so repeats slugify identically — pick the most-recently-created match) · push always creates a
**new** app → `auto`+selfhost+edit-existing silently duplicates → report must surface a
prominent "created a NEW app (duplicate)" warning (spec footgun) · `list` exit-code
ambiguous (parse stderr) · `project:` must stay a **mapping** (scalar crashes
`regen_vscode_settings.py`) · `group` sub-key is read only by the app, ignored by the
dsl scripts (they read `dsl_version`) · `.vscode/settings.json` side-effect whitelisted ·
backend injects Dify env directly (don't depend on `dev.env`+dotenv).

**(g)** Finalize **§E/§J/§Revision/AC #10/#23/#25** to the Lát-0 model; **§F** — add an
explicit "backend-owned Dify I/O; token never enters a turn" subsection (today only
*implied*, and partially contradicted); **§A** — document the `app_id` capture method
(`--json-out` + `list` reconcile; field name TBD); tick Nhịp-0 checkboxes (`.gitignore`,
pre-commit `exclude`, `setup-node.sh`, `project.group`). If `--json-out`/`--group` become
canonical, note them in §References "Reused tooling" and AGENTS.md §8.

---

## Sequencing & risk

- **Order is by risk, not by layer.** Lát 0 (CLI behavior) and Lát 3 (gate) are the
  net-new unknowns; Lát 4 is mostly copy. Lát 0 + 0.5 gate everything (model + engine).
- **Maps onto spec Nhịp:** Lát 0+0.5+1(by-hand) ≈ **Nhịp 0–1**; Lát 1–3 ≈ **Week 1–2**;
  Lát 4 ≈ **Week 3**; Lát 5 ≈ **Week 4**.
- **Each Lát runs end-to-end and demos** (curl through Lát 3; UI from Lát 4) — thin core
  outward.

## Spec-update ledger (satisfies "no silent drift")

| When | Spec target | Edit |
|---|---|---|
| Lát 0 done — **✅ APPLIED** (dialect + model-C rewrite) | §Revision Security/permissions, §A spawn+venv, §D, §E header, §J, AC #10/#23, Risk register, diagram | dialect fix (no leading slash) + full model-C rewrite landed: `acceptEdits` + `--setting-sources local` + deny-as-defense-in-depth + **#3b reject+REVERT as the real boundary**; §E body explicitly disclaimed as pre-spike draft. AC#25 unaffected. Brief QĐ#1 known-limitation corrected (echo>tools/x blocked; opaque `python -c` escapes). |
| Lát 0.5 — **✅ DONE** | §C Tooling ①/③/④, §Revision Cleanups:275, Nhịp-0 checkbox:1079 | `.claude/skills/dify-build/` authored (SKILL.md + 4 phases); §C Tooling ① → backend pulls/turn reads, ③ → scaffold is backend at Spec gate, ④ → backend (no turn); checkbox ticked. *(Remaining: §A turn-I/O ④-as-`result`-event reframe = Lát 2.)* |
| Lát 2 — **✅ DONE** | §A:479, §C:614, §E | executor ambiguity resolved: §A ④ row → "backend, no turn; gate = report.json exists+non-empty (no `result` event)"; §C Tooling ①/④ → backend (Lát 0.5); `sync.py` already out of the turn allowlist. *(Skill `.runs/` ↔ spec `apps/builder/.runs/` reconciled via SKILL.md run-dir note + backend `relocateRunArtifacts`.)* |
| Lát 5 | §F, §A | add backend-owned-Dify-I/O + cred-never-in-turn subsection; document `app_id` capture (`--json-out` + `list` reconcile); tick remaining Nhịp-0 |
| Lát 5 | §References, AGENTS.md §8 | if adopted, register `--json-out`/`--group` tool flags |
| Lát 5 review — **✅ done** | §A:218, §C:622, AC #4, plan diff-base rows | **narrowed the no-seed diff base** from "chosen pattern template" → **empty base (full-file additions)**: the auto-selected pattern is agent-internal prose in `SPEC.md`, not a tracked field, so `diff.ts` can't produce a pattern-delta; a true pattern-delta is a Phase-3+ enhancement. Code (`diff.ts`) was already empty-base; this aligns the spec to it. |
| Lát 6 (Phase 3) — **✅ APPLIED** (turn-level run-lock + multi-build UI) | §I "Run-lock granularity", §I failure table (2 rows), Q6, AC #21, Endpoints (`/api/tasks` 409 note, `/cancel`, **new `/api/active`**) | run-lock made **turn-level**: held only while a `claude` turn / backend write-unit runs, released when the build **parks at a gate**, so **multiple builds may sit parked** and only a real **turn collision** 409s (with `holder`). `lock.ts`: `holder`→single `turnHolder` slot, `acquire`/`release`/`holderTaskId`→`acquireTurn`(strict)/`releaseTurn`/`turnHolderId`+`turnBusy`; `reconcileOnBoot` simplified (running/scaffolding→error, awaiting_confirm survives untouched — no re-acquire, no tie-break; `turnHolder` starts null). `routes/tasks.ts`: turn acquired synchronously in the route right before dispatch (also closes the double-dispatch race → `advancing` Set removed), released in the shared `dispatch` `finally` (single release point); orchestrator is now lock-free (all 9 `release()` calls dropped). New `GET /api/active` + sidebar "In progress" section + actionable-busy "open it" jump (load-recovery, extends AC #22). 1-writer invariant (→ #3b confinement) preserved. Verified: 16 deterministic assertions (lock invariant, double-dispatch reject, boot reconcile, `/api/active`) + clean backend `tsc` / web `vite build` + clean isolated boot. |
| Lát 7 (spec 010 — post-009 QA UX hardening) — **✅ APPLIED** (F1, F4, F2-A) | §D (confirm-mode now live-patchable mid-build), §G/§J (slug-collision auto-suffix), AC #18, Endpoints (**new `PATCH /api/tasks/:id`**, `/cancel` reachable from every gate + sidebar) | three real fixes from the browser QA pass (`docs/specs/010-builder-ux-hardening.md`; F3 dropped — premise false). **F1 (cancel any in-flight build):** `gate.ts` adds `DISCARD` (`CANCEL('discard')`) to the analyze/spec/clean-implement/awaiting-import gates (still-failing keeps `Abandon`); `store.cancelById` + a sidebar hover-× cancel a parked/running build without opening it (confirm only when a turn is live). Non-destructive — `.runs/`+`projects/` stay on disk; the existing `/cancel` verb is unchanged. **F4 (slug-collision guard):** `scaffoldAtSpecGate`'s **derive** branch auto-suffixes a colliding new-workflow slug to the first free `<slug>_N` + records `task.slugNote` (surfaced on the Implement gate + in the report); the override branch (explicit user slug) and Dify-seed builds are untouched. **F2 Part A (patchable confirm-mode):** `PATCH /api/tasks/:id {confirm_mode}` persists `confirmMode` + broadcasts `task:update`; the next boundary honors it (the next `/confirm` re-loads from disk; `maybeAutoAdvance` reads it fresh). **Two 409s:** terminal (no next boundary) AND *this build's turn is currently running* (`turnHolderId()===id`) — patching mid-turn is both ineffective (the live orchestrator drives `maybeAutoAdvance` off its in-memory task) AND silently clobbered by that turn's gate `emit`, so it's rejected; the frontend also freezes the Confirm chip while `busy`. Parked/errored builds (no running turn) patch freely. The conversation-view Confirm chip reflects + patches the active build; Workflow/Deploy chips are read-only there. **Part B (immediate parked-auto-advance) deferred** (optional; not cheap). Clean backend `tsc` + web `vite build`; Lát-3–6 invariants (turn-lock, #3b confinement) untouched. **AC #15/#25 still need a live run to record** (require `claude`+lint-fail fixture). |

> Items already correct in the spec (no edit needed): **§I** (exit-code branch already
> dropped — "always regenerate on retry", confirmed spec :813-817). The §Revision
> *additions* to §E/§J already qualify "fail-fast" under `dontAsk` and bound the
> Bash-subprocess gap — but the **original §E body (:678) still asserts fail-fast
> unconditionally** and is rewritten in the Lát-0 ledger row above, so this is not a
> "no edit" item. The brief's correction #4 and parts of #10/#23 describe a *pre-revision*
> spec.
