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
    'Every question re-sends the build context, so its SIZE is the thing to watch: spec 098 cut it from',
    `~143 KB to ~5 KB, and the suite fences a fixture at ${kb(SEED_FENCE_BYTES)}. These are real asks.`,
    '',
    '| # | prompt sent | model | in | cache read | cache write | out | turns | time | cost | question |',
    '|--:|--:|---|--:|--:|--:|--:|--:|--:|--:|---|',
  ];

  const body = rows.map((r, i) => {
    const c = r.a.cost;
    const pb = r.a.promptBytes;
    const size = typeof pb === 'number' ? `${kb(pb)}${pb > SEED_FENCE_BYTES ? ' ⚠' : ''}` : '—';
    const q = r.q.replace(/\s+/g, ' ').trim();
    return `| ${i + 1} | ${size} | ${shortModel(c?.model)} | ${tok(c?.inputTokens)} | ${tok(c?.cacheReadTokens)} | `
      + `${tok(c?.cacheCreationTokens)} | ${tok(c?.outputTokens)} | ${tok(c?.numTurns)} | ${secs(c?.durationMs)} | `
      + `${usd(c?.totalCostUsd)} | ${q.length > 60 ? `${q.slice(0, 60)}…` : q || '—'} |`;
  });

  const verdict: string[] = ['', '## Reading this'];
  if (measured.length) {
    const sizes = measured.map((r) => r.a.promptBytes!);
    const over = sizes.filter((b) => b > SEED_FENCE_BYTES).length;
    verdict.push(
      '',
      `**Prompt size** — median ${kb(median(sizes))}, largest ${kb(Math.max(...sizes))}, `
        + `${measured.length - over} of ${measured.length} within the ${kb(SEED_FENCE_BYTES)} fence`
        + `${over ? ` · **${over} over it** ⚠ — that is the regression this ledger exists to catch` : ' ✅'}.`,
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
            ? 'A climbing curve is exactly the failure spec 098 fixed — worth a look.'
            : 'Flat or falling is what a working optimisation looks like here.'),
      );
    }
  }

  return [...head, ...body, ...verdict, ''].join('\n');
}
