/**
 * Spec 062 S1/S1b — INTEGRATION: drive the REAL orchestrator (startTask → the analyze phase) with a
 * fake `runTurn` that streams assistant text + a tool_use/tool_result pair, then asserts the wiring
 * actually PRODUCED the on-disk capture: `.runs/<id>/transcripts/analyze.md` (prompt + output + tool
 * summary + result) and `.runs/<id>/events.jsonl` (phase_start + gate_reached). This is the true test
 * of the only risky edit (orchestrator/turn-runner) — the units are proven separately; this proves
 * they're wired. Also pins AC #6: the SSE `phase:output` broadcast still fires unchanged.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { startTask, type OrchestratorCtx } from '../server/lib/orchestrator.js';
import { acquireTurn, releaseTurn } from '../server/lib/lock.js';
import { createTask, type Task } from '../server/state/task.js';
import { PHASES } from '../server/lib/phases.js';
import type { ClaudeSession, ClaudeStreamEvent, SessionLogger } from '../server/lib/claude-session.js';
import type { TurnResult } from '../server/lib/turn-runner.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'run-capture-'));
  const skill = join(dir, '.claude', 'skills', 'dify-build');
  mkdirSync(skill, { recursive: true });
  for (const name of ['analyze', 'spec', 'implement']) {
    writeFileSync(join(skill, `${name}.md`), `# ${name}\nrequirement: {{REQUIREMENT}}\n`);
  }
  return dir;
}

function writeArtifact(task: Task, dir: string): void {
  const phase = PHASES.find((p) => p.id === task.phase)!;
  const abs = join(dir, phase.artifactRel(task));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, '{"seed": null, "summary": "ok"}');
}

describe('run capture wiring (spec 062 S1/S1b integration)', () => {
  test('a real analyze turn writes transcripts/analyze.md + events.jsonl; SSE broadcast still fires', async () => {
    const dir = fixtureDir();
    const task = await createTask(dir, { requirement: 'fetch RSS and post to Slack', confirmMode: 'each_step' });

    const phaseOutputs: string[] = [];
    const runTurn = async (
      _s: ClaudeSession,
      _p: string,
      _onSessionId?: (id: string) => void,
      opts?: { timeoutMs?: number; onText?: (t: string) => void; onEvent?: (e: ClaudeStreamEvent) => void }
    ): Promise<TurnResult> => {
      // Simulate a streaming turn: assistant text, then a tool_use + its tool_result.
      opts?.onText?.('Analyzing the requirement…');
      opts?.onEvent?.({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'u1', name: 'Read', input: { file_path: 'req.md' } }] } });
      opts?.onEvent?.({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'u1', is_error: false }] } });
      writeArtifact(task, dir);
      return {
        sessionId: 'sess-analyze',
        result: { type: 'result', is_error: false, num_turns: 3, duration_ms: 5000, usage: { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 300 } } as never,
        isError: false,
      };
    };

    const ctx: OrchestratorCtx = {
      projectsDir: dir,
      settingsPath: '',
      log,
      broadcast: (_id, event, data) => {
        if (event === 'phase:output') phaseOutputs.push((data as { text: string }).text);
      },
      runners: { runTurn },
    };

    assert.ok(acquireTurn(task.taskId));
    try {
      await startTask(task, ctx);
    } finally {
      releaseTurn(task.taskId);
    }

    const runDir = join(dir, 'apps/builder/.runs', task.taskId);

    // AC #6: the SSE relay still received the assistant fragment (byte-identical broadcast path).
    assert.deepEqual(phaseOutputs, ['Analyzing the requirement…']);

    // S1: the transcript block landed with prompt + output + tool summary + result.
    const tPath = join(runDir, 'transcripts', 'analyze.md');
    assert.ok(existsSync(tPath), 'transcripts/analyze.md was written');
    const md = readFileSync(tPath, 'utf8');
    assert.match(md, /## ① Analyze — attempt 1 · resume=no/);
    assert.match(md, /### Prompt \(sent to claude\)/);
    assert.match(md, /Analyzing the requirement…/);
    assert.match(md, /- Read {2}req\.md {2}✓/);
    assert.match(md, /turns=3/);

    // S1b: the timeline recorded the phase start and the gate it reached.
    const evPath = join(runDir, 'events.jsonl');
    assert.ok(existsSync(evPath), 'events.jsonl was written');
    const events = readFileSync(evPath, 'utf8');
    assert.match(events, /"kind":"phase_start"/);
    assert.match(events, /"kind":"gate_reached"/);
    assert.match(events, /"phase":"analyze"/);
  });
});
