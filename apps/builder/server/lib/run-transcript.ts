/**
 * run-transcript.ts — spec 062 S1. Records ONE phase attempt (prompt + assistant output + a tool-call
 * summary + the result) and APPENDS it as a markdown block to `.runs/<taskId>/transcripts/<phase>.md`.
 *
 * Append, never overwrite (supersedes the r2 "last-run-wins" call): an error→retry keeps BOTH blocks,
 * so the messy middle survives (G3). Everything the recorder consumes already flows through the turn —
 * the prompt string, the `onText` fragments, and the `tool_use`/`tool_result` blocks on the event
 * stream — so wiring it costs no new subprocess. NON-FATAL by contract: a write failure never fails a
 * turn (AC #2); the recorder catches its own IO. Redacts the prompt + tool args (they carry
 * {{KNOWLEDGE}} / pasted tokens, S5). Caps the assistant output (tail) + prompt (head) so a runaway ③
 * can't bloat the run dir.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { redactSecrets } from './dify-io.js';
import { cachePct, PHASE_NUM } from './cost-cause.js';
import type { PhaseCost } from '../state/task.js';
import type { ClaudeStreamEvent } from './claude-session.js';

const OUTPUT_CAP = 64_000; // chars — keep the TAIL (failures show at the end)
const PROMPT_CAP = 48_000; // chars — keep the HEAD (the phase framing / change-request lead)

type Phase = 'analyze' | 'spec' | 'implement' | 'test';
const PHASE_LABEL: Record<Phase, string> = {
  analyze: 'Analyze',
  spec: 'Spec',
  implement: 'Implement',
  test: 'Test',
};

interface ToolCall {
  name: string;
  arg: string;
  ok?: boolean; // resolved from the matching tool_result.is_error; undefined = no result seen
  err?: string; // first line of the tool_result error content (redacted, capped) — spec 091 S1
}

/**
 * Accumulates one attempt's output + tool calls as the turn streams, then {@link flush}es a block.
 * One recorder per `spawnOnce`. `onText`/`onEvent` are hot-path callbacks — they only push to memory
 * (cheap) and are individually try-wrapped by the caller's guard, so they can never break the turn.
 */
export class AttemptRecorder {
  private readonly phase: Phase;
  private readonly attempt: number;
  private readonly resume: boolean;
  private readonly prompt: string;
  private out = ''; // a bounded TAIL window of the assistant stream (≤ OUTPUT_CAP chars)
  private receivedLen = 0; // total chars streamed (so the truncation marker reports the TRUE count)
  private readonly tools: ToolCall[] = [];
  private readonly byId = new Map<string, ToolCall>();

  constructor(args: { phase: Phase; attempt: number; resume: boolean; prompt: string }) {
    this.phase = args.phase;
    this.attempt = args.attempt;
    this.resume = args.resume;
    this.prompt = args.prompt;
  }

  /** Accumulate an assistant text fragment (the same fragments the SSE relay gets). */
  onText(text: string): void {
    this.receivedLen += text.length;
    this.out += text;
    // Bound memory: keep only the trailing OUTPUT_CAP window (failures show at the end). `receivedLen`
    // preserves the true total so render's truncation marker reports the real dropped count.
    if (this.out.length > OUTPUT_CAP) this.out = this.out.slice(-OUTPUT_CAP);
  }

  /** Extract tool calls from a stream event: `tool_use` (assistant) → a row; `tool_result` (user) → ok/err. */
  onEvent(event: ClaudeStreamEvent): void {
    const msg = event.message as { content?: Array<Record<string, unknown>> } | undefined;
    for (const block of msg?.content ?? []) {
      const type = block?.type;
      if (type === 'tool_use') {
        const call: ToolCall = {
          name: String(block.name ?? 'tool'),
          arg: argDigest(block.input),
        };
        this.tools.push(call);
        const id = block.id;
        if (typeof id === 'string') this.byId.set(id, call);
      } else if (type === 'tool_result') {
        const id = block.tool_use_id;
        const call = typeof id === 'string' ? this.byId.get(id) : undefined;
        if (call) {
          call.ok = !block.is_error;
          // Spec 091 S1 — keep the WHY, not just the ✗. Every diagnosis before this had to guess the
          // gate's decision back from a ~80-char command digest; the real reason was in `content` all
          // along and was dropped here.
          if (block.is_error) call.err = errDigest(block.content);
        }
      }
    }
  }

  /**
   * Append this attempt's block to `<runDir>/transcripts/<phase>.md`. `cost` is the parsed
   * `costFromResult(turn.result)` (spec 059) or null; `note` is the turn's error/triage note (if any).
   * Never throws.
   */
  async flush(runDir: string, r: { cost: PhaseCost | null; note?: string; nowMs?: number }): Promise<void> {
    try {
      const dir = join(runDir, 'transcripts');
      await mkdir(dir, { recursive: true });
      const block = this.render(r);
      await appendFile(join(dir, `${this.phase}.md`), block);
    } catch {
      // non-fatal: a transcript write must never fail the turn (AC #2).
    }
    // …and the same attempt in a form a machine can read back.
    //
    // The markdown above is for a person: prompt framing, a tool table, a result line. Parsing it back
    // to rebuild the UI would mean writing a parser against a layout that exists to be readable, which
    // breaks the first time the layout improves. This file is the other half — one JSON line per
    // attempt, holding exactly what the browser streamed.
    //
    // WHY IT EXISTS AT ALL: a phase's output has only ever lived in the client. Watch a build, clear the
    // cache (or open it on another machine), and every phase's reasoning was gone — the thread rebuilt
    // to "requirement + current gate" and the work in between simply had never been recorded anywhere
    // the browser could reach. An ask got its transcript for the same reason; this is the build's.
    try {
      const line: RunAttempt = {
        ts: r.nowMs ?? Date.now(),
        phase: this.phase,
        output: this.outputBlock(),
        ...(r.cost ? { cost: r.cost } : {}),
        ...(r.note ? { note: oneLine(r.note).slice(0, 500) } : {}),
      };
      await appendFile(join(runDir, RUNS_FILE), JSON.stringify(line) + '\n');
    } catch {
      // same contract as the markdown: best-effort, never fails a turn.
    }
  }

  /** The assistant-output section: the redacted tail window, prefixed with a truthful truncation marker
   *  (the dropped count comes from `receivedLen`, not the already-trimmed window). */
  private outputBlock(): string {
    const body = redactSecrets(this.out).trim() || '(no assistant text)';
    return this.receivedLen > OUTPUT_CAP
      ? `[… ${this.receivedLen - OUTPUT_CAP} chars truncated …]\n` + body
      : body;
  }

  /** Render the markdown block (pure — exposed for the unit test). */
  render(r: { cost: PhaseCost | null; note?: string; nowMs?: number }): string {
    const num = PHASE_NUM[this.phase];
    const outcome = r.note ? 'ERROR' : 'completed';
    const ts = new Date(r.nowMs ?? Date.now()).toISOString();
    const lines: string[] = [
      `## ${num} ${PHASE_LABEL[this.phase]} — attempt ${this.attempt} · resume=${this.resume ? 'yes' : 'no'} · ${ts} · outcome: ${outcome}`,
      '',
      '### Prompt (sent to claude)',
      '```',
      capHead(redactSecrets(this.prompt), PROMPT_CAP),
      '```',
      '',
      '### Assistant output',
      '```',
      this.outputBlock(),
      '```',
      '',
      '### Tool calls',
      // The call line's format is LOAD-BEARING: two external parsers anchor on the trailing ✓/✗
      // (e2e_check._denied_calls endswith("✗"), campaign._CALL_LINE `[✓✗]\s*$`), so the error reason
      // goes on a CONTINUATION line — indented, so `startswith("- ")` in both skips it (spec 091 F8).
      this.tools.length
        ? this.tools
            .map((t) => {
              const line = `- ${t.name}  ${t.arg}  ${t.ok === undefined ? '·' : t.ok ? '✓' : '✗'}`;
              return t.err ? `${line}\n    ↳ ${t.err}` : line;
            })
            .join('\n')
        : '- (none)',
      '',
      '### Result',
      resultLine(r.cost, r.note),
      '',
      '',
    ];
    return lines.join('\n');
  }
}

/** Per-phase tool-activity tally (spec 062 follow-up) — parsed BACK from a phase transcript's rendered
 *  `### Tool calls` sections so the dossier can surface "how much groping" at a glance (the manual
 *  count a ③-cost analysis otherwise does by hand). Co-located with the renderer so the format + parser
 *  can't drift. */
export interface ToolStats {
  total: number;
  fails: number;
  byTool: Array<{ name: string; count: number }>; // desc by count
}

/**
 * Count tool calls across ALL attempts in a phase transcript. Scans only within `### Tool calls`
 * sections (so a `- ` line inside the prompt/output code fences never miscounts), reading the tool
 * name (first token) + the trailing ✓/✗/· mark this file's own {@link AttemptRecorder.render} emits.
 */
export function parseToolStats(md: string): ToolStats {
  const byTool = new Map<string, number>();
  let total = 0;
  let fails = 0;
  let inSection = false;
  for (const line of md.split('\n')) {
    if (line.startsWith('### Tool calls')) {
      inSection = true;
      continue;
    }
    if (line.startsWith('### ')) {
      inSection = false;
      continue;
    }
    if (!inSection || !line.startsWith('- ') || line.startsWith('- (none)')) continue;
    const m = line.match(/^- (\S+)\s{2,}.*([✓✗·])\s*$/);
    if (!m) continue;
    total++;
    if (m[2] === '✗') fails++;
    byTool.set(m[1], (byTool.get(m[1]) ?? 0) + 1);
  }
  return {
    total,
    fails,
    byTool: [...byTool.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}

/** A one-line, redacted digest of a tool_use `input` (the file, command, query — whatever is salient). */
function argDigest(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  const pick =
    o.file_path ?? o.path ?? o.command ?? o.pattern ?? o.query ?? o.url ?? o.description ?? o.prompt;
  let s = typeof pick === 'string' ? pick : JSON.stringify(o);
  s = redactSecrets(s).replace(/\s+/g, ' ').trim();
  return s.length > 80 ? s.slice(0, 80) + '…' : s;
}

/** First non-empty line of a tool_result error `content` — the stream carries it as a plain string OR
 *  as `[{type:'text',text}]` blocks; handle both. Redacted (the reason can quote a sensitive path or a
 *  pasted token) and capped, so a runaway stack trace can't bloat the transcript. */
const ERR_CAP = 160; // chars
function errDigest(content: unknown): string {
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    for (const part of content) {
      const t = (part as Record<string, unknown> | null)?.text;
      if (typeof t === 'string' && t.trim()) {
        text = t;
        break;
      }
    }
  }
  const line = (redactSecrets(text).split('\n').find((l) => l.trim()) ?? '').trim();
  return line.length > ERR_CAP ? line.slice(0, ERR_CAP) + '…' : line;
}

function resultLine(cost: PhaseCost | null, note?: string): string {
  const parts: string[] = [];
  if (cost?.totalCostUsd != null) parts.push(`cost=$${cost.totalCostUsd.toFixed(2)}`);
  if (cost?.numTurns != null) parts.push(`turns=${cost.numTurns}`);
  const pct = cachePct(cost ?? undefined);
  if (pct != null) parts.push(`cache=${pct}%`);
  if (cost?.durationMs != null) parts.push(`duration=${Math.round(cost.durationMs / 1000)}s`);
  if (note) parts.push(oneLine(note));
  return parts.length ? parts.join(' · ') : '(no result — the turn died before a terminal event)';
}

/** One attempt, as the browser saw it: the streamed assistant text plus what the turn cost. */
export interface RunAttempt {
  ts: number;
  phase: string;
  output: string;
  cost?: PhaseCost;
  note?: string;
}

export const RUNS_FILE = 'runs.jsonl';

/**
 * Read the per-attempt records back, newest LAST.
 *
 * Bounded on purpose: this feeds `GET /api/tasks/:id`, which the client re-fetches on every reconnect,
 * and a long build's output would otherwise ride the wire again and again. Keeps the most recent
 * attempts within a total budget and says how many it dropped, rather than silently returning a
 * conversation with a hole in the middle.
 */
export async function readRunAttempts(
  runDir: string,
  opts?: { maxTotalChars?: number; maxPerAttempt?: number }
): Promise<{ runs: RunAttempt[]; dropped: number }> {
  const maxTotal = opts?.maxTotalChars ?? 48_000;
  const maxEach = opts?.maxPerAttempt ?? 6_000;
  let raw: string;
  try {
    raw = await readFile(join(runDir, RUNS_FILE), 'utf8');
  } catch {
    return { runs: [], dropped: 0 };
  }
  const all: RunAttempt[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      all.push(JSON.parse(line) as RunAttempt);
    } catch {
      /* a torn last line (a crash mid-append) is skipped, exactly as the event log does */
    }
  }
  const kept: RunAttempt[] = [];
  let used = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    const a = all[i];
    const out = a.output.length > maxEach ? `[… ${a.output.length - maxEach} chars truncated …]\n${a.output.slice(-maxEach)}` : a.output;
    if (used + out.length > maxTotal && kept.length) break;
    kept.unshift({ ...a, output: out });
    used += out.length;
  }
  return { runs: kept, dropped: all.length - kept.length };
}

/** Keep at most `cap` chars from the START (the prompt's phase framing / change-request lead), marking
 *  the drop. Output uses its own tail-window marker in {@link AttemptRecorder.outputBlock}. */
function capHead(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return text.slice(0, cap) + `\n[… ${text.length - cap} chars truncated …]`;
}

function oneLine(s: string): string {
  return s.replace(/\s*\n\s*/g, ' ⏎ ').trim();
}
