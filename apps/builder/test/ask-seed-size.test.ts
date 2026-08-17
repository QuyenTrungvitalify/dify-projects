/**
 * Spec 098 — the terminal ask's seed must stay small, and the workflow map must never be a half-truth.
 *
 * WHAT WENT WRONG: `gatherTerminalSeed` inlined `main.yml` whole on EVERY question. Measured on the
 * user's own sessions: 124–141KB per ask, 46 asks in one session, 89% of the bytes identical to the
 * previous one — answering cost 3.4× what building the workflows cost (60.5M vs 18.0M input-equivalent
 * tokens). The map of that same 52-node file is 3.5KB.
 *
 * The size fence below is the part that matters long-term: without it, the next `add(...)` line put back
 * into the seed goes unnoticed until someone runs out of quota.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { askTestWithin } from '../server/lib/ask.js';
import { buildWorkflowIndex } from '../server/lib/workflow-index.js';
import { createTask, saveTask, type Task } from '../server/state/task.js';
import type { ClaudeSession } from '../server/lib/claude-session.js';
import type { TurnResult } from '../server/lib/turn-runner.js';
import type { OrchestratorCtx } from '../server/lib/orchestrator-shared.js';

const log = { info() {}, warn() {}, error() {}, debug() {} } as unknown as OrchestratorCtx['log'];

/** A workflow shaped like the real thing: `nodes:`/`edges:` at the SAME indent as their key, node type
 *  and title nested under `data:`, plus the two shapes that broke the scanner during development —
 *  a comment between items, and `type:` keys at other depths. */
function workflowYaml(n: number): string {
  const nodes = Array.from({ length: n }, (_, i) => [
    `    - id: '${1000 + i}'`,
    '      data:',
    `        type: ${i === 0 ? 'trigger-webhook' : 'code'}`,
    `        title: node ${i}`,
    '        body:',
    '        - name: room_id',
    '          type: string', // a `type:` that must NOT be mistaken for the node's
    ...(i === 3 ? ['    # a comment between items — this used to end the scan early'] : []),
  ].join('\n'));
  const edges = Array.from({ length: n - 1 }, (_, i) => [
    '    - data:',
    '        sourceType: code',
    `      source: '${1000 + i}'`,
    `      target: '${1001 + i}'`,
    '      type: custom', // an edge-level `type:` at the item level
  ].join('\n'));
  return ['app:', '  name: big', 'workflow:', '  graph:', '    nodes:', ...nodes, '    edges:', ...edges].join('\n');
}

async function seededTask(dir: string, opts: { yaml: string; spec: string; requirement?: string }): Promise<Task> {
  const task = await createTask(dir, { requirement: opts.requirement ?? 'r', confirmMode: 'auto' });
  task.phase = 'test';
  task.status = 'done';
  task.project = '_drafts';
  task.workflowSlug = 'big';
  await saveTask(dir, task);
  await mkdir(join(dir, 'projects/_drafts/big/workflows'), { recursive: true });
  await writeFile(join(dir, 'projects/_drafts/big/SPEC.md'), opts.spec);
  await writeFile(join(dir, 'projects/_drafts/big/workflows/main.yml'), opts.yaml);
  await mkdir(join(dir, `apps/builder/.runs/${task.taskId}`), { recursive: true });
  return task;
}

async function promptFor(dir: string, task: Task, question = 'which node posts to Chatwork?'): Promise<string> {
  let prompt = '';
  const runTurn = async (
    _s: ClaudeSession, p: string, onSid?: (id: string) => void, o?: { onText?: (t: string) => void }
  ): Promise<TurnResult> => {
    prompt = p;
    onSid?.('sid-1');
    o?.onText?.('ok');
    return { sessionId: 'sid-1', result: { type: 'result', is_error: false }, isError: false };
  };
  await askTestWithin(task, question, {
    projectsDir: dir, settingsPath: '', log, broadcast: () => {}, runners: { runTurn },
  } as unknown as OrchestratorCtx);
  return prompt;
}

describe('spec 098 — the terminal ask seed', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ask-seed-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  test('THE FENCE: a 52-node build + a 40KB spec seeds under 16KB (was ~143KB)', async () => {
    const yaml = workflowYaml(52);
    assert.ok(yaml.length > 3000, 'fixture is a real-sized workflow');
    const task = await seededTask(dir, { yaml, spec: '# Spec\n' + 'x'.repeat(40_000) });
    const prompt = await promptFor(dir, task);
    assert.ok(prompt.length < 16_000, `seed grew back to ${prompt.length} chars — something was re-inlined`);
  });

  test('the raw YAML body is NOT in the prompt, but every node id IS', async () => {
    const task = await seededTask(dir, { yaml: workflowYaml(52), spec: '# small spec' });
    const prompt = await promptFor(dir, task);
    assert.ok(!prompt.includes('sourceHandle') && !prompt.includes('        body:'), 'raw YAML leaked in');
    for (const i of [0, 17, 51]) assert.ok(prompt.includes(`${1000 + i}`), `node ${1000 + i} missing from the map`);
    assert.match(prompt, /52 nodes:/);
    assert.match(prompt, /projects\/_drafts\/big\/workflows\/main\.yml/, 'the path must be there to read details');
  });

  test('a node title/type is read from `data:`, never from an edge or a body field', async () => {
    const idx = buildWorkflowIndex(workflowYaml(5));
    assert.equal(idx.ok, true);
    assert.equal(idx.nodes, 5);
    assert.equal(idx.edges, 4);
    assert.match(idx.text, /1000 \| trigger-webhook \| node 0/);
    assert.ok(!idx.text.includes('custom'), 'an edge type must not be reported as a node type');
    assert.ok(!idx.text.includes('| string'), 'a body field type must not be reported as a node type');
  });

  test('an unparseable workflow degrades HONESTLY — never a half map', async () => {
    const broken = 'workflow:\n  graph:\n   nodes:\n  - id: [unclosed\n';
    const idx = buildWorkflowIndex(broken);
    assert.equal(idx.ok, false, 'a shape it does not understand must report failure, not guess');
    const task = await seededTask(dir, { yaml: broken, spec: '# s' });
    const prompt = await promptFor(dir, task);
    assert.ok(prompt.includes('unclosed'), 'a small unreadable file is handed over raw');
  });

  test('a BIG unparseable workflow points at the file instead of inlining 100KB of it', async () => {
    const big = 'workflow: not-a-graph\n' + 'z'.repeat(60_000);
    const task = await seededTask(dir, { yaml: big, spec: '# s' });
    const prompt = await promptFor(dir, task);
    assert.ok(!prompt.includes('z'.repeat(1000)), 'the 60KB body must not be inlined');
    assert.match(prompt, /node map could not be built/);
    assert.ok(prompt.length < 8000, `still ${prompt.length} chars`);
  });

  test('a small SPEC.md is still inlined whole; a big one becomes its OPENING + outline + path', async () => {
    const small = await seededTask(dir, { yaml: workflowYaml(3), spec: '# Spec\nthe whole body is here' });
    assert.match(await promptFor(dir, small), /the whole body is here/);

    const dir2 = await mkdtemp(join(tmpdir(), 'ask-seed2-'));
    try {
      const bigSpec = ['# Title', ...Array.from({ length: 20 }, (_, i) => `## Section ${i}\n` + 'y'.repeat(1000))].join('\n');
      const big = await seededTask(dir2, { yaml: workflowYaml(3), spec: bigSpec });
      const prompt = await promptFor(dir2, big);
      assert.match(prompt, /## Section 7/, 'the outline keeps every heading');
      // The opening rides along — a heading list says what sections exist, not what the thing is for —
      // but it is BOUNDED. A whole 20KB body coming back must still fail here.
      assert.ok(prompt.includes('y'.repeat(300)), 'the opening is present');
      assert.ok(!prompt.includes('y'.repeat(900)), '…and it is an excerpt, not the body');
      assert.match(prompt, /outline only/);
      assert.ok(Buffer.byteLength(prompt) < 6 * 1024, `a 20KB spec must not cost 20KB: ${Buffer.byteLength(prompt)}B`);
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  });

  // ── S2: only THIS message's files carry the "read them" invitation ──────────────────────────────
  // Measured cause: 13 attachments were listed under "Read the file(s) above" on all 46 asks, and 7 of
  // 15 files were read more than once — 421k tokens of repetition, at 52k–274k per screenshot.

  test('older attachments stay listed (with paths) but lose the read invitation', async () => {
    const task = await seededTask(dir, { yaml: workflowYaml(3), spec: '# s' });
    task.attachments = ['uploads/0_old.png', 'uploads/1_old.png', 'uploads/2_new.png'];
    await saveTask(dir, task);

    let prompt = '';
    const runTurn = async (
      _s: ClaudeSession, p: string, onSid?: (id: string) => void, o?: { onText?: (t: string) => void }
    ): Promise<TurnResult> => {
      prompt = p; onSid?.('s'); o?.onText?.('ok');
      return { sessionId: 's', result: { type: 'result', is_error: false }, isError: false };
    };
    const ctx = { projectsDir: dir, settingsPath: '', log, broadcast: () => {}, runners: { runTurn } } as unknown as OrchestratorCtx;
    await askTestWithin(task, 'what is in the new one?', ctx, [2]); // index 2 is this message's upload

    const invite = prompt.slice(prompt.indexOf('Attached files:'), prompt.indexOf('Shared earlier'));
    assert.ok(invite.includes('2_new.png'), 'the new file is under the read invitation');
    assert.ok(!invite.includes('0_old.png'), 'an old file must not be');
    assert.match(prompt, /Shared earlier in this conversation/);
    assert.ok(prompt.includes('uploads/0_old.png'), 'old paths stay reachable for a deliberate re-read');
  });

  // THE CASE THAT PAYS: most questions carry no file at all. If "this turn brought nothing" collapses
  // into "no caller opinion", every older file gets the read invitation again and S2 buys nothing on the
  // turns that actually made up the bill (46 asks over 13 attachments, nearly all of them file-less).
  test('a question with NO new file leaves every attachment without the read invitation', async () => {
    const task = await seededTask(dir, { yaml: workflowYaml(3), spec: '# s' });
    task.attachments = ['uploads/0_old.png', 'uploads/1_old.png'];
    await saveTask(dir, task);

    let prompt = '';
    const runTurn = async (
      _s: ClaudeSession, p: string, onSid?: (id: string) => void, o?: { onText?: (t: string) => void }
    ): Promise<TurnResult> => {
      prompt = p; onSid?.('s'); o?.onText?.('ok');
      return { sessionId: 's', result: { type: 'result', is_error: false }, isError: false };
    };
    const ctx = { projectsDir: dir, settingsPath: '', log, broadcast: () => {}, runners: { runTurn } } as unknown as OrchestratorCtx;
    await askTestWithin(task, 'what does node 1001 do?', ctx, []); // [] = this turn uploaded nothing

    assert.ok(!prompt.includes('Read the file(s) above'), 'no file is new ⇒ nobody is invited to re-read');
    assert.match(prompt, /Shared earlier in this conversation/);
    for (const p of task.attachments) assert.ok(prompt.includes(p), `${p} stays reachable`);
    assert.match(prompt, /untrusted DATA/, 'the security caveat rides along with an older-only list too');
  });

  test('an OMITTED index list is byte-identical to the pre-098 behavior (phase/reply seam)', async () => {
    const { attachmentBlock } = await import('../server/lib/attachments.js');
    const paths = ['uploads/0_a.png', 'uploads/1_b.png'];
    assert.equal(attachmentBlock(paths, undefined), attachmentBlock(paths));
    assert.ok(!attachmentBlock(paths).includes('Shared earlier'), 'phase/reply prompts unchanged');
    // …and an EMPTY list is NOT the same thing: it means "nothing here is new".
    assert.notEqual(attachmentBlock(paths, []), attachmentBlock(paths));
    assert.ok(!attachmentBlock(paths, []).includes('Read the file(s) above'));
    // every path survives either way — losing one would strip the user's file from the prompt
    for (const p of paths) assert.ok(attachmentBlock(paths, []).includes(p), p);
  });

  // ── the map must not lie about a loop body ──────────────────────────────────────────────────────
  // In Dify's DSL an iteration's children are NOT a separate graph: they sit in this same `nodes:` array
  // with `parentId`, and their edges sit in this same `edges:` list. The first cut of this map announced
  // "inner graph — not expanded here", which was false, and worse: it left `a -> b` looking like main
  // flow when b runs once per item.
  test('an iteration child is marked as living inside its container', () => {
    const yaml = [
      'workflow:', '  graph:', '    nodes:', "    - id: 'it'", '      data:', '        type: iteration',
      '        title: loop it', "    - id: 'kid'", '      parentId: it', '      data:',
      '        type: http-request', '        title: fetch', "    - id: 'b'", '      data:',
      '        type: end', '        title: done',
      '    edges:', "    - source: 'it'", "      target: 'b'",
    ].join('\n');
    const idx = buildWorkflowIndex(yaml);
    assert.equal(idx.ok, true);
    assert.match(idx.text, /kid \| http-request \| fetch \[inside it\]/);
    assert.ok(!idx.text.includes('not expanded'), 'the old claim was simply untrue for this DSL');
    assert.match(idx.text, /once per item/, 'and the reader is told what "inside" costs');
  });

  test('a container with no resolvable body says so instead of implying it has none', () => {
    const yaml = [
      'workflow:', '  graph:', '    nodes:', "    - id: 'it'", '      data:', '        type: iteration',
      '        title: loop it', "    - id: 'b'", '      data:', '        type: end', '        title: done',
      '    edges:', "    - source: 'it'", "      target: 'b'",
    ].join('\n');
    const idx = buildWorkflowIndex(yaml);
    assert.equal(idx.ok, true);
    assert.match(idx.text, /it declare[s]? a body this map could not resolve/);
  });

  // ── the two ways a hand-rolled scan lies with a straight face ───────────────────────────────────

  test('a column-0 continuation line inside a quoted scalar does NOT silently truncate the node list', () => {
    // The exact shape found in skills/Tomatio13/example/manual_search.yml, which reported 5 of 6 nodes
    // with ok:true — the missing one was the `end` node. Both counters stopped early, so the
    // items-vs-nodes guard compared two equally-wrong numbers and saw no problem.
    const yaml = [
      'workflow:', '  graph:', '    nodes:',
      "    - id: 'a'", '      data:', '        type: llm', '        title: ask',
      "        prompt: 'first line", '回答は以下の形式で作成してください：', "質問: here'",
      "    - id: 'end1'", '      data:', '        type: end', '        title: done',
    ].join('\n');
    const idx = buildWorkflowIndex(yaml);
    assert.equal(idx.ok, false, 'a scan that fell out of the array mid-scalar must disown its result');
    assert.ok(!idx.text.includes('end1'), 'and must not publish the half it did see');
  });

  test('flow-style YAML is refused rather than reported as a workflow with no connections', () => {
    // `data: {type: llm}` yields ids and nothing else; the edges yield no pairs at all. Rendering that
    // produced a map saying "3 nodes" with no edge line — read as "nothing is connected", which is a
    // confident lie about the one thing the map exists to answer.
    const yaml = [
      'app:', '  name: flow', 'workflow:', '  graph:', '    nodes:',
      "      - id: '100'", '        data: {type: start, variables: []}',
      "      - id: '200'", '        data: {type: llm, prompt: "hi"}',
      '    edges:', "      - {source: '100', target: '200'}",
    ].join('\n');
    const idx = buildWorkflowIndex(yaml);
    assert.equal(idx.ok, false, 'ids alone are not a map');
  });

  test('a workflow that genuinely has no edges still gets its node map', () => {
    const yaml = [
      'workflow:', '  graph:', '    nodes:', "    - id: 'solo'", '      data:',
      '        type: start', '        title: only node',
    ].join('\n');
    const idx = buildWorkflowIndex(yaml);
    assert.equal(idx.ok, true, 'no `edges:` key ⇒ nothing failed, there is simply nothing to list');
    assert.equal(idx.edges, 0);
    assert.match(idx.text, /solo \| start/);
  });

  // ── S4, in bytes ────────────────────────────────────────────────────────────────────────────────
  // The first fence measured `String.length`, so a Japanese SPEC.md of 16,398 BYTES slipped under a
  // "16KB" cap (it is ~5,500 characters) and was inlined whole. Every threshold is bytes now.
  test('THE FENCE, in Japanese: a CJK spec is capped by its byte size, not its character count', async () => {
    const spec = '# 仕様\n' + Array.from({ length: 30 }, (_, i) => `## 第${i}節\n` + 'あ'.repeat(300)).join('\n');
    assert.ok(spec.length < 16 * 1024, 'the fixture is under the cap when miscounted as characters');
    assert.ok(Buffer.byteLength(spec) > 16 * 1024, 'and over it in the bytes that get billed');
    const task = await seededTask(dir, { yaml: workflowYaml(52), spec });
    const prompt = await promptFor(dir, task);
    assert.match(prompt, /outline only/, 'so it must ride as an outline');
    assert.ok(!prompt.includes('あ'.repeat(400)), 'not as a wall of body text');
    assert.ok(Buffer.byteLength(prompt) < 16 * 1024, `seed is ${Buffer.byteLength(prompt)} bytes`);
  });

  // ── the outline cap's own edge cases (found reviewing the cap after it shipped) ─────────────────
  // The cap ran over the heading list unconditionally, so on the two inputs where there was no usable
  // heading list it produced a seed with NO content — the excerpt it was supposed to protect was
  // replaced by the words "… and 0 more headings".

  test('a big spec with NO headings hands over an excerpt, not a count of nothing', async () => {
    const spec = 'あ'.repeat(20_000); // 60KB of Japanese, not one `#`
    const task = await seededTask(dir, { yaml: workflowYaml(3), spec });
    const prompt = await promptFor(dir, task);
    assert.ok(!prompt.includes('0 more headings'), 'the excerpt must not be replaced by a count of nothing');
    assert.ok(prompt.includes('あ'.repeat(200)), 'an actual opening excerpt is present');
    assert.match(prompt, /no headings/, 'and it says why it is an excerpt rather than an outline');
    assert.ok(Buffer.byteLength(prompt) < 16 * 1024, `seed is ${Buffer.byteLength(prompt)} bytes`);
  });

  test('one heading larger than the whole outline budget is kept, clipped', async () => {
    const spec = `# ${'x'.repeat(9000)}\n${'body\n'.repeat(5000)}`;
    const task = await seededTask(dir, { yaml: workflowYaml(3), spec });
    const prompt = await promptFor(dir, task);
    assert.ok(prompt.includes(`# ${'x'.repeat(150)}`), 'the sole heading survives');
    assert.ok(!prompt.includes('1 more heading'), 'it is not dropped and counted');
    assert.ok(Buffer.byteLength(prompt) < 16 * 1024, `seed is ${Buffer.byteLength(prompt)} bytes`);
  });

  test('a spec with more headings than the budget says how many it left out', async () => {
    const spec = ['# T', ...Array.from({ length: 2000 }, (_, i) => `## Section number ${i}\n` + 'y'.repeat(50))].join('\n');
    const task = await seededTask(dir, { yaml: workflowYaml(3), spec });
    const prompt = await promptFor(dir, task);
    assert.match(prompt, /… and \d+ more headings \(read the file\)/);
    assert.ok(Buffer.byteLength(prompt) < 16 * 1024, `seed is ${Buffer.byteLength(prompt)} bytes`);
  });

  /* Measured after `main.yml` became a map: SPEC.md was the biggest thing left — 9.9KB and 11.5KB on two
     real builds, BOTH under the old 16KB threshold, so both were inlined whole on every question and made
     up ~65% of the artifact context. A 10KB spec must not be inlined. */
  test('a typical 10KB spec rides as an outline, not whole', async () => {
    const spec = ['# Quy trình', ...Array.from({ length: 12 }, (_, i) => `## Bước ${i}\n` + 'chi tiết. '.repeat(80))].join('\n');
    assert.ok(Buffer.byteLength(spec) > 9_000 && Buffer.byteLength(spec) < 13_000, 'the fixture is a typical spec');
    const task = await seededTask(dir, { yaml: workflowYaml(3), spec });
    const prompt = await promptFor(dir, task);
    assert.match(prompt, /outline only/, 'a 10KB spec is exactly the case that used to slip through');
    assert.match(prompt, /## Bước 11/, 'every heading survives');
    assert.ok(Buffer.byteLength(prompt) < 4 * 1024, `seed is ${Buffer.byteLength(prompt)}B — it was ~11KB`);
  });

  test('a very long node title cannot make the map unbounded', () => {
    const yaml = [
      'workflow:', '  graph:', '    nodes:', "    - id: 'a'", '      data:', '        type: llm',
      `        title: ${'t'.repeat(5000)}`,
    ].join('\n');
    const idx = buildWorkflowIndex(yaml);
    assert.equal(idx.ok, true);
    assert.ok(idx.text.length < 200, `one node produced ${idx.text.length} chars`);
  });
});
