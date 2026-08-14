/**
 * cost.ts — spec 059. `costFromResult` extracts the per-phase cost/metrics from a `claude` turn's
 * terminal `result` stream-json event (already captured as turn-runner's `TurnResult.result`).
 *
 * PURE + presence-guarded: every field is read through a finite-number guard, so a shape drift (a
 * renamed/absent/wrong-typed field on a future `claude` CLI) degrades to a partial `PhaseCost` — or
 * to `null` when NOTHING numeric is recognized — and NEVER throws (matching analysis.ts's leniency).
 * Returning `null` for a dead turn's `result: null` (or an unrecognizable event) is deliberate: the
 * caller then records NO cost entry rather than a zero-filled husk. Deterministic (no clock): the
 * orchestrator stamps `at` when it assigns, keeping this reader unit-testable without mocking time.
 */
import type { ClaudeStreamEvent } from './claude-session.js';
import type { PhaseCost } from '../state/task.js';

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

export function costFromResult(result: ClaudeStreamEvent | null | undefined): PhaseCost | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const usage =
    r.usage && typeof r.usage === 'object' ? (r.usage as Record<string, unknown>) : {};
  // (field, value) pairs — only the ones that read as a finite number survive into `cost`.
  const fields: Array<[keyof PhaseCost, number | undefined]> = [
    ['durationMs', num(r.duration_ms)],
    ['apiDurationMs', num(r.duration_api_ms)],
    ['numTurns', num(r.num_turns)],
    ['totalCostUsd', num(r.total_cost_usd)],
    ['inputTokens', num(usage.input_tokens)],
    ['outputTokens', num(usage.output_tokens)],
    ['cacheReadTokens', num(usage.cache_read_input_tokens)],
    ['cacheCreationTokens', num(usage.cache_creation_input_tokens)],
  ];
  const cost: PhaseCost = {};
  for (const [k, v] of fields) if (v !== undefined) (cost as Record<string, number>)[k] = v;
  // Preserve the 059 contract: nothing numeric recognized ⇒ NO entry (not a model-only husk).
  if (!Object.keys(cost).length) return null;
  // Spec 062 #1: the model that ran, for fleet correlation. Recent claude stream-json result events
  // carry `modelUsage` (a map keyed by model id); older shapes may carry a bare `model`. Presence-
  // guarded like every other field — absent ⇒ omitted, never throws.
  const model = modelFromResult(r);
  if (model) cost.model = model;
  return cost;
}

/**
 * Which model actually did the work — the one that WROTE THE MOST, not the first key of `modelUsage`.
 *
 * A turn can involve more than one model. Captured verbatim from the first turn of a new chat, with
 * `--model opus` explicitly passed:
 *
 *     claude-haiku-4-5-20251001  out 14    $0.0008   ← the CLI's own housekeeping (session title)
 *     claude-opus-5              out 494   $0.0777   ← the model that answered
 *
 * Taking `keys[0]` reported **haiku** for an answer Opus wrote. That is not a cosmetic slip: this field
 * is the audit trail a before/after campaign reads (spec 062 #1), so it could credit a model change that
 * never happened — and on the user-facing dev tip it flatly contradicted the model chip, which was right.
 *
 * Output tokens are the discriminator because they measure PRODUCTION: an auxiliary call reads a lot and
 * writes almost nothing, while the answering model is the one that wrote. Ties and missing counters fall
 * back to input tokens, then to the first key, so a shape drift degrades to the old behaviour instead of
 * to nothing.
 */
function modelFromResult(r: Record<string, unknown>): string | undefined {
  const mu = r.modelUsage;
  if (mu && typeof mu === 'object') {
    const entries = Object.entries(mu as Record<string, unknown>);
    if (entries.length === 1) return entries[0][0];
    if (entries.length > 1) {
      const weigh = (v: unknown, key: 'outputTokens' | 'inputTokens'): number => {
        const u = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
        // Accept both spellings: the CLI writes camelCase here and snake_case in the top-level `usage`.
        return num(u[key]) ?? num(u[key === 'outputTokens' ? 'output_tokens' : 'input_tokens']) ?? 0;
      };
      for (const key of ['outputTokens', 'inputTokens'] as const) {
        let best: string | undefined;
        let bestN = 0;
        for (const [id, v] of entries) {
          const n = weigh(v, key);
          if (n > bestN) { bestN = n; best = id; }
        }
        if (best) return best;
      }
      return entries[0][0]; // nothing countable — the old behaviour, rather than no answer at all
    }
  }
  return typeof r.model === 'string' ? r.model : undefined;
}
