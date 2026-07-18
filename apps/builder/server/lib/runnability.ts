/**
 * runnability.ts — spec 037 S1: the runnability preflight detector.
 *
 * The #1 measured failure class ("static-clean but runnable:false", 12/12 in the corpus campaign —
 * .claude/skills/report/reports/INDEX.md) is a build whose YAML passes every linter yet cannot run:
 * empty `model.provider/name`, an unresolved plugin-hash TODO, non-stdlib imports in a `code` node,
 * or an empty `dataset_ids`. This module detects those four blocker classes at the ③ Implement
 * verify and renders ONE advisory line for the gate card (the `patternAdvisory` channel pattern —
 * NEVER a gate flag, never blocks, spec 037 D3/D4).
 *
 * Split (037 r4): the backend carries NO YAML dependency (fastify only — YAML is read via inline
 * python probes, cf. post-turn's YAML_PROBE), so the spec's "pure TS parse" is implemented as:
 *   probe (inline python, extracts FACTS as JSON) → {@link classifyRunnability} (PURE, TS owns the
 *   blocker semantics) → {@link preflightNote} (PURE, one advisory line).
 * The class predicates mirror .claude/skills/report/report_structure.py (D1/D2); the AC 2 parity
 * test runs BOTH over shared fixtures and compares `runnable_blocker_classes` — the standing guard
 * against two-sources-of-truth drift.
 */
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { runPython } from './shell.js';

export interface RunnabilityBlocker {
  class: 'model_empty' | 'sandbox_trap' | 'plugin_todo' | 'dataset_empty' | 'env_secret_empty';
  nodeId?: string;
  nodeType?: string;
  /** spec 066 S2: the env var's NAME for `env_secret_empty` (dev-readable; the human `detail` says it too). */
  varName?: string;
  detail: string;
}

/**
 * Spec 066 S3 — what the model advisory is allowed to PROMISE. Spec 043 auto-injects the model at
 * live-test/deploy, so 064 phrased the advisory as reassurance ("filled in automatically when you
 * test — nothing to set up"). That promise is FALSE when the workspace has no enabled model to inject:
 * `live-test.ts:269-270` then takes the 0-model degrade instead, and the llm node keeps `provider: ''`.
 * The real dossier (run 1784192313811) had `models: []` and was told "nothing to set up".
 *
 * Deliberately NOT keyed on `task.deploy`: a `deploy: 'none'` run can still be live-tested from the UI
 * (live-test.ts never consults the deploy mode), so "none ⇒ never auto-fills" would be a fresh lie in
 * the opposite direction. Omitting the field keeps the pre-066 wording, so existing callers are unchanged.
 */
export interface RunnabilityContext {
  /** enabled models harvested from the workspace; 0 ⇒ nothing to auto-inject. `undefined` ⇒ unknown. */
  workspaceModelCount?: number;
}

export interface Preflight {
  blockers: RunnabilityBlocker[];
  checkedAt: string;
  /** spec 072 — the external-input contract carried through from facts (webhook body fields). NOT a
   *  blocker (it does not stop the build); a separate advisory rendered by {@link sourceContractNote}. */
  sourceInputs?: { name: string; type: string; required: boolean }[];
}

/**
 * D2 (spec 017, moved here from report.ts in 037 S1 to break the report↔runnability import cycle;
 * report.ts re-exports it so consumers are unchanged): does the workflow still carry an UNRESOLVED
 * plugin TODO? PURE. Convention (AGENTS.md §4.3): a workflow needing a marketplace plugin leaves
 * `dependencies: []` + a `# TODO: add plugin hash` marker; the linters PASS that, an import fails.
 */
export function hasUnresolvedPluginTodo(yamlText: string): boolean {
  const todoMarker = yamlText
    .split('\n')
    .some((line) => /#\s*todo\b/i.test(line) && /plugin/i.test(line) && /hash/i.test(line));
  if (!todoMarker) return false;
  // `(#.*)?` tolerates a trailing inline comment, e.g. `dependencies: []  # TODO add plugin hash`
  // (spec 017 D2 hardening).
  return /^[ \t]*dependencies:[ \t]*\[[ \t]*\][ \t]*(#.*)?$/m.test(yamlText);
}

/** The probe's JSON shape — raw FACTS only; classification stays in TS. */
export interface RunnabilityFacts {
  kind: 'runnability_facts';
  model_nodes: { id: string; type: string; empty: boolean }[];
  code_nodes: { id: string; nonstdlib: string[] }[];
  kr_nodes: { id: string; empty: boolean }[];
  /** spec 066 S2 — OPTIONAL: a pre-066 probe/shim emits no `env_vars`; treat absent as []. */
  env_vars?: { name: string; value_type: string; empty: boolean; referenced: boolean }[];
  /** spec 072 S1 — the trigger-webhook body: the fields an EXTERNAL source must POST for the workflow
   *  to start. OPTIONAL (an older probe/shim emits none → treat absent as []). This is the one
   *  external-input seam declared in the YAML that no other class surfaces (env/tool already are). */
  webhook_inputs?: { name: string; type: string; required: boolean }[];
}

// Inline python: extract runnability FACTS from the workflow (marker string `runnability_facts`
// keys the test shims, like YAML_PROBE's `node_ids`). Mirrors report_structure.py: the 3-type
// MODEL set with `(not provider) or (not name)`, sys.stdlib_module_names + __future__, the same
// import regex, knowledge-retrieval dataset_ids (the D2 backport adds the same to the python).
// Exported for the AC 2 parity test (it spawns the probe with an explicitly resolved python).
export const RUNNABILITY_PROBE = `
import sys, json, re, yaml
try:
    with open(sys.argv[1]) as f:
        doc = yaml.safe_load(f)
except Exception as e:
    sys.stderr.write('parse error: %s' % e); sys.exit(1)
if not isinstance(doc, dict):
    sys.stderr.write('top level is not a mapping'); sys.exit(1)
try:
    STDLIB = set(sys.stdlib_module_names)
except AttributeError:
    STDLIB = set()
STDLIB |= {'__future__'}
IMPORT_RE = re.compile(r'^\\s*(?:from|import)\\s+([a-zA-Z0-9_]+)', re.M)
MODEL_TYPES = {'llm', 'parameter-extractor', 'question-classifier'}
wf = doc.get('workflow') or {}
nodes = ((wf.get('graph') or {}).get('nodes')) or []
out = {'kind': 'runnability_facts', 'model_nodes': [], 'code_nodes': [], 'kr_nodes': [], 'env_vars': [], 'webhook_inputs': []}
# spec 066 S2: an env var declared with an EMPTY value that a node actually consumes is a human setup
# step (a Slack webhook URL, an API key) that no other class sees.
# REFERENCED-ONLY by design: a workflow may legitimately declare an env var it does not use yet, and
# an unused empty var costs the user nothing at runtime — flagging it would be a false alarm.
# TWO reference forms, both first-class in Dify (mirrors tools/dify_base/lint_refs.py, which already
# walks both: REF_PATTERN + walk_value_selectors, with SPECIAL_NS = {conversation, env, sys}):
#   1. the template form  {{#env.NAME#}}          — a string anywhere in the graph
#   2. the selector form  value_selector: [env, NAME]  — vendor/dify-src variable_factory.py:84 builds
#      env refs as [ENVIRONMENT_VARIABLE_NODE_ID='env', name], so a probe that greps only form 1
#      silently MISSES form 2 — a false negative, i.e. the exact "we never told the user" failure
#      this class exists to end.
ENV_REF_RE = re.compile(r'{{\\s*#env\\.([A-Za-z0-9_]+)#\\s*}}')
graph_dump = yaml.safe_dump(wf.get('graph') or {}, allow_unicode=True, default_flow_style=False)
referenced = set(ENV_REF_RE.findall(graph_dump))
def _walk_selectors(o):
    if isinstance(o, dict):
        for k, v in o.items():
            if k == 'value_selector' and isinstance(v, list) and len(v) >= 2:
                if str(v[0]) == 'env':
                    referenced.add(str(v[1]))
            else:
                _walk_selectors(v)
    elif isinstance(o, list):
        for it in o: _walk_selectors(it)
_walk_selectors(wf.get('graph') or {})
for n in nodes:
    if not isinstance(n, dict): continue
    d = n.get('data') or {}
    if not isinstance(d, dict): continue
    t = d.get('type'); nid = str(n.get('id', '?'))
    if t in MODEL_TYPES:
        m = d.get('model') or {}
        out['model_nodes'].append({'id': nid, 'type': t,
                                   'empty': (not m.get('provider')) or (not m.get('name'))})
    if t == 'code':
        mods = set(IMPORT_RE.findall(d.get('code') or ''))
        out['code_nodes'].append({'id': nid, 'nonstdlib': sorted(mods - STDLIB)})
    if t == 'knowledge-retrieval':
        out['kr_nodes'].append({'id': nid, 'empty': not d.get('dataset_ids')})
    if t == 'trigger-webhook':  # spec 072 S1 — the external-source input contract, declared right here
        for b in (d.get('body') or []):
            if isinstance(b, dict) and b.get('name'):
                out['webhook_inputs'].append({'name': str(b.get('name')),
                                              'type': str(b.get('type') or ''),
                                              'required': bool(b.get('required'))})
for ev in (wf.get('environment_variables') or []):
    if not isinstance(ev, dict): continue
    # Dify declares env vars with \`name:\` (spec 057 gotcha: \`variable:\` breaks the import).
    name = ev.get('name') or ev.get('variable')
    if not name: continue
    out['env_vars'].append({'name': str(name),
                            'value_type': str(ev.get('value_type') or ''),
                            'empty': not ev.get('value'),
                            'referenced': str(name) in referenced})
print(json.dumps(out))
`;

/** PURE — facts + raw text → the blocker classes (D2). Exported for direct unit tests.
 *  `ctx` (spec 066 S3) is OPTIONAL: omitted ⇒ the pre-066 reassuring model wording. */
export function classifyRunnability(
  facts: RunnabilityFacts,
  yamlText: string,
  ctx: RunnabilityContext = {}
): Preflight {
  const blockers: RunnabilityBlocker[] = [];
  // spec 066 S3: can the auto-fill (043) actually happen? Only if the workspace HAS a model to
  // inject. `undefined` = not told → assume yes (pre-066 wording, byte-identical).
  const noModelInWorkspace = ctx.workspaceModelCount === 0;
  for (const m of facts.model_nodes) {
    if (m.empty) {
      blockers.push({
        // spec 064: plain-language detail (the node id stays on the object for dev, OUT of the human
        // text). spec 066 S3: reassurance ONLY when it is TRUE. The naive dossier (run 1784192313811)
        // had workspace `models: []` and was still told "nothing to set up" — the most reassuring
        // phrase in the note, about the one thing that guaranteed the workflow could never run.
        class: 'model_empty', nodeId: m.id, nodeType: m.type,
        detail: noModelInWorkspace
          ? 'an AI model — add one in Dify first (this workflow can\'t summarize or write without it)'
          : 'the AI model (filled in automatically when you test — nothing to set up)',
      });
    }
  }
  for (const c of facts.code_nodes) {
    if (c.nonstdlib.length) {
      blockers.push({
        // The node id stays on the object for dev; the human text names the MODULES, which is the
        // part a user could act on, and drops the id — a bare 13-digit id is unreadable and fails the
        // comprehension gate. (`model_empty`/`plugin_todo` were cleaned earlier; these two were not.)
        class: 'sandbox_trap', nodeId: c.id, nodeType: 'code',
        detail: `a code step uses ${c.nonstdlib.join(', ')}, which Dify's sandbox does not provide — it needs rewriting with the standard library`,
      });
    }
  }
  if (hasUnresolvedPluginTodo(yamlText)) {
    // spec 064: plain — no "plugin hash"/"dependencies" jargon reaches the user.
    blockers.push({ class: 'plugin_todo', detail: 'a plugin this workflow needs — install it in Dify Studio → Plugins if a run reports it missing' });
  }
  for (const k of facts.kr_nodes) {
    if (k.empty) {
      blockers.push({
        class: 'dataset_empty', nodeId: k.id, nodeType: 'knowledge-retrieval',
        detail: 'a knowledge base to search — pick one in Dify (this step has none selected yet)',
      });
    }
  }
  // spec 066 S2 — the fifth class. The real naive build (run 1784192313811) declared
  // `SLACK_WEBHOOK_URL` with `value: ''` and POSTed to `{{#env.SLACK_WEBHOOK_URL#}}`; the preflight
  // read only `graph.nodes`, so it saw nothing and the note told the user "nothing to set up". At 9am
  // the POST fired at an empty URL and the Slack message — the whole point of the request — never came.
  // `?? []` keeps a pre-066 probe (or a test shim) working: no field ⇒ no blockers, never a crash.
  for (const e of facts.env_vars ?? []) {
    if (e.empty && e.referenced) {
      blockers.push({
        class: 'env_secret_empty', varName: e.name,
        detail: `a value for ${e.name} — you'll paste this into Dify (the workflow can't run without it)`,
      });
    }
  }
  // spec 072 S1 — carry the external-input contract (webhook body) so the ④ report can tell the client
  // what their SOURCE must send. Not a blocker: the build runs; the SOURCE side is the client's to wire.
  return { blockers, checkedAt: new Date().toISOString(), sourceInputs: facts.webhook_inputs ?? [] };
}

/**
 * spec 072 S2 — the external-input contract advisory: what the client's SOURCE must provide.
 *
 * The google_slack build (run 1784367964063) was correct and the notes guided 5/6 setup steps, but
 * omitted the 6th: the workflow starts on a webhook, and NOTHING told the client their source (a Google
 * Form + Apps Script, or any service) must POST those fields to the webhook URL. Silent-import-success
 * one layer up — at the SOURCE. This is the line that closes it. Plain-language (spec 064 lineage, no
 * jargon → passes the 063 comprehension gate); a sibling to TRIGGER_ENABLE_NOTE, not a blocker.
 *
 * Returns null when there is no external-input seam (no webhook body) — most workflows.
 */
export function sourceContractNote(p: Preflight): string | null {
  const fields = p.sourceInputs ?? [];
  if (!fields.length) return null;
  const named = fields
    .map((f) => (f.required ? `${f.name} (required)` : f.name))
    .join(', ');
  return (
    'This workflow starts from a webhook, so something outside Dify has to send it data: your source ' +
    `(for example a Google Form + Apps Script, or any service that can POST) must call the webhook URL ` +
    `Dify shows after you enable the trigger, sending these fields: ${named}.`
  );
}

/** The ONE advisory line for the gate card / report notes (null = no blockers → clear the note).
 *  Self-declaring as advisory — the `patternAdvisory` voice (D3). */
export function preflightNote(p: Preflight): string | null {
  if (!p.blockers.length) return null;
  const parts = p.blockers.map((b) => b.detail);
  // Spec 066 S5: the FRAME goes plain too. Spec 064 made each blocker `detail` readable but left this
  // wrapper as `preflight: not runnable out-of-the-box — needs: … Advisory — does not block the build.`
  // — "preflight"/"Advisory" are internal vocabulary (an aviation/CI term and a status word), and the
  // sentence opened with a lowercase "preflight:" that `join(' ')` fused onto the lint line into the
  // nonsense run-on "all linters passed preflight". Self-terminating, capitalised, and it says WHO does
  // what: the build is finished; these are the user's remaining steps.
  return `Before this workflow can run, you need to: ${parts.join('; ')}. (The build itself is finished — these are setup steps in Dify.)`;
}

/** Probe + classify one workflow file. Throws on unreadable/unparseable input — callers (the ③
 *  implement verify, the ④ report) wrap in try/catch and treat a throw as warn-only (D4).
 *  `python` is the 013-D2 runner seam: the orchestrator passes `resolveRunners(ctx).runPython`
 *  so tests drive the preflight through the same injection point as everything else. */
export async function checkRunnability(
  projectsDir: string,
  workflowRel: string,
  python: typeof runPython = runPython,
  ctx: RunnabilityContext = {} // spec 066 S3 — omitted ⇒ pre-066 wording (callers opt in)
): Promise<Preflight> {
  const probe = await python(projectsDir, ['-c', RUNNABILITY_PROBE, workflowRel]);
  if (probe.code !== 0) {
    throw new Error(`runnability probe failed: ${(probe.stderr || probe.stdout).trim().slice(0, 200)}`);
  }
  const facts = JSON.parse(probe.stdout) as RunnabilityFacts;
  const yamlText = await readFile(join(projectsDir, workflowRel), 'utf8');
  return classifyRunnability(facts, yamlText, ctx);
}
