# Spec 008 — Meta Workflow Builder (Dify-builds-Dify)

**Status**: Draft (2026-05-29; revised 2026-05-30 — effort + retry control flow + Q6/Q7) — Feasibility proven, ready for implementation
**Effort**: L (~7–10 days for Phase 2 MVP; +1–2 days for Phase 3 hardening). Earlier "M (3–5 days)" estimate revised after critical review surfaced retry control flow design + multi-Mutator template overhead.
**Depends on**: 001 (multi-version schema), 002 (AGENTS.md), 003 (variable-ref linter), 007 (capability docs)

> A Dify workflow that generates **other** Dify workflows from natural-language
> requirements and auto-imports them into the same workspace via the Console
> API. Reduces "have an idea → app running" from ~30 min manual work to ~1 min.

## Context

### Problem

Building Dify workflows by hand is slow and error-prone, even with the
toolkit in this repo:

- 80% of new workflow effort is **boilerplate**: pick pattern → copy →
  generate node IDs → rewire variable refs → set plugin hash → validate → import.
- Recurring failure modes are documented in [AGENTS.md §9](../../AGENTS.md) but
  humans + AI agents still hit them: string IDs (not timestamp-ms),
  mis-typed `{{#node.field#}}`, fabricated plugin sha256, missing if-else
  legacy `conditions`.
- The 5 vetted patterns in [templates/patterns/](../../templates/patterns/) and
  46 corpus examples are searchable via [find.py](../../tools/dify_base/find.py)
  but still require an engineer to do the synthesis.

### Why eat our own dog food

A Dify workflow that builds Dify workflows has these advantages over an
external Python CLI:

1. **Self-contained** — runs inside Dify, no extra runtime/infra/auth surface.
2. **Distributable** — export DSL → anyone with Dify can import + run.
3. **Test loop** — generated app appears in workspace, click + use in 5 seconds.
4. **Dogfooding** — every Dify gotcha that breaks the builder also breaks
   user apps; fixing one fixes both.
5. **Composable** — Planner LLM can be swapped per workspace's available
   models without code change.

### Feasibility confirmed (2026-05-29)

PoC builder [templates/patterns/meta-workflow-builder.yml](../../templates/patterns/meta-workflow-builder.yml)
+ offline test [tests/test_meta_builder_codenode.py](../../tests/test_meta_builder_codenode.py)
proved 6 critical assumptions:

| Assumption | Evidence |
|---|---|
| Dify code-node Python sandbox can synthesize YAML from string template (no `yaml` lib needed) | Test runs `json + re + time` stdlib only, emits 4364-char valid YAML |
| Output passes `validate_workflow.py` + JSON Schema + variable-ref linter + plugin hash linter | All 4 linters return exit 0 on generated output |
| `POST /console/api/apps/imports` accepts `{mode: "yaml-content", yaml_content, name}` | Real Cloud Dify call returned `200 OK`, body `{app_id, status: "completed", error: "", current_dsl_version: "0.6.0"}` |
| The builder itself is valid Dify DSL importable into a real workspace | Manual upload to Cloud Dify (19.9KB) → status "completed" |
| Linters catch generator bugs before runtime | Found `ext_lines` indent bug during PoC test; would have failed Dify import silently |
| Auth is solvable for production (no architectural blocker) | Cloud uses `Cookie + CSRF + Bearer` (3 headers); self-host uses Bearer only; login flow `POST /console/api/login` returns fresh token without manual DevTools |

→ **No architectural unknowns remain.** Implementation is execution per the plan in §Design Phase 2.

## Goals

1. **Latency**: `Run → app_id in workspace` ≤ 30 seconds.
2. **Coverage**: handle the 5 patterns in [templates/patterns/](../../templates/patterns/)
   without fallback to human authoring. ≥80% of requirements that map to one
   of those patterns produce a working app on first try.
3. **Self-host first**: works fully automated on local Dify (docker compose
   from [dify-workspace](../../../dify-workspace/)). Cloud Dify is best-effort
   (CSRF requires either manual headers or generate-and-download mode).
4. **Auth automation**: after 1-time setup, user never touches a token / cookie.
5. **Validation guarantee**: every imported app passes the same 4 linters that
   hand-authored workflows do.
6. **Self-contained**: no external service besides Dify itself. Builder = 1
   YAML file exportable + importable like any other Dify app.

## Non-goals

1. **Complex workflows (>15 nodes)** — Deep Researcher (53 nodes), Dify 运营一条龙
   (51 nodes) require composing dozens of inter-dependent nodes the Planner
   LLM cannot reliably synthesize. Punt to Phase 4+ with RAG-based pattern lookup.
2. **DSL version migration** — Builder pins DSL 0.6.0 (matches `.dify-dsl-version`).
   When Dify ships DSL 0.7.x, regen schemas first ([Spec 001](001-multi-version-schema.md)),
   then bump builder.
3. **Cross-workspace deploy** — builder imports into the same workspace it runs in.
   Multi-workspace fanout = Phase 5+.
4. **Custom plugin authoring** — only references existing installed plugins via
   workspace probe. Cannot author new plugin packages.
5. **Dataset / knowledge-base creation** — `rag-qa` pattern requires user to
   pre-create the knowledge base; builder only references it by ID.
6. **Edit-existing-app workflow** — only creates new apps. Update/diff = Phase 5+.
7. **Multi-language UI** — Vietnamese requirements work via prompt; UI text
   is English-only in v1.

## Design

### Final architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Dify Workflow App: "Workflow Builder"  (mode: workflow)             │
│  Imported once per workspace via Studio → Import DSL                 │
└──────────────────────────────────────────────────────────────────────┘

Start node (vars: requirement, app_name, optional pattern_hint)
   │
   ▼
[1] Auth Bootstrap                              ── env: DIFY_EMAIL, DIFY_PASSWORD
    HTTP POST /console/api/login
    body: {email, password}
    out: access_token (fresh, ~24h lifetime)
   │
   ▼
[2] Workspace Probe                             ── uses access_token from [1]
    HTTP GET /console/api/workspaces/current/plugins
    out: plugin_catalog (JSON: {provider_id → marketplace_plugin_unique_identifier})
   │
   ▼
[3] Planner LLM                                 ── system prompt = pattern catalog
    Input: requirement, app_name, plugin_catalog
    Output: strict JSON plan
      { pattern: "file-to-llm" | "file-iteration" | "multi-step-llm"
              | "rag-qa" | "agent-with-tools",
        app_name, app_description,
        inputs[], model: {provider, name}, prompts: {system, user},
        plugin_refs[], allowed_extensions[], retry_hints }
   │
   ▼
[4] Plan Validator (code)                       ── fail-branch on schema mismatch
    - Required fields present
    - Pattern is one of 5
    - Model provider exists in plugin_catalog
    On fail: route to Planner Retry (max 2 attempts)
   │
   ▼
[5] Pattern Router (if-else)
    case plan.pattern == "file-to-llm"      → Mutator_FileToLLM
    case plan.pattern == "file-iteration"   → Mutator_FileIteration
    case plan.pattern == "multi-step-llm"   → Mutator_MultiStep
    case plan.pattern == "rag-qa"           → Mutator_RAG
    case plan.pattern == "agent-with-tools" → Mutator_Agent
   │
   ▼
[6] YAML Mutator (5 code nodes, one per pattern)
    For each branch:
    - Generate N timestamp-ms IDs (time.time() * 1000 + offset_i)
    - Build YAML as string template (no yaml lib — sandbox-safe)
    - Substitute plan fields + plugin hashes from probe
    - Emit yaml_content + import_body (pre-JSON-encoded)
   │
   ▼ (variable-aggregator merges 5 branches into single yaml_content)
   ▼
[7] YAML Validator (code)                       ── fail-branch on lint failure
    Inline subset of:
    - Node ID format check (timestamp-ms, 13 digits)
    - Edge ID format <src>-source-<tgt>-target
    - Variable refs {{#id.field#}} resolve to existing nodes
    - All if-else nodes have both `conditions` AND `cases`
    On fail: surface error → User retries with refined requirement
   │
   ▼
[8] Import to Dify
    HTTP POST /console/api/apps/imports
    Authorization: Bearer <token from [1]>
    body: {mode: "yaml-content", yaml_content, name: app_name}
    out: {app_id, status, error, current_dsl_version}
   │
   ▼
End node
    Outputs:
    - app_id (UUID)
    - app_url (computed: <console_base>/app/<app_id>/workflow)
    - generated_yaml (for debugging)
    - status (from API response)
    - plan_summary (human-readable: pattern + key choices)
```

### Component specification

#### [0] Start node

```yaml
type: start
variables:
  - variable: requirement
    type: paragraph
    required: true
    max_length: 4000
    placeholder: "Describe what the workflow should do…"
  - variable: app_name
    type: text-input
    required: true
    max_length: 80
  - variable: pattern_hint
    type: select
    required: false
    options: [auto, file-to-llm, file-iteration, multi-step-llm, rag-qa, agent-with-tools]
    default: auto
```

`pattern_hint` lets advanced users skip Planner pattern selection.

#### [1] Auth Bootstrap (HTTP node + parse code node)

**[1a] HTTP node**:
```
method: POST
url: {{#env.DIFY_CONSOLE_URL#}}/login
body: raw-text, application/json
content: |
  {"email": "{{#env.DIFY_EMAIL#}}", "password": "{{#env.DIFY_PASSWORD#}}", "remember_me": true}
```

Response shape (Dify ≥1.13):
```json
{ "result": "success",
  "data": { "access_token": "eyJ…", "refresh_token": "…" } }
```

HTTP node output: `body` (raw JSON string), `status_code` (int).

**[1b] Token Extractor (code node)** — required because HTTP node returns body
as a single opaque string, not a structured object. Downstream nodes can't
use `body.data.access_token` directly:

```python
def main(body: str, status_code: int) -> dict:
    import json
    if status_code != 200:
        raise ValueError(f"Login failed: HTTP {status_code}: {body[:200]}")
    data = json.loads(body)
    if data.get("result") != "success":
        raise ValueError(f"Login failed: {data}")
    return {
        "access_token": data["data"]["access_token"],
        "refresh_token": data["data"].get("refresh_token", ""),
    }
```

Subsequent HTTP nodes reference `{{#1b.access_token#}}`.

> **Self-host vs Cloud**: works on self-host. On Cloud, `/login` likely
> requires CSRF/captcha — see Open Q3 + §Cloud-mode fallback.

#### [2] Workspace Probe (HTTP node + code node)

```
method: GET
url: {{#env.DIFY_CONSOLE_URL#}}/workspaces/current/plugins
auth: Bearer {{#auth_bootstrap.access_token#}}
```

Code node parses response, builds `{provider_id: sha256_hash}` dict, returns
as JSON string for Mutators to consume.

#### [3] Planner LLM (LLM node)

**System prompt structure** (template):

```
You are a Dify workflow planner. Given a requirement, output a strict JSON
plan describing how to instantiate ONE of these 5 patterns:

# Pattern catalog
{{ patterns_section }}    ← compiled from templates/patterns/*.yml header comments

# Plugin catalog (from this workspace)
{{ plugin_catalog }}      ← from Workspace Probe output

# Output schema
{
  "pattern": "file-to-llm" | "file-iteration" | "multi-step-llm" | "rag-qa" | "agent-with-tools",
  "app_name": string,
  "app_description": string,
  "inputs": [{ variable, label, type, required, ... }],
  "model": { "provider": "<from plugin_catalog>", "name": "<model name>" },
  "prompts": { "system": string, "user_template": string },
  "plugin_refs": [{ "provider_id": "...", "unique_identifier": "<from catalog>" }],
  "allowed_extensions": [".pdf", ".txt", ...],
  "retry_hints": []         // populated on retry; empty on first attempt
}

# Rules
- Output raw JSON only. No prose, no code fences.
- Choose the simplest pattern matching the requirement.
- For unknown plugins, default to first in catalog matching provider type.
- "system" prompt is for the GENERATED workflow, not for you.
```

**Model settings**:
- Temperature: 0.1 (deterministic)
- `response_format: json_object` (forces JSON mode)
- Default model: `gpt-4o-mini` or workspace-available equivalent

#### [4] Plan Validator (code node)

```python
def main(plan_text: str, plugin_catalog: str) -> dict:
    import json, re

    cleaned = re.sub(r'^```(?:json)?\s*|\s*```$', '', plan_text.strip(),
                     flags=re.MULTILINE)
    plan = json.loads(cleaned)
    catalog = json.loads(plugin_catalog)

    errors = []
    required = ["pattern", "app_name", "model", "prompts"]
    for f in required:
        if f not in plan: errors.append(f"missing: {f}")
    if plan.get("pattern") not in ["file-to-llm", "file-iteration",
                                    "multi-step-llm", "rag-qa", "agent-with-tools"]:
        errors.append(f"invalid pattern: {plan.get('pattern')}")
    if plan.get("model", {}).get("provider") not in catalog:
        errors.append(f"provider not installed: {plan.get('model', {}).get('provider')}")

    if errors:
        return {"valid": False, "errors": "; ".join(errors), "plan": plan}
    return {"valid": True, "errors": "", "plan": plan}
```

Fail-branch routes back to Planner with `retry_hints = errors` (max 2 retries),
then surfaces error to End.

#### [5] Pattern Router (if-else node)

Standard Dify if-else with 5 cases on `plan.pattern` field. Must include both
legacy `conditions` AND modern `cases` per [AGENTS.md §9 2026-05-19](../../AGENTS.md).

#### [6] YAML Mutators (5 code nodes)

Each Mutator is a code node specialized for one pattern. Common structure:

```python
def main(plan_json: str, plugin_catalog: str, app_name: str) -> dict:
    import json, re, time
    plan = json.loads(plan_json)
    catalog = json.loads(plugin_catalog)

    # 1. Generate N unique timestamp-ms IDs
    base = int(time.time() * 1000)
    ids = [str(base + i * 3) for i in range(NODE_COUNT_PER_PATTERN)]

    # 2. Resolve plugin hash from catalog
    provider = plan["model"]["provider"]
    plugin_hash = catalog[provider]  # e.g. "langgenius/openai:0.0.31@<sha256>"

    # 3. Build YAML as string template
    yaml_content = PATTERN_TEMPLATE.format(
        app_name=escape_yaml(app_name),
        app_desc=escape_yaml(plan["app_description"]),
        plugin_hash=plugin_hash,
        model_name=plan["model"]["name"],
        system_prompt=indent_for_block_scalar(plan["prompts"]["system"]),
        node_ids=ids,
        # ... pattern-specific fields
    )

    # 4. Pre-encode import body
    import_body = json.dumps({
        "mode": "yaml-content",
        "yaml_content": yaml_content,
        "name": app_name,
    })

    return {
        "yaml_content": yaml_content,
        "import_body": import_body,
        "generated_ids": ",".join(ids),
    }
```

**Pattern templates** live as Python multi-line strings inside the Mutator
code (not external files — code node has no filesystem access). Source of
truth = [templates/patterns/](../../templates/patterns/), templates are
re-derived during builder build (one-time codegen step in setup).

**Number of nodes per pattern**:
| Pattern | Node count | IDs needed |
|---|---|---|
| file-to-llm | 4 | 4 |
| file-iteration | 7 | 7 (incl. iteration child) |
| multi-step-llm | 5 | 5 |
| rag-qa | 4 | 4 |
| agent-with-tools | 3 | 3 |

#### [7] YAML Validator (code node)

```python
def main(yaml_content: str) -> dict:
    import re
    errors = []

    # 1. Node IDs are 13-digit timestamp-ms quoted strings
    id_pattern = re.compile(r"^\s*-\s*id:\s*'(\d{13})'", re.MULTILINE)
    ids = id_pattern.findall(yaml_content)
    if not ids:
        errors.append("no node IDs found (expected timestamp-ms format)")

    # 2. Variable refs reference existing nodes
    ref_pattern = re.compile(r"\{\{#(\d{13})\.\w+#\}\}")
    refs = set(ref_pattern.findall(yaml_content))
    unknown = refs - set(ids)
    if unknown:
        errors.append(f"undefined node refs: {unknown}")

    # 3. Edge IDs format <src>-source-<tgt>-target
    edge_pattern = re.compile(r"id:\s*(\d{13})-source-(\d{13})-target")
    edges = edge_pattern.findall(yaml_content)
    for src, tgt in edges:
        if src not in ids: errors.append(f"edge src not a node: {src}")
        if tgt not in ids: errors.append(f"edge tgt not a node: {tgt}")

    # 4. DSL version pinned
    if "version: 0.6.0" not in yaml_content:
        errors.append("missing or wrong DSL version")

    # 5. Iteration child node ID format: <parent_id>start (no separator)
    #    See AGENTS.md §4.1
    iter_pattern = re.compile(r"type:\s*iteration\s*\n[^-]*?id:\s*'(\d{13})'",
                              re.MULTILINE | re.DOTALL)
    for parent_id in iter_pattern.findall(yaml_content):
        expected_child = f"{parent_id}start"
        if expected_child not in yaml_content:
            errors.append(f"iteration {parent_id} missing child '{expected_child}'")

    # 6. If-else nodes must have both `conditions` (legacy) AND `cases` (modern)
    #    See AGENTS.md §9 (2026-05-19 pitfall)
    ifelse_blocks = re.findall(r"type:\s*if-else.*?(?=\n    - id:|\Z)",
                               yaml_content, re.DOTALL)
    for block in ifelse_blocks:
        if "conditions:" not in block:
            errors.append("if-else node missing legacy 'conditions' field")
        if "cases:" not in block:
            errors.append("if-else node missing modern 'cases' field")

    return {"valid": len(errors) == 0,
            "errors": "; ".join(errors),
            "yaml_content": yaml_content}
```

Fail → User-facing error with diagnostic. No auto-retry (Mutator bug, not LLM).

#### [8] Import HTTP node

```
method: POST
url: {{#env.DIFY_CONSOLE_URL#}}/apps/imports
auth: Bearer {{#auth_bootstrap.access_token#}}
headers: Content-Type: application/json
body: raw-text → {{#mutator.import_body#}}
```

Expected response (confirmed Cloud 2026-05-29):
```json
{ "id": "<import_record_id>",
  "app_id": "<UUID of new app>",
  "app_mode": "workflow",
  "current_dsl_version": "0.6.0",
  "imported_dsl_version": "0.6.0",
  "error": "",
  "status": "completed" }
```

If `status != "completed"`, surface `error` to user.

#### [9] End node

```yaml
outputs:
  - variable: app_id
    value_selector: [<import_node_id>, body.app_id]
  - variable: app_url
    # computed via small code node: f"{DIFY_BASE}/app/{app_id}/workflow"
  - variable: generated_yaml
    value_selector: [<mutator_aggregator_id>, yaml_content]
  - variable: plan_summary
    value_selector: [<planner_id>, plan_summary_text]
  - variable: import_status
    value_selector: [<import_node_id>, body.status]
```

### Deployment modes (self-host vs Cloud)

Builder ships with a `DIFY_DEPLOYMENT_MODE` env var (`selfhost` | `cloud`).
This is required from Phase 2 day 1 because the auth + import paths diverge:

| Aspect | `selfhost` (primary) | `cloud` (fallback) |
|---|---|---|
| Auth | Login flow (`POST /login` → access_token) | Manual: paste 3 cookies + `X-Csrf-Token` in env |
| Import path | HTTP node POSTs to `/apps/imports` | HTTP node **disabled**, End node returns `yaml_content` for manual upload |
| User UX | Click run → app appears in workspace | Click run → copy YAML → Studio import → ~5s extra |
| Required env vars | `DIFY_EMAIL`, `DIFY_PASSWORD`, `DIFY_CONSOLE_URL` | `DIFY_CONSOLE_URL`, `DIFY_ACCESS_TOKEN`, `DIFY_CSRF_TOKEN`, `DIFY_COOKIE_JAR` |

Implementation: Pattern Router (§5) routes to Cloud-mode End node short-circuit
when `DIFY_DEPLOYMENT_MODE == "cloud"`. Same Mutator output, different exit path.

### Auth strategy

Detailed trade-offs:

| Option | Token lifetime | Setup | Code change | Self-host | Cloud |
|---|---|---|---|---|---|
| **A. Hardcoded token (PoC current)** | Hours, manual refresh | Paste once | None | ✓ works | ✓ but expires fast |
| **B. Refresh token flow** | 30 days | Paste refresh_token once | +1 HTTP node | ✓ | Maybe (CSRF on refresh endpoint TBD) |
| **C. Login flow (RECOMMENDED)** | Per-run fresh | Email+password env vars | +1 HTTP node | ✓ works | ✗ Cloud `/login` may have captcha |
| **D. PAT (future)** | Until revoked | Generate in UI | Trivial | ✗ Not in Dify OSS 1.13 | ✗ Not in Cloud yet |

**Phase 2 chooses Option C (login flow)** for self-host. Cloud users fall back
to Option A with documented limitation.

### Retry control flow (critical design decision)

**Constraint**: Dify DSL 0.6.0 workflows are DAGs — **no native loop construct**.
The `iteration` node iterates over an array, not for control-flow retry.
"Plan Validator fails → retry Planner with hints" is NOT a free primitive.

Three viable workarounds, picked per phase:

| Option | Mechanism | Cost | When |
|---|---|---|---|
| **R1. Sequential double-shot** | Hardcode 2 Planner LLM nodes in series. 1st normal; 2nd reads 1st's validation errors (if any) + rewrites plan. Plan Validator runs after each. Pattern Router only fires once. | +1 LLM call (~$0.001) always, even when not needed | **Phase 2 (chosen)** — simplest, deterministic |
| **R2. Chatflow + user retry** | Convert builder from `mode: workflow` → `mode: chatflow`. On validation fail, return diagnostic to user; user retries with refined requirement in next message. | UX shift (multi-turn conversation), state mgmt | Phase 3 — upgrade after Phase 2 ships |
| **R3. No retry, harden validators** | Single Planner shot. If Plan Validator fails, end immediately with diagnostic. | Cheapest; worst UX on edge cases | Fallback if R1 too complex |

**Phase 2 implementation (R1) detail**:

```
Planner LLM (1st) → Plan Validator (1st)
                      │
                      ├─ valid: true  → Pattern Router → ... → End
                      │
                      └─ valid: false → Planner LLM (2nd, with error context)
                                          → Plan Validator (2nd)
                                              ├─ valid: true  → Pattern Router → ...
                                              └─ valid: false → End with diagnostic
```

The 2nd Planner's user prompt:
```
Previous plan failed validation: {{#plan_validator_1.errors#}}
Failed plan: {{#planner_1.text#}}
Re-output a corrected JSON plan addressing the errors above.
```

Cost: 1 extra LLM call always (~$0.001 with gpt-4o-mini). Worth it for the
~5–10% of requirements where 1st-shot validation fails.

### Pattern coverage matrix (Phase 2 scope)

| Pattern | Reference | Variables Planner must produce | Mutator complexity |
|---|---|---|---|
| `file-to-llm` | [file-to-llm.yml](../../templates/patterns/file-to-llm.yml) | app_name, app_desc, model, system_prompt, allowed_extensions | Low |
| `file-iteration` | [file-iteration.yml](../../templates/patterns/file-iteration.yml) | + chunk_size, item_prompt | Medium (iteration node has child) |
| `multi-step-llm` | [multi-step-llm.yml](../../templates/patterns/multi-step-llm.yml) | + critique_prompt, refine_prompt | Low (3 LLM calls in sequence) |
| `rag-qa` | [rag-qa.yml](../../templates/patterns/rag-qa.yml) | + dataset_id, top_k, score_threshold | Low |
| `agent-with-tools` | [agent-with-tools.yml](../../templates/patterns/agent-with-tools.yml) | + tools[], agent_mode | Medium (tools array) |

Phase 3+ extensions: `if-else-branching`, `parameter-extraction`, custom `code-node`
templates.

### Setup runbook

#### One-time sysadmin setup (~10 min on self-host)

```bash
# 1. Boot Dify locally (if not already running)
docker compose -f /Users/quyenbt/Desktop/MyProjects/dify-workspace/docker/docker-compose.yaml up -d
# wait for nginx + api healthy (poll http://localhost/console/api/health)

# 2. First-time admin user setup via http://localhost
#    Email + password recorded for builder env

# 3. Install LLM provider plugin (Settings → Plugins → Marketplace)
#    Recommended: OpenAI or Anthropic — at least one of:
#      - langgenius/openai (gpt-4o-mini for cost)
#      - langgenius/anthropic (claude-haiku-4-5)

# 4. Import builder app
#    Studio → Import DSL → upload:
#      templates/patterns/meta-workflow-builder.yml

# 5. Configure builder env vars (Studio → Workflow Builder → Environment Variables)
#    DIFY_CONSOLE_URL = http://host.docker.internal/console/api
#    DIFY_EMAIL       = <admin email from step 2>
#    DIFY_PASSWORD    = <admin password from step 2>
#    (DIFY_CONSOLE_TOKEN no longer needed — login flow generates it)

# 6. Smoke test
#    Run with requirement: "Echo back the user's text input."
#    Expect: app_id returned, new app visible in Studio
```

#### End-user usage (per app generation)

1. Open `Workflow Builder` in Studio
2. Click `Run`
3. Fill requirement (paragraph), app_name (text), optional pattern_hint (select)
4. Click submit, wait ~30s
5. End output shows `app_url` — click it
6. Test the new app with real input

### Implementation plan

#### Phase 1 — Foundation (DONE 2026-05-29)

- [x] PoC builder for 1 pattern (file-to-llm): [templates/patterns/meta-workflow-builder.yml](../../templates/patterns/meta-workflow-builder.yml)
- [x] Offline E2E test: [tests/test_meta_builder_codenode.py](../../tests/test_meta_builder_codenode.py)
- [x] Confirm Cloud API contract: `POST /apps/imports` → 200 OK
- [x] Confirm full 4-linter pipeline passes on generated YAML
- [x] Find + fix `ext_lines` indent bug (validation caught it)
- [x] `vendor/dify-src/` symlink optimization in [setup.sh](../../scripts/setup.sh) (398MB saved)

#### Phase 2 — MVP (7–10 days)

Goal: Production-grade builder covering all 5 patterns with full automation.

> **Day 0 — Probe before commit** (~half day, blocks all subsequent work):
> Run [templates/probes/stdlib_check.yml](../../templates/probes/stdlib_check.yml) in
> target Dify. Verify `time`, `json`, `re` available. Also probe one of:
> `POST /apps/imports` with 20KB body (confirm no body size limit), and check
> output size limit of code node (`return {"big": "x" * 100_000}` — see what
> errors). Without these confirms, Day 3 (Mutators) may need to redesign.

**Day 1 — Auth automation + Workspace probe (1 day)**
- [ ] Replace hardcoded `DIFY_CONSOLE_TOKEN` env with `DIFY_EMAIL` + `DIFY_PASSWORD`
- [ ] Add Auth Bootstrap HTTP node + Token Extractor code node ([1a]/[1b] above)
- [ ] Add Workspace Probe HTTP node + plugin catalog parser
- [ ] Sample real `/workspaces/current/plugins` response, document shape inline
- [ ] Smoke-test against local self-host Dify

**Day 2 — Planner + Plan validator + Router + Retry (~1.5 days)**
- [ ] Compile pattern catalog (5 entries) into Planner system prompt
- [ ] Wire `response_format: json_object` on Planner LLM node (fallback per Q7)
- [ ] Implement Plan Validator code node ([4] above)
- [ ] Iterate Planner prompt against 5 canonical requirements (most time goes here)
- [ ] Implement R1 retry: 2nd Planner + Plan Validator (see §Retry control flow)
- [ ] Implement Pattern Router (if-else with 5 cases + both `conditions`/`cases`)
- [ ] Add lowercase-normalize for `plan.pattern` before router

**Day 3–4 — Implement 5 Mutators (~2–3 days)**

This is the biggest chunk. Each Mutator = ~150–250 LOC Python wrapping ~5–10KB
YAML template. Watch for code length limit (probe Day 0).

- [ ] Extract pattern templates from [templates/patterns/](../../templates/patterns/)
      into Python string-template form (one per Mutator code node)
- [ ] **`file-to-llm`** Mutator + offline test ✅ already done (Phase 1 PoC)
- [ ] **`file-iteration`** Mutator — handle iteration child ID `<parent>start` +
      `data.isInIteration: true` on child edges
- [ ] **`multi-step-llm`** Mutator — 3 LLM nodes in sequence + variable refs chained
- [ ] **`rag-qa`** Mutator — accept `dataset_id` from plan, embed in knowledge-retrieval
- [ ] **`agent-with-tools`** Mutator — embed tools array, validate provider matches
- [ ] Shared escape helper: multi-line prompt → YAML block scalar (handle `|`,
      trailing whitespace, unicode)
- [ ] Variable aggregator merging 5 mutator outputs into single `yaml_content`
- [ ] Per-pattern test in extended [test_meta_builder_codenode.py](../../tests/test_meta_builder_codenode.py) (5 mock plans)

**Day 5 — YAML Validator + Import (1 day)**
- [ ] Implement YAML Validator code node ([7] above) — incl. iteration child + if-else cases
- [ ] Update Import HTTP node to use `access_token` from Token Extractor
- [ ] Wire End node outputs (app_url computed via small code node)
- [ ] Cloud-mode short-circuit (skip Import, return yaml_content)

**Day 6 — E2E test setup + run (~1.5 days)**

E2E setup is its own work — datasets/fixtures don't pre-exist:

- [ ] Create test dataset for `rag-qa` E2E (sample knowledge base)
- [ ] Install web-search tool plugin for `agent-with-tools` E2E
- [ ] Add sample PDF / MD test files for `file-to-llm`, `file-iteration` E2E
- [ ] Full E2E run on self-host: 5 canonical requirements → 5 new apps created
- [ ] Pre-commit pass on builder YAML

**Day 7 — Polish (1 day)**
- [ ] Sysadmin runbook embedded in builder app's `description` field
- [ ] Error UX: parse `error` field from Import response → user-friendly message
- [ ] Embedded help text in Start node `hint` fields
- [ ] Acceptance criteria verification (see §Acceptance below)

**Day 8 — Buffer (1 day)**
- [ ] Reserved for unknowns: sandbox quirk, endpoint shape change, prompt
      doesn't converge, etc. **Realistic projects always use this.**

> **If Day 0 probe reveals sandbox/limit issues**: re-scope to file-to-llm + 1
> more pattern as Phase 2A; defer remaining 3 to Phase 2B. Better to ship 2
> working than 5 broken.

#### Phase 3 — Production hardening (1–2 days)

- [ ] Retry policy: Plan Validator fail → re-prompt Planner with `retry_hints` (max 2)
- [ ] Telemetry: log `{requirement, plan, outcome, app_id, errors}` to a Dify dataset
- [ ] Refresh-token fallback if login fails (Option B)
- [ ] Custom error mapping table (Dify import errors → human messages)
- [ ] Performance: avoid Workspace Probe if cached <24h

#### Phase 4+ — Future (out of MVP scope)

- [ ] RAG-based pattern lookup (replace embedded 5 → 50+ from corpus)
- [ ] Multi-pattern composition (Planner outputs DAG of patterns, not single)
- [ ] Visual diff preview before import
- [ ] Pattern marketplace (community-contributed patterns)
- [ ] GitOps sync: auto-commit generated YAMLs to projects/<slug>/workflows/

### Testing strategy

| Layer | Tool | Scope |
|---|---|---|
| **Unit (offline)** | Extended [test_meta_builder_codenode.py](../../tests/test_meta_builder_codenode.py) — 1 case per Mutator with mock plan | Generator logic per pattern |
| **Validator** | Existing skill `validate_workflow.py` + JSON Schema + `lint_refs.py` + `lint_plugin_hashes.py` | Generated YAML passes same checks as hand-authored |
| **Integration (mocked Dify)** | `unittest.mock` patches HTTP in code node | Auth + Import code paths |
| **E2E (real Dify, self-host)** | New `tests/test_meta_builder_e2e.py` (requires `DIFY_PROJECT=builder_e2e` env file) | 5 canonical requirements → 5 apps created |
| **Pre-commit** | All 12 hooks on `meta-workflow-builder.yml` | Builder itself stays validatable |

**Canonical requirements for E2E** (1 per pattern):
1. file-to-llm: "Summarize an English PDF into 3 Vietnamese bullets"
2. file-iteration: "Translate each paragraph of a Markdown file to Japanese"
3. multi-step-llm: "Generate a blog post draft, critique it, then refine"
4. rag-qa: "Answer questions about our team handbook (dataset id: X)"
5. agent-with-tools: "Web search + summarize results with citations"

Pass criteria: app imports + opens in Studio + runs without errors on sample input.

### Open questions

#### Q1. Sandbox stdlib availability — does `time + json + re` work in code nodes?

**Why it matters**: Mutator depends on `time.time()` for IDs, `json` for plan
parsing, `re` for regex. PoC test runs them in plain Python (sandbox not yet
verified).

**Resolution**: Run [templates/probes/stdlib_check.yml](../../templates/probes/stdlib_check.yml)
in target Dify workspace before Phase 2 day 1. If `time`/`json`/`re` are
restricted, Mutator must redesign (probably impossible — these are core).

Likely outcome: all 3 available (Dify's own sandbox uses them).

#### Q2. Plugin hash lookup endpoint stability

**Why it matters**: Mutator depends on `GET /console/api/workspaces/current/plugins`
returning a parseable list with `unique_identifier`. Endpoint shape isn't
public-API stable.

**Resolution**: Sample response capture during Phase 2 Day 1. Fallback: ask
user to paste plugin hash in env var if endpoint shape changes between Dify
versions.

#### Q3. Cloud Dify CSRF — can builder work fully automated on Cloud?

**Status**: Resolved. See §Deployment modes above.

Cloud requires `Cookie + CSRF + Bearer`. Cloud mode skips the HTTP Import node
and returns `yaml_content` for manual upload (5 sec extra). `selfhost` mode
runs full automation via login flow. Controlled by `DIFY_DEPLOYMENT_MODE` env.

#### Q4. Multi-pattern requirements ("file upload + RAG + multi-step")

**Why it matters**: Real requirements often span ≥2 patterns. Phase 2 only
supports 1 pattern per requirement.

**Resolution**: Out of Phase 2 scope. Document in user-facing help: "If your
requirement needs multiple patterns, generate the closest single-pattern app,
then enhance manually in Studio."

#### Q5. Iteration node child ID convention

**Why it matters**: Iteration pattern requires child node ID of format
`<iteration_id>start` (no underscore, no dash) per [AGENTS.md §4.1](../../AGENTS.md).
Mutator_FileIteration must respect this. AND edges inside iteration must set
`data.isInIteration: true` — easy to miss.

**Resolution**: Hard-code in Mutator_FileIteration: `child_id = parent_id + "start"`,
all edges with `source` or `target` inside iteration get `isInIteration: true`.
Already added to YAML Validator §7.

#### Q6. Dify code node — code size + output size limits (BLOCKING)

**Why it matters**: Each Mutator holds its pattern's YAML as a string template
inside the code node's `code:` field. Pattern sizes:
- `file-to-llm`: ~5KB
- `file-iteration`: ~11KB (largest)
- Other 3 patterns: ~6KB each
- Plus ~150 LOC Python wrapping

So each Mutator code node is ~10–15KB total. 5 Mutators × 15KB = 75KB embedded
in 1 workflow. Plus Mutator OUTPUT is a YAML string up to ~20KB.

Dify's actual limits for code node `code:` field and `outputs[*]` string size
are not documented. PoC (file-to-llm only, 4.4KB output) works fine, but
file-iteration could hit either limit.

**Resolution**: Probe Day 0 (before Phase 2 Day 1). Test cases:
1. Code node with 50KB `code:` field — does it accept?
2. Code node returning a 50KB string output — does downstream read it intact?

If limits hit: split Mutator template across multiple code nodes (header,
graph, footer concatenated); or move template to environment_variables (size
limit there is also unknown but probably higher).

#### Q7. `response_format: json_object` provider coverage

**Why it matters**: Planner LLM relies on JSON-mode output. Only some providers
pass this through Dify's LLM node:
- OpenAI: supported ✓
- Anthropic: native tool-use JSON, may not honor literal `json_object` ⚠️
- Gemini: response_schema instead — Dify LLM node may not translate ⚠️
- Local models (Ollama/vLLM): often ignored ✗

If Planner returns markdown-wrapped JSON or trailing prose, Plan Validator
catches via the existing `re.sub(r'^```(?:json)?...')` cleanup. But if format
fails harder (object + extra text), validator fails → retry helps but costs.

**Resolution**: Phase 2 supports OpenAI provider explicitly in Planner; document
other providers as best-effort. Add prompt instruction "Output JSON only. No
prose. No code fences." as belt-and-suspenders. If user picks non-OpenAI
provider for Planner, log warning in End node output.

### Acceptance criteria

Phase 2 is **Done** when:

1. [ ] Builder imports into self-host Dify successfully (Spec 008 builder file → app)
2. [ ] All 5 canonical E2E requirements (§Testing) produce working apps
3. [ ] Builder YAML passes all 12 pre-commit hooks
4. [ ] Offline test (`test_meta_builder_codenode.py`) covers all 5 patterns, exit 0
5. [ ] No manual token paste required after initial setup (login flow works)
6. [ ] Workspace probe returns plugin hash for ≥1 installed LLM provider (workspace minimum)
7. [ ] Plan validator catches and reports ≥3 distinct error types (missing field, invalid pattern, unknown plugin)
8. [ ] YAML validator catches and reports ≥4 distinct error types (bad ID format, broken ref, missing DSL version, iteration-child-ID format)
9. [ ] Determinism check: ≥4 of 5 runs of `requirement="Summarize PDF to 3 bullets"` produce same `plan.pattern` value (temperature 0.1 + temperature alone doesn't guarantee 100%)
10. [ ] End node returns clickable app_url that opens the new app's editor
11. [ ] Retry flow (R1) verified: deliberately broken plan → 2nd Planner self-corrects in ≥3 of 5 cases
12. [ ] Day 0 probe results documented (sandbox stdlib, code/output size limits, plugins endpoint shape)

### Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Sandbox lacks `time`/`json`/`re` | Very low | Blocker | Day 0 stdlib probe |
| Code node hits code-size or output-size limit (Q6) | **Medium** | Blocker for file-iteration | Day 0 probe; fallback split template across nodes or move to env var |
| Plugin hash endpoint shape changes between Dify versions | Medium | Builder breaks on upgrade | Pin builder to `.dify-tag`; document re-test step |
| Planner LLM hallucinates pattern that doesn't exist | Medium | Plan Validator catches, R1 retry self-heals | `response_format: json_object` + strict prompt + Plan Validator + R1 retry |
| **Planner prompt doesn't converge** across 5 patterns | **Medium** | Day 2 overruns | Reserve 1 day for prompt iteration; accept lower pattern coverage if needed |
| Cloud users can't use login flow | High (Cloud-specific) | Cloud users degraded UX | Cloud-mode short-circuit (yaml output, no auto import) |
| Generated YAML has subtle bug not caught by linters | Low | User sees broken app | YAML Validator catches structural issues; pattern templates already vetted |
| Token expires mid-run | Very low | Run fails | Login flow makes this ~impossible (<30s runs, ~24h tokens) |
| Iteration child ID format wrong | Low | Iteration silently broken | YAML Validator checks (§7) |
| **Linux self-host `host.docker.internal` not resolvable** | **Medium** for Linux | Builder can't reach Dify | Doc requires `--add-host=host.docker.internal:host-gateway` in compose override |
| **Non-OpenAI Planner provider drops JSON mode** (Q7) | Medium | Plan invalid, R1 retry costs extra | Document OpenAI as recommended; belt-and-suspenders prompt |

### Telemetry (Phase 3)

Log each generation to Dify dataset `builder_telemetry`:

```json
{
  "ts": "2026-05-29T22:30:00Z",
  "requirement": "...",
  "plan": {...},
  "pattern_chosen": "file-to-llm",
  "plan_retries": 0,
  "yaml_size_bytes": 4364,
  "validation_passed": true,
  "import_status": "completed",
  "app_id": "a5aaaa42-...",
  "elapsed_seconds": 18.3,
  "error": null
}
```

Use cases:
- Pattern usage distribution → invest in most-used Mutators
- Common Planner failures → improve system prompt
- Stuck users → identify requirements that consistently fail

## Maintenance notes

### When Dify DSL version bumps

1. Regen schemas: `.venv/bin/python schemas/gen_schema.py`
2. Update `.dify-dsl-version` and builder YAML `version:` field
3. Re-run [tests/test_meta_builder_codenode.py](../../tests/test_meta_builder_codenode.py) — Mutators emit new version
4. If schema changes are breaking (node type additions, field renames): each
   Mutator pattern template needs review

### When a pattern in `templates/patterns/*.yml` updates

Mutator code node holds pattern as Python string literal. Must manually sync:
1. Edit the Mutator code node's template string to match new pattern shape
2. Re-run offline test for that pattern
3. Pre-commit pass

Phase 3 nice-to-have: codegen step that auto-derives Mutator templates from
source pattern files.

### When a plugin hash changes (Dify workspace upgrades plugin)

No action needed — Workspace Probe refetches on every run.

## References

### Project documents
- [AGENTS.md](../../AGENTS.md) — universal context, especially §4 (conventions), §9 (pitfalls)
- [README.md](../../README.md) — project overview
- [docs/GUIDE.md](../GUIDE.md) — operations
- [docs/architecture.md](../architecture.md) — 4 pillars

### Related specs
- [001-multi-version-schema.md](001-multi-version-schema.md) — schema gen pipeline
- [003-variable-ref-linter.md](003-variable-ref-linter.md) — `lint_refs.py` (Validator uses this logic)
- [007-capability-docs-and-patterns.md](007-capability-docs-and-patterns.md) — pitfall log + plugin caps

### Phase 1 artifacts (PoC, already on main)
- [templates/patterns/meta-workflow-builder.yml](../../templates/patterns/meta-workflow-builder.yml) — current PoC, file-to-llm only
- [tests/test_meta_builder_codenode.py](../../tests/test_meta_builder_codenode.py) — offline E2E test
- [scripts/setup.sh](../../scripts/setup.sh) — `vendor/dify-src/` symlink awareness

### External
- Dify Console API: undocumented — endpoint discovery via DevTools / `sync.py` precedent
- Cloud Dify import confirmation (2026-05-29 user test):
  ```
  POST https://cloud.dify.ai/console/api/apps/imports → 200 OK
  Response: {app_id, status: "completed", current_dsl_version: "0.6.0"}
  ```

### Pattern source files (Mutator templates derive from these)
- [templates/patterns/file-to-llm.yml](../../templates/patterns/file-to-llm.yml)
- [templates/patterns/file-iteration.yml](../../templates/patterns/file-iteration.yml)
- [templates/patterns/multi-step-llm.yml](../../templates/patterns/multi-step-llm.yml)
- [templates/patterns/rag-qa.yml](../../templates/patterns/rag-qa.yml)
- [templates/patterns/agent-with-tools.yml](../../templates/patterns/agent-with-tools.yml)
