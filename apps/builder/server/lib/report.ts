/**
 * report.ts — Phase ④ Test&Report BACKEND (no claude turn), spec 009 Lát 2.
 *
 * `deploy=none` only: re-run the 3 linters on the produced `main.yml`, synthesize
 * `apps/builder/.runs/<taskId>/report.json` (shape per test.md :36–44, but `deploy:"none"`),
 * and gate on the report file existing + non-empty (there is NO `result` event — ④ is backend).
 *
 * NEVER runs `sync.py` (Dify I/O is backend-owned and out of scope for Lát 2). The Dify token
 * appears nowhere.
 */
import { join } from 'node:path';
import { stat, writeFile } from 'node:fs/promises';
import { runPython } from './shell.js';
import type { Task } from '../state/task.js';
import type { SessionLogger } from './claude-session.js';

export interface ReportResult {
  ok: boolean;
  reasons: string[];
  reportRel: string;
}

export async function runReport(
  projectsDir: string,
  task: Task,
  log: SessionLogger,
  opts?: { acceptedLintFailure?: boolean }
): Promise<ReportResult> {
  const slug = task.slug!;
  const wfRel = `projects/${slug}/workflows/${task.workflowFile}`;

  // 1. Re-run the 3 linters (relative .venv/bin/python, cwd = projectsDir); capture exit codes.
  const linters: Array<{ key: string; args: string[] }> = [
    { key: 'validate', args: ['skills/mango-svip/scripts/validate_workflow.py', wfRel] },
    { key: 'lint_refs', args: ['tools/dify_base/lint_refs.py', wfRel] },
    { key: 'lint_plugin_hashes', args: ['tools/dify_base/lint_plugin_hashes.py', wfRel] },
  ];
  const lint: Record<string, number> = {};
  const lintNotes: string[] = [];
  for (const l of linters) {
    const r = await runPython(projectsDir, l.args);
    lint[l.key] = r.code;
    if (r.code !== 0) {
      const detail = `${r.stdout}\n${r.stderr}`.trim().split('\n').slice(-4).join(' ⏎ ');
      lintNotes.push(`${l.key} exit ${r.code}: ${detail}`);
    }
  }

  // 2. Synthesize report.json (deploy:"none"; app_url/duplicate_warning null — no Dify contact).
  //    `accepted_lint_failure` marks the still-failing "Accept anyway" human override (§D / AC #25):
  //    ④ proceeded with lint≠0 by explicit user choice — surfaced prominently, never an auto path.
  const accepted = !!opts?.acceptedLintFailure;
  const baseNote = lintNotes.length
    ? `lint failures recorded: ${lintNotes.join('; ')}`
    : 'all linters passed; deploy=none (no Dify contact).';
  const report = {
    workflow_file: wfRel,
    lint: {
      validate: lint.validate,
      lint_refs: lint.lint_refs,
      lint_plugin_hashes: lint.lint_plugin_hashes,
    },
    deploy: 'none' as const,
    app_url: null,
    duplicate_warning: null,
    accepted_lint_failure: accepted,
    notes: accepted
      ? `ACCEPTED with failing linters (human "Accept anyway" override). ${baseNote}`
      : baseNote,
  };
  const reportRel = `apps/builder/.runs/${task.taskId}/report.json`;
  const reportAbs = join(projectsDir, reportRel);
  await writeFile(reportAbs, JSON.stringify(report, null, 2));
  task.artifacts.report = reportRel;

  // 3. Gate for ④ = report.json exists + non-empty (no result event — ④ is backend, not a turn).
  const reasons: string[] = [];
  let size = -1;
  try {
    size = (await stat(reportAbs)).size;
  } catch {
    reasons.push(`report.json missing: ${reportRel}`);
  }
  if (size === 0) reasons.push(`report.json empty: ${reportRel}`);
  if (lintNotes.length) log.warn({ taskId: task.taskId, lintNotes }, 'report: lint non-zero');

  return { ok: reasons.length === 0, reasons, reportRel };
}
