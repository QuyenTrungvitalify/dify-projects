/**
 * dossier.ts — spec 062 S3. `buildDossier` is a PURE function that renders the run's `summary.md`:
 * one improvement-oriented screen (intent → result → flow → acceptance → cost/cause → gaps → process
 * → files). It reads only what it is handed (task + parsed artifacts + the S1b event timeline), so a
 * PARTIAL run (errored / in-progress) still yields a coherent dossier that names the missing pieces.
 *
 * Pure + defensive: every field is optional-guarded, so a half-built run never throws. The cause hint
 * reuses the server-side 059 classifier (lib/cost-cause.ts, pinned to the FE copy by AC #3).
 */
import type { JudgeVerdict, Task } from '../state/task.js';
import type { RunEvent } from './run-events.js';
import type { ToolStats } from './run-transcript.js';
import { cachePct, classify, diagnose, shares, PHASE_NUM, type Diagnosis } from './cost-cause.js';

type Phase = 'analyze' | 'spec' | 'implement' | 'test';
const PHASE_LABEL: Record<Phase, string> = { analyze: 'Analyze', spec: 'Spec', implement: 'Implement', test: 'Test' };
const ORDER: Phase[] = ['analyze', 'spec', 'implement', 'test'];

export interface DossierInput {
  task: Task;
  events: RunEvent[];
  /** the Acceptance-Criteria list parsed from criteria.json (each item's `criterion` text). */
  criteria?: Array<{ criterion?: string }> | null;
  /** report.json `.notes[]` — the ④ report's advisory lines. */
  reportNotes?: string[] | null;
  /** the archive entry names actually bundled (for the "Files in this bundle" listing). */
  files: string[];
  /** a human note about anything omitted (e.g. "2 attachments omitted — over the 25 MB cap"). */
  omittedNote?: string | null;
  /** node count of the produced DSL, if the caller cheaply derived it (else the graph line is generic). */
  nodeCount?: number | null;
  /** per-phase tool-activity tally (parsed from the transcripts) — surfaces "how much groping" so a
   *  ③-cost analysis reads at a glance instead of hand-counting the tool list. */
  toolStats?: Partial<Record<Phase, ToolStats>>;
}

/** Build the `summary.md` text. Never throws. */
export function buildDossier(input: DossierInput): string {
  const { task, events } = input;
  const partial = task.status !== 'done';
  const s: string[] = [];

  const title = (task.name && task.name.trim()) || task.workflowSlug || task.requirement.slice(0, 40) || task.taskId;
  s.push(`# Run dossier — ${title} · ${task.taskId}`);
  if (partial) s.push('', `> ⚠ PARTIAL RUN (status=${task.status}) — some pieces below may be missing.`);
  s.push('');

  const runnable = task.preflightNote ? 'no — see Gaps' : 'yes (no preflight blockers noted)';
  s.push(`**Intent**    ${oneLine(task.requirement)}`);
  s.push(`**Result**    status=${task.status} · phase=${PHASE_NUM[task.phase] ?? task.phase} · runnable: ${runnable}`);
  const feats = task.analysisFeatures?.length ? ` · features [${task.analysisFeatures.join(', ')}]` : '';
  if (task.analysisPattern || feats) s.push(`**Pattern**   ${task.analysisPattern ?? '(none)'}${feats}`);
  s.push('');

  // ── Flow (S1b) ──
  s.push('## Flow — what happened, in order');
  const flow = flowLines(events);
  s.push(...(flow.length ? flow : ['- (no timeline recorded — a pre-062 build, or events.jsonl absent)']));
  s.push('');

  // ── Acceptance criteria ──
  s.push('## Acceptance criteria');
  s.push(...acceptanceLines(input.criteria, task.liveTest?.judge));
  s.push('');

  // ── Cost & cause (059) ──
  s.push('## Cost & cause (spec 059)');
  s.push(...costLines(task.cost));
  s.push('');

  // ── Gaps ──
  s.push('## Gaps to improve');
  const gaps: string[] = [];
  if (task.preflightNote) gaps.push(`- preflight: ${oneLine(stripLabel(task.preflightNote))}`);
  if (task.probeNote) gaps.push(`- probe:     ${oneLine(stripLabel(task.probeNote))}`);
  for (const n of input.reportNotes ?? []) if (n?.trim()) gaps.push(`- report:    ${oneLine(n)}`);
  if (task.error) gaps.push(`- error:     ${oneLine(task.error)}`);
  s.push(...(gaps.length ? gaps : ['- (none noted)']));
  s.push('');

  // ── Process (attempts & steering + tool activity) ──
  s.push('## Process — attempts & steering');
  s.push(...processLines(events, input.toolStats));
  s.push('');

  // ── Graph + files ──
  const nodes = input.nodeCount != null ? `${input.nodeCount} nodes` : 'see the DSL';
  s.push(`## Graph (DSL)   ${nodes} — workflows/${task.workflowFile}`);
  s.push('## Files in this bundle');
  s.push(...input.files.map((f) => `- ${f}`));
  if (input.omittedNote) s.push(`- omitted: ${oneLine(input.omittedNote)}`);
  s.push('');

  return s.join('\n');
}

/** Spec 062 #2 — the MACHINE-READABLE twin of the dossier. `summary.md` is prose (for a human); this is
 *  the same facts as JSON so a FLEET of client exports aggregates with `jq`, not by re-parsing text. */
export interface DossierData {
  taskId: string;
  name: string | null;
  intent: string;
  status: string;
  phase: string;
  /** true=no preflight blockers on a done build · false=preflight flagged · null=unknown (in-progress). */
  runnable: boolean | null;
  pattern: string | null;
  features: string[];
  cost: { perPhase: NonNullable<Task['cost']>; cause: Diagnosis | null };
  toolStats: Partial<Record<Phase, ToolStats>>;
  flow: RunEvent[];
  acceptance: Array<{ criterion: string; pass: boolean | null }>;
  gaps: { preflight: string | null; probe: string | null; report: string[]; error: string | null };
  files: string[];
}

/** Build the structured dossier data (never throws). Derives from the SAME helpers as `buildDossier`,
 *  so the JSON and the markdown can't disagree. */
export function buildDossierData(input: DossierInput): DossierData {
  const { task } = input;
  return {
    taskId: task.taskId,
    name: task.name ?? null,
    intent: task.requirement,
    status: task.status,
    phase: task.phase,
    runnable: task.preflightNote ? false : task.status === 'done' ? true : null,
    pattern: task.analysisPattern ?? null,
    features: task.analysisFeatures ?? [],
    cost: { perPhase: task.cost ?? {}, cause: diagnose(task.cost) },
    toolStats: input.toolStats ?? {},
    flow: input.events,
    acceptance: matchedAcceptance(input.criteria, task.liveTest?.judge),
    gaps: {
      preflight: task.preflightNote ? stripLabel(task.preflightNote) : null,
      probe: task.probeNote ? stripLabel(task.probeNote) : null,
      report: (input.reportNotes ?? []).filter((n): n is string => !!n?.trim()),
      error: task.error ?? null,
    },
    files: input.files,
  };
}

function flowLines(events: RunEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    const p = e.phase && e.phase in PHASE_NUM ? PHASE_NUM[e.phase as Phase] : '·';
    const lbl = e.phase && e.phase in PHASE_LABEL ? PHASE_LABEL[e.phase as Phase] : '';
    const d = e.detail ? oneLine(e.detail) : '';
    switch (e.kind) {
      case 'phase_start': out.push(`- ${p} ${lbl} started${d ? ` (${d})` : ''}`); break;
      case 'turn_spawned': out.push(`- ${p} turn spawned${d ? ` (${d})` : ''}`); break;
      case 'gate_reached': out.push(`- ${p} gate reached${d ? `: ${d}` : ''}`); break;
      case 'gate_action': out.push(`- ${p} → ${d || 'confirm'}`); break;
      case 'request_changes': out.push(`- ${p} ⤺ request-changes${d ? `  "${d}"` : ''}`); break;
      case 'error': out.push(`- ${p} ✗ ERROR${d ? `  ${d}` : ''}`); break;
      case 'retry': out.push(`- ${p} ↻ retry${d ? `  "${d}"` : ''}`); break;
      case 'live_test': out.push(`- ④ live-test${d ? `: ${d}` : ''}`); break;
      // spec 094 S1 — reads as a sibling of the request_changes line right above it, which is the
      // whole point: "⤺ request-changes" followed by "= no file change" is the empty round, visible.
      case 'artifact_unchanged': out.push(`- ${p} = no file change${d ? ` (${d})` : ''}`); break;
    }
  }
  return out;
}

/** Match each acceptance criterion against the live-test judge's per-criterion verdict (advisory) when
 *  present. `pass: null` = no judge verdict (not yet tested). Shared by the MD renderer + the JSON twin. */
function matchedAcceptance(
  criteria: DossierInput['criteria'],
  judge: JudgeVerdict | undefined
): Array<{ criterion: string; pass: boolean | null }> {
  const list = (criteria ?? []).map((c) => c?.criterion).filter((x): x is string => !!x && !!x.trim());
  const verdicts = new Map<string, boolean>();
  for (const jc of judge?.criteria ?? []) if (jc.criterion) verdicts.set(jc.criterion.trim(), jc.pass);
  return list.map((c) => ({ criterion: oneLine(c), pass: verdicts.has(c.trim()) ? verdicts.get(c.trim())! : null }));
}

function acceptanceLines(criteria: DossierInput['criteria'], judge: JudgeVerdict | undefined): string[] {
  const items = matchedAcceptance(criteria, judge);
  if (!items.length) return ['- (no acceptance rubric — criteria.json absent or a smoke-test)'];
  return items.map(({ criterion, pass }) => {
    const box = pass ? '[x]' : '[ ]';
    const mark = pass === null ? '' : pass ? ' ✓' : ' ✗';
    return `- ${box} ${criterion}${mark}`;
  });
}

function costLines(cost: Task['cost']): string[] {
  const share = shares(cost);
  const rows: string[] = [];
  for (const k of ORDER) {
    const c = cost?.[k];
    if (!c) continue;
    const sh = share[k] != null ? `${share[k]}%` : '—';
    const turns = c.numTurns != null ? String(c.numTurns) : '—';
    const pct = cachePct(c);
    rows.push(`| ${PHASE_NUM[k]} ${k} | ${sh} | ${turns} | ${pct != null ? pct + '%' : '—'} | ${classify(c)} |`);
  }
  if (!rows.length) return ['(no cost recorded — a pre-059 build, or every turn died before a result event)'];
  const d = diagnose(cost);
  const hint = d
    ? d.balanced
      ? `→ balanced — no single bottleneck (${d.allSameCause ? 'all ' + d.allSameCause : 'mixed causes'}); ${d.lever}`
      : `→ ${d.num} ${d.phase}${d.sharePct != null ? ` ${d.sharePct}%` : ''} · ${d.cause} (${d.detail}) → ${d.lever}`
    : '';
  return ['| phase | share | turns | cache% | cause |', '|---|---|---|---|---|', ...rows, ...(hint ? [hint] : [])];
}

function processLines(events: RunEvent[], toolStats?: Partial<Record<Phase, ToolStats>>): string[] {
  const out: string[] = [];
  const startCount: Partial<Record<string, number>> = {};
  const errCount: Partial<Record<string, number>> = {};
  const steering: string[] = [];
  for (const e of events) {
    if (e.kind === 'phase_start' && e.phase) startCount[e.phase] = (startCount[e.phase] ?? 0) + 1;
    if (e.kind === 'error' && e.phase) errCount[e.phase] = (errCount[e.phase] ?? 0) + 1;
    if ((e.kind === 'request_changes' || e.kind === 'retry') && e.detail?.trim()) {
      const p = e.phase && e.phase in PHASE_NUM ? PHASE_NUM[e.phase as Phase] : '·';
      steering.push(`${p} "${oneLine(e.detail)}"`);
    }
  }
  for (const k of ORDER) {
    const n = startCount[k];
    const ts = toolStats?.[k];
    if (!n && !(ts && ts.total)) continue; // nothing recorded for this phase
    const bits: string[] = [];
    if (n) {
      const errs = errCount[k] ?? 0;
      const attempts = n > 1 || errs ? ` (${errs ? `${errs} error → ` : ''}${n} attempt${n > 1 ? 's' : ''})` : '';
      bits.push(`${n} phase-start${n > 1 ? 's' : ''}${attempts}`);
    }
    if (ts && ts.total) bits.push(toolActivity(ts));
    out.push(`- ${PHASE_NUM[k as Phase]} ${PHASE_LABEL[k]}: ${bits.join(' · ')} — see transcripts/${k}.md`);
  }
  if (steering.length) out.push(`- user steering: ${steering.join(' · ')}`);
  return out.length ? out : ['- (single clean pass — no retries or steering recorded)'];
}

/** "32 tool calls, 15 ✗ (47%) — 18 Bash · 10 Grep · 3 Read · 1 Write" — the at-a-glance groping metric. */
function toolActivity(ts: ToolStats): string {
  const pct = ts.total ? Math.round((100 * ts.fails) / ts.total) : 0;
  const fails = ts.fails ? `, ${ts.fails} ✗ (${pct}%)` : '';
  const top = ts.byTool.slice(0, 6).map((t) => `${t.count} ${t.name}`).join(' · ');
  return `${ts.total} tool call${ts.total === 1 ? '' : 's'}${fails}${top ? ` — ${top}` : ''}`;
}

function oneLine(s: string): string {
  return s.replace(/\s*\n\s*/g, ' ⏎ ').trim();
}

/** Strip a note's OWN leading "preflight:"/"probe:"/"import-probe:" label, since the Gaps row prefixes
 *  its own — otherwise `task.preflightNote = "preflight: …"` renders "- preflight: preflight: …". */
function stripLabel(s: string): string {
  return s.replace(/^\s*(preflight|import-probe|probe)\s*:\s*/i, '');
}
