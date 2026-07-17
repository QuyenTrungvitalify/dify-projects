/**
 * Spec 062 S2/S5 — the run-dossier bundle assembler (lib/bundle.ts). Builds a real zip from a fixture
 * run dir + workflow subtree and verifies via the system `unzip`: summary.md leads; the artifacts +
 * transcript + events + the workflow DSL are present; `sessionIds` is STRIPPED from the bundled
 * task.json; every text file is REDACTED (a Bearer token → ***, S5); attachments ride along RAW; and
 * the ~25 MB cap omits overflow with a summary note that is never silent. Confinement: buildBundle only
 * ever reads under the run dir + the task's workflow subtree (it is handed a Task, never a raw path).
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { buildBundle } from '../server/lib/bundle.js';
import uiRoutes from '../server/routes/ui.js';
import type { Task } from '../server/state/task.js';

function hasUnzip(): boolean {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const TASK_ID = '1784212050999';

function mkFixture(): { projectsDir: string; task: Task; cleanup: () => void } {
  const projectsDir = mkdtempSync(join(tmpdir(), 'bundle-'));
  const runDir = join(projectsDir, 'apps/builder/.runs', TASK_ID);
  const wfDir = join(projectsDir, 'projects/demo/slack_news');
  mkdirSync(join(runDir, 'transcripts'), { recursive: true });
  mkdirSync(join(runDir, 'uploads'), { recursive: true });
  mkdirSync(join(wfDir, 'workflows'), { recursive: true });

  const task: Task = {
    taskId: TASK_ID,
    project: 'demo',
    workflowSlug: 'slack_news',
    workflow: 'Slack news',
    workflowFile: 'main.yml',
    requirement: 'fetch RSS and post to Slack',
    seedPath: null,
    seedAppId: null,
    deploy: 'none',
    testMode: 'static',
    confirmMode: 'each_step',
    fastMode: false,
    phase: 'test',
    status: 'done',
    name: 'Slack news bot',
    sessionIds: { analyze: 'sess-A', implement: 'sess-B' },
    artifacts: { report: `apps/builder/.runs/${TASK_ID}/report.json` },
    analysisPattern: 'scheduled-fetch-notify',
    cost: { implement: { numTurns: 14, model: 'claude-opus-4-8' } },
  };

  writeFileSync(join(runDir, 'task.json'), JSON.stringify(task, null, 2));
  // criteria.json's REAL shape (verified against a live export): { criteria: [ "<string>", … ] } —
  // an array of plain STRINGS, not {criterion} objects. parseCriteria must handle it (regression pin).
  writeFileSync(join(runDir, 'criteria.json'), JSON.stringify({ criteria: ['posts to Slack at 09:00', 'summarizes the feed'] }));
  // report.json carries a Bearer token to prove redaction reaches bundled text.
  writeFileSync(join(runDir, 'report.json'), JSON.stringify({ notes: ['ok, but Authorization: Bearer sk-secret999 leaked'] }));
  writeFileSync(join(runDir, 'events.jsonl'), JSON.stringify({ ts: 1, phase: 'implement', kind: 'phase_start', detail: 'fresh' }) + '\n');
  writeFileSync(
    join(runDir, 'transcripts', 'implement.md'),
    ['## ③ Implement — attempt 1', '### Tool calls', '- Bash  ls -la /nope  ✗', '- Bash  find . -name x  ✗', '- Write  main.yml  ✓', '### Result', 'ok', ''].join('\n')
  );
  writeFileSync(join(wfDir, 'SPEC.md'), '# SPEC\nposts to Slack\n');
  writeFileSync(join(wfDir, 'workflows', 'main.yml'), 'app:\n  name: Slack news\nversion: 0.6.0\n');
  writeFileSync(join(runDir, 'uploads', 'note.txt'), 'a user attachment');

  return { projectsDir, task, cleanup: () => rmSync(projectsDir, { recursive: true, force: true }) };
}

function extract(zip: Buffer): { dir: string; read: (name: string) => string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-out-'));
  const zp = join(dir, 'b.zip');
  writeFileSync(zp, zip);
  execFileSync('unzip', ['-o', '-q', zp, '-d', join(dir, 'out')]);
  return {
    dir,
    read: (name: string) => readFileSync(join(dir, 'out', name), 'utf8'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe('buildBundle (spec 062 S2/S5)', () => {
  let unzip = false;
  before(() => {
    unzip = hasUnzip();
  });

  test('bundles summary.md + artifacts + transcript + DSL; the zip opens cleanly', async (t) => {
    if (!unzip) return t.skip('no unzip');
    const fx = mkFixture();
    try {
      const zipBuf = await buildBundle(fx.projectsDir, fx.task);
      const zp = join(fx.projectsDir, 'b.zip');
      writeFileSync(zp, zipBuf);
      const listing = execFileSync('unzip', ['-l', zp], { encoding: 'utf8' });
      for (const name of ['summary.md', 'dossier.json', 'build-info.json', 'task.json', 'criteria.json',
        'report.json', 'events.jsonl', 'SPEC.md', 'workflows/main.yml', 'transcripts/implement.md', 'attachments/note.txt']) {
        assert.ok(listing.includes(name), `bundle contains ${name}`);
      }
      assert.doesNotThrow(() => execFileSync('unzip', ['-t', zp], { stdio: 'ignore' }), 'valid archive');
    } finally {
      fx.cleanup();
    }
  });

  test('task.json has sessionIds STRIPPED; a Bearer token is REDACTED in report.json (S5)', async (t) => {
    if (!unzip) return t.skip('no unzip');
    const fx = mkFixture();
    let out: ReturnType<typeof extract> | null = null;
    try {
      out = extract(await buildBundle(fx.projectsDir, fx.task));
      const taskJson = out.read('task.json');
      assert.ok(!taskJson.includes('sessionIds'), 'sessionIds stripped from bundled task.json');
      assert.ok(!taskJson.includes('sess-A'), 'no session id value leaks');
      const report = out.read('report.json');
      assert.ok(!report.includes('sk-secret999'), 'raw token must not appear');
      assert.match(report, /Bearer \*\*\*/);
    } finally {
      out?.cleanup();
      fx.cleanup();
    }
  });

  test('summary.md renders the dossier (intent + files listing)', async (t) => {
    if (!unzip) return t.skip('no unzip');
    const fx = mkFixture();
    let out: ReturnType<typeof extract> | null = null;
    try {
      out = extract(await buildBundle(fx.projectsDir, fx.task));
      const summary = out.read('summary.md');
      assert.match(summary, /# Run dossier — Slack news bot · 1784212050999/);
      assert.match(summary, /fetch RSS and post to Slack/);
      assert.match(summary, /- transcripts\/implement\.md/);
      // the string-array criteria.json parsed → the acceptance rubric renders (not "no rubric")
      assert.match(summary, /- \[ \] posts to Slack at 09:00/);
      assert.ok(!summary.includes('no acceptance rubric'), 'criteria were parsed from the real string-array shape');
      // tool-activity tally parsed back from the transcript → surfaced in Process (3 calls, 2 ✗)
      assert.match(summary, /③ Implement:.*3 tool calls, 2 ✗ \(67%\) — 2 Bash · 1 Write/);
    } finally {
      out?.cleanup();
      fx.cleanup();
    }
  });

  test('build-info.json + dossier.json — provenance stamp + machine-readable twin (#1/#2)', async (t) => {
    if (!unzip) return t.skip('no unzip');
    const fx = mkFixture();
    let out: ReturnType<typeof extract> | null = null;
    try {
      out = extract(await buildBundle(fx.projectsDir, fx.task));
      // #1 provenance: node stamped always; models derived from task.cost[*].model; git/version degrade
      // to null in a bare temp dir (no .git / no package.json) — the best-effort contract.
      const info = JSON.parse(out.read('build-info.json'));
      assert.equal(info.node, process.version);
      assert.deepEqual(info.models, ['claude-opus-4-8']);
      assert.ok('gitSha' in info && 'builderVersion' in info, 'stamp fields present (may be null)');
      assert.equal(typeof info.exportedAt, 'number');
      // #2 machine-readable twin: same facts as summary.md, as JSON
      const d = JSON.parse(out.read('dossier.json'));
      assert.equal(d.taskId, TASK_ID);
      assert.equal(d.status, 'done');
      assert.equal(d.pattern, 'scheduled-fetch-notify');
      assert.equal(d.cost.perPhase.implement.model, 'claude-opus-4-8');
      assert.ok(Array.isArray(d.acceptance) && d.acceptance.length === 2, 'criteria carried into the JSON');
      assert.ok(!out.read('task.json').includes('sessionIds'), 'still redacted/stripped in the twin bundle');
    } finally {
      out?.cleanup();
      fx.cleanup();
    }
  });

  test('GET /api/tasks/:id/bundle → 200 application/zip with a download filename (route wiring)', async () => {
    const fx = mkFixture();
    const app = Fastify();
    try {
      await app.register(uiRoutes, { projectsDir: fx.projectsDir, now: () => 0 });
      const res = await app.inject({ method: 'GET', url: `/api/tasks/${TASK_ID}/bundle` });
      assert.equal(res.statusCode, 200);
      assert.match(String(res.headers['content-type']), /application\/zip/);
      assert.match(String(res.headers['content-disposition']), new RegExp(`filename="builder-slack_news-${TASK_ID}\\.zip"`));
      assert.equal(res.rawPayload.subarray(0, 2).toString('latin1'), 'PK', 'zip magic bytes');
      if (unzip) {
        const zp = join(fx.projectsDir, 'via-http.zip');
        writeFileSync(zp, res.rawPayload);
        assert.doesNotThrow(() => execFileSync('unzip', ['-t', zp], { stdio: 'ignore' }));
      }
    } finally {
      await app.close();
      fx.cleanup();
    }
  });

  test('route rejects a crafted id (400) and a missing task (404) — confinement guard', async () => {
    const fx = mkFixture();
    const app = Fastify();
    try {
      await app.register(uiRoutes, { projectsDir: fx.projectsDir, now: () => 0 });
      const bad = await app.inject({ method: 'GET', url: '/api/tasks/..%2f..%2fetc/bundle' });
      assert.equal(bad.statusCode, 400); // isTaskId rejects a non-13-digit id before any fs access
      const missing = await app.inject({ method: 'GET', url: '/api/tasks/9999999999999/bundle' });
      assert.equal(missing.statusCode, 404);
    } finally {
      await app.close();
      fx.cleanup();
    }
  });

  test('the attachment cap omits overflow and summary.md STATES it (never silent, OQ5)', async () => {
    const fx = mkFixture();
    try {
      // A 1-byte cap forces the (present) attachment to be omitted.
      const zip = await buildBundle(fx.projectsDir, fx.task, { attachmentCapBytes: 1 });
      if (!unzip) {
        assert.ok(zip.length > 0);
        return;
      }
      const out = extract(zip);
      try {
        const summary = out.read('summary.md');
        assert.match(summary, /1 attachment\(s\) omitted/);
        assert.throws(() => out.read('attachments/note.txt'), 'the over-cap attachment is not in the zip');
      } finally {
        out.cleanup();
      }
    } finally {
      fx.cleanup();
    }
  });
});
