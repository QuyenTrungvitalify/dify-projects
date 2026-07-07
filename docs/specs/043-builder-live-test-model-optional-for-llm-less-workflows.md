# Spec 043 — Live-test doesn't require a workspace LLM model when the workflow has no LLM node

**Status**: Implemented 2026-07-07 (D1–D3 landed; unit tests green — `test_sync.py` 12/12, builder 377/377).
**Backend-only**, small (`sync.py inject-model` + `dify-io.ts` + `live-test.ts` + tests). No frontend/i18n
change, no gate-FSM change, no new deps. **OQ1 still open** — verify on the target self-host that Dify runs
a model-agnostic app on a 0-model workspace (see Open question).

> **Reference the SYMBOL, not the line.** Line links verified 2026-07-07; re-grep before editing.
> *(Renumbered 042→043: number 042 was concurrently claimed by `042-foreign-residue-preflight.md`.)*

**Motivation (user)**: a purely deterministic workflow (e.g. `start → document-extractor → code →
tool/md_exporter → end`, **zero LLM nodes**) still parked at `LIVE ⚠` with
`no enabled LLM model in the workspace (0-model)` — refusing to run the live test. The message is
misleading (the workflow uses no LLM) and the gate is over-strict (a model-agnostic workflow needs no
workspace model to run). *"Make it more flexible."*

**Builds on**:
- [032](032-builder-live-workflow-test.md) — the live-test sub-orchestrator + the model auto-fill
  (§2). This spec relaxes ONE precondition in it.
- [036](036-builder-capability-aware-test-targets.md) — capability-driven test targets. Unchanged.
- [041](041-builder-request-changes-everywhere.md) — *(sibling)*: at the resulting `LIVE ⚠` gate the
  user can now Request-changes; 043 reduces how often that gate is reached at all for LLM-less workflows.

---

## Root cause

`runLiveTest` bails on a missing workspace model **before** it considers whether the workflow even has an
LLM node ([live-test.ts:191-194](../../apps/builder/server/lib/live-test.ts#L191-L194)):

```ts
const { enabled, pick } = await live.resolveLlmModels(projectsDir);
if (!pick) return degradeStatic('no enabled LLM model in the workspace (0-model)');   // ← unconditional
```

`pick` is null when the workspace has **0 enabled LLM models**. The bail is a **blanket precondition**: it
fires for every workflow regardless of node types. But the model is only ever needed to **auto-fill LLM
nodes** — `inject-model` walks the graph and patches only `data.type === 'llm'` nodes
([sync.py:618-631](../../tools/dify_base/sync.py#L618-L631)); a workflow with **zero** LLM nodes patches
nothing (`node_count: 0`) and the `--provider/--name` args are never read
([dify-io.ts:709](../../apps/builder/server/lib/dify-io.ts#L709) — *"`nodeCount:0` ⇒ nothing to patch"*).
So the model requirement is spurious for LLM-less workflows.

## Design principle

**Require a workspace model only when the workflow actually contains an LLM node.** For a model-agnostic
workflow (no LLM node), skip the model entirely and run the live test on a 0-model workspace.

## Decisions

### D1 — `inject-model` reports the TOTAL LLM-node count (`sync.py`)

`cmd_inject_model` currently returns `node_count` = **patched** LLM nodes (empty/invalid model). Add
`llm_count` = **total** `data.type === 'llm'` nodes (patched or not), so the caller can gate on
"does this workflow use an LLM at all", not merely "how many got auto-filled":

```python
llm_nodes = [n for n in nodes if (n.get("data") or {}).get("type") == "llm"]
# … existing patch loop over llm_nodes …
print(json.dumps({ "node_count": len(patched), "llm_count": len(llm_nodes), "patched": patched, … }))
```

Why total, not patched: a (rare, seed-imported) LLM node with a **hard-coded** model that isn't enabled
in a 0-model workspace has `node_count: 0` (nothing patched under `valid=None`) yet still can't run — so
`llm_count` is the correct "needs a model" signal. Builder-produced workflows keep LLM models **empty**
(032 B5), so for them `llm_count == node_count` anyway.

### D2 — Surface `llmCount` on `DeployResult` (`dify-io.ts`)

Add `llmCount: number` to `DeployResult` and read it from the JSON
([dify-io.ts:723-729](../../apps/builder/server/lib/dify-io.ts#L723-L729)):
`const llmCount = typeof obj?.llm_count === 'number' ? obj.llm_count : nodeCount;` (fall back to
`nodeCount` so an older `sync.py` degrades gracefully).

### D3 — Make the 0-model gate conditional (`live-test.ts`)

Deploy FIRST (which reveals `llmCount`), THEN gate on the workflow actually needing a model:

```ts
// 1. resolve workspace models (may be empty — do NOT bail yet).
const { enabled, pick } = await live.resolveLlmModels(projectsDir);
if (bail()) return;

// 2. deploy: inject a model into empty LLM nodes. With no model available, pass a placeholder — a
//    workflow with 0 LLM nodes patches nothing, so the copy is valid & model-free (spec 043). The
//    placeholder is only ever written into an LLM node when llmCount>0, and D3's gate rejects that
//    deploy.yml BEFORE it is imported, so a bad copy never reaches Dify.
const dep = await live.deployWithModel(projectsDir, srcRel, outRel, pick ?? { provider: '', name: '' }, enabled.map((m) => m.name));
if (bail()) return;
if (!dep.ok || !dep.outFile) return degradeStatic(`model inject failed: ${lastLine(dep.stderr) || 'unknown'}`, pick ? { model: pick } : {});

// 3. 0-model gate — CONDITIONAL (spec 043): only a workflow that CONTAINS an LLM node needs a model.
if (dep.llmCount > 0 && !pick) {
  return degradeStatic('no enabled LLM model in the workspace (0-model)', { modelAutofilled: dep.nodeCount });
}
// llmCount === 0 (or a real pick) → proceed to import + run; a model-agnostic workflow runs model-free.
```

- The downstream verdict/report already tolerates `pick === null` + `nodeCount === 0`: the success line
  reads *"workflow's own model"* for `nodeCount === 0`
  ([live-test.ts:293](../../apps/builder/server/lib/live-test.ts#L293)); `base.model = pick` (null) shows
  no model — correct for an LLM-less run. *(Polish, optional: reword `nodeCount===0` to "no model needed
  (deterministic)" — cosmetic, not required.)*
- The `deploy.yml` written for an `llmCount>0 && !pick` degrade is a throwaway in `.runs/<taskId>/` and is
  never imported — no cleanup needed.

## Acceptance

1. A workflow with **0 LLM nodes** on a **0-model** workspace **runs the live test** (imports, runs,
   verdict `passed`/`workflow_fail`/`need_input`) instead of parking at `infra_degraded`/`LIVE ⚠`.
2. A workflow **with** an LLM node on a **0-model** workspace still degrades to static with the `0-model`
   message (unchanged behavior — genuinely can't fill/run the LLM).
3. A workflow with an LLM node on a workspace **with** models is unchanged (auto-fills + runs, as 032).
4. No frontend/i18n/gate-FSM change; `sync.py` change is additive (extra JSON field), old callers unaffected.

## Verify / tests
- `live-test.test.ts`: the existing `'0-model → infra_fail / static-only, parked at infra_degraded'`
  case ([live-test.test.ts:163](../../apps/builder/test/live-test.test.ts#L163)) splits into two — a
  0-model + **LLM** workflow (still degrades) and a 0-model + **LLM-less** workflow (now runs). Drive both
  through the injected `live` fakes (`resolveLlmModels → {enabled:[], pick:null}`; `deployWithModel`
  returning `llmCount:0` vs `llmCount:1`).
- A `sync.py` fixture test: `inject-model` on an LLM-less workflow returns `llm_count: 0, node_count: 0`;
  on an empty-model LLM workflow returns `llm_count: 1, node_count: 1`.

## Open question
- **OQ1 (verify against real Dify)**: does Dify's `/workflows/run` execute a model-agnostic app on a
  workspace with **0 enabled models**? The design assumes yes (the app declares no model dependency). If a
  given Dify build requires a workspace default model to run *any* app, an LLM-less run would fail at
  runtime → surfaced as `workflow_fail`/error rather than the old clean `0-model` degrade. Acceptable
  worst case (louder, not silently wrong), but if it proves common, add a fallback: on a run error whose
  body mentions a missing/default model, `degradeStatic` with the 0-model reason. Confirm on the target
  self-host before closing.
