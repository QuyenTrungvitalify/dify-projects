/**
 * cost-cause.ts — spec 062 S3 (OQ2). A SERVER-SIDE port of the spec-059 cost classifier that lives in
 * the FE (`web/src/lib/dev.ts`): `cachePct` / `classify` / `shares` / `diagnose`. The dossier's
 * `summary.md` renders a self-contained cost table + cause hint offline, so it can't reach the FE
 * function — this duplicates the ~15-line rule set here.
 *
 * The two copies MUST agree: `test/cost-cause.test.ts` feeds the SAME vectors as
 * `web/src/lib/dev.test.ts` and asserts identical causes/shares/diagnoses, so a change to the 059
 * rules on one side that isn't mirrored fails the build (spec 062 AC #3 — the anti-drift pin).
 *
 * PURE + presence-guarded (mirrors dev.ts): every read is null-guarded, so a partial/absent PhaseCost
 * degrades rather than throws. Operates on the server `PhaseCost` shape (state/task.ts), whose field
 * names match the FE `WirePhaseCost` one-for-one.
 */
import type { PhaseCost, Task } from '../state/task.js';

type Phase = 'analyze' | 'spec' | 'implement' | 'test';
type CostMap = Task['cost'];

const PHASE_NUM: Record<Phase, string> = { analyze: '①', spec: '②', implement: '③', test: '④' };
const ORDER: Phase[] = ['analyze', 'spec', 'implement', 'test'];

export type Cause = 'cold-start' | 'tool-loop' | 'generation' | 'inconclusive';

/** cache-hit % = cacheRead / (cacheRead + input); `null` when neither is known (nothing to divide). */
export function cachePct(c: PhaseCost | undefined): number | null {
  if (!c) return null;
  const denom = (c.cacheReadTokens ?? 0) + (c.inputTokens ?? 0);
  return denom > 0 ? Math.round((100 * (c.cacheReadTokens ?? 0)) / denom) : null;
}

/** Classify ONE phase by the 059 S3 rule order — cold-start (cache miss) ▸ tool-loop (≥8 turns) ▸
 *  generation (≥6k out tok) ▸ inconclusive. HEURISTIC, per-phase (identical to dev.ts). */
export function classify(c: PhaseCost | undefined): Cause {
  if (!c) return 'inconclusive';
  const pct = cachePct(c);
  if (pct !== null && pct < 60) return 'cold-start';
  if ((c.numTurns ?? 0) >= 8) return 'tool-loop';
  if ((c.outputTokens ?? 0) >= 6000) return 'generation';
  return 'inconclusive';
}

const LEVER: Record<Cause, string> = {
  'cold-start': 'stabilize the prompt prefix + keep spawns within the cache TTL',
  'tool-loop': 'fewer internal turns — better SPEC/template seed → fewer lint→fix cycles',
  generation: 'cut whole-file re-generation (edit in place)',
  inconclusive: 'compare medians of ≥3 runs',
};

function detailOf(c: PhaseCost, cause: Cause): string {
  switch (cause) {
    case 'cold-start':
      return `cache ${cachePct(c)}%`;
    case 'tool-loop':
      return `${c.numTurns} turns`;
    case 'generation':
      return `${((c.outputTokens ?? 0) / 1000).toFixed(1)}k out tok`;
    default:
      return 'no dominant signal';
  }
}

function entriesOf(cost: CostMap): Array<readonly [Phase, PhaseCost]> {
  return ORDER.map((k) => [k, cost?.[k]] as const).filter(
    (e): e is readonly [Phase, PhaseCost] => !!e[1]
  );
}

/** Each phase's share of total `durationMs`, whole percent. Empty when no phase recorded a duration. */
export function shares(cost: CostMap): Partial<Record<Phase, number>> {
  const entries = entriesOf(cost);
  const total = entries.reduce((s, [, c]) => s + (c.durationMs ?? 0), 0);
  const out: Partial<Record<Phase, number>> = {};
  if (total <= 0) return out;
  for (const [k, c] of entries) if (c.durationMs != null) out[k] = Math.round((100 * c.durationMs) / total);
  return out;
}

export interface Diagnosis {
  phase: Phase;
  num: string;
  sharePct: number | null;
  cause: Cause;
  detail: string;
  lever: string;
  balanced: boolean;
  allSameCause: Cause | null;
}

/** The PRIORITY diagnosis — the slowest phase + its cause + the lever (the HINT line). `balanced` when
 *  no phase clearly dominates (top < 40% AND its lead < 8 pts). Identical logic to dev.ts `diagnose`. */
export function diagnose(cost: CostMap): Diagnosis | null {
  const entries = entriesOf(cost);
  if (!entries.length) return null;

  const totalMs = entries.reduce((s, [, c]) => s + (c.durationMs ?? 0), 0);
  const haveMs = entries.some(([, c]) => (c.durationMs ?? 0) > 0);
  const sorted = [...entries].sort((a, b) =>
    haveMs
      ? (b[1].durationMs ?? 0) - (a[1].durationMs ?? 0)
      : (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0)
  );
  const [phase, c] = sorted[0];
  const sharePct =
    haveMs && totalMs > 0 && c.durationMs != null ? Math.round((100 * c.durationMs) / totalMs) : null;

  let balanced = false;
  if (haveMs && totalMs > 0 && sorted.length >= 2) {
    const s0 = sorted[0][1].durationMs != null ? (100 * sorted[0][1].durationMs) / totalMs : null;
    const s1 = sorted[1][1].durationMs != null ? (100 * sorted[1][1].durationMs) / totalMs : null;
    if (s0 != null && s1 != null && s0 < 40 && s0 - s1 < 8) balanced = true;
  }

  const causes = entries.map(([, cc]) => classify(cc));
  const allSameCause = causes.every((x) => x === causes[0]) ? causes[0] : null;

  const cause = classify(c);
  const lever = balanced ? 'gather ≥3 runs before targeting a phase' : LEVER[cause];
  return { phase, num: PHASE_NUM[phase], sharePct, cause, detail: detailOf(c, cause), lever, balanced, allSameCause };
}

export { PHASE_NUM };
