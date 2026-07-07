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
  class: 'model_empty' | 'sandbox_trap' | 'plugin_todo' | 'dataset_empty';
  nodeId?: string;
  nodeType?: string;
  detail: string;
}

export interface Preflight {
  blockers: RunnabilityBlocker[];
  checkedAt: string;
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
nodes = (((doc.get('workflow') or {}).get('graph') or {}).get('nodes')) or []
out = {'kind': 'runnability_facts', 'model_nodes': [], 'code_nodes': [], 'kr_nodes': []}
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
print(json.dumps(out))
`;

/** PURE — facts + raw text → the four blocker classes (D2). Exported for direct unit tests. */
export function classifyRunnability(facts: RunnabilityFacts, yamlText: string): Preflight {
  const blockers: RunnabilityBlocker[] = [];
  for (const m of facts.model_nodes) {
    if (m.empty) {
      blockers.push({
        class: 'model_empty', nodeId: m.id, nodeType: m.type,
        detail: `model fill (${m.type} ${m.id}; auto-injected at live test/deploy)`,
      });
    }
  }
  for (const c of facts.code_nodes) {
    if (c.nonstdlib.length) {
      blockers.push({
        class: 'sandbox_trap', nodeId: c.id, nodeType: 'code',
        detail: `code node ${c.id} imports non-stdlib (${c.nonstdlib.join(', ')}) — fails in the Dify sandbox`,
      });
    }
  }
  if (hasUnresolvedPluginTodo(yamlText)) {
    blockers.push({ class: 'plugin_todo', detail: 'plugin hash (dependencies TODO)' });
  }
  for (const k of facts.kr_nodes) {
    if (k.empty) {
      blockers.push({
        class: 'dataset_empty', nodeId: k.id, nodeType: 'knowledge-retrieval',
        detail: `dataset_ids (knowledge-retrieval ${k.id})`,
      });
    }
  }
  return { blockers, checkedAt: new Date().toISOString() };
}

/** The ONE advisory line for the gate card / report notes (null = no blockers → clear the note).
 *  Self-declaring as advisory — the `patternAdvisory` voice (D3). */
export function preflightNote(p: Preflight): string | null {
  if (!p.blockers.length) return null;
  const parts = p.blockers.map((b) => b.detail);
  return `preflight: not runnable out-of-the-box — needs: ${parts.join(', ')}. Advisory — does not block the build.`;
}

/** Probe + classify one workflow file. Throws on unreadable/unparseable input — callers (the ③
 *  implement verify, the ④ report) wrap in try/catch and treat a throw as warn-only (D4).
 *  `python` is the 013-D2 runner seam: the orchestrator passes `resolveRunners(ctx).runPython`
 *  so tests drive the preflight through the same injection point as everything else. */
export async function checkRunnability(
  projectsDir: string,
  workflowRel: string,
  python: typeof runPython = runPython
): Promise<Preflight> {
  const probe = await python(projectsDir, ['-c', RUNNABILITY_PROBE, workflowRel]);
  if (probe.code !== 0) {
    throw new Error(`runnability probe failed: ${(probe.stderr || probe.stdout).trim().slice(0, 200)}`);
  }
  const facts = JSON.parse(probe.stdout) as RunnabilityFacts;
  const yamlText = await readFile(join(projectsDir, workflowRel), 'utf8');
  return classifyRunnability(facts, yamlText);
}
