/**
 * ask-ledger.ts — one table that answers "is the ask optimisation still working?"
 *
 * WHY THIS EXISTS. Spec 098 cut the seed a question carries from ~143 KB to ~5 KB, and the evidence for
 * that was a one-off measurement on one machine. An optimisation that is only ever measured once is a
 * claim, not a property: the seed can grow back one `add(...)` at a time, a future artifact can re-inline
 * itself, and nobody notices until a quota does. The size fence in the test suite catches that for a
 * FIXTURE; this catches it for REAL USE, on someone else's builds, months later.
 *
 * WHAT IT READS. Only the persisted transcript (`chat.jsonl`) — no new measurement and no new plumbing:
 * every answer already records the prompt it was sent and what the turn cost. This renders those rows.
 *
 * WHY PROMPT BYTES LEAD. Cost is the number people look at, but it is the wrong headline: it moves with
 * the question, the model, the cache state and the price list. Prompt size is the thing 098 actually
 * changed, it is under this code's control, and it is comparable across machines and months. Cost is
 * shown beside it as the consequence.
 *
 * PURE + defensive: takes parsed lines, returns markdown (or `null` when there is nothing to say), and
 * every field is optional — a transcript written before any of this existed renders as a short note
 * rather than a table of dashes.
 */
import type { ConsultChatLine } from './ask.js';

/** The size fence spec 098 left behind (16 KB), restated here so the ledger can say pass/fail per row. */
export const SEED_FENCE_BYTES = 16 * 1024;

const kb = (n: number): string => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
const tok = (n: number | undefined): string =>
  typeof n === 'number' && Number.isFinite(n) ? (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n))) : '—';
const usd = (n: number | undefined): string =>
  typeof n === 'number' && Number.isFinite(n) ? `$${n.toFixed(3)}` : '—';
const secs = (ms: number | undefined): string =>
  typeof ms === 'number' && Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : '—';
const shortModel = (id: string | undefined): string =>
  id ? id.replace(/^([a-z0-9-]+\.)+/, '').replace(/^claude-/, '').replace(/-\d{8}$/, '') : '—';

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** One question and the answer it produced, paired the way `recordAsk` writes them. */
function exchanges(lines: ConsultChatLine[]): Array<{ q: string; a: ConsultChatLine }> {
  const out: Array<{ q: string; a: ConsultChatLine }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].role !== 'assistant') continue;
    let q = '';
    for (let j = i - 1; j >= 0; j--) {
      if (lines[j].role === 'user') { q = lines[j].text; break; }
    }
    out.push({ q, a: lines[i] });
  }
  return out;
}

/**
 * Render the ledger. `null` when the transcript holds no answers at all — an empty table would imply
 * "asked nothing and it was free", which is a different statement from "nothing recorded".
 */
export function buildAskLedger(lines: ConsultChatLine[]): string | null {
  const rows = exchanges(lines);
  if (!rows.length) return null;

  const measured = rows.filter((r) => typeof r.a.promptBytes === 'number');
  const priced = rows.map((r) => r.a.cost?.totalCostUsd).filter((n): n is number => typeof n === 'number');

  const head = [
    `# Ask ledger — ${rows.length} question${rows.length === 1 ? '' : 's'}`,
    '',
    // No spec number in the RENDERED text: this file is read by a user, months later, possibly on
    // another machine — and specs here are deleted once shipped, so a citation would point at nothing.
    // The fact stands on its own; provenance belongs in the source comment above.
    'Every question re-sends the build context, so its SIZE is what to watch. It used to be the whole',
    `artifact (~143 KB per question); it is now a map of it, and ${kb(SEED_FENCE_BYTES)} is the line a`,
    'regression test holds a fixture under.',
    '',
    '**Read the `artifacts` column, not `prompt`.** The prompt also carries your own requirement, which',
    'is the subject of the question and travels whole however long it is — a 11 KB requirement is not a',
    'regression. `artifacts` is the part this app decides: the workflow map, the spec outline, the report.',
    '',
    '| # | prompt sent | artifacts | model | in | cache read | cache write | out | turns | time | cost | question |',
    '|--:|--:|--:|---|--:|--:|--:|--:|--:|--:|--:|---|',
  ];

  const body = rows.map((r, i) => {
    const c = r.a.cost;
    const pb = r.a.promptBytes;
    const cb = r.a.contextBytes;
    const size = typeof pb === 'number' ? kb(pb) : '—';
    const ctx = typeof cb === 'number' ? `${kb(cb)}${cb > SEED_FENCE_BYTES ? ' ⚠' : ''}` : '—';
    // ↺ marks a question that started a fresh session. It belongs on the row because the row AFTER it is
    // where the saving shows up, and the two are otherwise impossible to connect.
    const mark = r.a.sessionReset ? ' ↺' : '';
    const q = r.q.replace(/\s+/g, ' ').trim();
    return `| ${i + 1}${mark} | ${size} | ${ctx} | ${shortModel(c?.model)} | ${tok(c?.inputTokens)} | ${tok(c?.cacheReadTokens)} | `
      + `${tok(c?.cacheCreationTokens)} | ${tok(c?.outputTokens)} | ${tok(c?.numTurns)} | ${secs(c?.durationMs)} | `
      + `${usd(c?.totalCostUsd)} | ${q.length > 60 ? `${q.slice(0, 60)}…` : q || '—'} |`;
  });

  const withCtx = rows.filter((r) => typeof r.a.contextBytes === 'number');
  const verdict: string[] = ['', '## Reading this'];
  if (withCtx.length) {
    const sizes = withCtx.map((r) => r.a.contextBytes!);
    const over = sizes.filter((b) => b > SEED_FENCE_BYTES).length;
    verdict.push(
      '',
      `**Artifact context** (the part this app controls) — median ${kb(median(sizes))}, largest `
        + `${kb(Math.max(...sizes))}, ${withCtx.length - over} of ${withCtx.length} within the `
        + `${kb(SEED_FENCE_BYTES)} fence`
        + `${over ? ` · **${over} over it** ⚠ — that is the regression this ledger exists to catch` : ' ✅'}.`,
    );
    if (measured.length) {
      const p = measured.map((r) => r.a.promptBytes!);
      verdict.push('', `Whole prompts ran ${kb(Math.min(...p))}–${kb(Math.max(...p))}; the difference is `
        + 'your requirement and the question itself, neither of which this app may shorten.');
    }
  } else if (measured.length) {
    verdict.push(
      '',
      `**Prompt size** — median ${kb(median(measured.map((r) => r.a.promptBytes!)))}. No artifact-context `
        + 'breakdown on these rows (a gate ask or a chat assembles context differently), so there is no '
        + 'pass/fail to give — the fence applies to the terminal ask only.',
    );
  } else {
    verdict.push('', '_No prompt sizes recorded — this transcript predates the ledger._');
  }
  if (priced.length) {
    const total = priced.reduce((a, b) => a + b, 0);
    verdict.push(
      '',
      `**Cost** — median ${usd(median(priced.map((n) => n * 1000)) / 1000)} per question, ${usd(total)} for all ${priced.length}.`,
    );
    if (priced.length >= 3) {
      // The failure mode 098 was about is a curve that CLIMBS: each turn re-sending more than the last.
      // Comparing the first third with the last third is crude, but it is the shape that matters, and a
      // crude signal stated as crude beats a precise one nobody can check.
      const cut = Math.max(1, Math.floor(priced.length / 3));
      const first = priced.slice(0, cut).reduce((a, b) => a + b, 0) / cut;
      const last = priced.slice(-cut).reduce((a, b) => a + b, 0) / cut;
      const pct = first > 0 ? Math.round((100 * (last - first)) / first) : 0;
      verdict.push(
        '',
        `**Trend** — first ${cut} averaged ${usd(first)}, last ${cut} ${usd(last)} (${pct >= 0 ? '+' : ''}${pct}%). `
          + (pct > 50
            ? 'A climbing curve is the failure this ledger exists to catch — worth a look.'
            : 'Flat or falling is what a working optimisation looks like here.'),
      );
    }
  }

  // Where the money actually went. A real QA run showed a one-line question costing $8.86 with 883.7k
  // tokens WRITTEN to cache — a few-KB prompt cannot produce that. It is the session HISTORY being
  // re-cached after its cache expired, and no amount of seed-shrinking touches it. Saying "the seed is
  // fine ✅" next to that number, and nothing else, would be technically true and practically useless.
  const resets = rows.filter((r) => r.a.sessionReset).length;
  if (resets) {
    verdict.push(
      '',
      `**Session resets** — ${resets} question${resets === 1 ? '' : 's'} (marked ↺) started a fresh `
        + 'session because the previous one had grown past its token budget. That is the lever working: '
        + 'compare the cost of a ↺ row with the one before it.',
    );
  }

  const writes = rows
    .map((r) => r.a.cost?.cacheCreationTokens)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  const worst = writes.length ? Math.max(...writes) : 0;
  if (worst >= 200_000) {
    verdict.push(
      '',
      `**Where the money went** — one turn wrote **${tok(worst)}** tokens INTO the cache. A prompt of a `
        + 'few KB cannot produce that: it is the session history being re-cached after the cache expired, '
        + 'which is what a long-lived ask session costs on its first question of the day. Shrinking the '
        + 'seed does not touch this — resetting the ask session is the lever, and this ledger is the '
        + 'evidence that it is worth pulling.',
    );
  }

  return [...head, ...body, ...verdict, ''].join('\n');
}
