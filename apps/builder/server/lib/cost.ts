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
  return Object.keys(cost).length ? cost : null;
}
