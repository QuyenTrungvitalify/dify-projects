# Spec 067 — Tool nodes are buildable: retire the workspace-specific-hash myth

**Status**: **Implemented — S1/S2/S3/S4/S5/S5b/S6** (2026-07-17).
- **S2** — `tools/dify_base/marketplace.py` (resolve/tools/catalog; public, unauthenticated) +
  `templates/tool-catalog.json` (6 tool plugins / 50 tools, version-pinned). The spec's open question
  is **answered**: the marketplace exposes the full tool declaration incl. parameters, so the catalog
  is fully generated. It **refuses** a non-tool plugin (`langgenius/jina` is `category: model` with 0
  tools) rather than shipping a hole a build could not use.
- **S3** — `templates/patterns/scheduled-tool-append.yml`: the missing trigger+tool precedent.
  `find.py --has tool --has trigger` goes **0 → 1**. 4/4 linters green; doc counts 9→10 + INDEX 45→46.
- **S4** — `spec.md` + `implement.md` now route to the catalog (and cite the measured Slack failure).
- **S5** — `lint_plugin_hashes.py` gained the **coverage** gate: a `type: tool` node whose plugin is
  unlisted now FAILS (it cleared all four gates before). 103 real YAMLs re-scanned: **0 regressions**.
- **S6** — per-arm `sources: {ok, count, error}` + the warn its own doc comment had promised but never
  emitted; `knowledgeBlock` now says which lookup failed instead of rendering silence that reads as
  "none exist".

**A test was the myth's last stronghold**: `test_pattern_consistency.py::test_empty_dependencies`
asserted `dependencies == []` for every pattern ("patterns should not commit specific plugin hashes").
That is the retired rule frozen into a gate — and exactly backwards for a tool pattern. Replaced with
the real invariant (`test_dependencies_match_the_tool_nodes`: cover your tool nodes, and only those),
**proven to fail** against `dependencies: []`.

### What the implementation review caught (2026-07-17) — all fixed

The first cut of S2/S3/S5 was **built on a wrong constant**, and its tests were green because they
asserted that same wrong constant. This repo already documented the truth in
`docs/runtime-supplement.md` — the file `SKILL.md` sends a build to **first** for exactly this
question — and the first pass never read it:

| | first cut | truth (`runtime-supplement.md` + `tool_manager.py:985-987` + 16 corpus nodes) |
|---|---|---|
| `provider_type` | `plugin` | **`builtin`** — Dify dispatches BUILT_IN to the PluginToolProviderController |
| `provider_name` | `omluc/google_sheets` (2 seg) | **3 seg, identical to `provider_id`** ("provider name doubled"); 2 segments raise ValueError in `GenericProviderID` |

Consequences, each now fixed and pinned by a test **proven to fail** against the old code:
- **S5's coverage gate was a NO-OP** — it skipped every `provider_type != 'plugin'`, i.e. every real
  tool node. Un-skipping it immediately found **6 real broken builds** in `projects/_drafts/`
  (4× `md_exporter`, `langgenius/jina`, `langgenius/audio`) shipping a tool node with no dependency —
  the exact silent-runtime-failure 067 predicts. **Including run `1784174040711`**, the build spec 061
  cited as proof that "Dify accepts the import, so the only gap is the jargon note": the import did
  succeed, and the plugin was never prompted for. **061 measured the wrong thing.**
- **The pattern failed `check-jsonschema`** (pre-commit hook #3, named in AC-5): all 6 nodes lacked
  `position`, a required `Node` property. The first pass reported "4/4 linters green" — true, and
  meaningless: none of those four check `position`. Declaring victory with the instrument at hand
  instead of the one with authority is the same failure this spec is about.
- **The pattern passed a parameter the tool does not have** (`values`) and **omitted a required one**
  (`data`). The catalog it points at had the answer. Now cross-checked by
  `test_the_tool_pattern_passes_only_parameters_the_tool_declares`.
- **The myth survived in 2 more live surfaces** the manual grep missed: `runtime-supplement.md`
  (which SKILL.md routes to first) and `plugin-capabilities.md`. AC-4 is now a real test
  (`tests/test_no_plugin_hash_myth.py`) over 8 phrasings × every live instruction surface, with a
  history-note exemption so it cannot flag its own fix — and it found `plugin-capabilities.md` itself.
- **S6 and 066 S3 nearly shipped past each other**: S3 read `models.length` while ignoring
  `sources.models.ok`, so one failed harvest arm would tell a user with GPT-4o "add an AI model in
  Dify first". Both call sites now read through `enabledModelCount()`.
- **`toolLabels` was order-dependent**: it read labels from the text *after* `type: tool`, so a Dify
  export (keys sorted alphabetically → `type` last) lost every label and rendered the checklist naming
  **nothing**. Now splits per list-item; pinned by a sorted-export fixture.

Verified: pytest **260**, server **557/558** (the 1 = pre-existing creds-gated AC-9), web **191**,
typecheck clean, docs-drift 7, all **5** gates green on the pattern (4 linters + check-jsonschema),
myth guard green over 8 phrasings.
- **S1 done** — the myth is retired in all 7 places it had spread (`AGENTS.md` §4.3 incl. the 7-step
  Export-DSL procedure, §5, and the `:252` "ONLY sanctioned source" clause; `docs/GUIDE.md:350`;
  `SKILL.md`, `implement.md`, `draft.md`, `spec.md`, `test.md`). A history note records *why*, so the
  rule cannot quietly return.
- **S5b done and urgent** — S1 alone would have **broken 061**: once the builder resolves hashes,
  `unresolvedPluginTodo` goes false and the checklist vanished. Now gated on `hasToolNode`
  (`report.ts:228`), pinned by 2 tests that were **proven to fail** against the old nesting.
- Verified: server 523/524 (the 1 = pre-existing creds-gated AC-9), web 188, pytest 215, docs-drift 7,
  typecheck clean. Myth grep: clean.

Claude authors; user implements. *(Numbered 067: 065 is `065-seed-provenance-cost-dimension.md`, 066 is the
sibling `066-post-import-readiness.md`.)*
**Effort**: L (corrects a load-bearing AGENTS.md rule, adds a marketplace resolver + a pattern, moves the tool
decision one phase upstream, and re-gates spec 061 — but every slice is independently shippable).
**Depends on**: spec 061 — **and it must repair it**: 061's checklist is gated on `hasUnresolvedPluginTodo`
(`report.ts:228`, `if (unresolvedPluginTodo) { if (toolNote) … }`), which S5 makes permanently **false** by
filling real hashes. Shipping S5 without S5b would silently delete 061's shipped deliverable. Also spec 037
(`{{KNOWLEDGE}}` + its deferred OQ1 "inject at Spec too"), spec 063 (the objective oracle).
**Overturns**: spec 061's non-goal *"NOT hash auto-injection for tools"* — see "The honest nuance".

## The finding (stakeholder report, 2026-07-16)

> 「ツールとしては、スプレッドシートとの連携ですね。」 — the tool the stakeholder wants is **spreadsheet
> (Google Sheets) integration**. They report that when they ask for it in the chat, the app answers that it
> **cannot do it**, and the linkage never goes smoothly.

This is the long-running `使用頻度の高いツールの実装` complaint, now root-caused. It is **not** a capability
limit, **not** a missing plugin, and **not** an AI failure. It is a **false statement in this repo's own
rulebook**, which the model obeys correctly:

> `AGENTS.md:75` — "The `@<sha256>` part is **real and workspace-specific** — copy it from a YAML exported
> from the target Dify workspace. **NEVER fabricate**." (echoed at `AGENTS.md:102`, `docs/GUIDE.md:350`)

**That is factually wrong, and it was disproved byte-for-byte:**

| source | identifier |
|---|---|
| export from the user's OWN workspace (`projects/_drafts/3_3/workflows/main.yml:15`) | `langgenius/openai:0.2.8@aae2be09…61ff16` |
| **public** marketplace, unauthenticated, no install (`GET marketplace.dify.ai/api/v1/plugins/langgenius/openai/0.2.8`) | `langgenius/openai:0.2.8@aae2be09…61ff16` |

Identical. Same for `langgenius/gemini:0.9.1@324a17a2…b90878`. The `@<sha256>` is a **global package checksum
keyed to (plugin, version)** — public, fetchable, install-free. Only `AGENTS.md:88`'s "the hash changes when
the plugin is upgraded" survives (it is version-keyed, so a resolver must pin the version).

### How the myth becomes "できません"

1. `②Spec` reads the never-fabricate rule and **over-applies it**: "I have no hash → therefore do not use the
   tool." The dossier says so in its own words — `SPEC.md:40-41` rejects the Slack tool node with the
   rationale 「プラグインハッシュ依存が増えないため」 (to avoid adding a plugin-hash dependency).
2. It overrides `①Analyze` even when Analyze got it right: run `1784185934247`'s `analyze.json:19` **plans**
   `{"type":"tool","purpose":"要約をSlackチャンネルへ通知"}` — the shipped YAML has no tool node. A fix at
   Analyze alone is therefore insufficient.
3. The pattern library **teaches the anti-behaviour**: `templates/patterns/scheduled-fetch-notify.yml:238-240`
   hard-codes the notify step as `type: http-request` with `# TODO: your service's endpoint (Slack/Teams/…)`,
   and `②Spec`'s transcript cites that header as justification 「パターンヘッダ自身が Slack をこの経路の通知先と明記」.
   `find.py --has tool --has trigger` → **zero** matches; a whole-repo grep of all 221 YAMLs finds no file with
   both a trigger and a `type: tool` node. Any 毎朝/定期 request can only land on the one http pattern.
4. `{{KNOWLEDGE}}` — the only channel carrying workspace facts — is **Implement-only**
   (`orchestrator.ts:397-401`, spec 037 D6 v1 scope / OQ1). It arrives one phase **after** the decision.

**Measured consequence**: three consecutive naive builds → **zero** tool nodes (Slack modelled as an
`http-request` to an env-secret webhook), and spec 061's checklist never fires.

## The honest nuance

Four facts, each verified against `vendor/dify-src @ 41e2812` (DSL 0.6.0) or this repo, pull in different
directions:

- **A tool node needs NO hash.** `schemas/dify-dsl-0.6.0.json:6291-6300` requires
  `[provider_id, provider_type, provider_name, tool_name, tool_label, tool_configurations, title,
  tool_parameters]`; `plugin_unique_identifier` (:6204-6212) is `anyOf [string, null]`, default null.
- **Dify does NOT reject an import for an uninstalled plugin.** Installed-ness is never consulted on the
  import path (`app_dsl_service.py:194-323`); missing-ness is a separate, non-throwing post-import call.
- **BUT the install prompt only fires on a non-empty top-level `dependencies:`.** `app_dsl_service.py:272-285`:
  `if dependencies: … elif parse_version(imported_version) <= parse_version("0.1.5"): …`. The graph-derived
  fallback is **dead at 0.6.0** (the version this repo pins). With `dependencies: []`, both branches are
  skipped → nothing written → `check-dependencies` returns empty → `plugin-dependency/index.tsx:13-14`
  returns null → **`InstallBundle` never renders.**
- **Filling the hash silently disarms spec 061.** `report.ts:228` nests the tool checklist inside
  `if (unresolvedPluginTodo)`. A resolved hash ⇒ no TODO ⇒ **no checklist** — the user loses the
  install/API-key/test steps exactly when the build finally uses a tool. S5b below is not optional.

⇒ The stakeholder's mental model — *"if it isn't installed, Dify itself will prompt to install"* — **is
literally implemented in Dify**, but **only if we write the real identifier into `dependencies:`**. The
honest-`# TODO` path (spec 061's stated non-goal: "NOT hash auto-injection for tools … the `# TODO` + the
post-import checklist is enough") is precisely the path where **Dify stays silent** and the tool fails at
runtime with no prompt. **061's non-goal is overturned here** — but its checklist must survive the change.

Also true and unchanged: `lint_plugin_hashes.py:31-36` is a **format-only** gate — `dependencies: []` passes
all four linters trivially, so no linter can catch a missing dependency. A real marketplace identifier
satisfies its `PATTERN` (`:16-18`) verbatim.

## Goal

**G1 — a request naming a marketplace tool builds a real tool node + a real `dependencies:` entry**, resolved
from the public marketplace, lint-clean, so importing it into Dify raises **Dify's own install prompt**.
「スプレッドシートとの連携」 becomes a normal build, not a refusal — with 061's post-import checklist still shown.

## Non-goals

- NOT auto-installing plugins, and NOT asking the user what they have installed (their explicit ask: *"always
  build with the tools that exist on Dify; if it isn't installed, Dify will prompt"*).
- NOT filling tool **credentials** — API keys stay the user's job. **Spec 061's checklist step (2) already
  says this**; S5b's whole purpose is to keep that step rendering. (Do NOT delegate this to 066: 066 has no
  credential step.)
- NOT a general plugin-catalog UI. A curated resolver for the high-frequency tools is the whole scope.

## Design

### S1 — retire the myth (M, and the linchpin — ship first)

Every other slice loses to this: `implement.md:42-43` pins the build to the pattern `SPEC.md` named, and the
model obeys AGENTS.md over any new advisory prose. Edit **all** of:
- **`AGENTS.md` §4.3 wholesale (`:74-88`)** — not just `:75`. An earlier draft of this spec said "`:88`
  stays", which review showed is wrong on its own terms: half of `:88` ("**re-export and copy the fresh
  hash**") IS the Export-DSL myth. Also myth-bearing and easy to miss: `:76` ("leave `dependencies: []`
  empty and put a `# TODO: add plugin hash from target workspace` comment" — which **S5 overturns**) and
  the whole 7-step `:78-86` "How to obtain a real plugin hash (one-time per plugin **per workspace**)"
  procedure. Only the *version-drift* half of `:88` survives, reworded onto the resolver.
- `AGENTS.md` §5 (`:102`);
- **`AGENTS.md:252-254`** — *"Workspace facts are the **ONLY sanctioned source** of plugin hashes / dataset
  ids in a Builder turn … no block → leave the documented TODO form (§4.3's never-fabricate rule is
  unchanged)"*. This sentence **forbids S2/S5 outright** and is the one the review nearly let through. Admit
  the marketplace catalog as a **second sanctioned source** (spec 037 D7 Class B already licenses author-time
  hash filling); keep "never fabricate" — *resolve*, never invent.
- `docs/GUIDE.md:350`; `.claude/skills/dify-build/SKILL.md` + `implement.md` wherever they restate the rule;
- `.claude/skills/dify-build/test.md:29` — claims an import "will fail for the missing marketplace plugin".
  False per the import path above; correct it (it is also a live landmine for any human/CLI run).

### S2 — a marketplace resolver + a curated catalog (M)

`sync.py marketplace-id <org>/<name>[/<version>]` → the `unique_identifier`, via unauthenticated
`GET marketplace.dify.ai/api/v1/plugins/<org>/<name>[/<version>]`. Use the **version-specific** endpoint (the
hash is version-keyed; `latest_package_identifier` drifts). Curate the `使用頻度の高い` set — starting with
**`omluc/google_sheets`** (`0.0.2@17f06eaa…c134f`, active, 4101 installs, tools `batch_get`/`batch_update`) —
as a small checked-in catalog carrying, per tool, the fields a node needs: `provider_id`, `provider_name`,
`tool_name`, `tool_label` + its parameter/config key shape. **Offline-first**: the catalog is the source of
truth during a build (a build must never depend on network reachability); the resolver refreshes it.
*Open question for the implementer: confirm the marketplace API exposes the per-tool parameter shape — if
not, that half of the catalog is hand-curated from a one-time export.*

### S3 — a tool-node pattern exemplar, including trigger+tool (M)

Add the missing precedent: a `templates/patterns/` workflow with a real `type: tool` node AND a trigger — the
stakeholder's exact shape (毎朝 → tool). Today `--has tool --has trigger` returns nothing, so the search can
only route a scheduled request to the http-only pattern. Fix `scheduled-fetch-notify.yml:238-240` so it stops
teaching Slack-as-http as the only answer.
**Doc-drift tax** (`tests/test_docs_drift.py:15-22` counts `templates/patterns/*.yml` and asserts the number
appears in the docs): bump 9→10 in `README.md`, `AGENTS.md`, `docs/architecture.md`. The new pattern must also
pass the 5 pre-commit hooks.

### S4 — move the tool decision upstream (M)

Give `①Analyze`/`②Spec` the tool catalog (spec 037 OQ1's deferred "inject at Spec too", or a dedicated catalog
token). The decision is made at ②Spec; facts that arrive at ③Implement cannot move it — and the
`{{KNOWLEDGE}}` block's own instruction scope is value-copying, not shape-selection, so widening the data
alone is not enough. `②Spec` must be told that naming a catalogued tool is **allowed and preferred**.

### S5 — write `dependencies:` for every tool node (S)

Whenever the build emits a `type: tool` node, emit the matching
`dependencies[].value.marketplace_plugin_unique_identifier` from the catalog. This is what arms Dify's
`InstallBundle` prompt. Add a linter/post-turn check for the **converse of `lint_plugin_hashes`**: a tool node
with no matching dependency entry (today: passes all four gates, prompts nothing, fails at runtime).

### S5b — re-gate spec 061's checklist (S, mandatory with S5)

Decouple the tool checklist from the TODO marker: gate it on **`hasToolNode`**, not `unresolvedPluginTodo`
(`report.ts:228-233`). Without this, S5 makes `unresolvedPluginTodo` permanently false and 061's checklist —
the only thing telling the user to install the plugin and add its API key — silently stops rendering.

### S6 — make `plugins: []` falsifiable (S)

`dify-io.ts:548/553/554` collapse "the call failed" and "the workspace is genuinely empty" into the same `[]`,
and `:544` only bails when **all three** fail — so one failed arm writes a confident lie, unlogged (`:527`
promises "partial failure → write what succeeded (logged)"; **no such log exists**). Add per-arm provenance
(`sources: {plugins: {ok, count, error}}`) + the missing warn. *(For the investigated dossier the harvest did
NOT fail — a live re-probe returned genuinely-empty for all three. This slice closes a latent trap and is the
one slice off the stakeholder's critical path.)*

## Acceptance criteria

1. **AUTO**: given a fixture SPEC naming a catalogued tool, the build emits a `type: tool` node **and** a
   `dependencies:` entry whose identifier equals the catalog value byte-for-byte, passing all four linters.
   Pinned offline (no network).
2. **AUTO**: the catalog's identifiers match the live marketplace — a **separately-invoked, network-gated**
   test (skipped by default, like `runnability.test.ts`'s creds-gated AC-9; never a silent green in CI).
3. **AUTO**: a `type: tool` node with no matching `dependencies` entry FAILS the S5 converse check
   (regression-pinned; today it passes silently). And a tool build **still renders 061's checklist** with
   `unresolved_plugin_todo: false` — the S5b guard; today's `report-tool-note.test.ts` must be extended, not
   just kept green.
4. **AUTO**: no doc asserts the myth — a `grep` guard over `AGENTS.md` (§4.3 **and** :252-254),
   `docs/GUIDE.md`, `.claude/skills/dify-build/*.md`. The guard must cover **every phrasing**, not just
   the headline one: `workspace-specific`, `ONLY sanctioned source`, **`re-export`**, **`exported from
   the target workspace`**, **`add plugin hash from target workspace`**, `intentionally never checked in`.
   (Review found the first draft grepped only the first two — so the 7-step procedure and `:88`'s
   "re-export" would have survived S1 *undetected*, which is exactly how the myth got load-bearing.)
   The guard must also not fire on a **negation** ("the hash is **not** workspace-specific"), so match the
   assertion, not the word. `find.py --has tool --has trigger` returns ≥1 pattern.
5. **AUTO**: `npm test` + `pytest` green — explicitly including **`tests/test_docs_drift.py`** (S3's pattern
   count) and the 5 pre-commit hooks. The four linters' semantics are unchanged except S5's addition.
6. **MANUAL** (needs a human in Dify — cannot be auto-tested): importing that DSL into a workspace **without**
   the plugin raises the `InstallBundle` prompt, and a live naive prompt 「毎朝スプレッドシートに書き込む」
   actually produces a tool node (a live model build is non-deterministic — never gate CI on it). Report per
   the spec-058 three-bucket contract; never silently drop.

## References

- Stakeholder: 「ツールとしては、スプレッドシートとの連携ですね。」 + *"always build with the tools that exist on
  Dify; if not installed, Dify will prompt to install"*.
- Live evidence: dossier `1784192313811` (Slack → http-request, no tool node, `SPEC.md:40-41` rationale);
  run `1784185934247` (`analyze.json:19` plans a tool node, Spec overrides it).
- Verified 2026-07-16: `marketplace.dify.ai/api/v1/plugins/{langgenius/openai/0.2.8, langgenius/gemini/0.9.1,
  omluc/google_sheets}` == workspace exports, unauthenticated.
- `vendor/dify-src/api/services/app_dsl_service.py:47,211,272-285` (the 0.1.5 version gate — why
  `dependencies:` is load-bearing); `web/app/components/workflow/plugin-dependency/index.tsx:13-14`.
- `schemas/dify-dsl-0.6.0.json:6204-6212,6291-6300`; `tools/dify_base/lint_plugin_hashes.py:16-18,31-36`;
  `apps/builder/server/lib/orchestrator.ts:397-401`; `dify-io.ts:527,544-554`; `report.ts:228-233`;
  `templates/patterns/scheduled-fetch-notify.yml:238-240`; `tests/test_docs_drift.py:15-22`;
  `AGENTS.md:75,88,102,252-254`; `docs/GUIDE.md:350`; `.claude/skills/dify-build/test.md:29`.
- [061](061-builder-tool-node-support.md) (non-goal overturned; checklist repaired by S5b),
  [037](037-builder-runnability-preflight-and-workspace-facts.md) (OQ1, D7 Class B),
  [066](066-post-import-readiness.md) (the sibling: telling the user what to do after import).
