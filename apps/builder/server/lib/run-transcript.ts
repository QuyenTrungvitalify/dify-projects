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
import { appendFile, mkdir } from 'node:fs/promises';
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
        if (call) call.ok = !block.is_error;
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
      this.tools.length
        ? this.tools.map((t) => `- ${t.name}  ${t.arg}  ${t.ok === undefined ? '·' : t.ok ? '✓' : '✗'}`).join('\n')
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

/** Keep at most `cap` chars from the START (the prompt's phase framing / change-request lead), marking
 *  the drop. Output uses its own tail-window marker in {@link AttemptRecorder.outputBlock}. */
function capHead(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return text.slice(0, cap) + `\n[… ${text.length - cap} chars truncated …]`;
}

function oneLine(s: string): string {
  return s.replace(/\s*\n\s*/g, ' ⏎ ').trim();
}
