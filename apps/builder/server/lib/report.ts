/**
 * report.ts — Phase ④ Test&Report BACKEND (no claude turn), spec 009 Lát 2 + Lát 5.
 *
 * Re-runs the 3 linters on the produced workflow and synthesizes
 * `apps/builder/.runs/<taskId>/report.json` (shape per test.md :36–44). Deploy-aware (Lát 5):
 *   - `none`     → local only; `app_url`/`duplicate_warning` null.
 *   - `cloud`    → skip import (CSRF blocks auto); the notes carry the copyable-YAML + Studio steps.
 *   - `selfhost` → the import (push) is a SEPARATE step (orchestrator `runImportAndFinish`); this fn
 *                  writes the report and re-writes it with `app_url`/`duplicate_warning` after push.
 *
 * NEVER runs `sync.py` itself (that is `dify-io.ts`). The Dify token appears nowhere in the report.
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
  /** all 3 linters exited 0 — gates whether a selfhost build may show the Import button (AC #25). */
  lintClean: boolean;
}

export interface ReportOpts {
  /** the still-failing "Accept anyway" human override (§D / AC #25). */
  acceptedLintFailure?: boolean;
  /** selfhost: the clickable workflow URL after a successful import (else null). */
  appUrl?: string | null;
  /** selfhost edit-existing: the prominent "created a NEW app (duplicate)" warning (spec footgun). */
  duplicateWarning?: string | null;
  /** selfhost: a note when the app id could not be captured ("push may have completed — check Dify"). */
  importNote?: string | null;
}

/** The Dify Studio manual-import steps for the cloud path (AC #9) — copyable YAML lives in main.yml. */
function cloudStudioNote(wfRel: string): string {
  return (
    'Cloud deploy: auto-import is blocked by CSRF, so import manually. The copyable YAML is the ' +
    `produced workflow (${wfRel}, shown in the main.yml tab). Steps in Dify Studio: ` +
    '① Studio → Create app → "Import DSL" → ② paste the YAML (or upload the file) → ③ Create.'
  );
}

export async function runReport(
  projectsDir: string,
  task: Task,
  log: SessionLogger,
  opts?: ReportOpts
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
  const lintClean = lint.validate === 0 && lint.lint_refs === 0 && lint.lint_plugin_hashes === 0;

  // 2. Synthesize report.json. `accepted_lint_failure` marks the still-failing "Accept anyway"
  //    human override (§D / AC #25). Deploy drives app_url / duplicate_warning / notes.
  const accepted = !!opts?.acceptedLintFailure;
  const appUrl = opts?.appUrl ?? null;
  const duplicateWarning = opts?.duplicateWarning ?? null;
  const lintLine = lintNotes.length
    ? `lint failures recorded: ${lintNotes.join('; ')}`
    : 'all linters passed';

  const noteParts: string[] = [lintLine];
  if (accepted) noteParts.unshift('ACCEPTED with failing linters (human "Accept anyway" override).');
  if (task.deploy === 'none') noteParts.push('deploy=none (no Dify contact).');
  if (task.deploy === 'cloud') noteParts.push(cloudStudioNote(wfRel));
  if (task.deploy === 'selfhost') {
    if (appUrl) noteParts.push(`imported to Dify: ${appUrl}`);
    if (opts?.importNote) noteParts.push(opts.importNote);
  }
  // The duplicate warning leads the notes so the UI surfaces it prominently (spec footgun).
  if (duplicateWarning) noteParts.unshift(`⚠ ${duplicateWarning}`);

  const report = {
    workflow_file: wfRel,
    lint: {
      validate: lint.validate,
      lint_refs: lint.lint_refs,
      lint_plugin_hashes: lint.lint_plugin_hashes,
    },
    deploy: task.deploy,
    app_url: appUrl,
    duplicate_warning: duplicateWarning,
    accepted_lint_failure: accepted,
    notes: noteParts.join(' '),
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

  return { ok: reasons.length === 0, reasons, reportRel, lintClean };
}
