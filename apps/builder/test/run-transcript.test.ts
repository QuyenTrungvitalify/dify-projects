/**
 * Spec 062 S1 — the per-attempt transcript recorder (lib/run-transcript.ts). Verifies the block
 * captures prompt + assistant output + tool-call summary + result; that tool calls are extracted from
 * the `tool_use`/`tool_result` stream blocks (with ok/err); that the prompt is REDACTED (a Bearer
 * token → ***, S5); that the output is TAIL-capped; and — the AC #2 core — that attempts APPEND
 * (an error→retry keeps BOTH blocks), never overwrite, with a write failure staying non-fatal.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AttemptRecorder, parseToolStats } from '../server/lib/run-transcript.js';
import type { ClaudeStreamEvent } from '../server/lib/claude-session.js';

const asstToolUse = (id: string, name: string, input: unknown): ClaudeStreamEvent =>
  ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } }) as ClaudeStreamEvent;
const userToolResult = (id: string, isError: boolean, content?: unknown): ClaudeStreamEvent =>
  ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content }] } }) as ClaudeStreamEvent;

describe('AttemptRecorder.render (spec 062 S1)', () => {
  test('block carries header + prompt + output + tools + result', () => {
    const rec = new AttemptRecorder({ phase: 'implement', attempt: 1, resume: false, prompt: 'do the thing' });
    rec.onText('working…');
    rec.onEvent(asstToolUse('t1', 'Edit', { file_path: 'projects/x/main.yml' }));
    rec.onEvent(userToolResult('t1', false));
    rec.onEvent(asstToolUse('t2', 'Bash', { command: 'validate_workflow.py main.yml' }));
    rec.onEvent(userToolResult('t2', true));
    const md = rec.render({ cost: { totalCostUsd: 0.12, numTurns: 11, durationMs: 94000, cacheReadTokens: 380, inputTokens: 620 }, nowMs: 0 });

    assert.match(md, /## ③ Implement — attempt 1 · resume=no · .* · outcome: completed/);
    assert.match(md, /### Prompt \(sent to claude\)/);
    assert.match(md, /do the thing/);
    assert.match(md, /### Assistant output/);
    assert.match(md, /working…/);
    assert.match(md, /- Edit {2}projects\/x\/main\.yml {2}✓/);
    assert.match(md, /- Bash {2}validate_workflow\.py main\.yml {2}✗/);
    assert.match(md, /cost=\$0\.12 · turns=11 · cache=38% · duration=94s/);
  });

  test('an error note flips the outcome to ERROR and shows in the result line', () => {
    const rec = new AttemptRecorder({ phase: 'implement', attempt: 2, resume: true, prompt: 'p' });
    const md = rec.render({ cost: null, note: 'phase timed out after 600s — retry or simplify', nowMs: 0 });
    assert.match(md, /attempt 2 · resume=yes .* outcome: ERROR/);
    assert.match(md, /phase timed out after 600s/);
  });

  test('the prompt is redacted (a Bearer token never lands in the transcript)', () => {
    const rec = new AttemptRecorder({ phase: 'spec', attempt: 1, resume: false, prompt: 'use Authorization: Bearer sk-abc12345 please' });
    const md = rec.render({ cost: null, nowMs: 0 });
    assert.ok(!md.includes('sk-abc12345'), 'raw token must not appear');
    assert.match(md, /Bearer \*\*\*/);
  });

  // ─── spec 091 S1 — a ✗ carries its reason on an indented ↳ continuation line ───
  test('an is_error tool_result with STRING content renders a ↳ reason line under the ✗', () => {
    const rec = new AttemptRecorder({ phase: 'analyze', attempt: 1, resume: false, prompt: 'p' });
    rec.onEvent(asstToolUse('t1', 'Bash', { command: '.venv/bin/python tools/dify_base/find.py --name kw' }));
    rec.onEvent(userToolResult('t1', true, 'command contains a shell metacharacter (chaining/redirect…)\nsecond line dropped'));
    const md = rec.render({ cost: null, nowMs: 0 });
    // the call line itself is UNCHANGED (F8: external parsers anchor on the trailing ✗)
    assert.match(md, /- Bash {2}\.venv\/bin\/python tools\/dify_base\/find\.py --name kw {2}✗\n {4}↳ command contains a shell metacharacter/);
    assert.ok(!md.includes('second line dropped'), 'only the first line of the reason is kept');
  });

  test('an is_error tool_result with ARRAY content ({type:text,text}) renders the ↳ reason too', () => {
    const rec = new AttemptRecorder({ phase: 'analyze', attempt: 1, resume: false, prompt: 'p' });
    rec.onEvent(asstToolUse('t1', 'Read', { file_path: 'apps/builder/.env' }));
    rec.onEvent(userToolResult('t1', true, [{ type: 'text', text: 'forbidden: read of a sensitive file (apps/builder/.env)' }]));
    const md = rec.render({ cost: null, nowMs: 0 });
    assert.match(md, / {4}↳ forbidden: read of a sensitive file/);
  });

  test('the ↳ reason is REDACTED and capped at 160 chars', () => {
    const rec = new AttemptRecorder({ phase: 'analyze', attempt: 1, resume: false, prompt: 'p' });
    rec.onEvent(asstToolUse('t1', 'Bash', { command: 'x' }));
    rec.onEvent(userToolResult('t1', true, 'denied: Authorization: Bearer sk-abc12345 ' + 'y'.repeat(300)));
    const md = rec.render({ cost: null, nowMs: 0 });
    assert.ok(!md.includes('sk-abc12345'), 'token redacted in the reason line');
    const reason = md.split('\n').find((l) => l.trimStart().startsWith('↳'))!;
    assert.ok(reason.trim().length <= 4 + 160 + 1, 'reason capped (↳ + 160 chars + ellipsis)');
    assert.match(reason, /…$/);
  });

  test('a SUCCESS tool_result never gets a ↳ line; an is_error with no content stays bare', () => {
    const rec = new AttemptRecorder({ phase: 'analyze', attempt: 1, resume: false, prompt: 'p' });
    rec.onEvent(asstToolUse('t1', 'Bash', { command: 'ls' }));
    rec.onEvent(userToolResult('t1', false, 'file listing…'));
    rec.onEvent(asstToolUse('t2', 'Bash', { command: 'ls nope' }));
    rec.onEvent(userToolResult('t2', true)); // no content on the wire
    const md = rec.render({ cost: null, nowMs: 0 });
    assert.ok(!md.includes('↳'), 'no reason line without an error reason');
    assert.match(md, /- Bash {2}ls nope {2}✗\n/);
  });

  test('assistant output is TAIL-capped (the end, where failures show, survives)', () => {
    const rec = new AttemptRecorder({ phase: 'implement', attempt: 1, resume: false, prompt: 'p' });
    rec.onText('HEAD_MARKER' + 'x'.repeat(200_000) + 'TAIL_MARKER');
    const md = rec.render({ cost: null, nowMs: 0 });
    assert.match(md, /chars truncated/);
    assert.ok(md.includes('TAIL_MARKER'), 'the tail is kept');
    assert.ok(!md.includes('HEAD_MARKER'), 'the head is dropped');
  });
});

describe('AttemptRecorder.flush (spec 062 S1 / AC #2)', () => {
  test('two attempts APPEND to the same phase file (error→retry keeps both blocks)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tr-'));
    try {
      const a1 = new AttemptRecorder({ phase: 'implement', attempt: 1, resume: false, prompt: 'first try' });
      a1.onText('attempt one output');
      await a1.flush(dir, { cost: null, note: 'lint gate failed', nowMs: 0 });

      const a2 = new AttemptRecorder({ phase: 'implement', attempt: 1, resume: true, prompt: 'fix it' });
      a2.onText('attempt two output');
      await a2.flush(dir, { cost: { numTurns: 5 }, nowMs: 0 });

      const file = join(dir, 'transcripts', 'implement.md');
      assert.ok(existsSync(file));
      const md = readFileSync(file, 'utf8');
      assert.match(md, /outcome: ERROR/); // the first (failed) attempt survived
      assert.match(md, /outcome: completed/); // the retry appended after it
      assert.ok(md.indexOf('attempt one output') < md.indexOf('attempt two output'), 'chronological order');
      assert.equal((md.match(/## ③ Implement/g) ?? []).length, 2, 'both blocks present');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('parseToolStats round-trips the rendered tool section (total, fails, per-tool) across attempts', () => {
    // Two attempts appended to one phase file — stats aggregate across both.
    const a1 = new AttemptRecorder({ phase: 'implement', attempt: 1, resume: false, prompt: 'p' });
    a1.onEvent(asstToolUse('t1', 'Bash', { command: 'ls -la /nope' }));
    a1.onEvent(userToolResult('t1', true)); // ✗
    a1.onEvent(asstToolUse('t2', 'Bash', { command: 'find . -name x' }));
    a1.onEvent(userToolResult('t2', true)); // ✗
    a1.onEvent(asstToolUse('t3', 'Read', { file_path: 'a.md' }));
    a1.onEvent(userToolResult('t3', false)); // ✓
    const a2 = new AttemptRecorder({ phase: 'implement', attempt: 2, resume: true, prompt: 'p' });
    a2.onEvent(asstToolUse('t4', 'Write', { file_path: 'main.yml' }));
    a2.onEvent(userToolResult('t4', false)); // ✓

    const md = a1.render({ cost: null, nowMs: 0 }) + a2.render({ cost: null, nowMs: 0 });
    const stats = parseToolStats(md);
    assert.equal(stats.total, 4);
    assert.equal(stats.fails, 2);
    assert.deepEqual(stats.byTool, [
      { name: 'Bash', count: 2 },
      { name: 'Read', count: 1 },
      { name: 'Write', count: 1 },
    ]);
  });

  test('parseToolStats ignores `- ` lines OUTSIDE the tool section (prompt/output fences)', () => {
    const md = [
      '## ③ Implement — attempt 1',
      '### Prompt (sent to claude)',
      '```',
      '- this is a bullet in the prompt ✓', // must NOT be counted
      '```',
      '### Tool calls',
      '- Bash  ls  ✓',
      '### Result',
      'cost=$0',
    ].join('\n');
    const stats = parseToolStats(md);
    assert.equal(stats.total, 1);
    assert.deepEqual(stats.byTool, [{ name: 'Bash', count: 1 }]);
  });

  test('parseToolStats ignores ↳ reason lines — counts match the pre-091 format (parser-compat, F8)', () => {
    const rec = new AttemptRecorder({ phase: 'implement', attempt: 1, resume: false, prompt: 'p' });
    rec.onEvent(asstToolUse('t1', 'Bash', { command: 'grep -rn x' }));
    rec.onEvent(userToolResult('t1', true, 'grep is not available to a Builder turn — use the Read tool instead'));
    rec.onEvent(asstToolUse('t2', 'Read', { file_path: 'a.md' }));
    rec.onEvent(userToolResult('t2', false));
    const stats = parseToolStats(rec.render({ cost: null, nowMs: 0 }));
    assert.equal(stats.total, 2, 'the ↳ line is not double-counted');
    assert.equal(stats.fails, 1);
  });

  test('parseToolStats on a (none) section → zero', () => {
    const md = '### Tool calls\n- (none)\n### Result\n';
    assert.deepEqual(parseToolStats(md), { total: 0, fails: 0, byTool: [] });
  });

  test('non-fatal: flush to an unwritable path does NOT throw', async () => {
    const rec = new AttemptRecorder({ phase: 'spec', attempt: 1, resume: false, prompt: 'p' });
    // mkdir will fail because a FILE sits where the dir should be — flush must swallow it.
    const dir = mkdtempSync(join(tmpdir(), 'tr-'));
    try {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(join(dir, 'transcripts'), 'i am a file, not a dir');
      await assert.doesNotReject(() => rec.flush(dir, { cost: null }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
