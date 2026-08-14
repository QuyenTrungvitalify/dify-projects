/* dev.ts — spec 059 dev panel.
 *
 * A RUNTIME dev flag (NOT Vite's compile-time `import.meta.env.DEV`, which is `false` in the prod
 * build served from `web/dist` — the way this app actually runs). `?dev=1` in the URL turns the dev
 * panel on and persists it to localStorage so it survives reloads; `?dev=0` turns it off. Read ONCE
 * at module load — flip the flag then reload to change it. All access is try-wrapped so a missing
 * `location`/`localStorage` (node test env) degrades to `false`, never throws.
 */
import type { WirePhaseCost, WireTask } from '../types';

const DEV_KEY = 'builder:dev';

function readDevFlag(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('dev');
    if (q === '1' || q === 'on' || q === 'true') localStorage.setItem(DEV_KEY, '1');
    else if (q === '0' || q === 'off' || q === 'false') localStorage.removeItem(DEV_KEY);
    return localStorage.getItem(DEV_KEY) === '1';
  } catch {
    return false;
  }
}

/** True when the dev panel should render (taskId + per-phase cost). Evaluated at load. */
export const devMode = readDevFlag();

/** Try-wrapped localStorage — a missing/blocked `localStorage` (node test env, private mode)
 *  degrades to a no-op / null instead of throwing. Shared by the dev-only surfaces. */
export const ls = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* no-op */
    }
  },
  del(k: string): void {
    try {
      localStorage.removeItem(k);
    } catch {
      /* no-op */
    }
  },
};

/** cache-hit % = cacheRead / (cacheRead + input). `null` when neither is known (nothing to divide) —
 *  the caller renders `—` rather than a misleading 0%. */
export function cachePct(c: WirePhaseCost | undefined): number | null {
  if (!c) return null;
  const denom = (c.cacheReadTokens ?? 0) + (c.inputTokens ?? 0);
  return denom > 0 ? Math.round((100 * (c.cacheReadTokens ?? 0)) / denom) : null;
}

/** A table cell: a rounded integer, or `—` for a missing/non-finite value. */
export function fmt(v: number | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v)) : '—';
}

/** `12345` → `12.3k`. Tokens are read at a glance, and a 6-digit number is not. */
function tok(v: number | undefined): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
}

/** `claude-opus-4-5-20260101` → `opus-4-5`. The vendor prefix and the date stamp are the same on every
 *  line; what a reader is scanning for is which FAMILY answered. */
export function shortModel(id: string | undefined): string | null {
  if (!id) return null;
  // Strip EVERY dotted prefix, not just one: a Bedrock id is `us.anthropic.claude-…`, so a single-segment
  // strip left `anthropic.claude-opus-4-8` — worse than doing nothing, because it looks deliberate.
  return id.replace(/^([a-z0-9-]+\.)+/, '').replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/\[1m\]$/, ' 1m');
}

/**
 * The one-line dev tip under an answer: which model answered, what it cost, how long it took.
 *
 * Returns `null` when the turn reported nothing numeric — a tip made of `—` separators tells the reader
 * less than no tip at all, and this line only exists to be glanceable. Every field is independently
 * optional, because `costFromResult` is presence-guarded and a CLI shape drift drops fields silently.
 */
export function askCostLine(c: WirePhaseCost | undefined): string | null {
  if (!c) return null;
  const parts: string[] = [];
  const m = shortModel(c.model);
  if (m) parts.push(m);
  // Fresh input and cached input are shown SEPARATELY, never summed. Measured on a real ask: raw
  // `input_tokens` was 2 while the turn actually read 36k from cache — "in 2" alone reads as "this cost
  // nothing", which is the opposite of true. Summing them into one number would be the other error: it
  // would hide that almost all of it was the cheap kind. Two numbers, each what it is.
  const i = tok(c.inputTokens);
  const cached = tok(c.cacheReadTokens);
  const o = tok(c.outputTokens);
  if (i) parts.push(`in ${i}`);
  const pct = cachePct(c);
  if (cached) parts.push(`cache ${cached}${pct === null ? '' : ` (${pct}%)`}`);
  else if (pct !== null) parts.push(`cache ${pct}%`);
  if (o) parts.push(`out ${o}`);
  const turns = c.numTurns;
  if (typeof turns === 'number' && Number.isFinite(turns)) {
    parts.push(`${Math.round(turns)} turn${Math.round(turns) === 1 ? '' : 's'}`);
  }
  if (typeof c.durationMs === 'number' && Number.isFinite(c.durationMs)) parts.push(`${(c.durationMs / 1000).toFixed(1)}s`);
  if (typeof c.totalCostUsd === 'number' && Number.isFinite(c.totalCostUsd)) parts.push(`$${c.totalCostUsd.toFixed(3)}`);
  return parts.length ? parts.join(' · ') : null;
}

type Phase = 'analyze' | 'spec' | 'implement' | 'test';
const PHASE_NUM: Record<Phase, string> = { analyze: '①', spec: '②', implement: '③', test: '④' };

export type Cause = 'cold-start' | 'tool-loop' | 'generation' | 'inconclusive';

/** Classify ONE phase's cost by spec 059 S3's rule order — cold-start (cache miss) ▸ tool-loop (many
 *  internal turns: ③'s lint→fix churn / ①'s find.py probes) ▸ generation (big output) ▸ inconclusive.
 *  HEURISTIC, per-phase (the table shows this for every row). */
export function classify(c: WirePhaseCost | undefined): Cause {
  if (!c) return 'inconclusive';
  const pct = cachePct(c);
  if (pct !== null && pct < 60) return 'cold-start';
  if ((c.numTurns ?? 0) >= 8) return 'tool-loop';
  if ((c.outputTokens ?? 0) >= 6000) return 'generation';
  return 'inconclusive';
}

/** The lever to try for each cause (rendered on the priority HINT line). */
const LEVER: Record<Cause, string> = {
  'cold-start': 'stabilize the prompt prefix + keep spawns within the cache TTL',
  'tool-loop': 'fewer internal turns — better SPEC/template seed → fewer lint→fix cycles',
  generation: 'cut whole-file re-generation (edit in place)',
  inconclusive: 'compare medians of ≥3 runs',
};

function detailOf(c: WirePhaseCost, cause: Cause): string {
  switch (cause) {
    case 'cold-start': return `cache ${cachePct(c)}%`;
    case 'tool-loop': return `${c.numTurns} turns`;
    case 'generation': return `${((c.outputTokens ?? 0) / 1000).toFixed(1)}k out tok`;
    default: return 'no dominant signal';
  }
}

const ORDER: Phase[] = ['analyze', 'spec', 'implement', 'test'];

function entriesOf(cost: WireTask['cost']): Array<readonly [Phase, WirePhaseCost]> {
  return ORDER.map((k) => [k, cost?.[k]] as const).filter(
    (e): e is readonly [Phase, WirePhaseCost] => !!e[1],
  );
}

/** Each phase's share of total `durationMs`, as a whole percent — the table's `share` column. Empty
 *  when no phase recorded a duration (the share is unknowable, so the cell shows `—`). */
export function shares(cost: WireTask['cost']): Partial<Record<Phase, number>> {
  const entries = entriesOf(cost);
  const total = entries.reduce((s, [, c]) => s + (c.durationMs ?? 0), 0);
  const out: Partial<Record<Phase, number>> = {};
  if (total <= 0) return out;
  for (const [k, c] of entries) if (c.durationMs != null) out[k] = Math.round((100 * c.durationMs) / total);
  return out;
}

/** The PRIORITY diagnosis — the slowest phase + its cause + the lever, for the HINT line. `balanced`
 *  is set when NO phase clearly dominates (top share < 40% AND its lead over the 2nd phase < 8 pts):
 *  then the HINT says "balanced, no single bottleneck" instead of over-pointing at a marginal leader
 *  (spec's own "compare medians of ≥3 runs" caveat, made automatic). `allSameCause` is the shared
 *  cause when every phase classifies the same (→ "all tool-loop"), else null. */
export interface Diagnosis {
  phase: Phase; // the slowest (top) phase
  num: string; // ①..④
  sharePct: number | null; // top phase's share of total durationMs
  cause: Cause; // the top phase's cause
  detail: string; // the evidence, e.g. "20 turns" / "cache 8%"
  lever: string; // the one-line thing to try
  balanced: boolean; // no phase clearly dominates
  allSameCause: Cause | null; // non-null when every phase shares one cause
}

export function diagnose(cost: WireTask['cost']): Diagnosis | null {
  const entries = entriesOf(cost);
  if (!entries.length) return null;

  const totalMs = entries.reduce((s, [, c]) => s + (c.durationMs ?? 0), 0);
  const haveMs = entries.some(([, c]) => (c.durationMs ?? 0) > 0);
  // Slowest first — by wall-clock; fall back to biggest output when no durations were recorded.
  const sorted = [...entries].sort((a, b) =>
    haveMs
      ? (b[1].durationMs ?? 0) - (a[1].durationMs ?? 0)
      : (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0),
  );
  const [phase, c] = sorted[0];
  const sharePct =
    haveMs && totalMs > 0 && c.durationMs != null ? Math.round((100 * c.durationMs) / totalMs) : null;

  // Balanced: the top phase barely leads (needs real durations + a 2nd phase to compare).
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
